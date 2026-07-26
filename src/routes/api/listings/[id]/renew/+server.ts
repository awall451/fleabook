import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getListing, getPhotos, renewListing } from '$lib/server/db';

/**
 * Reset the renewal clock after re-posting on Marketplace.
 *
 * No body: the price is whatever the listing holds right now, which is the point
 * — the seller edits the price first (a normal PATCH), then renews, and the
 * event history records the price that actually went back up.
 */
export const POST: RequestHandler = async ({ params }) => {
	const listing = getListing(params.id);
	if (!listing) error(404, 'listing not found');
	if (listing.posted_at == null) error(400, 'mark this listing posted before renewing it');

	const updated = renewListing(params.id);
	return json({ ...updated, photos: getPhotos(params.id) });
};
