# FlowForge

> **多项目 AI Agent 智能体平台** — 以 FlowForge 为通用底座框架，上层 *Forge 项目通过插件化/配置化方式扩展专业场景能力。
>
> **核心原则**：配置驱动 > 代码继承 > 独立实现；组合优于继承。

[![CI](https://github.com/<your-org>/flowforge/actions/workflows/ci.yml/badge.svg)](https://github.com/<your-org>/flowforge/actions/workflows/ci.yml)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Code Style: Ruff](https://img.shields.io/badge/code%20style-ruff-000000.svg)](https://github.com/astral-sh/ruff)

---

## 📋 目录

- [项目愿景](#项目愿景)
- [核心特性](#核心特性)
- [架构概览](#架构概览)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [开发指南](#开发指南)
- [测试](#测试)
- [文档导航](#文档导航)
- [贡献](#贡献)
- [许可证](#许可证)

---

## 项目愿景

FlowForge 是一个**可进化智能体主导全部自主开发流程**的 AI Agent 智能体平台。可进化智能体（Evolvable Agent，项目代号 Forgekin）具备：

- **持久身份**：跨会话保持身份与价值锚点
- **经验记忆**：高价值协作后结构化事件快照
- **经验蒸馏**：将情景记忆转化为可检索的程序性记忆
- **自我演进**：三模式自我进化（Scope Guard / Process Evolution / Knowledge Evolution）
- **自主开发**：三闭环自主开发（文档 / 代码 / 框架）

详见 [VISION.md](docs/VISION.md)。

## 核心特性

### 🧠 育灵体系（v7.0 Spirit Cultivation System）

- **12 个核心概念**：可进化智能体 / ForgeMind / Forgekin / 持久身份 / 经验记忆存储 / 经验蒸馏 / 锻典 / 灵议 / 进化阶 / 觉醒阶 / 灵族 / Pack
- **五级知识成熟度阶梯**：L0 Episode → L1 Pattern → L2 Draft → L3 Validated → L4 Standard
- **三模式自我进化**：Mode A Scope Guard / Mode B Process Evolution / Mode C Knowledge Evolution
- **元认知路由**：三信号（domain_reliability + evidence_completeness + self_reported_confidence）+ Mode C 反思

### 🌍 世界引擎

- **9 个一等公民**：World / Character / Scene / CanonDecision / Relationship / Artifact / Round / Branch / Turn
- **Role Mask 五层**：L1 路由 / L2 基础设施 / L3 本体能力 / L4 场景皮肤 / L5 世界内状态
- **Bridge Layer 三协议**：Role Mask / Canon Sync / World Driver
- **四心智家族护栏**：Ragdoll / Maine Coon / Siamese / hotfix

### 🔧 Harness 七层现实表面

1. **Durable State Surfaces** — 感知现实
2. **Tool Mediation** — 改变现实
3. **Evidence & Sensors** — 验证现实
4. **Governance Boundary** — 约束现实
5. **Magic Words 逃生舱** — 人机边界
6. **Entropy Control 退役** — 清理现实
7. **Harnessability 评估** — 适配现实

### 🤝 多智能体协作

- **TeamAct Queue Steer**：7 种 SteerAction + 5 级 SteerPriority
- **Agent Swarm**：5 灵智体协同（文心 / 夏洛克 / 鲁班 / 梵高 / 达芬奇）
- **IM 议事通道**：多智能体议事机制
- **Approval Hub**：统一审批中心

### 🔌 三方 Agent 集成

- **ProviderTransportRegistry**：Provider 传输协议注册表
- **ACP transport**：Agent Communication Protocol
- **host-owned 安全注入**：宿主拥有的安全注入机制
- **MCP 1→3 server 拆分**：collab / memory / signals 三类拆分

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│  应用层 (Gateway) — FastAPI / Next.js                            │
├─────────────────────────────────────────────────────────────────┤
│  指挥中枢层 (Brain) — Plan Generator / Runtime Coordinator       │
├─────────────────────────────────────────────────────────────────┤
│  专家执行层 (Workers) — 6 大专家 Agent / Forgekin                │
├─────────────────────────────────────────────────────────────────┤
│  工具与记忆层 (Tools & Memory) — ToolRegistry / EchoStore        │
├─────────────────────────────────────────────────────────────────┤
│  共享内核 (core/) — Plugin / Gate / Context / Memory / Tracing   │
└─────────────────────────────────────────────────────────────────┘
```

**铁律**：上层可以依赖下层，下层**绝对禁止**导入上层模块。单向依赖是架构不腐化的底线。

详见 [arch.md](docs/arch.md)。

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+（前端可选）
- SQLite（开发期）

### 安装

```bash
# 克隆仓库
git clone https://github.com/<your-org>/flowforge.git
cd flowforge

# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows

# 安装依赖
pip install -e ".[dev]"

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入必要配置（如 LLM API key）
```

### 运行

```bash
# 启动 FlowForge 服务
python -m flowforge.app.main

# 启动前端（可选）
cd web && npm install && npm run dev
```

### 初始化配置

```bash
# 交互式初始化（推荐新用户）
flowforge init --interactive

# 按场景初始化
flowforge init --profile=minimal    # 最小化（仅核心）
flowforge init --profile=standard   # 标准（核心 + 常用）
flowforge init --profile=full       # 全开（仅 dev 环境）
```

## 项目结构

> **重构说明**（2026-07-29）：`app/` 目录下沉为纯端点封装，实现代码迁移到 `core/`；新增 `harness/` 顶层目录（替代旧 `core/harness_v7/`）；API 路由按模块化分目录。详见 [docs/arch.md §2.8](docs/arch.md)。

```
flowforge/
├── a2a/                # Agent-to-Agent 通信协议
├── agents/             # 通用 Agent 实现
├── app/                # 应用层（仅 API 端点封装，< 500 行/文件）
│   ├── main.py         # FastAPI 入口（app 创建 + 路由挂载）
│   ├── deps.py         # 依赖注入
│   └── api/            # API 路由（按模块分目录）
│       ├── admin/      # 管理端点（prompts/settings/audit/ops/env_vars）
│       ├── agents/     # 智能体端点（council/forgemind/forgekins）
│       ├── core/       # 核心端点（auth/metrics/governance/openroute）
│       ├── memory/     # 记忆端点（memory/graph）
│       ├── plugins/    # 插件管理端点
│       ├── workflows/  # 工作流端点（tasks/loops/plans/missions）
│       ├── workspace/  # 工作空间端点（uploads/workspace）
│       ├── endpoints/  # 通用端点（dashboard/websocket）
│       └── router.py   # 主路由聚合
├── brain/              # 指挥中枢
├── cli/                # 命令行工具
├── compiler/           # Workflow YAML 编译器
├── config/             # YAML 配置（system/models/llm_route/prompts）
├── core/               # 共享内核（架构底层代码）
│   ├── bootstrap.py    # 启动注册（tools/agents/modes）← 从 main.py 提取
│   ├── plugin_loader.py # 插件生命周期编排 ← 从 main.py 提取
│   ├── plugin_protocol.py # Plugin V2 + V3 协议定义
│   ├── capability/     # 能力画像（F001）
│   ├── eval/           # Eval 自代谢（三信号）
│   ├── external_agent/ # 三方 Agent EAC v1 适配
│   ├── gate/           # 门禁系统
│   ├── interfaces/     # 抽象基类定义
│   ├── memory_federation/ # 多域记忆联邦
│   ├── teamact/        # TeamAct 六步循环
│   └── world_engine/   # 世界引擎
├── docs/               # 设计文档（spec/arch/design 三顶层）
│   ├── architecture/   # 架构文档（A0XX 与 F0XX 同号对应）
│   ├── decisions/      # ADR（不可变决策记录）
│   ├── design/         # 详细设计（D0XX 与 F0XX/A0XX 同号对应）
│   └── features/       # Feature 规格（F0XX）
├── executor/           # HybridExecutor
├── events/             # 事件总线（EventBus + DurableEventStream）
├── evolution/          # 自进化三闭环（Mode A/B/C + Eval Ledger）
├── forgemind/          # ForgeMind 业务模块（可进化智能体）
│   ├── base.py         # ForgekinBase 抽象基类
│   ├── forgekins/      # Forgekin YAML 配置（5 只预置）
│   ├── forging/        # 锻造流水线
│   └── autonomous.py   # 自主执行
├── harness/            # Harness 编排器（七层现实表面）
│   ├── durable_state.py
│   ├── evidence_sensors.py
│   ├── governance.py
│   └── tool_mediation.py
├── llm/                # LLM 客户端层
│   ├── router.py       # LLM 路由
│   ├── provider.py     # LLM Provider
│   ├── zhipu_client.py # 智谱 AI 直连客户端
│   ├── openroute_client.py # OpenRoute 客户端
│   └── trae/           # Trae CN 桥接客户端
├── loop/               # Loop 执行引擎（planner/verifier/reflector）
├── mcp/                # MCP 服务端/客户端
├── memory/             # 记忆管理
├── middleware/         # 中间件
├── modes/              # 执行模式（ReAct/PlanExecute/Reflexion/MultiAgent/...）
├── observability/      # 可观测性
├── review/             # 评审模块
├── scheduler/          # 任务调度器（APScheduler）
├── security/           # 安全模块
├── services/           # 业务服务
├── session/            # 会话管理 + EventStore
├── skills/             # Skill 沉淀
├── sop/                # SOP 标准作业流程
├── tools/              # 通用工具
├── vcs/                # 版本控制集成
├── web/                # Next.js 14 前端（React 18 + TypeScript + Tailwind）
└── workflows/          # 工作流定义
```

## 开发指南

### 代码规范

- Python 3.11+，类型注解**强制**
- 所有 I/O 操作使用 `async/await`
- Agent 禁止直接导入 LLM SDK，必须通过 `LLMClient`
- 工具调用必须通过 `ToolRegistry.execute()`
- 提示词必须外置到 YAML 配置

### 15 条编程红线

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

### T1-T8 测试铁律

| # | 铁律 | 说明 |
|---|------|------|
| **T1** | 禁止使用 Mock LLM | 所有 E2E/集成测试必须调用真实 LLM |
| **T2** | 禁止使用假数据 | 测试输入必须是真实场景数据 |
| **T3** | 禁止跳过验证 | 必须有具体断言 |
| **T4** | 禁止 Mock 工具 | 工具必须真实调用 |
| **T5** | 未实现即 Bug | 发现代码未实现必须记录为 Bug |
| **T6** | 必须采集指标 | E2E 测试必须用 MetricsCollector |
| **T7** | LLM 内容必须经 LLM 审核 | LLM 生成内容必须再调用 LLM 审核通过 |
| **T8** | Web 功能必须操控浏览器验证 DOM | 网页操作必须操控浏览器查看 DOM |

## 测试

```bash
# 运行单元测试
pytest flowforge/tests/

# 运行带覆盖率
pytest flowforge/tests/ --cov=flowforge --cov-report=term-missing

# 运行特定模块
pytest flowforge/tests/test_cl006_metacognition_mode_c.py -v
```

## 文档导航

| 文档 | 路径 | 说明 |
|------|------|------|
| **项目愿景** | [docs/VISION.md](docs/VISION.md) | 可进化智能体愿景 |
| **路线图** | [docs/ROADMAP.md](docs/ROADMAP.md) | 项目路线图 |
| **需求规格** | [docs/spec.md](docs/spec.md) | 需求规格文档 |
| **架构文档** | [docs/arch.md](docs/arch.md) | 架构文档 |
| **详细设计** | [docs/design.md](docs/design.md) | 详细设计索引 |
| **命名契约** | [docs/design/naming-contract.md](docs/design/naming-contract.md) | 三层命名体系 |
| **Feature 索引** | [docs/features/README.md](docs/features/README.md) | Feature 编号规则 |
| **ADR 索引** | [docs/decisions/README.md](docs/decisions/README.md) | 决策记录索引 |
| **SOP** | [docs/SOP.md](docs/SOP.md) | 可进化智能体协作 SOP |

## 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解贡献流程与规范。

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。
