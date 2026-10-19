@echo off
call "%~dp0_runtime.cmd" stop app
exit /b %ERRORLEVEL%