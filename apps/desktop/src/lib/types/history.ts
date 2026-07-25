// Rows in `watched_files` and `favorites` are shared by both media sources, so
// their primary key is source-namespaced instead of being a plain Mega path.
// See `toDbKey` / `parseSourceKey` in `$lib/services/db-service` -- always run a
// stored key through `parseSourceKey()` before using it; assuming Mega breaks
// every local row.

export interface HistoryEntry {
	/**
	 * Source-namespaced row key, NOT necessarily a Mega path (the column name is
	 * historical). Bare = Mega remote path; `file://`-prefixed = local file.
	 *
	 * The `file://` form is an OPAQUE IDENTIFIER, not a URI: the raw path is
	 * concatenated verbatim, so on Windows it reads `file://C:\Videos\a.mkv`.
	 * Never parse it as a URL and never display it as-is -- use
	 * `parseSourceKey()` and show the bare path.
	 */
	mega_path: string;
	filename: string;
	watched_at: string;
	play_count: number;
}

export interface FavoriteEntry {
	/** Source-namespaced row key. See {@link HistoryEntry.mega_path}. */
	mega_path: string;
	filename: string;
	entry_type: 'file' | 'folder';
	favorited_at: string;
}
