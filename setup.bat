@echo off
echo.
echo  ============================================
echo   DayLens — Setup (Windows)
echo   No C++ compiler or Visual Studio needed!
echo  ============================================
echo.

echo [1/2] Installing dependencies (pure JavaScript — no compilation)...
call npm install
if %errorlevel% neq 0 (
  echo.
  echo ERROR: npm install failed.
  echo Make sure you have Node.js installed from https://nodejs.org
  pause
  exit /b 1
)

echo.
echo [2/2] Setup complete!
echo.
echo  To launch DayLens:
echo    npm start
echo.
pause
