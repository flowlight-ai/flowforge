# ADR 011: 伙伴系统数学（Partnership System Math）

> **状态**: accepted
> **日期**: 2026-07-21
> **决策者**: operator + 架构师可进化智能体（Forgekin）
> **依赖**: `[doc:roleagent.md#第7章]` + `[doc:decisions/004-capability-profile-routing.md]` + `[doc:decisions/009-eval-self-metabolism.md]`
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第7章伙伴系统数学

---

## 1. 上下文

`[doc:roleagent.md#第7章]` 开篇提出："好的 agent harness 系统不是把单点能力推到极限，而是把单点波动组织进一个会自我校准的伙伴系统。" 这句话把多智能体协作的工程价值定位为四件事：上限搜索、下限保护、状态保真、失败恢复。前三件需要数学形式化，否则会退化为"几只 agent 凑在一起更靠谱"的口号。

当前 FlowForge 设计中：

- 多 agent 协作缺少可计算的"上限"概念，团队选择候选路径时没有形式化的最大净期望
- 缺少"下限"模型，无法回答"为什么用户感知错误率低于单 agent 错误率"
- 缺少"波动吸收"机制，provider 降级或 token 价格波动会直接传导给用户
- 缺少"Token 账本"，无法回答"三只 agent 协作比一只更省还是更贵"

roleagent.md 第7章给出四个工程直觉公式（上限 max、下限连乘门、波动吸收比例、Token 总成本包含返工与尾部风险），但缺乏可在运行时调用的可执行实现。本 ADR 把这些直觉落为 `flowforge.core.partnership` 包下的四个 LLM-free、确定性、可单测的模块。

本 ADR 是 P1 决策，术语对齐项目正式命名（详见 `[doc:decisions/012-naming-fusion.md]`）：智能体主体称为可进化智能体（Forgekin），跨厂商群体审议称为多智能体议事（MindCouncil），伙伴系统数学是 Forgekin 协作的"算盘"。

---

## 2. 决策

伙伴系统数学由四个独立模块构成，分别承担 roleagent.md 第7章的四个工程直觉公式。所有模块位于 `flowforge.core.partnership` 包下，依赖仅限 `flowforge.core.errors` 与 `flowforge.core.tracing`，可单测、可被多智能体议事 MindCouncil 在运行时调用。

### 2.1 上限取最大（Upper Bound = max of candidate paths）

`[doc:roleagent.md#第7章]`："团队不是平均值，而是候选路径的最大值。" 同质化团队的失败不是 agent 少，而是路径相关性高；跨厂商、跨角色、跨工作习惯才降低盲点相关性。

公式：

```
upper_bound = max(c.expected_value * c.probability - c.cost
                  for c in candidates)
```

代码实现：`UpperBoundCalculator.compute(candidates: list[CandidatePath]) -> UpperBoundResult`。

- `CandidatePath`（frozen dataclass）：`path_id`、`expected_value`（≥0）、`probability`（∈[0,1]）、`cost`（≥0，默认 0.0）
- `net_expected()`：`expected_value * probability - cost`
- 选路策略：主键 `net_expected()`，次键 `-cost`——相同净期望时优先低成本路径；全键相同时 `max` 返回首次出现，确定性强
- 边界：候选为空时返回 `upper_bound=0.0`、`best_path_id=None`、`explanation="no candidate paths provided"`
- 输出：`UpperBoundResult`（`upper_bound`、`best_path_id`、`expected_max`、`explanation`）

上限是"伙伴系统最乐观能保证什么"的代理：现实只会更差（可能选了次优路径，或概率未实现），但不会比这条最优路径的净期望更高。

### 2.2 下限连乘（Lower Bound = product of probabilities）

`[doc:roleagent.md#第7章]`："错误要连续穿过多层门，才会抵达用户。" 旧版 Ch.7 的 reviewer 数学作为局部模型被吸收进来：`P(最终正确) = author 正确且 reviewer 不误伤 + author 错误但 reviewer 抓住并修正`。简化为门链模型：

公式：

```
lower_bound = product(g.pass_probability for g in gates)
              * min(g.threshold for g in gates if g.pass_probability > 0)
```

代码实现：`LowerBoundCalculator.compute(gates: list[QualityGate]) -> LowerBoundResult`。

- `QualityGate`（frozen dataclass）：`gate_id`、`threshold`（∈[0,1]）、`pass_probability`（∈[0,1]）
- 门通过条件：`pass_probability > 0`
- 关键边界：任一门 `pass_probability == 0` → 整条链路坍塌为 `lower_bound=0.0`，该门记入 `failed_gates`；其余通过的门仍记入 `passed_gates`，便于多智能体议事 MindCouncil 归因到具体门
- 无门时 `lower_bound=0.0`（"未建立质量底"而非"质量为 1.0"，避免无门即安全的错觉）
- 全部门通过：`pass_probability` 连乘 × `min(threshold)`——最严门决定下限坡度
- 输出：`LowerBoundResult`（`lower_bound`、`passed_gates`、`failed_gates`、`explanation`）

下限模型不是严格独立事件概率公式，roleagent.md 明确声明这是工程事实而非精确概率：只要门的盲点不完全相关，最终错误率就不会等于单个 agent 的错误率。

### 2.3 波动吸收（Variance Absorption）— 风险分散

`[doc:roleagent.md#第7章]`："波动吸收：模型质量变成内部成本，而不是用户可见崩塌。" 用户感知质量 = 模型能力 × harness 契合度 × 纠错链路 × 恢复能力。波动先被 harness 吸收，余量才传导给用户。

公式：

```
internal_variance   = pvariance(prices)
absorbed_variance   = absorption_ratio * internal_variance
passed_to_user      = (1 - absorption_ratio) * internal_variance
user_would_collapse = passed_to_user > user_collapse_threshold
```

代码实现：`VarianceAbsorber.compute_absorption(prices: list[float], user_collapse_threshold: float) -> AbsorptionResult`。

- 默认吸收比：`DEFAULT_ABSORPTION_RATIO = 0.7`（70% 内部吸收，30% 传导用户）
- `absorption_ratio` 必须在 `[0.0, 1.0]`，越界抛 `PartnershipError`
- `user_collapse_threshold` 必须 ≥0，否则抛 `PartnershipError`
- 使用标准库 `statistics.pvariance`，无 numpy/scipy 依赖；样本数 <2 时方差为 0
- 输出：`AbsorptionResult`（`absorbed_variance`、`passed_to_user`、`user_would_collapse`、`recommendation`）
- 当 `passed_to_user > threshold` 时 `recommendation="increase absorption ratio"`，否则 `"stable"`

`VarianceAbsorber` 是伙伴系统的"减震器"：单点波动先变成系统内部的返工成本，而不是用户可见的质量崩塌。

### 2.4 Token 账本（Token Ledger）— 成本追踪与结算

`[doc:roleagent.md#第7章]`："Token 账本：单 agent 真的更省吗？" 单 agent 看似便宜，但完整成本应是 token + 返工成本 + 人类心智负载 + 跑偏后发现太晚的尾部成本 + 错误进入真实环境后的修复成本。

公式：

```
net_amount(A→B) = Σ(amount where from=A, to=B)
                - Σ(amount where from=B, to=A)

balance(P) = Σ(received by P) - Σ(sent by P)
```

代码实现：`TokenLedger`（append-only ledger）。

- `TokenEntry`（dataclass）：`from_partner`、`to_partner`、`amount`（≥0）、`reason`、`entry_id`（自动生成 `te-<uuid12>`）、`created_at`（UTC）、`settled`（默认 False）
- 约束：`from_partner != to_partner`，空字符串与自环均抛 `PartnershipError`
- 方法：
  - `record_entry(entry: TokenEntry) -> str`：追加一条转账记录，返回 `entry_id`
  - `get_balance(partner_id: str) -> float`：净余额 = 收到 - 发出；正=债权人（被欠），负=债务人
  - `list_entries(partner_id: str | None = None) -> list[TokenEntry]`：列表查询，可按伙伴过滤
  - `settle(partner_a, partner_b) -> SettlementResult`：批量结算两方所有未结算条目，返回 `net_amount` 与 `settled_entries`
- 输出：`SettlementResult`（`from_partner`、`to_partner`、`net_amount`、`settled_entries`）

`TokenLedger` 是回答"协作是否赚"的会计账本——它不替代 `[doc:decisions/009-eval-self-metabolism.md]` 的 eval 控制面，但为 eval 提供可对账的 Token 流水，让"协作赚就保留、不赚就收缩"成为可计量的判断而非信仰。

### 2.5 CandidatePath 与选路策略

`CandidatePath` 是上限公式的输入契约，本身是 frozen dataclass，校验逻辑写在 `__post_init__`：空 `path_id`、负 `expected_value`、超界 `probability`、负 `cost` 均抛 `PartnershipError`。

选路策略遵循 roleagent.md 第7章"这只 agent 有没有带来其他 agent 不会自然带来的视角"的判断——`UpperBoundCalculator` 不替模型思考"视角是否互补"，只把每个候选的净期望摆出来，由调用方（通常是被多智能体议事 MindCouncil 包装的 `CapabilityRouter`，见 `[doc:decisions/004-capability-profile-routing.md]`）决定是否扩展候选集。

四个模块共同构成 roleagent.md 第7章收束公式 `团队质量 = 上限搜索 × 下限保护 × 状态保真 × 失败恢复` 的可计算实现——上限、下限、波动吸收三件直接对应代码模块，状态保真与失败恢复由 `[doc:decisions/009-eval-self-metabolism.md]` 与可靠性控制面（ADR-010 路径）承担。

---

## 3. 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **方案 A（选定）: 四模块独立 + 确定性公式 + LLM-free** | 可单测、可被多智能体议事 MindCouncil 运行时调用、不依赖任何 provider；公式与 roleagent.md 第7章一一对应；模块互不耦合，可独立演进 | 公式偏简化（连乘门假设近似独立），不能完全建模盲点相关性；需要上层 eval 补齐 |
| 方案 B: 用 LLM 在线评估上限/下限 | 可处理语义模糊的候选与门 | 每次 TeamAct 循环都要 LLM 调用，延迟与成本不可接受；无法保证可复现；违反 operator 第7条"未实现即 Bug"原则（无 oracle 即无验证） |
| 方案 C: 只实现上限，下限/波动/账本用日志推断 | 实现最简 | 违反 roleagent.md 第7章核心主张（下限连乘、波动吸收、Token 账本是三件独立的事）；无法回答"用户感知错误率为何低于单 agent" |
| 方案 D: 把数学塞进 CapabilityRouter 内部 | 路由层一站式 | 违反"组合优于继承"原则（编程红线第9条）；数学模块与路由策略耦合，无法被 eval 控制面单独调用与对账 |

---

## 4. 理由

- `[doc:roleagent.md#第7章]` 明确给出四个工程直觉公式，方案 A 是把这些公式落为可执行代码的最小忠实实现
- 四模块独立、LLM-free、依赖仅限 `flowforge.core`——符合 operator 第5条"禁止硬编码路径和密钥"与项目规则铁律3"禁止绕过 DI 容器直接实例化"的可注入前提
- 上限取 `max(net_expected, -cost)` 而非 `max(expected_value)`：roleagent.md 第7章强调"路径相关性"决定上限，低成本候选在净期望相同时优先，避免"贵且无新增视角"的路径胜出
- 下限任一门 `pass_probability=0` 即坍塌为 0.0：符合 roleagent.md"错误要连续穿过多层门"的工程事实，单点失败不被概率平均稀释
- 波动吸收默认比 0.7：roleagent.md 提示"harness 不只是加速器还是缓冲层"，70% 内部吸收是工程经验起点，可被 eval 信号覆盖
- `TokenLedger` 采用 append-only 设计：与 `[doc:decisions/009-eval-self-metabolism.md]` 的轨迹经济学一致——trace 本地存储、可审计、不可篡改
- 术语对齐 `[doc:decisions/012-naming-fusion.md]`：Forgekin 协作数学以多智能体议事 MindCouncil 为仲裁面，而非人类路由器（人类作为方向锚点而非消息总线）

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 下限连乘假设门近似独立，盲点相关性高时会高估下限 | 由 `[doc:decisions/004-capability-profile-routing.md]` 的跨厂商 review 选择盲点不重叠的 reviewer，从源头压低相关性 |
| 上限 `max` 在候选极少时退化为单点，与单 agent 无差别 | 由 `CapabilityRouter` 负责扩展候选集；`UpperBoundResult.explanation` 暴露候选数与最佳路径细节供多智能体议事 MindCouncil 审查 |
| `absorption_ratio=0.7` 是工程经验默认值，缺乏数据支撑 | 标记为 Build to Delete 类脚手架（见 roleagent.md 第1章），由 `[doc:decisions/009-eval-self-metabolism.md]` 的 Eval Contract 设定退役信号 |
| `TokenLedger` 仅记录 token 转账，未包含返工成本与人类心智负载 | 账本只回答"协作是否赚 token 层面"；总成本（含返工与尾部风险）由 eval 控制面的轨迹经济学补齐 |
| 四模块均不调用 LLM，无法处理语义模糊的"门"或"候选" | 设计如此：模糊判断留给可进化智能体 Forgekin，数学模块只做确定性的"算盘"——符合 roleagent.md"harness 给数据不给结论"原则 |
| 公式过于简化，未来需要更精细的盲点相关性建模 | 模块独立、接口稳定，可被更高阶实现替换而不影响调用方；遵循 P0 ADR 的"先钉终态 schema，再扩展实现"原则 |

---

## 6. 否决理由

- **方案 B（LLM 在线评估）**：roleagent.md 第2章明确"harness 不应该替模型思考，而应该让模型在正确的坐标系里思考"——把数学判断外包给 LLM 等于把判断权从伙伴系统手中拿走；且违反 operator 第7条"未实现即 Bug"，因为无 oracle 即无验证
- **方案 C（只实现上限）**：roleagent.md 第7章开篇即说"上限提高，下限托底"——下限是 partner system 与单 agent 系统的本质分野，缺下限等于回到单 agent 路线
- **方案 D（数学塞进路由层）**：违反项目规则铁律3"禁止绕过 DI 容器直接实例化"与编程红线第9条"禁止用继承替代组合/插件"；数学模块需要被 eval 控制面与多智能体议事 MindCouncil 独立调用，耦合路由层将阻断可观测性

---

## 7. 参与者

- operator（愿景锚点 + 7 条不可妥协原则 + 最终决策）
- 架构师可进化智能体（方案设计 + 公式落地 + 术语对齐项目正式命名）
- 多智能体议事 MindCouncil（运行时仲裁面，负责调用四模块并归因）

---

## 8. 修订记录

| 日期 | 修订 | 修订者 |
|------|------|--------|
| 2026-07-21 | 初始版本，确立伙伴系统数学四模块决策（UpperBoundCalculator / LowerBoundCalculator / VarianceAbsorber / TokenLedger），术语对齐项目正式命名（可进化智能体 Forgekin / 多智能体议事 MindCouncil） | operator + 架构师可进化智能体 |

---

## 引用

- `[doc:roleagent.md#第7章]` — 伙伴系统的数学：上限提高，下限托底
- `[doc:roleagent.md#第1章]` — 核心公式：能力 × Harness 契合度
- `[doc:roleagent.md#第2章]` — TeamAct 团队主循环（harness 不替模型思考）
- `[doc:decisions/004-capability-profile-routing.md]` — 能力画像路由（CandidatePath 输入契约的上游）
- `[doc:decisions/009-eval-self-metabolism.md]` — Eval 自代谢（Token 账本轨迹经济学与 Build to Delete 判别）
- `[doc:decisions/012-naming-fusion.md]` — 命名融合（可进化智能体 Forgekin / 多智能体议事 MindCouncil）
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 可进化智能体（Forgekin）愿景
- `[doc:project_rules.md#铁律3]` — 禁止绕过 DI 容器直接实例化
- `[doc:project_rules.md#红线9]` — 禁止用继承替代组合/插件
