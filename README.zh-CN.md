<div align="center">

# FlowForge（简体中文）

### 持久身份智能体框架 · 自进化闭环

[![CI](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml)
[![CodeQL](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Code style: ruff](https://img.shields.io/badge/code%20style-ruff-000000.svg)](https://docs.astral.sh/ruff/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/flowlight-ai/flowforge/blob/main/CONTRIBUTING.md)
[![GitHub Discussions](https://img.shields.io/badge/GitHub-Discussions-purple.svg)](https://github.com/flowlight-ai/flowforge/discussions)

> *锻造持久身份 · 赋予记忆、多智能体议事（MindCouncil）与自进化（Self-Devolution）能力。*

</div>

---

[🇺🇸 English](README.md) · [🇨🇳 简体中文](README.zh-CN.md) · [🇯🇵 日本語](README.ja.md)

## 为什么需要 FlowForge？

今天的编码智能体——**OpenCode、Codex CLI、Gemini CLI、Qoder、iFlow、WorkBuddy、Claude Code**——只擅长一件事：*在一次会话内把一个任务执行到底。* 但它们都是一次性的"外包工"：会话一结束就遗忘；服务一重启就是一张白纸；模型一升级，辛苦积累的经验随之清零——而且没人对上个月发布的成果负责。

FlowForge 回答的是一个更难、更少人涉足的问题：

> **一个智能体如何跨越数月、跨越模型代际，保持持久身份、积累能力、保持可验证，并在治理下持续进化？**

FlowForge 不与这些智能体竞争——**它雇佣它们。** 它是把现有编码智能体绑定为能力扩展、并把它们培养成职业**可进化智能体（Forgekin）**的**驾驭层（Harness Layer）**：拥有持久身份（Soul Imprint）、成长轨迹与治理。

| 维度 | 主流编码智能体（OpenCode · Codex · Gemini CLI · Qoder · iFlow · Claude Code） | FlowForge |
|------|--------------------------------------------------|-----------|
| **品类** | 一次性的任务执行器（"一双巧手"） | 面向持久身份 Forgekin 的驾驭层 |
| **身份** | 每次会话一个全新实例，没有"我是谁" | 持久身份（Soul Imprint）+ 形态谱系，跨越数月与模型代际 |
| **成长** | 能力锁死在模型权重里，升级 = 换人 | 自进化闭环：自主进化自己的文档、代码、框架、审查与测试 |
| **审查** | 同一模型自审自批 | 跨厂商独立审查——没有智能体能审批自己的成果 |
| **自主性** | 全自动 / 人工介入二选一 | 觉醒阶 6 级渐进自主 + 六层 Guardrails + 魔法词拉闸 |
| **记忆** | 会话上下文 / 一个扁平记忆文件 | 情景记忆存储（EchoStore）× 蒸馏知识库（MindCodex）跨域联邦 |
| **形态** | 一个抽象 agent / 一个 CLI | 5 种可进化形态——生物 / 组织 / 物品 / 虚拟 / 混合 |

> **你已经在用的这些编码智能体是劳动力；FlowForge 赋予它们名字、记忆和管理者。**

## 核心特性

- **持久身份（可进化智能体 Forgekin）** — 拥有持久身份（Soul Imprint）、能力画像（Capability Profile）与情景记忆存储（EchoStore）的长寿可进化智能体（Forgekin），可跨越崩溃、模型升级与会话边界而存活。
- **自进化闭环（Self-Devolution Loops）** — 五条闭环让可进化智能体（Forgekin）在治理闸门下，自主进化自己的文档、代码、框架、审查与测试。
- **跨厂商审查** — 审查者必须来自与作者不同的厂商；没有智能体能审批自己的成果。
- **多域记忆联邦** — 通过蒸馏知识库（MindCodex）这一程序性记忆载体联邦的五域记忆。
- **七层驾驭工程（Harness Engineering）** — `durable_state`（持久状态）· `tool_mediation`（工具中介）· `evidence_sensors`（证据传感）· `governance`（治理）· `magic_words`（魔法词）· `entropy_control`（熵控）· `harnessability`（驾驭度）。
- **配置驱动的可进化智能体（Forgekin）** — 通过 YAML 画像注册任意数量的可进化智能体（Forgekin）。5 个默认 Forgekin 只是参考示例，并非上限。
- **三方 Agent（能力扩展）集成** — 将 Claude Code / Codex / Gemini / OpenCode / Trae CN 绑定为能力扩展。

## 可进化智能体（Forgekin）：可配置的自进化智能体

**架构并不固定于任何数量的可进化智能体（Forgekin）。** 可进化智能体（Forgekin）是配置驱动的实体——向 `config/forgekins/` 放入一份 YAML 画像即可注册一个，将其绑定到一条自进化闭环（Self-Devolution Loop），并（可选地）绑定一个三方编码 Agent（能力扩展）。ForgeMind 引擎（通用智能体框架）在运行期依据能力画像路由任务，而非硬编码角色。

**自进化才是架构的核心，而非可进化智能体（Forgekin）的数量。**

### 5 个默认可进化智能体（Forgekin，参考示例）

| 可进化智能体（Forgekin） | 厂商 | 自进化闭环 | 三方 Agent（能力扩展） |
|--------------------------|------|-----------|------------------------|
| **Wenxin（文心）** | anthropic | 文档进化 | Claude Code |
| **Sherlock（夏洛克）** | openai | 代码进化 | Codex |
| **Vangogh（梵高）** | google | 跨厂商审查 | Gemini |
| **Da Vinci（达芬奇）** | open_source | 测试进化 | OpenCode |
| **Luban（鲁班）** | bytedance | 框架进化 *（需运营者审批）* | Trae CN |

### 新增你自己的可进化智能体（Forgekin）

注册一个新的可进化智能体（Forgekin）是**纯配置操作**——无需改动框架代码：

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
│  可进化智能体注册表（ForgekinRegistry） · 多智能体议事（MindCouncil） · 三方 Agent（能力扩展） │
├─────────────────────────────────────────────────────────────────┤
│  指令层 · evolution/                                             │
│  ForgeMind 引擎（通用智能体框架） · 元认知路由 · 成熟度阶梯        │
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

# （可选）安装三方编码 Agent CLI
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

### 验证 5 个默认可进化智能体（Forgekin）

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

每个可进化智能体（Forgekin）都由 `config/forgekins/*.yaml` 下的一份 YAML 画像描述。**框架对可进化智能体（Forgekin）的数量没有上限**——按需增删画像即可匹配你的部署。

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
| **2** | forgemind 应用层 + 可进化智能体形态 | 🔄 进行中（约 85%） |
| **3** | 三方 Agent 适配层 | 🔄 进行中（约 80%） |
| **4** | 评估自代谢 + 分布式可靠性 | 🔄 进行中（约 40%） |
| **5** | 协同数学 + 自进化闭环 | 🔄 进行中（约 60%） |
| **6** | SpiritForge 经验蒸馏 + 多智能体议事（MindCouncil） | 🔄 进行中（约 40%） |

详见 [docs/roadmap.md](docs/roadmap.md)。

## 项目结构

```
flowforge/
├── core/              # 共享内核：capability · teamact · harness · memory · eval
├── evolution/         # ForgeMind 引擎（通用智能体框架，自进化编排）
├── forgemind/         # 应用层：forgekin · registry · council · external_agents
├── web/               # Web UI（Next.js 14 + FastAPI 后端）
├── config/            # forgemind.yaml · forgekins/*.yaml · evolution.yaml
├── docs/              # spec · arch · design · roadmap · ADRs · features
├── scripts/           # setup.py · install_agents.py · start.py · verify_five_forgekins.py
└── tests/             # 测试套件
```

## 贡献

我们欢迎任何形式的贡献——新的可进化智能体（Forgekin）画像、适配器集成、文档改进，或核心框架工作。

- 🐛 [报告 Bug](https://github.com/flowlight-ai/flowforge/issues/new?template=bug_report.yml)
- 💡 [提交功能建议](https://github.com/flowlight-ai/flowforge/issues/new?template=feature_request.yml)
- 💬 [加入讨论](https://github.com/flowlight-ai/flowforge/discussions)

提交 Pull Request 前请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

FlowForge 基于 **[MIT 许可证](LICENSE)** 发布。
