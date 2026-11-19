@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found.
    echo Please run INSTALL.bat once before starting the application.
    pause
    exit /b 1
)

set "PYTHONPATH=%~dp0"
set "QT_ENABLE_HIGHDPI_SCALING=1"

echo Starting BINANCE SMART TRADER AI...
".venv\Scripts\python.exe" -m app.main
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [CRASH] Application exited with error code %EXIT_CODE%.
    echo Check logs\app.log for full diagnostic details.
    pause
    exit /b %EXIT_CODE%
)

exit /b 0
