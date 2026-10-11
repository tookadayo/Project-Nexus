@echo off
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -File "%~dp0runtime-child.ps1" -Role operator -Root "%~dp0"
pause
