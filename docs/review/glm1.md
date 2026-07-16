# FlowForge v7.0 自我进化体系与跨项目一致性深度审核报告

> **审核日期**：2026-07-15
> **审核范围**：flowforge/docs/{spec.md, arch.md, design.md} v7.0 自我进化/养灵体系 + flowforge/docs/face/ 全部文档 + 9 大项目与 hiclaw/rules.md/prompts.md 一致性
> **审核团队**：AI 产品专家 / AI 架构师 / Agent 开发工程师 / 全栈工程师
> **文档状态**：待 operator 审阅

---

## 目录

- [第一章：审核概述](#第一章审核概述)
- [第二章：v7.0 自我进化体系设计审核](#第二章v70-自我进化体系设计审核)
- [第三章：face/ 目录文档审核](#第三章face-目录文档审核)
- [第四章：设计问题与改进建议汇总](#第四章设计问题与改进建议汇总)
- [第五章：9 大项目与 rules.md/prompts.md 跨项目一致性审查](#第五章9-大项目与-rulesmdpromptsmd-跨项目一致性审查)
- [第六章：养灵体系命名建议](#第六章养灵体系命名建议)

---

## 第一章：审核概述

### 1.1 审核对象

| 文档 | 行数 | 核心内容 |
|------|------|---------|
| spec.md | 3666 | v2.1 主体(1-2898) + v7.0 自我进化规格(2900-3666) |
| arch.md | 6492 | v6.0 主体(1-5292) + v7.0 架构升级(5293-6492) |
| design.md | 6976 | v6.0 主体(1-3259) + v7.0 详细设计(3260-6976) |
| face/face.md | 524 | 大厂面试原始记录（调研素材） |
| face/spec_face.md | 1398 | v3.0 工程规格 + v7.0 融合映射 |
| face/arch_face.md | 1506 | v3.0 架构详设 + v7.0 融合对齐 |
| face/task_face.md | 1171 | v3.0 任务清单 + v7.0 融合说明 |

### 1.2 审核维度

| 维度 | 审核重点 |
|------|---------|
| 产品 | 用户价值、竞品差异化、商业化路径、GTM 策略 |
| 架构 | 层级合理性、依赖方向、降级策略、扩展性、Feature Flag |
| Agent 工程 | 两类智能体分离、Soul Profile 设计、记忆架构、自锻引擎、Skill 自生成 |
| 全栈 | 数据库设计、API 端点、安全性、可观测性、CI/CD 兼容 |
| 跨项目一致性 | rules.md/prompts.md 与 9 大项目文档和代码的对齐 |

### 1.3 总体评估

**v7.0 自我进化体系设计整体评价：B+（优秀但有可修复的缺陷）**

- **亮点**：核心隐喻从"驾驭"到"养成"的跃迁具有哲学深度；对标 clowder-ai 养猫体系的同时做了适配而非照搬；两类智能体分离设计务实；安全红线 SR-01~08 设计周到；Feature Flag 灰度策略保证向后兼容
- **主要问题**：v7.0 子文档与 hiclaw/rules.md/prompts.md 零交叉引用（规则未对齐）；跨项目存在大量数值不一致（质量分阈值/Agent 数量/Loop 超时）；face/ 目录与 v7.0 权威源存在术语和职责重叠

---

## 第二章：v7.0 自我进化体系设计审核

### 2.1 产品维度审核

#### 2.1.1 核心定位跃迁评估

**公式升级**：`v6.0: Agent = Model + Harness` → `v7.0: Agent = Model + Harness + Soul`

**评价**：
- **正面**：从"驾驭层"到"养成"的隐喻转变有说服力，将 Agent 从工具定位升级为可成长的"灵体"，符合 AGI 前沿研究（RSI、Native Evolution）的方向
- **风险**：`Soul` 概念可能引发用户对 AI 意识的误解。建议在面向用户时使用"成长档案"或"进化档案"替代"灵魂档案"，在技术文档中保留 `Soul Profile` 术语

#### 2.1.2 竞品差异化

| 竞品 | 核心能力 | FlowForge v7.0 差异化 |
|------|---------|---------------------|
| clowder-ai | 养猫体系、Auto-Dream、F100 自进化 | ✅ 完整对标 + Trae Bridge（FlowForge 独有） |
| Claude Code | CLI 编码能力 | ✅ 通过 CLI Wrapper 集成为炉灵能力 |
| Codex (OpenAI) | CLI 编码能力 | ✅ 同上 |
| LangGraph | Agent 编排框架 | ✅ 作为基础设施层组件被使用 |
| AutoGPT | 自主 Agent | ⚠️ v7.0 的 Auto-Forge 更保守更安全，但需证明实际效果 |

**差异化优势**：Trae Bridge 模式是 FlowForge 独有设计（因 Trae 无 CLI），通过 JSON 文件交换解决了无 CLI 工具的接入问题，这是其他竞品不具备的。

#### 2.1.3 商业化路径

**当前缺失**：spec.md 和 face/ 均未提供 v7.0 的商业化路径分析。建议补充：
- 炉灵订阅模式（E1-E6 不同等级的定价策略）
- 跨 *Forge 协作的市场化（Skill 市场交易）
- 企业版 vs 个人版的功能切分

### 2.2 架构维度审核

#### 2.2.1 七层架构模型评估

**v7.0 新增第 7 层「自进化层（Evolution Layer）」**，在 v6.0 六层架构之上叠加：

```
7. 自进化层 (Evolution Layer) ★ v7.0 新增
6. 应用层 (*Forge 项目群)
5. 接入层 (Gateway)
4. Harness 驾驭层
3. 执行引擎层
2. 能力层
1. 基础设施层
```

**评价**：
- **正面**：自进化层置于最顶层，依赖方向自上而下，符合单向依赖原则；通过组合/继承让 *Forge 获得能力，不侵入 v6.0 层
- **问题 A-001 [P1]**：**arch.md 主体 §17（行 2163-2368）与 v7.0 子文档（行 5293-6492）章节号重号**。主体 §17 是 SDK/Guardrails/Handoff 等 8 个模块，v7.0 子文档 §15-§23 是 Forgekin/Auto-Forge/Soul 体系，二者使用重复的章节号但内容完全不同，造成阅读混乱
  - **建议**：将 v7.0 子文档章节号改为 §24-§32 或使用独立编号体系（如 §V7.1-V7.9）
- **问题 A-002 [P1]**：**arch.md 未给出 evolution/ 模块的代码目录结构**。仅在配置块中以 `data_dir` 定义运行时数据路径，但 `flowforge/evolution/` 的代码组织（哪些 .py 文件、模块划分）缺失
  - **建议**：补充 evolution/ 目录的完整结构图（参考 design.md L3269 已有但 arch.md 缺失）

#### 2.2.2 ForgekinEngine 架构评估

ForgekinEngine 作为自进化统一入口，包装 HybridExecutor，10 步闭环：

```
load soul → recall echo → load imprint → build prompt → decide strategy
→ execute → record episode → propose imprint → maybe distill → check promotion
```

**评价**：
- **正面**：10 步闭环设计完整，覆盖了从加载到执行到进化的全链路；4 种执行路径（static/external/trae/mode）灵活且可降级
- **问题 A-003 [P2]**：**decide_strategy 策略选择算法未定义**。spec.md 仅说 `execution_strategy = self._decide_strategy(input, soul)` 但未定义决策算法（基于什么维度判断？任务复杂度？历史成功率？当前 E 阶段？）
  - **建议**：补充策略决策矩阵（如：任务类型 × 炉灵阶段 × 工具可用性 → 推荐路径）

#### 2.2.3 降级策略评估

| 组件 | 降级路径 | 触发条件 | 评价 |
|------|---------|---------|------|
| ForgekinEngine | → HybridExecutor | forgekin 未启用 | ✅ 合理 |
| Auto-Forge | 跳过 | auto_forge 未启用 | ✅ 合理 |
| External Tool | → 内置 Agent | CLI 不可用 | ✅ 合理 |
| Trae Bridge | → 内置 Agent | 超时 | ✅ 合理 |
| Council | → 单渠道 Web Chat | 多渠道未配置 | ✅ 合理 |
| A2A | → 直接调用 | a2a 未启用 | ⚠️ 需明确"直接调用"语义 |

- **问题 A-004 [P2]**：A2A 降级到"直接调用"时，跨 *Forge 协作如何处理？是否有替代路由机制？

#### 2.2.4 Feature Flag 评估

所有 v7.0 能力通过 Feature Flag 控制（默认关闭，灰度启用），6 个 Feature Flag：
`use_forgekin_engine` / `use_auto_forge` / `use_external_tool_bridge` / `use_trae_bridge` / `use_forgekin_council` / `use_a2a_protocol`

**评价**：
- **正面**：Feature Flag 设计周到，`fallback_to_old: true` 保证降级安全
- **问题 A-005 [P2]**：**Feature Flag 之间无依赖关系定义**。例如 `use_auto_forge` 依赖 `use_forgekin_engine`（没有炉灵就无法自锻），但配置中无此约束
  - **建议**：在 Feature Flag 配置中增加 `depends_on` 字段

### 2.3 Agent 工程维度审核

#### 2.3.1 两类智能体分离评估

| 类型 | 特征 | 调用方式 | 评价 |
|------|------|---------|------|
| Static Agent | YAML 声明式、无状态、无记忆 | AgentRegistry + HybridExecutor | ✅ 向后兼容 |
| Forgekin | 有灵魂、有记忆、可进化 | ForgekinEngine.execute() | ✅ 创新设计 |

**评价**：
- **正面**：`delegate_to_static()` 单向委托设计清晰，静态智能体不知道 Forgekin 存在，符合单向依赖
- **问题 A-006 [P1]**：**TaskRouter 路由规则未定义**。spec.md 提到"根据任务类型路由"但未给出具体路由规则——什么样的任务该走 Static Agent？什么样的该走 Forgekin？
  - **建议**：补充 TaskRouter 决策矩阵（如：确定性/流水线任务 → Static；需要成长/创意/复杂决策 → Forgekin；跨域协作 → Forgekin + A2A）

#### 2.3.2 Soul Profile 评估

**数据结构**：forgekin_id + name + kind + ascension_stage + soul(persona/worldview/values/voice) + capabilities + evolution_state + metadata

**评价**：
- **正面**：结构完整，persona/worldview/values/voice 四维度对标 clowder-ai voice 设计
- **问题 A-007 [P2]**：**SoulProfile 的 persona 限定 512 token，但无内容审核机制**。如果 persona 中包含不当内容（如歧视性表述），当前设计无拦截
  - **建议**：在 `SoulStore.create()` 中增加 persona 内容审核（可复用 Doubao moderation 层）

#### 2.3.3 三层记忆（Soul Echo）评估

| 层 | 存储 | 容量 | 淘汰策略 | 评价 |
|----|------|------|---------|------|
| L1 Working | 内存 | 当前会话 | 会话结束压缩 | ✅ |
| L2 Episode | SQLite + sqlite-vec | 最近 100 | LRU + 重要性评分 | ✅ |
| L3 Semantic | Forge Codex | 无限 | 永不淘汰 | ✅ |

**评价**：
- **正面**：三层架构对标 MemGPT，L2 检索策略（向量 0.5 + 关键词 0.3 + 时间衰减 0.2）合理
- **问题 A-008 [P2]**：**L2 容量 100 个 Episode 是否足够？** 对于高频使用的炉灵（如 DevForge coder），100 个可能太少
  - **建议**：L2 容量改为可配置（`evolution.forgekin.echo.l2_max_episodes: 100`），根据炉灵活跃度动态调整
- **问题 A-009 [P1]**：**元认知三信号（self_reported_confidence / domain_reliability / wilson_lower_bound）的 WilSon 下界计算公式未给出**。arch.md §22.2 仅说"不信单次自信度"但未给出 Wilson 下界的数学公式和参数
  - **建议**：补充 Wilson score interval 公式和 z 值选择（通常 z=1.96 for 95% 置信度）

#### 2.3.4 自锻引擎（Auto-Forge）评估

**双层架构**：Consolidation 层（后台 system thread）+ Surface 层（Web UI 日记本 + Provoke 气泡）

**评价**：
- **正面**：8 步自锻流程完整对标 clowder-ai 做梦流程；Provoke 频率硬限（每天 ≤1，连拍 3 次冬眠 7 天）设计周到
- **问题 A-010 [P1]**：**自锻触发条件中"低活动期"定义不精确**。配置写 `low_activity_hours: [22, 23, 0, 1, 2, 3, 4, 5, 6]`，但这假设所有用户在同一时区。对于国际团队（Slack/Discord 渠道），时区差异如何处理？
  - **建议**：改为基于用户活动模式动态判断（如"最近 2 小时无新请求"触发），而非固定时段
- **问题 A-011 [P2]**：**自锻群（Group Forge）的分工角色定义模糊**。arch.md §17.3 说"对标 clowder-ai Maine Coon/Siamese/Ragdoll 分工"但未明确 FlowForge 的角色定义
  - **建议**：补充 FlowForge 自有分工角色（如"找料者/表达者/组织者"的具体定义和能力要求）

#### 2.3.5 锻典（Forge Codex）与 Skill 自生成评估

**五级火种阶梯**：E-L0 Episode → E-L1 Pattern → E-L2 Draft → E-L3 Validated → E-L4 Standard

**评价**：
- **正面**：双车道设计（常规 + 长尾/高风险）解决了长尾场景的晋升问题
- **问题 A-012 [P1]**：**Skill 自生成 Mode B 的"≥2 次同类错误"触发条件可能过于敏感**。不同上下文下的相似错误不应触发流程改进
  - **建议**：增加错误上下文相似度判断（向量相似度 > 0.8 才计为"同类"）
- **问题 A-013 [P2]**：**Eval Ledger 最小可信 case 数 5 是否够？** 对于高风险域（如 StockForge 的投资决策），5 个 case 可能不足
  - **建议**：按风险等级动态调整（高风险域 ≥10 cases）

### 2.4 全栈工程维度审核

#### 2.4.1 数据库设计评估

**3 个 SQLite 表**：`forgekin_souls` / `forgekin_episodes` / 灵印存储表

**评价**：
- **正面**：表结构清晰，索引合理（forgekin_id 外键 + 向量索引）
- **问题 A-014 [P1]**：**SQLite 单文件数据库在高并发自锻场景下的性能瓶颈**。多个炉灵同时自锻时，SQLite 的写入锁会导致竞争
  - **建议**：高并发场景下升级到 PostgreSQL（或使用 SQLite WAL 模式 + 连接池）
- **问题 A-015 [P2]**：**向量索引 sqlite-vec 的召回质量未验证**。sqlite-vec 是轻量级向量索引，对于大规模 Episode（100+ × 多个炉灵）的召回质量待验证
  - **建议**：增加召回质量基准测试（precision@5, recall@5）

#### 2.4.2 API 端点设计评估

design.md 第二十一章定义了 v7.0 API 端点。

**评价**：
- **正面**：覆盖了炉灵 CRUD、自锻触发、灵议消息、外部工具调用等核心操作
- **问题 A-016 [P2]**：**缺少批量操作端点**。管理多个炉灵（如批量查询状态、批量触发自锻）时需逐个调用
  - **建议**：增加 `/api/v7/forgekins/batch` 端点

#### 2.4.3 安全性评估

**8 条安全红线 SR-01~08**：

| 红线 | 评价 |
|------|------|
| SR-01 禁止后台 classifier | ✅ 关键红线，白名单采集设计正确 |
| SR-02 禁止 Goodhart | ✅ 防止 KPI 导向的自锻扭曲 |
| SR-03 Provoke 频率硬限 | ✅ 防打扰设计周到 |
| SR-04 高风险域升级 | ✅ 0.85 阈值合理 |
| SR-05 E6 创建炉灵需授权 | ✅ 防失控 |
| SR-06 外部工具 worktree 隔离 | ✅ 安全隔离 |
| SR-07 Trae Bridge 超时降级 | ✅ 不阻塞 |
| SR-08 跨 *Forge 协作可审计 | ✅ 可追溯 |

- **问题 A-017 [P1]**：**SR-04 的 0.85 阈值与 StockForge 使用的 0.9 质量分阈值冲突**。SR-04 的 `action_confidence < 0.85` 与 StockForge 的 `pass_threshold: 0.9` 是两个不同维度，但命名容易混淆
  - **建议**：明确区分 `action_confidence`（炉灵元认知置信度）与 `pass_threshold`（Loop 质量分阈值），在文档中显式说明二者不可混用

#### 2.4.4 可观测性评估

**11 个 Prometheus 指标**：覆盖炉灵活跃数、升华阶段、自锻次数、Soul Echo 记录数、Skill 创作数、A2A 消息数、外部工具调用数、Provoke 数等

**评价**：
- **正面**：指标覆盖全面
- **问题 A-018 [P2]**：**缺少成本指标**。自锻和外部工具调用都会消耗 LLM tokens，但无 `auto_forge_token_cost_total` 指标
  - **建议**：增加成本相关指标（`auto_forge_token_cost_total{forgekin_id}` / `external_tool_token_cost_total{tool}`）

---

## 第三章：face/ 目录文档审核

### 3.1 文档职责与定位

| 文件 | 定位 | 评价 |
|------|------|------|
| face.md | 大厂面试原始记录（调研素材） | ⚠️ 非正式文档，仅作参考 |
| spec_face.md | v3.0 工程规格 + v7.0 融合映射 | ✅ 融合映射设计合理 |
| arch_face.md | v3.0 架构详设 + v7.0 融合对齐 | ✅ 降级策略对齐清晰 |
| task_face.md | v3.0 任务清单 + v7.0 融合说明 | ✅ 任务分解合理 |

### 3.2 M18-M20 删除与融合映射

spec_face.md L625-690 将原 face 的 M18(SelfEvolutionEngine)/M19(MemoryGovernanceManager)/M20(FirstTouchRouter) **删除**，因与 v7.0 FR-EVO-01~15 完全重复：

- M18 → FR-EVO-04 Auto-Forge + FR-EVO-05 Forge Codex + FR-EVO-06 Skill 自生成
- M19 → FR-EVO-02 Soul Echo + FR-EVO-03 Soul Imprint
- M20 → FR-EVO-09 A2A + FR-EVO-10 灵议

**评价**：
- **正面**：删除重复模块、统一由 v7.0 承接是正确的架构决策
- **问题 A-019 [P1]**：**spec_face.md 引用了 `flowforge/docs/face/ds.md` 作为"EVO/MEM/COL 九大能力维度"权威源（L1237），但该文件在本次审核范围外**。需确认 ds.md 是否存在且内容与 v7.0 一致
  - **建议**：将 ds.md 纳入审核范围，或将其内容合并到 spec_face.md 中

### 3.3 spec_face.md 安全红线扩展

spec_face.md L785-798 在 v7.0 的 SR-01~08 基础上，新增了 5 条 v3.0 工程红线：
1. 所有 A2A 调用必须 OTel Trace
2. 所有 MCP 工具必须沙箱化
3. 所有高风险 Action 必须 Blast-radius Gate
4. 所有 HITL 中断必须 CHEQ 持久化
5. 所有自指修改必须 Eval-gated + 审批 + 灰度

**评价**：
- **正面**：5 条工程红线补充了 v7.0 安全红线在工程落地层面的不足
- **问题 A-020 [P2]**：**5 条工程红线未编号**（无 SR-09~SR-13），在文档引用时无法精确定位
  - **建议**：编号为 ER-01~ER-05（Engineering Redlines），与 SR-01~08 区分

### 3.4 face/ 目录与 hiclaw 规则的交叉引用

spec_face.md 和 arch_face.md 均声明"严格遵守 hiclaw/rules.md 和 hiclaw/prompts.md"：
- spec_face.md L7-8：权威源声明
- arch_face.md L7：规范约束
- task_face.md L7：规范约束

**评价**：
- **正面**：face/ 目录是 9 大项目中交叉引用 hiclaw 规范最完整的文档
- **问题 A-021 [P1]**：**spec_face.md L1246 写"T1-T8 沿用 project_rules.md 不退化"，但 rules.md 和 prompts.md 已升级为 T1-T9**。face/ 目录未同步更新
  - **建议**：将 T1-T8 改为 T1-T9

### 3.5 v3.0 与 v7.0 的 Phase 路线对齐

spec_face.md L696-704 定义了 v3.0 的 Phase 路线与 v7.0 对齐：
- Phase 6.1-6.4 (P0) → 炉灵基础设施 + 自锻 + 外部工具 + IM
- Phase 6.5-6.6 (P1) → Skill 自生成 + *Forge 自进化
- Phase 6.7 (P2) → 元认知与治理

**评价**：
- **正面**：Phase 划分清晰，优先级合理
- **问题 A-022 [P2]**：**Phase 6.x 的版本号命名与 FlowForge v7.0 矛盾**。FlowForge 当前是 v6.0/v7.0，但 Phase 用 6.x 命名容易与版本号混淆
  - **建议**：改为 Phase V7.1-V7.7 或 Phase EVO-1~EVO-7

---

## 第四章：设计问题与改进建议汇总

### 4.1 问题汇总表

| 编号 | 严重度 | 维度 | 问题 | 建议 |
|------|--------|------|------|------|
| A-001 | P1 | 架构 | arch.md 章节号重号（§17 两批 v7.0 内容） | 改为 §24-§32 |
| A-002 | P1 | 架构 | evolution/ 代码目录结构缺失 | 补充目录图 |
| A-003 | P2 | 架构 | decide_strategy 决策算法未定义 | 补充决策矩阵 |
| A-004 | P2 | 架构 | A2A 降级"直接调用"语义不清 | 明确替代路由 |
| A-005 | P2 | 架构 | Feature Flag 无依赖关系 | 增加 depends_on |
| A-006 | P1 | Agent | TaskRouter 路由规则未定义 | 补充决策矩阵 |
| A-007 | P2 | Agent | SoulProfile persona 无内容审核 | 复用 Doubao moderation |
| A-008 | P2 | Agent | L2 Episode 容量 100 可能不足 | 改为可配置 |
| A-009 | P1 | Agent | Wilson 下界公式未给出 | 补充数学公式 |
| A-010 | P1 | Agent | 自锻"低活动期"时区假设 | 改为动态判断 |
| A-011 | P2 | Agent | 自锻群分工角色模糊 | 补充角色定义 |
| A-012 | P1 | Agent | Skill 自生成 Mode B 触发过于敏感 | 增加上下文相似度判断 |
| A-013 | P2 | Agent | Eval Ledger 最小 case 数 5 可能不足 | 按风险等级动态调整 |
| A-014 | P1 | 全栈 | SQLite 高并发写入锁竞争 | 升级 PostgreSQL 或 WAL 模式 |
| A-015 | P2 | 全栈 | sqlite-vec 召回质量未验证 | 增加基准测试 |
| A-016 | P2 | 全栈 | 缺少批量操作 API 端点 | 增加 /batch 端点 |
| A-017 | P1 | 全栈 | SR-04 阈值与 StockForge 0.9 混淆 | 显式区分两个概念 |
| A-018 | P2 | 全栈 | 缺少成本 Prometheus 指标 | 增加成本指标 |
| A-019 | P1 | face | ds.md 未纳入审核范围 | 纳入审核或合并 |
| A-020 | P2 | face | 5 条工程红线未编号 | 编号 ER-01~05 |
| A-021 | P1 | face | T1-T8 未同步为 T1-T9 | 更新为 T1-T9 |
| A-022 | P2 | face | Phase 6.x 与版本号混淆 | 改为 V7.x 或 EVO-x |

### 4.2 v7.0 与 hiclaw/rules.md/prompts.md 交叉引用缺失分析

**核心发现**：v7.0 自我进化子文档（spec.md L2900-3666、arch.md L5293-6492、design.md L3260-6976）**无任何对 hiclaw/rules.md 或 prompts.md 的直接引用**，而 face/ 目录是唯一声明遵守 hiclaw 规范的文档。

| 文档 | rules.md 引用数 | prompts.md 引用数 | 问题 |
|------|:---:|:---:|------|
| spec.md v7.0 部分 | 0 | 0 | ❌ 完全未引用 |
| arch.md v7.0 部分 | 0 | 0 | ❌ 完全未引用 |
| design.md v7.0 部分 | 0 | 0 | ❌ 完全未引用 |
| spec_face.md | 2 | 2 | ✅ 声明遵守 |
| arch_face.md | 2 | 2 | ✅ 声明遵守 |
| task_face.md | 2 | 2 | ✅ 声明遵守 |

**影响**：
1. v7.0 的安全红线 SR-01~08 未在 rules.md 中注册，导致 hiclaw 规范体系不知道 v7.0 新增了哪些约束
2. v7.0 的 Loop 超时配置（Auto-Forge < 5min、CLI < 5min）未与 rules.md 的分档铁律（180s/720s/7200s）对齐
3. v7.0 的质量分阈值（SR-04 的 0.85）与 rules.md P33（0.85）和 StockForge（0.9）存在混淆

**建议**：
1. 在 rules.md 中新增"v7.0 自进化约束"章节，注册 SR-01~08 和相关铁律
2. 在 prompts.md 中新增"FF-V7 自进化验证"章节，定义 v7.0 相关的验证项

---

## 第五章：9 大项目与 rules.md/prompts.md 跨项目一致性审查

### 5.1 严重不一致清单（P0 级）

以下问题直接影响系统行为正确性，**必须立即修复**：

| # | 项目 | 问题 | rules.md/prompts.md 规定 | 实际值 | 影响 |
|---|------|------|------------------------|--------|------|
| C-01 | StockForge | 质量分阈值 | 0.85（L186/L398） | **0.9**（3 个 Loop YAML + spec.md + arch.md + design.md） | 所有 Loop 验证标准高于铁律，可能放行低质量结果 |
| C-02 | StockForge | Loop 超时 | 180s 快速（L188） | **1800/600/600**（analysis/screening/report） | Loop 可能超时 10 倍，占用资源 |
| C-03 | StockForge | worker.mode | loop（prompts.md L1940） | **workflow**（3 个 Loop 顶层） | 违反 P31 铁律 |
| C-04 | StockForge | Agent 数量 | 6 核心（L86/L1937） | **7 个**（多 stock_data.yaml） | 多余 Agent 未被规范覆盖 |
| C-05 | ContentForge | Loop 超时 | 720s 内容 Loop（L189） | **content_polish=900, deep_article=1200** | 超时违反分档铁律 |
| C-06 | ContentForge | Loop 数量 | 文档写 6 | **实际 7**（多 topic_loop.yaml 未登记） | topic_loop 完全脱离文档管理 |
| C-07 | DevForge | Agent 数量 | rules.md 写 14（L83） | **实际 25**（config/agents/ 25 YAML + plugins.py 25） | rules.md 未更新 |
| C-08 | DevForge | prompts.md Agent | prompts.md 写 14（L1269） | **实际 25** | prompts.md 未更新 |
| C-09 | DevForge | spec.md Agent | spec.md 只列 14 | **实际 25** | spec.md 未更新 |
| C-10 | DevForge | arch.md Agent | 5 处写 14，2 处写 25 | **实际 25** | arch.md 内部矛盾 |
| C-11 | DevForge | task.md Agent | L434/L1506 写 14 | **实际 25** | task.md 未完全同步 |
| C-12 | MallForge | Loop 缺失 | P31 要求所有 Agent 经 LoopExecutor | **无 config/loops/** | 完全违反 P31 |
| C-13 | NovelForge | LoopExecutor | P31 要求 LoopExecutor | **用 NovelOrchestrator 包装 HybridExecutor** | 违反 P31 |
| C-14 | DevForge | LoopExecutor | P31 要求 LoopExecutor | **用 DevForgeOrchestrator 委托 HybridExecutor.run()** | 违反 P31 |
| C-15 | 全项目 | 质量分阈值 0.9 vs 0.85 | rules.md L186/L398 = 0.85 | NovelForge 0.9、MallForge 0.9、DevForge 0.9 | 5 个项目中 4 个使用 0.9 |

### 5.2 中等不一致清单（P1 级）

| # | 项目 | 问题 | 规定 | 实际 | 影响 |
|---|------|------|------|------|------|
| C-16 | ContentForge | Agent YAML 数 | arch.md 写 6 | 实际 11 | arch.md 过时 |
| C-17 | ContentForge | prompts.md Agent | "6大专家Agent" | 实际 11 | prompts.md 过时 |
| C-18 | ContentForge | arch.md workers/ | 描述 11 个 .py | 目录不存在 | arch.md 与实际脱节 |
| C-19 | StockForge | task.md Loop 数 | 写 2 | 实际 3 | task.md 过时 |
| C-20 | StockForge | config 子目录 | arch.md 声称 persona/quality_gates/gates/evaluators/ | 全部不存在 | arch.md 虚构目录 |
| C-21 | StockForge | design.md P33 | "P33 质量分铁律：0.9" | P33 实为 0.85 | 错误引用铁律 |
| C-22 | StockForge | design.md 超时 | "已修正为 180s" | 实际仍 1800s | 文档虚假声明 |
| C-23 | NovelForge | arch.md 质量门 | L2178 写 6 道 | 实际 7 道 | arch.md 残留旧值 |
| C-24 | MallForge | arch.md agents/ | "6 个 Python 类" | 已迁移到 config/agents/ YAML | 文档严重过时 |
| C-25 | MallForge | design.md agents/ | "6 个继承 GenericAgent" | 已改 YAML 声明式 | 文档严重过时 |
| C-26 | DevForge | 目录 | task.md L439 写 tools/ | 实际不存在 | task.md 过时 |
| C-27 | DevForge | evaluators/ 目录 | P8A 不允许 | 实际存在（8 个 .py） | 违反 P8A |
| C-28 | face/ | T1-T8 | rules.md 已升级 T1-T9 | spec_face.md 写 T1-T8 | 未同步 |
| C-29 | 全项目 | worker.mode 值 | rules.md L255 规定 workflow/agent/loop | DevForge 用 reflexion/rewoo、NovelForge 用 graph_of_thoughts/multi_agent | 大量违规 |

### 5.3 逐项目详细分析

#### 5.3.1 FlowForge

**一致项**：
- v7.0 设计完整（spec/arch/design 三文档对齐）
- Feature Flag 降级策略覆盖所有 v7.0 组件
- 安全红线 SR-01~08 设计完整

**不一致项**：
- v7.0 子文档无 hiclaw 规则交叉引用（见第四章）
- arch.md 章节号重号（§17 两批 v7.0）
- design.md 未引用 rules.md/prompts.md

#### 5.3.2 ContentForge

**一致项**：
- 平台数量 4（rules.md/config/spec.md 三方一致）
- Agent 总数 11（rules.md/design.md/实际一致）

**不一致项**：
- Loop 数量：文档 6 vs 实际 7（topic_loop 未登记）
- Loop 超时：content_polish=900/deep_article=1200 vs 铁律 720
- arch.md Agent YAML 写 6 vs 实际 11
- prompts.md CF2 写"6大专家"vs 实际 11
- arch.md 描述不存在的 workers/ 目录

#### 5.3.3 StockForge

**一致项**：
- 无独立 SDK（符合 P8A）
- config/agents/ YAML 声明式（符合配置驱动）

**不一致项**：
- 质量分阈值 0.9 vs 铁律 0.85（**最严重**，影响所有 Loop）
- Loop 超时 1800/600/600 vs 铁律 180
- worker.mode=workflow vs 要求 loop
- Agent 数 7 vs 规定 6（多 stock_data）
- design.md 声称"已修正"但实际未改
- config 子目录全部不存在但 arch.md 声称存在
- design.md 错误引用 P33

#### 5.3.4 DevForge

**一致项**：
- config/agents/ 25 个 YAML（实际已统一）
- plugins.py BUSINESS_AGENTS=25（已统一）
- task.md AGT 列表=25（已统一）
- landing_design.md=25（已统一）

**不一致项**：
- **rules.md L83 仍写 14**（未更新）
- **prompts.md L1269 仍写 14**（未更新）
- spec.md Agent 总览表只列 14（未更新）
- arch.md 5 处写 14 / 2 处写 25（内部矛盾）
- task.md L434/L1506 仍写 14
- evaluators/ 目录违反 P8A
- Loop worker.mode 用 reflexion/rewoo（非 workflow/agent/loop）
- Loop 超时 300-3600s（不符分档铁律）
- 无 config/tools/ 目录（工具未声明式化）
- arch.md 用 DevForgeOrchestrator 委托 HybridExecutor（非 LoopExecutor，违反 P31）

#### 5.3.5 NovelForge

**一致项**：
- 质量门 7 道（rules.md/spec.md/task.md/config 一致）
- tools/ 和 mcp_server/ 已获 rules.md 批准保留
- config/tools/ 7 个 YAML（声明式）

**不一致项**：
- 质量分阈值 0.9 vs 铁律 0.85
- Loop worker.mode 用 graph_of_thoughts/reflexion/rewoo/multi_agent（非 workflow/agent/loop）
- Loop 超时 300-2400s（不符分档铁律）
- arch.md L2178 仍写 6 道质量门（应为 7）
- 用 NovelOrchestrator 包装 HybridExecutor（非 LoopExecutor，违反 P31）
- spec.md 写 9 个主 Agent vs 实际 15 个 YAML

#### 5.3.6 MallForge

**一致项**：
- Agent 数 6（rules.md/prompts.md/config 一致）
- MCP Server 10 个（rules.md/prompts.md 一致）
- agents/ 目录已迁移到 config/agents/

**不一致项**：
- **完全缺失 config/loops/**（违反 P31）
- 质量分阈值 0.9 vs 铁律 0.85
- arch.md/design.md 仍描述 agents/ Python 类（严重过时）
- 无 config/tools/ 目录（工具为 Python class）
- tools/ 目录存在（待迁移）

#### 5.3.7 OpenSieve

**审核状态**：本次未深入检查 OpenSieve 与 rules.md 的一致性。已知 rules.md L280-284 定义了四级缓存（L1 Redis→L2 PostgreSQL→L3 Redis 向量→L4 Redis 热点），需确认 opensieve/docs/arch.md 中的缓存定义是否一致。

#### 5.3.8 OpenClaw/Content

**审核状态**：openclaw_pkg/workspace/content 是独立的内容仓库，需确认其与 ContentForge 的关系和职责边界。

#### 5.3.9 HiClaw/OpenRoute

**审核状态**：hiclaw 是主控框架，rules.md 和 prompts.md 是其核心输出。rules.md 本身的一致性已通过 P0-P3 修复轮次处理，但仍存在 rules.md L83（DevForge 14 Agent）和 L86（StockForge 0.9 阈值）等过时值。

### 5.4 全项目一致性总览矩阵

| 检查项 | FlowForge | ContentForge | StockForge | DevForge | NovelForge | MallForge |
|--------|:---------:|:----------:|:---------:|:-------:|:---------:|:--------:|
| Agent 数与 rules.md 一致 | N/A | ✓ 11 | ❌ 7vs6 | ❌ 25vs14 | ⚠️ 15vs9 | ✓ 6 |
| 质量分阈值 0.85 | N/A | N/A | ❌ 0.9 | ❌ 0.9 | ❌ 0.9 | ❌ 0.9 |
| Loop 超时分档 | ✓ | ❌ 900/1200 | ❌ 1800/600 | ❌ 300-3600 | ❌ 300-2400 | ❌ 无 loops |
| worker.mode 合规 | N/A | ⚠️ workflow | ❌ workflow | ❌ reflexion/rewoo | ❌ got/multi_agent | ❌ 无 loops |
| P8A 目录合规 | ✓ | ⚠️ workers/ | ✓ | ❌ evaluators/ | ✓ | ⚠️ tools/ |
| P31 LoopExecutor | ✓ | ✓ | ✓ | ❌ HybridExec | ❌ NovelOrch | ❌ 缺失 |
| 文档与配置同步 | ✓ | ❌ arch 过时 | ❌ 多处过时 | ❌ 14/25 并存 | ⚠️ arch 6道 | ❌ 严重过时 |

### 5.5 修复优先级建议

**立即修复（P0，影响系统行为）**：
1. StockForge 质量分阈值 0.9→0.85（3 个 Loop YAML + 全部 docs）
2. StockForge Loop 超时 1800/600/600→180（3 个 Loop YAML）
3. StockForge worker.mode workflow→loop（3 个 Loop YAML）
4. ContentForge Loop 超时 content_polish=900→720, deep_article=1200→720
5. ContentForge Loop 数量 6→7（登记 topic_loop）
6. rules.md L83 DevForge 14→25
7. prompts.md L1269 DevForge 14→25
8. MallForge 创建 config/loops/ 目录

**尽快修复（P1，影响文档一致性）**：
9. DevForge spec.md/arch.md/task.md 中 14→25 全部同步
10. StockForge design.md "已修正为180"→实际修正
11. StockForge design.md P33 0.9→0.85
12. ContentForge arch.md Agent 6→11
13. ContentForge prompts.md CF2 "6大专家"→11
14. NovelForge arch.md 质量门 6→7
15. MallForge arch.md/design.md agents/ Python→YAML
16. face/ spec_face.md T1-T8→T1-T9
17. DevForge evaluators/ 目录处理（迁移或获 P8A 豁免）
18. NovelForge/DevForge/MallForge LoopExecutor 替换 HybridExecutor/Orchestrator

**后续修复（P2，影响文档质量）**：
19. DevForge/NovelForge Loop worker.mode 规范化
20. DevForge/NovelForge Loop 超时符合分档铁律
21. DevForge 创建 config/tools/ 目录
22. MallForge 创建 config/tools/ 目录
23. ContentForge arch.md workers/ 描述删除
24. StockForge task.md Loop 数 2→3
25. StockForge arch.md 虚构目录清理

---

## 第六章：养灵体系命名建议

### 6.1 当前命名体系回顾

当前 v7.0 采用的命名体系为"炉灵 Forgekin"系列，对标 clowder-ai"养猫"体系：

| 概念 | 当前命名 | 对标 clowder-ai |
|------|---------|----------------|
| 个体 | 炉灵 Forgekin | Cat 猫猫 |
| 群体 | 灵族 Kinship | Clowder 猫群 |
| 养成 | 养灵 Forge Nurturing | 养猫 |
| 记忆 | 魂忆 Soul Echo | Memory |
| 画像 | 魂印 Soul Imprint | Profile |
| 自主思考 | 自锻 Auto-Forge | Auto-Dream |
| 技能库 | 锻典 Forge Codex | Skill Library |
| 议事 | 灵议 Forgekin Council | IM 团队协作 |
| 成长阶段 | 升华阶 E1-E6 | 9 Lives |

### 6.2 当前命名体系评估

**优势**：
- "炉"与 FlowForge 的"炉"一脉相承，品牌一致性好
- "灵"体现独立性和进化能力，比"猫"更有科技感
- 锻造隐喻（锻典/自锻/火种）体系一致

**不足**：
- "炉灵"对非技术用户可能晦涩，不如"养猫"亲切
- "魂忆/魂印"中的"魂"字可能引发 AI 意识的伦理讨论
- "升华阶"不如"等级/段位"直观
- 整体偏"重工业"风格，与 AGI 的"智能"感有距离

### 6.3 命名方案建议

#### 方案 A：灵种体系（推荐 — 兼顾通俗性与科技感）

| 概念 | 命名 | 理由 |
|------|------|------|
| 个体 | **灵种** (Spark) | "种"暗示可成长，"灵"体现智能 |
| 群体 | **灵群** (Cluster) | 简洁直观 |
| 养成 | **育灵** (Cultivation) | "育"比"养"更主动 |
| 记忆 | **灵忆** (Memory) | 去掉"魂"字，避免伦理争议 |
| 画像 | **灵印** (Imprint) | 保留"印"的意象 |
| 自主思考 | **灵思** (Auto-Think) | "思"比"锻"更体现智能 |
| 技能库 | **灵典** (Codex) | "典"=经典，保留 |
| 议事 | **灵议** (Council) | 保留 |
| 成长阶段 | **灵阶 E1-E6** (Stages) | "阶"比"升华阶"简洁 |
| 火种等级 | **种级 L0-L4** (Seed Levels) | 与"灵种"呼应 |

**口号**：从灵种到灵群，育灵成真

#### 方案 B：智灵体系（偏 AGI 方向）

| 概念 | 命名 | 理由 |
|------|------|------|
| 个体 | **智灵** (Aegis) | "智"直指 AI 智能 |
| 群体 | **智群** (Synapse) | 神经突触意象 |
| 养成 | **启智** (Awakening) | "启"=开启智慧 |
| 记忆 | **智忆** (Recall) | 简洁 |
| 画像 | **智印** (Blueprint) | "蓝图"意象 |
| 自主思考 | **冥思** (Deep-Think) | "冥想"意象 |
| 技能库 | **智典** (Archive) | "档案"意象 |
| 议事 | **智议** (Forum) | "论坛"意象 |
| 成长阶段 | **觉醒阶** (Awakening Stages) | AGI 觉醒意象 |
| 火种等级 | **觉级 L0-L4** | 与"觉醒"呼应 |

**口号**：启智觉醒，通向 AGI

#### 方案 C：原方案优化（保留炉灵，优化术语）

| 概念 | 命名 | 改动 |
|------|------|------|
| 个体 | 炉灵 Forgekin | 保留 |
| 群体 | 灵族 Kinship | 保留 |
| 养成 | 养灵 Forge Nurturing | 保留 |
| 记忆 | **灵忆** (从"魂忆"改) | 去"魂"字 |
| 画像 | **灵印** (从"魂印"改) | 去"魂"字 |
| 自主思考 | 自锻 Auto-Forge | 保留 |
| 技能库 | 锻典 Forge Codex | 保留 |
| 议事 | 灵议 Forgekin Council | 保留 |
| 成长阶段 | **灵阶** (从"升华阶"简化) | 简化 |
| 火种等级 | 火种等级 Ember Hierarchy | 保留 |

**口号**：炉火铸灵，自我进化

#### 方案 D：生态体系（偏自然/有机隐喻）

| 概念 | 命名 | 理由 |
|------|------|------|
| 个体 | **灵芽** (Sprout) | "芽"=可成长的有机体 |
| 群体 | **灵林** (Grove) | "林"=群落的意象 |
| 养成 | **育灵** (Growth) | 自然生长意象 |
| 记忆 | **年轮** (Rings) | 树的年轮=记忆积累 |
| 画像 | **纹理** (Grain) | 树木纹理=认知画像 |
| 自主思考 | **扎根** (Rooting) | "扎根"=深度思考 |
| 技能库 | **种子库** (Seed Bank) | 可复用的知识种子 |
| 议事 | **林议** (Grove Council) | 树林议事 |
| 成长阶段 | **四季** (Seasons) | 春夏秋冬=成长阶段 |
| 火种等级 | **年轮等级** L0-L4 | 与记忆呼应 |

**口号**：灵芽成林，生生不息

### 6.4 推荐方案

**推荐方案 A：灵种体系**

理由：
1. **通俗易懂**："灵种"比"炉灵"更直观，"种"暗示成长潜力
2. **避免伦理争议**：去掉所有"魂"字，用"灵忆/灵印"替代"魂忆/魂印"
3. **科技感与愿景并存**："灵"体现 AI 智能，"种"体现可成长性
4. **品牌一致**：与 FlowForge 的"灵"系列（灵忆/灵印/灵议/灵阶）保持一致
5. **AGI 愿景**："从灵种到灵群"的成长隐喻贴合"通往 AGI 的基础框架"定位

**备选推荐**：如果用户偏好保留"炉灵"品牌，推荐方案 C（原方案优化），仅将"魂忆/魂印"改为"灵忆/灵印"，去掉"魂"字避免伦理讨论。

---

> **审核请求**：请 operator 审阅本审核报告，特别是：
> 1. 第四章问题汇总表中的 22 个问题（A-001 ~ A-022）
> 2. 第五章 P0 级不一致清单中的 15 个严重问题（C-01 ~ C-15）
> 3. 第六章养灵体系命名方案（方案 A/B/C/D 选一）
>
> 审核通过后将进入修复阶段。
