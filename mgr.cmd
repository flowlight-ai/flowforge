@echo off
REM ============================================================================
REM mgr.cmd - Windows wrapper to call mgr bash script from PowerShell/CMD
REM Usage: mgr status / mgr push --pr / mgr sync "feat(x): desc [agent]"
REM Platform: Windows only (Linux/macOS run ./mgr directly)
REM bash lookup: git-reverse -> registry -> PATH -> multi-drive fallback (no hardcode)
REM ============================================================================
setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "BASH_EXE="

REM Strategy 1: reverse from git.exe (git in <Root>\cmd\git.exe, bash in <Root>\bin\bash.exe)
where git >nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%i in ('where git') do (
        if not defined BASH_EXE (
            for %%d in ("%%~dpi..") do if exist "%%~fd\bin\bash.exe" set "BASH_EXE=%%~fd\bin\bash.exe"
        )
    )
)

REM Strategy 2: registry GitForWindows InstallPath (64/32bit/user)
if not defined BASH_EXE (
    for %%K in ("HKLM\SOFTWARE\GitForWindows" "HKLM\SOFTWARE\WOW6432Node\GitForWindows" "HKCU\SOFTWARE\GitForWindows") do (
        if not defined BASH_EXE for /f "tokens=2,*" %%a in ('reg query %%K /v InstallPath 2^>nul ^| findstr InstallPath') do if exist "%%b\bin\bash.exe" set "BASH_EXE=%%b\bin\bash.exe"
    )
)

REM Strategy 3: bash in PATH
if not defined BASH_EXE (
    where bash >nul 2>&1
    if not errorlevel 1 for /f "delims=" %%i in ('where bash') do if not defined BASH_EXE set "BASH_EXE=%%i"
)

REM Strategy 4: multi-drive common path fallback
if not defined BASH_EXE (
    for %%P in (C D E F G H I) do (
        if not defined BASH_EXE if exist "%%P:\Program Files\Git\bin\bash.exe" set "BASH_EXE=%%P:\Program Files\Git\bin\bash.exe"
        if not defined BASH_EXE if exist "%%P:\Program Files (x86)\Git\bin\bash.exe" set "BASH_EXE=%%P:\Program Files (x86)\Git\bin\bash.exe"
    )
)

if not defined BASH_EXE (
    echo [ERROR] bash not found. Install Git for Windows or add bash to PATH.
    exit /b 1
)

REM Convert Windows path to Unix path (D:\foo -> /d/foo, any drive)
set "DRIVE=%SCRIPT_DIR:~0,1%"
set "DRIVE_LOW="
for %%l in (a b c d e f g h i j) do if /i "%DRIVE%"=="%%l" set "DRIVE_LOW=%%l"
set "PATH_NO_DRIVE=%SCRIPT_DIR:~2%"
set "PATH_NO_DRIVE=%PATH_NO_DRIVE:\=/%"
set "UNIX_PATH=/%DRIVE_LOW%%PATH_NO_DRIVE%"

"%BASH_EXE%" -c "cd '%UNIX_PATH%' && ./mgr %*"
endlocal
