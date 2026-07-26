import { db } from './db';

export interface MonthEarning {
	/** YYYY-MM */
	key: string;
	label: string;
	cents: number;
	count: number;
}

export interface HeatCell {
	/** YYYY-MM-DD */
	date: string;
	cents: number;
	count: number;
}

export interface StatusCount {
	status: string;
	count: number;
}

export interface RecentSale {
	id: string;
	title: string;
	soldCents: number;
	askedCents: number | null;
	soldAt: number;
}

export interface DashboardData {
	totalEarnedCents: number;
	itemsSold: number;
	activeCount: number;
	listedValueCents: number;
	avgSaleCents: number;
	avgDaysToSell: number | null;
	bestSale: { title: string; cents: number } | null;
	months: MonthEarning[];
	statusCounts: StatusCount[];
	heat: HeatCell[];
	heatMaxCents: number;
	recent: RecentSale[];
	hasSample: boolean;
}

/** Active = a live listing, i.e. anything not sold or archived. */
const ACTIVE = new Set(['new', 'identifying', 'identified', 'pricing', 'draft', 'posted']);

function ymd(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface SoldRow {
	title: string | null;
	sold_price_cents: number | null;
	sold_at: number | null;
	price_cents: number | null;
	created_at: number;
}

export function dashboardData(): DashboardData {
	const handle = db();

	const sold = handle
		.prepare(
			`SELECT title, sold_price_cents, sold_at, price_cents, created_at
			   FROM listings
			  WHERE status = 'sold' AND sold_at IS NOT NULL AND sold_price_cents IS NOT NULL`
		)
		.all() as unknown as SoldRow[];

	const statusRows = handle
		.prepare('SELECT status, COUNT(*) AS count FROM listings GROUP BY status')
		.all() as unknown as { status: string; count: number }[];

	const listedValueRow = handle
		.prepare(
			"SELECT COALESCE(SUM(price_cents), 0) AS v FROM listings WHERE status = 'posted' AND price_cents IS NOT NULL"
		)
		.get() as unknown as { v: number };

	const hasSample =
		(handle.prepare('SELECT COUNT(*) AS c FROM listings WHERE is_sample = 1').get() as {
			c: number;
		}).c > 0;

	// Totals
	const totalEarnedCents = sold.reduce((s, r) => s + (r.sold_price_cents ?? 0), 0);
	const itemsSold = sold.length;
	const avgSaleCents = itemsSold > 0 ? Math.round(totalEarnedCents / itemsSold) : 0;

	const daysToSell = sold
		.filter((r) => r.sold_at && r.created_at && r.sold_at >= r.created_at)
		.map((r) => (r.sold_at! - r.created_at) / 86_400_000);
	const avgDaysToSell =
		daysToSell.length > 0
			? Math.round(daysToSell.reduce((a, b) => a + b, 0) / daysToSell.length)
			: null;

	const best = sold.reduce<{ title: string; cents: number } | null>((acc, r) => {
		const c = r.sold_price_cents ?? 0;
		if (!acc || c > acc.cents) return { title: r.title ?? 'Untitled', cents: c };
		return acc;
	}, null);

	const activeCount = statusRows.filter((s) => ACTIVE.has(s.status)).reduce((a, b) => a + b.count, 0);

	// Monthly earnings — last 12 calendar months, oldest first.
	const monthMap = new Map<string, { cents: number; count: number }>();
	const now = new Date();
	const months: MonthEarning[] = [];
	for (let i = 11; i >= 0; i--) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
		monthMap.set(key, { cents: 0, count: 0 });
		months.push({
			key,
			label: d.toLocaleString('en-US', { month: 'short' }),
			cents: 0,
			count: 0
		});
	}
	for (const r of sold) {
		const d = new Date(r.sold_at!);
		const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
		const bucket = monthMap.get(key);
		if (bucket) {
			bucket.cents += r.sold_price_cents ?? 0;
			bucket.count += 1;
		}
	}
	for (const m of months) {
		const b = monthMap.get(m.key)!;
		m.cents = b.cents;
		m.count = b.count;
	}

	// Heatmap — earnings per day over the last 371 days (53 weeks).
	const dayMap = new Map<string, { cents: number; count: number }>();
	for (const r of sold) {
		const key = ymd(new Date(r.sold_at!));
		const b = dayMap.get(key) ?? { cents: 0, count: 0 };
		b.cents += r.sold_price_cents ?? 0;
		b.count += 1;
		dayMap.set(key, b);
	}
	const heat: HeatCell[] = [];
	let heatMaxCents = 0;
	const start = new Date(now);
	start.setDate(start.getDate() - 370);
	for (let i = 0; i < 371; i++) {
		const d = new Date(start);
		d.setDate(start.getDate() + i);
		const key = ymd(d);
		const b = dayMap.get(key) ?? { cents: 0, count: 0 };
		heat.push({ date: key, cents: b.cents, count: b.count });
		if (b.cents > heatMaxCents) heatMaxCents = b.cents;
	}

	// Recent sales
	const recent: RecentSale[] = handle
		.prepare(
			`SELECT id, title, sold_price_cents, price_cents, sold_at
			   FROM listings
			  WHERE status = 'sold' AND sold_at IS NOT NULL
			  ORDER BY sold_at DESC LIMIT 8`
		)
		.all()
		.map((row) => {
			const r = row as Record<string, unknown>;
			return {
				id: r.id as string,
				title: (r.title as string) ?? 'Untitled',
				soldCents: (r.sold_price_cents as number) ?? 0,
				askedCents: (r.price_cents as number) ?? null,
				soldAt: r.sold_at as number
			};
		});

	return {
		totalEarnedCents,
		itemsSold,
		activeCount,
		listedValueCents: listedValueRow.v,
		avgSaleCents,
		avgDaysToSell,
		bestSale: best,
		months,
		statusCounts: statusRows.sort((a, b) => b.count - a.count),
		heat,
		heatMaxCents,
		recent,
		hasSample
	};
}

// --- Sample data (dashboard development / visualization) -------------------

const SAMPLE_ITEMS = [
	'IKEA Malm Dresser',
	'Weber Charcoal Grill',
	'Dyson V8 Vacuum',
	'KitchenAid Mixer',
	'Pioneer Bookshelf Speakers',
	'Craftsman Tool Set',
	'Patagonia Down Jacket',
	'Instant Pot Duo',
	'Herman Miller Chair',
	'Nintendo Switch',
	'Cast Iron Skillet Set',
	'Trek Hybrid Bike',
	'Sony Noise-Cancelling Headphones',
	'Coleman 6-Person Tent',
	'Vitamix Blender',
	'DeWalt Drill Kit',
	'Yeti Cooler 45qt',
	'Le Creuset Dutch Oven',
	'Peloton Bike Mat',
	'Baby Jogger Stroller',
	'Roomba i3',
	'Bose SoundLink',
	'Fender Squier Strat',
	'Ninja Air Fryer'
];

/** Insert ~24 mock sold listings spread over the past ~11 months so the
 *  dashboard has something to render. Idempotent-ish: clears prior samples first. */
export function insertSampleData(): void {
	const handle = db();
	clearSampleData();

	const now = Date.now();
	const stmt = handle.prepare(
		`INSERT INTO listings
		   (id, status, title, price_cents, sold_price_cents, sold_at, is_sample, created_at, updated_at)
		 VALUES (?, 'sold', ?, ?, ?, ?, 1, ?, ?)`
	);

	// Deterministic pseudo-random so repeated seeds look stable.
	let seed = 1337;
	const rnd = () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};

	// Sample listings get sample agent runs too, so "Load sample data" also
	// demonstrates the usage panel. They hang off the listing rows, so
	// clearSampleData's DELETE cascades them away — no extra cleanup.
	const runStmt = handle.prepare(
		`INSERT INTO agent_runs
		   (listing_id, stage, model, attempts, input_tokens, output_tokens,
		    cache_read_tokens, cache_creation_tokens, cost_usd, auth_mode,
		    duration_ms, ok, error, created_at)
		 VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 'api_key_stored', ?, ?, NULL, ?)`
	);

	for (let i = 0; i < SAMPLE_ITEMS.length; i++) {
		const asked = 10 + Math.floor(rnd() * 90); // $10–100
		// Sold slightly under ask most of the time.
		const sold = Math.max(5, Math.round(asked * (0.8 + rnd() * 0.2)));
		// Spread across the last ~330 days, clustered a bit toward recent.
		const daysAgo = Math.floor(rnd() * rnd() * 330);
		const soldAt = now - daysAgo * 86_400_000;
		const createdAt = soldAt - (2 + Math.floor(rnd() * 20)) * 86_400_000;
		const id = crypto.randomUUID();
		stmt.run(id, SAMPLE_ITEMS[i], asked * 100, sold * 100, soldAt, createdAt, soldAt);

		// Both stages, generated the day the listing was created. Magnitudes are
		// the ones real runs produce: identify reads photos, pricing browses.
		runStmt.run(
			id,
			'identify',
			'claude-sonnet-5',
			9_000 + Math.floor(rnd() * 6_000),
			600 + Math.floor(rnd() * 500),
			14_000 + Math.floor(rnd() * 20_000),
			5_000 + Math.floor(rnd() * 4_000),
			0.04 + rnd() * 0.05,
			25_000 + Math.floor(rnd() * 30_000),
			1,
			createdAt
		);
		// Roughly one pricing run in twelve comes back unusable.
		const priceOk = rnd() > 0.08 ? 1 : 0;
		runStmt.run(
			id,
			'price',
			'claude-opus-4-8',
			30_000 + Math.floor(rnd() * 40_000),
			1_800 + Math.floor(rnd() * 1_500),
			90_000 + Math.floor(rnd() * 120_000),
			12_000 + Math.floor(rnd() * 10_000),
			0.35 + rnd() * 0.4,
			150_000 + Math.floor(rnd() * 180_000),
			priceOk,
			createdAt + 60_000
		);
	}
}

export function clearSampleData(): void {
	db().prepare('DELETE FROM listings WHERE is_sample = 1').run();
}
