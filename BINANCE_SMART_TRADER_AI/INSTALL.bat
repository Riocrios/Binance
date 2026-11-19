@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================================
echo   BINANCE SMART TRADER AI - WINDOWS INSTALLATION
echo ============================================================================
echo.

ver | findstr /i "Windows" >nul
if errorlevel 1 (
    echo [ERROR] This installer is designed for Windows 10 / Windows 11 64-bit.
    pause
    exit /b 1
)

set "PYTHON_CMD="
where py >nul 2>&1
if not errorlevel 1 (
    py -3.12 --version >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_CMD=py -3.12"
    )
)

if "%PYTHON_CMD%"=="" (
    where python >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_CMD=python"
    )
)

if "%PYTHON_CMD%"=="" (
    echo [ERROR] Python 3.12 (64-bit) was not found on PATH.
    echo.
    echo Please install Python 3.12 64-bit manually from:
    echo   https://www.python.org/downloads/windows/
    echo IMPORTANT: Check "Add python.exe to PATH" during installation.
    echo This installer will never silently install Python without your consent.
    echo.
    pause
    exit /b 1
)

echo [1/8] Checking Python version and 64-bit architecture...
%PYTHON_CMD% -c "import sys, struct; v=sys.version_info; bits=struct.calcsize('P')*8; print(f'Detected Python {v.major}.{v.minor}.{v.micro} ({bits}-bit)'); sys.exit(0 if (v.major==3 and v.minor>=11 and bits==64) else 1)"
if errorlevel 1 (
    echo [ERROR] Python 3.12 (64-bit) is required. Please install 64-bit Python 3.12.
    pause
    exit /b 1
)

echo [2/8] Checking pip...
%PYTHON_CMD% -m pip --version
if errorlevel 1 (
    echo [ERROR] pip is not available in your Python installation.
    pause
    exit /b 1
)

echo [3/8] Creating virtual environment (.venv)...
if not exist ".venv\Scripts\python.exe" (
    %PYTHON_CMD% -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
)

set "VENV_PY=.venv\Scripts\python.exe"

echo [4/8] Installing required Python libraries...
"%VENV_PY%" -m pip install --upgrade pip
"%VENV_PY%" -m pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies from requirements.txt.
    pause
    exit /b 1
)

echo [5/8] Creating runtime directories...
if not exist "data" mkdir "data"
if not exist "logs" mkdir "logs"
if not exist "cache" mkdir "cache"
if not exist "assets" mkdir "assets"

echo [6/8] Verifying module imports and configuration...
"%VENV_PY%" -c "import PySide6, pyqtgraph, numpy, pandas, requests, websocket; from app.config import load_config; cfg=load_config(); print('Config OK:', cfg['market']['default_mode'])"
if errorlevel 1 (
    echo [ERROR] Core module import or config validation failed.
    pause
    exit /b 1
)

echo [7/8] Initializing local SQLite database...
"%VENV_PY%" -c "from app.database.database import DatabaseManager; from app.config import DATA_DIR; db=DatabaseManager(DATA_DIR / 'smart_trader.db'); db.initialize(); print('SQLite initialized at', DATA_DIR / 'smart_trader.db')"
if errorlevel 1 (
    echo [ERROR] SQLite initialization failed.
    pause
    exit /b 1
)

echo [8/8] Checking Binance public API connectivity...
"%VENV_PY%" -c "import requests; r1=requests.get('https://fapi.binance.com/fapi/v1/ping', timeout=6); r2=requests.get('https://api.binance.com/api/v3/ping', timeout=6); print('Binance Futures:', r1.status_code, '| Spot:', r2.status_code)"
if errorlevel 1 (
    echo [WARNING] Could not reach Binance API right now. You can still launch the app, and it will display DISCONNECTED until network access is restored.
)

echo.
echo ============================================================================
echo   INSTALLATION COMPLETE
echo ============================================================================
echo   You can now run START.bat anytime to launch BINANCE SMART TRADER AI.
echo ============================================================================
echo.
pause
exit /b 0
