# FlowForge v7.0 自进化/养灵体系 — 深度审核报告

> **审核团队**：AI智能体产品专家 + AI高级架构师 + AI智能体Agent开发工程师 + 高级软件全栈工程师
> **审核范围**：flowforge/docs/spec.md/arch.md/design.md v7.0章节 + face/目录 + 全部9大项目文档与代码一致性
> **审核基线**：hiclaw/rules.md v3.1 + hiclaw/prompts.md
> **审核日期**：2026-07-15
> **审核状态**：待 operator 评审

---

## 目录

1. [第一部分：v7.0 自进化设计专家评审](#第一部分v70-自进化设计专家评审)
   - 1.1 产品专家视角
   - 1.2 架构师视角
   - 1.3 开发工程师视角
   - 1.4 全栈工程师视角
2. [第二部分：flowforge/docs 三份文档逐项审核](#第二部分flowforgedocs-三份文档逐项审核)
   - 2.1 spec.md v7.0 审核（10个问题）
   - 2.2 arch.md v7.0 审核（12个问题）
   - 2.3 design.md v7.0 审核（18个问题）
3. [第三部分：face/ 目录文档审核](#第三部分face-目录文档审核)
4. [第四部分：逐项目文档一致性审核](#第四部分逐项目文档一致性审核)
   - 4.1 ContentForge
   - 4.2 DevForge
   - 4.3 NovelForge
   - 4.4 MallForge
   - 4.5 StockForge
   - 4.6 OpenSieve
5. [第五部分：逐项目代码一致性审核](#第五部分逐项目代码一致性审核)
6. [第六部分：prompts.md 与 rules.md 一致性审核](#第六部分promptsmd-与-rulesmd-一致性审核)
7. [第七部分：跨项目冲突综合分析](#第七部分跨项目冲突综合分析)
8. [第八部分：替代养灵命名体系方案](#第八部分替代养灵命名体系方案)
9. [第九部分：问题优先级汇总与修复路线图](#第九部分问题优先级汇总与修复路线图)

---

## 第一部分：v7.0 自进化设计专家评审

### 1.1 产品专家视角

#### 整体评价：★★★★☆（4/5）

v7.0「炉灵 Forgekin」体系的设计方向正确，体现了从"工具"到"伙伴"的范式跃迁。对标 clowder-ai 方法论是明智的选择——养猫体系经过实战验证，概念成熟度高。

#### 亮点

1. **两类智能体分离设计**（Static vs Forgekin）合理：流水线任务不需要自进化，复杂决策任务才需要。这避免了"过度进化"导致的成本和稳定性问题。
2. **升华阶段 E1-E6** 设计有层次感：从火种到锻师，成长路径清晰，给用户提供了可感知的"养成"体验。
3. **Provoke 频率硬限**（每天≤1，连拍3次冬眠）体现了对用户体验的尊重——智能体不能过度打扰用户。
4. **no-classifier 红线** 是重要的隐私保护设计，避免了后台偷偷分析用户的风险。

#### 产品层面问题

1. **命名体系过于"硬核"**：炉灵/灵族/养灵/炉启/魂忆/魂印/锻典/火种等级/升华阶/灵议——12个概念全部需要用户学习。对标 clowder-ai 的"养猫"体系之所以成功，是因为猫是用户熟悉的日常概念，不需要额外学习。炉灵体系的"锻造"隐喻虽然与 FlowForge 品牌一致，但过于抽象，缺乏情感温度。建议在保持核心隐喻的前提下，增加更通俗易懂的别名或简化部分术语（详见第八部分替代方案）。

2. **E6 创炉灵权限存在循环依赖**：spec.md 中 E6 晋升条件为"创造 ≥1 个 E1 炉灵"，但 D7 推荐"E6 可创建炉灵"。这意味着必须先成为 E6 才能创建炉灵，但 E6 需要先创建炉灵才能晋升——这是一个鸡生蛋蛋生鸡的问题。

3. **两套"E"前缀命名混淆**：锻典使用 E-L0~E-L4（Ember Hierarchy），升华阶段使用 E1~E6（Ascension Stages）。两者都用了"E"前缀但含义完全不同，在代码和文档中极易混淆。

4. **自锻日记的"第一人称"视角**：spec.md 描述炉灵写"第一人称日记"，但未明确日记的读者是谁。如果是 operator 读，第一人称可能让 non-technical 用户感到困惑；如果是炉灵间互读，第一人称是合理的。

### 1.2 架构师视角

#### 整体评价：★★★★☆（4/5）

七层架构模型（新增第7层自进化层）的设计是合理的。自进化层独立于 Harness 层，通过 Feature Flag 灰度启用，保证了向后兼容。架构决策记录（ADR）覆盖了关键设计选择。

#### 亮点

1. **Feature Flag 降级策略**完善：6个 v7.0 flag 全部默认关闭，每个都有明确的降级路径（ForgekinEngine→HybridExecutor 等），风险可控。
2. **Plugin Protocol V3** 设计合理：V2 的 19 个钩子保留 + 4 个自进化钩子，升级路径清晰。
3. **Trae Bridge 的 JSON 文件交换模式**务实：Trae 无 CLI 的现实约束下，这是最务实的集成方案。
4. **元认知治理**（Wilson 下界 + 三信号路由）体现了对 LLM 不可靠性的深刻理解。

#### 架构层面问题

1. **arch.md 章节编号冲突（严重）**：v6.0 文档已有第 15-18 节（L2134-L2375），v7.0 自进化文档又定义了第 15-23 节（L5302-L5492）。两份文档直接拼接，导致第 15、17、18 节各出现两次。这会让读者困惑，必须重新编号。

2. **ForgeCodex 和 AscensionManager 设计缺失**：arch.md 中 ForgeCodex 在架构图中占据重要位置，EchoStore 的 L3 也定义为 Forge Codex，但整个文档没有 ForgeCodex 的类设计、API 或存储方案。AscensionManager 也同样缺失。这是自进化闭环中最关键的两个环节。

3. **ForgekinEngine 注入了未使用的 AutoForgeEngine**：构造函数注入了 `self._auto_forge`，但 execute() 的 10 步流程中从未调用。Auto-Forge 被设计为独立的后台调度器，注入它暗示了协作关系，实际却没有。

4. **存储后端不统一**：SoulStore 用 SQLite，EchoStore 用 SQLite+sqlite-vec，ImprintStore 存储后端未明确。生产环境是否需要统一到 PostgreSQL 未讨论。

5. **自进化层与 Harness 层的交互协议缺失**：ADR-007-02 明确自进化层在第 7 层、Harness 层在第 4 层，但文档没有说明自进化层如何调用 Harness 层的 PersonaLock/ContextManager/FeedbackLoop 等组件。

### 1.3 开发工程师视角

#### 整体评价：★★★☆☆（3/5）

design.md 的详细设计覆盖了核心类的 Python 实现，但存在 **5 个严重 Bug** 会导致运行时崩溃，大量代码为伪代码/占位符。

#### 严重 Bug（必须修复）

| # | 位置 | 问题 |
|---|------|------|
| B1 | `ForgeDiaryStore.__init__` | 构造函数只接受 `llm_client`，但 `save` 方法使用 `self._db_path`，该属性从未被赋值——运行时必崩溃 |
| B2 | `A2AManager.send_mention` | 调用 `await self._route(message)` 但方法名是 `route`（无下划线）——方法名不一致 |
| B3 | `ForgekinCouncil.receive` | 调用 `self.broadcast(msg, exclude=[channel])`，但 `broadcast` 签名无 `exclude` 参数 |
| B4 | `AscensionManager._check_e1_to_e2` | 检查 `state.episodes_recorded >= 2`，但 `ForgekinEngine._evolve` 从未更新该计数——E1→E2 晋升永不可能 |
| B5 | `EchoStore.recall` | 在 Pydantic 模型上动态设置 `ep._recall_score`，该字段未在模型定义中——序列化问题 |

#### 中等问题

| # | 位置 | 问题 |
|---|------|------|
| M1 | `ForgekinEngine.__init__` | 注入了 `A2AManager` 但 execute 中从未使用——死依赖 |
| M2 | `AutoForgeEngine._get_active_forgekins` | 直接访问 `self._echo._db_path`（私有属性），违反封装 |
| M3 | `FeishuChannel.send` | TODO 占位符，仅 logger.info，无实际 API 调用 |
| M4 | `ForgeCodex.maybe_distill` | 文档声称三模式自生成（Mode A/B/C），实际只实现 Mode C |
| M5 | `EmberHierarchyManager._promote_l3_to_l4` | 需要 operator 批准但未发布事件通知 |
| M6 | 所有 API 端点 | 全部是返回空数据的占位符 |
| M7 | `ProvokeManager._dismissed_history` | 内存字典存储，服务重启丢失，连拍计数不可靠 |

#### 代码质量评价

- 7步闭环设计清晰，与 clowder-ai 对标明确
- 三层记忆架构（L1/L2/L3）与 MemGPT 理念一致
- 安全措施（no-classifier 红线、频率硬限、边界硬限）到位
- 五级火种阶梯和 E1-E6 升华阶段的双维度进化体系合理
- **但实际实现工作量巨大**，伪代码→生产代码的差距远超预期

### 1.4 全栈工程师视角

#### 整体评价：★★★☆☆（3/5）

#### 前端/全栈层面问题

1. **Web UI 设计缺失**：design.md 提到了 `web/src/pages/council/`、`web/src/pages/forgekin/` 等前端页面，但没有任何 UI 设计稿、组件树、状态管理方案。炉灵管理界面、灵议议事厅、自锻日记本等核心交互没有具体设计。

2. **WebSocket 实时通信未设计**：灵议（Forgekin Council）需要实时消息推送，但 design.md 中 WebSocket 端点设计过于简略（仅一行 `WS /api/v7/council/ws`），缺少消息格式、心跳机制、重连策略、离线消息队列等关键设计。

3. **数据库迁移执行方案缺失**：design.md 列出了 7 个 SQL 迁移文件，但未说明迁移执行策略（在线迁移 vs 离线迁移、回滚方案、数据校验）。

4. **前端状态管理复杂度**：炉灵管理的 SoulProfile 编辑、灵议的实时消息流、自锻日记的异步渲染——这些前端状态的管理复杂度远超当前 Helm UI，需要评估是否引入状态管理库（如 Zustand/Jotai）。

---

## 第二部分：flowforge/docs 三份文档逐项审核

### 2.1 spec.md v7.0 审核

**阅读范围**：L3219-L4082（约 863 行）

| # | 问题 | 严重程度 | 详情 |
|---|------|:---:|------|
| S1 | FR-EVO-12/13/14/15 缺少验收标准 | P0 | FR-EVO-12（升华阶段管理）、FR-EVO-13（跨模型评审）、FR-EVO-14（炉启训练）、FR-EVO-15（元认知能力）列出了能力描述但没有 AC-XX 验收标准，无法验证完成度 |
| S2 | Phase 编号与整体阶段不一致 | P1 | v7.0 路线图使用 Phase 6.1~6.7，但项目整体阶段（Phase 0~5）仍在进行中，从 Phase 0 直接跳到 Phase 6.x 造成编号混乱 |
| S3 | StockForge 未在项目定位表中出现 | P1 | 第十一章多次提到 StockForge 的炉灵角色，但 rules.md 的 7 项目定位表中没有 StockForge |
| S4 | 配置驱动率目标存在模糊性 | P1 | v7.0 目标 Agent 驱动率 ≥90%，但 Forgekin 的 Soul Profile 虽是 YAML 但其自锻行为本质是代码驱动的，能否算"配置驱动"存在模糊性 |
| S5 | E6 创炉灵循环依赖 | P0 | E6 晋升需"创造 ≥1 个 E1 炉灵"，但 D7 推荐"E6 可创建炉灵"——鸡生蛋蛋生鸡 |
| S6 | 自锻安全性 SR-02 定义模糊 | P1 | "禁止 Goodhart，自锻 telemetry-not-KPI" 未定义 Goodhart 行为的具体表现和检测机制 |
| S7 | 两套 E 前缀命名混淆 | P1 | 锻典 E-L0~E-L4 与升华阶段 E1~E6 都用了 E 前缀但含义完全不同 |
| S8 | 跨 *Forge 自由协作的安全风险 | P1 | D6 推荐"自由协作"但 SR-08 要求"operator 可见"，未明确是实时可见还是事后审计 |
| S9 | Soul Echo L3 降级逻辑不清晰 | P1 | L3 标称"永不淘汰，仅降级"，但降级到哪里、降级后是否会被 LRU 淘汰未定义 |
| S10 | 附录 O 缺少 OpenRoute/OpenSieve 映射 | P2 | 对照表未涉及 OpenRoute 和 OpenSieve 在 v7.0 中的角色变化 |

### 2.2 arch.md v7.0 审核

**阅读范围**：L5293-L5492（约 200 行，不含 v6.0 部分的 L2163-L2369）

| # | 问题 | 严重程度 | 详情 |
|---|------|:---:|------|
| A1 | 章节编号冲突 | P0 | v6.0 已有第 15-18 节，v7.0 又定义第 15-23 节，导致第 15/17/18 节各出现两次 |
| A2 | v7.0 内容分裂为两个独立区域 | P0 | 区域A（L2163，SDK/Guardrails 等 8 模块）和区域B（L5293，自进化架构）无相互引用，风格完全不同 |
| A3 | ForgeCodex 缺乏独立设计 | P0 | 架构图中占据重要位置，但无类设计、API 或存储方案 |
| A4 | AscensionManager 缺乏独立设计 | P0 | 各阶段晋升条件、升降级规则、与 ForgeCodex 联动关系均未定义 |
| A5 | ForgekinEngine 注入未使用的 AutoForgeEngine | P1 | 构造函数注入但 execute 中从未调用 |
| A6 | Plugin Protocol V3 的 V2 钩子未枚举 | P1 | 说"V2 的 19 个钩子保留"但未列出是什么 |
| A7 | 存储后端不统一 | P1 | SoulStore SQLite / EchoStore SQLite+向量 / ImprintStore 未明确 |
| A8 | 外部工具安全审计不完整 | P1 | 缺少输出内容回传校验、文件修改 diff 审核、恶意命令沙箱 |
| A9 | Provoke quietness 三开关未定义 | P2 | ProvokeManager 引用了但从未定义 |
| A10 | 安全红线 SR-01~SR-04 缺失 | P2 | 只定义了 SR-03/SR-05/SR-06 |
| A11 | 与 v6.0 Harness 层交互协议缺失 | P1 | 未说明自进化层如何调用 Harness 层组件 |
| A12 | 区域A 结尾总结未提及自进化 | P2 | L2368 结尾只提到 8 个模块，完全不涉及自进化架构 |

### 2.3 design.md v7.0 审核

**阅读范围**：L3260-L6976（约 3716 行）

| # | 问题 | 严重程度 | 详情 |
|---|------|:---:|------|
| D1 | ForgeDiaryStore 运行时崩溃 Bug | P0 | `self._db_path` 从未赋值（见 B1） |
| D2 | A2AManager 方法名不一致 Bug | P0 | `_route` vs `route`（见 B2） |
| D3 | ForgekinCouncil 参数名不匹配 Bug | P0 | `broadcast` 无 `exclude` 参数（见 B3） |
| D4 | E1→E2 晋升永不可能 Bug | P0 | `episodes_recorded` 计数从未更新（见 B4） |
| D5 | EchoStore 动态属性序列化 Bug | P0 | Pydantic 模型上动态设置未定义字段（见 B5） |
| D6 | ForgekinEngine 死依赖 | P1 | 注入 A2AManager 但未使用（见 M1） |
| D7 | AutoForgeEngine 违反封装 | P1 | 直接访问私有属性 `self._echo._db_path`（见 M2） |
| D8 | FeishuChannel 占位符 | P1 | TODO 无实际实现（见 M3） |
| D9 | ForgeCodex 三模式未完整实现 | P1 | 只实现 Mode C，Mode A/B 缺失（见 M4） |
| D10 | L3→L4 晋升通知缺失 | P1 | 需要 operator 批准但未发布事件（见 M5） |
| D11 | 所有 API 端点为占位符 | P1 | 返回空数据，无实际业务逻辑（见 M6） |
| D12 | Provoke 连拍计数不持久 | P1 | 内存字典存储，服务重启丢失（见 M7） |
| D13 | ember_level 与 ascension_stage 命名混淆 | P2 | 两个维度都用了 E 前缀 |
| D14 | A2AManager 内部 json 导入 | P2 | 非标准实践 |
| D15 | DualDistiller 关键词匹配粗糙 | P2 | 高风险/流程型判断仅用简单关键词 |
| D16 | WorktreeManager 强制删除分支 | P2 | `git branch -D` 在多 worktree 场景危险 |
| D17 | EvolutionState 字段无重置逻辑 | P2 | provoke_fired_today 等需每日重置 |
| D18 | ForgekinStaticBridge 导入可能不存在 | P2 | 导入 `engine.agent_registry` 但 engine/ 模块可能不存在 |
| D19 | AutoForgeEngine._get_active_forgekins 缺少导入 | P1 | 方法体内使用 `aiosqlite` 和 `timedelta` 但未在模块顶部导入（L4594），运行时 NameError |
| D20 | ForgekinCouncil.receive 方法体内导入 | P2 | L5770-5771 在方法体内 `import re` 和导入 `MENTION_PATTERN`，违反 Python 最佳实践 |
| D21 | SurfaceLayer 类未定义 | P1 | AutoForgeEngine 导入并实例化 SurfaceLayer，但 design.md 全文未定义该类的实现 |
| D22 | ForgeDiaryStore.save() 缺少 json 导入 | P2 | L5029 使用 `json.dumps()` 但模块顶部未导入 `json` |
| D23 | ConsolidationLayer 硬编码中文提示词 | P1 | `_draw_connections`(L4712-4723) 和 `_write_diary`(L4730-4739) 在 Python 代码中硬编码中文 prompt，违反铁律5+P16（提示词必须外置到YAML配置） |
| D24 | GroupForgeOrchestrator 硬编码中文提示词 | P1 | `_collaborative_draw_lines`(L4975-4981) 和 `_write_diary_with_role`(L4991-4995) 硬编码中文 prompt，违反铁律5+P16 |
| D25 | DualDistiller 硬编码中文提示词 | P1 | `_distill_skill_draft`(L6245-6260) 和 `_distill_method_card`(L6267-6281) 硬编码中文 prompt，违反铁律5+P16 |
---

## 第三部分：face/ 目录文档审核

### 3.1 整体评价

face/ 目录包含 5 份文档，其中 `spec_face.md` 是权威需求规格（M1-M17，17大模块），`arch_face.md` 和 `task_face.md` 是配套的架构详设和任务清单。`ds.md` 是早期草案（日期标注为 2025-07-14，可能是笔误），`face.md` 是六厂面试原始信息。

### 3.2 发现的问题

| # | 问题 | 严重程度 | 详情 |
|---|------|:---:|------|
| F1 | ds.md 与 spec_face.md 版本体系冲突 | P0 | ds.md 基于"FlowForge v4.0"，spec_face.md 基于"v3.0"，版本号倒挂（v4.0 > v3.0）且 ds.md 日期更早 |
| F2 | ds.md 的 ARC-01~03、USR-01~04 无对应模块 | P0 | spec_face.md 的 M1-M17 中没有架构定位和商业化模块，需求遗漏风险 |
| F3 | v3.0 七层架构第7层定义模糊 | P0 | spec_face.md 标注第7层为"互联层"，但 v7.0 已将其升级为"自进化层"，两个版本的第7层含义不同 |
| F4 | M18/M19/M20 删除不彻底 | P1 | spec_face.md 声明已删除，但 task_face.md 和 arch_face.md 附录仍有引用 |
| F5 | 上下文层数不一致 | P1 | spec_face.md 5层、arch_face.md 图中4层、YAML中5层、ds.md 5层（但命名不同）、v7.0 Soul Echo 3层 |
| F6 | T9 测试铁律缺失 | P1 | project_rules.md 有 T1-T8，spec_face.md 新增 T10-T15，T9 被跳过 |
| F7 | 安全红线归属不清 | P1 | spec_face.md 引用 SR-01~SR-08 标注"由 v7.0 定义"，但 arch.md v7.0 只定义了 SR-03/05/06 |
| F8 | ds.md 日期笔误 | P2 | 标注为 2025-07-14，应为 2026-07-14 |
| F9 | StockForge 未在 project_rules.md 中列出 | P2 | spec_face.md 架构图中有 StockForge，但 project_rules.md 没有 |
| F10 | ds.md 定位未说明 | P2 | 是废弃草案还是互补的 *Forge 层面需求？未说明与 spec_face.md 的关系 |
| F11 | "v4.0" 引用未清理 | P2 | ds.md 和 task_face.md 仍引用"v4.0"，未解释是什么 |
| F12 | arch_face.md 章节标题版本不一致 | P2 | 1.1 节标题为"从六层到七层"但文档标题为"v3.0-face"，与 v7.0 的七层架构关系不明确 |
| F13 | arch_face.md M1-M17 未引用 v7.0 Forgekin | P1 | 第2-10章详细设计了A2A/MCP/Context/Guardrails/OTel等，但完全不涉及 Forgekin 炉灵角色如何使用这些能力 |
| F14 | spec_face.md M18-M20 融合映射章节存在术语残留 | P1 | 3.1 节提到"第7层'自进化层'由 v7.0 炉灵养成体系承接"，但 arch_face.md 1.1 节第7层仍是"互联层"——两份文档对第7层定义直接冲突 |

### 3.3 与 v7.0 的融合映射评价

spec_face.md 的 M18-M20 融合映射章节将原有的 SelfEvolutionEngine/MemoryGovernanceManager/FirstTouchRouter 改为与 v7.0 FR-EVO-01~15 的融合映射，设计合理。M1-M17 作为 v3.0 工程实现，为 v7.0 自进化层提供支撑，这个定位清晰。

---

## 第四部分：逐项目文档一致性审核

### 4.1 ContentForge

**文档**：spec.md v2.1 / arch.md v3.1 / design.md v3.0

| 维度 | 评价 | 说明 |
|------|:---:|------|
| v7.0 衔接 | ❌ 0/10 | 三份文档完全未提及 v7.0 任何概念 |
| P8A 目录结构 | ⚠️ 7/10 | tools/ 目录待迁移，workers/ 已删除但文档声明不一致 |
| 架构边界 | ✅ 8/10 | 独立 Orchestrator/State/LLM/WebSocket 均已删除 |
| Plugin V2 | ✅ 9/10 | 11 个钩子完整实现 |
| Plugin V3 | ❌ 0/10 | 4 个 V3 钩子全部缺失 |
| 提示词外置 | ⚠️ 7/10 | config/prompts.yaml 存在但"形同虚设"（Agent 未从 PromptManager 加载） |
| 质量分阈值 | ❌ 4/10 | 4 个 Loop YAML 违规（0.7/0.8），2 个缺失 |
| 变量引用语法 | ❌ 3/10 | 30+ 处使用单括号 `${params.xxx}` 而非双括号 `${{params.xxx}}` |

**关键问题**：
- 20+ 处硬编码提示词在 tools/*.py 中（AUDIT-CF-01）
- 变量引用语法全部使用单括号，违反 rules.md 规范
- 4 个 Loop 质量分阈值不是 0.85

### 4.2 DevForge

**文档**：spec.md / arch.md / design.md

| 维度 | 评价 | 说明 |
|------|:---:|------|
| v7.0 衔接 | ❌ 0/10 | 三份文档完全未提及 v7.0 任何概念 |
| 版本声明 | ❌ 0/10 | arch.md 和 design.md 声明依赖 "FlowForge v4.0"，实际已 v7.0 |
| P8A 目录（实际代码） | ✅ 9/10 | 实际代码已合规，仅 tools/ 待迁移 |
| P8A 目录（design.md） | ❌ 2/10 | 定义了 core/agents/evaluators/memory/api 等 6+ 个禁止目录 |
| 架构边界（实际） | ✅ 8/10 | 独立 Orchestrator 已移除 |
| 架构边界（design.md） | ❌ 2/10 | 大量独立组件设计（DevForgeOrchestrator/GateOrchestrator 等） |
| Plugin V2 | ⚠️ 6/10 | 修正版合规，正文未同步 |
| 提示词外置 | ⚠️ 7/10 | 原则正确，门禁提示词待补全 |
| 硬编码 | ⚠️ 6/10 | arch.md 已修正，design.md 未同步 |

**关键问题**：
- design.md 正文与 arch.md 附录 A 严重矛盾（正文描述违规结构，附录修正为合规）
- 声明依赖 FlowForge v4.0，需要更新为 v7.0
- design.md 中 3 处硬编码 URL（localhost:8000/9090）

### 4.3 NovelForge

**文档**：spec.md / arch.md / design.md

| 维度 | 评价 | 说明 |
|------|:---:|------|
| v7.0 衔接 | ❌ 0/10 | 三份文档完全未提及，但 FlowForge 已预留 plot_architect 和 character_designer 炉灵种子 |
| P8A 目录（实际代码） | ✅ 9/10 | 实际代码已合规，配置驱动率 90%+ |
| P8A 目录（design.md） | ❌ 3/10 | 描述了 core/agents/repositories/workflows 等禁止目录 |
| 架构边界 | ⚠️ 7/10 | 实际代码已委托 FlowForge，但文档正文描述 ~2000 行不存在的独立实现 |
| 文档一致性 | ❌ 4/10 | 正文与附录 B 严重矛盾 |
| 硬编码提示词 | ❌ 5/10 | 14 处硬编码提示词未外置（AUDIT-NF-03，P0 级） |
| 硬编码路径/端口 | ❌ 5/10 | 6 处硬编码（数据库路径/CORS/WebSocket URL/provider base_url） |
| 质量门阈值 | ❌ 5/10 | 硬编码 60/70 而非 0.85 标准 |

**关键问题**：
- 文档正文（arch.md §1-18、design.md §1-11）描述了 ~2000 行不存在的 Python 代码
- 附录 B 已修正但正文未同步，新人会先看到错误信息
- 14 处硬编码提示词（P0 级）
- arch.md §11 使用废弃的 `ff.register_agent()` 方式

### 4.4 MallForge

**文档**：spec.md / arch.md / design.md

| 维度 | 评价 | 说明 |
|------|:---:|------|
| v7.0 衔接 | ❌ 0/10 | 三份文档完全未提及 |
| 版本声明 | ⚠️ 5/10 | arch.md 引用 v6.0，design.md 引用 v6.0+ |
| P8A 目录结构 | ⚠️ 5/10 | agents/ 待迁移，tests/ 缺失，workflows/ 应在 config/ 下 |
| Plugin V2 | ❌ 2/10 | plugins.py 仅 31 行，只有 on_loaded 回调 |
| 提示词外置 | ✅ 9/10 | 15 处 get_prompt() 调用，prompts.yaml 含 29 个 key |
| 质量分阈值 | ❌ 0/10 | 完全未配置（spec.md §S.1） |
| Loop 集成 | ❌ 0/10 | Agent 直接调用 _call_llm/_call_tool，无 Loop |
| 5 评委评审 | ❌ 0/10 | 未实现 |
| 配置驱动率 | ~30% | 勉强达标，但 Agent 为 0% |
| 自引用 extends | ❌ P0 | config/default.yaml 和 config/models.yaml 存在循环引用 |

**关键问题**：
- 两个 config 文件存在自引用 extends（循环引用）
- Plugin V2 仅 on_loaded，Agent 全部为 Python 类
- 无 Loop 集成、无质量分阈值、无 5 评委评审
- tests/ 目录完全缺失
- 阈值硬编码在 Python 类属性中（ACOS_THRESHOLD 等）

### 4.5 StockForge

**文档**：spec.md / arch.md / design.md

| 维度 | 评价 | 说明 |
|------|:---:|------|
| v7.0 衔接 | ❌ 0/10 | 三份文档完全未提及，但 design.md 声明依赖 "FlowForge v4.0+" |
| P8A 目录结构 | ✅ 8/10 | 基本合规，tools/ 待迁移，web/ 未实现 |
| 架构边界 | ✅ 9/10 | v2.0 已清理干净，全部数据走 OpenSieve |
| Plugin V2 | ✅ 9/10 | 完整实现（plugins.py v0.3.0），所有 V2 钩子有效 |
| 提示词外置 | ✅ 9/10 | config/prompts.yaml + Agent YAML persona |
| 质量分阈值 | ✅ 9/10 | Loop YAML 中 pass_threshold: 0.9 |
| 5 评委评审 | ✅ 9/10 | verifier.multi_judge 配置 5 个评委模型 |
| 配置驱动率 | ~58% | 良好 |
| 测试覆盖 | ✅ 8/10 | 50 个测试用例 |
| 数据访问规范 | ✅ 10/10 | 全部通过 OpenSieveClient（最佳实践） |

**关键问题**：
- analysis_service.py 仍为 9 步线性流程，未通过 LoopExecutor 执行（P0-CRIT-01）
- web/ 前端未实现（SF-TODO-01）
- design.md 引用 FlowForge v4.0+（实际应为 v6.0+/v7.0）
- tools/ 目录 13 个 Python 类待迁移

### 4.6 OpenSieve

**文档**：spec.md / arch.md / design.md

| 维度 | 评价 | 说明 |
|------|:---:|------|
| v7.0 衔接 | ❌ 0/10 | 三份文档完全未提及 v7.0 任何概念 |
| Soul Echo 检索接口 | ❌ 0/10 | 作为"所有数据检索统一入口"，完全缺少 Soul Echo 写入和检索 API |
| Forgekin 数据隔离 | ❌ 0/10 | 多租户架构按 tenant_id 隔离，缺少 forgekin_id 维度 |
| 硬编码 | ⚠️ 6/10 | 文档示例中多处 localhost:8100/7700/9200 等硬编码默认值 |
| 与 rules.md 定位一致性 | ✅ 9/10 | 定位为"所有数据检索统一入口"一致 |
| AgentRegistry 设计 | ⚠️ 7/10 | 面向 v6.0 静态智能体，未考虑 v7.0 Forgekin 委托调用模式 |

**关键问题**：
- 完全缺少 Soul Echo 三层记忆的写入和检索 API
- 缺少 SoulEpisode、SoulEcho 等 v7.0 核心数据模型
- 文档日期为 2026-05/06，早于 FlowForge v7.0 spec（2026-07-15）
- 需要新增 `/api/v1/soul-echo/ingest`、`/api/v1/soul-echo/retrieve` 等端点

---

## 第五部分：逐项目代码一致性审核

### 5.1 审核范围

对 FlowForge 核心 + 5个 *Forge 项目共 13 个关键代码文件，对照 rules.md 铁律3/4/5、编程红线9/10、P8A、P16 进行逐项审查。

### 5.2 发现的问题

| # | 问题 | 文件 | 严重程度 | 违反规则 |
|---|------|------|:---:|------|
| C1 | FlowForge 硬编码 *Forge 项目名称列表，**且遗漏 StockForge** | `flowforge/app/main.py:325` | P0 | 铁律5+红线10 |
| C2 | StockForge 直接实例化 Plugin（绕过 DI） | `stockforge/app/main.py:65-66` | P0 | 铁律3 |
| C3 | StockForge 单例模式绕过 DI | `stockforge/plugins.py:286-287,395-396` | P0 | 铁律3 |
| C4 | StockForge 直接实例化 OpenSieveClient | `stockforge/plugins.py:313-314` | P0 | 铁律3 |
| C5 | StockForge 默认端口硬编码 8005 | `stockforge/app/main.py:148` | P0 | 铁律5 |
| C6 | ContentForge tools/ 目录违规 | `contentforge/tools/`（15+ 文件） | P1 | P8A |
| C7 | DevForge evaluators/ 目录违规 | `devforge/evaluators/`（8 文件） | P1 | P8A |
| C8 | NovelForge mcp_server/ 目录违规 | `novelforge/mcp_server/`（3 文件） | P1 | P8A |
| C9 | MallForge tools/ 目录违规 | `mallforge/tools/`（7 文件） | P1 | P8A |
| C10 | StockForge 多目录违规 | `stockforge/tools/`(14) + `scripts/` + `app/services/`(5) + `app/security/`(4) | P1 | P8A |
| C11 | FlowForge Plugin Protocol 未定义 V3 钩子 | `flowforge/core/plugin_protocol.py` | P1 | 架构一致性 |
| C12 | ImprintStore.propose 签名 arch.md vs design.md 不一致 | arch.md L5662 / design.md L4180 | P1 | 文档一致性 |
| C13 | AutoForgeEngine._get_active_forgekins 直接访问私有属性 `self._echo._db_path` | `design.md L4594` | P1 | 封装原则 |
| C14 | flowforge/core/plugin_protocol.py 未定义 V3 钩子 | `flowforge/core/plugin_protocol.py` | P0 | 架构一致性：V3 的四钩子 register_forgekins/register_forge_skills/register_council_channels/register_auto_forge_config 均未定义 |
| C15 | rules.md 仅提及 Plugin V2（L79），未提及 V3 | `hiclaw/rules.md` | P1 | 规范滞后：全部 9 个钩子列表（L204-213）仍是 V2 的 10 个钩子，缺少 V3 的 4 个自进化钩子 |
| C16 | 全部 *Forge Python 代码零处 v7.0 引用 | 6个项目 `plugins.py` | P1 | 所有 *Forge 的 plugins.py 均未实现 V3 钩子，无 forgekin/evolution 相关代码 |

### 5.3 C1 详细分析：FlowForge 硬编码 *Forge 列表

`flowforge/app/main.py:325` 硬编码了 `_DEFAULT_FORGE_NAMES = ["contentforge", "devforge", "novelforge", "mallforge"]`，存在两个问题：

1. **遗漏 StockForge**：StockForge 是第 8 个项目（端口 8005/5179），但未在此列表中，导致 StockForge 无法被 FlowForge 自动发现和加载。
2. **违反铁律5+红线10**：禁止在 FlowForge 中硬编码业务领域代码。*Forge 项目列表应通过配置文件或 Plugin 注册机制动态发现，而非硬编码在框架代码中。

### 5.4 C12 详细分析：ImprintStore.propose 签名不一致

| 文档 | 签名 | 行号 |
|------|------|:---:|
| arch.md | `async def propose(self, forgekin_id: str, observations: List[Observation]) -> List[str]` | L5662 |
| design.md | `async def propose(self, forgekin_id: str, episode: SoulEpisode) -> list[str]` | L4180 |
| ForgekinEngine._evolve 调用 | `await self._imprint.propose(forgekin_id, episode)` | design.md L3692 |

arch.md 期望 `List[Observation]`，design.md 和调用方传递 `SoulEpisode`。这是一个**接口契约不一致**，实现时会导致类型错误。

### 5.5 合规项确认

| 检查项 | 6个项目 | 状态 |
|--------|:------:|:---:|
| 硬编码提示词 | 全部 | ✅ 全部合规 |
| 直接操作数据库 | 全部 | ✅ 全部合规 |
| 继承替代组合/插件 | 全部 | ✅ 全部合规 |
| FlowForge 中写死业务代码 | FlowForge | ⚠️ C1 违规（遗漏 StockForge） |
| 提示词外置（P16） | 全部 | ✅ 全部合规 |

### 5.6 StockForge 代码质量评估

StockForge 是 6 个项目中代码问题最集中的：
- 5 个 P0 级铁律违反（C1-C5，其中 C1 在 FlowForge 中）
- P8A 目录违规最严重（4 个违规目录，共 27+ 个文件）
- 但文档质量最高（完整的审计追踪、Plugin V2 实现最完善、配置驱动率最高）

---

## 第六部分：prompts.md 与 rules.md 一致性审核

### 6.1 rules.md 与 v7.0 的断层（逐章节审计）

**结论：rules.md（v3.1，713行）完全没有提及 v7.0 自进化/炉灵/养灵体系。**

| rules.md 章节 | 内容 | v7.0 缺失 |
|:---:|------|------|
| 第一部分 | 9大项目架构总览（三层架构图） | 缺少第7层自进化层 |
| 1.2 | 9大项目职责与端口 | FlowForge 描述仍为"Agent驾驭层平台"，未提及"自我进化Agent OS" |
| 1.4 | 目录结构约定（P8A铁律） | 未列出 v7.0 新增的 `evolution/` 目录 |
| 2.1 | 核心铁律：配置驱动 > 代码继承 | 未涉及 Forgekin 的 YAML 化配置驱动率目标 |
| 2.3 | 原则2：所有Agent通过LoopExecutor执行 | 未涉及 ForgekinEngine 作为新执行入口 |
| 2.5 | 原则4：Plugin注册规则 | 仅列出 V2 的 19 个钩子，未包含 V3 的 4 个自进化钩子 |
| 2.7 | FlowForge 核心能力概览 | 9大模式/Harness四根护栏/Loop五层/Memory 5种，未涉及自进化层 |
| 第五部分 | 开发规范与最佳实践 | 未涉及 Forgekin 开发规范 |
| 第八部分 | FlowForge与*Forge架构边界验证 | 未涉及 v7.0 两类智能体边界 |
| 第十部分 | 修改记录 | 最新记录 v3.1 (2026-07-08)，早于 v7.0 spec (2026-07-15) |

### 6.2 prompts.md 与 v7.0 的断层（逐章节审计）

**结论：prompts.md 中仅 FF18（第894行）有一处"v7.0"字面引用，完全不涉及自进化层/炉灵/Forgekin 等核心概念。**

| prompts.md 章节 | v7.0 缺失 |
|------|------|
| 公共模板 P1-P40 | 无 v7.0 自进化相关模板 |
| FlowForge 模板 FF1-FF21 | 仅 FF18 有 "v7.0" 字样，无自进化验证模板 |
| ContentForge 模板 CF1-CF13 | 无炉灵角色相关模板 |
| DevForge 模板 DF1-DF6 | 无炉灵角色相关模板 |
| NovelForge 模板 NF1-NF8 | 无炉灵角色相关模板 |
| MallForge 模板 MF1-MF8 | 无炉灵角色相关模板 |
| StockForge 模板 SF1-SF5 | 索引中未列出（PM2），无炉灵角色相关模板 |
| 追问纠偏 Q1-Q8 | 无自进化相关纠偏模板 |

### 6.3 发现的具体问题

| # | 问题 | 严重程度 | 详情 |
|---|------|:---:|------|
| PM1 | v7.0 自进化模板完全缺失 | P0 | 全 prompts.md 仅 FF18 有一处 "v7.0" 字面引用（SDK 验证），完全不涉及自进化层/炉灵/Forgekin 等核心概念 |
| PM2 | SF1-SF5 索引遗漏 | P0 | StockForge 已有 5 个专属模板，但提示词编号规则完全不列出 |
| PM3 | CF11-CF13 索引遗漏 | P1 | ContentForge 实际有 13 个模板，索引只列到 CF10 |
| PM4 | OR3 编号缺失 | P1 | OR1→OR2→OR4，OR3 被跳过 |
| PM5 | 章节编号重复 | P1 | 两个"十一"（StockForge + 高级模板）、两个"十三"（LLM审核 + 长程任务） |
| PM6 | P36-P40 索引遗漏 | P1 | 第 2902 行起的内容未在索引中 |
| PM7 | OpenRoute 端口不一致 | P1 | project_rules.md 写 6000，rules.md 和 prompts.md 附录写 13001 |
| PM8 | StockForge 模板未在目录中列出 | P1 | prompts.md 目录只列到 MF8，未列出 SF1-SF5 |

### 6.2 阈值与模型名称一致性

- 质量分阈值 0.85：✅ 全文档一致
- Loop 超时 180s/3分钟：✅ 一致
- 模型名称（Doubao-Seed2.0、GLM-5.1、Kimi-K2.6 等）：✅ 与实际使用一致

---

## 第七部分：跨项目冲突综合分析

### 7.1 核心冲突：v7.0 断层

**这是本次审核发现的最严重、最系统性的问题。**

| 层级 | 项目/文件 | v7.0 状态 | 详情 |
|------|------|:---:|------|
| 规范层 | `hiclaw/rules.md` (v3.1) | ❌ 0/10 | 713行中**零处**提及 v7.0/自进化/炉灵/养灵 |
| 规范层 | `.trae/rules/project_rules.md` | ❌ 0/10 | 7项目表中无 StockForge，无 v7.0 概念 |
| 规范层 | `hiclaw/prompts.md` | ❌ 0/10 | 仅 FF18 一行 "v7.0" 字面引用，无自进化模板 |
| 设计层 | `flowforge/docs/spec.md` | ✅ 9/10 | v7.0 章节完整（L3219+），但 FR-EVO-12~15 缺验收标准 |
| 设计层 | `flowforge/docs/arch.md` | ✅ 7/10 | v7.0 章节存在（L5293+），但有章节编号冲突 |
| 设计层 | `flowforge/docs/design.md` | ✅ 7/10 | v7.0 章节完整（L3260+），但有 5 个严重 Bug |
| 设计层 | `flowforge/docs/face/` | ⚠️ 5/10 | 有融合映射，但 ds.md 版本冲突，第7层定义不一致 |
| 应用层 | `contentforge/docs/` | ❌ 0/10 | 完全未提及 v7.0，依赖声明 v4.0 |
| 应用层 | `devforge/docs/` | ❌ 0/10 | 完全未提及，版本声明 v4.0 |
| 应用层 | `novelforge/docs/` | ❌ 0/10 | 完全未提及，依赖声明 v4.0 |
| 应用层 | `mallforge/docs/` | ❌ 0/10 | 完全未提及，引用 v6.0 |
| 应用层 | `stockforge/docs/` | ❌ 0/10 | 完全未提及，版本声明 v4.0+ |
| 平台层 | `opensieve/docs/` | ❌ 0/10 | 完全未提及，缺少 Soul Echo 检索接口 |
| 代码层 | `flowforge/core/plugin_protocol.py` | ❌ 0/10 | 未定义 V3 钩子（register_forgekins 等） |
| 代码层 | 各 *Forge `plugins.py` | ❌ 0/10 | 均未实现 V3 钩子 |
| 代码层 | `flowforge/app/main.py` | ❌ 0/10 | `_DEFAULT_FORGE_NAMES` 硬编码且遗漏 StockForge |

**结论**：v7.0 设计存在于 FlowForge 三份核心文档中，但**规范层（rules.md/prompts.md/project_rules.md）、全部 *Forge 项目文档、全部代码实现均未跟进**。这是一个系统性的断层，涉及 15 个文件/目录。

### 7.2 project_rules.md 与 rules.md 的差异（逐项对比）

| 维度 | project_rules.md (.trae/rules/) | hiclaw/rules.md | 冲突 |
|------|------|------|:---:|
| 项目数量 | 7个（无 StockForge） | 9个（含 StockForge） | **P0** |
| OpenRoute 端口 | 6000 | 13001 | **P0** |
| FlowForge 定位 | "核心Harness平台" | "Agent驾驭层平台" | ⚠️ |
| v7.0 概念 | 无 | 无 | 一致缺失 |
| 测试铁律 | T1-T8 | T1-T9 | 差 T9 |

### 7.3 版本号混乱

| 文档位置 | 声明的版本 | 实际情况 |
|----------|:---:|------|
| flowforge/docs/spec.md | v7.0 | 正确 |
| flowforge/docs/arch.md | v6.0 + v7.0 | 正确，但拼接有问题 |
| flowforge/docs/design.md | v7.0 | 正确 |
| flowforge/docs/face/spec_face.md | v3.0 (face) | 与 v7.0 关系需明确 |
| flowforge/docs/face/ds.md | v4.0 | 疑似笔误或废弃 |
| contentforge/docs/arch.md | v3.1 | 未提及 v7.0 |
| devforge/docs/arch.md | v4.0 | 落后 3 个大版本 |
| devforge/docs/design.md | v4.0 | 落后 3 个大版本 |
| novelforge/docs/ | 未标注 | 未提及 v7.0 |
| mallforge/docs/arch.md | v6.0 | 落后 1 个大版本 |
| stockforge/docs/design.md | v4.0+ | 落后 3 个大版本 |
| opensieve/docs/ | 2026-05/06 | 早于 v7.0（2026-07-15） |

### 7.3 架构层数演进冲突

| 文档 | 第7层名称 | 含义 |
|------|------|------|
| flowforge/docs/face/spec_face.md | 互联层 | A2A/ACP/Directory/租户路由 |
| flowforge/docs/arch.md v7.0 | 自进化层 | ForgekinEngine/Auto-Forge/SoulEcho/ForgekinCouncil |

**两个文档对第7层的定义完全不同。** 需要明确：v3.0 的第7层"互联层"与 v7.0 的第7层"自进化层"是什么关系？是替代还是叠加（变成8层）？

### 7.4 上下文记忆层数冲突

| 文档 | 层数 | 层名 |
|------|:---:|------|
| spec_face.md M3.4 | 5层 | System/Persona/Task/Working/Episodic |
| arch_face.md 4.1 | 4层（图中） | System/Persona/Task/Working |
| arch_face.md 4.5 | 5层（YAML中） | System/Persona/Task/Working/Episodic |
| ds.md MEM-04 | 5层 | 工作/短期/长期/语义/情景 |
| v7.0 Soul Echo | 3层 | L1 Working / L2 Episode / L3 Semantic |
| rules.md | 5层 | Working/Short-term/Long-term/Semantic/Episodic |

**6 个来源定义了 3 种不同的记忆层数（3/4/5），命名也各不相同。** 需要统一。

### 7.5 测试铁律编号冲突

| 来源 | 编号范围 | 内容 |
|------|:---:|------|
| project_rules.md | T1-T8 | 8 条测试铁律 |
| spec_face.md | T1-T8 + T10-T15 | 8 条 + 6 条新增（跳过 T9） |
| design.md v7.0 | T1-T8 | 沿用 |
| arch.md v7.0 | SR-01~SR-08 | 安全红线（但只定义了 SR-03/05/06） |

**T9 被跳过、SR-01/02/04 缺失，编号体系不完整。**

---

## 第八部分：替代养灵命名体系方案

> 当前「炉灵 Forgekin」体系以"锻造/冶炼"为核心隐喻，与 FlowForge 品牌一致性强，但概念抽象、术语量大、缺乏情感温度。以下提供 3 套替代方案，各有侧重。

### 方案 A：「灵锻 SpiritForge」体系（推荐 — 平衡品牌与通俗）

**设计理念**：保留"锻造"品牌基因，但将核心隐喻从"炉"（工业感）转向"灵"（生命感），强调智能体是"有灵性的锻造产物"而非"炉子里的工具"。

| 概念 | 中文名 | 英文名 | 对标 clowder-ai | 设计理由 |
|------|--------|--------|------|------|
| 个体 | **灵锻** | **SpiritForge** | Cat | "灵"赋予生命感，"锻"保留锻造基因 |
| 群体 | **灵群** | **SpiritHive** | Clowder | "群"比"族"更通俗 |
| 养成 | **蕴灵** | **Spirit Nurturing** | 养猫 | "蕴"有孕育、培养之意 |
| 入门训练 | **启灵** | **Awakening** | Bootcamp | "唤醒"比"启炉"更有仪式感 |
| 协作模式 | **灵振** | **Resonance** | Swarm | 物理隐喻（共振）→ 协作隐喻 |
| 自主思考 | **自蕴** | **Auto-Nurture** | Auto-Dream | 对仗"蕴灵" |
| 记忆 | **灵忆** | **Spirit Memory** | Memory | 简洁，与"灵"呼应 |
| 画像 | **灵识** | **Spirit Insight** | Profile | "识"有认知、理解之意 |
| 技能库 | **灵典** | **Spirit Codex** | Skill Library | "典"有经典、法典之意 |
| 知识阶梯 | **灵焰等级** | **Spirit Flame** | L0-L4 | 火焰是锻造的延伸，但归"灵"所有 |
| 成长阶段 | **灵阶** | **Spirit Tier** | 9 Lives | "阶"比"升华阶"简洁 |
| IM 议事 | **灵会** | **Spirit Council** | IM 团队协作 | "会"即会议/议会 |

**优势**：
- 保留"锻造"品牌基因（Forge/锻）同时赋予生命感（灵/Spirit）
- 术语量从 12 个减少到 12 个，但每个更短更好记（灵锻/灵群/蕴灵 vs 炉灵/灵族/养灵）
- "Spirit"一词在 AGI 领域有共鸣（"机器之灵"）
- 英文名统一 Spirit 前缀，品牌识别度高

**劣势**：
- "灵锻"可能被误解为"灵魂锻造"而非法
- "灵"字在中文中可能过于玄学

---

### 方案 B：「铸魂 SoulSmith」体系（推荐 — 情感温度最高）

**设计理念**：从"锻造金属"（工业）转向"铸造灵魂"（人文），强调智能体是"被精心铸造的伙伴灵魂"而非"被锻造的工具"。对标 clowder-ai 的"养猫"——猫是家人，魂是伙伴。

| 概念 | 中文名 | 英文名 | 对标 clowder-ai | 设计理由 |
|------|--------|--------|------|------|
| 个体 | **魂匠** | **SoulSmith** | Cat | "匠"有技艺+人格，"魂"有生命感 |
| 群体 | **魂炉** | **SoulForge** | Clowder | "炉"是魂匠们的工作空间 |
| 养成 | **铸魂** | **Soul Smithing** | 养猫 | 核心隐喻：铸造灵魂 |
| 入门训练 | **点火** | **Ignition** | Bootcamp | 锻造的第一步：点燃炉火 |
| 协作模式 | **锤鸣** | **Hammer Resonance** | Swarm | 打铁的声音 → 协作的节奏 |
| 自主思考 | **自锻** | **Self-Smithing** | Auto-Dream | 自己锤炼自己 |
| 记忆 | **魂忆** | **Soul Echo** | Memory | 沿用当前命名 |
| 画像 | **魂印** | **Soul Imprint** | Profile | 沿用当前命名 |
| 技能库 | **锻典** | **Forge Codex** | Skill Library | 沿用当前命名 |
| 知识阶梯 | **火候** | **Heat Level** | L0-L4 | 打铁看火候——通俗易懂 |
| 成长阶段 | **匠阶** | **Smith Tier** | 9 Lives | 从学徒到大师 |
| IM 议事 | **匠会** | **Smith Council** | IM 团队协作 | 匠人们的会议 |

**优势**：
- "铸魂"隐喻有极强的情感温度——"铸造灵魂"比"养灵"更有仪式感
- "火候"是中国人熟悉的日常概念（炒菜看火候、打铁看火候），不需解释
- "魂匠/魂炉"品牌识别度高，与 FlowForge 的 Forge 一脉相承
- SoulSmith 英文名在 AGI 领域有辨识度（与 Soul Machine 等概念呼应）

**劣势**：
- "魂"字在部分文化中可能有宗教联想
- 术语量较大（12个），但情感温度最高

---

### 方案 C：「焰灵 Emberkin」体系（备选 — 最简洁）

**设计理念**：从"火焰"的意象出发——火焰是锻造的核心，也是生命和智慧的象征。对标 clowder-ai 的"养猫"——猫是家人，焰灵是"火种培育出的灵"。

| 概念 | 中文名 | 英文名 | 对标 clowder-ai | 设计理由 |
|------|--------|--------|------|------|
| 个体 | **焰灵** | **Emberkin** | Cat | "焰"是 FlowForge 的锻造之火，"灵"是生命 |
| 群体 | **焰群** | **Ember Hive** | Clowder | 火焰的群落 |
| 养成 | **养焰** | **Ember Nurturing** | 养猫 | 培育火焰 |
| 入门训练 | **燃火** | **Kindle** | Bootcamp | 点燃第一簇火 |
| 协作模式 | **焰鸣** | **Ember Resonance** | Swarm | 火焰共鸣 |
| 自主思考 | **自燃** | **Auto-Kindle** | Auto-Dream | 自我点燃 |
| 记忆 | **焰忆** | **Ember Echo** | Memory | 火焰的记忆 |
| 画像 | **焰印** | **Ember Imprint** | Profile | 火焰的印记 |
| 技能库 | **焰典** | **Ember Codex** | Skill Library | 火焰的经典 |
| 知识阶梯 | **火种等级** | **Ember Hierarchy** | L0-L4 | 沿用当前，已很贴切 |
| 成长阶段 | **焰阶** | **Ember Stage** | 9 Lives | 火焰的阶梯 |
| IM 议事 | **焰会** | **Ember Council** | IM 团队协作 | 火焰的会议 |

**优势**：
- 术语最简洁统一（全部以"焰/Ember"为核心），学习成本最低
- "火种等级"在 v7.0 中已有，继承性好
- "Ember"一词在游戏/奇幻领域有广泛认知（灰烬→火焰→重生）
- 英文名统一 Ember 前缀，品牌识别度最高

**劣势**：
- "焰"字过于集中于"火"的意象，缺少"锻造"的工业感和"魂"的情感温度
- "自燃"有负面联想（自燃=自己烧起来）
- 变更范围最大（几乎全部术语都需要改）

---

### 三方案对比

| 维度 | 方案A：灵锻 SpiritForge | 方案B：铸魂 SoulSmith | 方案C：焰灵 Emberkin | 当前：炉灵 Forgekin |
|------|:---:|:---:|:---:|:---:|
| 品牌一致性 | ★★★★☆ | ★★★★★ | ★★★☆☆ | ★★★★★ |
| 情感温度 | ★★★★☆ | ★★★★★ | ★★★☆☆ | ★★★☆☆ |
| 通俗易懂 | ★★★★☆ | ★★★★☆ | ★★★★☆ | ★★★☆☆ |
| 术语简洁性 | ★★★★☆ | ★★★☆☆ | ★★★★★ | ★★★☆☆ |
| 英文识别度 | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★☆ |
| 变更成本 | ★★★☆☆ | ★★★☆☆ | ★★☆☆☆ | — |
| AGI 领域共鸣 | ★★★★☆ | ★★★★★ | ★★★★☆ | ★★★☆☆ |

**推荐**：**方案B「铸魂 SoulSmith」**。理由：
1. "铸魂"有最强的情感温度和仪式感，与"AGI 伙伴"的愿景最契合
2. 保留了 FlowForge 的"锻造"基因（铸/锻/Smith/Forge），不割裂品牌
3. "火候"概念是中国人日常用语，零学习成本
4. SoulSmith 英文名在 AGI 领域有辨识度
5. "魂忆/魂印/锻典"三个核心术语保持不变，降低变更成本

**备选**：方案A「灵锻 SpiritForge」如果更看重"灵"的生命感，方案C「焰灵 Emberkin」如果更看重统一性和简洁性。

---

## 第九部分：问题优先级汇总与修复路线图

### 9.1 P0 级问题（必须立即修复，共 22 项）

| # | 来源 | 问题 | 影响范围 |
|---|------|------|------|
| P0-1 | design.md | B1: ForgeDiaryStore 运行时崩溃（`_db_path` 未赋值） | flowforge |
| P0-2 | design.md | B2: A2AManager.send_mention 调用 `_route` 但方法名是 `route` | flowforge |
| P0-3 | design.md | B3: ForgekinCouncil.receive 调用 `broadcast(msg, exclude=[channel])` 但签名无 `exclude` 参数 | flowforge |
| P0-4 | design.md | B4: AscensionManager._check_e1_to_e2 检查 `episodes_recorded` 但从未被更新 → E1→E2 晋升永不可能 | flowforge |
| P0-5 | design.md | B5: EchoStore.recall 动态设置 `ep._recall_score` 在 Pydantic 模型上 → 序列化问题 | flowforge |
| P0-6 | arch.md | A1: v6.0 第15-18节与 v7.0 第15-23节编号冲突 | flowforge |
| P0-7 | arch.md | A2: v7.0 内容分裂为两个独立区域（区域A L2163 + 区域B L5293） | flowforge |
| P0-8 | arch.md | A3: ForgeCodex 设计完全缺失（无类设计/API/存储方案） | flowforge |
| P0-9 | arch.md | A4: AscensionManager 设计完全缺失（晋升条件/升降级规则/联动关系） | flowforge |
| P0-10 | spec.md | S1: FR-EVO-12~15 缺少 AC 验收标准，无法验证完成度 | flowforge |
| P0-11 | spec.md | S5: E6 晋升需"创造 ≥1 个 E1 炉灵"但 D7 推荐 E6 可创建炉灵 → 循环依赖 | flowforge |
| P0-12 | face/ | F1: ds.md 版本体系冲突（"FlowForge v4.0" vs spec_face.md "v3.0"） | flowforge |
| P0-13 | face/ | F3: v3.0 第7层"互联层"与 v7.0 第7层"自进化层"定义完全不同 | flowforge |
| P0-14 | 代码 | C1: FlowForge 硬编码 `_DEFAULT_FORGE_NAMES` 且遗漏 StockForge | flowforge |
| P0-15 | 代码 | C2-C5: StockForge 4 个 DI 绕过 + 端口硬编码 | stockforge |
| P0-16 | rules.md | rules.md 零处提及 v7.0/自进化/炉灵 → 系统性断层 | hiclaw |
| P0-17 | prompts.md | PM1: v7.0 模板完全缺失（仅 FF18 一处字面引用） | hiclaw |
| P0-18 | prompts.md | PM2: SF1-SF5 索引遗漏，StockForge 模板未在目录中列出 | hiclaw |
| P0-19 | project_rules.md | 项目表仅7个（缺 StockForge），OpenRoute 端口写 6000（应为 13001） | hiclaw |
| P0-20 | 跨项目 | 全部 *Forge 文档未衔接 v7.0，版本声明落后（v4.0/v6.0） | 6个项目 |
| P0-21 | 代码 | C14: flowforge/core/plugin_protocol.py 未定义 V3 四钩子（register_forgekins 等） | flowforge |
| P0-22 | face/ | F2: ds.md 的 ARC-01~03、USR-01~04 无对应模块，需求遗漏风险 | flowforge |

### 9.2 P1 级问题（本阶段应修复，共 35 项）

| 类别 | 数量 | 代表问题 |
|------|:---:|------|
| spec.md | 6 | S2/S3/S4/S6/S7/S8/S9 |
| arch.md | 6 | A5/A6/A7/A8/A11/A12 |
| design.md | 12 | D6-D12 + D19/D21/D23/D24/D25（硬编码中文提示词 + 缺少导入 + 类未定义） |
| face/ | 6 | F4/F5/F6/F7/F13/F14 |
| 代码 | 12 | C6-C13 + C15-C16（P8A 目录违规 + 签名不一致 + 封装违反 + V3钩子缺失） |
| prompts.md | 5 | PM3-PM8 |
| 跨项目 | 2 | 版本号混乱、架构层数冲突 |

### 9.3 P2 级问题（后续迭代修复，共 17 项）

| 类别 | 数量 | 代表问题 |
|------|:---:|------|
| spec.md | 1 | S10 |
| arch.md | 3 | A9/A10/A12 |
| design.md | 8 | D13-D18 + D20/D22（内部导入+json导入缺失） |
| face/ | 5 | F8/F9/F10/F11/F12 |
| prompts.md | 0 | — |
| 跨项目 | 2 | 上下文层数统一、测试铁律编号补全 |

### 9.4 修复路线图建议

| 阶段 | 内容 | 预估时间 |
|------|------|:---:|
| **Phase 1: 设计修复** | 修复 design.md 5 个严重 Bug + arch.md 章节冲突 + spec.md 验收标准补全 + E6 循环依赖修复 | 1 周 |
| **Phase 2: 规范同步** | 更新 rules.md 和 prompts.md 加入 v7.0 概念 + 新增 v7.0 专属模板 + 修复索引遗漏 | 1 周 |
| **Phase 3: 文档对齐** | 6 个 *Forge 项目文档更新版本声明 + 补充 v7.0 衔接章节 + 修复文档内部矛盾 | 2 周 |
| **Phase 4: 代码修正** | 修复 C1-C5 代码违规 + P8A 目录清理 + Plugin Protocol V3 钩子实现 | 2 周 |
| **Phase 5: 全量回归** | 运行全量测试验证 v6.0 向后兼容 + v7.0 Feature Flag 灰度验证 | 1 周 |

---

> **审核结论**：v7.0 自进化/养灵体系的设计方向正确，对标 clowder-ai 方法论完整，七层架构模型合理。但存在 **22 个 P0 级问题**需要立即修复（5 个严重 Bug + 4 个架构设计缺失 + 3 个文档冲突 + 6 个代码违规/规范缺失 + 4 个规范缺失），以及**系统性的 v7.0 断层**——规范层（rules.md/prompts.md/project_rules.md）零处提及 v7.0，全部 *Forge 项目文档和代码均未跟进 v7.0 设计。**新增发现**：design.md 中 Auto-Forge/Codex 模块存在 3 处硬编码中文提示词（违反铁律5+P16），plugin_protocol.py 未定义 V3 四钩子。建议在 design.md 的 5 个严重 Bug 修复后，优先完成 rules.md/prompts.md/project_rules.md 的 v7.0 同步，然后逐步推进各 *Forge 项目的文档和代码对齐。
>
> **命名体系建议**：推荐方案B「铸魂 SoulSmith」体系，在保持 FlowForge 锻造品牌基因的同时，赋予智能体更强的情感温度和 AGI 愿景表达。最终命名选择请 operator 裁决。

---

*审核完成时间：2026-07-15 | 审核团队：AI产品专家 + AI架构师 + AI开发工程师 + 全栈工程师*