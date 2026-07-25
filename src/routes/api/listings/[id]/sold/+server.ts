import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getListing, getPhotos, markSold } from '$lib/server/db';

/** Mark a listing sold with the actual sale price (may differ from the estimate). */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!getListing(params.id)) error(404, 'listing not found');

	const body = (await request.json()) as { price_cents?: unknown };
	const cents = Number(body.price_cents);
	if (!Number.isFinite(cents) || cents < 0) error(400, 'a valid sale price is required');

	const updated = markSold(params.id, Math.round(cents));
	return json({ ...updated, photos: getPhotos(params.id) });
};
