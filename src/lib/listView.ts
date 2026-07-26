/**
 * How the listings grid is displayed, as opposed to what it is showing.
 *
 * The filter and the search live in the URL, because they answer "what am I
 * looking at" and are worth linking and reloading. View and sort answer "how do
 * I like it laid out", so they persist per browser and survive every trip back
 * to the home page.
 *
 * They are kept in cookies rather than localStorage, which `theme.ts` uses. The
 * theme is a set of CSS variables, so an inline script can apply it before first
 * paint and the server never needs to know. A view is different markup: if the
 * server always rendered tiles, someone who prefers rows would watch the page
 * render tiles and then rearrange itself on every single navigation. A cookie is
 * readable in `load`, so the first paint is already correct.
 *
 * Sorting still happens on the client, over the list the server sent, so
 * reordering is instant and the load function only has to worry about filtering.
 */

export const VIEW_COOKIE = 'fleabook_view';
export const SORT_COOKIE = 'fleabook_sort';

/** A year, in seconds. A display preference should outlast the session. */
const COOKIE_MAX_AGE = 31_536_000;

export type ViewId = 'tiles' | 'rows';
export const DEFAULT_VIEW: ViewId = 'tiles';

export type SortId =
	| 'updated'
	| 'created-desc'
	| 'created-asc'
	| 'price-desc'
	| 'price-asc'
	| 'listed-desc'
	| 'title';

export const DEFAULT_SORT: SortId = 'updated';

export const SORTS: { id: SortId; label: string }[] = [
	{ id: 'updated', label: 'Recently updated' },
	{ id: 'created-desc', label: 'Newest first' },
	{ id: 'created-asc', label: 'Oldest first' },
	{ id: 'price-desc', label: 'Price: high to low' },
	{ id: 'price-asc', label: 'Price: low to high' },
	{ id: 'listed-desc', label: 'Longest listed' },
	{ id: 'title', label: 'Title A–Z' }
];

export function isViewId(value: unknown): value is ViewId {
	return value === 'tiles' || value === 'rows';
}

export function isSortId(value: unknown): value is SortId {
	return SORTS.some((s) => s.id === value);
}

/** Both sides read the stored value through these, so an unset or tampered
 *  cookie falls back to the default rather than rendering nothing. */
export function toView(value: unknown): ViewId {
	return isViewId(value) ? value : DEFAULT_VIEW;
}

export function toSort(value: unknown): SortId {
	return isSortId(value) ? value : DEFAULT_SORT;
}

/** Persist a preference from the browser. `SameSite=Lax` because this is only
 *  ever read by this app's own page loads; there is nothing here worth sending
 *  on a cross-site request. */
export function rememberPreference(name: string, value: string): void {
	document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

/** What a listing needs to be sortable. Structural so the page can pass its own
 *  richer row objects without a cast. */
export interface Sortable {
	title: string | null;
	price_cents: number | null;
	created_at: number;
	updated_at: number;
	posted_at: number | null;
	renewed_at: number | null;
}

/**
 * Sort a copy of the list.
 *
 * Missing values always sink to the bottom, in both directions. A listing with
 * no price is not "cheapest", and one that was never posted has not been listed
 * for zero days — it has no position on that axis at all, and floating it to the
 * top of "Price: low to high" would bury the answer the sort was asked for.
 */
export function sortListings<T extends Sortable>(listings: T[], sort: SortId): T[] {
	const byMissingLast = (a: number | null, b: number | null, compare: (x: number, y: number) => number) => {
		if (a == null && b == null) return 0;
		if (a == null) return 1;
		if (b == null) return -1;
		return compare(a, b);
	};

	const sorted = [...listings];
	switch (sort) {
		case 'created-desc':
			return sorted.sort((a, b) => b.created_at - a.created_at);
		case 'created-asc':
			return sorted.sort((a, b) => a.created_at - b.created_at);
		case 'price-desc':
			return sorted.sort((a, b) => byMissingLast(a.price_cents, b.price_cents, (x, y) => y - x));
		case 'price-asc':
			return sorted.sort((a, b) => byMissingLast(a.price_cents, b.price_cents, (x, y) => x - y));
		case 'listed-desc':
			// Oldest clock first: the listing that has sat longest since it was
			// posted or last renewed is the one most in need of attention.
			return sorted.sort((a, b) =>
				byMissingLast(
					a.renewed_at ?? a.posted_at,
					b.renewed_at ?? b.posted_at,
					(x, y) => x - y
				)
			);
		case 'title':
			return sorted.sort((a, b) =>
				(a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' })
			);
		case 'updated':
		default:
			return sorted.sort((a, b) => b.updated_at - a.updated_at);
	}
}
