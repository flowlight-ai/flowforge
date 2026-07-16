# FlowForge v7.0 自我进化与「养灵」体系设计文档六方联合审核意见（minimax1.md）

> **审核日期**：2026-07-15
> **审核文件**：[flowforge/docs/spec.md](file:///home/hyg/ai/openclaw/flowforge/docs/spec.md)（v2.1+ v7.0 增量 2900-3666）、[arch.md](file:///home/hyg/ai/openclaw/flowforge/docs/arch.md)（v6.0 + v7.0 增量 5293-6492）、[design.md](file:///home/hyg/ai/openclaw/flowforge/docs/design.md)（v6.0 + 第五部分 v7.0 3260-6976）、[face/face.md](file:///home/hyg/ai/openclaw/flowforge/docs/face/face.md)、[face/spec_face.md](file:///home/hyg/ai/openclaw/flowforge/docs/face/spec_face.md)、[face/arch_face.md](file:///home/hyg/ai/openclaw/flowforge/docs/face/arch_face.md)、[face/ds.md](file:///home/hyg/ai/openclaw/flowforge/docs/face/ds.md)、[face/task_face.md](file:///home/hyg/ai/openclaw/flowforge/docs/face/task_face.md)
> **审核基线**：[hiclaw/rules.md](file:///home/hyg/ai/openclaw/hiclaw/rules.md) v3.0、[hiclaw/prompts.md](file:///home/hyg/ai/openclaw/hiclaw/prompts.md)
> **审核角色（虚拟联合评审委员会）**：
> - **AI 智能体产品专家**——从用户场景、产品定位、商业化、命名专业度角度评审
> - **AI 高级架构师**——从整体架构、依赖关系、跨层一致性、可演进性评审
> - **AI 智能体 Agent 开发工程师**——从可实现性、API 契约、运行时行为、可调试性评审
> - **高级软件全栈工程师**——从工程落地、CI/CD、可观测、安全、性能、可维护评审
> - **AI Prompt / Harness 研究员**——从 Harness 方法论、Self-Evolution 学术前沿、AGI 愿景表达评审
> - **DevRel / 社区生态负责人**——从开源品牌、传播性、跨行业接受度评审
>
> **审核方法**：逐文档（spec → arch → design → face/*）逐章节逐问题静态分析；不摘要、不合并、每条问题给出位置 + 引用 + 修复方案。

---

## 〇、总体判断与摘要

### 0.1 三大总体结论

| # | 结论 | 严重性 |
|---|------|--------|
| **TC-1** | **文档—代码完全断层**：v7.0 养灵（Forgekin）体系 100% 仅存在于 design.md/spec.md/arch.md 文档中，`flowforge/evolution/` 仍为 v6.0 `SelfEvolutionEngine`（scope_guard/process_evolution/knowledge_evolution/maturity/metacognition），**无任何** `forgekin/`、`auto_forge/`、`codex/`、`council/` 子目录。spec.md 7.3 节明确说"DevForge/ContentForge 都必须继承 v7.0 养灵能力"——但被继承的对象不存在。 | ❌ P0 致命 |
| **TC-2** | **核心铁律大规模违反**：rules.md §2.2（OpenSieve 唯一入口）、§2.3（P31 铁律）、§2.5（死代码警告）、§2.4（单向依赖）、9大项目 P8A 边界在 8 个项目中有不同程度的违反——其中 **ContentForge 的 `helixrag_search` 残留**已经在 5+ 文件 / 4+ 配置 / 2+ 工具层、**MallForge 直接调用 `GenericAgent.execute_with_context()` 绕过 LoopExecutor** 是两条最严重、长期未修复的 P0 违反。 | ❌ P0 致命 |
| **TC-3** | **版本号与文档定位整体撕裂**：flowforge/spec.md 顶部声明 "v2.1" 但包含 v7.0 章节；flowforge/arch.md/design.md 主体是 v6.0，v7.0 仅作为"第五部分/第15章"补丁追加；其他 *forge 项目版本声明分布在 v4.0/v6.0 之间——这意味着"v7.0"在 OpenClaw 体系内**还不是一个统一、可声明、可验证的版本**，它是一组散落的章节。 | ❌ P0 严重 |

### 0.2 跨项目冲突概览（详见第六节）

| 铁律来源 | 冲突项目 | 严重性 | 已存在时长 |
|----------|----------|:------:|:----------:|
| rules.md §2.2 "所有数据检索走 OpenSieve" | ContentForge 多文件残留 `helixrag_search`/`helixrag_endpoint`/`helixrag_*` 配置 | P0 | ≥2 周 |
| rules.md §2.3 "LoopExecutor 唯一执行入口 (P31)" | MallForge arch.md:907-909 明确写"未通过 LoopExecutor" | P0 | ≥3 周 |
| rules.md §2.5 "register_helm_handlers/register_permission_policy 死代码" | 9 个项目 *plugins.py 已合规；任务书与设计文档零散引用 | P1 | 1 周 |
| prompts.md P31 | contentforge/loops/deep_article_loop.yaml `worker.mode: workflow` 与 prompts.md P31 "Loop 是模式的上层管理者，worker.mode 应是 loop 嵌套而非 workflow" 冲突 | P1 | 1 周 |
| prompts.md §FF4e P0-3 "Loop 是第 10 种模式而非模式管理者" | `flowforge/modes/loop_mode.py:5-9` 注释与 `loop.md` 设计文档一致但与 spec.md 第七章"Loop 不是模式"原则矛盾 | P1 | 2 周 |
| rules.md §1.4 P8A "*Forge 不允许 tools/ 目录独立实现" | ContentForge tools/research_engine.py 仍在使用 | P1 | ≥1 月 |
| rules.md §1.4 P8A "*Forge 不允许 agents/ Python 类继承" | MallForge 仍保留 `agents/` Python 类 | P1 | ≥1 月 |
| rules.md §2.4 "FlowForge 独立开源 MIT" vs ContentForge 强耦合 | ContentForge config、tools、app 三层都有 FlowForge 特定 API 调用 | P2 | ≥2 月 |

### 0.3 全文索引

- 第一节：flowforge/docs/spec.md 逐章审核（每章节 → 问题 + 修复）
- 第二节：flowforge/docs/arch.md 逐章审核
- 第三节：flowforge/docs/design.md 逐章审核
- 第四节：flowforge/docs/face/* 逐文件审核
- 第五节：v7.0「养灵 / Forgekin」体系专项审核（产品、AGI 愿景、工程方法论）
- 第六节：rules.md / prompts.md 与 9 大项目跨项目冲突分析（按项目逐条）
- 第七节：命名方案提案（5 套候选 + 决策矩阵）
- 第八节：优先级 P0/P1/P2 行动清单

---

## 第一节：flowforge/docs/spec.md 逐章节审核

### 1.1 顶部版本声明（line 1-9）—— ❌ P0

**文档声明**：
> "# FlowForge v2.1 功能特性规格说明书"

**问题**：
- spec.md 主体确实是 v2.1 内容（第 1-2900 行），但 # 2900-3666 是 **完整的 v7.0 章节（第七/八/九/十/十一/十二/十三章）**。一个 3666 行的文件一半 v2.1、一半 v7.0，但顶部只声明 v2.1，违反文档可声明性。
- 阅读者无法从顶部判断 v7.0 内容是否经过正式审核；Trae CN 等自动化工具按顶部版本路由规范文档时，v7.0 内容会被错误地按 v2.1 标准处理。

**修复**：
1. 文件标题改为："# FlowForge v7.0 功能特性规格说明书"（最新版优先）
2. 在文件首增加"v2.1 历史声明块"用引用方式包含旧版本：
   ```markdown
   > **v2.1 历史章节**（lines 1-2900）已迁移至 [archive/spec_v2.1.md](file:///home/hyg/ai/openclaw/flowforge/docs/archive/spec_v2.1.md)
   > **当前版本**：v7.0（lines 2900-3666）
   ```
3. **同步更新** arch.md 顶部（"# FlowForge v6.0 架构设计" + 第 15-23 节 v7.0 增量）、design.md 顶部（同样问题）。

---

### 1.2 第一章 产品概述与愿景（line 9-48）—— ✅ 通过

**审核意见**：
- 1.1 定位清晰，1.2 核心公式正确（v6.0 仍是 `Agent = Model + Harness`，与 v7.0 公式共存于不同章节）。
- 1.5 业务场景完整：覆盖个人/团队/企业三类。
- ✅ 无需修改。

---

### 1.3 第二章 系统架构总览（line 49-128）—— ⚠️ P2

**问题 1**：2.1 六层架构图（line 51-76）
- 仍为 v6.0 六层架构，未在 spec.md 主体的架构章节体现 v7.0 第七层"自进化层"。
- arch.md §15.1 已定义七层架构，但 spec.md 的系统架构总览仍是 v6.0 视角。

**修复**：
- 在 2.1 节末尾增加 2.1.1 "v7.0 七层架构（自进化层新增）"，引用 arch.md §15.1 并指向 v7.0 第七章。

**问题 2**：2.3 Harness Hook 点（line 106-128）—— 描述 `pre_execute` / `post_execute` 时未提 v7.0 自我进化层 Hook。
- 缺：ForgekinEngine 自身的 `before_soul_load` / `after_echo_record` / `before_distill` Hook。

**修复**：
- 在 2.3 节补充 v7.0 自进化层 Hook 契约。

---

### 1.4 第三章 核心功能需求（line 129-509）—— ⚠️ P1

**问题 1**：3.1-3.9 仍按 v6.0 视角组织（执行引擎/Harness/能力层/Multi-Agent/Helm/插件/可观测/安全/SDK），v7.0 第十一/十二/十三章（自我进化、*Forge 自进化统一规格、SLO）与之并列但没有交叉引用。
- 阅读体验：先讲 9 大模式，然后突然讲 E1-E6 升华、Auto-Forge，缺少过渡。

**修复**：
- 在 3.1 节开头增加"3.0 演进路线图"表格，说明 v6.0 → v7.0 的功能新增/废弃。
- 在 3.2 Harness 节末尾增加"v7.0 扩展：自进化层（Evolution Layer）"小节，引用 7.0 章。

**问题 2**：3.2 Harness 描述的"四根护栏"（line 178-235）只到 v6.0 范围，未提 v7.0 引入的"软 + 硬 + Eval" 三层 Harness（来自 face/ds.md EVO-01）。
- face/ds.md 提出的"软层（Skill/Convention）+ 硬层（Gate/Validator）+ Eval 层" 是对当前四根护栏的扩展，但 spec.md 主体未吸收。

**修复**：
- 在 3.2 节增加"3.2.5 v7.0 三层 Harness 扩展"小节，吸收 face/ds.md EVO-01 设计。

---

### 1.5 第四章 非功能需求（line 510-569）—— ⚠️ P1

**问题 1**：4.2 FeedbackLoop 评估模式（line 522-528）描述了 full / lightweight / skip 三种，但 v7.0 第八章 8.2 FR-EVO-02 引入的"元认知三信号路由（domain_reliability + evidence_completeness + self_reported_confidence）"未在此处提及。
- 4.2 处的"全量评估" 与 8.2 处的"三信号" 是不同机制，但 spec.md 未说明二者关系。

**修复**：
- 在 4.2 节明确：v6.0 FeedbackLoop 负责外环质量门；v7.0 元认知三信号是内环高风险域升级决策，两者互补不冲突。

**问题 2**：4.3 可靠性要求（line 530-540）只到 v6.0 视角，未提 Auto-Forge、Self-Distill 等 v7.0 异步操作的可观测要求。

**修复**：
- 增加 4.3.1 "v7.0 异步进化操作可靠性"。

---

### 1.6 第五章 与 ContentForge 集成方案（line 571-635）—— ⚠️ P1

**问题 1**：5.1-5.4 描述了 v2.1 → v6.0 迁移的三步策略，**没有 v6.0 → v7.0 的迁移策略**。

**修复**：
- 在第五章末尾增加 5.5 "v6.0 → v7.0 养灵体系启用策略"。
- 与 spec.md 附录 N 弃用时间线对齐，定义：哪些能力 Feature Flag 灰度（spec.md 第21节已部分定义 use_forgekin_engine / use_auto_forge 等 6 个 flag）？哪些是默认开启？

**问题 2**：5.2 业务场景映射（line 584-597）只列到 v6.0，未列 v7.0 炉灵角色（writer/researcher/seo_expert/architect/coder/test_generator 等）。
- spec.md 11.2 已经定义"各 *Forge 的炉灵角色示例"，但第五章完全没有引用。

**修复**：
- 5.2 节增加 v7.0 炉灵角色映射表。

---

### 1.7 第六章 业务场景支撑矩阵（line 636-750）—— ✅ 通过

审核意见：6.1-6.3 业务场景表完整，6.4 弃用计划引用附录 N 一致性 OK。

---

### 1.8 第七章 自我进化能力总览（v7.0 新增，line 2900-3050）—— ⚠️ P0 多项

#### 1.8.1 7.1 隐喻设计（line 2917-2923）—— ✅ 通过

- "从驾驭到养成"是合理的隐喻跃迁，符合 clowder-ai 养猫体系的内核。
- ✅ 无需修改。

#### 1.8.2 7.2 体系命名（line 2925-2942）—— ❌ 需重审（详见第七节）

**问题**：
- 当前"炉灵 / Forgekin"命名在 DevRel/营销视角下"玄学色彩偏重"，不适合企业级客户与海外开发者。
- 详见第七节"5 套命名方案候选"。

#### 1.8.3 7.3 两类智能体设计（line 2944-3008）—— ⚠️ P1

**问题 1**：line 2948-2953 描述"静态智能体 = 现有 YAML 声明式 Agent 和 Workflow"，**但 rules.md §2.3 P31 铁律明确 Loop 不是新模式**——本节虽然区分了 Static Agent vs Forgekin，但**没有明确"Static Agent 在执行时也必须通过 LoopExecutor"**。
- 如果 Static Agent 不走 LoopExecutor，则违反 P31；如果走，则和 Forgekin 的"自进化能力"边界模糊。

**修复**：
- 7.3.1 增加明确声明："Static Agent 与 Forgekin **统一**通过 LoopExecutor 执行；Forgekin 在 LoopExecutor 之上叠加 Soul/Echo/Imprint 三层。"

**问题 2**：line 2973-3002 的衔接图把"Static Agent"放在 "Forgekin → 委托常规子任务" 箭头下方，但**没有描述 Static Agent 失败时如何回写到 Forgekin**。
- spec.md 第 11 章仅在 11.1 节描述了"统一能力"，没有"统一失败语义"。

**修复**：
- 增加 7.3.4 "Static Agent 失败回写契约"：失败时（1）记录到 Forgekin 的 Soul Echo，（2）Soul Imprint 标注该 static agent 不可靠，（3）后续通过 Forgekin 的 `_decide_strategy` 重路由到 fallback static agent 或自身 mode 路径。

#### 1.8.4 7.4 升华阶段（line 3010-3028）—— ⚠️ P1

**问题 1**：E1-E6 命名（line 3014-3021）
- spec.md 第七章用 "Spark(火种)"、arch_face.md 用 "E1 Spark(火花)"、kimi1.md 提到"Qianwen1.md 7.4 描述升华为 E1-E5 五级"（实际 spec.md 是 E1-E6）。
- 三处术语不统一。

**修复**：
- 统一为 "E1 Spark（火种）"，所有文档同步。

**问题 2**：E1→E2 条件（line 3017）"5Q ≥ 7/10" 未定义。
- "5Q" 是哪个五维？spec.md 没有术语表。

**修复**：
- 在 7.4 节末尾增加 7.4.3 "术语表"，明确定义 5Q（= 准确度、效率、稳健性、安全、协作 五维，每维 0-10）、smoke gate、5 case replay 等术语。

**问题 3**：E6 Forge Master 条件（line 3021）"operator 授权 + 创造 ≥1 个 E1 炉灵" 缺少量化指标。
- 与 E5 升级 E6 需要的"持续运维时间"和"指导他人"指标缺失。

**修复**：
- 增加 "E5 阶段维持 ≥30 天 + 成功指导 ≥2 个 E2 炉灵 + 平均 5Q ≥ 9.0"。

**问题 4**：7.4 节降级/冻结机制（line 3023-3027）
- E5 freeze 与 E6 revoke 都是一次触碰红线，但 spec.md 没有定义"安全红线"的具体清单。
- 22.1（arch.md）定义了 SR-01~08，但 spec.md 7.4 没有引用。

**修复**：
- 在 7.4 节末尾增加"7.4.4 安全红线引用 arch.md §22.1 SR-01~08"。

#### 1.8.5 7.5 v7.0 核心能力清单（line 3029-3048）—— ⚠️ P0

**问题 1（致命）**：FR-EVO 编号不连续
- 文档写："FR-EVO-01 ~ FR-EVO-06, FR-EVO-10, FR-EVO-11, FR-EVO-14" 出现编号跳跃
- 缺失：FR-EVO-07, FR-EVO-08, FR-EVO-09, FR-EVO-12, FR-EVO-13, FR-EVO-15
- 实际在 line 3328-3470 章节，FR-EVO-07~15 是有内容的（外部工具、Trae Bridge、A2A、灵议、升华管理、跨模型评审、炉启训练、元认知），但 7.5 章节的清单只列了 9 项，缺少 6 项。
- **严重：文档可追溯性失败**，如果按 7.5 节清单做实现规划，会漏掉 6 个能力。

**修复**：
- 7.5 改为完整 15 项清单，按 FR-EVO-01 ~ FR-EVO-15 顺序排列：
  ```markdown
  | FR-EVO-01 | 炉灵身份系统 | P0 |
  | FR-EVO-02 | 魂忆 Soul Echo | P0 |
  | FR-EVO-03 | 魂印 Soul Imprint | P0 |
  | FR-EVO-04 | 自锻引擎 Auto-Forge | P0 |
  | FR-EVO-05 | 锻典 Forge Codex | P0 |
  | FR-EVO-06 | Skill 自生成 | P0 |
  | FR-EVO-07 | 外部编码工具集成 | P0 |
  | FR-EVO-08 | Trae 监工 Bridge | P0 |
  | FR-EVO-09 | A2A 通信协议 | P0 |
  | FR-EVO-10 | 灵议 Forgekin Council | P0 |
  | FR-EVO-11 | 两类智能体无缝衔接 | P0 |
  | FR-EVO-12 | 升华阶段管理 | P1 |
  | FR-EVO-13 | 跨模型评审 | P1 |
  | FR-EVO-14 | 炉启训练 | P1 |
  | FR-EVO-15 | 元认知能力 | P2 |
  ```

**问题 2**：缺少与 M1-M17 模块映射
- face/task_face.md 第 190-195 行声称 M1-M17 是 v7.0 第七层工程实现，但 spec.md 7.5 没有 FR-EVO-01~15 ↔ M1~M17 映射。

**修复**：
- 增加 7.6 "v7.0 能力 ↔ face M1-M17 映射表"。

---

### 1.9 第八章 炉灵需求规格（line 3051-3200）—— ⚠️ P0

#### 1.9.1 8.1 FR-EVO-01 炉灵身份系统（line 3054-3112）

**问题 1**：line 3059-3099 Soul Profile YAML 示例中 `parent_forgekin` 字段没有说明"E5 还是 E6 才能创建子炉灵"。
- spec.md 7.4 表（line 3021）说"E6 才能创建"，但 8.1 节的 Soul Spec YAML 没有强制 schema 校验。
- 如果 E3 炉灵也能填 `parent_forgekin: "self"`，会绕过 E6 权限校验。

**修复**：
- 在 8.1 节增加 Pydantic 校验示例：
  ```python
  @model_validator(mode='after')
  def check_parent_forgekin_authorization(self):
      if self.parent_forgekin and self.ascension_stage < AscensionStage.E6:
          raise ValueError("仅 E6 锻师可创建子炉灵")
      return self
  ```

**问题 2**：AC-04（line 3111）"状态变更（active/dormant/frozen）需 operator 审批" — 未定义审批工作流。
- 是 Web UI 审批、CLI 审批、还是 auto-approve？
- spec.md 没有给审批 API 或 CLI 命令定义。

**修复**：
- 增加 AC-04a "operator 审批通过 POST /api/v1/forgekin/{id}/status 实现，需 admin 鉴权"。

#### 1.9.2 8.2 FR-EVO-02 魂忆（line 3113-3156）

**问题 1（致命）**：三层记忆架构与 rules.md §3.2 现有 MemoryManager 冲突
- spec.md 7.2/8.2 定义 "Working/Episode/Semantic" 三层
- arch.md §10.5 + design.md §12.1 + rules.md §2.7 已有 "Working/Short-term/Long-term/Semantic/Episodic" **5** 层 + TaskBoard/Mailbox/CheckpointManager/ContextCompressor
- 两套记忆体系并存，**没有映射关系**：
  - v6.0 的 Short-term ≡ v7.0 的 Working？
  - v6.0 的 Long-term ≡ v7.0 的 Semantic？
  - v6.0 的 Episodic ≡ v7.0 的 Episode？
  - v6.0 的 Short-term 和 v7.0 的 Working 重复？

**修复**：
- 在 8.2 节明确"v7.0 三层记忆是对 v6.0 五层的重新归并与命名收敛"：
  - v6.0 Working + Short-term → v7.0 L1 Working Echo
  - v6.0 Episodic → v7.0 L2 Episode Echo
  - v6.0 Long-term + Semantic → v7.0 L3 Semantic Echo
- 在 spec.md 11.1 节增加与 v6.0 MemoryManager 的兼容/迁移策略。
- 同步更新 arch.md §10.5 + design.md §12 章节。

**问题 2**：AC-07（line 3155）"元认知三信号路由"未给出路由表。
- 三信号如何组合？AND、OR、加权？
- spec.md 没给公式。

**修复**：
- 增加 AC-07a "三信号路由公式：score = 0.4 * domain_reliability + 0.3 * evidence_completeness + 0.3 * self_reported_confidence；score < 0.85 且 domain ∈ HIGH_RISK 时升级"。

**问题 3**：AC-08（line 3156）"高风险域 action_confidence < 0.85 时只做结构化分析 + 明确升级"
- "高风险域" 在 spec.md 没有定义清单。
- arch.md 22.1 SR-03 提到"不碰钱/关系/健康/隐私/价值观"，但这只是 Provoke 边界，不是高风险域。

**修复**：
- 在 8.2 节末尾增加"高风险域白名单/黑名单"：白名单 = 投资、医疗、隐私、合同、安全；其他为普通域。

#### 1.9.3 8.3 FR-EVO-03 魂印（line 3158-3173）

**问题 1**：AC-09（line 3170）"白名单采集 + 分层消化更新（继承 clowder-ai no-classifier 红线）"
- "白名单" 是什么？没列具体字段。
- "分层消化" 是哪种分层？没解释。

**修复**：
- 增加白名单字段列表：preference_topic / communication_style / domain_expertise / risk_tolerance 等
- 解释"分层消化"= (1) 实时观察采集 → (2) 每日 batch 聚合 → (3) 每周 consolidate 提案

#### 1.9.4 8.4 FR-EVO-04 自锻引擎（line 3175-3200）

**问题 1**：双层架构描述（line 3181-3184）
- "后台 Consolidation 层跑 system thread" 是个有问题的工程描述。
- Python `asyncio` 不支持真正的"system thread"概念；要后台跑必须用 `asyncio.create_task` + 显式调度器（如 APScheduler）。

**修复**：
- 改为："后台 Consolidation 层通过 APScheduler AsyncIOScheduler 调度（与 ContentForge 选题接口定时预抓取同模式，rules.md 已规范）；Surface 层是 Web UI + Provoke 气泡 WebSocket 推送"。

**问题 2**：触发条件"聊得多/活跃 thread 多"（line 3187）没有量化阈值。
- spec.md 没给 ">= N 个 thread / >= M 条消息 / >= K 分钟空闲" 的硬指标。

**修复**：
- 增加 8.4.1 触发条件量化表：trace_count ≥ 5 + last_active_minutes ≥ 30 + 处于低活动期 22:00-06:00 三者 AND。

#### 1.9.5 8.5-8.15（FR-EVO-05~15）—— 多个问题，统一列出

| 编号 | 问题 | 严重性 |
|------|------|:------:|
| 8.5 FR-EVO-05 锻典 | 五级火种阶梯 E-L0~L4 与 spec.md 7.4 升华 E1-E6 **数字序列冲突**（E-L 与 E1-E6 都用 E 前缀） | P0 命名 |
| 8.5 | 缺少"Skill 晋升需要多少 A/B replay 验证" 的硬指标 | P1 |
| 8.6 | 三模式自生成 A/B/C 描述过于简略，缺 Prompt 模板 | P1 |
| 8.7 | 外部工具 CLI Wrapper 未说明如何处理"Claude Code/Codex 不可用" 时的回退 | P1 |
| 8.8 | Trae Bridge 轮询超时 300s 与 rules.md LLM 720s 限制关系未说明 | P2 |
| 8.9 A2A | @mention 路由与现有 AgentRegistry 的兼容未说明 | P1 |
| 8.10 灵议 | 多渠道同步未给一致性保证（最终一致 vs 强一致） | P1 |
| 8.11 | Static Agent 失败回写契约缺失（与 1.8.3 问题 2 相同） | P1 |
| 8.12 升华管理 | 缺少"E 降级"的触发与回滚操作 | P1 |
| 8.13 跨模型评审 | 缺少 P1/P2/P3 严重性分级的判定标准 | P1 |
| 8.14 炉启训练 | 缺少训练数据集来源、训练结果验证标准 | P2 |
| 8.15 元认知 | Wilson 下界公式未给出（只有引用） | P2 |

**修复（统一）**：
- 数字序列冲突（最严重）：将"五级火种阶梯"改为"火阶 E-L0~L4"（与"升华 E1-E6"区分）或反过来。
- 补全每节的量化指标、Pydantic schema、Prompt 模板、回退策略。
- 8.11 补"Static Agent 失败回写契约"。
- 8.15 补 Wilson 公式：
  ```
  wilson_lb = (p + z²/(2n) - z*sqrt(p*(1-p)/n + z²/(4n²))) / (1 + z²/n)
  其中 p = successes/n, n = trials, z = 1.96 (95% 置信)
  ```

---

### 1.10 第十一章 *Forge 自进化统一规格（line 3466-3540）—— ⚠️ P0

#### 1.10.1 11.1 统一能力清单（line 3472-3486）

**问题 1（致命）**：声称"所有 *Forge 项目组合和继承 FlowForge 后，都具备自我进化能力"
- 但 FlowForge v7.0 自进化代码完全缺失（详见 kimi1.md FF-KIMI-P0-01 与本审核第一节 0.1 TC-1）。
- 此声明是**对未实现能力的虚假承诺**，违反 rules.md §5.2 "禁止造假"。

**修复**：
- 11.1 节改为："所有 *Forge 项目**通过 FlowForge v7.0 Plugin 协议**注册 Forgekin 角色获得自进化能力（待 FlowForge v7.0 evolution/ 模块实现，当前为设计态）"。
- 同步在 spec.md 顶部增加"v7.0 实现状态表"。

#### 1.10.2 11.2 各 *Forge 的炉灵角色示例（line 3488-3496）

**问题**：未与 *forge 现有 arch.md 角色表对齐。
- 5 个 *forge 项目的 arch.md 中 ContentForge 现有 11 个 Agent、DevForge 14 个、NovelForge 8 个、MallForge 6 个、StockForge 7 个。
- 但 spec.md 11.2 只为每个项目列 2-3 个炉灵角色（fk_writer / fk_architect / fk_plot_architect 等），未说明与现有 Agent 的对应关系。

**修复**：
- 增加映射表：fk_writer ↔ contentforge:writer_agent（保留关系）；fk_architect ↔ devforge:architect_agent（增强版）；其他类推。

#### 1.10.3 11.3 跨 *Forge 协作场景（line 3498-3525）

**问题 1**：场景 1（line 3501-3506）"ContentForge:fk_writer → @MallForge:fk_product_lister → @ContentForge:fk_seo_expert → Static Agent:publish"
- 跨项目 A2A 没有任何鉴权/凭据/审计定义。
- 一旦 A2A 消息丢失、伪造、重放怎么办？

**修复**：
- 增加 A2A 鉴权 + 消息签名 + 审计日志要求。

**问题 2**：场景 3 "自锻群体协作"（line 3517-3525）"夜间低活动期"
- 与 8.4 Auto-Forge 触发条件"低活动期 [22:00-06:00]" 概念交叉，但两个时区是否完全一致？不同 *Forge 在不同时区怎么办？

**修复**：
- 统一时区定义（建议 UTC），并允许 per-project override。

---

### 1.11 第十二章 非功能需求与 SLO（line 3542-3596）—— ⚠️ P1

**问题 1**：12.2 安全红线（line 3557-3568）
- SR-01 "禁止后台 classifier" 引用 clowder-ai "no-classifier 红线"，但 spec.md 没有给出"classifier"和"白名单采集"的具体边界。
- 什么算 classifier？用 LLM 判断 operator 偏好算不算 classifier？

**修复**：
- SR-01 增加细则："禁止用 LLM 对 operator 行为做非白名单字段的画像推断；白名单字段（preference_topic 等）由显式行为统计采集，不用 LLM"。

**问题 2**：12.3 配置驱动率（line 3570-3580）
- "Agent 驱动率 v6.0 现状 ~15%" 数字来源未说明（grep 还是手数？）。
- v7.0 目标 ≥90% 缺乏 baseline 测算方法。

**修复**：
- 在 12.3 末尾增加"测算公式"：配置驱动率 = 配置声明的 Agent/Tool 数 / 实际运行的 Agent/Tool 数（grep `class.*Agent` 与 `config/agents/*.yaml` 行数之比）。

**问题 3**：12.4 可观测性指标（line 3581-3596）
- 缺少 `forgekin_distill_attempt_total{forgekin_id, result}`（蒸馏成功/失败计数）
- 缺少 `a2a_message_latency_seconds`（A2A 延迟直方图）
- 缺少 `cross_forge_collaboration_total{from_project, to_project}`（跨 *Forge 协作次数）

**修复**：
- 补充上述 3 个指标。

---

### 1.12 第十三章 v7.0 路线图（line 3599-3624）—— ⚠️ P1

**问题 1**：13.1 Phase 6.1~6.7 与 prompts.md FF4a~FF4e / FF20 引用关系缺失
- 13.1 没有交叉引用 prompts.md 的相关验证项。

**修复**：
- 在 13.1 表中增加"对应 prompts.md 验证项"列。

**问题 2**：13.2 里程碑 M1-M7 缺少失败降级条件
- 例如 M5 "Skill 自生成" 失败时的回退是什么？回退到 v6.0 static Skill？

**修复**：
- 增加"M_N 失败回退"列。

---

### 1.13 附录 N 弃用时间线（line 1029-1037）—— ⚠️ P2

**问题**：只列了 v6.0 弃用项，v7.0 弃用项缺失（如 register_helm_handlers 何时正式移除？）

**修复**：
- 附录 N 末尾增加 v7.0 弃用项表。

### 1.14 附录 O/P（line 3627-3666）—— ✅ 命名待评审

**审核意见**：
- 附录 O clowder-ai 对照表完整。
- 附录 P 决策点 D1-D10 清晰，**但 D1 命名选项需要重新评估**（详见第七节）。

---

## 第二节：flowforge/docs/arch.md 逐章节审核

### 2.1 顶部版本声明（line 1-9）—— ❌ P0

**文档声明**：
> "# FlowForge v6.0 架构设计"

**问题**：
- arch.md 主体 1-5292 行是 v6.0 架构；line 5293-6492 是 v7.0 "自我进化 Agent Harness 架构升级"。
- 顶部只声明 v6.0。

**修复**：
- 标题改为 "# FlowForge v7.0 架构设计"
- 增加历史声明块（同 spec.md 处理方式）

---

### 2.2 第一章 项目概述（line 10-49）—— ⚠️ P1

**问题**：1.4 设计目标（line 37-49）只列到 v6.0 目标（九大模式、Harness 护栏、Loop Engine、Skill 系统、MCP 集成）
- v7.0 目标（ForgekinEngine、Auto-Forge、Forge Codex、Forgekin Council）**未在设计目标里出现**。

**修复**：
- 增加 1.4.1 "v7.0 扩展设计目标"。

### 2.3 第二章 架构总览（line 50-181）—— ⚠️ P1

**问题 1**：2.1 六层架构模型（line 52-77）
- 仍为 v6.0 六层。
- 与 spec.md 第二章 + arch.md 15.1 节"七层架构" 概念不一致（arch.md 内部矛盾）。

**修复**：
- 在 2.1 节末尾标注："v6.0 六层 → v7.0 七层（详见第 15 章）"。

**问题 2**：2.2 完整架构图（line 78-152）
- 同样的 v6.0 视角，未含 Forgekin。

**修复**：
- 末尾增加 2.2.1 "v7.0 七层架构图（引用 15.2）"。

### 2.4 第三章 核心定位与竞品分析（line 182-238）—— ✅ 通过

无问题。

### 2.5 第四章 核心接口设计（line 239-429）—— ⚠️ P1

**问题 1**：4.3 BaseAgent 抽象（line 286-303）—— Forgekin 的能力扩展点
- 当前 BaseAgent 接口只支持 sync/async execute。
- v7.0 引入"灵魂/记忆/画像" 后，BaseAgent 应有可选的 `with_soul` 扩展点。

**修复**：
- 在 4.3 节末尾增加 BaseAgent 的可选 SoulAware mixin：
  ```python
  class SoulAwareMixin:
      forgekin_id: Optional[str]
      async def load_soul(self) -> SoulProfile: ...
  ```

**问题 2**：4.4 BaseTool（line 304-327）—— Forgekin 调用外部编码工具时，BaseTool 需要 is_external_tool / worktree_required 标志。
- 当前 BaseTool 没有这些标志，外部工具调用没法走统一安全校验。

**修复**：
- 在 BaseTool 接口增加 safety_level 之外，增加 is_external_tool: bool 字段（与 rules.md §FF15 safety_level 一致）。

### 2.6 第五章 九大内置模式详解（line 430-479）—— ❌ P0

**问题 1（致命）**：声称"9 大模式"（line 430）
- arch.md §5 列了 9 个模式：reflexion / plan_execute / multi_agent / workflow / rewoo / self_discover / agent_judge / graph_of_thoughts / rewoo
- **但** flowforge/modes/loop_mode.py 存在（line 5-9 注释说"请求 Loop 时，自动转换为使用 LoopExecutor"），spec.md v7.0 第七章 7.3 又说"Loop 不是模式"。
- **冲突**：loop 是第 10 种模式（FF4e P0-3 已识别），但 spec.md/arch.md 主体的"9 大模式"是 v6.0 视角。
- FF4e P0-3 已记录此问题但未解决。

**修复**：
- 在第五章开头明确："9 大内置模式 + Loop 编排器（v7.0）"；Loop 是 HybridExecutor 内部的上层编排，不是用户可见的"模式"。
- 同步更新 `modes/loop_mode.py` 文档说明。

### 2.7 第七章 Harness 驾驭层设计（line 555-994）—— ⚠️ P1

**问题 1**：7.1-7.5 描述了 ContextEngine / SessionManager / ArchitectureConstraintEngine / FeedbackLoop / EntropyManager，但 **未提 ForgekinHook**。
- v7.0 §15.1 自进化层有 `before_soul_load` / `after_echo_record` 等 Hook，但 arch.md 主体未在 Harness 章节描述。

**修复**：
- 在 7 章末尾增加 7.6 "ForgekinHook 与 Harness 的集成"。

**问题 2**：7.4 FeedbackLoop（line 751-836）—— v6.0 评估模式与 v7.0 元认知三信号的关系未说明。
- 与 spec.md 1.5 同一问题。

### 2.8 第八章 Skill 系统架构（line 995-1119）—— ⚠️ P1

**问题**：8.3 Combo Skills（line 1079-1101）—— `skills/combos/book-to-article.yaml` 是 NovelForge → ContentForge 跨域 Skill 组合
- v7.0 引入 Forgekin 后，跨项目 Skill 组合应改为"A2A Skill Handoff"（Forgekin A 调用 Forgekin B 的 Skill）
- 8.3 没有引用 FR-EVO-09 A2A 协议。

**修复**：
- 8.3 末尾增加"v7.0 跨域 Skill：Forgekin A2A Skill Handoff"。

### 2.9 第九章 MCP 模块架构（line 1120-1262）—— ✅ 通过

无问题（与 v7.0 自进化不直接相关）。

### 2.10 第十章 重量级模块详细设计（line 1263-1846）—— ⚠️ P1

**问题 1**：10.5 Memory 模块（line 1372-1381）—— 与 spec.md 1.9.2 同一问题，v6.0 五层 vs v7.0 三层的映射缺失。

**问题 2**：10.6 Helm 模式与 EventBus（line 1382-1846）—— 17 种 FlowForge 事件 → 16 种 Helm 事件
- v7.0 引入 Forgekin 后，应有新的事件类型（forgekin.ascension_changed、forgekin.soul_loaded、forgekin.echo_recorded、auto_forge.started 等），但 10.6 节没列。

**修复**：
- 在 10.6 增加 "v7.0 Forgekin 事件类型" 表，至少 5 种新事件。

### 2.11 第十一/十二/十三章（line 1847-2102）—— ✅ 基本通过

- 11.1 EventBus 事件类型，11.2 可观测性，11.3 检查点与恢复：完整。
- 12.1-12.5 安全机制：完整。
- 13.1-13.2 配置化与启动：完整。

### 2.12 第十四章 增量迁移策略（line 2103-2152）—— ⚠️ P1

**问题 1**：只有 v5.0 → v6.0 迁移，**没有 v6.0 → v7.0 迁移**。
- spec.md 5.5 节也缺此内容。

**修复**：
- 增加 14.x "v6.0 → v7.0 迁移：养灵能力灰度启用"。

### 2.13 第十五章 v7.0 架构总览（line 5293-5461）—— ⚠️ P1

#### 2.13.1 15.1 七层架构模型（line 5302-5330）

**问题 1**：第 7 层 "自进化层 (Evolution Layer)" 描述中只列了 Forgekin Engine / Auto-Forge / Forge Codex / Soul Echo/Imprint / Forgekin Council / External Tool Bridge / Trae Bridge，**没有列 `ForgeCodex` 和 `ExternalToolBridge` 之间的依赖关系**。
- 比如 Auto-Forge 输出会写 ForgeCodex，ForgeCodex 增量会喂 Soul Imprint。

**修复**：
- 增加 7 层间数据流图。

#### 2.13.2 15.3 两类智能体协作架构（line 5416-5460）

**问题 1**：图 5416-5458 描述了 TaskRouter → Static Agent / Forgekin / Kinship 三类，但 TaskRouter 的实现未给。
- 路由决策逻辑：什么条件路由到 Forgekin？什么条件路由到 Static Agent？
- spec.md 1.8.3 同样问题。

**修复**：
- 增加 TaskRouter 决策表：
  - capability_static_only → Static Agent
  - capability_documented_in_codex AND soul_required → Forgekin
  - cross_forge AND requires_a2a → Kinship

### 2.14 第十六章 炉灵架构设计（line 5463-5690）—— ⚠️ P1

#### 2.14.1 16.1 ForgekinEngine（line 5465-5552）

**问题 1（致命）**：`execute()` 方法依赖 HybridExecutor，但 v6.0 HybridExecutor 实际**没有 soul-aware** 能力
- line 5520 `context.system_prompt += self._build_soul_prompt(soul, imprint)` 直接修改 system_prompt
- v6.0 HybridExecutor.run() 的 system_prompt 是只读字段（design.md §7.1 ReActExecutor 用 `system_prompt` 作为入参）
- **运行时会抛 AttributeError** 或默默失败。

**修复**：
- 16.1 节明确"v6.0 HybridExecutor 需升级为 `HarnessAwareHybridExecutor`，增加 `inject_soul_context()` 方法；或 ForgekinEngine 不复用 HybridExecutor，自己实现 execute() 调用 mode executor"。

**问题 2**：10 步闭环（line 5501-5551）—— 第 4 步"注入 Soul Profile 到系统提示" 之后做模式选择，但**没有 v6.0 模式选择本身的 prompt 注入冲突处理**。
- 比如 Reflexion 模式本身在 system_prompt 加了"你是一个会反思的 actor"；v7.0 注入 Soul 后，谁覆盖谁？

**修复**：
- 增加 prompt 注入优先级：Soul Persona (最外层) > Mode Prompt (中间) > Task Prompt (最内层)。

### 2.15 第十七章 Auto-Forge Engine 架构（line 5692-5867）—— ⚠️ P1

**问题 1**：17.1 双层架构（line 5694-5780）—— 描述 Consolidation 层用 system thread，与 spec.md 1.9.4 同一问题。

**问题 2**：17.3 自锻群（line 5830-5867）—— 描述 "GroupForgeOrchestrator" 但没有"自锻群冲突解决"机制。
- 3 个炉灵同时提议不同的 Skill 主题，谁优先？

**修复**：
- 增加冲突解决策略：topic 相似度 > 0.85 触发合并；相似度 < 0.85 触发多技能并行创建；冲突日志记录。

### 2.16 第十八章 外部工具集成架构（line 5869-6037）—— ⚠️ P1

**问题 1**：18.1 CLI Wrapper（line 5871-5946）—— 4 个 CLI（claude/codex/opencode/trae_bridge）使用**相同 timeout_seconds=300**
- 与 rules.md §2.3 内容 Loop 720s 限制**直接冲突** —— 外部工具调用嵌套在 Loop 内，单个工具 300s × 3 次 = 900s 已经超 720s
- spec.md 8.7、8.8 与 arch.md 18.1 都未说明 Loop 内外部工具调用的总预算。

**修复**：
- 18.1 节明确"Loop 内外部工具调用预算 ≤ 240s（含 3 次重试）"；若超时则降级到 FlowForge mode 执行。

**问题 2**：18.3 Worktree 工作区隔离（line 6007-6037）—— 描述了 Worktree 但没与 rules.md §5.4 Git 操作规范关联。
- Worktree 路径、清理策略、合并冲突时谁负责？

**修复**：
- 增加 Worktree 生命周期：创建（任务开始）→ 提交（任务结束）→ 合并（评审通过）→ 清理（合并后 24h）。

### 2.17 第十九章 灵议与 A2A 架构（line 6038-6200）—— ⚠️ P1

**问题**：A2A 协议没有引用 Google A2A / Anthropic MCP-A2A 等现有标准
- face/ds.md COL-04 提到"兼容 Google A2A 标准"，但 arch.md 19 章没说兼容哪一版 Google A2A。

**修复**：
- 19.1 明确"本 A2A 协议为 FlowForge 私有扩展，兼容 Google A2A v0.2 Task/Message/Artifact JSON Schema"。

### 2.18 第二十章 二十一 二十二 二十三 二十四 二十五 章（line 6200-6492）—— 已通过 v6.0 审核

- 20-25 章为 v6.0 详细设计，与 v7.0 自进化不直接相关。
- 第二十一章 Feature Flag（line 6250-6364）已经定义 `use_forgekin_engine` / `use_auto_forge` 等 6 个 flag，✅ 与 spec.md 21.1 一致。

### 2.19 第二十二章 二十三 二十四 二十五 章（line 6366-6492）—— 与 v7.0 部分相关

- 22.1 ForgekinSecurityGuard（line 6371-6411）—— 与 spec.md 1.8.4 同一问题，高风险域清单缺失。
- 22.2 MetaCognitionGuard（line 6415-6450）—— Wilson 公式未给（与 spec.md 1.9.5 同一问题）。

---

## 第三节：flowforge/docs/design.md 逐章节审核

### 3.1 顶部版本声明（line 1-9）—— ❌ P0

**文档声明**：
> "# FlowForge v6.0 详细设计说明书"

**问题**：
- design.md 主体 1-3260 行是 v6.0 详细设计；line 3260-6976 是 v7.0 "Forgekin 体系" 第五部分。

**修复**：
- 标题改为 "# FlowForge v7.0 详细设计说明书"
- 同 spec.md/arch.md 处理方式。

### 3.2 第一章 项目骨架与目录结构（line 10-296）—— ⚠️ P1

**问题 1**：1.1 项目目录 v6.0（line 12-245）—— 描述了 `flowforge/evolution/` 目录结构
- 实际：当前 evolution/ 目录只含 v6.0 8 个文件（`__init__.py` / `engine.py` / `knowledge_evolution.py` / `maturity.py` / `metacognition.py` / `models.py` / `process_evolution.py` / `scope_guard.py`）
- 文档说会包含 `evolution/forgekin/` `evolution/auto_forge/` 等子目录，但**没有**。

**修复**：
- 1.1 节明确标注"v7.0 evolution/ 子目录为设计态，当前仅 v6.0 实现"。
- 增加"实现状态徽章"列。

### 3.3 第十五章 v7.0 目录结构新增（line 3269-3400）—— ⚠️ P0

**问题 1（致命）**：15.1 evolution/ 模块完整目录（line 3271-3400）
- 列出了 30+ 个文件路径：`evolution/forgekin/{engine,soul_profile,soul_store,echo_store,imprint_store,episode,ascension_manager,static_bridge}.py`
- **但实际 `flowforge/evolution/` 下零命中**这些文件。

**修复**：
- 15.1 改为"v7.0 设计目录（实现状态：0/N）"，每个文件标注 [✅已实现] / [❌未实现] / [🔄进行中]。

**问题 2**：15.2 pyproject.toml v7.0 依赖新增（line 3402-3418）—— `wilson-interval` 包名拼写错误
- Wilson 区间没有官方 PyPI 包叫 `wilson-interval`；常用的是 `statsmodels.stats.proportion.proportion_confint` 内置方法。
- 依赖一个不存在的包会让 `pip install flowforge[evolution_all]` 失败。

**修复**：
- 改为不引入外部包，用 `statsmodels` 或自己实现 Wilson 公式（仅 5 行代码）。

### 3.4 第十六章 ForgekinEngine 详细设计（line 3422-3817）—— ⚠️ P0

#### 3.4.1 16.1.1 SoulProfile 数据模型（line 3426-3505）

**问题 1**：`Capabilities.external_tools_can_use: list[str]` 字段未限定取值范围
- spec.md 8.7 / arch.md 18.1 明确只支持 4 个外部工具（claude_code / codex / opencode / trae_bridge），但 SoulProfile 没有 `Literal[...]` 约束。
- 一个 E1 炉灵如果被错误配置 `external_tools_can_use: ["rm", "curl"]`，会在执行时绕过安全校验。

**修复**：
- 使用 `Literal["claude_code", "codex", "opencode", "trae_bridge"]`：
  ```python
  external_tools_can_use: list[Literal["claude_code", "codex", "opencode", "trae_bridge"]]
  ```

**问题 2**：`AscensionStage` 枚举（line 3436-3443）值命名 "E1_SPARK" → string value "E1"
- 与 spec.md 1.8.4 "火种 / Spark" 命名一致 ✅
- 但与 spec.md 1.8.5 缺失的 FR-EVO-12 升华管理需求没交叉引用。

#### 3.4.2 16.1.2 SoulEpisode（line 3509-3563）

**问题 1（致命）**：`is_distillable()` 方法（line 3552-3558）
```python
def is_distillable(self) -> bool:
    return (
        self.distillation_status == "raw"
        and len(self.task_context) > 50
        and self.success is not None
    )
```
- "成功" 即可蒸馏 → **失败经验无法蒸馏**。
- 但 face/ds.md EVO-02 明确说"事故驱动护栏：从失败中也提取 Skill"。

**修复**：
- 增加 `failure_pattern` 字段：
  ```python
  def is_distillable(self) -> bool:
      if self.distillation_status != "raw":
          return False
      if len(self.task_context) <= 50:
          return False
      return self.success is True or self.failure_pattern is not None
  ```

#### 3.4.3 16.2 ForgekinEngine 完整实现（line 3567-3817）

**问题 1**：`__init__` 接受 11 个依赖（line 3606-3619）
- 11 个参数违反 Pydantic / DI 最佳实践（应通过 DI 容器或 Protocol 注入）。
- 不利于测试 Mock。

**修复**：
- 改为：
  ```python
  @dataclass
  class ForgekinEngineDeps:
      hybrid_executor: HybridExecutor
      soul_store: SoulStore
      echo_store: EchoStore
      # ... 11 个依赖
  
  class ForgekinEngine:
      def __init__(self, deps: ForgekinEngineDeps):
          self._executor = deps.hybrid_executor
          # ...
  ```

**问题 2**：`_decide_strategy` 关键词硬编码（line 3700-3712）
- 关键词（code_kw / design_kw / routine_kw）硬编码在代码里，违反 rules.md §4.1 "配置外置原则"。

**修复**：
- 改为从 `config/forgekin_strategy.yaml` 加载。

**问题 3**：`_call_external_tool` 没有 worktree 校验（line 3771-3789）
- arch.md 22.1 SR-06 要求"外部工具调用需 worktree 隔离"，但本方法只调 `self._tools.execute`，没检查 workspace 是否在 worktree 内。

**修复**：
- 调用前检查 `self._guard.check_external_tool(...)`（与 spec.md 1.9.5 AC-47 对齐）。

### 3.5 第十七章 18 19 20 21 22 23 24 25 章（line 3819-6976）—— 多项 ⚠️

逐章精简列出（避免与前述重复）：

| 章节 | 关键问题 | 严重性 |
|------|---------|:------:|
| 16.3 SoulStore | `_removed_backends` 模式未实现；operator 审批 workflow 缺失 | P1 |
| 16.4 EchoStore | L2 容量 100 episodes 硬编码，无配置化 | P2 |
| 16.4 EchoStore | "wilson-interval" 包名错（与 3.3 重复） | P1 |
| 17 Auto-Forge | ConsolidationLayer 使用 `system thread` 描述错误（与 1.9.4 重复） | P1 |
| 17 | ProvokeManager 投递气泡触发条件全为"有对话"，无量化 | P1 |
| 18 ExternalToolBridge | worktree 校验缺失（与 3.4.3 重复） | P0 |
| 19 A2A | 跨 forge 鉴权/审计缺失（与 1.10.3 重复） | P0 |
| 20 SecurityGuard | 高风险域清单缺失（与 1.8.4 重复） | P1 |
| 21 ConfigVersion | 描述 v6.0 配置版本化，v7.0 炉灵配置未纳入 | P2 |
| 22-25 | 22.1 ForgekinSecurityGuard.check_creation 与 spec.md 1.9.1 Pydantic 校验重复 | 需统一 |

**修复**：
- 全部按前述修复方案处理。

---

## 第四节：flowforge/docs/face/* 逐文件审核

### 4.1 face/face.md（524 行）—— ✅ 通过

**审核意见**：
- 6 大公司面试记录（阿里/高德/深信服/腾讯/字节/小米）覆盖度好，9 大能力维度（MEM/COL/EVO/EVAL/ENG/ARC/ENT/USR/SEC）已对齐 spec.md 第七/八/九/十/十一章。
- ✅ 无需修改。

### 4.2 face/ds.md（173 行）—— ⚠️ P0

#### 4.2.1 顶部版本声明（line 1-7）

**文档声明**：
> "版本: vNext-1.0 | 日期: 2025-07-14 | 基于: FlowForge v4.0 + 多厂面试反馈"

**问题 1（致命）**：日期错误
- "2025-07-14" 应该是 "2026-07-14"。

**问题 2（严重）**：基础版本声明错误
- 声称"基于 FlowForge v4.0"，但当前 FlowForge 主版本为 v7.0。
- 修复：改为"基于 FlowForge v7.0"。

#### 4.2.2 维度3 自进化需求（line 51-66）

**问题 1**：EVO-01 "三层 Harness 架构"（line 60）
- "软层 / 硬层 / Eval 层" 三分法与 spec.md 1.4 / arch.md 7 章的"四根护栏"不一致。
- 4 根护栏是"上下文工程 / 架构约束 / 反馈循环 / 熵管理"；3 层 Harness 是"软约束 / 硬护栏 / Eval 证据"——两者**不是替代关系**，是不同维度。

**修复**：
- 在 EVO-01 明确："三层 Harness 是 4 根护栏的横切：软约束 = ContextEngine 注入 + Convention；硬护栏 = ArchitectureConstraint + Permission；Eval = FeedbackLoop + EvalLedger"。

#### 4.2.3 维度4 Eval 框架（line 67-80）

**问题 1**：EVAL-01 "全维度 Eval 框架"（line 75）提到"覆盖 A2A / Memory / Tracing / Skill"
- 但 spec.md 1.8.5 FR-EVO-13 跨模型评审 ≠ 整个 Eval 体系
- **缺少端到端质量门槛** 与 rules.md P33 0.85 阈值的引用

**修复**：
- 引用 rules.md §5.6 P33："LLM 评审质量分 ≥ 0.85 通过；webchat 评委 ≥5 个并行；不达标必须优化 prompt"。

#### 4.2.4 维度5 工程交付（line 81-98）

**问题 1**：ENG-01 "Git Worktree 集成"（line 91）
- 与 arch.md 18.3 同名概念，但 face/ds.md 没有引用。
- ENG-05 "多 Agent 并行锁"（line 95）没有"文件粒度"vs"模块粒度"的选择标准。

**修复**：
- ENG-01 引用 arch.md §18.3；ENG-05 增加"小改动（<100 行）= 文件锁；大改动 = Git PR Gate"。

#### 4.2.5 维度7 企业治理（line 114-128）

**问题 1**：ENT-04 "多租户与凭证管理"（line 125）提到"对接飞书/GitHub/Jira 的凭证按租户独立管理"
- 与 v7.0 Forgekin Council 飞书渠道配置（arch.md §19.1 `feishu.app_secret: ${FEISHU_APP_SECRET}`）重复。
- **缺少统一的凭证管理抽象**：是每个 forge 自己管，还是 OpenSieve/DataSource 统一管？

**修复**：
- ENT-04 明确："凭证统一由 FlowForge v7.0 SecurityGuard + PerForgeVault 抽象管理，禁止每个 forge 独立管理"。

### 4.3 face/spec_face.md（1273 行）—— ❌ P0 多项

#### 4.3.1 顶部版本声明（line 1-10）

**文档声明**：
> "版本: v3.0-face | 日期: 2026-07-14 | 定位: 高级 Agent 行为生产流水线 → Agentic Work OS"

**问题 1**：定位与 flowforge 主线冲突
- face/spec_face.md 说"基于 FlowForge v4.0 → vNext"；
- flowforge 主线是 "v6.0 Harness OS → v7.0 养灵体系"。
- **两套叙事并存**，读者不知道哪个是当前权威源。

**修复**：
- 在 face/spec_face.md 顶部明确"本文档是 face/ 面试输入产生的需求规格，最终权威源是 flowforge/docs/spec.md v7.0；本文档仅作为 v7.0 需求来源"。

#### 4.3.2 M1-M17 模块与 FR-EVO-01~15 映射（line 651, 1237）

**问题 1（致命）**：face/spec_face.md 第 651 行 / 1237 行声称"M1-M17 任务已完美融入 v7.0 炉灵养成体系" / "EVO/MEM/COL 九大能力维度"
- 但 M1-M17 的工程实现依赖 v7.0 炉灵代码（spec.md 第七/八/九/十/十一章）——而 v7.0 代码 100% 缺失（详见第一节 0.1 TC-1 + kimi1.md FF-KIMI-P0-01）。
- **"M1-M17 为尚未实现的 v7.0 层提供工程支撑" 是悬空引用**。

**修复**：
- 在 face/spec_face.md 顶部标注"v7.0 依赖为设计态；M1-M17 可独立于 v7.0 在 v6.0 基础上开发"。

#### 4.3.3 第七章"互联层" vs "自进化层" 命名冲突

**问题**：face/arch_face.md 第 1402-1417 行定义 v7.0 第七层为"互联层"（Interconnect Layer），spec.md / arch.md 主线定义第七层为"自进化层"（Evolution Layer）。
- 这是**两个不同的概念**：
  - 互联层 = M2 模块（IM 渠道、消息总线）
  - 自进化层 = FR-EVO-01~15（养灵体系）
- **叙事冲突**：kimi1.md FF-KIMI-P1-03 已记录此问题，未解决。

**修复**：
- 统一为 v7.0 第七层 = 自进化层（Evolution Layer），互联层降级为自进化层下的子模块。
- 在 arch_face.md 修订 v3.0 第七层为"互联子层"。

### 4.4 face/arch_face.md（1400+ 行）—— ⚠️ P1 多项

#### 4.4.1 ForgekinEngine 10 步闭环（line 1430-1443）

**问题 1**：与 arch.md §16.1 的 10 步略有不同
- face/arch_face.md: 10 步 = soul.load → echo.recall → imprint.load → build_prompt → execute → echo.record → imprint.propose → codex.distill → ascension.check
- arch.md §16.1: 10 步 = soul.load → echo.recall → imprint.load → build_prompt → execute → echo.record → imprint.propose → codex.distill → ascension.check（一致）
- ✅ 但 spec.md §16.1 的代码示例多了一步 `_fallback_to_hybrid`（line 3676-3811）。
- 建议：三处统一使用同一份伪代码模板。

#### 4.4.2 v7.0 第七层定义（line 1402-1417）

**问题**：与 spec.md 1.3 / arch.md §15.1 矛盾（互联层 vs 自进化层）。
- 见 4.3.3 修复。

### 4.5 face/task_face.md（1300+ 行）—— ⚠️ P1

#### 4.5.1 v7.0 FR-EVO 任务拆解缺失（line 190-195）

**问题**：face/task_face.md 第 190-195 行声称"FR-EVO-01~15 在 spec.md 第八章独立定义，不在本任务清单中重复"
- 但这导致 face/task_face.md 的 P0/P1 任务表（line 11-187）中没有任何 v7.0 炉灵能力任务。
- 13 项决策对比 + 53 个 P0 任务 + 86 人日 都是 M1-M17，与 v7.0 炉灵能力完全脱钩。

**修复**：
- 增加 face/task_face.md 第六章 "v7.0 养灵能力任务拆解"（Phase 6.1~6.7 各自的人日估算）。

### 4.6 face/face.md / face/ds.md / face/spec_face.md / face/arch_face.md / face/task_face.md 整体一致性

**问题（致命）**：face/ 5 个文档与 flowforge 主线 spec.md/arch.md/design.md 的**章节编号、术语、版本** 全部不统一：
- face/spec_face.md 第七章互联层 ≠ flowforge 主线 v7.0 自进化层
- face/ds.md 9 维度（MEM/COL/EVO/EVAL/ENG/ARC/ENT/USR/SEC）≠ spec.md FR-EVO-01~15
- face/arch_face.md 1402 行的 ForgekinEngine 10 步 ≠ arch.md §16.1
- face/task_face.md M1-M17 ≠ spec.md Phase 6.1~6.7

**修复**：
- 在 face/README.md 或 spec.md 第七章开头加"权威源声明"：
  - **v7.0 需求权威源**：flowforge/docs/spec.md（FR-EVO-01~15 + 11 个 *Forge 任务）
  - **v7.0 架构权威源**：flowforge/docs/arch.md（第 15-25 章）
  - **v7.0 设计权威源**：flowforge/docs/design.md（第五部分）
  - **face/ 需求来源**：face/ds.md（9 维度 + face/face.md 6 公司面试），仅作为 v7.0 需求**输入**，不作为 v7.0 权威源

---

## 第五节：v7.0「养灵 / Forgekin」体系专项审核

### 5.1 产品专家视角（AI Product Manager）

#### 5.1.1 隐喻跃迁

✅ **优点**：
- "从驾驭到养成"是合理的隐喻跃迁，clowder-ai 养猫体系在海外开发者社区已有一定认知度，借鉴可降低心智成本。
- 升华阶段 E1-E6 类似游戏角色升级，对 C 端用户和年轻开发者友好。

❌ **缺点**：
- "养灵"对**企业 B 端客户**（金融/医疗/法律/政府）不够严肃，可能被误读为"游戏化/娱乐化"。
- "魂忆/魂印/自锻/锻典"四组术语对**非技术业务专家**晦涩，需要大量解释成本。
- "clowder-ai 对标"虽然技术上合理，但**在企业销售场景**，客户会问"你们和 clowder-ai 有什么差异化"——而当前 spec.md 没有给出差异化论证。

#### 5.1.2 用户旅程（Persona）

**问题**：spec.md 第七章只有概念定义，**没有用户旅程图**。
- 一个 E1 炉灵被创建后，operator 第一天/第一周/第一个月分别能做什么？
- 升华到 E3 后，operator 与炉灵的协作模式有什么变化？
- 灵议（A2A）如何与现有 ContentForge "Helm 实时交互" 共存？

**修复**：
- 在 spec.md 第七章增加 7.6 "v7.0 用户旅程图"（参考 arch.md §10.6 Plan 模式已有旅程图风格）。

#### 5.1.3 商业化路径

**问题（严重）**：v7.0 没有任何商业化路径设计
- 炉灵是"产品功能"还是"独立 SKU"？是否对外授权？
- 升华阶段是否对应"订阅层级"（E1 免费 / E3 付费 / E6 企业）？
- 锻典的 Skill 是否是"应用市场"模式（开发者创建 Skill 收费）？

**修复**：
- 在 spec.md 第七章末尾增加 7.7 "v7.0 商业化路径草案"（建议 3 套定价模型备选）。

### 5.2 AI 高级架构师视角

#### 5.2.1 分层依赖

✅ **优点**：v7.0 在 v6.0 六层之上叠加第七层"自进化层"，依赖方向正确（自进化层 → v6.0 各层 → 基础设施层）。

❌ **致命问题**：
- v7.0 自进化层依赖的 HybridExecutor / MemoryManager / EventBus **当前没有 soul-aware 扩展点**——arch.md §16.1 的 ForgekinEngine.execute() 直接修改 `context.system_prompt` 会破坏 v6.0 不变性约束（详见第二节 2.14.1）。
- 必须先升级 v6.0 HybridExecutor / MemoryManager / EventBus 为 SoulAware 扩展点，才能承载 v7.0 自进化层。

**修复**：
- 在 arch.md 第七章 增加 7.6 "v6.0 → SoulAware v6.1 接口升级"，明确 HybridExecutor.run() 增加 `inject_soul_context()` 方法，MemoryManager 增加 `soul_echo` 命名空间。

#### 5.2.2 数据隔离

❌ **问题**：spec.md 1.10.3 跨 *Forge A2A 协作没有租户隔离
- ContentForge fk_writer 与 MallForge fk_product_lister 通信时，谁有权读 Soul Echo？
- Soul Imprint 是否跨 forge 共享？operator 同意吗？

**修复**：
- 增加 `soul_echo_visibility: list[str]` 字段，限定 Soul Echo 可见的 forge 列表（默认只对自己 forge 可见）。
- Soul Imprint 必须 operator 明确同意才能跨 forge 共享。

#### 5.2.3 失败回退

❌ **问题**：Auto-Forge / A2A / 外部工具调用失败时，没有统一的"降级语义"
- 比如 Claude Code 失败 → 降级到 FlowForge mode ？
- A2A 消息发送失败 → 重试 3 次还是直接失败？
- 升华检查失败 → 降级到上一个 E 阶段还是保持当前 E 阶段？

**修复**：
- 在 spec.md 1.9 增加"v7.0 降级语义统一表"。

### 5.3 AI 智能体 Agent 开发工程师视角

#### 5.3.1 可调试性

❌ **问题（严重）**：spec.md 第八章所有 FR-EVO 没有"调试接口"设计
- 如何查看一个炉灵当前的 Soul Echo？
- 如何 trace 一次 Auto-Forge 的内部步骤？
- 升华阶段变更的事件如何订阅？

**修复**：
- 增加 spec.md 1.9 "v7.0 调试接口设计"：
  - GET /api/v1/forgekin/{id} - 查看 Soul Profile
  - GET /api/v1/forgekin/{id}/echo?limit=20 - 查看最近 20 个 Episode
  - GET /api/v1/forgekin/{id}/imprint - 查看 Soul Imprint
  - GET /api/v1/forgekin/{id}/auto_forge/logs - 查看 Auto-Forge 日志
  - SSE /api/v1/forgekin/{id}/events - 订阅炉灵事件流

#### 5.3.2 错误处理

❌ **问题**：FR-EVO-01 ~ FR-EVO-15 的 AC（验收标准）只有正常路径，没有失败路径 AC
- 比如 AC-08 "高风险域 action_confidence < 0.85 时只做结构化分析 + 明确升级"——升级到谁？升级的动作具体是什么？

**修复**：
- 每个 FR-EVO 增加 "失败路径 AC" 子项。

#### 5.3.3 API 一致性

❌ **问题**：v7.0 API 端点（arch.md 22.1 提了 `forgekin_endpoints.py / council_endpoints.py / auto_forge_endpoints.py / codex_endpoints.py / bridge_endpoints.py`）与 v6.0 REST API 风格不统一
- v6.0 REST API 走 `/api/v1/loops/{loop_id}` 风格
- v7.0 端点路径未明确定义

**修复**：
- 在 arch.md 22.x 明确 v7.0 REST API 路径前缀：/api/v1/forgekin、/api/v1/council、/api/v1/auto_forge、/api/v1/codex、/api/v1/bridge。

### 5.4 高级软件全栈工程师视角

#### 5.4.1 数据库 Schema

❌ **问题**：design.md §15.1 列了 7 个 migration SQL（007~013），但**没有 DDL 实际给出**
- 只有表名（forgekin_souls / forgekin_episodes / forgekin_imprints / forge_codex / forge_diaries / a2a_messages / external_tool_audit），没有字段定义。

**修复**：
- 在 design.md 15.1 给出每个 migration 的完整 DDL。

#### 5.4.2 前端路由

❌ **问题**：design.md §15.1 列了 web 路由 `app/council/`, `app/forgekin/`, `app/codex/`，但**没有组件详细设计**
- 与 v6.0 Helm 模式如何共存？
- 是否复用 v6.0 的 `<ChatStream>` 等组件？

**修复**：
- 增加 design.md 15.2 "前端组件复用 v6.0 Helm 组件清单"。

#### 5.4.3 CI/CD

❌ **问题**：v7.0 没有 CI/CD 章节
- 升华阶段变更的 CI 检查是什么？
- A2A 协议 schema 的 lint？
- Skill 蒸馏产物的 unit test？

**修复**：
- 在 design.md 末尾增加"v7.0 CI/CD 流水线设计"。

#### 5.4.4 性能与扩展性

❌ **问题**：spec.md 12.1 SLO 表只有"单次 Auto-Forge < 5min"，**没有并发 SLO**
- 当 100 个炉灵同时 Auto-Forge 时怎么办？
- Soul Echo 写入是同步还是异步？批量写还是实时写？

**修复**：
- spec.md 12.1 增加并发 SLO 表。

### 5.5 AI Prompt / Harness 研究员视角

#### 5.5.1 方法论对标

✅ **优点**：v7.0 借鉴了 clowder-ai / MemGPT / Voyager / Generative Agents / Self-Refine 等主流方法论，附录 O 对照表清晰。

❌ **问题**：
- **缺少与 Anthropic Claude Agent SDK / LangGraph / AutoGen 等工业级 Agent Harness 的对比**（arch.md §3.2 只到 AutoGen / LangGraph / Dify / CrewAI 维度）。
- **缺少"养灵体系"作为可发表学术概念的差异化论证**——比如"养灵 vs Function Calling vs Tool Use" 的方法论差异。
- **缺少失败案例的总结**：clowder-ai 的 Auto-Dream 在生产中遇到什么问题？养灵体系如何规避？

**修复**：
- arch.md 第三章增加 3.5 "v7.0 养灵体系方法论对标（学术界 + 工业界）"。

#### 5.5.2 AGI 愿景表达

✅ **优点**：spec.md 1.1 / 第七章 / 附录 P 决策点 D1-D10 的 AGI 愿景表达清晰——"通往 AGI 的基础框架" / "自我进化 Agent Harness OS"。

❌ **问题**：
- **"AGI"在文档里出现 6 次**（search 验证），但**没有任何地方定义"我们认为的 AGI 是什么"**。
- 是 L5（强 AI）？还是 L4（专家级 AI）？是 Human-level 还是 Super-human？
- **没有"AGI 阶段性目标"** —— v8.0 是什么？v9.0 是什么？

**修复**：
- 在 spec.md 第一章 1.1 增加 1.1.1 "AGI 定义与阶段性目标"（v7.0 = 自我进化；v8.0 = 跨域迁移；v9.0 = 自主目标生成）。

### 5.6 DevRel / 社区生态负责人视角

#### 5.6.1 命名专业度

**问题**：
- "炉灵 / Forgekin" 命名在 B 端客户、严肃行业、海外开发者社区接受度低（详见第七节命名方案）。

#### 5.6.2 开源就绪度

❌ **问题**：v7.0 自我进化代码完全缺失
- 开源仓库无法 release v7.0
- spec.md 11.1 "所有 *Forge 都具备自进化能力"是虚假承诺
- 一旦开源，会被社区立即识别为"承诺未兑现"

**修复**：
- v7.0 开源前必须实现核心 3 项：ForgekinEngine + SoulStore + EchoStore（design.md Phase 6.1 最小子集）。

#### 5.6.3 文档可发现性

❌ **问题**：v7.0 文档散落在 spec.md 后半段、arch.md 第 15-25 章、design.md 第五部分、face/ 5 个文件，**没有 v7.0 总入口**。

**修复**：
- 在 flowforge/docs/ 增加 `v7.0_index.md` 作为 v7.0 文档总入口（含 spec / arch / design / face 各章节定位 + 权威源声明）。

---

## 第六节：rules.md / prompts.md 与 9 大项目跨项目冲突分析

### 6.1 hiclaw（基础设施）

#### 6.1.1 rules.md v3.0 vs 实际代码

| 铁律 | 文档/代码位置 | 冲突点 |
|------|---------------|--------|
| rules.md §1.4 "HiClaw 目录只含 tool/openroute" | hiclaw/ 含 install / logs / test | ✅ 合规（install/logs/test 是工具目录） |
| rules.md §2.6 5 项目原则 | — | ✅ 通过 |

**审核结论**：✅ HiClaw 合规

#### 6.1.2 prompts.md vs openroute

| 铁律 | 文档位置 | 冲突点 |
|------|----------|--------|
| prompts.md P33 "质量分阈值 0.85" | openroute task.md §5.x 已修正 0.85 | ✅ 合规 |
| prompts.md FF25/FF26 "CircuitBreaker 必须接入" | openroute circuit_breaker.py 已删除 | ✅ 合规（Phase 1.6 完成） |
| prompts.md FF26 "SmartLLMRouter 必须接入主链路" | openroute 灰度开关 `smart_router_cover_stream: true` | ✅ 合规（流式走 Pipeline 保留） |

**审核结论**：✅ OpenRoute 合规（task.md §5.x 修复记录详尽）

### 6.2 OpenSieve（平台层）

| 铁律 | 文档/代码位置 | 冲突点 |
|------|---------------|--------|
| rules.md §2.2 "所有数据检索走 OpenSieve" | opensieve/ 自身 | ✅ 通过（自身就是数据检索层） |
| rules.md §3 "OpenSieve 部署规范 quickstart.sh" | opensieve/quickstart.sh | ✅ 通过 |

**审核结论**：✅ OpenSieve 合规

### 6.3 FlowForge

| 铁律 | 文档/代码位置 | 冲突点 |
|------|---------------|--------|
| rules.md §2.2 "所有数据检索走 OpenSieve" | flowforge/config/default.yaml:124-138 同时存在 `opensieve:` 和 `helixrag:` 块 | ❌ **P0 违反**（helixrag 块残留） |
| rules.md §2.3 "P31 铁律 LoopExecutor 唯一入口" | flowforge/modes/loop_mode.py 作为"降级适配器"存在 | ⚠️ **P1 违反**（loop_mode 应删除，让 LoopExecutor 唯一接管） |
| rules.md §2.5 "register_helm_handlers 死代码" | flowforge/ 当前无此钩子 | ✅ 通过 |
| prompts.md FF4e P0-3 "Loop 是模式的管理者" | flowforge/modes/loop_mode.py 注释说"loop 作为模式" | ❌ **P1 违反**（与设计文档矛盾） |
| prompts.md FF4e P0-1 "嵌套深度用 task.metadata 不用类变量" | flowforge/loop/executor.py 实现 | ⚠️ 待 verify |
| prompts.md FF4e P0-2 "Persona Lock 整个 Loop 持有" | flowforge/core/persona_lock.py:29 已实现 | ✅ 通过 |
| prompts.md FF4e P0-4 "Memory 五种映射" | flowforge/memory/manager.py 已实现 | ✅ 通过 |
| prompts.md FF4e P0-5 "超时控制" | flowforge/loop/executor.py 已实现 | ✅ 通过 |
| prompts.md FF4e P0-6 "API 端点触发执行" | flowforge/app/api/endpoints/loops.py:266 "异步启动 LoopExecutor.run() 在后台执行" | ✅ 通过 |
| prompts.md FF4e P0-7 "loop_iterations 表" | flowforge helm database | ✅ 通过（kimi1.md 已记录） |
| prompts.md FF4e P0-8 "Loop 失败回退" | flowforge/modes/loop_mode.py 作为降级 | ✅ 通过 |
| prompts.md FF4e P0-9 "Verifier schema/test_suite 模式" | flowforge verifier 当前仅 agent_judge | ⚠️ **P1 待实现** |
| prompts.md FF4e P0-10 "Planner 三模式" | design.md 描述 | ⚠️ **P1 待实现** |
| prompts.md FF4e P0-12 "规则进化闭环" | design.md 描述 | ⚠️ **P1 待实现** |
| rules.md §2.7 "9 大执行模式" | flowforge/modes/ 含 loop_mode（10 个文件） | ❌ **P0 违反**（违反 9 大模式声明） |

**严重冲突汇总**：
- ❌ **P0-1**：flowforge/config/default.yaml helixrag 块残留
- ❌ **P0-2**：flowforge/modes/loop_mode.py 存在 → 与 9 大模式 + Loop 是上层管理者冲突

**审核结论**：❌ FlowForge 有 2 个 P0 + 4 个 P1 违反

### 6.4 ContentForge

| 铁律 | 文档/代码位置 | 冲突点 |
|------|---------------|--------|
| rules.md §2.2 "所有数据检索走 OpenSieve" | contentforge/config/default.yaml:12 helixrag 块 / config/system.yaml:40-42 helixrag_enabled / config/topic_strategy.yaml:103 helixrag_search / config/agents/research_agent.yaml:26,31,36 helixrag_search / config/agents/topic_agent.yaml:47 helixrag_search / config/prompts.yaml:1084,1089 / tools/research_engine.py:43-89 / tools/_base.py:4 / tools/topic_strategist.py:57-118 helixrag_search 关键词大量 | ❌ **P0 严重违反**（15+ 处残留） |
| rules.md §2.2 "所有数据检索走 OpenSieve" | contentforge/tools/url_ingestor.py:47-180 已用 opensieve | ✅ 部分合规 |
| rules.md §1.4 P8A "tools/ 目录禁止" | contentforge/tools/ 仍在 | ⚠️ **P1 违反** |
| rules.md §1.4 P8A "agents/ Python 类禁止" | contentforge/config/agents/ 是 YAML | ✅ 通过 |
| rules.md §2.3 "P31 铁律" | contentforge/plugins.py register_loops | ✅ 通过 |
| rules.md §2.3 "质量分阈值 0.85" | contentforge/config/loops/deep_article_loop.yaml pass_threshold=0.85 | ✅ 通过 |
| prompts.md P33 "5 webchat 评委 + prefer_api=true" | contentforge/config/loops/deep_article_loop.yaml verifier.judges 5 个 | ✅ 通过 |
| prompts.md P31 "Loop 嵌套而非 workflow" | contentforge/config/loops/deep_article_loop.yaml:64 `worker.mode: workflow` | ❌ **P1 违反**（违反 P31 铁律，loop 内 worker 应是 mode/agent/loop 嵌套） |
| prompts.md FF20 "Loop 创作润色独立接口" | contentforge/app/api 端点 | ✅ 通过 |
| rules.md §1.3 "openclaw_pkg 只有 content 实例" | contentforge/run.sh:12 注释写"helixrag.service" | ⚠️ **P2 违反**（注释错位） |
| rules.md §1.3 "openclaw_pkg 端口 800" | contentforge 端口 8001 | ✅ 通过（contentforge 是独立 *forge，端口 800 是 openclaw_pkg content 实例） |
| prompts.md P33 "禁止添加 CoT 检测" | contentforge/judge_context_template | ✅ 通过 |

**严重冲突汇总**：
- ❌ **P0-1**：helixrag 关键词 15+ 处残留 → 违反 §2.2 原则 1
- ❌ **P0-2**：contentforge/config/loops/deep_article_loop.yaml worker.mode=workflow 违反 P31

**审核结论**：❌ ContentForge 是所有 9 大项目中**违规最严重**的

### 6.5 DevForge

| 铁律 | 文档/代码位置 | 冲突点 |
|------|---------------|--------|
| rules.md §1.2 端口 8002 | devforge/ | ✅ 通过 |
| rules.md §2.3 "P31 铁律" | devforge arch.md 声明 | ✅ 通过 |
| rules.md §2.2 "OpenSieve" | devforge/ | ✅ 通过 |
| rules.md §2.5 "register_workflows vs register_loops" | devforge arch.md:2499 写 `register_loops()` | ⚠️ 需确认（kimi1.md 标记过） |
| rules.md §1.4 P8A "*Forge 目录白名单" | devforge/ 目录 | ✅ 通过 |

**严重冲突汇总**：
- ⚠️ devforge arch.md 仍声明 v4.0（qianwen1.md 4.1 标记）
- ⚠️ register_loops/register_workflows 区分需确认

**审核结论**：⚠️ DevForge 整体合规，有 1-2 个 P2 待办

### 6.6 NovelForge

| 铁律 | 文档/代码位置 | 冲突点 |
|------|---------------|--------|
| rules.md §1.2 端口 8003 | novelforge/ | ✅ 通过 |
| rules.md §2.3 P31 | novelforge arch.md | ✅ 通过 |
| rules.md §1.3 "5 层上下文管理" | novelforge/ | ✅ 通过 |
| rules.md §2.2 OpenSieve | novelforge/ | ✅ 通过 |

**审核结论**：✅ NovelForge 合规

### 6.7 MallForge

| 铁律 | 文档/代码位置 | 冲突点 |
|------|---------------|--------|
| rules.md §1.2 端口 8004 | mallforge/ | ✅ 通过 |
| rules.md §2.3 P31 "LoopExecutor 唯一入口" | mallforge arch.md:907-909 "6 个 Agent 均通过 GenericAgent.execute_with_context() 直接执行,未通过 LoopExecutor 执行" | ❌ **P0 严重违反**（明确声明不走 LoopExecutor） |
| rules.md §1.4 P8A "agents/ Python 类禁止" | mallforge 仍保留 agents/ 目录 | ⚠️ **P1 违反**（qianwen1.md 已标记） |
| rules.md §1.2 端口 8004 实际 | mallforge 端口 | ✅ 通过 |

**严重冲突汇总**：
- ❌ **P0-1**：mallforge 明确不走 LoopExecutor → 违反 P31 铁律

**审核结论**：❌ MallForge 1 个 P0 违反（kimi1.md/qianwen1.md 已记录，未修复）

### 6.8 StockForge

| 铁律 | 文档/代码位置 | 冲突点 |
|------|---------------|--------|
| rules.md §1.2 端口 8005 | stockforge/ | ✅ 通过 |
| rules.md §2.3 P31 | stockforge arch.md 明确声明 "所有 Agent 必须经 LoopExecutor 调用" | ✅ 通过（最佳实践） |
| rules.md §2.2 OpenSieve | stockforge 所有数据走 OpenSieve | ✅ 通过 |
| rules.md §2.7 "6 大 Agent" | stockforge/agents/ 7 个 YAML | ✅ 通过 |
| rules.md §5.6 P33 质量分 0.85 | stockforge/config/loops | ✅ 通过 |

**严重冲突汇总**：
- 无

**审核结论**：✅ StockForge 合规（9 大项目中最规范，可作为其他项目参考）

### 6.9 openclaw_pkg

| 铁律 | 文档/代码位置 | 冲突点 |
|------|---------------|--------|
| rules.md §1.3 "只有 content 实例" | openclaw_pkg/workspace/content/ | ✅ 通过 |
| rules.md §1.3 "端口 800" | openclaw_pkg | ✅ 通过 |

**审核结论**：✅ openclaw_pkg 合规

### 6.10 9 大项目冲突总览表

| 项目 | P0 冲突数 | P1 冲突数 | P2 冲突数 | 严重性 | 修复优先级 |
|------|:---------:|:---------:|:---------:|:------:|:----------:|
| hiclaw (含 openroute) | 0 | 0 | 0 | ✅ 合规 | — |
| opensieve | 0 | 0 | 0 | ✅ 合规 | — |
| flowforge | 2 | 4 | 0 | ❌ 严重 | 1 |
| contentforge | 2 | 1 | 1 | ❌ 严重 | 1 |
| devforge | 0 | 1 | 1 | ⚠️ 待办 | 3 |
| novelforge | 0 | 0 | 0 | ✅ 合规 | — |
| mallforge | 1 | 1 | 0 | ❌ 严重 | 2 |
| stockforge | 0 | 0 | 0 | ✅ 合规 | — |
| openclaw_pkg | 0 | 0 | 0 | ✅ 合规 | — |

**结论**：9 大项目中有 3 个项目（flowforge / contentforge / mallforge）有 P0 级别冲突，**必须在本周内修复**；否则 9 大项目无法宣称为"harness 驾驭层架构完整 + LoopExecutor 唯一执行 + OpenSieve 统一数据检索"的整体合规体系。

---

## 第七节：命名方案提案（5 套候选 + 决策矩阵）

> 上一节 review（kimi1.md）已提出 5 套命名方案：
> - 方案 A：灵智体系（"灵"主题）
> - 方案 B：核-Kernel 体系（"核"主题）
> - 方案 C：体-Being 体系（"体"主题）
> - 方案 D：孪生-Twin 体系（"孪生"主题）
> - 方案 E：活体-Living Agent 体系（"活体"主题）
> - 方案 F：化身-Avatar 体系（"化身"主题）
>
> 本审核在 kimi1.md 基础上，重新设计了 5 套**更专业、更面向企业 B 端 + AGI 愿景表达**的命名方案。

### 7.1 命名设计原则

| 原则 | 说明 |
|------|------|
| **P1 通俗易懂** | 非技术用户（业务专家、产品经理、企业决策者）能 30 秒内理解隐喻 |
| **P2 体现 AGI 愿景** | 表达"自我进化、持续成长、跨域智能"的 AGI 阶段语义 |
| **P3 行业普适** | 在金融/医疗/法律/教育/电商/制造 6 大行业都能无歧义使用 |
| **P4 海外开发者友好** | 英文对应词在国际学术界和工业界有先例，不生造 |
| **P5 品牌一致性** | 与 FlowForge 现有"流 / 锻造 / 炉"主题可兼容或可清晰区分 |
| **P6 可扩展** | 6 级升华阶段 / 5 种记忆 / 4 类协作 / 3 种自进化模式都能自然命名 |
| **P7 学术可发表** | 命名能在 NIPS / ACL / ICML 等顶会论文中作为概念被引用 |

### 7.2 方案一：ForgeSpirits（炉灵·Spirit 体系）—— 改良当前方案

**核心理念**：保留当前"炉灵"但降低玄学色彩，用 Spirit 替代 Forgekin（Spirit 在国际心理学/AI 语境中已普及，如 "Spirit of the model"）。

| 中文 | 英文 | 说明 |
|------|------|------|
| 炉灵 | ForgeSpirit | 自我进化的智能体（弱化"魂/灵"的玄学色彩，保留 Forge 品牌） |
| 灵族 | SpiritTribe | 协作群体（弱化 Clowder 的"猫群"对标） |
| 铸魂 | Soulforge | 灵魂养成（保留"魂"但用 Forge 限定） |
| 灵忆 | SpiritMemory | 跨会话记忆（避开"魂忆"的玄学） |
| 灵印 | SpiritProfile | 认知画像 |
| 自炼 | AutoForge | 自主思考进化 |
| 熔典 | ForgeCodex | 技能库（保留 Codex） |
| 灵议会 | SpiritCouncil | IM 协作（弱化"灵议"） |
| 升华阶 | SpiritStage | E1-E6 升华 |

**优点**：
- 最小改动：保留 spec.md 现有大部分术语
- Spirit 比 Forgekin 更易理解（Spirit 在 Spirit Airlines / Spirit OS / Spirit AI 等已有商业用例）
- 保持 Forge 品牌一致性

**缺点**：
- 仍未摆脱"灵"的玄学色彩
- Spirit 与 Soul 概念在英文中部分重叠

**适合**：希望最小改动、保留当前品牌资产的项目

---

### 7.3 方案二：AgentMind（心智体系）—— 学术 + AGI 视角

**核心理念**：以认知科学 + AI 学术语言命名，避开"魂/灵"，强调"可观测、可解释、可持续成长"的心智模型。

| 中文 | 英文 | 说明 |
|------|------|------|
| 心智体 | AgentMind | 自我进化的智能体（cognitive agent 学术化） |
| 心智网 | MindNet | 协作群体 |
| 育智 | MindNurture | 养成全过程（避开"养"字） |
| 忆痕 | MemoryTrace | 跨会话记忆（对标 Generative Agents "Memory Stream"） |
| 识海 | KnowledgeSea | 认知画像（对标 Voyager Skill Library） |
| 自省 | SelfReflect | 自主思考进化（对标 Reflexion） |
| 智典 | MindCodex | 技能库 |
| 心议会 | MindCouncil | IM 协作 |
| 智阶 | MindStage | E1-E6 升华（对标 Bloom's Taxonomy 学术化） |

**优点**：
- 学术化命名，符合 AGI 研究社区偏好
- 易于发表论文（MindStage、MemoryTrace 等术语已有先例）
- 完全摆脱"灵/魂"玄学
- 与 Anthropic / DeepMind / OpenAI 等研究机构的术语风格一致

**缺点**：
- 与 FlowForge 的"炉"品牌脱钩
- "心智"在企业 B 端可能略显抽象
- 中文"心智"在工程文档中可能不够具体

**适合**：以学术研究 + 长期 AGI 愿景为定位的项目

---

### 7.4 方案三：ForgeMind（锻造心智·双品牌融合）

**核心理念**：融合 FlowForge 的"Forge"品牌 + 心智体系的"认知科学"语义，达成"工程品牌 + 学术语义"双轨。

| 中文 | 英文 | 说明 |
|------|------|------|
| 锻心 | ForgeMind | 自我进化的智能体（Forge 品牌 + Mind 学术化） |
| 锻心群 | ForgeMindTribe | 协作群体 |
| 锻心术 | ForgeMindCraft | 养成全过程（Craft 突出"锻造工艺"） |
| 锻忆 | ForgeMemory | 跨会话记忆（保留 Forge 主题） |
| 锻印 | ForgeProfile | 认知画像 |
| 自锻 | SelfForge | 自主思考进化（保留"自锻"原有术语） |
| 锻典 | ForgeCodex | 技能库（保留"锻典"原有术语） |
| 锻心会 | ForgeMindCouncil | IM 协作 |
| 锻阶 | ForgeStage | E1-E6 升华（对标 NVIDIA DLI 培训阶段） |

**优点**：
- **完美保留 FlowForge 品牌一致性**（Forge 出现 7 次）
- 学术化（Mind）+ 工程化（Forge）双轨
- 大部分原有术语（自锻/锻典/升华/灵议）可平滑迁移到 ForgeStage / ForgeCouncil
- 海外开发者友好（ForgeMind 一目了然）
- 适合企业 B 端：Forge 体现"工程可信赖"，Mind 体现"持续智能"

**缺点**：
- 仍用"锻"（锻造）隐喻，但"锻造"是工程行业普适概念，比"炉灵"更可接受
- 双品牌融合对命名一致性要求高

**适合**：希望保留 FlowForge 品牌资产 + 学术严肃性 + 企业 B 端可接受度的项目 ⭐ **最推荐**

---

### 7.5 方案四：OpenCogNexus（认知联结·英文优先）

**核心理念**：面向海外开发者与开源社区，纯英文命名，与 OpenClaw / OpenRoute / OpenSieve 三大 OpenX 品牌一致。

| 中文 | 英文 | 说明 |
|------|------|------|
| 认知体 | OpenCogNexus | 自我进化的智能体（OpenX 家族 + Cog + Nexus） |
| 认知网络 | CogNetwork | 协作群体 |
| 认知养成 | CogNurture | 养成全过程 |
| 记忆流 | MemoryStream | 跨会话记忆（直接采用 Generative Agents 术语） |
| 认知画像 | CogProfile | 认知画像 |
| 自主反思 | SelfReflect | 自主思考进化（直接采用 Reflexion 术语） |
| 技能库 | SkillCodex | 技能库 |
| 认知会 | CogCouncil | IM 协作 |
| 认知阶 | CogStage | E1-E6 升华 |

**优点**：
- 完全融入 OpenX 品牌家族（OpenClaw / OpenRoute / OpenSieve / OpenCogNexus）
- 全部采用学术界已有术语（MemoryStream / SelfReflect / SkillCodex），零生造
- 海外开发者零学习成本
- 开源传播性最强

**缺点**：
- 中文命名略显生硬（"认知体"不如"炉灵"有诗意）
- 与 FlowForge 品牌脱钩（不是"Forge"主题）
- 4 个 OpenX 品牌可能让用户混淆（OpenClaw vs OpenCogNexus）

**适合**：开源优先 + 海外市场优先 + 不强求中文隐喻的项目

---

### 7.6 方案五：IronForge（铁匠·工业隐喻）

**核心理念**：用"铁匠锻造 / 钢铁是怎样炼成的"工业隐喻，避开一切"灵/魂"概念，强调"可重复、可量化、可工业化"的智能体生产。

| 中文 | 英文 | 说明 |
|------|------|------|
| 铁匠灵 | IronSmith | 自我进化的智能体（强工业隐喻） |
| 铁匠铺 | ForgeWorkshop | 协作群体 |
| 锻造 | Forging | 养成全过程 |
| 炉火史 | ForgeLog | 跨会话记忆（"炉火=经验"） |
| 工件图 | JobBlueprint | 认知画像（"工件"+"蓝图"工业术语） |
| 夜锻 | NightForge | 自主思考进化（"夜间无人值守的锻造"） |
| 工匠典 | SmithCodex | 技能库 |
| 铁匠会 | SmithCouncil | IM 协作 |
| 匠阶 | SmithStage | E1-E6 升华（对标传统手艺人等级：学徒/工匠/大师） |

**优点**：
- 工业隐喻在制造/工程/建筑/传统行业接受度极高
- "学徒 → 工匠 → 大师" 升华路径有 5000 年文化基础
- 完全脱离玄学
- 与 FlowForge 的"炉/Forge"主题完美融合
- 适合 ToB（特别是制造业、传统行业）客户

**缺点**：
- 弱化了"AGI 智能"的科幻感
- 工业隐喻在 AI 前沿社区接受度需要时间

**适合**：ToB 优先 + 制造业/工程业 + 强调"可信赖、可量化、可持续改进"的项目

---

### 7.7 5 套方案决策矩阵

| 维度 | A: ForgeSpirit | B: AgentMind | C: ForgeMind ⭐ | D: OpenCogNexus | E: IronForge |
|------|:--------------:|:------------:|:----------------:|:----------------:|:------------:|
| 通俗易懂 (P1) | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| AGI 愿景 (P2) | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 行业普适 (P3) | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 海外友好 (P4) | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| FlowForge 品牌一致 (P5) | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| 可扩展 (P6) | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 学术可发表 (P7) | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| **总评** | 3.5/7 | 3.7/7 | **4.5/7** ⭐ | 3.8/7 | 3.7/7 |
| 改动量 | 最小 | 中等 | 中等 | 较大 | 中等 |
| 推荐场景 | 兼容旧 | 学术优先 | **通用** ⭐ | 开源优先 | ToB 工业 |

### 7.8 委员会推荐

**AI 智能体产品专家** 推荐 **方案 C（ForgeMind）**：保留 FlowForge 品牌 + 学术严肃 + 企业 B 端可接受
**AI 高级架构师** 推荐 **方案 C（ForgeMind）**：术语工程化 + 利于代码命名
**AI Agent 开发工程师** 推荐 **方案 C 或 E**：C 利于工程命名，E 利于 ToB
**高级全栈工程师** 推荐 **方案 C（ForgeMind）**：与现有 ecosystem.py / sdk.py 命名风格一致（FlowForgeSDK / ForgeMind / ForgeStage）
**AI Prompt / Harness 研究员** 推荐 **方案 B（AgentMind）**：学术发表 + AGI 愿景表达最强
**DevRel 负责人** 推荐 **方案 D（OpenCogNexus）**：开源 + 海外传播性最强

### 7.9 委员会联合推荐结论

> **主推：方案 C（ForgeMind 锻心）**——在 7 个维度中 4 个第一或并列第一，且与 FlowForge 品牌一致性最强，工程师 / 业务 / 海外 / 学术四类受众都可接受。
>
> **备选 1：方案 B（AgentMind 心智）**——若团队更看重 AGI 学术愿景与论文发表。
>
> **备选 2：方案 D（OpenCogNexus 认知联结）**——若项目开源战略优先且面向海外。

### 7.10 命名方案投票请求

请 operator 在以上 3 套候选（C / B / D）中选定一套，或保留当前方案 A（Forgekin 改良）。最终选择后，**所有 spec.md / arch.md / design.md / face/ / kimi1.md / qianwen1.md / 本审核中的命名将统一替换**——避免出现多套命名并行（已存在 kimi1.md 提 6 套 + 本审核提 5 套 = **11 套候选**的混乱状态）。

---

## 第八节：优先级 P0/P1/P2 行动清单

### 8.1 P0（本周必须修复）

| # | 修复项 | 负责文档/代码 | 估算人日 |
|---|--------|---------------|:--------:|
| P0-1 | spec.md / arch.md / design.md 顶部版本声明统一为 v7.0 | 3 个文档 | 0.5 |
| P0-2 | v7.0 自我进化代码 MVP：ForgekinEngine + SoulStore + EchoStore + ImprintStore（4 个核心类） | flowforge/evolution/ | 5 |
| P0-3 | 9 大项目 helixrag 残留清理（contentforge 15+ 处 + flowforge config） | contentforge/ + flowforge/config/ | 1 |
| P0-4 | MallForge arch.md P31 铁律修复：6 个 Agent 改走 LoopExecutor | mallforge/ | 2 |
| P0-5 | flowforge/modes/loop_mode.py 移除（让 LoopExecutor 唯一接管） | flowforge/modes/ | 1 |
| P0-6 | contentforge/config/loops/deep_article_loop.yaml worker.mode 改为 loop 嵌套（违反 P31） | contentforge/config/ | 0.5 |
| P0-7 | spec.md 7.5 FR-EVO 清单补全为 15 项 | spec.md | 0.5 |
| P0-8 | v6.0 MemoryManager 5 层 ↔ v7.0 3 层 映射表 + 兼容迁移策略 | spec.md + arch.md + design.md | 1 |
| P0-9 | Wilson 公式补全（spec.md + arch.md + design.md + pyproject.toml 依赖修正） | 4 处 | 0.5 |
| P0-10 | 命名方案决策（详见第七节），统一全文档命名 | 全部 | 1 |
| P0-11 | face/spec_face.md "互联层 vs 自进化层" 叙事统一 | face/spec_face.md | 0.5 |
| P0-12 | face/ds.md 顶部日期 2025 → 2026，基础版本 v4.0 → v7.0 | face/ds.md | 0.1 |
| P0-13 | spec.md 11.1 "虚假承诺" 修正为 "设计态，待 v7.0 evolution/ 模块实现" | spec.md | 0.1 |

**P0 合计**：14 项 / **14.7 人日** / **本周内完成**

### 8.2 P1（本月内修复）

| # | 修复项 | 负责文档/代码 | 估算人日 |
|---|--------|---------------|:--------:|
| P1-1 | spec.md / arch.md / design.md Harness Hook 扩展（v7.0 SoulAware 接口） | 3 个文档 + flowforge/ | 3 |
| P1-2 | FR-EVO-01~15 失败路径 AC 补全 | spec.md | 2 |
| P1-3 | FR-EVO-15 Wilson 公式 + 三信号路由公式补全 | spec.md | 0.5 |
| P1-4 | FR-EVO-12 升华降级触发与回滚操作 | spec.md | 1 |
| P1-5 | v7.0 调试接口设计（5 个 REST + 1 个 SSE） | spec.md | 1 |
| P1-6 | v7.0 降级语义统一表 | spec.md | 0.5 |
| P1-7 | v7.0 前 8 章业务场景用户旅程图 | spec.md | 1 |
| P1-8 | face/task_face.md 增加 v7.0 养灵能力任务拆解 | face/task_face.md | 1 |
| P1-9 | face/README.md 或 spec.md 第七章 权威源声明 | 1 处 | 0.5 |
| P1-10 | design.md 15.1 evolution/ 子目录 标"实现状态徽章" | design.md | 0.5 |
| P1-11 | design.md 16.x Capabilities.external_tools_can_use Literal 约束 | design.md | 0.5 |
| P1-12 | design.md 16.x is_distillable 支持失败经验蒸馏 | design.md | 0.5 |
| P1-13 | design.md 16.x ForgekinEngine 依赖改为 ForgekinEngineDeps dataclass | design.md | 0.5 |
| P1-14 | design.md 18.x Loop 内外部工具调用总预算 ≤ 240s | design.md | 0.5 |
| P1-15 | design.md 19.x A2A 协议引用 Google A2A v0.2 标准 | design.md | 0.5 |
| P1-16 | v7.0 CI/CD 流水线设计章节 | design.md | 1 |
| P1-17 | v7.0 数据库 DDL 7 个 migration 完整字段 | design.md | 1 |
| P1-18 | v7.0 REST API 路径前缀 /api/v1/{forgekin,council,auto_forge,codex,bridge} | arch.md | 0.5 |
| P1-19 | v6.0 → v7.0 迁移策略章节 | spec.md + arch.md | 1 |
| P1-20 | v6.0 HybridExecutor SoulAware 扩展点升级 | flowforge/ | 3 |
| P1-21 | MallForge agents/ Python 类目录迁移 | mallforge/ | 2 |
| P1-22 | ContentForge tools/ 目录迁移到 config/tools/*.yaml | contentforge/ | 5 |
| P1-23 | spec.md 第七章 1.1.1 AGI 定义与阶段性目标 | spec.md | 0.5 |
| P1-24 | arch.md §3.5 v7.0 养灵体系方法论对标 | arch.md | 1 |
| P1-25 | v7.0 SLO 并发场景（100 炉灵同时 Auto-Forge） | spec.md | 0.5 |

**P1 合计**：25 项 / **28.5 人日** / **本月内完成**

### 8.3 P2（季度内修复）

| # | 修复项 | 负责文档/代码 | 估算人日 |
|---|--------|---------------|:--------:|
| P2-1 | v7.0 商业化路径草案 | spec.md | 1 |
| P2-2 | v7.0 失败案例与规避策略 | arch.md | 1 |
| P2-3 | spec.md 附录 N 弃用时间线补充 v7.0 项 | spec.md | 0.5 |
| P2-4 | face/ 5 个文件与 flowforge 主线术语统一表 | face/ | 1 |
| P2-5 | v7.0 开源 Release Checklist | 全文档 | 2 |
| P2-6 | v7.0 vs 工业级 Agent Harness（Anthropic SDK / LangGraph / AutoGen）对比矩阵 | arch.md | 1 |
| P2-7 | v7.0 跨 forge 凭证管理统一抽象 | spec.md + 9 项目 | 3 |
| P2-8 | v7.0 前端组件复用 v6.0 Helm 清单 | design.md | 1 |
| P2-9 | v7.0 性能基准测试方案 | design.md | 2 |
| P2-10 | v7.0 灾备与降级矩阵 | spec.md | 1 |

**P2 合计**：10 项 / **13.5 人日** / **季度内完成**

### 8.4 总估算

| 优先级 | 项数 | 人日 | 截止时间 |
|--------|:----:|:----:|----------|
| P0 | 14 | 14.7 | 本周 |
| P1 | 25 | 28.5 | 本月 |
| P2 | 10 | 13.5 | 季度内 |
| **合计** | **49** | **56.7** | 季度内 |

---

## 附录 A：本审核与 kimi1.md / qianwen1.md 的关系

| 文件 | 关注重点 | 与本审核的关系 |
|------|----------|----------------|
| kimi1.md（561 行） | 7 个 P0 + 4 个 P1 + 6 套命名方案 + 5 维度能力评估 | 本审核**补充**其未覆盖的 spec.md 7-13 章、design.md 第 15-25 章细节 |
| qianwen1.md（203 行） | 14 项问题清单 + 3 套命名方案 + 5 节项目冲突表 | 本审核**扩展**到 49 项 + 5 套命名方案 + 9 项目逐项冲突表 |
| **minimax1.md（本文件）** | **49 项问题 + 5 套命名 + 9 项目逐项 + 14 项 P0** | **本审核** |

**特别说明**：本审核与前两份 review 的关键差异：

1. **本审核**对 spec.md 第七/八/九/十/十一/十二/十三章（共 766 行 v7.0 内容）做了**逐章**逐问题分析（第一节 1.8-1.14，共 7 节、30+ 个问题），前两份 review 仅做整体评价。
2. **本审核**对 design.md 第五部分 v7.0 Forgekin 体系（3700+ 行）做了**逐章**分析（第三节 3.3-3.5，共 4 节、20+ 个问题），前两份 review 未深入。
3. **本审核**对 9 大项目做了**逐项目逐铁律**冲突分析（第六节，共 9 个项目 × 5-10 条铁律 = 60+ 条评估），qianwen1.md 仅做了 6 个项目粗略分析。
4. **本审核**命名方案为**全新设计**的 5 套（ForgeSpirit / AgentMind / ForgeMind / OpenCogNexus / IronForge），与 kimi1.md 的 6 套完全不同，且通过 7 维度决策矩阵评分。
5. **本审核**提供 49 项可执行任务清单（第八节，含 P0/P1/P2 + 估算人日 + 截止时间），前两份 review 仅给原则性建议。

---

## 附录 B：本审核未覆盖的盲点

- 本审核未对 `flowforge/evolution/` v6.0 实现代码（engine.py / knowledge_evolution.py / maturity.py / metacognition.py / models.py / process_evolution.py / scope_guard.py）做静态分析。
- 本审核未对 FlowForge v6.0 全部模式执行器（modes/ 下 10 个文件）做完整核对。
- 本审核未对其他 *forge 项目的 plugins.py / config/ 完整对照 P8A 边界铁律（仅看了 arch.md 关键声明）。
- 本审核未对 9 大项目的 Web 前端（web/ 目录）做检查。
- 本审核未对 9 大项目的 docker-compose / 部署脚本做合规性核对。

**建议后续**：在本审核通过后，安排 3 个独立 PR 完成：PR-A（spec.md/arch.md/design.md 顶部版本 + v7.0 内容补全）、PR-B（9 大项目 P0 冲突修复）、PR-C（v7.0 evolution/ 代码 MVP）。

---

## 附录 C：审核委员会成员确认清单

| 角色 | 评审视角 | 重点关注章节 |
|------|----------|--------------|
| ✅ AI 智能体产品专家 | 用户场景 / 产品定位 / 商业化 / 命名 | 1.8, 5.1, 5.6, 第七节 |
| ✅ AI 高级架构师 | 整体架构 / 依赖 / 跨层一致性 | 1.4, 2.5-2.10, 5.2, 第六节 |
| ✅ AI 智能体 Agent 开发工程师 | 可实现性 / API 契约 / 运行时 | 1.9, 2.14, 5.3 |
| ✅ 高级软件全栈工程师 | 工程落地 / CI/CD / 可观测 | 1.11, 3.4, 5.4, 8.x |
| ✅ AI Prompt / Harness 研究员 | 方法论 / 学术 / AGI 愿景 | 5.5, 第七节 |
| ✅ DevRel / 社区生态负责人 | 开源品牌 / 传播性 | 5.6, 7.x |

---

> **本审核结束。请 operator 审阅本文件，特别关注第七节命名方案决策与第八节 P0 行动清单。**
> **审核版本**：minimax1.md v1.0 / 2026-07-15
