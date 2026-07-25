<script lang="ts">
	let { value = '', label = 'Copy' }: { value?: string | null; label?: string } = $props();

	let state = $state<'idle' | 'copied' | 'failed'>('idle');
	let timer: ReturnType<typeof setTimeout>;

	async function copy() {
		const text = value ?? '';
		if (!text) return;

		try {
			// navigator.clipboard needs a secure context. localhost qualifies, but
			// fall back to the legacy path so this still works over a plain-HTTP LAN
			// address if the port binding is ever changed.
			if (navigator.clipboard && window.isSecureContext) {
				await navigator.clipboard.writeText(text);
			} else {
				const scratch = document.createElement('textarea');
				scratch.value = text;
				scratch.style.position = 'fixed';
				scratch.style.opacity = '0';
				document.body.appendChild(scratch);
				scratch.select();
				document.execCommand('copy');
				scratch.remove();
			}
			state = 'copied';
		} catch {
			state = 'failed';
		}

		clearTimeout(timer);
		timer = setTimeout(() => (state = 'idle'), 1400);
	}
</script>

<button type="button" class:copied={state === 'copied'} onclick={copy} disabled={!value}>
	{state === 'copied' ? 'Copied' : state === 'failed' ? 'Failed' : label}
</button>

<style>
	button {
		font-size: 0.78rem;
		padding: 0.22rem 0.6rem;
		white-space: nowrap;
	}

	button.copied {
		border-color: var(--ok);
		color: var(--ok);
	}
</style>
