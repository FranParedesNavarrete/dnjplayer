mod commands;
mod mega;
mod pipeline;
mod util;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri_plugin_sql::{Migration, MigrationKind};

/// How long a quit may wait on MEGAcmd. `mega-exec` answers on loopback in well
/// under a second; anything past this means the server is wedged, and a wedged
/// helper must not hold the app's window open.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

/// `ExitRequested` and `Exit` can both fire for a single quit, so the teardown
/// is latched.
static SHUTDOWN_DONE: AtomicBool = AtomicBool::new(false);

/// Orderly shutdown. Runs at most once, on the main thread, from the run-event
/// loop.
///
/// What it does: stop every WebDAV location MEGAcmd is serving. `mega-cmd-server`
/// is a SEPARATE process that outlives us, so without this the user's Mega drive
/// stays exposed over HTTP on 127.0.0.1:4443 after the app is gone. This is the
/// only resource that actually leaks past process exit.
///
/// What it deliberately does NOT do: destroy the mpv instance.
///
/// The crash report from 2026-09-20 (`dnjplayer-2026-09-20-201441.ips`) is a
/// SIGSEGV inside libmpv's `hotplug_cb -> mp_msg`, reached from CoreAudio's HAL
/// device-list queue: an audio-device-change notification delivered AFTER mpv's
/// log context had been torn down. It reproduced during repeated init/destroy
/// cycles. Destroying mpv here would put that exact race on the app's very last
/// instruction, where a crash costs the user a crash report and buys nothing:
/// the process is about to exit, and the OS reclaims mpv's memory, GPU context
/// and audio device regardless. So mpv is left to die with the process, and the
/// only teardown we run is the one with an externally visible effect.
fn shutdown_once() {
    if SHUTDOWN_DONE.swap(true, Ordering::SeqCst) {
        return;
    }

    // Bounded: the actual `mega-exec` call runs on a throwaway thread so a
    // hung MEGAcmd cannot stall the quit. If it is still running when we give
    // up, the thread is simply abandoned along with the process.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(mega::webdav::stop_all());
    });

    match rx.recv_timeout(SHUTDOWN_TIMEOUT) {
        Ok(Ok(())) => log::info!("[shutdown] WebDAV shares stopped"),
        // Nothing served, or MEGAcmd not installed: both are normal, not errors.
        Ok(Err(e)) => log::debug!("[shutdown] WebDAV stop reported: {}", e),
        Err(_) => log::warn!(
            "[shutdown] MEGAcmd did not answer within {:?}; quitting anyway. WebDAV shares may still be served on 127.0.0.1:4443",
            SHUTDOWN_TIMEOUT
        ),
    }
}

/// Native handles for the embedded mpv video output, shared between the
/// `commands::player` commands.
pub struct MpvWindowState {
    /// Windows: HWND of mpv's own top-level window after it has been re-parented
    /// as a child of the Tauri window (see `attach_mpv_to_window`).
    pub hwnd: Mutex<Option<isize>>,
    /// macOS: mpv's own NSWindow after it has been attached as a child window
    /// ordered BELOW the Tauri window (see `attach_mpv_to_window`). Raw pointer,
    /// retained once by us; only dereferenced on the main thread.
    pub mac_mpv_window: Mutex<Option<isize>>,
}

pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create initial tables",
            sql: include_str!("db/migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create processing jobs table",
            sql: include_str!("db/migrations/002_jobs.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create watched files table",
            sql: include_str!("db/migrations/003_watched.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create favorites table",
            sql: include_str!("db/migrations/004_favorites.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create local roots table",
            sql: include_str!("db/migrations/005_local_roots.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add resume position to watched files",
            sql: include_str!("db/migrations/006_resume.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .manage(commands::fullscreen::ImmersiveState::default())
        .manage(MpvWindowState {
            hwnd: Mutex::new(None),
            mac_mpv_window: Mutex::new(None),
        })
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:dnjplayer.db", migrations)
                .build(),
        )
        // Persistent logging. Without a logger installed every `log::*` call in this
        // crate AND in tauri-plugin-libmpv is a silent no-op, so a user with a broken
        // player had nothing to send us. LogDir on macOS is ~/Library/Logs/<bundle id>/.
        // KeepOne + 5 MiB keeps the footprint bounded; the js_log bridge in
        // commands/player.rs feeds the webview console into the same file.
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("dnjplayer".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                .max_file_size(5 * 1024 * 1024)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_libmpv::init())
        .invoke_handler(tauri::generate_handler![
            commands::mega::mega_check_status,
            commands::mega::mega_ensure_server,
            commands::mega::mega_login,
            commands::mega::mega_logout,
            commands::mega::mega_whoami,
            commands::mega::mega_list_files,
            commands::mega::mega_list_shares,
            commands::mega::mega_search,
            commands::mega::mega_get_webdav_url,
            commands::mega::mega_stop_webdav,
            commands::mega::mega_server_generation,
            commands::mega::mega_open_install_page,
            commands::local::local_list_dir,
            commands::local::local_list_roots,
            commands::local::local_scan_folder,
            commands::local::local_search,
            commands::pipeline::submit_job,
            commands::pipeline::get_jobs,
            commands::pipeline::cancel_job,
            commands::library::get_library,
            commands::library::update_playback_position,
            commands::player::js_log,
            commands::player::attach_mpv_to_window,
            commands::player::resize_mpv_window,
            commands::player::hide_mpv_window,
            commands::player::restore_app_icon,
            commands::fullscreen::set_immersive_fullscreen,
            commands::player::get_cursor_pos,
            commands::player::dev_smoke_play_path,
        ])
        .setup(|app| {
            // Must happen before the user can touch the title bar. Setup runs on
            // the main thread, which is where AppKit requires this.
            if let Err(e) = commands::player::disable_native_fullscreen(app.handle()) {
                log::warn!("[player] could not disable native fullscreen: {}", e);
            }

            // Start mega-cmd-server in background on app launch (non-blocking)
            std::thread::spawn(|| {
                if mega::process::is_installed() {
                    let _ = mega::process::ensure_server();
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building dnjplayer")
        // `build` + `run(callback)` instead of `run(context)` purely to get the
        // run-event loop, which is the only place Tauri offers an exit hook.
        // `ExitRequested` fires on Cmd+Q / last window closed; `Exit` is the
        // last event before the process goes. Both are handled because the exact
        // path differs per platform, and `shutdown_once` latches.
        .run(|_app_handle, event| match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => shutdown_once(),
            _ => {}
        });
}
