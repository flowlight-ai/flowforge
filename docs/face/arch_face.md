# FlowForge v3.0 Agent Harness 架构详设 — arch_face

> **版本**：v3.0-face
> **日期**：2026-07-14
> **定位**：本文档为 `spec_face.md` 的架构落地详设，聚焦 P0 模块（M1-M5）+ 关键 P1 模块架构设计。
> **前置依赖**：`flowforge/docs/spec.md` v2.1、`flowforge/docs/arch.md`、`spec_face.md`
> **规范约束**：严格遵守 `hiclaw/rules.md`、`hiclaw/prompts.md`、单向依赖、DI 合规、配置驱动。

---

## 第一章：总体架构演进

### 1.1 从六层到七层

v2.1 六层架构 → v3.0 新增第 7 层"互联层"，并强化 2/3/4 层：

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 7. 互联层 (Interconnect Layer) ★ v3.0 新增                                │
│    A2A Server/Client | ACP Orchestrator | Agent Directory | 租户路由       │
├──────────────────────────────────────────────────────────────────────────┤
│ 6. 应用层 (Application Layer)                                              │
│    ContentForge / NovelForge / DevForge / MallForge / StockForge          │
├──────────────────────────────────────────────────────────────────────────┤
│ 5. 接入层 (Gateway Layer)                                                  │
│    FastAPI REST + WebSocket(Helm/Events) + Web UI + CLI + A2A Endpoint    │
├──────────────────────────────────────────────────────────────────────────┤
│ 4. Harness 驾驭层 (Harness Layer) ★ v3.0 强化                              │
│    Context Eng 2.0(JIT/MemoryTool/Editing) | 六层 Guardrails | 反馈循环    │
│    熵管理 | HITL(CHEQ) | AgentBOM | Blast-radius | 权限管线              │
├──────────────────────────────────────────────────────────────────────────┤
│ 3. 执行引擎层 (Engine Layer) ★ v3.0 强化                                   │
│    HybridExecutor(TAOR) | 9大模式 | Durable Execution | Long-Run Mgr     │
│    Scheduler | PreFlect | VIGIL | SAGE                                    │
├──────────────────────────────────────────────────────────────────────────┤
│ 2. 能力层 (Capability Layer) ★ v3.0 强化                                   │
│    MCP 2026(Stateless/Apps/OAuth) | Skill市场 | Prompt Cache              │
│    Agent库 | Memory(Enhanced) | Computer Use | Browser Agent             │
├──────────────────────────────────────────────────────────────────────────┤
│ 1. 基础设施层 (Infrastructure Layer) ★ v3.0 强化                           │
│    SQLite/PostgreSQL | Redis | Qdrant | LangGraph | OTel Collector        │
│    LLM API(多Provider配额池) | A2A Registry | Eval Backend                │
└──────────────────────────────────────────────────────────────────────────┘
```

### 1.2 架构演进原则

| 原则 | 说明 |
|------|------|
| **协议优先** | 优先采用国际标准（MCP 2026 / A2A / OTel GenAI / IETF CHEQ） |
| **向后兼容** | v2.1 接口不破坏，新能力通过 Feature Flag 渐进启用 |
| **配置驱动** | 所有策略 YAML 化，禁止硬编码（红线 11） |
| **DI 合规** | 所有新组件通过 DI 容器注入（红线 12） |
| **单向依赖** | 上层→下层，FlowForge 禁止 import *Forge |
| **可观测默认** | 所有 Agent/Tool/Loop 自动埋点 OTel Trace |
| **治理即代码** | 策略 YAML + CI/CD 门禁 |

### 1.3 控制回路演进

v2.1 控制回路（前馈+反馈+熵管理）→ v3.0 新增 4 条回路：

```
                         ┌─────────────┐
                         │ 用户意图     │
                         └──────┬──────┘
                                ▼
┌─────────────────────────────────────────────────────────────┐
│ 前馈控制（沿用 v2.1）                                         │
│ AGENTS.md | Skill 注入 | Linter | 权限管线                    │
└─────────────────────┬───────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ v3.0 新增：Durable 持久回路                                   │
│ 每个 Step 写入 Durable Event Log → 故障从 Checkpoint 恢复     │
└─────────────────────┬───────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Agent 执行（9 大模式，每步 OTel Span）                        │
│ 工具调用：MCP 2026 / A2A / Skill                              │
└─────────────────────┬───────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ v3.0 新增：CHEQ 中断点                                       │
│ HITL 中断持久化 → 重启后自动恢复至中断状态                    │
└─────────────────────┬───────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ 反馈控制（沿用 v2.1）+ v3.0 强化                              │
│ 六层 Guardrails 后馈验证 | Reflexion/PreFlect/VIGIL/SAGE     │
└─────────────────────┬───────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ v3.0 新增：Eval-gated 闭环                                   │
│ 金丝雀发布前自动跑 τ-bench → pass^k 未达标自动回滚            │
└─────────────────────┬───────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ v3.0 新增：Blast-radius 闸门                                 │
│ 高风险 Action 影响范围评估 → 双签/升级审批                    │
└─────────────────────┬───────────────────────────────────────┘
                      ▼
                 AgentBOM 落库 + 审计
```

### 1.4 核心数据流（端到端）

```
用户意图
  → Gateway（认证 + 限流 + 租户路由 + A2A Endpoint）
  → Harness（Context Eng JIT 注入 + 六层 Guardrails 前馈 + AgentBOM 加载）
  → Engine（Durable Execution 启动 + PreFlect 预检 + OTel Span 开启）
  → 9 大模式执行（每步 Checkpoint + OTel Span + VIGIL 监控）
  → 工具调用（MCP 2026 / A2A / Skill，全部沙箱化）
  → HITL 中断点（CHEQ 持久化，可恢复）
  → 输出（六层 Guardrails 后馈验证 + T7 LLM 审核）
  → Eval-gated 发布门禁（τ-bench pass^k）
  → 反馈循环（Reflexion / VIGIL / SAGE）
  → AgentBOM 落库 + 审计链 + OTel Trace 上报
```

---

## 第二章：M1 A2A 协议集成架构详设

### 2.1 组件总览

```
┌─────────────────────────────────────────────────────────────┐
│ 互联层 (Interconnect Layer)                                  │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ A2A Server   │  │ A2A Client   │  │ Agent        │        │
│  │ (FastAPI     │  │ (ToolRegistry│  │ Directory    │        │
│  │  Routes)     │  │  工具)       │  │ (注册中心)   │        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
│         │                  │                  │              │
│         ▼                  ▼                  ▼              │
│  ┌──────────────────────────────────────────────────┐        │
│  │ A2A Protocol Layer (协议适配)                     │        │
│  │  · Agent Card 生成/解析                            │        │
│  │  · Task 生命周期管理                               │        │
│  │  · SSE 流式响应                                   │        │
│  │  · 鉴权 (Bearer/OAuth2/JWT)                       │        │
│  └──────────────────────────────────────────────────┘        │
│         │                  │                  │              │
│         ▼                  ▼                  ▼              │
│  ┌──────────────────────────────────────────────────┐        │
│  │ 现有 FlowForge 基础设施                           │        │
│  │  · TaskStore (任务持久化)                          │        │
│  │  · EventBus (事件总线)                             │        │
│  │  · HybridExecutor (执行引擎)                       │        │
│  │  · ToolRegistry (工具注册)                         │        │
│  │  · OTel Tracing (可观测)                           │        │
│  └──────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 A2A Server 设计

**职责**：将 FlowForge Agent 暴露为符合 A2A 协议的 HTTP 服务端点。

**路由设计**（复用 FastAPI，不另起服务）：

| 路由 | 方法 | 说明 |
|------|------|------|
| `/.well-known/agent.json` | GET | Agent Card 自动发现 |
| `/a2a/{agent_id}/tasks` | POST | 下发任务（同步返回 task_id） |
| `/a2a/{agent_id}/tasks/{task_id}/status` | GET | 查询任务状态 |
| `/a2a/{agent_id}/tasks/{task_id}/result` | GET | 获取任务结果 |
| `/a2a/{agent_id}/tasks/{task_id}` | DELETE | 取消任务 |
| `/a2a/{agent_id}/stream` | POST | SSE 流式任务 |
| `/a2a/{agent_id}/tasks/{task_id}/subscribe` | POST | 订阅长任务推送 |
| `/a2a/directory/search` | GET | Agent 目录查询 |

**组件设计**：

```python
# flowforge/interconnect/a2a/server.py（新增模块）

class A2AServer:
    """A2A 协议服务端 — 将 FlowForge Agent 暴露为 A2A Endpoint。
    
    设计要点：
    - 复用 FastAPI 路由，不另起服务
    - 通过 DI 注入 AgentRegistry / TaskStore / HybridExecutor
    - 所有调用 OTel Trace
    - Agent Card YAML 配置化
    """
    
    def __init__(
        self,
        agent_registry: AgentRegistry,    # DI: Agent 注册中心
        task_store: TaskStore,             # DI: 任务持久化
        executor: HybridExecutor,          # DI: 执行引擎
        directory: AgentDirectory,         # DI: Agent 目录
        auth: A2AAuthenticator,            # DI: 鉴权器
        tracer: Tracer,                    # DI: OTel Tracer
    ):
        ...
    
    async def create_task(
        self, agent_id: str, request: A2ATaskRequest, tenant_id: str
    ) -> A2ATaskResponse:
        """下发 A2A 任务 — 复用 HybridExecutor 异步执行。"""
        ...
    
    async def stream_task(self, agent_id: str, request: A2ATaskRequest) -> AsyncIterator[str]:
        """SSE 流式任务 — 复用 Helm WebSocket 推送机制。"""
        ...
```

### 2.3 A2A Client 设计

**职责**：让 FlowForge Agent 可作为客户端调用外部 A2A Agent。

**通过 ToolRegistry 注册为工具**（遵守 DI 铁律 3）：

```python
# flowforge/interconnect/a2a/client.py（新增模块）

class A2AClientTool(BaseTool):
    """A2A 客户端工具 — 通过 ToolRegistry 注册，供 Agent 调用外部 A2A Agent。
    
    设计要点：
    - 继承 BaseTool，通过 DI 注入
    - 自动发现外部 Agent Card
    - 支持同步/流式两种调用模式
    - 支持长任务轮询/订阅
    """
    
    name = "a2a_invoke"
    description = "调用外部 A2A Agent 执行任务"
    
    async def execute(
        self,
        agent_url: str,           # 目标 Agent 的 base URL
        task_input: dict,          # 任务输入
        streaming: bool = False,   # 是否流式
        timeout: int = 300,        # 超时秒数
    ) -> ToolResult:
        ...
```

### 2.4 Agent Card 设计

**YAML 配置化**（红线 11）：

```yaml
# config/agent_cards/contentforge_writer.yaml
agent_id: contentforge:writer
name: ContentForge Writer
description: AI content writer specialized in Chinese long-form articles
version: 3.0.0
url: https://flowforge.local:8001/a2a/contentforge:writer

capabilities:
  streaming: true
  push_notifications: true
  state_transition: true

skills:
  - id: long_form_writing
    name: Long-form Article Writing
    description: 撰写中文长文章（2000-5000 字）
    tags: ["content", "chinese", "long-form"]
    input_schema:
      type: object
      properties:
        topic: {type: string}
        persona: {type: string}
        word_count: {type: integer}
  - id: seo_optimization
    name: SEO Optimization
    tags: ["seo", "content"]

authentication:
  schemes: ["bearer", "oauth2"]
  oauth2:
    token_url: https://flowforge.local/auth/oauth2/token
    scopes: ["a2a:tasks"]

default_input_modes: ["text", "json", "file"]
default_output_modes: ["text", "json", "markdown"]
```

### 2.5 Agent Directory 设计

**职责**：内部 Agent 注册中心，自动扫描所有 *Forge 项目生成 Agent Card。

```python
# flowforge/interconnect/a2a/directory.py

class AgentDirectory:
    """Agent 目录 — 自动发现 + 手动注册 + 联邦查询。
    
    设计要点：
    - 启动时扫描 config/agent_cards/*.yaml
    - 支持手动 register/unregister
    - 支持联邦查询（跨实例）
    - 缓存 + 定时刷新
    """
    
    async def search(
        self, skill: str = None, tags: list = None, federation: bool = False
    ) -> list[AgentCard]:
        ...
```

### 2.6 鉴权设计

```
请求 → Gateway（API Key 认证 + 限流）
       → A2A Server（Bearer Token / OAuth2 校验）
         → Agent 执行（Tenant 上下文注入）
           → 工具调用（权限管线二次校验）
```

| 鉴权方式 | 场景 | 实现 |
|---------|------|------|
| Bearer Token | 内部调用 | API Key + JWT 签名 |
| OAuth2 Client Credentials | 跨厂调用 | 标准 OAuth2 流程 |
| mTLS | 高安全场景 | 双向 TLS 证书 |

### 2.7 数据模型

```python
# flowforge/interconnect/a2a/models.py（Pydantic 模型）

class A2ATaskRequest(BaseModel):
    task_id: str = Field(default_factory=lambda: str(uuid4()))  # 客户端可选指定
    input: dict | str                                          # 任务输入
    input_mode: str = "text"                                   # text/json/file
    output_mode: str = "text"                                  # text/json/markdown
    streaming: bool = False
    push_notification_url: str | None = None
    metadata: dict = {}

class A2ATaskStatus(BaseModel):
    task_id: str
    state: Literal["pending", "running", "completed", "failed", "cancelled"]
    progress: float = 0.0                                      # 0.0-1.0
    created_at: datetime
    updated_at: datetime
    error: str | None = None

class A2ATaskResult(BaseModel):
    task_id: str
    output: dict | str
    output_mode: str
    artifacts: list[Artifact] = []                              # 产出物（文件/链接）
```

### 2.8 时序图：A2A 任务完整流程

```
外部Client          Gateway         A2AServer        HybridExecutor     Agent        ToolRegistry
    │                  │                │                  │              │              │
    │──POST /tasks───►│                │                  │              │              │
    │                  │──auth+route──►│                  │              │              │
    │                  │                │──create_task────►│              │              │
    │                  │                │                  │──execute────►│              │
    │                  │                │                  │              │──a2a_invoke─►│ (调用外部)
    │                  │                │                  │              │◄──result─────│
    │                  │                │                  │◄──output─────│              │
    │                  │                │◄──status────────│              │              │
    │◄─202 task_id─────┤◄─task_id───────┤                  │              │              │
    │                  │                │                  │              │              │
    │──GET /status────►│                │                  │              │              │
    │◄─running─────────┤◄───────────────┤                  │              │              │
    │                  │                │                  │              │              │
    │──GET /result────►│                │                  │              │              │
    │◄─completed───────┤◄───────────────┤                  │              │              │
```

### 2.9 与现有系统集成点

| 现有模块 | 集成方式 |
|---------|---------|
| `app/api/router.py` | 新增 A2A 路由组 |
| `core/task_store.py` | 复用任务持久化（扩展 state 字段） |
| `executor/hybrid_executor.py` | 复用执行引擎（异步执行 A2A 任务） |
| `core/agent_registry.py` | 复用 Agent 注册（生成 Agent Card） |
| `tools/registry.py` | 注册 `a2a_invoke` 工具 |
| `core/tracing.py` | 所有 A2A 调用 OTel Span |
| `middleware/auth.py` | 扩展 A2A 鉴权中间件 |
| `core/di.py` | A2A 组件通过 DI 注入 |

### 2.10 新增目录结构

```
flowforge/interconnect/          ★ v3.0 新增
├── __init__.py
├── a2a/
│   ├── __init__.py
│   ├── server.py                # A2A Server
│   ├── client.py                # A2A Client (Tool)
│   ├── directory.py             # Agent Directory
│   ├── authenticator.py         # 鉴权器
│   ├── card_builder.py          # Agent Card 生成器
│   ├── models.py                # Pydantic 数据模型
│   └── routes.py                # FastAPI 路由
├── acp/                         # P2 (M14)
│   ├── __init__.py
│   └── orchestrator.py
└── README.md
```

---

## 第三章：M2 MCP 2026 Spec RC 架构详设

### 3.1 组件总览

```
┌─────────────────────────────────────────────────────────────┐
│ 能力层 (Capability Layer) - MCP 2026                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ MCP Gateway   │  │ MCP Client   │  │ MCP Manifest │        │
│  │ (企业网关)    │  │ (Agent 端)   │  │ Registry     │        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
│         │                  │                  │              │
│         ▼                  ▼                  ▼              │
│  ┌──────────────────────────────────────────────────┐        │
│  │ MCP 2026 Protocol Layer                           │        │
│  │  · Stateless Core (状态外置 Redis)                │        │
│  │  · OAuth Authorization Code Flow                  │        │
│  │  · Tool Result Elision (结果裁剪)                │        │
│  │  · MCP Apps (Manifest 自动发现)                   │        │
│  └──────────────────────────────────────────────────┘        │
│         │                  │                  │              │
│         ▼                  ▼                  ▼              │
│  ┌──────────────────────────────────────────────────┐        │
│  │ Tool Sandbox (隔离执行)                           │        │
│  │  · Docker per tool (资源隔离)                     │        │
│  │  · Network Egress Allowlist                       │        │
│  │  · CVE-2025-47241 修复                            │        │
│  └──────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Stateless Core 设计

**核心思想**：MCP Server 无状态，所有状态由 Client 维护（Session ID 透传），Server 可水平扩展。

```
MCP Client                     MCP Server (无状态)           Redis (状态外置)
    │                              │                            │
    │──call(session_id, tool)─────►│                            │
    │                              │──get_state(session_id)────►│
    │                              │◄──state────────────────────│
    │                              │──execute(tool)────────────►│
    │                              │──set_state(session_id)────►│
    │◄──result─────────────────────│                            │
```

**现有 `flowforge/mcp/` 重构**：
- `mcp/server.py` → 移除状态字段，所有状态读写走 Redis
- `mcp/broker.py` → 增加 Session 状态路由
- `mcp/client.py` → 增加 Session ID 透传

### 3.3 MCP Apps 设计

**Manifest 自动发现**：

```yaml
# .well-known/mcp-manifest.json (MCP Server 自动暴露)
name: stockforge-data-tools
version: 3.0.0
description: StockForge 专业数据源 MCP 工具集
tools:
  - name: tushare_daily
    description: 获取股票日线数据
    input_schema: {...}
  - name: akshare_stock
    description: AkShare 股票数据
    input_schema: {...}
oauth:
  authorization_url: https://flowforge.local/auth/oauth2/authorize
  token_url: https://flowforge.local/auth/oauth2/token
  scopes: ["mcp:tools:read", "mcp:tools:write"]
sandbox:
  container: true
  network_egress_allowlist:
    - "api.tushare.pro"
    - "akshare.akfamily.xyz"
```

### 3.4 Tool Result Elision 设计

```python
# flowforge/mcp/elision.py（新增模块）

class ToolResultElision:
    """工具结果自动裁剪 — 与 M3 Context Editing 协同。
    
    策略：
    - > 4K tokens: 自动摘要
    - 历史 N 次后: 折叠为摘要
    - 配置驱动 (YAML)
    """
    
    async def elide(self, result: ToolResult, context: ElisionContext) -> ToolResult:
        if result.token_count > self.threshold:
            summary = await self._summarize(result)
            return result.with_summary(summary)
        return result
```

### 3.5 OAuth Authorization Code Flow

```
用户 → Agent → MCP Client → MCP Server (redirect)
                            ↓
                    用户授权页 (FlowForge Web UI)
                            ↓
                    Authorization Code
                            ↓
                    MCP Client → Token Endpoint → Access Token
                            ↓
                    MCP Client → MCP Server (Bearer Token)
```

**设计要点**：
- 用户级授权（非全局 API Key）
- 授权令牌加密存储（复用 `core/secret_store.py`）
- Token 刷新机制
- 与 M16 多租户协同

### 3.6 Tool Sandbox 强化

```yaml
# config/mcp_sandbox/policy.yaml
default:
  container: true
  cpu_limit: "0.5"
  memory_limit: "512m"
  network_egress: allowlist
  timeout: 30

tools:
  tushare_daily:
    network_egress_allowlist:
      - "api.tushare.pro"
  python_executor:
    cpu_limit: "1.0"
    memory_limit: "1g"
    timeout: 60
```

**CVE-2025-47241 修复**：
- 路径遍历防护（`path.normalize()` + 白名单）
- YAML 安全加载（`yaml.safe_load()` 已有，强化 schema 校验）
- 依赖版本锁定（`requirements.txt` pin）

### 3.7 与现有系统集成点

| 现有模块 | 集成方式 |
|---------|---------|
| `flowforge/mcp/` | 重构为 v2026 RC 兼容 |
| `core/native_tool_server.py` | 升级沙箱执行 |
| `tools/registry.py` | MCP 工具自动注册 |
| `core/secret_store.py` | OAuth Token 加密存储 |
| `middleware/auth.py` | OAuth Authorization Code Flow |
| `core/di.py` | MCP 组件 DI 注入 |

---

## 第四章：M3 Context Engineering 2.0 架构详设

### 4.1 组件总览

```
┌─────────────────────────────────────────────────────────────┐
│ Harness 驾驭层 - Context Engineering 2.0                    │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ JIT Context  │  │ Memory Tool  │  │ Context      │        │
│  │ Injector     │  │ (4 API)      │  │ Editor       │        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
│         │                  │                  │              │
│         ▼                  ▼                  ▼              │
│  ┌──────────────────────────────────────────────────┐        │
│  │ Context Layer Manager (升级)                      │        │
│  │  · System (永久) | Persona (持久)                 │        │
│  │  · Task (会话) | Working (即时)                   │        │
│  │  · lazy: true (按需加载)                          │        │
│  │  · priority (Token 不足时丢弃)                    │        │
│  └──────────────────────────────────────────────────┘        │
│         │                  │                  │              │
│         ▼                  ▼                  ▼              │
│  ┌──────────────────────────────────────────────────┐        │
│  │ Memory System (增强)                              │        │
│  │  · Short/Long/Episodic/Working/Semantic          │        │
│  │  · Mailbox/Task Board/Compressor                  │        │
│  │  · + Memory Tool API (新增)                       │        │
│  └──────────────────────────────────────────────────┘        │
│         │                  │                  │              │
│         ▼                  ▼                  ▼              │
│  ┌──────────────────────────────────────────────────┐        │
│  │ Context Cache (与 M9 Prompt Caching 协同)          │        │
│  └──────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 JIT Context 注入设计

**核心思想**：Agent 执行前不预加载所有上下文，通过 `context_fetch` 工具按需获取。

```python
# flowforge/harness/context_engine.py（升级现有模块）

class ContextEngine:
    """Context Engineering 2.0 核心引擎。
    
    设计要点：
    - JIT 注入：Agent 执行前不预加载，按需 fetch
    - Layer 分层：System/Persona/Task/Working
    - lazy 标记：声明 lazy 的层按需加载
    - priority：Token 不足时优先丢弃低优先级
    """
    
    async def build_context(
        self, agent_id: str, task_input: dict, session_id: str
    ) -> ContextBundle:
        """构建上下文 — JIT 模式。
        
        步骤：
        1. 加载 System 层（永久，必加载）
        2. 加载 Persona 层（持久，必加载）
        3. Task 层标记 lazy 的不加载，等 Agent 调用 context_fetch
        4. Working 层全部 lazy
        5. Token 预算检查，超限触发 Context Editing
        """
        ...
    
    async def fetch(self, layer: str, key: str = None) -> str:
        """Agent 按需获取上下文（通过 ToolRegistry 注册为工具）。"""
        ...
```

### 4.3 Memory Tool 设计

**让 LLM 自己管理上下文**，取代"系统提示词硬塞"模式：

```python
# flowforge/harness/memory_tool.py（新增模块）

class MemoryTool(BaseTool):
    """Memory Tool — 让 LLM 自己管理记忆。
    
    4 个 API：
    - memory_save(key, value, ttl, scope)
    - memory_recall(query, top_k)
    - memory_forget(key)
    - memory_compress(threshold)
    
    通过 ToolRegistry 注册，遵守 DI。
    """
    
    async def memory_save(
        self, key: str, value: str, ttl: int = 3600, scope: str = "session"
    ) -> ToolResult:
        """保存记忆 — scope: session/task/agent/global"""
        ...
    
    async def memory_recall(self, query: str, top_k: int = 5) -> ToolResult:
        """语义检索记忆"""
        ...
    
    async def memory_forget(self, key: str) -> ToolResult:
        """主动遗忘"""
        ...
    
    async def memory_compress(self, threshold: float = 0.8) -> ToolResult:
        """压缩旧记忆"""
        ...
```

### 4.4 Context Editing 设计

```python
# flowforge/harness/context_editor.py（新增模块）

class ContextEditor:
    """上下文自动裁剪 — Token 预算管理。
    
    策略（YAML 配置）：
    - token_budget: 32000           # 单次 Agent 调用上限
    - history_window: keep_first_last  # 保留首尾，中间摘要
    - tool_result_elision: true      # 工具结果折叠（与 M2 协同）
    - dialogue_compression: true     # 多轮对话自动总结
    - summary_trigger: 50_rounds     # 50 轮后触发压缩
    """
    
    async def edit(self, context: ContextBundle, budget: int) -> ContextBundle:
        """裁剪上下文至预算内。"""
        if context.token_count <= budget:
            return context
        # 1. 折叠旧工具结果
        # 2. 摘要历史对话
        # 3. 丢弃低优先级层
        ...
```

### 4.5 Context Layer Manager 升级

**现有 `core/context_layer_manager.py` 升级**：

```yaml
# config/context_engine/layers.yaml
layers:
  system:
    priority: 100           # 最高优先级
    lazy: false              # 必加载
    cache: true              # Cache 命中免重算
    source: AGENTS.md
  
  persona:
    priority: 90
    lazy: false
    cache: true
    source: config/personas/*.yaml
  
  task:
    priority: 70
    lazy: true               # 按需加载
    cache: false
    source: TaskStore
  
  working:
    priority: 50
    lazy: true
    cache: false
    source: WorkingMemory
    
  episodic:
    priority: 30
    lazy: true
    cache: false
    source: EpisodicMemory
```

### 4.6 Context Caching（与 M9 协同）

```
Agent 调用 → 检查 Cache (content hash)
  ├── Hit → 直接返回（免重算）
  └── Miss → 构建 Context → 写入 Cache → 返回
```

- System/Persona 层 Cache（命中率最高）
- Cache Key: `sha256(content + persona_id + agent_id)`
- TTL: 默认 1h，Persona 更新触发主动失效
- Cache 失效率监控（OTel Metric）

### 4.7 与现有系统集成点

| 现有模块 | 集成方式 |
|---------|---------|
| `harness/context_engine.py` | 升级为 JIT 模式 |
| `core/context_layer_manager.py` | 升级支持 lazy + priority |
| `memory/` | 全部 Memory store 增强 + Memory Tool API |
| `tools/registry.py` | 注册 context_fetch / memory_* 工具 |
| `loop/executor.py` | Loop 每步构建 Context |
| `core/tracing.py` | Context 操作 OTel Span |
| `core/di.py` | Context 组件 DI 注入 |

---

## 第五章：M4 六层 Guardrails 架构详设

### 5.1 六层架构总览

```
请求进入 → [L1 Input Validation] → [L2 System Prompt] → Agent 执行
                                                              ↓
输出 ← [L6 Cost Ceilings] ← [L5 Action Confirm] ← [L4 Output Validation] ← [L3 Tool Allowlist]
```

### 5.2 Layer 1: Input Validation

```python
# flowforge/security/guardrails/input_validator.py

class InputValidator:
    """输入验证 — Prompt Injection / Jailbreak / PII / 长度。"""
    
    async def validate(self, input: str, context: ValidationContext) -> ValidationResult:
        checks = [
            self._check_prompt_injection(input),    # LLM-as-Judge
            self._check_jailbreak(input),           # 关键词+模式
            self._check_pii(input),                 # 身份证/手机/邮箱/银行卡
            self._check_length(input),              # 长度限制
            self._check_language(input),            # 多语言识别
        ]
        ...
```

### 5.3 Layer 2: System Prompt Constraints

**自动注入**：
- `AGENTS.md`（项目规则）
- Skill 白名单
- Linter 规则
- 权限管线（M11 CHEQ）

**防泄露**：
- System Prompt 标记为 `system` role
- 输出过滤（检测是否泄露 system prompt 内容）
- 与 M5 OTel Trace 协同（记录注入内容）

### 5.4 Layer 3: Tool Allow-lists

```yaml
# config/guardrails/tool_allowlist.yaml
agents:
  contentforge:writer:
    tools:
      - web_search
      - opensieve_search
      - memory_recall
      - context_fetch
    rate_limit: 30/min
    param_schema_validation: true
  
  devforge:coder:
    tools:
      - python_executor
      - git_operations
      - code_quality
    rate_limit: 60/min
```

### 5.5 Layer 4: Output Validation

```python
# flowforge/security/guardrails/output_validator.py

class OutputValidator:
    """输出验证 — 内容审核/事实核查/代码安全/AI痕迹/格式。"""
    
    async def validate(self, output: str, context: ValidationContext) -> ValidationResult:
        checks = [
            self._content_moderation(output),       # 豆包 moderation
            self._fact_check(output),              # fact_check 工具
            self._code_security_scan(output),       # bandit/semgrep
            self._ai_flavor_detection(output),     # T7 标准
            self._format_validation(output),        # JSON Schema/Markdown
        ]
        ...
```

### 5.6 Layer 5: Action Confirmation

```yaml
# config/guardrails/action_confirmation.yaml
high_risk_actions:
  - name: publish_to_production
    description: 发布到生产环境
    blast_radius_threshold: 100       # 影响范围 > 100 触发双人审批
    revocation_window: 24h            # 24h 内可撤销
    approvers:
      role: [admin, publisher]
      min_count: 2                    # 双签
  
  - name: database_migration
    blast_radius_threshold: 10
    revocation_window: 1h
    approvers:
      role: [dba]
      min_count: 2
  
  - name: deployment
    blast_radius_threshold: 50
    revocation_window: 2h
    approvers:
      role: [devops]
      min_count: 1
```

### 5.7 Layer 6: Cost Ceilings

```python
# flowforge/security/guardrails/cost_ceiling.py

class CostCeiling:
    """成本上限 — 会话/日/月。"""
    
    async def check(self, tenant_id: str, agent_id: str) -> CostCheckResult:
        session_cost = await self._get_session_cost(...)
        if session_cost > self.config.session_limit:
            return CostCheckResult(blocked=True, reason="session_limit_exceeded")
        ...
```

### 5.8 Guardrails 编排器

```python
# flowforge/security/guardrails/orchestrator.py

class GuardrailsOrchestrator:
    """六层 Guardrails 编排 — 前馈(执行前) + 后馈(执行后)。"""
    
    async def pre_check(self, request: AgentRequest) -> GuardrailsResult:
        """前馈：L1 Input + L2 System Prompt + L3 Tool Allowlist"""
        ...
    
    async def post_check(self, response: AgentResponse) -> GuardrailsResult:
        """后馈：L4 Output + L5 Action Confirm + L6 Cost"""
        ...
```

### 5.9 与现有系统集成点

| 现有模块 | 集成方式 |
|---------|---------|
| `security/permission_pipeline.py` | 升级为 L2/L3 |
| `security/moderation.py` | 升级为 L4 内容审核 |
| `security/arch_constraint.py` | 架构约束 |
| `core/circuit_breaker.py` | L6 Cost 超限熔断 |
| `core/gate/orchestrator.py` | L5 Action Confirm |
| `tools/registry.py` | L3 工具白名单校验 |
| `core/di.py` | Guardrails 组件 DI 注入 |

### 5.10 新增目录结构

```
flowforge/security/guardrails/    ★ v3.0 新增
├── __init__.py
├── input_validator.py            # L1
├── system_prompt_guard.py        # L2
├── tool_allowlist.py             # L3
├── output_validator.py           # L4
├── action_confirmation.py        # L5
├── cost_ceiling.py               # L6
└── orchestrator.py               # 编排器
```

---

## 第六章：M5 OTel GenAI v1.30 架构详设

### 6.1 组件总览

```
┌─────────────────────────────────────────────────────────────┐
│ 可观测性 - OpenTelemetry GenAI v1.30                         │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ OTel Tracer  │  │ OTel Meter   │  │ Eval-Gated   │        │
│  │ (gen_ai.*)   │  │ (Metrics)    │  │ Deploy Gate  │        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
│         │                  │                  │              │
│         ▼                  ▼                  ▼              │
│  ┌──────────────────────────────────────────────────┐        │
│  │ Exporter Layer (多后端)                            │        │
│  │  · OTLP gRPC (默认)                               │        │
│  │  · LangSmith / Langfuse / Phoenix                │        │
│  └──────────────────────────────────────────────────┘        │
│         │                  │                  │              │
│         ▼                  ▼                  ▼              │
│  ┌──────────────────────────────────────────────────┐        │
│  │ OTel Collector (基础设施)                         │        │
│  └──────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 gen_ai Span Schema

```python
# flowforge/observability/genai_tracer.py（升级现有模块）

class GenAITracer:
    """OTel GenAI v1.30 标准化 Tracer。"""
    
    @tracer.start_as_current_span("gen_ai.llm")
    async def trace_llm_call(
        self, model: str, input: dict, output: dict, usage: dict
    ) -> Span:
        span = trace.get_current_span()
        span.set_attributes({
            "gen_ai.system": "openroute",
            "gen_ai.request.model": model,
            "gen_ai.usage.input_tokens": usage["input_tokens"],
            "gen_ai.usage.output_tokens": usage["output_tokens"],
            "gen_ai.response.finish_reason": output["finish_reason"],
            "gen_ai.prompt": json.dumps(input),       # 完整 prompt
            "gen_ai.completion": json.dumps(output),  # 完整 completion
        })
    
    @tracer.start_as_current_span("gen_ai.tool")
    async def trace_tool_call(self, tool_name: str, input: dict, output: dict): ...
    
    @tracer.start_as_current_span("gen_ai.agent")
    async def trace_agent_exec(self, agent_id: str, input: dict): ...
```

### 6.3 Span 层级关系

```
trace (root): user_request
├── span: gateway.handle
│   ├── span: guardrails.pre_check
│   ├── span: gen_ai.agent (contentforge:writer)
│   │   ├── span: context_engine.build_context
│   │   │   └── span: memory.recall
│   │   ├── span: gen_ai.llm (DeepSeek-V4-Pro)
│   │   │   └── attributes: gen_ai.usage.*
│   │   ├── span: gen_ai.tool (web_search)
│   │   │   └── span: mcp.call (duckduckgo)
│   │   ├── span: gen_ai.llm (第2次调用)
│   │   └── span: guardrails.post_check
│   │       └── span: output_validation.content_moderation
│   └── span: hitl.checkpoint
└── span: audit.log
```

### 6.4 Metrics 标准化

| Metric | 类型 | 说明 |
|--------|------|------|
| `gen_ai.client.token_usage` | Counter | Token 使用量 |
| `gen_ai.client.operation_duration` | Histogram | 操作延迟 |
| `gen_ai.server.active_requests` | UpDownCounter | 活跃请求数 |
| `flowforge.cache.hit_rate` | Gauge | Cache 命中率 |
| `flowforge.guardrails.block_count` | Counter | Guardrails 拦截数 |
| `flowforge.a2a.task_duration` | Histogram | A2A 任务延迟 |

### 6.5 Eval-gated Deployment

```python
# flowforge/observability/eval_gate.py（新增模块）

class EvalGatedDeploy:
    """评估驱动发布门禁。"""
    
    async def pre_deploy_check(self, version: str) -> DeployDecision:
        """发布前自动跑 τ-bench。"""
        results = await self._run_tau_bench(version, k=5)
        pass_rate = results.pass_count / k
        if pass_rate < self.config.pass_threshold:  # 默认 0.8
            return DeployDecision(blocked=True, reason=f"pass^5={pass_rate}")
        return DeployDecision(allowed=True)
```

### 6.6 Exporter 多后端

```yaml
# config/observability/exporters.yaml
exporters:
  otlp:
    enabled: true
    endpoint: "localhost:4317"
    protocol: grpc
  
  langsmith:
    enabled: false
    api_key: "${LANGSMITH_API_KEY}"
  
  langfuse:
    enabled: false
    public_key: "${LANGFUSE_PUBLIC_KEY}"
    secret_key: "${LANGFUSE_SECRET_KEY}"
  
  phoenix:
    enabled: false
    endpoint: "localhost:6006"
```

### 6.7 告警规则

```yaml
# config/observability/alerts.yaml
alerts:
  - name: llm_failure_rate_high
    metric: gen_ai.client.operation_duration
    condition: failure_rate > 0.05
    window: 5m
    severity: warning
  
  - name: llm_latency_high
    metric: gen_ai.client.operation_duration
    condition: p95 > 30
    window: 5m
    severity: warning
  
  - name: cache_hit_rate_low
    metric: flowforge.cache.hit_rate
    condition: value < 0.5
    window: 1h
    severity: warning
```

### 6.8 与现有系统集成点

| 现有模块 | 集成方式 |
|---------|---------|
| `observability/tracer.py` | 升级为 gen_ai.* schema |
| `observability/metrics_collector.py` | 对齐 gen_ai Metrics |
| `observability/alerts.py` | 升级告警规则 |
| `core/tracing.py` | `get_logger` 增加 OTel Span 上下文 |
| `llm/provider.py` | LLM 调用生成 gen_ai.llm Span |
| `tools/registry.py` | 工具调用生成 gen_ai.tool Span |
| `core/di.py` | OTel 组件 DI 注入 |

### 6.9 Helm UI Trace 视图

- 嵌入 Helm UI 新增 `Trace View` 面板
- Span 树形展开（可折叠）
- LLM Input/Output 可查看（支持折叠长内容）
- 错误 Span 高亮（红色）
- 慢 Span 高亮（黄色，> P95）
- 与现有 `ToolCallCard.tsx` / `LLMCallCard.tsx` 协同

---

## 第七章：跨模块架构协同

### 7.1 模块依赖关系图

```
M5 OTel GenAI ◄── 所有模块依赖（Trace 基础）
     ▲
     │
M4 Guardrails ◄── M1 A2A (Action Confirm)
     ▲              M2 MCP (Sandbox)
     │              M3 Context (Output Validation)
     │
M3 Context Eng ◄── M1 A2A (Context 构建)
     ▲                M2 MCP (Result Elision)
     │                M4 Guardrails (Context Validation)
     │
M2 MCP 2026 ◄── M1 A2A (工具调用)
     ▲
     │
M1 A2A (顶层互联)
```

**关键依赖**：
- M5 OTel 是所有模块的基础（先实施）
- M4 Guardrails 依赖 M5（Trace 拦截记录）
- M3 Context Eng 依赖 M5（Trace 上下文操作）
- M2 MCP 依赖 M4（沙箱）+ M5（Trace）
- M1 A2A 依赖 M2（工具）+ M3（上下文）+ M4（鉴权）+ M5（Trace）

### 7.2 建议实施顺序（考虑依赖）

```
Week 1-2: M5 OTel GenAI 基础（Span/Metric/Exporter）
Week 2-3: M4 Guardrails L1-L4（与 M5 并行）
Week 3-4: M3 Context Eng JIT + Memory Tool
Week 4-5: M2 MCP 2026 Stateless + Sandbox
Week 5-6: M1 A2A Server + Client + Directory
Week 7-8: 集成联调 + T10-T13 测试
```

### 7.3 数据模型共享

| 共享模型 | 使用模块 |
|---------|---------|
| `TaskContext` | M1/M3/M5/M7 |
| `AgentCard` | M1/M5/M12 |
| `ValidationResult` | M4/M5/M6 |
| `ToolResult` | M2/M3/M5 |
| `ContextBundle` | M3/M5/M7 |
| `SpanContext` | M5（所有模块） |

### 7.4 配置文件统一管理

```
flowforge/config/
├── a2a/                    # M1
│   ├── agent_cards/
│   └── auth.yaml
├── mcp_v2026/              # M2
│   ├── manifests/
│   ├── sandbox_policy.yaml
│   └── elision.yaml
├── context_engine/         # M3
│   ├── layers.yaml
│   ├── memory_policy.yaml
│   └── editing.yaml
├── guardrails/             # M4
│   ├── input_validation.yaml
│   ├── tool_allowlist.yaml
│   ├── action_confirmation.yaml
│   └── cost_ceilings.yaml
├── observability/          # M5
│   ├── exporters.yaml
│   ├── alerts.yaml
│   └── eval_gate.yaml
└── ...
```

---

## 第八章：部署架构

### 8.1 单实例部署（开发/测试）

```
FlowForge (单体)
├── FastAPI (REST + WebSocket + A2A Endpoint)
├── PostgreSQL (Durable + TaskStore)
├── Redis (MCP State + Cache)
├── Qdrant (Memory 语义检索)
├── OTel Collector (本地)
└── LLM API (OpenRoute)
```

### 8.2 多实例部署（生产）

```
                    ┌─────────────┐
                    │ Load Balancer│
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐       ┌─────────┐        ┌─────────┐
   │FlowForge│       │FlowForge│        │FlowForge│
   │Instance1│       │Instance2│        │Instance3│
   └────┬────┘       └────┬────┘        └────┬────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐       ┌─────────┐        ┌─────────┐
   │PostgreSQL│       │  Redis  │        │ Qdrant  │
   │ (集群)   │       │ (集群)  │        │ (集群)  │
   └─────────┘       └─────────┘        └─────────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                    ┌──────┴──────┐
                    │OTel Collector│
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │  Jaeger /   │
                    │  Prometheus │
                    └─────────────┘
```

### 8.3 A2A 联邦部署

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ FlowForge 实例 A │◄───►│ FlowForge 实例 B │◄───►│ FlowForge 实例 C │
│ (ContentForge)  │ A2A │ (DevForge)      │ A2A │ (StockForge)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        ▲                                                ▲
        │ A2A                                            │ A2A
        ▼                                                ▼
┌─────────────────────────────────────────────────────────────┐
│ 外部 Agent（其他厂 / 第三方 A2A Agent）                       │
└─────────────────────────────────────────────────────────────┘
```

### 8.4 容器化

```yaml
# docker-compose.yml (v3.0)
services:
  flowforge:
    image: flowforge:3.0
    ports: ["8000:8000"]
    environment:
      - FLOWFORGE_CONFIG_DIR=/app/flowforge/config
      - OTEL_EXPORTER_OTLP_ENDPOINT=otel-collector:4317
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://...
    depends_on: [postgres, redis, qdrant, otel-collector]
  
  postgres:
    image: postgres:16
    volumes: ["pgdata:/var/lib/postgresql/data"]
  
  redis:
    image: redis:7
  
  qdrant:
    image: qdrant/qdrant:latest
  
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    ports: ["4317:4317", "4318:4318"]
  
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports: ["16686:16686"]
```

---

## 第九章：技术选型

| 领域 | 选型 | 说明 |
|------|------|------|
| A2A 协议 | Google A2A Spec 2026 | Linux Foundation 托管 |
| MCP 协议 | MCP 2026 Spec RC | Stateless Core |
| Tracing | OpenTelemetry GenAI v1.30 | gen_ai.* schema |
| Trace 后端 | Jaeger / LangSmith / Langfuse | 多后端 |
| Metrics | Prometheus + Grafana | 标准 |
| 状态外置 | Redis 7 | MCP Stateless |
| 向量检索 | Qdrant | Memory 语义检索 |
| 持久化 | PostgreSQL 16 | Durable Event Log |
| 沙箱 | Docker | MCP 工具隔离 |
| 鉴权 | OAuth2 + JWT + mTLS | 多方式 |
| 配置 | YAML + Pydantic | 配置驱动 |
| 框架 | FastAPI + LangGraph | 沿用 v2.1 |
| 前端 | Next.js 14 + React 18 | 沿用 v2.1 |

---

## 第十章：附录

### 10.1 新增模块目录总览

```
flowforge/
├── interconnect/              ★ v3.0 新增 (M1, M14)
│   ├── a2a/
│   │   ├── server.py
│   │   ├── client.py
│   │   ├── directory.py
│   │   ├── authenticator.py
│   │   ├── card_builder.py
│   │   ├── models.py
│   │   └── routes.py
│   └── acp/                   # P2
│       └── orchestrator.py
├── mcp/                        # 升级 (M2)
│   ├── elision.py             # 新增
│   ├── manifest_registry.py   # 新增
│   └── oauth_flow.py           # 新增
├── harness/                    # 升级 (M3)
│   ├── context_engine.py      # 升级为 JIT
│   ├── memory_tool.py         # 新增
│   └── context_editor.py      # 新增
├── security/guardrails/        ★ v3.0 新增 (M4)
│   ├── input_validator.py
│   ├── system_prompt_guard.py
│   ├── tool_allowlist.py
│   ├── output_validator.py
│   ├── action_confirmation.py
│   ├── cost_ceiling.py
│   └── orchestrator.py
├── observability/              # 升级 (M5)
│   ├── genai_tracer.py        # 升级
│   ├── eval_gate.py           # 新增
│   └── exporter_manager.py    # 新增
└── config/                     # 配置扩展
    ├── a2a/
    ├── mcp_v2026/
    ├── context_engine/
    ├── guardrails/
    └── observability/
```

### 10.2 关键接口定义

```python
# flowforge/core/interfaces/v3.py（新增接口定义）

class IContextEngine(Protocol):
    async def build_context(self, agent_id, task_input, session_id) -> ContextBundle: ...
    async def fetch(self, layer, key) -> str: ...

class IGuardrailsOrchestrator(Protocol):
    async def pre_check(self, request: AgentRequest) -> GuardrailsResult: ...
    async def post_check(self, response: AgentResponse) -> GuardrailsResult: ...

class IGenAITracer(Protocol):
    async def trace_llm_call(self, model, input, output, usage) -> Span: ...
    async def trace_tool_call(self, tool_name, input, output) -> Span: ...

class IA2AServer(Protocol):
    async def create_task(self, agent_id, request, tenant_id) -> A2ATaskResponse: ...
    async def stream_task(self, agent_id, request) -> AsyncIterator[str]: ...
```

### 10.3 关联文档

- `spec_face.md`（需求规格，前置依赖）
- `task_face.md`（任务清单，配套文档）
- `flowforge/docs/spec.md` v2.1（FlowForge 原始规格）
- `flowforge/docs/arch.md`（FlowForge 原始架构）
- `hiclaw/rules.md`（开发规范）
- `hiclaw/prompts.md`（提示词模板库）

---

## 附录：v7.0 灵智养成体系融合架构对齐

> **版本**：v7.0 融合对齐 | **日期**：2026-07-15
> **目的**：将 face v3.0 架构（M1-M17）与 v7.0 灵智养成体系（ForgekinEngine / Mind Echo / SpiritForge / Mind Codex / Mind Council）对齐
> **参考**：`flowforge/docs/arch.md` 第 15-22 章（v7.0 自我进化 Agent Harness 架构升级）

### 1. v7.0 七层架构模型

v7.0 在 v3.0 七层架构基础上，将第 7 层"互联层"升级为"自进化层（Evolution Layer）"，承载灵智养成体系：

```
7. 自进化层 (Evolution Layer) ★ v7.0
   ForgekinEngine | SpiritForge | Mind Codex | Mind Echo/Imprint
   Mind Council | External Tool Bridge | Trae Bridge
6. 应用层 (*Forge 项目群)
   ContentForge / DevForge / NovelForge / MallForge / StockForge
5. 接入层 (FastAPI + WebSocket + Web UI)
4. Harness 驾驭层 (上下文工程 | 架构约束 | 反馈循环 | 熵管理 | Loop Engine)
3. 执行引擎层 (HybridExecutor | ModeRegistry | Scheduler)
2. 能力层 (Tool/Skill/Agent/Memory)
1. 基础设施层 (SQLite/PostgreSQL | Redis | Qdrant | LangGraph | LLM API)
```

**依赖方向**：自进化层 → 应用层 → 接入层 → Harness 层 → 执行引擎层 → 能力层 → 基础设施层。严禁反向依赖。

**关键约束**：
- 自进化层可以调用应用层及以下所有层的能力
- 应用层（*Forge）通过 PluginProtocol 注册灵智角色，组合获得自进化能力
- Harness 层及以下保持 v6.0/v3.0 设计不变，自进化层在其之上叠加

### 2. ForgekinEngine 架构（自进化统一入口）

参考 `flowforge/docs/arch.md` 第 16 章，ForgekinEngine 是灵智引擎——自进化的统一入口，包装 HybridExecutor，在每次任务执行中完成"灵魂加载 → 记忆召回 → 执行 → 记录 → 进化"闭环。

#### 2.1 ForgekinEngine 10 步闭环

```
1. soul.load(forgekin_id)          — 加载灵魂档案（Mind Profile）
2. echo.recall(task)               — 检索相关灵忆（Mind Echo L2 Episode）
3. imprint.load(forgekin_id)       — 注入灵印（Mind Imprint 认知画像）
4. soul_prompt                     — 注入 Mind Profile 到系统提示
5. decide_strategy                 — 选择执行路径（auto/static/external/trae/mode）
6. execute                         — 执行任务
7. echo.record(episode)            — 记录 Episode 到灵忆
8. imprint.propose(observations)   — 更新灵印（白名单采集 + 分层消化）
9. codex.maybe_distill(episode)    — 尝试蒸馏 Skill 到 Mind Codex
10. awakening.check_promotion()    — 检查觉醒条件（E1→E2→...→E6）
```

#### 2.2 四类执行路径

ForgekinEngine 在步骤 5-6 根据任务类型和灵智能力选择执行路径：

```python
# 路径 a：委托给静态 Agent（YAML 声明式、无状态、无记忆）
result = await self._delegate_to_static(input, context, soul)

# 路径 b：调用外部 CLI 工具（claude / codex / opencode，worktree 隔离）
result = await self._call_external_tool(input, context, soul)

# 路径 c：通过 Trae Bridge 监工模式执行（JSON 文件交换 + 轮询）
result = await self._call_trae_bridge(input, context, soul)

# 路径 d：使用 FlowForge 9大模式 + Tool + Skill（HybridExecutor 底座）
result = await self._executor.run(context)
```

**路由策略**：
- 确定性/流水线任务 → delegate_to_static()
- 需要外部代码能力 → call_external_tool()
- 需要 Trae IDE 集成 → call_trae_bridge()
- 需要成长/创意/复杂决策 → use_flowforge_mode()

#### 2.3 灵魂三件套

| 组件 | 说明 | 存储后端 |
|------|------|---------|
| Mind Profile | 身份与人格（forgekin_id / persona / worldview / awakening） | SQLite 表 `forgekin_souls` |
| Mind Echo | 灵忆-三层记忆（L1 Working / L2 Episode / L3 Semantic） | L1 内存 + L2 SQLite+sqlite-vec + L3 Mind Codex |
| Mind Imprint | 灵印-认知画像（结构化字段 + cat_note 主观日记 + white-list 采集） | SQLite 表 `forgekin_imprints` |

### 3. face M1-M17 到 v7.0 架构融合映射

| face 架构组件 | v7.0 对应组件 | 融合方式 |
|--------------|--------------|---------|
| A2A Server/Client (M1) | FR-EVO-09 A2A 通信协议 | Mind Council 间 @mention 路由 + thread isolation + structured handoff；A2A Manager 投递消息到目标灵智 inbox |
| Context Engineering 2.0 (M3) | ForgekinEngine 步骤 1-4 | soul.load / echo.recall / imprint.load / soul_prompt 替代原 JIT Context 注入，注入灵魂档案与灵忆 |
| 六层 Guardrails (M4) | ForgekinSecurityGuard + SR-01~08 安全红线 | 灵智安全守卫执行 SR-05 创建权限 / SR-06 外部工具 worktree 检查 / SR-03 Provoke 边界（不碰钱/关系/健康/隐私/价值观） |
| OTel GenAI v1.30 (M5) | forgekin_awakening_stage / spirit_forge_runs_total 等指标 | 灵智觉醒阶段、灵锻运行次数、Episode 记录数等 v7.0 指标纳入 OTel GenAI Span 导出 |
| HybridExecutor | ForgekinEngine 的执行底座 | ForgekinEngine 包装 HybridExecutor，在 mode 路径下调用 `_executor.run(context)`；降级时直接回退到 HybridExecutor |

### 4. 降级策略对齐

v7.0 降级路径（来自 `arch.md` 第 21 章）：当 v7.0 自进化能力不可用时，降级到 v6.0/v3.0 基座：

| 组件 | 降级路径 | 触发条件 |
|------|---------|---------|
| ForgekinEngine | → HybridExecutor（无灵魂、无记忆） | forgekin 未启用或不存在 |
| SpiritForge | 跳过（不灵锻） | auto_forge 未启用 |
| External Tool Bridge | → FlowForge 内置 Agent | CLI 不可用或超时 |
| Trae Bridge | → FlowForge 内置 Agent | 无响应或超时 |
| Mind Council | → 单渠道 Web Chat | 多渠道未配置 |
| A2A Protocol | → 直接调用（无 @mention） | a2a 未启用 |

**设计原则**：v6.0/v3.0 全部能力保留并向后兼容；v7.0 新增能力通过 Feature Flag 灰度启用。不是所有任务都需要自我进化，流水线型任务用静态智能体更高效；需要成长的复杂任务用灵智。

---

> **本文档为 FlowForge v3.0 架构详设，聚焦 P0 模块（M1-M5）。**
> **P1/P2 模块架构详设将在后续迭代补充。**
> **所有实现必须严格遵守 `hiclaw/rules.md` 和 `hiclaw/prompts.md`。**
