<script lang="ts">
	import { agoLabel, daysSince } from '$lib/format';
	import { formatPrice, type Listing, type RenewalStatus } from '$lib/types';

	/**
	 * One listing as a wide row: compact by default, expandable in place to the
	 * pricing and renewal detail the tile has no room for.
	 *
	 * The row's left side is a single link to the listing; the chevron is a
	 * separate button. Nesting a toggle inside a link gives you an element that
	 * does two things depending on where you click it, which is neither
	 * keyboard-navigable nor guessable.
	 */
	interface RowListing extends Listing {
		cover: string | null;
		photoCount: number;
		renewal: RenewalStatus;
	}

	let {
		listing,
		working,
		expanded,
		ontoggle
	}: {
		listing: RowListing;
		/** Progress text while an agent stage runs, or null when idle. */
		working: string | null;
		expanded: boolean;
		ontoggle: () => void;
	} = $props();

	let clock = $derived(listing.renewed_at ?? listing.posted_at);

	let timing = $derived.by(() => {
		if (listing.status === 'sold' && listing.sold_at) return `sold ${agoLabel(listing.sold_at)}`;
		if (clock != null) return `${daysSince(clock)}d listed`;
		return null;
	});

	let estimate = $derived.by(() => {
		if (listing.ai_price_basis === 'seller') return 'priced by you — no research run';
		if (listing.ai_price_low != null && listing.ai_price_high != null) {
			const range = `est $${formatPrice(listing.ai_price_low)}–${formatPrice(listing.ai_price_high)}`;
			return listing.ai_price_confidence
				? `${range} · ${listing.ai_price_confidence} confidence`
				: range;
		}
		return null;
	});
</script>

<div class="row" class:expanded>
	<a class="main" href="/listing/{listing.id}">
		<div class="thumb">
			{#if listing.cover}
				<img src={listing.cover} alt="" loading="lazy" />
			{:else}
				<span class="none">—</span>
			{/if}
			{#if listing.renewal.due}
				<span class="renew-dot" title="Up for {listing.renewal.daysListed} days" aria-hidden="true"
				></span>
			{/if}
		</div>

		<div class="text">
			<div class="title">{listing.title || 'Untitled listing'}</div>
			<div class="sub small muted">
				{[
					listing.category,
					listing.condition,
					`${listing.photoCount} photo${listing.photoCount === 1 ? '' : 's'}`
				]
					.filter(Boolean)
					.join(' · ')}
			</div>
		</div>

		<div class="right">
			{#if working}
				<span class="status working">
					<span class="spinner" aria-hidden="true"></span>
					{working}
				</span>
			{:else}
				<span class="status status-{listing.status}">{listing.status}</span>
			{/if}
			<span class="price">
				{listing.price_cents != null ? `$${formatPrice(listing.price_cents)}` : '—'}
			</span>
			{#if timing}
				<span class="timing small muted">{timing}</span>
			{/if}
		</div>
	</a>

	<button
		type="button"
		class="chev"
		aria-expanded={expanded}
		aria-label={expanded ? 'Hide details' : 'Show details'}
		onclick={ontoggle}
	>
		<span aria-hidden="true">{expanded ? '⌄' : '›'}</span>
	</button>
</div>

{#if expanded}
	<div class="detail small">
		<div class="line">
			{#if estimate}
				<span>{estimate}</span>
			{:else}
				<span class="muted">No price estimate yet</span>
			{/if}
			{#if listing.ai_msrp_cents}
				<span class="muted">retail new ${formatPrice(listing.ai_msrp_cents)}</span>
			{/if}
		</div>

		<div class="line muted">
			{#if listing.status === 'sold' && listing.sold_at}
				<span>
					Sold {agoLabel(listing.sold_at)}{listing.sold_price_cents != null
						? ` for $${formatPrice(listing.sold_price_cents)}`
						: ''}
				</span>
			{:else if listing.posted_at}
				<span>Posted {agoLabel(listing.posted_at)}</span>
				<span>
					renewed {listing.renewal_count} time{listing.renewal_count === 1 ? '' : 's'}
				</span>
			{:else}
				<!-- Listings posted before the renewal clock existed have no posted_at,
				     and guessing one from updated_at would be wrong the moment the
				     listing is edited. Say so rather than showing an invented date. -->
				<span>Not posted yet, or posted before renewal tracking</span>
			{/if}
			<span>Updated {agoLabel(listing.updated_at)}</span>
		</div>

		<a class="detail-link" href="/listing/{listing.id}">View listing →</a>
	</div>
{/if}

<style>
	.row {
		display: flex;
		align-items: stretch;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	.row:hover {
		border-color: var(--accent);
	}

	/* An expanded row and its detail panel read as one card: square off the
	   join so they do not look like two stacked things. */
	.row.expanded {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
		border-bottom-color: transparent;
	}

	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.6rem;
		text-decoration: none;
		color: inherit;
	}

	.thumb {
		position: relative;
		flex: none;
		width: 52px;
		height: 52px;
		border-radius: calc(var(--radius) - 2px);
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

	.thumb .none {
		color: var(--muted);
	}

	/* The tile view has room for a "renew" pill; a 52px thumb does not, so the
	   same signal becomes a dot in the same corner and the same colour. */
	.renew-dot {
		position: absolute;
		top: 3px;
		right: 3px;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #b26a00;
		box-shadow: 0 0 0 1px rgb(255 255 255 / 0.55);
	}

	.text {
		flex: 1;
		min-width: 0;
	}

	.title {
		font-weight: 550;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sub {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.right {
		flex: none;
		display: grid;
		grid-template-columns: auto auto;
		align-items: center;
		justify-items: end;
		column-gap: 0.6rem;
		row-gap: 0.1rem;
	}

	.price {
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}

	.timing {
		grid-column: 1 / -1;
	}

	.status {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
		white-space: nowrap;
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

	.chev {
		flex: none;
		width: 2.25rem;
		border: 0;
		border-left: 1px solid var(--border);
		background: none;
		color: var(--muted);
		font-size: 1.1rem;
		cursor: pointer;
	}

	.chev:hover {
		color: var(--accent);
	}

	.detail {
		border: 1px solid var(--border);
		border-top: 0;
		border-bottom-left-radius: var(--radius);
		border-bottom-right-radius: var(--radius);
		background: var(--surface-2);
		padding: 0.5rem 0.7rem 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.75rem;
	}

	.detail-link {
		align-self: flex-start;
		margin-top: 0.2rem;
	}

	@media (max-width: 620px) {
		.right {
			grid-template-columns: auto;
			row-gap: 0.15rem;
		}

		.sub {
			display: none;
		}
	}
</style>
