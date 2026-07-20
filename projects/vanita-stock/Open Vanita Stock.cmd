@echo off
title Vanita Stock
cd /d "%~dp0"
echo Starting Vanita Stock...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-StockFlow.ps1"
echo.
echo Vanita Stock stopped. Press any key to close this window.
pause >nul
