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

if [[ "$(uname -s)" == "Linux" ]]; then
  echo "[build-win] Notice: Skipping Windows Electron build on Linux. Windows installer is built on Windows."
  exit 0
fi

echo "[build-win] Building Windows Electron app..."
npm run build:electron:win
echo "[build-win] Build complete."
