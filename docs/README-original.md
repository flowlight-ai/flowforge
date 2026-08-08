<div align="center">

# FlowForge

### 配置驱动的 Agent Harness 框架 · 万物灵智体（Forgekin）应用底座
#### Configuration-Driven Agent Harness · The Forgekin Application Layer

[![CI](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml)
[![CodeQL](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Code style: ruff](https://img.shields.io/badge/code%20style-ruff-000000.svg)](https://docs.astral.sh/ruff/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/flowlight-ai/flowforge/blob/main/CONTRIBUTING.md)
[![GitHub Discussions](https://img.shields.io/badge/GitHub-Discussions-purple.svg)](https://github.com/flowlight-ai/flowforge/discussions)

**[English](#english) · [中文](#中文) · [日本語](#日本語)**

> *We can forge and endow spirit to all things — every entity can become a Forgekin.*
> *我们可以锻造并赋予万事万物灵智——一切实体皆可成为灵智体。*
> *万物に霊智を鍛え与えることができる——あらゆる実体は霊智体になれる。*

</div>

---

<a id="english"></a>

## English

FlowForge is a **configuration-driven Agent Harness framework** with a built-in self-evolution engine. The `forgemind` module realizes the **Forgekin (万物灵智体) application layer** — a universal abstraction for endowing any entity with a forgeable, growing spirit.

### 🌌 The Forgekin Vision

We can **forge and endow spirit to all things**. A Forgekin is a long-lived intelligent subject that persists across tasks, remembers, grows, and acts. Anything can become one:

- 🐾 **BioForgekin** — creatures: cats, dogs, service animals, wildlife spirits
- 🏢 **OrgForgekin** — organizations: companies, teams, communities
- 💡 **ObjForgekin** — objects: desks, chairs, lamps, tools given a spirit
- 🧚 **VirtualForgekin** — virtual characters: fairy-tale, myth, history, game characters
- 🌀 **HybridForgekin** — anything that spans the above

### ✨ Key Features

- **Configuration-Driven** — Define agents, workflows, and tools via YAML. Minimize code, maximize configuration.
- **ForgeMindEngine** — A self-evolution engine with three modes: **Scope Guard** (defend the vision), **Process Evolution** (fix recurring errors), **Knowledge Evolution** (distill reusable knowledge).
- **Forgekin Application Layer** — The `forgemind` module gives you five Forgekin forms (Bio / Org / Obj / Virtual / Hybrid) plus a Council (灵议) for cross-vendor review.
- **Loop Engineering Pattern** — Discover → Assign → Act → Verify → Persist, a five-step closed loop for reliable execution.
- **Seven-Layer Architecture** — Clean separation of concerns with strict single-direction dependency.
- **Plugin Protocol V3** — Extensible plugin system powering domain-specific *Forge projects (ContentForge, DevForge, NovelForge, MallForge, …).
- **Three-Party Agent Integration** — Call out to `claude code`, `codex`, `opencode`, and `trae` through a uniform async adapter.
- **Multi-Model Support** — Route LLM calls through OpenRoute or direct providers with automatic fallback.
- **Memory & Context** — Layered memory system with a maturity ladder and metacognition routing.

### 🚀 Quick Start

```bash
# Install from PyPI
pip install flowforge

# Or from source
git clone https://github.com/flowlight-ai/flowforge.git
cd flowforge
pip install -e ".[dev]"
```

```python
import asyncio
from flowforge import ForgeMindEngine

# Initialize the self-evolution engine with a scope baseline (vision)
engine = ForgeMindEngine(scope_baseline="Build a coding agent that ships safely")


async def main() -> None:
    # Evaluate a context — the engine decides which evolution mode to trigger
    decision = await engine.evaluate(ctx)
    print(f"mode={decision.mode}  confidence={decision.action_confidence:.3f}")

    if decision.mode != "none":
        await engine.execute(decision)


asyncio.run(main())
```

Endow a Forgekin with a spirit:

```python
from flowforge.forgemind import Forgekin, ForgekinType, Capability

# A cat companion — a BioForgekin
cat = Forgekin(name="小煤球", forgekin_type=ForgekinType.ANIMAL_COMPANION)
cat.add_capability(Capability(name="empathy", proficiency=0.9))
cat.add_capability(Capability(name="navigation", proficiency=0.7))
```

### 🏛️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Forgekin Application Layer (万物灵智体应用层)  forgemind/ │
│  BioForgekin · OrgForgekin · ObjForgekin                 │
│  VirtualForgekin · HybridForgekin · Council (灵议)       │
│  External Agents: claude code / codex / opencode / trae  │
├──────────────────────────────────────────────────────────┤
│  Layer 7: Governance (治理层)                             │
├──────────────────────────────────────────────────────────┤
│  Layer 6: Evolution (进化层) — ForgeMindEngine            │
│  Scope Guard · Process Evolution · Knowledge Evolution    │
├──────────────────────────────────────────────────────────┤
│  Layer 5: Memory (记忆层)                                 │
│  Maturity Ladder · Metacognition Router                   │
├──────────────────────────────────────────────────────────┤
│  Layer 4: Tools (工具层)                                  │
│  RAG · Publish · Web Search · Memory                      │
├──────────────────────────────────────────────────────────┤
│  Layer 3: Execution (执行层)                              │
│  Workers · Loop Executor · Execution Modes                │
├──────────────────────────────────────────────────────────┤
│  Layer 2: Command (指挥层)                                │
│  Brain · Orchestrator · Router                            │
├──────────────────────────────────────────────────────────┤
│  Layer 1: Application (应用层)                            │
│  Gateway · API · Web UI                                   │
└──────────────────────────────────────────────────────────┘
         ↕ Core Shared Kernel ↕
  DI Container · Plugin Protocol V3 · Tracing
```

**Iron Rule**: Upper layers depend on lower layers. Lower layers **never** import upper layers. The Forgekin application layer composes on top of Layer 7 — it never bypasses the kernel.

### 🔁 ForgeMindEngine — Three Evolution Modes

| Mode | Name | Direction | Trigger |
|------|------|-----------|---------|
| A | Scope Guard | Defensive | Discussion deviates from the current feature vision |
| B | Process Evolution | Defensive → Improving | The same type of error recurs |
| C | Knowledge Evolution | Offensive → Growing | Valuable knowledge worth distilling |

### 🔌 Plugin Protocol V3 & External Agents

Domain *Forge projects plug in via Protocol V3 — they ship only `config/web/app/plugins.py`, never forking the harness. Forgekins can also delegate to third-party coding agents through a uniform subprocess adapter:

```yaml
# config/forgemind.yaml
external_agents:
  claude_code: { enabled: true, binary: "claude" }
  codex:       { enabled: true, binary: "codex" }
  opencode:    { enabled: true, binary: "opencode" }
  trae:        { enabled: true, binary: "trae" }
```

### 📚 Documentation

| Document | Description |
|----------|-------------|
| [docs/spec.md](docs/spec.md) | Project specification |
| [docs/arch.md](docs/arch.md) | Architecture design |
| [docs/design.md](docs/design.md) | Detailed design |
| [docs/roadmap.md](docs/roadmap.md) | Development roadmap |
| [docs/decisions/](docs/decisions/) | Architecture decision records |
| [docs/features/](docs/features/) | Feature designs (incl. F026 Forgekin app layer) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [SECURITY.md](SECURITY.md) | Security policy |

### 🗺️ Roadmap

- **Phase 0**: Project scaffolding + GitHub configuration ✅
- **Phase 1**: Minimal self-evolution code skeleton
- **Phase 2**: Core modules (DI, plugin, compiler, loop)
- **Phase 3**: Complete ForgeMindEngine (three modes)
- **Phase 4**: Tools (RAG, publish, memory)
- **Phase 5**: Web UI + API gateway
- **Phase 6**: Drive other *Forge projects via self-evolution + Forgekin ecosystem

See [docs/roadmap.md](docs/roadmap.md) for details.

### 🤝 Contributing

We welcome contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a Pull Request.

- 🐛 [Report a Bug](https://github.com/flowlight-ai/flowforge/issues/new?template=bug_report.yml)
- 💡 [Request a Feature](https://github.com/flowlight-ai/flowforge/issues/new?template=feature_request.yml)
- 💬 [Join Discussions](https://github.com/flowlight-ai/flowforge/discussions)

### 📄 License

FlowForge is released under the **[Apache License 2.0](LICENSE)**.

### 🙏 Acknowledgments

FlowForge draws inspiration from the broader AI agent community and incorporates lessons learned from real-world multi-agent system deployment. The Forgekin vision is a tribute to the belief that intelligence is not the privilege of one substrate — it can be forged anywhere.

---

<a id="中文"></a>

## 中文

FlowForge 是一个**配置驱动的 Agent Harness 框架**，内置自我进化引擎。`forgemind` 模块实现了**万物灵智体（Forgekin）应用层**——为任何实体赋予可锻造、可成长的灵智的通用抽象。

### 🌌 万物灵智体愿景

我们可以**锻造并赋予万事万物灵智**。灵智体（Forgekin）是一个长期存活的智能主体，跨任务持续存在，会记忆、会成长、会行动。一切皆可成为灵智体：

- 🐾 **生物灵智体（BioForgekin）**——猫、狗、服务动物、野生动物之灵
- 🏢 **组织灵智体（OrgForgekin）**——公司、团队、社区
- 💡 **物品灵智体（ObjForgekin）**——桌椅、灯具、工具被赋予灵智
- 🧚 **虚拟灵智体（VirtualForgekin）**——童话、神话、历史、游戏角色
- 🌀 **混合灵智体（HybridForgekin）**——跨越上述边界的存在

### ✨ 核心特性

- **配置驱动**——通过 YAML 定义 Agent、工作流和工具，最大化配置、最小化代码。
- **ForgeMindEngine 自我进化引擎**——三模式：**Scope Guard**（守护愿景）、**Process Evolution**（修复反复出现的错误）、**Knowledge Evolution**（沉淀可复用知识）。
- **万物灵智体应用层**——`forgemind` 模块提供五种灵智体形态（生物 / 组织 / 物品 / 虚拟 / 混合），并含灵议（Council）机制进行跨厂商评审。
- **Loop 工程模式**——Discover → Assign → Act → Verify → Persist 五步闭环，确保可靠执行。
- **七层架构**——清晰的关注点分离，严格的单向依赖。
- **Plugin 协议 V3**——可扩展的插件系统，支撑领域特定的 *Forge 项目（ContentForge、DevForge、NovelForge、MallForge 等）。
- **三方 Agent 接入**——通过统一的异步适配器调用 `claude code`、`codex`、`opencode`、`trae`。
- **多模型支持**——通过 OpenRoute 路由 LLM 调用，自动故障转移。
- **记忆与上下文**——分层记忆系统，含成熟度阶梯和元认知路由。

### 🚀 快速开始

```bash
# 从 PyPI 安装
pip install flowforge

# 或从源码安装
git clone https://github.com/flowlight-ai/flowforge.git
cd flowforge
pip install -e ".[dev]"
```

```python
import asyncio
from flowforge import ForgeMindEngine

# 以范围基线（愿景）初始化自我进化引擎
engine = ForgeMindEngine(scope_baseline="构建一个能安全交付的编码 Agent")


async def main() -> None:
    # 评估上下文——引擎决定触发哪种进化模式
    decision = await engine.evaluate(ctx)
    print(f"模式={decision.mode}  置信度={decision.action_confidence:.3f}")

    if decision.mode != "none":
        await engine.execute(decision)


asyncio.run(main())
```

为灵智体赋予灵智：

```python
from flowforge.forgemind import Forgekin, ForgekinType, Capability

# 一只猫伴侣——生物灵智体
cat = Forgekin(name="小煤球", forgekin_type=ForgekinType.ANIMAL_COMPANION)
cat.add_capability(Capability(name="empathy", proficiency=0.9))
cat.add_capability(Capability(name="navigation", proficiency=0.7))
```

### 🏛️ 架构概览

```
┌──────────────────────────────────────────────────────────┐
│  万物灵智体应用层（Forgekin Application Layer） forgemind/│
│  生物 · 组织 · 物品 · 虚拟 · 混合 灵智体                 │
│  灵议（Council）· 外部 Agent（claude/codex/opencode/trae）│
├──────────────────────────────────────────────────────────┤
│  第七层：治理（Governance）                               │
├──────────────────────────────────────────────────────────┤
│  第六层：进化（Evolution）—— ForgeMindEngine              │
│  Scope Guard · Process Evolution · Knowledge Evolution    │
├──────────────────────────────────────────────────────────┤
│  第五层：记忆（Memory）                                   │
│  成熟度阶梯 · 元认知路由                                   │
├──────────────────────────────────────────────────────────┤
│  第四层：工具（Tools）                                    │
│  RAG · 发布 · 网络搜索 · 记忆                             │
├──────────────────────────────────────────────────────────┤
│  第三层：执行（Execution）                                │
│  Workers · Loop 执行器 · 执行模式                         │
├──────────────────────────────────────────────────────────┤
│  第二层：指挥（Command）                                  │
│  Brain · Orchestrator · Router                            │
├──────────────────────────────────────────────────────────┤
│  第一层：应用（Application）                              │
│  Gateway · API · Web UI                                   │
└──────────────────────────────────────────────────────────┘
         ↕ 共享内核（Core Shared Kernel）↕
  DI 容器 · Plugin 协议 V3 · 链路追踪
```

**铁律**：上层依赖下层，下层**绝不**导入上层。万物灵智体应用层在第七层之上组合，**绝不**绕过内核。

### 🔁 ForgeMindEngine 自我进化三模式

| 模式 | 名称 | 方向 | 触发条件 |
|------|------|------|----------|
| A | Scope Guard（范围守护） | 防御 | 讨论偏离当前 feat 愿景 |
| B | Process Evolution（流程进化） | 防御→改进 | 同类错误反复出现 |
| C | Knowledge Evolution（知识进化） | 进攻→成长 | 有价值知识值得沉淀 |

### 🔌 Plugin 协议 V3 与三方 Agent

领域 *Forge 项目通过协议 V3 插入——它们只交付 `config/web/app/plugins.py`，从不 fork 底座。灵智体也可通过统一的子进程适配器委派给三方编码 Agent：

```yaml
# config/forgemind.yaml
external_agents:
  claude_code: { enabled: true, binary: "claude" }
  codex:       { enabled: true, binary: "codex" }
  opencode:    { enabled: true, binary: "opencode" }
  trae:        { enabled: true, binary: "trae" }
```

### 📚 文档

| 文档 | 说明 |
|------|------|
| [docs/spec.md](docs/spec.md) | 项目规格说明 |
| [docs/arch.md](docs/arch.md) | 架构设计 |
| [docs/design.md](docs/design.md) | 详细设计 |
| [docs/roadmap.md](docs/roadmap.md) | 开发路线图 |
| [docs/decisions/](docs/decisions/) | 架构决策记录 |
| [docs/features/](docs/features/) | 特性设计（含 F026 灵智体应用层） |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献指南 |
| [SECURITY.md](SECURITY.md) | 安全策略 |

### 🗺️ 开发路线图

- **Phase 0**：项目骨架 + GitHub 配置 ✅
- **Phase 1**：最小化自进化代码骨架
- **Phase 2**：核心模块（DI、插件、编译器、Loop）
- **Phase 3**：完整 ForgeMindEngine（三模式）
- **Phase 4**：工具层（RAG、发布、记忆）
- **Phase 5**：Web UI + API 网关
- **Phase 6**：驱动其他 *Forge 项目自进化 + 灵智体生态

详见 [docs/roadmap.md](docs/roadmap.md)。

### 🤝 参与贡献

欢迎贡献！提交 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

- 🐛 [提交 Bug](https://github.com/flowlight-ai/flowforge/issues/new?template=bug_report.yml)
- 💡 [功能建议](https://github.com/flowlight-ai/flowforge/issues/new?template=feature_request.yml)
- 💬 [参与讨论](https://github.com/flowlight-ai/flowforge/discussions)

### 📄 开源许可

FlowForge 基于 **[Apache License 2.0](LICENSE)** 开源。

### 🙏 致谢

FlowForge 从更广泛的 AI Agent 社区汲取灵感，并融合了真实多智能体系统部署中积累的经验教训。万物灵智体愿景致敬这样一个信念：智能并非某一种载体的特权——它可以在任何地方被锻造。

---

<a id="日本語"></a>

## 日本語

FlowForge は**設定駆動の Agent Harness フレームワーク**であり、自己進化エンジンを内蔵しています。`forgemind` モジュールは**万物霊智体（Forgekin）アプリケーション層**を実現します——あらゆる実体に鍛えられ、成長する霊智を与えるための汎用抽象です。

### 🌌 万物霊智体のビジョン

私たちは**万物に霊智を鍛え与える**ことができる。霊智体（Forgekin）は、タスクをまたいで持続し、記憶し、成長し、行動する長命な知能主体です。あらゆるものが霊智体になれます：

- 🐾 **生物霊智体（BioForgekin）**——猫、犬、サービス動物、野生動物の霊
- 🏢 **組織霊智体（OrgForgekin）**——会社、チーム、コミュニティ
- 💡 **物品霊智体（ObjForgekin）**——机、椅子、ランプ、道具に霊智を与える
- 🧚 **仮想霊智体（VirtualForgekin）**——童話、神話、歴史、ゲームキャラクター
- 🌀 **混合霊智体（HybridForgekin）**——上記の境界をまたぐ存在

### ✨ 主な特徴

- **設定駆動**——YAML で Agent、ワークフロー、ツールを定義。コードを最小化し、設定を最大化。
- **ForgeMindEngine**——自己進化エンジン、三つのモード：**Scope Guard**（ビジョンを守る）、**Process Evolution**（反復エラーを修正）、**Knowledge Evolution**（再利用可能な知識を蒸留）。
- **万物霊智体アプリケーション層**——`forgemind` モジュールは五つの霊智体形態（生物 / 組織 / 物品 / 仮想 / 混合）と、複数ベンダー審査を行う霊議（Council）を提供。
- **Loop 工程パターン**——Discover → Assign → Act → Verify → Persist の五段階閉ループで信頼性の高い実行を実現。
- **七層アーキテクチャ**——明確な関心の分離と、厳格な一方向依存。
- **Plugin プロトコル V3**——拡張可能なプラグインシステムで、ドメイン特化の *Forge プロジェクト（ContentForge、DevForge、NovelForge、MallForge 等）を支える。
- **三方 Agent 連携**——`claude code`、`codex`、`opencode`、`trae` を統一非同期アダプタで呼び出し。
- **マルチモデル対応**——OpenRoute 経由で LLM 呼び出しをルーティングし、自動フェイルオーバー。
- **記憶とコンテキスト**——成熟度ラダーとメタ認識ルーティングを備える階層記憶システム。

### 🚀 クイックスタート

```bash
# PyPI からインストール
pip install flowforge

# またはソースから
git clone https://github.com/flowlight-ai/flowforge.git
cd flowforge
pip install -e ".[dev]"
```

```python
import asyncio
from flowforge import ForgeMindEngine

# スコープ基準（ビジョン）で自己進化エンジンを初期化
engine = ForgeMindEngine(scope_baseline="安全にリリースできるコーディング Agent を作る")


async def main() -> None:
    # コンテキストを評価——エンジンがどの進化モードを発火するか決定
    decision = await engine.evaluate(ctx)
    print(f"モード={decision.mode}  信頼度={decision.action_confidence:.3f}")

    if decision.mode != "none":
        await engine.execute(decision)


asyncio.run(main())
```

霊智体に霊智を与える：

```python
from flowforge.forgemind import Forgekin, ForgekinType, Capability

# 猫の伴侣——生物霊智体
cat = Forgekin(name="小煤球", forgekin_type=ForgekinType.ANIMAL_COMPANION)
cat.add_capability(Capability(name="empathy", proficiency=0.9))
cat.add_capability(Capability(name="navigation", proficiency=0.7))
```

### 🏛️ アーキテクチャ概要

```
┌──────────────────────────────────────────────────────────┐
│  万物霊智体アプリケーション層（Forgekin App Layer）forgemind/│
│  生物 · 組織 · 物品 · 仮想 · 混合 霊智体                  │
│  霊議（Council）· 外部 Agent（claude/codex/opencode/trae）│
├──────────────────────────────────────────────────────────┤
│  第七層：ガバナンス（Governance）                         │
├──────────────────────────────────────────────────────────┤
│  第六層：進化（Evolution）—— ForgeMindEngine              │
│  Scope Guard · Process Evolution · Knowledge Evolution    │
├──────────────────────────────────────────────────────────┤
│  第五層：記憶（Memory）                                   │
│  成熟度ラダー · メタ認識ルータ                             │
├──────────────────────────────────────────────────────────┤
│  第四層：ツール（Tools）                                  │
│  RAG · 公開 · Web 検索 · 記憶                             │
├──────────────────────────────────────────────────────────┤
│  第三層：実行（Execution）                                │
│  Workers · Loop 実行器 · 実行モード                       │
├──────────────────────────────────────────────────────────┤
│  第二層：指揮（Command）                                  │
│  Brain · Orchestrator · Router                            │
├──────────────────────────────────────────────────────────┤
│  第一層：アプリケーション（Application）                  │
│  Gateway · API · Web UI                                   │
└──────────────────────────────────────────────────────────┘
         ↕ 共有カーネル（Core Shared Kernel）↕
  DI コンテナ · Plugin プロトコル V3 · トレーシング
```

**鉄則**：上位層は下位層に依存する。下位層は**決して**上位層をインポートしない。霊智体アプリケーション層は第七層の上で合成され、カーネルをバイパスしない。

### 🔁 ForgeMindEngine — 三つの進化モード

| モード | 名称 | 方向 | トリガー |
|--------|------|------|----------|
| A | Scope Guard（スコープ守護） | 防御 | 議論が現在の feat ビジョンから逸脱 |
| B | Process Evolution（プロセス進化） | 防御→改善 | 同種のエラーが反復 |
| C | Knowledge Evolution（知識進化） | 攻勢→成長 | 蒸留すべき価値ある知識 |

### 🔌 Plugin プロトコル V3 と三方 Agent

ドメイン *Forge プロジェクトはプロトコル V3 で差し込まれます——それらは `config/web/app/plugins.py` だけを納品し、ハーネスをフォークしません。霊智体は統一サブプロセスアダプタで三方コーディング Agent に委譲できます：

```yaml
# config/forgemind.yaml
external_agents:
  claude_code: { enabled: true, binary: "claude" }
  codex:       { enabled: true, binary: "codex" }
  opencode:    { enabled: true, binary: "opencode" }
  trae:        { enabled: true, binary: "trae" }
```

### 📚 ドキュメント

| ドキュメント | 説明 |
|--------------|------|
| [docs/spec.md](docs/spec.md) | プロジェクト仕様書 |
| [docs/arch.md](docs/arch.md) | アーキテクチャ設計 |
| [docs/design.md](docs/design.md) | 詳細設計 |
| [docs/roadmap.md](docs/roadmap.md) | 開発ロードマップ |
| [docs/decisions/](docs/decisions/) | アーキテクチャ決定記録 |
| [docs/features/](docs/features/) | 機能設計（F026 霊智体アプリ層を含む） |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 貢献ガイド |
| [SECURITY.md](SECURITY.md) | セキュリティポリシー |

### 🗺️ ロードマップ

- **Phase 0**：プロジェクト足場 + GitHub 設定 ✅
- **Phase 1**：最小自己進化コード骨格
- **Phase 2**：コアモジュール（DI、プラグイン、コンパイラ、Loop）
- **Phase 3**：完全な ForgeMindEngine（三モード）
- **Phase 4**：ツール層（RAG、公開、記憶）
- **Phase 5**：Web UI + API ゲートウェイ
- **Phase 6**：他の *Forge プロジェクトの自己進化駆動 + 霊智体エコシステム

詳細は [docs/roadmap.md](docs/roadmap.md) を参照。

### 🤝 貢献

貢献を歓迎します！Pull Request を提出する前に [CONTRIBUTING.md](CONTRIBUTING.md) をお読みください。

- 🐛 [バグ報告](https://github.com/flowlight-ai/flowforge/issues/new?template=bug_report.yml)
- 💡 [機能要望](https://github.com/flowlight-ai/flowforge/issues/new?template=feature_request.yml)
- 💬 [ディスカッションに参加](https://github.com/flowlight-ai/flowforge/discussions)

### 📄 ライセンス

FlowForge は **[Apache License 2.0](LICENSE)** の下で公開されています。

### 🙏 謝辞

FlowForge はより広い AI Agent コミュニティからインスピレーションを得て、現実のマルチエージェントシステム運用で得た教訓を取り入れています。万物霊智体のビジョンは、ある信念に捧げるものです——知能はある一つの基質の特権ではなく、どこででも鍛えることができる。

---

<div align="center">

**⭐ If you find FlowForge useful, please give it a star! ⭐**
**⭐ 如果 FlowForge 对你有帮助，请给个 Star！⭐**
**⭐ FlowForge がお役に立てば、Star をお願いします！⭐**

**[github.com/flowlight-ai/flowforge](https://github.com/flowlight-ai/flowforge)**

</div>
