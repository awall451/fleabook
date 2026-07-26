import { db, getSetting } from './db';
import { RENEW_DAYS_DEFAULT, SETTING_RENEW_DAYS, renewalStatus } from '$lib/types';
import type { Listing } from '$lib/types';

/**
 * The configured renewal interval, in days.
 *
 * Settings are stored as strings, and an unset key comes back as ''. Anything
 * unparseable falls back to the default rather than to 0 — silently disabling
 * the reminders is the worse failure, since the user would never see that it
 * had happened.
 */
export function renewDays(): number {
	const raw = getSetting(SETTING_RENEW_DAYS).trim();
	if (raw === '') return RENEW_DAYS_DEFAULT;
	const days = Number(raw);
	return Number.isInteger(days) && days >= 0 ? days : RENEW_DAYS_DEFAULT;
}

/** How many live listings are asking to be renewed right now. */
export function renewalDueCount(days = renewDays()): number {
	if (days <= 0) return 0;

	const cutoff = Date.now() - days * 86_400_000;
	const row = db()
		.prepare(
			`SELECT COUNT(*) AS c FROM listings
			  WHERE status = 'posted' AND is_sample = 0
			    AND COALESCE(renewed_at, posted_at) IS NOT NULL
			    AND COALESCE(renewed_at, posted_at) <= ?`
		)
		.get(cutoff) as { c: number };
	return row.c;
}

/** A listing plus its renewal state, for the grid and the listing page. */
export function withRenewal<T extends Listing>(listing: T, days = renewDays()) {
	return { ...listing, renewal: renewalStatus(listing, days) };
}
