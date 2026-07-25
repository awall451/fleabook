import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addPhoto, createListing, getPhotos, listListings } from '$lib/server/db';
import { saveUpload } from '$lib/server/images';

export const GET: RequestHandler = ({ url }) => {
	const status = url.searchParams.get('status') ?? undefined;
	return json(listListings(status));
};

/**
 * Create a listing. Accepts either an empty JSON body (blank listing) or a
 * multipart form with `photos` files, so the upload page can create-and-attach
 * in a single round trip.
 */
export const POST: RequestHandler = async ({ request }) => {
	const listing = createListing();

	if (request.headers.get('content-type')?.includes('multipart/form-data')) {
		const form = await request.formData();
		const files = form.getAll('photos').filter((f): f is File => f instanceof File);

		if (files.length === 0) error(400, 'no photos in upload');

		for (const file of files) {
			const bytes = Buffer.from(await file.arrayBuffer());
			try {
				const filename = await saveUpload(listing.id, bytes);
				addPhoto(listing.id, filename);
			} catch {
				error(400, `could not read ${file.name} as an image`);
			}
		}
	}

	return json({ ...listing, photos: getPhotos(listing.id) }, { status: 201 });
};
