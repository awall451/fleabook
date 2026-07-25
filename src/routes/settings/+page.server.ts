import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSetting, setSetting } from '$lib/server/db';
import { LIMITS, SETTING_MEETUP_NOTE } from '$lib/types';

export const load: PageServerLoad = () => ({
	meetupNote: getSetting(SETTING_MEETUP_NOTE)
});

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const meetupNote = String(form.get('meetupNote') ?? '').trim();

		// It's appended to every description, so it cannot be allowed to push a
		// listing past Facebook's limit on its own.
		if (meetupNote.length > 500) {
			return fail(400, { meetupNote, error: 'Keep this under 500 characters.' });
		}

		setSetting(SETTING_MEETUP_NOTE, meetupNote);
		return { meetupNote, saved: true, limit: LIMITS.description };
	}
};
