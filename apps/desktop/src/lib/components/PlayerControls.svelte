<script lang="ts">
	import {
		isPaused,
		currentTime,
		duration,
		volume as volumeStore,
		speed as speedStore,
		progress,
		filename,
		brightness,
		contrast,
		saturation
	} from '$lib/stores/player';
	import { currentVideoTitle } from '$lib/stores/player-ui';
	import {
		togglePause,
		seek,
		seekAbsolute,
		setVolume,
		setSpeed,
		setMute,
		stopVideo,
		toggleFullscreen,
		setVideoAdjustment,
		resetVideoAdjustments
	} from '$lib/services/player-service';
	import {
		Play,
		Pause,
		SkipBack,
		SkipForward,
		Volume2,
		VolumeX,
		Square,
		Maximize,
		Minimize,
		SlidersHorizontal,
		ChevronUp,
		ChevronDown
	} from 'lucide-svelte';
	import { t } from '$lib/i18n';

	let isMuted = $state(false);
	let isFs = $state(false);
	let showAdjustments = $state(false);

	function formatTime(seconds: number | null): string {
		if (seconds == null || isNaN(seconds)) return '--:--';
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		const s = Math.floor(seconds % 60);
		if (h > 0) {
			return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
		}
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	function handleSeekInput(e: Event) {
		const target = e.target as HTMLInputElement;
		const pct = parseFloat(target.value);
		const dur = $duration;
		if (dur != null && dur > 0) {
			seekAbsolute(pct * dur);
		}
	}

	function handleVolumeInput(e: Event) {
		const target = e.target as HTMLInputElement;
		const vol = parseFloat(target.value);
		setVolume(vol);
	}

	function handleToggleMute() {
		isMuted = !isMuted;
		setMute(isMuted);
	}

	function handleSpeedChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		setSpeed(parseFloat(target.value));
	}

	function handleStop() {
		stopVideo();
	}

	async function handleFullscreen() {
		await toggleFullscreen();
		isFs = !isFs;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

		switch (e.key) {
			case ' ':
			case 'k':
				togglePause();
				e.preventDefault();
				break;
			case 'ArrowLeft':
				seek(-10);
				e.preventDefault();
				break;
			case 'ArrowRight':
				seek(10);
				e.preventDefault();
				break;
			case 'ArrowUp':
				setVolume(Math.min(($volumeStore ?? 100) + 5, 150));
				e.preventDefault();
				break;
			case 'ArrowDown':
				setVolume(Math.max(($volumeStore ?? 100) - 5, 0));
				e.preventDefault();
				break;
			case 'f':
				handleFullscreen();
				e.preventDefault();
				break;
			case 'm':
				handleToggleMute();
				e.preventDefault();
				break;
			case 'Escape':
				if (isFs) handleFullscreen();
				break;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="player-controls">
	<!-- Title -->
	<div class="title-row">
		<span class="video-title">{$currentVideoTitle ?? $filename ?? ''}</span>
	</div>

	<!-- Seek bar -->
	<div class="seek-row">
		<span class="time-label">{formatTime($currentTime)}</span>
		<input
			type="range"
			class="seek-slider"
			min="0"
			max="1"
			step="0.001"
			value={$progress}
			oninput={handleSeekInput}
		/>
		<span class="time-label">{formatTime($duration)}</span>
	</div>

	<!-- Inline adjustments panel (expandable, stays within controls area) -->
	{#if showAdjustments}
		<div class="adjustments-inline">
			<div class="adj-slider-row">
				<span class="adj-label">{$t['player.brightness']}</span>
				<input type="range" class="adj-slider" min="-100" max="100" step="1" value={$brightness} oninput={(e) => setVideoAdjustment('brightness', parseInt((e.target as HTMLInputElement).value))} />
				<span class="adj-value">{$brightness}</span>
			</div>
			<div class="adj-slider-row">
				<span class="adj-label">{$t['player.contrast']}</span>
				<input type="range" class="adj-slider" min="-100" max="100" step="1" value={$contrast} oninput={(e) => setVideoAdjustment('contrast', parseInt((e.target as HTMLInputElement).value))} />
				<span class="adj-value">{$contrast}</span>
			</div>
			<div class="adj-slider-row">
				<span class="adj-label">{$t['player.saturation']}</span>
				<input type="range" class="adj-slider" min="-100" max="100" step="1" value={$saturation} oninput={(e) => setVideoAdjustment('saturation', parseInt((e.target as HTMLInputElement).value))} />
				<span class="adj-value">{$saturation}</span>
			</div>
			<button class="adj-reset-btn" onclick={() => resetVideoAdjustments()}>{$t['player.reset']}</button>
		</div>
	{/if}

	<!-- Button row -->
	<div class="button-row">
		<div class="left-controls">
			<button class="ctrl-btn" onclick={() => seek(-10)} title={$t['player.rewind']}>
				<SkipBack size={18} strokeWidth={2} />
			</button>
			<button class="ctrl-btn play-btn" onclick={togglePause} title={$isPaused ? $t['player.play'] : $t['player.pause']}>
				{#if $isPaused}
					<Play size={22} strokeWidth={2} />
				{:else}
					<Pause size={22} strokeWidth={2} />
				{/if}
			</button>
			<button class="ctrl-btn" onclick={() => seek(10)} title={$t['player.forward']}>
				<SkipForward size={18} strokeWidth={2} />
			</button>
			<button class="ctrl-btn" onclick={handleStop} title={$t['player.stop']}>
				<Square size={16} strokeWidth={2} />
			</button>
		</div>

		<div class="right-controls">
			<!-- Speed -->
			<select class="speed-select" value={String($speedStore)} onchange={handleSpeedChange}>
				<option value="0.25">0.25x</option>
				<option value="0.5">0.5x</option>
				<option value="0.75">0.75x</option>
				<option value="1">1x</option>
				<option value="1.25">1.25x</option>
				<option value="1.5">1.5x</option>
				<option value="1.75">1.75x</option>
				<option value="2">2x</option>
			</select>

			<!-- Volume -->
			<button class="ctrl-btn" onclick={handleToggleMute} title={isMuted ? $t['player.unmute'] : $t['player.mute']}>
				{#if isMuted}
					<VolumeX size={18} strokeWidth={2} />
				{:else}
					<Volume2 size={18} strokeWidth={2} />
				{/if}
			</button>
			<input
				type="range"
				class="volume-slider"
				min="0"
				max="150"
				step="1"
				value={$volumeStore}
				oninput={handleVolumeInput}
			/>

			<!-- Video Adjustments toggle -->
			<button class="ctrl-btn" onclick={() => showAdjustments = !showAdjustments} title={$t['player.adjustments']}>
				<SlidersHorizontal size={18} strokeWidth={2} />
				{#if showAdjustments}
					<ChevronDown size={12} strokeWidth={2} />
				{:else}
					<ChevronUp size={12} strokeWidth={2} />
				{/if}
			</button>

			<!-- Fullscreen -->
			<button class="ctrl-btn" onclick={handleFullscreen} title={isFs ? $t['player.exitFullscreen'] : $t['player.fullscreen']}>
				{#if isFs}
					<Minimize size={18} strokeWidth={2} />
				{:else}
					<Maximize size={18} strokeWidth={2} />
				{/if}
			</button>
		</div>
	</div>
</div>

<style>
	.player-controls {
		flex-shrink: 0;
		background: var(--bg-secondary, #161b22);
		border-top: 1px solid var(--border);
		padding: 6px 16px 10px;
		border-radius: 0 0 8px 8px;
	}

	/* Title */
	.title-row {
		padding: 2px 0 4px;
		overflow: hidden;
	}

	.video-title {
		color: var(--text-primary);
		font-size: 0.8rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: block;
	}

	/* Seek bar */
	.seek-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 6px;
	}

	.time-label {
		color: var(--text-muted);
		font-size: 0.75rem;
		font-family: monospace;
		min-width: 50px;
		text-align: center;
	}

	.seek-slider {
		flex: 1;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: var(--bg-tertiary);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.seek-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--accent);
		cursor: pointer;
	}

	/* Inline adjustments (expands within controls, never behind mpv) */
	.adjustments-inline {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 6px 0;
		margin-bottom: 4px;
		border-top: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		flex-wrap: wrap;
	}

	.adj-slider-row {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		min-width: 160px;
	}

	.adj-label {
		color: var(--text-secondary);
		font-size: 0.72rem;
		min-width: 55px;
		white-space: nowrap;
	}

	.adj-slider {
		flex: 1;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: var(--bg-tertiary);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.adj-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--accent);
		cursor: pointer;
	}

	.adj-value {
		color: var(--text-muted);
		font-size: 0.68rem;
		font-family: monospace;
		min-width: 28px;
		text-align: right;
	}

	.adj-reset-btn {
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		color: var(--text-secondary);
		padding: 2px 10px;
		border-radius: 4px;
		font-size: 0.7rem;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.adj-reset-btn:hover {
		background: var(--border);
		color: var(--text-primary);
	}

	/* Button row */
	.button-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.left-controls, .right-controls {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.ctrl-btn {
		background: none;
		border: none;
		color: var(--text-primary);
		padding: 6px 8px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 2px;
		transition: background 0.15s;
	}

	.ctrl-btn:hover {
		background: var(--bg-tertiary);
	}

	.play-btn {
		padding: 8px 10px;
	}

	.speed-select {
		background: var(--bg-tertiary);
		color: var(--text-primary);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 3px 6px;
		font-size: 0.75rem;
		cursor: pointer;
		outline: none;
		max-width: 100px;
	}

	.volume-slider {
		width: 80px;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: var(--bg-tertiary);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.volume-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--text-primary);
		cursor: pointer;
	}
</style>
