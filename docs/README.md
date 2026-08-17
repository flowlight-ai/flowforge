# Documentation

English | [中文](README.zh.md)

> **Document ID**: README.md (v1.3)
> **Last revised**: 2026-07-21 (v1.3: removed dead links to gitignored files; synced doc-system cleanup)
> **Maintenance**: evolvable agents may self-evolve updates (per `[doc:roleagent.md#第5章]` Eval self-metabolism)
> **Dependencies**: 13 external documents (see `[doc:review/review.md#1.1.3]`)

---

## Engineering Standards

| Document | Purpose |
|----------|---------|
| [git-workflow.md](./git-workflow.md) | Git workflow: trunk-only dev (Gitee=master / GitHub=main), PR merge, signed commits |
| [dev-spec.md](./dev-spec.md) | General engineering spec: test-delivery trio, test iron rules T1–T9, 15 coding red lines |
| [AGENTS.md](./AGENTS.md) | **Rulebook for anyone writing / AI-generating docs** in this tree (read before editing docs) |

## 1. What is this

FlowForge is an **evolvable-agent forging factory** (Persistent Identity Agent Framework, codename ForgeMind; community name "general-purpose agent framework"). It forges evolvable agents (codename Forgekin) for Embodied AI and Character AI, via a self-evolving core framework. See [VISION.md](VISION.md).

The docs tree follows a standard software-engineering document structure so evolvable agents can incrementally maintain each Feature / ADR / architecture view — achieving "developing itself".

---

## 2. Top-level document navigation

| Document | Purpose | Status |
|----------|---------|:------:|
| [VISION.md](VISION.md) | Evolvable-agent vision statement (operator general-agent vision) | ✅ v1.2 |
| [ROADMAP.md](ROADMAP.md) | Phased roadmap | ✅ v1.0 |
| [SOP.md](SOP.md) | Evolvable-agent collaboration SOP | ✅ v1.1 |
| [TIPS.md](TIPS.md) | Lessons-learned & pitfall list | ✅ v1.1 |
| [roleagent.md](roleagent.md) | Engineering-path mirror of roleagent.md (seven engineering paths) | ✅ v1.1 mirror |
| [task.md](task.md) | Ecosystem porting task overview (11-phase milestones) | ✅ |
| [spec.md](spec.md) | Software Requirements Spec (SRS) — legacy Python-era; now an index, detail split into `features/` | 🔄 indexed |
| [arch.md](arch.md) | Software Architecture Doc (SAD) — legacy Python-era; index, detail in `architecture/` | 🔄 indexed |
| [design.md](design.md) | Software Design Doc (SDD) — legacy Python-era; index, detail in `design/` + `features/` | 🔄 indexed |
| [test.md](test.md) | Test-spec navigation + Test Feature index (19× T0XX) | ✅ v2.0 |
| [DEPLOY.md](DEPLOY.md) | Deployment guide for external developers | ✅ |

---

## 3. Dual-stack reality (READ THIS FIRST)

FlowForge is mid-transition between two technology stacks. **Document both accurately; do not pretend there is one stack.**

- **TS rewrite (active)** lives in [`refactor/`](refactor/). This is the **primary spec for all new TypeScript work** — `00-overview.md` (goals/decisions/architecture), `10-stage-map.md` (phases + capability matrix), `04-code-standards.md` (merged coding rules, read before every change), `01-stack-decision.md` (stack ADRs R01–R21). Target: pnpm monorepo, vendored Cordis kernel, npm scope `@flowforge/*`, "everything is a plugin".
- **Python-era SRS/SAD/SDD** (legacy implementation, sunsetting) are `spec.md` / `arch.md` / `design.md` plus the `architecture/`, `design/`, `features/`, `decisions/` subtrees. These describe the **current Python monolith** (behavior baseline / golden reference) and its historical ADRs — do **not** duplicate them into `refactor/`; cross-link with `[doc:...]` instead.
- Python is frozen→archived→deleted per `refactor/31-stage11-sunset.md` after feature parity. Dual-stack isolation: `/api/v1` = Python, `/api/v2` = TS; DBs physically separated (see `refactor/00-overview.md` D7/R18).

---

## 4. Six core subdirectory navigation

| Subdir | Purpose | Key files |
|--------|---------|-----------|
| [architecture/](architecture/) | Architecture docs (7-layer + forgemind app layer) — Python-era SAD splits | `README.md` / `A026-forgemind-app-layer.md` / `A036-forgemind-forge-relationship.md` |
| [decisions/](decisions/) | Architecture Decision Records (ADR), 13 core ADRs — Python-era | `004-capability-profile-routing.md` / `005-forgemind-application-layer.md` / `006-external-agent-integration.md` / `013-all-things-spirit-mind-vision.md` |
| [design/](design/) | Detailed design (naming contract + 44 Feature-level SDDs) — Python-era | `naming-contract.md` / `D001-capability-profile.md` / `D026-forgemind-app-layer.md` |
| [features/](features/) | Feature specs (one file per Feature, F001–F046) — Python-era SRS splits | `TEMPLATE.md` / `F001-capability-profile.md` / `F026-forgemind-app-layer.md` / `F031-external-agent-adapter.md` |
| [refactor/](refactor/) | **TS rewrite plan** (living spec) — see §3 | `00-overview.md` / `10-stage-map.md` / `04-code-standards.md` / `01-stack-decision.md` |
| [review/](review/) | Review traceability index (RA/FM/FR/CL namespaces) | `review.md` |

---

## 5. Other subdirectories

| Subdir | Purpose |
|--------|---------|
| [rules/](rules/) | Dev/AI-behavior red-line specs (8 files: `04-code-style`, `05-dev-spec`, `06-ai-behavior`, `07-coding-redlines`, `08-flowforge-boundary`, `11-doc-layering`, `12-doc-refactor-methodology`, `test-iron-rules`) |
| [prompts/](prompts/) | Prompt templates for AI tools (`FF-flowforge`, `P-v7`, `P-methodology`, `Q-followup`) |
| [test/](test/) | Test Feature specs (19× T0XX + TEMPLATE + README + `bugs.md` / `BUG_PROTOCOL.md`) |
| [perspectives/](perspectives/) | Perspective documents (doc-split target structure) |
| [harness-feedback/](harness-feedback/) | Harness-eval feedback (Eval self-metabolism) |
| [setup/](setup/) | Setup notes (currently empty) |

---

## 6. Documentation self-evolution rules

> Basis: `[doc:roleagent.md#第5章]` Eval self-metabolism + `[doc:review/review.md#12.3]` three-layer self-evolution

1. **One file per Feature**: Feature file < 50KB, rewritable by an agent in a single task.
2. **Immutable ADR history**: change a decision by adding a new ADR that references the old one; never edit the old ADR.
3. **Single source of truth**: one truth file per concept; others use `[doc:file#section]`.
4. **Eval-driven updates**: doc changes must be triggered by Eval signals (e.g. status auto-updates when a Feature completes).
5. **operator vision anchor is immutable**: the 7 principles in VISION.md §7 cannot be modified by evolvable agents.

---

## 7. Reference conventions

Cross-doc references use the `[doc:file#section]` format:

- `[doc:roleagent.md#第3章]` — chapter 3 of roleagent.md
- `[doc:review/review.md#第八章]` — chapter 8 of review.md
- `[doc:decisions/004-capability-profile-routing.md]` — ADR 004
- `[doc:features/F001-capability-profile.md#验收标准]` — acceptance criteria of F001
- `[doc:rules/11-doc-layering.md]` — doc-layering iron rule

---

## 8. Quick start

- **Understand the vision** → [VISION.md](VISION.md)
- **See the roadmap** → [ROADMAP.md](ROADMAP.md)
- **Understand engineering paths** → [roleagent.md](roleagent.md)
- **Review feedback** → [review/review.md](review/review.md)
- **Collaboration SOP** → [SOP.md](SOP.md)
- **Tips & pitfalls** → [TIPS.md](TIPS.md)
- **Requirements (legacy SRS)** → [spec.md](spec.md)
- **Core architecture (legacy SAD)** → [arch.md](arch.md) + [architecture/README.md](architecture/README.md)
- **Detailed design (legacy SDD)** → [design.md](design.md) + [design/README.md](design/README.md)
- **Key decisions (legacy ADR)** → [decisions/](decisions/)
- **NEW TS work (primary spec)** → [refactor/00-overview.md](refactor/00-overview.md) + [refactor/10-stage-map.md](refactor/10-stage-map.md)
- **Coding rules for TS rewrite** → [refactor/04-code-standards.md](refactor/04-code-standards.md) (read before every change)
- **Tests** → [test.md](test.md) (v2.0 index + 19× T0XX)

---

## 9. Collaboration: prompts & rules (AI must-read)

> **AI assistants**: before any task in this repo, read the dev specs under `docs/rules/` and the prompt templates under `docs/prompts/`. This `docs/` tree records only the flowforge platform itself, decoupled from other projects.

### Prompt templates — docs/prompts/

| File | Purpose |
|------|---------|
| [FF-flowforge.md](./prompts/FF-flowforge.md) | Project-specific prompt template |
| [P-v7.md](./prompts/P-v7.md) | v7.0 spec companion prompt (general) |
| [P-methodology.md](./prompts/P-methodology.md) | Methodology prompt (general) |
| [Q-followup.md](./prompts/Q-followup.md) | Follow-up / correction prompt (general) |

### Dev specs — docs/rules/ (8 general specs)

- [04-code-style.md](./rules/04-code-style.md)
- [05-dev-spec.md](./rules/05-dev-spec.md)
- [06-ai-behavior.md](./rules/06-ai-behavior.md)
- [07-coding-redlines.md](./rules/07-coding-redlines.md)
- [08-flowforge-boundary.md](./rules/08-flowforge-boundary.md)
- [11-doc-layering.md](./rules/11-doc-layering.md)
- [12-doc-refactor-methodology.md](./rules/12-doc-refactor-methodology.md)
- [test-iron-rules.md](./rules/test-iron-rules.md)

---

## 10. Change history

| Date | Version | Change | Author |
|------|:------:|--------|--------|
| 2026-07-17 | v1.0 | Initial docs entry | Luban (Owl) |
| 2026-07-19 | v1.1 | Added test.md v2.0; removed dead links to design-system.md / public-lessons.md | Luban (Owl) |
| 2026-07-19 | v1.2 | Completed test/ nav; added _archive/ entry; synced SOP.md/TIPS.md versions to v1.1 | Luban (Owl) |
| 2026-07-21 | v1.3 | Removed dead links to internal docs (task.md / _archive / harness-feedback / perspectives / setup); focused six-subdir nav on public docs | Architect evolvable agent |
| 2026-08-17 | v1.4 | English rewrite; added language switch + dual-stack reality section; added AGENTS.md pointer | doc agent |
