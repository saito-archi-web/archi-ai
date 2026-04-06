$Host.UI.RawUI.WindowTitle = "Madori Shindan AI"

$root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Join-Path $root "frontend"
$backend  = Join-Path $root "backend"
$envFile  = Join-Path $backend ".env"
$envEx    = Join-Path $backend ".env.example"

Write-Host ""
Write-Host "  === Madori Shindan AI ===" -ForegroundColor Cyan
Write-Host ""

# Node.js check
try {
    $v = & node -v 2>&1
    Write-Host "  [OK] Node.js $v" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Node.js not found." -ForegroundColor Red
    Write-Host "  Please install: https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# .env check
if (-not (Test-Path $envFile)) {
    Copy-Item $envEx $envFile
    Write-Host "  [OK] Created .env (mock mode)" -ForegroundColor Yellow
}
Write-Host ""

# Frontend: npm install
Write-Host "  [1/3] Installing frontend packages..." -ForegroundColor Cyan
Set-Location $frontend
npm install --prefer-offline
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] npm install failed (frontend)" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "  Done." -ForegroundColor Green
Write-Host ""

# Frontend: build
Write-Host "  [2/3] Building frontend..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Build failed" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "  Done." -ForegroundColor Green
Write-Host ""

# Backend: npm install
Write-Host "  [3/3] Installing backend packages..." -ForegroundColor Cyan
Set-Location $backend
npm install --prefer-offline
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] npm install failed (backend)" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "  Done." -ForegroundColor Green
Write-Host ""

# Open browser after 2 sec
Start-Job -ScriptBlock { Start-Sleep 2; Start-Process "http://localhost:3001" } | Out-Null

# Start server
Write-Host "  ================================" -ForegroundColor Cyan
Write-Host "  URL: http://localhost:3001" -ForegroundColor Green
Write-Host "  Close this window to stop." -ForegroundColor Yellow
Write-Host "  ================================" -ForegroundColor Cyan
Write-Host ""

node server.js
