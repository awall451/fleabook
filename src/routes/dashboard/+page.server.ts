import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { clearSampleData, dashboardData, insertSampleData } from '$lib/server/dashboard';

export const load: PageServerLoad = () => ({ dash: dashboardData() });

export const actions: Actions = {
	sample: () => {
		insertSampleData();
		return { seeded: true };
	},
	clearSample: () => {
		clearSampleData();
		return { cleared: true };
	}
};
