// Database service - wraps tauri-plugin-sql for common queries
// The SQL plugin is accessed directly from the frontend

import Database from '@tauri-apps/plugin-sql';

let db: Database | null = null;

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

export async function markWatched(megaPath: string, filename: string): Promise<void> {
	const database = await getDb();
	await database.execute(
		`INSERT INTO watched_files (mega_path, filename) VALUES ($1, $2)
		 ON CONFLICT(mega_path) DO UPDATE SET
		   play_count = play_count + 1,
		   watched_at = datetime('now')`,
		[megaPath, filename]
	);
}

export async function getWatchedPaths(): Promise<Set<string>> {
	const database = await getDb();
	const rows: { mega_path: string }[] = await database.select(
		'SELECT mega_path FROM watched_files'
	);
	return new Set(rows.map((r) => r.mega_path));
}

// --- History ---

import type { HistoryEntry, FavoriteEntry } from '$lib/types/history';

export async function getHistory(limit = 100): Promise<HistoryEntry[]> {
	const database = await getDb();
	return database.select(
		'SELECT mega_path, filename, watched_at, play_count FROM watched_files ORDER BY watched_at DESC LIMIT $1',
		[limit]
	);
}

export async function removeFromHistory(megaPath: string): Promise<void> {
	const database = await getDb();
	await database.execute('DELETE FROM watched_files WHERE mega_path = $1', [megaPath]);
}

export async function clearHistory(): Promise<void> {
	const database = await getDb();
	await database.execute('DELETE FROM watched_files');
}

// --- Favorites ---

export async function getFavorites(): Promise<FavoriteEntry[]> {
	const database = await getDb();
	return database.select(
		'SELECT mega_path, filename, entry_type, favorited_at FROM favorites ORDER BY favorited_at DESC'
	);
}

export async function getFavoritePaths(): Promise<Set<string>> {
	const database = await getDb();
	const rows: { mega_path: string }[] = await database.select(
		'SELECT mega_path FROM favorites'
	);
	return new Set(rows.map((r) => r.mega_path));
}

export async function toggleFavorite(megaPath: string, filename: string, entryType: 'file' | 'folder'): Promise<boolean> {
	const database = await getDb();
	const existing: { mega_path: string }[] = await database.select(
		'SELECT mega_path FROM favorites WHERE mega_path = $1',
		[megaPath]
	);
	if (existing.length > 0) {
		await database.execute('DELETE FROM favorites WHERE mega_path = $1', [megaPath]);
		return false; // removed
	} else {
		await database.execute(
			'INSERT INTO favorites (mega_path, filename, entry_type) VALUES ($1, $2, $3)',
			[megaPath, filename, entryType]
		);
		return true; // added
	}
}

export async function removeFavorite(megaPath: string): Promise<void> {
	const database = await getDb();
	await database.execute('DELETE FROM favorites WHERE mega_path = $1', [megaPath]);
}
