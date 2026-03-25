param(
  [switch]$b,
  [switch]$u
)

Push-Location $PSScriptRoot

if (-not $b -and -not $u) {
  Write-Host "Usage: .\build-win.ps1 [-b] [-u]"
  Write-Host "  -b  Build the Windows Electron app (.exe)"
  Write-Host "  -u  Upload .exe to a GitHub release (creates or updates)"
  Write-Host "  Both flags can be combined: .\build-win.ps1 -b -u"
  Pop-Location; exit 1
}

# ── Build ──────────────────────────────────────────────────────────────────

if ($b) {
  Write-Host "[build-win] Building Windows Electron app..."
  npm run build:electron:win
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed." -ForegroundColor Red
    Pop-Location; exit 1
  }
  Write-Host "[build-win] Build complete."
}

# ── Upload ─────────────────────────────────────────────────────────────────

if ($u) {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: GitHub CLI (gh) not found. Install it: winget install GitHub.cli" -ForegroundColor Red
    Pop-Location; exit 1
  }

  $version = node -p "require('./package.json').version"
  $tag = "v$version"

  $exe = Get-ChildItem release\*$version*.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $exe) {
    Write-Host "ERROR: No .exe found in release\. Run with -b first." -ForegroundColor Red
    Pop-Location; exit 1
  }

  Write-Host "[build-win] Uploading $($exe.Name) as $tag..."

  gh release view $tag 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[build-win] Creating release $tag..."
    gh release create $tag $exe.FullName --title "Monster MQTT Explorer $tag" --notes "Release $tag"
  } else {
    Write-Host "[build-win] Release $tag exists -- re-uploading asset..."
    gh release upload $tag $exe.FullName --clobber
  }

  if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Upload failed." -ForegroundColor Red
    Pop-Location; exit 1
  }

  $url = gh release view $tag --json url -q .url
  Write-Host "[build-win] Done. $url"
}

Pop-Location
