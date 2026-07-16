# FlowForge 设计文档与代码一致性审核报告（Kimi 团队 v1.0）

> **审核日期**：2026-06-29
> **审核团队**：AI 智能体产品专家、AI 高级架构师、AI 智能体 Agent 开发工程师、高级软件全栈工程师
> **审核对象**：
> - `flowforge/docs/spec.md`
> - `flowforge/docs/arch.md`
> - `flowforge/docs/design.md`
> - `flowforge/docs/face/{face.md, spec_face.md, arch_face.md, ds.md, task_face.md}`
> - 核心源码：`flowforge/evolution/`、`flowforge/tools/`、`flowforge/agents/`、`flowforge/core/plugin_protocol.py`、`flowforge/config/plugins.yaml`、`flowforge/app/main.py`
> **参照基线**（按优先级降序）：
> 1. `hiclaw/rules.md` v3.0
> 2. `hiclaw/prompts.md`
> 3. `opensieve/docs/spec.md`
> 4. 横向 *Forge 项目：`contentforge/`、`devforge/`、`novelforge/`、`mallforge/`、`stockforge/`

---

## 一、总体结论

FlowForge v7.0「炉灵 / Forgekin」自进化体系在文档层面已经构建出一套完整的概念框架：从 `Soul Profile` 灵魂档案、`Soul Echo` 魂忆、`Soul Imprint` 魂印，到 `Auto-Forge` 自锻引擎、`Forge Codex` 锻典、`Forgekin Council` 灵议庭，再到 `Ascension Stages` 升华阶，术语统一、层级清晰，且与 Face v3.0 的 M1-M17 工程模块形成了较好的映射。

**但是，当前存在一个致命断层：v7.0 炉灵体系目前几乎全部是文档设计，代码层面完全没有对应实现。** `flowforge/evolution/` 下仍是 v6.0 的 `SelfEvolutionEngine`（Scope Guard / Process Evolution / Knowledge Evolution），没有任何 `ForgekinEngine`、`SoulStore`、`EchoStore`、`ImprintStore`、`AutoForge`、`ForgeCodex`、`ForgekinCouncil` 的实现或入口。

与此同时，FlowForge 作为整个生态的「规则制定者」，自身却在多个地方违反了 `hiclaw/rules.md` 的「所有数据检索必须走 OpenSieve」铁律：直接注册 Tavily / DuckDuckGo 搜索工具、在 `web_search_agent` 中设置直连回退链、在启动流程中检查 `TAVILY_API_KEY`。这一问题如果得不到纠正，上层所有 *Forge 项目都会以 FlowForge 为「榜样」继续绕过 OpenSieve。

**总体判定**：文档设计先进且自洽，但代码落地严重滞后，核心规则在框架层自身尚未完全贯彻。**当前版本不建议进入 Phase 0 验收**，必须先完成 P0 修复。

---

## 二、评分矩阵

| 维度 | 评分 | 说明 |
|------|:----:|------|
| **文档概念完整性** | ⭐⭐⭐⭐⭐ | v7.0 炉灵体系概念完整、术语统一、与 Face v3.0 映射清晰 |
| **文档版本一致性** | ⭐⭐ | `spec.md` 标 v2.1、`arch.md`/`design.md` 标 v6.0，正文却包含 v7.0；Face 文档引用 v7.0 权威源但标题未标 v7.0 |
| **代码实现度** | ⭐⭐ | v7.0 炉灵体系代码完全缺失；v6.0 Harness 层基本实现 |
| **OpenSieve 合规性** | ⭐ | FlowForge 自身注册 Tavily/DuckDuckGo 直连工具，严重违反 rules.md §2.2 |
| **架构边界合规性（P8A）** | ⭐⭐⭐⭐ | FlowForge 作为平台层本身符合边界；但直接搜索工具破坏了数据入口统一原则 |
| **Plugin V2 协议一致性** | ⭐⭐⭐ | `plugin_protocol.py` 已实现标准钩子，但各 *Forge 落地参差不齐 |
| **质量分阈值一致性** | ⭐⭐⭐ | `rules.md`/`prompts.md` 默认 0.85，但 `flowforge/config/default.yaml` 和 `design.md` 仍写 0.9 |
| **Face v3.0 与 v7.0 融合叙事** | ⭐⭐⭐ | Face 将 v3.0 第 7 层定义为「互联层」、v7.0 升级为「自进化层」；`arch.md` 直接说 v7.0 新增「自进化层」，演进叙事不一致 |
| **与 *Forge 生态一致性** | ⭐⭐ | 其他 *Forge 文档未说明如何集成 v7.0 炉灵能力；HelixRAG 旧名残留；Plugin 钩子用法不统一 |
| **可测试性与铁律落地** | ⭐⭐⭐ | Face 新增 T10-T15，但 v7.0 无代码支撑；T1-T9 在 FlowForge 自身未完全覆盖 OpenSieve 合规 |

**综合评分：2.8 / 5.0**

---

## 三、问题等级分布

| 等级 | 数量 | 核心性质 |
|:----:|:----:|----------|
| **P0 致命** | 4 | v7.0 炉灵体系代码完全缺失、FlowForge 直连 Tavily/DuckDuckGo、Face v3.0 为不存在的 v7.0 层提供工程支撑、HelixRAG/直连搜索引擎在 *Forge 代码层残留 |
| **P1 严重** | 5 | 文档版本号混乱、质量分阈值 0.9 vs 0.85、七层架构叙事冲突、Plugin V2 落地不齐、Harness 组件实现位置描述过时 |
| **P2 一般** | 3 | *Forge 未声明 v7.0 集成策略、测试铁律 T10-T15 缺乏代码映射、文档中部分 v6.0 组件状态未更新 |

---

## 四、P0 致命问题（必须立即修复）

### FF-KIMI-P0-01：v7.0 炉灵（Forgekin）自我进化体系仅存在于文档，代码完全缺失

**问题位置**：
- [`flowforge/docs/spec.md`](file:///home/hyg/ai/openclaw/flowforge/docs/spec.md) 第 7–8 章（约 L2907–L3238）
- [`flowforge/docs/arch.md`](file:///home/hyg/ai/openclaw/flowforge/docs/arch.md) 第 15–22 章（约 L5293–L6400）
- [`flowforge/docs/design.md`](file:///home/hyg/ai/openclaw/flowforge/docs/design.md) 第五部分（约 L3260–L4067）
- [`flowforge/evolution/`](file:///home/hyg/ai/openclaw/flowforge/evolution) — 实际代码目录

**问题详情**：

文档定义了完整的 v7.0 自我进化能力：
- `FR-EVO-01` 炉灵身份系统（`forgekin_id` + `Soul Profile` + 升华阶段）
- `FR-EVO-02` 魂忆 `Soul Echo`（跨会话记忆累积）
- `FR-EVO-03` 魂印 `Soul Imprint`（对操作者/世界的认知画像）
- `FR-EVO-04` 自锻引擎 `Auto-Forge`（无人驱动时自主思考）
- `FR-EVO-06` Skill 自生成（Draft → Validated → Standard）
- `FR-EVO-15` 元认知能力（滚动可靠度 + Wilson 下界）

[`flowforge/docs/design.md`](file:///home/hyg/ai/openclaw/flowforge/docs/design.md) 明确列出应存在的源文件：
- `evolution/forgekin/engine.py`
- `evolution/forgekin/soul_profile.py`
- `evolution/forgekin/soul_store.py`
- `evolution/forgekin/echo_store.py`
- `evolution/forgekin/imprint_store.py`
- `evolution/auto_forge/scheduler.py`
- `evolution/codex/forge_codex.py`
- `evolution/council/forgekin_council.py`

**实际代码状态**：

对 `flowforge/evolution/` 全局搜索 `ForgekinEngine` / `SoulProfile` / `SoulStore` / `EchoStore` / `ImprintStore` / `AutoForge` / `ForgeCodex` / `ForgekinCouncil` **零命中**。当前目录仅包含 v6.0 实现：
- `engine.py` — `SelfEvolutionEngine`
- `scope_guard.py` — `ScopeGuard`
- `process_evolution.py` — `ProcessEvolution`
- `knowledge_evolution.py` — `KnowledgeEvolution`
- `metacognition.py` — `MetacognitionRouter`
- `maturity.py` — `KnowledgeMaturityLadder`
- `models.py` — `ScopeGuardSignal`、`EvolutionProposal`、`EpisodeCard`、`MethodCard`、`EvalLedger` 等

这些 v6.0 类与 v7.0 炉灵体系在数据模型、职责边界、调用入口上均无直接对应关系。

**影响**：
1. `spec.md` / `arch.md` / `design.md` 中所有 FR-EVO 需求都是无代码支撑的纸面设计。
2. `flowforge/docs/face/spec_face.md` 声明 M1-M17 为 v7.0 第 7 层自进化层提供工程支撑，但第 7 层本身不存在。
3. `flowforge/docs/spec.md` 第 11 章「*Forge 自进化统一规格」要求 ContentForge / DevForge / NovelForge / MallForge / StockForge 都具备自我进化能力，但 FlowForge 自身尚未提供可集成的 API。

**整改要求**：
1. **冻结 v7.0 文档对外宣称为「已实现」的表述**，在文档中明确标注 v7.0 为「设计/待实现」状态。
2. 制定分阶段实现路线图：
   - Phase 1（MVP）：`ForgekinEngine` + `SoulProfile` + `SoulStore` + `EchoStore` + `ImprintStore`
   - Phase 2：`Auto-Forge` 调度器 + `Forge Codex` 技能库
   - Phase 3：`Forgekin Council` 多炉灵协作 + 元认知治理
3. 在实现前，删除或改写 `design.md` 中「已存在」的源文件清单，避免误导开发者。
4. 更新 `face/spec_face.md` M18-M20 融合映射，明确当前 v7.0 实现状态。

---

### FF-KIMI-P0-02：FlowForge 自身违反「所有数据检索必须走 OpenSieve」铁律

**问题位置**：
- [`flowforge/tools/web_search.py`](file:///home/hyg/ai/openclaw/flowforge/tools/web_search.py)
- [`flowforge/tools/duckduckgo_search.py`](file:///home/hyg/ai/openclaw/flowforge/tools/duckduckgo_search.py)
- [`flowforge/agents/generic/web_search_agent.py`](file:///home/hyg/ai/openclaw/flowforge/agents/generic/web_search_agent.py)
- [`flowforge/app/main.py`](file:///home/hyg/ai/openclaw/flowforge/app/main.py)
- [`flowforge/config/plugins.yaml`](file:///home/hyg/ai/openclaw/flowforge/config/plugins.yaml)

**问题详情**：

`hiclaw/rules.md` §2.2 明确规定：
> 所有数据检索必须通过 OpenSieve，禁止绕过 OpenSieve 直接访问数据库或外部 API。

但 FlowForge 作为平台层，却直接内置并注册了外部搜索引擎：

| 位置 | 违规内容 |
|------|----------|
| [`flowforge/config/plugins.yaml:46-63`](file:///home/hyg/ai/openclaw/flowforge/config/plugins.yaml) | 注册 `tavily_search` 和 `duckduckgo_search` 两个直连工具 |
| [`flowforge/app/main.py:66-67`](file:///home/hyg/ai/openclaw/flowforge/app/main.py) | 启动时检查 `TAVILY_API_KEY` 并注册 Tavily / DuckDuckGo 工具 |
| [`flowforge/tools/web_search.py:19-20`](file:///home/hyg/ai/openclaw/flowforge/tools/web_search.py) | 回退链显式包含 `tavily_search` 和 `duckduckgo_search` |
| [`flowforge/tools/web_search.py:26`](file:///home/hyg/ai/openclaw/flowforge/tools/web_search.py) | 工具描述写「网络搜索聚合工具：HelixRAG→DuckDuckGo→LLM联网搜索回退链」，仍用旧名 HelixRAG 且暗示直连 |
| [`flowforge/agents/generic/web_search_agent.py:59`](file:///home/hyg/ai/openclaw/flowforge/agents/generic/web_search_agent.py) | Fallback 到 DuckDuckGo / Tavily 直连 |

**影响**：
1. 框架层成为规则违反者，直接破坏「OpenSieve 是唯一数据入口」的架构原则。
2. 上层 *Forge 项目会依据 FlowForge 的默认配置继续绕过 OpenSieve。
3. `TAVILY_API_KEY` 仍需要在 FlowForge 侧配置，与「所有搜索 key 应移交 OpenSieve」冲突。

**整改要求**：
1. **删除** `flowforge/config/plugins.yaml` 中的 `tavily_search` 和 `duckduckgo_search` 注册项。
2. **删除或迁移** `flowforge/tools/duckduckgo_search.py`；Tavily 工具如存在也应删除。
3. **改造** `flowforge/tools/web_search.py`：回退链仅允许 `opensieve_search` → 本地 LLM 生成，禁止直连 Tavily/DuckDuckGo。
4. **改造** `flowforge/agents/generic/web_search_agent.py`：删除 DuckDuckGo/Tavily fallback。
5. **清理** `flowforge/app/main.py`：移除 `TAVILY_API_KEY` 检查与 Tavily/DuckDuckGo 注册逻辑。
6. 将 Tavily / DuckDuckGo / SearXNG / Wikipedia 等搜索引擎作为 OpenSieve 内部 `SearchSource` 注册，由 OpenSieve `SourceLifecycleManager` 统一管理和容错切换。

---

### FF-KIMI-P0-03：Face v3.0 为尚未实现的 v7.0 自进化层提供工程支撑

**问题位置**：
- [`flowforge/docs/face/spec_face.md`](file:///home/hyg/ai/openclaw/flowforge/docs/face/spec_face.md) §1.2、§1.3、§3.1、M18-M20
- [`flowforge/docs/face/arch_face.md`](file:///home/hyg/ai/openclaw/flowforge/docs/face/arch_face.md) §1.1、附录 v7.0 融合对齐

**问题详情**：

`spec_face.md` 明确声明：
> 权威源：`flowforge/docs/spec.md` v7.0（炉灵养成体系权威源）、`flowforge/docs/arch.md` v7.0（七层架构权威源）。
> v3.0 的 M1-M17 是 v7.0 七层架构第 1-6 层的工程实现，为第 7 层（自进化层）的 ForgekinEngine / AutoForge / SoulEcho / ForgekinCouncil 提供协议、上下文、安全、可观测、评估、长程、纠错、成本、部署、HITL、治理、Computer Use、协议栈、故障恢复、多租户、Skill 市场等基础能力支撑。

但如 FF-KIMI-P0-01 所述，v7.0 炉灵体系目前没有任何代码实现。Face v3.0 的 M1-M17 虽然本身是合理的平台增强，但它们与 v7.0 的融合映射目前只是文档层面的「悬空引用」。

**影响**：
1. 开发者会误以为 v7.0 能力已经可用，只需在 Face v3.0 基础上叠加即可。
2. M18-M20 的验收标准无法落地，因为 v7.0 目标对象不存在。

**整改要求**：
1. 在 `spec_face.md` 和 `arch_face.md` 中明确标注：v7.0 炉灵体系为「设计阶段 / 待实现」，M18-M20 为「未来融合映射」。
2. 或者，将 Face v3.0 的发布范围限定为 v2.1 → v3.0 的工业级增强（A2A、MCP、Durable Execution、Guardrails、OTel 等），不绑定 v7.0 实现时间表。
3. 建立版本门控：只有 `evolution/forgekin/` 目录存在并通过基础测试后，才允许文档宣称 v7.0 融合完成。

---

### FF-KIMI-P0-04：*Forge 项目代码与文档仍存在 HelixRAG 旧名及直连搜索引擎残留

**问题位置**：
- [`contentforge/docs/landing_design.md`](file:///home/hyg/ai/openclaw/contentforge/docs/landing_design.md) 多处 `helixrag_search`
- [`devforge/docs/spec.md:4032`](file:///home/hyg/ai/openclaw/devforge/docs/spec.md) 工具列表仍写 `helixrag_search`
- [`novelforge/docs/landing_design.md:5515`](file:///home/hyg/ai/openclaw/novelforge/docs/landing_design.md) 「通过 HelixRAG 检索」
- [`novelforge/mcp_server/tools.py:150`](file:///home/hyg/ai/openclaw/novelforge/mcp_server/tools.py) 直接引用 `flowforge.tools.duckduckgo_search.DuckDuckGoSearchTool`
- [`contentforge/.env`](file:///home/hyg/ai/openclaw/contentforge/.env)（待确认）可能仍保留 `TAVILY_API_KEY`

**问题详情**：

OpenSieve 已完成品牌替换（原 HelixRAG），但多个 *Forge 文档仍在使用旧名。更严重的是，NovelForge 的 MCP Server 代码中直接 import DuckDuckGo 搜索工具，ContentForge 的 `.env` 和 CredentialStore 中 Tavily Key 归属尚未清理。

**影响**：
1. 文档与代码口径不一致，新成员会被旧名和直连实现误导。
2. 违反 `hiclaw/rules.md` §2.2「所有数据检索走 OpenSieve」。

**整改要求**：
1. 全局替换 `HelixRAG` / `helixrag` → `OpenSieve` / `opensieve`（文档 + 代码 + 配置）。
2. 删除或迁移 NovelForge MCP Server 中的 DuckDuckGo 直连引用。
3. 清理 ContentForge / FlowForge 中的 `TAVILY_API_KEY` 环境变量和 CredentialStore 条目，移交 OpenSieve 管理。

---

## 五、P1 严重问题（验收前必须完成）

### FF-KIMI-P1-01：文档版本号混乱，权威源引用互相矛盾

**问题位置**：
- [`flowforge/docs/spec.md:1`](file:///home/hyg/ai/openclaw/flowforge/docs/spec.md) — 标题 **FlowForge v2.1 功能特性规格说明书**
- [`flowforge/docs/arch.md:1`](file:///home/hyg/ai/openclaw/flowforge/docs/arch.md) — 标题 **FlowForge v6.0 架构设计**
- [`flowforge/docs/design.md:1`](file:///home/hyg/ai/openclaw/flowforge/docs/design.md) — 标题 **FlowForge v6.0 详细设计文档**
- [`flowforge/docs/face/spec_face.md:7`](file:///home/hyg/ai/openclaw/flowforge/docs/face/spec_face.md) — 声明权威源为 `spec.md v7.0`、`arch.md v7.0`
- 正文内 L2900 起为 v7.0 章节

**问题详情**：

三份核心文档的标题版本与正文版本不一致：`spec.md` 标题 v2.1 但包含 v7.0 内容；`arch.md` / `design.md` 标题 v6.0 但包含 v7.0 内容。Face 文档又引用「`spec.md v7.0` / `arch.md v7.0`」作为权威源，但这两份文件标题并未标 v7.0。

**影响**：开发者无法判断哪份文档代表当前权威版本，容易造成「v2.1 还是 v7.0」的混乱。

**整改要求**：
1. 统一三份文档标题为 **FlowForge v7.0**，或在标题中明确标注「v7.0 预览 / 设计稿」。
2. 在文档头部增加版本说明：本文档包含 v2.1/v6.0 基座内容 + v7.0 新增设计，当前实现状态以代码为准。
3. Face 文档引用权威源时，应指向明确的版本标识或代码实现状态。

---

### FF-KIMI-P1-02：质量分阈值配置与文档基准不一致（0.9 vs 0.85）

**问题位置**：
- [`flowforge/config/default.yaml:114`](file:///home/hyg/ai/openclaw/flowforge/config/default.yaml) — `quality_threshold: 0.9`
- [`flowforge/docs/design.md:959`](file:///home/hyg/ai/openclaw/flowforge/docs/design.md) — `QUALITY_THRESHOLD = 0.9`
- [`flowforge/docs/design.md:2474`](file:///home/hyg/ai/openclaw/flowforge/docs/design.md) — `QUALITY_THRESHOLD = 0.9`
- [`hiclaw/rules.md:186`](file:///home/hyg/ai/openclaw/hiclaw/rules.md) — 质量分阈值默认 **0.85**
- [`hiclaw/prompts.md:493`](file:///home/hyg/ai/openclaw/hiclaw/prompts.md) — 检查质量分阈值是否为 0.85
- [`hiclaw/prompts.md:518`](file:///home/hyg/ai/openclaw/hiclaw/prompts.md) — 质量分阈值默认 0.85

**问题详情**：

`rules.md` v3.0 和 `prompts.md` 已将默认质量分阈值从 0.9 调整为 **0.85**，但 FlowForge 的配置文件和详细设计文档仍使用 0.9。虽然 `loop/verifier.py` / `MultiJudgeVerifier` 实际默认可能为 0.85，但配置与文档的不一致会导致执行与预期偏差。

**整改要求**：
1. 将 `flowforge/config/default.yaml` 中的 `quality_threshold` 改为 **0.85**。
2. 将 `flowforge/docs/design.md` 中的 `QUALITY_THRESHOLD` 常量与说明改为 **0.85**。
3. 全项目搜索 `quality_threshold: 0.9` / `QUALITY_THRESHOLD = 0.9`，统一校准。
4. 如特定业务场景需要更高阈值，应在 Loop YAML 中显式覆盖并注释原因。

---

### FF-KIMI-P1-03：七层架构叙事冲突（互联层 vs 自进化层）

**问题位置**：
- [`flowforge/docs/face/arch_face.md:15-19`](file:///home/hyg/ai/openclaw/flowforge/docs/face/arch_face.md) — v3.0 第 7 层为「互联层（Interconnect Layer）」
- [`flowforge/docs/face/arch_face.md:1404-1408`](file:///home/hyg/ai/openclaw/flowforge/docs/face/arch_face.md) — v7.0 将「互联层」升级为「自进化层」
- [`flowforge/docs/arch.md:5293-5309`](file:///home/hyg/ai/openclaw/flowforge/docs/arch.md) — v7.0 直接新增第 7 层为「自进化层」，未提及「互联层」前身

**问题详情**：

Face v3.0 将第 7 层定义为「互联层」，然后在附录中说 v7.0 升级为「自进化层」。`arch.md` 却说 v7.0 直接新增第 7 层「自进化层」。两者对第 7 层的起源描述不一致：一个认为是「互联层升级」，一个认为是「自进化层新增」。

**整改要求**：
1. 统一七层架构演进叙事：v2.1 六层 → v3.0 新增互联层（Interconnect Layer）→ v7.0 将互联层扩展/重命名为自进化层（Evolution Layer）。
2. 在 `arch.md` v7.0 章节增加对 v3.0 互联层前身的说明，或明确「v7.0 自进化层包含并扩展了 v3.0 互联层职责」。
3. 避免同一层号在不同文档中出现两套起源故事。

---

### FF-KIMI-P1-04：Plugin V2 协议在各 *Forge 项目中落地不一致

**问题位置**：
- [`flowforge/core/plugin_protocol.py:327-411`](file:///home/hyg/ai/openclaw/flowforge/core/plugin_protocol.py) — 标准钩子定义完整
- [`contentforge/docs/spec.md:2511`](file:///home/hyg/ai/openclaw/contentforge/docs/spec.md) — Workflow 通过 `register_workflows` 注册，Loop 使用方式描述不清
- [`devforge/docs/spec.md:4790-4792`](file:///home/hyg/ai/openclaw/devforge/docs/spec.md) — 同时提到 `register_workflows` 与 `register_loops`，相对规范
- [`mallforge/docs/design.md:270-272`](file:///home/hyg/ai/openclaw/mallforge/docs/design.md) — 声称 `register_loops()` 已实现
- [`mallforge/docs/arch.md:930-937`](file:///home/hyg/ai/openclaw/mallforge/docs/arch.md) 与 [`mallforge/docs/spec.md:590`](file:///home/hyg/ai/openclaw/mallforge/docs/spec.md) — 写 `register_agents` / `register_tools` 为 no-op lambda，与 design.md 矛盾
- [`novelforge/docs/spec.md:3523`](file:///home/hyg/ai/openclaw/novelforge/docs/spec.md) 与 [`novelforge/docs/arch.md:2149`](file:///home/hyg/ai/openclaw/novelforge/docs/arch.md) — 明确标准 V2 hooks 未实现

**问题详情**：

FlowForge 已经定义了完整的 Plugin V2 协议（`register_agents/tools/loops/workflows/routes/schedules/event_handlers/gates/evaluators`），但各 *Forge 落地程度差异很大：ContentForge 文档对 `register_loops` 使用不清；MallForge 不同文档互相矛盾；NovelForge 直接未实现标准 hooks。

**整改要求**：
1. 制定一份统一的 *Forge Plugin V2 落地 checklist，明确每个项目必须实现哪些钩子。
2. 修正 MallForge 文档内部矛盾。
3. 推动 NovelForge 按标准 V2 协议重构插件注册。
4. 在 `rules.md` 或 `prompts.md` 中增加 Plugin V2 的强制验收项。

---

### FF-KIMI-P1-05：`design.md` / `arch.md` 对部分 Harness 组件的实现位置描述过时

**问题位置**：
- [`flowforge/docs/design.md:3118`](file:///home/hyg/ai/openclaw/flowforge/docs/design.md)
- [`flowforge/docs/arch.md:5175`](file:///home/hyg/ai/openclaw/flowforge/docs/arch.md)

**问题详情**：

文档写 `harness/feedback/verification_hooks.py`、`harness/entropy/doc_gardener.py`、`debt_tracker.py`、`rule_evolution.py`「未实现」。实际上这些能力已合并实现在 [`flowforge/harness/entropy_manager.py`](file:///home/hyg/ai/openclaw/flowforge/harness/entropy_manager.py) 中（`DocGardener`、`DebtTracker`、`RuleEvolution`）。

**整改要求**：
1. 更新 `design.md` / `arch.md` 中 Harness 组件的实现位置与状态。
2. 删除或归档过时的文件路径描述。

---

## 六、P2 一般问题（迭代优化）

### FF-KIMI-P2-01：*Forge 项目文档未声明 v7.0 炉灵体系集成策略

**问题位置**：
- `contentforge/docs/{spec.md,arch.md,design.md}`
- `devforge/docs/{spec.md,arch.md,design.md}`
- `novelforge/docs/{spec.md,arch.md,design.md}`
- `mallforge/docs/{spec.md,arch.md,design.md}`
- `stockforge/docs/{spec.md,arch.md,design.md}`

**问题详情**：

`flowforge/docs/spec.md` 第 11 章要求所有 *Forge 项目组合/继承 FlowForge 后具备自我进化能力，并给出了 `fk_writer`、`fk_architect`、`fk_analyst` 等角色映射。但各 *Forge 自身文档几乎未提及 Forgekin / Soul Echo / Auto-Forge / Forge Codex 如何被本业务使用。

**整改要求**：
1. 每个 *Forge 在 `arch.md` 中增加「v7.0 炉灵集成视角」章节。
2. 明确本项目的 Forgekin 角色、自进化方向、业务指标。

---

### FF-KIMI-P2-02：Face v3.0 新增 T10-T15 测试铁律缺乏代码映射

**问题位置**：
- [`flowforge/docs/face/spec_face.md`](file:///home/hyg/ai/openclaw/flowforge/docs/face/spec_face.md) §测试铁律
- [`flowforge/docs/test.md`](file:///home/hyg/ai/openclaw/flowforge/docs/test.md)

**问题详情**：

Face v3.0 在 T1-T9 基础上新增 T10-T15（A2A、MCP、Durable、Guardrails、OTel、Eval 等），但 `flowforge/docs/test.md` 和代码测试目录中未见对应实现计划或测试用例。

**整改要求**：
1. 在 `test.md` 中补充 T10-T15 的验收标准与测试用例模板。
2. 为 M1-M17 中每个 P0 模块定义至少一条端到端测试。

---

### FF-KIMI-P2-03：文档中「HelixRAG」等旧名与旧路径残留

**问题位置**：
- [`flowforge/tools/web_search.py:26`](file:///home/hyg/ai/openclaw/flowforge/tools/web_search.py) — 工具描述仍写「HelixRAG→DuckDuckGo→LLM联网搜索回退链」
- [`contentforge/docs/landing_design.md`](file:///home/hyg/ai/openclaw/contentforge/docs/landing_design.md) 多处
- [`devforge/docs/spec.md:4032`](file:///home/hyg/ai/openclaw/devforge/docs/spec.md)
- [`novelforge/docs/landing_design.md:5515`](file:///home/hyg/ai/openclaw/novelforge/docs/landing_design.md)

**整改要求**：
全局替换 `HelixRAG` / `helixrag` 为 `OpenSieve` / `opensieve`。

---

## 七、代码 vs 文档差距总表

| 文档声明 | 代码实际状态 | 差距评估 |
|---|---|---|
| `spec.md` v7.0 炉灵养成体系（FR-EVO-01~15） | `evolution/` 仍为 v6.0 `SelfEvolutionEngine`；无 `forgekin/`、`auto_forge/`、`codex/`、`council/` 目录 | **完全缺失** |
| `arch.md` 第 16 章 `ForgekinEngine` 包装 `HybridExecutor` | 无 `ForgekinEngine` 类 | **完全缺失** |
| `design.md` 第五部分 v7.0 目录结构与数据模型 | 文件不存在，模型不存在 | **完全缺失** |
| `rules.md` 所有数据检索走 OpenSieve | FlowForge 仍注册 Tavily/DuckDuckGo 直连工具；`web_search_agent` 直接 Fallback 到外部搜索 | **核心违规** |
| `rules.md` P31 LoopExecutor 为唯一执行入口 | `flowforge/loop/executor.py`、`flowforge/sdk.py` 已实现并集成；`hybrid_executor.py` 保留 `loop` mode 适配器作为向后兼容 | **基本实现，仍有模式化残留** |
| `rules.md` 默认质量分阈值 0.85 | `loop/verifier.py`、`MultiJudgeVerifier` 默认可能是 0.85；但 `config/default.yaml`、`design.md` 仍写 0.9 | **部分不一致** |
| `rules.md` Plugin V2 标准钩子 | `plugin_protocol.py` 已实现；各 *Forge 采用程度参差不齐 | **框架实现，项目落地不齐** |
| v6.0 Harness 层（反馈循环、熵管理、上下文工程） | `harness/feedback_loop.py`、`entropy_manager.py`、`context_engine.py`、`orchestrator.py` 等已实现 | **基本落地** |
| Face v3.0 M1-M17 工业级能力 | 部分已有基础（Loop、EventBus、Helm），但 A2A、Durable Execution、六层 Guardrails、OTel GenAI、Skill 市场等未验证 | **待验证** |

---

## 八、跨项目冲突与一致性核查

| 冲突点 | 涉及项目/文件 | 说明 | 建议 |
|---|---|---|---|
| **OpenSieve 唯一入口 vs 直连搜索工具** | FlowForge `tools/web_search.py`、`tools/duckduckgo_search.py`、`config/plugins.yaml`、`app/main.py` | 框架层违反自身规则 | 删除直连工具，统一为 OpenSieve SearchSource |
| **HelixRAG 名称残留** | ContentForge `docs/landing_design.md`；DevForge `docs/spec.md`；NovelForge `docs/landing_design.md` | 已更名 OpenSieve，但文档仍用旧名 | 全局替换 |
| **Tavily Key 归属** | ContentForge `.env` / `docs/landing_design.md`；FlowForge `app/main.py` | 文档已删除，但代码 / `.env` 清理未完成 | 移交 OpenSieve 管理 |
| **Plugin 钩子使用方式** | ContentForge / MallForge / NovelForge | 各项目未统一遵循 V2 协议 | 制定统一 checklist 并修正文档 |
| **v7.0 集成策略缺失** | ContentForge / DevForge / NovelForge / MallForge / StockForge | 这些项目文档未说明如何利用 Forgekin/Soul Echo/Auto-Forge | 每个 *Forge 增加 v7.0 集成章节 |
| **版本号引用混乱** | Face docs 引用 `spec.md v7.0`、`arch.md v7.0`，但后两者标题分别为 v2.1 / v6.0 | 权威源标识不一致 | 统一标题与版本声明 |
| **七层定义冲突** | `arch_face.md` 说 v3.0 第 7 层是「互联层」、v7.0 升级为「自进化层」；`arch.md` 说 v7.0 新增第 7 层「自进化层」 | 架构演进叙事不一致 | 统一叙事：互联层扩展为自进化层 |
| **质量分阈值 0.85 vs 0.9** | `hiclaw/rules.md`、`hiclaw/prompts.md` vs `flowforge/config/default.yaml`、`flowforge/docs/design.md` | 基准与配置/文档不一致 | 统一按 rules/prompts 0.85 |

---

## 九、整改优先级建议

### 立即执行（P0）
1. **冻结 v7.0 文档的「已实现」表述**，明确标注实现状态。
2. **删除 FlowForge 层面的 Tavily/DuckDuckGo 直连工具**（`config/plugins.yaml`、`app/main.py`、`tools/web_search.py`、`agents/generic/web_search_agent.py`）。
3. **制定 v7.0 炉灵体系分阶段实现路线图**，从 `ForgekinEngine` + `SoulProfile` + `EchoStore` + `ImprintStore` MVP 开始。
4. **清理 NovelForge MCP Server 与 ContentForge `.env` 中的直连搜索残留**。

### 尽快完成（P1）
5. 统一 `spec.md` / `arch.md` / `design.md` 标题版本与正文版本。
6. 校准 `flowforge/config/default.yaml` 与 `design.md` 中的质量分阈值为 0.85。
7. 统一七层架构叙事（互联层 → 自进化层）。
8. 修正 MallForge Plugin 文档矛盾，推动 NovelForge 实现标准 V2 hooks。
9. 更新 `design.md` / `arch.md` 中 Harness 组件的实现位置描述。

### 质量提升（P2）
10. 每个 *Forge 增加 v7.0 炉灵集成策略章节。
11. 在 `flowforge/docs/test.md` 中补充 T10-T15 验收标准。
12. 全局清理 `HelixRAG` 旧名残留。

---

## 十、养灵体系命名方案建议（独立章节）

> 本章节针对 `flowforge/docs/spec.md` / `arch.md` / `design.md` 中提出的「炉灵 / Forgekin / 养灵」自我进化体系，从专业产品命名与 AGI 愿景表达角度给出评审意见和替代方案，供最终决策。

### 10.1 对当前「炉灵 / Forgekin」命名的评审

当前体系使用了一套与「锻造」品牌强绑定的东方玄幻隐喻：

| 中文 | 英文 | 含义 |
|------|------|------|
| 炉灵 | Forgekin | 自进化智能体 |
| 养灵 | Forge Nurturing | 炉灵养成全过程 |
| 魂忆 | Soul Echo | 跨会话记忆 |
| 魂印 | Soul Imprint | 认知画像 |
| 自锻 | Auto-Forge | 无人驱动自主思考 |
| 锻典 | Forge Codex | 自生成技能库 |
| 灵议庭 | Forgekin Council | 多炉灵协作治理 |
| 升华阶 | Ascension Stages | 成长阶段 |

**优点**：
- 与 FlowForge / *Forge 的「锻造」品牌一脉相承，内部代号辨识度高。
- 术语对仗工整，便于记忆和传播。

**缺点**：
- **认知门槛高**：「炉灵」「魂印」「升华」等词带有明显的玄幻/游戏色彩，面向企业级客户或海外开发者时，会削弱 AGI 平台的专业感与可信度。
- **隐喻过载**：将 AI 工程系统比喻为「灵魂」「魂忆」容易与神秘主义、不可解释性产生联想，与可审计、可解释、可控的 AI 工程目标存在张力。
- **翻译与扩展负担**：`Forgekin`、`Soul Echo`、`Soul Imprint` 在英文语境中同样偏奇幻，进入金融、医疗、法律等严肃行业时需要二次包装。
- **能力映射不直观**：新用户无法一眼看出这些词对应「长期记忆、认知画像、技能沉淀、多 Agent 协作、成熟度模型」等核心工程能力。

**结论**：当前命名适合作为**内部代号**或**开发者社区趣味品牌**，但若要承载「通往 AGI 的基础框架」这一愿景，建议引入一套更通俗、更具技术普适性的对外命名体系，或在内部代号与对外品牌之间做区隔。

### 10.2 替代命名方案

#### 方案 A：智能核 / Agent Kernel（推荐）

| 中文 | 英文 | 对应现有概念 | 意象说明 |
|------|------|-------------|----------|
| 智能核 | Agent Kernel | Forgekin / 炉灵 | 把自进化智能体比喻为可成长的「核心」，强调它是 Agent 的可进化内核 |
| 核养 | Kernel Nurturing | 养灵 / Forge Nurturing | 对智能核的持续培养与训练 |
| 记忆核 | Memory Kernel | Soul Echo / 魂忆 | 跨会话累积的记忆层 |
| 认知核 | Cognition Kernel | Soul Imprint / 魂印 | 对操作者与世界的认知画像 |
| 自锻核 | Auto-Kernel | Auto-Forge / 自锻 | 无人驱动时的自主思考与进化 |
| 技能核 | Skill Kernel | Forge Codex / 锻典 | 自生成、可复用的技能库 |
| 核议会 | Kernel Council | Forgekin Council / 灵议庭 | 多智能核协作治理 |
| 核级 | Kernel Tier | Ascension Stages / 升华阶 | 智能核成熟度等级 |

**核心口号**：*Every Agent has a Kernel; every Kernel can grow.*

**适用性**：⭐⭐⭐⭐⭐
- 技术感强，通俗易懂，企业级客户容易接受。
- 与「Agent = Model + Harness + Kernel」的公式自然对应，可替换文档中的 `Agent = Model + Harness + Soul`。

#### 方案 B：锻体 / Forge Being

| 中文 | 英文 | 对应现有概念 | 意象说明 |
|------|------|-------------|----------|
| 锻体 | Forge Being | Forgekin / 炉灵 | 保留「锻造」品牌，但用「体」替代「灵」，弱化玄学 |
| 锻体养成 | Forge Being Nurturing | 养灵 | 锻体从弱到强的成长过程 |
| 经验体 | Experience Being | Soul Echo / 魂忆 | 累积的经验与记忆 |
| 画像体 | Profile Being | Soul Imprint / 魂印 | 对操作者的认知画像 |
| 自锻 | Auto-Forge | Auto-Forge / 自锻 | 可保留原名 |
| 技艺典 | Artifice Codex | Forge Codex / 锻典 | 锻体沉淀的技艺库 |
| 锻体议事厅 | Forge Being Council | Forgekin Council / 灵议庭 | 多锻体协作治理 |
| 锻阶 | Forge Rank | Ascension Stages / 升华阶 | 锻体等级 |

**核心口号**：*Forge the Being, not just the tool.*

**适用性**：⭐⭐⭐⭐
- 品牌延续性好，仍保留 FlowForge 的锻造隐喻。
- 「体」比「灵」更接近工程实体，认知门槛适中。

#### 方案 C：认知孪生 / Cognitive Twin

| 中文 | 英文 | 对应现有概念 | 意象说明 |
|------|------|-------------|----------|
| 认知孪生 | Cognitive Twin | Forgekin / 炉灵 | 借用「数字孪生」概念，强调与操作者共同进化的数字伙伴 |
| 孪生培养 | Twin Cultivation | 养灵 | 认知孪生的持续培养 |
| 记忆孪生 | Memory Twin | Soul Echo / 魂忆 | 跨会话记忆 |
| 偏好孪生 | Preference Twin | Soul Imprint / 魂印 | 对操作者偏好的画像 |
| 自主孪生 | Autonomous Twin | Auto-Forge / 自锻 | 无人驱动时自主思考 |
| 能力库 | Capability Library | Forge Codex / 锻典 | 孪生沉淀的能力库 |
| 孪生协同网 | Twin Mesh | Forgekin Council / 灵议庭 | 多孪生协作网络 |
| 成熟度 | Maturity Level | Ascension Stages / 升华阶 | 孪生成熟度等级 |

**核心口号**：*Your Cognitive Twin, evolving with you.*

**适用性**：⭐⭐⭐⭐
- 最易被企业客户接受，且与「数字孪生」已有概念衔接。
- 但缺少 FlowForge 品牌独特性，容易与市场上其他「AI Twin」概念混淆。

#### 方案 D：活体 Agent / Living Agent

| 中文 | 英文 | 对应现有概念 | 意象说明 |
|------|------|-------------|----------|
| 活体 | Living Agent | Forgekin / 炉灵 | 强调 Agent 像生命体一样成长 |
| 养育 | Living Agent Nurturing | 养灵 | 对生命体的持续养育 |
| 经历库 | Episode Store | Soul Echo / 魂忆 | 活体经历的情景记忆 |
| 认知画像 | Cognitive Profile | Soul Imprint / 魂印 | 对世界的认知画像 |
| 自主思考 | Autonomous Thinking | Auto-Forge / 自锻 | 无人驱动时的自主思考 |
| 能力典 | Capability Codex | Forge Codex / 锻典 | 活体沉淀的能力典籍 |
| 活体群 | Living Agent Swarm | Forgekin Council / 灵议庭 | 多活体协作群体 |
| 成长等级 | Growth Level | Ascension Stages / 升华阶 | 活体成长等级 |

**核心口号**：*Agents that live and learn.*

**适用性**：⭐⭐⭐
- 直截了当说明能力，无歧义。
- 但文学性较弱，作为品牌记忆点不足。

#### 方案 E：智能化身 / Agent Avatar

| 中文 | 英文 | 对应现有概念 | 意象说明 |
|------|------|-------------|----------|
| 化身 | Agent Avatar | Forgekin / 炉灵 | 强调可成长、可定制的 Agent 身份 |
| 化身养成 | Avatar Cultivation | 养灵 | 化身的持续养成 |
| 记忆体 | Memory Core | Soul Echo / 魂忆 | 化身记忆核心 |
| 人格画像 | Persona Profile | Soul Imprint / 魂印 | 化身人格画像 |
| 化身自省 | Avatar Introspection | Auto-Forge / 自锻 | 无人驱动时的自省 |
| 技艺典 | Artifice Codex | Forge Codex / 锻典 | 化身技艺典籍 |
| 化身议事厅 | Avatar Council | Forgekin Council / 灵议庭 | 多化身协作治理 |
| 阶位 | Avatar Rank | Ascension Stages / 升华阶 | 化身阶位 |

**核心口号**：*An Avatar that grows into an expert.*

**适用性**：⭐⭐⭐
- 适合 ToC / 个人助手场景。
- 企业级场景中「Avatar」可能显得过于娱乐化。

### 10.3 综合推荐

| 场景 | 推荐方案 |
|------|----------|
| **对外企业级品牌** | **方案 A：智能核 / Agent Kernel** |
| **保留 FlowForge 锻造品牌，同时降低玄学感** | **方案 B：锻体 / Forge Being** |
| **面向大众/个人助手市场** | 方案 E：智能化身 / Agent Avatar |
| **强调数字伙伴/企业数字化** | 方案 C：认知孪生 / Cognitive Twin |
| **内部工程代号（无品牌诉求）** | 保留现有「炉灵 / Forgekin」或方案 D：活体 Agent |

**最终建议**：
- **对外统一采用「智能核 / Agent Kernel」体系**，将文档中的公式从 `Agent = Model + Harness + Soul` 改为 `Agent = Model + Harness + Kernel`。
- **内部仍可保留「炉灵 / Forgekin」作为趣味代号**，但需在文档中明确「炉灵 = 智能核的内部代号」。
- 若必须保留「灵魂」隐喻，建议限定在开发者社区或品牌宣传材料中，正式技术文档优先使用「智能核」体系，以降低企业级客户的认知门槛并强化 AGI 工程平台的专业定位。

---

## 十一、修改记录

| 日期 | 版本 | 修改内容 |
|------|------|---------|
| 2026-06-29 | v1.0 | 初始审核报告：覆盖 FlowForge v7.0 炉灵体系、Face v3.0、代码实现差距、跨项目冲突、养灵体系命名方案 |
