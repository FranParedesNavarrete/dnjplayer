// Database service - wraps tauri-plugin-sql for common queries
// The SQL plugin is accessed directly from the frontend

import Database from '@tauri-apps/plugin-sql';

let db: Database | null = null;

// --- Source-aware row keys ---
//
// `toDbKey()` / `parseSourceKey()` live in `$lib/utils/source-key` (pure, unit
// tested) and are re-exported here so callers keep importing them from the DB
// service. Read the header of that file before touching the key format.
export { toDbKey, parseSourceKey } from '$lib/utils/source-key';

export async function getDb(): Promise<Database> {
	if (db) return db;
	db = await Database.load('sqlite:dnjplayer.db');
	return db;
}

export async function getSetting(key: string): Promise<string | null> {
	const database = await getDb();
	const result: { value: string }[] = await database.select(
		'SELECT value FROM settings WHERE key = $1',
		[key]
	);
	return result.length > 0 ? result[0].value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
	const database = await getDb();
	await database.execute(
		'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
		[key, value]
	);
}

// --- Watched files ---
//
// Every function below that takes or returns a `key` deals in STORED ROW KEYS,
// not bare paths: callers wrap local paths with toDbKey('local', path) and pass
// Mega paths through unchanged. Passing a bare local path would silently write
// or delete the wrong row (and could collide with a Mega path).

/** @param key Stored row key (see {@link toDbKey}), not a bare path. */
export async function markWatched(key: string, filename: string): Promise<void> {
	const database = await getDb();
	await database.execute(
		`INSERT INTO watched_files (mega_path, filename) VALUES ($1, $2)
		 ON CONFLICT(mega_path) DO UPDATE SET
		   play_count = play_count + 1,
		   watched_at = datetime('now')`,
		[key, filename]
	);
}

// --- Resume position ---
//
// Columns added by migration 006 on `watched_files`, keyed by the same
// source-namespaced row key as everything else in this file. A row may exist
// with a NULL position (watched from an older build, or finished), which reads
// back as "no resume point".

/** A stored resume point. `durationSeconds` is null for rows written without one. */
export interface ResumePoint {
	positionSeconds: number;
	durationSeconds: number | null;
}

/**
 * Store (or refresh) the resume point for a file.
 *
 * Upserts, so it also works for a file that was never marked watched -- without
 * touching `play_count`, which belongs to "the user started this", not to "the
 * user is still at minute 12". `watched_at` IS refreshed: a file you are still
 * watching is the most recent thing in your history.
 *
 * The caller decides whether a position is worth storing; see
 * {@link import('$lib/utils/resume').shouldStorePosition}. Use
 * {@link clearPlaybackPosition} for the "finished / start over" case.
 *
 * @param key Stored row key (see {@link toDbKey}), not a bare path.
 */
export async function savePlaybackPosition(
	key: string,
	filename: string,
	positionSeconds: number,
	durationSeconds: number | null
): Promise<void> {
	const database = await getDb();
	await database.execute(
		`INSERT INTO watched_files (mega_path, filename, position_seconds, duration_seconds)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT(mega_path) DO UPDATE SET
		   position_seconds = excluded.position_seconds,
		   duration_seconds = excluded.duration_seconds,
		   watched_at = datetime('now')`,
		[key, filename, positionSeconds, durationSeconds]
	);
}

/**
 * Read back a resume point, or null when there is no row or the row has no
 * position. Run the result through
 * {@link import('$lib/utils/resume').resumePositionFor} before seeking: a stored
 * position is not automatically a valid one.
 *
 * @param key Stored row key (see {@link toDbKey}), not a bare path.
 */
export async function getPlaybackPosition(key: string): Promise<ResumePoint | null> {
	const database = await getDb();
	const rows: { position_seconds: number | null; duration_seconds: number | null }[] =
		await database.select(
			'SELECT position_seconds, duration_seconds FROM watched_files WHERE mega_path = $1',
			[key]
		);
	const row = rows[0];
	if (!row || row.position_seconds == null) return null;
	return { positionSeconds: row.position_seconds, durationSeconds: row.duration_seconds };
}

/**
 * Drop the resume point while keeping the history row. Used when a file is
 * watched to the end, so the next play starts from the beginning instead of
 * jumping to the last 30 seconds.
 *
 * A no-op when the row doesn't exist -- deliberately: "finished a file we never
 * recorded" must not create a history entry as a side effect.
 *
 * @param key Stored row key (see {@link toDbKey}), not a bare path.
 */
export async function clearPlaybackPosition(key: string): Promise<void> {
	const database = await getDb();
	await database.execute(
		'UPDATE watched_files SET position_seconds = NULL WHERE mega_path = $1',
		[key]
	);
}

/**
 * Set of stored row keys of everything watched. Membership tests must build the
 * key the same way: `watched.has(toDbKey(source, path))`.
 */
export async function getWatchedPaths(): Promise<Set<string>> {
	const database = await getDb();
	const rows: { mega_path: string }[] = await database.select(
		'SELECT mega_path FROM watched_files'
	);
	return new Set(rows.map((r) => r.mega_path));
}

// --- History ---

import type { HistoryEntry, FavoriteEntry } from '$lib/types/history';

/**
 * Newest-first history. Rows carry the raw stored key in `mega_path`, which may
 * belong to either source -- run it through {@link parseSourceKey} before
 * playing or displaying it.
 */
export async function getHistory(limit = 100): Promise<HistoryEntry[]> {
	const database = await getDb();
	return database.select(
		'SELECT mega_path, filename, watched_at, play_count FROM watched_files ORDER BY watched_at DESC LIMIT $1',
		[limit]
	);
}

/** @param key Stored row key (see {@link toDbKey}), not a bare path. */
export async function removeFromHistory(key: string): Promise<void> {
	const database = await getDb();
	await database.execute('DELETE FROM watched_files WHERE mega_path = $1', [key]);
}

export async function clearHistory(): Promise<void> {
	const database = await getDb();
	await database.execute('DELETE FROM watched_files');
}

// --- Favorites ---

/**
 * All favorites, newest first. Like {@link getHistory}, `mega_path` is the raw
 * stored key of either source -- decode it with {@link parseSourceKey}.
 */
export async function getFavorites(): Promise<FavoriteEntry[]> {
	const database = await getDb();
	return database.select(
		'SELECT mega_path, filename, entry_type, favorited_at FROM favorites ORDER BY favorited_at DESC'
	);
}

/**
 * Set of stored row keys of every favorite. Test membership with
 * `favorites.has(toDbKey(source, path))`.
 */
export async function getFavoritePaths(): Promise<Set<string>> {
	const database = await getDb();
	const rows: { mega_path: string }[] = await database.select(
		'SELECT mega_path FROM favorites'
	);
	return new Set(rows.map((r) => r.mega_path));
}

/**
 * Add or remove a favorite.
 *
 * @param key Stored row key (see {@link toDbKey}), not a bare path.
 * @returns `true` if it was added, `false` if it was removed.
 */
export async function toggleFavorite(key: string, filename: string, entryType: 'file' | 'folder'): Promise<boolean> {
	const database = await getDb();
	const existing: { mega_path: string }[] = await database.select(
		'SELECT mega_path FROM favorites WHERE mega_path = $1',
		[key]
	);
	if (existing.length > 0) {
		await database.execute('DELETE FROM favorites WHERE mega_path = $1', [key]);
		return false; // removed
	} else {
		await database.execute(
			'INSERT INTO favorites (mega_path, filename, entry_type) VALUES ($1, $2, $3)',
			[key, filename, entryType]
		);
		return true; // added
	}
}

/** @param key Stored row key (see {@link toDbKey}), not a bare path. */
export async function removeFavorite(key: string): Promise<void> {
	const database = await getDb();
	await database.execute('DELETE FROM favorites WHERE mega_path = $1', [key]);
}
