# ADR 012: 命名融合（ForgeMind 主名，项目正式术语表）

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: operator + 架构师灵智体
> **依赖**: `[doc:VISION.md#6]`
> **依据**: operator 7 条不可妥协原则第 5 条（命名最终形态为"灵智"）
> **不可变**: 命名变更需 operator 直接决策，不能由灵智体自我演进修改

---

## 1. 上下文

FlowForge 引入"育灵体系"概念后，需要确立项目正式术语表，避免命名混乱。命名需求：
- 文档层与代码层需要双轨命名（文档面向 operator/B 端，代码面向开发者）
- 中文术语需要对 B 端/非技术用户友好
- 英文类名需要连写风格统一
- 12 个核心概念需要明确中英文对照
- 形态分类、记忆系统、议事机制等子系统需要命名一致性

operator 决策（2026-07-17）：
- 最终形态主名命名为"灵智 ForgeMind"
- 确立 12 个核心概念的项目正式术语表
- 文档层用"灵智"，代码层用"Forgekin"
- 所有英文类名采用连写风格

本 ADR 是 P0 决策，确立项目正式术语表。

---

## 2. 决策

### 2.1 双轨命名策略

| 轨道 | 用途 | 主名 | 代码层名 |
|------|------|------|---------|
| **文档/对外** | 文档、UI、operator 沟通 | **灵智（ForgeMind）** | — |
| **代码/技术** | 代码、API、配置 | — | **Forgekin** |

### 2.2 项目正式术语表（12 个核心概念）

| 术语 | 英文 | 英文类名 | 含义 | 用途 |
|------|------|---------|------|------|
| **灵智** | ForgeMind | ForgeMindEngine | 最终形态主名 | 文档/对外 |
| **灵智体** | Forgekin | Forgekin | 代码层主名 | 代码/API |
| **灵族** | ForgekinSpecies | ForgekinSpecies | 灵智体形态分类（5 种） | forgemind |
| **育灵** | ForgeNurturing | ForgeNurturing | 灵智体锻造过程 | forgemind |
| **灵忆** | EchoStore | EchoStore | 灵智体经验记忆 | 代码 |
| **灵印** | SoulImprint | SoulImprint | 灵智体身份标识 | 代码 |
| **灵锻** | SpiritForge | SpiritForge | 经验蒸馏到锻典 | 代码 |
| **锻典** | MindCodex | MindCodex | 蒸馏经验知识库 | 代码 |
| **灵议** | MindCouncil | MindCouncil | 多灵智体议事 | 代码 |
| **进化阶** | EvolutionStage | EvolutionStage | E1-E6 进化阶段 | forgemind |
| **觉醒阶** | AwakeningStage | AwakeningStage | 觉醒阶段 | forgemind |
| **能力画像** | CapabilityProfile | CapabilityProfile | 灵智体能力标识 | 代码 |

### 2.3 未选用的候选命名

| 候选命名 | 未选用原因 |
|---------|-----------|
| 炉灵 Forgekin | "炉灵"对 B 端不通俗 |
| 养灵 | "养"字过于随意 |
| E6 灵匠 Mind Artisan | 过渡命名，operator 废弃 |
| SelfEvolutionEngine | 与 ForgeMindEngine 冲突 |
| MemoryGovernanceManager | 与灵忆 EchoStore 职责重叠 |
| FirstTouchRouter | 与能力画像路由职责重叠 |
| SoulEcho（魂忆） | "魂"字引发 AI 伦理争议，改用"灵忆 EchoStore" |
| 魂印 | "魂"字引发 AI 伦理争议，改用"灵印" |
| AutoForge（灵锻） | 改用 SpiritForge，与"灵"字风格一致 |
| ForgeCodex（锻典） | 改用 MindCodex，避免与 ForgeMind 前缀混淆 |
| ForgekinCouncil（灵议） | 改用 MindCouncil，与 MindCodex 风格一致 |

### 2.4 "灵"字使用规范

项目正式术语统一使用"灵"字前缀（灵智/灵智体/灵族/育灵/灵忆/灵印/灵锻/锻典/灵议/进化阶/觉醒阶/能力画像），因为：
- "灵"字在中国文化中有"精神/灵动/记忆"含义，符合术语本意
- "灵"字不引发 AI 伦理争议（指数据/状态，非意识）
- 统一"灵"字前缀增强术语家族感

对外文档（如 README、营销材料）优先使用"灵智"主名。

### 2.5 代码命名规范

```python
# 类名：使用 ForgeMind / Forgekin / SpiritForge 前缀
class ForgeMindEngine: ...        # 灵智引擎（核心框架层）
class ForgekinBase: ...           # 灵智体基类（forgemind 应用层）
class ForgekinSpecies(Enum): ...  # 灵智体形态分类
class SpiritForge: ...            # 灵锻引擎（经验蒸馏到锻典 MindCodex）
class EchoStore: ...              # 灵忆（灵智体经验记忆）
class SoulImprint: ...            # 灵印（灵智体身份标识）
class MindCodex: ...              # 锻典（蒸馏经验知识库）
class MindCouncil: ...            # 灵议（多灵智体议事）
class EvolutionStage(Enum): ...   # 进化阶 E1-E6
class AwakeningStage(Enum): ...   # 觉醒阶
class CapabilityProfile: ...      # 能力画像

# 模块名：使用 forgemind / forgekin
flowforge/forgemind/              # 应用层
flowforge/core/forgekin/          # 核心层灵智体能力
flowforge/core/forging/           # 灵锻 SpiritForge 引擎
flowforge/core/council/           # 灵议 MindCouncil
flowforge/core/memory/codex.py    # 锻典 MindCodex

# 文档/UI：使用 ForgeMind / 灵智
VISION.md                         # 万物灵智体愿景
README.md                         # "灵智体锻造厂"
```

---

## 3. 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **方案 A（选定）: 双轨命名（灵智 ForgeMind / 灵智体 Forgekin）+ 项目正式术语表** | 命名统一，"灵智"对 B 端/非技术用户友好，代码与文档对齐，"灵"字家族感强 | 12 个核心概念需要严格对齐 |
| 方案 B: 用"炉灵 Forgekin"作为主名 | 减少命名决策工作量 | B 端/非技术用户难以理解，与 operator 决策冲突 |
| 方案 C: 用"Mind Artisan"作为主名 | 英文友好 | 中文用户难记 |
| 方案 D: 不统一命名，各文档自治 | 零工作量 | 命名混乱，文档间引用困难，违反真相源唯一原则 |

---

## 4. 理由

- operator 决策"灵智"为最终形态（愿景锚点第 5 条）
- 双轨命名让文档层（灵智 ForgeMind）和代码层（灵智体 Forgekin）各得其所
- 统一术语风格（连写：ForgeMindEngine / Forgekin / ForgekinSpecies / ForgeNurturing / EchoStore / SoulImprint / SpiritForge / MindCodex / MindCouncil / EvolutionStage / AwakeningStage / CapabilityProfile）
- "灵"字家族增强术语一致性，避免"魂"字 AI 伦理争议
- "灵智"对 B 端/非技术用户更友好

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 术语对齐可能遗漏 | grep 全局检查 + T7 LLM 审核 |
| 第三方文档可能用不同命名 | 在 README 中明确标注项目正式术语表 |
| 术语风格统一（连写）可能影响可读性 | 在 design/naming-contract.md 中明确命名契约 |
| 12 个核心概念记忆负担 | 术语表集中在 ADR-012 + design/README.md 两处 |

---

## 6. 否决理由

- **方案 B（"炉灵 Forgekin"）**：operator 决策"灵智"为最终形态，"炉灵"对 B 端不通俗
- **方案 C（"Mind Artisan"）**：中文用户难记
- **方案 D（不统一命名）**：命名混乱，违反真相源唯一原则，文档间引用困难

---

## 7. 参与者

- operator（最终形态命名决策，不可委托）
- 架构师灵智体（术语表整理 + 代码命名规范）

---

## 8. 修订记录

| 日期 | 修订 | 修订者 |
|------|------|--------|
| 2026-07-17 | 确立项目正式术语表（12 核心概念：ForgeMind / Forgekin / ForgekinSpecies / ForgeNurturing / EchoStore / SoulImprint / SpiritForge / MindCodex / MindCouncil / EvolutionStage / AwakeningStage / CapabilityProfile） | operator + 架构师灵智体 |

---

## 引用

- `[doc:VISION.md#6]` — operator 7 条不可妥协原则（第 5 条：命名最终形态为"灵智"）
- `[doc:VISION.md#7]` — 4 条 Iron Laws（灵忆 EchoStore / 灵锻 SpiritForge / 灵印 SoulImprint）
- `[doc:design/naming-contract.md]` — 命名契约（详细）
- `[doc:design/README.md]` — 设计文档术语表
