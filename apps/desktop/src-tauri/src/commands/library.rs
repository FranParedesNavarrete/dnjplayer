use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct LibraryItem {
    pub id: String,
    pub title: String,
    pub mega_remote_path: String,
    pub local_cached_path: Option<String>,
    pub duration_seconds: Option<f64>,
    pub source_resolution: Option<String>,
    pub processed_resolution: Option<String>,
    pub playback_position: f64,
    pub added_at: String,
}

#[tauri::command]
pub async fn get_library() -> Result<Vec<LibraryItem>, String> {
    // TODO: Query SQLite via tauri-plugin-sql from frontend
    // This is a placeholder - actual queries will go through the SQL plugin directly
    Ok(Vec::new())
}

#[tauri::command]
pub async fn update_playback_position(id: String, position: f64) -> Result<(), String> {
    // TODO: Will be handled via SQL plugin from frontend
    let _ = (id, position);
    Ok(())
}
