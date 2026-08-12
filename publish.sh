#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  echo "Usage: $0 [-h|--help]"
  echo
  echo "Upload built release artifacts in release/ (.dmg, .exe) to GitHub Release."
  echo "Uses the version from package.json as the release tag (e.g. v0.5.12)."
  echo
  echo "Options:"
  echo "  -h, --help    Show this help message and exit"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if ! command -v gh &>/dev/null; then
  echo "ERROR: GitHub CLI (gh) not found. Install it: brew install gh"
  exit 1
fi

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

FILES=()
for f in release/*.dmg release/*.exe release/*.zip release/*.AppImage; do
  [[ "$f" == *.blockmap ]] && continue
  [ -f "$f" ] && FILES+=("$f")
done

if [ ${#FILES[@]} -eq 0 ]; then
  echo "ERROR: No release files found in release/. Build first using ./build.sh (or ./build-mac.sh / ./build-win.sh)."
  exit 1
fi

echo "[publish] Found release files:"
for f in "${FILES[@]}"; do
  echo "  - $f"
done

if gh release view "$TAG" &>/dev/null; then
  echo "[publish] Release ${TAG} exists — uploading assets..."
  gh release upload "$TAG" "${FILES[@]}" --clobber
else
  echo "[publish] Creating release ${TAG}..."
  gh release create "$TAG" "${FILES[@]}" \
    --title "MonsterMQ-Explorer ${TAG}" \
    --notes "Release ${TAG}"
fi

echo "[publish] Done. Released ${TAG} to GitHub:"
echo "  $(gh release view "$TAG" --json url -q .url)"
