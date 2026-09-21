mod commands;
mod mega;
mod pipeline;
mod util;

use std::sync::Mutex;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Native handles for the embedded mpv video output, shared between the
/// `commands::player` commands.
pub struct MpvWindowState {
    /// Windows: HWND of mpv's own top-level window after it has been re-parented
    /// as a child of the Tauri window (see `attach_mpv_to_window`).
    pub hwnd: Mutex<Option<isize>>,
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
    ];

    tauri::Builder::default()
        .manage(MpvWindowState {
            hwnd: Mutex::new(None),
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
            commands::player::get_cursor_pos,
        ])
        .setup(|_app| {
            // Start mega-cmd-server in background on app launch (non-blocking)
            std::thread::spawn(|| {
                if mega::process::is_installed() {
                    let _ = mega::process::ensure_server();
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running dnjplayer");
}
