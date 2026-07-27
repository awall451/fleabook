import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { agentEnv, envKey } from '$lib/server/auth';
import { cancelLogin, startLogin, submitLoginCode } from '$lib/server/claudeCli';

/**
 * Signing in to a Claude subscription, without a terminal.
 *
 * Three steps, because the underlying CLI flow has three: start (which yields a
 * URL), the user authorising in a browser, and a code pasted back. The CLI
 * process waits between the first and the third, which is why this cannot be one
 * request — see `claudeCli.ts` for why it is held server-side.
 *
 * Why this exists at all: the subscription path used to require running
 * `claude auth login` from a terminal, against a binary buried in the app's
 * `node_modules`. On a build whose entire premise is "no terminal", that made
 * the cheaper of the two credential options the one only a developer could
 * reach — and the documentation recommended it anyway.
 */

/**
 * An operator-set key means this is a deployment, not someone's desktop.
 *
 * Signing in would write credentials that `agentEnv()` then ignores (invariant
 * 7: the env var wins), so the flow could not change which credential pays —
 * but it would still spend a browser round-trip to accomplish nothing, and it
 * would leave a token on a shared host. Refusing is both honest and safer.
 */
function refusedBecauseEnvKey(): Response | null {
	if (!envKey()) return null;
	return json(
		{
			ok: false,
			error:
				'This copy of Fleabook is configured with an API key from its environment, which takes precedence over signing in. Remove ANTHROPIC_API_KEY to use a subscription.'
		},
		{ status: 409 }
	);
}

export const POST: RequestHandler = async ({ request }) => {
	const refusal = refusedBecauseEnvKey();
	if (refusal) return refusal;

	let body: { action?: string; code?: string };
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Malformed request.' }, { status: 400 });
	}

	switch (body.action) {
		case 'start': {
			const started = await startLogin(agentEnv());
			return started.ok
				? json({ ok: true, url: started.url })
				: json({ ok: false, error: started.error }, { status: 500 });
		}

		case 'code': {
			const code = String(body.code ?? '').trim();
			if (!code) {
				return json({ ok: false, error: 'Paste the code from the sign-in page first.' }, { status: 400 });
			}

			// The result is whatever the CLI made of the code — a wrong one and an
			// expired one fail differently, and the user can act on the difference.
			const result = await submitLoginCode(code);
			return json({ ok: result.ok, error: result.ok ? undefined : result.message });
		}

		case 'cancel': {
			cancelLogin();
			return json({ ok: true });
		}

		default:
			return json({ ok: false, error: 'Unknown action.' }, { status: 400 });
	}
};
