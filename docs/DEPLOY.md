# FlowForge 部署指南

> 本指南面向外部开发者，说明如何在全新环境从零部署 FlowForge。
> 适用版本：flowlight-ai/flowforge v0.1.0

---

## 目录

1. [前置条件](#1-前置条件)
2. [快速部署](#2-快速部署)
3. [手动部署](#3-手动部署)
4. [环境变量配置](#4-环境变量配置)
5. [Docker 部署](#5-docker-部署)
6. [启动验证](#6-启动验证)
7. [常见问题](#7-常见问题)
8. [运维与升级](#8-运维与升级)

---

## 1. 前置条件

### 1.1 最低配置

| 项目 | 要求 |
|------|------|
| 操作系统 | Linux（Ubuntu 22.04+/CentOS 8+）、Windows 11 或 macOS 13+ |
| CPU | 2 核 |
| 内存 | 4 GB |
| 磁盘 | 10 GB 可用空间 |
| Python | 3.11+ |
| Node.js | 18+（前端构建） |
| 网络 | 可访问 LLM 网关端点 |

### 1.2 推荐配置

| 项目 | 要求 |
|------|------|
| CPU | 4 核+ |
| 内存 | 8 GB+ |
| 磁盘 | 20 GB+ SSD |
| Python | 3.11.x 或 3.12.x |
| Node.js | 20 LTS |

### 1.3 端口规划

| 服务 | 默认端口 | 用途 |
|------|----------|------|
| FlowForge 后端（FastAPI） | 8000 | REST API + WebSocket |
| FlowForge 前端（Next.js） | 5175 | Web 界面 |
| LLM 网关 | 13001 | OpenRoute 兼容端点（可选，见第 4 节） |

> 生产环境建议通过 Nginx/Caddy 反向代理前端端口并配置 TLS。

---

## 2. 快速部署

FlowForge 提供自动化脚本，可一键完成环境准备、依赖安装与前后端启动。

```bash
# 1. 克隆仓库
git clone https://github.com/flowlight-ai/flowforge.git
cd flowforge

# 2. 准备环境变量
cp .env.example .env
# 编辑 .env 填入 LLM 网关地址和 API Key（见第 4 节）

# 3. 一键安装（创建虚拟环境 + 安装后端依赖 + 构建前端）
python scripts/setup.py

# 4. （可选）安装外部编码 Agent CLI（Claude Code/Codex/Gemini 等）
python scripts/install_agents.py

# 5. 启动后端（端口 8000）+ 前端（端口 5175）
python scripts/start.py
```

启动后在浏览器打开 **http://localhost:5175** 即可访问 Web 界面。

---

## 3. 手动部署

如需对安装过程进行更细粒度控制，可按以下步骤手动部署。

### 3.1 项目结构

```
flowforge/
├── app/                    # FastAPI 后端入口
│   ├── main.py             # 应用入口（flowforge.app.main:app）
│   ├── api/                # API 路由
│   └── deps.py             # 依赖注入
├── web/                    # Next.js 前端
│   ├── src/                # 前端源码
│   ├── public/             # 静态资源
│   ├── package.json        # 前端依赖（dev 端口 5175）
│   ├── next.config.js
│   └── tailwind.config.ts
├── config/                 # YAML 配置
│   ├── forgekins/          # Forgekin 配置
│   ├── models.yaml         # 模型配置
│   ├── llm_route.yaml      # LLM 路由配置
│   ├── evolution.yaml      # 自进化参数
│   └── system.yaml         # 系统配置
├── core/                   # 共享内核（DI/插件/配置/追踪）
├── forgemind/              # Forgekin 应用层
├── evolution/              # 自进化引擎
├── loop/                   # Loop 执行器
├── llm/                    # LLM 路由
├── scripts/                # 自动化脚本
├── tests/                  # 测试用例
├── docs/                   # 文档
├── Dockerfile              # Docker 构建文件
├── docker-compose.yml      # Docker Compose 编排
├── pyproject.toml          # Python 项目配置
└── .env.example            # 环境变量模板
```

### 3.2 创建虚拟环境

```bash
cd flowforge

# Linux/macOS
python3.11 -m venv .venv
source .venv/bin/activate

# Windows PowerShell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 3.3 安装后端依赖

```bash
# 安装项目（含开发依赖，推荐）
pip install -e ".[dev]"

# 或仅安装运行时依赖
pip install -e .
```

### 3.4 构建前端

```bash
cd web
npm install
npm run build
cd ..
```

> 开发模式下可跳过 npm run build，直接使用 npm run dev 启动热更新服务。

### 3.5 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入 LLM 网关地址与 API Key（见第 4 节）
```

### 3.6 启动后端

```bash
python -m uvicorn flowforge.app.main:app --host 127.0.0.1 --port 8000
```

启动成功标志：

```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000
```

### 3.7 启动前端

在另一个终端：

```bash
cd web
npm run dev
```

启动成功后，Next.js 开发服务监听 **http://localhost:5175**。

---

## 4. 环境变量配置

所有配置通过 .env 文件或进程环境变量注入，遵循「环境变量 > .env > YAML 默认值」的优先级。

### 4.1 路径配置

```bash
# flowlight-ai 组织根目录（所有生态项目的父目录）
FLOWLIGHT_AI_ROOT="D:/projects/flowlight-ai"

# FlowForge 工作目录（状态、检查点、中间产物）
FLOWFORGE_WORK_DIR="${FLOWLIGHT_AI_ROOT}/flowforge/.work"

# 日志目录
FLOWFORGE_LOG_DIR="${FLOWFORGE_WORK_DIR}/logs"
```

### 4.2 LLM 网关配置

FlowForge 通过 OpenRoute 兼容的 API 端点调用 LLM，可在 config/models.yaml 和 config/llm_route.yaml 中配置 provider 与 fallback 链。

```bash
# OpenRoute 兼容网关地址（与实际部署的 LLM 网关地址一致）
FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL="http://localhost:13001"

# OpenRoute API Key
FLOWFORGE_LLM_ROUTE_OPENROUTE_API_KEY="or-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# 可选：直连 provider（需在 llm_route.yaml 中启用）
FLOWFORGE_LLM_ROUTE_DIRECT_ANTHROPIC_API_KEY=""
FLOWFORGE_LLM_ROUTE_DIRECT_OPENAI_API_KEY=""
FLOWFORGE_LLM_ROUTE_DIRECT_ZHIPU_API_KEY=""
```

> **注意**：OpenRoute 是独立的 LLM 网关项目，需单独部署。FlowForge 仅作为客户端调用其 OpenAI 兼容的 /v1/chat/completions 接口。请参考 OpenRoute 项目自身的部署文档。

### 4.3 自进化参数

```bash
# Loop 验证质量阈值（默认 0.85）
FLOWFORGE_EVOLUTION_QUALITY_THRESHOLD="0.85"

# Loop 最大迭代次数（默认 5）
FLOWFORGE_EVOLUTION_LOOP_MAX_ITERATIONS="5"

# LLM 调用超时（秒）
FLOWFORGE_EVOLUTION_LLM_TIMEOUT_SECONDS="90"
FLOWFORGE_EVOLUTION_LLM_LONG_ARTICLE_TIMEOUT_SECONDS="120"
FLOWFORGE_EVOLUTION_LLM_MAX_RETRIES="3"
```

### 4.4 调试与可观测性

```bash
# 调试日志（0=关闭，1=开启，记录 LLM 输入/输出/耗时）
FLOWFORGE_DEBUG="0"

# 日志级别（ERROR / WARN / INFO / DEBUG）
FLOWFORGE_TRACE_LEVEL="INFO"
```

### 4.5 内容审核与浏览器验证（可选）

```bash
# 启用 LLM 跨厂商互审（对 LLM 生成内容再用另一厂商 LLM 审核）
FLOWFORGE_T7_AUDIT_ENABLED="1"

# 启用浏览器 DOM 自动验证（需本机安装 Chrome/Edge）
FLOWFORGE_T8_DOM_VERIFICATION_ENABLED="0"
FLOWFORGE_T8_CDP_BROWSER_PATH=""
```

---

## 5. Docker 部署

项目提供 Dockerfile 与 docker-compose.yml 用于容器化部署。

> **说明**：当前仓库内的 Dockerfile 与 docker-compose.yml 仍指向旧版入口与端口（flowforge/web/app.py、端口 8765）。如需以容器方式运行新架构，请按以下方式调整后使用，或优先采用第 2、3 节的本地部署方式。

### 5.1 使用 Docker Compose

```bash
# 准备环境变量
cp .env.example .env
# 编辑 .env 填入实际配置

# 后台启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

### 5.2 使用 Docker 直接运行

```bash
docker build -t flowforge:0.1.0 .

docker run -d \
  --name flowforge \
  --restart unless-stopped \
  -p 8000:8000 \
  --env-file .env \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/docs:/app/docs \
  flowforge:0.1.0
```

### 5.3 跨机连接 LLM 网关

若 LLM 网关运行在其他服务器，修改 .env：

```bash
FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL="http://192.168.1.100:13001"
```

容器内访问宿主机网关时，使用 host.docker.internal：

```bash
FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL="http://host.docker.internal:13001"
```

---

## 6. 启动验证

### 6.1 健康检查

```bash
# 检查后端是否正常，预期返回 Forgekin 列表
curl http://localhost:8000/api/agents
```

### 6.2 浏览器访问

打开 **http://localhost:5175**，应看到：

- 左侧栏显示 Forgekin 卡片（文心/夏洛克/梵高/达芬奇/鲁班）
- 中间区域为协作议事聊天界面
- 底部输入框可发送消息

### 6.3 验证 5 个默认 Forgekin

```bash
python scripts/verify_five_forgekins.py
```

### 6.4 发送测试消息

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"content": "请分析 Python 的 GIL 对多线程的影响", "mentions": []}'
```

预期返回包含 Forgekin 响应及 LLM 元信息（model/provider/latency）。

---

## 7. 常见问题

### 7.1 后端无法启动

**症状**：ModuleNotFoundError: No module named 'flowforge'

**解决**：未安装项目依赖，执行：

```bash
pip install -e ".[dev]"
```

### 7.2 LLM 调用失败

**症状**：聊天回复「LLM 调用失败，所有 fallback 均已耗尽」

**排查步骤**：

1. 检查 LLM 网关是否运行：
   ```bash
   curl http://localhost:13001/v1/models
   ```

2. 检查 API Key 是否正确配置：
   ```bash
   echo $FLOWFORGE_LLM_ROUTE_OPENROUTE_API_KEY
   ```

3. 检查 config/llm_route.yaml 中 provider 是否启用、模型名称是否在网关支持列表内。

4. 测试网关连通性：
   ```bash
   curl -X POST http://localhost:13001/v1/chat/completions \
     -H "Authorization: Bearer $FLOWFORGE_LLM_ROUTE_OPENROUTE_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"zhipu/glm-4-flash","messages":[{"role":"user","content":"hello"}]}'
   ```

### 7.3 前端无法访问

**症状**：浏览器打开 http://localhost:5175 无响应

**排查步骤**：

1. 确认前端开发服务已启动：
   ```bash
   cd web && npm run dev
   ```

2. 确认依赖已安装：
   ```bash
   cd web && npm install
   ```

3. 检查端口是否被占用（见 7.5）。

### 7.4 WebSocket 连接断开

**症状**：浏览器控制台显示 WebSocket closed

**解决**：前端会自动重连。如持续断开，检查后端服务是否正常运行，以及反向代理是否放行 WebSocket 升级请求。

### 7.5 端口被占用

```bash
# Linux/macOS 查找占用进程
lsof -i :8000
lsof -i :5175

# Windows 查找占用进程
netstat -ano | findstr :8000
netstat -ano | findstr :5175
```

停止占用进程，或更换端口启动：

```bash
# 后端换端口
python -m uvicorn flowforge.app.main:app --host 127.0.0.1 --port 8001

# 前端换端口
cd web && npx next dev --port 5176
```

### 7.6 Docker 容器健康检查失败

```bash
# 查看容器日志
docker compose logs flowforge

# 进入容器调试
docker compose exec flowforge bash
curl http://localhost:8000/api/agents
```

---

## 8. 运维与升级

### 8.1 日志管理

```bash
# 日志位置（默认）
ls -la .work/logs/

# 实时查看
tail -f .work/logs/flowforge.log

# Docker 环境
docker compose logs -f flowforge
```

### 8.2 开启调试日志

```bash
export FLOWFORGE_DEBUG=1
export FLOWFORGE_TRACE_LEVEL=DEBUG
# 重启服务后，日志将包含 LLM 输入/输出/耗时
```

### 8.3 升级流程

```bash
# 1. 备份配置
cp -r config/ config_backup_$(date +%Y%m%d)/
cp .env .env.backup

# 2. 拉取新代码
git pull origin main

# 3. 更新依赖
pip install -e ".[dev]" --upgrade
cd web && npm install && cd ..

# 4. 检查配置变更
diff config_backup_$(date +%Y%m%d)/llm_route.yaml config/llm_route.yaml

# 5. 重启服务
# 本地：Ctrl+C 后重新执行 python scripts/start.py
# Docker：docker compose up -d --build
```

### 8.4 安全建议

1. **不要将 .env 文件提交到 Git**（已在 .gitignore 中排除）。
2. **生产环境使用反向代理**（Nginx/Caddy）配置 TLS。
3. **限制 LLM 网关端口访问**，仅允许 FlowForge 服务器访问 13001。
4. **定期轮换 API Key**。
5. **开启防火墙**，仅暴露前端端口（或反向代理端口）。

---

## 附录：快速启动检查清单

- [ ] Python 3.11+ 已安装
- [ ] Node.js 18+ 已安装
- [ ] LLM 网关已启动（端口 13001，可选）
- [ ] LLM 网关 API Key 已获取
- [ ] .env 文件已配置
- [ ] 后端依赖已安装（pip install -e .）
- [ ] 前端依赖已安装（cd web && npm install）
- [ ] 后端已启动（端口 8000）
- [ ] 前端已启动（端口 5175）
- [ ] 浏览器可访问 http://localhost:5175
- [ ] Forgekin 卡片正常显示
- [ ] 发送消息后收到真实 LLM 响应

---

> 本指南最后更新：2026-07-29 | FlowForge v0.1.0
