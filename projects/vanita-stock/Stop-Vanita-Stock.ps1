$root = (Resolve-Path $PSScriptRoot).Path
$statePath = Join-Path $root '.vanita-stock-server.json'

if (-not (Test-Path -LiteralPath $statePath)) {
    Write-Host 'Vanita Stock is not currently running.' -ForegroundColor Yellow
    exit 0
}

try {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
    if (-not $process -or $process.ProcessName -notmatch 'powershell|pwsh') {
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
        Write-Host 'Vanita Stock is not currently running.' -ForegroundColor Yellow
        exit 0
    }

    Stop-Process -Id $state.pid -Force
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    Write-Host 'Vanita Stock has been closed.' -ForegroundColor Green
}
catch {
    Write-Host "Could not close Vanita Stock: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
