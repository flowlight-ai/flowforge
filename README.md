<div align="center">

# FlowForge (English)

### Persistent-Identity Agent Framework · Self-Evolving Closed Loops

[![CI](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml)
[![CodeQL](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Code style: ruff](https://img.shields.io/badge/code%20style-ruff-000000.svg)](https://docs.astral.sh/ruff/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/flowlight-ai/flowforge/blob/main/CONTRIBUTING.md)
[![GitHub Discussions](https://img.shields.io/badge/GitHub-Discussions-purple.svg)](https://github.com/flowlight-ai/flowforge/discussions)

> *Forging persistent identity — endowing agents with memory, multi-agent deliberation (MindCouncil), and self-evolution (Self-Devolution).*

</div>

---

[🇺🇸 English](README.md) · [🇨🇳 简体中文](README.zh-CN.md) · [🇯🇵 日本語](README.ja.md)

## Why FlowForge?

FlowForge is a **Harness Layer** that provides agents with persistent identity, self-evolution capabilities, and a governance framework. It does not replace your agents — it **hires** them as capability extensions and cultivates them into professional **Evolvable Agents (Forgekin)**: with names, memories, growth trajectories, and responsibilities. Every capability of existing agents is inherited by FlowForge — plus six core capabilities of its own.

| Capability | Claude Code | OpenCode | Codex | WorkBuddy | Trae | Qoder | FlowForge |
|------|:-----------:|:--------:|:-----:|:---------:|:----:|:-----:|:---------:|
| Autonomous task execution | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Multi-agent orchestration | ✅ subagents | ✅ | — | ✅ Agent Team | — | ✅ expert teams | ✅ MindCouncil |
| Context & long-term memory | ✅ `CLAUDE.md` | ✅ | ✅ `AGENTS.md` | ✅ multi-layer memory | ✅ | ✅ Knowledge Engine | ✅ EchoStore + MindCodex |
| Tool calling & API orchestration | ✅ MCP | ✅ MCP | ✅ MCP | ✅ MCP | ✅ | ✅ MCP | ✅ MCP |
| Cross-system integration | ✅ IDE/Git | ✅ | ✅ IDE/Git/CI | ✅ Office/WeCom | ✅ Lark/IDE | ✅ IDE | ✅ via hired agents |
| Web search & multimodal | — | ✅ | ✅ | ✅ | ✅ image→code | — | ✅ |
| Desktop & office automation | — | — | — | ✅ Word/Excel/PPT | ✅ | ✅ QoderWork | ✅ |
| Self-reflection & continuous improvement | — | — | — | — | — | ✅ consciousness | ✅ |
| **Agent-level persistent identity** | — | — | — | — | — | — | ✅ Soul Imprint |
| **Structured self-evolution closed loops** | — | — | — | — | — | — | ✅ 5 loops: docs/code/framework/review/test |
| **Cross-vendor independent review** | — | — | — | — | — | — | ✅ structurally enforced |
| **Experience distillation pipeline** | — | — | — | — | — | — | ✅ SpiritForge → MindCodex |
| **Progressive autonomy (6 levels + guardrails)** | — | — | — | — | — | — | ✅ Awakening stage |
| **Multi-form** | — | — | — | — | — | — | ✅ 5 evolvable forms |

> **Build AI teams, not just agents. Hard rails, soft power, shared mission.**

## Core Features

- **Persistent Identity (Evolvable Agent / Forgekin)** — Long-lived Evolvable Agents (Forgekin) with a Soul Imprint, Capability Profile, and Episodic Memory Store (EchoStore) that survive across crashes, model upgrades, and session boundaries.
- **Self-Devolution Loops** — Five closed loops that let Evolvable Agents (Forgekin) autonomously evolve their own documentation, code, framework, reviews, and tests under governance gates.
- **Cross-Vendor Review** — Reviewers must come from a different vendor than the author; no agent can approve its own output.
- **Multi-Domain Memory Federation** — Five memory domains federated through the MindCodex (distilled knowledge base) as a procedural memory carrier.
- **Seven-Layer Harness Engineering** — `durable_state` · `tool_mediation` · `evidence_sensors` · `governance` · `magic_words` · `entropy_control` · `harnessability`.
- **Configuration-Driven Evolvable Agents (Forgekin)** — Register any number of Evolvable Agents (Forgekin) via YAML profiles. The 5 default Forgekin are reference examples, not an upper limit.
- **Third-Party Agent (Capability Extension) Integration** — Bind Claude Code / Codex / Gemini / OpenCode / Trae CN as capability extensions.

## Evolvable Agents (Forgekin): Configurable Self-Evolving Agents

**The architecture is not fixed to any number of Evolvable Agents (Forgekin).** An Evolvable Agent (Forgekin) is a configuration-driven entity — drop a YAML profile into `config/forgekins/` to register one, bind it to a Self-Devolution Loop, and (optionally) bind a third-party coding agent (capability extension). The ForgeMind Engine (general-purpose agent framework) routes tasks at runtime based on capability profiles, not hardcoded roles.

**Self-evolution is the core of the architecture, not the number of Evolvable Agents (Forgekin).**

### 5 Default Evolvable Agents (Forgekin, reference examples)

| Evolvable Agent (Forgekin) | Vendor | Self-Devolution Loop | Third-Party Agent (Capability Extension) |
|--------------------------|------|-----------|------------------------|
| **Wenxin (文心)** | anthropic | Documentation evolution | Claude Code |
| **Sherlock (夏洛克)** | openai | Code evolution | Codex |
| **Vangogh (梵高)** | google | Cross-vendor review | Gemini |
| **Da Vinci (达芬奇)** | open_source | Test evolution | OpenCode |
| **Luban (鲁班)** | bytedance | Framework evolution *(requires operator approval)* | Trae CN |

### Add Your Own Evolvable Agent (Forgekin)

Registering a new Evolvable Agent (Forgekin) is a **pure configuration operation** — no framework code changes needed:

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

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Application Layer · forgemind/                                  │
│  ForgekinRegistry · MindCouncil · Third-Party Agents (Capability │
│  Extensions)                                                     │
├─────────────────────────────────────────────────────────────────┤
│  Instruction Layer · evolution/                                  │
│  ForgeMind Engine · Metacognition Routing · Maturity Ladder      │
├─────────────────────────────────────────────────────────────────┤
│  Execution Layer · workers/ · loop/                              │
│  Self-Devolution Loops · Loop Executors · Execution Modes        │
├─────────────────────────────────────────────────────────────────┤
│  Tools & Memory Layer · core/                                    │
│  capability · teamact · harness · memory · eval · reliability    │
└─────────────────────────────────────────────────────────────────┘
       ↕ Shared Kernel: DI Container · Plugin Protocol · Tracing ↕
```

**Unidirectional dependency**: upper layers depend on lower layers; lower layers never import upper layers.

## Quick Start

### One-Click Install (Recommended)

```bash
git clone https://github.com/flowlight-ai/flowforge.git
cd flowforge

# Set up Python environment + install backend deps + build frontend
python scripts/setup.py

# (Optional) Install third-party coding agent CLIs
python scripts/install_agents.py

# Start backend (port 8000) + frontend (port 5175)
python scripts/start.py
```

Then open **http://localhost:5175** in your browser.

### Manual Install

> **Note on package structure**: The repository root *is* the `flowforge` package (it contains a top-level `__init__.py`). When starting the backend, you must add the repository's **parent directory** to `PYTHONPATH` so that `flowforge.app.main` resolves correctly.

```bash
pip install -e ".[dev]"
cd web && npm install && npm run build && cd ..

# Copy environment variable template
cp .env.example .env  # then fill in your keys

# Start backend (repo root is the flowforge package → parent dir on PYTHONPATH)
export PYTHONPATH="$PWD/.."          # PowerShell: $env:PYTHONPATH = "$PWD\.."
python -m uvicorn flowforge.app.main:app --host 127.0.0.1 --port 8000

# Start frontend (in another terminal)
cd web && npm run dev
```

### Verify the 5 Default Evolvable Agents (Forgekin)

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

Each Evolvable Agent (Forgekin) is described by a YAML profile under `config/forgekins/*.yaml`. **The framework imposes no upper limit on the number of Evolvable Agents (Forgekin)** — add or remove profiles as needed to match your deployment.

## Documentation

| Document | Description |
|------|------|
| [docs/VISION.md](docs/VISION.md) | Project vision & design philosophy |
| [docs/spec.md](docs/spec.md) | Project specification |
| [docs/arch.md](docs/arch.md) | Architecture design |
| [docs/design.md](docs/design.md) | Detailed design |
| [docs/roadmap.md](docs/roadmap.md) | Development roadmap |
| [docs/decisions/](docs/decisions/) | Architecture Decision Records (ADRs) |
| [docs/features/](docs/features/) | Feature designs |
| [docs/roleagent.md](docs/roleagent.md) | Multi-agent engineering paths |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guide |
| [SECURITY.md](SECURITY.md) | Security policy |

## Roadmap

| Phase | Scope | Status |
|------|------|------|
| **0** | Project scaffolding + cross-platform config + docs skeleton | ✅ Done |
| **1** | Seven engineering paths code skeleton | 🔄 In progress (~70%) |
| **2** | forgemind application layer + Evolvable Agent forms | 🔄 In progress (~85%) |
| **3** | Third-party agent adaptation layer | 🔄 In progress (~80%) |
| **4** | Evaluation self-metabolism + distributed reliability | 🔄 In progress (~40%) |
| **5** | Collaboration math + self-evolution closed loops | 🔄 In progress (~60%) |
| **6** | SpiritForge experience distillation + MindCouncil | 🔄 In progress (~40%) |

See [docs/roadmap.md](docs/roadmap.md) for details.

## Project Structure

```
flowforge/
├── core/              # Shared kernel: capability · teamact · harness · memory · eval
├── evolution/         # ForgeMind Engine (general-purpose agent framework, self-evolution orchestration)
├── forgemind/         # Application layer: forgekin · registry · council · external_agents
├── web/               # Web UI (Next.js 14 + FastAPI backend)
├── config/            # forgemind.yaml · forgekins/*.yaml · evolution.yaml
├── docs/              # spec · arch · design · roadmap · ADRs · features
├── scripts/           # setup.py · install_agents.py · start.py · verify_five_forgekins.py
└── tests/             # Test suites
```

## Contributing

We welcome contributions of any kind — new Evolvable Agent (Forgekin) profiles, adapter integrations, documentation improvements, or core framework work.

- 🐛 [Report a Bug](https://github.com/flowlight-ai/flowforge/issues/new?template=bug_report.yml)
- 💡 [Submit a Feature Request](https://github.com/flowlight-ai/flowforge/issues/new?template=feature_request.yml)
- 💬 [Join the Discussion](https://github.com/flowlight-ai/flowforge/discussions)

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a Pull Request.

## License

FlowForge is released under the **[MIT License](LICENSE)**.
