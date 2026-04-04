use crate::mega::{client, process, webdav};
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

            let full_path = if path.ends_with('/') {
                format!("{}{}", path, &clean_name)
            } else {
                format!("{}/{}", path, &clean_name)
            };

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

            let full_path = if path.ends_with('/') {
                format!("{}{}", path, &clean_name)
            } else {
                format!("{}/{}", path, &clean_name)
            };

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

    Ok(entries)
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

    Ok(shares)
}

fn format_size(bytes_str: &str) -> String {
    let bytes: u64 = match bytes_str.parse() {
        Ok(b) => b,
        Err(_) => return bytes_str.to_string(),
    };
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.0} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

#[tauri::command]
pub async fn mega_search(query: String) -> Result<Vec<MegaEntry>, String> {
    let output = client::exec(&["find", "/", "--pattern", &format!("*{}*", query)])?;
    let entries = output
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| {
            let path = l.trim().to_string();
            let name = path
                .rsplit('/')
                .next()
                .unwrap_or(&path)
                .to_string();
            let is_folder = path.ends_with('/');
            MegaEntry {
                name: name.trim_end_matches('/').to_string(),
                path: path.trim_end_matches('/').to_string(),
                size: String::new(),
                entry_type: if is_folder {
                    "folder".to_string()
                } else {
                    "file".to_string()
                },
            }
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
pub async fn mega_get_webdav_url(remote_path: String) -> Result<String, String> {
    // Ensure server is running
    process::ensure_server()?;
    webdav::serve(&remote_path)
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
