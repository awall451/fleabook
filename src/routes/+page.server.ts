import type { PageServerLoad } from './$types';
import { getCoverPhoto, listListings } from '$lib/server/db';
import { thumbName } from '$lib/server/images';
import { renewDays } from '$lib/server/renewals';
import { renewalStatus } from '$lib/types';

export const load: PageServerLoad = ({ url }) => {
	const status = url.searchParams.get('status') ?? undefined;
	const days = renewDays();
	const listings = listListings(status).map((listing) => {
		const cover = getCoverPhoto(listing.id);
		return {
			...listing,
			cover: cover ? `/photos/${listing.id}/${thumbName(cover.filename)}` : null,
			renewal: renewalStatus(listing, days)
		};
	});

	return { listings, status: status ?? 'all' };
};
