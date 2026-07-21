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
│   通过 Plugin V3 四钩子注册灵智体到 forgemind                    │
└──────────────────────────────────────────────────────────────────┘
                              ▲ Plugin V3
┌──────────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层（万物灵智体育灵场所）                  │
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
| forgemind 位置 | Layer 2 应用层 | 介于核心框架与 *Forge 之间，承载万物灵智体 |
| 三方 Agent 位置 | Layer 0 能力扩展层 | 作为灵智体能力扩展，不是工具 |
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

```
flowforge/
├── flowforge/                    # Layer 1: 核心框架层
│   ├── core/                     # 共享内核
│   │   ├── capability/           # 能力画像（F001）
│   │   ├── teamact/              # TeamAct 六步循环（F002-F007）
│   │   ├── harness/              # Harness 七层（F008-F013）
│   │   ├── memory/               # 多域记忆联邦（F014-F017）
│   │   ├── eval/                 # Eval 自代谢（F018-F020）
│   │   ├── reliability/          # 分布式可靠性（F021-F025）
│   │   ├── partnership/          # 伙伴系统数学
│   │   ├── external_agent/       # 三方 Agent 适配
│   │   ├── evolution/            # 自进化三闭环（Mode A/B/C）
│   │   ├── plugin_protocol.py    # Plugin V2 + V3 协议
│   │   ├── registries.py         # SkillRegistry / CouncilRegistry / ...
│   │   ├── interfaces/           # 抽象基类定义
│   │   ├── config.py             # 配置加载
│   │   ├── di.py                 # DI 容器
│   │   ├── errors.py             # 错误类型
│   │   └── tracing.py            # 日志 + trace_id
│   ├── llm/                      # LLM 客户端
│   ├── loop/                     # Loop 执行引擎
│   ├── tools/                    # 通用工具
│   └── py.typed
├── forgemind/                    # Layer 2: 应用层（万物灵智体育灵场所）
│   ├── base.py                   # ForgekinBase 抽象基类
│   ├── registry.py               # ForgekinRegistry
│   ├── council.py                # Mind Council（灵议）
│   ├── external_agents.py        # 三方 Agent 适配
│   ├── magic_words.py            # magic words 注册
│   ├── forgekins/                # 灵智体 YAML 配置
│   │   ├── luban.yaml            # 鲁班 = 猫头鹰（主架构师）
│   │   ├── sherlock.yaml         # 夏洛克 = 猎犬（代码审查）
│   │   └── vangogh.yaml          # 梵高 = 孔雀（视觉设计）
│   └── examples/                 # 5 形态示例灵智体
│       ├── animal_companion.py   # 生物灵智体示例
│       ├── organization.py       # 组织灵智体示例
│       ├── object_spirit.py      # 物品灵智体示例
│       └── fictional_character.py # 虚拟灵智体示例
├── config/                       # YAML 配置
│   ├── system.yaml               # 系统配置（路径、运行时）
│   ├── llm_route.yaml            # LLM 路由（fallback chains）
│   ├── evolution.yaml            # 自进化参数
│   ├── forgemind.yaml            # forgemind 应用层配置
│   └── prompts.yaml              # 提示词外置（铁律 5）
├── tests/                        # 测试套件（T1-T8 铁律）
├── docs/                         # 文档
├── .github/                      # GitHub 配置
├── pyproject.toml                # 项目元数据 + 依赖
├── .env.example                  # 环境变量模板
├── .gitignore
├── LICENSE                       # MIT
└── README.md
```

### 2.2 各层模块职责

#### Layer 1: 核心框架层（`flowforge/core/`）

| 模块 | 职责 | 关键文件 |
|------|------|---------|
| `capability/` | 能力画像建模、盲点检测、gap 分析 | `profile.py` / `analyzer.py` / `loader.py` |
| `teamact/` | TeamAct 六步循环、交接胶囊、熔断器 | `state_machine.py` / `handoff.py` / `circuit_breaker.py` |
| `harness/` | Harness 七层（持久状态/工具中介/证据/治理/magic words/熵/可驾驭度） | `durable_state.py` / `tool_mediation.py` / `evidence_sensors.py` / `governance.py` / `magic_words.py` / `entropy_control.py` / `harnessability.py` |
| `memory/` | 多域记忆联邦（Collection + 三检索入口 + 消费加权） | `collection.py` / `retrieval_entries.py` / `governance.py` / `consumption_weighted.py` / `mind_codex.py` |
| `eval/` | Eval Contract 五问 + 三方信号 + 七类归因 | `contract.py` / `three_signals.py` / `attribution.py` / `control_plane.py` |
| `reliability/` | 副作用 WAL + Tier 1-4 恢复 + liveness + 跨 provider 宿主 | `side_effect_wal.py` / `tier_recovery.py` / `liveness.py` / `provider_host.py` |
| `partnership/` | 伙伴系统数学（上限/下限/波动吸收/Token 账本） | `upper_bound.py` / `lower_bound.py` / `variance_absorption.py` / `token_ledger.py` |
| `external_agent/` | 三方 Agent EAC v1 七契约适配 | `adapter.py` / `claude_code.py` / `codex.py` / `opencode.py` / `trae.py` |
| `evolution/` | 自进化三闭环（Mode A/B/C）+ Eval Ledger | `scope_guard.py` / `process_evolution.py` / `knowledge_evolution.py` / `metacognition.py` / `maturity.py` / `engine.py` |
| `plugin_protocol.py` | Plugin V2 + V3 协议定义 | — |
| `registries.py` | SkillRegistry / CouncilRegistry / SpiritForgeRegistry / ForgekinRegistry | — |

#### Layer 2: forgemind 应用层（`forgemind/`）

| 模块 | 职责 |
|------|------|
| `base.py` | `ForgekinBase` 抽象基类（observe/reason/act/persist/verify） |
| `registry.py` | `ForgekinRegistry` — 灵智体注册中心 |
| `council.py` | `MindCouncil` — 灵议多智能体议事 |
| `external_agents.py` | 三方 Agent 调用入口（委托给 `core/external_agent/`） |
| `forgekins/` | 预置灵智体 YAML 配置 |
| `examples/` | 5 形态示例灵智体实现 |

#### Layer 3: *Forge 垂直业务层（独立项目）

*Forge 项目（ContentForge / DevForge / NovelForge / MallForge / StockForge）是独立开源项目，通过 Plugin V3 协议注册垂直领域灵智体到 forgemind。FlowForge 核心框架不感知 *Forge 内部实现。

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
    # 灵智体注册
    def register_forgekins(self) -> list[ForgekinSpec]: ...

    # 育灵技能注册（到 SkillRegistry，非 ForgekinRegistry）
    def register_forge_skills(self) -> list[SkillSpec]: ...

    # 灵议通道注册（到 CouncilRegistry）
    def register_council_channels(self) -> list[CouncilChannelSpec]: ...

    # 自动锻造配置注册（到 SpiritForgeRegistry）
    def register_spirit_forge_config(self) -> list[SpiritForgeConfig]: ...
```

### 3.3 注册中心

| 注册中心 | 职责 | 注册时机 |
|---------|------|---------|
| `ToolRegistry` | 工具白名单 + 副作用记录 | `register_tools()` 调用时 |
| `ForgekinRegistry` | 灵智体形态 + 谱系 | `register_forgekins()` 调用时 |
| `SkillRegistry` | 育灵技能 | `register_forge_skills()` 调用时 |
| `CouncilRegistry` | 灵议通道 | `register_council_channels()` 调用时 |
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
│ → 锻典（Mind Codex）条目沉淀        │
└─────────────────────────────────────┘
  ↓
灵智体进化阶提升（需 operator 确认）
```

### 4.3 灵议流

```
高觉醒阶灵智体（A5+）触发灵议
  ↓
MindCouncil 召集（≥ 2 个不同厂商灵智体）
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
| `config/forgemind.yaml` | 应用层 | 预置灵智体 + 三方 Agent + Council |
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
