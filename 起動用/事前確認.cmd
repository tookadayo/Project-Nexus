@echo off
call "%~dp0_runtime.cmd" diagnose app
exit /b %ERRORLEVEL%