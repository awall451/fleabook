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
export type PriceBasis = 'comps' | 'msrp';

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

	error: string | null;
	created_at: number;
	updated_at: number;
}

export interface ListingWithPhotos extends Listing {
	photos: Photo[];
}

export function formatPrice(cents: number | null | undefined): string {
	if (cents == null) return '';
	return (cents / 100).toFixed(2).replace(/\.00$/, '');
}
