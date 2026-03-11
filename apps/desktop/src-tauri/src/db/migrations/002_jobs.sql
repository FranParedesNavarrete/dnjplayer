CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY,
    library_id TEXT REFERENCES library(id),
    mega_remote_path TEXT NOT NULL,
    target_resolution TEXT NOT NULL,
    shader_mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    progress REAL DEFAULT 0.0,
    output_path TEXT,
    output_size_bytes INTEGER,
    docker_container_id TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
);
