# FlowForge Council 部署操作手册

> 本手册指导如何在全新服务器上从零部署 FlowForge Council（Forgekin 协作议事台）。
> 适用版本：flowlight-ai/flowforge v0.2.0+

---

## 目录

1. [系统要求](#1-系统要求)
2. [环境准备](#2-环境准备)
3. [获取代码](#3-获取代码)
4. [配置文件说明](#4-配置文件说明)
5. [方式一：本地直接运行](#5-方式一本地直接运行)
6. [方式二：Docker 容器部署](#6-方式二docker-容器部署)
7. [OpenRoute 网关部署](#7-openroute-网关部署)
8. [启动验证](#8-启动验证)
9. [T7/T8 铁律验证](#9-t7t8-铁律验证)
10. [常见问题排查](#10-常见问题排查)
11. [运维与升级](#11-运维与升级)

---

## 1. 系统要求

### 最低配置

| 项目 | 要求 |
|------|------|
| OS | Linux (Ubuntu 22.04+/CentOS 8+) 或 Windows 11 或 macOS 13+ |
| CPU | 2 核 |
| 内存 | 4 GB |
| 磁盘 | 10 GB 可用空间 |
| Python | 3.11+ |
| 网络 | 可访问 OpenRoute 网关（同机或跨机） |

### 推荐配置

| 项目 | 要求 |
|------|------|
| CPU | 4 核+ |
| 内存 | 8 GB+ |
| 磁盘 | 20 GB+ SSD |
| Python | 3.11.x 或 3.12.x |

### 端口规划

| 服务 | 默认端口 | 用途 |
|------|----------|------|
| FlowForge Web | 8765 | Web 界面 + REST API + WebSocket |
| OpenRoute 网关 | 13001 | LLM 多模型路由（**必须先启动**） |

> 生产环境建议通过 Nginx/Caddy 反向代理 8765 端口并配置 TLS。

---

## 2. 环境准备

### 2.1 Linux (Ubuntu/Debian)

```bash
# 安装 Python 3.11
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3.11-dev git

# 验证版本
python3.11 --version  # 应输出 Python 3.11.x
```

### 2.2 Windows 11

```powershell
# 方式一：从 python.org 下载安装（勾选 Add to PATH）
# 方式二：使用 winget
winget install Python.Python.3.11

# 验证
python --version  # 应输出 Python 3.11.x
```

### 2.3 macOS

```bash
# 使用 Homebrew
brew install python@3.11 git

# 验证
python3.11 --version
```

### 2.4 Docker（可选，用于容器化部署）

```bash
# Linux
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER  # 注销重新登录后生效

# 验证
docker --version
docker compose version
```

---

## 3. 获取代码

```bash
# 克隆仓库（替换为实际仓库地址）
git clone <repo-url> flowlight-ai
cd flowlight-ai/flowforge

# 或从现有部署拷贝
# scp -r user@old-server:/path/to/flowlight-ai ./
```

项目目录结构：

```
flowlight-ai/flowforge/
├── flowforge/              # Python 包（核心代码）
│   ├── core/               # 共享内核
│   ├── evolution/          # 自进化引擎
│   ├── forgemind/          # Forgekin 应用层
│   ├── llm/                # LLM 客户端
│   ├── loop/               # Loop 执行器
│   └── web/                # Web 应用（app.py + 前端）
│       ├── app.py          # FastAPI 主入口
│       ├── llm_bridge.py   # LLM 桥接层
│       └── static/         # 前端（HTML/CSS/JS）
├── config/                 # 配置文件（YAML）
│   ├── forgekins/          # 5 个 Forgekin 配置
│   ├── llm_route.yaml      # LLM 路由配置
│   ├── web_chat_prompts.yaml  # Web 聊天提示词
│   └── system.yaml         # 系统配置
├── tests/                  # 测试用例
├── docs/                   # 文档
├── Dockerfile              # Docker 构建文件
├── docker-compose.yml      # Docker Compose 编排
├── pyproject.toml          # Python 项目配置
└── .env.example            # 环境变量模板
```

---

## 4. 配置文件说明

### 4.1 环境变量（.env）

```bash
# 从模板复制
cp .env.example .env
```

编辑 `.env` 文件，填入实际值：

```bash
# ── 路径配置 ──
FLOWLIGHT_AI_ROOT="/opt/flowlight-ai"
FLOWFORGE_WORK_DIR="${FLOWLIGHT_AI_ROOT}/flowforge/.work"
FLOWFORGE_LOG_DIR="${FLOWFORGE_WORK_DIR}/logs"

# ── LLM 路由（关键配置）──
# OpenRoute 网关地址（必须与 OpenRoute 服务实际地址一致）
FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL="http://localhost:13001"
# OpenRoute API Key（从 OpenRoute 管理界面获取）
FLOWFORGE_LLM_ROUTE_OPENROUTE_API_KEY="or-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# ── 自进化参数 ──
FLOWFORGE_EVOLUTION_QUALITY_THRESHOLD="0.85"
FLOWFORGE_EVOLUTION_LLM_TIMEOUT_SECONDS="90"

# ── 调试 ──
FLOWFORGE_DEBUG="0"
FLOWFORGE_TRACE_LEVEL="INFO"
```

### 4.2 LLM 路由配置（config/llm_route.yaml）

此文件定义 LLM 的 provider 和 fallback chain。默认配置使用 OpenRoute 作为唯一 provider，所有模型通过 OpenRoute 路由。

关键配置项：

```yaml
providers:
  openroute:
    enabled: true
    base_url: "http://localhost:13001"  # OpenRoute 地址
    api_key: ""                          # 留空，通过环境变量注入
    kind: "openroute"

fallback_chains:
  content_create:       # 内容创作链
    - model: "DeepSeek-V4-Pro"
      provider: "openroute"
  t7_audit:             # T7 审核链（I9: 必须与 content_create 不同模型）
    - model: "Kimi-K2.6"
      provider: "openroute"
```

> **铁律 5**：禁止在 .py 文件中硬编码提示词/路径/密钥/端口。所有敏感配置必须通过环境变量或 YAML 注入。

### 4.3 Forgekin 配置（config/forgekins/）

5 个 Forgekin 各有独立 YAML 配置：

| 文件 | Forgekin | 角色 | 觉醒阶 |
|------|--------|------|--------|
| wenxin.yaml | 文心 (Wenxin) | 文档闭环 | E3 |
| sherlock.yaml | 夏洛克 (Sherlock) | 代码闭环 | E4 |
| vangogh.yaml | 梵高 (Vangogh) | 审查闭环 | E3 |
| davinci.yaml | 达芬奇 (DaVinci) | 测试闭环 | E3 |
| luban.yaml | 鲁班 (Luban) | 框架闭环 | E5 |

---

## 5. 方式一：本地直接运行

### 5.1 创建虚拟环境

```bash
cd flowlight-ai/flowforge

# Linux/macOS
python3.11 -m venv .venv
source .venv/bin/activate

# Windows
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 5.2 安装依赖

```bash
# 安装项目（含开发依赖）
pip install -e ".[dev]"

# 或仅安装运行时依赖
pip install -e .
```

### 5.3 加载环境变量

```bash
# Linux/macOS
export $(grep -v '^#' .env | xargs)

# Windows PowerShell
Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        Set-Item -Path "Env:$($Matches[1].Trim())" -Value $Matches[2].Trim().Trim('"')
    }
}
```

### 5.4 启动 FlowForge Web 服务

```bash
# 确保 OpenRoute 已启动（见第 7 节）

# 启动 Web 服务
python -m uvicorn flowforge.web.app:create_app --factory --host 0.0.0.0 --port 8765

# 或直接运行
python flowforge/web/app.py --host 0.0.0.0 --port 8765
```

启动成功标志：

```
[INFO] flowforge.web.llm_bridge: ForgekinLLMBridge ready: providers=['openroute'] quality_threshold=0.85
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8765
```

### 5.5 Windows PowerShell 一键启动

```powershell
# 设置环境变量
$env:FLOWFORGE_LLM_ROUTE_OPENROUTE_API_KEY="or-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# 启动
cd D:\path\to\flowlight-ai\flowforge
python -m uvicorn flowforge.web.app:create_app --factory --host 0.0.0.0 --port 8765
```

---

## 6. 方式二：Docker 容器部署

### 6.1 构建镜像

```bash
cd flowlight-ai/flowforge

# 构建
docker build -t flowforge-council:0.2.0 .

# 验证镜像
docker images flowforge-council
```

### 6.2 使用 Docker Compose

```bash
# 准备 .env 文件
cp .env.example .env
# 编辑 .env 填入实际配置

# 启动（后台运行）
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

### 6.3 使用 Docker 直接运行

```bash
docker run -d \
  --name flowforge-council \
  --restart unless-stopped \
  -p 8765:8765 \
  --env-file .env \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/docs:/app/docs \
  flowforge-council:0.2.0
```

### 6.4 跨机连接 OpenRoute

如果 OpenRoute 运行在其他服务器，修改 `.env`：

```bash
FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL="http://192.168.1.100:13001"
```

或使用 Docker 的 `--add-host`：

```bash
docker run -d \
  --add-host openroute-host:192.168.1.100 \
  -e FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL="http://openroute-host:13001" \
  ...
```

---

## 7. OpenRoute 网关部署

OpenRoute 是 LLM 多模型路由网关，FlowForge 的所有 LLM 调用都通过它路由。

### 7.1 获取 OpenRoute

```bash
# OpenRoute 代码位于 hiclaw/tool/openroute/ 目录
cd hiclaw/tool/openroute

# 安装依赖
pip install -r requirements.txt  # 或按其 pyproject.toml 安装
```

### 7.2 启动 OpenRoute

```bash
cd hiclaw/tool/openroute
python -m uvicorn app:app --host 0.0.0.0 --port 13001
```

启动成功标志：

```
INFO:app:网页版API透传调用器已初始化: 13个平台
INFO:app:ServiceContainer 初始化完成
INFO:     Uvicorn running on http://0.0.0.0:13001
```

### 7.3 获取 API Key

OpenRoute 启动后会生成 API Key，格式为 `or-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`。将其填入 FlowForge 的 `.env` 文件：

```bash
FLOWFORGE_LLM_ROUTE_OPENROUTE_API_KEY="or-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 7.4 验证 OpenRoute

```bash
# 健康检查
curl http://localhost:13001/v1/models

# 测试 LLM 调用
curl -X POST http://localhost:13001/v1/chat/completions \
  -H "Authorization: Bearer or-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"zhipu/glm-4-flash","messages":[{"role":"user","content":"hello"}]}'
```

---

## 8. 启动验证

### 8.1 健康检查

```bash
# 检查 Web 服务是否正常
curl http://localhost:8765/api/agents

# 预期返回 5 个 Forgekin
# {"agents": [{"id": "fk-wenxin", "name": "文心", ...}, ...]}
```

### 8.2 检查 LLM Bridge 状态

```bash
curl http://localhost:8765/api/bridge/status

# 预期返回
# {
#   "providers": ["openroute"],
#   "chains_available": ["content_create", "judge", "review", "t7_audit"],
#   "quality_threshold": 0.85,
#   "prompts_loaded": true
# }
```

### 8.3 浏览器访问

打开浏览器访问 `http://<服务器IP>:8765/`

应看到：
- 左侧 sidebar 显示 5 个 Forgekin 卡片（文心/夏洛克/梵高/达芬奇/鲁班）
- 中间聊天区域显示 Forgekin 问候语
- 底部输入框可输入消息
- 右侧面板可切换 状态/上下文/指标 标签

### 8.4 发送测试消息

```bash
# 发送消息
curl -X POST http://localhost:8765/api/chat \
  -H "Content-Type: application/json" \
  -d '{"content": "请分析Python的GIL对多线程的影响", "mentions": []}'

# 预期返回包含：
# - forgekin_responses 数组
# - 每个 response 包含 llm_meta（model/provider/latency_ms）
# - primary response 包含 t7_badge（score/verdict/reasons）
```

---

## 9. T7/T8 铁律验证

### 9.1 T7 审核（LLM 审核 LLM 产出）

```bash
# 触发 T7 审核（审核最近一条 primary 响应）
curl -X POST http://localhost:8765/api/verify/t7 \
  -H "Content-Type: application/json" \
  -d '{"count": 1}'

# 预期返回
# {
#   "score": 1.0,
#   "verdict": "pass",
#   "reasons": ["内容为 LLM 实时自然生成", ...],
#   "audit_llm": {"model": "openrouter/moonshotai/kimi-k2.6:free", ...}
# }
```

也可在 Web 界面操作：
1. 点击左侧活动栏「验证」图标（第3个图标）
2. 点击「运行 T7 审核」按钮
3. 等待 30-60 秒（LLM 审核需要时间）
4. 查看结果（应显示 PASS/FAIL + 分数 + 审核模型 + 审核理由）

### 9.2 T8 DOM 验证

```bash
# 获取 T8 检查清单
curl http://localhost:8765/api/verify/t8

# 预期返回包含 checklist 数组（8 项 DOM 检查）
```

在 Web 界面操作：
1. 在验证视图中点击「运行 T8 验证」按钮
2. 查看结果（应显示 8+/10 ALL PASS，包括 llm-meta 和 t7-badge 检查项）

### 9.3 验证标准

| 铁律 | 验证方法 | 通过标准 |
|------|----------|----------|
| T1 禁止 Mock LLM | 检查消息是否有 `llm_meta` | 每条 forgekin 响应有 `llm_meta.model` |
| T7 LLM 审核 LLM | 触发 T7 审核 | `t7_badge.score >= 0.85` 且 `verdict == "pass"` |
| T8 DOM 验证 | 运行 T8 检查 | 8+/10 项 PASS（含 llm-meta 和 t7-badge 检查） |

---

## 10. 常见问题排查

### 10.1 Web 服务无法启动

**症状**：`ModuleNotFoundError: No module named 'flowforge'`

**原因**：未安装项目依赖

**解决**：
```bash
cd flowlight-ai/flowforge
pip install -e ".[dev]"
```

### 10.2 LLM 调用失败

**症状**：聊天回复「⚠️ LLM 调用失败，所有 fallback 均已耗尽」

**排查步骤**：

1. 检查 OpenRoute 是否运行：
```bash
curl http://localhost:13001/v1/models
```

2. 检查 API Key 是否正确：
```bash
# 在 FlowForge 启动时设置环境变量
echo $FLOWFORGE_LLM_ROUTE_OPENROUTE_API_KEY
```

3. 检查 OpenRoute 日志是否有错误

4. 检查网络连通性：
```bash
# 从 FlowForge 服务器测试 OpenRoute
curl -X POST http://localhost:13001/v1/chat/completions \
  -H "Authorization: Bearer $FLOWFORGE_LLM_ROUTE_OPENROUTE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"zhipu/glm-4-flash","messages":[{"role":"user","content":"test"}]}'
```

### 10.3 WebSocket 连接断开

**症状**：浏览器控制台显示 `WebSocket closed`

**原因**：服务重启或网络中断

**解决**：前端会自动重连（最多 15 秒间隔）。如持续断开，检查 Web 服务是否正常运行。

### 10.4 T7 审核返回 FAIL

**症状**：T7 审核 `verdict=fail`

**可能原因**：
- LLM 返回了非 JSON 格式（审核 LLM 必须返回 JSON）
- 内容质量低于阈值（0.85）

**解决**：重新发送消息或调整 `config/web_chat_prompts.yaml` 中的 T7 审核提示词。

### 10.5 端口被占用

```bash
# 查找占用端口的进程
# Linux
sudo lsof -i :8765
# Windows
netstat -ano | findstr :8765

# 停止占用进程
# Linux
kill -9 <PID>
# Windows
Stop-Process -Id <PID> -Force

# 或更换端口
python -m uvicorn flowforge.web.app:create_app --factory --port 8766
```

### 10.6 Docker 容器健康检查失败

**症状**：`docker compose ps` 显示 unhealthy

**排查**：
```bash
# 查看容器日志
docker compose logs flowforge

# 进入容器调试
docker compose exec flowforge bash
curl http://localhost:8765/api/agents
```

### 10.7 浏览器缓存导致旧前端

**症状**：修改了前端代码但浏览器显示旧内容

**解决**：
- 强制刷新：`Ctrl+Shift+R`（Windows）/ `Cmd+Shift+R`（macOS）
- 或清除浏览器缓存
- index.html 已配置 `Cache-Control: no-cache` 头

---

## 11. 运维与升级

### 11.1 日志管理

```bash
# 日志位置
ls -la logs/

# 实时查看日志
tail -f logs/flowforge.log

# Docker 环境
docker compose logs -f flowforge
```

### 11.2 开启调试日志

```bash
# 设置环境变量
export FLOWFORGE_DEBUG=1
export FLOWFORGE_TRACE_LEVEL=DEBUG

# 重启服务后，日志将包含 LLM 输入/输出/耗时
```

### 11.3 升级流程

```bash
# 1. 备份配置
cp -r config/ config_backup_$(date +%Y%m%d)/
cp .env .env.backup

# 2. 拉取新代码
git pull origin main

# 3. 更新依赖
pip install -e ".[dev]" --upgrade

# 4. 检查配置变更
diff config_backup_$(date +%Y%m%d)/llm_route.yaml config/llm_route.yaml

# 5. 重启服务
# 本地：Ctrl+C 后重新启动
# Docker：docker compose up -d --build
```

### 11.4 备份策略

| 数据 | 位置 | 备份频率 |
|------|------|----------|
| 配置文件 | config/ | 每次变更后 |
| 环境变量 | .env | 每次变更后 |
| 日志 | logs/ | 每周 |
| 文档 | docs/ | 每次变更后 |

> 注意：当前版本 ChatState 为内存态，重启后消息历史会清空（仅保留 Forgekin 问候语）。如需持久化，需在后续版本中启用数据库存储。

### 11.5 性能调优

| 参数 | 配置位置 | 默认值 | 说明 |
|------|----------|--------|------|
| LLM 调用超时 | .env | 90s | `FLOWFORGE_EVOLUTION_LLM_TIMEOUT_SECONDS` |
| 最大重试次数 | llm_route.yaml | 3 | `max_retries` |
| 重试延迟 | llm_route.yaml | 1.0s | `retry_delay` |
| 质量阈值 | .env | 0.85 | `FLOWFORGE_EVOLUTION_QUALITY_THRESHOLD` |
| 消息上限 | app.py | 500 | ChatState 保留最近 500 条消息 |

### 11.6 安全建议

1. **不要将 .env 文件提交到 Git**（已在 .gitignore 中排除）
2. **生产环境使用反向代理**（Nginx/Caddy）配置 TLS
3. **限制 OpenRoute 端口访问**（仅允许 FlowForge 服务器访问 13001）
4. **定期轮换 API Key**
5. **开启防火墙**，仅暴露 8765 端口（或反向代理端口）

---

## 附录：快速启动检查清单

- [ ] Python 3.11+ 已安装
- [ ] OpenRoute 网关已启动（端口 13001）
- [ ] OpenRoute API Key 已获取
- [ ] `.env` 文件已配置（含 API Key）
- [ ] FlowForge 依赖已安装（`pip install -e .`）
- [ ] FlowForge Web 服务已启动（端口 8765）
- [ ] 浏览器可访问 `http://<IP>:8765/`
- [ ] 5 个 Forgekin 卡片正常显示
- [ ] 发送消息后收到真实 LLM 响应
- [ ] 消息包含 `llm_meta`（T1 证明）
- [ ] Primary 消息包含 `t7_badge`（T7 证明）
- [ ] T7 审核按钮可用
- [ ] T8 DOM 验证按钮可用

---

> 本手册最后更新：2026-07-23 | FlowForge Council v0.2.0
