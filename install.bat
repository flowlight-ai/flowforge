@echo off
chcp 65001 >nul
title FlowForge 一键安装 (TS)
echo ============================================================
echo   FlowForge 一键安装（TS 栈，P1 主入口）
echo ============================================================
echo.

cd /d "%~dp0\.."

REM 入口已从 Python 栈切换为 TS 栈（阶段10 入口切换，30-stage10-cutover.md T10.1）
REM 旧 Python 栈进入日落冻结前置（T10.2），本脚本不再安装 Python 依赖。

echo 检查 Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 18+（建议 22+）
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

echo 检查 pnpm...
call pnpm --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 pnpm，请先安装: npm i -g pnpm
    pause
    exit /b 1
)

echo [1/3] 安装 TS 依赖（pnpm install）...
call pnpm install
if errorlevel 1 (
    echo [错误] pnpm install 失败
    pause
    exit /b 1
)

echo [2/3] 类型检查（tsc -b）...
call pnpm typecheck
if errorlevel 1 (
    echo [警告] 类型检查未通过，可继续启动（见 ERROR 详情）
)

echo [3/3] 构建（tsdown，可选）...
call pnpm build

echo ============================================================
echo   安装完成！
echo   下一步: 运行 start.bat 启动 FlowForge（TS 栈）
echo ============================================================
pause