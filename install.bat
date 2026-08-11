@echo off
chcp 65001 >nul
title FlowForge 一键安装
echo ============================================================
echo   FlowForge 一键安装所有依赖环境
echo ============================================================
echo.

cd /d "%~dp0\.."

REM 检查 Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.11+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

REM 检查 Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 18+
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

echo [1/3] 运行环境检测...
python scripts\doctor.py
echo.
echo [2/3] 运行一键安装...
python scripts\install_all.py --all --npm-registry https://registry.npmmirror.com
echo.
echo [3/3] 安装完成，再次检测环境...
python scripts\doctor.py
echo.
echo ============================================================
echo   安装完成！
echo   下一步: 运行 start.bat 启动 FlowForge
echo ============================================================
pause