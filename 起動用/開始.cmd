@echo off
call "%~dp0_runtime.cmd" start app
exit /b %ERRORLEVEL%