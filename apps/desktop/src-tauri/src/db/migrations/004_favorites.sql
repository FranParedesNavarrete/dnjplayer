CREATE TABLE IF NOT EXISTS favorites (
    mega_path TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    entry_type TEXT NOT NULL DEFAULT 'file',
    favorited_at TEXT NOT NULL DEFAULT (datetime('now'))
);
