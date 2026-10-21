@echo off
call "%~dp0_runtime.cmd" diagnose operator
exit /b %ERRORLEVEL%