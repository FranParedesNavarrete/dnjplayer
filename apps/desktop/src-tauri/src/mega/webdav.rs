use super::client;

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

/// Stop all WebDAV served locations
pub fn stop_all() -> Result<(), String> {
    client::exec(&["webdav", "-d", "--all"])?;
    Ok(())
}

/// List currently served WebDAV locations.
/// Returns Vec of (remote_path, local_url) pairs.
pub fn list_served() -> Result<Vec<(String, String)>, String> {
    let output = client::exec(&["webdav"])?;
    Ok(parse_served_list(&output))
}

/// Parse the output of a bare `webdav` (list) command.
/// Each served location is printed as `"  /remote/path: http://127.0.0.1:4443/XXXX/file"`.
/// Lines without a URL are ignored; a URL without a path yields an empty path.
fn parse_served_list(output: &str) -> Vec<(String, String)> {
    let mut locations = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
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

    locations
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_serving_line() {
        let out = "Serving '/Movies/a.mkv': http://127.0.0.1:4443/AbCd1234/a.mkv";
        assert_eq!(
            parse_webdav_url(out).as_deref(),
            Some("http://127.0.0.1:4443/AbCd1234/a.mkv")
        );
    }

    #[test]
    fn parses_already_served_line_and_trims_trailing_punctuation() {
        let out = "Already served '/Movies/a.mkv': http://127.0.0.1:4443/AbCd1234/a.mkv.";
        assert_eq!(
            parse_webdav_url(out).as_deref(),
            Some("http://127.0.0.1:4443/AbCd1234/a.mkv")
        );
    }

    #[test]
    fn url_stops_at_whitespace_and_first_match_wins() {
        let out = "info line\nServing '/x': https://host:4443/id/x.mp4 (read-only)\nhttp://other";
        assert_eq!(
            parse_webdav_url(out).as_deref(),
            Some("https://host:4443/id/x.mp4")
        );
    }

    #[test]
    fn no_url_returns_none() {
        assert_eq!(parse_webdav_url(""), None);
        assert_eq!(parse_webdav_url("[API:err: -9] Not found"), None);
    }

    #[test]
    fn served_list_pairs_paths_with_urls() {
        let out = "\
WEBDAV SERVED LOCATIONS:
  /Movies/a.mkv: http://127.0.0.1:4443/AbCd/a.mkv
  //from/user@mail.com:Shared/b.mkv: http://127.0.0.1:4443/EfGh/b.mkv

  http://127.0.0.1:4443/orphan
";
        let served = parse_served_list(out);
        assert_eq!(
            served,
            vec![
                (
                    "/Movies/a.mkv".to_string(),
                    "http://127.0.0.1:4443/AbCd/a.mkv".to_string()
                ),
                (
                    "//from/user@mail.com:Shared/b.mkv".to_string(),
                    "http://127.0.0.1:4443/EfGh/b.mkv".to_string()
                ),
                (String::new(), "http://127.0.0.1:4443/orphan".to_string()),
            ]
        );
    }

    #[test]
    fn served_list_is_empty_when_nothing_is_served() {
        assert!(parse_served_list("No webdav locations are being served").is_empty());
    }
}
