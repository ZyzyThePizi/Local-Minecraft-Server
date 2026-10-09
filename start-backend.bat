@echo off
chcp 65001 >nul
title Minecraft panel - backend
cd /d "%~dp0"

echo.
echo   ==================================================
echo     Minecraft panel backend
echo   ==================================================
echo.

where node >nul 2>&1
if errorlevel 1 goto :nonode

if exist node_modules goto :funnel
echo   Első indítás: függőségek telepítése...
call npm install --no-audit --no-fund
if errorlevel 1 goto :npmfail

:funnel
rem Publikus HTTPS cím a backendnek. Ha már be van állítva, nem változtat semmin.
where tailscale >nul 2>&1
if errorlevel 1 goto :run
tailscale funnel --bg --https=10000 http://127.0.0.1:8765 >nul 2>&1
if errorlevel 1 goto :funnelfail
echo   Tailscale Funnel: bekapcsolva a 10000-es porton.
goto :run

:funnelfail
echo   [FIGYELEM] A Tailscale Funnel nem állt be. Fut a Tailscale, és be vagy jelentkezve?

:run
echo   Panel: https://zyzythepizi.github.io/minecraft/
echo   Ezt az ablakot hagyd nyitva, amíg a szerver kell. Leállítás: Ctrl+C
echo.
cd backend
node src/index.ts
goto :end

:nonode
echo   [HIBA] A Node.js nincs telepítve. Letöltés: https://nodejs.org - 24-es vagy újabb verzió kell.
goto :end

:npmfail
echo   [HIBA] A függőségek telepítése nem sikerült, nézd meg a fenti üzenetet.

:end
echo.
echo   A backend leállt. Nyomj meg egy gombot az ablak bezárásához.
pause >nul
