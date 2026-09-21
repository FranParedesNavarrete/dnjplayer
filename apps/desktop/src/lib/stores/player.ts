import { writable, derived } from 'svelte/store';
import type { MediaTrack } from '$lib/types/player';
import { computeBufferedSeconds, computeIsLoading } from '$lib/utils/buffering';

// mpv playback state
export const isPaused = writable(true);
export const currentTime = writable<number | null>(null);
export const duration = writable<number | null>(null);
export const filename = writable<string | null>(null);
export const videoWidth = writable<number | null>(null);
export const videoHeight = writable<number | null>(null);
export const volume = writable(100);
export const speed = writable(1.0);
// Mirrors mpv's `mute`. Written only by player-service.ts's observer, so a mute
// toggled from mpv's own OSD/keybinds is reflected too.
export const isMuted = writable(false);
// mpv's `media-title`: container metadata title when the file has one, else the
// filename mpv derived from the URL. For a Mega WebDAV stream the URL segment is
// an opaque token, so prefer `currentVideoTitle` (player-ui.ts) for display and
// treat this as a fallback / diagnostic.
export const mediaTitle = writable<string | null>(null);

// --- Buffering / stall state ---
//
// All four mirror observed mpv properties; see OBSERVED_PROPERTIES in
// player-service.ts. They exist mainly so the UI can tell "paused" apart from
// "stalled", which over a Mega WebDAV stream is the difference between a bug
// report and a spinner.

/** mpv's `paused-for-cache`: playback is stopped waiting for the network. */
export const isBuffering = writable(false);
/** mpv's `core-idle`: the playback core is producing no frames, for any reason. */
export const coreIdle = writable(false);
/** mpv's `seeking`: a seek is in flight and the position is not yet settled. */
export const isSeeking = writable(false);
/** mpv's `eof-reached`: parked at the end of the file (keep-open=yes). */
export const eofReached = writable(false);
/** mpv's `demuxer-cache-time`: ABSOLUTE timestamp of the last cached packet. */
export const demuxerCacheTime = writable<number | null>(null);
/** mpv's `demuxer-cache-duration`: RELATIVE seconds of cache ahead of the playhead. */
export const demuxerCacheDuration = writable<number | null>(null);

// Track state — a mirror of mpv's `track-list` / `aid` / `sid`, refreshed on
// every file load. Written only by player-service.ts; the UI reads and calls
// setAudioTrack()/setSubtitleTrack() to change the selection.
export const audioTracks = writable<MediaTrack[]>([]);
export const subtitleTracks = writable<MediaTrack[]>([]);
// Currently selected track ids. `'no'` means the stream is disabled (mpv
// reports the literal string "no"), `null` means unknown/not loaded yet.
export const currentAid = writable<number | 'no' | null>(null);
export const currentSid = writable<number | 'no' | null>(null);

// Video adjustments
export const brightness = writable(0);
export const contrast = writable(0);
export const saturation = writable(0);
export const gamma = writable(0);
export const hue = writable(0);

// Anime4K shader state
export const activeShaderMode = writable<'A' | 'B' | 'C' | 'off'>('off');
export const shaderVariant = writable<'S' | 'M' | 'L' | 'VL' | 'UL'>('VL');

// OSD (on-screen display) message — shown briefly over the video
export const osdMessage = writable<string | null>(null);

// Derived
export const progress = derived(
	[currentTime, duration],
	([$time, $dur]) => ($time != null && $dur != null && $dur > 0) ? $time / $dur : 0
);

export const resolution = derived(
	[videoWidth, videoHeight],
	([$w, $h]) => ($w && $h) ? `${$w}x${$h}` : null
);

/**
 * Seconds of media buffered AHEAD of the current position — a DURATION, not a
 * timestamp. 0 when nothing is cached or nothing is known.
 *
 * For a "loaded up to here" bar use {@link bufferedUntil} instead; this store is
 * the raw headroom figure (useful for "N s buffered" text or a stall heuristic).
 */
export const bufferedSeconds = derived(
	[demuxerCacheTime, demuxerCacheDuration, currentTime],
	([$cacheTime, $cacheDuration, $time]) =>
		computeBufferedSeconds($cacheTime, $cacheDuration, $time)
);

/**
 * ABSOLUTE timeline position, in seconds, up to which media is buffered — i.e.
 * where the secondary "loaded" bar should end. Clamped to the file duration so
 * it can never overshoot the track. Null while the position is unknown.
 *
 * Drawn as a fraction: `$bufferedUntil / $duration`.
 */
export const bufferedUntil = derived(
	[currentTime, bufferedSeconds, duration],
	([$time, $buffered, $dur]) => {
		if ($time == null) return null;
		const end = $time + $buffered;
		return $dur != null && $dur > 0 ? Math.min(end, $dur) : end;
	}
);

/**
 * "Show a spinner" — mpv is not producing frames and the user did not ask for
 * that. See computeIsLoading() for the predicate and why each term is there.
 *
 * NOTE for consumers: this is true whenever no file is loaded (there is no
 * duration), so gate it on `playerActive` (player-ui.ts) before rendering, or an
 * idle player shows a permanent spinner.
 */
export const isLoading = derived(
	[duration, coreIdle, isPaused, eofReached, isBuffering],
	([$duration, $coreIdle, $paused, $eof, $pausedForCache]) =>
		computeIsLoading({
			duration: $duration,
			coreIdle: $coreIdle,
			paused: $paused,
			eofReached: $eof,
			pausedForCache: $pausedForCache,
		})
);
