#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  echo "Usage: $0 [-h|--help]"
  echo
  echo "Build the web production bundle (dist/) inside a Docker container using node:22-alpine."
  echo "Runs 'npm ci && npm run build' (Vite build) in a clean container environment."
  echo
  echo "Options:"
  echo "  -h, --help    Show this help message and exit"
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
  "")
    ;;
  *)
    echo "Error: Unknown option '$1'" >&2
    usage >&2
    exit 1
    ;;
esac

docker run --rm \
  -v "$PWD":/app \
  -w /app \
  -u "$(id -u):$(id -g)" \
  node:22-alpine \
  sh -c "npm ci && npm run build"
