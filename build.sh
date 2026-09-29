#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  echo "Usage: $0 [-h|--help]"
  echo
  echo "Build all Electron app packages (macOS, Windows and Linux)."
  echo
  echo "Options:"
  echo "  -h, --help    Show this help message and exit"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -d "node_modules" ]]; then
  echo "[build] Installing dependencies..."
  npm install
fi

echo "[build] Building macOS Electron app..."
./build-mac.sh

if [[ "$(uname -s)" == "Linux" ]]; then
  echo "[build] Notice: Skipping Windows Electron build on Linux (Windows installer is built on Windows)."
else
  echo "[build] Building Windows Electron app..."
  ./build-win.sh
fi

echo "[build] Building Linux Electron app..."
./build-linux.sh

echo "[build] All platform builds completed successfully."
