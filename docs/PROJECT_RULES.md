# FlowForge 项目规则 v6.0

> **版本**：v6.0
> **更新日期**：2026-05-21
> 本文档为 Trae CN 启动时自动读取的项目上下文，确保 AI 开发助手始终理解项目全貌并严格遵守开发规范。

***

## 📚 项目背景

FlowForge 是一个**开源的 Agent Harness 平台**，提供四根 Harness 护栏（上下文工程、架构约束、反馈循环、熵管理）、9 大执行模式、多协议工具生态（MCP/OpenAPI/GraphQL）、Skill 系统、多 Agent 策略（Subagents/Teams/Swarms）和 Solo 实时交互能力。上层应用（ContentForge、DevForge、NovelForge 等）通过继承或扩展 FlowForge 的底座能力来构建业务特定功能。

**核心定位**：Agent Harness Layer — 从"编排框架"进化为"驾驭系统"，为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统。

**核心公式**：

```
Agent = Model (Brain) + Harness (Body)
FlowForge = Harness Layer = 前馈控制 + 反馈控制 + 熵管理 + 可观测性
```

**开源协议**：MIT License

***

## 🏗️ 项目架构

### 六层架构模型

```
┌─────────────────────────────────────────────────────────────────────┐
│  6. 应用层 (Application Layer)                                      │
│     ContentForge / NovelForge / 其他业务系统                        │
├─────────────────────────────────────────────────────────────────────┤
│  5. 接入层 (Gateway Layer)                                          │
│     FastAPI REST API + WebSocket (Solo/Events) + Web UI + CLI       │
├─────────────────────────────────────────────────────────────────────┤
│  4. Harness 驾驭层 (Harness Layer) ★ v6.0 核心                      │
│     上下文工程 | 架构约束 | 反馈循环 | 熵管理 | 权限管线 | 会话管理  │
├─────────────────────────────────────────────────────────────────────┤
│  3. 执行引擎层 (Engine Layer)                                       │
│     HybridExecutor (TAOR循环) | ModeRegistry (9大模式) | Scheduler  │
├─────────────────────────────────────────────────────────────────────┤
│  2. 能力层 (Capability Layer)                                       │
│     Tool生态 (MCP/OpenAPI/GraphQL) | Skill系统 | Agent库 | Memory   │
├─────────────────────────────────────────────────────────────────────┤
│  1. 基础设施层 (Infrastructure Layer)                               │
│     SQLite/PostgreSQL | Redis | Qdrant/Milvus | LangGraph | LLM API │
└─────────────────────────────────────────────────────────────────────┘
```

**铁律**：上层可以依赖下层，下层**绝对禁止**导入上层模块。单向依赖是架构不腐化的底线。

### 核心目录

```
flowforge/
├── app/            # FastAPI 应用入口 + API 端点
├── agents/         # 专家执行层（通用 Agent + 内容 Agent）
│   └── generic/    # 17 个通用 Agent（Thinker/Planner/Drafter/Critic 等）
├── core/           # 共享内核（纯接口定义 + 配置 + 追踪 + DI 容器）
├── engine/         # 执行引擎（HybridExecutor + StateManager + AgentRegistry + ModeRegistry）
├── harness/        # ★ v6.0 新增 — Harness 驾驭层（4 护栏 + 权限管线 + 会话管理）
│   ├── context/    #   上下文工程引擎
│   ├── constraints/#   架构约束引擎
│   ├── feedback/   #   反馈循环引擎
│   └── entropy/    #   熵管理引擎（含文档园丁 Agent）
├── security/       # ★ v6.0 新增 — 安全体系（权限管线 + 沙箱 + 并发安全）
├── skills/         # ★ v6.0 新增 — Skill 系统（多格式兼容 + 触发器 + 组合技）
├── mcp/            # ★ v6.0 新增 — MCP 模块（Client + Gateway + Broker + ToolAdapter）
├── observability/  # ★ v6.0 新增 — 可观测性（追踪 + 指标 + 审计日志）
├── events/         # 事件系统（EventBus + SoloAdapter）
├── memory/         # 记忆层（SQLite Store、Repository、5 种记忆策略）
├── modes/          # 执行模式（Workflow/ReAct/PlanExecute/Reflexion 等 9 种）
├── tools/          # 工具层（重组为子目录结构）
│   ├── builtin/    #   内置工具（LLM、搜索、文件读写等）
│   ├── adapters/   #   协议适配器（OpenAPI/GraphQL/Webhook）
│   └── publish/    #   发布渠道（头条/微信/本地等）
├── scheduler/      # 定时调度（APScheduler）
├── web/            # Web UI（Next.js 14 + React 18 + TypeScript）
├── config/         # 配置文件（system.yaml、models.yaml、harness_v6.yaml、workflows/*.yaml）
├── docs/           # 文档
└── tests/          # 测试用例
```

### 关键依赖关系

```
FlowForge（底座）    →  通用 Agent、通用 Workflow、模型治理、配置管理、日志追踪、Solo 交互、网页 Chat 代理、Harness 护栏、Skill 系统、MCP 协议
ContentForge（上层） →  内容创作 Agent、内容 SOP、专栏配置、发布渠道（继承 FlowForge）
DevForge（上层）     →  开发 Agent、IPD 工作流、代码审查、部署流程（继承 FlowForge）
```

***

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

### 铁律 7：禁止硬编码提示词

- ❌ 在 Agent/Tool/Mode 代码中直接写 f-string 提示词
- ✅ 所有提示词必须通过 `PromptManager.get(key, **kwargs)` 获取
- ✅ 提示词模板存放在 `config/prompts.yaml`，支持运行时修改
- ✅ 上层应用（ContentForge/DevForge/NovelForge）可通过覆盖 prompts.yaml 定制提示词，无需修改 FlowForge 源码

### 铁律 8：前端组件化架构

- ❌ 单个组件文件超过 300 行（不含样式）
- ❌ 在一个文件中实现多个独立功能组件
- ✅ 每个独立功能组件独立文件，通过 import 组装
- ✅ 共享类型定义在 `solo-types.ts` 中
- ✅ 共享工具函数在 `solo-utils.ts` 中
- ✅ 页面级组件在 `app/` 目录下，功能组件在 `components/` 目录下

**组件拆分原则**：
1. 按功能域拆分：聊天流、输入框、侧边栏、编辑器、图可视化
2. 共享状态通过 props 传递，不使用全局变量
3. 每个组件只负责一个关注点
4. 复杂组件内部状态用 `useReducer` 管理

### 铁律 9：禁止擅自修改服务端口和启动方式

- ❌ 擅自将后端从 8000 改为其他端口
- ❌ 擅自将 openroute 从 13000 改为其他端口
- ❌ 擅自将前端从 5174 改为其他端口
- ❌ 不使用项目规定的启动脚本启动服务
- ✅ 后端必须使用 `python -m uvicorn flowforge.app.main:app --host 0.0.0.0 --port 8000` 启动
- ✅ openroute 必须使用 `hiclaw/tool/openroute/run.ps1` 或 `run.bat` 启动脚本启动（端口 13000）
- ✅ 前端必须使用 `cd flowforge/web && npm run dev` 启动（端口 5174）
- ✅ 修改端口需要同步更新：models.yaml、next.config.js、PROVIDER_BASE_URLS、OpenRouteService.DEFAULT_OPENROUTE_PORT、useSoloWebSocket.ts

**原因**：openroute 使用 Playwright 浏览器自动化，浏览器登录缓存（cookies/session）与端口号绑定。改端口会导致所有网页版 LLM 需要重新登录，严重影响可用性。

### 铁律 10：Harness 灰度开关 — 所有 Harness 功能必须通过 config/harness_v6.yaml 的 enabled 开关控制

- ❌ 在代码中硬编码 `harness_enabled = True`
- ❌ 新增 Harness 功能后，禁用时系统行为与 v5.0 不一致
- ✅ 所有 Harness 功能必须通过 `config/harness_v6.yaml` 中对应模块的 `enabled` 开关控制
- ✅ 禁用所有 Harness 开关时，系统行为必须与 v5.0 完全一致（零侵入）
- ✅ HybridExecutor 中的 Hook 点通过 `ctx.harness_enabled` 条件判断，禁用时跳过所有 Harness 逻辑
- ✅ 新增 Harness 模块时，必须同时编写"开关禁用"路径的回归测试

**灰度开关配置参考**：

```yaml
# config/harness_v6.yaml
harness:
  context_engineering:
    enabled: true   # ← 每个模块独立开关
  architecture_constraints:
    enabled: true
  feedback_loop:
    enabled: true
  entropy_management:
    enabled: true
  permission_pipeline:
    enabled: true
  session_management:
    enabled: true
```

### 铁律 11：增量迁移 — 禁止一次性推倒重来，必须按三步增量迁移策略执行

- ❌ 一次性将 `executor/` 重命名为 `engine/` 并删除旧路径
- ❌ 一次性将 `tools/` 重组为子目录结构并破坏现有 import
- ❌ 跳过回归测试直接合并迁移变更
- ✅ 必须按以下三步增量迁移策略执行：

| 步骤 | 内容 | 新增目录 | 修改文件 | 回归测试 |
|------|------|---------|---------|---------|
| **Step 1** | 新增 harness/，灰度开关 | `harness/`（14个新文件） | `HybridExecutor.run()` 增加 Hook 点 | harness 禁用时行为不变 |
| **Step 2** | 重组 tools/agents，import 兼容 | `tools/builtin/` 等子目录 | `__init__.py` re-export + DeprecationWarning | 所有现有 Agent/Tool 测试通过 |
| **Step 3** | executor/→engine/，引入 security/observability | `engine/`, `security/`, `observability/` | 删除旧 import 路径 | 全量回归测试 |

- ✅ Step 2 的 import 兼容期为 1 个大版本周期（v6.0 全周期内保持兼容，v7.0 才删除旧路径）
- ✅ 旧 import 路径触发时输出 `DeprecationWarning`
- ✅ 每步完成后必须运行回归测试确认无破坏性变更

***

## 💡 开发前必读

### 1. 架构约束

- **六层单向依赖**：应用层 → 接入层 → Harness 驾驭层 → 执行引擎层 → 能力层 → 基础设施层
- **接口隔离**：所有抽象基类在 `core/interfaces/` 中定义，`core/` 只保留纯接口
- **循环依赖零容忍**：发现循环依赖必须重构，不允许用延迟导入规避
- **Harness 灰度**：所有 Harness 功能通过 `config/harness_v6.yaml` 开关控制，禁用时零侵入

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

- 网页 Chat 代理通过 `openroute` provider 接入（指向 hiclaw openroute 服务 127.0.0.1:13000）
- 支持 5 个平台：豆包、Kimi、DeepSeek、腾讯元宝、阿里千问 + 1 个轮询虚拟模型 web/chat
- API Key 通过 SecretStore 管理，优先级：DB → 环境变量 → .env 文件 → 默认值
- 模型健康检查和自动修复是内置能力
- Solo 模式任务在后台异步执行（`asyncio.ensure_future`），前端通过 WebSocket 接收实时事件

### 7. Hiclaw Proxy 网页代理服务（关键依赖）

#### 7.1 服务概述

hiclaw proxy 是 FlowForge 的**关键外部依赖**，将网页版大模型（豆包、Kimi、DeepSeek、腾讯元宝、阿里千问）包装为 OpenAI 兼容 API。通过 Playwright 驱动真实浏览器，模拟用户在网页上的输入/输出行为。

**代码位置**：`d:\software\openclaw\hiclaw\tool\openroute\`

**提供的 6 个模型**：

| 模型 ID                 | 平台       | 说明                        |
| --------------------- | -------- | ------------------------- |
| `doubao-web/seed-2.0` | 豆包       | 豆包专用，独立 BrowserContext    |
| `kimi-web/chat`       | Kimi     | 共享 BrowserContext 的独立 tab |
| `deepseek-web/chat`   | DeepSeek | 共享 BrowserContext 的独立 tab |
| `yuanbao-web/chat`    | 腾讯元宝     | 共享 BrowserContext 的独立 tab |
| `qianwen-web/chat`    | 阿里千问     | 共享 BrowserContext 的独立 tab |
| `web/chat`            | 轮询虚拟模型   | Round-Robin 在上述 5 个平台间轮询  |

#### 7.2 启动方法

```bash
# 方式一：直接启动（推荐调试时使用）
cd d:\software\openclaw\hiclaw\tool\openroute
python app.py
 .\start_openroute.bat

# 方式二：uvicorn 启动
cd d:\software\openclaw\hiclaw\tool\openroute
python -m uvicorn app:app --host 0.0.0.0 --port 13000

# 方式三：通过 FlowForge API 启动（推荐生产使用）
POST http://127.0.0.1:8000/api/v1/openroute/start
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

FlowForge 通过 `OpenRouteService`（`tools/openroute_service.py`）管理 openroute 服务的生命周期：

1. **子进程管理**：`OpenRouteService` 将 openroute 作为子进程启动/停止
2. **健康检查**：定期调用 `http://127.0.0.1:13000/health` 检测服务状态
3. **API 端点**：`/api/v1/openroute/start|stop|status|models|chat`
4. **自动关闭**：FlowForge 后端关闭时自动停止 openroute 子进程
5. **外部启动兼容**：即使 openroute 不是通过 OpenRouteService 启动的，也能检测到其运行状态

**接入流程**：

```
FlowForge 后端启动
  → lifespan() 检查 openroute 状态
  → 用户通过 API 或 UI 启动 openroute
  → OpenRouteService.start() 启动子进程
  → 健康检查通过后，openroute 模型可用
  → LLMClient 的 fallback 链自动包含 openroute 模型
  → FlowForge 后端关闭时，lifespan() 自动停止 openroute
```

#### 7.4 注意事项

- proxy 服务需要 Playwright 和 Chromium 已安装（`pip install playwright && playwright install chromium`）
- Windows 下默认有头模式（方便调试登录），Linux 下检测 DISPLAY 环境变量决定
- 首次使用需在浏览器中手动登录各平台（Cookie 保存在 `doubao_profile` 目录）
- proxy 服务的 `app.py` 中硬编码了端口 13000，修改需同步更新 `OpenRouteService.DEFAULT_OPENROUTE_PORT`
- **禁止在代码中硬编码 openroute 路径**，应通过 `OpenRouteService` 或配置文件管理

### 8. Harness Hook 点设计

Harness 层通过 2 个统一入口介入 Agent 执行流程：

```python
# HybridExecutor.run() 中的 Hook 点
if ctx.harness_enabled:
    await self.harness.pre_execute(ctx)      # context.inject() + entropy.check()

result = await agent.execute_with_context(input, ctx)

if ctx.harness_enabled:
    result = await self.harness.post_execute(result, ctx)  # constraints.validate() + feedback.evaluate()
```

- **pre_execute**：上下文工程注入 + 熵管理轻量检查
- **post_execute**：架构约束验证 + 反馈循环评估
- 熵管理（文档园丁、技术债回收）作为后台 Cron 任务，在 `pre_execute` 中只做"是否需要触发债务检查"的轻量判断

### 9. FeedbackLoop 评估模式

FeedbackLoop 作为全局护栏，独立于任何模式，与 Reflexion 模式构成内环+外环双层架构：

| 模式 | LLM 调用次数 | 适用场景 |
|------|-------------|---------|
| `full` | 2 次（四维评分 + 分类闸门） | 需要深度质量评估的场景 |
| `lightweight` | 1 次（仅分类闸门） | 日常运行，**默认** |
| `skip` | 0 次（跳过外环） | 内环 Reflexion 仍生效 |

***

## 📖 设计文档索引

| 文档     | 路径                                | 说明                        |
| ------ | --------------------------------- | ------------------------- |
| 功能特性规格 | `docs/spec.md`                   | v6.0 功能需求与设计（Harness 层、六层架构、Skill 系统等） |
| 架构设计原则 | `docs/ARCHITECTURE_PRINCIPLES.md` | 10 大架构原则（底座能力、单向依赖、配置外置等） |
| 功能特性规格 | `docs/design.md`                  | 功能需求与设计（v5.0 及之前）                   |
| API 参考 | `docs/api.md`                     | REST API + WebSocket 端点   |
| 架构概览   | `docs/arch.md`                    | 分层架构、技术栈                  |
| 测试用例   | `docs/test.md`                    | 测试场景                      |

***

## 🧭 AI 助手行为准则

1. **理解上下文再行动**：修改代码前先阅读架构文档和接口定义
2. **确定影响范围**：涉及多模块修改时必须列出影响清单
3. **禁止盲目覆盖**：跨模块修改必须逐个处理，不可批量复制
4. **编写/更新测试**：每次代码修改必须伴随对应测试用例
5. **验证无循环依赖**：修改后检查模块依赖图
6. **先读后写**：修改某个模块前，先完整理解该模块的当前实现
7. **不确定就问**：遇到模糊需求，主动询问用户确认，不要猜测
8. **开源意识**：所有公共接口必须添加标准 docstring，方便社区阅读和使用
9. **Harness 灰度意识**：新增 Harness 功能时，必须确保禁用开关后系统行为与 v5.0 一致

***

## ⚡ 快速参考

### 技术栈

- 后端：Python 3.11+ / FastAPI / SQLAlchemy (SQLite) / LangGraph / APScheduler
- 前端：Next.js 14 / React 18 / TypeScript / Tailwind / shadcn/ui
- 数据库：SQLite（任务/审计/状态/密钥） + HelixRAG PostgreSQL（文档索引）
- 代理：hiclaw proxy（Playwright 浏览器自动化，OpenAI API 兼容）

### 关键端口

| 服务            | 端口    | 说明           |
| ------------- | ----- | ------------ |
| FlowForge API | 8000  | FastAPI 后端   |
| FlowForge Web | 5174  | Next.js 前端   |
| hiclaw proxy  | 13000 | 网页 Chat 代理服务 |
| HelixRAG      | 8100  | RAG 素材检索服务   |

### 环境变量

| 变量                   | 用途                    | 必需                             |
| -------------------- | --------------------- | ------------------------------ |
| `OPENROUTER_API_KEY` | OpenRouter 模型 API Key | 可选                             |
| `ALIYUN_API_KEY`     | 阿里云模型 API Key         | 可选                             |
| `ARK_API_KEY`        | 字节火山方舟 API Key        | 可选                             |
| `TAVILY_API_KEY`     | Tavily 搜索 API Key     | 可选                             |
| `SECRET_KEY`         | 应用密钥                  | 建议                             |
| `OPENROUTE_BASE_URL` | 网页代理地址                | 默认 <http://127.0.0.1:13000/v1> |
| `HARNESS_CONFIG_PATH`| Harness 配置文件路径        | 可选，默认 `config/harness_v6.yaml` |

> 所有 API Key 均可通过 Web UI「设置 → 密钥管理」动态配置，无需重启服务。

***

## 🆕 新增开发规范（2025-05-17 更新）

### Agent 内部节点规范

- 每个 Agent 必须有明确的内部执行节点（至少 2 步）
- 每个节点必须发射事件到 EventBus：`context.event_bus.emit(task_id, "agent_name.node_name", data)`
- 事件命名规范：`{agent_name}.{node_name}_start` / `{agent_name}.{node_name}_complete`
- Agent 内部节点对应其 default_mode 的执行流程：
  - `react` → thought → action → observation（循环）
  - `reflexion` → actor → evaluator → reflector（迭代）
  - `plan_execute` → planner → executor
  - `rewoo` → blueprint → parallel_exec
  - `agent_judge` → actor → judge

### 静态/动态关系图规范

- 静态关系图：通过 `/api/v1/graph/workflows|agents|modes` API 动态生成，不写死
- 动态关系图：从 WebSocket 事件流实时构建，反映当前任务执行进度
- 设置页面提供静态关系图查看（点击弹框展示）
- 聊天窗口中展示动态节点图（实时更新执行进度）

### 模式切换 UI 规范

- 普通模式：显示 workflow 选择器，用户必须选择工作流
- Solo 模式：隐藏 workflow 选择器，AI 自主规划，中间有审核弹窗
- 全自动模式：隐藏 workflow 选择器，AI 自主完成所有任务
- 右边栏支持"编辑器"和"工作区文件"标签页切换

### YAML 配置兼容性规范

- Workflow YAML 中的步骤标识符同时支持 `name` 和 `id` 字段（`s.get("name") or s.get("id")`）
- 步骤显示名同时支持 `label` 和 `display_name` 字段
- 读取 YAML 时必须使用 `.get()` 而非 `[]` 访问，防止 KeyError
- 路径解析使用包的 `__file__` 属性（`import flowforge; os.path.dirname(flowforge.__file__)`），不使用相对路径 `../../`

### 前端路径导入规范

- Next.js App Router 中页面路径为 `src/app/settings/graphs/page.tsx`
- 从页面导入组件时，相对路径需要正确计算层级：`src/app/settings/graphs/` → `src/components/solo/` = `../../../components/solo/`
- 修改导入路径后必须在 dev server 中验证编译通过

### API 端点前缀规范

- FastAPI Router 定义 `prefix` 时，注意 `router.py` 中已有 `/api/v1` 前缀
- 子路由的 prefix 不应重复包含 `/api/v1`，否则导致双重前缀 404
- 正确示例：`router = APIRouter(prefix="/graph")` → 最终路径 `/api/v1/graph/workflows`

***

## 📅 变更日志

### 2026-05-21 (v6.0)

**架构升级**：
1. 项目定位从"Agent 编排框架"升级为"Agent Harness 平台"，引入 Harness Layer 概念
2. 架构从四层模型升级为六层模型：应用层 → 接入层 → Harness 驾驭层 → 执行引擎层 → 能力层 → 基础设施层
3. 新增 Harness 驾驭层（4 护栏）：上下文工程、架构约束、反馈循环、熵管理
4. 新增权限管线（deny → ask → allow）和会话管理器（92% 阈值压缩）

**目录结构变更**：
5. `core/` 精简为纯接口定义，`agent_registry.py` 移入 `engine/`
6. `executor/` 迁移为 `engine/`（含 AgentRegistry + ModeRegistry）
7. 新增 `harness/` 目录（context/ + constraints/ + feedback/ + entropy/）
8. 新增 `security/` 目录（权限管线 + 沙箱 + 并发安全）
9. 新增 `skills/` 目录（多格式兼容 + 触发器 + 组合技）
10. 新增 `mcp/` 目录（Client + Gateway + Broker + ToolAdapter）
11. 新增 `observability/` 目录（追踪 + 指标 + 审计日志）
12. `tools/` 重组为子目录结构：`builtin/` + `adapters/` + `publish/`

**新增铁律**：
13. 铁律 10：Harness 灰度开关 — 所有 Harness 功能必须通过 `config/harness_v6.yaml` 的 enabled 开关控制
14. 铁律 11：增量迁移 — 禁止一次性推倒重来，必须按三步增量迁移策略执行

**新增功能**：
15. FeedbackLoop 全局护栏：内环(Reflexion) + 外环(FeedbackLoop) 双层架构，支持 full/lightweight/skip 三档
16. Skill 系统：跨格式兼容（FlowForge/Claude Code/Anthropic/Trae CN），双层加载，组合技
17. MCP 模块：4 层架构（Client → Gateway → Broker → ToolAdapter），stdio + Streamable HTTP 双传输
18. 多 Agent 策略：Subagents（上下文隔离）/ Teams（TaskBoard 协作）/ Swarms（去中心化集群）
19. 轨迹记录与评估管线：记录 Agent 执行全过程的工具调用轨迹、决策点、状态变更

**配置变更**：
20. 新增 `config/harness_v6.yaml`（Harness 灰度开关配置）
21. 新增 `config/layer_mapping.yaml`（架构层映射配置）
22. 新增环境变量 `HARNESS_CONFIG_PATH`

**迁移策略**：
23. 三步增量迁移：Step 1 新增 harness/ + 灰度开关 → Step 2 重组 tools/agents + import 兼容 → Step 3 executor/→engine/ + security/observability
24. import 兼容期延至 v7.0，旧路径触发 DeprecationWarning

### 2025-05-17 (第二轮)

**完成事项**：
1. 修复 admin/models 页面崩溃 — `allProviders` API 返回对象数组被当字符串渲染，添加类型安全提取函数
2. 修复 CSS 变量拼接无效 — `var(--ok)1a` 改为 `var(--ok-subtle)` 等正确写法
3. 删除全局依赖关系图功能 — 移除 `dependency_graph.py` 和 `/admin/graph` 页面及导航项
4. 添加系统设置导航 — 新增"系统设置"分组（关系图/提示词管理/记忆管理）
5. 性能优化 — 添加 `useFetchWithCache` hook（30s TTL + 请求去重），仪表盘和模型页按需加载
6. 动态图层级化重构 — 从简单线性列表改为 workflow→agent→mode_step 层级卡片，显示 agent 头像、mode 徽章、实时动画、输出摘要
7. 静态图增强 — 支持可展开子图（agent 展开显示 mode 内部步骤），workflow 图显示每个步骤的 mode 子图
8. 后端 graph.py 增强 — 提取 `MODE_GRAPH_DEFS` 共享常量，agent/mode graph 返回内部执行步骤和迭代边
9. 聊天上下文修复 — 同一任务内发消息共享上下文，只有终态（idle/completed/error/rejected）才创建新任务
10. settings/graphs 页面改为卡片式设计，使用 display_name 和 description

**踩坑记录**：
- API 返回的数组元素可能是对象而非字符串，必须做类型检查后再渲染
- CSS 不支持 `var(--color)1a` 这种 token 拼接，必须使用预定义的 subtle 变量
- Next.js 首次编译每个页面需要 30-170 秒，测试时需要耐心等待
- React Error Boundary 是防止页面白屏的必备防线

### 2025-05-17 (第一轮)

**完成事项**：
1. 提示词完全外置 — 47 个提示词 key 迁移到 `config/prompts.yaml`，所有 Agent/Tool/Mode 通过 `get_prompt()` 获取
2. 提示词管理 API + 前端页面 — `/settings/prompts` 支持查看和编辑
3. Memory 管理 API + 前端页面 — `/settings/memory` 支持查看和删除
4. 静态关系图 API + 前端页面 — `/settings/graphs` 点击弹框展示 workflow/agent/mode 依赖图
5. 动态节点图组件 — 聊天窗口中实时展示执行进度
6. SoloLayout 组件化重构 — 从 1575 行拆分为 9 个独立组件文件（每个 < 300 行）
7. 模式切换 UI — 普通/Solo/全自动三模式切换，workflow 选择器联动
8. 右边栏标签页 — 编辑器/工作区文件切换
9. 15 个 Agent 全部重写为多节点内部执行流程
10. 9 个模式执行器修复 LLM 调用参数
11. graph.py 修复 workflows 路径和 YAML 兼容性问题

**踩坑记录**：
- `__file__` 相对路径在 uvicorn 运行时可能解析不正确，改用 `import flowforge` 包路径
- Workflow YAML 中步骤标识符有 `name` 和 `id` 两种格式，必须兼容
- FastAPI Router prefix 容易双重叠加，子路由 prefix 不应包含 `/api/v1`
- Next.js 页面导入组件的相对路径需要仔细计算层级
