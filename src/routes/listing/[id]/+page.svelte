<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import { autogrow } from '$lib/actions/autogrow';
	import { AVAILABILITIES, CONDITIONS, LIMITS, composeDescription, formatPrice } from '$lib/types';
	import { compactTokens, duration } from '$lib/format';
	import type { Listing } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function seedForm(listing: Listing) {
		return {
			title: listing.title ?? '',
			description: listing.description ?? '',
			category: listing.category ?? '',
			condition: listing.condition ?? '',
			priceDollars: listing.price_cents != null ? formatPrice(listing.price_cents) : '',
			tagsText: listing.tags.join(', '),
			location: listing.location ?? '',
			availability: listing.availability,
			sku: listing.sku ?? '',
			userContext: listing.user_context ?? ''
		};
	}

	// Local mirror of the row. Edits apply here immediately and PATCH in the
	// background — no save button. Seeded once on mount: server-side changes are
	// pushed back in explicitly (see the agent phases) rather than re-synced
	// reactively, so an in-flight edit is never clobbered mid-keystroke.
	// svelte-ignore state_referenced_locally
	let form = $state(seedForm(data.listing));

	// svelte-ignore state_referenced_locally
	let photos = $state(data.photos);
	let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveTimer: ReturnType<typeof setTimeout>;

	function parsedTags(): string[] {
		return form.tagsText
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean)
			.slice(0, LIMITS.tags);
	}

	function parsedPriceCents(): number | null {
		const cleaned = form.priceDollars.replace(/[^0-9.]/g, '');
		if (cleaned === '') return null;
		const dollars = Number.parseFloat(cleaned);
		return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
	}

	function scheduleSave() {
		saveState = 'saving';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(save, 500);
	}

	async function save() {
		try {
			const res = await fetch(`/api/listings/${data.listing.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title: form.title || null,
					description: form.description || null,
					category: form.category || null,
					condition: form.condition || null,
					price_cents: parsedPriceCents(),
					tags: parsedTags(),
					location: form.location || null,
					availability: form.availability,
					sku: form.sku || null,
					user_context: form.userContext || null
				})
			});
			saveState = res.ok ? 'saved' : 'error';
		} catch {
			saveState = 'error';
		}
	}

	async function addPhotos(fileList: FileList | null) {
		if (!fileList || fileList.length === 0) return;
		const body = new FormData();
		for (const file of fileList) body.append('photos', file);
		const res = await fetch(`/api/listings/${data.listing.id}/photos`, { method: 'POST', body });
		if (res.ok) photos = await res.json();
	}

	async function removePhoto(photoId: string) {
		const res = await fetch(`/api/listings/${data.listing.id}/photos/${photoId}`, {
			method: 'DELETE'
		});
		if (res.ok) photos = await res.json();
	}

	let agentBusy = $state<'identify' | 'price' | null>(null);
	let agentNote = $state<string | null>(null);
	let agentError = $state<string | null>(null);
	let chaining = $state(false); // true for the whole identify→price run

	/**
	 * Run one agent stage over SSE and resolve when it finishes. Resolves true on
	 * success, false on failure (with the message already in `agentError`).
	 *
	 * Pricing measures at three to five minutes, so progress has to be visible or
	 * the app looks hung. The server keeps working if this connection drops and
	 * writes its result to the database either way — a closed tab costs the wait,
	 * not the work.
	 */
	function runStage(stage: 'identify' | 'price'): Promise<boolean> {
		return new Promise((resolve) => {
			agentBusy = stage;
			agentNote = null;

			const source = new EventSource(`/api/listings/${data.listing.id}/${stage}`);
			let settled = false;

			// Mark settled and close synchronously — no awaits. The server sends
			// `done`, then closes the stream, and the browser fires `onerror` for
			// that close. If we awaited anything (e.g. invalidateAll) before setting
			// `settled`, onerror would fire mid-await with settled still false and
			// mis-report a "lost connection" — which broke the identify→price
			// handoff. Setting settled here first makes onerror's guard catch it.
			const stop = () => {
				settled = true;
				source.close();
				agentBusy = null;
				agentNote = null;
			};

			source.addEventListener('progress', (event) => {
				agentNote = JSON.parse((event as MessageEvent).data).note;
			});

			source.addEventListener('done', async (event) => {
				stop();
				const updated = JSON.parse((event as MessageEvent).data);
				// Push the agent's fields into the form explicitly rather than relying
				// on a reactive re-sync, so this can never land mid-keystroke.
				form = seedForm(updated);
				photos = updated.photos ?? photos;
				await invalidateAll(); // refresh the identify panel before pricing starts
				resolve(true);
			});

			source.addEventListener('failed', (event) => {
				agentError = JSON.parse((event as MessageEvent).data).message;
				stop();
				resolve(false);
			});

			// Fires on transport failure. EventSource retries by default, which would
			// silently start a second agent run — so close it and report instead.
			source.onerror = () => {
				if (settled) return;
				agentError = 'Lost the connection. The run may still be finishing — reload in a minute.';
				stop();
				resolve(false);
			};
		});
	}

	/** Flush any pending debounced edit so the agent reads current context. */
	async function flushSave() {
		clearTimeout(saveTimer);
		await save();
	}

	/**
	 * One-click: identify, show the result, then price — driven by a single
	 * server-side job. The whole run finishes on the server whether or not this
	 * tab stays open, so firing a listing and immediately moving to the next one
	 * no longer leaves it stuck at "identified" with no price.
	 */
	function generate(): Promise<void> {
		return new Promise((resolve) => {
			agentError = null;
			chaining = true;

			const start = async () => {
				await flushSave(); // persist the context box before the job reads it
				agentBusy = 'identify';
				agentNote = null;

				const source = new EventSource(`/api/listings/${data.listing.id}/generate`);
				let settled = false;

				const stop = () => {
					settled = true;
					source.close();
					agentBusy = null;
					agentNote = null;
					chaining = false;
					resolve();
				};

				source.addEventListener('progress', (event) => {
					agentNote = JSON.parse((event as MessageEvent).data).note;
				});

				// Intermediate: identify finished, pricing is starting.
				source.addEventListener('identified', async (event) => {
					const updated = JSON.parse((event as MessageEvent).data);
					form = seedForm(updated);
					photos = updated.photos ?? photos;
					agentBusy = 'price';
					await invalidateAll(); // show the identify panel before pricing progress
				});

				source.addEventListener('done', async (event) => {
					const updated = JSON.parse((event as MessageEvent).data);
					stop();
					form = seedForm(updated);
					photos = updated.photos ?? photos;
					await invalidateAll();
				});

				source.addEventListener('failed', (event) => {
					agentError = JSON.parse((event as MessageEvent).data).message;
					stop();
				});

				source.onerror = () => {
					if (settled) return;
					agentError =
						'Lost the connection — but the run continues on the server. Reload in a few minutes and the price will be there.';
					stop();
				};
			};

			start();
		});
	}

	async function rerun(stage: 'identify' | 'price') {
		agentError = null;
		await flushSave();
		await runStage(stage);
	}

	async function reorder(index: number, delta: number) {
		const next = [...photos];
		const target = index + delta;
		if (target < 0 || target >= next.length) return;
		[next[index], next[target]] = [next[target], next[index]];
		photos = next;
		await fetch(`/api/listings/${data.listing.id}/photos`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ order: next.map((p) => p.id) })
		});
	}

	async function setCover(photoId: string) {
		const res = await fetch(`/api/listings/${data.listing.id}/photos`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ cover: photoId })
		});
		if (res.ok) photos = await res.json();
	}

	async function setStatus(status: string) {
		// Field edits save on a 500ms debounce. Marking a listing done is usually
		// the last thing you do after typing, so flush any pending edit before
		// navigating away — otherwise the last thing you typed is lost.
		await flushSave();

		const res = await fetch(`/api/listings/${data.listing.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ status })
		});

		if (!res.ok) {
			saveState = 'error';
			return; // stay put — navigating would imply it worked
		}

		await goto('/', { invalidateAll: true });
	}

	/** Selling records the actual sale price and date — that's what the dashboard
	 *  earnings are built from — so capture the real number, defaulting to the ask. */
	async function markSold() {
		await flushSave();
		const suggested = parsedPriceCents();
		const answer = prompt(
			'Sold! What did it actually sell for? (USD)',
			suggested != null ? (suggested / 100).toString() : ''
		);
		if (answer === null) return; // cancelled
		const dollars = Number.parseFloat(answer.replace(/[^0-9.]/g, ''));
		if (!Number.isFinite(dollars) || dollars < 0) {
			alert('Please enter a valid dollar amount.');
			return;
		}
		const res = await fetch(`/api/listings/${data.listing.id}/sold`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ price_cents: Math.round(dollars * 100) })
		});
		if (res.ok) await goto('/', { invalidateAll: true });
		else saveState = 'error';
	}

	/** Reset the renewal clock after re-posting on Marketplace. The pending save is
	 *  flushed first so a price the seller just dropped is what gets snapshotted —
	 *  that snapshot is the whole point of recording the renewal. */
	async function renew() {
		await flushSave();
		const res = await fetch(`/api/listings/${data.listing.id}/renew`, { method: 'POST' });
		if (res.ok) await invalidateAll();
		else saveState = 'error';
	}

	async function destroy() {
		if (!confirm('Delete this listing and its photos? This cannot be undone.')) return;
		const res = await fetch(`/api/listings/${data.listing.id}`, { method: 'DELETE' });
		if (res.ok) await goto('/');
	}

	function thumbOf(filename: string) {
		return filename.replace(/\.jpg$/, '_thumb.jpg');
	}

	let costNote = $derived(
		data.costKind === 'billed'
			? 'Billed to your API key.'
			: data.costKind === 'mixed'
				? `Part of this ran on an API key and part on a subscription — $${data.usage.billedCostUsd.toFixed(2)} of it was actually billed.`
				: 'What these tokens would price at on API rates. Your Claude subscription covered them — this was never charged.'
	);

	let titleLeft = $derived(LIMITS.title - form.title.length);

	// What actually gets posted — body plus the global meetup note. The counter
	// and the copy button both work off this, not the textarea alone, so the
	// character budget reflects reality.
	let fullDescription = $derived(composeDescription(form.description, data.meetupNote));
	let descLeft = $derived(LIMITS.description - fullDescription.length);
</script>

<div class="head">
	<a href="/" class="back small">← All listings</a>
	<div class="head-right small">
		<span class="status status-{data.listing.status}">{data.listing.status}</span>
		<span class="muted">
			{#if saveState === 'saving'}Saving…{:else if saveState === 'saved'}Saved{:else if saveState === 'error'}Save failed{/if}
		</span>
	</div>
</div>

{#if data.listing.error}
	<p class="banner">{data.listing.error}</p>
{/if}

{#if data.renewal.due}
	<div class="renew-banner">
		<div>
			<strong>This listing is ready for renewal.</strong>
			<span class="small">
				It's been up {data.renewal.daysListed} day{data.renewal.daysListed === 1 ? '' : 's'}.
				Marketplace stops showing listings that aren't renewed about every {data.renewDays} days.
				Re-post it there — change the price first if it isn't moving — then mark it renewed here.
			</span>
		</div>
		<button type="button" class="primary" onclick={renew}>Renew</button>
	</div>
{/if}

<div class="columns">
	<section class="left">
		<div class="photos">
			{#each photos as photo, i (photo.id)}
				<div class="tile">
					<img src="/photos/{data.listing.id}/{thumbOf(photo.filename)}" alt="" />
					{#if photo.is_cover}
						<span class="cover-badge">cover</span>
					{:else}
						<button type="button" class="make-cover" onclick={() => setCover(photo.id)}>
							set cover
						</button>
					{/if}
					<div class="reorder">
						<button type="button" disabled={i === 0} onclick={() => reorder(i, -1)} aria-label="Move earlier">‹</button>
						<button
							type="button"
							disabled={i === photos.length - 1}
							onclick={() => reorder(i, 1)}
							aria-label="Move later">›</button
						>
					</div>
					<button
						type="button"
						class="remove"
						onclick={() => removePhoto(photo.id)}
						aria-label="Remove photo">×</button
					>
				</div>
			{/each}

			<label class="tile add">
				<span>+ Add</span>
				<input
					type="file"
					accept="image/*"
					multiple
					onchange={(e) => addPhotos(e.currentTarget.files)}
				/>
			</label>
		</div>

		<div class="folder">
			<div class="small muted">Photo folder — Facebook's uploader reads from disk</div>
			<div class="path-row">
				<code>{data.photoDir}</code>
				<CopyButton value={data.photoDir} label="Copy path" />
			</div>
		</div>

		<div class="agent">
			<div class="context-field">
				<label for="context">Context for Claude <span class="muted small">(optional)</span></label>
				<p class="muted small">
					Anything the photos don't show or you want emphasized — "the white one is sealed in box",
					"the lid latch is cracked", a link to the original product page, "keep the description
					short". Fed into both identify and pricing.
				</p>
				<p class="muted small">
					Naming your own price here ("list it at $100") skips the price research entirely — no
					web search, no tokens spent second-guessing you.
				</p>
				<textarea
					id="context"
					rows="3"
					placeholder="e.g. One white unit is new-in-box, sealed. Selling the two black ones used."
					bind:value={form.userContext}
					oninput={scheduleSave}
					disabled={chaining}
				></textarea>
			</div>

			<button
				type="button"
				class="primary wide"
				disabled={agentBusy !== null || photos.length === 0}
				onclick={generate}
			>
				{#if agentBusy === 'identify'}
					Identifying…
				{:else if agentBusy === 'price'}
					Researching price…
				{:else if data.listing.ai_identify_confidence}
					Regenerate listing
				{:else}
					Generate listing
				{/if}
			</button>

			{#if agentBusy}
				<div class="progress small">
					<span class="spinner" aria-hidden="true"></span>
					<span>{agentNote ?? 'working…'}</span>
				</div>
				{#if agentBusy === 'price'}
					<p class="small muted note">
						Price research reads the open web and usually takes a few minutes. You can leave this
						page — the result is saved either way.
					</p>
				{/if}
			{/if}

			{#if agentError}
				<p class="agent-error small">{agentError}</p>
			{/if}

			{#if data.listing.ai_identify_confidence}
				<div class="ai-summary small">
					<span class="muted">Identified as</span>
					{data.listing.ai_brand ?? 'unknown brand'}
					{data.listing.ai_model ?? ''}
					<span class="conf conf-{data.listing.ai_identify_confidence}">
						{data.listing.ai_identify_confidence} confidence
					</span>
					{#if data.listing.ai_flaws.length > 0}
						<ul class="flaws">
							{#each data.listing.ai_flaws as flaw (flaw)}
								<li>{flaw}</li>
							{/each}
						</ul>
					{/if}
				</div>

				<!-- Re-run one stage after a manual correction, without redoing both. -->
				<div class="rerun small">
					<button type="button" disabled={agentBusy !== null} onclick={() => rerun('identify')}>
						Re-identify only
					</button>
					<button type="button" disabled={agentBusy !== null} onclick={() => rerun('price')}>
						Re-price only
					</button>
				</div>
			{/if}

			{#if data.usage.runs > 0}
				<!-- The asterisk marks a figure that was never charged — hovering says
				     why. Spelling it out inline would crowd a one-line footnote. -->
				<p class="usage small muted" title={costNote}>
					{data.usage.runs} agent run{data.usage.runs === 1 ? '' : 's'} ·
					{compactTokens(data.usage.totalTokens)} tokens ·
					{duration(data.usage.durationMs)} · ${data.usage.costUsd.toFixed(2)}{data.costKind ===
					'billed'
						? ''
						: '*'}
				</p>
			{/if}
		</div>

		<div class="status-actions">
			<button type="button" onclick={() => setStatus('posted')}>Mark posted</button>
			{#if data.listing.status === 'posted'}
				<button type="button" class:primary={data.renewal.due} onclick={renew}>Renew</button>
			{/if}
			<button type="button" onclick={markSold}>Mark sold</button>
			<button type="button" class="danger" onclick={destroy}>Delete</button>
		</div>

		{#if data.listing.renewal_count > 0 && data.listing.renewed_at}
			<p class="small muted renew-history">
				Renewed {data.listing.renewal_count}× · last on {new Date(
					data.listing.renewed_at
				).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
			</p>
		{:else if data.listing.posted_at}
			<p class="small muted renew-history">
				Posted {new Date(data.listing.posted_at).toLocaleDateString('en-US', {
					month: 'short',
					day: 'numeric'
				})}{data.renewal.daysListed != null ? ` · ${data.renewal.daysListed} days on the market` : ''}
			</p>
		{/if}
	</section>

	<section class="right">
		<div class="field">
			<div class="label-row">
				<label for="title">Title</label>
				<span class="counter small" class:over={titleLeft < 0}>{titleLeft}</span>
				<CopyButton value={form.title} />
			</div>
			<input id="title" bind:value={form.title} oninput={scheduleSave} maxlength={LIMITS.title} />
		</div>

		<div class="row">
			<div class="field">
				<div class="label-row">
					<label for="price">Price (USD)</label>
					<CopyButton value={form.priceDollars} />
				</div>
				<input id="price" inputmode="decimal" bind:value={form.priceDollars} oninput={scheduleSave} />
			</div>

			<div class="field">
				<div class="label-row">
					<label for="condition">Condition</label>
					<CopyButton value={form.condition} />
				</div>
				<select id="condition" bind:value={form.condition} onchange={scheduleSave}>
					<option value="">—</option>
					{#each CONDITIONS as condition (condition)}
						<option value={condition}>{condition}</option>
					{/each}
				</select>
			</div>
		</div>

		{#if data.listing.ai_price_basis === 'seller'}
			<!-- The seller priced this one themselves in the context box, so there is
			     no research to show — only a note saying none was run, since a silent
			     skip looks identical to a stage that failed. -->
			<div class="price-panel">
				<div class="price-head">
					<span class="basis">priced by you — no research run</span>
				</div>
				<p class="rationale small">{data.listing.ai_rationale}</p>
			</div>
		{:else if data.listing.ai_price_confidence}
			<div class="price-panel">
				<div class="price-head">
					<span class="range">
						${formatPrice(data.listing.ai_price_low)} – ${formatPrice(data.listing.ai_price_high)}
					</span>
					<span class="basis">{data.listing.ai_price_basis === 'comps' ? 'from comparables' : 'estimated from retail'}</span>
					<span class="conf conf-{data.listing.ai_price_confidence}">
						{data.listing.ai_price_confidence} confidence
					</span>
				</div>

				{#if data.listing.ai_msrp_cents}
					<div class="small muted">Original retail around ${formatPrice(data.listing.ai_msrp_cents)}</div>
				{/if}

				<p class="rationale small">{data.listing.ai_rationale}</p>

				{#if data.listing.ai_sources.length > 0}
					<ul class="sources small">
						{#each data.listing.ai_sources as source (source)}
							<li><a href={source} target="_blank" rel="noreferrer noopener">{source}</a></li>
						{/each}
					</ul>
				{/if}

				<p class="caveat small muted">
					Web search mostly reaches asking prices, not completed sales, so this tends to read
					high. Treat it as a starting point and adjust.
				</p>
			</div>
		{/if}

		<div class="field">
			<div class="label-row">
				<label for="category">Category</label>
				<CopyButton value={form.category} />
			</div>
			<select id="category" bind:value={form.category} onchange={scheduleSave}>
				<option value="">—</option>
				{#each data.groups as group (group.group)}
					<optgroup label={group.group}>
						{#each group.categories as category (category.name)}
							<option value={category.name}>{category.name}</option>
						{/each}
					</optgroup>
				{/each}
			</select>
		</div>

		<div class="field">
			<div class="label-row">
				<label for="description">Description</label>
				<span class="counter small" class:over={descLeft < 0}>{descLeft}</span>
				<CopyButton value={fullDescription} />
			</div>
			<textarea
				id="description"
				use:autogrow={form.description}
				bind:value={form.description}
				oninput={scheduleSave}
				maxlength={LIMITS.description}
			></textarea>

			{#if data.meetupNote.trim()}
				<div class="appended small">
					<span class="muted">Copied with the description:</span>
					<p>{data.meetupNote.trim()}</p>
					<a class="muted" href="/settings">Edit in settings</a>
				</div>
			{:else}
				<p class="appended-empty small muted">
					No meetup note set. <a href="/settings">Add one in settings</a> to append pickup details
					to every listing.
				</p>
			{/if}
		</div>

		<div class="field">
			<div class="label-row">
				<label for="tags">Tags <span class="muted small">(comma separated, max 20)</span></label>
				<CopyButton value={parsedTags().join(', ')} />
			</div>
			<input id="tags" bind:value={form.tagsText} oninput={scheduleSave} />
		</div>

		<div class="row">
			<div class="field">
				<div class="label-row">
					<label for="location">Location</label>
					<CopyButton value={form.location} />
				</div>
				<input id="location" bind:value={form.location} oninput={scheduleSave} />
			</div>

			<div class="field">
				<div class="label-row"><label for="availability">Availability</label></div>
				<select id="availability" bind:value={form.availability} onchange={scheduleSave}>
					{#each AVAILABILITIES as availability (availability)}
						<option value={availability}
							>{availability === 'single' ? 'Single item' : 'In stock'}</option
						>
					{/each}
				</select>
			</div>

			<div class="field">
				<div class="label-row">
					<label for="sku">SKU</label>
					<CopyButton value={form.sku} />
				</div>
				<input id="sku" bind:value={form.sku} oninput={scheduleSave} />
			</div>
		</div>
	</section>
</div>

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.back {
		text-decoration: none;
	}

	.head-right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.status {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.05rem 0.55rem;
		color: var(--muted);
	}

	.banner {
		border: 1px solid var(--danger);
		color: var(--danger);
		border-radius: var(--radius);
		padding: 0.6rem 0.8rem;
	}

	/* A nudge, not an error — hence --warn rather than the red error banner it
	   sits directly beneath. */
	.renew-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		border: 1px solid var(--warn);
		border-left: 3px solid var(--warn);
		border-radius: var(--radius);
		padding: 0.6rem 0.8rem;
		margin-bottom: 1.25rem;
		background: var(--surface);
	}

	.renew-banner span {
		display: block;
		color: var(--muted);
		margin-top: 0.15rem;
		line-height: 1.5;
		max-width: 62ch;
	}

	.renew-history {
		margin: 0.5rem 0 0;
	}

	.usage {
		margin: 0.75rem 0 0;
	}

	.columns {
		display: grid;
		grid-template-columns: minmax(280px, 380px) 1fr;
		gap: 2rem;
		align-items: start;
	}

	@media (max-width: 860px) {
		.columns {
			grid-template-columns: 1fr;
		}
	}

	.photos {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
		gap: 0.5rem;
	}

	.tile {
		position: relative;
		aspect-ratio: 1;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--surface-2);
	}

	.tile img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.tile.add {
		display: grid;
		place-items: center;
		cursor: pointer;
		color: var(--muted);
		border-style: dashed;
	}

	.tile.add:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.tile.add input {
		display: none;
	}

	.cover-badge {
		position: absolute;
		left: 4px;
		bottom: 4px;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: rgba(0, 0, 0, 0.7);
		color: #fff;
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
	}

	/* Overlay controls sit on an unknown photo, so they carry their own contrast:
	   a near-opaque scrim plus a hairline ring that keeps the circle readable
	   against a dark subject too. */
	.remove {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 22px;
		height: 22px;
		padding: 0;
		line-height: 1;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.72);
		color: #fff;
		border-color: transparent;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
	}

	.remove:hover:not(:disabled) {
		background: var(--danger);
		border-color: transparent;
	}

	.make-cover {
		position: absolute;
		left: 4px;
		bottom: 4px;
		font-size: 0.62rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.72);
		color: #fff;
		border-color: transparent;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
		opacity: 0;
		transition: opacity 0.12s;
	}

	.tile:hover .make-cover,
	.make-cover:focus-visible {
		opacity: 1;
	}

	.reorder {
		position: absolute;
		right: 4px;
		bottom: 4px;
		display: flex;
		gap: 2px;
	}

	.reorder button {
		width: 22px;
		height: 22px;
		padding: 0;
		line-height: 1;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.72);
		color: #fff;
		border-color: transparent;
		font-size: 0.8rem;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
	}

	.reorder button:hover:not(:disabled) {
		background: rgba(0, 0, 0, 0.88);
		border-color: transparent;
	}

	/* An unavailable arrow stays legible — at 0.25 opacity it read as a smudge
	   rather than as a disabled control. `.tile` prefix outranks the theme-level
	   disabled rules in app.css. */
	.tile .reorder button:disabled {
		opacity: 1;
		background: rgba(0, 0, 0, 0.4);
		color: rgba(255, 255, 255, 0.55);
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25);
	}

	.progress {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.6rem;
		color: var(--muted);
	}

	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		flex: none;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}

	.note {
		margin: 0.4rem 0 0;
		line-height: 1.45;
	}

	.folder {
		margin-top: 1rem;
		padding: 0.7rem 0.8rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.path-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.35rem;
	}

	.path-row code {
		flex: 1;
		font-size: 0.75rem;
		overflow-wrap: anywhere;
		color: var(--muted);
	}

	.agent {
		margin-top: 1rem;
	}

	.context-field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 0.75rem;
	}

	.context-field label {
		font-weight: 550;
	}

	.context-field p {
		margin: 0 0 0.15rem;
		line-height: 1.45;
	}

	.context-field textarea {
		min-height: 4.5rem;
	}

	.wide {
		width: 100%;
	}

	.rerun {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}

	.rerun button {
		flex: 1;
		padding: 0.3rem 0.5rem;
	}

	.ai-summary {
		margin-top: 0.6rem;
		padding: 0.6rem 0.7rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		line-height: 1.5;
	}

	.conf {
		display: inline-block;
		border-radius: 999px;
		padding: 0 0.5rem;
		font-size: 0.72rem;
		border: 1px solid currentColor;
	}

	.conf-high {
		color: var(--ok);
	}

	.conf-medium {
		color: var(--warn);
	}

	.conf-low {
		color: var(--danger);
	}

	.flaws {
		margin: 0.4rem 0 0;
		padding-left: 1.1rem;
		color: var(--muted);
	}

	.agent-error {
		color: var(--danger);
		margin: 0.5rem 0 0;
	}

	.price-panel {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		padding: 0.75rem 0.85rem;
		margin-top: -0.35rem;
	}

	.price-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.range {
		font-weight: 650;
		font-size: 1.05rem;
	}

	.basis {
		font-size: 0.75rem;
		color: var(--muted);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0 0.5rem;
	}

	.rationale {
		margin: 0.5rem 0 0;
		line-height: 1.55;
	}

	.sources {
		margin: 0.5rem 0 0;
		padding-left: 1.1rem;
	}

	.sources a {
		overflow-wrap: anywhere;
	}

	.caveat {
		margin: 0.6rem 0 0;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border);
		line-height: 1.5;
	}

	.status-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.danger {
		color: var(--danger);
	}

	.danger:hover {
		border-color: var(--danger);
	}

	.right {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}

	/* Subgrid so the label rows share one height across the row: only some of
	   these fields carry a Copy button, and without it their label row is
	   shorter and the input below it rides up. */
	.row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.3rem 1rem;
	}

	.row .field {
		display: grid;
		grid-template-rows: subgrid;
		grid-row: span 2;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.label-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.label-row label {
		font-weight: 550;
		margin-right: auto;
	}

	.appended {
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius);
		background: var(--surface);
		padding: 0.5rem 0.7rem;
		margin-top: 0.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.appended p {
		margin: 0;
		white-space: pre-wrap;
		line-height: 1.5;
	}

	.appended a {
		align-self: flex-start;
		font-size: 0.78rem;
	}

	.appended-empty {
		margin: 0.4rem 0 0;
	}

	.counter {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	/* Auto-grown by the autogrow action — the drag handle and tall min-height
	   floor are no longer needed. */
	#description {
		resize: none;
		min-height: 0;
	}

	.counter.over {
		color: var(--danger);
	}
</style>
