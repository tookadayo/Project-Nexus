@echo off
call "%~dp0_runtime.cmd" stop operator
exit /b %ERRORLEVEL%