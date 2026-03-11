use std::process::Command;

/// Execute a MEGAcmd command and return stdout.
/// Uses `mega-exec` which communicates with the running mega-cmd-server.
/// On macOS, MEGAcmd installs commands as `mega-exec` (or individual `mega-ls`, `mega-login`, etc.)
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

fn try_exec(binary: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(binary)
        .args(args)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!(
                    "MEGAcmd not found (tried '{}'). Install from https://mega.io/cmd",
                    binary
                )
            } else {
                format!("Failed to execute '{}': {}", binary, e)
            }
        })?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        // MEGAcmd sometimes writes errors to stdout
        let msg = if stderr.is_empty() { stdout } else { stderr };
        Err(format!("MEGAcmd error: {}", msg))
    }
}

/// Check if MEGAcmd binaries are available on the system
pub fn is_available() -> bool {
    Command::new("mega-exec")
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
        || Command::new("mega-version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
}

/// Get MEGAcmd version string
pub fn version() -> Result<String, String> {
    exec(&["version"])
}
