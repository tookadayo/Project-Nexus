@echo off
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-nexus.ps1"
set "nexusExit=%ERRORLEVEL%"
echo.
if not "%nexusExit%"=="0" echo Setup failed. Review the message above.
pause
exit /b %nexusExit%
