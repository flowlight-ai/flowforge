# FlowForge Feature 规格

> **文档编号**: features/README.md（v1.1）
> **依据**: `[doc:review/review.md#12.1]` 文档拆分目标结构
> **参考**: 标准 Feature 目录结构（已归档，F001-F255）

---

## 1. Feature 规范

每个 Feature 是一个独立的可演进单元，对应 roleagent.md 中的"Feature 规格"。**单文件 < 50KB**，Forgekin可在单次任务中完整重写。

### 1.1 Feature 文件命名

```
F0XX-kebab-case-name.md
```

示例：
- `F001-capability-profile.md`
- `F026-forgemind-app-layer.md`
- `F031-external-agent-adapter.md`

### 1.2 Feature 编号规则

| 编号范围 | 类别 | 依据 |
|---------|------|------|
| F001-F007 | TeamAct 协作 | RA-009~RA-016 |
| F008-F013 | Harness 七层 | RA-017~RA-023 |
| F014-F017 | 多域记忆 | RA-024~RA-030 |
| F018-F020 | Eval 自代谢 | RA-031~RA-036 |
| F021-F025 | 分布式可靠性 | RA-037~RA-042 |
| F026-F030 | forgemind 应用层 | FM-001~FM-012 |
| F031-F035 | 三方 Agent 集成 | EX-001~EX-010 |
| F036-F040 | 其他 | — |
| F041-F044 | 可进化智能体（4 种组织角色） | FM-013~FM-016 |

### 1.3 Feature 模板

详见 [TEMPLATE.md](TEMPLATE.md)。

---

## 2. Feature 清单（44 份核心 Feature）

### 2.1 TeamAct 协作（F001-F007）

| Feature | 标题 | 状态 | 依据 |
|---------|------|:----:|------|
| [F001-capability-profile.md](F001-capability-profile.md) | 能力画像 | ⏳ | RA-001~RA-008 |
| [F002-teamact-loop.md](F002-teamact-loop.md) | TeamAct 六步循环 | ⏳ | RA-009~RA-016 |
| [F003-handoff-capsule.md](F003-handoff-capsule.md) | 交接胶囊 | ⏳ | RA-011 |
| [F004-pingpong-circuit-breaker.md](F004-pingpong-circuit-breaker.md) | 乒乓球熔断器 | ⏳ | RA-012 |
| [F005-at-mention-routing.md](F005-at-mention-routing.md) | 行首 @ 路由 | ⏳ | RA-013 |
| [F006-ball-custody-lease.md](F006-ball-custody-lease.md) | 持球注册 lease | ⏳ | RA-014 |
| [F007-push-back-protocol.md](F007-push-back-protocol.md) | Generator Push Back | ⏳ | RA-015 |

### 2.2 Harness 七层（F008-F013）

| Feature | 标题 | 状态 | 依据 |
|---------|------|:----:|------|
| [F008-durable-state-surfaces.md](F008-durable-state-surfaces.md) | Durable State Surfaces | ⏳ | RA-017 |
| [F009-evidence-sensors.md](F009-evidence-sensors.md) | Evidence & Sensors | ⏳ | RA-018 |
| [F010-governance-boundary.md](F010-governance-boundary.md) | Governance 压缩免疫 | ⏳ | RA-019 |
| [F011-magic-words.md](F011-magic-words.md) | Magic Words 逃生舱 | ⏳ | RA-020 |
| [F012-entropy-control.md](F012-entropy-control.md) | Entropy Control 退役 | ⏳ | RA-021 |
| [F013-harnessability.md](F013-harnessability.md) | Harnessability 评估 | ⏳ | RA-022 |

### 2.3 多域记忆（F014-F017）

| Feature | 标题 | 状态 | 依据 |
|---------|------|:----:|------|
| [F014-memory-collection.md](F014-memory-collection.md) | 多域记忆 Collection | ⏳ | RA-024 |
| [F015-three-retrieval-entry.md](F015-three-retrieval-entry.md) | 三检索入口 | ⏳ | RA-025 |
| [F016-memory-governance.md](F016-memory-governance.md) | 记忆治理三要素 | ⏳ | RA-026 |
| [F017-consumption-weighted-ranking.md](F017-consumption-weighted-ranking.md) | 消费加权排序 | ⏳ | RA-027 |

### 2.4 Eval 自代谢（F018-F020）

| Feature | 标题 | 状态 | 依据 |
|---------|------|:----:|------|
| [F018-eval-contract.md](F018-eval-contract.md) | Eval Contract 五问 | ⏳ | RA-032 |
| [F019-three-signal-cross.md](F019-three-signal-cross.md) | 三方信号交叉 | ⏳ | RA-033 |
| [F020-seven-attribution.md](F020-seven-attribution.md) | 七类归因矩阵 | ⏳ | RA-034 |

### 2.5 分布式可靠性（F021-F025）

| Feature | 标题 | 状态 | 依据 |
|---------|------|:----:|------|
| [F021-side-effect-wal.md](F021-side-effect-wal.md) | 副作用日志 WAL | ⏳ | RA-037 |
| [F022-tier-1-4-recovery.md](F022-tier-1-4-recovery.md) | Tier 1-4 恢复分级 | ⏳ | RA-038 |
| [F023-liveness-canonical-read.md](F023-liveness-canonical-read.md) | liveness 规范读模型 | ⏳ | RA-039 |
| [F024-weak-state-vs-strong-workflow.md](F024-weak-state-vs-strong-workflow.md) | 弱状态机 vs 强 workflow | ⏳ | RA-040 |
| [F025-provider-host-abstraction.md](F025-provider-host-abstraction.md) | 跨 provider 宿主抽象 | ⏳ | RA-041 |

### 2.6 forgemind 应用层（F026-F030）

| Feature | 标题 | 状态 | 依据 |
|---------|------|:----:|------|
| [F026-forgemind-app-layer.md](F026-forgemind-app-layer.md) | forgemind 应用层 | ⏳ | FM-001~FM-012 |
| [F027-all-things-spirit-species.md](F027-all-things-spirit-species.md) | 可进化智能体形态分类 | ⏳ | FM-003 |
| [F028-forging-pipeline.md](F028-forging-pipeline.md) | Forgekin锻造流水线 | ⏳ | FM-006 |
| [F029-physical-ai-sensors.md](F029-physical-ai-sensors.md) | 物理 AI 传感器接入 | ⏳ | FM-009 |
| [F030-virtual-world-setting.md](F030-virtual-world-setting.md) | 虚拟世界设定层 | ⏳ | FM-010 |

### 2.7 三方 Agent 集成（F031-F035）

| Feature | 标题 | 状态 | 依据 |
|---------|------|:----:|------|
| [F031-external-agent-adapter.md](F031-external-agent-adapter.md) | 三方 Agent 适配层 | ⏳ | EX-003 |
| [F032-external-agent-profile.md](F032-external-agent-profile.md) | 三方 Agent 能力画像 | ⏳ | EX-002 |
| [F033-external-agent-shared-state.md](F033-external-agent-shared-state.md) | 三方 Agent 状态共享 | ⏳ | EX-004 |
| [F034-external-agent-fallback.md](F034-external-agent-fallback.md) | 三方 Agent 失败回退 | ⏳ | EX-007 |
| [F035-external-agent-capability-fusion.md](F035-external-agent-capability-fusion.md) | 三方 Agent 能力融合 | ⏳ | EX-010 |

### 2.8 其他（F036-F040）

| Feature | 标题 | 状态 | 依据 |
|---------|------|:----:|------|
| [F036-forgemind-forge-relationship.md](F036-forgemind-forge-relationship.md) | forgemind 与 *Forge 关系 | ⏳ | FM-005 |
| [F037-forgemind-marketplace.md](F037-forgemind-marketplace.md) | Forgekin市场 | ⏳ | FM-007 |
| [F038-forgemind-lineage.md](F038-forgemind-lineage.md) | Forgekin进化谱系 | ⏳ | FM-008 |
| [F039-mind-codex-searchable.md](F039-mind-codex-searchable.md) | MindCodex可检索知识库 | ⏳ | RA-029 |
| [F040-harness-eval-control-plane.md](F040-harness-eval-control-plane.md) | Harness Eval 控制面 | ⏳ | RA-036 |

### 2.9 可进化智能体（F041-F044）

> 4 种组织形态可进化智能体（OrgForgekin），从 design.md §2.7 提取。每种智能体有独立代号 + 5 种 action.type + 觉醒阶上限 + 进化阶路径。

| Feature | 标题 | 状态 | 依据 | 代号 |
|---------|------|:----:|------|------|
| [F041-product-manager.md](F041-product-manager.md) | 产品经理可进化智能体 | ⏳ | FM-013 | 鹰·凯恩（Eagle Kane） |
| [F042-devops.md](F042-devops.md) | 运维可进化智能体 | ⏳ | FM-014 | 蜂鸟·闪电（Hummingbird Flash） |
| [F043-security-officer.md](F043-security-officer.md) | 安全官可进化智能体 | ⏳ | FM-015 | 狼·阿尔法（Wolf Alpha） |
| [F044-delivery-manager.md](F044-delivery-manager.md) | 交付经理可进化智能体 | ⏳ | FM-016 | 象·牛顿（Elephant Newton） |

---

## 3. Feature 状态定义

| 状态 | 含义 |
|------|------|
| ⏳ pending | 未开始 |
| 🔄 in_progress | 开发中 |
| ✅ done | 已完成并通过 Eval |
| ❌ deprecated | 已废弃 |
| 🚫 blocked | 被阻塞（需依赖解决） |

---

## 4. Feature 生命周期

```
1. operator / 架构师提出 Feature 需求
   ↓
2. 创建 F0XX-xxx.md（基于 TEMPLATE.md）
   ↓
3. 评审员Forgekin review Feature 规格
   ↓
4. 开发者 Forgekin实现代码骨架
   ↓
5. 测试员Forgekin执行 E2E 测试（T1-T8）
   ↓
6. Eval 员Forgekin归因到七类矩阵
   ↓
7. 若 Eval 通过 → 状态改为 ✅ done
   若 Eval 失败 → 回到步骤 4 修复
   ↓
8. 文档员Forgekin更新 F0XX.md + ROADMAP.md
   ↓
9. SpiritForge 经验蒸馏到 MindCodex（蒸馏知识库）
```

---

## 5. Feature 自我演进

Feature 文档可由Forgekin自我演进更新，但必须：
1. 通过 Eval 信号触发（不能主动修改）
2. 保留 `[doc:引用]` 格式
3. 单文件 < 50KB
4. 不违反 `[doc:VISION.md#7]` operator 愿景锚点
5. 不修改 ADR（ADR 不可变）
