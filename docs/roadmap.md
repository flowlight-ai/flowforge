# FlowForge · Development Roadmap

> **Document ID**: ROADMAP.md (v1.0)
> **Status**: Living document — updated after each phase completes
> **Cross-phase invariants**: Engineering standards (see CONTRIBUTING.md) · quality threshold 0.85 · vision anchors

---

## Roadmap Philosophy

FlowForge is built **compounding-infrastructure-first**: every phase delivers a layer that later phases build on, and none of them are throwaway. We deliberately resist the "demo-first" pressure because the problems we're solving — persistent identity, self-evolution, governance — only become valuable at the multi-month timescale.

**Three principles guide this roadmap:**

1. **Build-to-Persist over Build-to-Demo** — Every module is designed to outlive the current LLM generation. We don't ship features that will be rewritten when the next model drops.
2. **Self-Developing** — FlowForge uses FlowForge's own capabilities to develop FlowForge. By Phase 5, Forgekins are writing their own code, docs, and tests.
3. **Verifiable Claims over Vibes** — Every phase has concrete acceptance criteria with real LLM calls, real data, and concrete assertions. No "it kind of works" milestones.

**For contributors:** Each phase lists "Good first issues" — these are scoped tasks that don't require understanding the entire framework. Pick a phase that matches your interest and start there.

---

## Progress Overview

| Phase | Scope | Status | Completion |
|-------|-------|--------|-----------|
| **Phase 0** | Project scaffolding + cross-platform config + docs skeleton | 🔄 In Progress | 70% |
| **Phase 1** | Seven engineering paths code skeleton | ⏳ Pending | 0% |
| **Phase 2** | forgemind application layer + Forgekin morphologies | ⏳ Pending | 0% |
| **Phase 3** | Third-party Agent adapter layer | ⏳ Pending | 0% |
| **Phase 4** | Eval self-metabolism + distributed reliability | ⏳ Pending | 0% |
| **Phase 5** | Partnership math + self-evolution closed loop | ⏳ Pending | 0% |
| **Phase 6** | SpiritForge experience distillation + MindCouncil | ⏳ Pending | 0% |

---

## Phase 0: Project Scaffolding + Cross-Platform Config + Docs Skeleton

> **Goal**: Complete project metadata, cross-platform path config, and documentation skeleton so that Forgekins can incrementally maintain the docs.

**Acceptance Criteria:**
- Project metadata complete (`pyproject.toml` / `.gitignore` / `.env.example` / `README.md`)
- Cross-platform path config works (Linux / Windows / macOS)
- Docs skeleton complete (`spec.md` / `arch.md` / `design.md` / `VISION.md` / `ROADMAP.md` / `SOP.md` / `TIPS.md`)
- Seven subdirectory skeletons complete (architecture / decisions / design / features / harness-feedback / perspectives / setup)
- Core ADRs exist (ADR-004 / 005 / 006 / 012 / 013)
- Core Feature specs exist (F001 / F002 / F031)
- Terminology globally aligned (12 core concepts + 5 morphologies + evolution/awakening stages)
- GitHub public files present as a clean new project (no migration traces)

**Key Tasks:**
- P0-1 Project metadata (`pyproject.toml` / `.gitignore` / `.env.example` / `README.md`)
- P0-2 Cross-platform path config (`config/system.yaml` + `${...}` placeholders)
- P0-3 Top-level docs (VISION / README / ROADMAP / SOP / TIPS / roleagent)
- P0-4 Seven subdirectory skeletons (README + templates)
- P0-5 Core ADRs (5 completed)
- P0-6 Core Feature specs (3 completed)
- P0-7 Terminology global alignment (12 core concepts + 5 morphologies)

---

## Phase 1: Seven Engineering Paths Code Skeleton

> **Goal**: Implement code skeletons for the seven engineering paths from `roleagent.md` as Build-to-Persist compounding infrastructure.

**Dependencies**: Phase 0 complete, ADR-002/004/007/008/009/010/011, F001/F002/F008–F025

**Acceptance Criteria:**
- `CapabilityProfile` can load / query blind spots / compute gap_analysis
- `TeamAct` state machine runs the six-step loop + five termination conditions
- Harness seven layers skeleton complete (Durable State / Tool Mediation / Evidence / Governance / Magic Words / Entropy / Harnessability)
- Multi-domain memory federation MVP works (grep + retrieval entries + consumption weighting)
- Eval Contract five questions can be implemented by any harness component
- Distributed reliability Tier 1–4 recovery can be invoked by Forgekins
- Partnership system math formulas computable (ceiling / floor / volatility absorption)

**Seven Engineering Paths:**

| # | Path | Module | Dependencies |
|---|------|--------|-------------|
| 1 | Capability Profile | `core/capability/` | F001, ADR-004 |
| 2 | TeamAct State Machine | `core/teamact/` | F002–F007, ADR-002 |
| 3 | Harness Seven Layers | `core/harness/` | F008–F013, ADR-007 |
| 4 | Multi-Domain Memory Federation | `core/memory/` | F014–F017, ADR-008 |
| 5 | Eval Self-Metabolism | `core/eval/` | F018–F020, ADR-009 |
| 6 | Distributed Reliability | `core/reliability/` | F021–F025, ADR-010 |
| 7 | Partnership Math | `core/partnership/` | ADR-011 |

**Additional:**
- P1-8 Plugin V3 protocol update (4 hook semantics)
- P1-9 `rules.md` / `prompts.md` sync

---

## Phase 2: forgemind Application Layer + Forgekin Morphologies

> **Goal**: Implement the Forgekin application layer under `flowforge/forgemind/`, hosting the five morphologies (BioForgekin / OrgForgekin / ObjForgekin / VirtualForgekin / HybridForgekin).

**Dependencies**: Phase 1 complete, F026–F030, F036–F038

**Acceptance Criteria:**
- `flowforge/forgemind/` directory structure complete (species / forging / sensors / worlds / marketplace / lineage / codex / council / config / tests)
- `ForgekinBase` abstract class can be inherited (observe / act / verify methods)
- `ForgePipeline` can execute the forging flow
- `ForgeMindPlugin` implements Plugin V3 four hooks
- Five morphology enums loadable
- Evolution stages (E1–E6) + awakening stages (E1–E6) queryable
- E2E test: can forge a cat Forgekin (BioForgekin) + attach physical sensors (F029)

**Key Tasks:**
- P2-1 forgemind module skeleton (ForgekinSpecies / EvolutionStage / ForgekinBase / ForgePipeline / ForgeMindPlugin)
- P2-2 Five Forgekin morphologies
- P2-3 Forging pipeline (YAML config + externalized prompts + indicator definitions)
- P2-4 Physical AI sensor integration (camera / microphone / IoT)
- P2-5 Virtual world setting layer (VR / games / fairy-tales / mythology / history)
- P2-6 Forgekin marketplace + evolution lineage
- P2-7 forgemind ↔ *Forge relationship (4 *Forge Forgekin adapters)

---

## Phase 3: Third-Party Agent Adapter Layer

> **Goal**: Implement the `ExternalAgentAdapter` abstraction so Forgekins can integrate Claude Code / Codex / Gemini / OpenCode / Trae CN as capability extensions.

**Dependencies**: Phase 1 complete, P2-1, F031–F035

**Acceptance Criteria:**
- All four third-party Agent adapters callable (Claude Code / Codex / OpenCode / Trae CN)
- `ExternalAgentBridge` can execute fallback chains
- `ExternalAgentSharedState` syncs state with FlowForge
- `ExternalAgentCapabilityFusion` fuses third-party capabilities into Forgekin profiles
- Six-layer Guardrails fully enabled
- E2E test: a Forgekin can invoke Claude Code to complete a coding task

**Key Tasks:**
- P3-1 Third-party Agent core abstraction (Adapter / Bridge / SharedState / Fallback / CapabilityFusion)
- P3-2 Four concrete adapters (claude_code / codex / opencode / trae)
- P3-3 Externalized config (adapters.yaml / prompts.yaml / fallback.yaml / tool_allowlist.yaml)
- P3-4 Six-layer Guardrails implementation
- P3-5 Worktree isolation mechanism

---

## Phase 4: Eval Self-Metabolism + Distributed Reliability

> **Goal**: Implement Eval Contract + seven-class attribution + Tier 1–4 recovery + liveness canonical read-model so the harness can self-metabolize.

**Dependencies**: P1-5, P1-6

**Acceptance Criteria:**
- Eval Contract five questions implementable by any harness component (F018)
- Three signals (trace + human + auto) cross-verifiable (F019)
- Seven-class attribution matrix locates failure root causes (F020)
- Tier 1–4 recovery invocable by Forgekins (F022)
- Liveness canonical read-model queryable by any agent (F023)
- Harness Eval control plane daily aggregation (F040)
- Build-to-Delete sunset timer triggerable (F012)

**Key Tasks:**
- P4-1 Eval Contract full implementation
- P4-2 Three-signal cross-validation + seven-class attribution
- P4-3 Tier 1–4 recovery + liveness
- P4-4 Build-to-Delete sunset timer
- P4-5 Harness Eval control plane

---

## Phase 5: Partnership Math + Self-Evolution Closed Loop

> **Goal**: Implement partnership system math formulas + three-layer (docs / code / framework) self-evolution closed loop.

**Dependencies**: P1-7, Phase 4 complete

**Acceptance Criteria:**
- Ceiling / floor / volatility absorption formulas computable
- Token ledger tracks single-agent vs team cost
- Docs self-evolution: Feature completion auto-updates docs
- Code self-evolution: Eval-triggered sunset review auto-refactors
- Framework self-evolution: ForgekinEngine optimizes routing from runtime data
- "Self-develop-self" closed loop runs end-to-end

**Key Tasks:**
- P5-1 Partnership math full implementation (ceiling / floor / volatility / token ledger / dual-layer language / minimal necessary complexity)
- P5-2 Docs self-evolution (Feature doc auto-update / ADR auto-generation / Eval result archival)
- P5-3 Code self-evolution (Feature → code skeleton / Eval signal → harness refactor / attribution → auto-bug-fix)
- P5-4 Framework self-evolution (ForgekinEngine routing optimization / TeamAct termination optimization / memory federation authority adjustment)
- P5-5 "Self-develop-self" closed loop (11-step orchestrator / Forgekin A–G role definition / E2E test)

---

## Phase 6: SpiritForge Experience Distillation + MindCouncil

> **Goal**: Implement E4+ Evolving state + multi-Forgekin MindCouncil deliberation mechanism.

**Dependencies**: Phase 5 complete

**Acceptance Criteria:**
- SpiritForge distills experience into MindCodex during low-activity periods
- MindCouncil convenes multiple Forgekins for deliberation
- E4+ Evolving state triggerable (awakening stage ≥ E4)
- MindCouncil resolutions writable to `VISION.md` / `ROADMAP.md`
- Operator Magic Words can brake MindCouncil when it drifts from vision

**Key Tasks:**
- P6-1 SpiritForge experience distillation
- P6-2 MindCouncil multi-Forgekin deliberation
- P6-3 E4+ Evolving state machine
- P6-4 MindCouncil resolution write-back mechanism
- P6-5 Operator Magic Words integration

---

## Cross-Phase Standards

All phases adhere to the engineering standards defined in [CONTRIBUTING.md](../CONTRIBUTING.md) — including testing requirements, code quality rules, and review protocols. The quality threshold for all loops is `0.85`.

---

## How to Contribute to a Phase

Each phase has concrete acceptance criteria and tasks. Here's how to contribute:

1. **Pick a task** — Look at the phase's Key Tasks, pick one that matches your skills
2. **Check dependencies** — Make sure the task's dependencies are met
3. **Read the relevant ADRs and Feature specs** — Understand the design before coding
4. **Write code + tests** — Follow the engineering standards in CONTRIBUTING.md
5. **Open a PR** — Use the [PR template](../.github/pull_request_template.md)
6. **Cross-vendor review** — Your PR will be reviewed by Forgekins from a different vendor
7. **Merge** — Once CI passes and review approves, squash-and-merge

**Good first issues** for new contributors:
- Phase 0: Documentation improvements, cross-platform testing
- Phase 1: Unit tests for capability profile / partnership math
- Phase 2: Forgekin YAML profile authoring
- Phase 3: Adapter integration tests for a specific CLI agent

---

## Further Reading

- [VISION.md](VISION.md) — Forgekin vision statement
- [SOP.md](SOP.md) — Forgekin collaboration SOP
- [design.md](design.md) — Current phase detailed design
- [roleagent.md](roleagent.md) — Multi-agent engineering path whitepaper
- [CONTRIBUTING.md](../CONTRIBUTING.md) — How to contribute
