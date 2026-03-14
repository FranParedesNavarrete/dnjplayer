mod commands;
mod mega;
mod pipeline;

use std::sync::Mutex;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Stores the mpv window handle (HWND on Windows) between attach and resize calls.
pub struct MpvWindowState {
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
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
            commands::pipeline::submit_job,
            commands::pipeline::get_jobs,
            commands::pipeline::cancel_job,
            commands::library::get_library,
            commands::library::update_playback_position,
            commands::player::js_log,
            commands::player::attach_mpv_to_window,
            commands::player::resize_mpv_window,
            commands::player::hide_mpv_window,
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
