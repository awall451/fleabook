import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Listing, Photo, Status } from '$lib/types';

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve('data');
export const PHOTO_DIR = path.join(DATA_DIR, 'photos');

// The schema lives here rather than in a .sql file so the bundler doesn't have to
// ship a data file alongside the server build.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS listings (
  id              TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'new',
  title           TEXT,
  description     TEXT,
  category        TEXT,
  condition       TEXT,
  price_cents     INTEGER,
  tags            TEXT NOT NULL DEFAULT '[]',
  location        TEXT,
  availability    TEXT NOT NULL DEFAULT 'single',
  sku             TEXT,

  -- Free-text notes the seller gives before generating: what the photos can't
  -- show (a sealed box), defects, a purchase link, how detailed they want it.
  user_context    TEXT,

  ai_brand        TEXT,
  ai_model        TEXT,
  ai_flaws        TEXT NOT NULL DEFAULT '[]',
  ai_identify_confidence TEXT,

  ai_price_low    INTEGER,
  ai_price_high   INTEGER,
  ai_price_basis  TEXT,
  ai_msrp_cents   INTEGER,
  ai_rationale    TEXT,
  ai_sources      TEXT NOT NULL DEFAULT '[]',
  ai_price_confidence TEXT,

  -- Set when marked sold: the actual sale price (may differ from the estimate)
  -- and when it sold. Distinct from price_cents, which is the asking price.
  sold_price_cents INTEGER,
  sold_at          INTEGER,
  -- Mock rows for the dashboard. Hidden from the listings grid; removable.
  is_sample        INTEGER NOT NULL DEFAULT 0,

  error           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id          TEXT PRIMARY KEY,
  listing_id  TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  order_idx   INTEGER NOT NULL DEFAULT 0,
  is_cover    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_photos_listing ON photos(listing_id, order_idx);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`;

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
	if (_db) return _db;
	mkdirSync(PHOTO_DIR, { recursive: true });
	const handle = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
	handle.exec('PRAGMA journal_mode = WAL');
	handle.exec('PRAGMA foreign_keys = ON');
	handle.exec(SCHEMA);
	migrate(handle);
	reconcileInterruptedRuns(handle);
	_db = handle;
	return handle;
}

/**
 * Agent runs live in the server process, so a restart (deploy, crash) kills any
 * that were in flight and leaves the listing frozen at 'identifying' or
 * 'pricing' — the status is set when a stage starts and only cleared when it
 * finishes. On boot, nothing can still be running, so move those back to a
 * resting state the UI can act on, and record why. A 'pricing' listing keeps its
 * identify work and drops to 'identified'; an 'identifying' one goes to 'new'.
 */
function reconcileInterruptedRuns(handle: DatabaseSync): void {
	const note = 'The previous run was interrupted by a server restart. Re-run to finish.';
	handle
		.prepare("UPDATE listings SET status = 'identified', error = ? WHERE status = 'pricing'")
		.run(note);
	handle
		.prepare("UPDATE listings SET status = 'new', error = ? WHERE status = 'identifying'")
		.run(note);
}

/** CREATE TABLE IF NOT EXISTS never adds a column to a table that already
 *  exists, so columns introduced after the first release are added here. */
function migrate(handle: DatabaseSync): void {
	const columns = new Set(
		(handle.prepare('PRAGMA table_info(listings)').all() as { name: string }[]).map((c) => c.name)
	);
	if (!columns.has('user_context')) {
		handle.exec('ALTER TABLE listings ADD COLUMN user_context TEXT');
	}
	if (!columns.has('sold_price_cents')) {
		handle.exec('ALTER TABLE listings ADD COLUMN sold_price_cents INTEGER');
	}
	if (!columns.has('sold_at')) {
		handle.exec('ALTER TABLE listings ADD COLUMN sold_at INTEGER');
	}
	if (!columns.has('is_sample')) {
		handle.exec('ALTER TABLE listings ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0');
	}
}

/** node:sqlite hands back null-prototype rows; rebuild them as plain objects
 *  so SvelteKit can serialize them across the load boundary. */
function jsonArray(raw: unknown): string[] {
	if (typeof raw !== 'string' || raw === '') return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

function toListing(row: Record<string, unknown>): Listing {
	return {
		id: row.id as string,
		status: row.status as Status,
		title: (row.title as string) ?? null,
		description: (row.description as string) ?? null,
		category: (row.category as string) ?? null,
		condition: (row.condition as Listing['condition']) ?? null,
		price_cents: (row.price_cents as number) ?? null,
		tags: jsonArray(row.tags),
		location: (row.location as string) ?? null,
		availability: (row.availability as Listing['availability']) ?? 'single',
		sku: (row.sku as string) ?? null,
		user_context: (row.user_context as string) ?? null,

		ai_brand: (row.ai_brand as string) ?? null,
		ai_model: (row.ai_model as string) ?? null,
		ai_flaws: jsonArray(row.ai_flaws),
		ai_identify_confidence: (row.ai_identify_confidence as Listing['ai_identify_confidence']) ?? null,

		ai_price_low: (row.ai_price_low as number) ?? null,
		ai_price_high: (row.ai_price_high as number) ?? null,
		ai_price_basis: (row.ai_price_basis as Listing['ai_price_basis']) ?? null,
		ai_msrp_cents: (row.ai_msrp_cents as number) ?? null,
		ai_rationale: (row.ai_rationale as string) ?? null,
		ai_sources: jsonArray(row.ai_sources),
		ai_price_confidence: (row.ai_price_confidence as Listing['ai_price_confidence']) ?? null,

		sold_price_cents: (row.sold_price_cents as number) ?? null,
		sold_at: (row.sold_at as number) ?? null,

		error: (row.error as string) ?? null,
		created_at: row.created_at as number,
		updated_at: row.updated_at as number
	};
}

function toPhoto(row: Record<string, unknown>): Photo {
	return {
		id: row.id as string,
		listing_id: row.listing_id as string,
		filename: row.filename as string,
		order_idx: row.order_idx as number,
		is_cover: Boolean(row.is_cover)
	};
}

export function getSetting(key: string, fallback = ''): string {
	const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
	db()
		.prepare(
			'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
		)
		.run(key, value);
}

export function createListing(): Listing {
	const now = Date.now();
	const id = crypto.randomUUID();
	db()
		.prepare('INSERT INTO listings (id, status, created_at, updated_at) VALUES (?, ?, ?, ?)')
		.run(id, 'new', now, now);
	return getListing(id)!;
}

export function getListing(id: string): Listing | null {
	const row = db().prepare('SELECT * FROM listings WHERE id = ?').get(id) as
		| Record<string, unknown>
		| undefined;
	return row ? toListing(row) : null;
}

export function listListings(status?: string): Listing[] {
	// Sample rows are dashboard-only; never show them in the real grid.
	const rows = status
		? db()
				.prepare(
					'SELECT * FROM listings WHERE status = ? AND is_sample = 0 ORDER BY updated_at DESC'
				)
				.all(status)
		: db()
				.prepare('SELECT * FROM listings WHERE is_sample = 0 ORDER BY updated_at DESC')
				.all();
	return (rows as Record<string, unknown>[]).map(toListing);
}

/** Mark a listing sold, recording the actual sale price and time. */
export function markSold(id: string, soldPriceCents: number): Listing | null {
	const now = Date.now();
	db()
		.prepare(
			"UPDATE listings SET status = 'sold', sold_price_cents = ?, sold_at = ?, updated_at = ? WHERE id = ?"
		)
		.run(soldPriceCents, now, now, id);
	return getListing(id);
}

/** Columns a user (or the UI) may write directly. Anything not listed is ignored,
 *  so a stray key in a PATCH body can never reach the SQL. */
const USER_EDITABLE = new Set([
	'status',
	'title',
	'description',
	'category',
	'condition',
	'price_cents',
	'tags',
	'location',
	'availability',
	'sku',
	'user_context',
	'error'
]);

/** Columns only the agent pipeline writes. */
const AGENT_WRITABLE = new Set([
	'ai_brand',
	'ai_model',
	'ai_flaws',
	'ai_identify_confidence',
	'ai_price_low',
	'ai_price_high',
	'ai_price_basis',
	'ai_msrp_cents',
	'ai_rationale',
	'ai_sources',
	'ai_price_confidence'
]);

const JSON_COLUMNS = new Set(['tags', 'ai_flaws', 'ai_sources']);

export function updateListing(
	id: string,
	patch: Record<string, unknown>,
	opts: { allowAgentFields?: boolean } = {}
): Listing | null {
	const allowed = opts.allowAgentFields
		? new Set([...USER_EDITABLE, ...AGENT_WRITABLE])
		: USER_EDITABLE;

	const columns: string[] = [];
	const values: unknown[] = [];

	for (const [key, value] of Object.entries(patch)) {
		if (!allowed.has(key)) continue;
		columns.push(`${key} = ?`);
		if (JSON_COLUMNS.has(key)) {
			values.push(JSON.stringify(Array.isArray(value) ? value : []));
		} else if (value === null || value === undefined) {
			values.push(null);
		} else if (typeof value === 'number' || typeof value === 'string') {
			values.push(value);
		} else {
			values.push(String(value));
		}
	}

	if (columns.length === 0) return getListing(id);

	columns.push('updated_at = ?');
	values.push(Date.now(), id);

	db()
		.prepare(`UPDATE listings SET ${columns.join(', ')} WHERE id = ?`)
		.run(...(values as never[]));
	return getListing(id);
}

export function deleteListing(id: string): void {
	db().prepare('DELETE FROM listings WHERE id = ?').run(id);
}

export function getPhotos(listingId: string): Photo[] {
	const rows = db()
		.prepare('SELECT * FROM photos WHERE listing_id = ? ORDER BY order_idx, id')
		.all(listingId);
	return (rows as Record<string, unknown>[]).map(toPhoto);
}

export function addPhoto(listingId: string, filename: string): Photo {
	const id = crypto.randomUUID();
	const existing = getPhotos(listingId);
	const orderIdx = existing.length;
	const isCover = existing.length === 0 ? 1 : 0;
	db()
		.prepare(
			'INSERT INTO photos (id, listing_id, filename, order_idx, is_cover) VALUES (?, ?, ?, ?, ?)'
		)
		.run(id, listingId, filename, orderIdx, isCover);
	db().prepare('UPDATE listings SET updated_at = ? WHERE id = ?').run(Date.now(), listingId);
	return { id, listing_id: listingId, filename, order_idx: orderIdx, is_cover: Boolean(isCover) };
}

export function getCoverPhoto(listingId: string): Photo | null {
	const photos = getPhotos(listingId);
	return photos.find((p) => p.is_cover) ?? photos[0] ?? null;
}
