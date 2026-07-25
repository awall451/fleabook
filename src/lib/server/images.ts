import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { PHOTO_DIR } from './db';

const MAX_EDGE = 1600;
const THUMB_EDGE = 400;
const QUALITY = 85;

/** Filenames we generate ourselves, so this pattern is the complete set of what
 *  may be served. Anything else is a traversal attempt. */
const SAFE_FILENAME = /^[0-9a-f-]{36}(_thumb)?\.jpg$/;
const SAFE_ID = /^[0-9a-f-]{36}$/;

export function listingPhotoDir(listingId: string): string {
	if (!SAFE_ID.test(listingId)) throw new Error('invalid listing id');
	return path.join(PHOTO_DIR, listingId);
}

/**
 * Normalize an uploaded image: apply EXIF orientation, then re-encode.
 *
 * sharp drops all metadata unless `.withMetadata()` is called, so this strips
 * GPS coordinates as a side effect of the re-encode. That matters — phones
 * geotag by default, and a listing photo taken at home would otherwise carry
 * the seller's address into a public post.
 */
export async function saveUpload(listingId: string, bytes: Buffer): Promise<string> {
	const dir = listingPhotoDir(listingId);
	mkdirSync(dir, { recursive: true });

	const id = crypto.randomUUID();
	const filename = `${id}.jpg`;

	const pipeline = sharp(bytes, { failOn: 'error' }).rotate();

	await pipeline
		.clone()
		.resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
		.jpeg({ quality: QUALITY })
		.toFile(path.join(dir, filename));

	await pipeline
		.clone()
		.resize(THUMB_EDGE, THUMB_EDGE, { fit: 'inside', withoutEnlargement: true })
		.jpeg({ quality: 80 })
		.toFile(path.join(dir, `${id}_thumb.jpg`));

	return filename;
}

export function thumbName(filename: string): string {
	return filename.replace(/\.jpg$/, '_thumb.jpg');
}

/** Read a stored photo for serving. Returns null rather than throwing so the
 *  route can answer 404 without leaking whether the path exists. */
export async function readPhoto(listingId: string, filename: string): Promise<Buffer | null> {
	if (!SAFE_ID.test(listingId) || !SAFE_FILENAME.test(filename)) return null;
	try {
		return await readFile(path.join(PHOTO_DIR, listingId, filename));
	} catch {
		return null;
	}
}

export async function deletePhotoFiles(listingId: string, filename: string): Promise<void> {
	if (!SAFE_ID.test(listingId) || !SAFE_FILENAME.test(filename)) return;
	const dir = path.join(PHOTO_DIR, listingId);
	await Promise.allSettled([
		unlink(path.join(dir, filename)),
		unlink(path.join(dir, thumbName(filename)))
	]);
}
