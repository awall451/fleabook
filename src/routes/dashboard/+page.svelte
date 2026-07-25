<script lang="ts">
	import { enhance } from '$app/forms';
	import EarningsBars from '$lib/components/EarningsBars.svelte';
	import EarningsHeatmap from '$lib/components/EarningsHeatmap.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let d = $derived(data.dash);

	function dollars(cents: number): string {
		return `$${Math.round(cents / 100).toLocaleString()}`;
	}
	function money(cents: number): string {
		return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
	}

	let statusMax = $derived(Math.max(1, ...d.statusCounts.map((s) => s.count)));

	function relDate(ms: number): string {
		const days = Math.round((Date.now() - ms) / 86_400_000);
		if (days <= 0) return 'today';
		if (days === 1) return 'yesterday';
		if (days < 30) return `${days}d ago`;
		return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
</script>

<div class="head">
	<h1>Dashboard</h1>
	<form method="POST" use:enhance>
		{#if d.hasSample}
			<button class="ghost small" formaction="?/clearSample">Clear sample data</button>
		{:else}
			<button class="ghost small" formaction="?/sample">Load sample data</button>
		{/if}
	</form>
</div>

{#if d.hasSample}
	<p class="sample-note small">
		Showing sample data for visualization — it's hidden from your listings and removable above.
	</p>
{/if}

<!-- KPI tiles -->
<div class="tiles">
	<div class="tile hero">
		<div class="tlabel">Total earned</div>
		<div class="tvalue big">{dollars(d.totalEarnedCents)}</div>
		<div class="tsub muted small">{d.itemsSold} item{d.itemsSold === 1 ? '' : 's'} sold</div>
	</div>
	<div class="tile">
		<div class="tlabel">On the market</div>
		<div class="tvalue">{dollars(d.listedValueCents)}</div>
		<div class="tsub muted small">{d.activeCount} active listing{d.activeCount === 1 ? '' : 's'}</div>
	</div>
	<div class="tile">
		<div class="tlabel">Average sale</div>
		<div class="tvalue">{d.itemsSold > 0 ? dollars(d.avgSaleCents) : '—'}</div>
		<div class="tsub muted small">
			{d.avgDaysToSell != null ? `~${d.avgDaysToSell} days to sell` : 'no sales yet'}
		</div>
	</div>
	<div class="tile">
		<div class="tlabel">Best sale</div>
		<div class="tvalue">{d.bestSale ? dollars(d.bestSale.cents) : '—'}</div>
		<div class="tsub muted small truncate">{d.bestSale ? d.bestSale.title : '—'}</div>
	</div>
</div>

<!-- Monthly earnings -->
<section class="panel">
	<div class="panel-head">
		<h2>Monthly earnings</h2>
		<span class="muted small">last 12 months</span>
	</div>
	{#if d.itemsSold === 0}
		<p class="empty muted">No sales yet. Mark a listing sold — or load sample data to see this fill in.</p>
	{:else}
		<EarningsBars months={d.months} />
	{/if}
</section>

<!-- Heatmap -->
<section class="panel">
	<div class="panel-head">
		<h2>Selling streak</h2>
		<span class="muted small">earnings per day, last year</span>
	</div>
	<EarningsHeatmap heat={d.heat} maxCents={d.heatMaxCents} />
</section>

<div class="two-col">
	<!-- Status breakdown -->
	<section class="panel">
		<div class="panel-head"><h2>Listings by status</h2></div>
		<div class="statusbars">
			{#each d.statusCounts as s (s.status)}
				<div class="statusrow">
					<span class="sname">{s.status}</span>
					<div class="strack">
						<div class="sbar status-{s.status}" style="width: {(s.count / statusMax) * 100}%"></div>
					</div>
					<span class="scount">{s.count}</span>
				</div>
			{/each}
		</div>
	</section>

	<!-- Recent sales -->
	<section class="panel">
		<div class="panel-head"><h2>Recent sales</h2></div>
		{#if d.recent.length === 0}
			<p class="empty muted">Nothing sold yet.</p>
		{:else}
			<ul class="sales">
				{#each d.recent as sale (sale.id)}
					<li>
						<a href="/listing/{sale.id}" class="stitle">{sale.title}</a>
						<span class="samount">{money(sale.soldCents)}</span>
						<span class="swhen muted small">{relDate(sale.soldAt)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	h1 {
		margin: 0;
	}

	h2 {
		margin: 0;
		font-size: 1rem;
	}

	.ghost {
		background: transparent;
	}

	.sample-note {
		color: var(--warn);
		margin: 0.4rem 0 0;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		margin: 1.5rem 0;
	}

	@media (max-width: 760px) {
		.tiles {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.tile {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		padding: 0.9rem 1rem;
	}

	.tile.hero {
		background: linear-gradient(160deg, var(--surface-2), var(--surface));
		border-color: var(--accent);
	}

	.tlabel {
		font-size: 0.78rem;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.tvalue {
		font-size: 1.7rem;
		font-weight: 650;
		margin-top: 0.15rem;
	}

	.tvalue.big {
		font-size: 2.3rem;
		color: var(--ok);
	}

	.tsub {
		margin-top: 0.1rem;
	}

	.truncate {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.panel {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		padding: 1rem 1.15rem;
		margin-bottom: 1.25rem;
	}

	.panel-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.empty {
		padding: 1.5rem 0;
		text-align: center;
	}

	.two-col {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.25rem;
	}

	@media (max-width: 760px) {
		.two-col {
			grid-template-columns: 1fr;
		}
	}

	.statusbars {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.statusrow {
		display: grid;
		grid-template-columns: 5.5rem 1fr 2rem;
		align-items: center;
		gap: 0.6rem;
	}

	.sname {
		font-size: 0.82rem;
		color: var(--muted);
		text-transform: capitalize;
	}

	.strack {
		background: var(--surface-2);
		border-radius: 999px;
		height: 10px;
		overflow: hidden;
	}

	.sbar {
		height: 100%;
		background: var(--accent);
		border-radius: 999px;
		min-width: 3px;
	}

	.sbar.status-sold {
		background: var(--ok);
	}
	.sbar.status-posted {
		background: var(--accent);
	}
	.sbar.status-draft,
	.sbar.status-identified {
		background: var(--warn);
	}

	.scount {
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-size: 0.85rem;
	}

	.sales {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.sales li {
		display: grid;
		grid-template-columns: 1fr auto auto;
		align-items: baseline;
		gap: 0.6rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--border);
	}

	.sales li:last-child {
		border-bottom: none;
	}

	.stitle {
		text-decoration: none;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stitle:hover {
		color: var(--accent);
	}

	.samount {
		font-weight: 600;
		color: var(--ok);
		font-variant-numeric: tabular-nums;
	}
</style>
