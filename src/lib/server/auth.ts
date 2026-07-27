import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { getSetting, setSetting } from './db';
import { cliAuthStatus } from './claudeCli';
import { SETTING_API_KEY } from '$lib/types';

/**
 * Where the agent's credentials come from.
 *
 * The rule from the README holds: this module does not branch the agent on which
 * one is in play. It resolves a single environment object and hands it to the
 * SDK, which does the actual resolution. Adding a way to store a key in the app
 * moved *where the string comes from*, not how it is used.
 *
 * Precedence, first hit wins:
 *
 *   1. `ANTHROPIC_API_KEY` in the process environment — the operator's override.
 *      Docker Compose and any hosted deployment set it this way, and it has to
 *      outrank the database so a deployment can't be repointed at someone else's
 *      billing through the web UI.
 *   2. A key saved in Settings — the Windows path, where there is no compose file
 *      to edit and no subscription necessarily present.
 *   3. Neither — the SDK falls back to the Claude Code OAuth credentials, which
 *      is the subscription case and the default on a machine where the user has
 *      run `claude` at least once.
 */
export type AuthMode = 'api_key_env' | 'api_key_stored' | 'subscription' | 'unknown';

export interface AuthStatus {
	mode: AuthMode;
	/** One line, written for a person who does not know what OAuth is. */
	summary: string;
	/** True when a key lives in the database (so the UI can offer to clear it). */
	hasStoredKey: boolean;
	/** Masked — the raw key is never sent to the browser. */
	storedKeyPreview: string;
	/** True when the env var is set, which makes the stored key inert. */
	envKeyOverrides: boolean;
	/** Who the CLI says is signed in — shown so a wrong account is visible. */
	account?: string;
	/**
	 * True when the sign-in question could not be answered at all (the CLI is
	 * missing, or did not reply). Distinct from a confident "not signed in":
	 * the UI must not offer to fix something it cannot see.
	 */
	signInUnknown?: boolean;
}

/**
 * Anthropic keys have looked like this since the API launched. Checking the
 * prefix catches the common newbie mistakes — pasting a session cookie, an
 * OpenAI key, or the console URL — at the point of entry rather than as an
 * opaque 401 three screens later. If the format ever changes, this is the line
 * to relax.
 */
const KEY_PREFIX = 'sk-ant-';

/** Exported so the sign-in route can refuse when an operator key is in force. */
export function envKey(): string {
	return (process.env.ANTHROPIC_API_KEY ?? '').trim();
}

/** Server-only. Never return this to a client. */
export function storedApiKey(): string {
	return getSetting(SETTING_API_KEY).trim();
}

export function isValidKeyFormat(key: string): boolean {
	return key.startsWith(KEY_PREFIX) && key.length > KEY_PREFIX.length + 8;
}

export function saveApiKey(key: string): void {
	setSetting(SETTING_API_KEY, key.trim());
}

export function clearApiKey(): void {
	setSetting(SETTING_API_KEY, '');
}

/** `sk-ant-…a1b2` — enough to tell two keys apart, not enough to use one. */
export function maskKey(key: string): string {
	if (!key) return '';
	return `${KEY_PREFIX}…${key.slice(-4)}`;
}

/**
 * The environment handed to every `query()` call.
 *
 * When no key is in play the variable is deleted rather than left empty: an
 * empty-but-present `ANTHROPIC_API_KEY` still occupies its slot in the SDK's
 * precedence chain and authenticates with an empty key, which fails in a way
 * that looks nothing like "you are not logged in".
 */
export function agentEnv(): Record<string, string | undefined> {
	const key = envKey() || storedApiKey();
	const env = { ...process.env };
	if (key) {
		env.ANTHROPIC_API_KEY = key;
	} else {
		delete env.ANTHROPIC_API_KEY;
	}
	return env;
}

/**
 * Which credential is in play, cheaply.
 *
 * Split out from `authStatus()` because the two have incompatible costs. This
 * one is called per agent run to stamp the spend ledger (invariant 10) and by
 * `costKind()` to pick the cost wording (invariant 8) — hot paths that must stay
 * synchronous. `authStatus()` asks the CLI, which means spawning a 260MB binary;
 * doing that on every run would be indefensible for a field nothing reads back.
 *
 * The subscription branch here is therefore still a heuristic: the presence of
 * `.credentials.json` under the config dir. That is a weaker signal than the CLI
 * (see `authStatus()`), but it is the right trade for a ledger stamp — the
 * question it answers is "did an API key pay for this run", and the absence of a
 * key is a complete answer to that regardless of which OAuth store was used.
 */
export function authMode(): AuthMode {
	if (envKey()) return 'api_key_env';
	if (storedApiKey()) return 'api_key_stored';

	const configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude');
	return existsSync(path.join(configDir, '.credentials.json')) ? 'subscription' : 'unknown';
}

/**
 * The full picture, for the settings page only.
 *
 * Asks the CLI whether it is signed in, which costs a process spawn — acceptable
 * on a page a user opens deliberately, not on a hot path. Use `authMode()`
 * anywhere that needs only the credential in play.
 */
export async function authStatus(): Promise<AuthStatus> {
	const stored = storedApiKey();
	const fromEnv = envKey();

	if (fromEnv) {
		return {
			mode: 'api_key_env',
			summary: 'Using an API key from the environment (ANTHROPIC_API_KEY). Billed per request.',
			hasStoredKey: Boolean(stored),
			storedKeyPreview: maskKey(stored),
			envKeyOverrides: true
		};
	}

	if (stored) {
		return {
			mode: 'api_key_stored',
			summary: 'Using the API key saved below. Billed per request against your Anthropic credits.',
			hasStoredKey: true,
			storedKeyPreview: maskKey(stored),
			envKeyOverrides: false
		};
	}

	// Ask the CLI that will actually run the work, rather than inferring from a
	// file on disk. The previous check looked for `.credentials.json` under the
	// config dir and called its presence proof — which reported "signed in" for
	// anyone whose credentials lived elsewhere, and, worse, reported "not signed
	// in" for the Claude desktop app, which shares that directory for its data
	// but keeps its token somewhere the SDK cannot read. The result was a
	// settings page insisting the machine was ready while every run failed with
	// an API error. `claude auth status --json` is answered by the same binary
	// the SDK spawns, so agreement is structural rather than hopeful.
	const cli = await cliAuthStatus(agentEnv());

	if (cli?.loggedIn) {
		// Personal accounts get an auto-named organisation ("<email>'s Organization"),
		// which alongside the email reads as a stutter rather than as information.
		// It is worth showing only when it names something the email does not.
		const email = cli.email ?? '';
		const org = cli.orgName ?? '';
		const redundant = !org || (email && org.includes(email));
		const account = redundant ? email : [email, org].filter(Boolean).join(' · ');

		// The CLI reports the plan lowercase ("pro", "max"); it is a proper noun here.
		const plan = cli.subscriptionType
			? cli.subscriptionType.charAt(0).toUpperCase() + cli.subscriptionType.slice(1)
			: '';

		return {
			mode: 'subscription',
			summary: plan
				? `Using your Claude ${plan} subscription — nothing extra to pay.`
				: 'Using your Claude subscription — no API key needed, nothing extra to pay.',
			hasStoredKey: false,
			storedKeyPreview: '',
			envKeyOverrides: false,
			account: account || undefined
		};
	}

	// A null answer is not a "no". The CLI may be missing or may have failed to
	// run, and offering a sign-in button that cannot work is worse than saying
	// so plainly.
	if (cli === null) {
		return {
			mode: 'unknown',
			summary:
				'Fleabook could not check whether this computer is signed in to Claude. Add an API key below, or reinstall Fleabook if this persists.',
			hasStoredKey: false,
			storedKeyPreview: '',
			envKeyOverrides: false,
			signInUnknown: true
		};
	}

	return {
		mode: 'unknown',
		summary:
			'Not signed in yet. Sign in with your Claude subscription below, or add an API key instead.',
		hasStoredKey: false,
		storedKeyPreview: '',
		envKeyOverrides: false
	};
}
