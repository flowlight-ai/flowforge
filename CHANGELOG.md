# Changelog

All notable changes to FlowForge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-02

Initial public release of FlowForge ― a configuration-driven Persistent Identity
Agent framework with built-in self-evolution loops.

### Added
- **Persistent Identity (Forgekin)** — long-lived agents with Soul Imprint, Capability Profile, and EchoStore
- **Self-Devolution Loops** — five closed loops (docs / code / review / test / framework) under governance gates
- **Five default Forgekins** — config-driven YAML profiles under `config/forgekins/`
- **Cross-Vendor Review** — I9 invariant: reviewers must come from a different vendor than the author
- **Multi-Domain Memory Federation** — five memory domains federated through the MindCodex codex
- **Seven-Layer Harness Engineering** — durable_state / tool_mediation / evidence_sensors / governance / magic_words / entropy_control / harnessability
- **External Agent Integration** — Claude Code / Codex / Gemini / OpenCode / Trae CN adapters (`core/external_agent/`)
- **ForgeMind application layer** — species / forging / council / marketplace / lineage (`flowforge/forgemind/`)
- **Evolution Engine** — three modes (Scope Guard, Process Evolution, Knowledge Evolution)
- **Loop Executor** — Discover → Assign → Act → Verify → Persist
- **IM Council channels** — WebChat + Feishu mirror with I8 operator-approval workflow
- **FastAPI backend + Next.js 14 frontend** — Forgekin Council Chat UI
- **CLI** — `flowforge` command-line interface
- **Setup & verification scripts** — `scripts/setup.py`, `scripts/start.py`, `scripts/verify_five_forgekins.py`, `scripts/install_agents.py`
- Project governance: LICENSE, CLA, CODEOWNERS, SECURITY.md, CONTRIBUTING.md, MAINTAINERS.md, TRADEMARKS.md
- GitHub Actions: CI, release, CodeQL, docs, labels, stale, welcome workflows
- Issue templates, pull request template, dependabot config, Code of Conduct

### Changed
- API layer restructured for security hardening: flat `app/api/endpoints/` + `app/api/v1/` split into `app/api/{admin,agents,core,memory,plugins,workflows,workspace}` routers
- Harness moved to top-level `flowforge/harness/` package
- Memory subsystem moved to top-level `flowforge/memory/` package
- Declared previously-undeclared runtime dependencies (`pydantic-settings`, `apscheduler`, `python-multipart`)
- `scripts/start.py` now places the repo parent directory on `PYTHONPATH` so `flowforge.app.main` resolves when the repo root is the package

### Fixed
- Backend import path resolution for the repo-root-as-package layout
- Missing runtime dependencies required by `flowforge.core.config`, `flowforge.scheduler`, and FastAPI Form/File routes

### Documentation
- README.md with quickstart, architecture overview, and Forgekin reference
- docs/VISION.md, docs/spec.md, docs/arch.md, docs/design.md, docs/roadmap.md
- docs/DEPLOY.md, docs/SOP.md, docs/TIPS.md, docs/roleagent.md
- Architecture Decision Records in docs/decisions/
- Feature specs in docs/features/

---

## Changelog Format Guide / 更新日志格式说明

Each release entry should follow this structure:

```
## [VERSION] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes in existing functionality

### Deprecated
- Soon-to-be removed features

### Removed
- Removed features

### Fixed
- Bug fixes

### Security
- Security improvements
```

### Link References

```
[Unreleased]: https://github.com/flowlight-ai/flowforge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/flowlight-ai/flowforge/releases/tag/v0.1.0
```
