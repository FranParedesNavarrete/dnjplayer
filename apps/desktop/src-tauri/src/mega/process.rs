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

/// Return platform-specific candidate paths for the mega-cmd-server binary.
fn server_candidates() -> Vec<String> {
    let mut candidates = Vec::new();

    // Always try PATH lookup first
    candidates.push("mega-cmd-server".to_string());

    #[cfg(target_os = "windows")]
    {
        // Windows uses MEGAcmdServer.exe as the binary name
        candidates.insert(0, "MEGAcmdServer".to_string());
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(format!("{}\\MEGAcmd\\MEGAcmdServer.exe", local));
            candidates.push(format!("{}\\MEGAcmd\\mega-cmd-server.exe", local));
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            candidates.push(format!("{}\\MEGAcmd\\MEGAcmdServer.exe", pf));
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push("/Applications/MEGAcmd.app/Contents/MacOS/mega-cmd-server".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push("/usr/bin/mega-cmd-server".to_string());
        candidates.push("/usr/local/bin/mega-cmd-server".to_string());
    }

    candidates
}

/// Platform-specific install instructions for error messages.
fn install_hint() -> &'static str {
    #[cfg(target_os = "windows")]
    { return "Install MEGAcmd from https://mega.io/cmd (Windows installer)"; }
    #[cfg(target_os = "macos")]
    { return "Install MEGAcmd from https://mega.io/cmd or: brew install --cask megacmd"; }
    #[cfg(target_os = "linux")]
    { return "Install MEGAcmd: https://mega.io/cmd (available as .deb, .rpm, etc.)"; }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    { "Install MEGAcmd from https://mega.io/cmd" }
}

/// Start mega-cmd-server as a background process.
/// If already running, returns Ok immediately.
/// Tries platform-specific paths: macOS app bundle, Windows %LOCALAPPDATA%, Linux /usr/bin.
pub fn ensure_server() -> Result<(), String> {
    if is_server_running() {
        return Ok(());
    }

    let candidates = server_candidates();
    let mut last_err = String::from("No server binary found");

    for path in &candidates {
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

    Err(format!("{}. {}", last_err, install_hint()))
}

/// Check if user is logged in
pub fn is_logged_in() -> bool {
    client::exec(&["whoami"]).is_ok()
}
