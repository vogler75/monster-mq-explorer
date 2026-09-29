#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  echo "Usage: $0 [-h|--help]"
  echo "  Build the Linux Electron app (.AppImage, .deb for x64 and arm64) into release/"
  exit 0
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

if [[ ! -d "node_modules" ]]; then
  echo "[build-linux] Installing dependencies..."
  npm install
fi

echo "[build-linux] Building web assets for Electron..."
node scripts/set-version.cjs
ELECTRON=1 npx vite build

# electron-builder's bundled fpm (used for .deb) only runs on x86_64.
# On other hosts, use a system-installed fpm or fall back to AppImage only.
TARGETS=(AppImage deb)
if [[ "$(uname -m)" != "x86_64" ]]; then
  if command -v fpm &>/dev/null; then
    export USE_SYSTEM_FPM=true
  else
    echo "[build-linux] Notice: fpm not found on $(uname -m); skipping .deb packages."
    echo "[build-linux]   To build .deb: sudo apt install ruby ruby-dev build-essential && sudo gem install fpm"
    TARGETS=(AppImage)
  fi
fi

echo "[build-linux] Packaging Linux Electron app (${TARGETS[*]})..."
npx electron-builder --linux "${TARGETS[@]}" --x64 --arm64

echo "[build-linux] Build complete."
