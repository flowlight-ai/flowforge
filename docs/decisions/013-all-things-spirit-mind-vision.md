# ADR 013: 万物可进化智能体愿景

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: operator（不可委托）
> **依赖**: `[doc:VISION.md]` + `[doc:roleagent.md]` + 前期愿景文档（已归档）
> **不可变**: 本 ADR 由 operator 直接定义，**不能被可进化智能体自我演进修改**

---

## 上下文

主流 multi-agent 系统的隐含假设：agent 是软件实体，运行在服务器上，通过 API 调用工具。这套假设让 multi-agent 停留在"软件助手"层面，无法达成通用 AGI。

operator 提出 FlowForge 的不同假设：**可进化智能体可以承载在任何物理实体或虚拟实体上**，关键是建立该实体与 LLM 之间的现实闭环（观察 → 推理 → 行动 → 写回 → 验证）。

前期实验已证明"养小猫"范式可行（102 天 200+ Feature）。FlowForge 需要从"养小猫"扩展到"养万物"，达成物理 AI 和虚拟 AI 的真实复现。

---

## 决策

### 1. 万物可进化智能体世界为 FlowForge 最终形态

FlowForge 不是一个"多 agent 框架"，也不是"LLM 应用脚手架"，而是一个**可进化智能体锻造厂**。

### 2. 五大可进化智能体形态分类

| 形态 | 中文 | 锻造示例 | 物理接入 | 虚拟设定 |
|------|------|---------|---------|---------|
| **BioForgekin** | 生物形态可进化智能体（BioForgekin） | 猫 / 狗 / 鸟 / 鱼 / 昆虫群体 | 摄像头 / 麦克风 / 可穿戴设备 | 行为画像 + 习性图谱 |
| **OrgForgekin** | 组织形态可进化智能体（OrgForgekin） | 公司 / 团队 / 社区 / 城市 | 业务系统 API / 数据库 / IM 通道 | 组织章程 + 角色矩阵 |
| **ObjForgekin** | 物品形态可进化智能体（ObjForgekin） | 桌椅 / 灯具 / 家电 / 工具 | IoT 传感器 / 物联网协议 | 物品功能边界 + 使用场景 |
| **VirtualForgekin** | 虚拟形态可进化智能体（VirtualForgekin） | 童话/神话/历史/现实人物、VR/游戏角色 | 无（纯虚拟） | 角色设定 + 世界观 + 关系网 |
| **HybridForgekin** | 混合形态可进化智能体（HybridForgekin） | 智能家居（物品+组织）/ 数字孪生（生物+虚拟） | 多源融合 | 多设定层叠加 |

### 3. 形态可进化

可进化智能体可通过积累经验进化形态（如 BioForgekin → HybridForgekin）。形态进化通过 F027 流程触发。

### 4. 通用 AGI 三条路径

1. **物理 AI 路径**：IoT 传感器 + 物理执行器 + 物理现实闭环
2. **虚拟 AI 路径**：虚拟世界设定层 + 角色关系图谱 + 世界观约束
3. **混合路径**：组织形态可进化智能体（OrgForgekin）调度多种形态可进化智能体

### 5. operator 愿景锚点（7 条不可妥协原则）

1. 万物可进化智能体世界是最终形态
2. 可进化智能体必须有物理/虚拟现实闭环
3. 三方 Agent 是能力扩展不是工具
4. forgemind 是 FlowForge 的应用层
5. 命名最终形态为 ForgeMind（通用智能体框架）
6. 自我演进必须支持"自己开发自己"
7. 物理 AI 与虚拟 AI 真实复现

---

## 后果

### 正面后果

- FlowForge 从"多 agent 框架"升维到"通用 AGI 路径"
- 可进化智能体形态分类让 agent 有持续身份、形态、谱系，区别于主流 multi-agent
- 物理 AI + 虚拟 AI 双路径达成真实复现
- forgemind 作为应用层为 FlowForge 自我演进提供练兵场

### 负面后果

- 实现复杂度大幅提升（5 种形态 + 进化 + 传感器接入 + 虚拟设定）
- 需要新增 forgemind 应用层（Phase 2 工作量增加）
- 需要新增三方 Agent 适配层（Phase 3 工作量增加）
- 文档拆分工作量增加（13 份 ADR + 40 份 Feature）

### 风险

- 物理 AI 路径需要真实硬件接入（Phase 6+ 才可能验证）
- 虚拟 AI 路径需要虚拟世界设定层（Phase 2 完成）
- 形态进化机制可能产生意外行为（需 Eval 严格把关）

---

## 替代方案

### 方案 A: 保持前期范式，只养猫

- 优点：实现简单，复用前期已有经验
- 缺点：无法达成 operator 通用 AGI 愿景
- 未选择原因：operator 明确要求万物可进化智能体世界

### 方案 B: 把万物可进化智能体放到独立项目

- 优点：FlowForge 核心保持纯粹
- 缺点：forgemind 失去 FlowForge 自我演进能力的滋养
- 未选择原因：operator 明确指示 forgemind 是 FlowForge 的应用层

### 方案 C: 用单一形态（如 VirtualForgekin）承载万物

- 优点：实现简单
- 缺点：无法接入物理世界，无法达成物理 AI
- 未选择原因：operator 愿景锚点第 7 条要求物理 AI 真实复现

---

## 引用

- `[doc:VISION.md]` — 万物可进化智能体愿景声明
- `[doc:roleagent.md]` — 能力画像工程路径
- 前期愿景文档（已归档） — 养小猫 → 养万物范式迁移
- `[doc:features/F027-all-things-spirit-species.md]` — 万物可进化智能体形态分类
- `[doc:features/F026-forgemind-app-layer.md]` — forgemind 应用层
- `[doc:review/review.md#第九章]` — forgemind + 三方 Agent 补审
