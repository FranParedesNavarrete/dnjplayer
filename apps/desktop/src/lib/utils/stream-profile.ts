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
	// 256 MiB forward (mpv default 150 MiB) ~= 4 minutes of a 1080p anime encode
	// at ~8 Mbps. That is the window MEGAcmd has to recover from a stall before
	// the user sees anything. Nuvio uses 150 MiB (macOS) / 512 MiB (Windows);
	// 512 MiB forward + 256 MiB back is 3/4 GiB of resident memory for a desktop
	// player, which is a bad trade for the extra 4 minutes.
	'demuxer-max-bytes': '256MiB',
	// 128 MiB back (mpv default 50 MiB) ~= 2 minutes. A back-seek inside it is
	// served from memory instead of re-downloading over HTTP.
	'demuxer-max-back-bytes': '128MiB',
	// The byte caps above are the real limit; this is only a second ceiling, set
	// explicitly so behaviour does not depend on the mpv version's default.
	// An hour of readahead is never reached before 256 MiB is.
	'cache-secs': '3600',
	// Only binds if the stream cache is ever off (`cache-secs` overrides it when
	// the cache is on and larger). Kept as the floor for that case; mpv's default
	// of 1 s is a file-on-a-local-disk figure.
	'demuxer-readahead-secs': '20',
	// Seek inside the cached range instead of issuing a new HTTP request. mpv's
	// `auto` skips this for seekable streams — but "seekable" over WebDAV means a
	// fresh range request to a server that is itself downloading from Mega.
	'demuxer-seekable-cache': 'yes',
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
