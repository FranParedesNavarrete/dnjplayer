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

param([switch]$Publish)
$ErrorActionPreference = "Stop"

$repo = "FranParedesNavarrete/dnjplayer"
Set-Location (Join-Path $PSScriptRoot "..")

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
Write-Host "==> Building dnjplayer $tag for Windows..."

pnpm install
pnpm tauri build

# Locate the NSIS updater installer and its signature.
$nsisDir = "src-tauri\target\release\bundle\nsis"
$installer = Get-ChildItem $nsisDir -Filter "*-setup.exe" | Select-Object -First 1
$sigFile   = Get-ChildItem $nsisDir -Filter "*-setup.exe.sig" | Select-Object -First 1
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
$manifest.platforms | Add-Member -NotePropertyName "windows-x86_64" -NotePropertyValue $winEntry -Force
$manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $manifestPath -Encoding UTF8

Write-Host "==> Uploading installer + updated latest.json to $tag..."
gh release upload $tag --repo $repo --clobber $installer.FullName $manifestPath

Write-Host "==> Done. Windows auto-updates enabled for $tag."
