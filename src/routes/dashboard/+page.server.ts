import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { clearSampleData, dashboardData, insertSampleData } from '$lib/server/dashboard';
import { agentUsage } from '$lib/server/usage';
import { renewalDueCount } from '$lib/server/renewals';

export const load: PageServerLoad = () => ({
	dash: dashboardData(),
	usage: agentUsage(),
	renewalDue: renewalDueCount()
});

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
