# ADR 008: 多域记忆联邦

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: 架构师可进化智能体 + operator 审核
> **依赖**: `[doc:roleagent.md#第4章]` + `[doc:review/review.md#第八章]` RA-024~RA-030 + `[doc:review/review.md#第十三章]` CL-009
> **依据**: RA-024~RA-030（多域记忆联邦六层 + 三检索入口 + 治理三要素 + 消费加权排序）+ CL-009（三路记忆 Canon / Relational / Session）

---

## 上下文

`[doc:roleagent.md#第4章]` 一句话论点："很多 RAG 输给 grep"。grep 赢在当前性、精确性、可审计性，但 RAG 假设所有记忆都是同质的向量空间——这是 RAG 的根本缺陷。FlowForge v4.0 的现状（`[doc:review/review.md#第八章]` 8.4 节 RA-024~RA-030 共 7 项问题，5 项 P0）：

- 情景记忆存储（EchoStore）基于 sqlite-vec 向量检索 + 关键词 BM25，**这是典型 RAG 架构**（RA-024 P0）
- 完全无 Collection（知识域）概念，所有记忆混在一个 store 里
- 只有语义搜索一个入口（RA-025 P0），可进化智能体从上下文压缩恢复后无法快速"发生了什么"
- 记忆无权威等级、无触发方式、无生命周期（RA-026 P0），过期知识可能永远排在前面
- 完全无消费加权排序反馈闭环（RA-027 P0），靠向量相似度 + 时间衰减，无法识别"长期没被使用的知识应降权"
- 无冷启动保护（RA-028 P1），新知识可能因向量距离远永远排不到前面
- 蒸馏知识库（MindCodex）未建成可检索知识库，仍是固定 prompt 模板（RA-029 P0）
- 外部检索引擎在 QueryUnderstandingStage 用 LLM 改写查询（RA-030 P1），违反"简单系统 + 聪明可进化智能体"原则

`[doc:review/review.md#第十三章]` 13.2 节 CL-009 进一步补审：前期世界引擎三层架构（已归档）定义三路记忆——Canon（典藏，永久，世界级真相）/ Relational（关系，长期，角色间互动）/ Session（会话，临时，单次回合）。铁律："RP 台词不自动入典"——Role Play 中可进化智能体说的话不能自动进入 Canon 记忆，必须经过 Canon Sync 协议显式确认。v7.0 EchoStore 是单一记忆库，临时会话记忆污染永久典藏，无法实现此铁律。

operator 决策：FlowForge 必须实现六层多域记忆运行时 + 三检索入口 + 消费加权排序 + 贝叶斯收缩 + 中心化偏移 + 分数时效衰减 + 三路记忆区分。

---

## 决策

### 1. 六层多域记忆运行时（F014-F017 + F039）

| 层 | 内容 | 存续时间 | Feature |
|---|---|---|---|
| L1 工作记忆 | 当前任务上下文 | 单 session | （进程内 cache） |
| L2 Episode | 具体任务经历（情景记忆存储（EchoStore）） | 跨 session | F014 |
| L3 Skill | 可加载知识包（skill_packages） | 跨可进化智能体 | F014 |
| L4 Collection | 沉淀领域知识（知识域隔离） | 跨项目 | F014 |
| L5 蒸馏知识库（MindCodex） | 蒸馏经验（蒸馏知识库） | 跨代际 | F039 |
| L6 文化 | 团队规范（rules.md / prompts.md） | 永久 | （文档层） |

### 2. 三路记忆区分（CL-009，F093 铁律）

参考前期世界引擎三层架构（已归档）的三路记忆：

| 路径 | 用途 | 持久性 | 写入规则 |
|---|---|---|---|
| **Canon** | 典藏记忆，世界级真相 | 永久 | 必须经 Canon Sync 协议显式确认，**禁止 RP 台词自动入典** |
| **Relational** | 关系记忆，可进化智能体间互动 | 长期 | 由互动事件自动写入 |
| **Session** | 会话记忆，单次回合 | 临时 | 自动写入，回合结束清除（除非升级为 Relational） |

```python
class ThreeTrackMemory:
    canon: CanonStore           # 永久真相源
    relational: RelationalStore  # 长期互动
    session: SessionStore        # 临时会话

    def on_utterance(self, utterance: Utterance, source: str):
        if source == "role_play":
            self.session.write(utterance)   # 仅入 session，不入 canon
        elif source == "canon_sync_approved":
            self.canon.write(utterance)     # 显式确认才入 canon
```

### 3. 三检索入口（F015，RA-025）

不同认知模式走不同路：

| 入口 | 用途 | 实现 |
|---|---|---|
| `graph_resolve` | 精确导航（知道找什么，展开 1-3 跳邻居） | 字段查询 + 图遍历 |
| `list_recent` | 零先验扫描（刚从压缩恢复，按时间倒序列最近文档） | 时间倒序 |
| `search_evidence` | 语义搜索（知道方向但不知锚点） | BM25 + 向量混合 + 治理元数据 |

可进化智能体从上下文压缩恢复后，先调 `list_recent` 快速重建上下文，再调 `graph_resolve` / `search_evidence` 深入。

### 4. 治理层三要素（F016，RA-026）

每条记忆必须携带治理元数据：

```python
class MemoryGovernance:
    authority: AuthorityLevel   # 铁律 / 已验证决策 / 候选观察
    activation: ActivationMode  # 永远在场 / 按任务范围 / 只在查询时出现
    status: MemoryStatus        # 有效 / 待复核 / 已失效 / 归档
    expires_at: datetime | None # 生命周期
```

旧记忆和新记忆不再一视同仁排序，过期知识自动降权或归档。

### 5. 消费加权排序（F017，RA-027）

不用 LLM 自评打分，用可进化智能体真实行为（搜了 / 读了 / 用了）判断知识价值。14 个行为指标汇聚成消费加权排序：

```
调整后得分 = 融合检索得分
            + 权威加成
            + 消费先验
            + 时效衰减
            - 过时惩罚
```

行为指标包括：被引用次数、被复用次数、解决问题次数、失败引用次数、最近引用时间、引用可进化智能体多样性等。

### 6. 贝叶斯收缩 + 中心化偏移 + 分数时效衰减（RA-028）

防止冷启动偏热点和长尾保护：

- **贝叶斯收缩**：新知识不因没被搜过就被埋底——基于先验分布 + 观测次数调整，观测次数少时收缩到先验均值
- **中心化偏移**：减去同类知识平均消费率，允许负信号（被多次失败引用的知识应负分）
- **分数时效衰减**：旧知识不因近期没被搜就归零——按知识类型设置半衰期，而非线性衰减

```python
def adjusted_score(raw_score: float, observations: int, prior: float,
                   peer_mean: float, age_days: int, half_life_days: int) -> float:
    shrunk = (observations * raw_score + PRIOR_WEIGHT * prior) / (observations + PRIOR_WEIGHT)
    centered = shrunk - peer_mean
    decayed = centered * (0.5 ** (age_days / half_life_days))
    return decayed
```

### 7. 检索驱动的适配循环（RA-029，F039）

蒸馏知识库（MindCodex）必须建成**可检索知识库**，而非固定 prompt 模板。检索循环 vs 训练循环：

| 维度 | 检索循环 | 训练循环 |
|---|---|---|
| 生效时机 | 即时 | 下次训练后 |
| 跨厂商通用 | 是 | 否（每家厂商独立训练） |
| 灾难性遗忘 | 无 | 有 |
| 可审计性 | 完全（每次检索可追溯） | 弱 |

FlowForge 选检索驱动适配循环，蒸馏知识库条目可跨可进化智能体共享、即时生效、可审计回滚。

### 8. 简单系统 + 聪明可进化智能体原则（RA-030）

查询扩展由可进化智能体用自己的领域知识做，**不在检索引擎里加 regex 规则或小模型做意图分类**。外部检索引擎的 QueryUnderstandingStage 必须移除（已在 `[doc:project_rules.md]` 记录：检索引擎 /api/v1/retrieve 因 QueryUnderstandingStage LLM 调用耗时 90s 超时）。检索引擎只做检索 + 排序 + 治理元数据，意图理解交给可进化智能体。

### 9. 与 Pack 系统联动（CL-018）

参考前期 Pack 系统设计（已归档），蒸馏知识库条目可打包为 Pack 跨可进化智能体共享。Pack = 可分享的蒸馏知识库子集，由 SpiritForge（经验蒸馏）把高价值 Growth 蒸馏为 Pack（见 ADR 011 伙伴系统数学）。

---

## 后果

### 正面后果

- 记忆从"同质向量空间"升维到"六层多域 + 三路区分"的结构化联邦
- 三检索入口覆盖三种认知模式，可进化智能体从压缩恢复后可快速重建上下文
- 治理元数据让旧记忆自动归档，过期知识不再永远排前面
- 消费加权排序用真实行为判断知识价值，不用 LLM 自评
- 贝叶斯收缩保护冷启动新知识，中心化偏移允许负信号
- 检索驱动适配循环即时生效、跨厂商通用、无灾难性遗忘
- RP 台词不自动入典铁律让虚拟角色可进化智能体不被角色扮演污染核心身份

### 负面后果

- 六层多域架构增加实现复杂度（4 个 Feature F014-F017 + F039）
- 治理元数据每条记忆都要维护，记忆写入开销增加
- 三路记忆区分需要重构 EchoStore（破坏性变更）
- 消费加权排序需要积累 14 个行为指标，初期数据稀疏
- 移除外部检索引擎 QueryUnderstandingStage 影响现有检索行为（需迁移）

### 风险

- 多域联邦跨 store 一致性风险 —— 缓解：SharedStateLedger 走 Tier 2 恢复（见 ADR 010）
- 消费加权排序可能被恶意行为操纵（可进化智能体故意多次引用某条记忆）—— 缓解：跨可进化智能体引用多样性加权
- RP 台词不自动入典可能让虚拟角色可进化智能体记忆"太干净" —— 缓解：Canon Sync 协议允许 operator 显式批准入典
- 贝叶斯收缩先验参数难调 —— 缓解：与 ADR 009 Eval 自代谢联动，先验参数随 Eval 信号调整

---

## 替代方案

### 方案 A: 保持 RAG 架构（sqlite-vec + BM25）

- 优点：实现简单，已有代码
- 缺点：无知识域隔离、无权威等级、无消费加权（RA-024~RA-027 共 4 项 P0 未解决）
- 未选择原因：roleagent.md 明确"很多 RAG 输给 grep"

### 方案 B: 把所有记忆作为 Canon（无 Session 区分）

- 优点：治理简单
- 缺点：临时会话污染永久典藏，违反 CL-009 铁律
- 未选择原因：虚拟角色可进化智能体会被 RP 污染核心身份

### 方案 C: 用 LLM 在线评估每条记忆价值

- 优点：灵活
- 缺点：每次检索都要 LLM 调用，延迟高 + 成本高
- 未选择原因：性能不可接受，且 LLM 自评不可审计

### 方案 D: 用训练循环替代检索循环

- 优点：知识内化到模型权重
- 缺点：不能跨厂商通用、有灾难性遗忘、不可审计
- 未选择原因：违反 RA-029 检索驱动适配循环设计

---

## 引用

- `[doc:roleagent.md#第4章]` — 团队记忆：从 grep 到多域知识联邦
- `[doc:review/review.md#第八章]` 8.4 节 — RA-024~RA-030 多域记忆联邦补审（7 项，5 P0）
- `[doc:review/review.md#第十三章]` 13.2 节 — CL-009 三路记忆（Canon / Relational / Session）
- `[doc:features/F014-memory-collection.md]` — 多域记忆 Collection
- `[doc:features/F015-three-retrieval-entry.md]` — 三检索入口
- `[doc:features/F016-memory-governance.md]` — 记忆治理三要素
- `[doc:features/F017-consumption-weighted-ranking.md]` — 消费加权排序
- `[doc:features/F039-mind-codex-searchable.md]` — 蒸馏知识库可检索知识库
- 前期世界引擎三层架构（已归档） — 三路记忆 + RP 台词不自动入典铁律
- 前期 Pack 系统设计（已归档） — Pack 系统经验可移植
- `[doc:decisions/007-harness-engineering.md]` — Harness 工程路径（Durable State Surfaces 持有记忆联邦）
- `[doc:decisions/009-eval-self-metabolism.md]` — Eval 自代谢（消费加权信号来源）
- `[doc:decisions/010-distributed-reliability.md]` — 分布式可靠性（SharedStateLedger 跨 store 一致性）
- `[doc:decisions/011-partnership-math.md]` — 伙伴系统数学（Pack 共享机制）
- `[doc:design/naming-contract.md#2.5]` — EchoStore（情景记忆存储）
- `[doc:design/naming-contract.md#2.7]` — SpiritForge（经验蒸馏）
- `[doc:design/naming-contract.md#2.8]` — MindCodex（蒸馏知识库）
- `[doc:project_rules.md]` — 外部检索引擎 QueryUnderstandingStage 必须移除
