<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// svelte-ignore state_referenced_locally
	let meetupNote = $state(data.meetupNote);
</script>

<h1>Settings</h1>

<form method="POST" use:enhance>
	<div class="field">
		<label for="meetupNote">Meetup note</label>
		<p class="muted small">
			Appended to the end of every listing description when you copy it. Changing it here updates
			every listing at once — it isn't stored per-listing. Claude is instructed not to write any
			meetup, pickup, delivery, or payment language of its own, so this is the only place it comes
			from.
		</p>
		<textarea
			id="meetupNote"
			name="meetupNote"
			rows="3"
			maxlength="500"
			placeholder="e.g. Meet at the Main St. grocery store parking lot"
			bind:value={meetupNote}
		></textarea>
		<div class="row small muted">
			<span>{meetupNote.length} / 500</span>
			{#if form?.error}
				<span class="error">{form.error}</span>
			{:else if form?.saved}
				<span class="ok">Saved</span>
			{/if}
		</div>
	</div>

	<button class="primary" type="submit">Save</button>
</form>

{#if meetupNote.trim()}
	<div class="preview">
		<div class="small muted">Every description will end with:</div>
		<p>{meetupNote.trim()}</p>
	</div>
{/if}

<style>
	form {
		max-width: 620px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 1rem;
	}

	label {
		font-weight: 550;
	}

	.field p {
		margin: 0 0 0.2rem;
		line-height: 1.5;
	}

	textarea {
		min-height: 5rem;
	}

	.row {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}

	.error {
		color: var(--danger);
	}

	.ok {
		color: var(--ok);
	}

	.preview {
		max-width: 620px;
		margin-top: 1.75rem;
		padding: 0.75rem 0.85rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.preview p {
		margin: 0.35rem 0 0;
		white-space: pre-wrap;
		line-height: 1.55;
	}
</style>
