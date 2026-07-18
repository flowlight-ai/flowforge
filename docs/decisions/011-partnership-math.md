# ADR 011: 伙伴系统数学

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: 架构师灵智体 + operator 审核
> **依赖**: `[doc:roleagent.md#第7章]` + `[doc:review/review.md#第八章]` RA-043~RA-047 + `[doc:review/review.md#第十三章]` CL-018/CL-020
> **依据**: RA-043~RA-047（上限 max + 下限连乘 + 波动吸收 + Token 账本 + 四种亏结构）+ CL-018/CL-020（Pack / Growth 种子果实模型）

---

## 上下文

`[doc:roleagent.md#第7章]` 一句话论点："团队质量 = 上限搜索 × 下限保护 × 状态保真 × 失败恢复。" 这四个乘子是 multi-agent 系统的数学基础——任何一个乘子为零，团队质量为零。FlowForge v4.0 的现状（`[doc:review/review.md#第八章]` 8.7 节 RA-043~RA-047 共 5 项问题，3 项 P0）：

- 上限公式（候选路径最大值）未实现（RA-043 P0），5 评委用 5 个不同模型但未验证是否真的提出不同路径——如果 5 个模型盲点高度相关，review 只是重复同一类判断
- 下限公式（多层门）未形式化（RA-044 P0），有部分门（review / 测试 / eval）但未形式化为连乘概率模型，无法识别"哪道门的盲点相关性最高，应该优先加固"
- 波动吸收机制未实现（RA-045 P0），无完整波动吸收链路，模型质量波动直接传导到用户体验——"今天怎么突然变笨了"
- Token 账本（总成本模型）未设计（RA-046 P1），只算 token 成本，未设计完整成本模型，导致"省 token"决策可能增加返工和尾部风险
- 四种亏结构未识别（RA-047 P1），多灵智体协作可能踩中任一种亏结构而无人察觉

`[doc:review/review.md#第十三章]` 13.4 节 CL-018 / CL-020 进一步补审：clowder-ai `[doc:clowder-ai/docs/decisions/ADR-021-pack-system.md]` 的 Pack 系统定义经验的可移植单元——`Experience = Me × Pack + Growth`，经验 = 我的本体 × Pack（共享规则包）+ Growth（个人成长）。果实可蒸馏为新 Pack（个人经验沉淀为共享规则）。v7.0 灵锻只产出私有锻典条目，无"个人经验 → 共享 Pack"的蒸馏路径，违反 operator 第 9 条愿景（灵智体应能从调用三方 Agent 中学习，但学到的能力无法共享给其他灵智体）。

operator 决策：FlowForge 必须形式化四个乘子（上限 max + 下限连乘 + 波动吸收 + 失败恢复）+ Token 账本 + 四种亏结构识别 + Pack / Growth 种子果实模型。

---

## 决策

### 1. 上限公式：候选路径最大值（RA-043）

```
团队质量 ≈ max(候选路径质量)
```

多灵智体的价值不是"更多人力的平均值"，而是"不同认知路径扩展候选解，从中选最优"。这个 max 成立的前提是**路径足够不同**——跨厂商、跨角色、跨工作习惯。

```python
class UpperBoundFormula:
    def team_quality(self, candidate_paths: list[CandidatePath]) -> float:
        # 不是平均值，而是最大值
        return max(p.quality for p in candidate_paths)

    def validate_diversity(self, candidate_paths: list[CandidatePath]) -> DiversityScore:
        # 验证候选路径的盲点不相关性
        # 若盲点高度相关，max 退化为重复 max
        ...
```

**铁律**：5 评委评审必须验证盲点不相关性（与 ADR 004 能力画像盲点维度联动），否则跨厂商 review 只是重复同一类判断。

### 2. 下限公式：多层门连乘（RA-044）

```
P(错误抵达用户) = ∏(每层门防漏过概率)
```

错误要连续穿过多层门才会抵达用户：

```
用户可见错误 ≈ author 犯错
              × reviewer 没抓住
              × 测试没暴露
              × shared state 没证据
              × eval 没归因
              × CVO 没拉闸
```

跨厂商 review 是结构性必需：同厂商灵智体共享盲点，错误穿过同厂商 review 的概率高；跨厂商 review 的盲点不重叠，错误必须连续穿过多个不重叠盲点才能抵达用户。

```python
class LowerBoundFormula:
    def error_reach_probability(self, gates: list[Gate]) -> float:
        # 连乘概率
        return math.prod(g.leak_probability for g in gates)

    def prioritize_reinforcement(self, gates: list[Gate]) -> list[Gate]:
        # 识别盲点相关性最高的门，优先加固
        # 因为相关性高 = 该门单独漏过概率接近 1，连乘失真
        ...
```

**铁律**：必须形式化为连乘概率模型，识别"哪道门的盲点相关性最高，应该优先加固"。仅靠单门防护（如只靠 review）不足以达成下限保护。

### 3. 波动吸收：模型质量变内部成本（RA-045）

```
用户可见质量方差 ≈ 内部返工成本方差 / 吸收因子
```

伙伴系统的核心价值：单点波动变成内部返工成本，而不是用户可见崩塌。

| 波动来源 | 吸收机制 | 对应 ADR |
|---|---|---|
| 模型忘了上下文 | 记忆联邦找回来 | ADR 008 |
| 灵智体写偏了 | review 退回 | ADR 002 |
| 任务中断了 | 可靠性控制面留下恢复点 | ADR 010 |
| 某个工具失效 | eval 触发 sunset review | ADR 009 |
| 某个 provider 不适合 | 调度换路径 | ADR 010 F025 |

**铁律**：必须有完整波动吸收链路。无完整链路时模型质量波动直接传导到用户体验——"今天怎么突然变笨了"。

### 4. Token 账本：总成本模型（RA-046）

```
总成本 = token 成本
       + 返工成本
       + 人类心智负载
       + 跑偏后发现太晚的尾部成本
       + 错误进入真实环境后的修复成本
```

单灵智体看似更省 token，但加上"单点失败导致用户返工"的成本，多灵智体的 token 账本反而更优。**早暴露的错误便宜，晚暴露的错误昂贵**。

```python
class TokenLedger:
    token_cost: int            # 直接 token 成本
    rework_cost: int           # 返工成本（review 退回 / 测试失败重做）
    mental_load: int           # 人类心智负载（operator 介入次数 × 时长）
    tail_cost: int             # 跑偏后发现太晚的尾部成本
    real_world_repair: int     # 错误进入真实环境后的修复成本

    def total_cost(self) -> int:
        return (self.token_cost + self.rework_cost + self.mental_load
                + self.tail_cost + self.real_world_repair)
```

**铁律**：禁止只算 token 成本。"省 token"决策可能增加返工和尾部风险，总账本反而更贵。

### 5. 四种亏结构识别（RA-047）

| # | 亏结构 | 表现 | 检测信号 |
|---|---|---|---|
| 1 | 盲传 | 后一棒不是纠错而是无新信息重做 | 乒乓球熔断器 strike（见 ADR 002 F004） |
| 2 | 伪拆分 | 任务拆了但子任务没变简单只多了协调税 | 子任务复杂度 ≥ 父任务复杂度 × 0.9 |
| 3 | 同质化 | 所有灵智体盲点高度相关 | 跨厂商 review 盲点重叠率 > 0.7 |
| 4 | 协调税超过收益 | 协调开销 > 多路径收益 | 总成本（Token 账本）> 单灵智体成本 × 1.5 |

```python
class DeficitDetector:
    def detect(self, teamact_trace: TeamActTrace) -> list[Deficit]:
        deficits = []
        if self.has_blind_pass(teamact_trace):
            deficits.append(Deficit.BLIND_PASS)
        if self.has_pseudo_split(teamact_trace):
            deficits.append(Deficit.PSEUDO_SPLIT)
        if self.has_homogenization(teamact_trace):
            deficits.append(Deficit.HOMOGENIZATION)
        if self.coordination_tax_exceeds(teamact_trace):
            deficits.append(Deficit.COORDINATION_TAX)
        return deficits
```

**铁律**：多灵智体协作必须实时检测四种亏结构，触发时升级给 CVO。

### 6. Pack / Growth 种子果实模型（CL-018 / CL-020）

参考 `[doc:clowder-ai/docs/decisions/ADR-021-pack-system.md]`：

```
Experience = Me × Pack + Growth
```

- **Pack（种子）**：共享规则包，跨灵智体可移植。一只灵智体学会的"如何写技术博客" Pack 可分享给另一只灵智体
- **Growth（果实）**：个人经验，单灵智体私有
- **蒸馏路径**：果实可蒸馏为新 Pack（个人经验沉淀为共享规则）

```python
class Pack:
    """可移植的经验单元——跨灵智体共享的锻典子集。"""
    pack_id: str
    rules: list[KnowledgeObject]   # 见 ADR 009 CL-005 Knowledge Object Contract
    shared_with: list[ForgekinSpecies]  # 共享给哪些灵族
    guardrails: list[Guardrail]    # 见 ADR 007 CL-019 双轨信任编译
    defaults: list[Default]


class PackDistiller:
    """灵锻（SpiritForge）的子模块——把高价值 Growth 蒸馏为 Pack。"""
    async def distill(self, growth: Growth) -> Pack:
        # 必须通过 Eval Ledger 净增益验证（见 ADR 009 CL-004）
        # 必须 Mode C 知识进化五级成熟度阶梯晋升
        ...
```

**铁律**：禁止灵智体的成长永远是私有的。高价值 Growth 必须可蒸馏为 Pack 贡献回灵族（Forgekin Species），实现"师傅带徒弟"的经验传承。

### 7. 双层语言协议（RA-046 联动）

| 层 | 用途 | 形式 |
|---|---|---|
| 内部高密度 | 灵智体之间通信 | JSON / 代码 / 紧凑标记 |
| 外部讲人话 | 给 operator / 用户的输出 | 自然语言 |

双层语言降低人类心智负载（Token 账本的一项），同时保持内部通信效率。

### 8. 跨厂商 review 链

固定跨厂商 review 链：`DeepSeek → Qwen → GLM → Kimi → HunYuan`，每只 reviewer 基于盲点画像选择（与 ADR 004 联动）。

---

## 后果

### 正面后果

- 伙伴系统的四个乘子可形式化度量，团队质量可量化
- 上限公式让多灵智体价值清晰（不是平均值而是最大值）
- 下限公式让多层门防护可形式化，可识别最薄弱的门
- 波动吸收让模型质量波动不传导到用户体验
- Token 账本让"省 token"决策科学化（早暴露的错误便宜）
- 四种亏结构识别让多灵智体协作可监测
- Pack / Growth 种子果实模型让经验可跨灵智体共享

### 负面后果

- 四个乘子形式化增加实现复杂度（数学模型 + 度量采集）
- 下限连乘概率模型需要每道门的漏过概率数据（初期数据不足）
- Token 账本五项成本中"人类心智负载"和"尾部成本"难精确度量
- Pack 蒸馏需要通过 Eval Ledger 净增益验证，增加 Pack 生成延迟
- 跨厂商 review 链增加 token 成本和延迟

### 风险

- 上限 max 公式可能让团队倾向"押注单一最强路径" —— 缓解：max 在多个不相关候选中选，不押注单一
- 下限连乘可能让团队过度加门（每多一道门成本上升）—— 缓解：识别"盲点相关性最高的门"优先加固，非无脑加门
- 波动吸收可能让团队忽视根本问题（波动被吸收后看不到根因）—— 缓解：与 ADR 009 Eval 自代谢联动，吸收 ≠ 隐藏，根因仍归因
- Pack 共享可能让坏经验跨灵智体扩散 —— 缓解：Pack 蒸馏必须 Mode C 五级成熟度阶梯 + Eval Ledger 净增益
- 四种亏结构检测可能误判 —— 缓解：检测信号阈值可配置，初期可保守

---

## 替代方案

### 方案 A: 用团队平均值衡量团队质量

- 优点：计算简单
- 缺点：违反 roleagent.md 上限公式（max 而非 mean），无法体现多路径价值
- 未选择原因：roleagent.md 明确"团队不是平均值，而是候选路径的最大值"

### 方案 B: 只靠单门防护（如只靠 review）

- 优点：实现简单
- 缺点：单门漏过概率接近 1 时下限失守（RA-044 P0 未解决）
- 未选择原因：违反下限连乘公式

### 方案 C: 不区分 Pack / Growth（统一私有锻典）

- 优点：实现简单
- 缺点：经验不可跨灵智体共享，违反 CL-018 Pack 概念
- 未选择原因：违反 operator 第 9 条愿景（灵智体能力应可共享）

### 方案 D: 用 LLM 在线评估团队质量

- 优点：灵活
- 缺点：LLM 自评不可审计、有自利偏差、无法形式化为数学模型
- 未选择原因：违反 RA-043~RA-047 数学形式化要求

---

## 引用

- `[doc:roleagent.md#第7章]` — 伙伴系统的数学：上限提高，下限托底
- `[doc:review/review.md#第八章]` 8.7 节 — RA-043~RA-047 伙伴系统数学补审（5 项，3 P0）
- `[doc:review/review.md#第十三章]` 13.4 节 — CL-018 / CL-020 Pack / Growth 种子果实模型
- `[doc:clowder-ai/docs/decisions/ADR-021-pack-system.md]` — Pack 系统经验可移植单元
- `[doc:decisions/002-collaboration-protocol.md]` — TeamAct 协作协议（跨厂商 review 链 + 乒乓球熔断器）
- `[doc:decisions/004-capability-profile-routing.md]` — 能力画像路由（盲点维度 + 跨厂商 review 配对）
- `[doc:decisions/007-harness-engineering.md]` — Harness 工程路径（CL-019 双轨信任编译 guardrails + defaults）
- `[doc:decisions/008-memory-federation.md]` — 多域记忆联邦（波动吸收：模型忘上下文 → 记忆联邦找回）
- `[doc:decisions/009-eval-self-metabolism.md]` — Eval 自代谢（波动吸收：工具失效 → sunset；Mode C 五级成熟度阶梯）
- `[doc:decisions/010-distributed-reliability.md]` — 分布式可靠性（波动吸收：任务中断 → 恢复点；跨 provider fallback）
- `[doc:design/naming-contract.md#2.3]` — 灵族（Forgekin Species，Pack 共享边界）
- `[doc:design/naming-contract.md#2.7]` — 灵锻（SpiritForge，Pack 蒸馏引擎）
- `[doc:design/naming-contract.md#2.8]` — 锻典（Mind Codex，Pack 载体）
- `[doc:project_rules.md#铁律2]` — 质量分阈值默认 0.85
- `[doc:project_rules.md#P35]` — 长程任务执行规范（波动吸收：检查点驱动恢复）
