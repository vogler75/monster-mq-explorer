@echo off
setlocal

echo [Monster MQTT Explorer] Building PWA bundle...

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found in PATH.
  echo Install Node.js and npm, then run this script again.
  exit /b 1
)

if not exist package.json (
  echo ERROR: Run this script from the project root.
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    exit /b 1
  )
)

if not exist public\icons\icon-192.png (
  echo WARNING: public\icons\icon-192.png is missing.
)

if not exist public\icons\icon-512.png (
  echo WARNING: public\icons\icon-512.png is missing.
)

echo Running production build...
call npm run build:pwa
if errorlevel 1 (
  echo ERROR: PWA build failed.
  exit /b 1
)

if not exist dist\manifest.webmanifest (
  echo ERROR: dist\manifest.webmanifest was not generated.
  exit /b 1
)

if not exist dist\sw.js (
  echo ERROR: dist\sw.js was not generated.
  exit /b 1
)

echo.
echo PWA bundle created successfully in dist\
echo To test it locally, run: npm run preview
echo Then open the app in a browser and use Install App / Add to Home Screen.

exit /b 0
