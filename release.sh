#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

VERSION_FILE="version.txt"

usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Options:"
  echo "  (default)                Bump patch version (e.g. v0.5.4 -> v0.5.5), tag & push"
  echo "  --as-is                  Use version from version.txt as-is, tag & push"
  echo "  --dev, --next [version]  Advance to next development version (e.g. 0.5.15-dev)"
  echo "  -h, --help               Show this help message"
  exit 0
}

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "Error: $VERSION_FILE not found"
  exit 1
fi

CURRENT_RAW=$(head -1 "$VERSION_FILE" | tr -d '[:space:]')
CURRENT="${CURRENT_RAW#v}"

# Parse semver: MAJOR.MINOR.PATCH[-PRERELEASE]
if [[ "$CURRENT" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)(-([a-zA-Z0-9.-]+))?$ ]]; then
  MAJOR="${BASH_REMATCH[1]}"
  MINOR="${BASH_REMATCH[2]}"
  PATCH="${BASH_REMATCH[3]}"
  PRERELEASE="${BASH_REMATCH[5]:-}"
else
  echo "Error: Invalid version format '$CURRENT_RAW' in $VERSION_FILE (expected [v]X.Y.Z[-dev])"
  exit 1
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

if [[ "${1:-}" == "--dev" || "${1:-}" == "--next" ]]; then
  if [[ -n "${2:-}" ]]; then
    NEXT_DEV="${2#v}"
    if [[ ! "$NEXT_DEV" =~ -dev$ ]]; then
      NEXT_DEV="${NEXT_DEV}-dev"
    fi
  else
    if [[ -n "$PRERELEASE" ]]; then
      NEXT_DEV="${MAJOR}.${MINOR}.${PATCH}-${PRERELEASE}"
      echo "Already on a development version: ${NEXT_DEV}"
      exit 0
    else
      NEXT_DEV="${MAJOR}.${MINOR}.$((PATCH + 1))-dev"
    fi
  fi

  echo "=== Advancing Explorer to Development Version: ${NEXT_DEV} ==="
  echo "v${NEXT_DEV}" > "$VERSION_FILE"
  if [ -f "scripts/set-version.cjs" ]; then
    node scripts/set-version.cjs
  fi
  git add "$VERSION_FILE" package.json
  [ -f "package-lock.json" ] && git add package-lock.json
  git commit -m "chore(version): prepare next version ${NEXT_DEV}" || {
    echo "No new changes to commit"
  }
  git push origin HEAD
  echo "✓ Pushed development version ${NEXT_DEV} to origin/main"
  exit 0
fi

AS_IS=false
if [[ "${1:-}" == "--as-is" ]]; then
  AS_IS=true
elif [[ -n "${1:-}" ]]; then
  usage
fi

if $AS_IS; then
  VERSION="v${CURRENT}"
else
  if [[ -n "$PRERELEASE" ]]; then
    # Finalize dev version: 0.5.15-dev -> 0.5.15
    VERSION="v${MAJOR}.${MINOR}.${PATCH}"
  else
    PATCH=$((PATCH + 1))
    VERSION="v${MAJOR}.${MINOR}.${PATCH}"
  fi

  # Write new version back to file
  echo "$VERSION" > "$VERSION_FILE"
  if [ -f "scripts/set-version.cjs" ]; then
    node scripts/set-version.cjs
  fi
  git add "$VERSION_FILE" package.json
  [ -f "package-lock.json" ] && git add package-lock.json
  git commit -m "Bump version to $VERSION"
fi

echo "Tagging $VERSION ..."
git tag "$VERSION"
git push
git push --tags

echo "Released $VERSION"
echo ""
echo "Next steps:"
echo "  1. Build artifacts locally : ./build.sh"
echo "  2. Publish release assets  : ./publish.sh"
echo "  3. Advance to next dev ver : ./release.sh --dev (or ./bump-dev.sh)"
