import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getListing, getPhotos, updateListing } from '$lib/server/db';
import { priceListing, pricePatch } from '$lib/server/agent/price';
import { agentStream } from '$lib/server/agent/sse';

/** Stage 2: research the price on the open web. Measured at 3-5 minutes. */
export const GET: RequestHandler = ({ params }) => {
	const listing = getListing(params.id);
	if (!listing) error(404, 'listing not found');

	// Pricing the wrong product wastes the entire search, so require an identity
	// first — either from the agent or typed in by hand.
	if (!listing.title && !listing.ai_brand) {
		error(400, 'identify the item first, or give it a title to price against');
	}

	const previousStatus = listing.status;
	updateListing(params.id, { status: 'pricing', error: null }, { allowAgentFields: true });

	return agentStream(async (progress) => {
		try {
			const result = await priceListing(listing, progress);
			const updated = updateListing(params.id, pricePatch(result), { allowAgentFields: true });
			return { ...updated, photos: getPhotos(params.id) };
		} catch (err) {
			const message = err instanceof Error ? err.message : 'pricing failed';
			updateListing(
				params.id,
				{ status: previousStatus === 'pricing' ? 'identified' : previousStatus, error: message },
				{ allowAgentFields: true }
			);
			throw new Error(message);
		}
	});
};
