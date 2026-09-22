@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PMR - SimGrid Helper

echo.
echo  ========================================
echo   PMR -^> SimGrid Helper
echo  ========================================
echo.
echo  Read README FIRST.txt before you start.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js was not found.
  echo.
  echo  Install Node.js LTS from:
  echo    https://nodejs.org/
  echo  Then close this window and run START.bat again.
  echo.
  pause
  exit /b 1
)

echo  Starting helper...
echo  Browser: http://127.0.0.1:3847
echo  Keep this window open while you use the app.
echo.
echo  Close: window X or Ctrl+C
echo  ----------------------------------------
echo.

start "" "http://127.0.0.1:3847"
node src\server.js
if errorlevel 1 (
  echo.
  echo  [ERROR] The helper exited with an error.
  echo  Check the UDP port / README FIRST.txt
  echo.
  pause
)
