import type { PageServerLoad } from './$types';
import { getCoverPhoto, listListings } from '$lib/server/db';
import { thumbName } from '$lib/server/images';

export const load: PageServerLoad = ({ url }) => {
	const status = url.searchParams.get('status') ?? undefined;
	const listings = listListings(status).map((listing) => {
		const cover = getCoverPhoto(listing.id);
		return {
			...listing,
			cover: cover ? `/photos/${listing.id}/${thumbName(cover.filename)}` : null
		};
	});

	return { listings, status: status ?? 'all' };
};
