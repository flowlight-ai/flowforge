# FlowForge Architecture Feature 规格

> **文档编号**: README.md（v1.1）
> **更新日期**: 2026-07-19
> **用途**: 44 份 A0XX 文件的索引（Feature 级 SAD），与 [features/F0XX-xxx.md](../features/) 同号一一对应
> **依赖**: `[doc:../spec.md]` + `[doc:../arch.md]` + `[doc:../features/]` + `[doc:../../../hiclaw/rules.md#第十一部分]`

---

## 1. Architecture Feature 规范

每个 Architecture Feature 文件（A0XX-xxx.md）是 [features/F0XX-xxx.md](../features/) 的**架构层补充**，与 F0XX 同号一一对应。**单文件 < 50KB**，仅放架构视角设计。

### 1.1 文件命名

```
A0XX-kebab-case-name.md
```

### 1.2 编号规则

| 编号范围 | 类别 | 对应 F0XX |
|---------|------|----------|
| A001-A007 | TeamAct 协作 | F001-F007 |
| A008-A013 | Harness 七层 | F008-F013 |
| A014-A017 | 多域记忆 | F014-F017 |
| A018-A020 | Eval 自代谢 | F018-F020 |
| A021-A025 | 分布式可靠性 | F021-F025 |
| A026-A030 | forgemind 应用层 | F026-F030 |
| A031-A035 | 三方 Agent 集成 | F031-F035 |
| A036-A040 | 其他 | F036-F040 |
| A041-A044 | 可进化智能体（4 种组织角色） | F041-F044 |

### 1.3 模板

详见 [TEMPLATE.md](TEMPLATE.md)。

---

## 2. Architecture Feature 清单（44 份）

### 2.1 TeamAct 协作（A001-A007）

| Architecture | 标题 | 状态 | 对应 Feature | 对应 spec.md |
|-------------|------|:----:|-------------|-------------|
| [A001-capability-profile.md](A001-capability-profile.md) | 能力画像架构 | ⏳ | F001 | §3.1 |
| [A002-teamact-loop.md](A002-teamact-loop.md) | TeamAct 六步循环架构 | ⏳ | F002 | §3.2 |
| [A003-handoff-capsule.md](A003-handoff-capsule.md) | 交接胶囊架构 | ⏳ | F003 | §3.2 |
| [A004-pingpong-circuit-breaker.md](A004-pingpong-circuit-breaker.md) | 乒乓球熔断器架构 | ⏳ | F004 | §3.2 |
| [A005-at-mention-routing.md](A005-at-mention-routing.md) | 行首 @ 路由架构 | ⏳ | F005 | §3.2 |
| [A006-ball-custody-lease.md](A006-ball-custody-lease.md) | 持球注册 lease 架构 | ⏳ | F006 | §3.2 |
| [A007-push-back-protocol.md](A007-push-back-protocol.md) | Generator Push Back 架构 | ⏳ | F007 | §3.2 / §3.7 |

### 2.2 Harness 七层（A008-A013）

| Architecture | 标题 | 状态 | 对应 Feature | 对应 spec.md |
|-------------|------|:----:|-------------|-------------|
| [A008-durable-state-surfaces.md](A008-durable-state-surfaces.md) | Durable State Surfaces 架构 | ⏳ | F008 | §3.3 |
| [A009-evidence-sensors.md](A009-evidence-sensors.md) | Evidence & Sensors 架构 | ⏳ | F009 | §3.3 |
| [A010-governance-boundary.md](A010-governance-boundary.md) | Governance 压缩免疫架构 | ⏳ | F010 | §3.3 |
| [A011-magic-words.md](A011-magic-words.md) | Magic Words 逃生舱架构 | ⏳ | F011 | §3.3 |
| [A012-entropy-control.md](A012-entropy-control.md) | Entropy Control 退役架构 | ⏳ | F012 | §3.3 |
| [A013-harnessability.md](A013-harnessability.md) | Harnessability 评估架构 | ⏳ | F013 | §3.3 |

### 2.3 多域记忆（A014-A017）

| Architecture | 标题 | 状态 | 对应 Feature | 对应 spec.md |
|-------------|------|:----:|-------------|-------------|
| [A014-memory-collection.md](A014-memory-collection.md) | 多域记忆 Collection 架构 | ⏳ | F014 | §3.4 |
| [A015-three-retrieval-entry.md](A015-three-retrieval-entry.md) | 三检索入口架构 | ⏳ | F015 | §3.4 |
| [A016-memory-governance.md](A016-memory-governance.md) | 记忆治理三要素架构 | ⏳ | F016 | §3.4 |
| [A017-consumption-weighted-ranking.md](A017-consumption-weighted-ranking.md) | 消费加权排序架构 | ⏳ | F017 | §3.4 |

### 2.4 Eval 自代谢（A018-A020）

| Architecture | 标题 | 状态 | 对应 Feature | 对应 spec.md |
|-------------|------|:----:|-------------|-------------|
| [A018-eval-contract.md](A018-eval-contract.md) | Eval Contract 五问架构 | ⏳ | F018 | §3.5 |
| [A019-three-signal-cross.md](A019-three-signal-cross.md) | 三方信号交叉架构 | ⏳ | F019 | §3.5 |
| [A020-seven-attribution.md](A020-seven-attribution.md) | 七类归因矩阵架构 | ⏳ | F020 | §3.5 |

### 2.5 分布式可靠性（A021-A025）

| Architecture | 标题 | 状态 | 对应 Feature | 对应 spec.md |
|-------------|------|:----:|-------------|-------------|
| [A021-side-effect-wal.md](A021-side-effect-wal.md) | 副作用日志 WAL 架构 | ⏳ | F021 | §3.6 |
| [A022-tier-1-4-recovery.md](A022-tier-1-4-recovery.md) | Tier 1-4 恢复分级架构 | ⏳ | F022 | §3.6 |
| [A023-liveness-canonical-read.md](A023-liveness-canonical-read.md) | liveness 规范读模型架构 | ⏳ | F023 | §3.6 |
| [A024-weak-state-vs-strong-workflow.md](A024-weak-state-vs-strong-workflow.md) | 弱状态机 vs 强 workflow 架构 | ⏳ | F024 | §3.6 |
| [A025-provider-host-abstraction.md](A025-provider-host-abstraction.md) | 跨 provider 宿主抽象架构 | ⏳ | F025 | §3.6 |

### 2.6 forgemind 应用层（A026-A030）

| Architecture | 标题 | 状态 | 对应 Feature | 对应 spec.md |
|-------------|------|:----:|-------------|-------------|
| [A026-forgemind-app-layer.md](A026-forgemind-app-layer.md) | forgemind 应用层架构 | ⏳ | F026 | §3.8 |
| [A027-all-things-spirit-species.md](A027-all-things-spirit-species.md) | 多形态智能体形态分类架构 | ⏳ | F027 | §3.8 |
| [A028-forging-pipeline.md](A028-forging-pipeline.md) | Forgekin锻造流水线架构 | ⏳ | F028 | §3.9 |
| [A029-physical-ai-sensors.md](A029-physical-ai-sensors.md) | 物理 AI 传感器接入架构 | ⏳ | F029 | §3.11 |
| [A030-virtual-world-setting.md](A030-virtual-world-setting.md) | 虚拟世界设定层架构 | ⏳ | F030 | §3.12 |

### 2.7 三方 Agent 集成（A031-A035）

| Architecture | 标题 | 状态 | 对应 Feature | 对应 spec.md |
|-------------|------|:----:|-------------|-------------|
| [A031-external-agent-adapter.md](A031-external-agent-adapter.md) | 三方 Agent 适配层架构 | ⏳ | F031 | §3.10 |
| [A032-external-agent-profile.md](A032-external-agent-profile.md) | 三方 Agent 能力画像架构 | ⏳ | F032 | §3.10 |
| [A033-external-agent-shared-state.md](A033-external-agent-shared-state.md) | 三方 Agent 状态共享架构 | ⏳ | F033 | §3.10 |
| [A034-external-agent-fallback.md](A034-external-agent-fallback.md) | 三方 Agent 失败回退架构 | ⏳ | F034 | §3.10 |
| [A035-external-agent-capability-fusion.md](A035-external-agent-capability-fusion.md) | 三方 Agent 能力融合架构 | ⏳ | F035 | §3.10 |

### 2.8 其他（A036-A040）

| Architecture | 标题 | 状态 | 对应 Feature | 对应 spec.md |
|-------------|------|:----:|-------------|-------------|
| [A036-forgemind-forge-relationship.md](A036-forgemind-forge-relationship.md) | forgemind 与 *Forge 关系架构 | ⏳ | F036 | §3.8 |
| [A037-forgemind-marketplace.md](A037-forgemind-marketplace.md) | Forgekin市场架构 | ⏳ | F037 | §3.13 |
| [A038-forgemind-lineage.md](A038-forgemind-lineage.md) | Forgekin进化谱系架构 | ⏳ | F038 | §3.13 |
| [A039-mind-codex-searchable.md](A039-mind-codex-searchable.md) | MindCodex 可检索知识库架构 | ⏳ | F039 | §3.4 / §3.14 |
| [A040-harness-eval-control-plane.md](A040-harness-eval-control-plane.md) | Harness Eval 控制面架构 | ⏳ | F040 | §3.5 |

### 2.9 可进化智能体架构（A041-A044，4 种组织角色）

| Architecture | 标题 | 状态 | 对应 Feature | 责任方 Forgekin |
|-------------|------|:----:|-------------|-------------|
| [A041-product-manager.md](A041-product-manager.md) | 产品经理可进化智能体架构 | ⏳ | F041 | 鹰·凯恩（Eagle Kane） |
| [A042-devops.md](A042-devops.md) | 运维可进化智能体架构 | ⏳ | F042 | 蜂鸟·闪电（Hummingbird Flash） |
| [A043-security-officer.md](A043-security-officer.md) | 安全官可进化智能体架构 | ⏳ | F043 | 狼·阿尔法（Wolf Alpha） |
| [A044-delivery-manager.md](A044-delivery-manager.md) | 交付经理可进化智能体架构 | ⏳ | F044 | 象·牛顿（Elephant Newton） |

---

## 3. 与顶层 arch.md 的关系

- **顶层 [arch.md](../arch.md)**：放核心关键功能架构设计（§3.1-§3.17），章节与 [spec.md §3](../spec.md) 同号
- **本目录 A0XX**：放对应 Feature 的详细架构设计，与 F0XX 同号一一对应
- **跨文档引用**：A0XX 引用 F0XX（Feature 级 SRS）+ arch.md §3.X（顶层 SAD）+ D0XX（Feature 级 SDD，待创建）

---

## 4. 状态定义

| 状态 | 含义 |
|------|------|
| ⏳ pending | 未开始 |
| 🔄 in_progress | 开发中 |
| ✅ done | 已完成并通过架构 review |
| ❌ deprecated | 已废弃 |
| 🚫 blocked | 被阻塞（需依赖解决） |
