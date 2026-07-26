import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteListing, getListing, getPhotos, updateListing } from '$lib/server/db';
import { deletePhotoDir, deletePhotoFiles } from '$lib/server/images';

export const GET: RequestHandler = ({ params }) => {
	const listing = getListing(params.id);
	if (!listing) error(404, 'listing not found');
	return json({ ...listing, photos: getPhotos(params.id) });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	if (!getListing(params.id)) error(404, 'listing not found');
	const patch = await request.json();
	// updateListing whitelists columns; agent-only fields are rejected here.
	const updated = updateListing(params.id, patch);
	return json({ ...updated, photos: getPhotos(params.id) });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const listing = getListing(params.id);
	if (!listing) error(404, 'listing not found');

	for (const photo of getPhotos(params.id)) {
		await deletePhotoFiles(params.id, photo.filename);
	}
	await deletePhotoDir(params.id);
	deleteListing(params.id);
	return new Response(null, { status: 204 });
};
