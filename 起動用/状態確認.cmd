@echo off
call "%~dp0_runtime.cmd" status app
exit /b %ERRORLEVEL%