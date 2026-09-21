use crate::mega::{client, process, webdav};
use crate::util::size::format_size;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct MegaEntry {
    pub name: String,
    pub path: String,
    pub size: String,
    pub entry_type: String, // "file" or "folder"
}

#[derive(Debug, Serialize)]
pub struct MegaUser {
    pub email: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct MegaStatus {
    pub installed: bool,
    pub server_running: bool,
    pub logged_in: bool,
    pub email: Option<String>,
}

#[tauri::command]
pub async fn mega_check_status() -> Result<MegaStatus, String> {
    let installed = process::is_installed();
    if !installed {
        return Ok(MegaStatus {
            installed: false,
            server_running: false,
            logged_in: false,
            email: None,
        });
    }

    let server_running = process::is_server_running();
    if !server_running {
        return Ok(MegaStatus {
            installed: true,
            server_running: false,
            logged_in: false,
            email: None,
        });
    }

    let logged_in = process::is_logged_in();
    let email = if logged_in {
        client::exec(&["whoami"])
            .ok()
            .and_then(|output| parse_whoami_email(&output))
    } else {
        None
    };

    Ok(MegaStatus {
        installed: true,
        server_running: true,
        logged_in,
        email,
    })
}

#[tauri::command]
pub async fn mega_ensure_server() -> Result<(), String> {
    process::ensure_server()
}

/// Identity token of the mega-cmd-server instance we are currently talking to.
///
/// Bumped every time the server is observed to come back up (see
/// `mega::process::server_generation`). The frontend stores the value alongside
/// its WebDAV URL cache and wipes the cache when it changes, because a restarted
/// server invalidates every URL it previously minted. A plain atomic read: safe
/// to call before every cache hit.
#[tauri::command]
pub async fn mega_server_generation() -> Result<u64, String> {
    Ok(process::server_generation())
}

#[tauri::command]
pub async fn mega_login(email: String, password: String) -> Result<String, String> {
    // Ensure server is running before login
    process::ensure_server()?;
    client::exec(&["login", &email, &password])
}

#[tauri::command]
pub async fn mega_logout() -> Result<String, String> {
    // Stop all WebDAV before logout
    let _ = webdav::stop_all();
    client::exec(&["logout"])
}

#[tauri::command]
pub async fn mega_whoami() -> Result<MegaUser, String> {
    let output = client::exec(&["whoami"])?;
    let email = parse_whoami_email(&output).unwrap_or_default();
    Ok(MegaUser {
        email,
        name: String::new(),
    })
}

#[tauri::command]
pub async fn mega_list_files(path: String) -> Result<Vec<MegaEntry>, String> {
    // Try fast listing first (no metadata), fall back to detailed listing.
    // Plain `ls` is much faster for large shared folders because it skips
    // fetching size/date metadata for every entry.
    let output = match client::exec(&["ls", &path]) {
        Ok(out) => out,
        Err(_) => {
            // Fallback to ls -l if plain ls fails for some reason
            client::exec(&["ls", "-l", &path])?
        }
    };

    Ok(parse_ls_output(&path, &output))
}

/// Parse `ls` / `ls -l` output into entries under `path`.
///
/// Both formats MEGAcmd can emit are handled:
/// - long (`ls -l`, detected by the `FLAGS ... VERS` header): `FLAGS VERS SIZE DATE TIME NAME`,
///   where folders have `-` as size;
/// - plain (`ls`): names only, folders optionally suffixed with `/`. Without a
///   suffix we fall back to "has a file extension" to tell files from folders.
///
/// Path header lines (shared folders print `//from/user@mail.com:Folder/Sub:`)
/// end with `:` and are skipped.
fn parse_ls_output(path: &str, output: &str) -> Vec<MegaEntry> {
    let mut entries = Vec::new();
    let is_long_format = output.contains("FLAGS") && output.contains("VERS");

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Skip path header lines (shared folders output: "//from/user@email.com:Folder/Sub:")
        // These end with ':' or '/:' and typically start with '/' or '//'
        if line.ends_with(':') {
            continue;
        }

        if is_long_format {
            // ls -l format: FLAGS VERS SIZE DATE TIME NAME
            if line.contains("FLAGS") && line.contains("VERS") {
                continue;
            }
            let tokens: Vec<&str> = line.split_whitespace().collect();
            if tokens.len() < 6 {
                continue;
            }

            let size_str = tokens[2];
            let is_folder = size_str == "-";
            let name = tokens[5..].join(" ");
            let clean_name = name.trim_end_matches('/').to_string();

            let full_path = join_remote(path, &clean_name);

            let display_size = if is_folder {
                String::new()
            } else {
                format_size(size_str)
            };

            entries.push(MegaEntry {
                name: clean_name,
                path: full_path,
                size: display_size,
                entry_type: if is_folder {
                    "folder".to_string()
                } else {
                    "file".to_string()
                },
            });
        } else {
            // Plain ls format: names only. Folders may or may not have trailing '/'.
            // Use heuristic: entries with a file extension (e.g. .mkv, .mp4, .srt)
            // are files; everything else is a folder.
            let clean_name = line.trim_end_matches('/').to_string();

            if clean_name.is_empty() {
                continue;
            }

            let has_trailing_slash = line.ends_with('/');
            let is_folder = has_trailing_slash || !has_file_extension(&clean_name);

            let full_path = join_remote(path, &clean_name);

            entries.push(MegaEntry {
                name: clean_name,
                path: full_path,
                size: String::new(),
                entry_type: if is_folder {
                    "folder".to_string()
                } else {
                    "file".to_string()
                },
            });
        }
    }

    entries
}

/// `parent` + `/` + `name`, without doubling the separator when `parent`
/// already ends with one (e.g. the root `/`).
fn join_remote(parent: &str, name: &str) -> String {
    if parent.ends_with('/') {
        format!("{}{}", parent, name)
    } else {
        format!("{}/{}", parent, name)
    }
}

/// Check if a filename has a file extension (e.g. .mkv, .mp4, .txt).
/// Returns false for folder-like names without extensions.
fn has_file_extension(name: &str) -> bool {
    if let Some(dot_pos) = name.rfind('.') {
        let ext = &name[dot_pos + 1..];
        // Extension should be 1-10 alphanumeric chars (e.g. mkv, mp4, srt, tar, gz)
        !ext.is_empty() && ext.len() <= 10 && ext.chars().all(|c| c.is_ascii_alphanumeric())
    } else {
        false
    }
}

#[derive(Debug, Serialize)]
pub struct MegaShare {
    pub name: String,
    pub path: String,
    pub owner: String,
    pub access: String,
}

/// List incoming shares by parsing mega-mount output.
/// Mount lines look like: INSHARE on //from/user@email.com:FolderName (read access)
#[tauri::command]
pub async fn mega_list_shares() -> Result<Vec<MegaShare>, String> {
    let output = client::exec(&["mount"])?;
    Ok(parse_mount_shares(&output))
}

/// Parse `mount` output. Only `INSHARE` lines matter:
///   `INSHARE on //from/user@email.com:FolderName (read access)`
fn parse_mount_shares(output: &str) -> Vec<MegaShare> {
    let mut shares = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if !line.starts_with("INSHARE") {
            continue;
        }
        // Format: INSHARE on //from/user@email.com:FolderName (access_level access)
        let rest = match line.strip_prefix("INSHARE on ") {
            Some(r) => r,
            None => continue,
        };

        // Split path from access info: "//from/user:Folder (read access)"
        let (path, access) = match rest.rfind('(') {
            Some(idx) => {
                let p = rest[..idx].trim();
                let a = rest[idx..].trim_matches(|c| c == '(' || c == ')').trim();
                (p.to_string(), a.to_string())
            }
            None => (rest.to_string(), String::new()),
        };

        // Extract owner and folder name from path like //from/user@email.com:FolderName
        let after_from = path.strip_prefix("//from/").unwrap_or(&path);
        let (owner, folder_name) = match after_from.split_once(':') {
            Some((o, f)) => (o.to_string(), f.to_string()),
            None => (String::new(), after_from.to_string()),
        };

        shares.push(MegaShare {
            name: folder_name,
            path,
            owner,
            access,
        });
    }

    shares
}

/// Maximum folder depth (relative to each search root) returned by `mega_search`.
/// Keeps result sets small and avoids matching deeply buried folders.
const SEARCH_MAX_DEPTH: usize = 4;

/// Recursively search the given roots for **folders** whose name matches `query`.
///
/// Only folders are returned (not individual files): the user navigates into a
/// matching folder to pick episodes, which keeps result sets small. `find` still
/// recurses fully, so we cap depth to `SEARCH_MAX_DEPTH` levels below each root.
///
/// `roots` is the list of starting paths to search:
/// - Cloud drive: `["/"]`
/// - Shared folders: one entry per incoming share, e.g.
///   `["//from/user@mail.com:Folder 1", ...]` (MEGAcmd cannot search `//from`
///   directly, so each share must be searched individually).
///
/// Uses `find <root> --pattern=*query* --type=d -l`, whose output looks like:
///   `/path/to/folder (folder)`
/// For results inside a share, MEGAcmd drops the `//from/` prefix, so we
/// re-prepend it to keep paths usable for navigation/playback.
#[tauri::command]
pub async fn mega_search(query: String, roots: Vec<String>) -> Result<Vec<MegaEntry>, String> {
    let pattern = format!("--pattern=*{}*", query);
    let mut entries = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut last_err: Option<String> = None;

    for root in &roots {
        let output = match client::exec(&["find", root, &pattern, "--type=d", "-l"]) {
            Ok(out) => out,
            Err(e) => {
                // Skip roots that fail (e.g. a revoked share) but remember the
                // error in case every root fails.
                last_err = Some(e);
                continue;
            }
        };

        for entry in parse_find_output(root, &output) {
            // The same folder can be reached from several roots.
            if seen.insert(entry.path.clone()) {
                entries.push(entry);
            }
        }
    }

    // Only surface an error if we got nothing AND at least one root failed.
    if entries.is_empty() {
        if let Some(e) = last_err {
            return Err(e);
        }
    }

    Ok(entries)
}

/// Parse one root's `find ... --type=d -l` output into folder entries.
///
/// Lines look like `/path/to/folder (folder)`. Share results come back
/// relative to `//from/`, which is re-prepended. Entries deeper than
/// `SEARCH_MAX_DEPTH` below `root` (or equal to the root itself) are dropped.
/// Duplicates are NOT removed here; the caller dedupes across roots.
fn parse_find_output(root: &str, output: &str) -> Vec<MegaEntry> {
    let mut entries = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Strip the trailing " (folder)" metadata to get the raw path.
        let raw_path = match (line.rfind(" ("), line.ends_with(')')) {
            (Some(idx), true) => &line[..idx],
            _ => line,
        };

        // Rebuild an absolute path. Cloud results already start with '/';
        // share results are relative to `//from/`.
        let abs_path = if raw_path.starts_with('/') {
            raw_path.to_string()
        } else {
            format!("//from/{}", raw_path)
        };

        // Enforce the depth cap relative to the root being searched.
        let relative = abs_path.strip_prefix(root).unwrap_or(&abs_path);
        let depth = relative.split('/').filter(|s| !s.is_empty()).count();
        if depth == 0 || depth > SEARCH_MAX_DEPTH {
            continue;
        }

        let name = abs_path
            .rsplit('/')
            .next()
            .unwrap_or(&abs_path)
            .to_string();

        entries.push(MegaEntry {
            name,
            path: abs_path,
            size: String::new(),
            entry_type: "folder".to_string(),
        });
    }

    entries
}

#[tauri::command]
pub async fn mega_get_webdav_url(remote_path: String) -> Result<String, String> {
    // Ensure server is running
    process::ensure_server()?;
    webdav::serve(&remote_path)
}

/// Open the official MEGAcmd download page in the user's browser. The page
/// auto-detects the OS and serves the correct installer. We intentionally open
/// the official page rather than hardcoding installer URLs (MEGA does not publish
/// stable direct-download links — everything is resolved dynamically there).
#[tauri::command]
pub fn mega_open_install_page() -> Result<(), String> {
    use crate::util::command::hidden_command;
    const URL: &str = "https://mega.nz/cmd";

    #[cfg(target_os = "macos")]
    let spawn = hidden_command("open").arg(URL).spawn();
    #[cfg(target_os = "windows")]
    let spawn = hidden_command("cmd").args(["/C", "start", "", URL]).spawn();
    #[cfg(target_os = "linux")]
    let spawn = hidden_command("xdg-open").arg(URL).spawn();

    spawn
        .map(|_| ())
        .map_err(|e| format!("Failed to open browser: {}", e))
}

#[tauri::command]
pub async fn mega_stop_webdav() -> Result<String, String> {
    webdav::stop_all()?;
    Ok("All WebDAV locations stopped".to_string())
}

/// Parse email from mega-whoami output.
/// Output format: "Account e-mail: user@example.com"
fn parse_whoami_email(output: &str) -> Option<String> {
    output
        .lines()
        .find(|l| l.contains("mail"))
        .and_then(|l| l.split(':').nth(1))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(entries: &[MegaEntry]) -> Vec<(&str, &str)> {
        entries
            .iter()
            .map(|e| (e.name.as_str(), e.entry_type.as_str()))
            .collect()
    }

    #[test]
    fn file_extension_heuristic() {
        assert!(has_file_extension("episode.mkv"));
        assert!(has_file_extension("archive.tar.gz"));
        assert!(has_file_extension("subs.SRT"));
        assert!(has_file_extension("clip.m4v"));
        // Folder-like names
        assert!(!has_file_extension("Season 1"));
        assert!(!has_file_extension("Mr. Robot")); // ext would contain a space
        assert!(!has_file_extension("trailing."));
        assert!(!has_file_extension("no-ext"));
        assert!(!has_file_extension("x.toolongextension")); // > 10 chars
        assert!(!has_file_extension("v.1-2")); // non-alphanumeric ext
    }

    #[test]
    fn whoami_email_is_extracted() {
        assert_eq!(
            parse_whoami_email("Account e-mail: user@example.com"),
            Some("user@example.com".to_string())
        );
        assert_eq!(
            parse_whoami_email("[some notice]\nAccount e-mail:   user@example.com  \nOther: x"),
            Some("user@example.com".to_string())
        );
    }

    #[test]
    fn whoami_without_email_is_none() {
        assert_eq!(parse_whoami_email("Not logged in."), None);
        assert_eq!(parse_whoami_email("Account e-mail:"), None);
        assert_eq!(parse_whoami_email(""), None);
    }

    #[test]
    fn plain_ls_uses_slash_or_extension_to_classify() {
        let out = "Season 1/\nExtras\nep01.mkv\nep01.srt\n\n";
        let entries = parse_ls_output("/Anime/Show", out);
        assert_eq!(
            names(&entries),
            vec![
                ("Season 1", "folder"),
                ("Extras", "folder"),
                ("ep01.mkv", "file"),
                ("ep01.srt", "file"),
            ]
        );
        assert_eq!(entries[0].path, "/Anime/Show/Season 1");
        assert_eq!(entries[2].path, "/Anime/Show/ep01.mkv");
        assert!(entries.iter().all(|e| e.size.is_empty()));
    }

    #[test]
    fn plain_ls_at_root_does_not_double_the_slash() {
        let entries = parse_ls_output("/", "Movies/");
        assert_eq!(entries[0].path, "/Movies");
    }

    #[test]
    fn plain_ls_skips_share_header_lines() {
        let out = "//from/user@mail.com:Folder/Sub:\nep01.mkv\n";
        let entries = parse_ls_output("//from/user@mail.com:Folder/Sub", out);
        assert_eq!(names(&entries), vec![("ep01.mkv", "file")]);
        assert_eq!(entries[0].path, "//from/user@mail.com:Folder/Sub/ep01.mkv");
    }

    #[test]
    fn long_ls_reads_size_and_folder_marker() {
        let out = "\
FLAGS  VERS      SIZE  DATE        TIME  NAME
d---    -            -  01Jan2024  10:00  Season 1
----    1    734003200  01Jan2024  10:00  ep01 v2.mkv
----    1         2048  01Jan2024  10:00  ep01.srt
garbage line
";
        let entries = parse_ls_output("/Show", out);
        assert_eq!(
            names(&entries),
            vec![
                ("Season 1", "folder"),
                ("ep01 v2.mkv", "file"),
                ("ep01.srt", "file"),
            ]
        );
        assert_eq!(entries[0].size, "");
        assert_eq!(entries[1].size, "700.0 MB");
        assert_eq!(entries[2].size, "2 KB");
        assert_eq!(entries[1].path, "/Show/ep01 v2.mkv");
    }

    #[test]
    fn mount_output_yields_incoming_shares() {
        let out = "\
ROOT on /
INBOX on //in
RUBBISH on //bin
INSHARE on //from/friend@mail.com:Anime (read access)
INSHARE on //from/other@mail.com:Movies HD (full access)
";
        let shares = parse_mount_shares(out);
        assert_eq!(shares.len(), 2);
        assert_eq!(shares[0].name, "Anime");
        assert_eq!(shares[0].owner, "friend@mail.com");
        assert_eq!(shares[0].path, "//from/friend@mail.com:Anime");
        assert_eq!(shares[0].access, "read access");
        assert_eq!(shares[1].name, "Movies HD");
        assert_eq!(shares[1].access, "full access");
    }

    #[test]
    fn mount_without_access_suffix_still_parses() {
        let shares = parse_mount_shares("INSHARE on //from/a@b.c:Folder");
        assert_eq!(shares.len(), 1);
        assert_eq!(shares[0].name, "Folder");
        assert_eq!(shares[0].owner, "a@b.c");
        assert_eq!(shares[0].access, "");
    }

    #[test]
    fn find_output_strips_marker_and_caps_depth() {
        let out = "\
/Anime (folder)
/Anime/Naruto (folder)
/Anime/Naruto/Season 1 (folder)
/Anime/a/b/c/d (folder)
/Anime/a/b/c/d/e (folder)
";
        let entries = parse_find_output("/Anime", out);
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        // Root itself (depth 0) and depth 5 are excluded; depth 4 is kept.
        assert_eq!(paths, vec!["/Anime/Naruto", "/Anime/Naruto/Season 1", "/Anime/a/b/c/d"]);
        assert_eq!(entries[1].name, "Season 1");
        assert!(entries.iter().all(|e| e.entry_type == "folder"));
    }

    #[test]
    fn find_output_in_shares_gets_from_prefix_back() {
        let root = "//from/friend@mail.com:Anime";
        let out = "friend@mail.com:Anime/Naruto (folder)\n";
        let entries = parse_find_output(root, out);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "//from/friend@mail.com:Anime/Naruto");
        assert_eq!(entries[0].name, "Naruto");
    }
}
