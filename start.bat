@echo off
chcp 65001 >nul
title FlowForge 启动
echo ============================================================
echo   FlowForge 一键启动
echo ============================================================
echo.

cd /d "%~dp0\.."

REM 检查 .venv
if not exist ".venv" (
    echo [错误] .venv 不存在，请先运行 install.bat
    pause
    exit /b 1
)

echo 启动 FlowForge...
echo 前端: http://localhost:5174
echo 后端: http://localhost:8000
echo.
echo 按 Ctrl+C 停止所有服务
echo.

python scripts\start_all.py

pause