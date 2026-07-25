/**
 * Diagnostic: print the shape of every message the Agent SDK yields.
 *
 * The progress notes in src/lib/server/agent/run.ts depend on tool calls
 * arriving as `tool_use` content blocks nested inside `assistant` messages.
 * That is an observed detail of the SDK, not a documented contract — if
 * progress notes go quiet after an SDK upgrade, run this and check whether the
 * shape moved.
 *
 *   node scripts/dump-messages.mjs <directory-with-photos>
 */
import { query } from '@anthropic-ai/claude-agent-sdk';

const dir = process.argv[2];
if (!dir) {
	console.error('usage: node scripts/dump-messages.mjs <directory-with-photos>');
	process.exit(1);
}

for await (const message of query({
	prompt: 'List the .jpg files here using Glob, then Read one and describe it in one sentence.',
	options: {
		settingSources: [],
		allowedTools: ['Read', 'Glob'],
		disallowedTools: ['Bash', 'Write', 'Edit'],
		cwd: dir,
		maxTurns: 6,
		model: 'claude-sonnet-5'
	}
})) {
	const blocks = Array.isArray(message?.message?.content)
		? ' | blocks: ' +
			message.message.content.map((b) => b.type + (b.name ? `(${b.name})` : '')).join(',')
		: '';
	console.log(
		`type=${message.type} subtype=${message.subtype ?? '-'}${blocks} keys=[${Object.keys(message).join(',')}]`
	);
}
