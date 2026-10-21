@echo off
call "%~dp0_runtime.cmd" start operator
exit /b %ERRORLEVEL%