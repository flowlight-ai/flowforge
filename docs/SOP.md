# FlowForge 灵智体协作标准操作流程（SOP）

> **文档编号**: SOP.md（v1.0）
> **依据**: `[doc:roleagent.md#第2章]` TeamAct 六步循环 + 五项终止条件
> **适用范围**: 所有 FlowForge 灵智体协作场景（含 forgemind 万物灵智体 + *Forge 垂直灵智体）

---

## 1. SOP 总则

灵智体协作遵循 **TeamAct** 团队主循环（roleagent.md 第 2 章）：六步循环 + 五项终止条件。所有协作必须显式进入 TeamAct 状态机，不允许"无状态协作"。

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

## 2. 灵智体锻造 SOP（forgemind 专用）

### 2.1 创建新灵智体

```
1. operator 提出灵智体需求（如"养一只孙悟空灵智体"）
   ↓
2. 架构师灵智体读取 VISION.md + roleagent.md，生成 features/F0XX-species-xxx.md
   ↓
3. 开发者灵智体读取 F0XX 规格 + ADR 005/013，生成 forgemind/xxx_forgekin.py
   ↓
4. 评审员灵智体跨厂商 review F0XX + 代码，approve 或 blocking
   ↓
5. 测试员灵智体执行 E2E 测试（T1-T8 铁律），采集轨迹到 harness-feedback/
   ↓
6. Eval 员灵智体根据轨迹 + 三方信号，归因到七类矩阵之一
   ↓
7. 修复后回到步骤 3，直至 Eval 通过
   ↓
8. 文档员灵智体更新 F0XX.md 状态为"已完成"+ 更新 ROADMAP.md
   ↓
9. 灵锻员灵智体在低活动期将本次经验蒸馏到灵典 Mind Codex
```

### 2.2 灵智体进化

```
1. 灵智体在执行任务中累积经验（行为信号 + Eval 信号）
   ↓
2. 灵锻 SpiritForge 在低活动期触发经验蒸馏
   ↓
3. 蒸馏结果写入灵典 Mind Codex（可检索知识库）
   ↓
4. 灵智体能力画像更新（CapabilityProfile）
   ↓
5. 若形态需要进化（如 BioForgekin → HybridForgekin），触发 F027 形态升级流程
   ↓
6. 谱系记录到 ForgekinLineage
```

---

## 3. 三方 Agent 调用 SOP

### 3.1 调用决策

灵智体调用三方 Agent 前必须满足：
- 自身能力画像表明能力不足（CapabilityProfile.gap_analysis）
- 三方 Agent 在 allow-list 内（`[doc:rules.md#T4]`）
- 三方 Agent 的能力画像已加载（ExternalAgentProfile）

### 3.2 调用流程

```
1. 灵智体发起 ExternalAgentBridge.invoke(agent_id, task)
   ↓
2. ExternalAgentAdapter 路由到对应三方 Agent（如 claude_code）
   ↓
3. 三方 Agent 执行任务，状态写入 ExternalAgentSharedState
   ↓
4. 灵智体读取共享状态，融合到自身能力画像
   ↓
5. 若失败，ExternalAgentFallback 链回退到下一个三方 Agent 或 FlowForge 内置能力
   ↓
6. 执行轨迹写入灵智体 Eval 信号
```

### 3.3 三方 Agent 安全治理

| 治理层 | 机制 |
|--------|------|
| 输入验证 | 三方 Agent 调用前必须通过 Schema 校验 |
| 工具白名单 | 三方 Agent 只能调用 allow-list 内工具 |
| 输出验证 | 三方 Agent 输出必须通过 lint + 测试 |
| 操作确认 | 不可逆操作（merge/release）需 operator 确认 |
| 成本上限 | 每个灵智体有三方 Agent 调用配额 |
| 审计追踪 | 三方 Agent 调用全部记录到 harness-feedback/ |

---

## 4. 文档自我演进 SOP

### 4.1 文档更新触发

文档更新必须由 Eval 信号触发，不允许灵智体主动修改：
- Feature 完成后 → 自动更新 `features/F0XX.md` 状态
- 架构变更后 → 自动生成 `decisions/0XX-new-decision.md`
- Eval 失败后 → 自动更新 `harness-feedback/verdicts/`
- Bug 修复后 → 自动更新 `TIPS.md`（教训）

### 4.2 文档更新流程

```
1. Eval 信号触发文档更新
   ↓
2. 文档员灵智体读取相关文档（< 50KB）
   ↓
3. 灵智体生成新版本（保留 [doc:引用] 格式）
   ↓
4. 评审员灵智体 review 文档变更
   ↓
5. operator 确认（若涉及 VISION.md / ROADMAP.md）
   ↓
6. 提交到 git，记录到 harness-feedback/
```

### 4.3 文档不可变性规则

- **ADR 不可变**：决策变更通过新增 ADR 引用旧 ADR
- **VISION §7 不可改**：operator 愿景锚点不能被灵智体修改
- **review/ 历史不可改**：16 份审核文件保留为历史快照
- **face/ 历史不可改**：face v3.0 文档保留为 v7.0 Phase 0 快照

---

## 5. 自我演进安全治理 SOP

灵智体自我演进必须通过六层 Guardrails（`[doc:roleagent.md#第3章]` Governance Boundary）：

| 治理层 | 机制 | 实现 |
|--------|------|------|
| L1 输入验证 | Feature 规格必须通过 Schema 校验 | Pydantic 模型 |
| L2 系统提示约束 | 灵智体 system role 注入"禁止绕过 Eval" | 压缩免疫 system role |
| L3 工具白名单 | 灵智体只能调用 allow-list 内工具 | ToolRegistry |
| L4 输出验证 | 生成的代码必须通过 lint + 测试 | CI 流水线 |
| L5 操作确认 | 不可逆操作需 operator 确认 | Magic Words 逃生舱 |
| L6 成本上限 | 每个灵智体有 token / 三方 Agent 配额 | CostCeiling |

---

## 6. 异常处理 SOP

### 6.1 灵智体失败

```
1. 灵智体执行失败（如 LLM 超时 / 工具调用错误）
   ↓
2. TeamAct 状态机进入 Verdict 阶段，跨 agent review
   ↓
3. Eval 员灵智体归因到七类之一：
   - harness 错位 → 灵智体 A 重构相关 harness 组件
   - 工具缺口 → 灵智体 B 新增工具
   - 模型盲点 → 切换跨厂商模型
   - 数据缺失 → 灵智体 C 补数据
   - 愿景缺口 → operator 介入修订 VISION.md
   - 协作失败 → 灵智体 D 重构 TeamAct 配置
   - 资源耗尽 → 灵智体 E 扩容 / 降级
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
1. 灵智体自我演进产生破坏性变更（如删除核心模块）
   ↓
2. Magic Words 逃生舱触发（如"停止"）
   ↓
3. operator 确认是否回滚
   ↓
4. 回滚后归因到七类之一，修复治理层
```

---

## 7. 灵议 Mind Council SOP（Phase 6）

多灵智体议事用于解决跨灵智体冲突 / 复杂决策：

```
1. 任一灵智体可发起灵议（含议程 + 相关灵智体列表）
   ↓
2. 灵议主持灵智体（轮值）收集各方立场
   ↓
3. 各灵智体表达立场 + 能力画像盲点
   ↓
4. 主持灵智体综合，跨厂商 review
   ↓
5. 若达成共识 → 执行
   若未达成 → 升级给 operator
   ↓
6. 灵议记录到灵典 Mind Codex
```
