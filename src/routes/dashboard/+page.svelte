<script lang="ts">
	import { enhance } from '$app/forms';
	import EarningsBars from '$lib/components/EarningsBars.svelte';
	import EarningsHeatmap from '$lib/components/EarningsHeatmap.svelte';
	import TokenBars from '$lib/components/TokenBars.svelte';
	import { compactTokens, duration } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let d = $derived(data.dash);
	let u = $derived(data.usage);

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
	{#if data.renewalDue > 0}
		<!-- Only appears when there is something to do. The badge on the listing
		     tile is the primary surface; this is the count at a glance. -->
		<a class="tile due" href="/?status=posted">
			<div class="tlabel">Needs renewal</div>
			<div class="tvalue">{data.renewalDue}</div>
			<div class="tsub muted small">listing{data.renewalDue === 1 ? '' : 's'} past due</div>
		</a>
	{/if}
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

<!-- What the agent spent getting those listings written -->
<section class="panel">
	<div class="panel-head">
		<h2>Agent usage</h2>
		<span class="muted small">tokens across identify and pricing</span>
	</div>

	{#if !u.hasRuns}
		<p class="empty muted">
			No agent runs recorded yet. Generate a listing and its token usage shows up here.
		</p>
	{:else}
		<div class="tiles inner">
			<div class="tile">
				<div class="tlabel">Total tokens</div>
				<div class="tvalue">{compactTokens(u.total.totalTokens)}</div>
				<div class="tsub muted small">
					{compactTokens(u.total.inputTokens + u.total.cacheCreationTokens + u.total.cacheReadTokens)}
					in · {compactTokens(u.total.outputTokens)} out
				</div>
			</div>
			<div class="tile">
				<div class="tlabel">Runs</div>
				<div class="tvalue">{u.total.runs}</div>
				<div class="tsub muted small">
					across {u.listings} listing{u.listings === 1 ? '' : 's'}
				</div>
			</div>
			<div class="tile">
				<div class="tlabel">Per listing</div>
				<div class="tvalue">{compactTokens(u.avgTokensPerListing)}</div>
				<div class="tsub muted small">tokens on average</div>
			</div>
			<div class="tile">
				<div class="tlabel">{u.costKind === 'billed' ? 'API cost' : 'Token value'}</div>
				<div class="tvalue">${u.total.costUsd.toFixed(2)}</div>
				<div class="tsub muted small">
					{#if u.costKind === 'mixed'}
						${u.total.billedCostUsd.toFixed(2)} of it actually billed
					{:else if u.costKind === 'billed'}
						billed to your API key
					{:else}
						at API rates — covered by your plan
					{/if}
				</div>
			</div>
			{#if u.total.failed > 0}
				<div class="tile">
					<div class="tlabel">Failed runs</div>
					<div class="tvalue">{u.total.failed}</div>
					<div class="tsub muted small">
						{Math.round((u.total.failed / u.total.runs) * 100)}% of runs
					</div>
				</div>
			{/if}
		</div>

		{#if u.costKind === 'estimated'}
			<p class="muted small note">
				These runs went through your Claude subscription, so that figure is what the tokens would
				have priced at on API rates — not a charge. Nothing here was billed to you separately.
			</p>
		{:else if u.costKind === 'mixed'}
			<p class="muted small note">
				Some of this history ran on a Claude subscription and some on an API key. Only the
				API-key portion was a real charge; the rest is what those tokens would have priced at.
			</p>
		{/if}

		<TokenBars months={u.months} />

		<div class="stages">
			{#each u.stages.filter((s) => s.runs > 0) as stage (stage.stage)}
				<div class="stage">
					<div class="srow">
						<span class="sname">{stage.stage}</span>
						<span class="small muted">
							{compactTokens(stage.totalTokens)} · {stage.runs} run{stage.runs === 1 ? '' : 's'} ·
							~{duration(stage.avgDurationMs)} each
						</span>
					</div>
					<div class="strack">
						<div
							class="sbar"
							style="width: {u.total.totalTokens > 0
								? (stage.totalTokens / u.total.totalTokens) * 100
								: 0}%"
						></div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Itemization. The totals above say what was spent; only this says what it
		     was spent on — including listings that no longer exist, which is spend
		     with nothing to show for it and the most worth seeing. -->
		<div class="items">
			<div class="irow ihead small muted">
				<span>Listing</span>
				<span class="num">Runs</span>
				<span class="num">Tokens</span>
				<span class="num">{u.costKind === 'billed' ? 'Cost' : 'Value'}</span>
			</div>
			{#each u.byListing as item (item.listingId)}
				<div class="irow" class:gone={!item.exists}>
					<span class="ititle">
						{#if item.exists}
							<a href="/listing/{item.listingId}">{item.title}</a>
						{:else}
							{item.title}
						{/if}
						{#if !item.exists}<span class="tag">deleted</span>{/if}
						{#if item.isSample}<span class="tag">sample</span>{/if}
						{#if item.failed > 0}<span class="tag fail">{item.failed} failed</span>{/if}
					</span>
					<span class="num small">{item.runs}</span>
					<span class="num small">{compactTokens(item.totalTokens)}</span>
					<span class="num small">${item.costUsd.toFixed(2)}</span>
				</div>
			{/each}
		</div>

		{#if u.deleted.runs > 0}
			<p class="muted small note deleted-note">
				${u.deleted.costUsd.toFixed(2)} of that — {compactTokens(u.deleted.totalTokens)} across
				{u.deleted.runs} run{u.deleted.runs === 1 ? '' : 's'} — went on listings you have since
				deleted. Their spend is kept deliberately; deleting a listing does not un-spend it.
			</p>
		{/if}
	{/if}
</section>

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

	/* auto-fit rather than a fixed 4: the renewal tile only appears when something
	   is due, and a fixed track count would strand it alone on a second row. */
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 1rem;
		margin: 1.5rem 0;
	}

	.tiles.inner {
		margin: 0 0 1.25rem;
	}

	.tile.due {
		display: block;
		text-decoration: none;
		color: inherit;
		border-color: var(--warn);
	}

	.tile.due:hover {
		background: var(--surface-2);
	}

	.note {
		margin: 0 0 1rem;
		line-height: 1.5;
		max-width: 68ch;
	}

	.stages {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 1.25rem;
	}

	.srow {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 0.25rem;
	}

	.stages .sbar {
		background: var(--warn);
	}

	.items {
		margin-top: 1.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	.irow {
		display: grid;
		grid-template-columns: 1fr auto auto auto;
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.45rem 0.75rem;
		border-top: 1px solid var(--border);
	}

	.irow:first-child {
		border-top: 0;
	}

	.ihead {
		background: var(--surface-2);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.irow .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		min-width: 3.5rem;
	}

	/* Still legible — a deleted listing's cost is the number you most want to
	   read — but visibly not something you can click through to. */
	.irow.gone .ititle {
		color: var(--muted);
	}

	.ititle {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tag {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0 0.4rem;
		margin-left: 0.35rem;
		color: var(--muted);
	}

	.tag.fail {
		color: var(--danger);
		border-color: var(--danger);
	}

	.deleted-note {
		margin-top: 0.75rem;
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
