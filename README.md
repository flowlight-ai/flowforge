<div align="center">

# FlowForge

### Self-evolving agent harness · persistent identity framework

[![CI](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/ci.yml)
[![CodeQL](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml/badge.svg)](https://github.com/flowlight-ai/flowforge/actions/workflows/codeql.yml)
[![Node](https://img.shields.io/badge/node-%5E22.19.0%20%7C%7C%20%3E%3D24.0.0-blue.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11.7.0-orange.svg)](https://pnpm.io/)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Code style: ruff](https://img.shields.io/badge/code%20style-ruff-000000.svg)](https://docs.astral.sh/ruff/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/flowlight-ai/flowforge/blob/main/CONTRIBUTING.md)

> *Forge durable identity. Give agents memory, multi-agent deliberation (MindCouncil), and self-evolution (Self-Devolution).*

</div>

---

[🇺🇸 English](README.md) · [🇨🇳 简体中文](README.zh.md) · [🇯🇵 日本語](README.ja.md)

## What is FlowForge?

FlowForge (`flowforge`) is an **enterprise agent harness** built on an **everything-is-a-plugin** architecture, powered by a vendored [Cordis](https://github.com/cordiverse/cordis) kernel rescooped as `@flowforge/cordis`. Its design follows [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

It ships as a TypeScript pnpm monorepo where **every capability is a Cordis plugin** (`packages/*`, scoped `@flowforge/*`). A Python 3.11+ monolith (`agents/`, `brain/`, `core/`, `llm/`, `loop/`, `forgemind/`, `web/`, `sdk.py`) exists as a legacy implementation on a sunset path.

FlowForge is a **harness layer** for agents: rather than replacing your agents, it *employs* them as capability extensions and cultivates them into durable, evolvable agents — *Forgekin* — with a name, memory, growth trail, and accountability.

## Why FlowForge?

| Capability | What FlowForge adds |
|------------|---------------------|
| **Agent-level durable identity** | Forgekin survive crashes, model upgrades, and session boundaries through a persistent *Soul Imprint*. |
| **Structured self-evolution loops** | Five *Self-Devolution* loops let Forgekin evolve their own docs, code, framework, reviews, and tests under governance gates. |
| **Cross-vendor review** | Reviewers must come from a different vendor than the author — no agent approves its own output. |
| **Experience-distillation pipeline** | *SpiritForge* distills lessons into the *MindCodex* procedural-memory store. |
| **Graduated autonomy (6 stages + guardrails)** | *Awakening stages* let operators dial autonomy up safely. |
| **Multi-form agents** | Five evolvable forms cover a range of roles and mandates. |
| **Multi-agent deliberation** | *MindCouncil* coordinates multiple Forgekin on shared missions. |
| **Three-party agent integration** | Bind Claude Code / Codex / Gemini / OpenCode / Trae CN as capability extensions. |

> **Build AI teams, not just agents. Hard rails, soft power, shared mission.**

## Core features

- **Durable identity (Forgekin)** — long-lived evolvable agents with a persistent identity (*Soul Imprint*), a capability profile, and an episodic memory store (*EchoStore*).
- **Self-Devolution loops** — five governance-gated loops that let Forgekin evolve their own documentation, code, framework, reviews, and tests.
- **Cross-vendor review** — enforced structural separation; reviewers must differ in vendor from the author.
- **Multi-domain memory federation** — five memory domains federated through the *MindCodex* distilled-knowledge carrier.
- **Seven-layer harness engineering** — `durable_state` · `tool_mediation` · `evidence_sensors` · `governance` · `magic_words` · `entropy_control` · `harnessability`.
- **Config-driven Forgekin** — register any number of Forgekin via YAML profiles in `config/forgekins/`. The five defaults are reference examples, not a cap.
- **Three-party agent integration** — bind Claude Code / Codex / Gemini / OpenCode / Trae CN as capability extensions.

## Forgekin: configurable, self-evolving agents

**The architecture is not fixed to any number of Forgekin.** A Forgekin is a config-driven entity — drop a YAML profile into `config/forgekins/` to register one, bind it to a Self-Devolution loop, and optionally bind a three-party coding agent. The ForgeMind engine routes tasks at runtime by capability profile, not hardcoded roles.

**Self-evolution is the architecture's core — not the count of Forgekin.**

### Five default Forgekin (reference examples)

| Forgekin | Vendor | Self-Devolution loop | Three-party agent |
|----------|--------|----------------------|-------------------|
| **Wenxin** | anthropic | Doc evolution | Claude Code |
| **Sherlock** | openai | Code evolution | Codex |
| **Vangogh** | google | Cross-vendor review | Gemini |
| **Da Vinci** | open_source | Test evolution | OpenCode |
| **Luban** | bytedance | Framework evolution *(operator approval required)* | Trae CN |

### Add your own Forgekin

Registering a new Forgekin is a **pure config operation** — no framework code changes:

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
│  App layer · forgemind/                                          │
│  ForgekinRegistry · MindCouncil (multi-agent) · external agents  │
├─────────────────────────────────────────────────────────────────┤
│  Directive layer · evolution/                                    │
│  ForgeMind engine · metacognitive routing · maturity ladder      │
├─────────────────────────────────────────────────────────────────┤
│  Execution layer · workers/ · loop/                             │
│  Self-Devolution loops · loop executor · execution modes         │
├─────────────────────────────────────────────────────────────────┤
│  Tools & memory layer · core/                                    │
│  capability · teamact · harness · memory · eval · reliability     │
└─────────────────────────────────────────────────────────────────┘
       ↕  shared kernel: DI container · plugin protocol · tracing  ↕
```

**One-way dependency**: upper layers depend on lower layers; lower layers never import upper layers.

In the active TypeScript rewrite, the Cordis kernel (`@flowforge/cordis`) provides the plugin runtime, and every capability lives under `packages/<group>/<pkg>/` as a Cordis plugin.

## Developer preview

FlowForge is currently in **developer preview** and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

> The TypeScript `packages/*` rewrite is the active line; the Python monolith is legacy and frozen for sunset. Use `pnpm` for TS and `pytest`/`ruff` for Python.

## Quick start

### Run from source (TypeScript, active line)

Clone the repository and use pnpm (Corepack `pnpm@11.7.0`, Node `^22.19.0 || >=24.0.0`):

```sh
git clone https://gitee.com/flowlight/flowforge.git   # Gitee (base: master)
cd flowforge
pnpm install
pnpm build          # tsc -b tsconfig.host.json
pnpm flowforge      # host CLI — PLANNED / stage 3 (apps/cli not yet present)
pnpm start          # alias for `pnpm flowforge web` — PLANNED / stage 3
```

The Web UI and host entrypoints land with `apps/cli`; until then, exercise packages through their own examples and the test suite. See the [development guide](docs/development.md).

### Local checks before committing

Run the **minimal check set that covers your change surface** (exhaustive coverage is CI's job):

```sh
pnpm typecheck   # TypeScript type-check (same tsc pass as build)
pnpm lint        # oxlint static analysis
pnpm test        # vitest run
```

- Pure TS change → `pnpm typecheck` + `pnpm lint`
- Behavioral change → add `pnpm test`
- Docs change → sync the corresponding doc
- Dependency/build output (`lib/`) change → `pnpm build` first

## Project layout

```
flowforge/
├── vendor/                 # vendored deps (rescooped as @flowforge/*): cordis, cosmokit, ...
├── packages/               # TS plugins (active rewrite) — packages/<group>/<pkg>/
├── apps/                   # (planned / stage 3) host CLI — apps/cli/src/bin.ts
├── web/                    # Web UI (Next.js frontend)
├── native/landlock-run/    # native sandbox runner (standalone subproject)
├── docs/                   # spec / architecture / development docs
├── mgr  mgr.cmd  mgr.ps1   # mandatory Git-workflow CLI (direct git remote ops forbidden)
├── scripts/                # helper scripts
└── agents/ brain/ core/ llm/ loop/ forgemind/ web/ sdk.py  # Python 3.11+ monolith (legacy, sunset)
```

## Documentation

| Document | Purpose |
|----------|---------|
| [docs/VISION.md](docs/VISION.md) | Project vision and design philosophy |
| [docs/spec.md](docs/spec.md) | Project specification |
| [docs/arch.md](docs/arch.md) | Architecture design |
| [docs/design.md](docs/design.md) | Detailed design |
| [docs/roadmap.md](docs/roadmap.md) | Development roadmap |
| [docs/decisions/](docs/decisions/) | Architecture decision records (ADRs) |
| [docs/features/](docs/features/) | Feature designs |
| [docs/development.md](docs/development.md) | How to build, test, and develop |
| [AGENTS.md](AGENTS.md) | Mandatory AI-tool and Git workflow rules |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guide |
| [SECURITY.md](SECURITY.md) | Security policy |

## Contributing

Follow [AGENTS.md](AGENTS.md) for the mandatory AI-tool and Git workflow rules, and read the [development guide](docs/development.md) before contributing. All commits, pushes, PRs, and cross-platform syncs go through the root `./mgr` CLI — direct `git` remote operations are forbidden.

- 🐛 [Report a bug](https://github.com/flowlight-ai/flowforge/issues/new?template=bug_report.yml)
- 💡 [Request a feature](https://github.com/flowlight-ai/flowforge/issues/new?template=feature_request.yml)
- 💬 [Join the discussion](https://github.com/flowlight-ai/flowforge/discussions)

## License

FlowForge is released under the **[MIT License](LICENSE)**.

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
