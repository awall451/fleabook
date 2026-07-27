import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Direct access to the `claude` binary the agent SDK ships as a platform
 * dependency.
 *
 * The SDK spawns this binary for every `query()`, but exposes nothing for the
 * two questions a *setup* screen has to answer: is this machine signed in, and
 * how does a user sign in without a terminal? The CLI answers both as
 * documented subcommands — `claude auth status --json` and `claude auth login`
 * — so this module drives them rather than reaching into the SDK's internals.
 * (`claudeAuthenticate()` exists on the SDK's control protocol but is absent
 * from its `.d.ts`, which makes it exactly the kind of undocumented dependency
 * this repo already carries two of. A published subcommand is the safer bet.)
 *
 * Everything here degrades to null rather than throwing. Auth *status* is
 * advisory — the real authority is whether a run succeeds — and a settings page
 * that 500s because a probe timed out is worse than one that says "unknown".
 */

/** The CLI is a 260MB binary; cold start is slow, and a hung probe blocks a page load. */
const PROBE_TIMEOUT_MS = 20_000;

/**
 * How long a half-finished sign-in is allowed to sit holding a child process.
 * The user has to leave the app, sign in with Anthropic, and copy a code back,
 * so this cannot be tight — but an abandoned attempt must not pin a process for
 * the life of the server.
 */
const LOGIN_TIMEOUT_MS = 10 * 60_000;

/**
 * How long to wait for a verdict after the code is handed over.
 *
 * A real exchange is one network round trip. A *rejected* code does not end the
 * process at all — the CLI complains and prompts again, which is sensible in a
 * terminal and a hang anywhere else, because nothing further will ever be
 * written to that stdin. So the wait is bounded and the child is killed when it
 * elapses, which is what turns "spinner forever" into "that code wasn't
 * accepted".
 */
const CODE_TIMEOUT_MS = 45_000;

/**
 * Where the platform binary lives, or null if it cannot be found.
 *
 * This mirrors the SDK's own resolution (`@anthropic-ai/claude-agent-sdk-<os>-<arch>/claude[.exe]`)
 * because the point is to run *the same* binary the SDK will run — a probe
 * against a different copy would answer a question nobody asked. `FLEABOOK_CLAUDE_BIN`
 * overrides it for the case where a launcher already knows the absolute path.
 *
 * Not cached: on Windows this file has been observed to disappear mid-session
 * when the CLI's self-updater renames it aside, and a cached hit would then
 * report a path that no longer exists.
 */
export function claudeBinary(): string | null {
	const override = (process.env.FLEABOOK_CLAUDE_BIN ?? '').trim();
	if (override) return existsSync(override) ? override : null;

	const suffix = process.platform === 'win32' ? '.exe' : '';
	const candidates = [
		`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude${suffix}`,
		// The musl build is a separate package with the same layout; on glibc
		// hosts this simply fails to resolve.
		`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}-musl/claude${suffix}`
	];

	const require = createRequire(import.meta.url);
	for (const spec of candidates) {
		try {
			const resolved = require.resolve(spec);
			if (existsSync(resolved)) return resolved;
		} catch {
			// Not installed for this platform — try the next.
		}
	}
	return null;
}

/** Shape of `claude auth status --json`. Every field is optional by design: it is */
/** another program's output, and a missing field must not become an exception. */
export interface CliAuthStatus {
	loggedIn?: boolean;
	authMethod?: string;
	apiProvider?: string;
	email?: string;
	orgName?: string;
	subscriptionType?: string;
}

/**
 * Ask the CLI whether it is signed in.
 *
 * Returns null when the question could not be asked at all — binary missing,
 * timed out, unparseable output. Null means "no answer", which the caller must
 * not confuse with "not signed in": reporting a working setup as broken is the
 * worse failure, and this is the exact mistake the previous file-existence
 * check made on machines where the desktop app had signed in elsewhere.
 */
export async function cliAuthStatus(
	env: Record<string, string | undefined>
): Promise<CliAuthStatus | null> {
	const bin = claudeBinary();
	if (!bin) return null;

	const raw = await runCli(bin, ['auth', 'status', '--json'], env);
	if (raw === null) return null;

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object') return null;
		return parsed as CliAuthStatus;
	} catch {
		return null;
	}
}

/**
 * Run a short CLI subcommand and return stdout, or null if it could not be run.
 *
 * The exit code is deliberately ignored. `claude auth status --json` exits 1
 * when nobody is signed in — which is an *answer*, delivered as well-formed JSON
 * on stdout, not a failure to answer. Treating a non-zero exit as "no answer"
 * collapsed "not signed in" into "cannot tell", and the settings page hides the
 * sign-in button in the second case, so the people who most needed it were the
 * only ones who never saw it. Only a spawn error or a timeout is a real failure;
 * unusable output is caught by the caller's parse.
 */
function runCli(
	bin: string,
	args: string[],
	env: Record<string, string | undefined>
): Promise<string | null> {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(bin, args, {
				env: env as NodeJS.ProcessEnv,
				stdio: ['ignore', 'pipe', 'ignore'],
				windowsHide: true
			});
		} catch {
			resolve(null);
			return;
		}

		let out = '';
		let settled = false;
		const finish = (value: string | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};

		const timer = setTimeout(() => {
			child.kill();
			finish(null);
		}, PROBE_TIMEOUT_MS);

		child.stdout?.on('data', (c) => {
			out += String(c);
		});
		child.on('error', () => finish(null));
		child.on('close', () => finish(out));
	});
}

/* ------------------------------------------------------------------------- *
 * Sign-in
 * ------------------------------------------------------------------------- */

/**
 * `claude auth login` is interactive, but only in the shallow sense: it writes a
 * URL to stdout and then blocks reading a pasted code from stdin. Both ends are
 * plain pipes — no pty is involved — which is what makes it driveable from a web
 * UI instead of a terminal. (Verified against the shipped binary. It prints
 * nothing if stdin is closed at spawn, so the pipe must be kept open even though
 * nothing is written to it until the user comes back with a code.)
 *
 * The child outlives the request that started it, so it is held here rather than
 * in a route closure: starting the flow and submitting the code are two separate
 * HTTP requests, and the process has to still be waiting when the second lands.
 * One at a time — a second attempt cancels the first, since two concurrent
 * flows would race to write the same credentials file.
 */
interface LoginSession {
	child: ReturnType<typeof spawn>;
	url: string;
	/** Resolves when the child exits; carries what to tell the user. */
	done: Promise<{ ok: boolean; message: string }>;
	settleCode: (code: string) => void;
	timer: NodeJS.Timeout;
}

let session: LoginSession | null = null;

/** Pulled off stdout; the trailing bracket guards against a wrapped line. */
const URL_PATTERN = /https:\/\/\S*claude\.com\/\S*oauth\S*/i;

export interface LoginStart {
	ok: boolean;
	/** The page the user must open to authorise. Absent when ok is false. */
	url?: string;
	error?: string;
}

/**
 * Begin a sign-in and return the URL the user has to visit.
 *
 * Resolves as soon as the URL appears rather than when the child exits — the
 * child will sit there for minutes waiting for a code, and the caller needs the
 * URL now.
 */
export function startLogin(env: Record<string, string | undefined>): Promise<LoginStart> {
	cancelLogin();

	const bin = claudeBinary();
	if (!bin) {
		return Promise.resolve({
			ok: false,
			error:
				'The Claude command-line tool that ships with Fleabook is missing. Reinstalling Fleabook will restore it.'
		});
	}

	return new Promise<LoginStart>((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(bin, ['auth', 'login', '--claudeai'], {
				env: env as NodeJS.ProcessEnv,
				// stdin stays open on purpose: the CLI prints nothing at all if it is
				// closed at spawn, and the pasted code goes back through it later.
				stdio: ['pipe', 'pipe', 'pipe'],
				windowsHide: true
			});
		} catch {
			resolve({ ok: false, error: 'Could not start the sign-in.' });
			return;
		}

		let out = '';
		let url = '';
		let resolved = false;

		let settleCode!: (code: string) => void;
		const codePromise = new Promise<string>((r) => {
			settleCode = r;
		});

		const done = new Promise<{ ok: boolean; message: string }>((finish) => {
			child.on('error', () =>
				finish({ ok: false, message: 'The sign-in helper could not be started.' })
			);
			child.on('close', (exit) => {
				clearTimeout(timer);
				if (session?.child === child) session = null;
				finish(
					exit === 0
						? { ok: true, message: 'Signed in.' }
						: {
								ok: false,
								// The CLI's own complaint is more useful than anything invented
								// here — a wrong code and an expired one read differently.
								message: lastLine(out) || 'Sign-in did not complete. Please try again.'
							}
				);
			});
		});

		const timer = setTimeout(() => {
			child.kill();
		}, LOGIN_TIMEOUT_MS);

		const onChunk = (chunk: unknown) => {
			out += String(chunk);
			if (resolved) return;
			const match = out.match(URL_PATTERN);
			if (match) {
				url = match[0];
				resolved = true;
				session = { child, url, done, settleCode, timer };
				resolve({ ok: true, url });
			}
		};

		child.stdout?.on('data', onChunk);
		child.stderr?.on('data', onChunk);

		// Feed the code through only once the user supplies it. Writing earlier
		// would send an empty line and be read as an empty answer.
		void codePromise.then((code) => {
			try {
				child.stdin?.write(`${code}\n`);
			} catch {
				// The child already exited; `done` carries the reason.
			}
		});

		child.on('close', () => {
			if (resolved) return;
			resolved = true;
			resolve({
				ok: false,
				error: lastLine(out) || 'The sign-in helper stopped before it produced a sign-in link.'
			});
		});
	});
}

/** True when a sign-in is waiting for its code. */
export function loginPending(): boolean {
	return session !== null;
}

/**
 * Hand the pasted code to the waiting CLI and report what it made of it.
 *
 * The code is written to the child's stdin and never logged: it is a
 * single-use credential, and this is the one place it passes through.
 */
export async function submitLoginCode(
	code: string
): Promise<{ ok: boolean; message: string }> {
	const current = session;
	if (!current) {
		return {
			ok: false,
			message: 'That sign-in expired. Start it again.'
		};
	}

	current.settleCode(code.trim());

	// Whichever comes first: the child's own verdict, or the deadline. Killing on
	// the deadline makes `done` resolve through the close handler, so the CLI's
	// last line still reaches the user when it wrote one.
	const expiry = new Promise<{ ok: boolean; message: string }>((resolve) => {
		setTimeout(() => {
			cancelLogin();
			resolve({
				ok: false,
				message: 'That code was not accepted. Start the sign-in again and copy the newest code.'
			});
		}, CODE_TIMEOUT_MS);
	});

	return Promise.race([current.done, expiry]);
}

/** Stop a pending sign-in — on a fresh attempt, or when the user backs out. */
export function cancelLogin(): void {
	if (!session) return;
	clearTimeout(session.timer);
	try {
		session.child.kill();
	} catch {
		// Already gone.
	}
	session = null;
}

/** The CLI reports failures on the last non-empty line; the rest is progress chatter. */
function lastLine(text: string): string {
	const lines = text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	return lines.length > 0 ? lines[lines.length - 1] : '';
}
