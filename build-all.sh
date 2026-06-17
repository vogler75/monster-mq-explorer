#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "[build-all] Building and uploading macOS release..."
./build-mac.sh -b -u

echo "[build-all] Building and uploading Windows release..."
./build-win.sh -b -u

echo "[build-all] All builds and uploads completed successfully."
