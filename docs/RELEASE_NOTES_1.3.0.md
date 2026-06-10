# dnjplayer v1.3.0

### ✨ New

- **Automatic updates.** The app now checks for new releases on launch and can
  download, verify (signed) and install them in one click — plus a manual
  "Check for updates" button in Settings.
- **Global recursive search.** The browser search now finds **folders anywhere**
  in your current section — across your whole drive, or across all your shared
  folders and their subfolders (up to 4 levels deep), like the MEGA web. No more
  results limited to the current folder.
- **Chapter pre-loading.** When you queue several chapters, the next ones are
  resolved in the background while the current one plays, so moving to the next
  chapter is now near-instant instead of taking seconds.
- **Self-contained macOS app.** libmpv is now bundled inside the `.app` —
  `brew install mpv` is **no longer required**. (Windows already bundled it.)
- **Guided MEGAcmd setup.** If MEGAcmd isn't installed, the app now shows a clear
  prompt with a one-click button to get the official installer.

### 🎨 Improvements

- **Responsive UI.** The interface now adapts to large/4K screens — content fills
  the width and scales up instead of leaving big empty margins. Smaller windows
  are supported too (min size lowered).

### 🐛 Fixes

- **Windows:** fixed the console window that briefly flashed during navigation
  (every MEGAcmd/Docker call now runs hidden). No more "is this malware?" flicker.

---

> **Updating from 1.2.0:** this is the first version with the auto-updater, so
> **install 1.3.0 manually** (download below). From 1.3.0 onward, updates are
> automatic.
