//! Immersive full screen for macOS, without AppKit's full-screen Space.
//!
//! Two things were wrong with the previous approach (`setDecorations(false)` +
//! `maximize()` from the frontend):
//!
//! 1. It was not full screen. `maximize` sizes the window to the screen's
//!    *visibleFrame*, which excludes the menu bar and the Dock, so both stayed on
//!    screen over the video.
//! 2. Toggling decorations on a `transparent: true` window leaves the title bar
//!    without its backing material on the way back, so the top strip of the
//!    window turned see-through and showed whatever was behind the app. A user hit
//!    this on 1.5.0 and it looked like the app had lost its frame.
//!
//! Native full screen is not the alternative: it moves the window into its own
//! Space, and AppKit re-orders child windows ABOVE their parent when it does, so
//! mpv's surface would cover the whole UI (see `disable_native_fullscreen`).
//!
//! What works is doing by hand what a full-screen Space does, while staying in the
//! current Space:
//!
//!   - `NSApplicationPresentationOptions` auto-hides the menu bar and the Dock.
//!   - The window is sized to the screen's full `frame`, not its `visibleFrame`.
//!   - The title bar is made invisible WITHOUT touching the style mask's `Titled`
//!     bit: transparent title bar, hidden title, hidden traffic lights, and
//!     `FullSizeContentView` so the content reaches the top of the screen. All four
//!     are reversible and none of them disturbs the window's backing material.
//!
//! Child window ordering is untouched because there is no Space transition, so the
//! video stays below the UI exactly as it does in a window.

use std::sync::Mutex;

/// The window frame to go back to when leaving immersive mode, as
/// (x, y, width, height) in AppKit screen coordinates. `NSRect` is not `Send`,
/// hence the tuple.
#[derive(Default)]
pub struct ImmersiveState {
    pub saved_frame: Mutex<Option<(f64, f64, f64, f64)>>,
    /// Whether immersive mode is on right now. `do_resize_mpv_macos` reads this:
    /// while immersive, the video surface is snapped to the whole screen instead of
    /// to the DOM's video-area rect. The rect is converted through
    /// `contentLayoutRect`, which excludes the title bar's band — and the title bar
    /// still occupies layout when immersive even though it is invisible, so the
    /// page (and therefore the surface) starts below it. That left a ~28pt strip at
    /// the top of the screen with no document and no surface behind it, and with a
    /// transparent window that strip showed the DESKTOP. No CSS can reach it.
    /// Letting mpv own the whole screen fills it with mpv's own black, which is
    /// also what makes full screen feel like a cinema rather than a big window.
    pub active: Mutex<bool>,
    /// Whether WE added `FullSizeContentView`. Tauri already sets it on a
    /// `transparent: true` window, and the webview's coordinate conversion in
    /// `do_resize_mpv_macos` depends on the resulting layout, so clearing a bit we
    /// did not set would put the video a title bar's height out on the way back.
    pub added_full_size: Mutex<bool>,
}

/// Enter or leave immersive full screen. macOS only; a no-op elsewhere, where the
/// frontend uses real native full screen instead (the mpv window is composited on
/// top of the webview there, so a Space transition costs us nothing).
#[tauri::command]
pub fn set_immersive_fullscreen(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // AppKit only. Fire-and-forget, but `run_on_main_thread` keeps FIFO order,
        // so a rapid enter/leave pair cannot save the immersive frame as the one to
        // restore.
        let handle = app.clone();
        app.run_on_main_thread(move || {
            if let Err(e) = apply_immersive(&handle, on) {
                log::warn!("[fullscreen] immersive {} failed: {}", on, e);
            }
        })
        .map_err(|e| format!("Failed to dispatch to main thread: {}", e))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, on);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn apply_immersive(app: &tauri::AppHandle, on: bool) -> Result<(), String> {
    use objc2_app_kit::{
        NSApplication, NSApplicationPresentationOptions, NSWindowButton, NSWindowStyleMask,
        NSWindowTitleVisibility,
    };
    use objc2_foundation::MainThreadMarker;
    use tauri::Manager;

    let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
    let win = crate::commands::player::tauri_ns_window(app)?;
    let ns_app = NSApplication::sharedApplication(mtm);
    let state = app.state::<ImmersiveState>();

    // The traffic lights. Hidden rather than removed from the style mask, so the
    // window keeps its `Titled` backing and comes back intact.
    let buttons = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ];

    if on {
        let screen_frame = win
            .screen()
            .ok_or("window is not on a screen")?
            .frame();

        {
            let current = win.frame();
            let mut saved = state
                .saved_frame
                .lock()
                .map_err(|_| "saved_frame mutex poisoned")?;
            // Only the FIRST enter records the frame: entering twice in a row must
            // not overwrite the windowed geometry with the immersive one.
            if saved.is_none() {
                *saved = Some((
                    current.origin.x,
                    current.origin.y,
                    current.size.width,
                    current.size.height,
                ));
            }
        }

        ns_app.setPresentationOptions(
            NSApplicationPresentationOptions::AutoHideMenuBar
                | NSApplicationPresentationOptions::AutoHideDock,
        );
        let mask = win.styleMask();
        if !mask.contains(NSWindowStyleMask::FullSizeContentView) {
            win.setStyleMask(mask | NSWindowStyleMask::FullSizeContentView);
            *state
                .added_full_size
                .lock()
                .map_err(|_| "added_full_size mutex poisoned")? = true;
        }
        win.setTitlebarAppearsTransparent(true);
        win.setTitleVisibility(NSWindowTitleVisibility::Hidden);
        for b in buttons {
            if let Some(button) = win.standardWindowButton(b) {
                button.setHidden(true);
            }
        }
        win.setFrame_display(screen_frame, true);
        *state.active.lock().map_err(|_| "active mutex poisoned")? = true;
    } else {
        *state.active.lock().map_err(|_| "active mutex poisoned")? = false;
        ns_app.setPresentationOptions(NSApplicationPresentationOptions::empty());
        let added = {
            let mut f = state
                .added_full_size
                .lock()
                .map_err(|_| "added_full_size mutex poisoned")?;
            std::mem::replace(&mut *f, false)
        };
        if added {
            win.setStyleMask(win.styleMask() & !NSWindowStyleMask::FullSizeContentView);
        }
        win.setTitlebarAppearsTransparent(false);
        win.setTitleVisibility(NSWindowTitleVisibility::Visible);
        for b in buttons {
            if let Some(button) = win.standardWindowButton(b) {
                button.setHidden(false);
            }
        }
        let saved = state
            .saved_frame
            .lock()
            .map_err(|_| "saved_frame mutex poisoned")?
            .take();
        if let Some((x, y, w, h)) = saved {
            win.setFrame_display(
                objc2_foundation::NSRect::new(
                    objc2_foundation::NSPoint::new(x, y),
                    objc2_foundation::NSSize::new(w, h),
                ),
                true,
            );
        }
    }
    Ok(())
}
