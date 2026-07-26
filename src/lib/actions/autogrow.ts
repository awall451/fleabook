import type { Action } from 'svelte/action';

/**
 * Grow a <textarea> to fit its content, so the description never needs the
 * drag-to-resize corner. Re-fits on user input and whenever the bound value
 * changes programmatically (agent output, form reseed) — pass the current value
 * as the action parameter so Svelte re-runs `update` on every change.
 *
 *   <textarea use:autogrow={form.description} bind:value={form.description} />
 */
export const autogrow: Action<HTMLTextAreaElement, unknown> = (node) => {
	const fit = () => {
		// Collapse first so the element can shrink when text is deleted, not only grow.
		node.style.height = 'auto';
		node.style.height = `${node.scrollHeight}px`;
	};

	node.style.overflowY = 'hidden';
	node.addEventListener('input', fit);
	// Measure after layout so scrollHeight reflects the real wrapped height.
	requestAnimationFrame(fit);

	return {
		// Deferred, not immediate: `update` and `bind:value` are separate effects,
		// and on a programmatic change (agent output, form reseed) this can run
		// before the new text is in the DOM — measuring the old content and
		// freezing the box at the wrong height until something re-triggers it.
		// Typing is unaffected either way because the input listener fires after
		// the value is already set.
		update: () => requestAnimationFrame(fit),
		destroy: () => node.removeEventListener('input', fit)
	};
};
