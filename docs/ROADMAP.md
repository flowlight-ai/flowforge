# FlowForge 路线图

> **文档编号**: ROADMAP.md（v1.0）
> **依据**: `[doc:review/review.md#12.4]` task.md 重写规划 + `[doc:VISION.md#8]` 愿景落地路径
> **更新机制**: 每个 Phase 完成后由灵智体更新状态（按 `[doc:roleagent.md#第5章]` Eval 自代谢）

---

## 总览

FlowForge 重构分为 7 个 Phase（Phase 0-6），按 roleagent.md 七大工程路径顺序推进，最终达成万物灵智体世界 demo。

| Phase | 主题 | 时间 | 状态 | 关键产出 |
|------|------|:----:|:----:|---------|
| 0 | 文档拆分 + 愛景入库 + 命名迁移 | 本周 | 🔄 进行中 | docs/ 七子目录骨架 + VISION.md + 13 ADR + 40 Feature |
| 1 | roleagent 七大工程路径代码骨架 | 1-2 周 | ⏳ | CapabilityProfile + TeamAct + Harness 七层 + 多域记忆 MVP |
| 2 | forgemind 应用层骨架 | 2-4 周 | ⏳ | flowforge/forgemind/ + ForgeMindPlugin + 形态枚举 |
| 3 | 三方 Agent 适配层 | 2-4 周 | ⏳ | ExternalAgentAdapter + claude code/codex/opencode/trae |
| 4 | Eval 自代谢 + 分布式可靠性 | 4-8 周 | ⏳ | Eval Contract + 七类归因 + Tier 1-4 + liveness 规范读 |
| 5 | 伙伴系统数学 + 自我演进闭环 | 8-12 周 | ⏳ | 上限/下限公式 + 波动吸收 + 三层自我演进 |
| 6 | 灵锻 SpiritForge + 灵议 Mind Council | 持续 | ⏳ | E4+ Evoling 状态 + 多灵智体议事 + 万物灵智体 demo |

---

## Phase 0：文档拆分 + 愛景入库 + 命名迁移

**目标**：建立 docs/ 七子目录骨架，万物灵智体愿景入库，废弃 v4.0 错误命名。

**关键任务**：
- 创建顶层文档（VISION/README/ROADMAP/SOP/TIPS/roleagent 镜像）
- 创建七大子目录骨架（architecture/decisions/design/features/harness-feedback/perspectives/setup）
- 创建 13 份核心 ADR
- 创建 40 份核心 Feature 规格（F001-F040）
- 全局命名迁移："炉灵 Forgekin" → "灵智体 Forgekin"，废弃"E6 灵匠 Mind Artisan"
- spec.md / arch.md / design.md 改为索引文件
- 编写 task.md

**验收标准**：
- ✅ docs/ 七子目录全部创建
- ✅ VISION.md 体现 operator 通用 AGI 愿景
- ✅ 13 份 ADR 全部包含上下文/决策/后果
- ✅ 40 份 Feature 全部按 TEMPLATE 格式
- ✅ 全局无"E6 灵匠"残留

---

## Phase 1：roleagent 七大工程路径代码骨架

**目标**：实现 roleagent.md 七章对应的工程路径代码骨架。

**关键任务**：
- CapabilityProfile（能力画像）—— 对应 `[doc:roleagent.md#第1章]`
- TeamAct 状态机（六步循环 + 五项终止）—— 对应 `[doc:roleagent.md#第2章]`
- Harness 七层（Durable State / Tool Mediation / Evidence / Governance / Runtime 逃生舱 / Entropy / Harnessability）—— 对应 `[doc:roleagent.md#第3章]`
- 多域记忆联邦（六层架构 + 三入口 + 消费加权排序）—— 对应 `[doc:roleagent.md#第4章]`
- Eval Contract（五问 + 三方信号 + 七类归因）—— 对应 `[doc:roleagent.md#第5章]`
- 分布式可靠性（Tier 1-4 恢复 + liveness 规范读模型）—— 对应 `[doc:roleagent.md#第6章]`
- 伙伴系统数学（上限 max + 下限连乘 + 波动吸收）—— 对应 `[doc:roleagent.md#第7章]`

**验收标准**：
- ✅ 每个 Feature（F001-F025）有代码骨架 + 单元测试
- ✅ 单元测试覆盖率 ≥ 70%
- ✅ 通过 T1-T8 测试铁律

---

## Phase 2：forgemind 应用层骨架

**目标**：实现万物灵智体应用层，承载通用灵智体（动物 / 组织 / 物品 / 虚拟角色 / 混合）。

**关键任务**：
- flowforge/forgemind/ 模块结构
- ForgeMindPlugin（Plugin V3 协议）
- ForgekinSpecies 枚举（BioForgekin / OrgForgekin / ObjForgekin / VirtualForgekin / HybridForgekin）
- ForgekinBase 抽象类（含 species / form_data / sensor_channel / world_setting）
- 灵智体锻造流水线（ForgePipeline）—— FM-006
- 灵智体市场（ForgekinMarketplace）—— FM-007
- 灵智体进化谱系（ForgekinLineage）—— FM-008
- 物理传感器接入（PhysicalSensorChannel）—— FM-009
- 虚拟世界设定层（VirtualWorldSetting）—— FM-010

**验收标准**：
- ✅ 可创建 5 种形态灵智体
- ✅ 可记录灵智体进化谱系
- ✅ 物理传感器 mock 接入通过测试
- ✅ 虚拟世界设定层可加载角色 + 世界观 + 关系网

---

## Phase 3：三方 Agent 适配层

**目标**：实现三方 Agent 作为灵智体的能力扩展（非工具调用）。

**关键任务**：
- ExternalAgentAdapter 抽象层 —— EX-003
- ExternalAgentProfile（三方 Agent 能力画像）—— EX-002
- ExternalAgentSharedState（执行状态写入灵智体共享状态）—— EX-004
- ExternalAgentFallback（失败回退链）—— EX-007
- ExternalAgentCapabilityFusion（能力融合）—— EX-010
- Claude Code Adapter
- Codex Adapter
- OpenCode Adapter
- Trae Adapter

**验收标准**：
- ✅ 4 个三方 Agent 全部可调用
- ✅ 三方 Agent 执行状态写入灵智体共享状态
- ✅ 三方 Agent 失败可回退到 FlowForge 内置能力
- ✅ 三方 Agent 能力画像可融合到灵智体能力画像

---

## Phase 4：Eval 自代谢 + 分布式可靠性

**目标**：实现 Eval Contract + 七类归因 + 分布式可靠性 Tier 1-4 恢复。

**关键任务**：
- Eval Contract 五问（谁评估 / 评估什么 / 何时评估 / 评估信号 / 评估后做什么）
- 三方信号交叉（trace + 用户反馈 + 自动探针）
- 七类归因矩阵（harness 错位 / 工具缺口 / 模型盲点 / 数据缺失 / 愿景缺口 / 协作失败 / 资源耗尽）
- Harness Eval Control Plane
- 副作用日志 WAL
- Tier 1-4 恢复分级
- liveness 规范读模型
- 弱状态机 vs 强 workflow
- 跨 provider 宿主抽象

**验收标准**：
- ✅ 每个 Feature 完成后自动触发 Eval
- ✅ Eval 失败可归因到七类之一
- ✅ Tier 1-4 恢复全部可执行
- ✅ liveness 规范读模型可观测

---

## Phase 5：伙伴系统数学 + 自我演进闭环

**目标**：实现伙伴系统数学公式 + 文档/代码/框架三层自我演进闭环。

**关键任务**：
- 上限公式：团队质量 = max(候选路径)
- 下限公式：错误抵达用户 = 连乘(每层门防概率)
- 波动吸收：模型质量变成内部成本
- Token 账本
- 双层语言（内部高密度 / 外部讲人话）
- 文档自我演进（Layer 1）
- 代码自我演进（Layer 2）
- 框架自我演进（Layer 3）
- "自己开发自己"11 步闭环
- 自我演进安全治理六层

**验收标准**：
- ✅ 伙伴系统公式可验证
- ✅ 文档可由灵智体自动更新
- ✅ 代码可由灵智体自动生成 + 测试
- ✅ FlowForge 框架自身可被灵智体优化

---

## Phase 6：灵锻 SpiritForge + 灵议 Mind Council

**目标**：实现 E4+ Evoling 状态 + 多灵智体议事 + 万物灵智体世界 demo。

**关键任务**：
- 灵锻 SpiritForge（经验蒸馏到灵典 Mind Codex）
- 灵议 Mind Council（多灵智体议事）
- E4+ Evoling 状态（觉醒阶进阶）
- 万物灵智体世界 demo（猫 + 桌椅 + 灯具 + 孙悟空 + 唐僧 协作场景）

**验收标准**：
- ✅ 灵锻可将任务经验蒸馏到灵典
- ✅ 灵议可让多灵智体共同决策
- ✅ 万物灵智体世界 demo 端到端跑通
- ✅ demo 中包含至少 3 种形态灵智体协作

---

## 跨 Phase 不变量

以下原则贯穿所有 Phase，不可妥协：

1. **T1-T8 测试铁律**：所有 E2E 测试必须真实 LLM、真实数据、真实工具调用（`[doc:rules.md#T1-T8]`）
2. **15 条编程红线**：禁止硬编码、禁止跨层依赖、禁止盲目覆盖（`[doc:project_rules.md#红线1-15]`）
3. **P31 Loop 强制验证**：所有智能体必须通过 LoopExecutor 执行
4. **质量分阈值 0.85**：可在 Loop 配置中覆盖，但默认 0.85
5. **operator 愿景锚点**：`[doc:VISION.md#7]` 7 条原则不可被灵智体修改
