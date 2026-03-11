# dnjplayer

Desktop multimedia streaming app with Mega.io integration and real-time Anime4K upscaling.

Stream video from your Mega.io cloud storage with embedded libmpv playback and GPU-accelerated anime upscaling shaders.

## Features

- **Mega.io streaming** — Browse and stream videos directly from your Mega cloud via WebDAV
- **Embedded player** — libmpv-based video player with full playback controls
- **Anime4K upscaling** — Real-time GPU upscaling with Mode A (1080p), B (720p), C (480p) presets
- **Subtitle support** — Automatic detection and selection of embedded subtitle tracks
- **Dark / Light mode** — Theme toggle with localStorage persistence
- **Keyboard shortcuts** — Full keyboard control for playback, volume, seeking, and fullscreen

## Tech Stack

| Component | Technology |
|---|---|
| Desktop framework | [Tauri 2.x](https://tauri.app/) (Rust) |
| Frontend | [SvelteKit](https://svelte.dev/) + Svelte 5 |
| Video player | libmpv via [tauri-plugin-libmpv](https://github.com/nicklason/tauri-plugin-libmpv) |
| Cloud storage | [MEGAcmd](https://mega.io/cmd) (WebDAV server) |
| Upscaling | [Anime4K](https://github.com/bloc97/Anime4K) GLSL shaders |
| Database | SQLite via tauri-plugin-sql |
| Package manager | pnpm (monorepo) |

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
# Install system libmpv (the wrapper .so is already bundled)

# Debian/Ubuntu
sudo apt install libmpv-dev

# Fedora
sudo dnf install mpv-libs-devel

# Arch
sudo pacman -S mpv
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

The app will open with the Tauri development window. Make sure MEGAcmd is installed — the app will start `mega-cmd-server` automatically when needed.

## Build for Production

```bash
# Build distributable
pnpm tauri build
```

Output binaries are located in:

```
apps/desktop/src-tauri/target/release/bundle/
├── dmg/        # macOS .dmg installer
├── macos/      # macOS .app bundle
├── msi/        # Windows .msi installer
├── nsis/       # Windows .exe installer
├── deb/        # Linux .deb package
└── appimage/   # Linux .AppImage
```

## Project Structure

```
dnjplayer/
├── apps/desktop/                # Tauri + SvelteKit application
│   ├── src/                     # SvelteKit frontend
│   │   ├── routes/              # Pages: /, /browse, /player, /queue, /settings
│   │   └── lib/
│   │       ├── components/      # Svelte components (Player, PlayerControls, etc.)
│   │       ├── stores/          # Svelte writable stores (player, mega, theme)
│   │       ├── services/        # Tauri invoke wrappers
│   │       └── types/           # Shared TypeScript types
│   ├── src-tauri/               # Rust backend
│   │   ├── src/commands/        # Tauri commands (mega, library, player)
│   │   ├── src/mega/            # MEGAcmd process management
│   │   ├── src/shaders/         # Anime4K shader presets
│   │   └── lib/                 # Native libraries (libmpv wrapper)
│   └── static/shaders/          # Anime4K GLSL shader files
└── docker/                      # Optional: offline pre-processing pipeline
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` / `K` | Play / Pause |
| `←` / `→` | Seek -10s / +10s |
| `↑` / `↓` | Volume +5 / -5 |
| `M` | Toggle mute |
| `F` | Toggle fullscreen |
| `Escape` | Exit fullscreen |

## Anime4K Modes

Real-time upscaling optimized by source resolution:

| Mode | Source | Shader Pipeline |
|------|--------|-----------------|
| **A** | 1080p | Clamp + Restore_CNN + Upscale_CNN x2 + AutoDownscale + Upscale x2 |
| **B** | 720p | Clamp + Restore_CNN_Soft + Upscale_CNN x2 + AutoDownscale + Upscale x2 |
| **C** | 480p | Clamp + Upscale_Denoise_CNN x2 + AutoDownscale + Upscale_CNN x2 |

Each mode has quality variants: **S** (fast) → **M** → **L** → **VL** → **UL** (best quality).

## How It Works

1. User browses their Mega.io cloud storage from within the app
2. Selecting a video triggers MEGAcmd's WebDAV server on `localhost:4443`
3. mpv loads the HTTP stream URL and plays with Anime4K shaders active
4. Subtitle tracks are automatically detected and selectable from the player UI

## License

MIT
