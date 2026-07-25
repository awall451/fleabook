<script lang="ts">
	import { goto } from '$app/navigation';

	let files = $state<File[]>([]);
	let dragging = $state(false);
	let uploading = $state(false);
	let errorMessage = $state<string | null>(null);

	let previews = $derived(files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })));

	function addFiles(incoming: FileList | null) {
		if (!incoming) return;
		const images = Array.from(incoming).filter((f) => f.type.startsWith('image/'));
		files = [...files, ...images];
		errorMessage = null;
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		addFiles(event.dataTransfer?.files ?? null);
	}

	function remove(index: number) {
		files = files.filter((_, i) => i !== index);
	}

	/** SvelteKit errors arrive as JSON, plain text, or an HTML page depending on
	 *  where they were raised. Show the sentence, not the envelope. */
	async function readError(res: Response): Promise<string> {
		const body = await res.text().catch(() => '');
		try {
			const parsed = JSON.parse(body);
			if (typeof parsed?.message === 'string') return parsed.message;
		} catch {
			// not JSON
		}
		if (body && !body.trimStart().startsWith('<')) return body;
		return `Upload failed (${res.status})`;
	}

	async function upload() {
		if (files.length === 0) return;
		uploading = true;
		errorMessage = null;

		const form = new FormData();
		for (const file of files) form.append('photos', file);

		try {
			const res = await fetch('/api/listings', { method: 'POST', body: form });
			if (!res.ok) {
				const message = await readError(res);
				throw new Error(
					res.status === 413
						? `${message} — these photos exceed the server's upload limit. Try fewer at a time.`
						: message
				);
			}
			const listing = await res.json();
			await goto(`/listing/${listing.id}`);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Upload failed';
			uploading = false;
		}
	}
</script>

<h1>New listing</h1>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="dropzone"
	class:dragging
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
>
	<p>Drop photos here</p>
	<p class="muted small">or</p>
	<label class="picker">
		Choose files
		<input
			type="file"
			accept="image/*"
			multiple
			onchange={(e) => addFiles(e.currentTarget.files)}
		/>
	</label>
	<p class="muted small">EXIF data — including GPS location — is stripped on upload.</p>
</div>

{#if previews.length > 0}
	<div class="strip">
		{#each previews as preview, i (preview.url)}
			<div class="tile">
				<img src={preview.url} alt={preview.name} />
				<button type="button" class="remove" onclick={() => remove(i)} aria-label="Remove">×</button>
			</div>
		{/each}
	</div>
{/if}

{#if errorMessage}
	<p class="error">{errorMessage}</p>
{/if}

<div class="actions">
	<button class="primary" disabled={files.length === 0 || uploading} onclick={upload}>
		{uploading ? 'Uploading…' : `Create listing from ${files.length} photo${files.length === 1 ? '' : 's'}`}
	</button>
</div>

<style>
	.dropzone {
		border: 2px dashed var(--border);
		border-radius: var(--radius);
		padding: 2.5rem 1rem;
		text-align: center;
		background: var(--surface);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.dropzone.dragging {
		border-color: var(--accent);
		background: var(--surface-2);
	}

	.dropzone p {
		margin: 0;
	}

	.picker {
		display: inline-block;
		cursor: pointer;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.45rem 0.9rem;
	}

	.picker:hover {
		border-color: var(--accent);
	}

	.picker input {
		display: none;
	}

	.strip {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 1.25rem;
	}

	.tile {
		position: relative;
		width: 130px;
		aspect-ratio: 1;
		border-radius: var(--radius);
		overflow: hidden;
		border: 1px solid var(--border);
	}

	.tile img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.remove {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 24px;
		height: 24px;
		padding: 0;
		line-height: 1;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.65);
		color: #fff;
		border-color: transparent;
	}

	.error {
		color: var(--danger);
	}

	.actions {
		margin-top: 1.5rem;
	}
</style>
