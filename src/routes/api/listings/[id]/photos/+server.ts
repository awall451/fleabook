import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addPhoto, db, getListing, getPhotos } from '$lib/server/db';
import { saveUpload } from '$lib/server/images';

export const POST: RequestHandler = async ({ params, request }) => {
	if (!getListing(params.id)) error(404, 'listing not found');

	const form = await request.formData();
	const files = form.getAll('photos').filter((f): f is File => f instanceof File);
	if (files.length === 0) error(400, 'no photos in upload');

	for (const file of files) {
		const bytes = Buffer.from(await file.arrayBuffer());
		try {
			const filename = await saveUpload(params.id, bytes);
			addPhoto(params.id, filename);
		} catch {
			error(400, `could not read ${file.name} as an image`);
		}
	}

	return json(getPhotos(params.id), { status: 201 });
};

/** Reorder photos and/or set the cover. Facebook uses the first photo as the
 *  thumbnail, so ordering is worth controlling. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	if (!getListing(params.id)) error(404, 'listing not found');

	const { order, cover } = (await request.json()) as { order?: string[]; cover?: string };
	const owned = new Set(getPhotos(params.id).map((p) => p.id));

	if (Array.isArray(order)) {
		if (!order.every((id) => owned.has(id))) error(400, 'order contains an unknown photo');
		const stmt = db().prepare('UPDATE photos SET order_idx = ? WHERE id = ? AND listing_id = ?');
		order.forEach((photoId, index) => stmt.run(index, photoId, params.id));
	}

	if (typeof cover === 'string') {
		if (!owned.has(cover)) error(400, 'cover is not a photo of this listing');
		db().prepare('UPDATE photos SET is_cover = 0 WHERE listing_id = ?').run(params.id);
		db().prepare('UPDATE photos SET is_cover = 1 WHERE id = ?').run(cover);
	}

	db().prepare('UPDATE listings SET updated_at = ? WHERE id = ?').run(Date.now(), params.id);
	return json(getPhotos(params.id));
};
