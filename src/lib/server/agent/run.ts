import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ZodType } from 'zod';

export interface RunSpec {
	/** The task. */
	prompt: string;
	/** Role and output contract. Always explicit — never the claude_code preset. */
	systemPrompt: string;
	model: string;
	/** Auto-approved tools. */
	allowedTools: string[];
	/** Hard-denied tools. Everything dangerous is listed explicitly rather than
	 *  relying on the permission mode to fall through the right way. */
	disallowedTools: string[];
	/** Scoped to a single listing's photo directory so the agent cannot wander
	 *  the filesystem even if a prompt goes sideways. */
	cwd: string;
	maxTurns?: number;
	/** Called with short human-readable notes as tools fire. */
	onProgress?: (note: string) => void;
}

/**
 * Auth note: the SDK spawns the bundled Claude Code binary, which inherits this
 * process's environment. If ANTHROPIC_API_KEY is set it is used; otherwise the
 * binary falls back to the CLI's stored OAuth credentials (~/.claude). Switching
 * between the two is an env var, not a code change — which is what keeps the
 * "personal tool" and "shared deployment" cases on the same code path.
 */
function baseOptions(spec: RunSpec) {
	return {
		// Do not load ~/.claude/CLAUDE.md, project CLAUDE.md, or installed skills.
		// Without this the agent inherits the machine's personality skills and
		// writes listing copy in that voice. See scripts/smoke-agent.mjs.
		settingSources: [] as [],
		systemPrompt: spec.systemPrompt,
		model: spec.model,
		allowedTools: spec.allowedTools,
		disallowedTools: spec.disallowedTools,
		cwd: spec.cwd,
		maxTurns: spec.maxTurns ?? 12,
		permissionMode: 'dontAsk' as const,
		persistSession: false
	};
}

/** Map a tool invocation to something worth showing a human. */
function progressNote(name: string, input: unknown): string | null {
	const file = (input as { file_path?: string })?.file_path;
	const q = (input as { query?: string })?.query;
	const url = (input as { url?: string })?.url;

	switch (name) {
		case 'Read':
			return file ? `looking at ${file.split('/').pop()}` : 'looking at a photo';
		case 'Glob':
			return 'listing the photos';
		case 'WebSearch':
			return q ? `searching: ${q}` : 'searching the web';
		case 'WebFetch':
			return url ? `reading ${safeHost(url)}` : 'opening a page';
		default:
			return null;
	}
}

function safeHost(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return 'a page';
	}
}

/**
 * Tool calls arrive as `tool_use` content blocks nested inside `assistant`
 * messages — not as a top-level message type. (Verified against the live SDK
 * with scripts/dump-messages.mjs; re-run that after an SDK upgrade if progress
 * notes go quiet.)
 */
async function runOnce(spec: RunSpec): Promise<string> {
	let result = '';
	let sawResult = false;

	for await (const message of query({ prompt: spec.prompt, options: baseOptions(spec) })) {
		const m = message as Record<string, unknown>;

		if (m.type === 'assistant') {
			const content = (m.message as { content?: unknown[] } | undefined)?.content;
			if (Array.isArray(content)) {
				for (const block of content as Record<string, unknown>[]) {
					if (block.type === 'tool_use' && typeof block.name === 'string') {
						const note = progressNote(block.name, block.input);
						if (note) spec.onProgress?.(note);
					}
				}
			}
		}

		// Long silences during reasoning otherwise look like a hang.
		if (m.type === 'system' && m.subtype === 'thinking_tokens') {
			spec.onProgress?.('thinking');
		}

		if (m.type === 'result') {
			sawResult = true;
			if (typeof m.result === 'string') result = m.result;
			if (m.is_error || (typeof m.subtype === 'string' && m.subtype !== 'success')) {
				throw new Error(
					`the agent stopped early (${m.subtype ?? 'error'}${
						m.terminal_reason ? `: ${m.terminal_reason}` : ''
					})`
				);
			}
		}
	}

	if (!sawResult) throw new Error('the agent exited without returning a result');
	if (!result.trim()) throw new Error('the agent returned no output');
	return result;
}

/** Pull the JSON payload out of the agent's prose reply. */
function extractJson(text: string): unknown {
	const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
	const candidates = fenced.length > 0 ? fenced.map((m) => m[1]) : [];

	// Fall back to the outermost brace pair if the model skipped the fence.
	const first = text.indexOf('{');
	const last = text.lastIndexOf('}');
	if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

	for (const candidate of candidates.reverse()) {
		try {
			return JSON.parse(candidate);
		} catch {
			// try the next candidate
		}
	}
	throw new Error('no parseable JSON block in the agent response');
}

/**
 * Run the agent and validate its JSON output against `schema`.
 *
 * On a parse or validation failure it re-prompts once with the specific error
 * appended, which recovers most near-misses (a wrong enum value, a missing
 * field). Two failures throw — the caller records the message on the listing's
 * `error` column rather than writing half-valid data.
 */
export async function runStructured<T>(schema: ZodType<T>, spec: RunSpec): Promise<T> {
	let lastError = '';

	for (let attempt = 0; attempt < 2; attempt++) {
		const prompt =
			attempt === 0
				? spec.prompt
				: `${spec.prompt}\n\nYour previous response could not be used: ${lastError}\nReturn corrected JSON in a single \`\`\`json fenced block. Output nothing else.`;

		try {
			const raw = await runOnce({ ...spec, prompt });
			const parsed = schema.safeParse(extractJson(raw));
			if (parsed.success) return parsed.data;

			lastError = parsed.error.issues
				.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
				.join('; ');
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
		}

		if (attempt === 0) spec.onProgress?.('output was malformed, retrying');
	}

	throw new Error(lastError || 'the agent produced unusable output');
}
