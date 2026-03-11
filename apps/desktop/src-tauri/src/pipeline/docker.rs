use std::process::Command;

/// Check if Docker is installed and running
pub fn is_docker_available() -> bool {
    Command::new("docker")
        .arg("info")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Start a processing job in a Docker container
pub fn start_processing_container(
    job_id: &str,
    input_url: &str,
    output_dir: &str,
    shader_path: &str,
    target_width: u32,
    target_height: u32,
) -> Result<String, String> {
    let output = Command::new("docker")
        .args([
            "run",
            "-d",
            "--gpus",
            "all",
            "--name",
            &format!("dnjplayer-{}", job_id),
            "-v",
            &format!("{}:/output", output_dir),
            "-e",
            &format!("INPUT_URL={}", input_url),
            "-e",
            &format!("OUTPUT_FILE=/output/{}.mkv", job_id),
            "-e",
            &format!("TARGET_W={}", target_width),
            "-e",
            &format!("TARGET_H={}", target_height),
            "-e",
            &format!("SHADER_PATH={}", shader_path),
            "--network",
            "host",
            "dnjplayer/processor:latest",
        ])
        .output()
        .map_err(|e| format!("Docker run failed: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Stop and remove a processing container
pub fn stop_container(job_id: &str) -> Result<(), String> {
    let container_name = format!("dnjplayer-{}", job_id);
    Command::new("docker")
        .args(["stop", &container_name])
        .output()
        .ok();
    Command::new("docker")
        .args(["rm", &container_name])
        .output()
        .ok();
    Ok(())
}
