// Database service - wraps tauri-plugin-sql for common queries
// The SQL plugin is accessed directly from the frontend

let db: any = null;

export async function getDb() {
	if (db) return db;
	// TODO: Initialize when tauri-plugin-sql is properly set up
	// const Database = (await import('@tauri-apps/plugin-sql')).default;
	// db = await Database.load('sqlite:dnjplayer.db');
	return db;
}

export async function getSetting(key: string): Promise<string | null> {
	const database = await getDb();
	if (!database) return null;
	const result = await database.select('SELECT value FROM settings WHERE key = $1', [key]);
	return result.length > 0 ? result[0].value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
	const database = await getDb();
	if (!database) return;
	await database.execute(
		'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
		[key, value]
	);
}
