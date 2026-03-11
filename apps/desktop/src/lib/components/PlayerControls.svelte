<script lang="ts">
	import {
		isPaused,
		currentTime,
		duration,
		volume as volumeStore,
		speed as speedStore,
		progress,
		filename,
		subtitleTracks,
		currentSubtitleId
	} from '$lib/stores/player';
	import { currentVideoTitle, showControls } from '$lib/stores/player-ui';
	import {
		togglePause,
		seek,
		seekAbsolute,
		setVolume,
		setSpeed,
		setMute,
		stopVideo,
		toggleFullscreen,
		setSubtitleTrack
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
		Captions
	} from 'lucide-svelte';

	let isMuted = $state(false);
	let isFs = $state(false);
	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	let controlsVisible = $state(true);

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

	function handleSubtitleChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		setSubtitleTrack(parseInt(target.value, 10));
	}

	function handleMouseMove() {
		controlsVisible = true;
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			if (!$isPaused) controlsVisible = false;
		}, 3000);
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="controls-overlay"
	class:visible={controlsVisible || $isPaused}
	onmousemove={handleMouseMove}
>
	<!-- Title bar -->
	<div class="title-bar">
		<span class="video-title">{$currentVideoTitle ?? $filename ?? ''}</span>
	</div>

	<!-- Bottom controls -->
	<div class="controls-bar">
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

		<!-- Button row -->
		<div class="button-row">
			<div class="left-controls">
				<button class="ctrl-btn" onclick={() => seek(-10)} title="Rewind 10s">
					<SkipBack size={18} strokeWidth={2} />
				</button>
				<button class="ctrl-btn play-btn" onclick={togglePause} title={$isPaused ? 'Play' : 'Pause'}>
					{#if $isPaused}
						<Play size={22} strokeWidth={2} />
					{:else}
						<Pause size={22} strokeWidth={2} />
					{/if}
				</button>
				<button class="ctrl-btn" onclick={() => seek(10)} title="Forward 10s">
					<SkipForward size={18} strokeWidth={2} />
				</button>
				<button class="ctrl-btn" onclick={handleStop} title="Stop">
					<Square size={16} strokeWidth={2} />
				</button>
			</div>

			<div class="right-controls">
				<!-- Subtitles -->
				{#if $subtitleTracks.length > 0}
					<select class="subtitle-select" value={String($currentSubtitleId)} onchange={handleSubtitleChange} title="Subtitles">
						<option value="0">Subs Off</option>
						{#each $subtitleTracks as track}
							<option value={String(track.id)}>{track.title || track.lang || `Track ${track.id}`}</option>
						{/each}
					</select>
				{/if}

				<!-- Speed -->
				<select class="speed-select" value={String($speedStore)} onchange={handleSpeedChange}>
					<option value="0.25">0.25x</option>
					<option value="0.5">0.5x</option>
					<option value="0.75">0.75x</option>
					<option value="1">1x</option>
					<option value="1.25">1.25x</option>
					<option value="1.5">1.5x</option>
					<option value="2">2x</option>
				</select>

				<!-- Volume -->
				<button class="ctrl-btn" onclick={handleToggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
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

				<!-- Fullscreen -->
				<button class="ctrl-btn" onclick={handleFullscreen} title={isFs ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}>
					{#if isFs}
						<Minimize size={18} strokeWidth={2} />
					{:else}
						<Maximize size={18} strokeWidth={2} />
					{/if}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	.controls-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.3s ease;
		z-index: 10;
	}

	.controls-overlay.visible {
		opacity: 1;
	}

	.controls-overlay > * {
		pointer-events: auto;
	}

	/* Title bar */
	.title-bar {
		padding: 12px 16px;
		background: linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%);
	}

	.video-title {
		color: #fff;
		font-size: 0.9rem;
		font-weight: 500;
		text-shadow: 0 1px 3px rgba(0,0,0,0.5);
	}

	/* Bottom controls */
	.controls-bar {
		padding: 8px 16px 12px;
		background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%);
	}

	.seek-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 8px;
	}

	.time-label {
		color: rgba(255,255,255,0.8);
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
		background: rgba(255,255,255,0.2);
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
		color: rgba(255,255,255,0.9);
		padding: 6px 8px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
	}

	.ctrl-btn:hover {
		background: rgba(255,255,255,0.15);
	}

	.play-btn {
		padding: 8px 10px;
	}

	.speed-select,
	.subtitle-select {
		background: rgba(255,255,255,0.1);
		color: rgba(255,255,255,0.9);
		border: 1px solid rgba(255,255,255,0.2);
		border-radius: 4px;
		padding: 3px 6px;
		font-size: 0.75rem;
		cursor: pointer;
		outline: none;
	}

	.subtitle-select {
		max-width: 120px;
	}

	.volume-slider {
		width: 80px;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: rgba(255,255,255,0.2);
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
		background: #fff;
		cursor: pointer;
	}
</style>
