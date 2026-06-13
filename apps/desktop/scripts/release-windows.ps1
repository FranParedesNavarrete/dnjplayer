# Build a signed Windows release and add its entry to the updater manifest.
#
# Builds the NSIS installer with updater signing, then (with -Publish) downloads
# the existing latest.json from the GitHub release, merges the windows-x86_64
# entry, and re-uploads the installer + latest.json.
#
# Run the macOS release FIRST (creates the v<ver> release + latest.json), then
# run this on Windows to add Windows support to the same release.
#
# Usage (PowerShell, from apps/desktop):
#   .\scripts\release-windows.ps1            # build only (dry run)
#   .\scripts\release-windows.ps1 -Publish   # build + upload + update latest.json
#
# Requires: Rust (msvc), MS C++ Build Tools, Node+pnpm, gh, and the SAME updater
# private key used on macOS (copy ~/.tauri/dnjplayer_updater.key to this machine).

param([switch]$Publish, [string]$Target = "x86_64-pc-windows-msvc")
$ErrorActionPreference = "Stop"

$repo = "FranParedesNavarrete/dnjplayer"
Set-Location (Join-Path $PSScriptRoot "..")

# Updater platform key for the target (x64 build runs on x64 AND ARM64 via
# emulation; the bundled libmpv-2.dll is x64, so we cross-compile to x64 even on
# an ARM64 host).
$platformKey = switch ($Target) {
  "aarch64-pc-windows-msvc" { "windows-aarch64" }
  default { "windows-x86_64" }
}

# Load the signing key (content) from env or the local key file.
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  $keyPath = Join-Path $HOME ".tauri\dnjplayer_updater.key"
  if (Test-Path $keyPath) {
    $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -Raw $keyPath)
  } else {
    throw "Set TAURI_SIGNING_PRIVATE_KEY, or copy the key to $keyPath"
  }
}
if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
}

# libmpv-2.dll is gitignored; make sure it's present before building.
if (-not (Test-Path "src-tauri\lib\libmpv-2.dll")) {
  throw "src-tauri\lib\libmpv-2.dll missing. Run: bash scripts/setup-libmpv.sh"
}

$version = (Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).version
$tag = "v$version"
Write-Host "==> Building dnjplayer $tag for Windows ($Target)..."

rustup target add $Target | Out-Null

# Load the MSVC toolchain environment so cargo finds link.exe (a plain PowerShell
# doesn't have it; needed especially when cross-compiling x64 on an ARM64 host).
if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vswhere) {
    $vsPath = & $vswhere -latest -products * `
      -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
      -property installationPath | Select-Object -First 1
    $devShell = Join-Path $vsPath "Common7\Tools\Launch-VsDevShell.ps1"
    if ($vsPath -and (Test-Path $devShell)) {
      $vsArch = if ($Target -like "aarch64*") { "arm64" } else { "amd64" }
      # Launch-VsDevShell only accepts x86/amd64 for HostArch; on an ARM64 host
      # the x64 host tools run via emulation, which is fine for building.
      Write-Host "==> Loading MSVC environment (target $vsArch, host amd64)..."
      & $devShell -Arch $vsArch -HostArch amd64 -SkipAutomaticLocation
    }
  }
}
if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
  throw "MSVC link.exe not found. Install the 'Desktop development with C++' workload, or run from a 'Developer PowerShell for VS'."
}

pnpm install
pnpm tauri build --target $Target

# Locate THIS version's NSIS installer + signature. Old builds may still be in
# the folder, so filter by $version (a plain *-setup.exe + Select -First 1 picks
# the first alphabetically, e.g. an older 1.3.0 instead of 1.3.1).
$nsisDir = "src-tauri\target\$Target\release\bundle\nsis"
$installer = Get-ChildItem $nsisDir -Filter "*-setup.exe" | Where-Object { $_.Name -like "*$version*" } | Select-Object -First 1
$sigFile   = Get-ChildItem $nsisDir -Filter "*-setup.exe.sig" | Where-Object { $_.Name -like "*$version*" } | Select-Object -First 1
if (-not $installer -or -not $sigFile) {
  throw "NSIS installer/.sig not found in $nsisDir (is createUpdaterArtifacts on?)"
}
$signature = (Get-Content -Raw $sigFile.FullName).Trim()
$url = "https://github.com/$repo/releases/download/$tag/$($installer.Name)"

Write-Host "    installer: $($installer.FullName)"
if (-not $Publish) {
  Write-Host "Dry run. Re-run with -Publish to upload and update latest.json."
  exit 0
}

# Merge the windows-x86_64 entry into the release's existing latest.json.
$work = Join-Path ([System.IO.Path]::GetTempPath()) "dnjplayer-win-release"
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $work | Out-Null
$manifestPath = Join-Path $work "latest.json"

gh release download $tag --repo $repo --pattern "latest.json" --output $manifestPath --clobber
$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
$winEntry = [PSCustomObject]@{ signature = $signature; url = $url }
$manifest.platforms | Add-Member -NotePropertyName $platformKey -NotePropertyValue $winEntry -Force
# Write UTF-8 WITHOUT BOM. Set-Content -Encoding UTF8 (PowerShell 5.1) adds a BOM,
# which breaks the updater's JSON parser ("error decoding response body").
$json = $manifest | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "==> Uploading installer + updated latest.json to $tag..."
gh release upload $tag --repo $repo --clobber $installer.FullName $manifestPath

Write-Host "==> Done. Windows auto-updates enabled for $tag."
