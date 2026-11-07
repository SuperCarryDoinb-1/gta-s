@echo off
setlocal
title Shanghai Game
powershell.exe -NoProfile -File "%~dp0start-game.ps1" -Built
if errorlevel 1 pause
