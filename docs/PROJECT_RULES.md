# FlowForge 项目规则

> 本文档为 Trae CN 启动时自动读取的项目上下文，确保 AI 开发助手始终理解项目全貌并严格遵守开发规范。

---

## 📚 项目背景

FlowForge 是一个**开源的 AI Agent 操作系统底座**，提供通用的任务编排、模型治理、工具集成和 Solo 交互能力。上层应用（ContentForge、DevForge、NovelForge 等）通过继承或扩展 FlowForge 的底座能力来构建业务特定功能。

**核心定位**：AI Agent OS — 从底层模型代理到上层任务编排的全栈基础设施。

**开源协议**：MIT License

---

## 🏗️ 项目架构

### 分层架构

```
应用层 (Gateway / Web UI) → 指挥中枢层 (Brain / Executor) → 专家执行层 (Workers / Agents) → 工具与记忆层 (Tools & Memory)
        (所有层均可依赖共享内核 core/)
```

**铁律**：上层可以依赖下层，下层**绝对禁止**导入上层模块。单向依赖是架构不腐化的底线。

### 核心目录

```
flowforge/
├── app/            # FastAPI 应用入口 + API 端点
├── agents/         # 专家执行层（通用 Agent + 内容 Agent）
│   └── generic/    # 17 个通用 Agent（Thinker/Planner/Drafter/Critic 等）
├── core/           # 共享内核（配置、接口、追踪、指标、DI 容器）
├── events/         # 事件系统（EventBus + SoloAdapter）
├── executor/       # 执行器（HybridExecutor + StateManager）
├── memory/         # 记忆层（SQLite Store、Repository）
├── modes/          # 执行模式（Workflow/ReAct/PlanExecute/Reflexion 等 9 种）
├── tools/          # 工具层（LLM、搜索、发布、渠道、网页代理）
├── scheduler/      # 定时调度（APScheduler）
├── web/            # Web UI（Next.js 14 + React 18 + TypeScript）
├── config/         # 配置文件（system.yaml、models.yaml、workflows/*.yaml）
├── docs/           # 文档
└── tests/          # 测试用例
```

### 关键依赖关系

```
FlowForge（底座）    →  通用 Agent、通用 Workflow、模型治理、配置管理、日志追踪、Solo 交互、网页 Chat 代理
ContentForge（上层） →  内容创作 Agent、内容 SOP、专栏配置、发布渠道（继承 FlowForge）
DevForge（上层）     →  开发 Agent、IPD 工作流、代码审查、部署流程（继承 FlowForge）
```

---

## 🔴 铁律（违反则代码审查不通过）

### 铁律 1：底座能力原则 — 禁止上层能力下沉到 FlowForge
- ❌ 在 FlowForge 中实现内容创作 SOP
- ❌ 在 FlowForge 中实现 DevForge 的代码审查逻辑
- ✅ 至少 2 个上层应用需要的能力才可下层到 FlowForge
- ✅ FlowForge 中的能力必须不包含任何业务特定逻辑

### 铁律 2：禁止跨 persona/业务 复制配置
- ❌ `shutil.copy(persona/life.yaml, persona/education.yaml)`
- ✅ 每个 persona 配置文件必须根据定位独立编写

### 铁律 3：禁止使用假数据/假逻辑
- ❌ 返回硬编码的 `{"status": "ok"}`、模拟向量搜索、模拟图谱构建
- ✅ 所有检索、存储、发布必须使用真实实现

### 铁律 4：禁止绕过 DI 容器直接实例化
- ❌ `from workers.topic_agent import TopicAgent; agent = TopicAgent()`
- ✅ 所有依赖必须通过构造函数注入，由 DI 容器管理

### 铁律 5：禁止直接操作数据库
- ❌ `cursor.execute("INSERT INTO tasks ...")`
- ✅ 所有数据库操作必须通过 Repository 层

### 铁律 6：禁止硬编码路径和密钥
- ❌ `path = "/home/user/project/..."`, `api_key = "sk-xxx"`
- ✅ 通过 `config/system.yaml` 或 `.env` 注入，或通过 SecretStore 动态管理

---

## 💡 开发前必读

### 1. 架构约束
- **分层单向依赖**：应用层 → 指挥中枢 → 专家执行 → 工具与记忆
- **接口隔离**：所有抽象基类在 `core/interfaces/` 中定义
- **循环依赖零容忍**：发现循环依赖必须重构，不允许用延迟导入规避

### 2. 代码规范
- Python 3.11+，类型注解**强制**
- 所有 I/O 操作使用 `async/await`
- Agent 禁止直接导入 LLM SDK，必须通过 `LLMClient`
- 工具调用必须通过 `ToolRegistry.execute()`，禁止直接 import
- 日志使用 `core/tracing.py` 的 `get_logger`，自动注入 `trace_id`

### 3. Agent 开发
- 继承 `BaseAgent`，实现 `execute(input: AgentInput) -> AgentOutput`
- 输入输出通过 Pydantic 模型校验
- 修改 State 时通过 `state_updates` 返回，不直接修改 State 对象

### 4. 开源代码注释规范
- 所有公共类、函数、方法必须包含 docstring（遵循 Google Style 或 NumPy Style）
- 模块级 docstring 说明模块用途、作者、协议
- 关键算法和业务逻辑处添加行内注释解释"为什么"而非"是什么"
- 接口和抽象类必须注释每个方法的参数、返回值、可能的异常
- 配置文件（YAML）中的非显而易见字段必须添加注释

### 5. Solo 交互开发
- Solo 模式通过 `interaction_mode: "solo"` 触发
- 前端发送 `mode: "solo"` 会被后端自动映射为 `mode: "workflow"` + `interaction_mode: "solo"`
- 事件桥接：EventBus → EventBusSoloAdapter → ConnectionManager → WebSocket
- WebSocket 直连后端 8000 端口（Next.js rewrites 不支持 WS 协议升级）

### 6. 模型与代理
- 网页 Chat 代理通过 `webproxy` provider 接入（指向 hiclaw proxy 服务 127.0.0.1:13000）
- 支持 5 个平台：豆包、Kimi、DeepSeek、腾讯元宝、阿里千问 + 1 个轮询虚拟模型 web/chat
- API Key 通过 SecretStore 管理，优先级：DB → 环境变量 → .env 文件 → 默认值
- 模型健康检查和自动修复是内置能力
- Solo 模式任务在后台异步执行（`asyncio.ensure_future`），前端通过 WebSocket 接收实时事件

### 7. Hiclaw Proxy 网页代理服务（关键依赖）

#### 7.1 服务概述
hiclaw proxy 是 FlowForge 的**关键外部依赖**，将网页版大模型（豆包、Kimi、DeepSeek、腾讯元宝、阿里千问）包装为 OpenAI 兼容 API。通过 Playwright 驱动真实浏览器，模拟用户在网页上的输入/输出行为。

**代码位置**：`d:\software\openclaw\hiclaw\tool\proxy\`

**提供的 6 个模型**：
| 模型 ID | 平台 | 说明 |
|---------|------|------|
| `doubao-web/seed-2.0` | 豆包 | 豆包专用，独立 BrowserContext |
| `kimi-web/chat` | Kimi | 共享 BrowserContext 的独立 tab |
| `deepseek-web/chat` | DeepSeek | 共享 BrowserContext 的独立 tab |
| `yuanbao-web/chat` | 腾讯元宝 | 共享 BrowserContext 的独立 tab |
| `qianwen-web/chat` | 阿里千问 | 共享 BrowserContext 的独立 tab |
| `web/chat` | 轮询虚拟模型 | Round-Robin 在上述 5 个平台间轮询 |

#### 7.2 启动方法
```bash
# 方式一：直接启动（推荐调试时使用）
cd d:\software\openclaw\hiclaw\tool\proxy
python app.py

# 方式二：uvicorn 启动
cd d:\software\openclaw\hiclaw\tool\proxy
python -m uvicorn app:app --host 0.0.0.0 --port 13000

# 方式三：通过 FlowForge API 启动（推荐生产使用）
POST http://127.0.0.1:8000/api/v1/webproxy/start
```

**启动后验证**：
```bash
# 健康检查
curl http://127.0.0.1:13000/health

# 查看可用模型
curl http://127.0.0.1:13000/v1/models

# 测试调用
curl -X POST http://127.0.0.1:13000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"doubao-web/seed-2.0","messages":[{"role":"user","content":"hello"}]}'
```

#### 7.3 插件化接入方案
FlowForge 通过 `WebProxyService`（`tools/webproxy_service.py`）管理 proxy 服务的生命周期：

1. **子进程管理**：`WebProxyService` 将 proxy 作为子进程启动/停止
2. **健康检查**：定期调用 `http://127.0.0.1:13000/health` 检测服务状态
3. **API 端点**：`/api/v1/webproxy/start|stop|status|models|chat`
4. **自动关闭**：FlowForge 后端关闭时自动停止 proxy 子进程
5. **外部启动兼容**：即使 proxy 不是通过 WebProxyService 启动的，也能检测到其运行状态

**接入流程**：
```
FlowForge 后端启动
  → lifespan() 检查 webproxy 状态
  → 用户通过 API 或 UI 启动 webproxy
  → WebProxyService.start() 启动子进程
  → 健康检查通过后，webproxy 模型可用
  → LLMClient 的 fallback 链自动包含 webproxy 模型
  → FlowForge 后端关闭时，lifespan() 自动停止 proxy
```

#### 7.4 注意事项
- proxy 服务需要 Playwright 和 Chromium 已安装（`pip install playwright && playwright install chromium`）
- Windows 下默认有头模式（方便调试登录），Linux 下检测 DISPLAY 环境变量决定
- 首次使用需在浏览器中手动登录各平台（Cookie 保存在 `doubao_profile` 目录）
- proxy 服务的 `app.py` 中硬编码了端口 13000，修改需同步更新 `WebProxyService.DEFAULT_PROXY_PORT`
- **禁止在代码中硬编码 proxy 路径**，应通过 `WebProxyService` 或配置文件管理

---

## 📖 设计文档索引

| 文档 | 路径 | 说明 |
|------|------|------|
| 架构设计原则 | `docs/ARCHITECTURE_PRINCIPLES.md` | 10 大架构原则（底座能力、单向依赖、配置外置等） |
| 功能特性规格 | `docs/design.md` | 功能需求与设计 |
| API 参考 | `docs/api.md` | REST API + WebSocket 端点 |
| 架构概览 | `docs/arch.md` | 分层架构、技术栈 |
| 测试用例 | `docs/test.md` | 测试场景 |

---

## 🧭 AI 助手行为准则

1. **理解上下文再行动**：修改代码前先阅读架构文档和接口定义
2. **确定影响范围**：涉及多模块修改时必须列出影响清单
3. **禁止盲目覆盖**：跨模块修改必须逐个处理，不可批量复制
4. **编写/更新测试**：每次代码修改必须伴随对应测试用例
5. **验证无循环依赖**：修改后检查模块依赖图
6. **先读后写**：修改某个模块前，先完整理解该模块的当前实现
7. **不确定就问**：遇到模糊需求，主动询问用户确认，不要猜测
8. **开源意识**：所有公共接口必须添加标准 docstring，方便社区阅读和使用

---

## ⚡ 快速参考

### 技术栈
- 后端：Python 3.11+ / FastAPI / SQLAlchemy (SQLite) / LangGraph / APScheduler
- 前端：Next.js 14 / React 18 / TypeScript / Tailwind / shadcn/ui
- 数据库：SQLite（任务/审计/状态/密钥） + HelixRAG PostgreSQL（文档索引）
- 代理：hiclaw proxy（Playwright 浏览器自动化，OpenAI API 兼容）

### 关键端口
| 服务 | 端口 | 说明 |
|------|------|------|
| FlowForge API | 8000 | FastAPI 后端 |
| FlowForge Web | 5174 | Next.js 前端 |
| hiclaw proxy | 13000 | 网页 Chat 代理服务 |
| HelixRAG | 8100 | RAG 素材检索服务 |

### 环境变量
| 变量 | 用途 | 必需 |
|------|------|------|
| `OPENROUTER_API_KEY` | OpenRouter 模型 API Key | 可选 |
| `ALIYUN_API_KEY` | 阿里云模型 API Key | 可选 |
| `ARK_API_KEY` | 字节火山方舟 API Key | 可选 |
| `TAVILY_API_KEY` | Tavily 搜索 API Key | 可选 |
| `SECRET_KEY` | 应用密钥 | 建议 |
| `WEBPROXY_BASE_URL` | 网页代理地址 | 默认 http://127.0.0.1:13000/v1 |

> 所有 API Key 均可通过 Web UI「设置 → 密钥管理」动态配置，无需重启服务。

---

> **本文档在每次 Trae CN 启动时自动加载。**
> **所有代码开发必须严格遵守 `docs/ARCHITECTURE_PRINCIPLES.md` 中的原则。**
> **如有疑问，参考设计文档或直接询问用户，不要猜测或假设。**
