# FlowForge 生态 landing_design.md 多角色深度审核意见（_mm 版）

> 审核日期：2026-06-15
> 审核角色：AI 智能体产品专家 / AI 高级架构师 / AI Agent 开发工程师 / 高级软件全栈工程师
> 审核范围：flowforge / devforge / contentforge / novelforge 四个项目的 `docs/landing_design.md`
> 重点参照：hiclaw/prompts.md（P1–P18 模板）、flowforge/docs/landing_plan.md、flowforge/docs/task.md、devforge/docs/optimization_plan.md、各项目 landing_plan.md，以及 `flowforge/core/flowforge.py`、`flowforge/loop/executor.py`、`novelforge/agents/base.py` 等关键源码的交叉验证
> 文档版本对照：flowforge 端到端 review_landing_design.md（v1）/ review_landing_design_deepseek.md（v2）已存在的问题，本审核作为"产品+架构+工程"三维深度版，**重点补充**：
> - 业务场景完整性与产品级 UX
> - 跨项目契约一致性与可扩展性
> - 实施依赖图与排期可行性
> - 代码 vs 设计的真实差距及风险量化

---

## 〇、整体评价与对比定位

### 0.1 多角色评分矩阵

| 评审维度（满分 5） | FlowForge | DevForge | ContentForge | NovelForge |
|---|:-:|:-:|:-:|:-:|
| **业务价值对齐**（产品） | 4.0 | 4.5 | 4.0 | 3.5 |
| **架构合理性**（架构） | 4.0 | 3.5 | 3.5 | 3.5 |
| **工程可落地性**（开发） | 2.5 | 2.5 | 2.0 | 2.0 |
| **生产可运维性**（全栈） | 2.5 | 2.0 | 1.5 | 1.5 |
| **横向一致性**（架构） | 3.5 | 3.5 | 3.0 | 3.0 |
| **可验证性**（全栈） | 2.0 | 2.0 | 1.5 | 1.5 |
| **综合** | **3.1** | **3.0** | **2.6** | **2.5** |

### 0.2 本版审核相对前两版的差异化贡献

- **业务视角补全**：前两版侧重架构与代码，本版补齐产品定位、用户旅程、商业场景与可观测性。
- **跨项目契约**：聚焦四份 landing_design.md 之间的字段命名、状态机、错误码、变量引用规范（`$outputs.xxx` vs `${state.xxx}`）不一致问题。
- **依赖图量化**：把所有"阻塞"条目展开为可执行的依赖矩阵与排期甘特要点。
- **代码-设计差距清单**：交叉验证 `flowforge/core/flowforge.py`、`flowforge/loop/executor.py` 等关键模块，列出"设计写到的但代码不存在"和"代码存在的但设计未覆盖"两个方向的 gap。
- **多角色观点分离**：每个问题明确标注哪位角色最关注、修复后影响哪个项目。

---

## 一、AI 智能体产品专家视角

### 1.1 业务场景完整性

#### P0 缺失：缺少"用户故事地图"与"端到端用户旅程"

四份 landing_design.md **通篇只讲架构、不讲用户**。以 DevForge 为例，dev_greenfield.yaml 设计了 9 道 DCP+TR 门禁，但**没有回答**：
- 谁提交任务？（PM / 架构师 / 开发者？）
- 门禁的"人工确认"如何被触发？（Web UI 按钮？IM 推送？邮件？）
- DCP-3 发布决策被驳回时，PM 在哪个页面看到？做什么操作？
- 跨部门协作（开发-测试-运维-安全）的并发与互斥如何表达？

**问题**：`flowforge/loop/executor.py` 第 80 行注释有 `on_iteration_create/update/complete` 三个回调（向 Repository 写迭代记录），但**没有给产品/前端暴露"任务进度展示"的 API 协议**。

**建议**：
- 每个项目 landing_design.md 顶部新增"用户旅程图"章节，含 3–5 个核心角色 + 关键操作节点。
- 补充 EventBus 事件到前端 WebSocket 推送的契约：`task.created` / `gate.review_ready` / `gate.human_required` / `iteration.retry_exhausted` 等。

#### P0 缺失：缺少"失败 UX 设计"

所有 landing_design.md 只画 PASS 路径，**完全缺少 FAIL 路径**：
- Reflexion 重试耗尽后用户看到什么？
- 门禁被 veto_dimensions 触发后，回退到哪个阶段、回退几次后升级？
- 沙箱内执行代码崩溃时，对外暴露什么信息？

**建议**：在每个 Phase 1 核心功能实现条目下，强制要求附"失败路径 UX 流程图"。

#### P1 缺失：缺少"用户价值度量"（KPI/OKR）

四份文档都未定义如何度量项目自身的成功。建议补充：

| 项目 | 北极星指标 | 健康指标 |
|------|---------|---------|
| FlowForge | 配置驱动率（Agent/Tool/Workflow 三大类 YAML 化率） | 启动时间、cold start 内存、并发 session 数 |
| DevForge | DCP 门禁准确率（与人工评审的一致性） | 端到端发布时长、hotfix 修复时长、自动回滚成功率 |
| ContentForge | SOP 完成率（深度长文从选题到发布一次通过率） | 平均审核次数、单篇发布耗时、平台适配成功 |
| NovelForge | 章节一致性得分、伏笔回收率 | 单章节生成耗时、Reflexion 收敛轮数 |

---

### 1.2 多端与多角色覆盖度

#### P0 问题：ContentForge Web 控制台设计严重不完整

`contentforge/docs/landing_design.md` 中 CF-P1-04 "Web 控制台 6 大页面" 只列页面名（选题、写作、审核、发布、复盘、配置），**未定义**：
- 实时协作（多人协同编辑同一篇 draft）
- 移动端适配（自媒体从业者主要用手机）
- 富文本编辑器选型（v1 已用 Tiptap，需在文档中固化）
- 暗色模式（长时创作场景刚需）

**CF-P1-04 应拆分为子任务**：
- 6 大页面 → 拆为 CF-P1-04a 前端技术栈定版（Next.js / Tiptap / Zustand / Tailwind 已有需固化）
- CF-P1-04b WebSocket 事件契约（Helm Studio 实时交互）
- CF-P1-04c 审核中心（pass / edit / reject 三态交互 + AI 改写建议）
- CF-P1-04d 移动端响应式布局
- CF-P1-04e 暗色模式与无障碍（a11y）

#### P1 缺失：DevForge 没有"开发者 IDE 集成"的细节

landing_design.md 中 ECO-07 VS Code 扩展只占半页纸，**未定义**：
- 哪些功能在 IDE 内、哪些在 Web
- IDE 内能触发哪些门禁（TR-1 代码评审？）
- 是否支持代码编辑历史回放
- 离线模式（无网时能否本地评审）

#### P1 缺失：NovelForge 没有"作家-编辑-AI"三方协作流程

8 阶段 Agent 全部是 AI 自主执行，**没有 human-in-the-loop 节点**（虽然 `quality_gate` 上有 `human_review: true`，但流程上没说在 Web 哪个页面给作家看）。

**建议**：在 novel_creation.yaml 的关键阶段（style_calibrate、writing_loop 写完每 5 章）增加 `human_review_node`，与前端"待审核"列表对接。

---

## 二、AI 高级架构师视角

### 2.1 架构合理性与借鉴深度

#### P0 过度借鉴：CAP-01 Source<A> 代数系统设计过深

`flowforge/docs/landing_design.md` 第 1837–2040 行，**整章近 200 行代码**实现了一个 5 类型的 Source 代数（Pure/Computed/Reconcile/Replace/Map），含 ContextFragment 的 6 字段结构（key/content/source/priority/merge_strategy/metadata）。

**问题**：
1. **现实问题规模不匹配**：FlowForge 当前仅 1 个 HarnessOrchestrator + 1 个 ContextEngine，**没有多源上下文需要 reconcile**。这一代数为"未来可能的多源"提前支付了复杂度。
2. **学习曲线陡**：4 个 *Forge 项目的开发人员要理解 5 种 Source、4 种 MergeStrategy、Generic[A]、ContextFragment 等概念，**收益与成本严重不匹配**。
3. **未在 *Forge 找到需求**：devforge/contentforge/novelforge 都没有"上下文片段优先级"诉求。
4. **替代方案足够**：当前 `_build_dynamic_context()` 已经是 dict 拼接，**加一个 priority 字段排序就够**。

**建议**（架构师决策点）：
- 把 CAP-01 降级为 P3，**改为 P0**: `context_priority: dict[str, int]` 简单实现，**保留 5 行配置语义**。
- 在 Phase 3 真的出现"多源上下文冲突"场景时，再升级到 Source<A> 代数。

#### P0 架构隐患：FWK-06 TurnTransition 状态爆炸

`flowforge/docs/landing_design.md` 第 580–768 行定义 `TurnKind` 含 6 种状态：
```
CONTINUE / REBUILD_PREPARED / AGENT_SWITCH / COMPLETED / FAILED / OVERFLOW_COMPACTION
```

**问题**：
1. **状态机不闭合**：`REBUILD_PREPARED` 和 `OVERFLOW_COMPACTION` 之后都跳到 `_reflect_and_replan`，二者的边界模糊。
2. **参数膨胀**：`TurnTransitionEngine.decide(verdict, attempt, max_retries, feedback_gate, context_utilization, compaction_threshold)` 7 个参数，调用方极易出错。
3. **与现有 LoopPhase 重复**：`LoopPhase` 已有 PENDING/RUNNING/REFLECTING/PAUSED/COMPLETED/FAILED/LOOPING 等状态，**TurnKind 与 LoopPhase 两套并行状态机**，会引入隐式不一致。
4. **`max_steps=25` 与 `max_retries=4` 优先级未定义**：当 attempt=4 已超 max_retries，但 attempt=4 还没到 max_steps=25，会进入 FAILED 分支而非 OVERFLOW_COMPACTION。

**建议**：
- 把 `TurnKind` 与 `LoopPhase` **合并为一张状态机表**（一张表，9 个状态，2 个维度：phase × kind）。
- `decide()` 只接收 `verdict + LoopContext`，把 7 个参数封装为 `LoopContext` 对象。
- 明确定义 max_steps 与 max_retries 的优先关系（**建议 max_steps 优先级高于 max_retries**，因为 max_steps 是 OpenCode 安全护栏）。

#### P0 借鉴不彻底：INF-02 EventStore 设计回退了 OpenCode 的关键能力

OpenCode 的 PromptInputManager 三阶段 admit→promote→execute 在 `optimization_plan.md` 中已识别（Pattern 3.2.1），但 `flowforge/docs/landing_design.md` 的 INF-02 只设计了简单的 `EventStore.append(event)`，**缺失**：
- **`steer` vs `queue` 投递语义**：用户中途插入指令应优先处理
- **`interrupt_seq` 抑制旧 wake**：避免重复 LLM 调用
- **inbox → promoted 状态机**：`SessionInputManager` 的三阶段

**问题**：`flowforge/loop/executor.py` 第 51–80 行构造函数已要求 `checkpoint_mgr`、`entropy_mgr`、`rule_evolution`、`persona_lock` 等 11 个依赖，**再加 EventStore + RunCoordinator 会让 LoopExecutor 构造变成"参数怪兽"**。

**建议**：
- 明确 `SessionInputManager` 是 LoopExecutor 的**可选项**（Phase 1 先做基础 EventStore，Phase 2 加 inbox 三阶段）。
- 给 LoopExecutor 加一个 `optional_components: dict` 注入入口，避免构造函数参数爆炸。

#### P1 借鉴片面：OpenCode 的 Effect Schema 在 FlowForge 中没有映射

OpenCode 用 Effect Schema 实现**端到端类型安全**（provider/auth/endpoint/framing 四轴 schema），但 FlowForge 沿用 Pydantic + dict：
- `LLMRequest` 是 `@dataclass` 而非 `BaseModel`，**没有运行时校验**
- `SessionEvent.data: Dict[str, Any]` 是黑盒 dict
- `WorkflowDefinition` 用了 Pydantic，但 `CompiledStep.metadata` 仍是 `Dict[str, Any]`

**建议**：
- 关键跨边界数据结构（LLMRequest / SessionEvent / CompiledStep / GateVerdict）**全部改为 Pydantic BaseModel**。
- Effect Schema 的"四轴正交"思想可借鉴为：`LLMProvider = Protocol × Auth × Endpoint × Framing` 的 dataclass 组合，替代现在 `LLMRouter._resolve_provider` 的字符串拼接。

#### P1 跨项目契约不一致（关键发现）

四份 landing_design.md 在**同一类概念**上使用了**不同命名/结构**：

| 概念 | FlowForge | DevForge | ContentForge | NovelForge |
|------|-----------|----------|--------------|------------|
| Agent 引用 | `agent: "name"` | `agent: "dev_xxx"` | `agent: "topic"` | `agent: "novel_concept"` |
| 变量引用 | `ctx.state["..."]` | `$outputs.xxx` | `${state.xxx}` | `${state.xxx}` / `${params.xxx}` |
| 状态输出 | `output: "draft"` | `output: "code"` | `output_mapping: {draft: "state_updates.draft"}` | `state_updates: {chapter_draft: "result.draft"}` |
| 门禁 | `gate_config` | `gate_config` | 无 | `quality_gate` |
| 超时 | `timeout_seconds: 300` | `timeout_seconds: 300` | 无 | 无（仅在 steps 级） |
| 错误处理 | `on_error: "abort"` | `on_error: "auto_rollback"` | 无 | 无 |
| 重试 | `retry_count: 0` | `retry: {max_attempts, strategy}` | 无 | `on_fail: {action, max_retries}` |
| 检查点 | 无显式字段 | `checkpoint: true` | `checkpoint: {enabled, backend, path}` | 无显式字段 |
| 阶段定义 | 隐式 | `stage: 0..5` 显式 | `order: 1..N` 隐式 | `phase: "concept".."completed"` |

**问题**：
1. **变量引用 3 种语法**：FlowForge 用 Python 表达式 `ctx.state["..."]`，DevForge 用 `$outputs.xxx`，ContentForge/NovelForge 用 `${state.xxx}` LangGraph 风格。**编译时无法统一校验**。
2. **Agent 命名空间冲突**：4 个项目都用单层命名（`topic`、`outline`），**跨项目合并时无法区分**（如 ContentForge 的 `topic` 和 NovelForge 的 `topic` 不能共存）。
3. **状态输出 3 种语法**：`output` / `output_mapping` / `state_updates`，**没有自动转换规则**。

**建议**（架构师必须推动）：
- **统一为 LangGraph 风格** `${state.xxx}` / `${params.xxx}` / `${result.xxx}`，FlowForge WorkflowCompiler 升级时同时支持。
- **命名空间加项目前缀**：`contentforge:topic` / `novelforge:outline` / `devforge:coder`，避免冲突。
- **统一状态输出**：`state_updates: {key: expression}` 一种语法。
- **统一错误处理/重试/超时**：定义 `execution_policy: {timeout, retry, on_error, on_anomaly}` 一个对象。
- **统一检查点**：`checkpoint: {enabled, backend, path, every_n_steps}`。

---

### 2.2 可扩展性与插件边界

#### P1 FlowForge 框架对 4 个 *Forge 的依赖方向反向

`flowforge/core/flowforge.py` 第 17–28 行有**反向依赖**：
```python
try:
    from contentforge.tools.toutiao_publisher import ToutiaoPublisherTool
except ImportError:
    ToutiaoPublisherTool = None
```

**这是 P11 架构腐化问题中"循环依赖"的典型表现**。FlowForge 框架**绝不能 import contentforge**，否则：
- 框架无法独立发布
- 测试时必须安装 ContentForge 才能跑
- Plugin 协议失效（FlowForgePlugin 是为解耦而设计的，结果 FlowForge 自身反向 import）

**建议**：
- 删除 `flowforge/core/flowforge.py` 第 17–28 行的反向 import。
- ToutiaoPublisherTool / WeChatPublisherTool / PexelsImageTool 通过 ContentForgePlugin 的 `register_tools()` 钩子注册。
- 同时在 `hiclaw/prompts.md` P9 契约验证中显式添加此检查项。

#### P1 插件机制不足以表达 *Forge 的业务复杂度

`flowforge/core/plugin.py` 的 `FlowForgePlugin` 协议目前只提供 `register_agents` / `register_tools` / `register_routes` / `register_event_handlers` 四个钩子。

**DevForge 实际需要**：
- `register_workflows`（4 种任务类型 workflow YAML）
- `register_gates`（10 个 DCP/TR 门禁 YAML）
- `register_evaluators`（8 个 Evaluator Agent）
- `register_canary_strategy`（金丝雀发布策略）
- `register_sandbox`（代码沙箱执行器）

**ContentForge 实际需要**：
- `register_sops`（4 种 SOP workflow）
- `register_topic_strategy`（4 级降级策略）
- `register_publish_platforms`（多平台 publisher 注册）

**NovelForge 实际需要**：
- `register_quality_gates`（6 道质量门）
- `register_context_layers`（5 层上下文管理）
- `register_novel_state_repository`（NovelState 强类型）
- `register_review_arbitrators`（盲评仲裁机制）

**问题**：当前插件协议过窄，*Forge 项目不得不**绕过插件协议**直接在 plugin.py 里塞 import。`flowforge/docs/landing_design.md` 第 1783 行的 INF-08 提到"DefensePipeline.L5-L10 新增"暗示了扩展点不足。

**建议**：
- 把 `FlowForgePlugin` 协议扩展为 `register_*` 全集：`register_workflows / register_gates / register_evaluators / register_sops / register_quality_gates / register_context_layers` 等。
- 引入 `register_workflow_step_handler` 钩子，让 *Forge 注入自定义 StepType（DevForge 注入 `gate`，ContentForge 注入 `sop_node`，NovelForge 注入 `quality_gate`）。
- 在 hiclaw/prompts.md P9 契约验证中**强制要求**所有 *Forge 业务能力通过插件协议暴露，禁止在 plugin.py 中直接注册。

#### P1 缺少年龄化/版本控制设计

`flowforge/docs/landing_design.md` 第 2116–2164 行 CAP-03 StaleTool 是基于 hash 的版本控制，**但以下对象没有版本控制**：
- Workflow YAML（v2.0 vs v3.0 切换时如何处理已运行的 task？）
- Agent YAML（同上）
- Persona 定义（hot reload 还是要重启？）
- Prompt 模板（prompts.yaml 改了，cache 怎么办？）

**建议**：
- 在 INF-09 架构边界清理后，新增"**配置版本控制**"小节：`ConfigVersion` 数据结构 + 启动时的"配置变更检测 + 优雅重启"。

---

## 三、AI Agent 开发工程师视角

### 3.1 实施依赖与排期可行性

#### P0 死锁：FWK-01 是真正的"鸡与蛋"

```
*Forge Phase 0  ── 依赖 ──>  FlowForge FWK-01 (Workflow YAML Compiler)
                              │
                              ├─ 自身依赖 FlowForge Phase 0
                              ├─ 自身依赖 FlowForge Phase 1 (LLMRouter, EventStore)
                              └─ 自身依赖 FlowForge Phase 2 (SystemContext, FiberSet)
```

`flowforge/docs/landing_design.md` 第 22 行写"FWK-01: Workflow YAML Compiler"是 Phase 0，但 Phase 1 的 INF-01 LLMRouter 也是它的依赖（因为 WorkflowCompiler 编译产物中 `mode: reflexion` 需要 LLMRouter 解析）。

**问题**：四份 landing_design.md 都说"Phase 0 渐进式迁移，先 FWK-01 MVP + fallback"，但**没有任何一份给出 FWK-01 MVP 的接口冻结清单**。

**建议**（开发工程师必须钉死）：
- FWK-01 MVP 接口冻结清单（必须支持）：
  - `WorkflowCompiler.compile(yaml_dict) -> CompiledWorkflow`
  - `CompiledWorkflow.to_sop_steps() -> List[Dict]`
  - 至少支持 SEQUENCE + CONDITIONAL + GATE 三种 StepType
  - 至少支持 `$outputs.xxx` 变量引用（与 DevForge 一致）
- FWK-01 MVP 不支持：
  - PARALLEL / FALLBACK / LOOP（推到 Phase 1）
  - Source<A> 代数（推后）
  - 嵌套 Workflow（推后）
- FWK-01 MVP 验收用例：dev_hotfix.yaml 能跑通。

#### P0 风险：删代码的回滚路径不清

四份 landing_design.md 共要删除 ~7871 行代码（ContentForge 2867 + NovelForge 2027 + DevForge 1877 + FlowForge 1100）：
- DevForge 7 处
- ContentForge 12 处
- NovelForge 5 处

**问题**：所有删除都说"过渡期保留 DeprecationWarning"，但**没有任何一个项目说明 DeprecationWarning 的保留时长**（6 个月？1 年？）。

**建议**：
- 明确 DeprecationWarning 期限：**3 个 minor 版本**或**6 个月**，以先到者为准。
- 在 `pyproject.toml` 中通过 `tools.deprecated` 配置表管理。
- 删除前必须用 `git grep` 全量搜索引用，确保 0 引用。
- 每批删除后跑 `pytest --collect-only` + E2E（即使有 mocking 也要跑骨架）。

#### P1 阻塞项 P0 化的失误

`flowforge/docs/landing_plan.md` 把 CAP-01 Source<A> 标 P1，但**它是 4 个 *Forge 都不需要的过度设计**。架构师应**主动降级**：
- CAP-01 Source<A> 代数：P1 → **取消或推 Phase 3**
- INF-08 十层安全防御：P0 → **降级 P1，先实现 L5/L6**
- CAP-10 FiberSet：P1 → **降级 P2（DevForge/ContentForge 当前用不到）**
- ECO-07 VS Code 扩展：P2 → **升级 P1**（DevForge 核心价值）

---

### 3.2 代码与设计的真实差距

#### P0 关键差距（设计写但代码不存在）

| 编号 | 设计 | 代码现状 | 风险 |
|------|------|---------|------|
| GAP-01 | `loop/executor.py` TurnTransition | 仅 Plan→Execute→Verify 三段 if-else | 高 |
| GAP-02 | `harness/compaction.py` DualThresholdCompactor | `SessionManager._summarize_older_messages` 仍是 `content[:2000]` 截断 | 中 |
| GAP-03 | `session/event_store.py` EventStore | 完全不存在 | 高 |
| GAP-04 | `compiler/workflow_compiler.py` | 整个目录不存在 | 高（全链阻塞） |
| GAP-05 | `compiler/conditional_router.py` | 整个目录不存在 | 中 |
| GAP-06 | `harness/persona_injector.py` | `PersonaLock` 存在但**没有自动注入机制** | 中 |
| GAP-07 | `llm/router.py` LLMRouter | 仅 `tools/llm_client.py` 单 Provider | 中 |
| GAP-08 | `core/di.py` DIContainer 升级 | 现有 DI 是 Service Locator | 中 |
| GAP-09 | `loop/fiber_set.py` FiberSet | `loop/parallel.py` 用 `asyncio.gather` | 中 |
| GAP-10 | `security/permission_v2.py` PermissionV2 | 现有 `PermissionPipeline` 仅 1 个 deny/ask/allow 顺序链 | 中 |
| GAP-11 | `events/durable_stream.py` DurableEventStream | 仅 `events/event_bus.py` 内存总线 | 中 |
| GAP-12 | `security/credential_store.py` | 仅 `core/secret_store.py` 且默认路径依赖包安装位置（BUG-FF-09） | 中 |
| GAP-13 | `config/layered_search.py` | 不存在 | 低 |

#### P0 关键差距（代码存在但设计未覆盖）

| 编号 | 代码现状 | 设计覆盖度 |
|------|---------|-----------|
| GAP-C01 | `flowforge/core/flowforge.py` 反向 import ContentForge 工具 | **完全未提及**（违反 P9 契约） |
| GAP-C02 | `flowforge/loop/executor.py` 的 11 个构造参数 | 设计文档**只展示了 4 个** |
| GAP-C03 | `novelforge/agents/base.py` BaseNovelAgent（已标记 deprecated） | 设计文档**未提删除计划**（应在 NF-P0-08 但**未写明与 flowforge.agents.generic.base.GenericAgent 的对比**） |
| GAP-C04 | `flowforge/loop/state.py` LoopPhase 7 状态 | 设计文档 TurnKind 6 状态，**两套并行未说明如何合并** |
| GAP-C05 | `flowforge/harness/entropy_manager.py` DebtTracker/RuleEvolution | 设计文档说"SQLite 持久化"，但**没说什么时候 fallback 到内存模式** |
| GAP-C06 | `flowforge/agents/declarative.py` | 4 个 *Forge 都引但**FWK-09 设计文档没引用此模块** |
| GAP-C07 | `flowforge/skills/loader.py` MarkdownSkill 加载器 | **ECO-02 MarkdownSkill 设计与现有 loader 重复**，未说明是替代还是并存 |
| GAP-C08 | `flowforge/memory/manager.py` MemoryManager | 设计文档**说用 FlowForge Memory**，但**没明确 MemoryManager 接口**（task.md BUG-FF 指 `add()` 方法签名不一致） |

**建议**：
- 上述 13+8 = 21 个 GAP 应该作为**单独的"实现追溯表"**追加到 `flowforge/docs/landing_design.md` 附录。
- 在 P11 架构腐化检测中，把 GAP-C01（FlowForge 反向 import）作为**最高优先级**修复。

#### P1 配置驱动率从 0% → 80% 的实操路径

`flowforge/docs/landing_plan.md` 第 36 行目标"Agent ≥ 80%、Tool ≥ 60%、Workflow ≥ 90%"是**没有细分到项目**的。

**实际细分**：

| 项目 | Agent 数 | Tool 数 | Workflow 数 | 当前驱动率 | 目标驱动率 |
|------|--------:|--------:|------------:|----------:|----------:|
| FlowForge | 12 内置 + 3 Generic | 14 | 0 | 0% | Agent 90% / Tool 60% |
| DevForge | 14 | 5 | 4 | 17% | Agent 100% / Tool 100% / Workflow 100% |
| ContentForge | 6 | 6 | 4 SOP | 0% | Agent 100% / Tool 100% / Workflow 100% |
| NovelForge | 8 | 5 | 1 | 0% | Agent 100% / Tool 100% / Workflow 100% |

**实施路径**：
1. **Week 1-2**：FWK-09 DeclarativeAgent YAML 加载器 + 1 个示例（topic_agent）
2. **Week 3-4**：ContentForge 6 个 Agent 全量 YAML 化（最具复用价值）
3. **Week 5-6**：DevForge 14 个 Agent YAML 化
4. **Week 7-8**：NovelForge 8 个 Agent YAML 化
5. **Week 9-10**：FlowForge 12 个内置 Agent YAML 化

---

## 四、高级软件全栈工程师视角

### 4.1 可观测性与运维

#### P0 缺失：所有 landing_design.md 缺少"可观测性设计"

4 份 landing_design.md 通篇没有：
- 业务指标（北极星 + 健康指标）
- Trace 链路（OpenTelemetry / Jaeger）
- 日志规范（结构化日志、PII 脱敏、trace_id 关联）
- 告警规则（哪些指标异常要告警）
- 仪表盘（开箱即用的 Grafana 模板）

**问题**：
- `flowforge/core/tracing.py` 的 `get_logger` **没有 trace_id 注入**（hiclaw/prompts.md P14 第 155 行要求）
- 4 份 landing_design.md 都没有 `event_id`、`session_id`、`task_id` 的全链路传播方案

**建议**：
- 在每个 Phase 1 入口增加 "可观测性前置条件"：
  - 每个 Agent 调用前注入 `trace_id`
  - 每个门禁决策记录结构化审计日志
  - 每个 LLM 调用记录 token 数 + 延迟 + 模型名
- 提供 4 个开箱即用的 Grafana 仪表盘：FlowForge 健康度 / DevForge 门禁通过率 / ContentForge 发布成功率 / NovelForge 一致性得分。

#### P0 缺失：缺少灾备与降级设计

- **DevForge**：金丝雀发布失败时回滚，但**回滚到哪个版本**？version history 存哪里？
- **ContentForge**：Playwright 发布失败时降级到 API 发布，但**降级后如何人工介入**？
- **NovelForge**：Reflexion 失败时打回重写，但**重写预算耗尽后**？
- **FlowForge**：LLM 全部不可用时，**如何降级到规则引擎**？

**建议**：
- 每个 Phase 1 必须配"**降级决策树**"小节。
- 增加 `task.degrade_to_human` 事件契约。

---

### 4.2 测试与质量门禁

#### P0 测试铁律违反风险

hiclaw/prompts.md T1-T6 + BUG-FF-09 + BUG-FF-10 已指出当前测试问题。4 份 landing_design.md **都没回答**：
- 如何验证"配置驱动率 80%"？（不能人工数 YAML 文件）
- 如何验证"门禁 9 个 DCP+TR 全部生效"？
- 如何验证"ContextEpoch 切换正确"？
- 如何验证"FallbackChain 链路"？

**建议**（全栈工程师推动）：
- 新增 `tests/config/test_*` 测试套件：
  - 自动扫描所有 `*.yaml` 配置，验证 Pydantic schema
  - 自动统计"配置驱动率 = 通过 schema 校验的 YAML 数 / 应配置项总数"
  - 每个 Phase 必须有"配置驱动率 ≥ 目标"作为前置验收
- 新增 `tests/integration/test_*` 端到端：
  - `test_greenfield_flow.py`（DevForge 9 道门禁）
  - `test_deep_article_sop.py`（ContentForge 完整 SOP）
  - `test_novel_creation.py`（NovelForge 8 阶段）
  - **用 HTTP Cassette 录制真实 LLM/HelixRAG 响应**（OpenCode 模式）

#### P1 缺少性能基线

所有设计项都没有性能指标，**没有 SLO 定义**。

**建议基线**（参考 OpenCode）：
| 组件 | 指标 | 目标 |
|------|------|------|
| WorkflowCompiler.compile() | 100 step 编译耗时 | < 50ms |
| SessionManager.check_and_compact() | 1MB 上下文压缩耗时 | < 500ms |
| FiberSet.parallel(10 workers) | 调度延迟 | < 10ms |
| EventStore.append() | SQLite WAL 模式 | < 5ms |
| PersonaInjector.inject() | 包含 5 个 Source resolve | < 30ms |
| LoopExecutor 单次迭代 | 端到端（含 1 次 LLM） | < 30s |
| DualThresholdCompactor | LLM 摘要 | < 10s |
| MultiJudgeVerifier | 3 个评委并行 | < 15s |

---

### 4.3 安全与合规

#### P0 CAP-02 PermissionV2 设计不完整

`flowforge/docs/landing_design.md` 第 2043–2112 行 PermissionV2：
```python
if last_match.decision == PermissionDecision.ASK:
    approved = await self._request_user_approval(last_match, tool_name, params, context)
```

**问题**：
1. `_request_user_approval` 假设 `context.request_user_approval` 方法存在，**但 TaskContext 没有定义此方法**。
2. ASK 超时怎么办？**文档没说**。
3. 多个 ASK 并发时如何去重？
4. **没有审计日志**：每次 ask→allow/deny 决策应记录到不可篡改日志。

**建议**：
- TaskContext 增加 `request_user_approval(tool, params, timeout)` 抽象方法
- FlowForge 提供默认 `WebSocketApprovalProvider`（推送到 Web UI）
- 每次决策写 `audit_log`（与 INF-08 集成）
- ASK 超时默认 DENY（fail-closed）

#### P0 INF-08 十层安全防御 L1-L10 全部为空实现

```python
async def check_input(self, ctx) -> bool:
    return True
```

**问题**：除名称外无任何设计细节。**L9 SandboxExecutor 推给 DevForge 不合理**——DevForge 的沙箱需要 FlowForge 提供 Tool 隔离 API。

**建议**：
- L1-L4 在 FlowForge 框架实现
- L5-L6 在 FlowForge 框架实现（与现有 Guardrails 集成）
- L7-L8 在 FlowForge 框架实现
- L9 在 DevForge Plugin 实现（用 FlowForge 提供的 ToolIsolation 抽象）
- L10 在 FlowForge 框架实现（替换 BUG-FF-09 的 SecretStore）
- 每层必须有：
  - 启用/禁用配置
  - 输入/输出契约
  - 默认策略（fail-open / fail-closed）
  - 指标埋点

#### P1 缺少年龄化/密钥管理设计

BUG-FF-09：`core/secret_store.py` 默认路径依赖包安装位置。CAP-12 CredentialStore 设计 OK 但**没有迁移计划**：
- 现有 `SecretStore` 中的密钥如何迁移到新 `CredentialStore`？
- Fernet 加密密钥如何管理？（不能硬编码）
- KMS / Vault 集成？

**建议**：
- 增加"密钥迁移 Runbook"
- `CredentialStore` 默认使用环境变量 `FLOWFORGE_MASTER_KEY`
- 提供 KMS 适配器接口（AWS KMS / HashiCorp Vault）

---

## 五、跨项目共性问题

### 5.1 四个项目 landing_design.md 的结构性失衡

| 章节 | FlowForge | DevForge | ContentForge | NovelForge |
|------|-----------|----------|--------------|------------|
| 设计哲学/原则 | ✅ 详尽 | ✅ 详尽 | ❌ 缺失 | ✅ 详尽 |
| 目录/TOC | ✅ 7 章 | ✅ 6 章 | ✅ 5 章 | ✅ 7 章 |
| Phase 0 详细设计 | ✅ 9 项 | ✅ 8 项 | ✅ 13 项 | ✅ 10 项 |
| Phase 1 详细设计 | ✅ 9 项 | ✅ 10 项 | ✅ 12 项 | ✅ 10 项 |
| Phase 2 详细设计 | ✅ 13 项 | ✅ 6 项 | ✅ 7 项 | ✅ 8 项 |
| Phase 3 详细设计 | ✅ 多项 | ✅ 4 项 | ✅ 5 项 | ✅ 5 项 |
| 跨 Phase 通用设计 | ✅ | ✅ 缺失 | ✅ 缺失 | ✅ 缺失 |
| 接口变更表 | ✅ 详尽 | ✅ 详尽 | ✅ 详尽 | ✅ 部分 |
| 向后兼容策略 | ✅ 详尽 | ✅ 详尽 | ✅ 详尽 | ✅ 详尽 |
| 验收标准 | ✅ 详尽 | ✅ 详尽 | ✅ 详尽 | ✅ 详尽 |
| **用户旅程** | ❌ | ❌ | ❌ | ❌ |
| **失败 UX** | ❌ | ❌ | ❌ | ❌ |
| **可观测性** | ❌ | ❌ | ❌ | ❌ |
| **灾备降级** | ❌ | ❌ | ❌ | ❌ |
| **性能基线** | ❌ | ❌ | ❌ | ❌ |
| **跨项目契约** | ❌ | ❌ | ❌ | ❌ |

**建议**：所有项目统一增加 5 个"横切关注点"章节：
1. 用户旅程
2. 失败 UX
3. 可观测性
4. 灾备降级
5. 性能基线

### 5.2 实施排期甘特建议

```
Week 1-2   [FWK-01 MVP: sequence + conditional + gate] (全链阻塞点)
Week 2-3   [FWK-09 MVP: DeclarativeAgent YAML loader + 1 示例]
Week 3-4   [FlowForge 内部清理: 修 BUG-FF-09/10, 删 GAP-C01 反向依赖]
Week 4-5   [ContentForge 6 Agent YAML 化 + 4 SOP YAML 化]
Week 5-6   [DevForge 14 Agent + 8 Evaluator + 10 Gate YAML 化]
Week 6-7   [NovelForge 8 Agent + 6 QualityGate YAML 化]
Week 7-8   [FlowForge 12 内置 Agent + 14 Tool YAML 化]
Week 8-9   [INF-01 LLMRouter + 1 个迁移示例]
Week 9-10  [INF-02 EventStore MVP (基础版不含 inbox 三阶段)]
Week 10-11 [ContentForge/NovelForge Phase 1 核心功能]
Week 11-12 [DevForge Phase 1 金丝雀+沙箱]
Week 12-13 [全栈回归测试 + 性能基线]
Week 13+   [Phase 2 能力升级（按优先级重排后实施）]
```

### 5.3 风险量化

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:----:|:----:|---------|
| FWK-01 MVP 延期 | 高 | 致命 | 提供"硬编码 fallback 模板"作为 Plan B |
| 4 个 *Forge 同步延期 | 中 | 严重 | **串行实施**而非并行：先 ContentForge，再 DevForge，再 NovelForge |
| 配置驱动率 0% 阻碍 | 高 | 致命 | 优先实现 FWK-09 MVP（最小 DeclarativeAgent） |
| 硬编码提示词未清零 | 中 | 严重 | 与 prompts.yaml 同步强校验（CI 阶段 grep） |
| 跨项目命名冲突 | 低 | 中 | 命名空间加项目前缀 |
| Agent 执行模式修正失败 | 中 | 严重 | 保留旧版 Agent 作为 fallback，分批修正 |

---

## 六、按项目落地的优先级 Top 10（融合 4 角色共识）

| 序 | 项目 | 编号 | 建议 | 紧急度 | 主导角色 |
|---|------|------|------|:------:|---------|
| 1 | FlowForge | GAP-C01 | 删除 `flowforge.py` 反向 import ContentForge 工具 | P0 | 架构师 |
| 2 | FlowForge | FWK-01 MVP | 实现 WorkflowCompiler MVP（仅 sequence + conditional + gate） | P0 | 开发工程师 |
| 3 | FlowForge | FWK-09 MVP | 实现 DeclarativeAgent YAML 加载器 | P0 | 开发工程师 |
| 4 | FlowForge | INF-02 MVP | 实现 EventStore SQLite WAL 模式 | P0 | 全栈工程师 |
| 5 | FlowForge | BUG-FF-09 | 修复 SecretStore 默认路径 | P0 | 全栈工程师 |
| 6 | 跨项目 | 统一变量引用 | 全生态统一为 `${state.xxx}` 语法 | P0 | 架构师 |
| 7 | 跨项目 | 命名空间前缀 | Agent 名加 `项目前缀:agent名` | P0 | 架构师 |
| 8 | ContentForge | CF-P0-01/02 | 6 Agent + 4 SOP 全量 YAML 化 | P0 | 开发工程师 |
| 9 | DevForge | DF-P0-01/03 | 4 Workflow + 14 Agent YAML 化 | P0 | 开发工程师 |
| 10 | NovelForge | NF-P0-01/02 | 8 Agent + 6 QualityGate YAML 化 | P0 | 开发工程师 |
| 11 | FlowForge | CAP-01 | **降级或取消 Source<A> 代数** | P1 | 架构师 |
| 12 | FlowForge | FWK-06 | 合并 TurnKind 与 LoopPhase 状态机 | P1 | 架构师 |
| 13 | DevForge | DF-P0-04 | 8 Evaluator YAML 化 | P1 | 开发工程师 |
| 14 | ContentForge | CF-P0-13 | 24 处硬编码提示词外置 | P0 | 全栈工程师 |
| 15 | NovelForge | NF-P0-09 | 14 处硬编码提示词外置 | P0 | 全栈工程师 |
| 16 | FlowForge | Plugin 协议扩展 | 增加 `register_workflows / register_gates / register_evaluators / register_sops / register_quality_gates` 钩子 | P1 | 架构师 |
| 17 | DevForge | DF-P1-01/02 | 金丝雀发布 + 自动回滚 | P1 | 全栈工程师 |
| 18 | 跨项目 | 可观测性 | 增加 trace_id 全链路传播 + Grafana 仪表盘 | P1 | 全栈工程师 |
| 19 | 跨项目 | 性能基线 | 8 项核心组件 SLO 目标 | P1 | 全栈工程师 |
| 20 | 跨项目 | 用户旅程图 | 4 个项目各加 1 张用户旅程图 | P2 | 产品专家 |

---

## 七、给架构评审委员会的建议

### 7.1 必须做（Do）

1. **冻结 FWK-01 MVP 接口**：开发工程师 24 小时内出 API 草案，所有 *Forge 项目对照确认。
2. **统一跨项目变量引用语法**：架构师 48 小时内召集 *Forge 负责人定稿。
3. **删除 FlowForge 反向 import**：全栈工程师 1 周内完成。
4. **扩展 Plugin 协议**：架构师 1 周内出 v2 协议草案。

### 7.2 不做（Don't）

1. **不实施 CAP-01 Source<A> 代数**：当前阶段过度设计。
2. **不并行启动 4 个 *Forge 的 Phase 0**：先 ContentForge 跑通模式，再 DevForge / NovelForge。
3. **不删除现有 Agent 的同时切换 YAML 化**：保留 Python 类作为 fallback，至少 3 个 minor 版本。
4. **不引入新的 LLM 路由层而不冻结旧 LLMClient 接口**：先冻结再重构。

### 7.3 重做（Redo）

1. **重做 CAP-01**：改为简单的 `context_priority: dict[str, int]`。
2. **重做 FWK-06 TurnTransition**：合并到 LoopPhase 状态机。
3. **重做 ContentForge CF-P1-04**：拆分为 5 个子任务，前端技术栈先定版。
4. **重做跨项目排期**：从并行改为串行+小步快跑。

---

## 八、总结

四份 landing_design.md **在"设计愿景"层面质量高**，OpenCode 借鉴策略合理，Phase 分层逻辑清晰，**融合影响矩阵**（FlowForge 附录）和**接口变更表**/**向后兼容策略**/**验收标准**三件套非常完整。

**但**在以下 6 个维度有结构性缺失，需要 4 个角色联动补齐：

| 维度 | 当前状态 | 期望状态 |
|------|---------|---------|
| 业务场景 | 4 份文档全无 | 用户旅程 + 失败 UX + 价值指标 |
| 跨项目契约 | 命名/语法 3 套不统一 | 单一规范 + 命名空间 |
| 实施依赖图 | 文字描述，无甘特 | 排期甘特 + 关键路径 + 风险量化 |
| 设计与代码差距 | 21 个 GAP 未识别 | GAP 表 + 优先级 + 修复 owner |
| 可观测性/性能 | 全无 | 8 项 SLO + Grafana + trace_id |
| 安全/灾备 | CAP-02 缺审计、INF-08 空设计 | 5 个降级决策树 + 密钥迁移 Runbook |

**最关键 3 条建议**（4 角色共识）：
1. **架构师**：统一跨项目变量引用语法 + Agent 命名空间前缀
2. **开发工程师**：FWK-01 MVP 必须先冻结接口再实施，否则全链阻塞
3. **全栈工程师**：删除 FlowForge 反向 import（违反 P9 契约铁律）

> 本审核基于 2026-06-15 的文档与代码状态。随着代码推进，本意见需要按 Phase 重新校准（建议在 Phase 0 结束时复审）。
