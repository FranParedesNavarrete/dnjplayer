# dnjplayer

Desktop multimedia player with Mega.io streaming, local file playback and real-time Anime4K upscaling.

Play video from your Mega.io cloud storage *or* straight off your own drives, with an embedded libmpv player and GPU-accelerated anime upscaling shaders — all in one native desktop app.

## Features

- **Mega.io streaming** — Browse your cloud drive and shared folders, stream any video via WebDAV
- **Local files** — Browse your computer and external drives, save folders as reusable libraries, and play without installing a second player. Works with no MEGAcmd and no Mega account
- **Audio & subtitle tracks** — Pick any audio or subtitle track in files that carry several, load an external subtitle file, and set a preferred language that is applied automatically
- **Embedded player** — libmpv-based playback with hardware decoding (`hwdec=auto-safe`), rendered by mpv's `gpu-next` output inside the app window
- **Overlay controls (macOS)** — Title, timeline and actions are drawn *over* the video and auto-hide when idle. On Windows the same controls live in a bar below the video (see [Architecture](#architecture))
- **Resume playback** — Files reopen where you left them, with no prompt. A position is kept between 1 s and 90% of the duration and dropped past that, so finishing a file makes the next play start over
- **Anime4K upscaling** — Real-time GPU shaders (Mode A/B/C) with variant selection (S/M/L/VL/UL), switchable via keyboard shortcuts
- **History & Favorites** — Track watched content with play counts, bookmark files and folders for quick access
- **Video adjustments** — Brightness, contrast and saturation controls with live preview and keyboard shortcuts
- **Playback controls** — Speed (0.25×–2×), volume (0–150%), seek bar, fullscreen, comprehensive keyboard shortcuts
- **Notifications & logging** — Failures surface as on-screen messages with an expandable technical detail, and the app writes a rotating log file to the OS log directory
- **Dark & Light themes** — System-wide toggle with localStorage persistence
- **Internationalization** — English and Spanish, extensible via `src/lib/i18n/`

## Tech Stack

| Component | Technology |
|---|---|
| Desktop framework | [Tauri 2.x](https://tauri.app/) (Rust backend) |
| Frontend | [SvelteKit](https://svelte.dev/) + Svelte 5 (static adapter) |
| Video player | libmpv via [tauri-plugin-libmpv](https://github.com/nicklason/tauri-plugin-libmpv) |
| Cloud storage | [MEGAcmd](https://mega.io/cmd) (WebDAV server on localhost:4443) |
| Upscaling | [Anime4K](https://github.com/bloc97/Anime4K) GLSL shaders |
| Database | SQLite via tauri-plugin-sql |
| Logging | tauri-plugin-log (file + stdout) |
| Tests | Vitest (frontend) + `cargo test` (Rust), run in GitHub Actions |
| Icons | [Lucide](https://lucide.dev/) |
| Package manager | pnpm (monorepo with workspaces) |

## Prerequisites

### Required

- **Node.js** >= 18
- **pnpm** >= 9
- **Rust** >= 1.70 — install via [rustup](https://rustup.rs/)
- **MEGAcmd** — download from [mega.io/cmd](https://mega.io/cmd)

### macOS

```bash
# Install libmpv via Homebrew
brew install mpv

# Create symlinks for Tauri to find libmpv at runtime
mkdir -p ~/lib
ln -sf /opt/homebrew/lib/libmpv.dylib ~/lib/libmpv.dylib
ln -sf /opt/homebrew/lib/libmpv.2.dylib ~/lib/libmpv.2.dylib
```

### Windows

The `libmpv-wrapper.dll` is bundled in the repo. You also need `libmpv-2.dll` (the mpv runtime):

```bash
# Option 1: Run the setup script (requires Git Bash + 7-Zip)
bash apps/desktop/scripts/setup-libmpv.sh

# Option 2: Manual download
# 1. Go to https://github.com/zhongfly/mpv-winbuild/releases
# 2. Download the latest mpv-dev-x86_64-*.7z
# 3. Extract libmpv-2.dll from the archive
# 4. Place it in apps/desktop/src-tauri/lib/
```

### Linux

```bash
# Debian/Ubuntu
sudo apt install libmpv-dev

# Fedora
sudo dnf install mpv-libs-devel

# Arch
sudo pacman -S mpv
```

### Anime4K Shaders (optional)

To enable real-time upscaling, download the Anime4K shader pack and place the `.glsl` files in `apps/desktop/static/shaders/`:

```bash
# Download the latest release from https://github.com/bloc97/Anime4K/releases
# Extract and move .glsl files directly into the shaders directory
unzip Anime4K_v4.0.1.zip -d /tmp/anime4k
mv /tmp/anime4k/**/*.glsl apps/desktop/static/shaders/
```

## Quick Start

```bash
# Clone the repository
git clone https://github.com/FranParedesNavarrete/dnjplayer.git
cd dnjplayer

# Install dependencies
pnpm install

# Windows only: download libmpv-2.dll (~30MB compressed)
bash apps/desktop/scripts/setup-libmpv.sh

# Run in development mode
pnpm tauri dev
```

The app will open with the Tauri window. MEGAcmd must be installed — the app manages `mega-cmd-server` automatically as a background process.

## Development

```bash
# Type-check the frontend (svelte-check). Expected: 0 errors, 0 warnings
pnpm --filter desktop check

# Frontend unit tests (Vitest) — pure helpers only, no DOM or Tauri needed
pnpm --filter desktop test

# Rust unit tests (MEGAcmd output parsers, the command runner, size formatting)
cd apps/desktop/src-tauri && cargo test
```

CI (`.github/workflows/ci.yml`) runs all of the above, plus `cargo check`, on
every push to `main` and every pull request, on `macos-latest` — the only platform validated locally. The
frontend is built before the cargo steps because `tauri::generate_context!()`
embeds `frontendDist` at compile time and fails if it is missing; libmpv is
`dlopen`'ed at runtime and is not needed for `cargo check`.

## Logs

The app installs a file logger (via `tauri-plugin-log`), so a playback problem
leaves a trace. The log captures both the Rust side and the webview console, at
`Debug` level in development builds and `Info` in release builds, rotating at
5 MiB.

- **macOS** — `~/Library/Logs/com.dnjplayer.app/dnjplayer.log`
- **Windows / Linux** — `dnjplayer.log` in the per-app log directory Tauri
  resolves for the platform (`app_log_dir`)

In development the same output also goes to stdout, so `pnpm tauri dev` shows it
in the terminal. Attaching this file is the single most useful thing in a bug
report.

## Build for Production

### macOS

```bash
# Build .app and .dmg with proper libmpv bundling
cd apps/desktop
pnpm tauri:build:macos
```

The build script handles copying `libmpv-wrapper.dylib` to the correct bundle location and setting up library search paths for the system-installed libmpv (via Homebrew).

### Windows

```bash
pnpm tauri build
```

### Linux

```bash
pnpm tauri build
```

Output binaries:

```
apps/desktop/src-tauri/target/release/bundle/
├── macos/      # macOS .app bundle + .dmg
├── nsis/       # Windows .exe installer
├── msi/        # Windows .msi installer
├── deb/        # Linux .deb package
└── appimage/   # Linux .AppImage
```

## Project Structure

```
dnjplayer/
├── apps/desktop/                  # Tauri + SvelteKit application
    ├── src/                       # SvelteKit frontend
    │   ├── routes/                # Pages: /, /local, /history, /player, /queue, /settings
    │   └── lib/
    │       ├── components/        # Player, PlayerOverlay, ToastHost, FileBrowser, LocalFileBrowser, AuthForm
    │       │   └── player/        # Overlay panels: SeekBar, TracksPanel, VideoPanel, SpeedPanel
    │       ├── stores/            # Svelte writable stores (player, player-ui, notifications, mega, theme, settings)
    │       ├── services/          # Tauri invoke wrappers (player, mega, local, db, prefetch, update)
    │       ├── types/             # Shared TypeScript types
    │       ├── utils/             # Pure, unit-tested helpers (media types, path handling, track labels, source keys, resume, stream profile, buffering)
    │       └── i18n/              # Translations (en, es)
    ├── src-tauri/                 # Rust backend
    │   ├── src/commands/          # Tauri commands (mega, local, library, player)
    │   ├── src/mega/              # MEGAcmd process management & WebDAV
    │   ├── src/db/                # SQLite migrations
    │   └── lib/                   # Native libraries (libmpv wrappers)
    └── static/shaders/            # Anime4K GLSL shader files
```

## App Pages

| Page | Route | Description |
|------|-------|-------------|
| **Browse Mega** | `/` | Mega.io cloud file browser, with login and recursive search |
| **Local Files** | `/local` | Your drives and saved folders. Available without MEGAcmd |
| **History** | `/history` | Watch history and favorites (with tabs), for both sources |
| **Player** | `/player` | Embedded video playback. Controls overlay the video on macOS, and sit in a bar below it on Windows |
| **Queue** | `/queue` | Playback queue for the chapters/episodes lined up |
| **Settings** | `/settings` | Theme, language, Mega status, shader defaults, track languages |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` / `K` | Play / Pause |
| hold `Space` | Play at 2× until released |
| `←` / `→` or `J` / `L` | Seek −10s / +10s |
| `Shift`+`←` / `Shift`+`→` (or `Shift`+`J` / `Shift`+`L`) | Fine seek −1s / +1s |
| `↑` / `↓` | Volume +5 / −5 (0–150) |
| `M` | Toggle mute |
| `F` | Toggle fullscreen |
| `Escape` | Close the open panel, or leave fullscreen if none is open |
| `N` | Next in playlist |
| `P` | Previous in playlist |
| `A` | Next audio track |
| `S` | Next subtitle track (cycles through "off") |
| `G` / `H` | Subtitle delay −100ms / +100ms |
| `1` / `2` | Contrast down / up |
| `3` / `4` | Brightness up / down |
| `7` / `8` | Saturation down / up |
| `[` / `]` | Speed down / up (0.25x steps, 0.25x–2x) |
| `R` | Reset all video adjustments |
| `Shift+1` / `Shift+2` / `Shift+3` | Anime4K Mode A (1080p) / B (720p) / C (480p) |
| `Shift+0` | Disable Anime4K shaders |

Letters are matched case-insensitively, so Caps Lock does not disable them.
Combinations that include `Cmd`, `Ctrl` or `Alt` are ignored by the player and
left to the OS and the app menu. Number-row shortcuts are matched on the physical
key rather than the character it produces, so they work on any keyboard layout —
including the `Shift`+digit shader shortcuts, which on a non-US layout produce
entirely different characters.

## Anime4K Modes

Real-time upscaling optimized by source resolution:

| Mode | Optimized For | Shader Pipeline |
|------|---------------|-----------------|
| **A** | 1080p | Clamp Highlights → Restore CNN → Upscale CNN x2 → AutoDownscale → Upscale x2 |
| **B** | 720p | Clamp Highlights → Restore CNN Soft → Upscale CNN x2 → AutoDownscale → Upscale x2 |
| **C** | 480p | Clamp Highlights → Upscale Denoise CNN x2 → AutoDownscale → Upscale CNN x2 |

Each mode has quality variants: **S** (fast) → **M** → **L** → **VL** → **UL** (best quality).

## How It Works

There are two sources, and they behave the same once playback starts.

**From Mega.io:**

1. **Login** — Authenticate with your Mega.io account from the Browse page
2. **Browse** — Navigate your cloud drive or shared folders to find a video
3. **Play** — Selecting a video starts MEGAcmd's WebDAV server and opens the HTTP stream in the embedded mpv player

**From your own drives:**

1. **Add a folder** — Pick it once from *Local Files*; it is saved and reusable across sessions
2. **Browse** — Navigate your saved folders, drives and volumes. Only playable files are listed
3. **Play** — mpv opens the file directly, so there is no streaming step

Then, for either source:

- **Pick tracks** — Choose the audio and subtitle track from the player, or set a preferred language in Settings and let it apply itself. External subtitle files can be loaded too, and for local files a matching subtitle sitting next to the video is picked up automatically
- **Upscale** — Anime4K shaders run in real-time on the GPU during playback (configurable in Settings)
- **Adjust** — Tune brightness, contrast, saturation and playback speed from the player controls

> Switching tracks on a Mega stream pauses for a second or two while mpv re-buffers
> the new track over HTTP, then resumes on its own. Local files switch instantly.

### Architecture

```
┌─────────────────────────────────────────────┐
│  Tauri Window                               │
│  ┌────────────────────┐  ┌────────────────┐ │
│  │  SvelteKit WebView │  │  mpv Window    │ │
│  │  (UI, controls)    │  │  (video layer) │ │
│  └────────┬───────────┘  └───────▲────────┘ │
│           │ invoke                │ resize   │
│  ┌────────▼───────────────────────┴────────┐ │
│  │  Rust Backend                           │ │
│  │  • MEGAcmd process mgmt                │ │
│  │  • NSWindow / Win32 child window APIs   │ │
│  │  • SQLite database                      │ │
│  └────────────────┬────────────────────────┘ │
└───────────────────┼─────────────────────────-┘
                    │ WebDAV (localhost:4443)
              ┌─────▼─────┐
              │ MEGAcmd   │
              │ Server    │
              └───────────┘
```

On **macOS** and **Windows**, mpv runs as a child/owned window of the Tauri window, and Rust commands dispatched to the main thread (required by the NSWindow/Win32 APIs) keep its position and size in sync with the video area.

The two platforms differ in stacking order, which is why the controls differ:

- **macOS** — mpv's window is ordered *below* the transparent Tauri window, and while a video plays the document carries a `video-hole` class so nothing paints over the video area. The DOM therefore composites on top of the video, which is what makes the overlay controls possible. Native fullscreen is not used: AppKit re-orders child windows above the parent, so fullscreen is a borderless maximize.
- **Windows** — mpv's window is re-parented *on top* of WebView2, so no DOM element can overlap the video yet. The controls stay in a bar below it, and because mpv swallows mouse-move events there, the app polls the cursor position to know when to reveal them.

On both, the surface is kept in sync by a `ResizeObserver` on the video area plus window resize/scroll listeners — not by a `requestAnimationFrame` loop.

On **Linux**, tauri-plugin-libmpv handles embedding natively via `wid`.

## Security

- **Content Security Policy** — Restricts script sources, connections and media origins
- **Minimal capabilities** — Only the Tauri permissions actually used by the app are granted
- **No shell execution** — The app does not expose arbitrary shell commands to the frontend
- **Local WebDAV** — MEGAcmd's WebDAV server only binds to `127.0.0.1:4443`

### Known Limitations

- MEGAcmd passes credentials via CLI arguments (visible in the process list) — this is a MEGAcmd design constraint. The app never puts command arguments into log lines or user-visible error messages: they are redacted to the subcommand plus an argument count (`login <2 args>`)
- WebDAV traffic between the app and MEGAcmd is unencrypted HTTP on localhost
- `macOSPrivateApi: true` is required for window transparency and child window management

## License

MIT
