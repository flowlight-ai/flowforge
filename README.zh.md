<div align="center">

# FlowForge（简体中文）

### 自进化智能体驾驭层 · 持久身份框架

[![CI](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml)
[![CodeQL](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml)
[![Node](https://img.shields.io/badge/node-%5E22.19.0%20%7C%7C%20%3E%3D24.0.0-blue.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11.7.0-orange.svg)](https://pnpm.io/)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Code style: ruff](https://img.shields.io/badge/code%20style-ruff-000000.svg)](https://docs.astral.sh/ruff/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/flowlight-ai/flowforge/blob/main/CONTRIBUTING.md)

> *锻造持久身份 · 赋予记忆、多智能体议事（MindCouncil）与自进化（Self-Devolution）能力。*

</div>

---

[🇺🇸 English](README.md) · [🇨🇳 简体中文](README.zh.md) · [🇯🇵 日本語](README.ja.md)

## FlowForge 是什么？

FlowForge（`flowforge`）是一个基于**一切皆插件**架构的企业级智能体驾驭层（Harness Layer），由 vendored 的 [Cordis](https://github.com/cordiverse/cordis) 内核 rescoop 为 `@flowforge/cordis` 驱动。其设计遵循[_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

它以 TypeScript pnpm 单体仓库形态交付，**每一项能力都是一个 Cordis 插件**（`packages/*`，作用域 `@flowforge/*`）。另有 Python 3.11+ 单体（`agents/`、`brain/`、`core/`、`llm/`、`loop/`、`forgemind/`、`web/`、`sdk.py`）作为 legacy 实现对齐于 sunset 路径。

FlowForge 是智能体的**驾驭层**：它不替代你的智能体，而是**雇佣**它们作为能力扩展，并将其培养为有名字、有记忆、有成长轨迹、有责任的持久可进化智能体——**Forgekin**。

## 为什么需要 FlowForge？

| 能力 | FlowForge 提供了什么 |
|------|----------------------|
| **智能体级持久身份** | Forgekin 通过持久 *Soul Imprint* 跨越崩溃、模型升级与会话边界而存活。 |
| **结构化自进化闭环** | 五条 *Self-Devolution* 闭环让 Forgekin 在治理闸门下自主进化文档/代码/框架/审查/测试。 |
| **跨厂商审查** | 审查者必须来自与作者不同的厂商——没有智能体能审批自己的产出。 |
| **经验蒸馏管线** | *SpiritForge* 将经验蒸馏进 *MindCodex* 程序性记忆库。 |
| **渐进自主（6 级 + 护栏）** | *Awakening 阶*让运营者安全地逐步调高自主度。 |
| **多形态智能体** | 五种可进化形态覆盖不同角色与使命。 |
| **多智能体议事** | *MindCouncil* 围绕共享使命协调多个 Forgekin。 |
| **三方智能体集成** | 将 Claude Code / Codex / Gemini / OpenCode / Trae CN 绑定为能力扩展。 |

> **Build AI teams, not just agents. Hard rails, soft power, shared mission.**

## 核心特性

- **持久身份（Forgekin）** — 拥有持久身份（*Soul Imprint*）、能力画像与情景记忆库（*EchoStore*）的长寿可进化智能体。
- **自进化闭环（Self-Devolution Loops）** — 治理闸门下的五条闭环，让 Forgekin 自主进化自己的文档、代码、框架、审查与测试。
- **跨厂商审查** — 结构性强制分离；审查者必须与作者不同厂商。
- **多域记忆联邦** — 经由蒸馏知识库 *MindCodex* 联邦的五域记忆。
- **七层驾驭工程（Harness Engineering）** — `durable_state` · `tool_mediation` · `evidence_sensors` · `governance` · `magic_words` · `entropy_control` · `harnessability`。
- **配置驱动的可进化智能体（Forgekin）** — 通过 `config/forgekins/` 下的 YAML 画像注册任意数量的 Forgekin；5 个默认 Forgekin 只是参考示例，并非上限。
- **三方智能体集成** — 将 Claude Code / Codex / Gemini / OpenCode / Trae CN 绑定为能力扩展。

## 可进化智能体（Forgekin）：可配置的自进化智能体

**架构并不固定于任何数量的 Forgekin。** Forgekin 是配置驱动的实体——向 `config/forgekins/` 放入一份 YAML 画像即可注册一个，将其绑定到一条自进化闭环（Self-Devolution Loop），并（可选地）绑定一个三方编码 Agent（能力扩展）。ForgeMind 引擎在运行期依据能力画像路由任务，而非硬编码角色。

**自进化才是架构的核心，而非 Forgekin 的数量。**

### 5 个默认可进化智能体（Forgekin，参考示例）

| 可进化智能体（Forgekin） | 厂商 | 自进化闭环 | 三方 Agent（能力扩展） |
|--------------------------|------|-----------|------------------------|
| **Wenxin（文心）** | anthropic | 文档进化 | Claude Code |
| **Sherlock（夏洛克）** | openai | 代码进化 | Codex |
| **Vangogh（梵高）** | google | 跨厂商审查 | Gemini |
| **Da Vinci（达芬奇）** | open_source | 测试进化 | OpenCode |
| **Luban（鲁班）** | bytedance | 框架进化 *（需运营者审批）* | Trae CN |

### 新增你自己的可进化智能体（Forgekin）

注册一个新的 Forgekin 是**纯配置操作**——无需改动框架代码：

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
│  ForgekinRegistry · 多智能体议事（MindCouncil） · 三方 Agent       │
├─────────────────────────────────────────────────────────────────┤
│  指令层 · evolution/                                             │
│  ForgeMind 引擎 · 元认知路由 · 成熟度阶梯                          │
├─────────────────────────────────────────────────────────────────┤
│  执行层 · workers/ · loop/                                       │
│  自进化闭环 · 闭环执行器 · 执行模式                                │
├─────────────────────────────────────────────────────────────────┤
│  工具与记忆层 · core/                                            │
│  capability · teamact · harness · memory · eval · reliability     │
└─────────────────────────────────────────────────────────────────┘
       ↕ 共享内核：DI 容器 · 插件协议 · 链路追踪 ↕
```

**单向依赖**：上层依赖下层；下层绝不导入上层。

在活跃的 TypeScript 重写中，Cordis 内核（`@flowforge/cordis`）提供插件运行时，每一项能力都作为 Cordis 插件位于 `packages/<group>/<pkg>/` 下。

## 开发者预览

FlowForge 当前处于**开发者预览**阶段，正在快速迭代。**将出现破坏性兼容性变更。**

> TypeScript `packages/*` 重写是活跃主线；Python 单体为 legacy，已冻结进入 sunset。TS 用 `pnpm`，Python 用 `pytest`/`ruff`。

## 快速开始

### 从源码运行（TypeScript，活跃主线）

克隆仓库并使用 pnpm（Corepack `pnpm@11.7.0`，Node `^22.19.0 || >=24.0.0`）：

```sh
git clone https://gitee.com/flowlight/flowforge.git   # Gitee（base: master）
cd flowforge
pnpm install
pnpm build          # tsc -b tsconfig.host.json
pnpm flowforge      # 主机 CLI —— PLANNED / stage 3（apps/cli 尚未落地）
pnpm start          # 别名 `pnpm flowforge web` —— PLANNED / stage 3
```

Web UI 与主机入口随 `apps/cli` 一并落地；在此之前，通过各包自身的示例与测试套件来使用。参见[开发指南](docs/development.zh.md)。

### 提交前本地检查

仅运行**覆盖你改动面的最小检查集**（穷尽覆盖由 CI 负责）：

```sh
pnpm typecheck   # TypeScript 类型检查（与 build 同一 tsc 阶段）
pnpm lint        # oxlint 静态检查
pnpm test        # vitest run
```

- 纯 TS 改动 → `pnpm typecheck` + `pnpm lint`
- 行为变更 → 补充 `pnpm test`
- 文档改动 → 同步对应文档
- 依赖/构建产物（`lib/`）改动 → 先 `pnpm build`

## 项目结构

```
flowforge/
├── vendor/                 # vendored 依赖（rescoop 为 @flowforge/*）：cordis、cosmokit……
├── packages/               # TS 插件（活跃重写）—— packages/<group>/<pkg>/
├── apps/                   # (planned / stage 3) 主机 CLI —— apps/cli/src/bin.ts
├── web/                    # Web UI（Next.js 前端）
├── native/landlock-run/    # 原生沙箱运行器（独立子工程）
├── docs/                   # 规格 / 架构 / 开发文档
├── mgr  mgr.cmd  mgr.ps1   # 强制 Git 工作流 CLI（禁止直接 git 远程操作）
├── scripts/                # 辅助脚本
└── agents/ brain/ core/ llm/ loop/ forgemind/ web/ sdk.py  # Python 3.11+ 单体（legacy，sunset）
```

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
| [docs/development.zh.md](docs/development.zh.md) | 如何构建、测试与开发 |
| [AGENTS.md](AGENTS.md) | 强制的 AI 工具与 Git 工作流规范 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献指南 |
| [SECURITY.md](SECURITY.md) | 安全策略 |

## 贡献

提交前请遵循 [AGENTS.md](AGENTS.md) 中的强制 AI 工具与 Git 工作流规范，并阅读[开发指南](docs/development.zh.md)。所有提交、推送、PR 与跨平台同步一律通过根目录 `./mgr` CLI——禁止直接 `git` 远程操作。

- 🐛 [报告 Bug](https://github.com/flowlight-ai/flowforge/issues/new?template=bug_report.yml)
- 💡 [提交功能建议](https://github.com/flowlight-ai/flowforge/issues/new?template=feature_request.yml)
- 💬 [加入讨论](https://github.com/flowlight-ai/flowforge/discussions)

## 许可证

FlowForge 基于 **[MIT 许可证](LICENSE)** 发布。

第三方依赖及其许可证披露于 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
