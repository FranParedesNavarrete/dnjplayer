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
