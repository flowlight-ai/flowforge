# FlowForge — 架构设计

> **版本**：v1.0
> **对应规格**：`spec.md`
> **对应设计**：`design.md`
> **定位**：本文档定义 FlowForge 的架构层次、模块组织、依赖关系与扩展协议。

---

## 1. 架构总览

FlowForge 采用**三层 + 一扩展**架构，单向依赖，组合优于继承。

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 3: *Forge 垂直业务层                                       │
│   ContentForge / NovelForge / DevForge / MallForge / StockForge  │
│   通过 Plugin V3 四钩子注册 Forgekin 到 forgemind                │
└──────────────────────────────────────────────────────────────────┘
                              ▲ Plugin V3
┌──────────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层（可进化智能体 Forge Nurturing 场所）│
│   base / registry / council / external_agents / forgekins/       │
│   ForgekinBase + ForgekinRegistry + ForgePipeline                │
└──────────────────────────────────────────────────────────────────┘
                              ▲ 装饰器
┌──────────────────────────────────────────────────────────────────┐
│ Layer 1: FlowForge 核心框架层（Harness v2.0）                    │
│   capability / teamact / harness / memory / eval / reliability / │
│   partnership / external_agent / evolution / plugin /            │
│   ForgekinEngine（装饰 HybridExecutor + HarnessOrchestrator）    │
└──────────────────────────────────────────────────────────────────┘
                              ▲ EAC v1 七契约
┌──────────────────────────────────────────────────────────────────┐
│ Layer 0: 三方 Agent 能力扩展层                                   │
│   ClaudeCode Adapter / Codex Adapter /                          │
│   OpenCode Adapter / Trae Adapter                               │
└──────────────────────────────────────────────────────────────────┘
```

### 1.1 关键架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 自进化层位置 | 融入 Layer 1（Harness v2.0 升级） | 避免自进化层 ↔ 应用层循环依赖 |
| ForgekinEngine 形态 | HarnessOrchestrator 的装饰器 | 避免绕过 Harness 护栏 |
| forgemind 位置 | Layer 2 应用层 | 介于核心框架与 *Forge 之间，承载可进化智能体 |
| 三方 Agent 位置 | Layer 0 能力扩展层 | 作为 Forgekin 能力扩展，不是工具 |
| *Forge 集成方式 | Plugin V3 协议 | 核心框架不感知 *Forge 内部实现 |

### 1.2 依赖方向铁律

> **单向依赖零容忍**：违反则代码审查不通过。

```
Layer 3 (*Forge)        → 可依赖 Layer 2 + Layer 1
Layer 2 (forgemind)     → 可依赖 Layer 1
Layer 1 (core)          → 不依赖任何上层
Layer 0 (三方 Agent)    → 通过 EAC 契约接入，不依赖任何 FlowForge 模块
```

**反向依赖零容忍**：
- `flowforge/core/` 禁止 import `flowforge/forgemind/`
- `flowforge/core/` 禁止 import 任何 `*forge` 模块
- `flowforge/forgemind/` 禁止 import 任何 `*forge` 模块

---

## 2. 模块组织

### 2.1 顶层目录结构

> **架构原则**：架构相关/底层代码按架构分层组织，业务功能按模块组织，UI 界面按组件组织。
> `app/` 目录仅包含端点接口封装，所有实现代码下沉到 `core/` 或对应功能模块。

```
flowforge/
├── app/                          # 应用层（仅 API 端点封装，不含实现代码）
│   ├── main.py                   # FastAPI 入口（< 500 行，仅 app 创建 + 路由挂载）
│   ├── deps.py                   # 依赖注入
│   └── api/                      # API 路由（按模块分目录）
│       ├── admin/                # 管理端点（prompts/settings/audit/ops）
│       ├── agents/               # 智能体端点（council/forgemind/verify/...）
│       │   ├── council.py        # Council 聊天路由（薄封装，< 500 行）
│       │   ├── council_state.py  # Council 数据模型 + 状态管理
│       │   ├── council_helpers.py# Council 工具函数
│       │   ├── council_chat_service.py    # Council 聊天业务逻辑
│       │   ├── council_task_service.py    # Council 任务/推回逻辑
│       │   ├── council_settings_service.py# Council 设置/仪表板逻辑
│       │   ├── council_workflow_service.py# Council 工作流/WebSocket 逻辑
│       │   ├── forgemind.py      # ForgeMind API 端点
│       │   ├── forgemind_registry.py      # Forgekin 注册表（从 forgemind.py 提取）
│       │   └── forgemind_models.py        # ForgeMind Pydantic 模型
│       ├── core/                 # 核心端点（auth/metrics/governance/...）
│       ├── endpoints/            # 通用端点（dashboard/websocket）
│       ├── memory/               # 记忆端点
│       ├── plugins/              # 插件管理端点
│       ├── workflows/            # 工作流端点（tasks/loops/plans/...）
│       ├── workspace/            # 工作空间端点
│       ├── fusion_router.py      # Web Fusion v1 路由聚合
│       └── router.py             # 主路由聚合
├── core/                         # 共享内核（架构底层代码）
│   ├── bootstrap.py              # 启动注册（tools/agents/modes）← 从 main.py 提取
│   ├── plugin_loader.py          # PluginLoader 类（插件生命周期）← 从 main.py 提取
│   ├── plugin_protocol.py        # Plugin V2 + V3 协议定义
│   ├── plugin_registry.py        # 插件注册中心
│   ├── plugin_lifecycle.py       # 插件生命周期管理
│   ├── plugin_manager.py         # 插件管理器
│   ├── config.py                 # 配置加载
│   ├── di.py                     # DI 容器
│   ├── errors.py                 # 错误类型
│   ├── tracing.py                # 日志 + trace_id
│   ├── agent_registry.py         # Agent 注册中心
│   ├── tool_chain_executor.py    # 工具链执行器
│   ├── model_service.py          # 模型服务
│   ├── persona_lock.py           # Persona 锁
│   ├── metrics.py                # 指标收集
│   ├── interfaces/               # 抽象基类定义
│   ├── capability/               # 能力画像（F001）
│   ├── external_agent/           # 三方 Agent 适配
│   ├── gate/                     # 门禁系统
│   ├── world_engine/             # 世界引擎
│   ├── memory_federation/        # 记忆联邦
│   ├── teamact/                  # TeamAct 六步循环
│   └── eval/                     # Eval 自代谢
├── llm/                          # LLM 客户端层
│   ├── router.py                 # LLM 路由
│   ├── council_bridge.py         # Council LLM 桥接
│   ├── council_bridge_holder.py  # Council 桥接持有器
│   ├── provider.py               # LLM Provider
│   ├── trae/                     # Trae CN 桥接客户端
│   └── ...
├── loop/                         # Loop 执行引擎
├── modes/                        # 执行模式（ReAct/PlanExecute/Reflexion/...）
├── agents/                       # 通用 Agent 实现
├── tools/                        # 通用工具
├── executor/                     # HybridExecutor
├── events/                       # 事件总线
├── memory/                       # 记忆管理
├── scheduler/                    # 任务调度器
├── compiler/                     # Workflow YAML 编译器
├── harness/                      # Harness 编排器
├── mcp/                          # MCP 服务端/客户端
├── forgemind/                    # ForgeMind 业务模块（可进化智能体）
│   ├── base.py                   # ForgekinBase 抽象基类
│   ├── registry.py               # ForgekinRegistry
│   ├── council.py                # Mind Council
│   ├── forgekins/                # Forgekin YAML 配置
│   ├── forging/                  # 锻造流水线
│   └── ...
├── evolution/                    # 自进化三闭环（Mode A/B/C）
├── config/                       # YAML 配置
│   ├── system.yaml               # 系统配置
│   ├── llm_route.yaml            # LLM 路由
│   ├── prompts.yaml              # 提示词外置（铁律 5）
│   ├── forgekins/                # Forgekin 配置
│   └── workflows/                # 工作流配置
├── docs/                         # 文档
└── pyproject.toml                # 项目元数据 + 依赖
```

### 2.2 各层模块职责

#### 应用层（`app/`）— 仅端点封装

| 模块 | 职责 | 关键文件 |
|------|------|---------|
| `main.py` | FastAPI 入口，app 创建 + 路由挂载 + lifespan | `app/main.py`（< 500 行） |
| `api/admin/` | 管理端点 | `prompts.py` / `settings.py` / `audit.py` / `ops.py` |
| `api/agents/` | 智能体端点 | `council.py` / `forgemind.py` / `verify.py` |
| `api/core/` | 核心端点 | `auth.py` / `metrics.py` / `governance.py` |
| `api/workflows/` | 工作流端点 | `tasks.py` / `loops.py` / `plans.py` |

#### 核心框架层（`core/`）— 架构底层代码

| 模块 | 职责 | 关键文件 |
|------|------|---------|
| `bootstrap.py` | 启动注册（tools/agents/modes） | `register_core_tools()` / `register_core_agents()` / `register_all_modes()` |
| `plugin_loader.py` | 插件生命周期编排 | `PluginLoader` 类（加载/卸载/热重载/自动发现） |
| `plugin_protocol.py` | Plugin V2 + V3 协议定义 | `FlowForgePlugin` / `PluginContext` / `PluginState` |
| `capability/` | 能力画像建模、盲点检测、gap 分析 | `profile.py` / `analyzer.py` / `loader.py` |
| `external_agent/` | 三方 Agent EAC v1 七契约适配 | `adapter.py` / `trae.py` / `codex.py` / `opencode.py` |
| `gate/` | 门禁系统 | `approval.py` / `voting.py` / `timeout.py` |
| `world_engine/` | 世界引擎 | `bridge.py` / `coordinator.py` / `citizens.py` |
| `memory_federation/` | 多域记忆联邦 | `collection.py` / `governance.py` / `mind_codex.py` |
| `teamact/` | TeamAct 六步循环 | `state_machine.py` / `handoff.py` / `circuit_breaker.py` |
| `eval/` | Eval 自代谢 | `contract.py` / `three_signals.py` / `attribution.py` |

#### 业务模块层

| 模块 | 职责 |
|------|------|
| `forgemind/` | 可进化智能体 Forge Nurturing — Forgekin 管理、锻造、MindCouncil |
| `evolution/` | 自进化三闭环（Mode A/B/C）+ Eval Ledger |
| `llm/` | LLM 客户端、路由、Council 桥接、Trae CN 适配 |
| `loop/` | Loop 执行引擎（planner/verifier/reflector） |
| `modes/` | 执行模式（ReAct/PlanExecute/Reflexion/MultiAgent/...） |

#### Layer 3: *Forge 垂直业务层（独立项目）

*Forge 项目（ContentForge / DevForge / NovelForge / MallForge / StockForge）是独立开源项目，通过 Plugin V3 协议注册垂直领域 Forgekin 到 forgemind。FlowForge 核心框架不感知 *Forge 内部实现。

---

## 3. Plugin 协议

### 3.1 Plugin V2（11 钩子，基础协议）

```python
class PluginProtocol(Protocol):
    # 配置加载
    def register_config(self) -> dict[str, Any]: ...
    def load_config(self, config: dict[str, Any]) -> None: ...

    # 生命周期
    async def on_startup(self) -> None: ...
    async def on_shutdown(self) -> None: ...

    # 工具注册
    def register_tools(self) -> list[ToolSpec]: ...
    def register_agents(self) -> list[AgentSpec]: ...

    # 路由
    def register_routes(self) -> list[RouteSpec]: ...
    def register_prompts(self) -> dict[str, str]: ...

    # 事件
    async def on_event(self, event: Event) -> None: ...
    async def on_task_start(self, task: Task) -> None: ...
    async def on_task_end(self, task: Task, result: Result) -> None: ...
```

### 3.2 Plugin V3（4 个 forgekin 钩子，应用层扩展）

```python
class ForgekinPluginProtocol(PluginProtocol, Protocol):
    # Forgekin 注册
    def register_forgekins(self) -> list[ForgekinSpec]: ...

    # Forge Nurturing 技能注册（到 SkillRegistry，非 ForgekinRegistry）
    def register_forge_skills(self) -> list[SkillSpec]: ...

    # MindCouncil 通道注册（到 CouncilRegistry）
    def register_council_channels(self) -> list[CouncilChannelSpec]: ...

    # 自动锻造配置注册（到 SpiritForgeRegistry）
    def register_spirit_forge_config(self) -> list[SpiritForgeConfig]: ...
```

### 3.3 注册中心

| 注册中心 | 职责 | 注册时机 |
|---------|------|---------|
| `ToolRegistry` | 工具白名单 + 副作用记录 | `register_tools()` 调用时 |
| `ForgekinRegistry` | Forgekin 形态 + 谱系 | `register_forgekins()` 调用时 |
| `SkillRegistry` | Forge Nurturing 技能 | `register_forge_skills()` 调用时 |
| `CouncilRegistry` | MindCouncil 通道 | `register_council_channels()` 调用时 |
| `SpiritForgeRegistry` | 自动锻造配置 | `register_spirit_forge_config()` 调用时 |

---

## 4. 数据流

### 4.1 单次任务执行流

```
用户输入
  ↓
FirstTouchRouter（意图识别）
  ↓
HarnessOrchestrator（编排）
  ↓
ForgekinEngine（装饰器，注入 forgekin 能力）
  ↓
TeamActState（六步循环）
  ↓
ForgekinBase.observe() → reason() → act()
  ↓                                    ↓
  ↑                                    ↓
VerifyReport ← ForgekinBase.verify() ← ActionResult
  ↓
Eval 信号采集 → Eval Ledger（不可删除）
  ↓
EchoStore 写回（ForgekinBase.persist()）
  ↓
能力画像更新（CapabilityProfile）
```

### 4.2 自进化流

```
Eval 信号累积
  ↓
┌─────────────────────────────────────┐
│ Mode A: Scope Guard                 │
│ 检测偏差关键词 → 阻止越界 + 记录    │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ Mode B: Process Evolution           │
│ 信号达阈值 → 流程规则升级 + SOP     │
└─────────────────────────────────────┘
  ↓
┌─────────────────────────────────────┐
│ Mode C: Knowledge Evolution         │
│ smoke gate + promotion gate         │
│ → Mind Codex 条目沉淀              │
└─────────────────────────────────────┘
  ↓
Forgekin 进化阶提升（需 operator 确认）
```

### 4.3 MindCouncil 流

```
高觉醒阶 Forgekin（A5+）触发 MindCouncil
  ↓
MindCouncil 召集（≥ 2 个不同厂商 Forgekin）
  ↓
多轮审议（受 magic words 逃生舱约束）
  ↓
共识达成 → 执行
共识未达 → 升级 operator
```

---

## 5. 配置驱动

### 5.1 配置文件层次

| 文件 | 范围 | 说明 |
|------|------|------|
| `.env` | 部署环境 | 路径根、API key、密钥（gitignored） |
| `config/system.yaml` | 系统 | 路径占位符解析、运行时行为 |
| `config/llm_route.yaml` | LLM 路由 | Provider 配置 + fallback chains |
| `config/evolution.yaml` | 自进化 | 三闭环参数 + 成熟度阈值 |
| `config/forgemind.yaml` | 应用层 | 预置 Forgekin + 三方 Agent + Council |
| `config/prompts.yaml` | 提示词 | 所有 prompt 外置（铁律 5） |

### 5.2 路径占位符

所有路径通过 `.env` 注入，YAML 中使用 `${...}` 占位符：

| 占位符 | 含义 |
|--------|------|
| `${FLOWLIGHT_AI_ROOT}` | flowlight-ai 组织根目录 |
| `${FLOWFORGE_WORK_DIR}` | FlowForge 工作目录 |
| `${FLOWFORGE_LOG_DIR}` | 日志目录 |

完整占位符列表见 `.env.example`。

### 5.3 配置优先级

```
1. Process environment variables（最高）
2. .env file
3. config/*.yaml defaults（最低）
```

---

## 6. DI 容器

> **铁律 3**：禁止绕过 DI 容器直接实例化。

```python
# ❌ 禁止
from flowforge.core.capability.analyzer import ProfileAnalyzer
analyzer = ProfileAnalyzer()

# ✅ 允许
from flowforge.core.di import get_container
container = get_container()
analyzer = container.get(ProfileAnalyzer)
```

所有依赖通过构造函数注入，由 DI 容器管理生命周期。`core/di.py` 提供 `get_container()` 单例访问。

---

## 7. 引用

- `spec.md` — 全局规格说明（做什么）
- `design.md` — 当前阶段设计（如何实现）
- `decisions/` — 架构决策记录（ADR）
- `features/` — Feature 规格模板
- `.env.example` — 环境变量模板
- `config/system.yaml` — 系统配置
