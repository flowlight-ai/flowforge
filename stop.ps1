# ============================================================
# FlowForge 停止脚本 (Windows PowerShell)
# 用法: .\stop.ps1
# ============================================================

$ErrorActionPreference = "Continue"

function Write-Step  { param([string]$Msg) Write-Host "`n  >> $Msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Msg) Write-Host "  [OK] $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host "  [WARN] $Msg" -ForegroundColor Yellow }
function Write-Info  { param([string]$Msg) Write-Host "  $Msg" -ForegroundColor Gray }

function Stop-Port {
    param([int]$Port, [string]$ServiceName)

    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue

    if ($null -eq $connections) {
        Write-Info "$ServiceName (端口 $Port): 未运行"
        return
    }

    $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique

    foreach ($pid in $pids) {
        try {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) {
                $procName = $proc.ProcessName
                Write-Info "停止 $ServiceName (PID=$pid, 进程=$procName, 端口=$Port)..."
                Stop-Process -Id $pid -Force -ErrorAction Stop
                Write-Ok "$ServiceName 已停止 (PID=$pid)"
            }
        } catch {
            Write-Warn "无法停止进程 PID=$pid: $_"
        }
    }
}

Write-Step "停止 FlowForge 服务"

# 停止 FlowForge (端口 8000)
$flowforgePort = if ($env:FLOWFORGE_PORT) { $env:FLOWFORGE_PORT } else { 8000 }
Stop-Port -Port $flowforgePort -ServiceName "FlowForge"

# 停止 OpenRoute (端口 13000)
$openroutePort = if ($env:OPENROUTE_PORT) { $env:OPENROUTE_PORT } else { 13000 }
Stop-Port -Port $openroutePort -ServiceName "OpenRoute"

# 验证端口已释放
Start-Sleep -Seconds 2

Write-Step "验证服务已停止"

$allStopped = $true

foreach ($portInfo in @(
    @{ Port = $flowforgePort; Name = "FlowForge" }
    @{ Port = $openroutePort; Name = "OpenRoute" }
)) {
    $conn = Get-NetTCPConnection -LocalPort $portInfo.Port -State Listen -ErrorAction SilentlyContinue
    if ($null -eq $conn) {
        Write-Ok "$($portInfo.Name) (端口 $($portInfo.Port)): 已停止"
    } else {
        Write-Warn "$($portInfo.Name) (端口 $($portInfo.Port)): 仍在运行"
        $allStopped = $false
    }
}

Write-Host ""
if ($allStopped) {
    Write-Host "  所有服务已停止。" -ForegroundColor Green
} else {
    Write-Host "  部分服务可能仍在运行，请手动检查。" -ForegroundColor Yellow
}
Write-Host ""
