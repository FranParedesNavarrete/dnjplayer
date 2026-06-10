#!/bin/bash
# Build macOS app with proper libmpv bundling.
#
# Produces a SELF-CONTAINED .app: the user does NOT need `brew install mpv`.
# libmpv and its whole dependency tree (ffmpeg, libass, libplacebo, Python core
# for vapoursynth, ...) are vendored into Contents/MacOS/lib with all install
# names rewritten to @executable_path/lib.
#
# It also fixes two structural issues:
# 1. tauri-plugin-libmpv looks for the wrapper dylib relative to the executable
#    (Contents/MacOS/lib/), but Tauri places resources in Contents/Resources/lib/.
# 2. The wrapper does dlopen("libmpv.dylib"); a launcher sets
#    DYLD_FALLBACK_LIBRARY_PATH to the bundled lib dir so it loads OUR libmpv.
#
# Usage: bash scripts/build-macos.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

# Pass --no-dmg to skip the create-dmg step (useful for CI / quick verification).
MAKE_DMG=1
for arg in "$@"; do [ "$arg" = "--no-dmg" ] && MAKE_DMG=0; done

# createUpdaterArtifacts is enabled, so `tauri build` signs the updater payload
# and needs the signing key CONTENT in TAURI_SIGNING_PRIVATE_KEY. Load it from
# the local key file unless already provided.
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/dnjplayer_updater.key}"
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -f "$KEY_PATH" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
fi
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

if [ "$MAKE_DMG" -eq 1 ] && ! command -v create-dmg &> /dev/null; then
  echo "ERROR: create-dmg not found. Install with: brew install create-dmg"
  exit 1
fi
if ! command -v dylibbundler &> /dev/null; then
  echo "ERROR: dylibbundler not found. Install with: brew install dylibbundler"
  exit 1
fi

# Locate the Homebrew libmpv (Apple Silicon or Intel prefix).
LIBMPV_SRC="$(ls /opt/homebrew/lib/libmpv.2.dylib /usr/local/lib/libmpv.2.dylib 2>/dev/null | head -1 || true)"
if [ -z "$LIBMPV_SRC" ]; then
  echo "ERROR: libmpv.2.dylib not found. Install build dep with: brew install mpv"
  exit 1
fi

# Recursively vendor every non-system dependency of the dylibs in $1 into $1,
# rewriting install names to @executable_path/lib. Catches plain dylibs AND
# frameworks (e.g. Python) that dylibbundler can miss. Idempotent; loops until
# no new libraries are copied.
vendor_deps() {
  local LIBDIR="$1"
  while :; do
    local new=0
    for f in "$LIBDIR"/*; do
      [ -f "$f" ] || continue            # skip symlinks/dirs
      # Normalize this lib's own id.
      install_name_tool -id "@executable_path/lib/$(basename "$f")" "$f" 2>/dev/null || true
      # Repoint (and pull in) every Homebrew/local dependency.
      while read -r dep; do
        [ -z "$dep" ] && continue
        local base; base="$(basename "$dep")"
        if [ ! -e "$LIBDIR/$base" ] && [ -f "$dep" ]; then
          cp -L "$dep" "$LIBDIR/$base"; chmod +w "$LIBDIR/$base"
          install_name_tool -id "@executable_path/lib/$base" "$LIBDIR/$base" 2>/dev/null || true
          new=$((new+1))
        fi
        install_name_tool -change "$dep" "@executable_path/lib/$base" "$f" 2>/dev/null || true
      done < <(otool -L "$f" | tail -n +2 | awk '{print $1}' \
                 | grep -E "/opt/homebrew|/usr/local|/opt/local|Cellar" || true)
    done
    [ "$new" -eq 0 ] && break
  done
}

echo "==> Building .app bundle..."
pnpm tauri build --bundles app

APP="src-tauri/target/release/bundle/macos/dnjplayer.app"

if [ ! -d "$APP" ]; then
  echo "ERROR: .app bundle not found at $APP"
  exit 1
fi

DST_DIR="$APP/Contents/MacOS/lib"
mkdir -p "$DST_DIR"

echo "==> Fixing libmpv-wrapper location in bundle..."
cp "$APP/Contents/Resources/lib/libmpv-wrapper.dylib" "$DST_DIR/libmpv-wrapper.dylib"
install_name_tool -id @executable_path/lib/libmpv-wrapper.dylib "$DST_DIR/libmpv-wrapper.dylib"

echo "==> Vendoring libmpv + dependency tree into the bundle..."
cp -L "$LIBMPV_SRC" "$DST_DIR/libmpv.2.dylib"
chmod +w "$DST_DIR/libmpv.2.dylib"
# Bulk-bundle the dependency tree, then catch anything left (frameworks, ids).
dylibbundler -of -b -x "$DST_DIR/libmpv.2.dylib" -d "$DST_DIR" -p "@executable_path/lib" >/dev/null
vendor_deps "$DST_DIR"
# The wrapper dlopen()s the unversioned name.
ln -sf libmpv.2.dylib "$DST_DIR/libmpv.dylib"

# Verify self-containment: no Homebrew/local paths must remain.
LEAKS=0
for f in "$DST_DIR"/*; do
  [ -f "$f" ] || continue
  if otool -L "$f" 2>/dev/null | tail -n +2 | grep -qE "/opt/homebrew|/usr/local|/opt/local|Cellar"; then
    echo "  LEAK: $f"; LEAKS=$((LEAKS+1))
  fi
done
if [ "$LEAKS" -ne 0 ]; then
  echo "ERROR: $LEAKS bundled libraries still reference Homebrew paths."
  exit 1
fi
echo "    libmpv bundle is self-contained ($(ls "$DST_DIR" | wc -l | tr -d ' ') files, $(du -sh "$DST_DIR" | cut -f1))."

echo "==> Adding launcher script for libmpv discovery..."
BINARY="$APP/Contents/MacOS/dnjplayer"
mv "$BINARY" "$BINARY-bin"
cat > "$BINARY" << 'LAUNCHER'
#!/bin/bash
# Launcher: point dlopen("libmpv.dylib") at the bundled, self-contained libmpv.
DIR="$(dirname "$0")"
export DYLD_FALLBACK_LIBRARY_PATH="$DIR/lib"
exec "$DIR/dnjplayer-bin" "$@"
LAUNCHER
chmod +x "$BINARY"

# Code signing fails inside iCloud-synced folders (e.g. ~/Documents): the sync
# daemon injects com.apple.FinderInfo / fileprovider xattrs that codesign rejects
# and re-adds instantly. So we sign + package in a staging dir outside iCloud and
# copy only the finished artifacts back. STAGED_APP is the signed bundle the
# release script tars for the updater. Shared via DNJ_STAGING.
STAGING="${DNJ_STAGING:-${TMPDIR:-/tmp}/dnjplayer-release}"
STAGED_APP="$STAGING/dnjplayer.app"
DMG_DIR="src-tauri/target/release/bundle/macos"
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
DMG_NAME="dnjplayer-${VERSION}-macOS-arm64.dmg"

echo "==> Staging bundle to $STAGING (outside iCloud) and signing..."
rm -rf "$STAGING"; mkdir -p "$STAGING"
ditto --noextattr --norsrc "$APP" "$STAGED_APP"
find "$STAGED_APP/Contents/MacOS/lib" -type f -exec codesign --force --sign - {} \;
codesign --force --sign - "$STAGED_APP/Contents/MacOS/dnjplayer-bin"
codesign --force --sign - "$STAGED_APP"
codesign --verify --strict "$STAGED_APP" || { echo "ERROR: bundle signature invalid"; exit 1; }
echo "    Signed bundle: $STAGED_APP"

if [ "$MAKE_DMG" -eq 0 ]; then
  echo "==> Skipping DMG (--no-dmg)."
  exit 0
fi

echo "==> Creating DMG with create-dmg..."
DMG_STAGED="$STAGING/$DMG_NAME"
rm -f "$DMG_STAGED"
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
  "$DMG_STAGED" \
  "$STAGED_APP"

# Copy the finished DMG back next to the build output (xattrs on a .dmg file
# don't affect the signed app inside it).
mkdir -p "$DMG_DIR"
rm -f "$DMG_DIR"/*.dmg
cp "$DMG_STAGED" "$DMG_DIR/$DMG_NAME"

echo "==> Done!"
echo "    signed .app: $STAGED_APP"
echo "    .dmg:        $DMG_DIR/$DMG_NAME"
