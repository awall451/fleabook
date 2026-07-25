<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { applyTheme, DEFAULT_THEME, readTheme, THEMES, type ThemeId } from '$lib/theme';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// svelte-ignore state_referenced_locally
	let meetupNote = $state(data.meetupNote);

	let apiKey = $state('');

	// Both forms post to the same page, so each result is tagged with the form it
	// came from — without this a saved key would light up the meetup note's
	// "Saved" marker and vice versa.
	const meetupForm = $derived(form?.kind === 'meetup' ? form : null);
	const keyForm = $derived(form?.kind === 'apiKey' ? form : null);

	// The real value only exists in the browser; the server render shows the
	// default and is corrected on mount.
	let theme = $state<ThemeId>(DEFAULT_THEME);
	$effect(() => {
		theme = readTheme();
	});

	function pick(id: ThemeId) {
		theme = id;
		applyTheme(id);
	}
</script>

<h1>Settings</h1>

<form method="POST" action="?/meetup" use:enhance>
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
			{#if meetupForm?.error}
				<span class="error">{meetupForm.error}</span>
			{:else if meetupForm?.saved}
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

<h2>Claude access</h2>
<p class="muted small section-note">
	Fleabook writes your listings with Claude, so it needs a way to reach it. There are two, and you
	only need one.
</p>

<div class="auth" class:unknown={data.auth.mode === 'unknown'}>
	<span class="badge">
		{#if data.auth.mode === 'subscription'}
			Subscription
		{:else if data.auth.mode === 'unknown'}
			Not set up
		{:else}
			API key
		{/if}
	</span>
	<span>{data.auth.summary}</span>
</div>

{#if data.auth.envKeyOverrides && data.auth.hasStoredKey}
	<p class="muted small section-note">
		An <code>ANTHROPIC_API_KEY</code> is set in this app's environment, so it is being used instead of
		the key saved below. Remove the saved key to avoid confusion, or unset the environment variable.
	</p>
{/if}

<form method="POST" action="?/saveKey" use:enhance>
	<div class="field">
		<label for="apiKey">Anthropic API key (optional)</label>
		<p class="muted small">
			Leave this empty if you pay for Claude and have signed in with the Claude Code app — that
			already works and costs nothing extra. Add a key here only if you don't have a subscription.
			It is stored on this computer, in this app's database, and is sent nowhere except Anthropic.
		</p>
		<input
			id="apiKey"
			name="apiKey"
			type="password"
			autocomplete="off"
			spellcheck="false"
			placeholder={data.auth.storedKeyPreview || 'sk-ant-…'}
			bind:value={apiKey}
		/>
		<div class="row small muted">
			<span>
				{#if data.auth.hasStoredKey}
					A key is saved ({data.auth.storedKeyPreview}). Typing a new one replaces it.
				{:else}
					No key saved.
				{/if}
			</span>
			{#if keyForm?.error}
				<span class="error">{keyForm.error}</span>
			{:else if keyForm?.saved}
				<span class="ok">Key saved</span>
			{:else if keyForm?.cleared}
				<span class="ok">Key removed</span>
			{/if}
		</div>
	</div>

	<div class="actions">
		<button class="primary" type="submit">Save key</button>
		{#if data.auth.hasStoredKey}
			<button type="submit" formaction="?/clearKey">Remove key</button>
		{/if}
	</div>
</form>

<details class="howto">
	<summary>I don't have an API key — how do I get one?</summary>
	<p class="muted small">
		An API key is a pay-as-you-go alternative to a Claude subscription. You add credits up front and
		each listing draws a small amount against them. There is no monthly fee.
	</p>
	<ol class="small">
		<li>
			Go to <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer"
				>console.anthropic.com</a
			> and create an account.
		</li>
		<li>Open <strong>Billing</strong> and add credits. The smallest top-up is plenty to try this out.</li>
		<li>Open <strong>API keys</strong> and choose <strong>Create key</strong>.</li>
		<li>
			Copy the key — it starts with <code>sk-ant-</code> and is only shown once — then paste it into
			the box above and save.
		</li>
	</ol>
	<p class="muted small">
		Keep the key private. Anyone who has it can spend your credits. If you ever paste it somewhere by
		accident, delete it in the console and create a new one.
	</p>
</details>

<h2>Theme</h2>
<p class="muted small themes-note">
	Applies instantly and is remembered in this browser. Nothing about your listings changes.
</p>

<div class="themes">
	{#each THEMES as t (t.id)}
		<button
			type="button"
			class="theme"
			class:selected={theme === t.id}
			aria-pressed={theme === t.id}
			onclick={() => pick(t.id)}
		>
			<span class="swatch {t.id}">
				<span class="bar"></span>
				<span class="dot"></span>
			</span>
			<span class="meta">
				<span class="name">{t.name}</span>
				<span class="small muted">{t.blurb}</span>
			</span>
		</button>
	{/each}
</div>

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

	h2 {
		margin: 2.5rem 0 0.2rem;
		font-size: 1.15rem;
	}

	.section-note {
		margin: 0 0 0.9rem;
		max-width: 620px;
		line-height: 1.5;
	}

	.auth {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		max-width: 620px;
		margin-bottom: 1.25rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--ok);
		border-radius: var(--radius);
		background: var(--surface);
		line-height: 1.5;
	}

	/* Nothing is broken yet — the agent just has no way to authenticate — so this
	   reads as a prompt to finish setup, not as an error. */
	.auth.unknown {
		border-left-color: var(--accent);
	}

	.badge {
		flex: none;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius);
		border: 1px solid var(--border);
	}

	.actions {
		display: flex;
		gap: 0.5rem;
	}

	.howto {
		max-width: 620px;
		margin-top: 1.5rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.howto summary {
		cursor: pointer;
		font-weight: 550;
	}

	.howto p {
		margin: 0.6rem 0 0;
		line-height: 1.5;
	}

	.howto ol {
		margin: 0.6rem 0 0;
		padding-left: 1.2rem;
		line-height: 1.6;
	}

	.themes-note {
		margin: 0 0 0.9rem;
		max-width: 620px;
	}

	.themes {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 0.7rem;
		max-width: 620px;
	}

	.theme {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.6rem;
		text-align: left;
		background: var(--surface);
	}

	.theme.selected {
		border-color: var(--accent);
		outline: 1px solid var(--accent);
	}

	.meta {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.name {
		font-weight: 600;
	}

	/* Each swatch paints its own theme's colours, so the palette is visible
	   without switching to it. */
	.swatch {
		flex: none;
		position: relative;
		width: 46px;
		height: 34px;
		border-radius: var(--radius);
		border: 1px solid var(--sw-border);
		background: var(--sw-bg);
		overflow: hidden;
	}

	.swatch .bar {
		position: absolute;
		inset: 0 0 auto 0;
		height: 9px;
		background: var(--sw-surface);
		border-bottom: 1px solid var(--sw-border);
	}

	.swatch .dot {
		position: absolute;
		left: 6px;
		bottom: 6px;
		width: 16px;
		height: 8px;
		border-radius: 2px;
		background: var(--sw-accent);
	}

	.swatch.facebook {
		--sw-bg: #f0f2f5;
		--sw-surface: #ffffff;
		--sw-border: #ced0d4;
		--sw-accent: #1877f2;
	}

	.swatch.midnight {
		--sw-bg: #14171c;
		--sw-surface: #1b1f26;
		--sw-border: #333a45;
		--sw-accent: #6ea1ff;
	}

	.swatch.paper {
		--sw-bg: #fbfaf6;
		--sw-surface: #ffffff;
		--sw-border: #ddd7c8;
		--sw-accent: #9a3412;
	}

	.swatch.win98 {
		--sw-bg: #008080;
		--sw-surface: #c0c0c0;
		--sw-border: #000000;
		--sw-accent: #000080;
	}
</style>
