@echo off
setlocal
cd /d "%~dp0"
npm run start
if errorlevel 1 (
  echo.
  echo The game could not start. Check that Node.js and project dependencies are installed.
  pause
)
