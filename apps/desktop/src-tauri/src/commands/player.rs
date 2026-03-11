/// macOS-specific commands for embedding mpv's window as a child of the Tauri window.
/// On Windows/Linux, the tauri-plugin-libmpv handles embedding via --wid natively.

/// Attach mpv's window as a borderless child of the Tauri main window.
/// `mpv_window_ptr` is the raw NSWindow pointer obtained from mpv's `window-id` property.
#[tauri::command]
pub async fn attach_mpv_to_window(
    app: tauri::AppHandle,
    mpv_window_ptr: i64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        use raw_window_handle::HasWindowHandle;
        use objc2::rc::Retained;
        use objc2_app_kit::{NSView, NSWindow, NSWindowOrderingMode, NSWindowStyleMask};
        use objc2_foundation::{NSPoint, NSRect, NSSize};

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

        // Make mpv window borderless (remove title bar)
        mpv_ns_window.setStyleMask(NSWindowStyleMask::Borderless);
        mpv_ns_window.setHasShadow(false);

        // Add mpv window as child of Tauri window
        unsafe {
            tauri_ns_window.addChildWindow_ordered(
                &mpv_ns_window,
                NSWindowOrderingMode::Above,
            );
        }

        // Match mpv window frame to Tauri window's content area
        if let Some(content_view) = tauri_ns_window.contentView() {
            let content_frame = content_view.frame();
            let origin = tauri_ns_window.frame().origin;
            let new_frame = NSRect::new(
                NSPoint::new(origin.x, origin.y),
                NSSize::new(content_frame.size.width, content_frame.size.height),
            );
            mpv_ns_window.setFrame_display(new_frame, true);
        }

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, mpv_window_ptr);
        Ok(()) // No-op on other platforms
    }
}

/// Resize/reposition the mpv child window to match the video area.
/// Coordinates are relative to the Tauri window's content area (top-left origin).
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

        // Find the borderless child window (mpv) and resize it
        if let Some(children) = tauri_ns_window.childWindows() {
            let count = children.count();
            for i in 0..count {
                let child = children.objectAtIndex(i);
                if child.styleMask().contains(NSWindowStyleMask::Borderless) {
                    let tauri_frame = tauri_ns_window.frame();
                    // macOS uses bottom-left origin, convert from top-left
                    let screen_x = tauri_frame.origin.x + x;
                    let screen_y =
                        tauri_frame.origin.y + tauri_frame.size.height - y - height;
                    let new_frame = NSRect::new(
                        NSPoint::new(screen_x, screen_y),
                        NSSize::new(width, height),
                    );
                    child.setFrame_display(new_frame, true);
                    break;
                }
            }
        }

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, x, y, width, height);
        Ok(())
    }
}
