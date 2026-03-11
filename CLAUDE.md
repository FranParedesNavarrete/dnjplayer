# dnjplayer

Multimedia streaming desktop app with Mega.io integration and Anime4K upscaling.

## Stack

- **Desktop**: Tauri 2.x (Rust backend)
- **Frontend**: SvelteKit + Svelte 5 (static adapter, SSR disabled)
- **Video**: libmpv embedded via tauri-plugin-libmpv
- **Cloud**: MEGAcmd (managed background process with WebDAV server)
- **Upscaling**: Anime4K GLSL shaders (real-time via mpv) + FFmpeg/libplacebo (pre-processing via Docker)
- **Database**: SQLite via tauri-plugin-sql
- **Package manager**: pnpm (monorepo with workspaces)

## Project Structure

- `apps/desktop/` - Main Tauri + SvelteKit application
  - `src/` - SvelteKit frontend (Svelte 5, TypeScript)
  - `src-tauri/` - Rust backend (Tauri commands, Mega integration, pipeline)
- `docker/` - Pre-processing Docker setup (FFmpeg + libplacebo + CUDA)
- `docs/` - Documentation

## Commands

- `pnpm dev` - Start SvelteKit dev server
- `pnpm build` - Build frontend for production
- `pnpm tauri dev` - Run Tauri app in development
- `pnpm tauri build` - Build distributable app

## Conventions

- Frontend state management: Svelte writable stores in `src/lib/stores/`
- Tauri commands: defined in `src-tauri/src/commands/`, invoked from `src/lib/services/`
- TypeScript types: shared in `src/lib/types/`
- Database: migrations in `src-tauri/src/db/migrations/`, queries via tauri-plugin-sql
- Anime4K shaders: bundled in `static/shaders/`, presets defined in `src-tauri/src/shaders/presets.rs`
- Dark theme by default (CSS variables in `app.css`)

## MEGAcmd Integration

The app manages MEGAcmd (`mega-cmd-server`) as a background process. Video streaming uses
MEGAcmd's WebDAV server (port 4443) to provide HTTP URLs that mpv can open directly.
Commands use `mega-exec` prefix (e.g., `mega-exec ls`, `mega-exec login`).

## Anime4K Modes

- Mode A: Optimized for 1080p source (Restore_CNN + Upscale)
- Mode B: Optimized for 720p source (Restore_CNN_Soft + Upscale)
- Mode C: Optimized for 480p source (Upscale_Denoise + Upscale)
- Variants: S (fast) < M < L < VL < UL (best quality)
