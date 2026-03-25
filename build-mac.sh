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

  DMG=$(ls release/*"${VERSION}"*.dmg 2>/dev/null | grep -v blockmap | head -1)
  if [ -z "$DMG" ]; then
    echo "ERROR: No .dmg found in release/ for version ${VERSION}. Run with -b first."
    exit 1
  fi

  echo "[build-mac] Uploading ${DMG} as ${TAG}..."

  if gh release view "$TAG" &>/dev/null; then
    echo "[build-mac] Release ${TAG} exists — re-uploading asset..."
    gh release upload "$TAG" "$DMG" --clobber
  else
    echo "[build-mac] Creating release ${TAG}..."
    gh release create "$TAG" "$DMG" \
      --title "Monster MQTT Explorer ${TAG}" \
      --notes "Release ${TAG}"
  fi

  echo "[build-mac] Done. $(gh release view "$TAG" --json url -q .url)"
fi
