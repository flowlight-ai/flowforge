# ADR 012: 命名融合（ForgeMind 主名）

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: operator（不可委托）
> **依赖**: `[doc:review/review.md#第六章]` 育灵体系命名融合方案
> **不可变**: 命名变更需 operator 直接决策，不能由灵智体自我演进修改

---

## 上下文

FlowForge v7.0 引入"育灵体系"概念后，出现了 19 套独立命名方案 + 4 项深度补充 + 3 项新框架。命名混乱导致：
- 文档间术语不一致（spec.md 用"炉灵"，arch.md 用"养灵"，design.md 用"灵匠"）
- 代码与文档断层（evolution/ 代码用 v4.0 SelfEvolutionEngine，文档用 v7.0 ForgeMindEngine）
- B 端/非技术用户难以理解（"炉灵 Forgekin"对非技术用户不够通俗）
- AI 伦理争议（"魂"字引发 LLM 是否有灵魂的争议）

operator 最终决策（2026-07-17）：
- 最终形态命名为"灵智"
- 废弃"E6 灵匠 Mind Artisan"等过渡命名
- 其他命名按推荐执行

---

## 决策

### 1. 双轨命名策略

| 轨道 | 用途 | 主名 | 代码层名 |
|------|------|------|---------|
| **文档/对外** | 文档、UI、operator 沟通 | **灵智（ForgeMind）** | — |
| **代码/技术** | 代码、API、配置 | — | **Forgekin** |

### 2. 最终形态命名

| 旧命名 | 新命名 | 用途 |
|--------|--------|------|
| E6 灵匠 Mind Artisan | **灵智 ForgeMind** | 最终形态主名（文档/对外） |
| 炉灵 Forgekin | **灵智体 Forgekin** | 代码层主名 |
| 养灵 Forge Nurturing | **育灵 Forge Nurturing** | 灵智体锻造过程 |

### 3. v7.1 术语表（10 个核心术语）

> v1.1 修订（2026-07-18）：根据 operator 指令，"魂忆→灵忆"、"魂印→灵印"（"魂"字过于玄学，统一改为"灵"字）。原 v7.0 表中"魂忆/魂印"已废弃。

| 术语 | 英文 | 含义 | 用途 |
|------|------|------|------|
| **灵智** | ForgeMind | 最终形态主名 | 文档/对外 |
| **灵智体** | Forgekin | 代码层主名 | 代码/API |
| **灵族** | Forgekin Species | 灵智体形态分类（5 种） | forgemind |
| **育灵** | Forge Nurturing | 灵智体锻造过程 | forgemind |
| **灵忆** | EchoStore | 灵智体经验记忆 | 代码 |
| **灵印** | Soul Imprint | 灵智体身份标识 | 代码 |
| **灵锻** | SpiritForge | 经验蒸馏到锻典 | 代码 |
| **锻典** | Mind Codex | 蒸馏经验知识库 | 代码 |
| **灵议** | Mind Council | 多灵智体议事 | 代码 |
| **进化阶** | Evolution Stage | E1-E6 能力成熟度 | forgemind |

### 4. 废弃命名清单

| 废弃命名 | 替换为 | 废弃原因 |
|---------|--------|---------|
| E6 灵匠 Mind Artisan | 灵智 ForgeMind | operator 直接决策 |
| 炉灵 Forgekin | 灵智体 Forgekin | "炉灵"对 B 端不通俗 |
| 养灵 | 育灵 | "养"字过于随意 |
| 魂忆 | 灵忆 | v7.1：operator 2026-07-18 决策，"魂"字过于玄学，统一改为"灵"字 |
| 魂印 | 灵印 | v7.1：operator 2026-07-18 决策，"魂"字过于玄学，统一改为"灵"字 |
| M18 SelfEvolutionEngine | ForgeMindEngine | v4.0 自创术语，与 v7.0 FR-EVO 冲突 |
| M19 MemoryGovernanceManager | （映射到 M1-M17） | v4.0 自创术语 |
| M20 FirstTouchRouter | （映射到 M1-M17） | v4.0 自创术语 |

### 5. "魂"字使用规范（v1.1 作废）

> **v1.1 作废声明**（2026-07-18）：原 v1.0 §5 主张"魂忆/魂印保留'魂'字"，operator 在 2026-07-18 指令中明确否决此规范，要求"魂"字过于玄学，统一改为"灵"字。本节保留作历史索引，新文档/代码不可使用"魂忆/魂印"。

~~`魂忆` / `魂印` / `灵锻` / `锻典` / `灵议` 等含"魂"字术语**保留**，因为：~~
- ~~这些是技术术语（非"灵魂"含义）~~
- ~~"魂"字在中国文化中有"精神/记忆/印记"含义，符合术语本意~~
- ~~不引发 AI 伦理争议（指数据/状态，非意识）~~

**v1.1 新规范**：
- `灵忆`（EchoStore）/ `灵印`（Soul Imprint）/ `灵锻`（SpiritForge）/ `锻典`（Mind Codex）/ `灵议`（Mind Council）统一使用"灵"字
- "灵"字与"灵智/灵族/灵智体"系列对齐，避免"魂"字引发的玄学争议
- 对外文档（README、营销材料）仍优先使用"灵智"主名

### 6. 全局替换规则

以下文件必须全局替换（在 Phase 0 完成）：

| 文件 | 替换规则 |
|------|---------|
| `flowforge/docs/spec.md` | 炉灵 → 灵智体 / E6 灵匠 → 灵智 / **魂忆 → 灵忆 / 魂印 → 灵印**（v1.1 新增） |
| `flowforge/docs/arch.md` | 炉灵 → 灵智体 / 养灵 → 育灵 / **魂忆 → 灵忆 / 魂印 → 灵印**（v1.1 新增） |
| `flowforge/docs/design.md` | 炉灵 → 灵智体 / M18/M19/M20 → ForgeMindEngine / **魂忆 → 灵忆 / 魂印 → 灵印**（v1.1 新增） |
| `flowforge/docs/design/naming-contract.md` | **魂忆 → 灵忆 / 魂印 → 灵印**（v1.1 新增，已升级到 v1.1） |
| `flowforge/docs/face/*.md` | 炉灵 → 灵智体 / **魂忆 → 灵忆 / 魂印 → 灵印**（v1.1 新增） |
| `flowforge/docs/decisions/*.md` | **魂忆 → 灵忆 / 魂印 → 灵印**（v1.1 新增） |
| `flowforge/docs/features/*.md` | **魂忆 → 灵忆 / 魂印 → 灵印**（v1.1 新增） |
| `flowforge/docs/perspectives/*.md` | **魂忆 → 灵忆 / 魂印 → 灵印**（v1.1 新增） |
| `flowforge/docs/TIPS.md` | **魂忆 → 灵忆 / 魂印 → 灵印**（v1.1 新增） |
| `flowforge/evolution/*.py` | SelfEvolutionEngine → ForgeMindEngine |
| `flowforge/core/plugin_protocol.py` | 新增 V3 四钩子 |
| `hiclaw/rules.md` | 炉灵 → 灵智体 / 养灵 → 育灵 |
| `hiclaw/prompts.md` | 炉灵 → 灵智体 |

**说明**：review/ 目录下的旧审核记录（glm.md/doubao.md/minimax1.md 等）是历史审核快照，保留原术语不改；新增审核文件（如 clowder-ai-deep-review.md）必须用 v7.1 新术语。

### 7. 代码命名规范

```python
# 类名：使用 Forgekin 前缀
class ForgekinBase: ...           # 灵智体基类
class ForgekinEngine: ...         # 灵智体引擎（原 SelfEvolutionEngine）
class ForgekinSpecies(Enum): ...  # 灵智体形态分类

# 模块名：使用 forgemind / forgekin
flowforge/forgemind/              # 应用层
flowforge/core/forgekin/          # 核心层灵智体能力

# 文档/UI：使用 ForgeMind / 灵智
VISION.md                         # 万物灵智体愿景
README.md                         # "灵智体锻造厂"
```

---

## 后果

### 正面后果

- 命名统一，消除文档间术语不一致
- "灵智"对 B 端/非技术用户更友好
- 代码与文档对齐（Forgekin 代码层 / ForgeMind 文档层）
- 废弃 v4.0 自创术语，与 v7.0 FR-EVO 体系对齐

### 负面后果

- 需要全局替换多个文件（Phase 0 工作量增加）
- 旧代码可能引用废弃命名（需要兼容期）
- 第三方文档（如 clowder-ai）可能仍用旧命名

### 风险

- 替换可能遗漏（缓解：grep 全局检查 + T7 LLM 审核）
- 旧代码兼容期可能产生命名混用（缓解：明确废弃时间表）

---

## 替代方案

### 方案 A: 保持"炉灵 Forgekin"主名

- 优点：减少替换工作量
- 缺点：B 端/非技术用户难以理解
- 未选择原因：operator 决策"灵智"为最终形态

### 方案 B: 用"Mind Artisan"作为主名

- 优点：英文友好
- 缺点：中文用户难记
- 未选择原因：operator 废弃"E6 灵匠 Mind Artisan"

### 方案 C: 不统一命名，各文档自治

- 优点：零工作量
- 缺点：命名混乱持续，文档间引用困难
- 未选择原因：违反真相源唯一原则

---

## 引用

- `[doc:review/review.md#第六章]` — 育灵体系命名融合方案
- `[doc:VISION.md#7]` — operator 愿景锚点第 5 条（命名最终形态为"灵智"）
- `[doc:design/naming-contract.md]` — 命名契约（详细）
- `[doc:project_rules.md#红线11]` — 禁止硬编码
