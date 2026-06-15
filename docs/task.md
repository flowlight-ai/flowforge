# FlowForge + ContentForge + NovelForge 问题清单 — Prompt 验证与代码审计

> 基于 `hiclaw/prompts.md` 中公共模板(P1-P18)、FlowForge 模板(FF1-FF19)、ContentForge 模板(CF1-CF9)、NovelForge 模板(NF1-NF8)逐条验证，结合代码走读和设计文档对比，发现的所有问题。
> 审计日期: 2026-06-11 | 更新日期: 2026-06-15
> 审计方法: 逐条 Prompt → 对照设计文档 → 验证代码实现 → 记录差距
> 第三轮审计重点: 硬编码提示词全面排查、硬编码路径/密钥/配置、空实现/占位代码、绕过框架直接调用

---

## 一、FlowForge 架构问题

### BUG-FF-03: workflow_executor.py 已从1327行缩减至约375行 ✅ 已修复

- **来源**: P11 架构腐化检测 / FF1 九大模式验证
- **严重等级**: P2 — 一般
- **描述**: `workflow_executor.py` 已从1327行缩减至约375行，God Object问题已大幅改善。

### BUG-FF-05: 模式参数与设计文档不一致

- **来源**: FF1 九大模式验证 / A11 文档与代码一致性验证
- **严重等级**: P2 — 一般
- **描述**: 各模式的参数（如 MAX_STEPS、MAX_ITERATIONS 等）与设计文档定义不一致。例如 react 模式的 MAX_STEPS 设计为 8，代码中可能不同。
- **修复方案**: 统一代码与文档中的参数值

### BUG-FF-06: ArchitectureConstraintEngine 层映射与设计文档不匹配

- **来源**: FF3 四根护栏验证
- **严重等级**: P2 — 一般
- **描述**: `security/arch_constraint.py` 的 ArchitectureConstraintEngine 存在，但约束规则和层级映射与设计文档定义不完全一致。
- **修复方案**: 对齐设计文档更新约束规则

### BUG-FF-07: HelmDatabase 重复建表

- **来源**: FF8 Helm WebSocket E2E
- **严重等级**: P2 — 一般
- **描述**: Helm 相关的数据库表定义存在重复，可能导致初始化冲突。
- **修复方案**: 统一数据库表定义

### BUG-FF-09: SecretStore 默认路径依赖包安装位置

- **来源**: P14 代码质量门禁 / A5 安全审计
- **严重等级**: P2 — 一般
- **描述**: SecretStore 的默认存储路径依赖于 Python 包的安装位置，不同环境可能不一致。
- **修复方案**: 使用配置文件指定存储路径

### BUG-FF-10: Marketplace 下载回退创建空 Stub

- **来源**: FF18 SDK 能力验证
- **严重等级**: P2 — 一般
- **描述**: `core/marketplace.py` 的 Marketplace 在下载失败时创建空 stub 文件作为回退，可能导致后续使用时出现难以诊断的错误。
- **修复方案**: 下载失败时抛出明确异常，不创建空文件

---

## 二、ContentForge 功能问题

### BUG-CF-04: Agentic RAG 知识中枢 — search() 核心多源检索逻辑仍为占位

- **来源**: CF5 Agentic RAG 知识中枢验证
- **严重等级**: P1 — 严重
- **描述**: `contentforge/tools/agentic_rag.py` 框架骨架已存在，包含 SimHashDeduplicator、RRFFusion、TimeDecayWeighter、QueryUnderstanding、index_document() 等组件骨架，但 **`AgenticRAG.search()` 方法中核心多源检索逻辑仍为占位 `pass`**，未真正实现多源检索链路。

### BUG-CF-05: PublishAgent 未集成 PublishEngine — 仍缺少 llm_client 参数

- **来源**: CF6-CF7 发布技能与多平台发布验证
- **严重等级**: P1 — 严重
- **描述**: `contentforge/tools/publish_engine.py` 已实现 ContentAdapter(内容适配)、StaggeredPublisher(错峰发布)、PlatformCircuitBreaker(熔断保护)，但 **PublishAgent 仍未使用 PublishEngine**，仍只是简单循环调用 `publish_{platform}` 工具。此外 PublishAgent.__init__ 仍缺少 llm_client 参数。Playwright 自动化发布完全缺失。

### BUG-CF-06: Web 控制台严重缺失 — 缺审核中心/定时任务/专栏配置等

- **来源**: CF9 Web 控制台验证
- **严重等级**: P1 — 严重（从"仅3页面"降级为"4页面但缺关键功能"）
- **描述**: 前端现有4个页面（/, /create, /tasks, /templates），/create 页面含 Helm Studio WebSocket 实时交互，但缺少：
  - 审核中心（waiting_review 状态任务的审核操作界面）
  - 定时任务管理页面
  - 专栏配置管理页面
  - 模型配置管理页面
  - 发布日志页面
  - /settings 和 /help 页面（Sidebar引用但不存在）
  - Helm Studio 审核交互（pass/edit/reject 按钮）
- **影响**: 用户无法通过 Web 界面管理创作流程
- **修复方案**: 按优先级补充前端页面

### BUG-CF-07R: plugins.py 和 pyproject.toml 仍引用旧包名 contentforge.agents

- **来源**: P13 代码冗余检查 / CF-07 审核补充
- **严重等级**: P1 — 严重
- **描述**: `contentforge/agents/` 目录已删除，但 `plugins.py` 仍使用 `"contentforge.agents"` 作为 agents_package，`pyproject.toml` 的 entry-points 仍指向 `contentforge.agents.*`，存在17处残留引用。

### BUG-CF-08: core/pipeline.py 已标记废弃但代码仍存在

- **来源**: P11 架构腐化检测 / CF1 内容创作全流程验证
- **严重等级**: P2 — 一般（从"双体系重叠"降级为"已标记废弃但代码残留"）
- **描述**: `core/pipeline.py` 已标记为 DEPRECATED（使用 DeprecationWarning），明确提示使用 `brain.orchestrator.ContentForgeOrchestrator` 替代。但约1200行代码仍存在，可能被其他模块引用。
- **修复方案**: 确认无引用后删除 pipeline.py，或移至 archive/

### BUG-CF-09: DI 容器已初始化但主流程仍绕过容器

- **来源**: P14 代码质量门禁 / 铁律3
- **严重等级**: P2 — 一般
- **描述**: `contentforge/core/di_setup.py` 已实现完整 DI 容器配置，`main.py` 启动时调用了 `setup_di_container()`。但主流程中 Orchestrator 的实际创建路径是 FlowForgeSDK → Plugin → 直接实例化，**绕过了 DI 容器**。DI 容器初始化了但未被使用。
- **修复方案**: 让 FlowForge SDK 的 bootstrap 过程通过 DI 容器解析 Orchestrator

---

## 三、NovelForge 功能问题

> 以下为第三轮深度审计（2026-06-13）基于 NF1-NF8 提示词验证新增

### BUG-NF-01: 八大创作阶段 Agent 执行模式与设计文档严重不符

- **来源**: NF2 八大创作阶段验证 / A11 文档与代码一致性验证
- **严重等级**: P0 — 致命
- **描述**: 8个Agent文件均存在，但执行模式与设计文档arch.md定义严重不符：

| Agent | 设计文档模式 | 实际default_mode | 问题 |
|-------|-------------|-----------------|------|
| NovelConceptAgent | Graph of Thoughts | `"got"` | 实际只是单次LLM调用+JSON解析，**没有GoT的多分支发散→交叉对比→合并收敛**流程 |
| OutlineAgent | Plan-and-Execute | `"rewoo"` | ❌ 模式不匹配，且只是单次LLM调用 |
| StyleCalibrateAgent | Reflexion | `"reflexion"` | 模式正确但**没有Actor→Evaluator→Reflector循环** |
| ChapterWritingAgent | Reflexion+SOUL | `"reflexion"` | SOUL注入已实现但**没有自评循环** |
| ContinuityCheckAgent | ReAct | `"react"` | 模式正确但**没有Thought→Action→Observation循环** |
| PolisherAgent | ReWOO | `"rewoo"` | 只是单次LLM调用，**没有规划→并行执行→对比确认** |
| FullReviewAgent | Graph of Thoughts | `"agent_judge"` | ❌ 模式不匹配 |

- **影响**: Agent声明了模式但实际执行只是单次LLM调用，FlowForge的模式执行器未被真正利用
- **修复方案**: 每个Agent实现对应模式的核心循环逻辑，而非仅设置default_mode字符串

### BUG-NF-02: PublicationAdvisorAgent 完全缺失

- **来源**: NF2 八大创作阶段验证 / 铁律5（未实现即Bug）
- **严重等级**: P1 — 严重
- **描述**: 设计文档spec.md明确定义"出版顾问Agent"为阶段八专用Agent，但代码中完全不存在。`deps.py` 也未注册此Agent。阶段八"完稿审核"缺少商业评估能力。
- **修复方案**: 实现 PublicationAdvisorAgent，负责商业潜力评估、签约平台推荐、推广建议

### BUG-NF-03: agents/ 目录下新旧Agent文件命名冲突

- **来源**: P11 架构腐化检测 / P13 代码冗余检查
- **严重等级**: P1 — 严重
- **描述**: `novelforge/agents/` 目录下存在两套Agent文件，职责重叠：
  - 新版: `novel_concept_agent.py`, `outline_agent.py`, `chapter_writer_agent.py`, `continuity_agent.py`, `polisher_agent.py`, `full_review_agent.py`, `style_calibrate_agent.py`, `chapter_review_agent.py`
  - 旧版: `world_builder.py`, `style_refiner.py`, `outline_planner.py`, `novel_reviewer.py`, `dialogue_crafter.py`, `character_designer.py`, `chapter_writer.py`, `continuity_checker.py`
  - `continuity_checker.py`(GenericAgent子类) 与 `continuity_agent.py`(BaseNovelAgent子类) 实现同一职责
  - `deps.py` 中 import 了 `continuity_checker` 模块的 `ContinuityCheckerAgent`，但实际应使用 `continuity_agent` 模块的 `ContinuityCheckAgent`——**存在命名混乱**
- **影响**: 开发者不清楚该用哪个Agent，deps.py注册的可能不是正确的实现
- **修复方案**: (1) 删除旧版Agent文件 (2) 统一deps.py的import (3) 确保注册的是新版Agent

### BUG-NF-04: 五层上下文管理写入路径严重缺失

- **来源**: NF3 五层上下文管理验证
- **严重等级**: P1 — 严重
- **描述**: `core/context_manager.py` 存在但写入路径严重缺失：
  - **L1全文层**: 没有向量索引写入（write_context_layers中没有调用embedding_repo写入向量数据）
  - **L2章摘要层**: 摘要生成降级策略只是截断前200字，质量堪忧
  - **L3卷摘要层**: 逻辑缺失——`_regenerate_full_summary`只生成500字全书摘要而非卷摘要
  - **L4全书摘要层**: `_regenerate_full_summary`存在但没有持久化到数据库
  - **L5世界状态表**: 写入路径缺失——write_context_layers中没有更新world_state的逻辑（人物位置/关系/能力/情绪变化、时间线事件、伏笔状态等均未自动维护）
  - **输入组装逻辑**: 设计文档要求(L4全书摘要+L3当前卷摘要+L2前N-1章摘要+向量检索+第N-1章全文+SOUL)未完整实现，当前只返回previous_chapters和world_state
- **影响**: 写第N章时上下文不完整，长篇小说一致性无法保证
- **修复方案**: (1) 实现向量索引写入 (2) 实现L3卷摘要逻辑 (3) 实现L4持久化 (4) 实现L5世界状态自动维护 (5) 完善输入组装逻辑

### BUG-NF-05: SOUL 风格参数缺少3个反馈维度

- **来源**: NF4 SOUL风格参数验证
- **严重等级**: P1 — 严重
- **描述**: `core/style_profile.py` 的 StyleProfile 模型：
  - ✅ 5个核心维度已定义（narrative_voice/language_register/description_preference/dialogue_style/pacing_tendency）
  - ❌ 3个反馈维度缺失：
    - `author_feedback`（作家特别要求/自由文本）——设计文档spec.md明确定义
    - `author_tags`（预设标签列表）——设计文档明确定义
    - `paragraph_annotations`（段落级标注）——设计文档明确定义
  - `to_prompt_segment`方法只输出5个核心维度，缺少author_feedback注入
- **影响**: 风格校准阶段的作家反馈无法被注入后续章节的system prompt
- **修复方案**: (1) StyleProfile增加author_feedback/author_tags/paragraph_annotations字段 (2) to_prompt_segment注入author_feedback

### BUG-NF-06: 一致性检测5个Tool依赖不完整的world_state

- **来源**: NF5 一致性检测验证
- **严重等级**: P2 — 一般
- **描述**: 5个Tool文件均存在（search_character/search_timeline/check_foreshadowing/verify_power_system/compare_geography），但：
  - 都依赖world_state_repo中已有数据，但写入路径不完整（NF-04已指出），world_state表可能为空
  - verify_power_system和compare_geography只检查"!!"前缀标记作为矛盾标记，无真正的语义验证能力
  - 没有LLM增强的语义检索能力，只是简单的字符串匹配
- **影响**: 一致性检测形同虚设，无法发现真正的逻辑矛盾
- **修复方案**: (1) 修复world_state写入路径(NF-04) (2) Tool增加LLM增强的语义验证

### BUG-NF-07: 六道质量门检查条件与设计文档不一致

- **来源**: NF6 六道质量门验证
- **严重等级**: P2 — 一般
- **描述**: `core/quality_gate.py` 6道质量门已定义，但检查条件与设计文档不一致：
  - **QG-2**: 设计文档要求"大纲评分≥60且无致命逻辑矛盾"，代码只检查`outline.volumes.length >= 1`和`outline.climax_points.length >= 1`，**缺少评分检查和逻辑矛盾检查**
  - **QG-3**: 设计文档要求`style_confirmed == true`，代码检查`calibration_score >= 0.7`，**缺少style_confirmed布尔检查**
  - **QG-5**: 设计文档要求`foreshadowing_recovery_rate >= 0.8`，代码额外增加了`consistency_score >= 0.85`，与设计文档不一致
- **修复方案**: 对齐设计文档更新质量门检查条件

### BUG-NF-08: 盲评不严格 + 仲裁结果未覆盖评分 + 打回重写闭环缺失

- **来源**: NF7 盲评与仲裁验证
- **严重等级**: P1 — 严重
- **描述**: `core/review_orchestrator.py` 已实现三方并行盲评+加权+仲裁，但存在3个问题：
  - **盲评不严格**: 三个Reviewer共享同一个TaskContext，理论上可以互相看到状态，设计文档要求"互不可见"
  - **仲裁结果未覆盖评分**: 仲裁后返回的revision只是修改建议，没有用仲裁分数替换加权分数，score字段仍是原始加权分
  - **打回重写闭环缺失**: 设计文档要求"平均<70→打回写手Agent重写"，但ReviewOrchestrator只返回`passed: False`，没有触发重写的闭环逻辑
- **修复方案**: (1) 每个Reviewer使用独立的TaskContext副本 (2) 仲裁后用仲裁分数替换加权分 (3) 实现打回重写闭环

### BUG-NF-09: 冻结/续写/版本管理/回溯修改严重缺失

- **来源**: NF8 冻结与续写验证
- **严重等级**: P1 — 严重
- **描述**: `freeze_novel`/`unfreeze_novel` 基础方法存在，NovelStatus枚举包含FROZEN状态，但以下关键功能缺失：
  - **跨天审核持久化**: 设计文档要求"Event + 持久化双写"，当前只有内存中的Event，没有跨天恢复逻辑
  - **多版本管理**: 数据库有chapter_versions表和ChapterVersionModel，但ChapterRepository中没有版本写入和回滚方法
  - **回溯修改**: 设计文档要求"修改某一章后自动识别受影响章节并触发一致性重检"，完全未实现
  - **checkpoint保存**: 数据库有checkpoints表和CheckpointModel，但没有在写作循环中自动保存checkpoint的逻辑
  - **解冻续写**: unfreeze_novel只是简单将status改为"writing"，没有从最后一个checkpoint恢复State的逻辑
- **修复方案**: (1) 实现跨天审核持久化 (2) 实现版本写入和回滚 (3) 实现回溯修改触发 (4) 实现checkpoint自动保存 (5) 实现从checkpoint恢复

### BUG-NF-10: NovelForge 数据库路径硬编码

- **来源**: P14 代码质量门禁 / 铁律5
- **严重等级**: P2 — 一般
- **描述**: `novelforge/app/database.py` 中数据库路径硬编码为 `Path(__file__).resolve().parent.parent / "data" / "novelforge.db"`，违反铁律5"禁止硬编码路径"。
- **修复方案**: 从配置文件或环境变量读取数据库路径

### BUG-NF-11: NovelForge 测试中11个API端点测试失败

- **来源**: P7 测试铁律自检 / NF1 小说创作全流程验证
- **严重等级**: P1 — 严重
- **描述**: NovelForge测试中73个测试有11个失败，主要是API端点测试（404 Not Found），说明API路由未正确挂载。
- **修复方案**: 检查并修复API路由注册

---

## 四、公共模板验证问题

### BUG-PUB-01: FlowForge 与 ContentForge/NovelForge Plugin 集成机制混乱

- **来源**: P17 FlowForge SDK 集成规范 / P18 插件注册完整性
- **严重等级**: P1 — 严重（从"缺失"降级为"两套体系并存"）
- **描述**: ContentForge 存在两套并行的Plugin体系：
  - 旧体系（`contentforge/plugin.py`）: 继承FlowForgePlugin，实现register_agents/register_tools/register_routes
  - 新体系（`contentforge/plugins.py`）: 使用FlowForgeSDK.create_plugin()，通过agents_package自动扫描
  - 旧体系register_tools返回空dict（注释说"ContentForge tools are registered via FlowForgeSDK"）
  - NovelForge的deps.py同时使用SDK方式和直接FlowForge().register_agent()方式，两套注册机制混用
- **影响**: Agent/Tool注册路径不统一，可能出现重复注册或遗漏注册
- **修复方案**: (1) 统一为一套Plugin体系 (2) 清理旧体系代码 (3) NovelForge统一使用SDK方式

### BUG-PUB-02: 跨项目事件总线未统一

- **来源**: P16 跨项目集成验证 / P9 契约与弱耦合验证
- **严重等级**: P2 — 一般
- **描述**: FlowForge EventBus（通用发布-订阅）、OpenSieve AgentBus（Agent间通信+死锁检测）、NovelForge事件（订阅FlowForge EventBus）三套事件体系独立运行：
  - FlowForge EventBus和OpenSieve AgentBus完全独立，无法互操作
  - AgentBus有协作关系映射和死锁检测能力，EventBus没有
  - EventBus有请求-响应模式，AgentBus没有
- **影响**: 跨项目协作时事件链路断裂
- **修复方案**: 统一到 FlowForge EventBus 或增加桥接层

### BUG-PUB-03: 5个项目重复代码部分清理但仍存在

- **来源**: P13 代码冗余检查 / Q3 架构追问
- **严重等级**: P2 — 一般（从"大量重复"降级为"部分改善"）
- **描述**: 已改善：各项目Agent基类已统一继承flowforge.agents.generic.base.GenericAgent，Plugin注册已通过SDK统一。但仍存在：
  - 数据库层重复：每个项目独立实现database.py/models.py/Repository层，模式几乎相同
  - 配置管理重复：每个项目都有config/default.yaml/models.yaml/plugins.yaml/prompts.yaml
  - API路由结构重复：每个项目都有app/api/router.py/app/main.py/app/deps.py
  - NovelForge存在新旧两套Agent文件（NF-03已指出）
- **修复方案**: 将公共能力下沉到 FlowForge，上层项目通过 SDK 复用

---

## 问题统计

| 严重等级 | FlowForge | ContentForge | NovelForge | 公共 | 合计 |
|----------|:---------:|:------------:|:----------:|:----:|:----:|
| P0 致命 | 0 | 0 | 1 | 0 | 1 |
| P1 严重 | 0 | 1 | 5 | 1 | 7 |
| P2 一般 | 5 | 2 | 3 | 2 | 12 |
| **合计** | **5** | **3** | **9** | **3** | **20** |

**本轮审核已修复删除**: BUG-FF-01, BUG-FF-02, BUG-FF-04, BUG-FF-08, BUG-FF-11, BUG-FF-12, BUG-NEW-01, BUG-NEW-02, BUG-NEW-03, BUG-NEW-04, BUG-NEW-05, BUG-NEW-06, BUG-NEW-07, BUG-NEW-08, BUG-CF-02, BUG-CF-03, BUG-CF-10, BUG-CF-11（共 18 项）

**前轮已修复删除**: BUG-CF-01, BUG-CF-07, BUG-CF-12（共 3 项）

**2026-06-13 验证修复**: BUG-CF-04, BUG-CF-05, BUG-CF-07R 原标记已修复，经复核确认未修复，已恢复为未修复状态

**累计已修复**: 21 项（原24项，BUG-CF-04/05/07R复核确认未修复，扣除3项）

---

## 修复优先级建议

### 第一优先级（必须立即修复 — P0/P1）

1. **BUG-NF-01**: 八大创作阶段Agent执行模式与设计文档严重不符 → Agent声明了模式但实际只是单次LLM调用
2. **BUG-NF-02**: PublicationAdvisorAgent完全缺失 → 阶段八缺少商业评估能力
3. **BUG-NF-03**: agents/目录新旧Agent文件命名冲突 → deps.py注册可能不正确
4. **BUG-NF-04**: 五层上下文管理写入路径严重缺失 → 长篇小说一致性无法保证
5. **BUG-NF-05**: SOUL风格参数缺少3个反馈维度 → 作家反馈无法注入
6. **BUG-NF-08**: 盲评不严格+仲裁结果未覆盖+打回重写闭环缺失
7. **BUG-NF-09**: 冻结/续写/版本管理/回溯修改严重缺失
8. **BUG-NF-11**: 11个API端点测试失败 → API路由未正确挂载
9. **BUG-CF-04**: AgenticRAG.search()核心多源检索逻辑仍为占位pass
10. **BUG-CF-05**: PublishAgent未集成PublishEngine，仍缺少llm_client参数
11. **BUG-CF-06**: Web控制台缺审核中心/定时任务/专栏配置等关键页面
12. **BUG-CF-07R**: plugins.py和pyproject.toml仍引用旧包名contentforge.agents
13. **BUG-PUB-01**: Plugin集成机制两套体系并存 → 注册路径不统一

### 第二优先级（质量提升 — P2）

14. **BUG-FF-03**: workflow_executor.py已从1327行缩减至约375行 ✅ 已修复
15. **BUG-NF-06**: 一致性检测Tool依赖不完整的world_state
16. **BUG-NF-07**: 六道质量门检查条件与设计文档不一致
17. **BUG-NF-10**: 数据库路径硬编码
18. **BUG-CF-08**: pipeline.py已标记废弃但代码残留
19. **BUG-CF-09**: DI容器已初始化但主流程仍绕过
20. **BUG-PUB-02**: 跨项目事件总线未统一
21. **BUG-PUB-03**: 5个项目重复代码部分清理但仍存在
22. 文档一致性修复（BUG-FF-05, BUG-FF-06）
23. 安全问题修复（BUG-FF-07, BUG-FF-09, BUG-FF-10）

---

> **本文档与各项目 docs/ 下的设计文档互补。发现问题时请同步更新对应设计文档。**

---

## 五、硬编码提示词问题（第三轮审计新增）

> 以下为第三轮深度审计（2026-06-13）基于P16提示词外置验证模板全面排查发现

### BUG-PROMPT-01: FlowForge 77处硬编码提示词未外置到YAML

- **来源**: P16 提示词外置验证 / 铁律5（禁止硬编码）
- **严重等级**: P0 — 致命
- **描述**: FlowForge项目中77处LLM提示词硬编码在Python代码中，未外置到 `config/prompts.yaml`。最严重的问题：

| 模块 | 文件 | 硬编码数 | 说明 |
|------|------|:--------:|------|
| core | `prompt_manager.py` | 39 | `_DEFAULT_PROMPTS`字典与prompts.yaml双重定义，内容有差异 |
| brain | `plan_generator.py` | 2 | 初始计划生成(28行)+增量更新(46行)长提示词 |
| modes | `workflow_executor.py` | 3 | 翻译/代码/通用步骤系统提示 |
| modes | `rewoo.py` | 1 | ReWOO fallback提示 |
| modes | `workflow_validator.py` | 2 | LLM搜索提示 |
| tools | `web_search.py` | 2 | LLM搜索提示（与workflow_validator.py重复） |
| agents | `topic_research.py` | 2 | LLM搜索提示（与web_search.py重复，3处重复！） |
| agents/generic | `web_search_agent.py` | 4 | 搜索/计划/摘要/回退提示 |
| agents/generic | 16个通用Agent文件 | 16 | 每个Agent各自硬编码 |
| loop | `reflector.py` | 1 | 失败分析提示 |
| loop | `planner.py` | 2 | 计划生成+重计划提示 |
| harness | `feedback_loop.py` | 3 | 评判/评分提示 |

- **核心问题**:
  1. `_DEFAULT_PROMPTS`(39个)与`prompts.yaml`(38个)双重定义，内容有差异，以哪个为准？
  2. 同一搜索提示词在3个文件中重复硬编码
  3. 修改提示词需要改代码重新部署，违反配置外置原则
- **修复方案**: (1) 删除`_DEFAULT_PROMPTS`，PromptManager只从YAML加载 (2) 所有硬编码提示词外置到prompts.yaml (3) 代码通过`get_prompt(key)`加载 (4) 合并3处重复搜索提示词为1个YAML key

### BUG-PROMPT-02: ContentForge 24处硬编码提示词，prompts.yaml完全未被引用

- **来源**: P16 提示词外置验证 / 铁律5
- **严重等级**: P0 — 致命
- **描述**: ContentForge生产代码中24处硬编码提示词，`config/prompts.yaml`定义了21个提示词模板但**0个被实际使用**。两套提示词完全脱节。

| 模块 | 文件 | 硬编码数 | 说明 |
|------|------|:--------:|------|
| workers | `topic_agent.py` | 5 | 4策略选题+LLM搜索回退 |
| workers | `writer_agent.py` | 4 | 文章创作主提示词+3处fallback |
| workers | `editor_agent.py` | 1 | 编辑润色 |
| workers | `audit_agent.py` | 1 | 多维度审核评分 |
| workers | `fact_check_agent.py` | 2 | 交叉验证+选题验证 |
| app/api | `content.py` | 11 | 7个persona风格+创作+评估+反思+视频+系列+互动 |

- **核心问题**: prompts.yaml是"规划态"，代码硬编码是"运行态"，两者没有建立加载/引用关系
- **修复方案**: (1) 所有硬编码提示词外置到prompts.yaml (2) 代码通过PromptManager加载 (3) 删除prompts.yaml中未被使用的模板或补充对应实现

### BUG-PROMPT-03: NovelForge 14处硬编码提示词，prompts.yaml定义了但代码未引用

- **来源**: P16 提示词外置验证 / 铁律5
- **严重等级**: P0 — 致命
- **描述**: NovelForge生产代码中14处硬编码提示词，`config/prompts.yaml`定义了6个`agent.*`提示词但代码**完全忽略**这些配置，各自硬编码了不同版本。

| 模块 | 文件 | 硬编码数 | yaml有对应? |
|------|------|:--------:|:-----------:|
| agents | `novel_concept_agent.py` | 1 | ⚠️ 有但未引用 |
| agents | `outline_agent.py` | 1 | ⚠️ 有但未引用 |
| agents | `chapter_writer_agent.py` | 1 | ⚠️ 有但未引用 |
| agents | `market_analyst_agent.py` | 1 | ❌ 无 |
| agents | `style_calibrate_agent.py` | 1 | ❌ 无 |
| agents | `polisher_agent.py` | 1 | ⚠️ 有但未引用 |
| agents | `plot_integrator_agent.py` | 1 | ❌ 无 |
| agents | `publication_advisor_agent.py` | 1 | ❌ 无 |
| agents | `full_review_agent.py` | 1 | ⚠️ 有但未引用 |
| agents | `continuity_checker.py` | 1 | ⚠️ 有但未引用 |
| agents/reviewers | `emotion_reviewer.py`+`arbitrator.py` | 2 | ❌ 无 |
| core | `context_manager.py` | 2 | ❌ 无 |

- **修复方案**: 同上，全部外置到prompts.yaml并通过PromptManager加载

---

## 六、硬编码路径/密钥与代码质量问题（第三轮审计新增）

### BUG-CONFIG-01: FlowForge 多处硬编码路径和直接SQL

- **来源**: P14 代码质量门禁 / 铁律4+5
- **严重等级**: P1 — 严重
- **描述**:
  - `flowforge/core/system.py` 硬编码 `C:\\` 路径
  - `flowforge/memory/helm_db.py` 大量直接SQL操作绕过Repository层
  - `flowforge/memory/secret_store.py` 直接SQL操作
  - `flowforge/memory/mailbox.py` 直接SQL操作
  - `contentforge/core/task_store.py` 直接SQL操作
  - `novelforge/app/database.py` 硬编码数据库路径
- **影响**: 违反铁律4（禁止直接SQL）和铁律5（禁止硬编码路径）
- **修复方案**: (1) 路径从配置文件读取 (2) SQL操作迁移到Repository层

### BUG-CONFIG-02: FlowForge 4个核心工具为空实现/Stub

- **来源**: P10 未实现功能审查 / 铁律2+5
- **严重等级**: P0 — 致命
- **描述**:
  - `flowforge/tools/publish.py` — 发布工具返回stub数据
  - `flowforge/tools/video_generate.py` — 视频生成返回stub数据
  - `flowforge/core/mcp_integration.py` — MCP集成全部stub
  - `novelforge/tools/base.py` — 搜索基类抛NotImplementedError
- **影响**: 违反铁律2（禁止假数据/假逻辑）和铁律5（未实现即Bug）
- **修复方案**: 实现真实功能或删除stub代码并标记为未实现

### BUG-CONFIG-03: FlowForge SDK文档示例中硬编码IP和密钥

- **来源**: P14 代码质量门禁 / A5 安全审计
- **严重等级**: P2 — 一般
- **描述**: SDK文档/示例中包含硬编码的IP地址和API密钥示例
- **修复方案**: 使用环境变量占位符替代

---

## 问题统计（更新版）

| 严重等级 | FlowForge | ContentForge | NovelForge | 公共 | 提示词 | 配置 | 合计 |
|----------|:---------:|:------------:|:----------:|:----:|:------:|:----:|:----:|
| P0 致命 | 0 | 0 | 1 | 0 | 3 | 1 | **5** |
| P1 严重 | 0 | 3 | 5 | 1 | 0 | 1 | **10** |
| P2 一般 | 5 | 2 | 3 | 2 | 0 | 1 | **13** |
| **合计** | **5** | **5** | **9** | **3** | **3** | **2** | **28** |

**硬编码提示词统计**: FlowForge 77处 + ContentForge 24处 + NovelForge 14处 = **115处**

**累计已修复**: 21 项

---

## 修复优先级建议（更新版）

### 第一优先级（必须立即修复 — P0）

1. **BUG-PROMPT-01**: FlowForge 77处硬编码提示词 → 修改提示词需改代码重新部署
2. **BUG-PROMPT-02**: ContentForge 24处硬编码提示词 → prompts.yaml完全未被引用
3. **BUG-PROMPT-03**: NovelForge 14处硬编码提示词 → prompts.yaml定义了但代码未引用
4. **BUG-CONFIG-02**: 4个核心工具为空实现/Stub → 违反铁律2+5
5. **BUG-NF-01**: 八大创作阶段Agent执行模式与设计文档严重不符

### 第二优先级（必须尽快修复 — P1）

6. **BUG-NF-02**: PublicationAdvisorAgent完全缺失
7. **BUG-NF-03**: agents/目录新旧Agent文件命名冲突
8. **BUG-NF-04**: 五层上下文管理写入路径严重缺失
9. **BUG-NF-05**: SOUL风格参数缺少3个反馈维度
10. **BUG-NF-08**: 盲评不严格+仲裁结果未覆盖+打回重写闭环缺失
11. **BUG-NF-09**: 冻结/续写/版本管理/回溯修改严重缺失
12. **BUG-NF-11**: 11个API端点测试失败
13. **BUG-CF-04**: AgenticRAG.search()核心多源检索逻辑仍为占位pass
14. **BUG-CF-05**: PublishAgent未集成PublishEngine，仍缺少llm_client参数
15. **BUG-CF-06**: Web控制台缺审核中心/定时任务/专栏配置等
16. **BUG-CF-07R**: plugins.py和pyproject.toml仍引用旧包名contentforge.agents
17. **BUG-PUB-01**: Plugin集成机制两套体系并存
18. **BUG-CONFIG-01**: 多处硬编码路径和直接SQL

### 第三优先级（质量提升 — P2）

19. **BUG-FF-03**: workflow_executor.py已从1327行缩减至约375行 ✅ 已修复
20. **BUG-NF-06**: 一致性检测Tool依赖不完整的world_state
21. **BUG-NF-07**: 六道质量门检查条件与设计文档不一致
22. **BUG-NF-10**: 数据库路径硬编码
23. **BUG-CF-08**: pipeline.py已标记废弃但代码残留
24. **BUG-CF-09**: DI容器已初始化但主流程仍绕过
25. **BUG-PUB-02**: 跨项目事件总线未统一
26. **BUG-PUB-03**: 5个项目重复代码部分清理但仍存在
27. **BUG-CONFIG-03**: SDK文档示例中硬编码IP和密钥
28. 文档一致性修复（BUG-FF-05, BUG-FF-06）
29. 安全问题修复（BUG-FF-07, BUG-FF-09, BUG-FF-10）

---

## 七、P14A代码全量扫描问题（第四轮审计新增）

> 以下为第四轮深度审计（2026-06-13）基于P14A代码全量扫描模板逐文件逐行审计发现
> FlowForge 27项 + ContentForge 81项 + NovelForge 98项 = **206项新问题**

### 7.1 FlowForge P14A扫描结果（27项）

#### P0级（7项）

| # | 问题 | 文件 | 行号 | 铁律 |
|---|------|------|------|------|
| FF-P14A-01 | secret_key="changeme-in-production" 安全隐患 | core/system.py | - | 铁律5 |
| FF-P14A-02 | PublishTool.execute()返回stub数据 | tools/publish.py | - | 铁律2+5 |
| FF-P14A-03 | VideoGenerateTool.execute()返回stub数据 | tools/video_generate.py | - | 铁律2+5 |
| FF-P14A-04 | MCP Integration全部stub实现 | core/mcp_integration.py | - | 铁律2+5 |
| FF-P14A-05 | 10+存储模块全部直接sqlite3.connect()+裸SQL | memory/helm_db.py, secret_store.py, mailbox.py等 | - | 铁律4 |
| FF-P14A-06 | 提示词硬编码77处+跨文件重复3处 | 多文件 | - | 铁律5 |
| FF-P14A-07 | 数据库路径全部硬编码 | 多文件 | - | 铁律5 |

#### P1级（12项）

| # | 问题 | 文件 | 行号 | 铁律 |
|---|------|------|------|------|
| FF-P14A-08 | app/main.py模块级大量初始化 | app/main.py | - | 架构 |
| FF-P14A-09 | except ImportError: pass静默吞错 | app/main.py | - | 规范 |
| FF-P14A-10 | _DEFAULT_PROMPTS与prompts.yaml双重定义 | core/prompt_manager.py | - | 铁律5 |
| FF-P14A-11 | plan_generator.py 2处长提示词硬编码 | brain/plan_generator.py | L74-101,L142-187 | 铁律5 |
| FF-P14A-12 | feedback_loop.py 3处评判提示词硬编码 | harness/feedback_loop.py | - | 铁律5 |
| FF-P14A-13 | 16个通用Agent各自硬编码提示词 | agents/generic/*.py | - | 铁律5 |
| FF-P14A-14 | loop/planner.py 2处计划提示词硬编码 | loop/planner.py | - | 铁律5 |
| FF-P14A-15 | loop/reflector.py 1处反思提示词硬编码 | loop/reflector.py | - | 铁律5 |
| FF-P14A-16 | web_search相关3文件重复搜索提示词 | tools/web_search.py, agents/topic_research.py, modes/workflow_validator.py | - | 铁律5 |
| FF-P14A-17 | workflow_executor.py 3处步骤提示词硬编码 | modes/workflow_executor.py | - | 铁律5 |
| FF-P14A-18 | rewoo.py 1处fallback提示词硬编码 | modes/rewoo.py | - | 铁律5 |
| FF-P14A-19 | 硬编码端口号 | 多文件 | - | 铁律5 |

#### P2级（8项）

| # | 问题 | 文件 | 行号 | 铁律 |
|---|------|------|------|------|
| FF-P14A-20 | 部分函数缺少类型注解 | 多文件 | - | 规范 |
| FF-P14A-21 | 部分模块无测试文件 | 多模块 | - | 测试 |
| FF-P14A-22 | SDK文档示例硬编码IP和密钥 | sdk.py docstring | - | 铁律5 |
| FF-P14A-23 | Marketplace下载回退创建空Stub | core/marketplace.py | - | 铁律2 |
| FF-P14A-24 | HelmDatabase重复建表 | memory/helm_db.py | - | 规范 |
| FF-P14A-25 | ArchitectureConstraintEngine层映射不匹配 | security/arch_constraint.py | - | 文档 |
| FF-P14A-26 | 模式参数与设计文档不一致 | modes/*.py | - | 文档 |
| FF-P14A-27 | SecretStore默认路径依赖包安装位置 | memory/secret_store.py | - | 铁律5 |

---

### 7.2 ContentForge P14A扫描结果（81项）

#### P0级（8项）

| # | 问题 | 文件 | 行号 | 铁律 |
|---|------|------|------|------|
| CF-P14A-01 | DI容器TaskRepo()/AuditRepo()无参实例化必崩 | core/di_setup.py | - | 铁律3 |
| CF-P14A-02 | prompts.yaml定义21个模板但0个被引用 | config/prompts.yaml | - | 铁律5 |
| CF-P14A-03 | writer_agent.py单提示词近90行硬编码 | workers/writer_agent.py | L36-65 | 铁律5 |
| CF-P14A-04 | topic_agent.py 5处策略提示词硬编码 | workers/topic_agent.py | L87-220 | 铁律5 |
| CF-P14A-05 | content.py 11处提示词硬编码（含7个persona风格） | app/api/endpoints/content.py | L628-1190 | 铁律5 |
| CF-P14A-06 | AgenticRAG.search()多源检索为空占位 | tools/agentic_rag.py | L178-203 | 铁律2+5 |
| CF-P14A-07 | PublishAgent未集成PublishEngine | workers/publish_agent.py | - | 铁律2 |
| CF-P14A-08 | Web控制台缺审核中心/定时任务/专栏配置等6+页面 | web/src/app/ | - | 功能 |

#### P1级（26项）

| # | 问题 | 文件 | 铁律 |
|---|------|------|------|
| CF-P14A-09 | editor_agent.py 1处提示词硬编码 | workers/editor_agent.py | 铁律5 |
| CF-P14A-10 | audit_agent.py 1处28行提示词硬编码 | workers/audit_agent.py | 铁律5 |
| CF-P14A-11 | fact_check_agent.py 2处提示词硬编码 | workers/fact_check_agent.py | 铁律5 |
| CF-P14A-12 | research_agent.py提示词硬编码 | workers/research_agent.py | 铁律5 |
| CF-P14A-13 | plugins.py agents_package指向已删除的旧包 | plugins.py L11 | 铁律5 |
| CF-P14A-14 | pyproject.toml 16个entry-point引用旧包 | pyproject.toml L38-54 | 铁律5 |
| CF-P14A-15 | pipeline.py已标记废弃但1200行代码残留 | core/pipeline.py | 架构 |
| CF-P14A-16 | DI容器初始化了但主流程绕过容器 | app/main.py | 铁律3 |
| CF-P14A-17 | task_store.py直接SQL操作 | core/task_store.py | 铁律4 |
| CF-P14A-18 | 硬编码端口号 | 多文件 | 铁律5 |
| CF-P14A-19 | 硬编码超时/阈值 | 多文件 | 铁律5 |
| CF-P14A-20 | 单元测试Mock LLM调用（违反T1） | tests/unit/ | T1 |
| CF-P14A-21 | 单元测试使用假数据"test"/"hello"（违反T2） | tests/unit/ | T2 |
| CF-P14A-22 | 遇到错误直接pytest.skip()（违反T3） | tests/unit/ | T3 |
| CF-P14A-23 | 缺少集成测试 | tests/integration/ | 测试 |
| CF-P14A-24 | 缺少E2E测试 | tests/e2e/ | 测试 |
| CF-P14A-25 | API端点缺少参数校验 | app/api/ | 安全 |
| CF-P14A-26 | 部分函数缺少类型注解 | 多文件 | 规范 |
| CF-P14A-27 | 废弃import | 多文件 | 规范 |
| CF-P14A-28 | 裸except | 多文件 | 规范 |
| CF-P14A-29 | 同步I/O操作 | 多文件 | 规范 |
| CF-P14A-30 | Playwright自动化发布缺失 | tools/ | 铁律5 |
| CF-P14A-31 | SEO规划/优化Agent未实现 | workers/ | 铁律5 |
| CF-P14A-32 | 标题优化Agent未实现 | workers/ | 铁律5 |
| CF-P14A-33 | 内容改写Agent未实现 | workers/ | 铁律5 |
| CF-P14A-34 | 多语言翻译Agent未实现 | workers/ | 铁律5 |

#### P2级（47项）

| 类别 | 数量 | 说明 |
|------|:----:|------|
| 硬编码URL | ~8 | http://localhost等 |
| 硬编码超时/阈值 | ~12 | timeout=, max_retries=等 |
| 缺少类型注解 | ~15 | 函数参数/返回值 |
| 废弃import | ~5 | 未使用的import |
| 测试覆盖不足 | ~7 | 无测试文件的模块 |

---

### 7.3 NovelForge P14A扫描结果（98项）

#### P0级（16项）

| # | 问题 | 文件 | 铁律 |
|---|------|------|------|
| NF-P14A-01 | 15个Agent提示词全部硬编码，prompts.yaml定义了但未引用 | agents/*.py | 铁律5 |
| NF-P14A-02 | 八大创作阶段Agent执行模式与设计文档严重不符 | agents/*.py | 铁律5 |
| NF-P14A-03 | deps.py直接实例化绕过DI容器 | app/deps.py | 铁律3 |
| NF-P14A-04 | Agent注册逻辑重复执行两次 | app/deps.py | 铁律3 |
| NF-P14A-05 | 五层上下文管理写入路径严重缺失 | core/context_manager.py | 铁律2 |
| NF-P14A-06 | SOUL风格参数缺少3个反馈维度 | core/style_profile.py | 铁律5 |
| NF-P14A-07 | 一致性检测Tool依赖不完整的world_state | tools/*.py | 铁律2 |
| NF-P14A-08 | 盲评不严格+仲裁结果未覆盖+打回重写闭环缺失 | core/review_orchestrator.py | 铁律2 |
| NF-P14A-09 | 冻结/续写/版本管理/回溯修改严重缺失 | 多文件 | 铁律5 |
| NF-P14A-10 | PublicationAdvisorAgent完全缺失 | agents/ | 铁律5 |
| NF-P14A-11 | agents/目录新旧Agent文件命名冲突 | agents/ | 架构 |
| NF-P14A-12 | 11个API端点测试失败(404) | tests/ | 测试 |
| NF-P14A-13 | 数据库路径硬编码 | app/database.py | 铁律5 |
| NF-P14A-14 | novel_store.py 10处同步I/O阻塞事件循环 | tools/novel_store.py | 规范 |
| NF-P14A-15 | 全局异常处理器返回完整traceback | app/main.py | 安全 |
| NF-P14A-16 | 搜索基类抛NotImplementedError | tools/base.py | 铁律2 |

#### P1级（31项）

| # | 问题 | 文件 | 铁律 |
|---|------|------|------|
| NF-P14A-17 | novels.py 3个API返回假数据(role="supporting",x=0,y=0) | app/api/endpoints/novels.py | 铁律2 |
| NF-P14A-18 | 六道质量门检查条件与设计文档不一致 | core/quality_gate.py | 文档 |
| NF-P14A-19 | 硬编码端口号 | 多文件 | 铁律5 |
| NF-P14A-20 | 硬编码超时/阈值 | 多文件 | 铁律5 |
| NF-P14A-21 | 硬编码URL | 多文件 | 铁律5 |
| NF-P14A-22 | 裸except | 多文件 | 规范 |
| NF-P14A-23 | 部分函数缺少类型注解 | 多文件 | 规范 |
| NF-P14A-24 | 废弃import | 多文件 | 规范 |
| NF-P14A-25 | 缺少集成测试 | tests/ | 测试 |
| NF-P14A-26 | 缺少E2E测试 | tests/ | 测试 |
| NF-P14A-27 | 测试中Mock LLM调用（违反T1） | tests/ | T1 |
| NF-P14A-28 | 测试中使用假数据（违反T2） | tests/ | T2 |
| NF-P14A-29 | API端点缺少参数校验 | app/api/ | 安全 |
| NF-P14A-30 | continuity_checker.py与continuity_agent.py重复 | agents/ | 冗余 |
| NF-P14A-31 | chapter_writer.py与chapter_writer_agent.py重复 | agents/ | 冗余 |
| NF-P14A-32 | style_refiner.py与style_calibrate_agent.py重复 | agents/ | 冗余 |
| NF-P14A-33 | outline_planner.py与outline_agent.py重复 | agents/ | 冗余 |
| NF-P14A-34 | novel_reviewer.py与full_review_agent.py重复 | agents/ | 冗余 |
| NF-P14A-35 | world_builder.py未注册到deps.py | agents/ | 铁律5 |
| NF-P14A-36 | dialogue_crafter.py未注册到deps.py | agents/ | 铁律5 |
| NF-P14A-37 | character_designer.py未注册到deps.py | agents/ | 铁律5 |
| NF-P14A-38 | 摘要生成降级策略只是截断前200字 | core/context_manager.py | 铁律2 |
| NF-P14A-39 | L3卷摘要逻辑缺失 | core/context_manager.py | 铁律2 |
| NF-P14A-40 | L4全书摘要未持久化 | core/context_manager.py | 铁律2 |
| NF-P14A-41 | L5世界状态写入路径缺失 | core/context_manager.py | 铁律2 |
| NF-P14A-42 | 输入组装逻辑不完整 | core/context_manager.py | 铁律2 |
| NF-P14A-43 | verify_power_system只检查"!!"前缀 | tools/verify_power_system.py | 铁律2 |
| NF-P14A-44 | compare_geography只检查"!!"前缀 | tools/compare_geography.py | 铁律2 |
| NF-P14A-45 | 跨天审核持久化缺失 | core/ | 铁律5 |
| NF-P14A-46 | 多版本管理未实现 | core/ | 铁律5 |
| NF-P14A-47 | 回溯修改未实现 | core/ | 铁律5 |
| NF-P14A-48 | checkpoint自动保存缺失 | core/ | 铁律5 |

#### P2级（51项）

| 类别 | 数量 | 说明 |
|------|:----:|------|
| 硬编码URL | ~6 | http://localhost等 |
| 硬编码超时/阈值 | ~10 | timeout=, max_retries=等 |
| 缺少类型注解 | ~15 | 函数参数/返回值 |
| 废弃import | ~8 | 未使用的import |
| 裸except | ~4 | except: |
| 测试覆盖不足 | ~8 | 无测试文件的模块 |

---

## 问题统计（最终版）

| 严重等级 | FlowForge | ContentForge | NovelForge | 公共 | 提示词 | 配置 | P14A新增 | 合计 |
|----------|:---------:|:------------:|:----------:|:----:|:------:|:----:|:--------:|:----:|
| P0 致命 | 0 | 0 | 1 | 0 | 3 | 1 | 31 | **36** |
| P1 严重 | 0 | 3 | 5 | 1 | 0 | 1 | 69 | **79** |
| P2 一般 | 5 | 2 | 3 | 2 | 0 | 1 | 106 | **119** |
| **合计** | **5** | **5** | **9** | **3** | **3** | **2** | **206** | **234** |

**硬编码提示词统计**: FlowForge 77处 + ContentForge 24处 + NovelForge 14处 = **115处**

**违反铁律统计**:
- 铁律5（禁止硬编码）: 80+ 处
- 铁律2（禁止假数据/假逻辑）: 15+ 处
- 铁律3（禁止绕过DI容器）: 8+ 处
- 铁律4（禁止直接SQL）: 12+ 处
- 测试铁律T1-T6: 10+ 处

---

## 修复优先级建议（最终版）

### 第一优先级（必须立即修复 — P0，共52项）

**硬编码提示词（3项，影响115处代码）**:
1. BUG-PROMPT-01: FlowForge 77处硬编码提示词
2. BUG-PROMPT-02: ContentForge 24处硬编码提示词
3. BUG-PROMPT-03: NovelForge 14处硬编码提示词

**空实现/Stub（4项）**:
4. BUG-CONFIG-02: 4个核心工具为空实现/Stub
5. FF-P14A-02: PublishTool返回stub
6. FF-P14A-03: VideoGenerateTool返回stub
7. FF-P14A-04: MCP Integration全部stub

**安全漏洞（2项）**:
8. FF-P14A-01: secret_key="changeme-in-production"
9. NF-P14A-15: 全局异常处理器返回完整traceback

**架构致命问题（8项）**:
10. CF-P14A-01: DI容器TaskRepo()/AuditRepo()无参实例化必崩
11. FF-P14A-05: 10+存储模块全部直接SQL
12. FF-P14A-07: 数据库路径全部硬编码
13. NF-P14A-03: deps.py直接实例化绕过DI
14. NF-P14A-04: Agent注册逻辑重复执行两次
15. NF-P14A-14: novel_store.py 10处同步I/O阻塞
16. NF-P14A-16: 搜索基类抛NotImplementedError
17. BUG-NF-01: 八大创作阶段Agent执行模式与设计文档严重不符

**功能缺失（19项）**:
18-36. 见上文NF-P14A-05至NF-P14A-13, CF-P14A-06至CF-P14A-08等

### 第二优先级（必须尽快修复 — P1，共107项）
见上文各项目P1级问题清单

### 第三优先级（质量提升 — P2，共121项）
见上文各项目P2级问题清单

---

## 八、P8A架构边界违反问题（第五轮审计新增）

> 以下为第五轮深度审计（2026-06-13）基于P8A架构边界验证铁律发现
> 这是整个生态的根基问题——FlowForge应纯通用框架，*Forge应轻量业务扩展

### 8.1 FlowForge 含有特定领域业务代码（应移出）

**严重等级**: P0 — 致命（违反架构根基原则）

FlowForge中包含 **10个内容创作Agent + 1个开发Agent + 6个内容/素材Tool + 5个内容配置**，这些属于特定领域，应移到对应的*forge项目：

| # | 文件 | 所属领域 | 应移至 | 行数 |
|---|------|---------|--------|:----:|
| ARCH-FF-01 | agents/article_writing.py | 内容创作 | ContentForge | ~60 |
| ARCH-FF-02 | agents/article_eval.py | 内容创作 | ContentForge | ~40 |
| ARCH-FF-03 | agents/article_reflect.py | 内容创作 | ContentForge | ~30 |
| ARCH-FF-04 | agents/content_audit.py | 内容创作 | ContentForge | ~80 |
| ARCH-FF-05 | agents/content_repurposer.py | 内容创作 | ContentForge | ~70 |
| ARCH-FF-06 | agents/headline_optimizer.py | 内容创作 | ContentForge | ~90 |
| ARCH-FF-07 | agents/material_collection.py | 内容创作 | ContentForge | ~50 |
| ARCH-FF-08 | agents/publishing.py | 内容创作 | ContentForge | ~40 |
| ARCH-FF-09 | agents/seo_optimization.py | 内容创作 | ContentForge | ~60 |
| ARCH-FF-10 | agents/topic_research.py | 内容创作 | ContentForge | ~80 |
| ARCH-FF-11 | agents/code_writer_agent.py | 开发 | DevForge | ~70 |
| ARCH-FF-12 | tools/wechat_publisher.py | 内容发布 | ContentForge | ~50 |
| ARCH-FF-13 | tools/toutiao_publisher.py | 内容发布 | ContentForge | ~50 |
| ARCH-FF-14 | tools/publish.py | 内容发布 | ContentForge | ~40 |
| ARCH-FF-15 | tools/pexels_search.py | 素材检索 | ContentForge/OpenSieve | ~60 |
| ARCH-FF-16 | tools/pexels_image.py | 素材检索 | ContentForge/OpenSieve | ~40 |
| ARCH-FF-17 | tools/image_download.py | 素材检索 | ContentForge/OpenSieve | ~50 |
| ARCH-FF-18 | tools/video_generate.py | 内容创作 | ContentForge | ~30 |
| ARCH-FF-19 | config/loops/content_polish_loop.yaml | 内容创作 | ContentForge | ~30 |
| ARCH-FF-20 | config/loops/deep_article_loop.yaml | 内容创作 | ContentForge | ~40 |
| ARCH-FF-21 | config/loops/news_summary_loop.yaml | 内容创作 | ContentForge | ~30 |
| ARCH-FF-22 | config/loops/series_article_loop.yaml | 内容创作 | ContentForge | ~30 |
| ARCH-FF-23 | config/skills/content_audit.yaml | 内容创作 | ContentForge | ~20 |

**预计可移出代码**: ~1100行 + 5个配置文件

### 8.2 ContentForge 含有大量不应存在的重复服务代码

**严重等级**: P0 — 致命（违反*Forge轻量原则）

| # | 违反类型 | 文件 | 行数 | 应怎么做 |
|---|---------|------|:----:|---------|
| ARCH-CF-01 | 独立编排逻辑 | brain/orchestrator.py | 677 | 删除，使用FlowForge Orchestrator + Workflow |
| ARCH-CF-02 | 独立DI容器组装 | core/di_setup.py | 220 | 删除，通过SDK自动发现注册 |
| ARCH-CF-03 | 独立数据库层 | memory/stores/sqlite_store.py + memory/repositories/ | ~400 | 删除，使用FlowForge Memory |
| ARCH-CF-04 | 独立任务存储 | core/task_store.py | ~150 | 删除，使用FlowForge Memory |
| ARCH-CF-05 | 独立LLM服务 | tools/llm/model_service.py + router.py + helm_adapter.py | ~500 | 删除，使用FlowForge LLMClient |
| ARCH-CF-06 | 独立SOP编排 | brain/sop/deep_article.py + news_summary.py + review_controller.py | ~500 | 删除，使用FlowForge Workflow YAML |
| ARCH-CF-07 | 独立调度器 | brain/scheduler.py | ~100 | 删除，使用FlowForge Scheduler |
| ARCH-CF-08 | 独立Bridge封装 | core/flowforge_bridge.py | ~80 | 删除，直接用GenericAgent |
| ARCH-CF-09 | 独立SDK封装 | sdk/client.py | ~60 | 删除，直接用FlowForgeSDK |
| ARCH-CF-10 | 独立指标系统 | core/metrics.py | ~30 | 删除，直接用flowforge.metrics |
| ARCH-CF-11 | 独立回调系统 | core/callback.py | ~50 | 抽象为FlowForge通用通知机制 |
| ARCH-CF-12 | 独立配置系统 | core/config.py | ~100 | 简化，仅保留ContentForge特有字段 |

**预计可删除重复代码**: ~2867行

### 8.3 NovelForge 含有大量不应存在的重复服务代码

**严重等级**: P0 — 致命

| # | 违反类型 | 文件 | 行数 | 应怎么做 |
|---|---------|------|:----:|---------|
| ARCH-NF-01 | 独立编排逻辑 | core/orchestrator.py | 467 | 删除，使用FlowForge Orchestrator |
| ARCH-NF-02 | 独立核心模块 | core/下9个模块 | ~800 | 删除events/state_repository等重复模块，保留context_manager/quality_gate等NovelForge特有 |
| ARCH-NF-03 | 独立数据库层 | app/database.py + models.py + repositories/ | ~500 | 删除，使用FlowForge Memory |
| ARCH-NF-04 | 独立Deps组装 | app/deps.py | ~200 | 删除，通过SDK自动注册 |
| ARCH-NF-05 | Agent基类封装 | agents/base.py BaseNovelAgent | ~60 | 删除，直接用GenericAgent |

**预计可删除重复代码**: ~2027行（保留NovelForge特有的context_manager/quality_gate/style_profile/review_orchestrator等约500行）

### 8.4 DevForge 含有大量不应存在的重复服务代码

**严重等级**: P0 — 致命

| # | 违反类型 | 文件 | 行数 | 应怎么做 |
|---|---------|------|:----:|---------|
| ARCH-DF-01 | 独立编排逻辑 | core/orchestrator.py | 477 | 删除，使用FlowForge Orchestrator |
| ARCH-DF-02 | 独立配置系统 | core/config.py | ~100 | 删除，继承FlowForge SystemConfig |
| ARCH-DF-03 | 独立数据库层 | memory/database.py + repository.py + audit_service.py | ~400 | 删除，使用FlowForge Memory |
| ARCH-DF-04 | 独立工作流执行器 | core/workflow_executor.py | ~300 | 删除，使用FlowForge WorkflowExecutor |
| ARCH-DF-05 | 独立门控编排 | core/gate_orchestrator.py + agent_guard.py | ~200 | 抽象为FlowForge通用机制 |
| ARCH-DF-06 | 独立模型定义 | core/models.py | ~100 | 删除，使用FlowForge TaskContext |
| ARCH-DF-07 | 独立API层 | api/routes.py + schemas.py + websocket.py | ~300 | 通过plugins.py注册到FlowForge |

**预计可删除重复代码**: ~1877行

### 8.5 MallForge — 基本符合架构原则

MallForge是最接近理想架构的项目：仅有agents、tools、config、web和plugins.py，无独立core/memory/orchestrator。

唯一问题：plugins.py中直接定义了3个API端点，应抽离到独立的endpoints文件。

### 8.6 跨项目配置重复

| 配置文件 | 重复项目数 | 应统一管理方 |
|---------|:---------:|------------|
| config/models.yaml | 5 | FlowForge统一管理，*Forge不再重复 |
| config/default.yaml | 5 | FlowForge提供默认值，*Forge仅覆盖特有字段 |
| config/prompts.yaml | 5 | 各*Forge保留自己的（提示词是业务特有的） |
| config/plugins.yaml | 5 | 各*Forge保留自己的（插件是业务特有的） |

---

## 问题统计（最终版v3）

| 严重等级 | 前四轮 | P8A架构边界 | OpenCode对标 | 合计 |
|----------|:------:|:-----------:|:------------:|:----:|
| P0 致命 | 36 | 4 | 12 | **52** |
| P1 严重 | 79 | 0 | 28 | **107** |
| P2 一般 | 119 | 0 | 2 | **121** |
| **合计** | **234** | **4** | **42** | **280** |

**架构边界违反统计**:
- FlowForge含特定领域代码: 23处（~1100行 + 5配置文件）
- ContentForge含重复服务代码: 12处（~2867行）
- NovelForge含重复服务代码: 5处（~2027行）
- DevForge含重复服务代码: 7处（~1877行）
- **总计可删除重复代码: ~7871行**

### 8.7 FlowForge框架配置能力不足（导致*Forge必须代码继承）

**严重等级**: P0 — 致命（这是架构问题的根因）

当前各*Forge中82处通过代码继承扩展的案例，其中大部分本应通过配置驱动实现。以下是FlowForge框架缺失的配置能力清单：

#### P0级（影响全部4个项目，必须最先实现）

| # | 缺失能力 | 影响 | 说明 |
|---|---------|------|------|
| FWK-01 | **Workflow YAML Compiler** | 全部4个项目 | YAML定义→LangGraph图自动编译，含条件边/并行/中断点。当前3个项目各自用Python硬编码编排 |
| FWK-02 | **Conditional Router** | CF/NF/MF | 根据输入条件选择不同prompt模板/工具链/处理路径。当前TopicAgent/SupportAgent等用if-else硬编码策略路由 |
| FWK-03 | **Fallback Chain** | CF/NF/MF | 工具调用的有序回退链声明式定义(helixrag→web_search→llm_generate)。当前4个Agent各自硬编码回退逻辑 |

#### P1级（影响3+项目）

| # | 缺失能力 | 影响 | 说明 |
|---|---------|------|------|
| FWK-04 | **State Param Mapping** | CF/NF | 从state中自动填充agent输入参数(如style_profile←state.style_profile)。当前ChapterWritingAgent等硬编码参数注入 |
| FWK-05 | **Persona Auto-Inject** | CF | persona的SOUL/MEMORY/CREATION自动注入prompt。当前WriterAgent/EditorAgent等硬编码persona加载 |
| FWK-06 | **Reflexion Loop** | CF/DF | max_rounds + threshold + check_tool + retry_prompt。当前CoderAgent等硬编码自检循环 |
| FWK-07 | **Agent Pipeline** | MF | 串行步骤定义+步骤间数据传递+翻译链。当前ListingGeneratorAgent等硬编码多步pipeline |
| FWK-08 | **Scoring Rubric** | CF | 维度/权重/阈值/风险规则的声明式定义。当前AuditAgent硬编码15维度评分体系 |
| FWK-09 | **DeclarativeAgent state_updates** | NF | DeclarativeAgent增加state_updates映射配置。当前约15个纯prompt+LLM+JSON的Agent可YAML化但缺此能力 |

#### P2级（影响1-2个项目）

| # | 缺失能力 | 影响 | 说明 |
|---|---------|------|------|
| FWK-10 | **Gate Config** | DF | 门控类型+评估器+通过条件的声明式定义 |
| FWK-11 | **Execution Guard** | DF | 超时+熔断+重试的声明式定义 |
| FWK-12 | **CLI Tool Wrapper** | DF | executable + args_template + output_parser |
| FWK-13 | **Intent Router** | MF | 关键词→处理路径的映射 |
| FWK-14 | **Business Rules** | MF | 阈值判断/约束过滤的声明式定义 |
| FWK-15 | **Declarative API Endpoint** | MF | YAML定义端点→Tool映射 |

#### P3级（影响1个项目）

| # | 缺失能力 | 影响 | 说明 |
|---|---------|------|------|
| FWK-16 | **Context Pre-load** | NF | 执行前自动从工具加载特定数据 |
| FWK-17 | **Sub-Orchestrator** | NF | Agent内部嵌套编排其他Agent(如三方盲评+仲裁) |
| FWK-18 | **Checkpoint Config** | NF | 自动保存/恢复state |
| FWK-19 | **JSON Store Tool** | NF/MF | 基于JSON文件的CRUD工具声明式配置 |
| FWK-20 | **Formula Tool** | MF | 声明式公式计算工具 |
| FWK-21 | **Channel Plugin Protocol** | CF | 消息渠道标准扩展接口 |

### 8.8 配置驱动率统计

| 项目 | Agent配置声明 | Agent代码继承 | Agent独立实现 | Tool配置声明 | Tool代码继承 | Workflow配置 | Workflow代码编排 |
|------|:-----------:|:-----------:|:-----------:|:-----------:|:-----------:|:-----------:|:-------------:|
| ContentForge | 0 | 7 | 0 | 0 | 3 | 0 | 3 SOP |
| NovelForge | 0 | 12 | 0 | 0 | 7 | 0 | 1 Orchestrator |
| DevForge | 0 | 20 | 0 | 0 | 5 | 0 | 1 Orchestrator |
| MallForge | 0 | 6 | 0 | 0 | 6 | 1 YAML | 0 |
| **合计** | **0** | **45** | **0** | **0** | **21** | **1** | **5** |

**配置驱动率**: Agent 0/45=0%, Tool 0/21=0%, Workflow 1/6=17%

**目标配置驱动率**: Agent ≥80%, Tool ≥60%, Workflow ≥90%

---

## 修复优先级建议（最终版v3）

### 第负一优先级（FlowForge框架能力 — 不补齐则架构原则无法落地）

**FlowForge框架配置能力不足是所有架构问题的根因**，不补齐这些能力，*Forge就无法通过配置驱动，只能继续代码继承：

1. **FWK-01**: Workflow YAML Compiler（影响全部4个项目，消除5个独立Orchestrator）
2. **FWK-02**: Conditional Router（影响CF/NF/MF，消除if-else策略路由）
3. **FWK-03**: Fallback Chain（影响CF/NF/MF，消除4处硬编码回退逻辑）
4. **FWK-04**: State Param Mapping（影响CF/NF，消除参数注入硬编码）
5. **FWK-05**: Persona Auto-Inject（影响CF，消除persona加载硬编码）
6. **FWK-09**: DeclarativeAgent state_updates（影响NF，15个Agent可YAML化）

### 第零优先级（架构根基 — 框架能力补齐后立即执行）

7. **ARCH-FF**: FlowForge移出23处特定领域代码到对应*Forge（~1100行）
8. **ARCH-CF**: ContentForge删除12处重复服务代码（~2867行），改用FlowForge SDK
9. **ARCH-NF**: NovelForge删除5处重复服务代码（~2027行），改用FlowForge SDK
10. **ARCH-DF**: DevForge删除7处重复服务代码（~1877行），改用FlowForge SDK
11. 删除ContentForgeAgent/BaseNovelAgent/DevForgeAgent冗余中间层
12. 约15个纯prompt+LLM+JSON的Agent迁移到DeclarativeAgent YAML配置

### 第一优先级（P0，共52项）
见上文

### 第二优先级（P1，共107项）
见上文

### 第三优先级（P2，共121项）
见上文

---

## 九、OpenCode 对标差距问题（第六轮审计新增）

> 以下为第六轮审计（2026-06-15）基于 prompts.md 设计要求与实际代码对比发现
> 对标 OpenCode 等先进 Agent 框架的设计理念，识别当前生态的关键差距

### 9.1 FlowForge 对标差距

| # | 问题 | 来源Prompt | 严重等级 | 描述 |
|---|------|-----------|---------|------|
| OC-FF-01 | Reflexion模式MAX_ITERATIONS与设计文档不一致 | FF1 | P1 | 设计文档要求MAX_ITERATIONS=4，需验证代码是否一致 |
| OC-FF-02 | ModeRegistry智能推荐无降级逻辑 | FF2 | P1 | 推荐模式执行失败时应自动降级到备选模式，当前未实现 |
| OC-FF-03 | FeedbackLoop三种评估模式未完整实现 | FF4 | P1 | full/lightweight/skip三种模式需验证是否真正区分 |
| OC-FF-04 | Skill系统四种格式兼容未验证 | FF11 | P1 | FlowForge/Claude Code/Anthropic/Trae CN四种格式兼容性未验证 |
| OC-FF-05 | Skill组合技(Combo Skills)未实现 | FF11 | P1 | 多Skill管道编排能力未实现 |
| OC-FF-06 | Skill触发器匹配未实现 | FF11 | P1 | 自然语言触发词自动匹配+置信度评分未实现 |
| OC-FF-07 | Skill版本管理未实现 | FF11 | P2 | 语义化版本+依赖管理未实现 |
| OC-FF-08 | MCP Streamable HTTP传输未实现 | FF12 | P1 | 仅支持stdio传输，Streamable HTTP未实现 |
| OC-FF-09 | Memory TaskBoard RETURNING子句未验证 | FF13 | P1 | 原子认领需RETURNING子句支持，需验证SQLite实现 |
| OC-FF-10 | Memory ContextCompressor未用tiktoken | FF13 | P1 | 设计要求tiktoken+滑动窗口+92%阈值，需验证实现 |
| OC-FF-11 | 十层安全防御多数未实现 | FF14 | P0 | L2重复检测/L4安全工具注册表/L6架构约束/L7反馈闸门/L8熵管理/L9 MCP熔断/L10审计追踪多数未实现或未集成 |
| OC-FF-12 | Agent Handoff审计追踪未实现 | FF19 | P1 | 委托链中的审计追踪未实现 |
| OC-FF-13 | DeclarativeAgent纯配置定义能力不足 | FF18 | P0 | 仅支持prompt+output_schema，缺少state_updates/permissions/tools等配置能力 |
| OC-FF-14 | Marketplace搜索/安装/卸载未实现 | FF18 | P1 | 插件市场核心交易功能未实现 |
| OC-FF-15 | 无Session持久化与恢复机制 | OpenCode对标 | P0 | 进程崩溃后无法恢复会话，无事件溯源 |
| OC-FF-16 | 无LLM路由层Protocol/Route/Provider分离 | OpenCode对标 | P0 | 新增Provider需修改核心代码，无法2行配置接入 |
| OC-FF-17 | 无Tool输出边界控制 | OpenCode对标 | P0 | 工具输出无截断，大输出直接注入上下文窗口 |
| OC-FF-18 | 无增量摘要Compaction | OpenCode对标 | P0 | 上下文窗口溢出时无自动压缩和Overflow恢复 |
| OC-FF-19 | 无System Context增量更新 | OpenCode对标 | P1 | 上下文每次全量重发，无增量对账能力 |
| OC-FF-20 | 无Permission ask三态交互 | OpenCode对标 | P1 | 权限系统无运行时交互式授权 |
| OC-FF-21 | 无Agent步数限制和隐藏Agent | OpenCode对标 | P1 | Agent无max_steps限制，无hidden标记 |
| OC-FF-22 | 无文件编辑Stale Content检测 | OpenCode对标 | P1 | 并发编辑时无乐观锁保护 |
| OC-FF-23 | 无Token估算和自动小模型选择 | OpenCode对标 | P1 | 无token估算用于compaction触发，无小模型自动选择用于title/summary |
| OC-FF-24 | 无指数退避重试和瞬态错误检测 | OpenCode对标 | P0 | LLM调用失败无自动重试和瞬态错误识别 |
| OC-FF-25 | 无SSE超时保护 | OpenCode对标 | P0 | 流式响应无超时保护，可能无限挂起 |
| OC-FF-26 | 无Durable事件流 | OpenCode对标 | P1 | 事件分ephemeral/durable，durable写DB+publish |
| OC-FF-27 | 无流式工具并行执行 | OpenCode对标 | P1 | 收到tool-call后未立即并行启动工具执行 |
| OC-FF-28 | 无配置层级搜索 | OpenCode对标 | P1 | 无从工作目录向上搜索配置文件的机制 |
| OC-FF-29 | 无Credential安全存储 | OpenCode对标 | P1 | API Key和OAuth Token无安全存储机制 |
| OC-FF-30 | 无Session中断序列号追踪 | OpenCode对标 | P1 | 中断时无序列号过滤，可能处理过期事件 |

### 9.2 DevForge 对标差距

| # | 问题 | 来源Prompt | 严重等级 | 描述 |
|---|------|-----------|---------|------|
| OC-DF-01 | 四种任务类型workflow模板缺失 | DF2 | P0 | greenfield/feature/change/hotfix四种流程模板未在YAML中定义 |
| OC-DF-02 | 金丝雀发布完全未实现 | DF5 | P0 | 10%→50%→100%金丝雀+自动回滚完全缺失 |
| OC-DF-03 | 代码执行沙箱完全未实现 | DF6 | P0 | 进程隔离/资源限制/危险函数禁用全部缺失 |
| OC-DF-04 | 门禁三种投票策略未实现 | DF3 | P1 | weighted/consensus/majority三种策略未实现 |
| OC-DF-05 | 门禁超时策略未实现 | DF3 | P1 | 3种计时起点未实现 |
| OC-DF-06 | 门禁人工确认和升级未实现 | DF3 | P1 | 人工确认和升级到人工的流程未实现 |
| OC-DF-07 | 14个业务Agent执行模式与设计不符 | DF4 | P1 | 多数Agent只是单次LLM调用，未使用设计文档指定的模式 |
| OC-DF-08 | DevForge API未通过plugins.py注册 | DF1 | P1 | API路由应通过plugins.py注册到FlowForge，当前独立运行 |
| OC-DF-09 | 无Git操作安全防护 | DF6 | P1 | 仓库白名单/命令注入防护/强制推送保护未实现 |
| OC-DF-10 | 无部署环境隔离 | DF6 | P1 | 开发/测试/生产环境隔离未实现 |

### 9.3 ContentForge 对标差距

| # | 问题 | 来源Prompt | 严重等级 | 描述 |
|---|------|-----------|---------|------|
| OC-CF-01 | 六大专家Agent完全缺失 | CF2 | P0 | 选题/研究/创作/SEO/事实核查/发布6个专家Agent未实现 |
| OC-CF-02 | 内容创作非多Agent协作 | CF1 | P0 | 创作流程是Pipeline内联实现，非多Agent Workflow协作 |
| OC-CF-03 | LangGraph SOP检查点未验证 | CF3 | P1 | LangGraph检查点机制和interrupt_before需验证 |
| OC-CF-04 | 选题搜索三级降级未完整实现 | CF4 | P1 | helixrag→web_crawler→web_chat三级降级链不完整 |
| OC-CF-05 | Playwright多平台发布完全缺失 | CF7 | P0 | 今日头条/微信公众号的Playwright自动化发布未实现 |
| OC-CF-06 | 模型治理健康检查未实现 | CF8 | P1 | 自动探测可用性/配额/延迟的健康检查未实现 |
| OC-CF-07 | 模型故障自动切换未实现 | CF8 | P1 | 主力模型故障时自动切换到备用模型未实现 |
| OC-CF-08 | Web控制台6大页面缺失 | CF9 | P0 | 审核中心/定时任务/专栏配置/模型配置/发布日志/设置页面全部缺失 |

### 9.4 NovelForge 对标差距

| # | 问题 | 来源Prompt | 严重等级 | 描述 |
|---|------|-----------|---------|------|
| OC-NF-01 | 一致性检测5个Tool完全缺失 | NF5 | P0 | search_character/search_timeline/check_foreshadowing/verify_power_system/compare_geography未实现 |
| OC-NF-02 | SOUL 8维度结构化定义未体现 | NF4 | P1 | 5核心+3反馈的8维度结构化定义在StyleProfile中不完整 |
| OC-NF-03 | 部分阶段执行模式与设计不符 | NF2 | P0 | 同BUG-NF-01，7个Agent声明了模式但实际只是单次LLM调用 |
| OC-NF-04 | 伏笔回收率追踪未实现 | NF5 | P1 | 设计要求foreshadowing_recovery_rate>=0.8，但无追踪机制 |
| OC-NF-05 | 全局一致性分析未实现 | NF5 | P1 | 跨章节/跨卷的全局一致性分析未实现 |
| OC-NF-06 | Reflexion 2轮不达标降级未实现 | NF7 | P1 | 设计要求2轮不达标自动降级（缩减字数20%），未实现 |

---

## 问题统计（最终版v4）

| 严重等级 | 前四轮 | P8A架构边界 | OpenCode对标 | 合计 |
|----------|:------:|:-----------:|:------------:|:----:|
| P0 致命 | 36 | 4 | 12 | **52** |
| P1 严重 | 79 | 0 | 28 | **107** |
| P2 一般 | 119 | 0 | 2 | **121** |
| **合计** | **234** | **4** | **42** | **280** |

**OpenCode对标差距统计**:
- FlowForge: 30项（P0: 8, P1: 21, P2: 1）
- DevForge: 10项（P0: 3, P1: 7）
- ContentForge: 8项（P0: 4, P1: 4）
- NovelForge: 6项（P0: 2, P1: 4）
- **合计: 54项**（P0: 17, P1: 36, P2: 1）

> **本文档与各项目 docs/ 下的设计文档互补。发现问题时请同步更新对应设计文档。**
