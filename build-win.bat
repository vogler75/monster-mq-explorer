@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

set DO_BUILD=0
set DO_UPLOAD=0

if "%~1"=="" goto usage

:parse_args
if "%~1"=="" goto done_args
if "%~1"=="-b" set DO_BUILD=1
if "%~1"=="-u" set DO_UPLOAD=1
if "%~1"=="-bu" (set DO_BUILD=1 & set DO_UPLOAD=1)
if "%~1"=="-ub" (set DO_BUILD=1 & set DO_UPLOAD=1)
shift
goto parse_args
:done_args

if %DO_BUILD%==0 if %DO_UPLOAD%==0 goto usage
goto start

:usage
echo Usage: build-win.bat [-b] [-u]
echo   -b  Build the Windows Electron app (.exe)
echo   -u  Upload .exe to a GitHub release (creates or updates)
echo   Both flags can be combined: build-win.bat -b -u
exit /b 1

:start

:: ── Build ───────────────────────────────────────────────────────────────────

if %DO_BUILD%==1 (
  echo [build-win] Building Windows Electron app...
  npm run build:electron:win
  if errorlevel 1 (
    echo ERROR: Build failed.
    exit /b 1
  )
  echo [build-win] Build complete.
)

:: ── Upload ──────────────────────────────────────────────────────────────────

if %DO_UPLOAD%==1 (
  where gh >nul 2>&1
  if errorlevel 1 (
    echo ERROR: GitHub CLI ^(gh^) not found. Install it: winget install GitHub.cli
    exit /b 1
  )

  for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set VERSION=%%v
  set TAG=v!VERSION!

  set EXE=
  for %%f in (release\*.exe) do set EXE=%%f
  if "!EXE!"=="" (
    echo ERROR: No .exe found in release\. Run with -b first.
    exit /b 1
  )

  echo [build-win] Uploading !EXE! as !TAG!...

  gh release view "!TAG!" >nul 2>&1
  if errorlevel 1 (
    echo [build-win] Creating release !TAG!...
    gh release create "!TAG!" "!EXE!" --title "Monster MQTT Explorer !TAG!" --notes "Release !TAG!"
  ) else (
    echo [build-win] Release !TAG! exists -- re-uploading asset...
    gh release upload "!TAG!" "!EXE!" --clobber
  )

  if errorlevel 1 (
    echo ERROR: Upload failed.
    exit /b 1
  )

  for /f "delims=" %%u in ('gh release view "!TAG!" --json url -q .url') do echo [build-win] Done. %%u
)

endlocal
