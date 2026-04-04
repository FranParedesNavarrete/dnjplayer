# dnjplayer

Desktop multimedia streaming app with Mega.io integration and real-time Anime4K upscaling.

Stream video from your Mega.io cloud storage with an embedded libmpv player and GPU-accelerated anime upscaling shaders — all in one native desktop app.

## Features

- **Mega.io streaming** — Browse your cloud drive and shared folders, stream any video via WebDAV
- **Embedded player** — libmpv-based playback with hardware decoding, integrated into the app window on macOS, Windows and Linux
- **Anime4K upscaling** — Real-time GPU shaders (Mode A/B/C) optimized for different source resolutions
- **Video adjustments** — Brightness, contrast and saturation controls with live preview
- **Playback controls** — Speed (0.25×–2×), volume (0–150%), seek bar, fullscreen, keyboard shortcuts
- **Dark & Light themes** — System-wide toggle with localStorage persistence
- **Internationalization** — English and Spanish, extensible via `src/lib/i18n/`
- **Pre-processing pipeline** — Optional Docker-based offline upscaling with FFmpeg + libplacebo + NVIDIA GPU

## Tech Stack

| Component | Technology |
|---|---|
| Desktop framework | [Tauri 2.x](https://tauri.app/) (Rust backend) |
| Frontend | [SvelteKit](https://svelte.dev/) + Svelte 5 (static adapter) |
| Video player | libmpv via [tauri-plugin-libmpv](https://github.com/nicklason/tauri-plugin-libmpv) |
| Cloud storage | [MEGAcmd](https://mega.io/cmd) (WebDAV server on localhost:4443) |
| Upscaling | [Anime4K](https://github.com/bloc97/Anime4K) GLSL shaders |
| Database | SQLite via tauri-plugin-sql |
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
# Extract into the shaders directory
unzip Anime4K_v4.0.1.zip -d apps/desktop/static/shaders/
```

## Quick Start

```bash
# Clone the repository
git clone https://github.com/your-username/dnjplayer.git
cd dnjplayer

# Install dependencies
pnpm install

# Windows only: download libmpv-2.dll (~30MB compressed)
bash apps/desktop/scripts/setup-libmpv.sh

# Run in development mode
pnpm tauri dev
```

The app will open with the Tauri window. MEGAcmd must be installed — the app manages `mega-cmd-server` automatically as a background process.

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
│   ├── src/                       # SvelteKit frontend
│   │   ├── routes/                # Pages: /, /browse, /player, /queue, /settings
│   │   └── lib/
│   │       ├── components/        # Player, PlayerControls, FileBrowser, AuthForm
│   │       ├── stores/            # Svelte writable stores (player, mega, theme, settings)
│   │       ├── services/          # Tauri invoke wrappers (player, mega, pipeline, db)
│   │       ├── types/             # Shared TypeScript types
│   │       └── i18n/              # Translations (en, es)
│   ├── src-tauri/                 # Rust backend
│   │   ├── src/commands/          # Tauri commands (mega, library, player, pipeline)
│   │   ├── src/mega/              # MEGAcmd process management & WebDAV
│   │   ├── src/pipeline/          # Docker container management for pre-processing
│   │   ├── src/db/                # SQLite migrations
│   │   └── lib/                   # Native libraries (libmpv wrappers)
│   └── static/shaders/            # Anime4K GLSL shader files
└── docker/                        # Offline pre-processing pipeline
    ├── Dockerfile.processor       # CUDA 12.2 + FFmpeg + libplacebo
    ├── docker-compose.yml         # GPU orchestration
    └── scripts/process.sh         # FFmpeg upscaling entrypoint
```

## App Pages

| Page | Route | Description |
|------|-------|-------------|
| **Library** | `/` | Saved and recently watched media |
| **Browse** | `/browse` | Mega.io cloud file browser with login |
| **Player** | `/player` | Embedded video playback with controls |
| **Queue** | `/queue` | Anime4K pre-processing job queue |
| **Settings** | `/settings` | Theme, language, Mega status, shader defaults |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` / `K` | Play / Pause |
| `←` / `→` | Seek −10s / +10s |
| `↑` / `↓` | Volume +5 / −5 |
| `M` | Toggle mute |
| `F` | Toggle fullscreen |
| `Escape` | Exit fullscreen |
| `N` | Next in playlist |
| `P` | Previous in playlist |
| `1` / `2` | Contrast down / up |
| `3` / `4` | Brightness up / down |
| `7` / `8` | Saturation down / up |
| `[` / `]` | Speed down / up (0.25x steps, 0.25x–2x) |
| `R` | Reset all video adjustments |
| `Shift+1` / `Shift+2` / `Shift+3` | Anime4K Mode A (1080p) / B (720p) / C (480p) |
| `Shift+0` | Disable Anime4K shaders |

## Anime4K Modes

Real-time upscaling optimized by source resolution:

| Mode | Optimized For | Shader Pipeline |
|------|---------------|-----------------|
| **A** | 1080p | Clamp Highlights → Restore CNN → Upscale CNN x2 → AutoDownscale → Upscale x2 |
| **B** | 720p | Clamp Highlights → Restore CNN Soft → Upscale CNN x2 → AutoDownscale → Upscale x2 |
| **C** | 480p | Clamp Highlights → Upscale Denoise CNN x2 → AutoDownscale → Upscale CNN x2 |

Each mode has quality variants: **S** (fast) → **M** → **L** → **VL** → **UL** (best quality).

## How It Works

1. **Login** — Authenticate with your Mega.io account from the Browse page
2. **Browse** — Navigate your cloud drive or shared folders to find a video
3. **Play** — Selecting a video starts MEGAcmd's WebDAV server and opens the HTTP stream in the embedded mpv player
4. **Upscale** — Anime4K shaders run in real-time on the GPU during playback (configurable in Settings)
5. **Adjust** — Tune brightness, contrast, saturation and playback speed from the controls bar

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

On **macOS** and **Windows**, mpv runs as a child/owned window of the Tauri window. The frontend's `requestAnimationFrame` loop continuously syncs mpv's position and size with the video area via Rust commands dispatched to the main thread (required for NSWindow/Win32 APIs).

On **Linux**, tauri-plugin-libmpv handles embedding natively via `--wid`.

## Security

- **Content Security Policy** — Restricts script sources, connections and media origins
- **Minimal capabilities** — Only the Tauri permissions actually used by the app are granted
- **No shell execution** — The app does not expose arbitrary shell commands to the frontend
- **Local WebDAV** — MEGAcmd's WebDAV server only binds to `127.0.0.1:4443`

### Known Limitations

- MEGAcmd passes credentials via CLI arguments (visible in the process list) — this is a MEGAcmd design constraint
- WebDAV traffic between the app and MEGAcmd is unencrypted HTTP on localhost
- `macOSPrivateApi: true` is required for window transparency and child window management

## License

MIT
