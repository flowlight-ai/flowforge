# FlowForge 设计规范导航 + Design Feature 规格

> **文档编号**: design/README.md（v2.0）
> **更新日期**: 2026-07-19
> **用途 1**: FlowForge 设计规范文档导航（命名契约 / 控制台设计系统 / 品牌设计 / 动效设计）
> **用途 2**: 40 份 D0XX 文件的索引（Feature 级 SDD），与 [features/F0XX-xxx.md](../features/) + [architecture/A0XX-xxx.md](../architecture/) 同号一一对应
> **依据**: `[doc:review/review.md#12.1]` 文档拆分目标结构 + `[doc:../../../hiclaw/rules.md#第十一部分]` 文档分层规范
> **参考**: `[doc:clowder-ai/docs/design/]` 目录结构 + `[doc:../architecture/README.md]` Architecture Feature 索引结构

---

## 1. 设计规范范围

本目录存放 FlowForge 的设计规范文档与 Feature 级 SDD 文档。

**与 features/ 的区别**：
- `design/` 存放**横切关注点**（命名、品牌、UI 设计系统等）+ **Feature 级 SDD**（D0XX-xxx.md）
- `features/` 存放**具体 Feature 规格**（每个 Feature 一个文件 F0XX）
- `architecture/` 存放**Feature 级 SAD**（A0XX，与 F0XX 同号）

---

## 2. 设计规范文件清单

| 文件 | 内容 | 状态 |
|------|------|:----:|
| [README.md](README.md) | 设计规范导航 + Design Feature 索引（本文件） | ✅ v2.0 |
| [TEMPLATE.md](TEMPLATE.md) | D0XX 文件模板（7 节结构） | ✅ v1.0 |
| [naming-contract.md](naming-contract.md) | 命名契约（12 概念 + 双轨策略 + 进化阶 + 觉醒阶） | ✅ v1.1 |
| [console-design-system.md](console-design-system.md) | 控制台设计系统 | ⏳ Phase 2 |
| [forgemind-brand.md](forgemind-brand.md) | forgemind 品牌（多形态智能体形态分类视觉） | ⏳ Phase 2 |
| [hero-prism-motion.md](hero-prism-motion.md) | 动效设计 | ⏳ Phase 2 |

---

## 3. 命名契约核心（详见 naming-contract.md）

### 3.1 双轨命名策略

| 轨道 | 用途 | 主名 | 代码层名 |
|------|------|------|---------|
| 文档/对外 | 文档、UI、operator 沟通 | 灵智（ForgeMind） | — |
| 代码/技术 | 代码、API、配置 | — | Forgekin |

**废弃命名**：
- ❌ "E6 灵匠 Mind Artisan" → ✅ "灵智"
- ❌ "炉灵" → ✅ "灵智体"
- ❌ "魂忆" → ✅ "灵忆"（v7.1 修订）
- ❌ "魂印" → ✅ "灵印"（v7.1 修订）
- ❌ M18/M19/M20 自创术语 → ✅ M1-M17 + v7.0 FR-EVO 术语

### 3.2 v7.1 术语表

| 术语 | 含义 |
|------|------|
| 灵智 ForgeMind | 最终形态主名 |
| 灵智体 Forgekin | 代码层主名 |
| 灵族 Forgekin Species | 灵智体形态分类（5 种） |
| 育灵 Forge Nurturing | 灵智体锻造过程 |
| 灵忆 EchoStore | 灵智体经验记忆 |
| 灵印 Mind Imprint | 灵智体身份标识 |
| 灵锻 SpiritForge | 经验蒸馏到锻典 |
| 锻典 Mind Codex | 蒸馏经验知识库 |
| 灵议 Mind Council | 多灵智体议事 |
| 进化阶 Evolution Stage | E1-E6 能力成熟度 |
| 觉醒阶 Awakening Stage | E1-E6 自主性等级 |

---

## 4. forgemind 品牌核心（详见 forgemind-brand.md）

### 4.1 多形态智能体形态视觉

5 种形态分类各有视觉标识：
- **BioForgekin**（生物灵智体）：暖色调 + 生物形态曲线
- **OrgForgekin**（组织灵智体）：冷色调 + 网络节点拓扑
- **ObjForgekin**（物品灵智体）：中性色 + 物品几何轮廓
- **VirtualForgekin**（虚拟灵智体）：渐变色 + 虚拟抽象符号
- **HybridForgekin**（混合灵智体）：多色融合 + 复合形态

### 4.2 灵智体锻造视觉语言

锻造流水线视觉表达：原石 → 粗锻 → 精锻 → 觉醒 → 进化

---

## 5. FlowForge Design Feature 规格

### 5.1 Design Feature 规范

每个 Design Feature 文件（D0XX-xxx.md）是 [features/F0XX-xxx.md](../features/) + [architecture/A0XX-xxx.md](../architecture/) 的**详细设计层补充**，与 F0XX / A0XX 同号一一对应。**单文件 < 50KB**，仅放详细设计视角（类签名 / 算法 / 时序 / 数据结构 / 配置项）。

#### 5.1.1 文件命名

```
D0XX-kebab-case-name.md
```

#### 5.1.2 编号规则

| 编号范围 | 类别 | 对应 F0XX / A0XX |
|---------|------|------------------|
| D001-D007 | TeamAct 协作详细设计 | F001-F007 / A001-A007 |
| D008-D013 | Harness 七层详细设计 | F008-F013 / A008-A013 |
| D014-D017 | 多域记忆详细设计 | F014-F017 / A014-A017 |
| D018-D020 | Eval 自代谢详细设计 | F018-F020 / A018-A020 |
| D021-D025 | 分布式可靠性详细设计 | F021-F025 / A021-A025 |
| D026-D030 | forgemind 应用层详细设计 | F026-F030 / A026-A030 |
| D031-D035 | 三方 Agent 集成详细设计 | F031-F035 / A031-A035 |
| D036-D040 | 其他详细设计 | F036-F040 / A036-A040 |

#### 5.1.3 模板

详见 [TEMPLATE.md](TEMPLATE.md)（v1.0，7 节结构）。

#### 5.1.4 7 节结构

| 节 | 标题 | 用途 |
|---|------|------|
| 1 | 详细设计上下文 | 设计问题 / 设计约束 / 设计影响 |
| 2 | 详细设计 | 类图 / 接口实现 / 数据结构 / 算法 |
| 3 | 模块实现 | 关键代码 / 关键流程 / 时序图 |
| 4 | 跨模块协作实现 | 上游依赖实现 / 下游影响实现 / 跨模块不变量 |
| 5 | 详细设计验收 | 功能验收 / 性能验收 / 安全验收 / Build to Delete/Persist 验收 |
| 6 | 引用 | 跨文档引用 |
| 7 | 变更历史 | 版本变更记录 |

---

### 5.2 Design Feature 清单（40 份）

#### 5.2.1 TeamAct 协作详细设计（D001-D007）

| Design | 标题 | 状态 | 对应 Feature | 对应 Architecture | 对应 design.md |
|--------|------|:----:|-------------|------------------|----------------|
| [D001-capability-profile.md](D001-capability-profile.md) | 能力画像详细设计 | ⏳ | F001 | A001 | §3.1 |
| [D002-teamact-loop.md](D002-teamact-loop.md) | TeamAct 六步循环详细设计 | ⏳ | F002 | A002 | §3.2 |
| [D003-handoff-capsule.md](D003-handoff-capsule.md) | 交接胶囊详细设计 | ⏳ | F003 | A003 | §3.2 |
| [D004-pingpong-circuit-breaker.md](D004-pingpong-circuit-breaker.md) | 乒乓球熔断器详细设计 | ⏳ | F004 | A004 | §3.2 |
| [D005-at-mention-routing.md](D005-at-mention-routing.md) | 行首 @ 路由详细设计 | ⏳ | F005 | A005 | §3.2 |
| [D006-ball-custody-lease.md](D006-ball-custody-lease.md) | 持球注册 lease 详细设计 | ⏳ | F006 | A006 | §3.2 |
| [D007-push-back-protocol.md](D007-push-back-protocol.md) | Generator Push Back 详细设计 | ⏳ | F007 | A007 | §3.2 / §3.7 |

#### 5.2.2 Harness 七层详细设计（D008-D013）

| Design | 标题 | 状态 | 对应 Feature | 对应 Architecture | 对应 design.md |
|--------|------|:----:|-------------|------------------|----------------|
| [D008-durable-state-surfaces.md](D008-durable-state-surfaces.md) | Durable State Surfaces 详细设计 | ⏳ | F008 | A008 | §3.3 |
| [D009-evidence-sensors.md](D009-evidence-sensors.md) | Evidence & Sensors 详细设计 | ⏳ | F009 | A009 | §3.3 |
| [D010-governance-boundary.md](D010-governance-boundary.md) | Governance 压缩免疫详细设计 | ⏳ | F010 | A010 | §3.3 |
| [D011-magic-words.md](D011-magic-words.md) | Magic Words 逃生舱详细设计 | ⏳ | F011 | A011 | §3.3 |
| [D012-entropy-control.md](D012-entropy-control.md) | Entropy Control 退役详细设计 | ⏳ | F012 | A012 | §3.3 |
| [D013-harnessability.md](D013-harnessability.md) | Harnessability 评估详细设计 | ⏳ | F013 | A013 | §3.3 |

#### 5.2.3 多域记忆详细设计（D014-D017）

| Design | 标题 | 状态 | 对应 Feature | 对应 Architecture | 对应 design.md |
|--------|------|:----:|-------------|------------------|----------------|
| [D014-memory-collection.md](D014-memory-collection.md) | 多域记忆 Collection 详细设计 | ⏳ | F014 | A014 | §3.4 |
| [D015-three-retrieval-entry.md](D015-three-retrieval-entry.md) | 三检索入口详细设计 | ⏳ | F015 | A015 | §3.4 |
| [D016-memory-governance.md](D016-memory-governance.md) | 记忆治理三要素详细设计 | ⏳ | F016 | A016 | §3.4 |
| [D017-consumption-weighted-ranking.md](D017-consumption-weighted-ranking.md) | 消费加权排序详细设计 | ⏳ | F017 | A017 | §3.4 |

#### 5.2.4 Eval 自代谢详细设计（D018-D020）

| Design | 标题 | 状态 | 对应 Feature | 对应 Architecture | 对应 design.md |
|--------|------|:----:|-------------|------------------|----------------|
| [D018-eval-contract.md](D018-eval-contract.md) | Eval Contract 五问详细设计 | ⏳ | F018 | A018 | §3.5 |
| [D019-three-signal-cross.md](D019-three-signal-cross.md) | 三方信号交叉详细设计 | ⏳ | F019 | A019 | §3.5 |
| [D020-seven-attribution.md](D020-seven-attribution.md) | 七类归因矩阵详细设计 | ⏳ | F020 | A020 | §3.5 |

#### 5.2.5 分布式可靠性详细设计（D021-D025）

| Design | 标题 | 状态 | 对应 Feature | 对应 Architecture | 对应 design.md |
|--------|------|:----:|-------------|------------------|----------------|
| [D021-side-effect-wal.md](D021-side-effect-wal.md) | 副作用日志 WAL 详细设计 | ⏳ | F021 | A021 | §3.6 |
| [D022-tier-1-4-recovery.md](D022-tier-1-4-recovery.md) | Tier 1-4 恢复分级详细设计 | ⏳ | F022 | A022 | §3.6 |
| [D023-liveness-canonical-read.md](D023-liveness-canonical-read.md) | liveness 规范读模型详细设计 | ⏳ | F023 | A023 | §3.6 |
| [D024-weak-state-vs-strong-workflow.md](D024-weak-state-vs-strong-workflow.md) | 弱状态机 vs 强 workflow 详细设计 | ⏳ | F024 | A024 | §3.6 |
| [D025-provider-host-abstraction.md](D025-provider-host-abstraction.md) | 跨 provider 宿主抽象详细设计 | ⏳ | F025 | A025 | §3.6 |

#### 5.2.6 forgemind 应用层详细设计（D026-D030）

| Design | 标题 | 状态 | 对应 Feature | 对应 Architecture | 对应 design.md |
|--------|------|:----:|-------------|------------------|----------------|
| [D026-forgemind-app-layer.md](D026-forgemind-app-layer.md) | forgemind 应用层详细设计 | ⏳ | F026 | A026 | §3.8 |
| [D027-all-things-spirit-species.md](D027-all-things-spirit-species.md) | 多形态智能体形态分类详细设计 | ⏳ | F027 | A027 | §3.8 |
| [D028-forging-pipeline.md](D028-forging-pipeline.md) | 灵智体锻造流水线详细设计 | ⏳ | F028 | A028 | §3.9 |
| [D029-physical-ai-sensors.md](D029-physical-ai-sensors.md) | 物理 AI 传感器接入详细设计 | ⏳ | F029 | A029 | §3.11 |
| [D030-virtual-world-setting.md](D030-virtual-world-setting.md) | 虚拟世界设定层详细设计 | ⏳ | F030 | A030 | §3.12 |

#### 5.2.7 三方 Agent 集成详细设计（D031-D035）

| Design | 标题 | 状态 | 对应 Feature | 对应 Architecture | 对应 design.md |
|--------|------|:----:|-------------|------------------|----------------|
| [D031-external-agent-adapter.md](D031-external-agent-adapter.md) | 三方 Agent 适配层详细设计 | ⏳ | F031 | A031 | §3.10 |
| [D032-external-agent-profile.md](D032-external-agent-profile.md) | 三方 Agent 能力画像详细设计 | ⏳ | F032 | A032 | §3.10 |
| [D033-external-agent-shared-state.md](D033-external-agent-shared-state.md) | 三方 Agent 状态共享详细设计 | ⏳ | F033 | A033 | §3.10 |
| [D034-external-agent-fallback.md](D034-external-agent-fallback.md) | 三方 Agent 失败回退详细设计 | ⏳ | F034 | A034 | §3.10 |
| [D035-external-agent-capability-fusion.md](D035-external-agent-capability-fusion.md) | 三方 Agent 能力融合详细设计 | ⏳ | F035 | A035 | §3.10 |

#### 5.2.8 其他详细设计（D036-D040）

| Design | 标题 | 状态 | 对应 Feature | 对应 Architecture | 对应 design.md |
|--------|------|:----:|-------------|------------------|----------------|
| [D036-forgemind-forge-relationship.md](D036-forgemind-forge-relationship.md) | forgemind 与 *Forge 关系详细设计 | ⏳ | F036 | A036 | §3.8 |
| [D037-forgemind-marketplace.md](D037-forgemind-marketplace.md) | 灵智体市场详细设计 | ⏳ | F037 | A037 | §3.13 |
| [D038-forgemind-lineage.md](D038-forgemind-lineage.md) | 灵智体进化谱系详细设计 | ⏳ | F038 | A038 | §3.13 |
| [D039-mind-codex-searchable.md](D039-mind-codex-searchable.md) | 灵典可检索知识库详细设计 | ⏳ | F039 | A039 | §3.4 / §3.14 |
| [D040-harness-eval-control-plane.md](D040-harness-eval-control-plane.md) | Harness Eval 控制面详细设计 | ⏳ | F040 | A040 | §3.5 |

---

## 6. 与顶层 design.md 的关系

- **顶层 [design.md](../design.md)**：放核心关键功能详细设计（§3.1-§3.17），章节与 [spec.md §3](../spec.md) + [arch.md §3](../arch.md) 同号
- **本目录 D0XX**：放对应 Feature 的完整详细设计，与 F0XX / A0XX 同号一一对应
- **跨文档引用**：D0XX 引用 F0XX（Feature 级 SRS）+ A0XX（Feature 级 SAD）+ design.md §3.X（顶层 SDD）

```
spec.md §3.X  ←─同号─→  arch.md §3.X  ←─同号─→  design.md §3.X
       ↑                        ↑                        ↑
       │                        │                        │
   features/F0XX          architecture/A0XX          design/D0XX
（Feature 级 SRS）     （Feature 级 SAD）         （Feature 级 SDD）
```

---

## 7. 状态定义

| 状态 | 含义 |
|------|------|
| ⏳ pending | 未开始 |
| 🔄 in_progress | 开发中 |
| ✅ done | 已完成并通过详细设计 review |
| ❌ deprecated | 已废弃 |
| 🚫 blocked | 被阻塞（需依赖解决） |

---

## 8. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-17 | v1.0 | 初版：设计规范导航（命名契约 / 控制台 / 品牌 / 动效） | Trae CN（agent） |
| 2026-07-19 | v2.0 | **新增 FlowForge Design Feature 规格**：40 份 D0XX 文件索引（与 F0XX/A0XX 同号一一对应）+ TEMPLATE.md 模板引用 + 7 节结构说明 + 与顶层 design.md 关系图 | 文档员灵智体（钢笔·文心） |
