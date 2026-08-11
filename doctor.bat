@echo off
chcp 65001 >nul
title FlowForge 环境检测
echo ============================================================
echo   FlowForge 环境检测
echo ============================================================
echo.

cd /d "%~dp0\.."
python scripts\doctor.py
pause