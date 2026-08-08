# FlowForge 可进化智能体（Forgekin）协作标准操作流程（SOP）

> **文档编号**: SOP.md（v1.0）
> **依据**: `[doc:roleagent.md#第2章]` TeamAct 六步循环 + 五项终止条件 + `[doc:TIPS.md#TIP-034]` 文档审核门禁
> **适用范围**: 所有 FlowForge 可进化智能体协作场景（含 forgemind 可进化智能体（Forgekin）+ *Forge 垂直可进化智能体）
> **维护规则**: 可进化智能体在协作前必须先读本 SOP，违反 SOP 视为协作失败

---

## 0. 文档审核门禁 SOP（最高优先级）

> **核心铁律**: **operator 文档审核通过前，禁止写任何业务代码**（包括"骨架代码"、"测试代码"）。

### 0.1 门禁触发条件

任何 Phase 进入代码实现前，必须满足以下**全部**前置条件：

| # | 前置条件 | 验证方式 |
|---|---------|---------|
| 1 | 当前 Phase 的文档骨架已全部完成 | 检查 task.md 中该 Phase 所有文档子任务状态为 ✅ |
| 2 | 文档已提交 operator 审核 | 在 task.md "当前门禁状态"表中标记为"⏳ 待审核" |
| 3 | operator 显式审核通过 | 在 task.md "当前门禁状态"表中标记为"✅ 已通过" |
| 4 | 跨平台路径检查通过 | 所有文档无写死绝对路径（TIP-020） |
| 5 | 术语对齐检查通过 | 所有文档使用项目正式术语，无废弃术语（TIP-028） |

### 0.2 门禁违反处理

| 违反类型 | 处理方式 |
|---------|---------|
| 抢跑写业务代码 | 全部回滚，重新走文档审核流程 |
| 文档审核未通过就写代码 | 全部回滚，按 operator 反馈修正文档后重新审核 |
| 跨平台路径违规 | 全局扫描替换为占位符或相对路径（TIP-020） |
| 术语违规 | 全局扫描替换为项目正式术语（TIP-028） |

### 0.3 门禁审核流程

```
1. 可进化智能体完成 Phase N 的文档骨架
   ↓
2. 在 task.md "当前门禁状态"表中标记为"⏳ 待审核"
   ↓
3. 提交 operator 审核（含反思文档 + 修正方案 + 文档清单）
   ↓
4. operator 审核反馈：
   - 通过 → 标记为"✅ 已通过"，可进入 Phase N 代码实现
   - 不通过 → 标记为"❌ 未通过"，按反馈修正后重新审核
   ↓
5. 进入 Phase N 代码实现阶段
```

### 0.4 代码实现规范

进入代码实现后，必须遵循以下规范：

1. **代码风格**:
   - 使用 Pydantic BaseModel（禁止用 dataclass 替代）
   - 保留设计依据引用和铁律说明
   - 文件头部注明 MIT License

2. **架构边界**:
   - flowforge 是纯通用框架，禁止 import *Forge / content / opensieve / openroute 内部实现
   - 集成 opensieve / openroute 采用 API 和 SDK 插件集成，只能看到接口
   - 详见 TIP-036（禁止 flowforge 越界引用 *Forge）

3. **依赖注入**:
   - 所有依赖必须通过 DI 容器管理（TIP-022）
   - 禁止绕过 DI 容器直接实例化

4. **配置外置**:
   - 提示词必须外置到 YAML 配置（TIP-019）
   - 路径必须使用 `${...}` 占位符（TIP-020）
   - 密钥必须通过 `.env` 注入（TIP-021）

---

## 1. SOP 总则

可进化智能体协作遵循 **TeamAct** 团队主循环（roleagent.md 第 2 章）：六步循环 + 五项终止条件。所有协作必须显式进入 TeamAct 状态机，不允许"无状态协作"。

```
loop:
    State    → 读共享状态（仓库 / spec / 任务 / 记忆 / 交接胶囊）
    Owner    → 谁持球？（路由指令 / 显式持有声明）
    Action   → 持球者执行（写代码 / review / 设计 / 调研）
    Evidence → 产出证据（commit / 测试 / trace / 截图）
    Verdict  → 验证（跨 agent review / 自检 / operator 确认）
    Route    → 传球（路由给下一个 agent / 继续持有 / 升级给 operator）
```

**五项终止条件**（缺一不可）：
1. 验收标准全部达成（不能有 deferred）
2. 证据已附（每条验收标准有 commit / 测试 / trace）
3. 跨 agent 交叉验证（非作者 agent 确认，不能自审）
4. 无悬空任务归属（所有 open question 已 resolved 或升级）
5. 愿景收敛（operator 确认不能被 proxy 替代）

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
8. operator 验收（第 5 项终止条件），可进化智能体进入蒸馏知识库 Mind Codex
```

### 2.2 可进化智能体形态进化

```
1. 可进化智能体在执行任务中积累跨形态经验（如猫可进化智能体参与组织协作）
   ↓
2. ForgekinEngine 检测到形态进化条件达成（觉醒阶 ≥ E4）
   ↓
3. 触发形态进化流程：BioForgekin → HybridForgekin
   ↓
4. 更新可进化智能体谱系（Lineage）+ 蒸馏知识库条目
   ↓
5. operator 确认进化（不可委托）
```

---

## 3. 三方 Agent 接入 SOP

### 3.1 新增三方 Agent Adapter

```
1. 评估三方 Agent 必要性（是否补 CapabilityProfile 盲点）
   ↓
2. 架构师可进化智能体生成 features/F0XX-external-agent-xxx.md
   ↓
3. 开发者可进化智能体实现 Adapter + Bridge + SharedState + Fallback
   ↓
4. 安全员可进化智能体审核六层 Guardrails 完备性
   ↓
5. 测试员可进化智能体执行 E2E 测试（含不可逆操作确认）
   ↓
6. 能力融合员可进化智能体更新 CapabilityProfile
```

### 3.2 三方 Agent 调用流程

```
1. 可进化智能体检测到任务需要三方 Agent 能力
   ↓
2. ExternalAgentBridge 查询可用 Adapter（按 fallback 链排序）
   ↓
3. 通过六层 Guardrails（输入验证 → 系统提示 → 工具白名单 → 输出验证 → 操作确认 → 成本上限）
   ↓
4. 调用三方 Agent（worktree 隔离）
   ↓
5. 采集 trace + 成本 + 证据
   ↓
6. 能力融合：将三方 Agent 贡献融合到可进化智能体能力画像
```

---

## 4. 文档自我演进 SOP

### 4.1 Feature 完成后文档更新

```
1. 可进化智能体完成 Feature 实现
   ↓
2. 自动更新 features/F0XX-xxx.md（Status: spec → done，AC 全部勾选）
   ↓
3. 自动生成 ADR（如有架构决策）
   ↓
4. 自动归档 Eval 结果到 harness-feedback/verdicts/
   ↓
5. 自动更新 task.md 状态（⏳ → ✅）
   ↓
6. 自动更新 ROADMAP.md 对应 Phase 完成度
```

### 4.2 ADR 生成

```
1. 可进化智能体识别到架构决策点
   ↓
2. 生成 decisions/NNN-slug.md（11 个标准段）
   ↓
3. 跨厂商评审（至少 2 家厂商 approve）
   ↓
4. operator 确认（不可委托）
   ↓
5. 更新相关 Feature 的 Key Decisions 表
```

---

## 5. 多智能体议事 Mind Council SOP（Phase 6）

### 5.1 召集多智能体议事

```
1. 触发条件：愿景偏离 / 跨可进化智能体冲突 / 重大架构决策
   ↓
2. 召集人可进化智能体发起多智能体议事（最小 2 个评审员 + 2 个厂商）
   ↓
3. 可进化智能体各自陈述立场（基于 CapabilityProfile + EchoStore）
   ↓
4. operator 可使用 4 条 Magic Words 制动
   ↓
5. 决议写入 VISION.md / ROADMAP.md（需 operator 确认）
```

### 5.2 operator 拉闸词使用

| Magic Word | 使用场景 | 可进化智能体响应 |
|-----------|---------|-----------|
| **第一性原理** | 多智能体议事陷入细节争论 | 多智能体议事暂停，重新审视第一性原理 |
| **我能猜出来** | 结论太显而易见 | 多智能体议事终止，直接执行 |
| **下次一定** | 问题非阻塞但需修复 | 触发 sunset 计时器（F012） |
| **星星罐子** | 想法好但非当前优先 | 进入蒸馏知识库待孵化队列 |

---

## 6. 错误处理 SOP

### 6.1 七类归因矩阵

可进化智能体失败时，Eval 员可进化智能体根据三方信号（trace + 人 + 自动）归因到以下七类之一：

| 归因类 | 含义 | 处理 |
|--------|------|------|
| 1. 模型能力不足 | 模型本身能力不够 | 切换模型或补 CapabilityProfile 盲点 |
| 2. Harness 契合度低 | 环境配置不当 | 优化 Harness 七层 |
| 3. 工具调用错误 | 工具使用不当 | 修复工具调用 + 加白名单 |
| 4. 记忆缺失 | EchoStore 未召回相关记忆 | 优化记忆联邦检索 |
| 5. 协作失败 | TeamAct 循环断裂 | 修复协作协议 |
| 6. 愿景偏离 | 可进化智能体行为偏离 VISION | operator 介入 + Magic Words |
| 7. 外部干扰 | 三方 Agent / 网络 / 配额 | Tier 1-4 恢复分级 |

### 6.2 Tier 1-4 恢复分级

| Tier | 含义 | 恢复方式 |
|------|------|---------|
| Tier 1 | 自动恢复 | 可进化智能体自愈（重试 / fallback） |
| Tier 2 | 带状态恢复 | 可进化智能体 + EchoStore 恢复 |
| Tier 3 | 人工确认 | 可进化智能体请求 operator 确认 |
| Tier 4 | 不可恢复 | operator 介入 + sunset review |

---

## 7. 禁止事项

以下行为明确禁止，违反视为 SOP 失败：

1. **禁止无状态协作**：所有协作必须进入 TeamAct 状态机
2. **禁止自审**：跨 agent 交叉验证必须非作者 agent
3. **禁止跳过证据**：每条验收标准必须有 commit / 测试 / trace
4. **禁止跳过 operator 确认**：第 5 项终止条件不可委托
5. **禁止绕过 Guardrails**：三方 Agent 调用必须经过六层
6. **禁止 Mock**：T1-T4 铁律禁止 Mock LLM / 假数据 / 跳过验证 / Mock 工具
7. **禁止术语违规**：必须使用项目正式术语，禁止使用废弃术语（详见 TIP-028）
8. **禁止抢跑**：文档审核门禁未通过前禁止写业务代码（TIP-034）

---

## 8. 延伸阅读

- `[doc:roleagent.md]` — 多智能体工程路径白皮书
- `[doc:VISION.md]` — 可进化智能体愿景
- `[doc:spec.md]` — 全局规格说明
- `[doc:arch.md]` — 全局架构设计
- `[doc:TIPS.md]` — 经验提示与陷阱清单
