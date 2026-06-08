#!/bin/bash
# Build macOS app with proper libmpv-wrapper bundling.
#
# Fixes two issues in the production .app bundle:
# 1. tauri-plugin-libmpv searches for the wrapper dylib relative to the
#    executable (Contents/MacOS/lib/), but Tauri's `resources` config places
#    it in Contents/Resources/lib/. We copy it to the correct location.
# 2. The wrapper uses dlopen("libmpv.dylib") which doesn't search Homebrew
#    paths on modern macOS. We wrap the binary with a launcher script that
#    sets DYLD_FALLBACK_LIBRARY_PATH before exec.
#
# Usage: bash scripts/build-macos.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

if ! command -v create-dmg &> /dev/null; then
  echo "ERROR: create-dmg not found. Install with: brew install create-dmg"
  exit 1
fi

echo "==> Building .app bundle..."
pnpm tauri build --bundles app

APP="src-tauri/target/release/bundle/macos/dnjplayer.app"

if [ ! -d "$APP" ]; then
  echo "ERROR: .app bundle not found at $APP"
  exit 1
fi

echo "==> Fixing libmpv-wrapper location in bundle..."
SRC="$APP/Contents/Resources/lib/libmpv-wrapper.dylib"
DST_DIR="$APP/Contents/MacOS/lib"
DST="$DST_DIR/libmpv-wrapper.dylib"

mkdir -p "$DST_DIR"
cp "$SRC" "$DST"
install_name_tool -id @executable_path/lib/libmpv-wrapper.dylib "$DST"

echo "==> Adding launcher script for libmpv discovery..."
BINARY="$APP/Contents/MacOS/dnjplayer"
mv "$BINARY" "$BINARY-bin"
cat > "$BINARY" << 'LAUNCHER'
#!/bin/bash
# Launcher: set library search paths so libmpv-wrapper can find libmpv via dlopen.
# Modern macOS ignores DYLD_FALLBACK_LIBRARY_PATH set after process start,
# so we must set it before exec'ing the real binary.
DIR="$(dirname "$0")"
export DYLD_FALLBACK_LIBRARY_PATH="$HOME/lib:/opt/homebrew/lib:/usr/local/lib:/usr/lib"
exec "$DIR/dnjplayer-bin" "$@"
LAUNCHER
chmod +x "$BINARY"

echo "==> Re-signing bundle..."
xattr -cr "$APP"
codesign --force --sign - "$DST"
codesign --force --sign - "$BINARY-bin"
codesign --force --sign - "$APP"

echo "==> Creating DMG with create-dmg..."
DMG_DIR="src-tauri/target/release/bundle/macos"
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
DMG_NAME="dnjplayer-${VERSION}-macOS-arm64.dmg"
DMG_PATH="$DMG_DIR/$DMG_NAME"

rm -f "$DMG_DIR"/*.dmg

create-dmg \
  --volname "dnjplayer" \
  --volicon "src-tauri/icons/icon.icns" \
  --window-pos 200 120 \
  --window-size 600 400 \
  --icon-size 120 \
  --icon "dnjplayer.app" 160 200 \
  --hide-extension "dnjplayer.app" \
  --app-drop-link 440 200 \
  --no-internet-enable \
  "$DMG_PATH" \
  "$APP"

echo "==> Done!"
echo "    .app: $APP"
echo "    .dmg: $DMG_PATH"
