#!/bin/bash
# Build a signed macOS release with auto-updater artifacts.
#
# Produces, in src-tauri/target/release/bundle/macos/:
#   - dnjplayer.app                 (fixed bundle, via build-macos.sh)
#   - dnjplayer-<ver>-macOS-arm64.dmg   (first-time install)
#   - dnjplayer.app.tar.gz          (updater payload, from the FIXED app)
#   - dnjplayer.app.tar.gz.sig      (minisign signature)
#   - latest.json                   (updater manifest, darwin-aarch64)
#
# The tarball is created AFTER build-macos.sh applies the libmpv-wrapper fix and
# launcher, so the auto-updated app is the same working bundle as the DMG.
#
# Usage:
#   bash scripts/release.sh            # build + sign + write latest.json
#   bash scripts/release.sh --publish  # also create/upload the GitHub release
#
# Requires:
#   - The updater private key at ~/.tauri/dnjplayer_updater.key (see README).
#   - create-dmg (brew install create-dmg), gh (for --publish).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

REPO="FranParedesNavarrete/dnjplayer"
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/dnjplayer_updater.key}"
export TAURI_SIGNING_PRIVATE_KEY_PATH="$KEY_PATH"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

if [ ! -f "$KEY_PATH" ]; then
  echo "ERROR: updater private key not found at $KEY_PATH"
  echo "Generate it once with: pnpm --filter desktop exec tauri signer generate -w \"$KEY_PATH\""
  exit 1
fi

VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
TAG="v$VERSION"
BUNDLE_DIR="src-tauri/target/release/bundle/macos"
TARBALL="$BUNDLE_DIR/dnjplayer.app.tar.gz"
DMG="$BUNDLE_DIR/dnjplayer-${VERSION}-macOS-arm64.dmg"

# Shared staging dir (outside iCloud) where build-macos.sh leaves the SIGNED app.
export DNJ_STAGING="${TMPDIR:-/tmp}/dnjplayer-release"
STAGED_APP="$DNJ_STAGING/dnjplayer.app"

echo "==> Releasing dnjplayer $TAG"

# 1. Build, vendor libmpv, sign and DMG (staged outside iCloud).
bash scripts/build-macos.sh

if [ ! -d "$STAGED_APP" ]; then
  echo "ERROR: signed .app not found at $STAGED_APP after build-macos.sh"
  exit 1
fi

# 2. Pack the updater payload from the SIGNED staged app and sign it.
echo "==> Creating updater tarball from the signed bundle..."
rm -f "$TARBALL" "$TARBALL.sig"
tar -czf "$TARBALL" -C "$DNJ_STAGING" "dnjplayer.app"

echo "==> Signing tarball..."
pnpm --filter desktop exec tauri signer sign -f "$KEY_PATH" -p "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" "$TARBALL"

# 3. Generate latest.json (signature is the full .sig file content, JSON-escaped).
echo "==> Writing latest.json..."
PUB_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
URL="https://github.com/$REPO/releases/download/$TAG/dnjplayer.app.tar.gz"
node -e '
  const fs = require("fs");
  const [sigPath, version, pubDate, url, out] = process.argv.slice(1);
  const signature = fs.readFileSync(sigPath, "utf8").trim();
  const manifest = {
    version,
    notes: "See the release notes on GitHub.",
    pub_date: pubDate,
    platforms: {
      "darwin-aarch64": { signature, url }
    }
  };
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
' "$TARBALL.sig" "$VERSION" "$PUB_DATE" "$URL" "$BUNDLE_DIR/latest.json"

echo ""
echo "==> Artifacts ready in $BUNDLE_DIR:"
echo "    - $(basename "$DMG")        (manual install)"
echo "    - dnjplayer.app.tar.gz      (updater payload)"
echo "    - latest.json               (updater manifest)"
echo ""
echo "NOTE: latest.json only contains darwin-aarch64. To enable Windows"
echo "      auto-updates, build on Windows with TAURI_SIGNING_PRIVATE_KEY set"
echo "      (createUpdaterArtifacts is on) and add a \"windows-x86_64\" entry"
echo "      with the .nsis.zip URL and its .sig content before uploading."

# Detect --publish among all args (pnpm forwards an extra `--` separator).
PUBLISH=0
for arg in "$@"; do [ "$arg" = "--publish" ] && PUBLISH=1; done

if [ "$PUBLISH" -ne 1 ]; then
  echo ""
  echo "Dry run. Re-run with --publish to create the GitHub release and upload."
  exit 0
fi

# 4. Publish to GitHub. Upload the DMG, the updater tarball and latest.json.
echo ""
echo "==> Publishing release $TAG to $REPO..."
if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release create "$TAG" --repo "$REPO" --title "$TAG" --generate-notes
fi
gh release upload "$TAG" --repo "$REPO" --clobber \
  "$DMG" \
  "$TARBALL" \
  "$BUNDLE_DIR/latest.json"

echo "==> Done. Release $TAG published."
