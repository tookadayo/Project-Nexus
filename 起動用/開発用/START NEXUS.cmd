@echo off
cd /d "%~dp0..\.."
powershell.exe -NoLogo -NoProfile -File "%CD%\scripts\development\start-nexus.ps1" %*
set "nexusExit=%ERRORLEVEL%"
echo.
pause
exit /b %nexusExit%
