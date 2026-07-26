/** Shared types. Safe to import from both client and server. */

export const STATUSES = [
	'new',
	'identifying',
	'identified',
	'pricing',
	'draft',
	'posted',
	'sold',
	'archived'
] as const;
export type Status = (typeof STATUSES)[number];

/** Verbatim Facebook Marketplace condition values. Do not reword. */
export const CONDITIONS = ['New', 'Used - Like New', 'Used - Good', 'Used - Fair'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const AVAILABILITIES = ['single', 'in_stock'] as const;
export type Availability = (typeof AVAILABILITIES)[number];

export type Confidence = 'high' | 'medium' | 'low';
/** How a price was arrived at. 'seller' means the seller had already decided —
 *  stated in the context box — and no research was run. */
export type PriceBasis = 'comps' | 'msrp' | 'seller';

/** Facebook's own limits — enforced in the UI so a copied field never gets truncated. */
export const LIMITS = {
	title: 100,
	description: 5000,
	tags: 20
} as const;

export const SETTING_MEETUP_NOTE = 'meetup_note';

/**
 * An Anthropic API key entered in Settings. Optional — it exists for people
 * running the Windows build without a Claude subscription. See
 * `src/lib/server/auth.ts` for how it is resolved against the environment.
 */
export const SETTING_API_KEY = 'anthropic_api_key';

/**
 * How many days a posted listing may sit before the UI nags. Facebook
 * Marketplace expects a renewal about weekly, hence the default — but it is a
 * setting rather than a constant because the platform's rule is theirs to change
 * and people cross-post to sites with other cadences. `0` turns the reminders off.
 */
export const SETTING_RENEW_DAYS = 'renew_days';
export const RENEW_DAYS_DEFAULT = 7;

/**
 * The description that actually gets posted: the listing body plus the global
 * meetup note.
 *
 * The note is appended at copy time rather than baked into the stored
 * description, so editing it in settings updates every listing at once — and so
 * the agent, which is told not to write meetup or logistics language, can never
 * contradict it.
 */
export function composeDescription(
	description: string | null | undefined,
	meetupNote: string | null | undefined
): string {
	const body = (description ?? '').trimEnd();
	const note = (meetupNote ?? '').trim();
	if (!note) return body;
	if (!body) return note;
	return `${body}\n\n${note}`;
}

export interface Photo {
	id: string;
	listing_id: string;
	filename: string;
	order_idx: number;
	is_cover: boolean;
}

export interface Listing {
	id: string;
	status: Status;

	// Editable Facebook fields
	title: string | null;
	description: string | null;
	category: string | null;
	condition: Condition | null;
	price_cents: number | null;
	tags: string[];
	location: string | null;
	availability: Availability;
	sku: string | null;
	user_context: string | null;

	// Stage 1 — identify
	ai_brand: string | null;
	ai_model: string | null;
	ai_flaws: string[];
	ai_identify_confidence: Confidence | null;

	// Stage 2 — price
	ai_price_low: number | null;
	ai_price_high: number | null;
	ai_price_basis: PriceBasis | null;
	ai_msrp_cents: number | null;
	ai_rationale: string | null;
	ai_sources: string[];
	ai_price_confidence: Confidence | null;

	sold_price_cents: number | null;
	sold_at: number | null;

	// Renewal clock. `posted_at` is stamped the first time the listing reaches
	// 'posted'; `renewed_at` is null until the first renewal. The clock reads from
	// whichever is later — see `renewalStatus`.
	posted_at: number | null;
	renewed_at: number | null;
	renewal_count: number;

	error: string | null;
	created_at: number;
	updated_at: number;
}

export interface ListingWithPhotos extends Listing {
	photos: Photo[];
}

/** A point in a listing's life worth keeping: posted, and each renewal. The
 *  price is snapshotted so a later "did dropping the price help?" is answerable. */
export interface ListingEvent {
	id: number;
	listing_id: string;
	kind: 'posted' | 'renewed';
	price_cents: number | null;
	created_at: number;
}

export type AgentStage = 'identify' | 'price';

/** One row per agent stage per generate. Tokens are summed across the retry
 *  attempt when `runStructured` had to re-prompt. */
export interface AgentRun {
	id: number;
	listing_id: string;
	/** The listing's title as it stood when the run was recorded, or when the
	 *  listing was deleted. Spend records outlive listings; this is what names
	 *  them afterwards. Null for a run on a listing deleted before it was
	 *  titled. */
	listing_title: string | null;
	stage: AgentStage;
	model: string | null;
	attempts: number;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_creation_tokens: number;
	cost_usd: number;
	/** Which credential paid — see `src/lib/server/auth.ts`. */
	auth_mode: string;
	duration_ms: number;
	ok: boolean;
	error: string | null;
	created_at: number;
}

export interface RenewalStatus {
	/** True when the listing is posted, reminders are on, and the clock has run out. */
	due: boolean;
	/** Days since the listing was posted or last renewed. Null when never posted. */
	daysListed: number | null;
	/** Days past the renewal interval. 0 when not yet due. */
	daysOverdue: number;
}

const DAY_MS = 86_400_000;

/**
 * Whether a listing is asking to be renewed.
 *
 * Only 'posted' listings have a clock — a draft isn't on Marketplace yet, and a
 * sold one is done. Listings posted before this feature existed have a null
 * `posted_at` and stay quiet rather than guessing a date from `updated_at`,
 * which moves on every edit and would fire immediately on old rows.
 */
export function renewalStatus(
	listing: Pick<Listing, 'status' | 'posted_at' | 'renewed_at'>,
	renewDays: number,
	now: number = Date.now()
): RenewalStatus {
	const since = listing.renewed_at ?? listing.posted_at;
	if (listing.status !== 'posted' || since == null) {
		return { due: false, daysListed: null, daysOverdue: 0 };
	}

	const daysListed = Math.floor((now - since) / DAY_MS);
	if (renewDays <= 0) return { due: false, daysListed, daysOverdue: 0 };

	return {
		due: daysListed >= renewDays,
		daysListed,
		daysOverdue: Math.max(0, daysListed - renewDays)
	};
}

export function formatPrice(cents: number | null | undefined): string {
	if (cents == null) return '';
	return (cents / 100).toFixed(2).replace(/\.00$/, '');
}
