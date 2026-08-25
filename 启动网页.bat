@echo off
cd /d "%~dp0backend"
title Hunan Logistics Platform - localhost:5000
echo ============================================
echo   Xianglian Zhitu - Hunan Logistics Platform
echo   Server: http://localhost:5000
echo   Close this window to stop the server.
echo ============================================
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:5000"
python app_stdlib.py
pause
