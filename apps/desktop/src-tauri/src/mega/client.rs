use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Timeout for MEGAcmd commands (seconds).
/// WebDAV serve can take a few seconds; 15s is generous but prevents infinite hangs.
const COMMAND_TIMEOUT_SECS: u64 = 15;

/// Return platform-specific candidate paths for a given MEGAcmd binary name.
/// Tries PATH first, then known install locations per platform.
fn binary_candidates(binary: &str) -> Vec<String> {
    let mut candidates = vec![binary.to_string()];

    #[cfg(target_os = "windows")]
    {
        // Windows uses different binary names: MEGAclient for mega-exec
        if binary == "mega-exec" {
            candidates.insert(0, "MEGAclient".to_string());
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(format!("{}\\MEGAcmd\\{}.exe", local, binary));
            if binary == "mega-exec" {
                candidates.push(format!("{}\\MEGAcmd\\MEGAclient.exe", local));
            }
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            candidates.push(format!("{}\\MEGAcmd\\{}.exe", pf, binary));
            if binary == "mega-exec" {
                candidates.push(format!("{}\\MEGAcmd\\MEGAclient.exe", pf));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(format!(
            "/Applications/MEGAcmd.app/Contents/MacOS/{}",
            binary
        ));
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push(format!("/usr/bin/{}", binary));
        candidates.push(format!("/usr/local/bin/{}", binary));
    }

    candidates
}

/// Execute a MEGAcmd command and return stdout.
/// Uses `mega-exec` which communicates with the running mega-cmd-server.
/// Tries platform-specific paths for binaries if PATH lookup fails.
/// All commands have a 15-second timeout to prevent infinite hangs.
pub fn exec(args: &[&str]) -> Result<String, String> {
    // Try mega-exec first (single binary that dispatches)
    let result = try_exec("mega-exec", args);
    if result.is_ok() {
        return result;
    }

    // Fallback: try individual mega-<command> binary (e.g., mega-ls, mega-login)
    if let Some((cmd, rest)) = args.split_first() {
        let mega_cmd = format!("mega-{}", cmd);
        let fallback = try_exec(&mega_cmd, rest);
        if fallback.is_ok() {
            return fallback;
        }
    }

    // Return original error
    result
}

/// Try executing a binary with the given args, checking all platform-specific paths.
/// Uses spawn + try_wait polling with a timeout instead of blocking .output().
fn try_exec(binary: &str, args: &[&str]) -> Result<String, String> {
    let candidates = binary_candidates(binary);
    let mut last_err = format!(
        "MEGAcmd not found (tried '{}'). Install from https://mega.io/cmd",
        binary
    );

    for candidate in &candidates {
        match Command::new(candidate)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(mut child) => {
                let timeout = Duration::from_secs(COMMAND_TIMEOUT_SECS);
                let start = Instant::now();

                loop {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            let mut stdout_buf = String::new();
                            let mut stderr_buf = String::new();
                            if let Some(mut out) = child.stdout.take() {
                                let _ = out.read_to_string(&mut stdout_buf);
                            }
                            if let Some(mut err) = child.stderr.take() {
                                let _ = err.read_to_string(&mut stderr_buf);
                            }
                            let stdout = stdout_buf.trim().to_string();
                            let stderr = stderr_buf.trim().to_string();

                            if status.success() {
                                return Ok(stdout);
                            } else {
                                let msg = if stderr.is_empty() { stdout } else { stderr };
                                return Err(format!("MEGAcmd error: {}", msg));
                            }
                        }
                        Ok(None) => {
                            // Still running — check timeout
                            if start.elapsed() > timeout {
                                let _ = child.kill();
                                let _ = child.wait();
                                return Err(format!(
                                    "MEGAcmd command timed out after {}s: {} {}",
                                    COMMAND_TIMEOUT_SECS,
                                    candidate,
                                    args.join(" ")
                                ));
                            }
                            std::thread::sleep(Duration::from_millis(50));
                        }
                        Err(e) => {
                            return Err(format!("Error waiting for '{}': {}", candidate, e));
                        }
                    }
                }
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    last_err = format!(
                        "MEGAcmd not found (tried '{}'). Install from https://mega.io/cmd",
                        candidate
                    );
                    continue; // Try next candidate
                } else {
                    return Err(format!("Failed to execute '{}': {}", candidate, e));
                }
            }
        }
    }

    Err(last_err)
}

/// Check if MEGAcmd binaries are available on the system.
/// Tries platform-specific paths in addition to PATH.
pub fn is_available() -> bool {
    // Try mega-exec with all platform paths
    for candidate in &binary_candidates("mega-exec") {
        if Command::new(candidate)
            .arg("version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .and_then(|mut c| c.wait())
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return true;
        }
    }
    // Fallback: try mega-version with all platform paths
    for candidate in &binary_candidates("mega-version") {
        if Command::new(candidate)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .and_then(|mut c| c.wait())
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return true;
        }
    }
    false
}

/// Get MEGAcmd version string
pub fn version() -> Result<String, String> {
    exec(&["version"])
}
