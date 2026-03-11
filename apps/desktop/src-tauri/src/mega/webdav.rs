use super::client;

/// Default WebDAV port used by MEGAcmd
const WEBDAV_DEFAULT_PORT: u16 = 4443;

/// Serve a remote path via WebDAV and return the local HTTP URL.
/// MEGAcmd outputs lines like:
///   "Serving '/path': http://127.0.0.1:4443/XXXX/filename"
/// or if already served:
///   "Already served '/path': http://..."
pub fn serve(remote_path: &str) -> Result<String, String> {
    let output = client::exec(&["webdav", remote_path])?;
    parse_webdav_url(&output).ok_or_else(|| {
        // If we can't parse the URL from the serve output,
        // try listing served locations to find it
        match list_served() {
            Ok(locations) => {
                for (path, url) in &locations {
                    if path == remote_path {
                        return url.clone();
                    }
                }
                format!(
                    "WebDAV URL not found in output: {}",
                    output.lines().next().unwrap_or("(empty)")
                )
            }
            Err(_) => format!(
                "Could not parse WebDAV URL from: {}",
                output.lines().next().unwrap_or("(empty)")
            ),
        }
    })
}

/// Stop serving a specific remote path via WebDAV
pub fn stop(remote_path: &str) -> Result<(), String> {
    client::exec(&["webdav", "-d", remote_path])?;
    Ok(())
}

/// Stop all WebDAV served locations
pub fn stop_all() -> Result<(), String> {
    client::exec(&["webdav", "-d", "--all"])?;
    Ok(())
}

/// List currently served WebDAV locations.
/// Returns Vec of (remote_path, local_url) pairs.
pub fn list_served() -> Result<Vec<(String, String)>, String> {
    let output = client::exec(&["webdav"])?;
    let mut locations = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Format: "  /remote/path: http://127.0.0.1:4443/XXXX/file"
        if let Some(url) = parse_webdav_url(line) {
            // Extract the path part before the URL
            if let Some(colon_pos) = line.find("http") {
                let path_part = line[..colon_pos].trim().trim_end_matches(':').trim();
                if !path_part.is_empty() {
                    locations.push((path_part.to_string(), url));
                    continue;
                }
            }
            locations.push((String::new(), url));
        }
    }

    Ok(locations)
}

/// Get the base WebDAV URL (http://127.0.0.1:PORT)
pub fn base_url() -> String {
    format!("http://127.0.0.1:{}", WEBDAV_DEFAULT_PORT)
}

/// Extract an HTTP/HTTPS URL from a line of text
fn parse_webdav_url(text: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        // Find http:// or https:// in the line
        if let Some(start) = line.find("http://").or_else(|| line.find("https://")) {
            // URL extends to end of line or next whitespace
            let url_part = &line[start..];
            let end = url_part
                .find(char::is_whitespace)
                .unwrap_or(url_part.len());
            let url = url_part[..end].trim_end_matches(|c: char| c == '.' || c == ',');
            return Some(url.to_string());
        }
    }
    None
}
