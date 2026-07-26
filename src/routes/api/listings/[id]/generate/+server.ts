import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getListing, getPhotos, updateListing } from '$lib/server/db';
import { identifyListing, identifyPatch } from '$lib/server/agent/identify';
import { priceListing, pricePatch, sellerPricePatch } from '$lib/server/agent/price';
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
		// Stage 1 — identify. It also reads back whatever the seller's context box
		// says about price, which decides whether stage 2 runs at all.
		let directive: 'research' | 'seller_set' | 'no_research' = 'research';
		let sellerPrice: number | null = null;
		try {
			const idResult = await identifyListing(params.id, listing.user_context, progress);
			updateListing(params.id, identifyPatch(idResult), { allowAgentFields: true });
			directive = idResult.price_directive;
			sellerPrice = idResult.seller_price;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'identification failed';
			updateListing(params.id, { status: 'new', error: message }, { allowAgentFields: true });
			throw new Error(message);
		}

		// Surface the identify result immediately so the panel updates before the
		// multi-minute pricing stage begins.
		const identified = { ...getListing(params.id)!, photos: getPhotos(params.id) };
		emitEvent('identified', identified);

		// A seller who priced the item in the context box has already done stage 2's
		// job. Running it anyway is the expensive failure: several minutes of web
		// research and the largest model in the app, spent to produce a number that
		// gets overwritten — and, when it lands well below what the seller decided,
		// actively misleading. The manual "Re-price only" button stays available for
		// anyone who changes their mind and does want the research.
		if (directive !== 'research') {
			progress(
				sellerPrice != null
					? `using your price of $${sellerPrice} — skipping price research`
					: 'skipping price research, as you asked'
			);
			updateListing(params.id, sellerPricePatch(sellerPrice), { allowAgentFields: true });
			return { ...getListing(params.id)!, photos: getPhotos(params.id) };
		}

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
