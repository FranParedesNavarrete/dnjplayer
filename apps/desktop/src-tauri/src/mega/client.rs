use std::process::Command;

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
fn try_exec(binary: &str, args: &[&str]) -> Result<String, String> {
    let candidates = binary_candidates(binary);
    let mut last_err = format!(
        "MEGAcmd not found (tried '{}'). Install from https://mega.io/cmd",
        binary
    );

    for candidate in &candidates {
        match Command::new(candidate).args(args).output() {
            Ok(output) => {
                if output.status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    // MEGAcmd sometimes writes errors to stdout
                    let msg = if stderr.is_empty() { stdout } else { stderr };
                    return Err(format!("MEGAcmd error: {}", msg));
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
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return true;
        }
    }
    // Fallback: try mega-version with all platform paths
    for candidate in &binary_candidates("mega-version") {
        if Command::new(candidate)
            .output()
            .map(|o| o.status.success())
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
