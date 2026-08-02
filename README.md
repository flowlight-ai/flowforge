<div align="center">

# FlowForge

### Persistent Identity Agent Framework with Self-Devolution Loops
#### 持久身份智能体框架 · 自进化闭环

[![CI](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml)
[![CodeQL](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Code style: ruff](https://img.shields.io/badge/code%20style-ruff-000000.svg)](https://docs.astral.sh/ruff/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/flowlight-ai/flowforge/blob/main/CONTRIBUTING.md)
[![GitHub Discussions](https://img.shields.io/badge/GitHub-Discussions-purple.svg)](https://github.com/flowlight-ai/flowforge/discussions)

> *Forge a Persistent Identity. Endow it with Memory, Council, and Self-Devolution.*
> *锻造持久身份 · 赋予记忆、MindCouncil 与自进化能力。*

</div>

---

<details>
<summary>🇨🇳 简体中文 / Chinese Version（点击展开 · click to expand）</summary>

# FlowForge（简体中文）

### 持久身份智能体框架 · 自进化闭环

> *锻造持久身份 · 赋予记忆、MindCouncil 与自进化能力。*

## 为什么需要 FlowForge？

主流多智能体框架（AutoGen / CrewAI / LangGraph）很好地回答了一个问题：*在一次会话内，多次 LLM 调用如何协作？* 但会话一结束，智能体就遗忘了；服务一重启，就回到空白状态；模型一升级，辛苦积累的经验就丢了。

FlowForge 回答的是一个更难、更少人涉足的问题：

> **一个智能体如何跨越数月、跨越模型代际，保持身份、积累能力、保持可验证，并在治理下持续进化？**

这不是又一个聊天机器人框架。FlowForge 是那些需要*长期记住、持续成长、并对结果负责*的智能体的**基础设施层**。

| 维度 | 主流多智能体 | FlowForge |
|------|-------------|-----------|
| **身份** | 会话级；重启即失忆 | 跨会话、跨崩溃、跨模型升级持久存在 |
| **能力** | 单一模型 + 工具调用 | 模型 × 工具链 × 灵智体形态 × 外部智能体扩展 |
| **协作** | 固定角色槽位（PM/开发/测试） | 动态能力画像路由；角色只是运行期标签 |
| **进化** | 模型升级 = 系统升级 | 智能体自主进化自己的文档、代码与测试 |
| **审查** | 同厂商自审批 | 跨厂商独立审查（没有智能体能审批自己的成果） |
| **具身** | API 工具调用 | 物理传感器（IoT）+ 虚拟世界设定 |

## 核心特性

- **持久身份（Forgekin / 灵智体）** — 拥有 `Soul Imprint`（灵魂印记）、`Capability Profile`（能力画像）与 `EchoStore`（回声仓储）的长寿智能体，可跨越崩溃、模型升级与会话边界而存活。
- **自进化闭环（Self-Devolution Loops）** — 五条闭环让智能体在治理闸门下，自主进化自己的文档、代码、框架、审查与测试。
- **跨厂商审查** — 审查者必须来自与作者不同的厂商；没有智能体能审批自己的成果。
- **多域记忆联邦** — 通过 `MindCodex` 程序性记忆法典联邦的五域记忆。
- **七层工具链工程** — `durable_state`（持久状态）· `tool_mediation`（工具中介）· `evidence_sensors`（证据传感）· `governance`（治理）· `magic_words`（魔法词）· `entropy_control`（熵控）· `harnessability`（可驾驭性）。
- **配置驱动的灵智体** — 通过 YAML 画像注册任意数量的灵智体。5 个默认灵智体只是参考示例，并非上限。
- **外部智能体集成** — 将 Claude Code / Codex / Gemini / OpenCode / Trae CN 绑定为能力扩展。

## 灵智体（Forgekins）：可配置的自进化智能体

**架构并不固定于任何数量的灵智体。** 灵智体是配置驱动的实体——向 `config/forgekins/` 放入一份 YAML 画像即可注册一个，将其绑定到一条自进化闭环，并（可选地）绑定一个外部编码智能体。ForgeMindEngine 在运行期依据能力画像路由任务，而非硬编码角色。

**自进化才是架构的核心，而非智能体的数量。**

### 5 个默认灵智体（参考示例）

| 灵智体 | 厂商 | 自进化闭环 | 外部智能体 |
|--------|------|-----------|-----------|
| **Wenxin（文心）** | anthropic | 文档进化 | Claude Code |
| **Sherlock（夏洛克）** | openai | 代码进化 | Codex |
| **Vangogh（梵高）** | google | 跨厂商审查 | Gemini |
| **Da Vinci（达芬奇）** | open_source | 测试进化 | OpenCode |
| **Luban（鲁班）** | bytedance | 框架进化 *（需运营者审批）* | Trae CN |

### 新增你自己的灵智体

注册一个新的灵智体是**纯配置操作**——无需改动框架代码：

```yaml
# config/forgekins/my-forgekin.yaml
name: "MyForgekin"
vendor: anthropic
self_dev_loop: SelfDevCodeLoop
awakening_stage: E3
external_agent: claude_code
capabilities:
  - { name: "rust", proficiency: 0.8 }
  - { name: "system_design", proficiency: 0.6 }
blind_spots: ["frontend"]
```

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│  应用层 · forgemind/                                             │
│  灵智体注册表 · MindCouncil · 外部智能体                          │
├─────────────────────────────────────────────────────────────────┤
│  指令层 · evolution/                                             │
│  ForgeMindEngine · 元认知路由 · 成熟度阶梯                        │
├─────────────────────────────────────────────────────────────────┤
│  执行层 · workers/ · loop/                                       │
│  自进化闭环 · 闭环执行器 · 执行模式                               │
├─────────────────────────────────────────────────────────────────┤
│  工具与记忆层 · core/                                            │
│  capability · teamact · harness · memory · eval · reliability    │
└─────────────────────────────────────────────────────────────────┘
       ↕ 共享内核：DI 容器 · 插件协议 · 链路追踪 ↕
```

**单向依赖**：上层依赖下层；下层绝不导入上层。

## 快速开始

### 一键安装（推荐）

```bash
git clone https://github.com/flowlight-ai/flowforge.git
cd flowforge

# 搭建 Python 环境 + 安装后端依赖 + 构建前端
python scripts/setup.py

# （可选）安装外部编码智能体 CLI
python scripts/install_agents.py

# 启动后端（8000 端口）+ 前端（5175 端口）
python scripts/start.py
```

随后在浏览器打开 **http://localhost:5175**。

### 手动安装

> **关于包结构的说明**：仓库根目录*就是* `flowforge` 包（它包含顶层 `__init__.py`）。启动后端时，必须将该仓库的**父目录**加入 `PYTHONPATH`，这样 `flowforge.app.main` 才能正确解析。

```bash
pip install -e ".[dev]"
cd web && npm install && npm run build && cd ..

# 复制环境变量模板
cp .env.example .env  # 然后填入你的密钥

# 启动后端（仓库根即 flowforge 包 → 父目录在 PYTHONPATH 上）
export PYTHONPATH="$PWD/.."          # PowerShell: $env:PYTHONPATH = "$PWD\.."
python -m uvicorn flowforge.app.main:app --host 127.0.0.1 --port 8000

# 启动前端（另开一个终端）
cd web && npm run dev
```

### 验证 5 个默认灵智体

```bash
python scripts/verify_five_forgekins.py
```

**环境变量**（参见 `.env.example`）：

```
FLOWFORGE_WEBCHAT_TOKEN=...
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_CHAT_ID=...
```

## 配置

```yaml
# config/forgemind.yaml
external_agents:
  claude_code: { enabled: true, binary: "claude" }
  codex:       { enabled: true, binary: "codex" }
  gemini:      { enabled: true, binary: "gemini" }
  opencode:    { enabled: true, binary: "opencode" }
  trae:        { enabled: true, binary: "trae" }

council:
  min_reviewers: 2
  min_distinct_vendors: 2     # 跨厂商强制
  pass_threshold: 0.85        # 质量阈值
```

每个灵智体都由 `config/forgekins/*.yaml` 下的一份 YAML 画像描述。**框架对灵智体数量没有上限**——按需增删画像即可匹配你的部署。

## 文档

| 文档 | 说明 |
|------|------|
| [docs/VISION.md](docs/VISION.md) | 项目愿景与设计哲学 |
| [docs/spec.md](docs/spec.md) | 项目规格说明 |
| [docs/arch.md](docs/arch.md) | 架构设计 |
| [docs/design.md](docs/design.md) | 详细设计 |
| [docs/roadmap.md](docs/roadmap.md) | 开发路线图 |
| [docs/decisions/](docs/decisions/) | 架构决策记录（ADRs） |
| [docs/features/](docs/features/) | 特性设计 |
| [docs/roleagent.md](docs/roleagent.md) | 多智能体工程路径 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献指南 |
| [SECURITY.md](SECURITY.md) | 安全策略 |

## 路线图

| 阶段 | 范围 | 状态 |
|------|------|------|
| **0** | 项目脚手架 + 跨平台配置 + 文档骨架 | ✅ 已完成 |
| **1** | 七条工程路径代码骨架 | 🔄 进行中（约 70%） |
| **2** | forgemind 应用层 + 灵智体形态 | 🔄 进行中（约 85%） |
| **3** | 第三方智能体适配层 | 🔄 进行中（约 80%） |
| **4** | 评估自代谢 + 分布式可靠性 | 🔄 进行中（约 40%） |
| **5** | 协同数学 + 自进化闭环 | 🔄 进行中（约 60%） |
| **6** | SpiritForge 经验蒸馏 + MindCouncil | 🔄 进行中（约 40%） |

详见 [docs/roadmap.md](docs/roadmap.md)。

## 项目结构

```
flowforge/
├── core/              # 共享内核：capability · teamact · harness · memory · eval
├── evolution/         # ForgeMindEngine（自进化编排）
├── forgemind/         # 应用层：forgekin · registry · council · external_agents
├── web/               # Web UI（Next.js 14 + FastAPI 后端）
├── config/            # forgemind.yaml · forgekins/*.yaml · evolution.yaml
├── docs/              # spec · arch · design · roadmap · ADRs · features
├── scripts/           # setup.py · install_agents.py · start.py · verify_five_forgekins.py
└── tests/             # 测试套件
```

## 贡献

我们欢迎任何形式的贡献——新的灵智体画像、适配器集成、文档改进，或核心框架工作。

- 🐛 [报告 Bug](https://github.com/flowlight-ai/flowforge/issues/new?template=bug_report.yml)
- 💡 [提交功能建议](https://github.com/flowlight-ai/flowforge/issues/new?template=feature_request.yml)
- 💬 [加入讨论](https://github.com/flowlight-ai/flowforge/discussions)

提交 Pull Request 前请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

FlowForge 基于 **[MIT 许可证](LICENSE)** 发布。

</details>

---

## Why FlowForge?

Mainstream multi-agent frameworks (AutoGen / CrewAI / LangGraph) answer one question well: *how do multiple LLM calls cooperate within a session?* But when the session ends, the agent forgets. When the server restarts, it's a blank slate. When the model upgrades, hard-won experience is lost.

FlowForge answers the harder, less crowded question:

> **How does an agent preserve identity, accumulate capability, remain verifiable, and evolve under governance — across months and model generations?**

This is not another chatbot framework. FlowForge is the **infrastructure layer** for agents that need to *remember, grow, and be held accountable* over long time horizons.

| Dimension | Mainstream Multi-Agent | FlowForge |
|-----------|------------------------|-----------|
| **Identity** | Session-scoped; amnesia on restart | Persistent across sessions, crashes, and model upgrades |
| **Capability** | Single model + tool calls | Model × Harness × Forgekin morphology × External agent extension |
| **Collaboration** | Fixed role slots (PM/Dev/Test) | Dynamic capability-profile routing; role is a runtime label |
| **Evolution** | Model upgrade = system upgrade | Agents autonomously evolve their own docs, code, and tests |
| **Review** | Same-vendor self-approval | Cross-vendor independent review (no agent approves its own work) |
| **Embodiment** | API tool calls | Physical sensors (IoT) + virtual world settings |

---

## Key Features

- **Persistent Identity (Forgekin)** — Long-lived agents with `Soul Imprint`, `Capability Profile`, and `EchoStore` that survive crashes, model upgrades, and session boundaries.
- **Self-Devolution Loops** — Five closed loops that let agents autonomously evolve their own documentation, code, framework, reviews, and tests — under governance gates.
- **Cross-Vendor Review** — Reviewers must come from a different vendor than the author; no agent can approve its own work.
- **Multi-Domain Memory Federation** — Five memory domains federated through the `MindCodex` procedural memory codex.
- **Seven-Layer Harness Engineering** — `durable_state` · `tool_mediation` · `evidence_sensors` · `governance` · `magic_words` · `entropy_control` · `harnessability`.
- **Config-Driven Forgekins** — Register any number of Forgekins via YAML profiles. The 5 defaults are a reference example, not a limit.
- **External Agent Integration** — Bind Claude Code / Codex / Gemini / OpenCode / Trae CN as capability extensions.

---

## Forgekins: Configurable Self-Evolving Agents

**The architecture is not fixed to any number of Forgekins.** A Forgekin is a config-driven entity — register one by dropping a YAML profile into `config/forgekins/`, binding it to a Self-Devolution Loop and (optionally) an external coding agent. The ForgeMindEngine routes tasks at runtime based on capability profiles, not hardcoded roles.

**Self-evolution is the architectural centerpiece, not the agent count.**

### The 5 Default Forgekins (Reference Example)

| Forgekin | Vendor | Self-Dev Loop | External Agent |
|----------|--------|---------------|----------------|
| **Wenxin** (文心) | anthropic | Documentation evolution | Claude Code |
| **Sherlock** (夏洛克) | openai | Code evolution | Codex |
| **Vangogh** (梵高) | google | Cross-vendor review | Gemini |
| **Da Vinci** (达芬奇) | open_source | Test evolution | OpenCode |
| **Luban** (鲁班) | bytedance | Framework evolution *(operator-approved)* | Trae CN |

### Adding Your Own Forgekin

Registering a new Forgekin is a **config-only operation** — no framework code changes:

```yaml
# config/forgekins/my-forgekin.yaml
name: "MyForgekin"
vendor: anthropic
self_dev_loop: SelfDevCodeLoop
awakening_stage: E3
external_agent: claude_code
capabilities:
  - { name: "rust", proficiency: 0.8 }
  - { name: "system_design", proficiency: 0.6 }
blind_spots: ["frontend"]
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Application Layer · forgemind/                                 │
│  Forgekin Registry · Council · External Agents                  │
├─────────────────────────────────────────────────────────────────┤
│  Command Layer · evolution/                                     │
│  ForgeMindEngine · Metacognition Router · Maturity Ladder       │
├─────────────────────────────────────────────────────────────────┤
│  Execution Layer · workers/ · loop/                             │
│  Self-Dev Loops · Loop Executor · Execution Modes               │
├─────────────────────────────────────────────────────────────────┤
│  Tools & Memory Layer · core/                                   │
│  capability · teamact · harness · memory · eval · reliability   │
└─────────────────────────────────────────────────────────────────┘
       ↕ Shared Kernel: DI Container · Plugin Protocol · Tracing ↕
```

**Single-direction dependency**: upper layers depend on lower layers; lower layers never import upper layers.

---

## Quick Start

### One-command setup (recommended)

```bash
git clone https://github.com/flowlight-ai/flowforge.git
cd flowforge

# Set up Python env + install backend deps + build frontend
python scripts/setup.py

# (Optional) Install external coding agent CLIs
python scripts/install_agents.py

# Start backend (port 8000) + frontend (port 5175)
python scripts/start.py
```

Then open **http://localhost:5175** in your browser.

### Manual setup

> **Note on package layout**: the repository root *is* the `flowforge` package
> (it contains the top-level `__init__.py`). When launching the backend you must
> put the **parent** directory of the repo on `PYTHONPATH` so
> `flowforge.app.main` resolves.

```bash
pip install -e ".[dev]"
cd web && npm install && npm run build && cd ..

# Copy environment template
cp .env.example .env  # then fill in your keys

# Start backend (repo root is the `flowforge` package → parent dir on PYTHONPATH)
export PYTHONPATH="$PWD/.."          # PowerShell: $env:PYTHONPATH = "$PWD\.."
python -m uvicorn flowforge.app.main:app --host 127.0.0.1 --port 8000

# Start frontend (in another terminal)
cd web && npm run dev
```

### Verify the 5 default Forgekins

```bash
python scripts/verify_five_forgekins.py
```

**Environment variables** (see `.env.example`):

```
FLOWFORGE_WEBCHAT_TOKEN=...
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_CHAT_ID=...
```

---

## Configuration

```yaml
# config/forgemind.yaml
external_agents:
  claude_code: { enabled: true, binary: "claude" }
  codex:       { enabled: true, binary: "codex" }
  gemini:      { enabled: true, binary: "gemini" }
  opencode:    { enabled: true, binary: "opencode" }
  trae:        { enabled: true, binary: "trae" }

council:
  min_reviewers: 2
  min_distinct_vendors: 2     # cross-vendor enforcement
  pass_threshold: 0.85        # quality threshold
```

Each Forgekin is described by a YAML profile under `config/forgekins/*.yaml`. **The framework imposes no limit on the number of Forgekins** — add or remove profiles to match your deployment.

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/VISION.md](docs/VISION.md) | Project vision and design philosophy |
| [docs/spec.md](docs/spec.md) | Project specification |
| [docs/arch.md](docs/arch.md) | Architecture design |
| [docs/design.md](docs/design.md) | Detailed design |
| [docs/roadmap.md](docs/roadmap.md) | Development roadmap |
| [docs/decisions/](docs/decisions/) | Architecture Decision Records (ADRs) |
| [docs/features/](docs/features/) | Feature designs |
| [docs/roleagent.md](docs/roleagent.md) | Multi-agent engineering paths |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guide |
| [SECURITY.md](SECURITY.md) | Security policy |

---

## Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| **0** | Project scaffolding + cross-platform config + docs skeleton | ✅ Complete |
| **1** | Seven engineering paths code skeleton | 🔄 In Progress (~70%) |
| **2** | forgemind application layer + Forgekin morphologies | 🔄 In Progress (~85%) |
| **3** | Third-party Agent adapter layer | 🔄 In Progress (~80%) |
| **4** | Eval self-metabolism + distributed reliability | 🔄 In Progress (~40%) |
| **5** | Partnership math + self-evolution closed loop | 🔄 In Progress (~60%) |
| **6** | SpiritForge experience distillation + MindCouncil | 🔄 In Progress (~40%) |

See [docs/roadmap.md](docs/roadmap.md) for details.

---

## Project Structure

```
flowforge/
├── core/              # Shared kernel: capability · teamact · harness · memory · eval
├── evolution/         # ForgeMindEngine (self-evolution orchestration)
├── forgemind/         # Application layer: forgekin · registry · council · external_agents
├── web/               # Web UI (Next.js 14 + FastAPI backend)
├── config/            # forgemind.yaml · forgekins/*.yaml · evolution.yaml
├── docs/              # spec · arch · design · roadmap · ADRs · features
├── scripts/           # setup.py · install_agents.py · start.py · verify_five_forgekins.py
└── tests/             # Test suite
```

---

## Contributing

We welcome contributions of all kinds — new Forgekin profiles, adapter integrations, documentation improvements, or core framework work.

- 🐛 [Report a Bug](https://github.com/flowlight-ai/flowforge/issues/new?template=bug_report.yml)
- 💡 [Request a Feature](https://github.com/flowlight-ai/flowforge/issues/new?template=feature_request.yml)
- 💬 [Join Discussions](https://github.com/flowlight-ai/flowforge/discussions)

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a Pull Request.

---

## License

FlowForge is released under the **[MIT License](LICENSE)**.

---

<div align="center">

**⭐ If FlowForge helps you forge a Persistent Identity Agent, please give it a star! ⭐**

**[github.com/flowlight-ai/flowforge](https://github.com/flowlight-ai/flowforge)**

</div>
