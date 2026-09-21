use crate::util::command::hidden_command;
use std::io::Read;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

/// Timeout for MEGAcmd commands (seconds).
/// Large shared folders can take a while to list; 60s prevents infinite hangs
/// while giving enough time for big directory listings.
const COMMAND_TIMEOUT_SECS: u64 = 60;

/// How long we keep draining stdout/stderr after the child has exited but the
/// pipes are still open (a grandchild inherited them). MEGAcmd does not do
/// this today; the grace period just keeps a misbehaving child from turning a
/// successful run into a bogus timeout.
const PIPE_DRAIN_GRACE: Duration = Duration::from_secs(1);

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
/// All commands have a 60-second timeout to prevent infinite hangs.
pub fn exec(args: &[&str]) -> Result<String, String> {
    // Try mega-exec first (single binary that dispatches)
    let result = try_exec("mega-exec", args, &redact_args(args));
    if result.is_ok() {
        return result;
    }

    // Fallback: try individual mega-<command> binary (e.g., mega-ls, mega-login)
    if let Some((cmd, rest)) = args.split_first() {
        let mega_cmd = format!("mega-{}", cmd);
        // Here the subcommand is the binary name itself, so every remaining
        // argument is user data and must be redacted.
        let fallback = try_exec(&mega_cmd, rest, &count_label(rest.len()));
        if fallback.is_ok() {
            return fallback;
        }
    }

    // Return original error
    result
}

// --- Argument redaction -------------------------------------------------------
//
// `mega_login` runs `exec(&["login", email, password])`, and error strings from
// this module end up verbatim in the UI (AuthForm) and in logs. So NOTHING here
// may interpolate the argument list: the only safe pieces are the binary and
// the subcommand name (a fixed string chosen by our own code). Everything else
// is replaced with a count.

/// `"<N args>"` placeholder for `n` redacted arguments (empty for zero).
fn count_label(n: usize) -> String {
    match n {
        0 => String::new(),
        1 => "<1 arg>".to_string(),
        n => format!("<{} args>", n),
    }
}

/// Credential-safe rendering of an `exec()` argument list: the subcommand is
/// kept, the rest is counted. `["login", "a@b.c", "hunter2"]` -> `"login <2 args>"`.
pub(crate) fn redact_args(args: &[&str]) -> String {
    match args.split_first() {
        None => String::new(),
        Some((subcommand, rest)) => {
            let rest = count_label(rest.len());
            if rest.is_empty() {
                subcommand.to_string()
            } else {
                format!("{} {}", subcommand, rest)
            }
        }
    }
}

// --- Child process runner -----------------------------------------------------

/// Output of a child that ran to completion.
struct Completed {
    status: ExitStatus,
    stdout: String,
    stderr: String,
}

enum RunError {
    /// `spawn()` itself failed (binary missing, not executable...).
    Spawn(std::io::Error),
    /// `try_wait()` failed after a successful spawn.
    Wait(std::io::Error),
    /// The child was killed because it exceeded the timeout. Carries whatever
    /// stdout had been produced so far, so a partial listing is not lost.
    TimedOut { partial_stdout: String },
}

#[derive(Clone, Copy)]
enum Stream {
    Stdout,
    Stderr,
}

/// Move a pipe onto its own thread and forward every chunk it produces.
///
/// This is the fix for the pipe deadlock: stdout and stderr are drained from
/// the moment the child starts. Previously both were only read after the child
/// had exited, so a child writing more than the OS pipe buffer (64 KiB on
/// macOS/Linux -- one big `ls` or `find` is enough) blocked in `write()`,
/// never exited, and was killed 60s later with no output at all.
fn pump<R: Read + Send + 'static>(mut reader: R, stream: Stream, tx: Sender<(Stream, Vec<u8>)>) {
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF: child closed its end
                Ok(n) => {
                    // The receiver is gone only after the runner returned
                    // (timeout); nothing left to do but stop reading.
                    if tx.send((stream, buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        // Dropping `tx` here is what lets the runner detect EOF on this stream.
    });
}

/// Spawn `cmd` with piped stdout/stderr, drain both concurrently, and wait for
/// it to exit within `timeout`. On timeout the child is killed and reaped.
fn run_with_timeout(cmd: &mut Command, timeout: Duration) -> Result<Completed, RunError> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(RunError::Spawn)?;

    let (tx, rx) = mpsc::channel::<(Stream, Vec<u8>)>();
    if let Some(out) = child.stdout.take() {
        pump(out, Stream::Stdout, tx.clone());
    }
    if let Some(err) = child.stderr.take() {
        pump(err, Stream::Stderr, tx.clone());
    }
    // Only the pump threads hold senders now, so `Disconnected` == both pipes
    // reached EOF.
    drop(tx);

    let deadline = Instant::now() + timeout;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_status: Option<ExitStatus> = None;
    let mut pipes_open = true;
    // Set once the child has exited while its pipes are still open.
    let mut drain_until: Option<Instant> = None;

    loop {
        if pipes_open {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok((Stream::Stdout, bytes)) => stdout.extend_from_slice(&bytes),
                Ok((Stream::Stderr, bytes)) => stderr.extend_from_slice(&bytes),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => pipes_open = false,
            }
        }

        if exit_status.is_none() {
            match child.try_wait() {
                Ok(Some(status)) => exit_status = Some(status),
                Ok(None) => {}
                Err(e) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(RunError::Wait(e));
                }
            }
        }

        match exit_status {
            Some(status) if !pipes_open => {
                return Ok(Completed {
                    status,
                    stdout: String::from_utf8_lossy(&stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&stderr).into_owned(),
                });
            }
            Some(status) => {
                // Exited, but something still holds the pipes. Give it a short
                // grace period, then return what we have; the pump threads die
                // on their own at EOF.
                let until = *drain_until.get_or_insert_with(|| Instant::now() + PIPE_DRAIN_GRACE);
                if Instant::now() >= until {
                    return Ok(Completed {
                        status,
                        stdout: String::from_utf8_lossy(&stdout).into_owned(),
                        stderr: String::from_utf8_lossy(&stderr).into_owned(),
                    });
                }
            }
            None => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(RunError::TimedOut {
                        partial_stdout: String::from_utf8_lossy(&stdout).into_owned(),
                    });
                }
                if !pipes_open {
                    // Pipes closed but the child is still running: nothing to
                    // drain, so avoid a busy loop on try_wait().
                    thread::sleep(Duration::from_millis(20));
                }
            }
        }
    }
}

/// Try executing a binary with the given args, checking all platform-specific paths.
///
/// `safe_args` is the pre-redacted argument list (see [`redact_args`]) used in
/// every error message; the real `args` never appear in them.
fn try_exec(binary: &str, args: &[&str], safe_args: &str) -> Result<String, String> {
    let candidates = binary_candidates(binary);
    let mut last_err = format!(
        "MEGAcmd not found (tried '{}'). Install from https://mega.io/cmd",
        binary
    );

    for candidate in &candidates {
        let mut cmd = hidden_command(candidate);
        cmd.args(args);

        match run_with_timeout(&mut cmd, Duration::from_secs(COMMAND_TIMEOUT_SECS)) {
            Ok(completed) => {
                let stdout = completed.stdout.trim().to_string();
                let stderr = completed.stderr.trim().to_string();
                if completed.status.success() {
                    return Ok(stdout);
                }
                let msg = if stderr.is_empty() { stdout } else { stderr };
                return Err(format!("MEGAcmd error: {}", msg));
            }
            Err(RunError::TimedOut { partial_stdout }) => {
                let mut msg = format!(
                    "MEGAcmd command timed out after {}s: {} {}",
                    COMMAND_TIMEOUT_SECS,
                    candidate,
                    safe_args
                );
                let partial = partial_stdout.trim();
                if !partial.is_empty() {
                    msg.push_str("\nPartial output:\n");
                    msg.push_str(partial);
                }
                return Err(msg);
            }
            Err(RunError::Wait(e)) => {
                return Err(format!("Error waiting for '{}': {}", candidate, e));
            }
            Err(RunError::Spawn(e)) => {
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
        if hidden_command(candidate)
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
        if hidden_command(candidate)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_args_keeps_only_the_subcommand() {
        assert_eq!(redact_args(&[]), "");
        assert_eq!(redact_args(&["version"]), "version");
        assert_eq!(redact_args(&["ls", "/Movies"]), "ls <1 arg>");
        assert_eq!(
            redact_args(&["find", "/", "--pattern=*x*", "--type=d", "-l"]),
            "find <4 args>"
        );
    }

    #[test]
    fn redact_args_never_leaks_credentials() {
        let redacted = redact_args(&["login", "user@example.com", "hunter2"]);
        assert_eq!(redacted, "login <2 args>");
        assert!(!redacted.contains("hunter2"));
        assert!(!redacted.contains("user@example.com"));
    }

    #[test]
    fn count_label_formats() {
        assert_eq!(count_label(0), "");
        assert_eq!(count_label(1), "<1 arg>");
        assert_eq!(count_label(3), "<3 args>");
    }

    // The runner tests need a shell; they exercise the real pipe behaviour
    // rather than mocking it, because the bug they guard against lives in the
    // OS pipe buffer.
    #[cfg(unix)]
    mod runner {
        use super::super::*;

        fn sh(script: &str) -> Command {
            let mut cmd = Command::new("sh");
            cmd.arg("-c").arg(script);
            cmd
        }

        #[test]
        fn drains_output_larger_than_the_pipe_buffer() {
            // 200 KB on stdout and 100 KB on stderr, both well over the 64 KiB
            // pipe buffer. With the old read-after-exit code this never returns.
            let mut cmd = sh(
                "head -c 200000 /dev/zero | tr '\\0' 'x'; \
                 head -c 100000 /dev/zero | tr '\\0' 'e' >&2",
            );
            let started = Instant::now();
            let done = match run_with_timeout(&mut cmd, Duration::from_secs(10)) {
                Ok(done) => done,
                Err(_) => panic!("expected the child to complete"),
            };
            assert!(done.status.success());
            assert_eq!(done.stdout.len(), 200_000);
            assert!(done.stdout.bytes().all(|b| b == b'x'));
            assert_eq!(done.stderr.len(), 100_000);
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "drain took {:?}",
                started.elapsed()
            );
        }

        #[test]
        fn timeout_kills_the_child_and_keeps_partial_stdout() {
            let mut cmd = sh("printf 'partial'; sleep 10");
            let started = Instant::now();
            match run_with_timeout(&mut cmd, Duration::from_millis(300)) {
                Err(RunError::TimedOut { partial_stdout }) => {
                    assert_eq!(partial_stdout, "partial");
                }
                Ok(_) => panic!("expected a timeout"),
                Err(_) => panic!("expected a timeout, got another error"),
            }
            // The child was killed, not waited for its full 10 s sleep.
            assert!(started.elapsed() < Duration::from_secs(3));
        }

        #[test]
        fn reports_non_zero_exit_with_stderr() {
            let mut cmd = sh("echo out; echo 'boom' >&2; exit 3");
            let done = match run_with_timeout(&mut cmd, Duration::from_secs(5)) {
                Ok(done) => done,
                Err(_) => panic!("expected the child to complete"),
            };
            assert!(!done.status.success());
            assert_eq!(done.stdout.trim(), "out");
            assert_eq!(done.stderr.trim(), "boom");
        }

        #[test]
        fn missing_binary_is_a_spawn_error() {
            let mut cmd = Command::new("/nonexistent/dnjplayer-test-binary");
            match run_with_timeout(&mut cmd, Duration::from_secs(1)) {
                Err(RunError::Spawn(e)) => assert_eq!(e.kind(), std::io::ErrorKind::NotFound),
                _ => panic!("expected a spawn error"),
            }
        }
    }
}
