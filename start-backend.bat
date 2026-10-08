@echo off
rem Elindítja a Minecraft panel backendjét. Bezárás: Ctrl+C (a Minecraft szervert szépen leállítja).
title Minecraft panel backend
cd /d "%~dp0"
if not exist node_modules (
  echo Fuggosegek telepitese...
  call npm install || goto :error
)
cd backend
node src/index.ts
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo Hiba tortent, nezd meg a fenti uzenetet.
pause
