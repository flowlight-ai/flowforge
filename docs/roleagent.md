# roleagent.md 工程路径（FlowForge 落地版）

> **文档编号**: roleagent.md（v1.0）
> **用途**: FlowForge 灵智体在 `flowforge/docs/` 内即可访问 roleagent 工程路径核心内容
> **维护规则**: 本文件不得偏离核心主张；项目演进时同步更新

---

## 0. 一句话主张

> **multi-agent 协作从 role-agent 走向能力画像、动态路由、共享状态、eval 和可靠性治理的工程路径。**

项目实战核心发现：多 agent 的价值不是"更多人力"，而是**右尾变长**（不同认知路径扩展候选解）、**左尾被截断**（错误要连续穿过多层门才能触达用户）、**方差被吸收**（单点波动变成内部返工成本而非用户可见崩塌）。

好的 agent harness 系统不是把单点能力推到极限，而是**把单点波动组织进一个会自我校准的伙伴系统**。

---

## 1. 核心公式：能力 × Harness 契合度

### 1.1 等式

```
Agent 质量 = 模型能力 × Harness 契合度（Environment Fit）
```

同一只 agent 放进不同 harness，能发挥出的能力完全不同。画像只有进入具体运行环境后，才会从静态描述变成可验证能力。

### 1.2 Agent 状态三层

| 层 | 这里存什么 | 存续时间 | 谁控制 |
|---|---|---|---|
| 权重状态 | 训练写进的参数 | 直到下次训练前持久 | 模型厂商 |
| 计算状态 | KV cache、隐藏激活 | 单次推理调用 | 模型架构 |
| 现实状态 | 代码仓、git 历史、文档、任务归属、记忆 | 跨推理、跨 agent、跨时间 | 环境层（harness） |

harness 工程操作的是**第三层现实状态**——唯一一层跨会话、跨 agent、跨时间持续存在的状态。

### 1.3 投资半衰期判别式

| Build to Delete（有保质期脚手架） | Built to Persist（复利型基础设施） |
|---|---|
| 详细的思维链模板 | 文件系统 / git / 搜索工具接入 |
| 多步推理引导 | trace 基础设施与可观测性 |
| 错误恢复样板代码 | 测试 / lint / review 反馈回路 |
| 工具调用别名兜底 | agent 交接协议与路由 |
| 人格装饰文字 | 不可逆操作护栏与应急开关 |

**判别器**：这层 harness 是在补模型当前的认知缺陷，还是在编码外部现实和协作协议？前者 → 轻量做、标 sunset；后者 → 认真做、加测试、长期维护。

---

## 2. TeamAct 团队主循环

### 2.1 六步循环

```
loop:
    State    → 读共享状态（仓库 / spec / 任务 / 记忆 / 交接胶囊）
    Owner    → 谁持球？（路由指令 / 显式持有声明）
    Action   → 持球者执行（写代码 / review / 设计 / 调研）
    Evidence → 产出证据（commit / 测试 / trace / 截图）
    Verdict  → 验证（跨 agent review / 自检 / operator 确认）
    Route    → 传球（路由给下一个 agent / 继续持有 / 升级给 operator）
```

### 2.2 五项终止条件（缺一不可）

1. 验收标准全部达成（不能有 deferred）
2. 证据已附（每条验收标准有 commit / 测试 / trace）
3. 跨 agent 交叉验证（非作者 agent 确认，不能自审）
4. 无悬空任务归属（所有 open question 已 resolved 或升级）
5. 愿景收敛（operator 确认不能被 proxy 替代）

### 2.3 持球注册 lease

持球者必须显式声明持球（ball custody lease），避免双持球冲突。lease 有 TTL，超时自动释放。

### 2.4 乒乓球熔断器

如果两个 agent 互相传球超过 3 次仍未达成终止条件，触发乒乓球熔断器，升级给 operator。

---

## 3. Harness 七层

### 3.1 七层定义

| 层 | 名称 | 职责 | 对应 Feature |
|---|------|------|-------------|
| 1 | Durable State Surfaces | 持久状态层（跨 session 持续） | F008 |
| 2 | Tool Mediation | 工具中介（统一工具调用接口） | F009（部分） |
| 3 | Evidence & Sensors | 验证证据（commit / 测试 / trace / 截图） | F009 |
| 4 | Governance Boundary | 治理边界（压缩免疫，不可被 prompt 压缩） | F010 |
| 5 | Magic Words | 逃生舱（operator 紧急制动） | F011 |
| 6 | Entropy Control | 退役机制（Build to Delete sunset） | F012 |
| 7 | Harnessability | 评估（harness 自身的可驾驭性） | F013 |

### 3.2 Governance 压缩免疫

Governance Boundary 是不可被 prompt 压缩的硬约束。即使 LLM 上下文窗口满了，Governance 规则也不能被裁剪。这是防止"prompt 注入绕过护栏"的关键。

### 3.3 Magic Words 逃生舱

operator 可以通过 4 条 Magic Words 紧急制动（详见 `[doc:VISION.md#8]`）：
- 第一性原理
- 我能猜出来
- 下次一定
- 星星罐子

---

## 4. 多域记忆联邦

### 4.1 记忆治理三要素

| 要素 | 含义 |
|------|------|
| 权威等级 | authoritative（原始数据）> derivative（推导数据）> cache（缓存） |
| 消费加权 | 按访问频率排序，高频记忆权重高 |
| 时效验证 | 旧记忆降权或归档，防止过时结论污染 |

### 4.2 三检索入口

| 入口 | 用途 | 实现 |
|------|------|------|
| grep | 精确文本匹配 | ripgrep |
| 语义 | 语义相似度 | embedding + 向量检索 |
| 索引 | 结构化查询 | 倒排索引 / 图谱 |

### 4.3 锻典 MindCodex

锻典是可检索的知识库，存储灵智体蒸馏的经验。锻典条目有 5 级成熟度阶梯：

| 级别 | 含义 | 来源 |
|------|------|------|
| Seed | 种子（单次事件） | 单次任务执行 |
| Case | 案例（多次类似事件） | 多次任务归纳 |
| Method | 方法（可复用模式） | Case 提炼 |
| Principle | 原则（高层抽象） | Method 抽象 |
| Constitution | 宪法（不可违反） | operator 确认 |

---

## 5. Eval 自代谢

### 5.1 Eval Contract 五问

每个 harness 组件必须回答五问：

1. **Who** — 谁在 eval？（trace / 人 / 自动）
2. **What** — eval 什么？（功能 / 性能 / 协作 / 愿景）
3. **When** — 何时 eval？（实时 / 每日 / 每周）
4. **Where** — eval 结果存哪？（harness-feedback/verdicts/）
5. **Why** — 为什么 eval？（归因到七类矩阵之一）

### 5.2 三方信号交叉

| 信号 | 来源 | 用途 |
|------|------|------|
| trace | 自动采集 | 客观执行轨迹 |
| 人 | operator / reviewer | 主观判断 |
| 自动 | Eval 算法 | 模式识别 |

三方信号交叉验证，单一信号不足以归因。

### 5.3 七类归因矩阵

详见 `[doc:SOP.md#6.1]`

---

## 6. 分布式可靠性

### 6.1 Tier 1-4 恢复分级

| Tier | 含义 | 恢复方式 |
|------|------|---------|
| Tier 1 | 自动恢复 | 灵智体自愈（重试 / fallback） |
| Tier 2 | 带状态恢复 | 灵智体 + 灵忆恢复 |
| Tier 3 | 人工确认 | 灵智体请求 operator 确认 |
| Tier 4 | 不可恢复 | operator 介入 + sunset review |

### 6.2 liveness 规范读模型

任何 agent 可以查询任何其他 agent 的 liveness 状态（alive / dead / degraded）。liveness 是规范读模型，不是直接探测。

### 6.3 弱状态机 vs 强 workflow

| 类型 | 含义 | 适用场景 |
|------|------|---------|
| 弱状态机 | 状态可被重新计算 | 临时计算结果 |
| 强 workflow | 状态不可逆 | 已发布的代码 / 已发送的消息 |

---

## 7. 伙伴系统数学

### 7.1 上限公式

```
上限 = max(候选路径)
```

多 agent 协作的上限是所有候选路径中的最大值。增加 agent 数量扩展候选路径，提升上限。

### 7.2 下限公式

```
下限 = 多层门连乘
```

多 agent 协作的下限是多层门的连乘。每层门有通过率，错误要连续穿过多层门才能触达用户。

### 7.3 波动吸收

```
单点波动 → 内部返工成本（不触达用户）
```

单点 agent 的波动（性能 / 准确度）被伙伴系统吸收为内部返工成本，而非用户可见崩塌。

### 7.4 Token 账本

Token 账本统计单 agent vs 团队成本，回答"多 agent 是否值得"。

---

## 8. operator 7 条不可妥协原则

详见 `[doc:VISION.md#6]`

---

## 9. 万物灵智体形态分类

详见 `[doc:VISION.md#2]`

---

## 10. 三方 Agent 集成

详见 `[doc:VISION.md#5]`

---

## 11. 延伸阅读

- `[doc:VISION.md]` — 万物灵智体愿景
- `[doc:SOP.md]` — 灵智体协作 SOP
- `[doc:decisions/004-capability-profile-routing.md]` — 能力画像路由 ADR
- `[doc:decisions/006-external-agent-integration.md]` — 三方 Agent 集成 ADR
