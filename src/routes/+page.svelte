<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import ListingRow from '$lib/components/ListingRow.svelte';
	import {
		rememberPreference,
		SORT_COOKIE,
		SORTS,
		sortListings,
		VIEW_COOKIE,
		type SortId,
		type ViewId
	} from '$lib/listView';
	import { formatPrice, RENEW_DUE, STATUSES } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let filters = $derived(
		data.remindersOn ? ['all', RENEW_DUE, ...STATUSES] : ['all', ...STATUSES]
	);

	function label(filter: string): string {
		return filter === RENEW_DUE ? 'renew due' : filter;
	}

	/** A chip's URL keeps the current search — narrowing by status and searching
	 *  are different questions, and clicking one should not discard the other. */
	function chipHref(filter: string): string {
		const params = new URLSearchParams();
		if (filter !== 'all') params.set('status', filter);
		if (data.query) params.set('q', data.query);
		const qs = params.toString();
		return qs ? `/?${qs}` : '/';
	}

	// Search is bound to the URL rather than to local state so a result list can
	// be linked, reloaded, and stepped back through. Debounced because every
	// keystroke is otherwise a server round-trip.
	let search = $state('');
	let seeded = $state(false);
	$effect(() => {
		// Seed once from the URL; after that the input is the source of truth and
		// re-seeding would fight the user mid-keystroke.
		if (seeded) return;
		search = data.query;
		seeded = true;
	});

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function onSearch() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			const params = new URLSearchParams();
			if (data.status !== 'all') params.set('status', data.status);
			if (search.trim()) params.set('q', search.trim());
			const qs = params.toString();
			// keepFocus so typing is uninterrupted; replaceState so a search does not
			// bury the previous page under one history entry per keystroke.
			goto(qs ? `/?${qs}` : '/', { keepFocus: true, noScroll: true, replaceState: true });
		}, 200);
	}

	function clearSearch() {
		search = '';
		onSearch();
	}

	// A listing carries one of these while an agent stage is running on the
	// server. The status is written when the stage starts and cleared when it
	// finishes — even if you navigated away — so it survives a page reload.
	const WORKING: Record<string, string> = {
		identifying: 'identifying…',
		pricing: 'researching price…'
	};

	// Display preferences arrive already resolved from the cookie, so the server
	// rendered this page in the right shape and there is nothing to correct after
	// hydration. The local override is what makes a change instant: the cookie is
	// written for the next load, but this render must not wait for one.
	let viewOverride = $state<ViewId | null>(null);
	let sortOverride = $state<SortId | null>(null);
	let view = $derived(viewOverride ?? data.view);
	let sort = $derived(sortOverride ?? data.sort);

	function setView(next: ViewId) {
		viewOverride = next;
		rememberPreference(VIEW_COOKIE, next);
	}

	function setSort(next: SortId) {
		sortOverride = next;
		rememberPreference(SORT_COOKIE, next);
	}

	let listings = $derived(sortListings(data.listings, sort));

	// Which rows are open. Keyed by id rather than index so reordering or
	// refreshing the list does not silently expand a different listing.
	let openRows = $state(new SvelteSet<string>());
	function toggleRow(id: string) {
		if (openRows.has(id)) openRows.delete(id);
		else openRows.add(id);
	}

	let anyWorking = $derived(data.listings.some((l) => l.status in WORKING));

	// While something is working elsewhere, refresh the list on an interval so the
	// spinner clears itself when the run lands — no manual reload. Stops once
	// nothing is active, so an idle page isn't polling.
	$effect(() => {
		if (!anyWorking) return;
		const timer = setInterval(() => invalidateAll(), 4000);
		return () => clearInterval(timer);
	});
</script>

<div class="toolbar">
	<div class="search">
		<input
			type="search"
			placeholder="Search titles, brands, tags…"
			aria-label="Search listings"
			bind:value={search}
			oninput={onSearch}
		/>
		{#if search}
			<button type="button" class="clear" onclick={clearSearch} aria-label="Clear search">×</button>
		{/if}
	</div>

	<div class="display">
		<label class="sr-only" for="sort">Sort</label>
		<select id="sort" value={sort} onchange={(e) => setSort(e.currentTarget.value as SortId)}>
			{#each SORTS as option (option.id)}
				<option value={option.id}>{option.label}</option>
			{/each}
		</select>

		<div class="views" role="group" aria-label="View">
			<button
				type="button"
				class:on={view === 'tiles'}
				aria-pressed={view === 'tiles'}
				onclick={() => setView('tiles')}
			>
				Tiles
			</button>
			<button
				type="button"
				class:on={view === 'rows'}
				aria-pressed={view === 'rows'}
				onclick={() => setView('rows')}
			>
				Rows
			</button>
		</div>
	</div>

	<div class="filters">
		{#each filters as filter (filter)}
			{@const count = data.counts[filter] ?? 0}
			{#if count === 0 && data.status !== filter}
				<!-- Nothing to show behind it, so it reads as a label rather than a
				     control. Left in place instead of hidden: a bar that reshuffles as
				     work moves through it is harder to aim at than a stable one. -->
				<span class="chip empty-chip">{label(filter)} <span class="count">0</span></span>
			{:else}
				<a class="chip" class:active={data.status === filter} href={chipHref(filter)}>
					{label(filter)}
					<span class="count">{count}</span>
				</a>
			{/if}
		{/each}
	</div>
</div>

{#if data.listings.length === 0}
	<p class="empty muted">
		{#if data.query}
			No listings match <strong>{data.query}</strong>.
			<button type="button" class="linklike" onclick={clearSearch}>Clear the search</button>
		{:else if data.status !== 'all'}
			Nothing is {label(data.status)} right now. <a href={chipHref('all')}>Show everything</a>.
		{:else}
			Nothing here yet. <a href="/new">Upload some photos</a> to start a listing.
		{/if}
	</p>
{:else if view === 'rows'}
	<div class="rows">
		{#each listings as listing (listing.id)}
			<ListingRow
				{listing}
				working={WORKING[listing.status] ?? null}
				expanded={openRows.has(listing.id)}
				ontoggle={() => toggleRow(listing.id)}
			/>
		{/each}
	</div>
{:else}
	<div class="grid">
		{#each listings as listing (listing.id)}
			<a class="card" href="/listing/{listing.id}">
				<div class="thumb">
					{#if listing.cover}
						<img src={listing.cover} alt="" loading="lazy" />
					{:else}
						<span class="muted small">no photos</span>
					{/if}
					{#if listing.renewal.due}
						<!-- The whole tile is already a link to the listing, so the badge
						     needs no handler of its own — it just has to be noticed. -->
						<span class="renew-badge" title="Up for {listing.renewal.daysListed} days">
							<span aria-hidden="true">⟳</span> renew
						</span>
					{/if}
				</div>
				<div class="body">
					<div class="title">{listing.title || 'Untitled listing'}</div>
					<div class="meta">
						<span class="price">
							{listing.price_cents != null ? `$${formatPrice(listing.price_cents)}` : '—'}
						</span>
						{#if listing.status in WORKING}
							<span class="status working">
								<span class="spinner" aria-hidden="true"></span>
								{WORKING[listing.status]}
							</span>
						{:else}
							<span class="status status-{listing.status}">{listing.status}</span>
						{/if}
					</div>
				</div>
			</a>
		{/each}
	</div>
{/if}

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}

	.search {
		position: relative;
		flex: 1 1 16rem;
		max-width: 22rem;
	}

	.search input {
		padding-right: 2rem;
	}

	/* The native search-field clear button only exists in some browsers, so the
	   affordance is provided here rather than assumed. */
	.search .clear {
		position: absolute;
		right: 0.35rem;
		top: 50%;
		transform: translateY(-50%);
		border: 0;
		background: none;
		color: var(--muted);
		font-size: 1.1rem;
		line-height: 1;
		padding: 0.15rem 0.35rem;
		cursor: pointer;
	}

	.search input::-webkit-search-cancel-button {
		display: none;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	/* Pushed to the end of the toolbar: how the list is laid out is a different
	   question from what it contains, and mixing the two controls invites you to
	   read the sort as another filter. */
	.display {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-left: auto;
	}

	.display select {
		width: auto;
		font-size: 0.8rem;
		padding: 0.2rem 0.4rem;
	}

	.views {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 999px;
		overflow: hidden;
	}

	.views button {
		border: 0;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 0.8rem;
		padding: 0.2rem 0.7rem;
		cursor: pointer;
	}

	.views button.on {
		background: var(--accent);
		color: var(--accent-text);
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.chip {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
		font-size: 0.8rem;
		text-decoration: none;
		color: var(--muted);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.2rem 0.7rem;
	}

	.chip.active {
		background: var(--accent);
		color: var(--accent-text);
		border-color: transparent;
	}

	.count {
		font-variant-numeric: tabular-nums;
		font-size: 0.72rem;
		opacity: 0.75;
	}

	/* Reachable-but-empty. Faded rather than removed, and not a link, so the row
	   stays in one place while the numbers move. */
	.empty-chip {
		opacity: 0.4;
		cursor: default;
	}

	.linklike {
		border: 0;
		background: none;
		padding: 0;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}

	.empty {
		padding: 3rem 0;
		text-align: center;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
		gap: 1rem;
	}

	.card {
		text-decoration: none;
		color: inherit;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--surface);
		display: flex;
		flex-direction: column;
	}

	.card:hover {
		border-color: var(--accent);
	}

	.thumb {
		position: relative;
		aspect-ratio: 4 / 3;
		background: var(--surface-2);
		display: grid;
		place-items: center;
		overflow: hidden;
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* Sits on an unknown photo, so — like the listing page's photo overlays — it
	   carries its own contrast rather than a theme colour: an opaque amber fill
	   and a hairline ring that survives both a dark and a blown-out subject. */
	.renew-badge {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		background: #b26a00;
		color: #fff;
		box-shadow: 0 0 0 1px rgb(255 255 255 / 0.55);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	.body {
		padding: 0.65rem 0.75rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.title {
		font-weight: 550;
		line-height: 1.35;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.price {
		font-weight: 650;
	}

	.status {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
	}

	/* Per-status colours live in app.css so the listing page gets the same set. */

	.status.working {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--accent);
		border-color: var(--accent);
		text-transform: none;
		letter-spacing: 0;
	}

	.spinner {
		width: 9px;
		height: 9px;
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
</style>
