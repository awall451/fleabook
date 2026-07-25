import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getListing, getPhotos, updateListing } from '$lib/server/db';
import { identifyListing, identifyPatch } from '$lib/server/agent/identify';
import { priceListing, pricePatch } from '$lib/server/agent/price';
import { agentStream } from '$lib/server/agent/sse';

/**
 * The one-click flow: identify, then price — as a single server-side job.
 *
 * This is deliberately NOT two client-orchestrated requests. If the browser
 * closes after identify but before pricing (exactly what happens when you fire a
 * listing and immediately move to the next), a client-chained pricing step never
 * starts. Running both stages inside one `agentStream` job means the whole thing
 * finishes server-side regardless of the connection — pricing lands whether or
 * not the tab is still open.
 */
export const GET: RequestHandler = ({ params }) => {
	const listing = getListing(params.id);
	if (!listing) error(404, 'listing not found');
	if (getPhotos(params.id).length === 0) error(400, 'add photos before generating');

	updateListing(params.id, { status: 'identifying', error: null }, { allowAgentFields: true });

	return agentStream(async (progress, emitEvent) => {
		// Stage 1 — identify.
		try {
			const idResult = await identifyListing(params.id, listing.user_context, progress);
			updateListing(params.id, identifyPatch(idResult), { allowAgentFields: true });
		} catch (err) {
			const message = err instanceof Error ? err.message : 'identification failed';
			updateListing(params.id, { status: 'new', error: message }, { allowAgentFields: true });
			throw new Error(message);
		}

		// Surface the identify result immediately so the panel updates before the
		// multi-minute pricing stage begins.
		const identified = { ...getListing(params.id)!, photos: getPhotos(params.id) };
		emitEvent('identified', identified);

		// Stage 2 — price. A failure here leaves the listing usefully 'identified'
		// with the error recorded, rather than discarding the identify work.
		updateListing(params.id, { status: 'pricing', error: null }, { allowAgentFields: true });
		try {
			const priceResult = await priceListing(identified, progress);
			updateListing(params.id, pricePatch(priceResult), { allowAgentFields: true });
		} catch (err) {
			const message = err instanceof Error ? err.message : 'pricing failed';
			updateListing(params.id, { status: 'identified', error: message }, { allowAgentFields: true });
			throw new Error(message);
		}

		return { ...getListing(params.id)!, photos: getPhotos(params.id) };
	});
};
