#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

docker run --rm \
  -v "$PWD":/app \
  -w /app \
  -u "$(id -u):$(id -g)" \
  node:22-alpine \
  sh -c "npm ci && npm run build"
