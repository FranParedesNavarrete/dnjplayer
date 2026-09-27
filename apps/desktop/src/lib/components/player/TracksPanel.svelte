<script lang="ts">
	import { audioTracks, subtitleTracks, currentAid, currentSid } from '$lib/stores/player';
	import { setAudioTrack, setSubtitleTrack, addExternalSubtitle } from '$lib/services/player-service';
	import { localPickSubtitle } from '$lib/services/local-service';
	import { language } from '$lib/stores/settings';
	import { trackLabel } from '$lib/utils/track-labels';
	import { t } from '$lib/i18n';

	// The subtitle delay lives in PlayerOverlay because the G/H shortcuts drive it
	// too; the panel only renders it and reports the steps it wants applied.
	let {
		subtitleDelayMs = 0,
		onAdjustDelay,
		onResetDelay,
	}: {
		subtitleDelayMs?: number;
		onAdjustDelay: (deltaMs: number) => void;
		onResetDelay: () => void;
	} = $props();

	// mpv's aid/sid can be null (unknown / mpv decides), so fall back to whichever
	// track mpv reported as selected. Values are strings to match <option value>.
	let audioValue = $derived(
		$currentAid != null
			? String($currentAid)
			: String($audioTracks.find((track) => track.selected)?.id ?? ''),
	);
	let subtitleValue = $derived(
		$currentSid != null
			? String($currentSid)
			: String($subtitleTracks.find((track) => track.selected)?.id ?? 'no'),
	);

	let hasTrackChoices = $derived($audioTracks.length > 1 || $subtitleTracks.length > 0);

	function handleAudioChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value;
		setAudioTrack(value === 'no' ? 'no' : parseInt(value, 10));
	}

	function handleSubtitleChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value;
		setSubtitleTrack(value === 'no' ? 'no' : parseInt(value, 10));
	}

	async function handleLoadSubtitle() {
		const path = await localPickSubtitle();
		if (path) await addExternalSubtitle(path);
	}
</script>

<div class="panel-body">
	{#if $audioTracks.length > 1}
		<div class="row">
			<span class="label">{$t['player.audioTrack']}</span>
			<select value={audioValue} onchange={handleAudioChange}>
				{#each $audioTracks as track (track.id)}
					<option value={String(track.id)}>
						{trackLabel(track, $language, $t['player.trackUnnamed'])}
					</option>
				{/each}
			</select>
		</div>
	{/if}

	{#if $subtitleTracks.length > 0}
		<div class="row">
			<span class="label">{$t['player.subtitleTrack']}</span>
			<select value={subtitleValue} onchange={handleSubtitleChange}>
				<option value="no">{$t['player.subtitlesOff']}</option>
				{#each $subtitleTracks as track (track.id)}
					<option value={String(track.id)}>
						{trackLabel(track, $language, $t['player.trackUnnamed'])}
					</option>
				{/each}
			</select>
		</div>
	{/if}

	{#if !hasTrackChoices}
		<span class="empty">{$t['player.noTracks']}</span>
	{/if}

	<div class="row">
		<span class="label">{$t['player.subtitleDelay']}</span>
		<div class="stepper">
			<button class="chip" onclick={() => onAdjustDelay(-100)} title="G">-100 ms</button>
			<span class="value">{subtitleDelayMs > 0 ? '+' : ''}{subtitleDelayMs} ms</span>
			<button class="chip" onclick={() => onAdjustDelay(100)} title="H">+100 ms</button>
			<button class="chip" onclick={onResetDelay}>{$t['player.reset']}</button>
		</div>
	</div>

	<button class="panel-action" onclick={handleLoadSubtitle}>{$t['player.loadSubtitles']}</button>
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
		min-width: 110px;
		white-space: nowrap;
	}

	/* Native <select> popups are OS-level windows, so they are the one kind of
	   popup that is visible on Windows too, where mpv paints over the webview. */
	select {
		flex: 1;
		min-width: 0;
		max-width: 320px;
		background: var(--ov-chip);
		color: var(--ov-text);
		border: 1px solid var(--ov-chip-border);
		border-radius: 6px;
		padding: 4px 8px;
		font-size: 0.78rem;
		cursor: pointer;
		outline: none;
		text-overflow: ellipsis;
	}

	.stepper {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.value {
		color: var(--ov-text);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		min-width: 64px;
		text-align: center;
	}

	.chip,
	.panel-action {
		background: var(--ov-chip);
		border: 1px solid var(--ov-chip-border);
		color: var(--ov-text);
		border-radius: 6px;
		font-size: 0.75rem;
		cursor: pointer;
		transition: background 0.15s;
	}

	.chip {
		padding: 4px 8px;
	}

	.panel-action {
		align-self: flex-start;
		padding: 5px 12px;
		font-size: 0.76rem;
	}

	.chip:hover,
	.panel-action:hover {
		background: var(--ov-chip-hover);
	}

	.empty {
		color: var(--ov-text-dim);
		font-size: 0.78rem;
		font-style: italic;
	}
</style>
