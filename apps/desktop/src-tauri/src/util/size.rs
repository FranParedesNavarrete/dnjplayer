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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_below_one_kib_are_plain() {
        assert_eq!(format_size_bytes(0), "0 B");
        assert_eq!(format_size_bytes(1), "1 B");
        assert_eq!(format_size_bytes(1023), "1023 B");
    }

    #[test]
    fn kib_has_no_decimals() {
        assert_eq!(format_size_bytes(1024), "1 KB");
        assert_eq!(format_size_bytes(1_400), "1 KB");
        assert_eq!(format_size_bytes(700 * 1024), "700 KB");
    }

    #[test]
    fn mib_and_gib_have_one_decimal() {
        assert_eq!(format_size_bytes(1024 * 1024), "1.0 MB");
        assert_eq!(format_size_bytes(350 * 1024 * 1024 + 512 * 1024), "350.5 MB");
        assert_eq!(format_size_bytes(1024 * 1024 * 1024), "1.0 GB");
        assert_eq!(format_size_bytes(1_503_238_554), "1.4 GB");
    }

    #[test]
    fn megacmd_size_token_is_parsed_or_passed_through() {
        assert_eq!(format_size("2048"), "2 KB");
        assert_eq!(format_size("1073741824"), "1.0 GB");
        // Folders print "-" in `ls -l`; anything non-numeric is left alone.
        assert_eq!(format_size("-"), "-");
        assert_eq!(format_size(""), "");
        assert_eq!(format_size("12abc"), "12abc");
        assert_eq!(format_size("-5"), "-5");
    }
}
