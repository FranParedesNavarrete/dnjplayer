// Job queue management - backed by SQLite via tauri-plugin-sql
// Queue operations are primarily handled from the frontend via the SQL plugin
// This module provides Rust-side helpers for the processing pipeline

pub const STATUS_QUEUED: &str = "queued";
pub const STATUS_DOWNLOADING: &str = "downloading";
pub const STATUS_PROCESSING: &str = "processing";
pub const STATUS_COMPLETED: &str = "completed";
pub const STATUS_FAILED: &str = "failed";
pub const STATUS_CANCELLED: &str = "cancelled";
