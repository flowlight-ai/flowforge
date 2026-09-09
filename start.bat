@echo off
chcp 65001 >nul
title FlowForge 启动 (TS)
echo ============================================================
echo   FlowForge 一键启动（TS 版，P1 主入口）
echo ============================================================
echo.

cd /d "%~dp0\.."

REM 入口已从 Python 栈切换为 TS 栈（阶段 10 入口切换，30-stage10-cutover.md T10.1）
REM 旧 Python 栈进入日落冻结前置（T10.2），如需回退见 README "Python 旧版回退" 章节。

REM 检查依赖
if not exist "node_modules" (
    echo [错误] 依赖未安装，请先运行 install.bat（pnpm install）
    pause
    exit /b 1
)

if not exist "apps\cli\src\bin.ts" (
    echo [错误] 未找到 TS CLI 入口 apps\cli\src\bin.ts
    pause
    exit /b 1
)

echo 启动 FlowForge（TS 栈）...
echo 由 flowforge CLI 统一装配（web profile 承载前端与接口）
echo 按 Ctrl+C 停止服务
echo.
echo [提示] 旧 Python 旧版已进入日落冻结前置（DEPRECATED），详见 README 回退章节。
echo.

call pnpm start

pause