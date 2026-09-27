// Resume-position thresholds.
//
// Pure, so the rules that decide "this is worth resuming" can be unit tested
// without mpv or SQLite. player-service.ts owns the timing (when to sample),
// db-service.ts owns the storage; everything below is just arithmetic.
//
// The three regions of a file:
//
//   0 ────── 1s ─────────────────────────── 90% ────── end
//   │ "from  │ worth storing / resuming      │ "finished"
//   │  the   │                               │
//   │ start" │                               │
//
// Below the floor the user has effectively not started, and resuming there is
// indistinguishable from playing from the beginning while being more surprising.
// Past the watched fraction the user has effectively finished, so the next play
// must start over — storing 98% would make "play" look broken.

/**
 * Positions below this are treated as "not started". Also guards against the
 * position sample that lands at ~0 while mpv is still opening the file.
 */
export const RESUME_MIN_SECONDS = 1;

/**
 * Past this fraction of the duration the file counts as watched: no position is
 * stored, and any stored one is cleared.
 */
export const WATCHED_FRACTION = 0.9;

/**
 * Files shorter than this never get a resume point. A 40-second clip is faster
 * to re-watch than to reason about, and the 1s/90% window barely exists for it.
 */
export const RESUME_MIN_DURATION_SECONDS = 60;

/** A finite, strictly positive number (mpv reports NaN/null while loading). */
function isPositiveFinite(value: number | null | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Is `position` inside the storable window for a file of length `duration`?
 *
 * False means one of: we don't know the duration yet, the file is too short to
 * bother with, playback has barely started, or it has effectively finished.
 * The caller must treat a false here as "clear any stored position", not as
 * "leave the old one alone" — otherwise finishing a file leaves last week's
 * position behind and the next play jumps into the middle of it.
 */
export function shouldStorePosition(
	position: number | null | undefined,
	duration: number | null | undefined
): boolean {
	if (!isPositiveFinite(duration) || duration < RESUME_MIN_DURATION_SECONDS) return false;
	if (typeof position !== 'number' || !Number.isFinite(position)) return false;
	return position >= RESUME_MIN_SECONDS && position <= duration * WATCHED_FRACTION;
}

/**
 * Has the file been watched far enough to count as seen?
 * Used to decide that a stored position must be dropped rather than updated.
 */
export function isEffectivelyWatched(
	position: number | null | undefined,
	duration: number | null | undefined
): boolean {
	if (!isPositiveFinite(duration)) return false;
	if (typeof position !== 'number' || !Number.isFinite(position)) return false;
	return position > duration * WATCHED_FRACTION;
}

/**
 * Turn a stored row into the position mpv should start at, or null for "start
 * from the beginning".
 *
 * `storedDuration` is the duration recorded alongside the position. It is
 * allowed to be null (rows written before this existed, or a file whose duration
 * mpv never reported); the position is then taken at face value, because the
 * only alternative is to throw away a perfectly good resume point. When it IS
 * known, the same window as {@link shouldStorePosition} is re-applied, which is
 * what protects against a row that was written for a different (e.g. replaced or
 * re-encoded) file and now points past the end.
 */
export function resumePositionFor(
	storedPosition: number | null | undefined,
	storedDuration: number | null | undefined
): number | null {
	if (typeof storedPosition !== 'number' || !Number.isFinite(storedPosition)) return null;
	if (storedPosition < RESUME_MIN_SECONDS) return null;
	if (storedDuration == null) return storedPosition;
	if (!shouldStorePosition(storedPosition, storedDuration)) return null;
	return storedPosition;
}
