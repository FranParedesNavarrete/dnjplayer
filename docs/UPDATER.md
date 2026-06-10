# Auto-updates (Tauri updater)

The app checks GitHub Releases for a newer **signed** build and can install it
in place. Updates are checked silently ~3s after launch and can be triggered
manually from **Settings → Updates**.

## How it works

- `tauri.conf.json` → `plugins.updater` points at
  `https://github.com/FranParedesNavarrete/dnjplayer/releases/latest/download/latest.json`
  and embeds the **public** signing key.
- Each release uploads `latest.json` + a signed update payload. The app verifies
  the payload signature against the embedded public key before installing.

## Signing keys

- Generated once with `tauri signer generate`.
- **Private key** lives at `~/.tauri/dnjplayer_updater.key` — **never commit it**.
  Back it up somewhere safe; losing it means clients can't verify future updates.
- **Public key** is committed inside `tauri.conf.json` (`plugins.updater.pubkey`).

## macOS build requirements & self-contained bundling

The macOS `.app` is **self-contained**: end users do NOT need `brew install mpv`.
`build-macos.sh` vendors `libmpv` and its whole dependency tree (ffmpeg, libass,
libplacebo, Python core for vapoursynth, ...) into `Contents/MacOS/lib`, rewrites
every install name to `@executable_path/lib`, and verifies that no Homebrew paths
remain. (Windows already ships a self-contained `libmpv-2.dll`.)

The **build machine** still needs:
- `brew install mpv` (source of libmpv to vendor)
- `brew install dylibbundler` (collects the dependency tree)
- `brew install create-dmg`

### ⚠️ Do not build under iCloud-synced folders

Code signing fails when the repo lives under an iCloud-synced folder (e.g.
`~/Documents`): the sync daemon injects `com.apple.FinderInfo` / `fileprovider`
xattrs that `codesign` rejects and re-adds instantly. `build-macos.sh` works
around this by signing + packaging in a staging dir under `$TMPDIR` (outside
iCloud) and copying only the finished DMG/updater artifacts back. For a smoother
setup, consider moving the repo out of `~/Documents` (e.g. `~/dev/dnjplayer`).

## Cutting a release (macOS)

1. Bump `version` in **all** of: `apps/desktop/src-tauri/tauri.conf.json`,
   `apps/desktop/package.json`, root `package.json` (keep them in sync).
2. From `apps/desktop`:
   ```bash
   pnpm release:macos            # build + sign + write latest.json (dry run)
   pnpm release:macos -- --publish   # also create the GitHub release and upload
   ```
   This reuses `build-macos.sh` (libmpv-wrapper fix + launcher + DMG) and then
   builds the **updater tarball from the fixed bundle**, signs it, and writes
   `latest.json`.
3. Assets uploaded: the DMG (manual install), `dnjplayer.app.tar.gz` (updater
   payload) and `latest.json`.

## Windows

Run the macOS release FIRST (it creates the `v<ver>` release + `latest.json`),
then on a Windows machine run the helper, which builds the signed NSIS installer
and merges the `windows-x86_64` entry into the same release's `latest.json`:

```powershell
# from apps/desktop, in PowerShell
.\scripts\release-windows.ps1            # build only (dry run)
.\scripts\release-windows.ps1 -Publish   # upload installer + update latest.json
```

The script **cross-compiles to x64** (`--target x86_64-pc-windows-msvc`) by
default, which is correct even on a **Windows ARM64** host: the bundled
`libmpv-2.dll` is x64, and an x64 build runs on both x64 and ARM64 (emulation).
Override with `-Target aarch64-pc-windows-msvc` only if you also ship an ARM64
libmpv. The updater key is derived from the target (`windows-x86_64`).

Prerequisites on the Windows machine:
- Rust + `rustup target add x86_64-pc-windows-msvc`, Microsoft C++ Build Tools
  (with x64 support), Node + pnpm, `gh`.
- `libmpv-2.dll` (x64) present (`bash scripts/setup-libmpv.sh` — it's gitignored).
- The **same** updater private key as macOS: copy `~/.tauri/dnjplayer_updater.key`
  to the Windows machine (or set `TAURI_SIGNING_PRIVATE_KEY`). One key signs both
  platforms; the single `pubkey` in `tauri.conf.json` verifies both.

## Important: the first updater-enabled version

The currently installed **v1.2.0 has no updater**, so it cannot auto-update.
**v1.3.0 must be installed manually** (DMG). From v1.3.0 onward, updates are
automatic.
