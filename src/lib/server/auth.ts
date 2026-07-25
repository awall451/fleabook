import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { getSetting, setSetting } from './db';
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
}

/**
 * Anthropic keys have looked like this since the API launched. Checking the
 * prefix catches the common newbie mistakes — pasting a session cookie, an
 * OpenAI key, or the console URL — at the point of entry rather than as an
 * opaque 401 three screens later. If the format ever changes, this is the line
 * to relax.
 */
const KEY_PREFIX = 'sk-ant-';

function envKey(): string {
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
 * Best-effort check for stored Claude Code credentials.
 *
 * On Linux and Windows the CLI writes `.credentials.json` under the config
 * directory, so its presence is a reliable signal. macOS keeps them in the
 * Keychain instead — hence `unknown` rather than a confident "not signed in"
 * when the file is missing. Reporting a working setup as broken is the worse
 * failure here.
 */
function hasOAuthCredentials(): boolean {
	const configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude');
	return existsSync(path.join(configDir, '.credentials.json'));
}

export function authStatus(): AuthStatus {
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

	if (hasOAuthCredentials()) {
		return {
			mode: 'subscription',
			summary: 'Using your Claude subscription — no API key needed, nothing extra to pay.',
			hasStoredKey: false,
			storedKeyPreview: '',
			envKeyOverrides: false
		};
	}

	return {
		mode: 'unknown',
		summary:
			'No API key saved and no Claude Code sign-in found. Either sign in with the Claude Code app, or add an API key below.',
		hasStoredKey: false,
		storedKeyPreview: '',
		envKeyOverrides: false
	};
}
