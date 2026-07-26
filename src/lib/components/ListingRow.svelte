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

	// The detail lines are assembled here rather than in markup so the separators
	// fall between the parts that actually exist — a row with no estimate and no
	// retail figure should not render a stranded "·".
	let priceLine = $derived.by(() => {
		const parts: string[] = [];
		if (listing.ai_price_basis === 'seller') {
			parts.push('priced by you — no research run');
		} else if (listing.ai_price_low != null && listing.ai_price_high != null) {
			parts.push(
				`est $${formatPrice(listing.ai_price_low)}–${formatPrice(listing.ai_price_high)}`
			);
			if (listing.ai_price_confidence) parts.push(`${listing.ai_price_confidence} confidence`);
		}
		if (listing.ai_msrp_cents) parts.push(`retail new $${formatPrice(listing.ai_msrp_cents)}`);
		return parts.length > 0 ? parts.join(' · ') : 'No price estimate yet';
	});

	let historyLine = $derived.by(() => {
		const parts: string[] = [];
		if (listing.status === 'sold' && listing.sold_at) {
			parts.push(
				`Sold ${agoLabel(listing.sold_at)}${
					listing.sold_price_cents != null ? ` for $${formatPrice(listing.sold_price_cents)}` : ''
				}`
			);
		} else if (listing.posted_at) {
			parts.push(`Posted ${agoLabel(listing.posted_at)}`);
			parts.push(`renewed ${listing.renewal_count} time${listing.renewal_count === 1 ? '' : 's'}`);
		} else {
			// Listings posted before the renewal clock existed have no posted_at, and
			// guessing one from updated_at would be wrong the moment the listing is
			// edited. Say so rather than showing an invented date.
			parts.push('Not posted yet, or posted before renewal tracking');
		}
		parts.push(`updated ${agoLabel(listing.updated_at)}`);
		return parts.join(' · ');
	});
</script>

<div class="card" class:expanded>
	<div class="row">
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
			<div class="facts">
				<div>{priceLine}</div>
				<div class="muted">{historyLine}</div>
			</div>
			<a class="go" href="/listing/{listing.id}">View listing →</a>
		</div>
	{/if}
</div>

<style>
	/* The row and its detail share one border. Butting two bordered boxes
	   together instead leaves a doubled seam that no amount of corner-squaring
	   hides — the card owns the outline, the parts inside own nothing. */
	.card {
		--thumb: 52px;
		--gutter: 0.6rem;
		--gap: 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	.card:hover {
		border-color: var(--accent);
	}

	.row {
		display: flex;
		align-items: stretch;
	}

	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--gap);
		padding: 0.5rem var(--gutter);
		text-decoration: none;
		color: inherit;
	}

	.thumb {
		position: relative;
		flex: none;
		width: var(--thumb);
		height: var(--thumb);
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

	/* Indented to where the title starts, so the detail reads as belonging to
	   this row rather than to the column of thumbnails. */
	.detail {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.2rem 1rem;
		border-top: 1px solid var(--border);
		background: var(--surface-2);
		padding: 0.45rem var(--gutter) 0.5rem
			calc(var(--gutter) + var(--thumb) + var(--gap));
	}

	.facts {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.go {
		flex: none;
		white-space: nowrap;
	}

	@media (max-width: 620px) {
		.right {
			grid-template-columns: auto;
			row-gap: 0.15rem;
		}

		.sub {
			display: none;
		}

		/* No room to indent past the thumbnail on a phone, and the alignment it
		   was buying is gone anyway once the row wraps. */
		.detail {
			padding-left: var(--gutter);
		}
	}
</style>
