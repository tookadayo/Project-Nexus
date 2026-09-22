@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-nexus.ps1"
if errorlevel 1 (
  echo.
  echo NEXUS failed to start. Review the error above.
  pause
  exit /b 1
)
endlocal
