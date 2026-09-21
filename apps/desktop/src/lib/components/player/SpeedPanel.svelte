<script lang="ts">
	import { speed } from '$lib/stores/player';
	import { setSpeed } from '$lib/services/player-service';
	import { t } from '$lib/i18n';

	const PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

	// mpv reports `speed` as a double, so compare with a tolerance instead of ===
	// (0.75 round-trips exactly today, but a future step of 1/3 would not).
	const isActive = (preset: number, current: number) => Math.abs(preset - current) < 0.001;
</script>

<div class="panel-body">
	<div class="grid">
		{#each PRESETS as preset (preset)}
			<button
				class="chip"
				class:active={isActive(preset, $speed)}
				onclick={() => setSpeed(preset)}
			>
				{preset}x
			</button>
		{/each}
	</div>
	<span class="hint">{$t['player.speedHint']}</span>
</div>

<style>
	.panel-body {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(56px, 1fr));
		gap: 6px;
	}

	.chip {
		background: var(--ov-chip);
		border: 1px solid var(--ov-chip-border);
		color: var(--ov-text);
		padding: 6px 4px;
		border-radius: 6px;
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}

	.chip:hover {
		background: var(--ov-chip-hover);
	}

	.chip.active {
		border-color: var(--accent);
		color: var(--accent);
	}

	.hint {
		color: var(--ov-text-dim);
		font-size: 0.72rem;
	}
</style>
