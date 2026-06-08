use std::process::Command;

/// Build a [`Command`] that never spawns a visible console window on Windows.
///
/// On Windows, `std::process::Command` would otherwise flash a `cmd` window every
/// time a subprocess (MEGAcmd, Docker, ...) is launched, which looks like malware
/// to the user. This applies the `CREATE_NO_WINDOW` creation flag. On every other
/// platform it is just `Command::new`.
pub fn hidden_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    configure_no_window(&mut cmd);
    cmd
}

/// Apply the `CREATE_NO_WINDOW` flag to an existing command (Windows only; no-op
/// elsewhere).
#[cfg(windows)]
pub fn configure_no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn configure_no_window(_cmd: &mut Command) {}
