@echo off
setlocal
chcp 65001 >nul
title Les Chroniques de Felingard
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  if exist "%LOCALAPPDATA%\hermes\node\npm.cmd" (
    set "PATH=%LOCALAPPDATA%\hermes\node;%PATH%"
  ) else if exist "%ProgramFiles%\nodejs\npm.cmd" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
  )
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js / npm introuvable dans le PATH.
  echo Installez Node.js ou verifiez "%LOCALAPPDATA%\hermes\node".
  pause
  exit /b 1
)

if not exist "node_modules\.bin\vite.cmd" (
  echo Installation des dependances du projet...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERREUR] L'installation des dependances a echoue.
    pause
    exit /b 1
  )
)

echo Lancement de Les Chroniques de Felingard...
call npm run start
if errorlevel 1 (
  echo.
  echo [ERREUR] Le jeu n'a pas pu demarrer. Verifiez Node.js et les dependances.
  pause
  exit /b 1
)
