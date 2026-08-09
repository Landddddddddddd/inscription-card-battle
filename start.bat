@echo off
REM ============================================================
REM  Inscryption Local - One-click launcher
REM  Double-click this file to start the server and open the game.
REM ============================================================
cd /d "%~dp0"
set PORT=3000

REM If the server is already running, just open the browser.
curl -s -o nul -w "%%{http_code}" "http://localhost:%PORT%/" --max-time 2 > "%TEMP%\ins_chk.txt" 2>nul
set /p CHK=<"%TEMP%\ins_chk.txt"
if "%CHK%"=="200" (
  echo [OK] Server already running. Opening game...
  goto OPEN
)

REM Make sure Node.js is available.
where node >nul 2>nul
if %errorlevel%==0 (
  echo [START] Launching server (node server.js)...
  start "InscryptionServer" cmd /k "node server.js"
) else (
  echo [ERROR] node not found. Install Node.js (https://nodejs.org) and add it to PATH.
  pause
  exit /b 1
)

REM Wait until the server responds.
echo [WAIT] Starting server...
:WAIT
timeout /t 1 >nul
curl -s -o nul -w "%%{http_code}" "http://localhost:%PORT%/" --max-time 1 > "%TEMP%\ins_chk2.txt" 2>nul
set /p CHK2=<"%TEMP%\ins_chk2.txt"
if not "%CHK2%"=="200" goto WAIT

:OPEN
echo [DONE] Opening browser to the game...
start http://localhost:%PORT%/
exit /b 0
