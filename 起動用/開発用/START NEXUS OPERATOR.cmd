@echo off
cd /d "%~dp0..\.."
powershell.exe -NoLogo -NoProfile -File "%CD%\scripts\development\runtime-child.ps1" -Role operator -Root "%CD%"
pause