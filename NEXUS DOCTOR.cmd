@echo off
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor-nexus.ps1" %*
set "nexusExit=%ERRORLEVEL%"
echo.
pause
exit /b %nexusExit%
