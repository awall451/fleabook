<script lang="ts">
	import type { HeatCell } from '$lib/server/dashboard';

	let { heat, maxCents }: { heat: HeatCell[]; maxCents: number } = $props();

	const PITCH = 16; // cell 13px + 3px gap
	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	type Slot = { cell: HeatCell; level: number } | null;

	// Pad the front so the first column starts on Sunday, then chunk into weeks.
	let weeks = $derived.by(() => {
		if (heat.length === 0) return [] as Slot[][];
		const firstDow = new Date(heat[0].date + 'T00:00:00').getDay(); // 0=Sun
		const slots: Slot[] = Array.from({ length: firstDow }, () => null);
		for (const cell of heat) {
			const ratio = maxCents > 0 ? cell.cents / maxCents : 0;
			const level = cell.cents === 0 ? 0 : Math.min(4, Math.ceil(ratio * 4));
			slots.push({ cell, level });
		}
		const cols: Slot[][] = [];
		for (let i = 0; i < slots.length; i += 7) cols.push(slots.slice(i, i + 7));
		return cols;
	});

	// A month label sits above the first week that contains that month's first days.
	let monthLabels = $derived.by(() => {
		let last = -1;
		return weeks.map((week) => {
			const firstReal = week.find((s) => s !== null);
			if (!firstReal) return '';
			const m = new Date(firstReal.cell.date + 'T00:00:00').getMonth();
			if (m !== last) {
				last = m;
				return MONTHS[m];
			}
			return '';
		});
	});

	let hovered = $state<{ col: number; row: number; cell: HeatCell } | null>(null);

	function money(cents: number): string {
		return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
	}
	function longDate(iso: string): string {
		return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<div class="scroll">
	<div class="heat" style="--pitch: {PITCH}px">
		<div class="months" style="grid-template-columns: repeat({weeks.length}, {PITCH}px)">
			{#each monthLabels as label, i (i)}
				<span>{label}</span>
			{/each}
		</div>

		<div class="grid">
			{#each weeks as week, col (col)}
				<div class="week">
					{#each week as slot, row (row)}
						{#if slot === null}
							<div class="cell empty-slot"></div>
						{:else}
							<div
								class="cell lvl-{slot.level}"
								role="img"
								aria-label="{longDate(slot.cell.date)}: {money(slot.cell.cents)}"
								onmouseenter={() => (hovered = { col, row, cell: slot.cell })}
								onmouseleave={() => (hovered = null)}
							></div>
						{/if}
					{/each}
				</div>
			{/each}
		</div>

		{#if hovered}
			<div
				class="tip"
				style="left: {hovered.col * PITCH + PITCH / 2}px; top: {hovered.row * PITCH - 6}px"
			>
				<strong>{money(hovered.cell.cents)}</strong>
				<span class="muted">{longDate(hovered.cell.date)}</span>
				{#if hovered.cell.count > 0}
					<span class="muted">{hovered.cell.count} item{hovered.cell.count === 1 ? '' : 's'}</span>
				{/if}
			</div>
		{/if}
	</div>

	<div class="legend small muted">
		Less
		<span class="cell lvl-0"></span>
		<span class="cell lvl-1"></span>
		<span class="cell lvl-2"></span>
		<span class="cell lvl-3"></span>
		<span class="cell lvl-4"></span>
		More
	</div>
</div>

<style>
	/* Sequential ramp, supplied per theme (--heat-1..4 in app.css). Single hue,
	   light→dark by magnitude — the safe case for colorblind readers (magnitude
	   reads by lightness). */
	.heat {
		--empty: var(--surface-2);
		--g1: var(--heat-1, #9be9a8);
		--g2: var(--heat-2, #40c463);
		--g3: var(--heat-3, #2f9e4f);
		--g4: var(--heat-4, #1c6b34);
		position: relative;
		width: max-content;
	}

	.scroll {
		overflow-x: auto;
		padding-bottom: 0.25rem;
	}

	.months {
		display: grid;
		font-size: 0.68rem;
		color: var(--muted);
		height: 1rem;
		margin-bottom: 2px;
	}

	.months span {
		white-space: nowrap;
	}

	.grid {
		display: flex;
		gap: 3px;
	}

	.week {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.cell {
		width: 13px;
		height: 13px;
		border-radius: 3px;
		background: var(--empty);
	}

	.empty-slot {
		background: transparent;
	}

	.lvl-0 {
		background: var(--empty);
	}
	.lvl-1 {
		background: var(--g1);
	}
	.lvl-2 {
		background: var(--g2);
	}
	.lvl-3 {
		background: var(--g3);
	}
	.lvl-4 {
		background: var(--g4);
	}

	.cell[role='img']:hover {
		outline: 1px solid var(--text);
		outline-offset: -1px;
	}

	.tip {
		position: absolute;
		transform: translate(-50%, -100%);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.3rem 0.55rem;
		font-size: 0.75rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.05rem;
		white-space: nowrap;
		z-index: 5;
		pointer-events: none;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
	}

	.tip .muted {
		color: var(--muted);
	}

	.legend {
		display: flex;
		align-items: center;
		gap: 3px;
		margin-top: 0.6rem;
	}

	.legend .cell {
		width: 12px;
		height: 12px;
	}

	.legend {
		gap: 0.35rem;
	}
</style>
