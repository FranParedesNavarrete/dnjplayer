CREATE TABLE IF NOT EXISTS local_roots (
    path TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
