@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0backend"
title 湘链智图 - http://127.0.0.1:5000
echo ============================================
echo   湘链智图 · 湖南省市州生鲜冷链运输数字平台
echo   登录页: http://127.0.0.1:5000/login.html
echo   关闭本窗口即停止服务
echo ============================================
echo.
echo [1/2] 正在检查 Python 环境...

set "PYEXE="
where python >nul 2>nul && set "PYEXE=python"
if not defined PYEXE where py >nul 2>nul && set "PYEXE=py -3"
if not defined PYEXE (
  echo [错误] 未找到 Python，请先安装 Python 3.6 及以上版本后重试。
  pause
  exit /b 1
)
echo [OK] Python 已就绪

echo.
echo [2/2] 正在启动服务，浏览器将在 3 秒后自动打开...
echo.
echo   ==========================================
echo    登录方式（三选一）：
echo    1. 账号 admin / 密码 123456
echo    2. 点击「游客体验」快速进入
echo    3. 点击「演示账号」一键登录
echo   ==========================================
echo.
echo   如果浏览器没有自动弹出，请手动访问：
echo   http://127.0.0.1:5000/login.html
echo.

start "" cmd /c "timeout /t 3 /nobreak >nul && start http://127.0.0.1:5000/login.html"

%PYEXE% app_stdlib.py

echo.
echo ============================================
echo   服务已退出。若为异常退出，请把上方报错截图。
echo ============================================
echo.
pause
