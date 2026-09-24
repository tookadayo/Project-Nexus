@echo off
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-nexus.ps1"
set "nexusExit=%ERRORLEVEL%"
echo.
if not "%nexusExit%"=="0" echo Start failed. Check .local\runtime\*.err.log or run NEXUS DOCTOR.cmd.
pause
exit /b %nexusExit%
