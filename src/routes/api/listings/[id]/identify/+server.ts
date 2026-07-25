import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getListing, getPhotos, updateListing } from '$lib/server/db';
import { identifyListing, identifyPatch } from '$lib/server/agent/identify';
import { agentStream } from '$lib/server/agent/sse';

/** Stage 1: identify the item from its photos. ~10-20s. SSE (EventSource is GET-only). */
export const GET: RequestHandler = ({ params }) => {
	const listing = getListing(params.id);
	if (!listing) error(404, 'listing not found');
	if (getPhotos(params.id).length === 0) error(400, 'add photos before identifying');

	updateListing(params.id, { status: 'identifying', error: null }, { allowAgentFields: true });

	return agentStream(async (progress) => {
		try {
			const result = await identifyListing(params.id, listing.user_context, progress);
			const updated = updateListing(params.id, identifyPatch(result), { allowAgentFields: true });
			return { ...updated, photos: getPhotos(params.id) };
		} catch (err) {
			const message = err instanceof Error ? err.message : 'identification failed';
			// Roll the status back so the UI offers a retry rather than sitting in a
			// state that looks terminal, and keep the reason visible.
			updateListing(params.id, { status: 'new', error: message }, { allowAgentFields: true });
			throw new Error(message);
		}
	});
};
