@echo off
call "%~dp0_runtime.cmd" status operator
exit /b %ERRORLEVEL%