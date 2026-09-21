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
		isBuffering,
		isLoading,
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
	import { Loader2 } from 'lucide-svelte';
	import { stepSpinner, IDLE_SPINNER, type SpinnerState } from '$lib/utils/buffering';
	import { digitShortcut, isDigitRowKey, type DigitAction } from '$lib/utils/shortcuts';
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
	//
	// In 'below' mode the buffering indicator has to pin it too. There the whole
	// bar collapses to zero height when it hides, and it is the only place the
	// indicator can live — nothing may be drawn over the native mpv window on
	// Windows (CLAUDE.md #2) — so without this the "it is loading, not frozen"
	// message would vanish exactly when the user starts wondering.
	$effect(() => {
		controlsPinned.set(panel !== 'none' || (!chromeOverVideo && showSpinner));
	});

	// Auto-advance to the next item when the current video ends.
	$effect(() => {
		checkAutoAdvance($currentTime, $duration);
	});

	// A new file invalidates the subtitle delay we are tracking locally.
	//
	// It has to reset MPV too, not just this variable: `sub-delay` is a global mpv
	// option and `loadfile` does not clear it (the same trap `start` has). Zeroing
	// only the local copy meant five taps of G on episode 1 carried -0.5 s into
	// episode 2 while the panel and the OSD both claimed 0 ms, and the next tap
	// jumped from -500 ms to -100 ms. player-service.ts also zeroes it on load;
	// this keeps the two in step when the overlay is mounted mid-playback.
	$effect(() => {
		$currentVideoUrl;
		subtitleDelayMs = 0;
		setSubtitleDelay(0);
	});

	onDestroy(() => {
		controlsPinned.set(false);
		controlsVisible.set(true);
		// Unmounting with the 2x hold active (navigating away with Space held, or
		// the reportLoadFailure() unmount) used to leave mpv at speed=2 for the rest
		// of the session, because keyup never arrived. endSpeedBoost() also clears
		// spaceHoldTimer, so it covers the plain-hold case too.
		endSpeedBoost();
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

	// --- Buffering indicator -------------------------------------------------

	// `isLoading` is TRUE whenever no file is loaded (there is no duration), so it
	// MUST be gated on `playerActive` or an idle player shows a permanent spinner.
	// `isSeeking` is deliberately NOT part of this: a seek that completes normally
	// settles well inside the grace delay, and one that stalls shows up as
	// `paused-for-cache` anyway — including it only made local seeks flash.
	let spinnerBusy = $derived($playerActive && ($isBuffering || $isLoading));

	// The grace/minimum-visible hysteresis lives in utils/buffering.ts as a pure
	// step function, so the component owns exactly one timer: the step tells us
	// when it next wants to be looked at.
	let spinnerState = $state<SpinnerState>(IDLE_SPINNER);
	let showSpinner = $derived(spinnerState.visible);

	$effect(() => {
		// Read the dependency first so the effect tracks it.
		const busy = spinnerBusy;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const advance = () => {
			const step = stepSpinner(spinnerState, busy, Date.now());
			spinnerState = step.state;
			if (step.recheckInMs != null) timer = setTimeout(advance, step.recheckInMs);
		};
		advance();
		return () => {
			if (timer) clearTimeout(timer);
		};
	});

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

	function applyDigitAction(action: DigitAction) {
		if (action.kind === 'shader') {
			switchShaderMode(action.mode);
			return;
		}
		const current =
			action.property === 'contrast'
				? $contrast
				: action.property === 'brightness'
					? $brightness
					: $saturation;
		// mpv clamps these to -100..100 itself, but clamping here keeps the stores
		// (and therefore the sliders in VideoPanel) from drifting past the ends.
		const next = Math.max(Math.min(current + action.delta, 100), -100);
		setVideoAdjustment(action.property, next);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (isTextEntryTarget(e.target)) return;
		// Shift is part of several shortcuts (the Anime4K presets, fine seek), so it
		// is NOT in this guard; the other modifiers belong to the OS and the app
		// menu (Cmd+R must not reset the image).
		if (e.ctrlKey || e.metaKey || e.altKey) return;

		// Number row FIRST, and by physical key. These used to be matched on the
		// produced character ('!', '@', '#', ')'), which is Shift+1/2/3/0 only on a
		// US layout — on Spanish ISO, Shift+2 is '\"', so Anime4K modes B and C and
		// the "off" switch were unreachable. `e.code` names the key by position on
		// any layout. See utils/shortcuts.ts.
		if (isDigitRowKey(e.code)) {
			const action = digitShortcut(e.code, e.shiftKey);
			// An unbound digit is swallowed rather than allowed to fall through to
			// the character switch, where some layout's character for it could
			// collide with an unrelated letter shortcut.
			e.preventDefault();
			if (action) {
				applyDigitAction(action);
				pokeUiActivity();
			}
			return;
		}

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

			// The number row (image adjustments, and Shift + digit for the Anime4K
			// presets) is handled above, by physical key rather than by character.

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

<!-- Buffering indicator, centred on the video. Deliberately a SIBLING of
     `.player-overlay` and not a child: the chrome hides by setting `opacity: 0`
     on that element, and a child can't opt out of an ancestor's opacity — the
     spinner has to survive the auto-hide, since a stall is most alarming exactly
     when the controls are gone. Only in 'over' mode; in 'below' mode the native
     mpv window is painted on top of the webview, so anything positioned here
     would simply be invisible (CLAUDE.md #2) and the chip inside the bar is used
     instead. -->
{#if chromeOverVideo && showSpinner}
	<div class="buffering-layer" role="status" aria-live="polite">
		<div class="buffering-badge">
			<Loader2 class="spin" size={34} strokeWidth={2.2} />
			<span>{$t['player.buffering']}</span>
		</div>
	</div>
{/if}

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

		<!-- 'below' mode only (see the layer above for why). Sits over the seek row
		     so it never reflows the bar, which on Windows would resize the video
		     area and re-trigger the native surface sync. -->
		{#if !chromeOverVideo && showSpinner}
			<div class="buffering-chip" role="status" aria-live="polite">
				<Loader2 class="spin" size={14} strokeWidth={2.4} />
				<span>{$t['player.buffering']}</span>
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
	/* Buffering indicator. `inset: 0` resolves against `.video-area`
	   (position: relative, Player.svelte), the same box the chrome uses, so the
	   badge lands in the middle of the picture. `pointer-events: none` throughout:
	   it must never intercept a click meant for the video or the chrome. */
	.buffering-layer {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		/* Above the chrome (z-index 6) but below the OSD (10), which is a direct
		   response to a key the user just pressed and outranks a status hint. */
		z-index: 8;
	}

	.buffering-badge {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 18px 26px;
		border-radius: 14px;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(10px);
		color: #fff;
		font-size: 0.82rem;
		font-weight: 500;
		letter-spacing: 0.01em;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
		animation: buffering-in 0.18s ease-out;
	}

	/* 'below' mode: a compact chip in the bar instead of a badge on the video. */
	.buffering-chip {
		display: flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--ov-chip);
		border: 1px solid var(--ov-chip-border);
		color: var(--ov-text-dim);
		font-size: 0.72rem;
		white-space: nowrap;
	}

	/* lucide-svelte forwards `class` to the <svg>, and the icon is rendered by a
	   child component, so the selector has to be :global. */
	.buffering-badge :global(.spin),
	.buffering-chip :global(.spin) {
		animation: buffering-spin 0.9s linear infinite;
	}

	@keyframes buffering-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes buffering-in {
		from {
			opacity: 0;
			transform: scale(0.94);
		}
	}

	/* Respect the OS setting: the spinner is a status hint, not information that
	   depends on motion, so freezing it loses nothing. */
	@media (prefers-reduced-motion: reduce) {
		.buffering-badge :global(.spin),
		.buffering-chip :global(.spin) {
			animation: none;
		}
		.buffering-badge {
			animation: none;
		}
	}

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
