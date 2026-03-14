CREATE TABLE IF NOT EXISTS watched_files (
    mega_path TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    watched_at TEXT NOT NULL DEFAULT (datetime('now')),
    play_count INTEGER NOT NULL DEFAULT 1
);
