/**
 * Diagnostic: proves two things in one run.
 *
 *   1. Auth works — the Agent SDK finds the Claude Code CLI's OAuth credentials.
 *   2. `settingSources: []` isolates the agent from ~/.claude/CLAUDE.md and any
 *      globally installed skills.
 *
 * (2) matters more than it looks. Without it the agent inherits whatever
 * personality skills the machine has installed, and every generated listing
 * description picks up that voice. Run this after changing agent options, and
 * inside the container after the Docker phase.
 *
 *   node scripts/smoke-agent.mjs
 */
import { query } from '@anthropic-ai/claude-agent-sdk';

async function ask(label, options) {
	let out = '';
	const started = Date.now();
	try {
		for await (const message of query({
			prompt: 'In one plain English sentence, describe what a stand mixer is.',
			options
		})) {
			if ('result' in message && typeof message.result === 'string') out = message.result;
		}
	} catch (err) {
		out = `ERROR: ${err.message}`;
	}
	console.log(`\n### ${label}  (${((Date.now() - started) / 1000).toFixed(1)}s)\n${out}`);
}

// `env` mirrors what the app passes. It resolves the environment explicitly
// rather than letting the SDK inherit this process's, so that a key saved in
// Settings behaves the same as one exported by Compose — see
// src/lib/server/auth.ts. Passing it here keeps this smoke test exercising the
// same option shape the app uses; without it, an auth regression caused by that
// option would not show up until a real listing run.
await ask('WITH settingSources: []  — what the app uses', {
	env: process.env,
	settingSources: [],
	allowedTools: [],
	disallowedTools: ['Bash', 'Write', 'Edit', 'WebSearch', 'WebFetch'],
	maxTurns: 1
});

await ask('WITHOUT settingSources — SDK default, inherits global config', { maxTurns: 1 });

console.log(
	'\nExpected: the first answer is a normal, complete English sentence.\n' +
		'If the two answers read the same and both sound like your global CLAUDE.md,\n' +
		'the isolation is not taking effect — stop and fix that before generating listings.'
);
