// Buffering maths, extracted from the stores so it can be unit tested.
//
// mpv exposes two related and easily confused cache properties:
//
//   demuxer-cache-time      ABSOLUTE timestamp of the last packet in the cache
//                           (same clock as `time-pos`), or a negative/absent
//                           value when there is no cache.
//   demuxer-cache-duration  RELATIVE seconds of cache ahead of the playback
//                           position.
//
// Both are unreliable on their own: `-time` is the accurate one for drawing a
// "buffered up to here" bar, but it is meaningless right after a seek (mpv
// resets the cache and the value can trail the new position), and it is absent
// for some demuxers. `-duration` is always relative and survives seeks, but it
// is coarser. So: prefer `-time`, sanity-check it against the position, fall
// back to `-duration`.

/** Tolerance for `demuxer-cache-time` lagging `time-pos` right after a seek. */
const CACHE_TIME_SLACK_SECONDS = 5;

/**
 * Seconds of media buffered AHEAD of `position` (a duration, never a timestamp).
 *
 * Returns 0 when nothing is known, so a UI can always render it. Adapted from
 * Nuvio's cache-ahead computation (analysis-nuvio-mpv-integration.md §4), minus
 * its `initialStartSeconds` special case: our resume seek is applied through
 * mpv's own `start` option before the file opens, so `time-pos` is never behind
 * the resume target the way it is in Nuvio's "load at 0, then seek" flow.
 */
export function computeBufferedSeconds(
	cacheTime: number | null | undefined,
	cacheDuration: number | null | undefined,
	position: number | null | undefined
): number {
	const pos = typeof position === 'number' && Number.isFinite(position) ? position : 0;

	if (typeof cacheTime === 'number' && Number.isFinite(cacheTime) && cacheTime > 0) {
		// Only trust the absolute value while it is plausibly in front of us.
		// Just after a seek it can briefly point behind the playhead, and a
		// negative "buffered ahead" would draw the bar backwards.
		if (cacheTime >= pos - CACHE_TIME_SLACK_SECONDS) {
			return Math.max(cacheTime - pos, 0);
		}
	}

	if (typeof cacheDuration === 'number' && Number.isFinite(cacheDuration) && cacheDuration > 0) {
		return cacheDuration;
	}

	return 0;
}

/**
 * The "spinner should be visible" predicate, per Nuvio
 * (analysis-nuvio-mpv-integration.md §4):
 *
 *   !fileReady || (core-idle && !paused && !eof-reached) || paused-for-cache
 *
 * Read as three distinct states:
 *  - `!fileReady`      — mpv has not finished opening the file (no duration yet).
 *  - `coreIdle && !paused && !eof` — the user asked for playback, the file has
 *    ended nothing, and yet mpv is producing no frames: it is stalled.
 *  - `pausedForCache`  — mpv says outright that it is waiting on the network.
 *
 * `eofReached` matters because `keep-open=yes` leaves mpv core-idle and unpaused
 * at the end of a file; without it every finished file would show a spinner
 * forever.
 */
export function computeIsLoading(state: {
	duration: number | null;
	coreIdle: boolean;
	paused: boolean;
	eofReached: boolean;
	pausedForCache: boolean;
}): boolean {
	const fileReady =
		typeof state.duration === 'number' && Number.isFinite(state.duration) && state.duration > 0;
	if (!fileReady) return true;
	if (state.pausedForCache) return true;
	return state.coreIdle && !state.paused && !state.eofReached;
}

// --- Spinner visibility, with hysteresis at both ends -----------------------
//
// `isBuffering`/`isLoading` flip far too fast to drive a spinner directly. Over
// a MEGAcmd WebDAV stream `paused-for-cache` routinely blips for 50-150 ms while
// the demuxer tops up, and every file transition makes `duration` null for a
// frame or two. Wiring either straight to the DOM gives a strobe light.
//
// So the raw "busy" flag goes through a two-sided delay:
//
//   graceMs       how long busy must persist BEFORE the spinner appears. A
//                 stall shorter than this is invisible to the user, which is
//                 the point — it was invisible in the video too.
//   minVisibleMs  how long the spinner stays once shown, even if busy clears
//                 immediately. Without it, a stall just over `graceMs` draws a
//                 one-frame flash, which reads as a glitch rather than as
//                 information.
//
// This is a pure step function rather than a pile of timers in the component:
// it takes the previous state and "now", and returns the next state plus how
// many ms later it wants to be called again (null = nothing pending). The
// component only has to own one setTimeout.

/** Delay before a stall becomes a visible spinner. */
export const SPINNER_GRACE_MS = 300;
/** Minimum time the spinner stays on screen once it has appeared. */
export const SPINNER_MIN_VISIBLE_MS = 400;

export interface SpinnerTimings {
	graceMs: number;
	minVisibleMs: number;
}

export const DEFAULT_SPINNER_TIMINGS: SpinnerTimings = {
	graceMs: SPINNER_GRACE_MS,
	minVisibleMs: SPINNER_MIN_VISIBLE_MS,
};

export interface SpinnerState {
	/** Whether the spinner should be painted right now. */
	visible: boolean;
	/** Timestamp of the rising edge of the current busy period, if any. */
	busySince: number | null;
	/** Timestamp at which the spinner became visible, if it is. */
	shownAt: number | null;
}

/** The at-rest state: nothing busy, nothing shown. */
export const IDLE_SPINNER: SpinnerState = { visible: false, busySince: null, shownAt: null };

export interface SpinnerStep {
	state: SpinnerState;
	/** ms until this function should be called again, or null if nothing is pending. */
	recheckInMs: number | null;
}

/**
 * Advance the spinner state machine.
 *
 * @param prev  the state returned by the previous call (start from IDLE_SPINNER)
 * @param busy  the raw predicate — `playerActive && (isBuffering || isLoading)`
 * @param now   a monotonic-ish millisecond clock (`Date.now()` is fine)
 */
export function stepSpinner(
	prev: SpinnerState,
	busy: boolean,
	now: number,
	timings: SpinnerTimings = DEFAULT_SPINNER_TIMINGS
): SpinnerStep {
	if (busy) {
		// Already on screen: stay on, and stop asking to be re-checked. `shownAt`
		// is preserved so a later release still honours the minimum visible time.
		if (prev.visible) {
			return {
				state: { visible: true, busySince: prev.busySince ?? now, shownAt: prev.shownAt ?? now },
				recheckInMs: null,
			};
		}
		const busySince = prev.busySince ?? now;
		const waited = now - busySince;
		if (waited >= timings.graceMs) {
			return { state: { visible: true, busySince, shownAt: now }, recheckInMs: null };
		}
		// Still inside the grace window: keep waiting, and say exactly when the
		// caller should look again so no polling loop is needed.
		return {
			state: { visible: false, busySince, shownAt: null },
			recheckInMs: timings.graceMs - waited,
		};
	}

	// Not busy. A pending-but-never-shown grace period is simply abandoned, which
	// is the whole point: the stall was too short to be worth reporting.
	if (!prev.visible) return { state: IDLE_SPINNER, recheckInMs: null };

	const shownFor = now - (prev.shownAt ?? now);
	if (shownFor >= timings.minVisibleMs) return { state: IDLE_SPINNER, recheckInMs: null };
	// Hold it a little longer. `busySince` is cleared: if busy returns while the
	// spinner is still up, the `prev.visible` branch above keeps it up with no
	// new grace period, which is what "it never really recovered" should look like.
	return {
		state: { visible: true, busySince: null, shownAt: prev.shownAt },
		recheckInMs: timings.minVisibleMs - shownFor,
	};
}
