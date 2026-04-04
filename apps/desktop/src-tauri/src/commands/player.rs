/// Forward JavaScript console messages to the Rust terminal.
/// WKWebView on macOS does not print console.log to stdout, so we bridge via Tauri command.
#[tauri::command]
pub fn js_log(level: String, msg: String) {
    match level.as_str() {
        "error" => log::error!("[webview] {}", msg),
        "warn" => log::warn!("[webview] {}", msg),
        "debug" => log::debug!("[webview] {}", msg),
        _ => log::info!("[webview] {}", msg),
    }
}

/// Platform-specific commands for embedding mpv's window as a child of the Tauri window.
/// - macOS: NSWindow child window (addChildWindow_ordered) — dispatched to main thread
/// - Windows: Win32 owned window (SetWindowLongPtrW + SetWindowPos)
/// - Linux: tauri-plugin-libmpv handles embedding via --wid natively.

/// Attach mpv's window as a borderless child of the Tauri main window.
/// `mpv_window_ptr` is the raw window pointer obtained from mpv's `window-id` property.
///
/// IMPORTANT: On macOS, all NSWindow operations MUST happen on the main thread.
/// Tauri async commands run on tokio worker threads, so we use `run_on_main_thread`
/// to dispatch the actual window manipulation to the main thread.
#[tauri::command]
pub async fn attach_mpv_to_window(
    app: tauri::AppHandle,
    mpv_window_ptr: i64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;

        log::debug!("[player] attach_mpv_to_window called with ptr={}, dispatching to main thread", mpv_window_ptr);

        let (tx, rx) = mpsc::channel();
        let app_handle = app.clone();

        // Dispatch all NSWindow operations to the main thread
        app.run_on_main_thread(move || {
            let result = do_attach_mpv_macos(app_handle, mpv_window_ptr);
            let _ = tx.send(result);
        })
        .map_err(|e| format!("Failed to dispatch to main thread: {}", e))?;

        return rx
            .recv()
            .map_err(|e| format!("Channel receive error: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        use raw_window_handle::HasWindowHandle;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos,
            GWL_EXSTYLE, GWL_STYLE,
            HWND_TOP, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_SHOWWINDOW,
            WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_VISIBLE,
            WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE, WS_EX_TRANSPARENT,
        };

        let mpv_hwnd = HWND(mpv_window_ptr as *mut std::ffi::c_void);

        // Get Tauri's HWND
        let tauri_window = app
            .get_webview_window("main")
            .ok_or("Could not find main window")?;

        let handle = tauri_window
            .window_handle()
            .map_err(|e| format!("Failed to get window handle: {}", e))?;
        let raw = handle.as_raw();
        let tauri_hwnd = match raw {
            raw_window_handle::RawWindowHandle::Win32(win32) => {
                HWND(win32.hwnd.get() as *mut std::ffi::c_void)
            }
            _ => return Err("Not running on Windows".into()),
        };

        unsafe {
            // Set mpv as a child window of Tauri's main window
            SetWindowLongPtrW(mpv_hwnd, GWL_STYLE,
                (WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS).0 as isize
            );

            // Set extended styles: tool window (no taskbar), no-activate, transparent to mouse
            SetWindowLongPtrW(mpv_hwnd, GWL_EXSTYLE,
                (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT).0 as isize
            );

            // Re-parent: make mpv a child of Tauri window
            let _ = windows::Win32::UI::WindowsAndMessaging::SetParent(mpv_hwnd, tauri_hwnd);

            // Position mpv window to fill the client area
            let mut rect = windows::Win32::Foundation::RECT::default();
            let _ = windows::Win32::UI::WindowsAndMessaging::GetClientRect(tauri_hwnd, &mut rect);

            let _ = SetWindowPos(
                mpv_hwnd,
                HWND_TOP,
                0, 0,
                rect.right - rect.left,
                rect.bottom - rect.top,
                SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        }

        // Store the mpv HWND for later resize calls
        let state = app.state::<crate::MpvWindowState>();
        *state.hwnd.lock().map_err(|e| e.to_string())? = Some(mpv_window_ptr as isize);

        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, mpv_window_ptr);
        Ok(()) // No-op on Linux (plugin handles --wid)
    }
}

/// Helper that runs on the main thread to perform macOS NSWindow operations for attach.
#[cfg(target_os = "macos")]
fn do_attach_mpv_macos(app: tauri::AppHandle, mpv_window_ptr: i64) -> Result<(), String> {
    use tauri::Manager;
    use raw_window_handle::HasWindowHandle;
    use objc2::rc::Retained;
    use objc2_app_kit::{NSView, NSWindow, NSWindowOrderingMode, NSWindowStyleMask};
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    log::debug!("[player] do_attach_mpv_macos running on main thread, ptr={}", mpv_window_ptr);

    // Get the Tauri main window
    let tauri_window = app
        .get_webview_window("main")
        .ok_or("Could not find main window")?;

    // Get the native NSWindow handle from Tauri
    let handle = tauri_window
        .window_handle()
        .map_err(|e| format!("Failed to get window handle: {}", e))?;
    let raw = handle.as_raw();
    let tauri_ns_window: Retained<NSWindow> = match raw {
        raw_window_handle::RawWindowHandle::AppKit(appkit) => unsafe {
            let ns_view_ptr = appkit.ns_view.as_ptr() as *const NSView;
            let ns_view: &NSView = &*ns_view_ptr;
            ns_view.window().ok_or("NSView has no window")?
        },
        _ => return Err("Not running on macOS".into()),
    };

    // Get mpv's NSWindow from the raw pointer
    let mpv_ns_window: Retained<NSWindow> = unsafe {
        let ptr = mpv_window_ptr as *mut NSWindow;
        if ptr.is_null() {
            return Err("mpv window pointer is null".into());
        }
        Retained::retain(ptr).ok_or("Failed to retain mpv NSWindow")?
    };

    log::debug!("[player] Setting style mask to Borderless...");

    // Make mpv window borderless (remove title bar)
    mpv_ns_window.setStyleMask(NSWindowStyleMask::Borderless);
    mpv_ns_window.setHasShadow(false);

    // Ignore mouse events so clicks pass through to the Tauri webview,
    // keeping keyboard shortcuts working without focus loss.
    mpv_ns_window.setIgnoresMouseEvents(true);

    log::debug!("[player] Adding mpv as child window...");

    // Add mpv window as child of Tauri window
    unsafe {
        tauri_ns_window.addChildWindow_ordered(
            &mpv_ns_window,
            NSWindowOrderingMode::Above,
        );
    }

    // Start mpv window hidden (1x1 at origin) — the JS ResizeObserver will
    // call resize_mpv_window with the correct video-area rect shortly after.
    let origin = tauri_ns_window.frame().origin;
    let initial_frame = NSRect::new(
        NSPoint::new(origin.x, origin.y),
        NSSize::new(1.0, 1.0),
    );
    mpv_ns_window.setFrame_display(initial_frame, false);

    log::info!("[player] mpv window attached (hidden, awaiting resize)");
    Ok(())
}

/// Hide the mpv child window completely (orderOut on macOS, ShowWindow(SW_HIDE) on Windows).
/// This is the proper way to hide an NSWindow — setting it to 1x1 px is not sufficient.
#[tauri::command]
pub async fn hide_mpv_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;

        let (tx, rx) = mpsc::channel();
        let app_handle = app.clone();

        app.run_on_main_thread(move || {
            let result = do_hide_mpv_macos(app_handle);
            let _ = tx.send(result);
        })
        .map_err(|e| format!("Failed to dispatch to main thread: {}", e))?;

        return rx
            .recv()
            .map_err(|e| format!("Channel receive error: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

        let state = app.state::<crate::MpvWindowState>();
        let hwnd_val = *state.hwnd.lock().map_err(|e| e.to_string())?;
        if let Some(val) = hwnd_val {
            let mpv_hwnd = HWND(val as *mut std::ffi::c_void);
            unsafe { let _ = ShowWindow(mpv_hwnd, SW_HIDE); }
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        Ok(())
    }
}

/// Helper to hide the mpv NSWindow on macOS using orderOut.
#[cfg(target_os = "macos")]
fn do_hide_mpv_macos(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use raw_window_handle::HasWindowHandle;
    use objc2_app_kit::{NSView, NSWindow, NSWindowStyleMask};

    let tauri_window = app
        .get_webview_window("main")
        .ok_or("Could not find main window")?;

    let handle = tauri_window
        .window_handle()
        .map_err(|e| format!("Failed to get window handle: {}", e))?;
    let raw = handle.as_raw();
    let tauri_ns_window: objc2::rc::Retained<NSWindow> = match raw {
        raw_window_handle::RawWindowHandle::AppKit(appkit) => unsafe {
            let ns_view_ptr = appkit.ns_view.as_ptr() as *const NSView;
            let ns_view: &NSView = &*ns_view_ptr;
            ns_view.window().ok_or("NSView has no window")?
        },
        _ => return Err("Not running on macOS".into()),
    };

    // Find the borderless child (mpv) and hide it with orderOut
    if let Some(children) = tauri_ns_window.childWindows() {
        let count = children.count();
        for i in 0..count {
            let child = children.objectAtIndex(i);
            if child.styleMask().contains(NSWindowStyleMask::Borderless) {
                log::debug!("[player] Hiding mpv window via orderOut");
                child.orderOut(None);
                break;
            }
        }
    }

    Ok(())
}

/// Resize/reposition the mpv child window to match the video area.
/// Coordinates are relative to the Tauri window's content area (top-left origin).
///
/// On macOS, dispatched to the main thread (same reason as attach).
#[tauri::command]
pub async fn resize_mpv_window(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;

        let (tx, rx) = mpsc::channel();
        let app_handle = app.clone();

        // Dispatch all NSWindow operations to the main thread
        app.run_on_main_thread(move || {
            let result = do_resize_mpv_macos(app_handle, x, y, width, height);
            let _ = tx.send(result);
        })
        .map_err(|e| format!("Failed to dispatch to main thread: {}", e))?;

        return rx
            .recv()
            .map_err(|e| format!("Channel receive error: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOZORDER,
        };

        let state = app.state::<crate::MpvWindowState>();
        let hwnd_val = *state.hwnd.lock().map_err(|e| e.to_string())?;
        let hwnd_val = hwnd_val.ok_or("mpv window not attached")?;
        let mpv_hwnd = HWND(hwnd_val as *mut std::ffi::c_void);

        // JS getBoundingClientRect() returns CSS pixels; Win32 SetWindowPos expects
        // physical pixels. Multiply by the window's scale factor for HiDPI displays.
        let scale = app
            .get_webview_window("main")
            .map(|w| w.scale_factor().unwrap_or(1.0))
            .unwrap_or(1.0);

        unsafe {
            let _ = SetWindowPos(
                mpv_hwnd,
                HWND_TOP,
                (x * scale) as i32,
                (y * scale) as i32,
                (width * scale) as i32,
                (height * scale) as i32,
                SWP_NOACTIVATE | SWP_NOZORDER,
            );
        }

        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, x, y, width, height);
        Ok(())
    }
}

/// Helper that runs on the main thread to perform macOS NSWindow operations for resize.
///
/// Coordinate conversion: the JS side sends (x, y, width, height) from
/// `getBoundingClientRect()` which uses a top-left origin relative to the
/// webview content area. macOS uses a bottom-left screen origin, so we must
/// convert using the content view height (NOT the window frame height, which
/// includes the title bar).
#[cfg(target_os = "macos")]
fn do_resize_mpv_macos(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    use tauri::Manager;
    use raw_window_handle::HasWindowHandle;
    use objc2_app_kit::{NSView, NSWindow, NSWindowStyleMask};
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let tauri_window = app
        .get_webview_window("main")
        .ok_or("Could not find main window")?;

    // Get Tauri's NSWindow
    let handle = tauri_window
        .window_handle()
        .map_err(|e| format!("Failed to get window handle: {}", e))?;
    let raw = handle.as_raw();
    let tauri_ns_window: objc2::rc::Retained<NSWindow> = match raw {
        raw_window_handle::RawWindowHandle::AppKit(appkit) => unsafe {
            let ns_view_ptr = appkit.ns_view.as_ptr() as *const NSView;
            let ns_view: &NSView = &*ns_view_ptr;
            ns_view.window().ok_or("NSView has no window")?
        },
        _ => return Err("Not running on macOS".into()),
    };

    // Get content view height (excludes title bar) for correct Y conversion
    let content_height = tauri_ns_window
        .contentView()
        .map(|cv| cv.frame().size.height)
        .unwrap_or(tauri_ns_window.frame().size.height);

    let tauri_frame = tauri_ns_window.frame();

    // Find the borderless child window (mpv) and resize it
    if let Some(children) = tauri_ns_window.childWindows() {
        let count = children.count();
        for i in 0..count {
            let child = children.objectAtIndex(i);
            if child.styleMask().contains(NSWindowStyleMask::Borderless) {
                // Convert from webview top-left coords to macOS screen bottom-left coords.
                // The content area's bottom-left in screen coords = window frame origin
                // (the content view sits at the bottom of the window, title bar is at top).
                let screen_x = tauri_frame.origin.x + x;
                let screen_y = tauri_frame.origin.y + content_height - y - height;

                let new_frame = NSRect::new(
                    NSPoint::new(screen_x, screen_y),
                    NSSize::new(width, height),
                );
                child.setFrame_display(new_frame, true);

                // Ensure the window is visible (it may have been hidden via orderOut)
                if !child.isVisible() {
                    child.orderFront(None);
                }
                break;
            }
        }
    }

    Ok(())
}
