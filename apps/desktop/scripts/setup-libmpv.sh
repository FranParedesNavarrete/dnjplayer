#!/bin/bash
# Download platform-specific libmpv dependencies for dnjplayer.
# The small wrapper DLLs (libmpv-wrapper.*) are committed to the repo.
# This script downloads large runtime dependencies that can't be committed.
#
# Usage: bash scripts/setup-libmpv.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../src-tauri/lib"
mkdir -p "$LIB_DIR"

# Detect platform
case "$(uname -s)" in
  Darwin)
    echo "macOS detected."
    echo "libmpv-wrapper.dylib is already bundled in src-tauri/lib/"
    echo ""
    echo "Make sure libmpv is installed via Homebrew:"
    echo "  brew install mpv"
    echo ""
    echo "Then create symlinks if not already done:"
    echo "  mkdir -p ~/lib"
    echo "  ln -sf /opt/homebrew/lib/libmpv.dylib ~/lib/libmpv.dylib"
    echo "  ln -sf /opt/homebrew/lib/libmpv.2.dylib ~/lib/libmpv.2.dylib"
    ;;

  Linux)
    echo "Linux detected."
    echo "libmpv-wrapper.so is already bundled in src-tauri/lib/"
    echo ""
    echo "Make sure libmpv is installed:"
    echo "  Debian/Ubuntu: sudo apt install libmpv-dev"
    echo "  Fedora:        sudo dnf install mpv-libs-devel"
    echo "  Arch:          sudo pacman -S mpv"
    ;;

  MINGW*|MSYS*|CYGWIN*)
    echo "Windows detected."
    echo "libmpv-wrapper.dll is already bundled in src-tauri/lib/"
    echo ""

    if [ -f "$LIB_DIR/libmpv-2.dll" ]; then
      echo "libmpv-2.dll already exists in src-tauri/lib/ — skipping download."
      exit 0
    fi

    echo "Downloading libmpv-2.dll (required Windows runtime dependency, ~30MB compressed)..."
    echo ""

    # Get latest release from mpv-winbuild
    RELEASE_URL="https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest"
    ASSET_URL=$(curl -s "$RELEASE_URL" | grep -o '"browser_download_url": *"[^"]*mpv-dev-x86_64[^"]*\.7z"' | head -1 | cut -d'"' -f4)

    if [ -z "$ASSET_URL" ]; then
      echo "ERROR: Could not find mpv-dev-x86_64 download URL."
      echo "Please download manually from: https://github.com/zhongfly/mpv-winbuild/releases"
      echo "Extract libmpv-2.dll and place it in: $LIB_DIR/"
      exit 1
    fi

    echo "Downloading from: $ASSET_URL"
    TEMP_DIR=$(mktemp -d)
    ARCHIVE="$TEMP_DIR/mpv-dev.7z"

    curl -L -o "$ARCHIVE" "$ASSET_URL"

    # Check for 7z
    if command -v 7z &>/dev/null; then
      7z e "$ARCHIVE" libmpv-2.dll -o"$TEMP_DIR" -y
    elif command -v 7za &>/dev/null; then
      7za e "$ARCHIVE" libmpv-2.dll -o"$TEMP_DIR" -y
    else
      echo "ERROR: 7z not found. Install p7zip or 7-Zip to extract the archive."
      echo "  Windows: https://www.7-zip.org/"
      echo "  Or install via scoop: scoop install 7zip"
      echo ""
      echo "Alternatively, download and extract manually:"
      echo "  $ASSET_URL"
      echo "  Place libmpv-2.dll in: $LIB_DIR/"
      rm -rf "$TEMP_DIR"
      exit 1
    fi

    if [ -f "$TEMP_DIR/libmpv-2.dll" ]; then
      cp "$TEMP_DIR/libmpv-2.dll" "$LIB_DIR/libmpv-2.dll"
      echo ""
      echo "✓ libmpv-2.dll installed to src-tauri/lib/"
    else
      echo "ERROR: libmpv-2.dll not found in archive."
      exit 1
    fi

    rm -rf "$TEMP_DIR"
    ;;

  *)
    echo "Unknown platform: $(uname -s)"
    echo "See README.md for manual setup instructions."
    exit 1
    ;;
esac

echo ""
echo "Setup complete!"
