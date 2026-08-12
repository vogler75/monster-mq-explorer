#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  echo "Usage: $0 [-h|--help]"
  echo "  Build the Windows Electron app (.exe) into release/"
  exit 0
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

echo "[build-win] Building Windows Electron app..."
npm run build:electron:win
echo "[build-win] Build complete."
