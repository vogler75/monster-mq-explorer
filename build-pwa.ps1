<#
.SYNOPSIS
    Builds the PWA bundle for MonsterMQ-Explorer.
#>

Push-Location $PSScriptRoot
try {
    Write-Host "[MonsterMQ-Explorer] Building PWA bundle..."

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        [Console]::Error.WriteLine("ERROR: npm was not found in PATH.")
        [Console]::Error.WriteLine("Install Node.js and npm, then run this script again.")
        exit 1
    }

    if (-not (Test-Path "package.json")) {
        [Console]::Error.WriteLine("ERROR: Run this script from the project root.")
        exit 1
    }

    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing dependencies..."
        & npm install
        if ($LASTEXITCODE -ne 0) {
            [Console]::Error.WriteLine("ERROR: npm install failed.")
            exit 1
        }
    }

    if (-not (Test-Path "public\icons\icon-192.png")) {
        Write-Warning "public\icons\icon-192.png is missing."
    }

    if (-not (Test-Path "public\icons\icon-512.png")) {
        Write-Warning "public\icons\icon-512.png is missing."
    }

    Write-Host "Running production build..."
    & npm run build:pwa
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("ERROR: PWA build failed.")
        exit 1
    }

    if (-not (Test-Path "dist\manifest.webmanifest")) {
        [Console]::Error.WriteLine("ERROR: dist\manifest.webmanifest was not generated.")
        exit 1
    }

    if (-not (Test-Path "dist\sw.js")) {
        [Console]::Error.WriteLine("ERROR: dist\sw.js was not generated.")
        exit 1
    }

    Write-Host ""
    Write-Host "PWA bundle created successfully in dist\"
    Write-Host "To test it locally, run: npm run preview"
    Write-Host "Then open the app in a browser and use Install App / Add to Home Screen."

    exit 0
} finally {
    Pop-Location
}
