#!/usr/bin/env bash
set -euo pipefail

VERSION_FILE="version.txt"

usage() {
  echo "Usage: $0 [--as-is]"
  echo ""
  echo "  (default)  Bump patch version (e.g. v0.5.4 -> v0.5.5), write to version.txt, tag & push"
  echo "  --as-is    Use version from version.txt as-is (for manual major/minor bumps), tag & push"
  exit 1
}

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "Error: $VERSION_FILE not found"
  exit 1
fi

CURRENT=$(head -1 "$VERSION_FILE" | tr -d '[:space:]')

if [[ ! "$CURRENT" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Invalid version format '$CURRENT' in $VERSION_FILE (expected vX.Y.Z)"
  exit 1
fi

AS_IS=false
if [[ "${1:-}" == "--as-is" ]]; then
  AS_IS=true
elif [[ -n "${1:-}" ]]; then
  usage
fi

if $AS_IS; then
  VERSION="$CURRENT"
else
  # Strip leading 'v', split, bump patch
  BASE="${CURRENT#v}"
  MAJOR="${BASE%%.*}"
  REST="${BASE#*.}"
  MINOR="${REST%%.*}"
  PATCH="${REST#*.}"
  PATCH=$((PATCH + 1))
  VERSION="v${MAJOR}.${MINOR}.${PATCH}"

  # Write new version back to file
  echo "$VERSION" > "$VERSION_FILE"
  git add "$VERSION_FILE"
  git commit -m "Bump version to $VERSION"
fi

echo "Tagging $VERSION ..."
git tag "$VERSION"
git push
git push --tags

echo "Released $VERSION"
