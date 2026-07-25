//! Local filesystem browsing (internal disks and external drives).
//!
//! Mirrors the shape of the Mega commands (`commands::mega`) so the frontend can
//! treat both sources uniformly: every listing command returns [`FsEntry`], which
//! serializes exactly like the Mega entry type (`size` is a pre-formatted string,
//! `entry_type` is `"file"` or `"folder"`).
//!
//! Paths that descend into a tree are built with [`PathBuf`] — never by
//! concatenating strings — because Windows separators are `\` while macOS/Linux
//! use `/`. The one literal exception is a Windows drive root, which *is*
//! spelled `X:\` and has no parent to join onto.
//!
//! Every command here touches the filesystem, and on a network mount or a
//! spun-down external drive a single `stat()` can block for seconds. Tauri runs
//! `async` commands on the shared tokio runtime, so blocking there would stall
//! unrelated IPC (including the player's own commands). Each command therefore
//! stays `async` (a sync command would run on the main thread and freeze the
//! webview) and moves its blocking body onto the blocking pool with
//! [`tauri::async_runtime::spawn_blocking`].

use crate::util::size::format_size_bytes;
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// A local filesystem entry. Serializes identically to `FsEntry` on the frontend
/// (`$lib/types/mega`) and to `commands::mega::MegaEntry`.
#[derive(Debug, Serialize)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub size: String,
    pub entry_type: String, // "file" or "folder"
}

/// A browsable starting point: a drive letter, a mounted volume or the home folder.
#[derive(Debug, Serialize)]
pub struct LocalRoot {
    pub path: String,
    pub label: String,
}

/// Video extensions we consider playable.
///
/// MUST STAY IN SYNC with `VIDEO_EXTENSIONS` in
/// `apps/desktop/src/lib/utils/media-types.ts`.
const VIDEO_EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "avi", "webm", "mov", "flv", "wmv", "m4v", "ts",
];

/// Maximum folder depth (relative to each search root) walked by `local_search`.
/// Same cap as `mega_search`, for consistent behaviour between sources.
const SEARCH_MAX_DEPTH: usize = 4;

/// Hard cap on `local_search` results, so scanning a multi-terabyte drive cannot
/// stall the UI with tens of thousands of rows.
const SEARCH_MAX_RESULTS: usize = 300;

/// Hard cap on folders `local_search` opens, and on how long it may spend.
///
/// [`SEARCH_MAX_RESULTS`] bounds the *output*, not the *work*: a query that
/// matches nothing walks the whole tree down to [`SEARCH_MAX_DEPTH`], and roots
/// like `C:\` or `/` reach directories with hundreds of thousands of entries
/// (`C:\Windows\WinSxS`). On a cold cache or a USB drive that is tens of seconds
/// with nothing to show for it, so the walk also stops on whichever of these two
/// budgets runs out first and returns the partial results it has.
const SEARCH_MAX_DIRS: usize = 20_000;
const SEARCH_TIME_BUDGET: Duration = Duration::from_secs(4);

/// How many entries `local_search` reads between two time-budget checks.
/// `Instant::now()` is cheap but not free, and a single directory can hold
/// hundreds of thousands of entries, so the budget has to be re-checked *within*
/// one directory as well — just not on every single entry.
const SEARCH_TIME_CHECK_STRIDE: usize = 512;

/// Turn a `spawn_blocking` join failure (the pool thread panicked or the runtime
/// shut down) into the `String` error the frontend expects.
fn join_err(e: tauri::Error) -> String {
    format!("Filesystem task failed: {}", e)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// List the direct children of `path` (files and folders), folders first and then
/// in natural, case-insensitive order.
#[tauri::command]
pub async fn local_list_dir(path: String) -> Result<Vec<FsEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || list_dir_blocking(path))
        .await
        .map_err(join_err)?
}

fn list_dir_blocking(path: String) -> Result<Vec<FsEntry>, String> {
    let dir = PathBuf::from(&path);
    if !dir.exists() {
        return Err(format!(
            "Folder not found: {} (the drive may be disconnected)",
            path
        ));
    }
    if !dir.is_dir() {
        return Err(format!("Not a folder: {}", path));
    }

    let read_dir = fs::read_dir(&dir).map_err(|e| format!("Cannot read {}: {}", path, e))?;

    let mut entries = Vec::new();
    for item in read_dir {
        // Skip individual entries we cannot stat (permissions, races) instead of
        // failing the whole listing.
        let Ok(item) = item else { continue };
        if is_hidden_entry(&item) {
            continue;
        }
        if let Some(entry) = to_fs_entry(&item) {
            entries.push(entry);
        }
    }

    sort_entries(&mut entries);
    Ok(entries)
}

/// List the browsable roots of this machine: drives/volumes plus the home folder.
#[tauri::command]
pub async fn local_list_roots() -> Result<Vec<LocalRoot>, String> {
    tauri::async_runtime::spawn_blocking(collect_roots)
        .await
        .map_err(join_err)
}

/// List the video files directly inside `path`, in natural order.
///
/// Non-recursive on purpose: it is used to build the playback queue for the
/// folder the user is currently browsing (typically one season of episodes).
#[tauri::command]
pub async fn local_scan_folder(path: String) -> Result<Vec<FsEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_folder_blocking(path))
        .await
        .map_err(join_err)?
}

fn scan_folder_blocking(path: String) -> Result<Vec<FsEntry>, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!(
            "Folder not found: {} (the drive may be disconnected)",
            path
        ));
    }

    let read_dir = fs::read_dir(&dir).map_err(|e| format!("Cannot read {}: {}", path, e))?;

    let mut entries = Vec::new();
    for item in read_dir {
        let Ok(item) = item else { continue };
        // Test the *name* first: it comes straight from `readdir` and costs
        // nothing, while building the `FsEntry` needs a `stat()` for the size.
        // Nearly every entry is rejected here, so this is the difference between
        // one syscall per file and one syscall per video.
        if !is_video(&item.file_name().to_string_lossy()) {
            continue;
        }
        if is_hidden_entry(&item) {
            continue;
        }
        let Some(entry) = to_fs_entry(&item) else {
            continue;
        };
        // A *folder* named `Season 1.mkv` matches `is_video` but is not playable.
        if entry.entry_type == "file" {
            entries.push(entry);
        }
    }

    sort_entries(&mut entries);
    Ok(entries)
}

/// Recursively search `roots` for folders and video files whose name contains
/// `query` (case-insensitive substring).
///
/// Breadth-first, so shallow matches surface first. Capped at
/// [`SEARCH_MAX_DEPTH`] levels below each root, [`SEARCH_MAX_RESULTS`] hits, and
/// the [`SEARCH_MAX_DIRS`]/[`SEARCH_TIME_BUDGET`] work budget. Unreadable
/// roots/folders are skipped silently (e.g. a drive unplugged mid-search).
#[tauri::command]
pub async fn local_search(query: String, roots: Vec<String>) -> Result<Vec<FsEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || search_blocking(query, roots))
        .await
        .map_err(join_err)?
}

fn search_blocking(query: String, roots: Vec<String>) -> Result<Vec<FsEntry>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }

    let started = Instant::now();
    let mut dirs_visited = 0usize;

    let mut results: Vec<FsEntry> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    // (folder, depth of that folder relative to its root)
    let mut queue: VecDeque<(PathBuf, usize)> = roots
        .iter()
        .map(|root| (PathBuf::from(root), 0usize))
        .collect();

    'outer: while let Some((dir, depth)) = queue.pop_front() {
        // Give up on the rest of the tree rather than keep the user waiting;
        // whatever matched so far is still returned.
        dirs_visited += 1;
        if dirs_visited > SEARCH_MAX_DIRS || started.elapsed() >= SEARCH_TIME_BUDGET {
            break;
        }

        let Ok(read_dir) = fs::read_dir(&dir) else {
            continue;
        };

        let mut until_time_check = SEARCH_TIME_CHECK_STRIDE;
        for item in read_dir {
            until_time_check -= 1;
            if until_time_check == 0 {
                until_time_check = SEARCH_TIME_CHECK_STRIDE;
                if started.elapsed() >= SEARCH_TIME_BUDGET {
                    break 'outer;
                }
            }

            let Ok(item) = item else { continue };
            if is_hidden_entry(&item) {
                continue;
            }

            // Match on the name before doing any `stat()`: the vast majority of
            // entries never make it into the results, and only folders need to
            // be classified so the walk can descend into them.
            let name = item.file_name().to_string_lossy().to_string();
            let matches = name.to_lowercase().contains(&needle);
            let Some(is_dir) = resolve_is_dir(&item) else {
                continue;
            };

            if matches && (is_dir || is_video(&name)) {
                let entry = fs_entry_from(&item, is_dir);
                if seen.insert(entry.path.clone()) {
                    results.push(entry);
                    if results.len() >= SEARCH_MAX_RESULTS {
                        break 'outer;
                    }
                }
            }

            if is_dir && depth + 1 < SEARCH_MAX_DEPTH {
                queue.push_back((item.path(), depth + 1));
            }
        }
    }

    sort_entries(&mut results);
    Ok(results)
}

// ---------------------------------------------------------------------------
// Entry helpers
// ---------------------------------------------------------------------------

/// Whether `item` is a directory, resolving symlinks.
///
/// Returns `None` for entries that should not be listed at all: those whose type
/// cannot be read, and **broken symlinks**. `DirEntry::file_type()` describes the
/// link itself, so a dangling `link.mkv` used to be reported as a plain file,
/// pass `is_video()`, get queued for playback and only fail at open time.
fn resolve_is_dir(item: &fs::DirEntry) -> Option<bool> {
    let file_type = item.file_type().ok()?;
    if file_type.is_symlink() {
        // `fs::metadata` follows the link (unlike `DirEntry::metadata`), so this
        // both classifies the target and proves it exists.
        Some(fs::metadata(item.path()).ok()?.is_dir())
    } else {
        Some(file_type.is_dir())
    }
}

/// Build an [`FsEntry`] from a directory entry. Returns `None` when the entry
/// cannot be classified (see [`resolve_is_dir`]).
fn to_fs_entry(item: &fs::DirEntry) -> Option<FsEntry> {
    let is_dir = resolve_is_dir(item)?;
    Some(fs_entry_from(item, is_dir))
}

/// Build an [`FsEntry`] once `is_dir` is already known, so callers that had to
/// classify the entry anyway do not pay for it twice.
fn fs_entry_from(item: &fs::DirEntry, is_dir: bool) -> FsEntry {
    let path = item.path();

    let size = if is_dir {
        // Folders show no size, same as the Mega listing.
        String::new()
    } else {
        // `fs::metadata` and not `DirEntry::metadata()`: the latter does not
        // follow symlinks, so `link.mkv -> 3 GB movie` reported the size of the
        // link itself (~128 B). Symlinked libraries are the norm on Linux/NAS
        // setups. For a regular file the two are the same single `stat()`.
        fs::metadata(&path)
            .map(|m| format_size_bytes(m.len()))
            .unwrap_or_default()
    };

    FsEntry {
        name: item.file_name().to_string_lossy().to_string(),
        path: path.to_string_lossy().to_string(),
        size,
        entry_type: if is_dir { "folder" } else { "file" }.to_string(),
    }
}

fn has_extension(name: &str, extensions: &[&str]) -> bool {
    match Path::new(name).extension() {
        Some(ext) => {
            let ext = ext.to_string_lossy().to_lowercase();
            extensions.contains(&ext.as_str())
        }
        None => false,
    }
}

fn is_video(name: &str) -> bool {
    has_extension(name, VIDEO_EXTENSIONS)
}

// ---------------------------------------------------------------------------
// Hidden entries
// ---------------------------------------------------------------------------

/// Windows: honour the `hidden` file attribute, plus the two system folders that
/// live on the root of every volume and are never interesting to the user.
#[cfg(windows)]
fn is_hidden_entry(item: &fs::DirEntry) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;

    let name = item.file_name().to_string_lossy().to_lowercase();
    if name == "$recycle.bin" || name == "system volume information" {
        return true;
    }

    item.metadata()
        .map(|m| m.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0)
        .unwrap_or(false)
}

/// macOS/Linux: dot-files are hidden.
#[cfg(not(windows))]
fn is_hidden_entry(item: &fs::DirEntry) -> bool {
    item.file_name().to_string_lossy().starts_with('.')
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/// Folders first, then natural (numeric-aware), case-insensitive order.
///
/// `read_dir` gives no ordering guarantee at all, so this has to happen here:
/// without it local folders would come out shuffled while Mega ones look sorted.
/// The final case-sensitive comparison only breaks ties, keeping the result
/// deterministic on case-insensitive filesystems.
fn sort_entries(entries: &mut [FsEntry]) {
    entries.sort_by(|a, b| {
        let a_folder = a.entry_type == "folder";
        let b_folder = b.entry_type == "folder";
        b_folder
            .cmp(&a_folder)
            .then_with(|| natural_cmp(&a.name, &b.name))
            .then_with(|| a.name.cmp(&b.name))
    });
}

/// Case-insensitive "natural" comparison: runs of digits compare as numbers, so
/// `Ep 2` sorts before `Ep 10`. Hand-rolled to avoid a new dependency.
fn natural_cmp(a: &str, b: &str) -> Ordering {
    let ac: Vec<char> = a.chars().collect();
    let bc: Vec<char> = b.chars().collect();
    let (mut i, mut j) = (0usize, 0usize);

    while i < ac.len() && j < bc.len() {
        if ac[i].is_ascii_digit() && bc[j].is_ascii_digit() {
            let start_a = i;
            while i < ac.len() && ac[i].is_ascii_digit() {
                i += 1;
            }
            let start_b = j;
            while j < bc.len() && bc[j].is_ascii_digit() {
                j += 1;
            }
            // Compare the digit runs numerically without parsing (a run can be
            // longer than u64): strip leading zeros, then longer run wins, and
            // equal lengths compare lexicographically.
            let num_a: String = ac[start_a..i].iter().collect();
            let num_b: String = bc[start_b..j].iter().collect();
            let trimmed_a = num_a.trim_start_matches('0');
            let trimmed_b = num_b.trim_start_matches('0');
            let ord = trimmed_a
                .len()
                .cmp(&trimmed_b.len())
                .then_with(|| trimmed_a.cmp(trimmed_b));
            if ord != Ordering::Equal {
                return ord;
            }
        } else {
            let la = lower(ac[i]);
            let lb = lower(bc[j]);
            if la != lb {
                return la.cmp(&lb);
            }
            i += 1;
            j += 1;
        }
    }

    // Whichever name still has characters left is the longer one.
    (ac.len() - i).cmp(&(bc.len() - j))
}

fn lower(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

// ---------------------------------------------------------------------------
// Roots
// ---------------------------------------------------------------------------

fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let raw = std::env::var_os("USERPROFILE");
    #[cfg(not(target_os = "windows"))]
    let raw = std::env::var_os("HOME");

    raw.map(PathBuf::from).filter(|p| p.is_dir())
}

/// The home folder, always labelled `"Home"`.
///
/// Deliberately *not* labelled with its last path component: that is the user
/// name, and on Linux the removable-media container is `/media/<user>`, so both
/// roots would show up under the same name with no way to tell them apart.
fn home_root() -> Option<LocalRoot> {
    home_dir().map(|home| LocalRoot {
        path: home.to_string_lossy().to_string(),
        label: "Home".to_string(),
    })
}

/// Build a root from a path, labelled with its last component. Only used where
/// that component is already meaningful and unique (a volume name under
/// `/Volumes`), hence macOS-only.
#[cfg(target_os = "macos")]
fn root_from(path: &Path, fallback_label: &str) -> LocalRoot {
    let label = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| fallback_label.to_string());
    LocalRoot {
        path: path.to_string_lossy().to_string(),
        label,
    }
}

/// Windows: the home folder plus every existing drive letter.
///
/// Drive letters come from `GetLogicalDrives()`, which is a single bitmask read
/// with no I/O at all. Probing `A:\`..`Z:\` with `Path::exists()` instead — as
/// this used to — means 26 real `stat()` calls: a drive letter mapped to a NAS
/// that is powered off blocks for the full network timeout on every launch (10
/// to 45 s of frozen sidebar), and an empty removable drive can pop up the
/// system's own "There is no disk in drive E:" dialog. That cost is worth the
/// `Win32_Storage_FileSystem` feature of the `windows` crate, which is already a
/// dependency here. Volume labels would additionally need
/// `GetVolumeInformationW` (which *does* hit the drive), so the label stays the
/// drive letter.
#[cfg(target_os = "windows")]
fn collect_roots() -> Vec<LocalRoot> {
    use windows::Win32::Storage::FileSystem::GetLogicalDrives;

    let mut roots = Vec::new();

    if let Some(home) = home_root() {
        roots.push(home);
    }

    // Bit 0 is `A:`, bit 1 is `B:`, and so on. A 0 return means the call failed,
    // which leaves the drive list empty; the home root still gets the user in.
    let mask = unsafe { GetLogicalDrives() };
    for (bit, letter) in (b'A'..=b'Z').enumerate() {
        if mask & (1 << bit) == 0 {
            continue;
        }
        let letter = letter as char;
        roots.push(LocalRoot {
            // A drive root really is spelled `X:\` and has no parent to join
            // onto, so this is the one path we format by hand.
            path: format!("{}:\\", letter),
            label: format!("{}:", letter),
        });
    }

    roots
}

/// macOS: the home folder plus every mounted volume under `/Volumes`.
#[cfg(target_os = "macos")]
fn collect_roots() -> Vec<LocalRoot> {
    let mut roots = Vec::new();

    if let Some(home) = home_root() {
        roots.push(home);
    }

    if let Ok(read_dir) = fs::read_dir("/Volumes") {
        let mut volumes: Vec<LocalRoot> = read_dir
            .flatten()
            .filter(|item| !is_hidden_entry(item))
            .filter(|item| item.path().is_dir())
            .map(|item| root_from(&item.path(), "Volume"))
            .collect();
        volumes.sort_by(|a, b| natural_cmp(&a.label, &b.label));
        roots.extend(volumes);
    }

    roots
}

/// Linux: the home folder plus the usual removable-media mount points that exist.
///
/// Each container gets an explicit, path-qualified label. Labelling them with
/// their last component would name `/media/<user>` after the user, i.e. exactly
/// the same as the home folder.
#[cfg(target_os = "linux")]
fn collect_roots() -> Vec<LocalRoot> {
    let mut roots = Vec::new();

    if let Some(home) = home_root() {
        roots.push(home);
    }

    let user = std::env::var("USER").unwrap_or_default();
    let mut candidates: Vec<(PathBuf, String)> = Vec::new();
    if !user.is_empty() {
        for base in ["/media", "/run/media"] {
            let path = PathBuf::from(base).join(&user);
            let label = format!("Removable media ({})", path.to_string_lossy());
            candidates.push((path, label));
        }
    }
    candidates.push((
        PathBuf::from("/mnt"),
        "Mounted volumes (/mnt)".to_string(),
    ));

    for (path, label) in candidates {
        if path.is_dir() {
            roots.push(LocalRoot {
                path: path.to_string_lossy().to_string(),
                label,
            });
        }
    }

    roots
}
