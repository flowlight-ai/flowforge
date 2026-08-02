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
[🇺🇸 English](README.md) · [🇨🇳 简体中文](README.zh-CN.md) · [🇯🇵 日本語](README.ja.md)

## Why FlowForge?

FlowForge is the **harness layer** that gives agents a persistent identity, self-evolution capability, and governance framework. It doesn't replace your agents — it **employs** them as capability extensions and grows them into career **Forgekin**: agents with a name, a memory, a growth trajectory, and accountability. Every capability your existing agents have, FlowForge inherits — plus six things only FlowForge has.

| Capability | Claude Code | OpenCode | Codex | WorkBuddy | Trae | Qoder | FlowForge |
|------------|:-----------:|:--------:|:-----:|:---------:|:----:|:-----:|:---------:|
| Project context | ✅ `CLAUDE.md` | ✅ | ✅ `AGENTS.md` | ✅ | ✅ | ✅ Repo Wiki | ✅ |
| Deep codebase understanding | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Multi-agent collaboration | ✅ subagents | ✅ sub-agent | — | ✅ experts | — | ✅ expert teams | ✅ MindCouncil |
| Long-term memory | ✅ memory files | — | ✅ | ✅ multi-layer | — | ✅ Knowledge Engine | ✅ EchoStore + MindCodex |
| Code generation & refactor | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Automated testing | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| Git / PR workflow & CI/CD | ✅ | ✅ | ✅ GitHub Actions | ✅ | ✅ | ✅ | ✅ |
| IDE integration | ✅ VS Code / JetBrains | — | ✅ VS Code | ✅ | ✅ IDE | ✅ JetBrains | ✅ via agents |
| CLI support | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| MCP protocol | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| Multi-model support | — | ✅ | — | ✅ | ✅ DeepSeek | ✅ Claude/Gemini/GPT | ✅ |
| Autonomous execution | ✅ checkpoints | ✅ | ✅ cloud sandbox | ✅ | ✅ | ✅ Quest Mode | ✅ |
| Web search & multimodal | — | ✅ WebSearch | ✅ screenshots | ✅ | ✅ image→code | — | ✅ |
| **Agent-level persistent identity** | — | — | — | — | — | — | ✅ Soul Imprint |
| **Self-Devolution Loops** | — | — | — | — | — | — | ✅ evolve own docs/code/tests |
| **Cross-vendor independent review** | — | — | — | — | — | — | ✅ structurally enforced |
| **Experience distillation** | — | — | — | — | — | — | ✅ SpiritForge → MindCodex |
| **Graduated autonomy (6 stages)** | — | — | — | — | — | — | ✅ Awakening Stages |
| **Multi-species morphology** | — | — | — | — | — | — | ✅ 5 evolvable species |

> **Build AI teams, not just agents. Hard rails, soft power, shared mission.**

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

