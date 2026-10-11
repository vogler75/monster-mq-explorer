#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "Usage: ./bump-dev.sh [version]"
    echo ""
    echo "Advance to the next development version (e.g. 0.5.15-dev) and push to origin/main."
    echo "If [version] is omitted, increments the patch number and appends -dev."
    exit 0
fi

exec "$SCRIPT_DIR/release.sh" --dev "$@"
