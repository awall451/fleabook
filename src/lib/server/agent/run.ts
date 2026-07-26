import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ZodType } from 'zod';
import { agentEnv, authStatus } from '$lib/server/auth';
import { recordAgentRun } from '$lib/server/db';
import type { AgentStage } from '$lib/types';

export interface RunSpec {
	/** The task. */
	prompt: string;
	/** Who this run is for, and which stage it is — recorded against the run's
	 *  token usage so the dashboard can attribute cost per listing and per stage. */
	listingId: string;
	stage: AgentStage;
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
 * Auth note: the SDK spawns the bundled Claude Code binary. If ANTHROPIC_API_KEY
 * is set in the environment it hands over it is used; otherwise the binary falls
 * back to the CLI's stored OAuth credentials (~/.claude). Switching between the
 * two is an env var, not a code change — which is what keeps the "personal tool"
 * and "shared deployment" cases on the same code path.
 *
 * The environment is passed explicitly rather than inherited so a key saved in
 * Settings works the same way as one exported by Docker Compose. `agentEnv()`
 * owns that precedence; nothing here branches on where the key came from.
 */
function baseOptions(spec: RunSpec) {
	return {
		env: agentEnv(),
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
			// Split on both separators — the agent reports Windows paths with
			// backslashes, and a POSIX-only split would print the whole path.
			return file ? `looking at ${file.split(/[/\\]/).pop()}` : 'looking at a photo';
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

/** What one `query()` cost. Zeroed when the SDK reports nothing usable. */
interface RunUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	costUsd: number;
	model: string | null;
}

function emptyUsage(): RunUsage {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		costUsd: 0,
		model: null
	};
}

function num(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Pull token counts off the `result` message.
 *
 * Prefer `modelUsage` over the top-level `usage`. A run is not one model: the
 * SDK also spends tokens on a small side model for its own internal work, and
 * the top-level `usage` does not include them — it undercounted a measured run
 * by a third, while `total_cost_usd` (which does cover everything) was correct.
 * `modelUsage` breaks the spend down per model, so summing it reconciles with
 * the cost. The primary model is the one with the most tokens, not whichever
 * key enumerates first — that picked the side model.
 *
 * Read defensively for the same reason the progress notes are: the exact shape
 * is an SDK implementation detail, not a documented contract. If usage flatlines
 * at zero after an upgrade, run `scripts/dump-messages.mjs` and check whether
 * these fields moved — the numbers are cosmetic, so a shape change must degrade
 * to zeroes rather than throw and take a listing's agent run down with it.
 */
function readUsage(message: Record<string, unknown>): RunUsage {
	const out = emptyUsage();
	out.costUsd = num(message.total_cost_usd);

	const modelUsage = message.modelUsage as Record<string, unknown> | undefined;
	const entries = modelUsage ? Object.entries(modelUsage) : [];

	if (entries.length === 0) {
		// No breakdown available — fall back to the aggregate, which undercounts
		// a multi-model run but is better than recording nothing.
		const usage = (message.usage ?? {}) as Record<string, unknown>;
		out.inputTokens = num(usage.input_tokens);
		out.outputTokens = num(usage.output_tokens);
		out.cacheReadTokens = num(usage.cache_read_input_tokens);
		out.cacheCreationTokens = num(usage.cache_creation_input_tokens);
		return out;
	}

	let primaryTokens = -1;
	for (const [name, raw] of entries) {
		const m = (raw ?? {}) as Record<string, unknown>;
		const input = num(m.inputTokens);
		const output = num(m.outputTokens);
		const cacheRead = num(m.cacheReadInputTokens);
		const cacheCreation = num(m.cacheCreationInputTokens);

		out.inputTokens += input;
		out.outputTokens += output;
		out.cacheReadTokens += cacheRead;
		out.cacheCreationTokens += cacheCreation;

		const total = input + output + cacheRead + cacheCreation;
		if (total > primaryTokens) {
			primaryTokens = total;
			// `canonicalModel` is the id the SDK priced against; the key can be an
			// alias or a provider-specific string.
			out.model = (m.canonicalModel as string) ?? name;
		}
	}

	return out;
}

/**
 * Tool calls arrive as `tool_use` content blocks nested inside `assistant`
 * messages — not as a top-level message type. (Verified against the live SDK
 * with scripts/dump-messages.mjs; re-run that after an SDK upgrade if progress
 * notes go quiet.)
 */
async function runOnce(spec: RunSpec, usage: RunUsage[]): Promise<string> {
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
			// Collected before the error check below: a run that failed still spent
			// tokens, and hiding that would make the usage panel flatter than reality.
			usage.push(readUsage(m));
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
 *
 * Exactly one `agent_runs` row is written per call, on both the success and the
 * failure path, with the retry's tokens folded into the same row. Bookkeeping
 * never fails the run: a broken write here would otherwise lose real listing
 * work to a dashboard feature.
 */
export async function runStructured<T>(schema: ZodType<T>, spec: RunSpec): Promise<T> {
	let lastError = '';
	const usage: RunUsage[] = [];
	const startedAt = Date.now();

	try {
		for (let attempt = 0; attempt < 2; attempt++) {
			const prompt =
				attempt === 0
					? spec.prompt
					: `${spec.prompt}\n\nYour previous response could not be used: ${lastError}\nReturn corrected JSON in a single \`\`\`json fenced block. Output nothing else.`;

			try {
				const raw = await runOnce({ ...spec, prompt }, usage);
				const parsed = schema.safeParse(extractJson(raw));
				if (parsed.success) {
					record(spec, usage, startedAt, null);
					return parsed.data;
				}

				lastError = parsed.error.issues
					.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
					.join('; ');
			} catch (err) {
				lastError = err instanceof Error ? err.message : String(err);
			}

			if (attempt === 0) spec.onProgress?.('output was malformed, retrying');
		}
	} catch (err) {
		// Anything the loop didn't already convert to `lastError`.
		lastError = err instanceof Error ? err.message : String(err);
	}

	const message = lastError || 'the agent produced unusable output';
	record(spec, usage, startedAt, message);
	throw new Error(message);
}

function record(spec: RunSpec, usage: RunUsage[], startedAt: number, error: string | null): void {
	const total = usage.reduce((acc, u) => ({
		inputTokens: acc.inputTokens + u.inputTokens,
		outputTokens: acc.outputTokens + u.outputTokens,
		cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
		cacheCreationTokens: acc.cacheCreationTokens + u.cacheCreationTokens,
		costUsd: acc.costUsd + u.costUsd,
		model: u.model ?? acc.model
	}), emptyUsage());

	try {
		recordAgentRun({
			listing_id: spec.listingId,
			stage: spec.stage,
			model: total.model ?? spec.model,
			// No result message at all (a spawn failure) still counts as one attempt.
			attempts: Math.max(1, usage.length),
			input_tokens: total.inputTokens,
			output_tokens: total.outputTokens,
			cache_read_tokens: total.cacheReadTokens,
			cache_creation_tokens: total.cacheCreationTokens,
			cost_usd: total.costUsd,
			auth_mode: authStatus().mode,
			duration_ms: Date.now() - startedAt,
			ok: error === null,
			error
		});
	} catch {
		// Usage tracking is cosmetic; never let it break a listing.
	}
}
