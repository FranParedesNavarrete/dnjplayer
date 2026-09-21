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
