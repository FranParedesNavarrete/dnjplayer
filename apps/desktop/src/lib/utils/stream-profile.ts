// Network / demuxer profile for mpv, as pure data.
//
// Until now `buildMpvConfig()` passed six options and not one of them concerned
// the network, so a Mega WebDAV stream ran on mpv's file-oriented defaults:
// a 150 MiB demuxer cache that HTTP seeks could not reuse, and a 60 s read
// timeout — a full minute of a frozen, unexplained picture when MEGAcmd dies.
//
// Both profiles below set the SAME keys with explicit values, so switching from
// a Mega stream to a local file (or back) fully resets the previous one. That
// also makes playback independent of mpv's own defaults, which have moved
// between versions (`cache-secs` was 10 in older mpv, 3600000 in 0.41).
//
// WHY setProperty BEFORE loadfile, and not loadfile's per-file options argument:
//  - `loadfile <url> [<flags> [<index> [<options>]]]` grew its `index` argument
//    in mpv 0.38, so the position of the options list is version-dependent;
//    getting it wrong silently changes what the other arguments mean.
//  - the options list is one comma/equals-delimited string that needs escaping
//    for values, and a single typo fails the whole load with no diagnostic.
//  - the only thing per-file options buy is not leaking settings between files,
//    and writing the full profile before every load already guarantees that.
// These are all ordinary runtime-settable mpv properties (verified against
// `mpv --list-properties`), and the demuxer for the next file is created after
// we write them, so it picks them up.

/** Streams served by MEGAcmd's WebDAV server, i.e. `http://127.0.0.1:4443/...`. */
export const REMOTE_STREAM_OPTIONS: Record<string, string> = {
	// Force the stream cache on. `auto` would already enable it for HTTP, but
	// this profile only makes sense with a cache and says so.
	'cache': 'yes',
	// The readahead is capped by TIME here and by bytes only as a memory ceiling,
	// which is the opposite of how it was set before and is deliberate.
	//
	// Measured 2026-09-27 against the user's own content (a 1.24 GB, ~22 min
	// 1080p episode = 0.94 MB/s) served by MEGAcmd over WebDAV:
	//   - supply is 1.7-3.0 MB/s, i.e. 1.8x-3.2x the bitrate: the network is not
	//     the bottleneck, and the cache reaches its cap within 30 seconds;
	//   - with the old 256 MiB cap the cache pinned at 278 s and never moved,
	//     because 256 MiB IS 4.6 minutes at this bitrate. That cap, not the
	//     network, is why pausing to "let it load" stopped gaining anything at
	//     ~6 minutes: mpv had filled the cache and simply stopped reading.
	// The user's stalls came in bursts ~16 minutes apart with nothing in the app
	// happening around them, which means supply outages longer than that 4.6
	// minute cushion. So the cushion is the thing to grow.
	//
	// `cache-secs` is the intent (20 minutes of video, whatever it weighs) and
	// `demuxer-max-bytes` is the safety net (a 4K file would otherwise ask for
	// far more RAM to hold 20 minutes). Whichever binds first wins: for 1080p
	// anime that is the time, which is what was asked for.
	//
	// 20 minutes is close to a whole episode of this material, and that is the
	// point. Measured on a file MEGAcmd had never downloaded: the demuxer read
	// at 7.9x the bitrate and had the ENTIRE 24-minute file cached 46 seconds
	// into playback, with no stall. Throughput varies enormously though — a
	// `curl` of the same server minutes earlier measured 3 MB/s against this
	// run's ~27 MB/s — and that variance is the whole argument for a big
	// cushion: when the network is good mpv banks the episode, and when it goes
	// bad (the user's stalls arrived in bursts ~16 minutes apart) there is
	// something to spend.
	//
	// Worth knowing when reasoning about this: MEGAcmd does not stream, it
	// DOWNLOADS the file to ~/.megaCmd while serving it over WebDAV. So the real
	// supply limit is its download, not the WebDAV read, and re-reading a file it
	// already holds is served from local disk at disk speed. Benchmarks that
	// reuse the same file therefore measure the wrong thing.
	'cache-secs': '1200',
	'demuxer-max-bytes': '2GiB',
	// Halved from 128 MiB to part-fund the forward cache. Back-seeks inside the
	// cached range are served from memory, but they are rare next to the cost of
	// a mid-playback stall, and the queue pre-open means TWO demuxers can be
	// alive at once.
	'demuxer-max-back-bytes': '64MiB',
	// Only binds if the stream cache is ever off (`cache-secs` overrides it when
	// the cache is on and larger). Kept as the floor for that case; mpv's default
	// of 1 s is a file-on-a-local-disk figure.
	'demuxer-readahead-secs': '20',
	// Seek inside the cached range instead of issuing a new HTTP request. mpv's
	// `auto` skips this for seekable streams — but "seekable" over WebDAV means a
	// fresh range request to a server that is itself downloading from Mega.
	'demuxer-seekable-cache': 'yes',
	// How much must be buffered before playback RESUMES after running dry. mpv's
	// default is 1 second, and that default is what made a supply hiccup read as
	// "buffering all the time": with a source delivering at roughly playback rate,
	// resuming on a one-second cushion runs dry again within seconds, so a single
	// ~30 s supply gap surfaced as five or six separate stalls with the badge
	// flashing between them (measured from a user's log, 2026-09-25: bursts of 3-6
	// stalls of 1.5-8 s each, ~16 minutes apart, none of them at a file boundary).
	// Waiting for a real cushion turns that burst into ONE pause, after which
	// playback has 20 s of slack to absorb the next gap instead of none.
	// It costs nothing when the network is keeping up: the property is only
	// consulted once the cache has already run dry.
	'cache-pause-wait': '20',
	// mpv's default is 60 s. The WebDAV server is on loopback and buffers ahead,
	// so 20 s without a single byte means it is gone or wedged, not slow. Cutting
	// this to a third turns a minute of frozen picture into a prompt `end-file`
	// error, which is what raises the toast and triggers the URL re-resolve in
	// handleLoadError().
	'network-timeout': '20',
};

/** Local files: mpv's own defaults for this mpv (0.41), written out explicitly. */
export const LOCAL_FILE_OPTIONS: Record<string, string> = {
	'cache': 'auto', // = disabled for local files
	'demuxer-max-bytes': '150MiB',
	'demuxer-max-back-bytes': '50MiB',
	'cache-secs': '3600000',
	'demuxer-readahead-secs': '1',
	'demuxer-seekable-cache': 'auto',
	// mpv's own default: a local file that runs dry has a real problem, and
	// waiting 20 s would not fix it.
	'cache-pause-wait': '1',
	'network-timeout': '60',
};

/**
 * Is this something mpv will open over the network?
 *
 * Everything the app plays is either an absolute local path
 * or an `http://127.0.0.1:4443/...` WebDAV URL, so a scheme test is enough;
 * `file://` is not produced anywhere (see utils/source-key.ts — the `file://`
 * there is a DB key, never a URL handed to mpv).
 */
export function isRemoteUrl(url: string): boolean {
	return /^https?:\/\//i.test(url);
}


/**
 * The full set of mpv properties to write before a `loadfile` of `url`.
 *
 * Both profiles carry the SAME keys, which is what guarantees that switching
 * between a Mega stream and a local file fully resets the previous one instead
 * of leaving half of it behind.
 */
export function streamProfileFor(url: string): Record<string, string> {
	return isRemoteUrl(url) ? REMOTE_STREAM_OPTIONS : LOCAL_FILE_OPTIONS;
}
