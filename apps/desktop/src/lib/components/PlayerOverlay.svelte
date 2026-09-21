<script lang="ts">
	import { onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import {
		isPaused,
		currentTime,
		duration,
		volume as volumeStore,
		speed as speedStore,
		filename,
		brightness,
		contrast,
		saturation,
		audioTracks,
		subtitleTracks,
		osdMessage,
		isMuted,
		bufferedUntil,
	} from '$lib/stores/player';
	import {
		currentVideoTitle,
		currentVideoUrl,
		playlist,
		playlistIndex,
		playerActive,
		playerFullscreen,
		playbackError,
		controlsPinned,
		controlsVisible,
		uiActivityTick,
		pokeUiActivity,
		chromeOverVideo,
	} from '$lib/stores/player-ui';
	import { defaultShaderMode, defaultShaderVariant, controlsHideDelay } from '$lib/stores/settings';
	import {
		togglePause,
		seek,
		setVolume,
		setSpeed,
		setMute,
		stopVideo,
		toggleFullscreen,
		setVideoAdjustment,
		resetVideoAdjustments,
		loadShaderPreset,
		playNext,
		playPrev,
		checkAutoAdvance,
		cycleAudioTrack,
		cycleSubtitleTrack,
		setSubtitleDelay,
	} from '$lib/services/player-service';
	import SeekBar from './player/SeekBar.svelte';
	import TracksPanel from './player/TracksPanel.svelte';
	import SpeedPanel from './player/SpeedPanel.svelte';
	import VideoPanel from './player/VideoPanel.svelte';
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
		// Canonical name in lucide-svelte 0.577; `Subtitles` is only a deprecated
		// alias for this same icon and could be dropped in a future major.
		Captions,
		Gauge,
		ChevronLeft,
		RotateCcw,
		RotateCw,
		X,
	} from 'lucide-svelte';
	import { t } from '$lib/i18n';
	import type { ShaderMode } from '$lib/types/player';

	// The "loaded up to here" bar reads mpv's demuxer cache directly (Phase 3):
	// `bufferedUntil` is an absolute timeline position, which is what SeekBar wants.

	// --- Auto-hide -----------------------------------------------------------

	// Netflix/Nuvio timing (`controls.js:450`, Compose `PlayerScreenRuntimeEffects
	// .kt:366`). The user setting only keeps its "never hide" escape hatch (0);
	// every other stored value is superseded by this Netflix-style delay.
	const AUTO_HIDE_MS = 3500;
	// Hold threshold before Space turns into a 2x boost instead of play/pause.
	const SPEED_BOOST_HOLD_MS = 220;
	const SPEED_BOOST_RATE = 2;

	type Panel = 'none' | 'tracks' | 'speed' | 'video';
	let panel = $state<Panel>('none');

	let pointerInTop = $state(false);
	let pointerInBottom = $state(false);
	let scrubbing = $state(false);

	// Honour the user's setting. Netflix-style chrome wants ~3.5 s, but Settings
	// offers 5/10/15/30/60 s and "Never", and a setting that silently does nothing
	// is worse than no setting at all. AUTO_HIDE_MS is only the fallback for a
	// missing/invalid stored value; 0 still means "never hide".
	let hideDelay = $derived($controlsHideDelay ?? AUTO_HIDE_MS);

	// Nuvio's desktop predicate (`canAutoHideChrome`, controls.js:2103): visible,
	// not scrubbing, pointer not over the chrome, no modal open, no visible error.
	// `controlsPinned` is our name for "a panel is open". Note that, like Nuvio's
	// desktop path, playing/paused is NOT part of it: the chrome hides while paused.
	let canAutoHide = $derived(
		$playerActive &&
			hideDelay > 0 &&
			!scrubbing &&
			!pointerInTop &&
			!pointerInBottom &&
			!$controlsPinned &&
			!$playbackError,
	);

	// Composite reschedule key (Nuvio's `currentChromeAutoHideKey`). The countdown
	// is re-armed only when this string changes, so a state that is identical to
	// the previous one can never restart it — which a mutable deadline variable
	// cannot express inside an $effect.
	let autoHideKey = $derived(
		[
			canAutoHide ? '1' : '0',
			$controlsVisible ? '1' : '0',
			hideDelay,
			$uiActivityTick,
		].join(':'),
	);

	$effect(() => {
		// Deliberately the effect's ONLY reactive dependency: everything it needs
		// is encoded in the key, so nothing else can re-trigger the countdown.
		const [hideable, visible, delay] = autoHideKey.split(':');
		if (hideable !== '1' || visible !== '1') return;
		const timer = setTimeout(() => controlsVisible.set(false), Number(delay));
		return () => clearTimeout(timer);
	});

	// An open panel pins the chrome open (CLAUDE.md #2: mpv swallows clicks over
	// the video, so a panel that collapsed under the cursor would be unrecoverable).
	$effect(() => {
		controlsPinned.set(panel !== 'none');
	});

	// Auto-advance to the next item when the current video ends.
	$effect(() => {
		checkAutoAdvance($currentTime, $duration);
	});

	// A new file invalidates the subtitle delay we are tracking locally.
	$effect(() => {
		$currentVideoUrl;
		subtitleDelayMs = 0;
	});

	onDestroy(() => {
		controlsPinned.set(false);
		controlsVisible.set(true);
		if (spaceHoldTimer) clearTimeout(spaceHoldTimer);
		if (pauseReconcileTimer) clearTimeout(pauseReconcileTimer);
	});

	function togglePanel(next: Panel) {
		panel = panel === next ? 'none' : next;
		pokeUiActivity();
	}

	// --- Optimistic play/pause ----------------------------------------------

	// Nuvio (`controls.js:2327-2348`): paint the new state immediately, then fall
	// back to mpv's truth if it hasn't confirmed within 1.5 s. Over WebDAV the
	// round-trip can take a few hundred ms and the button would otherwise feel dead.
	const PAUSE_RECONCILE_MS = 1500;
	let optimisticPaused = $state<boolean | null>(null);
	let pauseReconcileTimer: ReturnType<typeof setTimeout> | null = null;

	let displayPaused = $derived(optimisticPaused ?? $isPaused);

	function handleTogglePause() {
		const next = !displayPaused;
		optimisticPaused = next;
		if (pauseReconcileTimer) clearTimeout(pauseReconcileTimer);
		pauseReconcileTimer = setTimeout(() => {
			// mpv never confirmed — drop the optimistic value and show the truth.
			optimisticPaused = null;
			pauseReconcileTimer = null;
		}, PAUSE_RECONCILE_MS);
		togglePause();
		pokeUiActivity();
	}

	// Reconcile as soon as mpv agrees. Written as a store subscription rather than
	// an $effect so it never re-runs on its own writes.
	const unsubscribePaused = isPaused.subscribe((paused) => {
		if (optimisticPaused === null || optimisticPaused !== paused) return;
		optimisticPaused = null;
		if (pauseReconcileTimer) {
			clearTimeout(pauseReconcileTimer);
			pauseReconcileTimer = null;
		}
	});
	onDestroy(unsubscribePaused);

	// --- Misc actions --------------------------------------------------------

	let hasPrev = $derived($playlistIndex > 0);
	let hasNext = $derived($playlistIndex < $playlist.length - 1);
	let hasTrackChoices = $derived($audioTracks.length > 1 || $subtitleTracks.length > 0);
	// `isMuted` is the observed mpv `mute` property (Phase 3), not local state:
	// mpv can change it on its own and a local flag would drift out of sync.
	function handleToggleMute() {
		setMute(!$isMuted);
	}

	function handleVolumeInput(e: Event) {
		setVolume(parseFloat((e.target as HTMLInputElement).value));
	}

	function handleBack() {
		// Non-destructive: leaving the player page keeps playback alive, exactly
		// like clicking another sidebar entry does. Stopping is the Stop button.
		if (window.history.length > 1) window.history.back();
	}

	async function switchShaderMode(mode: ShaderMode) {
		defaultShaderMode.set(mode);
		await loadShaderPreset(mode, get(defaultShaderVariant));
	}

	// --- Subtitle delay ------------------------------------------------------

	// mpv's `sub-delay` is in seconds and we never read it back, so the current
	// value is tracked here and reset on every file change.
	let subtitleDelayMs = $state(0);

	function applySubtitleDelay(ms: number) {
		subtitleDelayMs = ms;
		setSubtitleDelay(ms);
		osdMessage.set($t['player.osd.subDelay'].replace('{value}', String(ms)));
	}

	const adjustSubtitleDelay = (deltaMs: number) => applySubtitleDelay(subtitleDelayMs + deltaMs);
	const resetSubtitleDelay = () => applySubtitleDelay(0);

	// --- Keyboard ------------------------------------------------------------

	let spaceHoldTimer: ReturnType<typeof setTimeout> | null = null;
	let spaceDown = false;
	let speedBeforeBoost: number | null = null;

	function isTextEntryTarget(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement
		);
	}

	function endSpeedBoost() {
		if (spaceHoldTimer) {
			clearTimeout(spaceHoldTimer);
			spaceHoldTimer = null;
		}
		if (speedBeforeBoost == null) return false;
		setSpeed(speedBeforeBoost);
		speedBeforeBoost = null;
		return true;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (isTextEntryTarget(e.target)) return;
		// Shift is part of several shortcuts ('!', fine seek); the other modifiers
		// belong to the OS and the app menu (Cmd+R must not reset the image).
		if (e.ctrlKey || e.metaKey || e.altKey) return;

		// Letters are matched case-insensitively so Caps Lock / Shift+J still work.
		const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
		const fine = e.shiftKey;

		switch (key) {
			case ' ':
				e.preventDefault();
				// Auto-repeat must not re-arm the hold timer.
				if (spaceDown) return;
				spaceDown = true;
				spaceHoldTimer = setTimeout(() => {
					spaceHoldTimer = null;
					speedBeforeBoost = get(speedStore) ?? 1;
					setSpeed(SPEED_BOOST_RATE);
					osdMessage.set(
						$t['player.osd.speedBoost'].replace('{value}', String(SPEED_BOOST_RATE)),
					);
				}, SPEED_BOOST_HOLD_MS);
				break;
			case 'k':
				handleTogglePause();
				e.preventDefault();
				break;

			// Seeking. Shift makes it a fine ±1 s step (Nuvio `controls.js:2361`).
			case 'ArrowLeft':
			case 'j':
				seek(fine ? -1 : -10);
				e.preventDefault();
				break;
			case 'ArrowRight':
			case 'l':
				seek(fine ? 1 : 10);
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
				toggleFullscreen();
				e.preventDefault();
				break;
			case 'm':
				handleToggleMute();
				e.preventDefault();
				break;
			case 'n':
				if (hasNext) playNext();
				e.preventDefault();
				break;
			case 'p':
				if (hasPrev) playPrev();
				e.preventDefault();
				break;
			case 'Escape':
				// Nuvio's order: close what's open first, only then leave fullscreen.
				if (panel !== 'none') panel = 'none';
				else if ($playerFullscreen) toggleFullscreen();
				break;

			// Track cycling (both paint their own OSD message)
			case 'a':
				cycleAudioTrack();
				e.preventDefault();
				break;
			case 's':
				cycleSubtitleTrack();
				e.preventDefault();
				break;

			// Subtitle delay: G / H (Nuvio `controls.js:3554-3563`)
			case 'g':
				adjustSubtitleDelay(-100);
				e.preventDefault();
				break;
			case 'h':
				adjustSubtitleDelay(100);
				e.preventDefault();
				break;

			// Contrast: 1 / 2
			case '1':
				setVideoAdjustment('contrast', Math.max($contrast - 5, -100));
				e.preventDefault();
				break;
			case '2':
				setVideoAdjustment('contrast', Math.min($contrast + 5, 100));
				e.preventDefault();
				break;

			// Brightness: 3 / 4
			case '3':
				setVideoAdjustment('brightness', Math.min($brightness + 5, 100));
				e.preventDefault();
				break;
			case '4':
				setVideoAdjustment('brightness', Math.max($brightness - 5, -100));
				e.preventDefault();
				break;

			// Saturation: 7 / 8
			case '7':
				setVideoAdjustment('saturation', Math.max($saturation - 5, -100));
				e.preventDefault();
				break;
			case '8':
				setVideoAdjustment('saturation', Math.min($saturation + 5, 100));
				e.preventDefault();
				break;

			// Anime4K shader modes: Shift + 1/2/3/0
			case '!':
				switchShaderMode('A');
				e.preventDefault();
				break;
			case '@':
				switchShaderMode('B');
				e.preventDefault();
				break;
			case '#':
				switchShaderMode('C');
				e.preventDefault();
				break;
			case ')':
				switchShaderMode('off');
				e.preventDefault();
				break;

			// Playback speed: [ / ]
			case '[':
				setSpeed(Math.max(($speedStore ?? 1.0) - 0.25, 0.25));
				e.preventDefault();
				break;
			case ']':
				setSpeed(Math.min(($speedStore ?? 1.0) + 0.25, 2.0));
				e.preventDefault();
				break;

			// Reset all adjustments
			case 'r':
				resetVideoAdjustments();
				e.preventDefault();
				break;

			default:
				// Not a shortcut: don't count it as player activity.
				return;
		}

		// Any handled shortcut reveals the chrome and restarts the countdown.
		pokeUiActivity();
	}

	function handleKeyup(e: KeyboardEvent) {
		if (e.key !== ' ') return;
		if (isTextEntryTarget(e.target)) return;
		spaceDown = false;
		// A hold that reached 2x only restores the speed; a tap toggles playback.
		if (!endSpeedBoost()) handleTogglePause();
		e.preventDefault();
	}

	// keyup never arrives if the window loses focus mid-hold (Cmd+Tab), which
	// would leave playback stuck at 2x forever.
	function handleWindowBlur() {
		spaceDown = false;
		endSpeedBoost();
	}
</script>

<svelte:window onkeydown={handleKeydown} onkeyup={handleKeyup} onblur={handleWindowBlur} />

<div class="player-overlay" class:over={chromeOverVideo} class:hidden={!$controlsVisible}>
	<!-- Top layer: back, title, room for future actions on the right. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="chrome-top"
		onpointerenter={() => (pointerInTop = true)}
		onpointerleave={() => (pointerInTop = false)}
		onpointerdown={pokeUiActivity}
	>
		<button class="icon-btn" onclick={handleBack} title={$t['player.back']}>
			<ChevronLeft size={22} strokeWidth={2} />
		</button>
		<span class="video-title">{$currentVideoTitle ?? $filename ?? ''}</span>
		<div class="top-actions"></div>
	</div>

	<!-- Bottom layer: panels, timeline, action row. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="chrome-bottom"
		onpointerenter={() => (pointerInBottom = true)}
		onpointerleave={() => (pointerInBottom = false)}
		onpointerdown={pokeUiActivity}
	>
		{#if panel !== 'none'}
			<!-- One markup, two placements: floating above the action row where the
			     DOM paints over the video, inline (pushing the video up) where the
			     native mpv window is on top and a floating panel would be invisible. -->
			<div class="panel" class:floating={chromeOverVideo}>
				<header class="panel-head">
					<span>
						{#if panel === 'tracks'}{$t['player.tracks']}
						{:else if panel === 'speed'}{$t['player.speed']}
						{:else}{$t['player.adjustments']}{/if}
					</span>
					<button class="icon-btn small" onclick={() => (panel = 'none')} title={$t['player.close']}>
						<X size={16} strokeWidth={2} />
					</button>
				</header>
				{#if panel === 'tracks'}
					<TracksPanel
						{subtitleDelayMs}
						onAdjustDelay={adjustSubtitleDelay}
						onResetDelay={resetSubtitleDelay}
					/>
				{:else if panel === 'speed'}
					<SpeedPanel />
				{:else}
					<VideoPanel />
				{/if}
			</div>
		{/if}

		<SeekBar bufferedSeconds={$bufferedUntil} bind:scrubbing />

		<div class="action-row">
			<div class="action-group">
				<button
					class="icon-btn play"
					onclick={handleTogglePause}
					title={displayPaused ? $t['player.play'] : $t['player.pause']}
				>
					{#if displayPaused}
						<Play size={24} strokeWidth={2} />
					{:else}
						<Pause size={24} strokeWidth={2} />
					{/if}
				</button>
				<button class="icon-btn" onclick={() => seek(-10)} title={$t['player.rewind']}>
					<RotateCcw size={17} strokeWidth={2} />
				</button>
				<button class="icon-btn" onclick={() => seek(10)} title={$t['player.forward']}>
					<RotateCw size={17} strokeWidth={2} />
				</button>
				<button
					class="icon-btn"
					onclick={playPrev}
					disabled={!hasPrev}
					title={$t['player.prev']}
				>
					<SkipBack size={18} strokeWidth={2} />
				</button>
				<button class="icon-btn" onclick={playNext} disabled={!hasNext} title={$t['player.next']}>
					<SkipForward size={18} strokeWidth={2} />
				</button>
				<button class="icon-btn" onclick={stopVideo} title={$t['player.stop']}>
					<Square size={16} strokeWidth={2} />
				</button>

				<div class="volume">
					<button
						class="icon-btn"
						onclick={handleToggleMute}
						title={$isMuted ? $t['player.unmute'] : $t['player.mute']}
					>
						{#if $isMuted}
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
						aria-label={$t['player.volume']}
						oninput={handleVolumeInput}
					/>
				</div>
			</div>

			<div class="action-group">
				<button
					class="icon-btn"
					class:active={panel === 'speed'}
					onclick={() => togglePanel('speed')}
					title={$t['player.speed']}
				>
					<Gauge size={18} strokeWidth={2} />
					<span class="btn-tag">{$speedStore}x</span>
				</button>

				<!-- Rendered while open even if the tracks vanish (playlist advanced),
				     so the panel can always be closed from its own button. -->
				{#if hasTrackChoices || panel === 'tracks'}
					<button
						class="icon-btn"
						class:active={panel === 'tracks'}
						onclick={() => togglePanel('tracks')}
						title={$t['player.tracks']}
					>
						<Captions size={18} strokeWidth={2} />
					</button>
				{/if}

				<button
					class="icon-btn"
					class:active={panel === 'video'}
					onclick={() => togglePanel('video')}
					title={$t['player.adjustments']}
				>
					<SlidersHorizontal size={18} strokeWidth={2} />
				</button>

				<button
					class="icon-btn"
					onclick={toggleFullscreen}
					title={$playerFullscreen ? $t['player.exitFullscreen'] : $t['player.fullscreen']}
				>
					{#if $playerFullscreen}
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
	/* Overlay colour tokens. Custom properties inherit, so the child components
	   (SeekBar, panels) pick these up without re-declaring them. Two sets: one for
	   chrome drawn on top of arbitrary video frames, one for the classic bar. */
	.player-overlay {
		--ov-text: var(--text-primary);
		--ov-text-dim: var(--text-secondary);
		--ov-rail: var(--bg-tertiary);
		--ov-rail-buffered: var(--border);
		--ov-chip: var(--bg-tertiary);
		--ov-chip-hover: var(--border);
		--ov-chip-border: var(--border);
		--ov-panel-bg: var(--bg-secondary);
		color: var(--ov-text);
	}

	.player-overlay.over {
		--ov-text: #fff;
		--ov-text-dim: rgba(255, 255, 255, 0.72);
		--ov-rail: rgba(255, 255, 255, 0.28);
		--ov-rail-buffered: rgba(255, 255, 255, 0.45);
		--ov-chip: rgba(255, 255, 255, 0.14);
		--ov-chip-hover: rgba(255, 255, 255, 0.26);
		--ov-chip-border: rgba(255, 255, 255, 0.18);
		--ov-panel-bg: rgba(16, 18, 22, 0.92);

		/* macOS: the DOM paints above the video, so the chrome floats on it.
		   `inset: 0` + pointer-events:none means the overlay never changes the
		   .video-area rectangle — the native surface is only resized by the
		   ResizeObserver in Player.svelte, and this must never trigger it. */
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		pointer-events: none;
		z-index: 6;
		transition: opacity 0.2s ease;
	}

	/* Only the actual chrome takes the mouse; the middle of the video does not. */
	.player-overlay.over .chrome-top,
	.player-overlay.over .chrome-bottom {
		pointer-events: auto;
	}

	/* Vertical gradients instead of opaque bars: the text stays legible over any
	   frame while the video remains visible edge to edge. */
	.player-overlay.over .chrome-top {
		background: linear-gradient(
			to bottom,
			rgba(0, 0, 0, 0.75) 0%,
			rgba(0, 0, 0, 0.45) 45%,
			rgba(0, 0, 0, 0) 100%
		);
		padding: 14px 18px 44px;
	}

	.player-overlay.over .chrome-bottom {
		background: linear-gradient(
			to top,
			rgba(0, 0, 0, 0.85) 0%,
			rgba(0, 0, 0, 0.55) 45%,
			rgba(0, 0, 0, 0) 100%
		);
		padding: 60px 18px 16px;
	}

	.player-overlay.over.hidden {
		opacity: 0;
		pointer-events: none;
	}

	.player-overlay.over.hidden .chrome-top,
	.player-overlay.over.hidden .chrome-bottom {
		pointer-events: none;
	}

	/* Windows/Linux: the native mpv window is drawn ON TOP of the webview, so the
	   chrome is a normal bar below the video (its wrapper in Player.svelte does
	   the collapsing, which pushes the video area — see CLAUDE.md #2). */
	.player-overlay:not(.over) {
		background: var(--bg-secondary);
		border-top: 1px solid var(--border);
		border-radius: 0 0 8px 8px;
		padding: 6px 10px 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.player-overlay:not(.over) .chrome-top {
		padding: 0 0 2px;
	}

	.player-overlay:not(.over) .chrome-bottom {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.chrome-top {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.top-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.video-title {
		font-size: 0.95rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.player-overlay.over .video-title {
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
	}

	.action-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 6px;
	}

	.action-group {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.icon-btn {
		background: none;
		border: none;
		color: var(--ov-text);
		padding: 6px 8px;
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		cursor: pointer;
		transition: background 0.15s, opacity 0.15s;
	}

	.icon-btn:hover:not(:disabled) {
		background: var(--ov-chip-hover);
	}

	.icon-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.icon-btn.active {
		background: var(--ov-chip);
		color: var(--accent);
	}

	.icon-btn.play {
		padding: 6px 10px;
	}

	.icon-btn.small {
		padding: 2px 4px;
	}

	.btn-tag {
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}

	.volume {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-left: 6px;
	}

	.volume-slider {
		width: clamp(60px, 8vw, 110px);
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: var(--ov-rail);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.volume-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: var(--ov-text);
		cursor: pointer;
	}

	/* Panel: floating card over the video (macOS) or an inline block (Windows). */
	.panel {
		background: var(--ov-panel-bg);
		border: 1px solid var(--ov-chip-border);
		border-radius: 10px;
		padding: 12px 14px;
		margin-bottom: 10px;
		max-height: 300px;
		overflow-y: auto;
	}

	.panel.floating {
		position: absolute;
		right: 18px;
		bottom: 96px;
		width: min(420px, calc(100% - 36px));
		margin-bottom: 0;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(12px);
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 10px;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--ov-text);
	}
</style>
