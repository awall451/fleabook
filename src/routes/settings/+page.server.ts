import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSetting, setSetting } from '$lib/server/db';
import { authStatus, clearApiKey, isValidKeyFormat, saveApiKey } from '$lib/server/auth';
import {
	LIMITS,
	RENEW_DAYS_DEFAULT,
	SETTING_MEETUP_NOTE,
	SETTING_RENEW_DAYS
} from '$lib/types';
import { renewDays } from '$lib/server/renewals';

export const load: PageServerLoad = async () => ({
	meetupNote: getSetting(SETTING_MEETUP_NOTE),
	renewDays: renewDays(),
	renewDaysDefault: RENEW_DAYS_DEFAULT,
	// Awaited rather than streamed: the page's first decision is which of the two
	// credential routes to offer, and a badge that arrives late would flip from
	// "not set up" to "signed in" under the user's cursor.
	// Masked preview only — the raw key never leaves the server.
	auth: await authStatus()
});

/**
 * Named actions rather than a single default: the page now saves two unrelated
 * things, and SvelteKit does not allow a default action alongside named ones.
 * Every return carries a `kind` so the page can tell which form the result
 * belongs to.
 */
export const actions: Actions = {
	meetup: async ({ request }) => {
		const form = await request.formData();
		const meetupNote = String(form.get('meetupNote') ?? '').trim();

		// It's appended to every description, so it cannot be allowed to push a
		// listing past Facebook's limit on its own.
		if (meetupNote.length > 500) {
			return fail(400, {
				kind: 'meetup' as const,
				meetupNote,
				error: 'Keep this under 500 characters.'
			});
		}

		setSetting(SETTING_MEETUP_NOTE, meetupNote);
		return { kind: 'meetup' as const, meetupNote, saved: true, limit: LIMITS.description };
	},

	renewals: async ({ request }) => {
		const form = await request.formData();
		const raw = String(form.get('renewDays') ?? '').trim();
		const days = Number(raw);

		// 0 disables reminders; the upper bound just stops a typo from silently
		// meaning "never" when the user meant "weekly".
		if (!Number.isInteger(days) || days < 0 || days > 365) {
			return fail(400, {
				kind: 'renewals' as const,
				error: 'Enter a whole number of days between 0 and 365 (0 turns reminders off).'
			});
		}

		setSetting(SETTING_RENEW_DAYS, String(days));
		return { kind: 'renewals' as const, renewDays: days, saved: true };
	},

	saveKey: async ({ request }) => {
		const form = await request.formData();
		// Console copy buttons and terminal pastes both like to bring whitespace.
		const key = String(form.get('apiKey') ?? '').trim();

		if (!key) {
			return fail(400, {
				kind: 'apiKey' as const,
				error: 'Paste a key first, or use Remove to go back to your Claude subscription.'
			});
		}

		if (!isValidKeyFormat(key)) {
			return fail(400, {
				kind: 'apiKey' as const,
				error:
					"That doesn't look like an Anthropic API key. They begin with sk-ant- and are much longer — copy the whole string from the API keys page."
			});
		}

		saveApiKey(key);
		return { kind: 'apiKey' as const, saved: true };
	},

	clearKey: async () => {
		clearApiKey();
		return { kind: 'apiKey' as const, cleared: true };
	}
};
