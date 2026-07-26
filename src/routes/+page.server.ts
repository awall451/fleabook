import type { PageServerLoad } from './$types';
import { getCoverPhoto, listListings } from '$lib/server/db';
import { thumbName } from '$lib/server/images';
import { renewDays } from '$lib/server/renewals';
import { RENEW_DUE, renewalStatus, STATUSES, type Listing, type Status } from '$lib/types';

function matchesSearch(listing: Listing, needle: string): boolean {
	if (!needle) return true;
	// Brand and model are searchable because they are often what you remember
	// about a listing when its title has been edited into something else.
	const haystack = [
		listing.title,
		listing.ai_brand,
		listing.ai_model,
		listing.sku,
		...listing.tags
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
	return needle
		.split(/\s+/)
		.filter(Boolean)
		.every((word) => haystack.includes(word));
}

export const load: PageServerLoad = ({ url }) => {
	const requested = url.searchParams.get('status') ?? 'all';
	const filter =
		requested === 'all' || requested === RENEW_DUE || STATUSES.includes(requested as Status)
			? requested
			: 'all';
	const query = (url.searchParams.get('q') ?? '').trim();
	const needle = query.toLowerCase();

	const days = renewDays();

	// Load everything once, then filter in memory. The counts have to be taken
	// across all statuses to be worth showing at all, so the query cannot be
	// narrowed server-side — and the grid is a personal inventory, not a feed.
	const all = listListings().map((listing) => ({
		...listing,
		renewal: renewalStatus(listing, days)
	}));

	// Counts describe what is reachable *right now*: they are taken after the
	// search is applied, so filtering to "welder" shows how those matches are
	// distributed rather than restating the whole library's totals.
	const matching = all.filter((listing) => matchesSearch(listing, needle));

	const counts: Record<string, number> = { all: matching.length };
	for (const status of STATUSES) counts[status] = 0;
	counts[RENEW_DUE] = 0;
	for (const listing of matching) {
		counts[listing.status] += 1;
		if (listing.renewal.due) counts[RENEW_DUE] += 1;
	}

	const selected = matching.filter((listing) => {
		if (filter === 'all') return true;
		if (filter === RENEW_DUE) return listing.renewal.due;
		return listing.status === filter;
	});

	const listings = selected.map((listing) => {
		const cover = getCoverPhoto(listing.id);
		return {
			...listing,
			cover: cover ? `/photos/${listing.id}/${thumbName(cover.filename)}` : null
		};
	});

	return {
		listings,
		status: filter,
		query,
		counts,
		// With reminders switched off there is no clock, so the renew filter would
		// be permanently empty and permanently meaningless.
		remindersOn: days > 0
	};
};
