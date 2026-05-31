#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  echo "Usage: $0 [-b] [-u]"
  echo "  -b  Build the Windows Electron app (.exe)"
  echo "  -u  Upload .exe to a GitHub release (creates or updates)"
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
  echo "[build-win] Building Windows Electron app..."
  npm run build:electron:win
  echo "[build-win] Build complete."
fi

# ── Upload ───────────────────────────────────────────────────────────────────

if $DO_UPLOAD; then
  if ! command -v gh &>/dev/null; then
    echo "ERROR: GitHub CLI (gh) not found. Install it: brew install gh"
    exit 1
  fi

  VERSION=$(node -p "require('./package.json').version")
  TAG="v${VERSION}"

  EXES=()
  for f in release/*.exe; do
    [ -f "$f" ] && EXES+=("$f")
  done
  if [ ${#EXES[@]} -eq 0 ]; then
    echo "ERROR: No .exe found in release/. Run with -b first."
    exit 1
  fi

  if gh release view "$TAG" &>/dev/null; then
    echo "[build-win] Release ${TAG} exists — re-uploading assets..."
    gh release upload "$TAG" "${EXES[@]}" --clobber
  else
    echo "[build-win] Creating release ${TAG}..."
    gh release create "$TAG" "${EXES[@]}" \
      --title "Monster MQTT Explorer ${TAG}" \
      --notes "Release ${TAG}"
  fi

  echo "[build-win] Done. $(gh release view "$TAG" --json url -q .url)"
fi
