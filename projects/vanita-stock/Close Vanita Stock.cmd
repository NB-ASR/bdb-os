@echo off
title Close Vanita Stock
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-Vanita-Stock.ps1"
echo.
echo Press any key to close this window.
pause >nul
