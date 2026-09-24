@echo off
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-nexus.ps1"
exit /b %ERRORLEVEL%
