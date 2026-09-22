@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PMR - SimGrid Helper

echo.
echo  ========================================
echo   PMR -^> SimGrid Helper
echo  ========================================
echo.
echo  Najpierw przeczytaj plik:  README FIRST.txt
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [BLAD] Nie znaleziono Node.js.
  echo.
  echo  Zainstaluj Node.js LTS ze strony:
  echo    https://nodejs.org/
  echo  Potem zamknij to okno i uruchom START.bat ponownie.
  echo.
  pause
  exit /b 1
)

echo  Uruchamiam helper...
echo  Przegladarka: http://127.0.0.1:3847
echo  Tego okna NIE zamykaj, dopoki korzystasz z programu.
echo.
echo  Zamkniecie: krzyzyk okna albo Ctrl+C
echo  ----------------------------------------
echo.

start "" "http://127.0.0.1:3847"
node src\server.js
if errorlevel 1 (
  echo.
  echo  [BLAD] Program zakonczyl sie z bledem.
  echo  Sprawdz port UDP / README FIRST.txt
  echo.
  pause
)
