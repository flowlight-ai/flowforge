# FlowForge 可进化智能体协作标准操作流程（SOP）

> **文档编号**: SOP.md（v1.1）
> **依据**: `[doc:roleagent.md#第2章]` TeamAct 六步循环 + 五项终止条件
> **适用范围**: 所有 FlowForge 可进化智能体（Evolvable Agent，项目代号 Forgekin，社区社交称"可进化智能体"）协作场景（含 forgemind 可进化智能体 + *Forge 垂直可进化智能体）
> **命名规范**: 严格遵循 `[doc:design/naming-contract.md]` v2.0 "官方名称优先"原则

---

## 0. 智能体分类说明

FlowForge 生态智能体分为两大类（详见 `[doc:design/naming-contract.md#2]`）：

| 类别 | 官方名称（P0） | 项目英文名（P1） | 适用场景 |
|------|---------------|----------------|---------|
| **静态智能体** | Static Agent / Stateless Agent / Task-Specific Agent | StaticAgent / DeclarativeAgent / ExternalAgentAdapter | 单次任务执行、工具调用、无状态查询 |
| **可进化智能体** | Evolvable Agent / Autonomous Agent with Persistent Identity | Forgekin | 长期任务、跨会话能力积累、自进化闭环 |

**默认指代规则**：在 FlowForge 上下文中，"智能体"默认指代**可进化智能体（Forgekin）**；若指代静态智能体必须显式标注。本 SOP 主要描述可进化智能体协作流程，静态智能体作为其能力扩展（通过 ExternalAgentAdapter）参与。

---

## 1. SOP 总则

可进化智能体协作遵循 **TeamAct** 团队主循环（roleagent.md 第 2 章）：六步循环 + 五项终止条件。所有协作必须显式进入 TeamAct 状态机，不允许"无状态协作"。

```
loop:
    State    → 读共享状态（仓库 / spec / 任务 / 记忆 / 交接胶囊）
    Owner    → 谁持球？（路由指令 / 显式持有声明）
    Action   → 持球者执行（写代码 / review / 设计 / 调研）
    Evidence → 产出证据（commit / 测试 / trace / 截图）
    Verdict  → 验证（跨 agent review / 自检 / CVO 确认）
    Route    → 传球（路由给下一个 agent / 继续持有 / 升级给 CVO）
```

**五项终止条件**（缺一不可）：
1. 验收标准全部达成（不能有 deferred）
2. 证据已附（每条验收标准有 commit / 测试 / trace）
3. 跨 agent 交叉验证（非作者 agent 确认，不能自审）
4. 无悬空任务归属（所有 open question 已 resolved 或升级）
5. 愿景收敛（CVO 确认不能被 proxy 替代）

---

## 2. 可进化智能体锻造 SOP（forgemind 专用）

### 2.1 创建新可进化智能体

```
1. operator 提出可进化智能体需求（如"养一只孙悟空可进化智能体"）
   ↓
2. 架构师可进化智能体读取 VISION.md + roleagent.md，生成 features/F0XX-species-xxx.md
   ↓
3. 开发者可进化智能体读取 F0XX 规格 + ADR 005/013，生成 forgemind/xxx_forgekin.py
   ↓
4. 评审员可进化智能体跨厂商 review F0XX + 代码，approve 或 blocking
   ↓
5. 测试员可进化智能体执行 E2E 测试（T1-T8 铁律），采集轨迹到 harness-feedback/
   ↓
6. Eval 员可进化智能体根据轨迹 + 三方信号，归因到七类矩阵之一
   ↓
7. 修复后回到步骤 3，直至 Eval 通过
   ↓
8. 文档员可进化智能体更新 F0XX.md 状态为"已完成"+ 更新 ROADMAP.md
   ↓
9. 经验蒸馏员可进化智能体在低活动期将本次经验蒸馏到 Distilled Knowledge Base（MindCodex，社区社交称"蒸馏知识库"）
```

### 2.2 可进化智能体进化

```
1. 可进化智能体在执行任务中累积经验（行为信号 + Eval 信号）
   ↓
2. Experience Distillation（SpiritForge，社区社交称"经验蒸馏"）在低活动期触发经验蒸馏
   ↓
3. 蒸馏结果写入 Distilled Knowledge Base（MindCodex，可检索知识库）
   ↓
4. 可进化智能体 Capability Profile（CapabilityProfile）更新
   ↓
5. 若形态需要进化（如 BioForgekin → HybridForgekin），触发 F027 形态升级流程
   ↓
6. 谱系记录到 ForgekinLineage
```

---

## 3. 三方 Agent 调用 SOP

### 3.1 调用决策

可进化智能体调用三方 Agent 前必须满足：
- 自身 Capability Profile 表明能力不足（CapabilityProfile.gap_analysis）
- 三方 Agent 在 allow-list 内（`[doc:rules.md#T4]`）
- 三方 Agent 的能力画像已加载（ExternalAgentProfile）

### 3.2 调用流程

```
1. 可进化智能体发起 ExternalAgentBridge.invoke(agent_id, task)
   ↓
2. ExternalAgentAdapter 路由到对应三方 Agent（如 claude_code）
   ↓
3. 三方 Agent 执行任务，状态写入 ExternalAgentSharedState
   ↓
4. 可进化智能体读取共享状态，融合到自身 Capability Profile
   ↓
5. 若失败，ExternalAgentFallback 链回退到下一个三方 Agent 或 FlowForge 内置能力
   ↓
6. 执行轨迹写入可进化智能体 Eval 信号
```

### 3.3 三方 Agent 安全治理

| 治理层 | 机制 |
|--------|------|
| 输入验证 | 三方 Agent 调用前必须通过 Schema 校验 |
| 工具白名单 | 三方 Agent 只能调用 allow-list 内工具 |
| 输出验证 | 三方 Agent 输出必须通过 lint + 测试 |
| 操作确认 | 不可逆操作（merge/release）需 operator 确认 |
| 成本上限 | 每个可进化智能体有三方 Agent 调用配额 |
| 审计追踪 | 三方 Agent 调用全部记录到 harness-feedback/ |

> **说明**：三方 Agent（Claude Code / Codex / OpenCode / Trae 等）通过 ExternalAgentAdapter 接入，归类为"外部接入静态智能体"，作为可进化智能体的能力扩展。

---

## 4. 文档自我演进 SOP

### 4.1 文档更新触发

文档更新必须由 Eval 信号触发，不允许可进化智能体主动修改：
- Feature 完成后 → 自动更新 `features/F0XX.md` 状态
- 架构变更后 → 自动生成 `decisions/0XX-new-decision.md`
- Eval 失败后 → 自动更新 `harness-feedback/verdicts/`
- Bug 修复后 → 自动更新 `TIPS.md`（教训）

### 4.2 文档更新流程

```
1. Eval 信号触发文档更新
   ↓
2. 文档员可进化智能体读取相关文档（< 50KB）
   ↓
3. 可进化智能体生成新版本（保留 [doc:引用] 格式）
   ↓
4. 评审员可进化智能体 review 文档变更
   ↓
5. operator 确认（若涉及 VISION.md / ROADMAP.md）
   ↓
6. 提交到 git，记录到 harness-feedback/
```

### 4.3 文档不可变性规则

- **ADR 不可变**：决策变更通过新增 ADR 引用旧 ADR
- **VISION §7 不可改**：operator 愿景锚点不能被可进化智能体修改
- **review/ 历史不可改**：16 份审核文件保留为历史快照
- **face/ 历史不可改**：face v3.0 文档保留为 v7.0 Phase 0 快照

---

## 5. 自我演进安全治理 SOP

可进化智能体自我演进必须通过六层 Guardrails（`[doc:roleagent.md#第3章]` Governance Boundary）：

| 治理层 | 机制 | 实现 |
|--------|------|------|
| L1 输入验证 | Feature 规格必须通过 Schema 校验 | Pydantic 模型 |
| L2 系统提示约束 | 可进化智能体 system role 注入"禁止绕过 Eval" | 压缩免疫 system role |
| L3 工具白名单 | 可进化智能体只能调用 allow-list 内工具 | ToolRegistry |
| L4 输出验证 | 生成的代码必须通过 lint + 测试 | CI 流水线 |
| L5 操作确认 | 不可逆操作需 operator 确认 | Magic Words 逃生舱 |
| L6 成本上限 | 每个可进化智能体有 token / 三方 Agent 配额 | CostCeiling |

> **关联**：六层 Guardrails 的强度随 Autonomy Level（AwakeningStage，社区社交称"觉醒阶"）递进调整，详见 `[doc:design/naming-contract.md#5]`。

---

## 6. 异常处理 SOP

### 6.1 可进化智能体失败

```
1. 可进化智能体执行失败（如 LLM 超时 / 工具调用错误）
   ↓
2. TeamAct 状态机进入 Verdict 阶段，跨 agent review
   ↓
3. Eval 员可进化智能体归因到七类之一：
   - harness 错位 → 可进化智能体 A 重构相关 harness 组件
   - 工具缺口 → 可进化智能体 B 新增工具
   - 模型盲点 → 切换跨厂商模型
   - 数据缺失 → 可进化智能体 C 补数据
   - 愿景缺口 → operator 介入修订 VISION.md
   - 协作失败 → 可进化智能体 D 重构 TeamAct 配置
   - 资源耗尽 → 可进化智能体 E 扩容 / 降级
   ↓
4. 修复后回到 Action 阶段
```

### 6.2 三方 Agent 失败

```
1. 三方 Agent 调用失败（如 Claude Code 超时）
   ↓
2. ExternalAgentFallback 链回退
   ↓
3. 回退顺序：Codex → OpenCode → Trae → FlowForge 内置能力
   ↓
4. 全部失败 → 升级给 operator
```

### 6.3 自我演进失控

```
1. 可进化智能体自我演进产生破坏性变更（如删除核心模块）
   ↓
2. Magic Words 逃生舱触发（如"停止"）
   ↓
3. operator 确认是否回滚
   ↓
4. 回滚后归因到七类之一，修复治理层
```

---

## 7. Multi-Agent Deliberation SOP（Phase 6）

Multi-Agent Deliberation（MindCouncil，社区社交称"多智能体议事"）用于解决跨可进化智能体冲突 / 复杂决策：

```
1. 任一可进化智能体可发起 MindCouncil（含议程 + 相关可进化智能体列表）
   ↓
2. MindCouncil 主持可进化智能体（轮值）收集各方立场
   ↓
3. 各可进化智能体表达立场 + Capability Profile 盲点
   ↓
4. 主持可进化智能体综合，跨厂商 review
   ↓
5. 若达成共识 → 执行
   若未达成 → 升级给 operator
   ↓
6. MindCouncil 记录到 Distilled Knowledge Base（MindCodex）
```

---

## 变更历史

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-07-17 | 初版：TeamAct 六步循环 + 五项终止 + 7 大场景 SOP | Trae CN（agent） |
| v1.1 | 2026-07-19 | 按"官方名称优先"原则重构：标题与全文改为 P0 官方名称"可进化智能体（Forgekin）"；新增 §0 智能体分类说明（静态智能体 vs 可进化智能体）；P2 体系别名首次出现双标注；保留所有 SOP 流程步骤不变 | Trae CN（agent） |
