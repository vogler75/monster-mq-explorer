#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

build=false
electron=false

usage() {
  echo "Usage: ./run.sh [-b] [-e|--electron]"
  echo
  echo "Options:"
  echo "  -b    Build first, then run the production preview server"
  echo "  -e    Run the Electron preview app"
  echo "  --electron"
  echo "        Run the Electron preview app"
  echo "  -h    Show this help"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -b) build=true ;;
    -e|--electron) electron=true ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  shift
done

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm was not found in PATH."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

if [ "$electron" = true ]; then
  npm run electron:preview
elif [ "$build" = true ]; then
  npm run build
  npm run preview
else
  npm run dev
fi
