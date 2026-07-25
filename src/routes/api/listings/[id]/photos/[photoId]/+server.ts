import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, getListing, getPhotos } from '$lib/server/db';
import { deletePhotoFiles } from '$lib/server/images';

export const DELETE: RequestHandler = async ({ params }) => {
	if (!getListing(params.id)) error(404, 'listing not found');

	const photo = getPhotos(params.id).find((p) => p.id === params.photoId);
	if (!photo) error(404, 'photo not found');

	db().prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
	await deletePhotoFiles(params.id, photo.filename);

	// If the cover was removed, promote whatever is now first.
	const remaining = getPhotos(params.id);
	if (remaining.length > 0 && !remaining.some((p) => p.is_cover)) {
		db().prepare('UPDATE photos SET is_cover = 1 WHERE id = ?').run(remaining[0].id);
	}

	return json(getPhotos(params.id));
};
