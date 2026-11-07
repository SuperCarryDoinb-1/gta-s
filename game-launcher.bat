@echo off
setlocal
title GTA Game Launcher
rem Resolve relative to the launcher so the workspace can be moved safely.
set "GAME_DIR=%~dp0"

if not exist "%GAME_DIR%\package.json" (
    echo [ERROR] Game directory was not found: "%GAME_DIR%"
    goto :failed
)
cd /d "%GAME_DIR%"
if errorlevel 1 goto :failed

where node.exe >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found. Install Node.js and try again.
    goto :failed
)
if not exist "%GAME_DIR%\node_modules\vite\bin\vite.js" (
    echo [ERROR] Game dependencies are missing. Run npm install in:
    echo "%GAME_DIR%"
    goto :failed
)

echo Starting game from "%GAME_DIR%"
echo The game will open in your browser automatically.
echo Keep this terminal open while playing. Press Ctrl+C to stop.
echo The game always uses port 5175 so local saves stay on the same origin.
echo.
node.exe "%GAME_DIR%\node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5175 --strictPort --open
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Game launch failed. See the error above.
pause
exit /b 1
