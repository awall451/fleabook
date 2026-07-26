import type { Action } from 'svelte/action';

/**
 * Grow a <textarea> to fit its content, so it never needs the drag-to-resize
 * corner and never hides text behind a scrollbar. Re-fits on user input and
 * whenever the bound value changes programmatically (agent output, form
 * reseed) — pass the current value as the action parameter so Svelte re-runs
 * `update` on every change.
 *
 *   <textarea rows="3" use:autogrow={form.description} bind:value={form.description} />
 *
 * The `rows` attribute keeps its usual meaning as a floor: the box starts that
 * tall and grows from there, so an empty field still shows its placeholder and
 * still looks like something you can type several lines into. Without a floor
 * an empty textarea collapses to a single line and clips a two-line placeholder.
 *
 * The action also owns `resize` and `min-height` rather than leaving them to
 * each page's CSS — the global stylesheet gives every textarea a 9rem floor and
 * a drag handle, which is exactly what auto-growing replaces.
 */
export const autogrow: Action<HTMLTextAreaElement, unknown> = (node) => {
	/** Height of `rows` lines of text plus the element's own padding and border. */
	const floor = () => {
		const style = getComputedStyle(node);
		const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 20;
		const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
		const border = node.offsetHeight - node.clientHeight;
		return node.rows * line + padding + border;
	};

	const fit = () => {
		// Collapse first so the element can shrink when text is deleted, not only grow.
		node.style.height = 'auto';
		// `box-sizing: border-box` is set globally, so the height we assign has to
		// cover the border as well — `scrollHeight` counts content and padding only,
		// and using it raw leaves the last line a couple of pixels short.
		const border = node.offsetHeight - node.clientHeight;
		node.style.height = `${Math.max(node.scrollHeight + border, floor())}px`;
	};

	node.style.overflowY = 'hidden';
	node.style.resize = 'none';
	node.style.minHeight = '0';
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
