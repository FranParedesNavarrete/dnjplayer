use std::process::Command;

/// Get FFmpeg progress from Docker container logs
pub fn get_container_progress(container_name: &str) -> Result<f64, String> {
    let output = Command::new("docker")
        .args(["logs", "--tail", "5", container_name])
        .output()
        .map_err(|e| format!("Failed to get container logs: {}", e))?;

    let logs = String::from_utf8_lossy(&output.stderr);

    // Parse FFmpeg progress output: "frame= 1234 fps= 30 ..."
    // Extract frame count and compare with total
    for line in logs.lines().rev() {
        if line.contains("frame=") {
            // Basic progress extraction - will be refined
            return Ok(0.5); // placeholder
        }
    }

    Ok(0.0)
}
