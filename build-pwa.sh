#!/usr/bin/env sh

set -eu

echo "[Monster MQTT Explorer] Building PWA bundle..."

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm was not found in PATH."
  echo "Install Node.js and npm, then run this script again."
  exit 1
fi

if [ ! -f package.json ]; then
  echo "ERROR: Run this script from the project root."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

if [ ! -f public/icons/icon-192.png ]; then
  echo "WARNING: public/icons/icon-192.png is missing."
fi

if [ ! -f public/icons/icon-512.png ]; then
  echo "WARNING: public/icons/icon-512.png is missing."
fi

echo "Running production build..."
npm run build:pwa

if [ ! -f dist/manifest.webmanifest ]; then
  echo "ERROR: dist/manifest.webmanifest was not generated."
  exit 1
fi

if [ ! -f dist/sw.js ]; then
  echo "ERROR: dist/sw.js was not generated."
  exit 1
fi

echo
echo "PWA bundle created successfully in dist/"
echo "To test it locally, run: npm run preview"
echo "Then open the app in a browser and use Install App / Add to Home Screen."
