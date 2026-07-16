# FlowForge v7.0 自进化与养灵体系设计 — 六方审核意见汇总（并集）

> **汇总日期**：2026-07-16
> **汇总角色**：高级 AI 智能体架构专家
> **汇总原则**：取并集（保留所有团队的独特发现，不仅保留共识）；冲突点明确标记
> **汇总范围**：6 份审核意见文件 + 原始 spec.md 第 7.2 节养灵体系命名
> **状态**：⚠️ 待 operator 评审对齐后再动手修改设计文档/代码
>
> **6 方审核输入**：
>
> | # | 团队 | 轮次 | 文件 | 行数 | 命名方案数 |
> |---|------|------|------|------|:----------:|
> | 1 | deepseek | 第四轮 | `deepseek.md` | 556 | 3 |
> | 2 | doubao | 第二轮 | `doubao.md` | 620 | 3 |
> | 3 | glm | 第四轮 | `glm.md` | 529 | 4 |
> | 4 | kimi | 第五轮 | `kimi.md` | 492 | 3 |
> | 5 | minimax | 第三轮 | `minimax.md` | 843 | 5 |
> | 6 | qianwen | 第三轮 | `qianwen.md` | 810 | 4 |
>
> **原始权威源**：`flowforge/docs/spec.md` 第 7.2 节（第 3248-3265 行）「炉灵 Forgekin」体系命名定义

---

## 目录

1. [总体评分对比](#1-总体评分对比)
2. [P0 级问题并集（致命问题）](#2-p0-级问题并集致命问题)
3. [P1 级问题并集（严重问题）](#3-p1-级问题并集严重问题)
4. [P2 级问题并集（中等问题）](#4-p2-级问题并集中等问题)
5. [核心矛盾点分析（六方共识）](#5-核心矛盾点分析六方共识)
6. [养灵体系命名方案对比分析（重点）](#6-养灵体系命名方案对比分析重点)
7. [意见冲突标记](#7-意见冲突标记)
8. [共识点（所有团队一致同意）](#8-共识点所有团队一致同意)
9. [建议的下一步行动](#9-建议的下一步行动)

---

## 1. 总体评分对比

### 1.1 评分维度对照（10 分制）

> 注：deepseek 使用 5 星制（★），已换算为 10 分制便于对比；「-」表示该团队未单独评分。

| 维度 | deepseek | doubao | glm | kimi | minimax | qianwen | 平均 |
|------|:--------:|:------:|:--:|:----:|:-------:|:-------:|:----:|
| 产品愿景与定位 | 8.0 | 8.5 | 9.0 | 9.0 | 8.5 | 10.0 | 8.8 |
| 架构设计合理性 | 8.0 | 7.5 | 7.5 | 6.5 | 7.0 | - | 7.3 |
| 技术可行性 | 6.0 | 7.0 | 6.5 | 5.5 | 6.0 | 4.0 | 5.8 |
| 文档完整性/一致性 | - | 6.5 | 6.0 | 5.0 | 6.0 | 6.0 | 5.9 |
| 代码实现一致性 | - | - | 4.0 | 4.0 | - | - | 4.0 |
| 9 大项目规范一致性 | - | - | 5.5 | 4.5 | 5.0 | 6.0 | 5.3 |
| 配置驱动合规性（P8A） | - | 7.0 | 6.5 | 6.0 | 5.0 | - | 6.1 |
| 测试可验证性 | - | 5.5 | 5.0 | 5.0 | 4.5 | - | 5.0 |
| 养灵体系命名成熟度 | - | - | - | 7.0 | - | - | 7.0 |

### 1.2 关键观察

- **产品愿景**得分最高（平均 8.8），六方一致认可"从驾驭到养成"的范式跃迁方向
- **技术可行性**得分最低（平均 5.8），核心瓶颈是"文档宏大但代码实现严重滞后"
- **代码实现一致性**仅 glm/kimi 两方评分，均为 4.0，反映 evolution/ 术语冲突问题严重
- **测试可验证性**平均仅 5.0，"自我进化有效性如何客观验证"是六方共同难题

---

## 2. P0 级问题并集（致命问题）

> 以下为 6 个团队提出的所有 P0 级问题的并集（去重合并），共 **18 项**。每项标注提出该问题的团队。

### P0-1 🔴 evolution/ 代码术语与 v7.0 设计严重冲突

- **提出团队**：glm、kimi、deepseek、minimax
- **问题**：`flowforge/evolution/__init__.py` 导出 `SelfEvolutionEngine`（v4.0 旧名），而 v7.0 设计要求 `ForgekinEngine`；`KnowledgeMaturityLadder` 应为 `Ember Hierarchy`；`ScopeGuard/ProcessEvolution/KnowledgeEvolution` 对应 v7.0 三模式自生成但命名未对齐
- **影响**：开发者按 v7.0 文档 `import ForgekinEngine` 会 `ImportError`
- **涉及**：`flowforge/evolution/__init__.py`、`engine.py`、`devforge/plugins.py:473`

### P0-2 🔴 design.md 描述 evolution/ 30+ 文件，实际仅 8 个扁平文件

- **提出团队**：glm、kimi、minimax、qianwen
- **问题**：design.md 第 15.1 节描述 `forgekin/auto_forge/codex/tools/council/security/api` 七个子目录共 30+ 文件，实际 `evolution/` 只有 8 个扁平 `.py` 文件，无任何子目录，缺失 75% 以上模块
- **缺失模块**：SoulStore、EchoStore、ImprintStore、AscensionManager、AutoForgeEngine、ForgeCodex、A2AManager、ForgekinCouncil
- **涉及**：`design.md:3269`、`flowforge/evolution/`

### P0-3 🔴 FlowForge core 硬编码业务领域提示词

- **提出团队**：glm、kimi、deepseek
- **问题**：
  - `declarative_agent.py:750` 硬编码"你是资深内容创作者"
  - `default_llm_actors.py:45,112,194` 硬编码"你是内容创作者"/"你是严格的内容质量审核员"/"你是严格的反思员"
  - `loop/verifier.py:300` 硬编码评审提示词
- **违反**：编程红线第 10 条（禁止在 flowforge 中写死业务领域代码）+ 第 11 条（禁止硬编码提示词）+ P8A + P34-11
- **涉及**：`flowforge/core/declarative_agent.py`、`flowforge/modes/default_llm_actors.py`、`flowforge/loop/verifier.py`

### P0-4 🔴 架构层数第 7 层定义双重冲突

- **提出团队**：doubao、glm、kimi、minimax、deepseek（五方一致）
- **问题**：v7.0 arch.md 称"七层 = 六层 + 自进化层"，v3.0-face arch_face.md 称"七层 = 六层 + 互联层"——两个文档都声称自己是"七层架构"但第 7 层完全不同
- **涉及**：`arch.md:5304`、`arch_face.md:15`、`spec_face.md:7`

### P0-5 🔴 ForgekinEngine 与 LoopExecutor 关系未定义

- **提出团队**：doubao、glm、kimi、minimax（四方一致）
- **问题**：v2.1 已有 LoopExecutor（Planner→Worker→Verifier→Reflector→Memory 五步），v7.0 又有 ForgekinEngine（10 步闭环），两者约 70-80% 功能重叠，文档未说明是替代/包含/包装关系
- **涉及**：`spec.md` 第 7 章、`arch.md:5465`、`rules.md:180`（P31）

### P0-6 🔴 版本号严重混乱

- **提出团队**：kimi、glm、doubao、minimax（四方一致）
- **问题**：`spec.md` 标题写 v2.1 但第 3219 行起是 v7.0 内容；`arch.md`/`design.md` 标题写 v6.0 但内容含 v7.0；`spec_face.md` 声称引用 `spec.md` v7.0 权威源但该标题不存在
- **涉及**：`spec.md:1`、`arch.md:1`、`design.md:1`、`spec_face.md:7`

### P0-7 🔴 face 文档 M18-M20 删除不彻底

- **提出团队**：doubao、glm、kimi、minimax（四方一致）
- **问题**：project_memory 明确要求删除 M18/M19/M20，但 `spec_face.md` 仍有 15+ 处引用：
  - 第 156 行 G18 决策项"M18-M20 融合"
  - 第 625 行章节标题"模块 M18-M20：v7.0 炉灵养成体系融合映射"
  - 第 1234 行"M18/M19/M20 架构详设"
- **且** `evolution/__init__.py` 仍保留 `SelfEvolutionEngine`（对应原 M18），`devforge/plugins.py` 仍初始化它
- **涉及**：`spec_face.md`、`task_face.md`、`evolution/__init__.py`、`devforge/plugins.py:473`

### P0-8 🔴 FlowForge agents/ 目录违反 P8A 铁律

- **提出团队**：minimax（早期审核发现 14+ 业务 Agent）、kimi（第五轮确认已清理至 generic/）、glm（第四轮确认已清理但 declarative_agent.py 残留）
- **冲突说明**：⚠️ **此问题状态在团队之间存在冲突**——minimax 第三轮审核时仍发现 `topic_research.py`、`article_writing.py`、`seo_optimization.py`、`publishing.py`、`code_writer_agent.py` 等 14+ 业务专属 Agent；但 kimi 第五轮和 glm 第四轮审核时确认 `flowforge/agents/` 已清理至 `generic/` 目录，仅 `declarative_agent.py:750` 残留内容创作领域提示词。**结论**：业务 Agent 文件已清理，但硬编码提示词残留问题仍存在。详见 [7.4 节](#74-flowforgeagents-p8a-状态冲突)
- **违反**：P8A 铁律「FlowForge 无业务逻辑」+ 红线 10
- **涉及**：`flowforge/agents/`、`flowforge/core/declarative_agent.py`

### P0-9 🔴 测试代码使用 MockLLM 违反 T1

- **提出团队**：glm、kimi
- **问题**：
  - `tests/conftest.py:27` 定义 `MockLLM` 类
  - `tests/integration/test_react_resume_integration.py` 使用 `MockLLMClient`
  - `tests/unit/test_skills.py` patch `LLMClient`
- **违反**：测试铁律 T1（禁止使用 Mock LLM）
- **涉及**：`flowforge/tests/conftest.py`、`flowforge/tests/integration/`、`flowforge/tests/unit/`

### P0-10 🔴 v7.0 配置文件大面积缺失

- **提出团队**：kimi
- **问题**：`flowforge/config/` 中不存在 `evolution.yaml`、`forgekin_seeds/`、`auto_forge.yaml`、`external_tools.yaml`、`migrations/007-013.sql`，design.md 第 15.1 节规划的 30+ 配置/迁移文件仅 `a2a_channels.yaml` 存在
- **涉及**：`design.md:3269-3399`、`flowforge/config/`

### P0-11 🔴 PluginProtocol V3 钩子未定义

- **提出团队**：kimi、glm
- **问题**：design.md 第 20 章声称 *Forge 通过 `register_forgekins`/`register_skill_seeds`/`register_council_channels`/`register_auto_forge_config` 注册炉灵，但 `flowforge/core/plugin_protocol.py` 当前只有 V1/V2 钩子（register_agents/tools/modes/.../loops/personas/prompts），无 V3 钩子
- **涉及**：`design.md:6167-6254`、`flowforge/core/plugin_protocol.py:245-474`

### P0-12 🔴 LLMClient 独立模块与 ModelCapability 并存

- **提出团队**：kimi
- **问题**：project_memory 要求"LLM capabilities must be provided through FlowForge ModelCapability; independent LLM client modules are prohibited"，但 `flowforge/tools/llm_client.py`、`flowforge/llm/` .providers 仍大量直接 import LLMClient
- **涉及**：`flowforge/tools/llm_client.py`、`flowforge/llm/provider.py`、`flowforge/app/main.py:9`

### P0-13 🔴 memory/ 模块直接操作 SQLite

- **提出团队**：kimi
- **问题**：`task_board.py`、`short_term.py`、`semantic.py`、`mailbox.py`、`manager.py` 中大量 `sqlite3.connect` + `conn.execute`，未通过 Repository 层
- **违反**：铁律 4（禁止直接操作数据库）
- **涉及**：`flowforge/memory/*.py`

### P0-14 🔴 contentforge 硬编码提示词

- **提出团队**：glm、kimi
- **问题**：`contentforge/tools/research_engine.py:168` 硬编码"你是素材研究规划专家"
- **违反**：编程红线第 11 条
- **涉及**：`contentforge/tools/research_engine.py`

### P0-15 🔴 design.md 代码存在 5 个严重 Bug

- **提出团队**：deepseek
- **问题**：
  | # | 位置 | 问题 |
  |---|------|------|
  | B1 | `ForgeDiaryStore.__init__` | 使用 `self._db_path` 但该属性从未赋值——运行时必崩溃 |
  | B2 | `A2AManager.send_mention` | 调用 `await self._route(message)` 但方法名是 `route`——方法名不一致 |
  | B3 | `ForgekinCouncil.receive` | 调用 `broadcast(msg, exclude=[channel])`，但 `broadcast` 签名无 `exclude` 参数 |
  | B4 | `AscensionManager._check_e1_to_e2` | 检查 `state.episodes_recorded >= 2`，但 `ForgekinEngine._evolve` 从未更新该计数——E1→E2 永不可能 |
  | B5 | `EchoStore.recall` | 在 Pydantic 模型上动态设置 `ep._recall_score`，序列化问题 |
- **涉及**：`design.md` 对应类设计章节

### P0-16 🔴 E6 创炉灵权限存在循环依赖

- **提出团队**：deepseek
- **问题**：spec.md 中 E6 晋升条件为"创造 ≥1 个 E1 炉灵"，但 D7 推荐"E6 可创建炉灵"。必须先成为 E6 才能创建炉灵，但 E6 需要先创建炉灵才能晋升——鸡生蛋蛋生鸡问题
- **涉及**：`spec.md` 第 7.4 节

### P0-17 🔴 两套"E"前缀命名混淆

- **提出团队**：deepseek
- **问题**：锻典使用 E-L0~E-L4（Ember Hierarchy），升华阶段使用 E1~E6（Ascension Stages）。两者都用了"E"前缀但含义完全不同，在代码和文档中极易混淆
- **涉及**：`spec.md` 第 7 章

### P0-18 🔴 arch.md 章节编号冲突

- **提出团队**：deepseek
- **问题**：v6.0 文档已有第 15-18 节（L2134-L2375），v7.0 自进化文档又定义了第 15-23 节（L5302-L5492）。两份文档直接拼接，导致第 15、17、18 节各出现两次
- **涉及**：`arch.md`

---

## 3. P1 级问题并集（严重问题）

### P1-1 🟠 升华阶段 E1-E6 判定执行者未定义

- **提出团队**：doubao、glm、kimi、minimax（四方一致）
- **问题**：spec.md 给出量化条件（≥2 Episode、5Q≥7/10 等），但未说明由 Metrics 系统、LLM、ForgekinCouncil 还是 operator 执行判定
- **涉及**：`spec.md:3356-3373`

### P1-2 🟠 Soul Echo L3 语义记忆实现路径不清

- **提出团队**：doubao、glm、kimi、qianwen（四方一致）
- **问题**：L3「无限容量、永不淘汰」的语义记忆如何从 L2 Episode 自动提炼、如何存储/检索，design.md 未给出具体算法与存储后端
- **涉及**：`spec.md:3469-3474`、`design.md:3927-4117`

### P1-3 🟠 Auto-Forge 自指修改缺少退化防护机制

- **提出团队**：doubao、glm、kimi、minimax（四方一致）
- **问题**：炉灵可修改自己的 prompt/skill，但缺少"越改越差"的退化检测与自动回滚机制
- **涉及**：`spec.md` 第 8.4 节、`arch.md:5692`

### P1-4 🟠 v3.0-face M4 Guardrails 与 v7.0 SR-01~08 功能重叠

- **提出团队**：doubao、glm、kimi、minimax（四方一致）
- **问题**：M4 六层 Guardrails 与 spec.md 第 12.2 节 8 条安全红线功能大量重叠，层级关系未明确
- **涉及**：`spec_face.md` M4、`spec.md` 第 12.2 节

### P1-5 🟠 ForgekinEngine 注入了未使用的 AutoForgeEngine

- **提出团队**：deepseek
- **问题**：构造函数注入了 `self._auto_forge`，但 execute() 的 10 步流程中从未调用
- **涉及**：`design.md` ForgekinEngine 章节

### P1-6 🟠 ForgeCodex 和 AscensionManager 设计缺失

- **提出团队**：deepseek
- **问题**：arch.md 中 ForgeCodex 在架构图中占据重要位置，但整个文档没有 ForgeCodex 的类设计、API 或存储方案。AscensionManager 也同样缺失
- **涉及**：`arch.md`

### P1-7 🟠 存储后端不统一

- **提出团队**：deepseek
- **问题**：SoulStore 用 SQLite，EchoStore 用 SQLite+sqlite-vec，ImprintStore 存储后端未明确。生产环境是否需要统一到 PostgreSQL 未讨论
- **涉及**：`design.md`

### P1-8 🟠 自进化层与 Harness 层交互协议缺失

- **提出团队**：deepseek
- **问题**：ADR-007-02 明确自进化层在第 7 层、Harness 层在第 4 层，但文档没有说明自进化层如何调用 Harness 层的 PersonaLock/ContextManager/FeedbackLoop 等组件
- **涉及**：`arch.md`

### P1-9 🟠 Provoke 安全检查易被绕过

- **提出团队**：glm、kimi（两方一致）
- **问题**：`arch.md:6406` 使用关键词黑名单（投资建议、感情建议等），LLM 可用同义词/隐喻绕过
- **涉及**：`arch.md:6401-6406`

### P1-10 🟠 stockforge 直接操作数据库

- **提出团队**：glm
- **问题**：`app/services/schedule_service.py:178` 直接 `sqlite3.connect`，`app/services/report_repository.py` 虽是 Repository 但直接使用 `conn.execute` 拼 SQL 而非 ORM
- **违反**：铁律 4
- **涉及**：`stockforge/app/services/`

### P1-11 🟠 v3.0-face M9 Cost 与现有 model_service 重复

- **提出团队**：minimax
- **问题**：arch_face.md 设计 M9 Cost 优化，但 flowforge 已有 `model_service.py`，且 project_memory 记录有"健康检查探测 URL 必须用 `.removesuffix('/v1')`"的修复
- **涉及**：`arch_face.md`、`flowforge/core/model_service.py`

### P1-12 🟠 v3.0-face M5 OTel 与现有 tracing 系统并存

- **提出团队**：minimax
- **问题**：spec_face.md M5 设计 OTel GenAI 全量改造，但 `flowforge/core/tracing.py` 已有 `get_logger` 系统
- **涉及**：`spec_face.md`、`flowforge/core/tracing.py`

### P1-13 🟠 flowforge/a2a/ 与 evolution/council/a2a_manager.py 关系未明确

- **提出团队**：kimi
- **问题**：现有 `flowforge/a2a/` 是旧实现还是 v3.0-face M1 实现？是否与 design.md 规划的 `evolution/council/a2a_manager.py` 重复或冲突？
- **涉及**：`flowforge/a2a/`、`design.md:3319-3333`

### P1-14 🟠 pyproject.toml 版本未升级至 v7.0

- **提出团队**：kimi
- **问题**：`flowforge/pyproject.toml` 当前 `version = "0.1.0"`，未按 design.md 第 15.2 节升级为 `7.0.0`，也未声明 `sqlite-vec`、`wilson-interval` 等 v7.0 依赖
- **涉及**：`flowforge/pyproject.toml:7`、`design.md:3402-3418`

### P1-15 🟠 Web UI 设计缺失

- **提出团队**：deepseek
- **问题**：design.md 提到了 `web/src/pages/council/`、`web/src/pages/forgekin/` 等前端页面，但没有任何 UI 设计稿、组件树、状态管理方案
- **涉及**：`design.md`

### P1-16 🟠 WebSocket 实时通信未设计

- **提出团队**：deepseek
- **问题**：灵议（Forgekin Council）需要实时消息推送，但 design.md 中 WebSocket 端点设计过于简略（仅一行 `WS /api/v7/council/ws`），缺少消息格式、心跳机制、重连策略、离线消息队列等关键设计
- **涉及**：`design.md`

### P1-17 🟠 炉灵商业化路径未设计

- **提出团队**：minimax
- **问题**：炉灵如何卖给客户？按个卖？按能力卖？按调用次数卖？升华阶段 E1 和 E6 价值差异如何量化？
- **涉及**：`spec.md` 第八章后

---

## 4. P2 级问题并集（中等问题）

### P2-1 🟡 ForgekinCouncil 投票机制与冲突解决策略缺失

- **提出团队**：doubao、minimax
- **问题**：多个炉灵意见不一致时怎么办？简单多数票？加权投票？平票怎么处理？
- **涉及**：`spec.md` 第 7.4 节

### P2-2 🟡 炉灵之间的通信协议未定义

- **提出团队**：doubao
- **问题**：多个炉灵如何交流？自然语言对话？结构化消息？通信格式标准？
- **涉及**：`spec.md`

### P2-3 🟡 Soul Echo 三层记忆的存储实现未指定

- **提出团队**：minimax、doubao
- **问题**：spec.md 第 8.2 节给出 3 层结构，但 storage backend（SQLite vs 向量库 vs Redis）未设计
- **涉及**：`spec.md` / `design.md`

### P2-4 🟡 Forge Codex 缺少技能质量分级

- **提出团队**：doubao
- **问题**：技能沉淀到 Forge Codex 后，如何保证质量？如何区分"成熟技能"和"临时技巧"？
- **涉及**：`spec.md`

### P2-5 🟡 Windows 11 兼容性未验证

- **提出团队**：kimi
- **问题**：project_memory 要求所有测试用例必须通过 Windows 11 验证，但 `sqlite-vec`、外部编码工具 CLI（Claude Code/Codex）等未明确 Windows 兼容性
- **涉及**：`project_memory.md`、`design.md:3407-3411`

### P2-6 🟡 数据库迁移执行方案缺失

- **提出团队**：deepseek
- **问题**：design.md 列出了 7 个 SQL 迁移文件，但未说明迁移执行策略（在线迁移 vs 离线迁移、回滚方案、数据校验）
- **涉及**：`design.md`

### P2-7 🟡 前端状态管理复杂度

- **提出团队**：deepseek
- **问题**：炉灵管理的 SoulProfile 编辑、灵议的实时消息流、自锻日记的异步渲染——前端状态管理复杂度远超当前 Helm UI
- **涉及**：`design.md`

### P2-8 🟡 OpenSieve 统一检索原则落实不均

- **提出团队**：kimi
- **问题**：project_memory 与 rules.md 要求所有数据检索走 OpenSieve，但 `flowforge/memory/` 直接查 SQLite
- **涉及**：`rules.md:169-178`、`flowforge/memory/`

### P2-9 🟡 配置驱动率目标与现状差距

- **提出团队**：kimi
- **问题**：project_memory 要求 Phase 0 配置驱动率 ≥30%，但 spec.md 附录 S.2 显示约 20%
- **涉及**：`spec.md:3114-3123`、`project_memory.md`

### P2-10 🟡 devforge/plugins.py:470 的 register_evolution 仍未删除

- **提出团队**：kimi
- **问题**：前四轮已指出，但第五轮代码仍保留该非标准钩子，docstring 仍引用 `SelfEvolutionEngine`
- **涉及**：`devforge/plugins.py:470-482`

### P2-11 🟡 M3 Context Engineering 2.0 矛盾

- **提出团队**：qianwen
- **问题**：决策 4 推荐"渐进式 20-30%"，但验收标准要求"≥40%"
- **涉及**：`spec_face.md` M3

### P2-12 🟡 no-classifier 红线"禁止采集字段"未定义

- **提出团队**：qianwen
- **问题**：文档未给出具体禁止采集字段列表
- **建议**：参考 GDPR/CCPA，明确禁止采集政治倾向、宗教信仰、性取向、健康数据等
- **涉及**：`spec.md` SR-01

---

## 5. 核心矛盾点分析（六方共识）

以下三个核心矛盾被多个团队独立识别，是当前最严重的系统性问题。

### 矛盾 1：v4.0 代码术语 vs v7.0 设计术语

```
┌──────────────────────────────────────────────────────────────────┐
│  evolution/__init__.py（实际代码）    spec.md/arch.md（设计）      │
│  ─────────────────────────────        ──────────────────────────  │
│  SelfEvolutionEngine            →     ForgekinEngine              │
│  ScopeGuard (Mode A)            →     Scope Guard                │
│  ProcessEvolution (Mode B)      →     Process Evolution          │
│  KnowledgeEvolution (Mode C)   →     Knowledge Evolution         │
│  KnowledgeMaturityLadder       →     Ember Hierarchy            │
│  KnowledgeMaturityLevel        →     Ember Level (E-L0~E-L4)     │
│  EpisodeCard                   →     SoulEpisode                 │
│  MethodCard                    →     Skill Draft / Method Card    │
│  MetacognitionRouter           →     MetaCognitionGuard           │
│                                                                  │
│  → 根因：evolution/ 代码是 v4.0 时期写的，v7.0 设计文档是后写的  │
│  → 影响：开发者按 v7.0 文档写代码会 ImportError                   │
│  → 提出团队：glm / kimi / deepseek / minimax                     │
└──────────────────────────────────────────────────────────────────┘
```

### 矛盾 2：v3.0-face 互联层 vs v7.0 自进化层（架构层数冲突）

```
┌──────────────────────────────────────────────────────────────────┐
│  v2.1 六层架构（共同基础）                                        │
│  ↓                                                               │
│  v3.0-face: 七层 = 六层 + 互联层（A2A/ACP/MCP 2026）              │
│  v7.0     : 七层 = 六层 + 自进化层（Forgekin/Auto-Forge/Codex）   │
│                                                                  │
│  → 两份文档都声称自己是七层，第 7 层却不同                         │
│  → 必须统一为八层，或明确某层下沉/合并                             │
│  → 提出团队：doubao / glm / kimi / minimax / deepseek（五方）     │
└──────────────────────────────────────────────────────────────────┘
```

### 矛盾 3：design.md evolution/ 30+ 文件 vs 实际 8 个扁平文件

```
┌──────────────────────────────────────────────────────────────────┐
│  design.md 第 15.1 节描述：              实际 evolution/：       │
│  ────────────────────────              ────────────────────────  │
│  forgekin/ (8 文件)                    __init__.py               │
│  auto_forge/ (7 文件)                  engine.py                 │
│  codex/ (7 文件)                       knowledge_evolution.py   │
│  tools/ (5 文件)                       maturity.py              │
│  council/ (7+ 文件)                    metacognition.py          │
│  security/ (2 文件)                    models.py                 │
│  api/ (端点)                           process_evolution.py      │
│  → 共 30+ 文件                         scope_guard.py            │
│                                        → 共 8 个扁平文件          │
│                                                                  │
│  → 缺失：SoulStore、EchoStore、ImprintStore、AscensionManager    │
│     AutoForgeEngine、ForgeCodex、A2AManager、ForgekinCouncil     │
│  → v7.0 炉灵体系当前实现率 ≈ 10%                                  │
│  → 提出团队：glm / kimi / minimax / qianwen（四方）               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 6. 养灵体系命名方案对比分析（重点）

> ⚠️ 本章节是本次汇总的重点。原始养灵体系命名来自 `spec.md` 第 7.2 节，是 6 个团队命名方案的对比基准。

### 6.1 原始「炉灵 Forgekin」体系命名（spec.md 第 7.2 节权威源）

```
核心公式：Agent = Model + Harness + Soul
范式：从"驾驭野兽"到"养成灵体"
对标：clowder-ai 养猫体系
```

| 概念 | 中文名 | 英文名 | 对标 clowder-ai | 含义 |
|------|--------|--------|-----------------|------|
| 个体 | 炉灵 | Forgekin | Cat（猫猫） | 具备独立身份、记忆、人格的自进化智能体 |
| 群体 | 灵族 | Kinship | Clowder（猫群） | 一群协作的炉灵 |
| 养成 | 养灵 | Forge Nurturing | 养猫 | 炉灵从诞生到升华的全过程 |
| 入门训练 | 炉启 | Forge Initiation | Bootcamp | 新炉灵的入门训练 |
| 协作模式 | 共鸣 | Resonance | Swarm | 炉灵群体的协作模式 |
| 自主思考 | 自锻 | Auto-Forge | Auto-Dream | 无人驱动时的自主思考与进化 |
| 记忆 | 魂忆 | Soul Echo | Memory | 炉灵的累积记忆与经验 |
| 画像 | 魂印 | Soul Imprint | Profile | 炉灵对操作者/世界的认知画像 |
| 技能库 | 锻典 | Forge Codex | Skill Library | 炉灵积累的可复用知识体系 |
| 知识阶梯 | 火种等级 | Ember Hierarchy | L0-L4 Knowledge | 知识成熟度阶梯 |
| 成长阶段 | 升华阶 | Ascension Stages | 9 Lives | 炉灵成长的生命阶段 |
| IM 议事 | 灵议 | Forgekin Council | IM 团队协作 | 炉灵间的即时通讯与议事 |

**升华阶段（E1-E6）**：Spark（火种）→ Ember（余烬）→ Flame（火焰）→ Blaze（烈焰）→ Inferno（地狱火）→ Forge Master（锻师）

### 6.2 原始命名的核心问题（六方共同指出）

| # | 问题 | 提出团队 |
|---|------|----------|
| N1 | **术语过于"硬核玄幻"**：炉灵/灵族/养灵/炉启/魂忆/魂印/锻典/火种等级/升华阶/灵议——12 个概念全部需要用户学习 | deepseek、doubao、kimi、minimax |
| N2 | **过度依赖 clowder-ai 私有概念**：一旦 clowder-ai 项目方向调整或停止维护，FlowForge 整套养灵体系将失去参照系 | minimax |
| N3 | **ToB 场景接受度存疑**：企业用户可能觉得"炉灵/魂忆/魂印"过于玄幻不专业 | doubao、kimi |
| N4 | **英文国际化问题**：Soul（灵魂）在西方文化中有宗教色彩，可能引起误解 | kimi |
| N5 | **两套"E"前缀命名混淆**：锻典 E-L0~E-L4 vs 升华阶段 E1~E6 | deepseek |
| N6 | **与 FlowForge 品牌的一致性**：Forge 意象是优势还是束缚？ | glm、kimi |

### 6.3 六方命名方案详情（22 套并集）

#### 6.3.1 deepseek 团队（3 套方案，推荐 B）

**方案 A：灵锻 SpiritForge**
- 核心理念：保留"锻造"品牌基因 + "灵"生命感
- 个体/群体：灵锻体 SpiritForge / 灵锻群 SpiritForge Cluster
- 记忆/画像：灵忆 Spirit Echo / 灵印 Spirit Imprint
- 技能库：灵锻典 Spirit Codex
- 升华阶段：火种 Spark → 余烬 Ember → ... → 锻师 Forge Master（保留）

**方案 B：铸魂 SoulSmith**（⚠️ deepseek 推荐）
- 核心理念："铸造灵魂"，情感温度最高，"火候"概念零学习成本
- 个体/群体：铸魂体 SoulSmith / 铸魂群 SoulSmith Guild
- 记忆/画像：魂忆 Soul Echo（保留）/ 魂印 Soul Imprint（保留）
- 技能库：铸魂典 Soul Codex
- 升华阶段：星火 Spark → 初焰 First Flame → 炉火 Hearth Fire → 烈焰 Blaze → 锻火 Forge Fire → 铸魂大师 Soul Master

**方案 C：焰灵 Emberkin**
- 核心理念：全部以"焰/Ember"为核心，最简洁统一
- 个体/群体：焰灵 Emberkin / 焰群 Ember Cluster
- 记忆/画像：焰忆 Ember Echo / 焰印 Ember Imprint
- 技能库：焰典 Ember Codex
- 升华阶段：火星 Spark → 初焰 Ember → 火焰 Flame → 烈焰 Blaze → 烈火 Inferno → 焰师 Ember Master

#### 6.3.2 doubao 团队（3 套方案，推荐 A）

**方案 A：灵锻体系**（⚠️ doubao 推荐）
- 核心理念：兼顾项目特色与通用 AGI
- 个体/群体：灵锻体 SpiritForge / 灵锻群 Spirit Cluster
- 记忆/画像：灵忆 Spirit Echo / 灵纹 Spirit Imprint
- 技能库：灵锻典 Spirit Codex
- 架构调整：互联层下沉到接入层，保持七层
- 升华阶段：E1-E6（保留 Ember 体系）

**方案 B：灵成长体系**
- 核心理念：通俗易懂，ToB 友好
- 个体/群体：智能体 Agent / 成长记忆 Growth Memory / 技能库 Skill Library
- 去玄幻化：全部使用通用技术术语

**方案 C：源灵体系**
- 核心理念：更有 AGI 终极感
- 个体/群体：源灵 Source Spirit / 灵域 Spirit Domain
- 记忆/画像：溯忆 Source Echo / 灵纹 Source Imprint
- 技能库：灵藏 Spirit Vault
- 升华阶段：源种 Seed → 萌芽 Sprout → ... → 源灵至尊 Source Sovereign

#### 6.3.3 glm 团队（4 套方案，推荐 A 保留）

**方案 A：炉灵 Forgekin**（⚠️ glm 推荐保留）
- 核心理念：与 FlowForge 品牌一致，已有完整文档支撑
- 理由：命名已投入大量文档成本，术语体系自洽，Forge 意象与"锻造"品牌一致
- 优化：加强术语自洽定义，降低对 clowder-ai 的依赖

**方案 B：智体 Cognimate**
- 核心理念：认知科学背书，ToB 友好
- 个体/群体：智体 Cognimate / 智体群 Cognimate Cluster
- 记忆/画像：认知忆 Cognitive Echo / 认知印 Cognitive Imprint
- 技能库：智典 Cognitive Codex
- 升华阶段：C1-C6（Cognitive Stage 1-6）

**方案 C：锻灵 Forge-Soul**
- 核心理念：保留 Forge 意象，弱化玄幻感
- 个体/群体：锻灵 Forge-Soul / 锻灵群 Forge-Soul Cluster
- 记忆/画像：灵忆 Soul Echo / 灵印 Soul Imprint（保留）
- 技能库：锻典 Forge Codex（保留）

**方案 D：灵工 Aegis-Soul**
- 核心理念：守护者意象，适合安全要求高的 ToB 场景
- 个体/群体：灵工 Aegis-Soul / 灵工群 Aegis Cluster
- 记忆/画像：盾忆 Aegis Echo / 盾印 Aegis Imprint
- 技能库：护典 Aegis Codex
- 升华阶段：A1-A6（Aegis Stage 1-6）

#### 6.3.4 kimi 团队（3 套方案，推荐 A）

**方案 A：锻灵体系 Forgekin System**（⚠️ kimi 推荐）
- 核心理念：去宗教化（铭忆/铭刻替代魂忆/魂印），强化 Forge 意象
- 个体/群体：锻灵 Forgekin / 锻灵群 Forgekin Cluster
- 记忆/画像：铭忆 Echo Archive / 铭刻 Imprint Profile（去"Soul"宗教色彩）
- 技能库：锻典 Forge Codex（保留）
- 知识阶梯：火种等级 Ember Hierarchy（保留）
- 升华阶段：进化阶 Evolution Tiers（替代"升华阶"，去宗教色彩）
- AGI 演进路径：L1 工具 → L2 助手 → L3 伙伴 → L4 专家 → L5 创造者 → L6 共生体
- Slogan：Forge Intelligence, Evolving Souls

**方案 B：智锻体**
- 核心理念：企业级、工业化命名
- 个体/群体：智锻体 Forge Intel / 智锻群 Intel Cluster
- 记忆/画像：智忆 Intel Echo / 智印 Intel Imprint

**方案 C：保留炉灵但优化英文**
- 核心理念：去 Soul 宗教色彩（Echo Archive/Imprint Profile/Evolution Tiers）
- 中文保留炉灵，英文全部去 Soul

#### 6.3.5 minimax 团队（5 套方案，推荐 A）

**方案 A：灵锻体系**（⚠️ minimax 推荐）
- 核心理念：与 doubao 方案 A 相同，但采用八层架构（互联层独立为第 6 层）
- 个体/群体：灵锻体 SpiritForge / 灵锻群 Spirit Cluster
- 记忆/画像：灵忆 Spirit Echo / 灵纹 Spirit Imprint
- 技能库：灵锻典 Spirit Codex
- 升华阶段：E1-E6（保留 Ember 体系）

**方案 B：灵枢体系**
- 核心理念：AGI 终极感
- 个体/群体：灵枢 Spirit Hub / 灵子 Spirit Particle
- 记忆/画像：灵忆 Spirit Echo / 灵纹 Spirit Imprint
- 技能库：灵藏 Spirit Vault
- 议事：灵枢会 Spirit Council / 灵境 Spirit Realm
- 演化：灵演 Spirit Evolution

**方案 C：灵成长体系**
- 核心理念：通俗易懂，ToB 友好（与 doubao 方案 B 相同）

**方案 D：铸灵体系**
- 核心理念：金属工艺感，工业制造隐喻
- 个体/群体：铸灵 Forge Soul / 铸灵群 Forge Cluster
- 记忆/画像：铸忆 Forge Echo / 铸印 Forge Imprint
- 技能库：铸典 Forge Codex

**方案 E：养灵体系**（保留原方案）
- 核心理念：最小改动，直接使用 spec.md 原始命名

#### 6.3.6 qianwen 团队（4 套方案，推荐 C）

**方案 A：灵核 SoulCore**
- 核心理念："灵魂核心"概念
- 个体/群体：灵核 SoulCore / 灵核群 Core Cluster
- 记忆/画像：核忆 Core Echo / 核印 Core Imprint
- 技能库：核典 Core Codex

**方案 B：智灵 MindSpark**
- 核心理念："思维火花"概念
- 个体/群体：智灵 MindSpark / 智灵群 Spark Cluster
- 记忆/画像：智忆 Mind Echo / 智印 Mind Imprint
- 技能库：智典 Mind Codex

**方案 C：进化体 Evoling**（⚠️ qianwen 强烈推荐）
- 核心理念："Evolution + Being"新造词，直接体现"进化"核心理念
- 个体/群体：进化体 Evoling / 进化群体 Evolving Swarm
- 记忆/画像：进化忆 Evolution Echo / 进化印 Evolution Imprint
- 技能库：进化典 Evolution Codex
- 升华阶段用生态隐喻：Seed（种子）→ Sprout（萌芽）→ Sapling（树苗）→ Tree（成树）→ Forest（森林）→ Ecosystem（生态）
- 理由：去玄幻化、去宗教化、直接表达"进化"本质、生态隐喻更通用

**方案 D：灵子 Animon**
- 核心理念："Anima + Monad"哲学深度
- 个体/群体：灵子 Animon / 灵子群 Animon Cluster
- 记忆/画像：灵子忆 Anima Echo / 灵子印 Anima Imprint

### 6.4 命名方案对比矩阵

#### 6.4.1 个体命名对比

| 团队 | 方案 A | 方案 B | 方案 C | 方案 D | 方案 E | 推荐 |
|------|--------|--------|--------|--------|--------|------|
| 原始 | 炉灵 Forgekin | - | - | - | - | - |
| deepseek | 灵锻 SpiritForge | 铸魂 SoulSmith | 焰灵 Emberkin | - | - | B |
| doubao | 灵锻 SpiritForge | 智能体 Agent | 源灵 Source Spirit | - | - | A |
| glm | 炉灵 Forgekin（保留） | 智体 Cognimate | 锻灵 Forge-Soul | 灵工 Aegis-Soul | - | A |
| kimi | 锻灵 Forgekin | 智锻体 Forge Intel | 炉灵（优化英文） | - | - | A |
| minimax | 灵锻 SpiritForge | 灵枢 Spirit Hub | 智能体 Agent | 铸灵 Forge Soul | 炉灵 Forgekin | A |
| qianwen | 灵核 SoulCore | 智灵 MindSpark | 进化体 Evoling | 灵子 Animon | - | C |

#### 6.4.2 命名理念流派对比

| 流派 | 代表方案 | 核心理念 | 优势 | 劣势 | 支持团队 |
|------|----------|----------|------|------|----------|
| **保留派** | 炉灵 Forgekin | 与 FlowForge 品牌一致，文档已投入 | 零迁移成本，品牌一致 | 玄幻感强，ToB 不友好 | glm |
| **灵锻派** | 灵锻 SpiritForge | 兼顾 Forge 品牌与灵性 | 折中方案 | 与 Forge 仍有绑定 | doubao、minimax |
| **铸魂派** | 铸魂 SoulSmith | 情感温度最高 | 用户共鸣强 | 仍有 Soul 宗教色彩 | deepseek |
| **锻灵派** | 锻灵 Forgekin | 去 Soul 宗教化，保留 Forge | 国际化好 | 仍有 Forge 绑定 | kimi |
| **进化派** | 进化体 Evoling | 直接表达进化本质 | 去玄幻去宗教 | 失去品牌特色 | qianwen |
| **通俗派** | 智能体 Agent | ToB 友好通用 | 零学习成本 | 无差异化 | doubao(B)、minimax(C) |

#### 6.4.3 各团队对原始命名的态度

| 团队 | 是否保留原始命名 | 理由 |
|------|:----------------:|------|
| deepseek | ❌ 不保留 | 12 个概念学习成本高，情感温度不足 |
| doubao | ⚠️ 部分保留 | 保留 Forge 意象但改为"灵锻" |
| glm | ✅ 保留 | 品牌一致，文档已投入，优化即可 |
| kimi | ⚠️ 部分保留 | 保留中文炉灵但英文去 Soul |
| minimax | ❌ 不保留（但提供保留选项 E） | 玄幻感强，ToB 不友好 |
| qianwen | ❌ 不保留 | 过于理想化，应直接表达进化本质 |

---

## 7. 意见冲突标记

> ⚠️ 以下为 6 个团队之间明确存在的意见分歧，需要在动手前对齐。

### 7.1 命名方案推荐冲突（核心冲突）

| 冲突点 | 团队 A | 团队 B | 冲突说明 |
|--------|--------|--------|----------|
| 保留 vs 替换 | glm（推荐保留炉灵 Forgekin） | deepseek/doubao/minimax/qianwen（推荐替换） | glm 认为品牌一致性和文档投入成本重要；其他团队认为玄幻感和 ToB 接受度更重要 |
| 灵锻 vs 铸魂 | doubao、minimax（推荐灵锻 SpiritForge） | deepseek（推荐铸魂 SoulSmith） | 灵锻派兼顾 Forge 品牌，铸魂派追求情感温度 |
| 锻灵 vs 进化体 | kimi（推荐锻灵 Forgekin System） | qianwen（推荐进化体 Evoling） | kimi 保留 Forge 意象去 Soul，qianwen 完全去品牌化 |
| 中文保留 vs 英文优化 | kimi 方案 C（保留中文炉灵） | kimi 方案 A（中文改锻灵） | kimi 内部也有分歧：是否保留中文"炉灵" |
| 架构层数 | doubao 方案 A（七层，互联层下沉） | minimax 方案 A（八层，互联层独立） | 即使都选灵锻，架构层数方案不同 |

### 7.2 架构层数解决方案冲突

| 方案 | 描述 | 支持团队 | 反对理由 |
|------|------|----------|----------|
| **A 八层架构** | 自进化层(7) + 互联层(8) | minimax、doubao（部分）、glm（倾向） | 层数过多，宣传压力大 |
| **B 合并为"进化互联层"** | 将 A2A 纳入自进化层 | - | 概念边界模糊 |
| **C 互联层下移为接入层扩展** | 互联层是接入层(5)的增强 | doubao（方案 A）、qianwen | 低估 A2A 战略地位 |
| **D 自进化作为贯穿层** | 不作为独立层，cross-cutting | - | 弱化自进化战略地位 |

### 7.3 E6 Forge Master 评估冲突

| 团队 | 对 E6 的态度 | 理由 |
|------|-------------|------|
| deepseek | 🔴 指出循环依赖 Bug | E6 晋升需创建炉灵，但创建炉灵需先成为 E6 |
| qianwen | ⚠️ 过于理想化 | LLM 本质是统计模型，无法真正"发现盲区"，建议降级为"人类引导下发现盲区" |
| doubao | 无特殊批评 | 认为设计合理 |
| glm | 未明确批评 | - |
| kimi | 未明确批评 | - |
| minimax | 未明确批评 | - |

### 7.4 FlowForge agents/ P8A 状态冲突

| 团队 | 审核轮次 | 发现 |
|------|----------|------|
| minimax | 第三轮 | 🔴 仍有 14+ 业务专属 Agent（topic_research/article_writing/seo_optimization 等） |
| kimi | 第五轮 | ✅ 已清理至 generic/，但 declarative_agent.py:750 残留硬编码 |
| glm | 第四轮 | ✅ 已清理至 generic/，但 declarative_agent.py:750 残留硬编码 |

**结论**：业务 Agent 文件已清理（kimi/glm 确认），但硬编码提示词残留问题仍存在。minimax 审核较早，状态已过时。

### 7.5 no-classifier 红线表述冲突

| 团队 | 建议表述 | 理由 |
|------|----------|------|
| 原始 spec.md | "No-Classifier Principle — 禁止依赖 AI 分类器做关键决策" | 隐私保护 |
| doubao | "No-Sole-Classifier — 关键决策不能仅依赖 AI 分类器" | T7 审核/事实核查本身就是 LLM-as-Judge，完全禁止不可行 |
| qianwen | 需明确禁止采集字段列表 | 参考 GDPR/CCPA |
| glm | 无特殊修改建议 | - |

### 7.6 升华阶段判定执行者冲突

| 团队 | 建议的判定执行者 | 权重分配 |
|------|-----------------|----------|
| doubao | 量化指标 + Council 投票 + 人工确认 | 70% + 20% + 10% |
| qianwen | 人工审核 + LLM 辅助 | 未明确权重 |
| minimax | 可观测+可验证体系 | 未明确权重 |
| glm | 未明确 | - |
| kimi | 未明确 | - |
| deepseek | 未明确（但指出 E1→E2 永不可能的 Bug B4） | - |

### 7.7 Soul Echo L3 实现路径冲突

| 团队 | L3 实现建议 |
|------|------------|
| qianwen | 初期采用"人工审核+LLM 辅助"模式，引入知识成熟度阶梯 |
| doubao | 补充详细记忆系统设计，参考"忆层"设计 |
| minimax | 指定存储后端（Qdrant/Milvus） |
| glm | 未给出具体算法，但指出 sqlite-vec Windows 兼容性问题 |

### 7.8 对 clowder-ai 依赖程度冲突

| 团队 | 对 clowder-ai 对标的态度 |
|------|-------------------------|
| deepseek | 对标明智，养猫体系经过实战验证 |
| minimax | ⚠️ 过度依赖，应降级为"参考项" |
| qianwen | ⚠️ clowder-ai 是商业产品，细节未完全公开，需警惕过度理想化 |
| glm | 建议加强术语自洽定义，降低依赖 |
| doubao | 无特殊批评 |
| kimi | 无特殊批评 |

---

## 8. 共识点（所有团队一致同意）

> 以下为 6 个团队达成共识的问题，无需进一步对齐，可直接进入修复阶段。

### 8.1 范式跃迁方向正确

- **共识**：从"驾驭野兽"到"养成灵体"的范式跃迁方向正确，符合 AGI 发展趋势
- **支持团队**：全部 6 方

### 8.2 两类智能体分离设计合理

- **共识**：Static Agent（工具型）与 Forgekin（自进化型）分离设计合理，避免过度工程化
- **支持团队**：全部 6 方

### 8.3 Feature Flag 降级策略完善

- **共识**：6 个 v7.0 flag 全部默认关闭，每个都有明确降级路径，风险可控
- **支持团队**：deepseek、glm、kimi

### 8.4 升华阶段 E1-E6 游戏化设计有吸引力

- **共识**：E1→E6 的进阶体系类似游戏职业等级，激发用户养成欲
- **支持团队**：全部 6 方

### 8.5 Harness 层与自进化层应明确分工

- **共识**：Harness 层（第 4 层）= 单次任务内质量控制；自进化层（第 7 层）= 跨任务能力提升
- **支持团队**：doubao、glm、kimi、minimax

### 8.6 硬编码提示词必须外置

- **共识**：所有硬编码提示词必须迁移到 YAML 配置，违反编程红线第 11 条
- **支持团队**：glm、kimi、deepseek

### 8.7 evolution/ 代码必须同步 v7.0 术语

- **共识**：evolution/ 代码的 v4.0 术语必须更新为 v7.0 设计术语
- **支持团队**：glm、kimi、deepseek、minimax

### 8.8 M18-M20 必须彻底删除

- **共识**：face 文档中所有 M18/M19/M20 引用必须清理
- **支持团队**：doubao、glm、kimi、minimax

### 8.9 版本号必须统一

- **共识**：spec.md/arch.md/design.md 标题版本号必须与内容版本一致
- **支持团队**：doubao、glm、kimi、minimax

---

## 9. 建议的下一步行动

> ⚠️ 用户明确要求："先不要更新文档和写代码，等我们把审核意见对齐后再开始动手"。以下为对齐后的建议行动顺序。

### 9.1 需要优先对齐的决策点

| # | 决策点 | 选项 | 影响 |
|---|--------|------|------|
| D1 | **养灵体系命名** | A.保留炉灵 / B.灵锻 / C.铸魂 / D.锻灵 / E.进化体 | 影响所有文档和代码术语 |
| D2 | **架构层数** | A.八层 / B.七层(互联层下沉) / C.七层(合并进化互联) | 影响 arch.md/arch_face.md |
| D3 | **E6 Forge Master** | A.保留原设计 / B.降级为"人类引导下发现盲区" / C.修复循环依赖 Bug | 影响 spec.md 第 7.4 节 |
| D4 | **no-classifier 红线** | A.保留原表述 / B.改为"No-Sole-Classifier" | 影响 spec.md SR-01 |
| D5 | **升华阶段判定执行者** | A.量化指标为主 / B.Council 投票为主 / C.人工确认为主 | 影响 spec.md 第 7.4 节 |
| D6 | **Soul Echo L3 实现** | A.人工审核+LLM 辅助 / B.全自动 LLM 抽象 / C.知识成熟度阶梯 | 影响 design.md |
| D7 | **对 clowder-ai 依赖** | A.必要项 / B.参考项 | 影响 spec.md 第 7.2 节 |

### 9.2 对齐后的修复优先级

```
Phase 1（术语对齐，P0）：
  1. 决定养灵体系最终命名（D1）
  2. 更新 evolution/ 代码术语为 v7.0（P0-1）
  3. 清理 M18-M20 残留（P0-7）
  4. 统一版本号（P0-6）
  5. 外置硬编码提示词（P0-3, P0-14）

Phase 2（架构对齐，P0）：
  6. 决定架构层数方案（D2）
  7. 明确 ForgekinEngine 与 LoopExecutor 关系（P0-5）
  8. 修复 design.md 代码 Bug（P0-15）
  9. 补充缺失的 v7.0 配置文件（P0-10）
  10. 定义 PluginProtocol V3 钩子（P0-11）

Phase 3（实现补齐，P1）：
  11. 补充 evolution/ 缺失模块（P0-2）
  12. 定义升华阶段判定执行者（D5）
  13. 设计 Soul Echo L3 实现路径（D6）
  14. 增加 Auto-Forge 退化防护（P1-3）
  15. 明确 M4 Guardrails 与 SR-01~08 层级关系（P1-4）

Phase 4（测试与合规，P1-P2）：
  16. 移除 MockLLM，改用真实 LLM（P0-9）
  17. memory/ 模块接入 Repository 层（P0-13）
  18. 验证 Windows 11 兼容性（P2-5）
```

### 9.3 命名方案决策建议

> 作为高级 AI 智能体架构专家，基于 6 方审核意见的综合分析，给出以下决策建议（仅供参考，最终由 operator 决定）。

**推荐方案**：**kimi 方案 A「锻灵 Forgekin System」** + **doubao/minimax 方案 A「灵锻 SpiritForge」的折中**

理由：
1. **保留 Forge 品牌基因**：与 FlowForge 品牌一致（glm 的核心论点）
2. **去 Soul 宗教色彩**：英文用 Echo Archive / Imprint Profile 替代 Soul Echo / Soul Imprint（kimi 的核心论点）
3. **中文可接受度高**：锻灵比炉灵通俗，比智能体有特色
4. **国际化友好**：Forgekin 在英文中无宗教含义
5. **迁移成本低**：仅需修改英文术语，中文"炉灵→锻灵"变化小
6. **升华阶段用进化阶**：去宗教化（kimi 建议）

**不推荐完全替换为"进化体 Evoling"**（qianwen 方案 C）的理由：
- 失去 FlowForge 品牌特色
- 生态隐喻（Seed→Tree→Forest）与 Forge 锻造意象断裂
- 完全去品牌化会导致与 FlowForge 生态脱节

---

## 附录：六方审核文件索引

| # | 文件 | 团队 | 轮次 | 核心贡献 |
|---|------|------|------|----------|
| 1 | `deepseek.md` | deepseek | 第四轮 | 5 个代码 Bug、E6 循环依赖、章节编号冲突 |
| 2 | `doubao.md` | doubao | 第二轮 | 架构冲突全景图、ForgekinEngine vs LoopExecutor 对比 |
| 3 | `glm.md` | glm | 第四轮 | 代码实测验证、术语冲突根因定位、4 套命名方案 |
| 4 | `kimi.md` | kimi | 第五轮 | PluginProtocol V3 缺失、v7.0 配置缺失、去宗教化命名 |
| 5 | `minimax.md` | minimax | 第三轮 | 9 大项目一致性核查、5 套命名方案、商业化路径 |
| 6 | `qianwen.md` | qianwen | 第三轮 | 实现状态量化（0% 实现）、分阶段落地策略、Evoling 命名 |

---

> **本汇总文档为审核意见对齐用，不涉及任何设计文档或代码修改。**
> **请 operator 评审本文件，特别是第 7 章「意见冲突标记」和第 9.1 节「需要优先对齐的决策点」。**
> **对齐完成后，再开始动手修改设计文档和代码。**
