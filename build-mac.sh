#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  echo "Usage: $0 [-b] [-u]"
  echo "  -b  Build the macOS Electron app (.dmg)"
  echo "  -u  Upload .dmg to a GitHub release (creates or updates)"
  echo "  Both flags can be combined: $0 -b -u"
  exit 1
}

DO_BUILD=false
DO_UPLOAD=false

while getopts "bu" opt; do
  case $opt in
    b) DO_BUILD=true ;;
    u) DO_UPLOAD=true ;;
    *) usage ;;
  esac
done

if ! $DO_BUILD && ! $DO_UPLOAD; then
  usage
fi

# ── Build ────────────────────────────────────────────────────────────────────

if $DO_BUILD; then
  echo "[build-mac] Building macOS Electron app..."
  npm run build:electron:mac
  echo "[build-mac] Build complete."
fi

# ── Upload ───────────────────────────────────────────────────────────────────

if $DO_UPLOAD; then
  if ! command -v gh &>/dev/null; then
    echo "ERROR: GitHub CLI (gh) not found. Install it: brew install gh"
    exit 1
  fi

  VERSION=$(node -p "require('./package.json').version")
  TAG="v${VERSION}"

  mapfile -t DMGS < <(ls release/*.dmg 2>/dev/null | grep -v blockmap)
  if [ ${#DMGS[@]} -eq 0 ]; then
    echo "ERROR: No .dmg found in release/. Run with -b first."
    exit 1
  fi

  if gh release view "$TAG" &>/dev/null; then
    echo "[build-mac] Release ${TAG} exists — re-uploading assets..."
    gh release upload "$TAG" "${DMGS[@]}" --clobber
  else
    echo "[build-mac] Creating release ${TAG}..."
    gh release create "$TAG" "${DMGS[@]}" \
      --title "Monster MQTT Explorer ${TAG}" \
      --notes "Release ${TAG}"
  fi

  echo "[build-mac] Done. $(gh release view "$TAG" --json url -q .url)"
fi
