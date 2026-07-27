import { db, toAgentRun } from './db';
import { authMode } from './auth';
import type { AgentRun, AgentStage } from '$lib/types';

/**
 * How a dollar figure should be labelled — not whether to show one.
 *
 * The SDK reports `total_cost_usd` on every run, including runs a Claude
 * subscription paid for, where it is a list-price estimate rather than a charge.
 * That number is still worth showing a subscriber — it's what the tokens would
 * price at, and it's the figure you'd need to judge a plan against an API key —
 * but presenting it as "API cost" would invent a bill they never received. So
 * the cost is always shown and the *wording* carries the distinction.
 *
 * Derived from the runs being summed, not from the credential in use right now:
 * swapping in an API key today does not turn last month's subscription runs into
 * charges, and the label has to describe the money it is actually reporting.
 */
export type CostKind = 'billed' | 'estimated' | 'mixed';

/** The auth modes whose recorded cost is an actual charge rather than an estimate. */
const BILLED_MODES = new Set(['api_key_env', 'api_key_stored']);

export function costKind(runs: AgentRun[]): CostKind {
	// With nothing recorded there is no history to describe, so fall back to what
	// the next run will be — the panel is showing zeroes either way.
	if (runs.length === 0) return BILLED_MODES.has(authMode()) ? 'billed' : 'estimated';

	const billed = runs.filter((r) => BILLED_MODES.has(r.auth_mode)).length;
	if (billed === runs.length) return 'billed';
	if (billed === 0) return 'estimated';
	return 'mixed';
}

export interface RunSummary {
	runs: number;
	failed: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	totalTokens: number;
	/** Every run, whoever paid. The headline figure. */
	costUsd: number;
	/** The part of `costUsd` an API key was actually charged for. Equal to
	 *  `costUsd` unless the history spans a switch between credentials. */
	billedCostUsd: number;
	durationMs: number;
}

function emptySummary(): RunSummary {
	return {
		runs: 0,
		failed: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		totalTokens: 0,
		costUsd: 0,
		billedCostUsd: 0,
		durationMs: 0
	};
}

export function summariseRuns(runs: AgentRun[]): RunSummary {
	const out = emptySummary();
	for (const run of runs) {
		out.runs += 1;
		if (!run.ok) out.failed += 1;
		out.inputTokens += run.input_tokens;
		out.outputTokens += run.output_tokens;
		out.cacheReadTokens += run.cache_read_tokens;
		out.cacheCreationTokens += run.cache_creation_tokens;
		out.durationMs += run.duration_ms;
		out.costUsd += run.cost_usd;
		if (BILLED_MODES.has(run.auth_mode)) out.billedCostUsd += run.cost_usd;
	}
	// Cache reads and writes are billed separately from fresh input, so the
	// headline figure has to include them or it understates a cached run badly.
	out.totalTokens =
		out.inputTokens + out.outputTokens + out.cacheReadTokens + out.cacheCreationTokens;
	return out;
}

export interface StageUsage extends RunSummary {
	stage: AgentStage;
	avgDurationMs: number;
	avgTokens: number;
}

export interface MonthUsage {
	/** YYYY-MM */
	key: string;
	label: string;
	tokens: number;
	runs: number;
}

/**
 * What one listing's generations cost, itemized.
 *
 * `exists` is false once the listing has been deleted. Those rows are the ones
 * most worth reading — a deleted listing is spend with nothing to show for it —
 * so they stay in the table rather than being filtered out, just marked and
 * un-linked.
 */
export interface ListingUsage extends RunSummary {
	listingId: string;
	title: string;
	exists: boolean;
	isSample: boolean;
	lastRunAt: number;
}

export interface AgentUsage {
	hasRuns: boolean;
	total: RunSummary;
	/** Listings that have at least one recorded run. */
	listings: number;
	avgTokensPerListing: number;
	stages: StageUsage[];
	/** Per-listing itemization, most tokens first. */
	byListing: ListingUsage[];
	/** The part of the total spent on listings that no longer exist. */
	deleted: RunSummary;
	months: MonthUsage[];
	/** Whether the headline cost is a real charge, a list-price estimate, or both.
	 *  Drives the tile's wording, not whether it renders. */
	costKind: CostKind;
}

const STAGES: AgentStage[] = ['identify', 'price'];

/**
 * Token and cost aggregation for the dashboard.
 *
 * Deliberately separate from `dashboardData()`: earnings and agent spend answer
 * different questions and one going quiet should not take the other with it.
 */
export function agentUsage(): AgentUsage {
	const rows = db()
		.prepare('SELECT * FROM agent_runs ORDER BY created_at')
		.all() as Record<string, unknown>[];
	const runs = rows.map(toAgentRun);

	const total = summariseRuns(runs);
	const listings = new Set(runs.map((r) => r.listing_id)).size;

	// Which listings are still around, and what they are called now. A live title
	// beats the snapshot on the run row: identify runs are recorded before the
	// listing has a title, and the seller may have edited it since.
	const live = new Map<string, { title: string | null; isSample: boolean }>(
		(
			db().prepare('SELECT id, title, is_sample FROM listings').all() as Record<string, unknown>[]
		).map((r) => [
			r.id as string,
			{ title: (r.title as string) ?? null, isSample: Boolean(r.is_sample) }
		])
	);

	const grouped = new Map<string, AgentRun[]>();
	for (const run of runs) {
		const bucket = grouped.get(run.listing_id);
		if (bucket) bucket.push(run);
		else grouped.set(run.listing_id, [run]);
	}

	const byListing: ListingUsage[] = [...grouped].map(([listingId, forListing]) => {
		const record = live.get(listingId);
		// Newest snapshot wins among the run rows — deleteListing writes the title
		// onto whichever rows still lacked one.
		const snapshot = [...forListing].reverse().find((r) => r.listing_title)?.listing_title ?? null;
		return {
			...summariseRuns(forListing),
			listingId,
			title: record?.title ?? snapshot ?? 'Untitled listing',
			exists: record != null,
			isSample: record?.isSample ?? false,
			lastRunAt: Math.max(...forListing.map((r) => r.created_at))
		};
	});
	byListing.sort((a, b) => b.totalTokens - a.totalTokens);

	const deleted = summariseRuns(runs.filter((r) => !live.has(r.listing_id)));

	const stages: StageUsage[] = STAGES.map((stage) => {
		const forStage = runs.filter((r) => r.stage === stage);
		const summary = summariseRuns(forStage);
		return {
			...summary,
			stage,
			avgDurationMs: summary.runs > 0 ? Math.round(summary.durationMs / summary.runs) : 0,
			avgTokens: summary.runs > 0 ? Math.round(summary.totalTokens / summary.runs) : 0
		};
	});

	// Last 12 calendar months, oldest first — same window and shape as the
	// earnings chart so the two read as one dashboard.
	const now = new Date();
	const monthMap = new Map<string, MonthUsage>();
	const months: MonthUsage[] = [];
	for (let i = 11; i >= 0; i--) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
		const entry: MonthUsage = {
			key,
			label: d.toLocaleString('en-US', { month: 'short' }),
			tokens: 0,
			runs: 0
		};
		monthMap.set(key, entry);
		months.push(entry);
	}
	for (const run of runs) {
		const d = new Date(run.created_at);
		const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
		const bucket = monthMap.get(key);
		if (!bucket) continue;
		bucket.tokens +=
			run.input_tokens + run.output_tokens + run.cache_read_tokens + run.cache_creation_tokens;
		bucket.runs += 1;
	}

	return {
		hasRuns: runs.length > 0,
		total,
		listings,
		avgTokensPerListing: listings > 0 ? Math.round(total.totalTokens / listings) : 0,
		stages,
		byListing,
		deleted,
		months,
		costKind: costKind(runs)
	};
}
