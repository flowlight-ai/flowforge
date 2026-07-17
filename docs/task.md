# FlowForge v7.0 重构任务清单

> **本文档作用**: 基于 `review.md` 第十二章 12.4 节 6 阶段规划，列出从 Phase 0 文档拆分骨架到 Phase 6 灵议议事的全部任务清单，作为灵智体协作的"待办池"。
>
> **维护规则**: 灵智体在执行任务时按所属 Phase 领取任务；任务完成后须更新本文档状态标记（⏳ → 🔄 → ✅），并同步更新 `ROADMAP.md` 对应阶段状态。
>
> **跨 Phase 不变量**: T1-T8 测试铁律、15 条编程红线、P31 Loop 强制验证、质量分阈值 0.85、operator 7 条愿景锚点（见 `VISION.md`）。
>
> **审核文件清单（共 16 份）**: `review/glm.md`、`review/glm1.md`、`review/qianwen.md`、`review/qianwen1.md`、`review/deepseek.md`、`review/deepseek1.md`、`review/doubao.md`、`review/doubao1.md`、`review/kimi.md`、`review/kimi1.md`、`review/minimax.md`、`review/minimax1.md`、`review/review.md`（终稿 v1.2）、`review/review1.md`、`review/reviewd.md`、`review/reviewd1.md`。
>
> **本文档依赖引用（共 13 份）**:
> 1. `review/review.md` —— 终稿审核（决策源）
> 2. `VISION.md` —— 万物灵智体愿景
> 3. `ROADMAP.md` —— 6 阶段路线图
> 4. `SOP.md` —— 灵智体协作 SOP
> 5. `TIPS.md` —— 38 条经验提示
> 6. `roleagent.md` —— 七大工程路径
> 7. `decisions/004-capability-profile-routing.md` —— 能力画像 ADR
> 8. `decisions/005-forgemind-application-layer.md` —— forgemind ADR
> 9. `decisions/006-external-agent-integration.md` —— 三方 Agent ADR
> 10. `decisions/012-naming-fusion.md` —— 命名融合 ADR
> 11. `decisions/013-all-things-spirit-mind-vision.md` —— 万物灵智体愿景 ADR
> 12. `features/TEMPLATE.md` —— Feature 模板
> 13. `harness-feedback/README.md` —— Eval 反馈规范

---

## 进度概览

| 阶段 | 范围 | 时间 | 状态 | 完成度 |
|------|------|------|------|--------|
| Phase 0 | 文档拆分骨架 + 命名迁移 + v7.0 设计态标注 | 本周 | 🔄 进行中 | 50% |
| Phase 1 | roleagent 七大工程路径代码骨架 | 1-2 周 | ⏳ 待开始 | 0% |
| Phase 2 | forgemind 应用层骨架 + 万物灵智体形态分类 | 2-4 周 | ⏳ 待开始 | 0% |
| Phase 3 | 三方 Agent 适配层 | 2-4 周 | ⏳ 待开始 | 0% |
| Phase 4 | Eval 自代谢 + 分布式可靠性 | 4-8 周 | ⏳ 待开始 | 0% |
| Phase 5 | 伙伴系统数学 + 自我演进闭环 | 8-12 周 | ⏳ 待开始 | 0% |
| Phase 6 | 灵锻 SpiritForge + 灵议 Mind Council | 持续 | ⏳ 待开始 | 0% |

---

## Phase 0：文档拆分骨架 + 命名迁移 + v7.0 设计态标注

> **目标**: 按 `clowder-ai/docs` 七大子目录结构组织 flowforge/docs/，完成术语全局替换，让文档可被灵智体增量维护。
>
> **验收标准**:
> - docs/ 七子目录骨架完整（architecture/ decisions/ design/ features/ harness-feedback/ perspectives/ setup/）
> - 13 份核心 ADR 全部存在
> - 40 份 Feature 规格全部存在（F001-F040）
> - 术语全局替换：炉灵→灵智、E6 灵匠 Mind Artisan→灵智、M18/M19/M20→ForgeMindEngine
> - spec.md / arch.md / design.md 改为索引文件（指向七子目录）

### P0-1 顶层文档（✅ 已完成）

| 任务 | 文件 | 状态 |
|------|------|------|
| 万物灵智体愿景 | `VISION.md` | ✅ |
| 文档总入口导航 | `README.md` | ✅ |
| 6 阶段路线图 | `ROADMAP.md` | ✅ |
| 灵智体协作 SOP | `SOP.md` | ✅ |
| 38 条经验提示 | `TIPS.md` | ✅ |
| roleagent 工程路径镜像 | `roleagent.md` | ✅ |

### P0-2 七大子目录骨架（✅ 已完成）

| 任务 | 文件 | 状态 |
|------|------|------|
| architecture/ README | `architecture/README.md` | ✅ |
| decisions/ README + ADR 规范 | `decisions/README.md` | ✅ |
| design/ README | `design/README.md` | ✅ |
| features/ README + TEMPLATE | `features/README.md`、`features/TEMPLATE.md` | ✅ |
| harness-feedback/ README | `harness-feedback/README.md` | ✅ |
| perspectives/ README | `perspectives/README.md` | ✅ |
| setup/ README | `setup/README.md` | ✅ |

### P0-3 P0 ADR（5 份已完成，剩余 8 份待补）

| 任务 | 文件 | 状态 |
|------|------|------|
| ADR-004 能力画像路由 | `decisions/004-capability-profile-routing.md` | ✅ |
| ADR-005 forgemind 应用层 | `decisions/005-forgemind-application-layer.md` | ✅ |
| ADR-006 三方 Agent 集成 | `decisions/006-external-agent-integration.md` | ✅ |
| ADR-012 命名融合 | `decisions/012-naming-fusion.md` | ✅ |
| ADR-013 万物灵智体愿景 | `decisions/013-all-things-spirit-mind-vision.md` | ✅ |
| ADR-001 Agent 调用方式 | `decisions/001-agent-invocation-approach.md` | ⏳ |
| ADR-002 TeamAct 协作协议 | `decisions/002-collaboration-protocol.md` | ⏳ |
| ADR-003 线程架构 | `decisions/003-project-thread-architecture.md` | ⏳ |
| ADR-007 Harness 工程路径 | `decisions/007-harness-engineering.md` | ⏳ |
| ADR-008 多域记忆联邦 | `decisions/008-memory-federation.md` | ⏳ |
| ADR-009 Eval 自代谢 | `decisions/009-eval-self-metabolism.md` | ⏳ |
| ADR-010 分布式可靠性 | `decisions/010-distributed-reliability.md` | ⏳ |
| ADR-011 伙伴系统数学 | `decisions/011-partnership-math.md` | ⏳ |

### P0-4 核心 Feature 规格（4 份已完成，剩余 36 份待补）

| 任务 | 文件 | 状态 |
|------|------|------|
| F001 能力画像 | `features/F001-capability-profile.md` | ✅ |
| F002 TeamAct 六步循环 | `features/F002-teamact-loop.md` | ✅ |
| F026 forgemind 应用层 | `features/F026-forgemind-app-layer.md` | ✅ |
| F031 三方 Agent 适配层 | `features/F031-external-agent-adapter.md` | ✅ |
| F003 交接胶囊 | `features/F003-handoff-capsule.md` | ⏳ |
| F004 乒乓球熔断器 | `features/F004-pingpong-circuit-breaker.md` | ⏳ |
| F005 行首 @ 路由 | `features/F005-at-mention-routing.md` | ⏳ |
| F006 持球注册 lease | `features/F006-ball-custody-lease.md` | ⏳ |
| F007 Generator Push Back | `features/F007-push-back-protocol.md` | ⏳ |
| F008 Durable State Surfaces | `features/F008-durable-state-surfaces.md` | ⏳ |
| F009 Evidence & Sensors | `features/F009-evidence-sensors.md` | ⏳ |
| F010 Governance 压缩免疫 | `features/F010-governance-boundary.md` | ⏳ |
| F011 Magic Words 逃生舱 | `features/F011-magic-words.md` | ⏳ |
| F012 Entropy Control 退役 | `features/F012-entropy-control.md` | ⏳ |
| F013 Harnessability 评估 | `features/F013-harnessability.md` | ⏳ |
| F014 多域记忆 Collection | `features/F014-memory-collection.md` | ⏳ |
| F015 三检索入口 | `features/F015-three-retrieval-entry.md` | ⏳ |
| F016 记忆治理三要素 | `features/F016-memory-governance.md` | ⏳ |
| F017 消费加权排序 | `features/F017-consumption-weighted-ranking.md` | ⏳ |
| F018 Eval Contract 五问 | `features/F018-eval-contract.md` | ⏳ |
| F019 三方信号交叉 | `features/F019-three-signal-cross.md` | ⏳ |
| F020 七类归因矩阵 | `features/F020-seven-attribution.md` | ⏳ |
| F021 副作用日志 WAL | `features/F021-side-effect-wal.md` | ⏳ |
| F022 Tier 1-4 恢复分级 | `features/F022-tier-1-4-recovery.md` | ⏳ |
| F023 liveness 规范读模型 | `features/F023-liveness-canonical-read.md` | ⏳ |
| F024 弱状态机 vs 强 workflow | `features/F024-weak-state-vs-strong-workflow.md` | ⏳ |
| F025 跨 provider 宿主抽象 | `features/F025-provider-host-abstraction.md` | ⏳ |
| F027 万物灵智体形态分类 | `features/F027-all-things-spirit-species.md` | ⏳ |
| F028 灵智体锻造流水线 | `features/F028-forging-pipeline.md` | ⏳ |
| F029 物理 AI 传感器接入 | `features/F029-physical-ai-sensors.md` | ⏳ |
| F030 虚拟世界设定层 | `features/F030-virtual-world-setting.md` | ⏳ |
| F032 三方 Agent 能力画像 | `features/F032-external-agent-profile.md` | ⏳ |
| F033 三方 Agent 状态共享 | `features/F033-external-agent-shared-state.md` | ⏳ |
| F034 三方 Agent 失败回退 | `features/F034-external-agent-fallback.md` | ⏳ |
| F035 三方 Agent 能力融合 | `features/F035-external-agent-capability-fusion.md` | ⏳ |
| F036 forgemind 与 *Forge 关系 | `features/F036-forgemind-forge-relationship.md` | ⏳ |
| F037 灵智体市场 | `features/F037-forgemind-marketplace.md` | ⏳ |
| F038 灵智体进化谱系 | `features/F038-forgemind-lineage.md` | ⏳ |
| F039 灵典可检索知识库 | `features/F039-mind-codex-searchable.md` | ⏳ |
| F040 Harness Eval 控制面 | `features/F040-harness-eval-control-plane.md` | ⏳ |

### P0-5 architecture/ 子目录文件（8 份）

| 任务 | 文件 | 状态 |
|------|------|------|
| 架构视图（七层 + forgemind） | `architecture/2026-07-17-architecture-views.md` | ⏳ |
| 行首 @ 路由协议 | `architecture/at-mention-routing-system.md` | ⏳ |
| CLI 集成（三方 Agent） | `architecture/cli-integration.md` | ⏳ |
| 协作全景（TeamAct + 共鸣 + 灵议） | `architecture/collaboration-landscape.md` | ⏳ |
| Feature 在七层架构中的归属 | `architecture/feature-placement.md` | ⏳ |
| 多域记忆联邦架构 | `architecture/memory-system-overview.md` | ⏳ |
| 检索流水线（三入口 + 消费加权） | `architecture/retrieval-pipeline-deep-dive.md` | ⏳ |
| 用户旅程（万物灵智体锻造） | `architecture/user-journeys.md` | ⏳ |

### P0-6 design/ 子目录文件（4 份）

| 任务 | 文件 | 状态 |
|------|------|------|
| 命名契约（12 概念 + 双轨） | `design/naming-contract.md` | ⏳ |
| 控制台设计系统 | `design/console-design-system.md` | ⏳ |
| forgemind 品牌（万物灵智体形态视觉） | `design/forgemind-brand.md` | ⏳ |
| 动效设计 | `design/hero-prism-motion.md` | ⏳ |

### P0-7 perspectives/ 子目录文件（4 份）

| 任务 | 文件 | 状态 |
|------|------|------|
| operator 愿景视角 | `perspectives/operator-vision.md` | ⏳ |
| 架构师能力画像视角 | `perspectives/architect-capability.md` | ⏳ |
| 灵智体第一人称体验 | `perspectives/forgekin-experience.md` | ⏳ |
| 三方 Agent 厂商视角 | `perspectives/external-agent-vendor.md` | ⏳ |

### P0-8 旧文件迁移

| 任务 | 文件 | 状态 |
|------|------|------|
| spec.md 改为索引文件 | `spec.md` | ⏳ |
| arch.md 改为索引文件 | `arch.md` | ⏳ |
| design.md 改为索引文件 | `design.md` | ⏳ |
| test.md 归档到 archive/ | `test.md` → `archive/legacy_design/test.md` | ⏳ |

### P0-9 命名全局替换（铁律）

| 替换项 | 旧 → 新 | 范围 | 状态 |
|--------|---------|------|------|
| 炉灵 | 炉灵 → 灵智体 | 全部 .md 文件 | ⏳ |
| E6 灵匠 Mind Artisan | E6 灵匠 Mind Artisan → 灵智 ForgeMind（最终形态） | review.md + spec_face.md + arch_face.md | ⏳ |
| M18/M19/M20 | M18(SelfEvolutionEngine)/M19(MemoryGovernanceManager)/M20(FirstTouchRouter) → ForgeMindEngine（合并） | face/ 全部 + evolution/ 代码 | ⏳ |
| 养灵 | 养灵 → 育灵 | 全部 .md 文件 | ⏳ |
| 魂忆 | 魂忆 → 灵忆 | 全部 .md 文件 | ⏳ |
| 魂印 | 魂印 → 灵印 | 全部 .md 文件 | ⏳ |
| 自锻 | 自锻 → 灵锻 | 全部 .md 文件 | ⏳ |
| 火种 | 火种 → 进化阶 | 全部 .md 文件 | ⏳ |
| 升华阶 | 升华阶 → 觉醒阶 | 全部 .md 文件 | ⏳ |

---

## Phase 1：roleagent 七大工程路径代码骨架

> **目标**: 按 `roleagent.md` 七大工程路径实现代码骨架，作为 Build to Persist 复利型基础设施。
>
> **依赖**: P0-3 ADR-002/004/007/008/009/010/011、P0-4 F001/F002/F008-F025
>
> **验收标准**:
> - CapabilityProfile 可加载/查询盲点/计算 gap_analysis
> - TeamAct 状态机可跑六步循环 + 五项终止
> - Harness 七层（Durable State / Tool Mediation / Evidence / Governance / Magic Words / Entropy / Harnessability）骨架完整
> - 多域记忆联邦 MVP 可工作（grep + 检索入口 + 消费加权）
> - Eval Contract 五问可被任意 harness 组件实现
> - 分布式可靠性 Tier 1-4 恢复分级可被灵智体调用
> - 伙伴系统数学公式可计算（上限/下限/波动吸收）

### P1-1 能力画像代码（依赖 F001）

| 任务 | 文件 | 状态 |
|------|------|------|
| CapabilityProfile Pydantic 模型 | `flowforge/core/capability/profile.py` | ⏳ |
| CognitiveStyle / BlindSpot / SkillPackage | `flowforge/core/capability/models.py` | ⏳ |
| gap_analysis / has_blind_spot_conflict | `flowforge/core/capability/analyzer.py` | ⏳ |
| Profile YAML 加载器 | `flowforge/core/capability/loader.py` | ⏳ |
| 单元测试 | `tests/core/capability/test_profile.py` | ⏳ |

### P1-2 TeamAct 状态机代码（依赖 F002-F007）

| 任务 | 文件 | 状态 |
|------|------|------|
| TeamActStep 枚举 + TerminationCondition | `flowforge/core/teamact/types.py` | ⏳ |
| HandoffCapsule（交接胶囊） | `flowforge/core/teamact/handoff.py` | ⏳ |
| TeamActState 状态机 | `flowforge/core/teamact/state_machine.py` | ⏳ |
| PingPongCircuitBreaker 熔断器 | `flowforge/core/teamact/circuit_breaker.py` | ⏳ |
| 行首 @ 路由协议 | `flowforge/core/teamact/at_mention_router.py` | ⏳ |
| 持球注册 lease | `flowforge/core/teamact/ball_custody.py` | ⏳ |
| Push Back 协议 | `flowforge/core/teamact/push_back.py` | ⏳ |
| 单元测试 | `tests/core/teamact/test_state_machine.py` | ⏳ |

### P1-3 Harness 七层代码（依赖 F008-F013）

| 任务 | 文件 | 状态 |
|------|------|------|
| Durable State Surfaces（持久状态层） | `flowforge/core/harness/durable_state.py` | ⏳ |
| Tool Mediation（工具中介） | `flowforge/core/harness/tool_mediation.py` | ⏳ |
| Evidence & Sensors（验证证据） | `flowforge/core/harness/evidence_sensors.py` | ⏳ |
| Governance Boundary（治理边界，压缩免疫） | `flowforge/core/harness/governance.py` | ⏳ |
| Magic Words 逃生舱 | `flowforge/core/harness/magic_words.py` | ⏳ |
| Entropy Control 退役机制 | `flowforge/core/harness/entropy_control.py` | ⏳ |
| Harnessability 评估 | `flowforge/core/harness/harnessability.py` | ⏳ |
| 单元测试 | `tests/core/harness/test_durable_state.py` 等 7 份 | ⏳ |

### P1-4 多域记忆联邦代码（依赖 F014-F017、F039）

| 任务 | 文件 | 状态 |
|------|------|------|
| Collection（记忆集合） | `flowforge/core/memory/collection.py` | ⏳ |
| 三检索入口（grep / 语义 / 索引） | `flowforge/core/memory/retrieval_entries.py` | ⏳ |
| 记忆治理三要素 | `flowforge/core/memory/governance.py` | ⏳ |
| 消费加权排序 | `flowforge/core/memory/consumption_weighted.py` | ⏳ |
| 灵典 Mind Codex 可检索 | `flowforge/core/memory/mind_codex.py` | ⏳ |
| 单元测试 | `tests/core/memory/test_federation.py` | ⏳ |

### P1-5 Eval 自代谢代码（依赖 F018-F020、F040）

| 任务 | 文件 | 状态 |
|------|------|------|
| Eval Contract 五问 | `flowforge/core/eval/contract.py` | ⏳ |
| 三方信号交叉 | `flowforge/core/eval/three_signals.py` | ⏳ |
| 七类归因矩阵 | `flowforge/core/eval/attribution.py` | ⏳ |
| Harness Eval 控制面 | `flowforge/core/eval/control_plane.py` | ⏳ |
| Eval YAML 配置加载 | `flowforge/core/eval/loader.py` | ⏳ |
| 单元测试 | `tests/core/eval/test_attribution.py` | ⏳ |

### P1-6 分布式可靠性代码（依赖 F021-F025）

| 任务 | 文件 | 状态 |
|------|------|------|
| 副作用日志 WAL | `flowforge/core/reliability/side_effect_wal.py` | ⏳ |
| Tier 1-4 恢复分级 | `flowforge/core/reliability/tier_recovery.py` | ⏳ |
| liveness 规范读模型 | `flowforge/core/reliability/liveness.py` | ⏳ |
| 弱状态机 vs 强 workflow | `flowforge/core/reliability/state_workflow.py` | ⏳ |
| 跨 provider 宿主抽象 | `flowforge/core/reliability/provider_host.py` | ⏳ |
| 单元测试 | `tests/core/reliability/test_wal.py` | ⏳ |

### P1-7 伙伴系统数学代码（依赖 ADR-011）

| 任务 | 文件 | 状态 |
|------|------|------|
| 上限公式（候选路径最大值） | `flowforge/core/partnership/upper_bound.py` | ⏳ |
| 下限公式（多层门） | `flowforge/core/partnership/lower_bound.py` | ⏳ |
| 波动吸收（内部成本 vs 用户崩塌） | `flowforge/core/partnership/variance_absorption.py` | ⏳ |
| Token 账本 | `flowforge/core/partnership/token_ledger.py` | ⏳ |
| 单元测试 | `tests/core/partnership/test_math.py` | ⏳ |

### P1-8 Plugin V3 协议更新

| 任务 | 文件 | 状态 |
|------|------|------|
| register_forgekins 钩子 | `flowforge/core/plugin_protocol.py` | ⏳ |
| register_forge_skills 钩子 | `flowforge/core/plugin_protocol.py` | ⏳ |
| register_council_channels 钩子 | `flowforge/core/plugin_protocol.py` | ⏳ |
| register_auto_forge_config 钩子 | `flowforge/core/plugin_protocol.py` | ⏳ |
| 单元测试 | `tests/core/test_plugin_v3.py` | ⏳ |

### P1-9 rules.md / prompts.md 同步

| 任务 | 文件 | 状态 |
|------|------|------|
| rules.md 补充 v7.0 育灵体系 | `hiclaw/rules.md` | ⏳ |
| rules.md 补充 roleagent 工程路径引用 | `hiclaw/rules.md` | ⏳ |
| rules.md 补充 forgemind 模块引用 | `hiclaw/rules.md` | ⏳ |
| rules.md 补充 Plugin V3 四钩子 | `hiclaw/rules.md` | ⏳ |
| prompts.md 补充 v7.0 育灵提示词模板 | `hiclaw/prompts.md` | ⏳ |
| prompts.md 补充 roleagent 工程路径模板 | `hiclaw/prompts.md` | ⏳ |
| prompts.md 补充 forgemind 灵智体锻造模板 | `hiclaw/prompts.md` | ⏳ |

---

## Phase 2：forgemind 应用层骨架 + 万物灵智体形态分类

> **目标**: 在 `flowforge/forgemind/` 下实现万物灵智体应用层，承载 5 种形态分类（BioForgekin / OrgForgekin / ObjForgekin / VirtualForgekin / HybridForgekin）。
>
> **依赖**: P1 全部、P0-4 F026-F030、F036-F038
>
> **验收标准**:
> - `flowforge/forgemind/` 目录结构完整（species/ forging/ sensors/ worlds/ marketplace/ lineage/ codex/ council/ config/ tests/）
> - ForgekinBase 抽象类可被继承（observe/act/verify 三方法）
> - ForgePipeline 可执行锻造流程
> - ForgeMindPlugin 实现 Plugin V3 四钩子
> - 5 种形态枚举可加载
> - 进化阶（E1-E6）+ 觉醒阶（E1-E6）可查询
> - E2E 测试：可锻造一个猫灵智体（BioForgekin）+ 接入物理传感器（F029）

### P2-1 forgemind 模块骨架

| 任务 | 文件 | 状态 |
|------|------|------|
| forgemind/__init__.py | `flowforge/forgemind/__init__.py` | ⏳ |
| ForgekinSpecies 枚举 | `flowforge/forgemind/species.py` | ⏳ |
| EvolutionStage 进化阶 | `flowforge/forgemind/stages.py` | ⏳ |
| ForgekinBase 抽象类 | `flowforge/forgemind/base.py` | ⏳ |
| ForgekinFormData | `flowforge/forgemind/forms.py` | ⏳ |
| ForgePipeline 锻造流水线 | `flowforge/forgemind/forging/pipeline.py` | ⏳ |
| ForgeMindPlugin 插件 | `flowforge/forgemind/plugins.py` | ⏳ |
| 单元测试 | `flowforge/forgemind/tests/test_base.py` | ⏳ |

### P2-2 万物灵智体形态分类（5 种）

| 任务 | 文件 | 状态 |
|------|------|------|
| BioForgekin（生物灵智体） | `flowforge/forgemind/species/bio.py` | ⏳ |
| OrgForgekin（组织灵智体） | `flowforge/forgemind/species/org.py` | ⏳ |
| ObjForgekin（物品灵智体） | `flowforge/forgemind/species/obj.py` | ⏳ |
| VirtualForgekin（虚拟灵智体） | `flowforge/forgemind/species/virtual.py` | ⏳ |
| HybridForgekin（混合灵智体） | `flowforge/forgemind/species/hybrid.py` | ⏳ |
| E2E：猫灵智体锻造 | `flowforge/forgemind/tests/test_cat_forgekin.py` | ⏳ |

### P2-3 灵智体锻造流水线

| 任务 | 文件 | 状态 |
|------|------|------|
| 锻造阶段定义 | `flowforge/forgemind/forging/stages.py` | ⏳ |
| 锻造 YAML 配置 | `flowforge/forgemind/config/forging.yaml` | ⏳ |
| 锻造提示词外置 | `flowforge/forgemind/config/prompts.yaml` | ⏳ |
| 锻造指标定义 | `flowforge/forgemind/config/metrics.yaml` | ⏳ |

### P2-4 物理 AI 传感器接入

| 任务 | 文件 | 状态 |
|------|------|------|
| 传感器抽象层 | `flowforge/forgemind/sensors/base.py` | ⏳ |
| 摄像头传感器 | `flowforge/forgemind/sensors/camera.py` | ⏳ |
| 麦克风传感器 | `flowforge/forgemind/sensors/microphone.py` | ⏳ |
| IoT 传感器接入 | `flowforge/forgemind/sensors/iot.py` | ⏳ |
| 单元测试 | `flowforge/forgemind/tests/test_sensors.py` | ⏳ |

### P2-5 虚拟世界设定层

| 任务 | 文件 | 状态 |
|------|------|------|
| 世界设定抽象 | `flowforge/forgemind/worlds/base.py` | ⏳ |
| VR/游戏世界适配 | `flowforge/forgemind/worlds/vr.py` | ⏳ |
| 童话/神话/历史角色适配 | `flowforge/forgemind/worlds/narrative.py` | ⏳ |
| 单元测试 | `flowforge/forgemind/tests/test_worlds.py` | ⏳ |

### P2-6 灵智体市场 + 进化谱系

| 任务 | 文件 | 状态 |
|------|------|------|
| Marketplace 抽象 | `flowforge/forgemind/marketplace/base.py` | ⏳ |
| 灵智体上架/下架 | `flowforge/forgemind/marketplace/registry.py` | ⏳ |
| 进化谱系（Lineage） | `flowforge/forgemind/lineage/tree.py` | ⏳ |
| 谱系可视化数据 | `flowforge/forgemind/lineage/visualizer.py` | ⏳ |
| 单元测试 | `flowforge/forgemind/tests/test_lineage.py` | ⏳ |

### P2-7 forgemind 与 *Forge 关系

| 任务 | 文件 | 状态 |
|------|------|------|
| *Forge 灵智体注册接口 | `flowforge/forgemind/forge_registry.py` | ⏳ |
| ContentForge 灵智体适配 | `contentforge/forgekin_adapter.py` | ⏳ |
| NovelForge 灵智体适配 | `novelforge/forgekin_adapter.py` | ⏳ |
| DevForge 灵智体适配 | `devforge/forgekin_adapter.py` | ⏳ |
| MallForge 灵智体适配 | `mallforge/forgekin_adapter.py` | ⏳ |

---

## Phase 3：三方 Agent 适配层

> **目标**: 实现 ExternalAgentAdapter 抽象层，让灵智体可接入 claude code / codex / opencode / trae 等三方 Agent，作为能力扩展。
>
> **依赖**: P1 全部、P2-1、P0-4 F031-F035
>
> **验收标准**:
> - 4 个三方 Agent Adapter 全部可调用（claude code / codex / opencode / trae）
> - ExternalAgentBridge 可执行 fallback 链
> - ExternalAgentSharedState 可与 FlowForge 共享状态同步
> - ExternalAgentCapabilityFusion 可融合三方 Agent 能力到灵智体画像
> - 六层 Guardrails 全部启用（输入验证 + 系统提示 + 工具白名单 + 输出验证 + 操作确认 + 成本上限）
> - E2E 测试：灵智体可调用 claude code 完成代码任务

### P3-1 三方 Agent 核心抽象

| 任务 | 文件 | 状态 |
|------|------|------|
| ExternalAgentAdapter 抽象类 | `flowforge/core/external_agent/adapter.py` | ⏳ |
| ExternalAgentBridge 桥接层 | `flowforge/core/external_agent/bridge.py` | ⏳ |
| ExternalAgentSharedState 状态共享 | `flowforge/core/external_agent/shared_state.py` | ⏳ |
| ExternalAgentFallback 失败回退 | `flowforge/core/external_agent/fallback.py` | ⏳ |
| ExternalAgentCapabilityFusion 能力融合 | `flowforge/core/external_agent/capability_fusion.py` | ⏳ |
| 单元测试 | `tests/core/external_agent/test_bridge.py` | ⏳ |

### P3-2 四个具体 Adapter

| 任务 | 文件 | 状态 |
|------|------|------|
| Claude Code Adapter | `flowforge/core/external_agent/adapters/claude_code.py` | ⏳ |
| Codex Adapter | `flowforge/core/external_agent/adapters/codex.py` | ⏳ |
| OpenCode Adapter | `flowforge/core/external_agent/adapters/opencode.py` | ⏳ |
| Trae Adapter | `flowforge/core/external_agent/adapters/trae.py` | ⏳ |
| E2E 测试 | `tests/core/external_agent/test_adapters_e2e.py` | ⏳ |

### P3-3 三方 Agent 配置外置

| 任务 | 文件 | 状态 |
|------|------|------|
| Adapter YAML 配置 | `flowforge/core/external_agent/config/adapters.yaml` | ⏳ |
| 提示词外置 | `flowforge/core/external_agent/config/prompts.yaml` | ⏳ |
| fallback 链配置 | `flowforge/core/external_agent/config/fallback.yaml` | ⏳ |
| 工具白名单配置 | `flowforge/core/external_agent/config/tool_allowlist.yaml` | ⏳ |

### P3-4 六层 Guardrails 实现

| 任务 | 文件 | 状态 |
|------|------|------|
| 输入验证 | `flowforge/core/external_agent/guardrails/input_validation.py` | ⏳ |
| 系统提示约束 | `flowforge/core/external_agent/guardrails/system_prompt.py` | ⏳ |
| 工具白名单 | `flowforge/core/external_agent/guardrails/tool_allowlist.py` | ⏳ |
| 输出验证 | `flowforge/core/external_agent/guardrails/output_validation.py` | ⏳ |
| 操作确认（不可逆） | `flowforge/core/external_agent/guardrails/action_confirm.py` | ⏳ |
| 成本上限 | `flowforge/core/external_agent/guardrails/cost_ceiling.py` | ⏳ |

### P3-5 worktree 隔离机制

| 任务 | 文件 | 状态 |
|------|------|------|
| worktree 隔离 | `flowforge/core/external_agent/worktree.py` | ⏳ |
| 跨 worktree 共享状态同步 | `flowforge/core/external_agent/sync.py` | ⏳ |

---

## Phase 4：Eval 自代谢 + 分布式可靠性

> **目标**: 实现 Eval Contract + 七类归因 + Tier 1-4 恢复 + liveness 规范读模型，让 harness 能自我代谢。
>
> **依赖**: P1-5、P1-6
>
> **验收标准**:
> - Eval Contract 五问可被任意 harness 组件实现（F018）
> - 三方信号（trace + 人 + 自动）可交叉验证（F019）
> - 七类归因矩阵可定位失败根因（F020）
> - Tier 1-4 恢复分级可被灵智体调用（F022）
> - liveness 规范读模型可被任何 agent 查询（F023）
> - Harness Eval 控制面可每日汇总（F040）
> - Build to Delete sunset 计时器可触发（F012）

### P4-1 Eval Contract 完整实现

| 任务 | 文件 | 状态 |
|------|------|------|
| 五问 Schema 定义 | `flowforge/core/eval/contract.py` | ⏳ |
| Eval 域 YAML 配置 | `flowforge/config/eval/*.yaml` | ⏳ |
| Eval 结果采集 | `flowforge/core/eval/collector.py` | ⏳ |
| Eval 裁决记录 | `flowforge/core/eval/verdict.py` | ⏳ |

### P4-2 三方信号交叉 + 七类归因

| 任务 | 文件 | 状态 |
|------|------|------|
| trace 信号采集 | `flowforge/core/eval/trace_signal.py` | ⏳ |
| 人信号采集 | `flowforge/core/eval/human_signal.py` | ⏳ |
| 自动信号采集 | `flowforge/core/eval/auto_signal.py` | ⏳ |
| 交叉验证算法 | `flowforge/core/eval/cross_validation.py` | ⏳ |
| 七类归因实现 | `flowforge/core/eval/attribution.py` | ⏳ |

### P4-3 Tier 1-4 恢复 + liveness

| 任务 | 文件 | 状态 |
|------|------|------|
| Tier 1（自动恢复） | `flowforge/core/reliability/tier1_auto.py` | ⏳ |
| Tier 2（带状态恢复） | `flowforge/core/reliability/tier2_stateful.py` | ⏳ |
| Tier 3（人工确认） | `flowforge/core/reliability/tier3_human.py` | ⏳ |
| Tier 4（不可恢复） | `flowforge/core/reliability/tier4_fatal.py` | ⏳ |
| liveness 规范读模型 | `flowforge/core/reliability/liveness.py` | ⏳ |

### P4-4 Build to Delete sunset 计时器

| 任务 | 文件 | 状态 |
|------|------|------|
| sunset 计时器 | `flowforge/core/harness/sunset_timer.py` | ⏳ |
| 紧急修复标签检测 | `flowforge/core/harness/hotfix_detector.py` | ⏳ |
| 两周强制 review | `flowforge/core/harness/sunset_review.py` | ⏳ |

### P4-5 Harness Eval 控制面

| 任务 | 文件 | 状态 |
|------|------|------|
| 控制面 API | `flowforge/core/eval/control_plane.py` | ⏳ |
| 每日汇总任务 | `flowforge/core/eval/daily_summary.py` | ⏳ |
| 仪表盘数据 | `flowforge/core/eval/dashboard.py` | ⏳ |

---

## Phase 5：伙伴系统数学 + 自我演进闭环

> **目标**: 实现伙伴系统数学公式 + 文档/代码/框架三层自我演进闭环。
>
> **依赖**: P1-7、P4 全部
>
> **验收标准**:
> - 上限/下限/波动吸收公式可计算
> - Token 账本可统计单 agent vs 团队成本
> - 文档自我演进：Feature 完成后自动更新文档
> - 代码自我演进：Eval 触发 sunset review 后自动重构
> - 框架自我演进：ForgekinEngine 根据运行数据优化路由策略
> - "自己开发自己"闭环可跑通（review.md §12.3.2 11 步流程）

### P5-1 伙伴系统数学完整实现

| 任务 | 文件 | 状态 |
|------|------|------|
| 上限公式（候选路径最大值） | `flowforge/core/partnership/upper_bound.py` | ⏳ |
| 下限公式（多层门） | `flowforge/core/partnership/lower_bound.py` | ⏳ |
| 波动吸收 | `flowforge/core/partnership/variance_absorption.py` | ⏳ |
| Token 账本 | `flowforge/core/partnership/token_ledger.py` | ⏳ |
| 双层语言（内部高密度 + 外部讲人话） | `flowforge/core/partnership/dual_language.py` | ⏳ |
| 最小必要复杂度计算 | `flowforge/core/partnership/min_complexity.py` | ⏳ |

### P5-2 文档自我演进

| 任务 | 文件 | 状态 |
|------|------|------|
| Feature 文档自动更新 | `flowforge/core/evolution/doc_evolution.py` | ⏳ |
| ADR 自动生成 | `flowforge/core/evolution/adr_generator.py` | ⏳ |
| Eval 结果归档 | `flowforge/core/evolution/verdict_archiver.py` | ⏳ |
| 文档自我演进 SOP | `docs/SOP.md`（更新） | ⏳ |

### P5-3 代码自我演进

| 任务 | 文件 | 状态 |
|------|------|------|
| Feature → 代码骨架生成器 | `flowforge/core/evolution/code_skeleton.py` | ⏳ |
| Eval 信号 → harness 重构 | `flowforge/core/evolution/harness_refactor.py` | ⏳ |
| 七类归因 → Bug 自动修复 | `flowforge/core/evolution/bug_fixer.py` | ⏳ |

### P5-4 框架自我演进

| 任务 | 文件 | 状态 |
|------|------|------|
| ForgekinEngine 路由优化 | `flowforge/core/evolution/route_optimizer.py` | ⏳ |
| TeamAct 终止条件优化 | `flowforge/core/evolution/termination_optimizer.py` | ⏳ |
| 记忆联邦权威等级调整 | `flowforge/core/evolution/memory_ranker.py` | ⏳ |

### P5-5 "自己开发自己"闭环

| 任务 | 文件 | 状态 |
|------|------|------|
| 11 步闭环编排器 | `flowforge/core/evolution/self_dev_loop.py` | ⏳ |
| 灵智体 A-G 角色定义 | `flowforge/core/evolution/roles.py` | ⏳ |
| 闭环 E2E 测试 | `tests/core/evolution/test_self_dev_loop.py` | ⏳ |

---

## Phase 6：灵锻 SpiritForge + 灵议 Mind Council

> **目标**: 实现 E4+ Evoling 状态 + 多灵智体议事机制。
>
> **依赖**: P5 全部
>
> **验收标准**:
> - 灵锻 SpiritForge 可在低活动期蒸馏经验到灵典 Mind Codex
> - 灵议 Mind Council 可召集多灵智体议事
> - E4+ Evoling 状态可触发（觉醒阶 ≥ E4）
> - 灵议决议可写入 VISION.md / ROADMAP.md
> - operator 拉闸词可在灵议偏离愿景时制动

### P6-1 灵锻 SpiritForge

| 任务 | 文件 | 状态 |
|------|------|------|
| 灵锻引擎 | `flowforge/forgemind/codex/spirit_forge.py` | ⏳ |
| 经验蒸馏 | `flowforge/forgemind/codex/distiller.py` | ⏳ |
| 灵典写入 | `flowforge/forgemind/codex/mind_codex_writer.py` | ⏳ |
| 每日低活动期调度 | `flowforge/forgemind/codex/scheduler.py` | ⏳ |

### P6-2 灵议 Mind Council

| 任务 | 文件 | 状态 |
|------|------|------|
| 灵议引擎 | `flowforge/forgemind/council/engine.py` | ⏳ |
| 多灵智体议事协议 | `flowforge/forgemind/council/protocol.py` | ⏳ |
| 决议写入机制 | `flowforge/forgemind/council/resolution.py` | ⏳ |
| operator 拉闸词检测 | `flowforge/forgemind/council/cvo_brake.py` | ⏳ |

### P6-3 E4+ Evoling 状态

| 任务 | 文件 | 状态 |
|------|------|------|
| Evoling 状态触发条件 | `flowforge/forgemind/stages.py`（更新） | ⏳ |
| Evoling 行为定义 | `flowforge/forgemind/stages/evoling.py` | ⏳ |

---

## 横向任务（跨 Phase）

### H-1 hiclaw/rules.md 同步更新

| 任务 | 文件 | 状态 |
|------|------|------|
| 第十部分补充 v7.0 育灵体系 | `hiclaw/rules.md` | ⏳ |
| 引用 roleagent.md 工程路径 | `hiclaw/rules.md` | ⏳ |
| 引用 forgemind 模块 | `hiclaw/rules.md` | ⏳ |
| Plugin V3 四钩子规范 | `hiclaw/rules.md` | ⏳ |
| 命名融合方案（ForgeMind 主名） | `hiclaw/rules.md` | ⏳ |

### H-2 hiclaw/prompts.md 同步更新

| 任务 | 文件 | 状态 |
|------|------|------|
| 新增 P41 万物灵智体锻造模板 | `hiclaw/prompts.md` | ⏳ |
| 新增 P42 能力画像生成模板 | `hiclaw/prompts.md` | ⏳ |
| 新增 P43 TeamAct 协作模板 | `hiclaw/prompts.md` | ⏳ |
| 新增 P44 三方 Agent 调用模板 | `hiclaw/prompts.md` | ⏳ |
| 新增 P45 灵锻 SpiritForge 模板 | `hiclaw/prompts.md` | ⏳ |
| 新增 P46 灵议 Mind Council 模板 | `hiclaw/prompts.md` | ⏳ |
| 新增 FF22 forgemind 集成验证 | `hiclaw/prompts.md` | ⏳ |
| 新增 FF23 三方 Agent 集成验证 | `hiclaw/prompts.md` | ⏳ |

### H-3 旧文档归档

| 任务 | 文件 | 状态 |
|------|------|------|
| face/ 添加 README（v7.0 Phase 0 标注） | `docs/face/README.md` | ⏳ |
| archive/ 添加 README | `docs/archive/README.md` | ⏳ |

### H-4 测试铁律执行

| 任务 | 文件 | 状态 |
|------|------|------|
| 所有 E2E 测试遵守 T1-T8 铁律 | `tests/` 全部 | ⏳ |
| 所有测试用真实 LLM（禁 Mock） | `tests/` 全部 | ⏳ |
| 所有 LLM 生成内容必须经 LLM 审核（T7） | `tests/` 全部 | ⏳ |
| Web 功能必须操控浏览器验证 DOM（T8） | `tests/` 全部 | ⏳ |

---

## 执行规则

### R1 任务领取规则
- 灵智体按所属 Phase 领取任务
- 一个灵智体同时只能持有一个任务（ball custody lease，F006）
- 持球超时（默认 30 分钟）自动释放，其他灵智体可接手

### R2 任务完成规则
- 任务完成必须通过 TeamAct 五项终止条件（F002）
- 必须有 commit + 测试 + trace 作为证据（F009）
- 必须有跨厂商 review（非作者 agent 确认）
- 必须更新本文档状态标记

### R3 任务阻塞规则
- 任务依赖未完成时，标记为 🚫 阻塞
- 阻塞任务不可领取
- 阻塞超过 24 小时升级到 operator

### R4 文档同步规则
- 每完成一个 Feature，更新 `features/F0XX.md` 状态
- 每完成一个 ADR，更新 `decisions/README.md` 清单
- 每完成一个 Phase，更新 `ROADMAP.md` 状态

### R5 自我演进规则
- 灵智体在执行任务过程中发现的新经验，写入 `TIPS.md`
- 灵智体发现的设计缺陷，写入 `harness-feedback/verdicts/`
- 灵智体发现的愿景缺口，升级到 operator（不自行修改 `VISION.md`）

---

## 文档变更历史

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-07-17 | 初版：基于 review.md §12.4 重写，覆盖 Phase 0-6 全部任务 | Trae CN（agent） |
| v1.1 | 2026-07-17 | 补充横向任务 H-1/H-2（rules.md / prompts.md 同步） | Trae CN（agent） |

---

> **下一步建议**:
> 1. operator 审核本 task.md，确认 Phase 0-6 任务清单完整性
> 2. 进入 Phase 1，按 P1-1 → P1-2 → P1-3 顺序实现代码骨架
> 3. Phase 1 完成后，进入 Phase 2 forgemind 应用层实现
> 4. 横向任务 H-1/H-2 应与 Phase 1 并行推进（rules.md / prompts.md 同步）
