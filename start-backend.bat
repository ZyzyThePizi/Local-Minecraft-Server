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
if errorlevel 1 goto :playit
tailscale funnel --bg --https=10000 http://127.0.0.1:8765 >nul 2>&1
if errorlevel 1 goto :funnelfail
echo   Tailscale Funnel: bekapcsolva a 10000-es porton.
goto :playit

:funnelfail
echo   [FIGYELEM] A Tailscale Funnel nem állt be. Fut a Tailscale, és be vagy jelentkezve?

:playit
rem A játékforgalom tunnelje (playit.gg). Ha nincs telepítve, letölti és telepíti; ha nem fut, elindítja.
set "PLAYIT=%ProgramFiles%\playit_gg\bin\playit.exe"
if exist "%PLAYIT%" goto :playitcheck
echo   A playit.gg nincs telepítve, letöltöm a hivatalos telepítőt...
set "PLAYITMSI=%TEMP%\playit-windows-x86_64-signed.msi"
curl.exe -fsSL -o "%PLAYITMSI%" https://github.com/playit-cloud/playit-agent/releases/latest/download/playit-windows-x86_64-signed.msi
if errorlevel 1 goto :playitfail
rem Csak a playit.gg kiadójának (Developed Methods LLC) érvényes aláírásával futtatjuk.
powershell -NoProfile -Command "$s = Get-AuthenticodeSignature $env:PLAYITMSI; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notlike '*Developed Methods LLC*') { exit 1 }"
if errorlevel 1 goto :playitsig
echo   Telepítés: a Windows engedélyt kér (UAC), fogadd el.
msiexec /i "%PLAYITMSI%" /passive
if not exist "%PLAYIT%" goto :playitfail
del "%PLAYITMSI%" >nul 2>&1
echo   A playit.gg telepítve. Egy új ablakban párosítsd a fiókoddal (a kiírt linket nyisd meg),
echo   majd a playit.gg oldalán hozz létre egy "Minecraft Java" tunnelt a 127.0.0.1:25565-re.
start "playit.gg beállítás" "%PLAYIT%" setup
goto :run

:playitcheck
for %%P in (playit.exe playitd.exe playitd-service.exe) do (
  tasklist /fi "imagename eq %%P" | "%SystemRoot%\System32\find.exe" /i "%%P" >nul && goto :playiton
)
start "playit.gg" /min "%PLAYIT%" start
:playiton
echo   playit.gg: fut (játékforgalom).
goto :run

:playitsig
echo   [FIGYELEM] A letöltött playit.gg telepítő aláírása nem érvényes, nem futtatom.
del "%PLAYITMSI%" >nul 2>&1
goto :run

:playitfail
echo   [FIGYELEM] A playit.gg telepítése nem sikerült. Kézzel: https://playit.gg/download

:run
echo   Panel: https://zyzythepizi.github.io/Local-Minecraft-Server/
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
