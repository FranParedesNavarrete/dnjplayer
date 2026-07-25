/// Format a byte count as a short human-readable string, e.g. `"1.4 GB"`.
///
/// Shared by the Mega listing (which parses sizes out of MEGAcmd output) and the
/// local filesystem listing (which reads them from `fs::Metadata`), so both
/// sources render sizes identically in the UI.
pub fn format_size_bytes(bytes: u64) -> String {
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

/// Same as [`format_size_bytes`], but for the raw size token MEGAcmd prints.
/// Anything that is not a plain byte count is passed through untouched.
pub fn format_size(bytes_str: &str) -> String {
    match bytes_str.parse::<u64>() {
        Ok(bytes) => format_size_bytes(bytes),
        Err(_) => bytes_str.to_string(),
    }
}
