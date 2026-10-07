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

/// Native glue for embedding libmpv's video output inside the Tauri window.
///
/// - macOS: mpv (0.40+) IGNORES `wid`: its Swift backend (`video/out/mac/common.swift`)
///   always creates its own NSWindow, and the old OpenGL `cocoa` context that honoured
///   `wid` was removed. So we take mpv's window (from the `window-id` property), make
///   it borderless and attach it as a child window ordered BELOW the Tauri window.
///   The Tauri window is transparent and the DOM stops painting under the video area
///   (`html.video-hole`, see app.css), so the video shows through and DOM elements can
///   be drawn on top of it. `resize_mpv_window` moves the child to track `.video-area`.
///   Everything that touches AppKit is dispatched to the main thread.
/// - Windows: mpv's own window is re-parented as a child of the Tauri window via Win32
///   (`SetParent`). It sits ON TOP of the webview, so DOM cannot overlap the video there.
/// - Linux: tauri-plugin-libmpv handles embedding via --wid natively.

/// Debug harness: absolute path of a file the player page should load on mount,
/// taken from the `DNJ_SMOKE_PLAY` environment variable. Always `None` in release
/// builds so it can't be triggered on a user's machine.
#[tauri::command]
pub fn dev_smoke_play_path() -> Option<String> {
    if cfg!(debug_assertions) {
        std::env::var("DNJ_SMOKE_PLAY").ok().filter(|s| !s.is_empty())
    } else {
        None
    }
}

/// Attach mpv's window to the Tauri main window.
/// `mpv_window_ptr` is the raw window pointer obtained from mpv's `window-id` property
/// (NSWindow* on macOS, HWND on Windows).
#[tauri::command]
pub async fn attach_mpv_to_window(
    app: tauri::AppHandle,
    mpv_window_ptr: i64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;

        log::debug!("[player] attach_mpv_to_window ptr={}, dispatching to main thread", mpv_window_ptr);

        // One-shot: waiting for the result here is fine (it happens once per mpv
        // window) and lets the frontend know whether the attach worked.
        let (tx, rx) = mpsc::channel();
        let app_handle = app.clone();
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
            HWND_TOP, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_HIDEWINDOW,
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

            // Start HIDDEN at 1x1 (like macOS). resize_mpv_window will show and
            // position it over the video area once the player page mounts.
            // Filling the whole client area + showing here covered the entire app
            // in black while the stream loaded — looked like the app was broken.
            let _ = SetWindowPos(
                mpv_hwnd,
                HWND_TOP,
                0, 0, 1, 1,
                SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_HIDEWINDOW,
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

/// Main-thread body of `attach_mpv_to_window` on macOS.
///
/// Idempotent: re-attaching the same window only refreshes its style/order, which
/// the frontend relies on (it re-attaches once shortly after the first attach).
#[cfg(target_os = "macos")]
fn do_attach_mpv_macos(app: tauri::AppHandle, mpv_window_ptr: i64) -> Result<(), String> {
    use tauri::Manager;
    use objc2::rc::Retained;
    use objc2_app_kit::{NSWindow, NSWindowOrderingMode, NSWindowStyleMask};
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let tauri_ns_window = tauri_ns_window(&app)?;

    // Get mpv's NSWindow from the raw pointer
    let mpv_ns_window: Retained<NSWindow> = unsafe {
        let ptr = mpv_window_ptr as *mut NSWindow;
        if ptr.is_null() {
            return Err("mpv window pointer is null".into());
        }
        Retained::retain(ptr).ok_or("Failed to retain mpv NSWindow")?
    };

    // Borderless, no shadow: it must look like part of our window, not a window.
    mpv_ns_window.setStyleMask(NSWindowStyleMask::Borderless);
    mpv_ns_window.setHasShadow(false);
    // It sits below the webview so it never gets the mouse anyway; be explicit so
    // AppKit never routes a click to it should the ordering ever flip.
    mpv_ns_window.setIgnoresMouseEvents(true);
    let state = app.state::<crate::MpvWindowState>();
    let mut slot = state.mac_mpv_window.lock().map_err(|e| e.to_string())?;
    let already_attached = *slot == Some(mpv_window_ptr as isize);

    if !already_attached {
        // Fully transparent until the first resize positions it over the video
        // area; orderOut would detach it from the parent, alpha keeps it attached.
        // Only on the FIRST attach: the frontend re-attaches once shortly after,
        // and hiding it again there would undo the resize that already showed it.
        mpv_ns_window.setAlphaValue(0.0);
        // Child window BELOW the parent: the parent (Tauri window) is transparent
        // and the DOM leaves a hole over the video area, so the video shows
        // through while every DOM element paints above it. `Above` — the previous
        // design — put the video over the whole UI instead.
        unsafe {
            tauri_ns_window.addChildWindow_ordered(&mpv_ns_window, NSWindowOrderingMode::Below);
        }
        let origin = tauri_ns_window.frame().origin;
        mpv_ns_window.setFrame_display(
            NSRect::new(NSPoint::new(origin.x, origin.y), NSSize::new(1.0, 1.0)),
            false,
        );
        log::info!(
            "[player] mpv window attached below the Tauri window (hidden, awaiting resize); tauri window opaque={} alpha={} mpv level={} tauri level={}",
            tauri_ns_window.isOpaque(),
            tauri_ns_window.alphaValue(),
            mpv_ns_window.level(),
            tauri_ns_window.level()
        );
        // Keep our own retain so the pointer stays valid as long as we hold it.
        let _ = Retained::into_raw(mpv_ns_window);
        *slot = Some(mpv_window_ptr as isize);
    }

    Ok(())
}

/// Hide the mpv video surface (child window on both platforms).
/// The next `resize_mpv_window` shows it again.
#[tauri::command]
pub async fn hide_mpv_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let Some(ptr) = mac_mpv_window_ptr(&app)? else {
            return Ok(()); // never attached: nothing to hide
        };
        // Fire-and-forget: the caller doesn't need the result, and blocking a tokio
        // worker on the main thread here caused stalls in the previous design.
        app.run_on_main_thread(move || {
            let win = unsafe { mac_mpv_window_ref(ptr) };
            win.setAlphaValue(0.0);
        })
        .map_err(|e| format!("Failed to dispatch to main thread: {}", e))?;
        Ok(())
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

/// Resize/reposition the mpv video surface to match the `.video-area` element.
/// Coordinates are CSS pixels from `getBoundingClientRect()` (top-left origin,
/// relative to the webview viewport).
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
        let ptr = mac_mpv_window_ptr(&app)?.ok_or("mpv window not attached")?;
        // Fire-and-forget (see hide_mpv_window). Layout events can arrive in bursts
        // during a window resize; the main thread applies them in order.
        let app_handle = app.clone();
        app.run_on_main_thread(move || {
            if let Err(e) = do_resize_mpv_macos(&app_handle, ptr, x, y, width, height) {
                log::warn!("[player] resize failed: {}", e);
            }
        })
        .map_err(|e| format!("Failed to dispatch to main thread: {}", e))?;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, ShowWindow, HWND_TOP, SWP_NOACTIVATE, SWP_NOZORDER, SW_SHOWNA,
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
            // Re-show the window in case it was hidden (SW_HIDE) when navigating
            // away. SW_SHOWNA = show without stealing activation/focus.
            let _ = ShowWindow(mpv_hwnd, SW_SHOWNA);
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

/// Absolute path of the bundled Anime4K shader directory.
///
/// Resolved here rather than in the frontend because Rust is the only side that
/// knows where the files actually are in BOTH modes, and because this is the only
/// place that can cheaply check they exist.
///
/// It had been `resolveResource('shaders')`, which was wrong in both:
///   - packaged: `bundle.resources` listed `../static/shaders/**/*`, and Tauri
///     escapes a path that climbs out of the project root, so the files land in
///     `Resources/_up_/static/shaders/` while that call returns
///     `Resources/shaders`;
///   - dev: the fallback was the relative string `"shaders"`, which mpv resolved
///     against its working directory — `src-tauri/target/debug/shaders`.
/// Neither path existed, and `setProperty('glsl-shaders', …)` accepts paths it
/// never opens, so mpv only failed later at render time while the app logged
/// "Anime4K shaders loaded". The feature was silently dead in every build, which
/// is exactly how a user came to notice that disabling Anime4K changed nothing at
/// all about performance.
///
/// Returning `Err` when nothing is found is the point: the caller surfaces it
/// instead of pretending.
#[tauri::command]
pub fn shader_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    let mut tried: Vec<String> = Vec::new();

    // Packaged: `bundle.resources` maps the shaders to `Resources/shaders`.
    if let Ok(resources) = app.path().resource_dir() {
        let candidate = resources.join("shaders");
        if candidate.is_dir() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
        tried.push(candidate.to_string_lossy().into_owned());
    }

    // Dev: no bundle, but the repo is right there. Baked in at compile time, so
    // it simply fails over in a release build where it does not exist.
    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../static/shaders");
    if dev.is_dir() {
        return Ok(dev.to_string_lossy().into_owned());
    }
    tried.push(dev.to_string_lossy().into_owned());

    Err(format!("Anime4K shaders not found. Tried: {}", tried.join(", ")))
}

/// macOS: put our own icon back in the Dock.
///
/// libmpv's Cocoa backend calls `NSApplication.setApplicationIconImage` with mpv's
/// own logo when it brings up its window. That property is per-PROCESS, not per
/// window, so the Dock tile for dnjplayer turns into mpv's. Passing `None` clears
/// the override and AppKit falls back to the icon in the bundle's Info.plist.
///
/// Called after the surface is attached and after every full-screen toggle, because
/// mpv re-applies it whenever it rebuilds its window rather than only once.
#[tauri::command]
pub fn restore_app_icon(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // AppKit, so main thread. Fire-and-forget: the Dock tile is cosmetic and
        // never worth blocking a caller or failing a playback path over.
        app.run_on_main_thread(|| {
            use objc2_app_kit::NSApplication;
            use objc2_foundation::MainThreadMarker;

            if let Some(mtm) = MainThreadMarker::new() {
                let ns_app = NSApplication::sharedApplication(mtm);
                unsafe { ns_app.setApplicationIconImage(None) };
            }
        })
        .map_err(|e| format!("Failed to dispatch to main thread: {}", e))?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

/// macOS: take native full screen off the table.
///
/// The green title-bar button and View > Enter Full Screen move the window into a
/// full-screen Space, and AppKit re-orders child windows ABOVE their parent when
/// it does that. mpv's window is a child ordered BELOW (see `do_attach_mpv_macos`),
/// so native full screen covers the entire webview with the video surface —
/// controls included — and the surface also loses the geometry the webview had
/// synced to it, which is why the picture goes missing rather than just covering
/// the UI. Re-adding the child with `NSWindowOrderingMode::Below` after the
/// transition does not stick; that was measured during the 2026-09-21 spike and is
/// why the app's own full screen is borderless + maximised instead (see
/// `toggleFullscreen` in player-service.ts).
///
/// Users reached the broken state by combining the two: app full screen first, then
/// the green button. Clearing `FullScreenPrimary` and setting `FullScreenNone`
/// makes the green button zoom the window instead and greys out the menu item.
/// Zoom is compatible with the embedding, so neither control can reach the broken
/// state any more, in either order.
#[cfg(target_os = "macos")]
pub fn disable_native_fullscreen(app: &tauri::AppHandle) -> Result<(), String> {
    use objc2_app_kit::NSWindowCollectionBehavior;

    let win = tauri_ns_window(app)?;
    let mut behavior = win.collectionBehavior();
    behavior.remove(NSWindowCollectionBehavior::FullScreenPrimary);
    behavior.remove(NSWindowCollectionBehavior::FullScreenAuxiliary);
    behavior.insert(NSWindowCollectionBehavior::FullScreenNone);
    win.setCollectionBehavior(behavior);
    Ok(())
}

/// No-op off macOS: there the mpv window is re-parented on top of the webview and
/// native full screen is the right thing to use.
#[cfg(not(target_os = "macos"))]
pub fn disable_native_fullscreen(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

/// Tauri's main NSWindow. Must be called on the main thread.
#[cfg(target_os = "macos")]
pub(crate) fn tauri_ns_window(app: &tauri::AppHandle) -> Result<objc2::rc::Retained<objc2_app_kit::NSWindow>, String> {
    use tauri::Manager;
    use raw_window_handle::HasWindowHandle;
    use objc2_app_kit::NSView;

    let tauri_window = app
        .get_webview_window("main")
        .ok_or("Could not find main window")?;
    let handle = tauri_window
        .window_handle()
        .map_err(|e| format!("Failed to get window handle: {}", e))?;
    match handle.as_raw() {
        raw_window_handle::RawWindowHandle::AppKit(appkit) => unsafe {
            let ns_view_ptr = appkit.ns_view.as_ptr() as *const NSView;
            let ns_view: &NSView = &*ns_view_ptr;
            ns_view.window().ok_or("NSView has no window".into())
        },
        _ => Err("Not running on macOS".into()),
    }
}

/// Read the stored mpv NSWindow pointer (macOS).
#[cfg(target_os = "macos")]
fn mac_mpv_window_ptr(app: &tauri::AppHandle) -> Result<Option<isize>, String> {
    use tauri::Manager;
    Ok(*app
        .state::<crate::MpvWindowState>()
        .mac_mpv_window
        .lock()
        .map_err(|e| e.to_string())?)
}

/// Turn the stored pointer back into a window reference.
///
/// SAFETY: the pointer was retained in `do_attach_mpv_macos` and is never released,
/// so it stays valid while stored. Must only be called on the main thread.
#[cfg(target_os = "macos")]
unsafe fn mac_mpv_window_ref<'a>(ptr: isize) -> &'a objc2_app_kit::NSWindow {
    &*(ptr as *const objc2_app_kit::NSWindow)
}

/// Main-thread body of `resize_mpv_window` on macOS.
///
/// Coordinate conversion: the JS rect is top-left relative to the webview's
/// viewport; CSS px == AppKit points on macOS (the backing scale is applied by the
/// layer). The viewport is the window's `contentLayoutRect`: with a transparent
/// window Tauri uses a full-size content view (title bar included) and the
/// WKWebView, although sized to the whole content view, lays out its page below
/// the title bar. Measuring against `contentView.frame` or the webview's frame
/// therefore puts the video 28pt (one title bar) too high; `contentLayoutRect` is
/// the area not covered by the title bar, whatever the window style. Window
/// coordinates are bottom-left, hence the height subtraction, and
/// `convertRectToScreen` yields the screen frame an NSWindow needs.
#[cfg(target_os = "macos")]
fn do_resize_mpv_macos(
    app: &tauri::AppHandle,
    ptr: isize,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let tauri_ns_window = tauri_ns_window(app)?;
    let mpv_window = unsafe { mac_mpv_window_ref(ptr) };

    // Snap outward to whole pixels so the video surface always fully covers the
    // transparent DOM rect (a fractional gap shows the desktop through the window).
    let left = x.floor();
    let top = y.floor();
    let w = ((x + width).ceil() - left).max(1.0);
    let h = ((y + height).ceil() - top).max(1.0);

    // Immersive full screen: mpv owns the WHOLE screen, not the DOM rect.
    //
    // The conversion below goes through `contentLayoutRect`, which excludes the
    // title bar's band, and the title bar still occupies layout while immersive
    // even though it is invisible — so the page, and with it the surface, starts
    // ~28pt down. That strip had no document and no surface behind it, and through
    // a transparent window it showed the user's DESKTOP. It is unreachable from
    // CSS, there being no document there. Giving mpv the screen fills it with
    // mpv's own black, which is also what makes full screen read as a cinema
    // instead of a very large window. The video keeps its aspect ratio either way;
    // mpv letterboxes inside whatever frame it is given.
    {
        use tauri::Manager;
        let immersive = *app
            .state::<crate::commands::fullscreen::ImmersiveState>()
            .active
            .lock()
            .map_err(|e| e.to_string())?;
        if immersive {
            if let Some(screen) = tauri_ns_window.screen() {
                mpv_window.setFrame_display(screen.frame(), true);
                if mpv_window.alphaValue() < 1.0 {
                    mpv_window.setAlphaValue(1.0);
                }
                return Ok(());
            }
        }
    }

    let viewport = tauri_ns_window.contentLayoutRect();
    let in_window = NSRect::new(
        NSPoint::new(
            viewport.origin.x + left,
            viewport.origin.y + viewport.size.height - top - h,
        ),
        NSSize::new(w, h),
    );
    let on_screen = tauri_ns_window.convertRectToScreen(in_window);
    let frame = NSRect::new(
        NSPoint::new(on_screen.origin.x.round(), on_screen.origin.y.round()),
        NSSize::new(w, h),
    );

    mpv_window.setFrame_display(frame, true);
    if mpv_window.alphaValue() < 1.0 {
        mpv_window.setAlphaValue(1.0);
    }
    Ok(())
}

/// Return the global cursor position (screen pixels). Windows only: the native mpv
/// window sits on top of the webview there and (with newer libmpv) swallows
/// mouse-move events, so the webview's onmousemove never fires over the video and
/// the controls bar could never reappear. The frontend polls this instead.
/// On macOS the webview is above the video and receives the mouse directly.
#[tauri::command]
pub async fn get_cursor_pos(app: tauri::AppHandle) -> Result<(i32, i32), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
        let mut p = POINT::default();
        unsafe { GetCursorPos(&mut p).map_err(|e| e.to_string())?; }
        return Ok((p.x, p.y));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("cursor position polling is only used on Windows".into())
    }
}
