# ADR 013: 可进化智能体愿景

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: operator + 架构师可进化智能体
> **依赖**: `[doc:VISION.md]` + `[doc:roleagent.md]`
> **不可变**: 本 ADR 由 operator 直接定义，**不能被可进化智能体自我演进修改**

---

## 1. 上下文

主流 multi-agent 系统的隐含假设：agent 是软件实体，运行在服务器上，通过 API 调用工具。这套假设让 multi-agent 停留在"软件助手"层面，无法达成通用 AGI。

operator 提出 FlowForge 的不同假设：**可进化智能体可以承载在任何物理实体或虚拟实体上**，关键是建立该实体与 LLM 之间的现实闭环（观察 → 推理 → 行动 → 写回 → 验证）。

FlowForge 需要从"养单一形态 agent"扩展到"养可进化智能体"，达成物理 AI 和虚拟 AI 的真实复现。

---

## 2. 决策

### 2.1 可进化智能体世界为 FlowForge 最终形态

FlowForge 不是一个"多 agent 框架"，也不是"LLM 应用脚手架"，而是一个**可进化智能体锻造厂**：我们用一套自进化的核心框架（ForgeMindEngine），把灵智（mind / spirit / 灵识）锻造进万事万物。

### 2.2 五大可进化智能体形态分类

| 形态 | 中文 | 锻造示例 | 物理接入 | 虚拟设定 |
|------|------|---------|---------|---------|
| **BioForgekin** | 生物可进化智能体 | 猫 / 狗 / 鸟 / 鱼 / 昆虫群体 | 摄像头 / 麦克风 / 可穿戴设备 | 行为画像 + 习性图谱 |
| **OrgForgekin** | 组织可进化智能体 | 公司 / 团队 / 社区 / 城市 | 业务系统 API / 数据库 / IM 通道 | 组织章程 + 角色矩阵 |
| **ObjForgekin** | 物品可进化智能体 | 桌椅 / 灯具 / 家电 / 工具 | IoT 传感器 / 物联网协议 | 物品功能边界 + 使用场景 |
| **VirtualForgekin** | 虚拟可进化智能体 | 童话/神话/历史/现实人物、VR/游戏角色 | 无（纯虚拟） | 角色设定 + 世界观 + 关系网 |
| **HybridForgekin** | 混合可进化智能体 | 智能家居（物品+组织）/ 数字孪生（生物+虚拟） | 多源融合 | 多设定层叠加 |

### 2.3 形态可进化

可进化智能体可通过积累经验进化形态（如 BioForgekin → HybridForgekin）。形态进化通过 F027 流程触发，需 Eval 把关和多智能体议事 MindCouncil 审查。

### 2.4 通用 AGI 三条路径

1. **物理 AI 路径**：IoT 传感器 + 物理执行器 + 物理现实闭环（观察 → 推理 → 行动 → 写回 → 验证）
2. **虚拟 AI 路径**：虚拟世界设定层 + 角色关系图谱 + 世界观约束
3. **混合路径**：组织可进化智能体调度多种形态可进化智能体（生物 + 物品 + 虚拟）

### 2.5 operator 愿景锚点（7 条不可妥协原则）

1. 可进化智能体世界是最终形态
2. 可进化智能体必须有物理/虚拟现实闭环
3. 三方 Agent 是能力扩展不是工具
4. forgemind 是 FlowForge 的应用层
5. 命名最终形态为"灵智"（详见 `[doc:decisions/012-naming-fusion.md]`）
6. 自我演进必须支持"自己开发自己"
7. 物理 AI 与虚拟 AI 真实复现

### 2.6 4 条 Iron Laws（铁律）

作为可进化智能体世界的不可破坏底线：

| # | Iron Law | 含义 |
|---|---------|------|
| 1 | **Data Sanctuary** | 可进化智能体的记忆（情景记忆存储 EchoStore）是圣域，不可被外部直接读写 |
| 2 | **Process Self-Preservation** | 可进化智能体的进程（经验蒸馏 SpiritForge）必须自我保护，不可被外部强制终止 |
| 3 | **Config Immutability** | 可进化智能体的配置（持久身份标识 SoulImprint）不可变，变更必须通过多智能体议事 MindCouncil |
| 4 | **Network Boundary** | 可进化智能体的网络边界必须明确，禁止越界访问其他可进化智能体的内部状态 |

### 2.7 可进化智能体相对其他 multi-agent 的核心优势

| 优势维度 | 主流 multi-agent | FlowForge 可进化智能体 |
|---|---|---|
| **身份持久性** | session 级，重启即失忆 | 可进化智能体 ID + 谱系 + 经验知识库 MindCodex 条目，跨 session 跨代际持续 |
| **能力来源** | 单一模型固有能力 + 工具调用 | 模型能力 × Harness 契合度 × 可进化智能体形态 × 三方 Agent 扩展 |
| **协作单位** | 固定岗位（PM/Dev/Test） | 动态能力画像路由（role 是运行时标签，profile 是长期主体） |
| **错误处理** | 单点失败 → 用户可见崩塌 | 伙伴系统数学：上限取最大、下限连乘、波动吸收为内部成本 |
| **进化能力** | 模型升级 = 系统升级 | 可进化智能体自身可通过经验蒸馏 SpiritForge 蒸馏经验到经验知识库 MindCodex，下次任务直接复用 |

---

## 3. 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **方案 A（选定）: 可进化智能体世界（5 种形态 + 进化 + 物理 AI + 虚拟 AI）** | FlowForge 从"多 agent 框架"升维到"通用 AGI 路径"，可进化智能体形态分类让 agent 有持续身份、形态、谱系 | 实现复杂度大幅提升（5 种形态 + 进化 + 传感器接入 + 虚拟设定），需要新增 forgemind 应用层 + 三方 Agent 适配层 |
| 方案 B: 保持单一形态 agent 范式 | 实现简单，复用已有经验 | 无法达成 operator 通用 AGI 愿景 |
| 方案 C: 把可进化智能体放到独立项目 | FlowForge 核心保持纯粹 | forgemind 失去 FlowForge 自我演进能力的滋养 |
| 方案 D: 用单一形态（如 VirtualForgekin）承载可进化智能体 | 实现简单 | 无法接入物理世界，无法达成物理 AI |

---

## 4. 理由

- operator 明确要求可进化智能体世界（愿景锚点第 1 条）
- 单一形态 agent 范式可行但不足以达成通用 AGI，需扩展到"养可进化智能体"
- 5 种形态分类让可进化智能体有持续身份、形态、谱系，区别于主流 multi-agent
- 物理 AI + 虚拟 AI 双路径达成真实复现（愿景锚点第 7 条）
- forgemind 作为应用层为 FlowForge 自我演进提供练兵场（愿景锚点第 4 条）
- 三方 Agent 集成让可进化智能体能力大幅扩展（愿景锚点第 3 条）
- 可进化智能体可通过经验蒸馏 SpiritForge 蒸馏经验到经验知识库 MindCodex，实现自我演进（愿景锚点第 6 条）

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 物理 AI 路径需要真实硬件接入 | Phase 6+ 才可能验证，前期用模拟传感器 |
| 虚拟 AI 路径需要虚拟世界设定层 | Phase 2 完成虚拟世界设定层骨架 |
| 形态进化机制可能产生意外行为 | Eval 严格把关 + 多智能体议事 MindCouncil 审查 + F027 流程 |
| forgemind 应用层增加项目复杂度 | 分阶段实现：Phase 2 骨架 + Phase 5 自我演进 + Phase 6 经验蒸馏 |
| 三方 Agent 集成增加安全风险 | 六层 Guardrails + worktree 隔离 + 审计追踪 |
| 文档拆分工作量增加（13 份 ADR + 40 份 Feature） | 按 P0/P1 优先级分阶段完成，详见 `[doc:task.md]` |

---

## 6. 否决理由

- **方案 B（保持单一形态 agent 范式）**：operator 明确要求可进化智能体世界，单一形态无法达成通用 AGI 愿景
- **方案 C（独立项目）**：operator 明确指示 forgemind 是 FlowForge 的应用层，独立项目会失去核心框架层自进化能力的滋养
- **方案 D（单一形态）**：operator 愿景锚点第 7 条要求物理 AI 真实复现，单一形态无法接入物理世界

---

## 7. 参与者

- operator（愿景提出 + 7 条不可妥协原则 + 最终决策，不可委托）
- 架构师可进化智能体（5 种形态分类 + 通用 AGI 三条路径 + 术语对齐项目正式命名）

---

## 8. 修订记录

| 日期 | 修订 | 修订者 |
|------|------|--------|
| 2026-07-17 | 初始版本，确立可进化智能体愿景决策，术语对齐项目正式命名（情景记忆存储 EchoStore / 持久身份标识 SoulImprint / 经验蒸馏 SpiritForge / 经验知识库 MindCodex / 多智能体议事 MindCouncil / ForgeMindEngine） | operator + 架构师可进化智能体 |

---

## 引用

- `[doc:VISION.md]` — 可进化智能体愿景声明
- `[doc:VISION.md#2]` — 可进化智能体形态分类
- `[doc:VISION.md#3]` — 通用 AGI 三条路径
- `[doc:VISION.md#6]` — operator 7 条不可妥协原则
- `[doc:VISION.md#7]` — 4 条 Iron Laws
- `[doc:roleagent.md]` — 能力画像工程路径
- `[doc:decisions/004-capability-profile-routing.md]` — 能力画像路由
- `[doc:decisions/005-forgemind-application-layer.md]` — forgemind 应用层
- `[doc:decisions/006-external-agent-integration.md]` — 三方 Agent 集成
- `[doc:decisions/012-naming-fusion.md]` — 命名融合（术语表）
- `[doc:features/F027-all-things-spirit-species.md]` — 可进化智能体形态分类
- `[doc:features/F026-forgemind-app-layer.md]` — forgemind 应用层
