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
	import { log } from '$lib/log';
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

	// A geometry change can leave the hover flags lying: they are driven by
	// `pointerenter`/`pointerleave` on the chrome rows, and those only fire when
	// the POINTER moves. Entering or leaving full screen resizes the window under
	// a stationary pointer, so a chrome row can slide out from under the cursor
	// without ever sending `pointerleave` — the flag stays true, `canAutoHide`
	// stays false, and the chrome never hides again for the rest of the session.
	// That is the reported "in full screen the title and the buttons don't hide".
	//
	// Clearing both on every full-screen transition is safe: if the pointer really
	// is over a row afterwards, the next mouse move re-enters it and re-arms the
	// flag, and until then the auto-hide countdown is exactly what we want running.
	$effect(() => {
		$playerFullscreen; // track transitions
		pointerInTop = false;
		pointerInBottom = false;
	});

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
		if (hideable !== '1' || visible !== '1') {
			// Which term blocked it. "The chrome never hides" is otherwise
			// indistinguishable between six causes, and one of them is a user
			// setting that is doing exactly what it was asked to.
			log.debug(
				`[player] chrome stays up: active=${$playerActive} delay=${hideDelay} ` +
					`scrubbing=${scrubbing} inTop=${pointerInTop} inBottom=${pointerInBottom} ` +
					`pinned=${$controlsPinned} error=${!!$playbackError} visible=${$controlsVisible}`,
			);
			return;
		}
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

	/**
	 * Close an open panel when the pointer goes down anywhere else.
	 *
	 * On `pointerdown` rather than `click`, so the panel is gone before whatever
	 * was clicked reacts — a `click` listener would fire after the video had
	 * already been toggled underneath it.
	 *
	 * The panel's own toggle buttons are skipped via `data-panel-toggle`:
	 * `pointerdown` runs BEFORE `click`, so without that exclusion pressing the
	 * button would close the panel here and `togglePanel` would immediately
	 * reopen it, making the button unable to close anything.
	 *
	 * macOS only in practice. On Windows the native mpv window is composited on
	 * top of the webview and swallows pointer events over the video
	 * (CLAUDE.md #2), so a click on the picture never reaches the DOM — which is
	 * also why the panels are inline rather than floating there.
	 */
	function handleOutsidePointerDown(e: PointerEvent) {
		if (panel === 'none') return;
		const target = e.target as Element | null;
		if (!target?.closest) return;
		if (target.closest('.panel') || target.closest('[data-panel-toggle]')) return;
		panel = 'none';
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
	// The machine's state is a PLAIN variable, not `$state`, and that is the whole
	// point. It used to be `$state` and the effect below both read and wrote it,
	// so the effect re-triggered itself: every pass produced a fresh object (so it
	// always counted as a change), and the effect's own cleanup cancelled the
	// pending timer each time. The timer is what satisfies `minVisibleMs`, so once
	// the badge was up it could never come down — it stayed on screen for the rest
	// of the file. Shipped in 1.5.0/1.5.1; reported as "the buffering modal is
	// permanently on" while playback was in fact fine.
	//
	// Only the boolean the template needs is reactive. The effect now tracks
	// `spinnerBusy` alone, which is exactly the one input it should re-run for.
	let spinnerMachine: SpinnerState = IDLE_SPINNER;
	let spinnerVisible = $state(false);
	let showSpinner = $derived(spinnerVisible);

	$effect(() => {
		// Read the dependency first so the effect tracks it.
		const busy = spinnerBusy;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const advance = () => {
			const step = stepSpinner(spinnerMachine, busy, Date.now());
			spinnerMachine = step.state;
			spinnerVisible = step.state.visible;
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

<svelte:window
	onkeydown={handleKeydown}
	onkeyup={handleKeyup}
	onblur={handleWindowBlur}
	onpointerdown={handleOutsidePointerDown}
/>

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
	<!-- The scrim is painted BY the two chrome rows, as their own background, and
	     that is deliberate. The last row of a gradient's ramp comes out at alpha
	     ~1 on this compositing path — a near-black hairline — and nothing removes
	     it: an overshooting box clipped by `.video-area`, a transparent plateau, a
	     mask over a flat fill, and background layers on a pseudo-element were all
	     tried and all kept it. So the line is placed rather than fought. Tying the
	     ramp to each row's own box makes its length follow the element, so the
	     hairline always lands exactly on that row's inner edge, where it reads as
	     the border of the title strip and of the controls strip. Nothing to keep
	     in sync, and it can never drift into the middle of the picture. -->

	<!-- Top layer: back, title, room for future actions on the right. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="chrome-top"
		onpointerenter={() => (pointerInTop = true)}
		onpointerleave={() => (pointerInTop = false)}
		onpointerdown={pokeUiActivity}
	>
		<button
			class="icon-btn"
			onclick={handleBack}
			aria-label={$t['player.back']}
			data-tip={$t['player.back']}
			data-tip-align="start"
		>
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
					aria-label={displayPaused ? $t['player.play'] : $t['player.pause']} data-tip={displayPaused ? $t['player.play'] : $t['player.pause']}
				>
					{#if displayPaused}
						<Play size={24} strokeWidth={2} />
					{:else}
						<Pause size={24} strokeWidth={2} />
					{/if}
				</button>
				<button class="icon-btn" onclick={() => seek(-10)} aria-label={$t['player.rewind']} data-tip={$t['player.rewind']}>
					<RotateCcw size={17} strokeWidth={2} />
				</button>
				<button class="icon-btn" onclick={() => seek(10)} aria-label={$t['player.forward']} data-tip={$t['player.forward']}>
					<RotateCw size={17} strokeWidth={2} />
				</button>
				<button
					class="icon-btn"
					onclick={playPrev}
					disabled={!hasPrev}
					aria-label={$t['player.prev']} data-tip={$t['player.prev']}
				>
					<SkipBack size={18} strokeWidth={2} />
				</button>
				<button class="icon-btn" onclick={playNext} disabled={!hasNext} aria-label={$t['player.next']} data-tip={$t['player.next']}>
					<SkipForward size={18} strokeWidth={2} />
				</button>
				<button class="icon-btn" onclick={stopVideo} aria-label={$t['player.stop']} data-tip={$t['player.stop']}>
					<Square size={16} strokeWidth={2} />
				</button>

				<div class="volume">
					<button
						class="icon-btn"
						onclick={handleToggleMute}
						aria-label={$isMuted ? $t['player.unmute'] : $t['player.mute']} data-tip={$isMuted ? $t['player.unmute'] : $t['player.mute']}
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
					data-panel-toggle
					aria-label={$t['player.speed']} data-tip={$t['player.speed']}
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
					data-panel-toggle
						aria-label={$t['player.tracks']} data-tip={$t['player.tracks']}
					>
						<Captions size={18} strokeWidth={2} />
					</button>
				{/if}

				<button
					class="icon-btn"
					class:active={panel === 'video'}
					onclick={() => togglePanel('video')}
					data-panel-toggle
					aria-label={$t['player.adjustments']} data-tip={$t['player.adjustments']}
				>
					<SlidersHorizontal size={18} strokeWidth={2} />
				</button>

				<button
					class="icon-btn"
					onclick={toggleFullscreen}
					aria-label={$playerFullscreen ? $t['player.exitFullscreen'] : $t['player.fullscreen']} data-tip={$playerFullscreen ? $t['player.exitFullscreen'] : $t['player.fullscreen']}
					data-tip-align="end"
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
		--ov-text-dim: rgba(255, 255, 255, 0.85);
		/* These were calibrated to sit under a dark scrim. With the scrim gone they
		   have to hold their own against a white frame, which the anime supplies
		   constantly, so the chips went from white-on-white (invisible over a
		   bright shot) to a dark translucent pill. Flat colours, no gradient —
		   nothing here can bring the hairline back.
		   The unplayed track is DARK, not translucent white. White at 0.45 with
		   the buffered part at 0.68 left the two almost indistinguishable over a
		   bright frame, and raising the buffered value cannot fix it: the ceiling
		   is opaque white and the track was already near it. A dark track gives
		   the three levels room to separate — dark track, white buffered, accent
		   played — and it is the one choice that reads on a bright shot and a dark
		   one alike, which is why every player that has no scrim does this. */
		--ov-rail: rgba(0, 0, 0, 0.45);
		--ov-rail-buffered: rgba(255, 255, 255, 0.72);
		--ov-chip: rgba(205, 210, 220, 0.18);
		--ov-chip-hover: rgba(215, 220, 230, 0.3);
		--ov-chip-border: rgba(255, 255, 255, 0.22);
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

	/* Legibility over bare video, and the blur radius is the whole game here.
	   These strokes and glyphs are about 2px wide, so a shadow blurred over a
	   comparable distance piles up on itself right next to the stroke and reads
	   as a black outline rather than as shade — that is what 5px at 0.6 did, and
	   2px at 0.9 before it. The blur has to be several times the stroke width,
	   with the alpha dropped to match, so the same total darkness is spread into
	   a haze with no edge anywhere in it. */
	.player-overlay.over .chrome-top,
	.player-overlay.over .chrome-bottom {
		position: relative;
		z-index: 1;
	}

	/* Tooltips. These replace the native `title` ones, which macOS renders as a
	   grey system box that appears over the video after a delay and in the wrong
	   place. `aria-label` keeps the accessible name, since these buttons have no
	   visible text, and `data-tip` feeds the visual one. Not used on the panel's
	   close button: that panel scrolls (`overflow-y: auto`), which would clip it. */
	.player-overlay.over .icon-btn[data-tip]::after {
		content: attr(data-tip);
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%) translateY(4px);
		padding: 5px 9px;
		border-radius: 7px;
		background: rgba(38, 40, 46, 0.8);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid var(--ov-chip-border);
		color: #fff;
		font-size: 0.72rem;
		font-weight: 500;
		line-height: 1.2;
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.12s ease, transform 0.12s ease;
	}

	.player-overlay.over .icon-btn[data-tip]:hover::after,
	.player-overlay.over .icon-btn[data-tip]:focus-visible::after {
		opacity: 1;
		transform: translateX(-50%) translateY(0);
	}

	/* The two buttons at the far edges would push their tooltip off the window,
	   so those anchor to the button instead of centring on it. */
	.player-overlay.over .icon-btn[data-tip-align='start']::after {
		left: 0;
		transform: translateY(4px);
	}

	.player-overlay.over .icon-btn[data-tip-align='end']::after {
		left: auto;
		right: 0;
		transform: translateY(4px);
	}

	.player-overlay.over .icon-btn[data-tip-align='start']:hover::after,
	.player-overlay.over .icon-btn[data-tip-align='start']:focus-visible::after,
	.player-overlay.over .icon-btn[data-tip-align='end']:hover::after,
	.player-overlay.over .icon-btn[data-tip-align='end']:focus-visible::after {
		transform: translateY(0);
	}

	/* The back button is on the TOP row, so its tooltip hangs below it. */
	.player-overlay.over .chrome-top .icon-btn[data-tip]::after {
		bottom: auto;
		top: calc(100% + 8px);
		transform: translateY(-4px);
	}

	.player-overlay.over .chrome-top .icon-btn[data-tip]:hover::after,
	.player-overlay.over .chrome-top .icon-btn[data-tip]:focus-visible::after {
		transform: translateY(0);
	}

	/* Play/pause is the one control the eye should land on first, so it gets a
	   filled disc. Same flat chip colours as the hover pills. */
	.player-overlay.over .icon-btn.play {
		width: 44px;
		height: 44px;
		padding: 0;
		margin-right: 6px;
		border-radius: 50%;
		background: var(--ov-chip);
		transition: background 0.15s ease;
	}

	.player-overlay.over .icon-btn.play:hover {
		background: var(--ov-chip-hover);
	}

	/* The chips are a light grey at low alpha, so on a bright frame they have
	   almost no tone of their own to separate them from the picture. The blur
	   does that job instead: it is what makes them read as glass rather than as
	   a wash of paint, and it works on a dark shot and a white one alike. It goes
	   on a rounded, self-contained box — the one shape this compositing path has
	   never had trouble with, unlike a gradient fading across the frame. */
	.player-overlay.over .icon-btn.play,
	.player-overlay.over .icon-btn:hover:not(:disabled),
	.player-overlay.over .icon-btn.active {
		backdrop-filter: blur(12px) saturate(1.1);
		-webkit-backdrop-filter: blur(12px) saturate(1.1);
	}

	/* A touch of feedback on the glyph itself, which costs nothing and makes the
	   row feel alive without moving the layout. */
	.player-overlay.over .icon-btn :global(svg) {
		transition: transform 0.12s ease;
	}

	.player-overlay.over .icon-btn:not(:disabled):hover :global(svg) {
		transform: scale(1.08);
	}

	/* The rows slide in from their own edge as they fade, rather than just
	   appearing. 10px is enough to read as movement and small enough that it
	   never looks like the layout is settling. */
	.player-overlay.over .chrome-top,
	.player-overlay.over .chrome-bottom {
		transition: transform 0.2s ease;
	}

	.player-overlay.over.hidden .chrome-top {
		transform: translateY(-10px);
	}

	.player-overlay.over.hidden .chrome-bottom {
		transform: translateY(10px);
	}

	/* No shadow on the icons or the sliders, and this is the conclusion of several
	   attempts rather than an omission. A drop-shadow blurred over any distance
	   comparable to a 2px icon stroke or a 4px rail piles up next to it and reads
	   as a black contour; blurring it wide enough to stop doing that leaves it too
	   faint to earn its keep. On the button it was worse still, because `filter`
	   shadows the background box too, so the hover pill got a hard dark outline.
	   Contrast over a bright frame comes from flat colour instead — see the raised
	   rails and the dark chips in the `over` palette above. */
	/* Mostly flat, with the fade confined to the last third. A long even ramp
	   makes the hairline at its end look like a defect; a strip that is almost
	   uniform and then softens into its own edge makes the very same line read as
	   the strip's border. The paddings are tightened to hug the content: the old
	   44px/60px were dead space the free-standing scrim needed and nothing else
	   used. */
	.player-overlay.over .chrome-top {
		padding: 14px 18px 18px;
		background: linear-gradient(
			to bottom,
			rgba(0, 0, 0, 0.62) 0%,
			rgba(0, 0, 0, 0.58) 55%,
			rgba(0, 0, 0, 0.34) 82%,
			rgba(0, 0, 0, 0) 100%
		);
	}

	.player-overlay.over .chrome-bottom {
		padding: 20px 18px 16px;
		background: linear-gradient(
			to top,
			rgba(0, 0, 0, 0.66) 0%,
			rgba(0, 0, 0, 0.6) 55%,
			rgba(0, 0, 0, 0.34) 82%,
			rgba(0, 0, 0, 0) 100%
		);
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
