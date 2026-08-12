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

echo "[build-mac] Building macOS Electron app..."
npm run build:electron:mac
echo "[build-mac] Build complete."
