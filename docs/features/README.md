# Feature 规格文档

> **目录作用**: 存放 FlowForge Feature 规格文档（F001-F040），每个 Feature 记录一个独立功能的上下文、决策、接口、验收标准
> **维护规则**: 新增 Feature 时复制 `TEMPLATE.md` 到 `F{NNN}-{slug}.md`

---

## Feature 编号规则

- 格式：`F{NNN}-{slug}.md`（NNN 三位数字递增，slug 用英文短横线分隔）
- 稳定性：已发布编号不重排、不复用
- 状态：`spec` → `in-progress` → `done`

---

## P0 核心 Feature（4 份，✅ 已完成）

| Feature | 标题 | 状态 | 文件 |
|---------|------|------|------|
| F001 | 能力画像 CapabilityProfile | ✅ | `[doc:features/F001-capability-profile.md]` |
| F002 | TeamAct 六步循环 | ✅ | `[doc:features/F002-teamact-loop.md]` |
| F026 | forgemind 应用层 | ✅ | `[doc:features/F026-forgemind-app-layer.md]` |
| F031 | 三方 Agent 适配层 | ✅ | `[doc:features/F031-external-agent-adapter.md]` |

---

## P1 七大工程路径 Feature（23 份，✅ 已完成）

> P1 Feature 对应 Phase 1 代码实现，为追溯性规格记录（代码先行、Feature 追溯补齐）。
> 全部基于 `flowforge/core/` 下真实代码提取接口，术语对齐 ADR-012。

### TeamAct 子 Feature（F003-F007，5 份）
> 依赖 ADR-002，参考代码 `flowforge/core/teamact/`

| Feature | 标题 | 状态 | 文件 |
|---------|------|------|------|
| F003 | 交接胶囊 Handoff Capsule | ✅ | `[doc:features/F003-handoff-capsule.md]` |
| F004 | @mention 路由 AtMention Router | ✅ | `[doc:features/F004-at-mention-router.md]` |
| F005 | 球权租借 Ball Custody Lease | ✅ | `[doc:features/F005-ball-custody-lease.md]` |
| F006 | 推回协议 Push Back Protocol | ✅ | `[doc:features/F006-push-back-protocol.md]` |
| F007 | 乒乓球熔断器 PingPong Circuit Breaker | ✅ | `[doc:features/F007-pingpong-circuit-breaker.md]` |

### Harness 七层 Feature（F008-F013，6 份）
> 依赖 ADR-007，参考代码 `flowforge/core/harness/`
> 说明：F013 合并熵控制（Layer 6）+ 可驾驭性评分（Layer 7），因两者紧密相关——熵控制器产生 artifact 状态信号，可驾驭性评分器基于这些信号 + 其他 5 维信号打分。

| Feature | 标题 | 状态 | 文件 |
|---------|------|------|------|
| F008 | 持久状态表面 Durable State Surface | ✅ | `[doc:features/F008-durable-state-surface.md]` |
| F009 | 工具中介 Tool Mediation | ✅ | `[doc:features/F009-tool-mediation.md]` |
| F010 | 证据传感器 Evidence Sensors | ✅ | `[doc:features/F010-evidence-sensors.md]` |
| F011 | 治理边界 Governance Boundary | ✅ | `[doc:features/F011-governance-boundary.md]` |
| F012 | Magic Words 逃生舱 | ✅ | `[doc:features/F012-magic-words.md]` |
| F013 | 熵控制 + 可驾驭性评分 Entropy + Harnessability | ✅ | `[doc:features/F013-entropy-harnessability.md]` |

### 多域记忆联邦 Feature（F014-F017，4 份）
> 依赖 ADR-008，参考代码 `flowforge/core/memory/`
> 说明：F017 合并记忆治理 + 灵典 MindCodex，因灵典是治理保护的对象，二者在同一模块下紧密耦合。

| Feature | 标题 | 状态 | 文件 |
|---------|------|------|------|
| F014 | 记忆收集 + 多域存储 Memory Collection | ✅ | `[doc:features/F014-memory-collection.md]` |
| F015 | 三检索入口 Retrieval Entries | ✅ | `[doc:features/F015-retrieval-entries.md]` |
| F016 | 消费加权评分 Consumption Weighted | ✅ | `[doc:features/F016-consumption-weighted.md]` |
| F017 | 记忆治理 + 灵典 Memory Governance + MindCodex | ✅ | `[doc:features/F017-memory-governance-mind-codex.md]` |

### Eval 自代谢 Feature（F018-F020，3 份）
> 依赖 ADR-009，参考代码 `flowforge/core/eval/`

| Feature | 标题 | 状态 | 文件 |
|---------|------|------|------|
| F018 | Eval Contract 五问 | ✅ | `[doc:features/F018-eval-contract.md]` |
| F019 | 三方信号交叉验证 Three Signals | ✅ | `[doc:features/F019-three-signals.md]` |
| F020 | 七类归因矩阵 Attribution Matrix | ✅ | `[doc:features/F020-attribution-matrix.md]` |

### 分布式可靠性 Feature（F021-F025，5 份）
> 依赖 ADR-010，参考代码 `flowforge/core/reliability/`

| Feature | 标题 | 状态 | 文件 |
|---------|------|------|------|
| F021 | 副作用预写日志 Side-Effect WAL | ✅ | `[doc:features/F021-side-effect-wal.md]` |
| F022 | Tier 1-4 恢复分级 Tiered Recovery | ✅ | `[doc:features/F022-tier-recovery.md]` |
| F023 | Liveness 规范读 Liveness Probe | ✅ | `[doc:features/F023-liveness-probe.md]` |
| F024 | Weak State vs Strong Workflow | ✅ | `[doc:features/F024-state-workflow-comparator.md]` |
| F025 | Provider Host 抽象 | ✅ | `[doc:features/F025-provider-host.md]` |

---

## 完整 Feature 清单（F001-F040）

### 已完成（27 份 ✅）

| 范围 | 标题 | 数量 | 状态 |
|------|------|:----:|:----:|
| F001-F002 | 能力画像 + TeamAct 主循环 | 2 | ✅ |
| F003-F007 | TeamAct 子 Feature | 5 | ✅ |
| F008-F013 | Harness 七层 | 6 | ✅ |
| F014-F017 | 多域记忆联邦 | 4 | ✅ |
| F018-F020 | Eval 自代谢 | 3 | ✅ |
| F021-F025 | 分布式可靠性 | 5 | ✅ |
| F026 | forgemind 应用层 | 1 | ✅ |
| F031 | 三方 Agent 适配层 | 1 | ✅ |

### 待创建（13 份 ⏳，Phase 2-6 视进度补齐）

| 范围 | 标题 | 依赖 ADR | 优先级 |
|------|------|---------|--------|
| F027-F030 | 万物灵智体形态分类（5 形态 + 物理 AI 传感器 + 虚拟世界设定层 + 进化谱系） | ADR-013 | Phase 2 启动前 |
| F028 | 灵智体锻造流水线 | ADR-005 | Phase 2 |
| F032-F035 | 三方 Agent 子 Feature（Adapter / Bridge / SharedState / Fallback / CapabilityFusion） | ADR-006 | Phase 3 |
| F036-F038 | forgemind 高级 Feature（市场 / 谱系 / council） | ADR-005 | Phase 2-6 |
| F040 | Harness Eval 控制面 | ADR-009 | Phase 4 |

> **说明**：F039 灵典可检索知识库已合并入 F017（记忆治理 + 灵典 MindCodex），F039 编号保留不复用但不再单独创建。

---

## Feature 文档模板

详见 `[doc:features/TEMPLATE.md]`

---

## 延伸阅读

- `[doc:features/TEMPLATE.md]` — Feature 文档模板
- `[doc:task.md#P0-6]` — P0 Feature 任务清单
- `[doc:decisions/README.md]` — ADR 清单
- `[doc:roleagent.md]` — 七大工程路径白皮书
