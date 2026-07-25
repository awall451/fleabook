import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readPhoto } from '$lib/server/images';

/** Photos live in the data volume, outside static/, so they need a route.
 *  readPhoto validates both path segments against generated-filename patterns. */
export const GET: RequestHandler = async ({ params }) => {
	const bytes = await readPhoto(params.listingId, params.file);
	if (!bytes) error(404, 'not found');

	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': 'image/jpeg',
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
