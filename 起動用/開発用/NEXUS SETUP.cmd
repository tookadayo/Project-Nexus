@echo off
cd /d "%~dp0..\.."
powershell.exe -NoLogo -NoProfile -File "%CD%\scripts\development\setup-nexus.ps1" %*
set "nexusExit=%ERRORLEVEL%"
echo.
pause
exit /b %nexusExit%
