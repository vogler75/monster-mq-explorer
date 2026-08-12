#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  echo "Usage: $0 [-h|--help]"
  echo
  echo "Build all Electron app packages (macOS and Windows)."
  echo
  echo "Options:"
  echo "  -h, --help    Show this help message and exit"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "[build] Building macOS Electron app..."
./build-mac.sh

echo "[build] Building Windows Electron app..."
./build-win.sh

echo "[build] All platform builds completed successfully."
