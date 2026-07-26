import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { agentRunsForListing, getListing, getPhotos, getSetting } from '$lib/server/db';
import { categoryGroups } from '$lib/server/categories';
import { listingPhotoDir } from '$lib/server/images';
import { renewDays } from '$lib/server/renewals';
import { costKind, summariseRuns } from '$lib/server/usage';
import { SETTING_MEETUP_NOTE, renewalStatus } from '$lib/types';

export const load: PageServerLoad = ({ params }) => {
	const listing = getListing(params.id);
	if (!listing) error(404, 'listing not found');

	const runs = agentRunsForListing(params.id);

	return {
		listing,
		photos: getPhotos(params.id),
		groups: categoryGroups(),
		renewDays: renewDays(),
		renewal: renewalStatus(listing, renewDays()),
		// What the two agent stages cost for this listing. The figure is always
		// shown; `costKind` decides whether it reads as a charge or an estimate.
		usage: summariseRuns(runs),
		costKind: costKind(runs),
		// Appended to the description at copy time rather than stored per-listing,
		// so editing it in settings updates every listing.
		meetupNote: getSetting(SETTING_MEETUP_NOTE),
		// Facebook's uploader needs files from disk, so surface the path rather
		// than pretending photos can be handed over via the clipboard.
		photoDir: listingPhotoDir(params.id)
	};
};
