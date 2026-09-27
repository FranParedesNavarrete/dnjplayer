use super::client;
use crate::util::command::hidden_command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// Monotonic "which mega-cmd-server instance are we talking to" counter.
///
/// WHY: every WebDAV URL MEGAcmd hands out (`http://127.0.0.1:4443/<token>/file`)
/// dies with the server that minted it. The frontend caches those URLs in memory
/// forever, so after a server restart mpv opens a dead URL and the user gets a
/// black screen. There is no MEGAcmd API that exposes a server identity, so we
/// derive one: every time we *observe* the server go from down to up, the token
/// is bumped and the frontend drops its whole URL cache.
///
/// Starts "down" on purpose: the first successful observation after app start
/// bumps it to 1, which is harmless because the cache is empty then anyway.
struct ServerGeneration {
    generation: AtomicU64,
    was_down: AtomicBool,
}

impl ServerGeneration {
    const fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
            was_down: AtomicBool::new(true),
        }
    }

    /// Feed in one observation of the server's liveness. Returns the current
    /// generation. Only the down -> up edge bumps it: a server that simply keeps
    /// running must never invalidate URLs that are still good.
    fn observe(&self, running: bool) -> u64 {
        if running {
            if self.was_down.swap(false, Ordering::SeqCst) {
                return self.generation.fetch_add(1, Ordering::SeqCst) + 1;
            }
        } else {
            self.was_down.store(true, Ordering::SeqCst);
        }
        self.generation.load(Ordering::SeqCst)
    }

    fn get(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }
}

static SERVER_GENERATION: ServerGeneration = ServerGeneration::new();

/// Current server generation. A cheap atomic read: it never spawns a process, so
/// the frontend can call it before every cached-URL hit without paying for a
/// `mega-exec version` round trip.
pub fn server_generation() -> u64 {
    SERVER_GENERATION.get()
}

/// Check if mega-cmd-server is running and responsive.
///
/// Doubles as the sampling point for [`server_generation`]: every liveness check
/// anywhere in the app (status polling, `ensure_server`, login...) feeds the
/// generation, so a restart is noticed even when *we* were not the ones who
/// restarted it.
pub fn is_server_running() -> bool {
    let running = client::version().is_ok();
    SERVER_GENERATION.observe(running);
    running
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
        match hidden_command(path).spawn() {
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

#[cfg(test)]
mod tests {
    use super::ServerGeneration;

    // A local instance per test: the real one is a process-wide static, and
    // tests in the same binary run concurrently.
    #[test]
    fn first_live_observation_bumps_from_the_unknown_state() {
        let gen = ServerGeneration::new();
        assert_eq!(gen.get(), 0);
        assert_eq!(gen.observe(true), 1);
    }

    #[test]
    fn a_server_that_keeps_running_never_invalidates_urls() {
        let gen = ServerGeneration::new();
        gen.observe(true);
        for _ in 0..10 {
            assert_eq!(gen.observe(true), 1);
        }
    }

    #[test]
    fn each_down_up_cycle_bumps_exactly_once() {
        let gen = ServerGeneration::new();
        assert_eq!(gen.observe(true), 1);
        // Several consecutive "down" samples are still a single outage.
        gen.observe(false);
        gen.observe(false);
        assert_eq!(gen.observe(true), 2);
        gen.observe(false);
        assert_eq!(gen.observe(true), 3);
        assert_eq!(gen.get(), 3);
    }

    #[test]
    fn a_down_observation_alone_does_not_bump() {
        let gen = ServerGeneration::new();
        gen.observe(true);
        assert_eq!(gen.observe(false), 1);
        assert_eq!(gen.get(), 1);
    }
}

// --- Streaming cache budget ---------------------------------------------------
//
// MEGAcmd's WebDAV server does not stream, it DOWNLOADS each file it serves into
// `~/.megaCmd/file-service/<session>/cache/` so that seeking back is fast. That
// cache is removed on logout — and this app never logs out, so it only grows.
//
// It has its own reclaimer, but the shipped defaults never fire for our usage:
// clean up only above 10 GiB, only files unaccessed for 4320 minutes (three
// days), checked every two hours. A user had 2.6 GiB sitting there, which is
// well under the threshold, so the reclaimer was correctly doing nothing. At one
// 1.24 GB episode per ~22 minutes, three days of grace is effectively "never".
//
// So we set a budget suited to a video player. Deleting the files ourselves would
// be the wrong move: the directory belongs to a process we do not own, a file
// being served right now lives there too, and MEGAcmd already has the policy
// engine — it just needs sensible numbers. Its reclaimer treats a file being
// read as accessed, so nothing can be removed mid-playback.
//
// NOTE: `configure` is GLOBAL to MEGAcmd, not scoped to this app. Anything else
// on the machine using MEGAcmd gets these values too.

/// Cache above this and the next sweep does something. Roughly three of the
/// 1.2 GB episodes this is used for, so an ordinary queue never trips it.
const RECLAIM_THRESHOLD_BYTES: u64 = 4 * 1024 * 1024 * 1024;
/// What a sweep trims down to.
const RECLAIM_TARGET_BYTES: u64 = 1024 * 1024 * 1024;
/// Minutes a file must go untouched to be eligible. Long enough to survive a
/// pause or a browse away from the player, short enough that finished episodes
/// do not linger.
const RECLAIM_AGE_MINUTES: u64 = 15;
/// Seconds between sweeps.
const RECLAIM_PERIOD_SECONDS: u64 = 300;
/// Seconds after login before the FIRST sweep.
const RECLAIM_DELAY_SECONDS: u64 = 60;

fn desired_cache_budget() -> [(&'static str, u64); 5] {
    [
        ("file_service_reclaim_threshold", RECLAIM_THRESHOLD_BYTES),
        ("file_service_reclaim_target", RECLAIM_TARGET_BYTES),
        ("file_service_reclaim_age_threshold", RECLAIM_AGE_MINUTES),
        ("file_service_reclaim_period", RECLAIM_PERIOD_SECONDS),
        ("file_service_reclaim_delay", RECLAIM_DELAY_SECONDS),
    ]
}

/// Parse `configure`'s `key = value` listing.
pub(crate) fn parse_configure(output: &str) -> std::collections::HashMap<String, String> {
    output
        .lines()
        .filter_map(|line| {
            let (k, v) = line.split_once('=')?;
            Some((k.trim().to_string(), v.trim().to_string()))
        })
        .collect()
}

/// Which keys are not already at the wanted value.
///
/// Writing a key that is already correct is NOT harmless: MEGAcmd restarts the
/// "first sweep" delay whenever any reclaim value changes, so an app that wrote
/// all five on every launch would push the first sweep past its own lifetime and
/// the cache would never be reclaimed at all.
pub(crate) fn cache_budget_diff(
    current: &std::collections::HashMap<String, String>,
    desired: &[(&'static str, u64)],
) -> Vec<(&'static str, u64)> {
    desired
        .iter()
        .filter(|(key, want)| current.get(*key).map(|v| v.as_str()) != Some(&want.to_string()))
        .copied()
        .collect()
}

/// Bring MEGAcmd's streaming cache budget in line. Best-effort: a failure here
/// costs disk space, never playback, so it is logged and swallowed.
pub fn apply_cache_budget() {
    let listing = match super::client::exec(&["configure"]) {
        Ok(out) => out,
        Err(e) => {
            log::warn!("[mega] could not read MEGAcmd configuration: {}", e);
            return;
        }
    };
    let current = parse_configure(&listing);
    let pending = cache_budget_diff(&current, &desired_cache_budget());
    if pending.is_empty() {
        return;
    }
    for (key, value) in pending {
        let value = value.to_string();
        match super::client::exec(&["configure", key, &value]) {
            Ok(_) => log::info!("[mega] streaming cache budget: {} = {}", key, value),
            Err(e) => log::warn!("[mega] could not set {}: {}", key, e),
        }
    }
}

#[cfg(test)]
mod cache_budget_tests {
    use super::*;
    use std::collections::HashMap;

    fn listing() -> HashMap<String, String> {
        parse_configure(
            "file_service_reclaim_age_threshold = 4320\n\
             file_service_reclaim_batch_size = 4\n\
             file_service_reclaim_threshold = 10737418240\n",
        )
    }

    #[test]
    fn parses_the_key_value_listing() {
        let m = listing();
        assert_eq!(m.get("file_service_reclaim_age_threshold").unwrap(), "4320");
        assert_eq!(m.get("file_service_reclaim_batch_size").unwrap(), "4");
    }

    #[test]
    fn reports_only_the_keys_that_differ() {
        let desired = [
            ("file_service_reclaim_age_threshold", 15u64),
            ("file_service_reclaim_batch_size", 4u64),
        ];
        let diff = cache_budget_diff(&listing(), &desired);
        // batch_size already matches and must NOT be rewritten: writing any
        // reclaim key restarts the delay before the first sweep.
        assert_eq!(diff, vec![("file_service_reclaim_age_threshold", 15u64)]);
    }

    #[test]
    fn a_missing_key_counts_as_differing() {
        let desired = [("file_service_reclaim_period", 300u64)];
        assert_eq!(cache_budget_diff(&listing(), &desired).len(), 1);
    }

    #[test]
    fn nothing_to_do_when_already_applied() {
        let current = parse_configure("file_service_reclaim_period = 300\n");
        let desired = [("file_service_reclaim_period", 300u64)];
        assert!(cache_budget_diff(&current, &desired).is_empty());
    }
}
