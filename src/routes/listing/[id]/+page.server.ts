import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getListing, getPhotos, getSetting } from '$lib/server/db';
import { categoryGroups } from '$lib/server/categories';
import { listingPhotoDir } from '$lib/server/images';
import { SETTING_MEETUP_NOTE } from '$lib/types';

export const load: PageServerLoad = ({ params }) => {
	const listing = getListing(params.id);
	if (!listing) error(404, 'listing not found');

	return {
		listing,
		photos: getPhotos(params.id),
		groups: categoryGroups(),
		// Appended to the description at copy time rather than stored per-listing,
		// so editing it in settings updates every listing.
		meetupNote: getSetting(SETTING_MEETUP_NOTE),
		// Facebook's uploader needs files from disk, so surface the path rather
		// than pretending photos can be handed over via the clipboard.
		photoDir: listingPhotoDir(params.id)
	};
};
