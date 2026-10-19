@echo off
call "%~dp0_runtime.cmd" restart app
exit /b %ERRORLEVEL%