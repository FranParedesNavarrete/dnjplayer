// Source-aware row keys for `watched_files` and `favorites`.
//
// Both tables key rows on `mega_path TEXT PRIMARY KEY`, with no format
// constraint. To store local files alongside Mega ones in those same tables
// (no schema change, no data migration), we namespace the key:
//
//   - Mega paths are stored BARE:            `/Movies/a.mkv`
//   - Local paths are stored with a prefix:  `file:///Movies/a.mkv`
//
// i.e. NO SCHEME MEANS MEGA. That keeps every row a user already has valid, and
// stops a local `/Movies/a.mkv` from colliding with the Mega file of the same
// path.
//
// CRITICAL: `file://` + the raw path is an OPAQUE IDENTIFIER, **not** a URI.
// The path is concatenated verbatim: no URL-encoding, no separator conversion,
// no host component. On Windows this literally produces
// `file://C:\Videos\a.mkv` (backslashes and all). That is intentional and must
// stay that way -- turning these keys into real RFC 8089 file URIs would change
// the key for every already-stored row and silently wipe users' existing
// history and favorites. Never feed these keys to a URL parser; use
// parseSourceKey() and hand the resulting bare path to the filesystem/mpv.
//
// This lives outside db-service.ts so it can be unit-tested in plain Node:
// db-service imports `@tauri-apps/plugin-sql`, which only loads inside Tauri.
// db-service re-exports both helpers, so existing callers are unaffected.

import type { MediaSource } from '$lib/types/player';

const LOCAL_KEY_PREFIX = 'file://';

/**
 * Build the DB row key for a media item.
 *
 * @param source `'mega'` -> key is the bare path; `'local'` -> key is
 *   `file://` + the raw path (opaque identifier, see the note above).
 * @param path The Mega remote path or the absolute local filesystem path.
 */
export function toDbKey(source: MediaSource, path: string): string {
	return source === 'local' ? `${LOCAL_KEY_PREFIX}${path}` : path;
}

/**
 * Inverse of {@link toDbKey}: split a stored row key back into its source and
 * its raw path.
 *
 * A key without the `file://` prefix is a Mega path -- which is also what makes
 * this backwards compatible with rows written before local playback existed.
 */
export function parseSourceKey(key: string): { source: MediaSource; path: string } {
	if (key.startsWith(LOCAL_KEY_PREFIX)) {
		return { source: 'local', path: key.slice(LOCAL_KEY_PREFIX.length) };
	}
	return { source: 'mega', path: key };
}
