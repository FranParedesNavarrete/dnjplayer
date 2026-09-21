// When to hand the NEXT queue item to mpv ahead of time, as pure data.
//
// THE PROBLEM, measured. Opening a Matroska stream over HTTP is not one request
// but THREE sequential ones: the header at byte 0, a jump to the tail for the
// SeekHead/Cues, then back to the first cluster. Against a stand-in WebDAV
// server with a 2 s first-byte latency (mpv 0.41.0, our REMOTE_STREAM_OPTIONS
// profile, 378 MiB 1080p mkv) the gap between the end of one episode and the
// first frame of the next was:
//
//   prefetch-playlist=no    6.07 s   <- three cold opens, serialised
//   prefetch-playlist=yes   0.11 s   <- all three already done
//
// 6 s of a frozen picture is exactly what Fran reported as "the app looks like
// it has hung". mpv's own `--prefetch-playlist` fixes it, but only for entries
// that are already in MPV'S playlist — and our queue lives in Svelte, with one
// cold `loadfile` per episode, so mpv never has a next entry to prefetch.
//
// THE FIX, and why it is this shape rather than "give mpv the whole queue".
// Measured facts that drove the design (all mpv 0.41.0, via JSON IPC):
//
//  1. `keep-open=yes` does NOT park at EOF when a next playlist entry exists —
//     mpv advances on its own and `eof-reached` goes to null, never true. Our
//     entire auto-advance path hangs off `eof-reached === true`, so handing mpv
//     a real queue silently breaks it. `keep-open=always` parks at EOF even
//     with a next entry, which keeps our trigger working.
//  2. mpv starts the prefetch open as soon as a next entry EXISTS (given the
//     current file's stream has been read into the demuxer cache), not at some
//     fixed distance from the end. So appending late works exactly as well as
//     appending up front — which is what lets us keep our own queue.
//  3. An explicit `playlist-next force` reuses the prefetched demuxer (0.01 s)
//     and a `start` written just before it IS honoured on that entry, so resume
//     still works.
//  4. `loadfile … replace` wipes the other playlist entries, so the existing
//     cold path cleans up after itself and cannot be polluted by a stale
//     pre-open.
//  5. `playlist-next` with nothing after the current entry STOPS playback and
//     still reports success — so it must never be issued on a guess.
//
// Hence: keep our queue, append exactly ONE entry, late, and consume it.

/**
 * How far from the end of the current file to append the next one.
 *
 * Sized from the measurement above: the lead has to cover three sequential
 * stream opens. At 4 s of runway only two of the three fitted and 2.16 s of the
 * stall remained, so the lead must comfortably exceed 3x the server's first-byte
 * latency. 45 s covers a MEGAcmd that is far slower than the 2 s stand-in, and
 * costs only that mpv holds a second open demuxer for the last 45 s of each
 * episode.
 */
export const PREOPEN_LEAD_SECONDS = 45;

export interface PreopenInput {
	/** mpv's `time-pos`, or null while unknown. */
	position: number | null;
	/** mpv's `duration`, or null while unknown. */
	duration: number | null;
	/** Index of the item playing now, in OUR playlist. */
	index: number;
	/** Length of OUR playlist. */
	length: number;
	/**
	 * Whether the next item needs the same demuxer/network profile as the
	 * current one (both remote, or both local).
	 *
	 * This gates the pre-open instead of switching the profile, because the
	 * profile options (`cache`, `demuxer-max-bytes`, …) are read when the
	 * demuxer is CREATED. Appending a Mega stream while the local-file profile
	 * is in force would open it with the cache off, which is worse than the cold
	 * start we were trying to avoid — and writing the remote profile first would
	 * mutate it under the currently playing local file. A mixed queue simply
	 * falls back to the cold path.
	 */
	sameStreamProfile: boolean;
	/** True once this index's successor has already been handed to mpv. */
	alreadyArmed: boolean;
	lead?: number;
}

/**
 * Should the next item be appended to mpv's playlist right now?
 *
 * Deliberately conservative: every unknown is a "no", because a wrong pre-open
 * costs a wasted demuxer (and, for a Mega item, a WebDAV URL frozen earlier
 * than necessary) while a missed one only costs the cold start we have today.
 */
export function shouldPreopenNext(input: PreopenInput): boolean {
	if (input.alreadyArmed) return false;
	if (!input.sameStreamProfile) return false;
	// Nothing to pre-open: last item, or an empty/1-item queue.
	if (input.index < 0 || input.index >= input.length - 1) return false;

	const { position, duration } = input;
	if (position == null || !Number.isFinite(position)) return false;
	if (duration == null || !Number.isFinite(duration) || duration <= 0) return false;

	const remaining = duration - position;
	// `remaining <= 0` means we are at or past EOF: the transition is already
	// happening and appending now would arrive too late to help anyway.
	if (remaining <= 0) return false;
	return remaining <= (input.lead ?? PREOPEN_LEAD_SECONDS);
}
