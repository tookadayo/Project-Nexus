@echo off
setlocal
set "NODE_OPTIONS="
set "NODE_PATH="
set "TSX_TSCONFIG_PATH="
set "nexusNode=%USERPROFILE%\NEXUS-RUNTIME\tools\node-v24.22.0-win-x64\node.exe"
if not exist "%nexusNode%" (
  echo NEXUS OFFICIAL_NODE_24_22_REQUIRED
  exit /b 1
)
pushd "%~dp0.."
if errorlevel 1 exit /b 1
"%nexusNode%" "%CD%\scripts\production\bootstrap.mjs" "%~1" "%~2"
set "nexusExit=%ERRORLEVEL%"
popd
echo.
if not "%NEXUS_NONINTERACTIVE%"=="1" pause
exit /b %nexusExit%