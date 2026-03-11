use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessingJob {
    pub id: String,
    pub mega_remote_path: String,
    pub target_resolution: String,
    pub shader_mode: String,
    pub status: String,
    pub progress: f64,
    pub error_message: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub async fn submit_job(
    mega_remote_path: String,
    target_resolution: String,
    shader_mode: String,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();
    // TODO: Insert into SQLite, spawn Docker container
    let _ = (mega_remote_path, target_resolution, shader_mode);
    Ok(job_id)
}

#[tauri::command]
pub async fn get_jobs() -> Result<Vec<ProcessingJob>, String> {
    // TODO: Query SQLite
    Ok(Vec::new())
}

#[tauri::command]
pub async fn cancel_job(job_id: String) -> Result<(), String> {
    // TODO: Stop Docker container, update SQLite
    let _ = job_id;
    Ok(())
}
