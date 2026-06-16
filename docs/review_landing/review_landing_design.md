# FlowForge 生态 landing_design.md 综合审核意见

> 审核日期：2026-06-15
> 审核角色：AI智能体产品专家、AI高级架构师、AI Agent开发工程师、高级软件全栈工程师
> 审核范围：flowforge/docs/landing_design.md、devforge/docs/landing_design.md、contentforge/docs/landing_design.md、novelforge/docs/landing_design.md
> 关联文档：hiclaw/prompts.md、flowforge/docs/landing_plan.md、flowforge/docs/task.md、devforge/docs/optimization_plan.md、各项目 landing_plan.md

---

## 一、总体评价

### 1.1 方案成熟度评分

| 项目 | 设计完整性 | 代码可落地性 | 架构合理性 | 风险可控性 | 综合评分 |
|------|:---------:|:----------:|:---------:|:---------:|:-------:|
| FlowForge | ★★★★☆ | ★★★☆☆ | ★★★★☆ | ★★★☆☆ | 3.5/5 |
| DevForge | ★★★★☆ | ★★☆☆☆ | ★★★★☆ | ★★★☆☆ | 3.0/5 |
| ContentForge | ★★★☆☆ | ★★☆☆☆ | ★★★☆☆ | ★★☆☆☆ | 2.5/5 |
| NovelForge | ★★★☆☆ | ★★☆☆☆ | ★★★☆☆ | ★★☆☆☆ | 2.5/5 |

### 1.2 总体判断

四个项目的 landing_design.md 在**设计层面**展现了完整的架构愿景和清晰的技术路线，OpenCode 借鉴策略合理，Phase 分层逻辑清晰。但存在以下**根本性矛盾**：

1. **设计-实现鸿沟极大**：设计文档版本 v6.0/v7.0 vs 代码版本 v0.1.0，差距严重
2. **框架能力前置依赖未解**：FWK-01~09 全部阻塞上层项目，但 FlowForge 自身基础设施也未就绪
3. **配置驱动率 0%**：当前 Agent/Tool/Workflow 配置驱动率均为 0%，设计文档假设的 YAML 驱动模式尚无代码支撑
4. **280项审计问题未清零**：task.md 中 P0 致命 36项、P1 严重 79项，与落地设计并行推进存在冲突

---

## 二、FlowForge landing_design.md 审核意见

### 2.1 优点

1. **融合而非替换的设计哲学**正确——在现有 Harness/Loop 骨架上注入 OpenCode 模式，而非推翻重建
2. **Phase 分层合理**：Phase 0（框架能力）→ Phase 1（基础设施）→ Phase 2（核心能力）→ Phase 3（生态），依赖关系清晰
3. **融合影响矩阵**（附录）非常有价值——列出了每个设计项对现有模块的影响和风险等级
4. **向后兼容策略**详尽——每个设计项都提供了 fallback 方案

### 2.2 问题与建议

#### P0 致命问题

**问题1：FWK-01 Workflow YAML Compiler 设计过度复杂**

WorkflowCompiler 同时承担编译、验证、转换三个职责，CompiledStep 的递归嵌套（branches/parallel_steps/fallback_chain/loop_config）导致编译产物难以调试。建议：
- 将编译器拆分为 Parser + Validator + CodeGen 三阶段
- 增加编译中间产物（IR）的可视化/调试能力
- 先实现 SEQUENCE + CONDITIONAL 两种 StepType，其余迭代扩展

**问题2：INF-02 Session 持久化与 EventStore 设计存在数据一致性风险**

EventStore 使用 SQLite 单文件存储，append() 后立即 commit，高频写入场景下性能堪忧。RunCoordinator 的 _runs 字典是纯内存的，进程崩溃后丢失。建议：
- EventStore 改为 WAL 模式 + 批量提交（每 100 条或每秒）
- RunCoordinator 的 _runs 状态也需要持久化到 EventStore
- 增加 snapshot compaction 机制——快照超过 N 个时合并

**问题3：INF-05 DualThresholdCompactor 的 LLM-based 摘要存在死循环风险**

当 Compaction 触发 LLM 摘要但 LLM 调用失败时，回退到 _extractive_summarize，但抽取式摘要可能仍然超过阈值，导致反复触发 Compaction。建议：
- 增加 Compaction 最大次数限制（如 3 次/Session）
- 抽取式摘要后强制截断到安全阈值以下
- 增加 Compaction 失败后的降级策略（如丢弃最旧消息）

**问题4：CAP-01 Source<A> 代数系统过度设计**

SystemContext 的 Source<A> 代数系统引入了 PureSource/ComputedSource/ReconcileSource/ReplaceSource/MapSource 五种类型，ContextFragment 含 key/content/source/priority/merge_strategy/metadata 六个字段。对于当前阶段的 FlowForge 来说，这个抽象层次过高，实际收益不明显。建议：
- Phase 2 先用简单的 Dict[str, ContextFragment] 实现，每个 Fragment 含 key/content/priority
- Phase 3 再引入代数操作（reconcile/replace/map）
- 优先保证 ContextEngine.inject() 的正确性，而非代数系统的完备性

#### P1 严重问题

**问题5：FWK-06 Reflexion Loop 与 LoopExecutor 的融合方案过于激进**

TurnTransition 替代 LoopExecutor._execute_iterations() 中的嵌套 if-else，但 TurnTransitionEngine.decide() 的参数列表过长（7个参数），且状态转换逻辑分散在 decide() 和 LoopExecutor._execute_iterations() 两个地方。建议：
- 将 feedback_gate、context_utilization、compaction_threshold 封装为 LoopContext 对象
- TurnTransitionEngine.decide() 只接收 verdict + LoopContext
- 保留现有 if-else 逻辑作为 fallback，TurnTransition 作为可选增强

**问题6：INF-03 DI 容器升级缺少生命周期管理**

DIContainer 的 SCOPED 生命周期未实现——resolve() 中只处理了 SINGLETON 和 TRANSIENT。SCOPED 生命周期需要请求级/会话级作用域容器，当前设计未涉及。建议：
- 明确 SCOPED 的使用场景（如 TaskContext 是否需要 SCOPED）
- 实现 ScopedContainer 子类，绑定到请求/会话生命周期
- 或先移除 SCOPED，只保留 SINGLETON + TRANSIENT

**问题7：CAP-10 FiberSet 的 next_completed() 超时时间过短**

next_completed() 使用 asyncio.wait_for(timeout=0.1)，100ms 的超时在 LLM 调用场景下太短，可能导致频繁返回 None。建议：
- 超时时间改为可配置，默认值设为 1.0s
- 或改用 asyncio.wait() 的 FIRST_COMPLETED 模式

**问题8：INF-08 十层安全防御设计过于粗略**

DefensePipeline 的 check_input() 和 check_output() 都是空实现，L5-L10 只列了名称没有详细设计。建议：
- 每层防御独立设计文档，明确输入/输出/配置/与 Harness 的集成点
- L5 InputGuardrail 和 L6 OutputGuardrail 优先实现（与现有 Guardrails 框架对接）
- L9 SandboxExecutor 放到 DevForge 专用，不从 FlowForge 层面实现

#### P2 一般问题

**问题9：FWK-07 PipelineCompiler 继承 WorkflowCompiler 不合理**

Pipeline 是 Workflow 的特化（仅 SEQUENCE 步骤），但 PipelineCompiler 继承 WorkflowCompiler 意味着 Pipeline 拥有了 Workflow 的全部能力（条件/回退/并行/循环），违反最小知识原则。建议：
- PipelineCompiler 独立实现，不继承 WorkflowCompiler
- 或 Pipeline 编译为 CompiledWorkflow(steps_type=SEQUENCE) 后由 WorkflowCompiler 统一处理

**问题10：ECO-07 VS Code 扩展缺乏优先级论证**

VS Code 扩展在 Phase 3，但开发者体验是 DevForge 的核心竞争力。建议评估是否提前到 Phase 2。

**问题11：缺少性能基线设计**

所有设计项都没有性能指标（如 Workflow 编译耗时、Compaction 耗时、FiberSet 调度延迟等）。建议：
- 每个关键组件定义性能基线
- 特别是 DualThresholdCompactor 和 FiberSet 需要基准测试

---

## 三、DevForge landing_design.md 审核意见

### 3.1 优点

1. **4种任务类型 workflow YAML 模板设计详尽**——greenfield.yaml 的 9 个门禁、6 个阶段定义完整，可直接指导实现
2. **架构边界清晰**——明确了 DevForge 作为 FlowForge Plugin 的定位，7 处架构违反的删除清单明确
3. **金丝雀发布和代码沙箱设计实用**——10%→50%→100% 渐进发布 + 自动回滚逻辑清晰

### 3.2 问题与建议

#### P0 致命问题

**问题1：4种 Workflow YAML 模板完全依赖 FWK-01，但 FWK-01 本身未实现**

dev_greenfield.yaml 使用了 gate 类型步骤、$outputs 引用、checkpoint_on_stage_complete 等高级特性，但 WorkflowCompiler 尚未实现这些能力。建议：
- 定义 FWK-01 的最小可行子集（MVP）：仅支持 sequence + conditional + gate 三种步骤类型
- DevForge 先用 MVP 子集实现 hotfix 和 change 两种简单模板
- greenfield 和 feature 模板在 FWK-01 完整版就绪后再迁移

**问题2：门禁 YAML 配置与 FlowForge ScoringRubric (FWK-08) 的映射关系未定义**

门禁配置中 dimensions/weight/threshold/veto_dimensions 等字段与 FWK-08 ScoringRubric 的 DimensionDef/RiskRule 如何映射？建议：
- 明确 gate_config → ScoringRubric 的转换规则
- veto_dimensions 映射为 RiskRule（action: "block"）
- on_reject.retry_strategy 映射为 Reflexion Loop 配置

#### P1 严重问题

**问题3：14个 Agent 执行模式修正缺乏渐进式方案**

当前所有 Agent 都是单次 LLM 调用，设计要求改为 Self-Discover/GoT/Reflexion/ReWOO/Multi-Agent 等模式。但一次性修正 14 个 Agent 风险极高。建议：
- 按影响面分三批：第一批 5 个核心 Agent（coder/architect/deploy/monitor/reviewer），第二批 5 个辅助 Agent，第三批 4 个支撑 Agent
- 每批修正后全量回归测试
- 保留旧版 Agent 作为 fallback

**问题4：代码执行沙箱设计缺少安全审计**

沙箱设计只列了黑名单（os.system, subprocess, eval, exec），但没有：
- 白名单机制（只允许特定模块 import）
- 沙箱逃逸检测
- 资源使用监控（CPU/内存/磁盘实时监控）
建议增加安全审计章节，参考 gVisor/Firecracker 的安全模型。

**问题5：金丝雀发布依赖 K8s 但无 Docker Compose 替代方案细节**

landing_plan.md 提到"先实现 Docker Compose 版本"，但 landing_design.md 中没有 Docker Compose 版本的设计。建议补充。

#### P2 一般问题

**问题6：删除独立 API 层后 WebSocket 支持如何保证**

当前 api/websocket.py 提供了 DevForge 专用的 WebSocket 端点，删除后需要通过 FlowForge 的 WebSocket 框架注册。建议明确 WebSocket 事件注册方案。

**问题7：通用逻辑下沉清单缺少优先级排序**

GateOrchestrator、GateConfig、Evaluator 基类、检查点策略四个下沉项没有优先级。建议：GateConfig 最先下沉（影响全部 4 个项目），GateOrchestrator 最后（需要 FlowForge 第 10 种模式支持）。

---

## 四、ContentForge landing_design.md 审核意见

### 4.1 优点

1. **6个专家 Agent YAML 定义规范**——每个 Agent 的 YAML Schema 包含 execution_mode/tools/model_assignment/persona_inject/output_schema，结构清晰
2. **SOP Workflow YAML 模板实用**——深度长文/快讯/微头条/系列四种模板覆盖主要场景
3. **AgenticRAG.search() 实现计划步骤明确**——5 步实现路径清晰

### 4.2 问题与建议

#### P0 致命问题

**问题1：Playwright 多平台发布设计缺失关键细节**

landing_design.md 中 CF-P1-03 Playwright 多平台发布只有高层描述，缺少：
- 登录态管理（Cookie/Session 持久化、多账号切换）
- 反检测机制（指纹伪装、UA 轮换）
- 发布失败重试策略（网络超时、页面结构变化）
- 平台 DOM 选择器维护方案（平台改版后选择器失效）
建议：增加 Playwright 发布引擎的详细设计，特别是登录态管理和选择器维护。

**问题2：Web 控制台 6 大页面设计缺失前端技术方案**

landing_design.md 只列了 6 个页面名称和功能，缺少：
- 前端技术栈选型（当前是 Next.js，是否继续？）
- 状态管理方案（创作流程的实时状态更新）
- WebSocket 集成方案（Helm Studio 的实时交互）
- 审核中心的 Tiptap 富文本编辑器集成方案
建议：增加前端架构设计章节。

**问题3：AgenticRAG.search() 与 OpenSieve 的集成关系未定义**

AgenticRAG 依赖 HelixRAG/Elasticsearch/Milvus，但 OpenSieve 已经提供了聚合检索能力。两者关系不清晰：
- AgenticRAG 是调用 OpenSieve API 还是直接访问 ES/Milvus？
- 如果调用 OpenSieve，AgenticRAG 的 SimHashDeduplicator/RRFFusion 是否与 OpenSieve 重复？
建议：明确 AgenticRAG 与 OpenSieve 的职责边界，优先使用 OpenSieve 的检索能力。

#### P1 严重问题

**问题4：PublishAgent 集成 PublishEngine 的路径不清晰**

当前 PublishAgent 只是简单循环调用 publish_{platform} 工具，PublishEngine 已实现 ContentAdapter/StaggeredPublisher/CircuitBreaker 但未被集成。设计文档缺少集成步骤：
- PublishAgent 如何调用 PublishEngine？
- PublishEngine 的 CircuitBreaker 状态如何持久化？
- StaggeredPublisher 的错峰间隔如何配置？
建议：给出 PublishAgent → PublishEngine 的调用链路图。

**问题5：24处硬编码提示词外置方案缺少迁移策略**

CF-P0-13 要求外置 24 处硬编码提示词，但没有说明：
- 外置后如何保证提示词内容不变（迁移验证）
- PromptManager 的加载优先级（YAML vs 代码默认值）
- 提示词版本管理方案
建议：参考 FlowForge 的 BUG-PROMPT-01 修复方案，统一迁移策略。

**问题6：删除独立 LLM 服务后模型路由如何保证**

ContentForge 的 tools/llm/router.py 有自己的模型路由逻辑（多供应商、健康检查），删除后依赖 FlowForge LLMRouter。但 FlowForge LLMRouter (INF-01) 尚未实现。建议：
- 保留 ContentForge 的 LLM 路由作为 fallback
- FlowForge LLMRouter 实现后逐步迁移

#### P2 一般问题

**问题7：内容适配引擎缺少平台格式规范**

ContentAdapter 的"同一文章自动适配不同平台格式要求"缺少具体规范：
- 今日头条的格式要求是什么？
- 微信公众号的格式要求是什么？
- 适配规则是硬编码还是可配置？
建议：增加平台格式规范表。

---

## 五、NovelForge landing_design.md 审核意见

### 5.1 优点

1. **架构边界原则明确**——"不修改 FlowForge 任何内核代码"，通过注册扩展
2. **数据一致性原则**——"五层上下文写入必须原子化"，章节保存+摘要生成+世界状态更新在同一事务中
3. **八大阶段 Agent YAML 定义详细**——每个 Agent 的 mode/got/reflexion/plan_execute 配置完整
4. **盲评与仲裁机制修正方案清晰**——独立 TaskContext + 仲裁分数覆盖 + 打回重写闭环

### 5.2 问题与建议

#### P0 致命问题

**问题1：八大阶段 Agent 执行模式修正缺乏 FlowForge 模式执行器的验证**

设计要求 NovelConceptAgent 使用 GoT 模式、OutlineAgent 使用 Plan-and-Execute 模式等，但 FlowForge 的模式执行器（react/plan_execute/reflexion/rewoo/got 等）自身是否已正确实现？task.md 中 BUG-FF-05 指出"模式参数与设计文档不一致"。建议：
- 先验证 FlowForge 9 大模式的正确性（FF1 提示词验证）
- 模式验证通过后再修正 NovelForge Agent
- 每个模式提供最小验证用例

**问题2：五层上下文管理写入路径修复的原子性保证不足**

设计要求"章节保存 + 摘要生成 + 世界状态更新在同一事务中"，但：
- L2 章摘要生成需要 LLM 调用（耗时 5-30 秒），LLM 调用不应在数据库事务中
- L5 世界状态更新涉及多个表（人物/时间线/伏笔/战力/地理），跨表事务复杂
建议：
- 采用 Saga 模式：章节保存 → 异步生成摘要 → 异步更新世界状态
- 每步失败有补偿操作（如摘要生成失败则标记为 pending，后台重试）
- 世界状态更新拆分为独立事务，按维度分别更新

**问题3：GoT (Graph of Thoughts) 模式在小说创作场景的适用性存疑**

NovelConceptAgent 和 FullReviewAgent 使用 GoT 模式，但 GoT 的多分支发散→交叉对比→合并收敛流程需要 3-5 次 LLM 调用，成本高且延迟大。对于小说创作场景：
- 概念孵化阶段是否真的需要 3 个分支？还是 1 个主方案 + 1 个备选方案更实用？
- FullReviewAgent 的 GoT 与三方盲评+仲裁是否功能重叠？
建议：
- NovelConceptAgent 改为 Plan-and-Execute（1 次规划 + 1 次执行），降低成本
- FullReviewAgent 保持 GoT（评审场景确实需要多角度），但限制分支数为 2

#### P1 严重问题

**问题4：SOUL 风格参数 8 维度补全缺少交互式校准的 UX 设计**

设计要求增加 author_feedback/author_tags/paragraph_annotations 三个反馈维度，但没有说明：
- 作家如何输入这些反馈？Web 界面？YAML 配置？
- paragraph_annotations 的粒度如何控制？（每段都标注 vs 关键段标注）
- author_tags 的预设标签列表从哪来？
建议：增加 SOUL 校准的交互设计章节。

**问题5：伏笔回收率追踪的自动提取机制未设计**

ForeshadowingTracker 需要"写作时自动提取伏笔标记"，但：
- 伏笔标记的格式是什么？（自然语言描述 vs 结构化标签）
- 如何从 LLM 生成的章节内容中自动提取伏笔？
- 提取准确率如何保证？
建议：
- 定义伏笔标记的 Schema（id, description, planted_chapter, expected_resolution, status）
- 在 ChapterWritingAgent 的 prompt 中要求 LLM 在章节末尾附加伏笔标记
- 伏笔提取后人工确认（Human-in-the-Loop）

**问题6：冻结/续写基本功能缺少检查点格式定义**

设计要求"从最后一个 checkpoint 恢复 State"，但 checkpoint 的格式未定义：
- checkpoint 包含哪些数据？（messages/state/metadata/context_epoch?）
- checkpoint 存储在哪里？（SQLite? 文件系统?）
- checkpoint 的大小限制？（长篇小说的 messages 可能很大）
建议：定义 Checkpoint Schema，与 FlowForge INF-02 Session 持久化对齐。

#### P2 一般问题

**问题7：一致性检测 5 个 Tool 的 LLM 增强语义验证缺少 Prompt 设计**

verify_power_system 和 compare_geography 从"只检查 !! 前缀"升级为"LLM 增强语义验证"，但缺少验证 Prompt 设计。建议：定义每个 Tool 的语义验证 Prompt 模板。

**问题8：质量门 QG-5 的 foreshadowing_recovery_rate ≥ 0.8 阈值过高**

80% 的伏笔回收率对于连载小说来说过于严格，很多长篇小说的伏笔回收率在 50-70%。建议：
- QG-5 阈值改为 ≥ 0.6（WARNING）和 ≥ 0.8（PASS）
- 增加 CONDITIONAL 状态

---

## 六、跨项目共性问题

### 6.1 框架依赖链未打通

四个项目的 Phase 0 全部依赖 FlowForge 的 FWK-01~09，但 FlowForge 自身的 Phase 0 也未实现。这形成了**循环等待**：

```
*Forge Phase 0 → FWK-01~09 → FlowForge Phase 0 → INF-01~09（也需要 FWK-01）
```

建议：
- FlowForge 先实现 FWK-01（Workflow Compiler）的最小可行版本
- *Forge 项目在 FWK-01 MVP 就绪后立即启动 Phase 0
- FWK-02~09 可以与 *Forge Phase 0 并行开发

### 6.2 配置驱动率从 0% 到 80%+ 的路径不清晰

所有设计文档都假设 Agent/Tool/Workflow 可以通过 YAML 声明，但当前配置驱动率为 0%。从 0% 到 80%+ 需要一个明确的迁移路径：

1. **第一步**：实现 DeclarativeAgent 的 YAML 加载器（FWK-09 MVP）
2. **第二步**：将纯 prompt+LLM+JSON 的 Agent 迁移到 YAML（约 15 个）
3. **第三步**：将需要工具绑定的 Agent 迁移到 YAML（约 20 个）
4. **第四步**：将需要复杂编排的 Agent 保留为 Python 类（约 10 个）

建议：每个项目给出具体的迁移清单和顺序。

### 6.3 硬编码提示词外置缺少统一方案

四个项目共 115 处硬编码提示词（FlowForge 77 + ContentForge 24 + NovelForge 14），但缺少统一的外置方案：
- PromptManager 的加载优先级（YAML > _DEFAULT_PROMPTS > 代码硬编码）
- 提示词的版本管理
- 提示词的 A/B 测试能力

建议：定义统一的 PromptManager 协议，四个项目统一实施。

### 6.4 删除重复代码的回归测试策略不足

四个项目共需删除 ~7871 行重复代码，但回归测试策略只有"分批删除，每批后全量回归测试"。问题是：
- 当前测试覆盖率低（很多模块无测试）
- E2E 测试依赖外部服务（LLM/HelixRAG/Milvus）
- 测试铁律违反严重（Mock LLM/假数据/跳过验证）

建议：
- 删除前先补充关键路径的集成测试
- 使用 HTTP Cassette（ECO-06）录制外部服务响应，消除外部依赖
- 定义"删除安全标准"：被删除模块的所有调用方都有测试覆盖

### 6.5 事件总线未统一

FlowForge EventBus、OpenSieve AgentBus、NovelForge 事件三套体系独立运行（BUG-PUB-02）。landing_design.md 中 CAP-11 DurableEventStream 是新增的第四套事件体系。建议：
- 统一为 FlowForge EventBus + DurableEventStream
- OpenSieve AgentBus 作为 EventBus 的桥接层
- NovelForge 事件通过 EventBus 发布

---

## 七、优化建议汇总

### 7.1 优先级调整建议

| 原优先级 | 建议调整 | 原因 |
|---------|---------|------|
| CAP-01 Source<A> 代数 | P1 → P2 | 过度设计，当前阶段简单 Dict 足够 |
| FWK-01 Workflow Compiler | P0 → P0（但缩小 MVP 范围） | 全链路阻塞，必须最先实现但需最小化 |
| INF-08 十层安全防御 | P0 → P1 | 设计过于粗略，先实现 L5/L6 两层 |
| ECO-07 VS Code 扩展 | P2 → P1 | DevForge 核心竞争力，提前投入 |
| NF-P1-02 Agent 执行模式修正 | P0 → P0（但分批实施） | 风险高，分 3 批渐进修正 |

### 7.2 新增建议项

| 编号 | 建议 | 优先级 | 说明 |
|------|------|--------|------|
| NEW-01 | 定义 PromptManager 统一协议 | P0 | 115 处硬编码提示词的统一解决方案 |
| NEW-02 | 定义 Checkpoint Schema 统一格式 | P1 | 四个项目的检查点格式统一 |
| NEW-03 | 增加 Workflow Compiler MVP 验收用例 | P0 | FWK-01 的最小可行版本需要明确的验收标准 |
| NEW-04 | 增加 AgenticRAG 与 OpenSieve 职责边界定义 | P1 | 避免检索能力重复建设 |
| NEW-05 | 增加性能基线设计 | P2 | 关键组件需要性能指标 |
| NEW-06 | 增加 Playwright 发布引擎详细设计 | P0 | 当前只有高层描述，缺少关键细节 |
| NEW-07 | 增加前端架构设计章节 | P1 | ContentForge Web 控制台缺少技术方案 |

### 7.3 实施节奏建议

```
Week 1-2:  FWK-01 MVP（sequence + conditional + gate）
Week 2-3:  FWK-09 DeclarativeAgent YAML 加载器
Week 3-4:  *Forge Phase 0 启动（YAML 配置化 + 提示词外置）
Week 4-6:  INF-01 LLM 路由 + INF-02 Session 持久化
Week 6-8:  *Forge Phase 1 启动（核心功能实现）
Week 8-10: INF-05 Compaction + CAP-10 FiberSet
Week 10-12: *Forge Phase 2 启动（能力升级）
Week 12+:  Phase 3 生态完善
```

---

## 八、结论

四个项目的 landing_design.md 在**设计层面**质量较高，架构愿景清晰，OpenCode 借鉴策略合理。但核心矛盾在于**设计-实现鸿沟**——设计文档假设的框架能力（FWK-01~09、INF-01~09）均未实现，上层项目无法启动。

**关键建议**：
1. **先打通 FWK-01 MVP**——这是全链路的阻塞点，最小可行版本只需支持 sequence + conditional + gate
2. **降低 CAP-01 Source<A> 代数的优先级**——过度设计，当前阶段简单方案足够
3. **统一 PromptManager 协议**——115 处硬编码提示词是全生态的共性问题
4. **分批实施 Agent 执行模式修正**——14+8=22 个 Agent 的模式修正风险极高，必须分批
5. **增加性能基线设计**——关键组件（Compaction、FiberSet、Workflow Compiler）需要性能指标

> 本审核意见基于 2026-06-15 的文档状态，随着代码实现的推进，部分意见可能需要更新。
