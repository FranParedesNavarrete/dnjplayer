use super::client;
use std::process::Command;

/// Check if mega-cmd-server is running and responsive
pub fn is_server_running() -> bool {
    client::exec(&["version"]).is_ok()
}

/// Check if MEGAcmd is installed on the system
pub fn is_installed() -> bool {
    client::is_available()
}

/// Start mega-cmd-server as a background process.
/// If already running, returns Ok immediately.
pub fn ensure_server() -> Result<(), String> {
    if is_server_running() {
        return Ok(());
    }

    // Try to start the server
    // On macOS: /Applications/MEGAcmd.app/Contents/MacOS/mega-cmd-server
    // On Linux: mega-cmd-server (in PATH)
    let server_paths = [
        "mega-cmd-server",
        "/Applications/MEGAcmd.app/Contents/MacOS/mega-cmd-server",
    ];

    let mut last_err = String::from("No server binary found");

    for path in &server_paths {
        match Command::new(path).spawn() {
            Ok(_) => {
                // Wait for server to become responsive
                for _ in 0..10 {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if is_server_running() {
                        return Ok(());
                    }
                }
                return Err("mega-cmd-server started but not responding after 5s".to_string());
            }
            Err(e) => {
                last_err = format!("Failed to start '{}': {}", path, e);
                continue;
            }
        }
    }

    Err(last_err)
}

/// Check if user is logged in
pub fn is_logged_in() -> bool {
    client::exec(&["whoami"]).is_ok()
}
