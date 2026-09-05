#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  echo "Usage: $0 [-h|--help]"
  echo "  Build the macOS Electron app (.dmg) into release/"
  exit 0
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

if [[ ! -d "node_modules" ]]; then
  echo "[build-mac] Installing dependencies..."
  npm install
fi

echo "[build-mac] Building web assets for Electron..."
node scripts/set-version.cjs
ELECTRON=1 npx vite build

echo "[build-mac] Packaging macOS Electron app..."
if [[ "$(uname -s)" == "Darwin" ]]; then
  npx electron-builder --mac
else
  echo "[build-mac] Notice: Running on Linux. Building macOS zip packages (DMG requires macOS sips/hdiutil)."
  npx electron-builder --mac zip --arm64 --x64
fi

echo "[build-mac] Build complete."
