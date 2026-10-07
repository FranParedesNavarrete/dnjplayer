<script lang="ts">
	import { brightness, contrast, saturation, gamma } from '$lib/stores/player';
	import { setVideoAdjustment, resetVideoAdjustments } from '$lib/services/player-service';
	import { t } from '$lib/i18n';

	// Image adjustments are cheap mpv property writes (no demuxer work), so these
	// can stay live on `oninput` — unlike seeking, which is committed on release.
	function apply(property: 'brightness' | 'contrast' | 'saturation' | 'gamma', e: Event) {
		const value = parseInt((e.target as HTMLInputElement).value, 10);
		setVideoAdjustment(property, value);
	}
</script>

<div class="panel-body">
	<div class="row">
		<span class="label">{$t['player.brightness']}</span>
		<input
			type="range"
			min="-100"
			max="100"
			step="1"
			value={$brightness}
			oninput={(e) => apply('brightness', e)}
		/>
		<span class="value">{$brightness}</span>
	</div>
	<div class="row">
		<span class="label">{$t['player.contrast']}</span>
		<input
			type="range"
			min="-100"
			max="100"
			step="1"
			value={$contrast}
			oninput={(e) => apply('contrast', e)}
		/>
		<span class="value">{$contrast}</span>
	</div>
	<div class="row">
		<span class="label">{$t['player.saturation']}</span>
		<input
			type="range"
			min="-100"
			max="100"
			step="1"
			value={$saturation}
			oninput={(e) => apply('saturation', e)}
		/>
		<span class="value">{$saturation}</span>
	</div>
	<div class="row">
		<span class="label">{$t['player.gamma']}</span>
		<input
			type="range"
			min="-100"
			max="100"
			step="1"
			value={$gamma}
			oninput={(e) => apply('gamma', e)}
		/>
		<span class="value">{$gamma}</span>
	</div>
	<button class="panel-action" onclick={() => resetVideoAdjustments()}>{$t['player.reset']}</button>
</div>

<style>
	.panel-body {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.label {
		color: var(--ov-text-dim);
		font-size: 0.78rem;
		min-width: 74px;
		white-space: nowrap;
	}

	.value {
		color: var(--ov-text-dim);
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		min-width: 30px;
		text-align: right;
	}

	input[type='range'] {
		flex: 1;
		min-width: 130px;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: var(--ov-rail);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--accent);
		cursor: pointer;
	}

	.panel-action {
		align-self: flex-start;
		background: var(--ov-chip);
		border: 1px solid var(--ov-chip-border);
		color: var(--ov-text);
		padding: 5px 12px;
		border-radius: 6px;
		font-size: 0.76rem;
		cursor: pointer;
		transition: background 0.15s;
	}

	.panel-action:hover {
		background: var(--ov-chip-hover);
	}
</style>
