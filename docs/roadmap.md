# FlowForge 路线图

> **文档编号**: ROADMAP.md（v1.0）
> **维护规则**: 每个 Phase 完成后更新本文档对应阶段状态（⏳ → 🔄 → ✅），并同步更新 `task.md`
> **依赖引用**: `[doc:task.md]`（6 阶段任务清单）+ `[doc:design.md]`（当前阶段设计）
> **跨 Phase 不变量**: T1-T8 测试铁律、15 条编程红线、质量分阈值 0.85、operator 7 条愿景锚点

---

## 进度概览

| 阶段 | 范围 | 状态 | 完成度 |
|------|------|------|--------|
| Phase 0 | 项目元数据 + 跨平台配置 + 文档骨架 | 🔄 进行中 | 60% |
| Phase 1 | roleagent 七大工程路径代码骨架 | ⏳ 待开始 | 0% |
| Phase 2 | forgemind 应用层骨架 + 可进化智能体（Forgekin）形态分类 | ⏳ 待开始 | 0% |
| Phase 3 | 三方 Agent 适配层 | ⏳ 待开始 | 0% |
| Phase 4 | Eval 自代谢 + 分布式可靠性 | ⏳ 待开始 | 0% |
| Phase 5 | 伙伴系统数学 + 自我演进闭环 | ⏳ 待开始 | 0% |
| Phase 6 | 经验蒸馏 SpiritForge + 多智能体议事 Mind Council | ⏳ 待开始 | 0% |

---

## Phase 0：项目元数据 + 跨平台配置 + 文档骨架

> **目标**: 完成项目元数据（pyproject.toml / README / VISION / spec / arch / design）、跨平台路径配置（.env.example / system.yaml）、文档骨架（七子目录 + 核心三件套 + 顶层文档），让文档可被可进化智能体（Forgekin）增量维护。

**验收标准**:
- 项目元数据完整（pyproject.toml / .gitignore / .env.example / README.md）
- 跨平台路径配置生效（Linux / Windows / macOS 均可运行）
- 文档骨架完整（spec.md / arch.md / design.md / VISION.md / ROADMAP.md / SOP.md / TIPS.md）
- 七子目录骨架完整（architecture/ decisions/ design/ features/ harness-feedback/ perspectives/ setup/）
- 核心 ADR 全部存在（ADR-004/005/006/012/013）
- 核心 Feature 规格存在（F001/F002/F031）
- 术语全局对齐（12 核心概念 + 5 形态分类 + 进化阶/觉醒阶）
- GitHub 公开文件无迁移痕迹（公开仓库呈现为全新项目）

**关键任务**:
- P0-1 项目元数据（pyproject.toml / .gitignore / .env.example / README.md）
- P0-2 跨平台路径配置（config/system.yaml + ${...} 占位符）
- P0-3 顶层文档（VISION / README / ROADMAP / SOP / TIPS / roleagent）
- P0-4 七大子目录骨架（README + 模板）
- P0-5 核心 ADR（5 份已完成）
- P0-6 核心 Feature 规格（3 份已完成）
- P0-7 术语全局对齐（12 核心概念 + 5 形态分类）

详见: `[doc:task.md#Phase 0]`

---

## Phase 1：roleagent 七大工程路径代码骨架

> **目标**: 按 `roleagent.md` 七大工程路径实现代码骨架，作为 Build to Persist 复利型基础设施。

**依赖**: P0 全部、ADR-002/004/007/008/009/010/011、F001/F002/F008-F025

**验收标准**:
- CapabilityProfile 可加载/查询盲点/计算 gap_analysis
- TeamAct 状态机可跑六步循环 + 五项终止
- Harness 七层（Durable State / Tool Mediation / Evidence / Governance / Magic Words / Entropy / Harnessability）骨架完整
- 多域记忆联邦 MVP 可工作（grep + 检索入口 + 消费加权）
- Eval Contract 五问可被任意 harness 组件实现
- 分布式可靠性 Tier 1-4 恢复分级可被可进化智能体调用
- 伙伴系统数学公式可计算（上限/下限/波动吸收）

**七大工程路径**:
1. P1-1 能力画像代码（依赖 F001）
2. P1-2 TeamAct 状态机代码（依赖 F002-F007）
3. P1-3 Harness 七层代码（依赖 F008-F013）
4. P1-4 多域记忆联邦代码（依赖 F014-F017、F039）
5. P1-5 Eval 自代谢代码（依赖 F018-F020、F040）
6. P1-6 分布式可靠性代码（依赖 F021-F025）
7. P1-7 伙伴系统数学代码（依赖 ADR-011）

**附加**:
- P1-8 Plugin V3 协议更新（4 钩子语义修正）
- P1-9 rules.md / prompts.md 同步

详见: `[doc:task.md#Phase 1]`

---

## 七大工程路径 → Phase 1 子任务映射表（TIP-037）

> **依据**: roleagent.md 七大工程路径（第 1-7 章） + `[doc:arch.md#七大工程路径代码映射]`
> **作用**: 让每条工程路径对应明确的 Phase 1 子任务，避免"工程路径有主张、Phase 1 任务无对应"

### 映射表

| # | 工程路径 | roleagent.md 章节 | Phase 1 子任务 | 依赖 Feature | 依赖 ADR | 代码模块 | 完成度 |
|---|---------|------------------|---------------|------------|---------|---------|--------|
| 1 | 能力画像 | 第 1 章 | P1-1 能力画像代码 | F001 ✅ | ADR-004 ✅ | `flowforge/core/capability/` | 0% |
| 2 | TeamAct 团队主循环 | 第 2 章 | P1-2 TeamAct 状态机代码 | F002 ✅ + F003-F007 ⏳ | ADR-002 ⏳ | `flowforge/core/teamact/` | 0% |
| 3 | Harness 七层 | 第 3 章 | P1-3 Harness 七层代码 | F008-F013 ⏳ | ADR-007 ⏳ | `flowforge/core/harness/` | 0% |
| 4 | 多域记忆联邦 | 第 4 章 | P1-4 多域记忆联邦代码 | F014-F017、F039 ⏳ | ADR-008 ⏳ | `flowforge/core/memory/` | 0% |
| 5 | Eval 自代谢 | 第 5 章 | P1-5 Eval 自代谢代码 | F018-F020、F040 ⏳ | ADR-009 ⏳ | `flowforge/core/eval/` | 0% |
| 6 | 分布式可靠性 | 第 6 章 | P1-6 分布式可靠性代码 | F021-F025 ⏳ | ADR-010 ⏳ | `flowforge/core/reliability/` | 0% |
| 7 | 伙伴系统数学 | 第 7 章 | P1-7 伙伴系统数学代码 | 待规划 | ADR-011 ⏳ | `flowforge/core/partnership/` | 0% |

### Phase 1 启动前置条件

> **铁律**: 文档审核门禁（TIP-034）+ 代码实现规范（SOP.md §0.4）

| 前置条件 | 状态 | 说明 |
|---------|------|------|
| Phase 0 文档骨架完成 | 🔄 进行中 | P0-1~P0-7 进行中 |
| operator 审核通过 Phase 0 | ⏳ 待审核 | 待 Phase 0 完成后提交 |
| 8 份待创建 ADR（ADR-002/007/008/009/010/011 等） | ⏳ 待创建 | Phase 1 启动前需补齐 |
| 36 份待创建 Feature（F003-F007/F008-F040） | ⏳ 待创建 | Phase 1 启动前需补齐核心 Feature |

### 七大工程路径与 Phase 2-6 的关系

| Phase | 涉及的工程路径 | 说明 |
|-------|--------------|------|
| Phase 2 | 路径 1（能力画像）+ 路径 2（TeamAct） | forgemind 应用层使用能力画像路由 + TeamAct 编排多可进化智能体协作 |
| Phase 3 | 路径 3（Harness 七层） | 三方 Agent 调用需通过 Harness 六层 Guardrails |
| Phase 4 | 路径 5（Eval 自代谢）+ 路径 6（分布式可靠性） | Eval 完整实现 + Tier 1-4 恢复分级完整实现 |
| Phase 5 | 路径 7（伙伴系统数学） | 伙伴系统数学完整实现 + 自我演进闭环 |
| Phase 6 | 全部 7 条路径 | 经验蒸馏 SpiritForge + 多智能体议事 MindCouncil 基于全部 7 条路径的成果 |

详见: `[doc:arch.md#七大工程路径代码映射]`

---

## Phase 2：forgemind 应用层骨架 + 可进化智能体形态分类

> **目标**: 在 `flowforge/forgemind/` 下实现可进化智能体应用层，承载 5 种形态分类（BioForgekin / OrgForgekin / ObjForgekin / VirtualForgekin / HybridForgekin）。

**依赖**: P1 全部、F026-F030、F036-F038

**验收标准**:
- `flowforge/forgemind/` 目录结构完整（species/ forging/ sensors/ worlds/ marketplace/ lineage/ codex/ council/ config/ tests/）
- ForgekinBase 抽象类可被继承（observe/act/verify 三方法）
- ForgePipeline 可执行锻造流程
- ForgeMindPlugin 实现 Plugin V3 四钩子
- 5 种形态枚举可加载
- 进化阶（E1-E6）+ 觉醒阶（E1-E6）可查询
- E2E 测试：可锻造一个猫可进化智能体（BioForgekin）+ 接入物理传感器（F029）

**关键任务**:
- P2-1 forgemind 模块骨架（ForgekinSpecies / EvolutionStage / ForgekinBase / ForgePipeline / ForgeMindPlugin）
- P2-2 可进化智能体形态分类（5 种）
- P2-3 可进化智能体锻造流水线（YAML 配置 + 提示词外置 + 指标定义）
- P2-4 物理 AI 传感器接入（摄像头/麦克风/IoT）
- P2-5 虚拟世界设定层（VR/游戏/童话/神话/历史）
- P2-6 可进化智能体市场 + 进化谱系
- P2-7 forgemind 与 *Forge 关系（4 个 *Forge 可进化智能体适配）

详见: `[doc:task.md#Phase 2]`

---

## Phase 3：三方 Agent 适配层

> **目标**: 实现 ExternalAgentAdapter 抽象层，让可进化智能体可接入 claude code / codex / opencode / trae 等三方 Agent，作为能力扩展。

**依赖**: P1 全部、P2-1、F031-F035

**验收标准**:
- 4 个三方 Agent Adapter 全部可调用（claude code / codex / opencode / trae）
- ExternalAgentBridge 可执行 fallback 链
- ExternalAgentSharedState 可与 FlowForge 共享状态同步
- ExternalAgentCapabilityFusion 可融合三方 Agent 能力到可进化智能体画像
- 六层 Guardrails 全部启用
- E2E 测试：可进化智能体可调用 claude code 完成代码任务

**关键任务**:
- P3-1 三方 Agent 核心抽象（Adapter / Bridge / SharedState / Fallback / CapabilityFusion）
- P3-2 四个具体 Adapter（claude_code / codex / opencode / trae）
- P3-3 三方 Agent 配置外置（adapters.yaml / prompts.yaml / fallback.yaml / tool_allowlist.yaml）
- P3-4 六层 Guardrails 实现
- P3-5 worktree 隔离机制

详见: `[doc:task.md#Phase 3]`

---

## Phase 4：Eval 自代谢 + 分布式可靠性

> **目标**: 实现 Eval Contract + 七类归因 + Tier 1-4 恢复 + liveness 规范读模型，让 harness 能自我代谢。

**依赖**: P1-5、P1-6

**验收标准**:
- Eval Contract 五问可被任意 harness 组件实现（F018）
- 三方信号（trace + 人 + 自动）可交叉验证（F019）
- 七类归因矩阵可定位失败根因（F020）
- Tier 1-4 恢复分级可被可进化智能体调用（F022）
- liveness 规范读模型可被任何 agent 查询（F023）
- Harness Eval 控制面可每日汇总（F040）
- Build to Delete sunset 计时器可触发（F012）

**关键任务**:
- P4-1 Eval Contract 完整实现
- P4-2 三方信号交叉 + 七类归因
- P4-3 Tier 1-4 恢复 + liveness
- P4-4 Build to Delete sunset 计时器
- P4-5 Harness Eval 控制面

详见: `[doc:task.md#Phase 4]`

---

## Phase 5：伙伴系统数学 + 自我演进闭环

> **目标**: 实现伙伴系统数学公式 + 文档/代码/框架三层自我演进闭环。

**依赖**: P1-7、P4 全部

**验收标准**:
- 上限/下限/波动吸收公式可计算
- Token 账本可统计单 agent vs 团队成本
- 文档自我演进：Feature 完成后自动更新文档
- 代码自我演进：Eval 触发 sunset review 后自动重构
- 框架自我演进：ForgekinEngine 根据运行数据优化路由策略
- "自己开发自己"闭环可跑通

**关键任务**:
- P5-1 伙伴系统数学完整实现（上限/下限/波动吸收/Token账本/双层语言/最小必要复杂度）
- P5-2 文档自我演进（Feature文档自动更新 / ADR自动生成 / Eval结果归档）
- P5-3 代码自我演进（Feature→代码骨架 / Eval信号→harness重构 / 七类归因→Bug自动修复）
- P5-4 框架自我演进（ForgekinEngine路由优化 / TeamAct终止条件优化 / 记忆联邦权威等级调整）
- P5-5 "自己开发自己"闭环（11步闭环编排器 / 可进化智能体A-G角色定义 / E2E测试）

详见: `[doc:task.md#Phase 5]`

---

## Phase 6：经验蒸馏 SpiritForge + 多智能体议事 Mind Council

> **目标**: 实现 E4+ Evoling 状态 + 多可进化智能体议事机制。

**依赖**: P5 全部

**验收标准**:
- 经验蒸馏 SpiritForge 可在低活动期蒸馏经验到蒸馏知识库 Mind Codex
- 多智能体议事 Mind Council 可召集多可进化智能体议事
- E4+ Evoling 状态可触发（觉醒阶 ≥ E4）
- 多智能体议事决议可写入 VISION.md / ROADMAP.md
- operator 拉闸词可在多智能体议事偏离愿景时制动

**关键任务**:
- P6-1 经验蒸馏 SpiritForge 实现
- P6-2 多智能体议事 Mind Council 实现
- P6-3 E4+ Evoling 状态机
- P6-4 多智能体议事决议写回机制
- P6-5 operator 拉闸词集成

详见: `[doc:task.md#Phase 6]`

---

## 跨 Phase 不变量

以下规则在所有 Phase 都必须遵守，违反任何一条视为该 Phase 失败：

### T1-T8 测试铁律
| # | 铁律 |
|---|------|
| T1 | 禁止使用 Mock LLM |
| T2 | 禁止使用假数据 |
| T3 | 禁止跳过验证 |
| T4 | 禁止 Mock 工具 |
| T5 | 未实现即 Bug |
| T6 | 必须采集指标 |
| T7 | LLM 内容必须经 LLM 审核 |
| T8 | Web 功能必须操控浏览器验证 DOM |

### 15 条编程红线
1. 禁止添加 CoT 检测 / 中文比例检测
2. 质量分阈值默认 0.85（可在 Loop 配置中覆盖）
3. 禁止使用 Mock LLM
4. 禁止使用假数据
5. 禁止跳过验证
6. 禁止只看退出码不检查输出质量
7. 禁止在修复问题时修改不相关代码
8. 禁止删除已有测试用例
9. 禁止用继承替代组合/插件
10. 禁止在 flowforge 中写死业务领域代码
11. 禁止硬编码提示词/路径/密钥/端口
12. 禁止绕过 DI 容器直接实例化
13. 禁止直接操作数据库
14. 禁止不按 prompts.md 和 rules.md 执行
15. 禁止偷工减料（发现未实现即 Bug）

### operator 7 条愿景锚点
详见 `[doc:VISION.md#6]`

---

## 延伸阅读

- `[doc:task.md]` — 6 阶段任务清单（待办池）
- `[doc:VISION.md]` — 可进化智能体愿景
- `[doc:SOP.md]` — 可进化智能体协作 SOP
- `[doc:design.md]` — 当前阶段设计
- `[doc:roleagent.md]` — 多智能体工程路径白皮书
