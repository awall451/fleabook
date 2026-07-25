<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatPrice, STATUSES } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const filters = ['all', ...STATUSES];

	// A listing carries one of these while an agent stage is running on the
	// server. The status is written when the stage starts and cleared when it
	// finishes — even if you navigated away — so it survives a page reload.
	const WORKING: Record<string, string> = {
		identifying: 'identifying…',
		pricing: 'researching price…'
	};

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

<div class="filters">
	{#each filters as filter (filter)}
		<a
			class="chip"
			class:active={data.status === filter}
			href={filter === 'all' ? '/' : `/?status=${filter}`}>{filter}</a
		>
	{/each}
</div>

{#if data.listings.length === 0}
	<p class="empty muted">
		Nothing here yet. <a href="/new">Upload some photos</a> to start a listing.
	</p>
{:else}
	<div class="grid">
		{#each data.listings as listing (listing.id)}
			<a class="card" href="/listing/{listing.id}">
				<div class="thumb">
					{#if listing.cover}
						<img src={listing.cover} alt="" loading="lazy" />
					{:else}
						<span class="muted small">no photos</span>
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
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 1.25rem;
	}

	.chip {
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

	.status-draft,
	.status-identified {
		color: var(--warn);
	}

	.status-posted,
	.status-sold {
		color: var(--ok);
	}

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
