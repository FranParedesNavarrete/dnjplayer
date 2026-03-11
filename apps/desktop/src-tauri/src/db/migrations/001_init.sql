CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mega_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS library (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    mega_remote_path TEXT NOT NULL,
    local_cached_path TEXT,
    duration_seconds REAL,
    source_resolution TEXT,
    processed_resolution TEXT,
    shader_mode_used TEXT,
    last_played_at TEXT,
    playback_position REAL DEFAULT 0.0,
    added_at TEXT NOT NULL,
    video_adjustments_json TEXT
);

CREATE TABLE IF NOT EXISTS video_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    brightness INTEGER DEFAULT 0,
    contrast INTEGER DEFAULT 0,
    saturation INTEGER DEFAULT 0,
    gamma INTEGER DEFAULT 0,
    hue INTEGER DEFAULT 0,
    deband INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shader_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mode TEXT NOT NULL,
    variant TEXT NOT NULL,
    shaders_json TEXT NOT NULL,
    is_default INTEGER DEFAULT 0
);
