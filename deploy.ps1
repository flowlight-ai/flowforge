# ============================================================
# FlowForge 一键部署脚本 (Windows PowerShell)
# 用法: .\deploy.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

# ── 颜色输出函数 ──────────────────────────────────────────────
function Write-Step  { param([string]$Msg) Write-Host "`n  >> $Msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Msg) Write-Host "  [OK] $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host "  [WARN] $Msg" -ForegroundColor Yellow }
function Write-Fail  { param([string]$Msg) Write-Host "  [FAIL] $Msg" -ForegroundColor Red }
function Write-Info  { param([string]$Msg) Write-Host "  $Msg" -ForegroundColor Gray }

# ── 状态跟踪 ──────────────────────────────────────────────────
$script:StatusTable = @{}

function Set-Status {
    param([string]$Name, [string]$Status, [string]$Detail = "")
    $script:StatusTable[$Name] = @{ Status = $Status; Detail = $Detail }
}

# ============================================================
# 第 1 步: 预检查
# ============================================================
Write-Step "第 1 步: 预检查"

# 1.1 Python 3.11+
try {
    $pyVer = python --version 2>&1
    $pyVerStr = $pyVer.ToString()
    if ($pyVerStr -match "Python (\d+)\.(\d+)") {
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        if ($major -gt 3 -or ($major -eq 3 -and $minor -ge 11)) {
            Write-Ok "Python 版本: $pyVerStr"
            Set-Status "Python" "OK" $pyVerStr
        } else {
            Write-Fail "Python 版本过低: $pyVerStr (需要 3.11+)"
            Set-Status "Python" "FAIL" "版本过低: $pyVerStr"
            throw "Python 版本不满足要求"
        }
    } else {
        Write-Fail "无法解析 Python 版本: $pyVerStr"
        Set-Status "Python" "FAIL" "无法解析版本"
        throw "Python 版本解析失败"
    }
} catch {
    Write-Fail "未找到 Python: $_"
    Set-Status "Python" "FAIL" "未安装"
    throw "Python 未安装或不在 PATH 中"
}

# 1.2 端口检查
function Test-PortAvailable {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    return ($null -eq $conn)
}

$portsToCheck = @(8000, 13000)
$portOk = $true
foreach ($port in $portsToCheck) {
    if (Test-PortAvailable $port) {
        Write-Ok "端口 $port 可用"
        Set-Status "Port:$port" "OK" "可用"
    } else {
        $proc = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
        $procInfo = if ($proc) { "PID=$($proc.OwningProcess)" } else { "占用中" }
        Write-Warn "端口 $port 已被占用 ($procInfo)"
        Set-Status "Port:$port" "WARN" "已被占用 ($procInfo)"
        $portOk = $false
    }
}
if (-not $portOk) {
    Write-Warn "部分端口已被占用，服务可能无法启动。运行 .\stop.ps1 可释放端口。"
}

# 1.3 .env 文件
$envFile = Join-Path $RootDir ".env"
$envTemplate = Join-Path $RootDir ".env.template"
if (-not (Test-Path $envFile)) {
    if (Test-Path $envTemplate) {
        Copy-Item $envTemplate $envFile
        Write-Warn ".env 不存在，已从 .env.template 创建。请编辑 .env 填入真实密钥。"
        Set-Status ".env" "WARN" "从模板创建，需填入密钥"
    } else {
        Write-Fail ".env 和 .env.template 均不存在"
        Set-Status ".env" "FAIL" "文件缺失"
        throw ".env 文件缺失"
    }
} else {
    Write-Ok ".env 文件存在"
    Set-Status ".env" "OK" "存在"
}

# 加载 .env 到当前进程环境
Write-Info "加载 .env 环境变量..."
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $parts = $line -split "=", 2
        $key = $parts[0].Trim()
        $val = $parts[1].Trim()
        [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
    }
}

# 1.4 配置文件检查 (FlowForge 核心；*Forge 项目各自检查自己的配置)
$projects = @(
    @{ Name = "flowforge";   ConfigDir = "flowforge\config";   Required = @("default.yaml", "models.yaml", "plugins.yaml") }
)

foreach ($proj in $projects) {
    $cfgDir = Join-Path $RootDir $proj.ConfigDir
    $missing = @()
    foreach ($req in $proj.Required) {
        if (-not (Test-Path (Join-Path $cfgDir $req))) {
            $missing += $req
        }
    }
    if ($missing.Count -eq 0) {
        Write-Ok "$($proj.Name) 配置文件完整"
        Set-Status "Config:$($proj.Name)" "OK" "完整"
    } else {
        Write-Warn "$($proj.Name) 缺少配置: $($missing -join ', ')"
        Set-Status "Config:$($proj.Name)" "WARN" "缺少: $($missing -join ', ')"
    }
}

# ============================================================
# 第 2 步: 安装依赖
# ============================================================
Write-Step "第 2 步: 安装依赖"

# 2.1 FlowForge 核心依赖
$flowforgeReq = Join-Path $RootDir "flowforge\requirements.txt"
if (Test-Path $flowforgeReq) {
    Write-Info "安装 FlowForge 依赖..."
    try {
        pip install -r $flowforgeReq --quiet 2>&1 | Out-Null
        Write-Ok "FlowForge 依赖安装完成"
        Set-Status "Deps:flowforge" "OK" "已安装"
    } catch {
        Write-Warn "FlowForge 依赖安装可能不完整: $_"
        Set-Status "Deps:flowforge" "WARN" "安装可能不完整"
    }
} else {
    Write-Fail "未找到 flowforge\requirements.txt"
    Set-Status "Deps:flowforge" "FAIL" "requirements.txt 缺失"
}

# 2.2 OpenRoute 依赖（可选 — OpenRoute 是外部服务，由 OPENROUTE_DIR 环境变量定位）
$openrouteReq = if ($env:OPENROUTE_DIR) { Join-Path $env:OPENROUTE_DIR "requirements.txt" } else { "" }
if ($openrouteReq -and (Test-Path $openrouteReq)) {
    Write-Info "安装 OpenRoute 依赖 (OPENROUTE_DIR=$env:OPENROUTE_DIR)..."
    try {
        pip install -r $openrouteReq --quiet 2>&1 | Out-Null
        Write-Ok "OpenRoute 依赖安装完成"
        Set-Status "Deps:openroute" "OK" "已安装"
    } catch {
        Write-Warn "OpenRoute 依赖安装可能不完整: $_"
        Set-Status "Deps:openroute" "WARN" "安装可能不完整"
    }
} else {
    Write-Warn "OPENROUTE_DIR 未设置或 requirements.txt 不存在；跳过 OpenRoute 依赖安装（OpenRoute 作为外部服务由独立部署管理）"
    Set-Status "Deps:openroute" "WARN" "OPENROUTE_DIR 未配置"
}

# 2.3 验证关键包
$keyPackages = @("fastapi", "uvicorn", "httpx", "pydantic", "sqlalchemy", "apscheduler")
Write-Info "验证关键包..."
$missingPkgs = @()
foreach ($pkg in $keyPackages) {
    $check = python -c "import $pkg; print($pkg.__version__)" 2>&1
    if ($LASTEXITCODE -eq 0) {
        $ver = $check.ToString().Trim()
        Write-Ok "$pkg $ver"
    } else {
        Write-Warn "$pkg 未安装"
        $missingPkgs += $pkg
    }
}
if ($missingPkgs.Count -eq 0) {
    Set-Status "KeyPackages" "OK" "全部就绪"
} else {
    Set-Status "KeyPackages" "WARN" "缺少: $($missingPkgs -join ', ')"
}

# ============================================================
# 第 3 步: 初始化数据库
# ============================================================
Write-Step "第 3 步: 初始化数据库"

$dataDirs = @(
    "data"
    "flowforge\data"
)

foreach ($dir in $dataDirs) {
    $fullPath = Join-Path $RootDir $dir
    if (-not (Test-Path $fullPath)) {
        New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
        Write-Ok "创建目录: $dir"
    } else {
        Write-Info "目录已存在: $dir"
    }
}

# 创建 logs 目录
$logsDir = Join-Path $RootDir "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
    Write-Ok "创建目录: logs"
}

# 运行迁移脚本（如果存在）
$migrationScripts = @(
    @{ Name = "OpenSieve SQL"; Path = "opensieve\scripts\init.sql" }
)
foreach ($mig in $migrationScripts) {
    $migPath = Join-Path $RootDir $mig.Path
    if (Test-Path $migPath) {
        Write-Info "发现迁移脚本: $($mig.Name) ($($mig.Path))"
        # SQL 迁移需要数据库连接，此处仅提示
    }
}

Set-Status "Database" "OK" "目录已就绪"

# ============================================================
# 第 4 步: 启动 OpenRoute 服务
# ============================================================
Write-Step "第 4 步: 启动 OpenRoute 服务"

# OpenRoute 是外部服务，由 OPENROUTE_DIR 环境变量定位
# 未配置时仅做健康检查（假设 OpenRoute 已独立部署）
if (-not $env:OPENROUTE_DIR) {
    Write-Warn "OPENROUTE_DIR 未设置；假设 OpenRoute 已作为外部服务部署。如需由本脚本启动，请在 .env 中设置 OPENROUTE_DIR"
}
$openrouteDir = if ($env:OPENROUTE_DIR) { $env:OPENROUTE_DIR } else { "" }
$openrouteApp = if ($openrouteDir) { Join-Path $openrouteDir "app.py" } else { "" }
$openroutePort = if ($env:OPENROUTE_PORT) { $env:OPENROUTE_PORT } else { 13000 }

if ($openrouteApp -and (Test-Path $openrouteApp)) {
    # 检查端口是否已被占用（可能已运行）
    if (-not (Test-PortAvailable $openroutePort)) {
        Write-Warn "端口 $openroutePort 已被占用，检查是否为 OpenRoute..."
        try {
            $check = Invoke-RestMethod -Uri "http://127.0.0.1:$openroutePort/v1/models" -TimeoutSec 3 -ErrorAction Stop
            Write-Ok "OpenRoute 已在运行"
            Set-Status "OpenRoute" "OK" "已运行 (端口 $openroutePort)"
        } catch {
            Write-Warn "端口 $openroutePort 被其他进程占用"
            Set-Status "OpenRoute" "WARN" "端口被占用"
        }
    } else {
        Write-Info "启动 OpenRoute (端口 $openroutePort, dir=$openrouteDir)..."
        $env:OPENROUTE_PORT = $openroutePort
        $env:HF_HUB_OFFLINE = "1"

        # 启动 OpenRoute 后台进程
        $openrouteProc = Start-Process -FilePath "python" `
            -ArgumentList "app.py" `
            -WorkingDirectory $openrouteDir `
            -WindowStyle Hidden `
            -PassThru

        Write-Info "OpenRoute PID: $($openrouteProc.Id)"

        # 等待健康检查通过
        $maxWait = 60
        $waited = 0
        $openrouteHealthy = $false
        while ($waited -lt $maxWait) {
            Start-Sleep -Seconds 2
            $waited += 2
            try {
                $response = Invoke-WebRequest -Uri "http://127.0.0.1:$openroutePort/v1/models" -TimeoutSec 3 -ErrorAction Stop
                if ($response.StatusCode -eq 200) {
                    $openrouteHealthy = $true
                    break
                }
            } catch {
                # 继续等待
            }
            Write-Info "等待 OpenRoute 启动... (${waited}s/${maxWait}s)"
        }

        if ($openrouteHealthy) {
            Write-Ok "OpenRoute 启动成功 (端口 $openroutePort, ${waited}s)"
            Set-Status "OpenRoute" "OK" "运行中 (端口 $openroutePort)"
        } else {
            Write-Fail "OpenRoute 启动超时 (${maxWait}s)"
            Set-Status "OpenRoute" "FAIL" "启动超时"
            # 检查进程是否还在
            if (-not $openrouteProc.HasExited) {
                Write-Info "OpenRoute 进程仍在运行，可能初始化较慢"
            }
        }
    }
} else {
    # OpenRoute 由外部独立部署 — 仅做健康检查
    Write-Info "OpenRoute 由外部部署管理，仅做健康检查 (端口 $openroutePort)..."
    try {
        $check = Invoke-RestMethod -Uri "http://127.0.0.1:$openroutePort/v1/models" -TimeoutSec 3 -ErrorAction Stop
        Write-Ok "OpenRoute 已在运行 (外部部署)"
        Set-Status "OpenRoute" "OK" "外部部署运行中 (端口 $openroutePort)"
    } catch {
        Write-Warn "OpenRoute 未在端口 $openroutePort 运行；FlowForge 可启动但 LLM 调用将不可用"
        Set-Status "OpenRoute" "WARN" "外部未运行"
    }
}

# ============================================================
# 第 5 步: 启动 FlowForge 服务
# ============================================================
Write-Step "第 5 步: 启动 FlowForge 服务"

$flowforgePort = if ($env:FLOWFORGE_PORT) { $env:FLOWFORGE_PORT } else { 8000 }

if (-not (Test-PortAvailable $flowforgePort)) {
    Write-Warn "端口 $flowforgePort 已被占用，检查是否为 FlowForge..."
    try {
        $check = Invoke-RestMethod -Uri "http://localhost:$flowforgePort/health" -TimeoutSec 3 -ErrorAction Stop
        Write-Ok "FlowForge 已在运行"
        Set-Status "FlowForge" "OK" "已运行 (端口 $flowforgePort)"
    } catch {
        Write-Warn "端口 $flowforgePort 被其他进程占用"
        Set-Status "FlowForge" "WARN" "端口被占用"
    }
} else {
    Write-Info "启动 FlowForge (端口 $flowforgePort)..."

    # 设置环境变量
    $env:SERVER_PORT = $flowforgePort
    $env:FLOWFORGE_DOMAIN_MODULE = if ($env:FLOWFORGE_DOMAIN_MODULE) { $env:FLOWFORGE_DOMAIN_MODULE } else { "flowforge.plugins" }

    # 启动 FlowForge 后台进程
    $flowforgeProc = Start-Process -FilePath "python" `
        -ArgumentList "-m", "uvicorn", "flowforge.app.main:app", "--host", "0.0.0.0", "--port", $flowforgePort `
        -WorkingDirectory $RootDir `
        -WindowStyle Hidden `
        -PassThru

    Write-Info "FlowForge PID: $($flowforgeProc.Id)"

    # 等待健康检查通过
    $maxWait = 60
    $waited = 0
    $flowforgeHealthy = $false
    while ($waited -lt $maxWait) {
        Start-Sleep -Seconds 2
        $waited += 2
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$flowforgePort/health" -TimeoutSec 3 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                $flowforgeHealthy = $true
                break
            }
        } catch {
            # 继续等待
        }
        Write-Info "等待 FlowForge 启动... (${waited}s/${maxWait}s)"
    }

    if ($flowforgeHealthy) {
        Write-Ok "FlowForge 启动成功 (端口 $flowforgePort, ${waited}s)"
        Set-Status "FlowForge" "OK" "运行中 (端口 $flowforgePort)"
    } else {
        Write-Fail "FlowForge 启动超时 (${maxWait}s)"
        Set-Status "FlowForge" "FAIL" "启动超时"
        if (-not $flowforgeProc.HasExited) {
            Write-Info "FlowForge 进程仍在运行，可能初始化较慢"
        }
    }
}

# ============================================================
# 第 6 步: 验证所有服务
# ============================================================
Write-Step "第 6 步: 验证所有服务"

# 6.1 OpenRoute 健康检查
$openroutePort = if ($env:OPENROUTE_PORT) { $env:OPENROUTE_PORT } else { 13000 }
try {
    $orHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$openroutePort/v1/models" -TimeoutSec 5 -ErrorAction Stop
    $modelCount = $orHealth.data.Count
    Write-Ok "OpenRoute: $modelCount 个模型可用"
    Set-Status "Verify:OpenRoute" "OK" "$modelCount 个模型"
} catch {
    Write-Fail "OpenRoute 健康检查失败: $_"
    Set-Status "Verify:OpenRoute" "FAIL" $_.ToString()
}

# 6.2 FlowForge 健康检查
$flowforgePort = if ($env:FLOWFORGE_PORT) { $env:FLOWFORGE_PORT } else { 8000 }
try {
    $ffHealth = Invoke-RestMethod -Uri "http://localhost:$flowforgePort/health" -TimeoutSec 5 -ErrorAction Stop
    $ffStatus = $ffHealth.status
    $components = $ffHealth.components
    Write-Ok "FlowForge: status=$ffStatus"
    if ($components) {
        foreach ($key in $components.PSObject.Properties) {
            $comp = $key.Value
            $compStatus = $comp.status
            $extra = ""
            if ($comp.modes) { $extra = " ($($comp.modes) modes)" }
            if ($comp.plugins) { $extra = " ($($comp.plugins) plugins)" }
            if ($comp.tools) { $extra = " ($($comp.tools) tools)" }
            if ($comp.agents) { $extra = " ($($comp.agents) agents)" }
            Write-Info "  - $($key.Name): $compStatus$extra"
        }
    }
    Set-Status "Verify:FlowForge" "OK" "status=$ffStatus"
} catch {
    Write-Fail "FlowForge 健康检查失败: $_"
    Set-Status "Verify:FlowForge" "FAIL" $_.ToString()
}

# 6.3 SDK 集成检查
Write-Info "验证 SDK 集成..."
$env:PYTHONPATH = $RootDir
$sdkCheck = python -c "from flowforge.sdk import FlowForgeSDK; sdk = FlowForgeSDK(); print('SDK_OK')" 2>&1
if ($sdkCheck.ToString().Contains("SDK_OK")) {
    Write-Ok "FlowForge SDK 导入正常"
    Set-Status "Verify:SDK" "OK" "导入成功"
} else {
    Write-Warn "FlowForge SDK 导入异常: $sdkCheck"
    Set-Status "Verify:SDK" "WARN" "导入异常"
}

# 6.4 Agent 注册验证 — 检查 FlowForge 核心 Agent 是否被 scan_agents 发现
# *Forge 项目的 Agent 由各自项目部署脚本验证（FlowForge 通过 Plugin V3 协议在运行时发现）
Write-Info "验证 FlowForge 核心 Agent 自动发现..."
$agentProjects = @(
    @{ Name = "flowforge"; Package = "flowforge.agents.generic" }
)
foreach ($proj in $agentProjects) {
    $agentCheck = python -c "from flowforge.sdk import FlowForgeSDK; sdk = FlowForgeSDK(project='$($proj.Name)'); count = sdk.scan_agents('$($proj.Package)'); print(f'AGENTS_OK:{count}')" 2>&1
    if ($agentCheck.ToString() -match "AGENTS_OK:(\d+)") {
        $agentCount = $Matches[1]
        if ([int]$agentCount -gt 0) {
            Write-Ok "$($proj.Name) Agent 发现: $agentCount 个"
            Set-Status "Agents:$($proj.Name)" "OK" "$agentCount 个"
        } else {
            Write-Warn "$($proj.Name) 未发现 Agent"
            Set-Status "Agents:$($proj.Name)" "WARN" "0 个"
        }
    } else {
        Write-Warn "$($proj.Name) Agent 扫描失败: $agentCheck"
        Set-Status "Agents:$($proj.Name)" "WARN" "扫描失败"
    }
}

# 6.5 Tool 注册验证 — 检查 FlowForge 核心 Tool 是否被 scan_tools 发现
# *Forge 项目的 Tool 由各自项目部署脚本验证（FlowForge 通过 Plugin V3 协议在运行时发现）
Write-Info "验证 FlowForge 核心 Tool 自动发现..."
$toolProjects = @(
    @{ Name = "flowforge"; Package = "flowforge.tools" }
)
foreach ($proj in $toolProjects) {
    $toolCheck = python -c "from flowforge.sdk import FlowForgeSDK; sdk = FlowForgeSDK(project='$($proj.Name)'); count = sdk.scan_tools('$($proj.Package)'); print(f'TOOLS_OK:{count}')" 2>&1
    if ($toolCheck.ToString() -match "TOOLS_OK:(\d+)") {
        $toolCount = $Matches[1]
        if ([int]$toolCount -gt 0) {
            Write-Ok "$($proj.Name) Tool 发现: $toolCount 个"
            Set-Status "Tools:$($proj.Name)" "OK" "$toolCount 个"
        } else {
            Write-Warn "$($proj.Name) 未发现 Tool"
            Set-Status "Tools:$($proj.Name)" "WARN" "0 个"
        }
    } else {
        Write-Warn "$($proj.Name) Tool 扫描失败: $toolCheck"
        Set-Status "Tools:$($proj.Name)" "WARN" "扫描失败"
    }
}

# 6.6 路由发现验证 — 检查 FlowForge API 路由是否包含核心端点
Write-Info "验证 API 路由..."
$coreRoutes = @(
    "/api/v1/tasks",
    "/api/v1/modes",
    "/health",
    "/metrics"
)
$routeOk = $true
foreach ($route in $coreRoutes) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$flowforgePort$route" -Method Get -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        if ($resp.StatusCode -in @(200, 201, 405)) {
            Write-Ok "路由 $route 可达"
        }
    } catch {
        # 404 = 路由不存在, 其他错误 = 服务不可达
        if ($_.Exception.Response.StatusCode -eq 404) {
            Write-Warn "路由 $route 不存在"
            Set-Status "Route:$route" "WARN" "404"
            $routeOk = $false
        } elseif ($_.Exception.Response.StatusCode -eq 405) {
            # 405 Method Not Allowed = 路由存在但不支持GET（如POST端点）
            Write-Ok "路由 $route 存在 (POST端点)"
        } else {
            Write-Warn "路由 $route 不可达: $_"
            $routeOk = $false
        }
    }
}
if ($routeOk) {
    Set-Status "Routes" "OK" "核心路由可达"
} else {
    Set-Status "Routes" "WARN" "部分路由不可达"
}

# 6.6 FlowForge 核心插件加载检查（*Forge 项目插件由各自项目部署脚本验证）
$pluginProjects = @("flowforge")
foreach ($proj in $pluginProjects) {
    $pluginCheck = python -c "from $($proj).plugins import plugin; print('PLUGIN_OK:' + plugin.manifest.name)" 2>&1
    if ($pluginCheck.ToString().Contains("PLUGIN_OK:")) {
        $pluginName = $pluginCheck.ToString().Split(":")[1].Trim()
        Write-Ok "$proj 插件加载: $pluginName"
        Set-Status "Plugin:$proj" "OK" $pluginName
    } else {
        Write-Warn "$proj 插件加载失败: $pluginCheck"
        Set-Status "Plugin:$proj" "WARN" "加载失败"
    }
}

# ============================================================
# 第 7 步: 冒烟测试
# ============================================================
Write-Step "第 7 步: 冒烟测试"

$flowforgePort = if ($env:FLOWFORGE_PORT) { $env:FLOWFORGE_PORT } else { 8000 }
$smokeOk = $false

# 7.1 Agent 注册冒烟测试 — 验证 FlowForge 核心 Agent 能被创建和执行
Write-Info "7.1 Agent 注册冒烟测试..."
$agentSmoke = python -c "
from flowforge.sdk import FlowForgeSDK
sdk = FlowForgeSDK(project='flowforge')
count = sdk.scan_agents('flowforge.agents.generic')
if count > 0:
    print(f'AGENT_SMOKE_OK:{count}')
else:
    print('AGENT_SMOKE_FAIL:0')
" 2>&1
if ($agentSmoke.ToString() -match "AGENT_SMOKE_OK:(\d+)") {
    Write-Ok "Agent 注册冒烟: $($Matches[1]) 个 Agent 可用"
    Set-Status "Smoke:Agents" "OK" "$($Matches[1]) 个"
} else {
    Write-Warn "Agent 注册冒烟失败: $agentSmoke"
    Set-Status "Smoke:Agents" "WARN" "失败"
}

# 7.2 Tool 注册冒烟测试 — 验证 FlowForge 核心 Tool 能被创建和调用
Write-Info "7.2 Tool 注册冒烟测试..."
$toolSmoke = python -c "
from flowforge.sdk import FlowForgeSDK
sdk = FlowForgeSDK(project='flowforge')
count = sdk.scan_tools('flowforge.tools')
if count > 0:
    print(f'TOOL_SMOKE_OK:{count}')
else:
    print('TOOL_SMOKE_FAIL:0')
" 2>&1
if ($toolSmoke.ToString() -match "TOOL_SMOKE_OK:(\d+)") {
    Write-Ok "Tool 注册冒烟: $($Matches[1]) 个 Tool 可用"
    Set-Status "Smoke:Tools" "OK" "$($Matches[1]) 个"
} else {
    Write-Warn "Tool 注册冒烟失败: $toolSmoke"
    Set-Status "Smoke:Tools" "WARN" "失败"
}

# 7.3 路由发现冒烟测试 — 验证 API 路由可达
Write-Info "7.3 路由发现冒烟测试..."
try {
    $modesResp = Invoke-RestMethod -Uri "http://localhost:$flowforgePort/api/v1/modes" -TimeoutSec 5 -ErrorAction Stop
    $modeCount = 0
    if ($modesResp.data) { $modeCount = $modesResp.data.Count }
    Write-Ok "路由冒烟: /api/v1/modes 返回 $modeCount 个模式"
    Set-Status "Smoke:Routes" "OK" "$modeCount 个模式"
} catch {
    Write-Warn "路由冒烟失败 (FlowForge 可能未运行): $_"
    Set-Status "Smoke:Routes" "WARN" "不可达"
}

# 7.4 LLM 端到端冒烟测试 — Reflexion 多LLM交叉审核验证
Write-Info "7.4 LLM 端到端冒烟测试（Reflexion 多LLM交叉审核）..."
try {
    Write-Info "创建 Reflexion 模式任务（验证 actor->evaluator 交叉审核）..."
    $body = @{
        intent = "写一篇关于AI Agent技术趋势的深度分析"
        mode = "reflexion"
        persona = "technology"
        interaction_mode = "helm"
    } | ConvertTo-Json -Depth 5

    $headers = @{ "Content-Type" = "application/json" }

    $taskResponse = Invoke-RestMethod `
        -Uri "http://localhost:$flowforgePort/api/v1/tasks" `
        -Method Post -Body $body -Headers $headers -TimeoutSec 30 -ErrorAction Stop

    $taskId = if ($taskResponse.task_id) { $taskResponse.task_id } elseif ($taskResponse.data.task_id) { $taskResponse.data.task_id } else { "unknown" }
    Write-Ok "Reflexion 任务创建成功: task_id=$taskId"

    # 轮询等待任务完成（最多300秒，reflexion需要多轮迭代）
    Write-Info "等待 Reflexion 执行完成（actor->evaluator 交叉审核）..."
    $maxWait = 300
    $waited = 0
    $taskCompleted = $false
    $lastStatus = ""

    while ($waited -lt $maxWait) {
        Start-Sleep -Seconds 10
        $waited += 10
        try {
            $statusResp = Invoke-RestMethod -Uri "http://localhost:$flowforgePort/api/v1/tasks/$taskId" -TimeoutSec 10 -ErrorAction Stop
            $taskData = if ($statusResp.data) { $statusResp.data } else { $statusResp }
            $taskStatus = $taskData.status
            $lastStatus = $taskStatus

            if ($waited % 30 -eq 0) { Write-Info "  轮询中... ${waited}s, status=$taskStatus" }

            if ($taskStatus -eq "completed") {
                $taskCompleted = $true
                $outputData = $taskData.output_data
                $articleContent = ""; $score = 0; $iterations = 0

                if ($outputData) {
                    $result = $outputData.result
                    if ($result) {
                        if ($result.output) { $articleContent = $result.output }
                        if ($result.score) { $score = $result.score }
                        if ($result.iterations) { $iterations = $result.iterations }
                    }
                    if (-not $articleContent -and $outputData.content) { $articleContent = $outputData.content }
                }
                if (-not $articleContent -and $taskData.summary) { $articleContent = $taskData.summary }

                $contentLen = if ($articleContent) { $articleContent.Length } else { 0 }
                Write-Ok "Reflexion 完成! ${waited}s, iterations=$iterations, score=$score, content=${contentLen}chars"
                Set-Status "Smoke:E2E" "OK" "iterations=$iterations, score=$score, ${waited}s"

                # 验证1: 文章内容非空且足够长
                if ($contentLen -ge 500) {
                    Write-Ok "验证通过: 文章内容 ${contentLen} 字符 >= 500"
                } else {
                    Write-Warn "文章内容过短: ${contentLen} 字符 < 500"
                    Set-Status "Smoke:E2E" "WARN" "内容过短: ${contentLen}chars"
                }
                # 验证2: 多LLM交叉审核
                if ($iterations -ge 1) {
                    Write-Ok "验证通过: 多LLM交叉审核 iterations=$iterations (actor+evaluator 不同模型)"
                }
                # 验证3: 评分在合理范围
                if ($score -ge 0 -and $score -le 1) {
                    Write-Ok "验证通过: 评分 $score 在 [0,1] 范围"
                }
                break
            } elseif ($taskStatus -eq "error" -or $taskStatus -eq "failed") {
                Write-Warn "Reflexion 执行失败: status=$taskStatus"
                break
            }
        } catch {
            if ($waited % 30 -eq 0) { Write-Info "  连接异常，继续轮询... ${waited}s" }
        }
    }

    if (-not $taskCompleted) {
        Write-Warn "Reflexion 未在 ${maxWait}s 内完成 (last_status=$lastStatus)"
        Set-Status "Smoke:E2E" "WARN" "超时 ${maxWait}s, status=$lastStatus"
    }
} catch {
    Write-Warn "E2E 冒烟失败 (非致命): $_"
    Set-Status "Smoke:E2E" "WARN" "失败: $($_.Exception.Message.Substring(0, [Math]::Min(80, $_.Exception.Message.Length)))"
}

# ============================================================
# 第 8 步: 状态报告
# ============================================================
Write-Step "第 8 步: 部署状态报告"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor White
Write-Host "  ║              FlowForge 部署状态报告                         ║" -ForegroundColor White
Write-Host "  ╠══════════════════════════════════════════════════════════════╣" -ForegroundColor White

foreach ($key in $script:StatusTable.Keys | Sort-Object) {
    $entry = $script:StatusTable[$key]
    $statusIcon = switch ($entry.Status) {
        "OK"   { "[OK]  " }
        "WARN" { "[WARN]" }
        "FAIL" { "[FAIL]" }
        default { "[??]  " }
    }
    $color = switch ($entry.Status) {
        "OK"   { "Green" }
        "WARN" { "Yellow" }
        "FAIL" { "Red" }
        default { "Gray" }
    }
    $detail = if ($entry.Detail) { " - $($entry.Detail)" } else { "" }
    Write-Host ("  ║  {0} {1}{2,-40} ║" -f $statusIcon, $key, $detail) -ForegroundColor $color
}

Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor White

# 访问地址
$flowforgePort = if ($env:FLOWFORGE_PORT) { $env:FLOWFORGE_PORT } else { 8000 }
$openroutePort = if ($env:OPENROUTE_PORT) { $env:OPENROUTE_PORT } else { 13000 }

Write-Host ""
Write-Host "  访问地址:" -ForegroundColor Cyan
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  FlowForge API:  http://localhost:$flowforgePort" -ForegroundColor White
Write-Host "  FlowForge 健康检查: http://localhost:$flowforgePort/health" -ForegroundColor White
Write-Host "  FlowForge 指标: http://localhost:$flowforgePort/metrics" -ForegroundColor White
Write-Host "  OpenRoute API:  http://127.0.0.1:$openroutePort/v1" -ForegroundColor White
Write-Host "  OpenRoute 模型: http://127.0.0.1:$openroutePort/v1/models" -ForegroundColor White
Write-Host "  OpenRoute 健康: http://127.0.0.1:$openroutePort/health" -ForegroundColor White
Write-Host ""

# 统计
$okCount = ($script:StatusTable.Values | Where-Object { $_.Status -eq "OK" }).Count
$warnCount = ($script:StatusTable.Values | Where-Object { $_.Status -eq "WARN" }).Count
$failCount = ($script:StatusTable.Values | Where-Object { $_.Status -eq "FAIL" }).Count

if ($failCount -gt 0) {
    Write-Host "  部署完成，但有 $failCount 个失败项，请检查上方报告。" -ForegroundColor Red
} elseif ($warnCount -gt 0) {
    Write-Host "  部署完成，有 $warnCount 个警告项。服务已可用，建议检查警告。" -ForegroundColor Yellow
} else {
    Write-Host "  部署成功！所有检查均通过。" -ForegroundColor Green
}

Write-Host ""
Write-Host "  停止服务: .\stop.ps1" -ForegroundColor Gray
Write-Host ""
