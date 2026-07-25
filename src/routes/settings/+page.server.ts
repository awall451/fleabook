import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSetting, setSetting } from '$lib/server/db';
import { authStatus, clearApiKey, isValidKeyFormat, saveApiKey } from '$lib/server/auth';
import { LIMITS, SETTING_MEETUP_NOTE } from '$lib/types';

export const load: PageServerLoad = () => ({
	meetupNote: getSetting(SETTING_MEETUP_NOTE),
	// Masked preview only — the raw key never leaves the server.
	auth: authStatus()
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
