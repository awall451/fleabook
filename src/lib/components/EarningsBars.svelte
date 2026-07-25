<script lang="ts">
	import type { MonthEarning } from '$lib/server/dashboard';

	let { months }: { months: MonthEarning[] } = $props();

	let max = $derived(Math.max(1, ...months.map((m) => m.cents)));
	let hovered = $state<number | null>(null);

	function dollars(cents: number): string {
		return `$${Math.round(cents / 100).toLocaleString()}`;
	}
</script>

<div class="chart">
	<div class="bars" role="list">
		{#each months as month, i (month.key)}
			<div
				class="col"
				role="listitem"
				onmouseenter={() => (hovered = i)}
				onmouseleave={() => (hovered = null)}
			>
				{#if hovered === i}
					<div class="tip">
						<strong>{dollars(month.cents)}</strong>
						<span class="muted">{month.count} sold</span>
					</div>
				{/if}
				<div class="track">
					<div
						class="bar"
						class:zero={month.cents === 0}
						style="height: {month.cents === 0 ? 0 : Math.max(3, (month.cents / max) * 100)}%"
					></div>
				</div>
				<div class="xlabel" class:now={i === months.length - 1}>{month.label}</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.chart {
		--bar: var(--accent);
	}

	.bars {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		height: 190px;
	}

	.col {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		height: 100%;
		position: relative;
	}

	.track {
		flex: 1;
		display: flex;
		align-items: flex-end;
	}

	.bar {
		width: 100%;
		background: var(--bar);
		border-radius: 4px 4px 0 0;
		min-height: 0;
		transition: filter 0.12s;
	}

	.col:hover .bar:not(.zero) {
		filter: brightness(1.15);
	}

	.bar.zero {
		height: 2px !important;
		background: var(--border);
		border-radius: 2px;
	}

	.xlabel {
		text-align: center;
		font-size: 0.7rem;
		color: var(--muted);
		margin-top: 0.35rem;
		white-space: nowrap;
	}

	.xlabel.now {
		color: var(--text);
		font-weight: 600;
	}

	.tip {
		position: absolute;
		bottom: calc(100% + 4px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.05rem;
		white-space: nowrap;
		z-index: 3;
		pointer-events: none;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
	}

	.tip .muted {
		color: var(--muted);
	}
</style>
