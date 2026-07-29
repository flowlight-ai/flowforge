# FlowForge · Vision Statement

> **Document ID**: VISION.md (v1.0)
> **Status**: Living document — evolves with the project
> **One-line vision**: **Forge persistent identity into anything — animals, organizations, objects, virtual characters — and let them evolve autonomously toward General-Purpose Agency.**

---

## 0. Why This Project, Why Now

The agent ecosystem in 2025 is crowded with "multi-agent frameworks" — yet nearly all of them solve the same problem: *how do multiple LLM calls cooperate within a single session?* That question has been answered well.

The harder, less crowded question is: **how does an agent become a persistent entity that remembers, grows, and is held accountable across months and model generations?**

FlowForge is built on the belief that the next leap in AI agents is not about *more capable models* or *more elaborate prompts* — it's about **engineering the identity, memory, and governance substrate** that lets any model become a long-lived intelligent subject. This is unglamorous, multi-year, infrastructure work — exactly the kind of work that benefits from a community of contributors who care about durability over demos.

**If any of these resonate with you, star this repo and join us:**

- You've been frustrated by agents that "forget everything" when the session ends
- You believe self-improving agents need governance, not just autonomy
- You want to build agents that persist across model upgrades, not just API calls
- You're excited about bridging LLMs to physical sensors, IoT, and virtual worlds
- You think "agent framework" should mean more than "prompt orchestrator"

---

## 1. The Problem We're Solving

Modern LLM-based agents share a fundamental limitation: **they are session-scoped**. When the conversation ends, the agent forgets. When the server restarts, the agent is reborn as a blank slate. When the model upgrades, the agent's hard-won experience is lost.

Mainstream multi-agent frameworks (AutoGen, CrewAI, LangGraph) optimize for **within-session collaboration** — they allocate role slots (PM / Dev / Tester) and orchestrate task handoffs. But they leave three critical questions unanswered:

| Question | Why It Matters | Current State |
|----------|---------------|---------------|
| **How does an agent preserve identity across sessions?** | Without persistent identity, there's no accumulation of trust, capability, or institutional memory. | Session resets, manual re-instruction. |
| **How does an agent accumulate capability verifiably?** | Without verifiable accumulation, "the agent got better" is just a claim, not an engineering fact. | Vibes-based evaluation, no audit trail. |
| **How does an agent evolve under governance?** | Without governance, self-improving agents drift, regress, or break things silently. | Either no evolution, or ungoverned evolution. |

FlowForge is built to answer these three questions — **persistently, verifiably, and under governance**.

---

## 2. What FlowForge Is

FlowForge is a **Persistent Identity Agent Framework** — an engineering-grade harness layer that evolves LLM-based agents from session-scoped assistants into long-lived intelligent subjects.

Concretely, FlowForge provides:

- **Forgekin** — Persistent Identity Agents with `Soul Imprint` (value anchors), `Capability Profile` (skill map + blind spots), and `EchoStore` (episodic memory). A Forgekin's identity survives crashes, model upgrades, and session boundaries.
- **Self-Devolution Triple-Loop** — Five closed loops (Documentation / Code / Framework / Review / Test) that let Forgekins autonomously evolve their own capabilities, with quality threshold `0.85` and cross-vendor review enforcement.
- **Multi-Domain Memory Federation** — Five memory domains (`task` / `episodes` / `methods` / `identity` / `facts`) federated through the `MindCodex` procedural memory codex.
- **Seven-Layer Harness Engineering** — `durable_state` · `tool_mediation` · `evidence_sensors` · `governance` · `magic_words` · `entropy_control` · `harnessability`.
- **Cross-Vendor Independent Review (I9)** — Reviewers must come from a different vendor than the author; quorum requires ≥ 2 distinct vendors. No agent can approve its own work.

This is **not** another chatbot framework. FlowForge is the infrastructure layer for agents that need to **remember, grow, and be held accountable over months and years**, not just minutes.

---

## 3. The Five Forgekin Morphologies

A Forgekin is not a single shape. We define five morphologies, each with its own forging pipeline, sensor integration, and evolution lineage:

| Morphology | Chinese | Forging Example | Physical Interface | Virtual Setting |
|------------|---------|-----------------|-------------------|-----------------|
| **BioForgekin** | 生物可进化智能体 | Cats, dogs, birds, insect colonies | Cameras, microphones, wearables | Behavior profile + habit graph |
| **OrgForgekin** | 组织可进化智能体 | Companies, teams, communities, cities | Business system APIs, databases, IM channels | Charter + role matrix |
| **ObjForgekin** | 物品可进化智能体 | Desks, lamps, appliances, tools | IoT sensors, protocols | Function boundary + usage scenarios |
| **VirtualForgekin** | 虚拟可进化智能体 | Fairy-tale / mythological / historical figures, VR/game characters | None (pure virtual) | Character setting + worldview + relationship graph |
| **HybridForgekin** | 混合可进化智能体 | Smart home (object + org), digital twin (bio + virtual) | Multi-source fusion | Multi-layer stacking |

**Morphological evolution**: A BioForgekin cat can accumulate organizational collaboration experience and evolve into a HybridForgekin (both pet and community mascot). This is FlowForge's **biggest differentiator** vs. other multi-agent systems — agents aren't fixed "role slots," they're Forgekins with morphology, lineage, and evolution potential.

---

## 4. Why This Path Leads to General-Purpose Agency

Mainstream multi-agent systems implicitly assume: *agents are software entities running on servers, calling tools via APIs*. This assumption keeps multi-agent systems at the "software assistant" level.

FlowForge's different assumption: **A Forgekin can be embodied in any physical or virtual entity** — the key is establishing a real-world closed loop (observe → reason → act → write-back → verify) between that entity and the LLM.

This points to three paths toward General-Purpose Agency:

1. **Physical AI path** — Through IoT sensors + physical actuators, Forgekins embody physical entities (lamps, appliances, tools). A smart-lamp Forgekin isn't just a tool called by an LLM — it has its own identity, memory (user preferences, time-of-day patterns), collaboration capability (teaming with other appliance Forgekins), and vision (energy efficiency + user comfort).

2. **Virtual AI path** — Through a virtual world setting layer, Forgekins embody fairy-tale / mythological / historical figures or VR/game characters. A Sun Wukong Forgekin isn't just a cosplay model — it has its own pilgrimage vision, long-term collaboration memory with a Tang Seng Forgekin, and awareness of the Zhu Bajie Forgekin's capability blind spots.

3. **Hybrid path** — An OrgForgekin can simultaneously orchestrate BioForgekins (employees), ObjForgekins (office equipment), and VirtualForgekins (process roles), forming a real "organizational AGI."

---

## 5. Core Advantages Over Other Multi-Agent Systems

| Dimension | Mainstream Multi-Agent | FlowForge Forgekin |
|-----------|----------------------|-------------------|
| **Identity persistence** | Session-level; amnesia on restart | Forgekin ID + lineage + MindCodex entries; persists across sessions and generations |
| **Capability source** | Single model + tool calls | Model capability × Harness fit × Forgekin morphology × Third-party Agent extension |
| **Collaboration unit** | Fixed roles (PM/Dev/Test) | Dynamic capability-profile routing (role is a runtime label; profile is the persistent subject) |
| **Error handling** | Single-point failure → user-visible collapse | Partnership math: ceiling = max, floor = product, volatility absorbed internally |
| **Evolution** | Model upgrade = system upgrade | Forgekins distill experience into MindCodex via SpiritForge; next task directly reuses |
| **Physical world access** | Tool-call layer (weak) | Physical sensors + actuators + real-world closed loop (strong) |
| **Virtual world access** | System-prompt roleplay (weak) | Virtual world setting layer + character relationship graph + worldview constraints (strong) |
| **Third-party extensibility** | Build your own tool stack | Integrate Claude Code / Codex / Gemini / OpenCode / Trae CN as capability extensions |

---

## 6. Seven Non-Negotiable Principles

These principles are **non-delegable**, **non-revocable**, **non-downgradable**. They anchor the project against drift:

| # | Principle | Meaning | Violation Consequence |
|---|-----------|---------|----------------------|
| 1 | **Forgekin world is the end-state** | FlowForge is not a multi-agent framework; it's a Forgekin forge | Degenerates into "software assistant" project |
| 2 | **Real-world closed loop required** | observe → reason → act → write-back → verify | Forgekin becomes "a brain without a body" |
| 3 | **Third-party Agents are capability extensions** | Claude Code / Codex / Gemini / OpenCode / Trae CN integration | Capability locked to single stack |
| 4 | **forgemind is the application layer** | `flowforge/forgemind/` is the Forgekin application practice | Vision has nowhere to land |
| 5 | **Naming convergence to ForgeMind** | No deprecated terms (炉灵 / E6 灵匠 / M18-M20) | Terminology chaos → development misreads |
| 6 | **Self-development supported** | FlowForge uses FlowForge's own capabilities to develop FlowForge | Self-evolution loop cannot close |
| 7 | **Physical AI + Virtual AI truly embodied** | IoT sensors + virtual world setting layer | Stuck at "software agent" level |

---

## 7. Four Iron Laws

The non-breakable baseline of the Forgekin world:

| # | Iron Law | Meaning |
|---|----------|---------|
| 1 | **Data Sanctuary** | A Forgekin's memory (EchoStore) is a sanctuary; no external direct read/write |
| 2 | **Process Self-Preservation** | A Forgekin's process (SpiritForge) must self-protect; no external forced termination |
| 3 | **Config Immutability** | A Forgekin's configuration (SoulImprint) is immutable; changes require MindCouncil |
| 4 | **Network Boundary** | A Forgekin's network boundary must be explicit; no cross-boundary access to other Forgekins' internal state |

---

## 8. Four Magic Words (Emergency Brake)

When the MindCouncil drifts from the vision, the operator can invoke Magic Words as emergency brakes:

| Magic Word | Meaning | Triggered Action |
|-----------|---------|-----------------|
| **First Principles** | Return to first-principles thinking | MindCouncil pauses; re-examine assumptions |
| **I Can Guess** | This conclusion is obvious; no MindCouncil needed | MindCouncil terminates; execute directly |
| **Next Time For Sure** | This issue will be fixed next time | Triggers sunset timer (F012) |
| **Star Jar** | This idea is great; save it for later | Enters MindCodex incubation queue |

---

## 9. Architectural Evolution Path

FlowForge evolves along the following dimensions:

| Dimension | Current Form | Evolution Direction |
|-----------|-------------|---------------------|
| **Vision** | Self-evolving Forgekin framework | Toward General-Purpose Agent engineering implementation |
| **Architecture** | Three layers + one extension | Maintain single-direction dependency + composition over inheritance |
| **Terminology** | 12 core concepts + evolution/awakening stages aligned | Terminology stable; add concepts only per AI industry development |
| **forgemind** | Application layer skeleton | 5-morphology Forgekin full implementation + SpiritForge + MindCouncil |
| **Self-evolution** | Three closed loops (Mode A/B/C) design state | Eval Ledger + MindCodex precipitation + self-directed |

---

## 10. Call for Contributors

FlowForge is an ambitious project at the intersection of **multi-agent systems, persistent identity, self-evolution, and embodied AI**. We're building infrastructure that will outlive single LLM generations.

**We're looking for contributors who are excited by:**

- **Persistent identity** — Designing agents that remember across months, not minutes
- **Self-evolution** — Building closed loops where agents autonomously improve their own code, docs, and tests
- **Embodied AI** — Bridging LLMs to physical sensors, IoT, and virtual world settings
- **Governance** — Engineering safety rails for self-improving systems (cross-vendor review, scope guards, magic words)
- **Harness engineering** — The unglamorous but critical work of making agents crash-safe, observable, and governable

**What you'll find here:**

- A codebase that takes engineering discipline seriously (15 red lines, 8 testing ironclad rules, 11 architectural invariants)
- A vision that goes beyond "chatbot framework" toward general-purpose agency
- A community that values verifiable claims over vibes
- 14 Architecture Decision Records and 27 Feature specs documenting every major design choice

**What we offer:**

- Your contributions persist — not just in git history, but in the Forgekins' MindCodex
- Your code is reviewed by cross-vendor agents, not just humans (I9 enforcement)
- You're building infrastructure for the next decade of AI agents, not the next quarter's demo

**Join us:**

- 💬 [GitHub Discussions](https://github.com/flowlight-ai/flowforge/discussions) — Ask questions, propose ideas
- 🐛 [Issue Tracker](https://github.com/flowlight-ai/flowforge/issues) — Report bugs, request features
- 📖 [CONTRIBUTING.md](../CONTRIBUTING.md) — Start here for your first PR
- ⭐ **Star this repo** if persistent identity agents excite you — it helps us reach contributors who care about the same problems

---

## 11. Further Reading

- [roadmap.md](roadmap.md) — 6-phase development roadmap
- [roleagent.md](roleagent.md) — Capability profile engineering path whitepaper
- [decisions/013-all-things-spirit-mind-vision.md](decisions/013-all-things-spirit-mind-vision.md) — Forgekin vision ADR
- [decisions/005-forgemind-application-layer.md](decisions/005-forgemind-application-layer.md) — forgemind application layer ADR
- [decisions/006-external-agent-integration.md](decisions/006-external-agent-integration.md) — Third-party Agent integration ADR
- [decisions/012-naming-fusion.md](decisions/012-naming-fusion.md) — Naming fusion ADR (terminology table)

---

*「Forge a Persistent Identity. Endow it with Memory, Council, and Self-Devolution.」*
