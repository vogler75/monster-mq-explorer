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

# electron-builder's bundled fpm (used for .deb) only runs on x86_64.
# On other hosts, use a system-installed fpm or fall back to AppImage only.
TARGETS=(AppImage deb)
DEB_WARNING=""
if [[ "$(uname -m)" != "x86_64" ]]; then
  if command -v fpm &>/dev/null; then
    export USE_SYSTEM_FPM=true
  else
    if ! command -v ruby &>/dev/null; then
      DEB_WARNING="Ruby and fpm are not installed. Install them with:
    sudo apt install ruby ruby-dev build-essential
    sudo gem install fpm"
    else
      DEB_WARNING="fpm is not installed. Install it with:
    sudo gem install fpm"
    fi
    TARGETS=(AppImage)
  fi
fi

warn_deb() {
  [[ -z "$DEB_WARNING" ]] && return
  echo >&2
  echo "[build-linux] WARNING: Skipping .deb packages: electron-builder's bundled fpm does not run on $(uname -m)." >&2
  echo "[build-linux]   $DEB_WARNING" >&2
  echo "[build-linux]   Then run $0 again to also build the .deb packages." >&2
  echo >&2
}

warn_deb

echo "[build-linux] Building web assets for Electron..."
node scripts/set-version.cjs
ELECTRON=1 npx vite build

echo "[build-linux] Packaging Linux Electron app (${TARGETS[*]})..."
npx electron-builder --linux "${TARGETS[@]}" --x64 --arm64

echo "[build-linux] Build complete."
warn_deb
