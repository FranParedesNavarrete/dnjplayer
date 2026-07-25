// Persisted local folders (the "roots" the user pinned in the sidebar).
//
// Backed by the `local_roots` table (migration 005). This is only about the
// user's own picks; the machine's drives/volumes come from the Rust side
// (`localListRoots` in local-service.ts).

import { getDb } from './db-service';

export interface SavedRoot {
	path: string;
	label: string;
	added_at: string;
}

/** All folders the user saved, oldest first. */
export async function getSavedRoots(): Promise<SavedRoot[]> {
	const database = await getDb();
	return database.select('SELECT path, label, added_at FROM local_roots ORDER BY added_at ASC');
}

/**
 * Save a folder. Idempotent: re-adding the same path just refreshes its label.
 *
 * `ON CONFLICT … DO UPDATE` and not `INSERT OR REPLACE`: the latter deletes the
 * row and inserts a new one, so `added_at` would be re-defaulted to
 * `datetime('now')` and the folder would jump to the end of the `added_at ASC`
 * ordering — a re-add is not a re-creation.
 */
export async function addSavedRoot(path: string, label: string): Promise<void> {
	const database = await getDb();
	await database.execute(
		'INSERT INTO local_roots (path, label) VALUES ($1, $2) ON CONFLICT(path) DO UPDATE SET label = excluded.label',
		[path, label]
	);
}

export async function removeSavedRoot(path: string): Promise<void> {
	const database = await getDb();
	await database.execute('DELETE FROM local_roots WHERE path = $1', [path]);
}
