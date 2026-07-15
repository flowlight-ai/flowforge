# FlowForge 生态整体落地计划

> 版本：v1.0 | 日期：2025-06-15
> 基于 task.md (280项问题) + optimization_plan.md (65+ OpenCode借鉴模式)

## 一、总体目标

将 FlowForge 生态从当前 v0.1.0 骨架状态推进到 v1.0 生产可用状态，分4个阶段：
- Phase 0: 框架能力补齐（让*Forge可以通过配置驱动）
- Phase 1: 基础设施加固（Session持久化、LLM路由、权限系统等）
- Phase 2: 核心能力升级（System Context代数、Compaction、Tool输出边界等）
- Phase 3: 生态与体验完善（Plugin Hook、Markdown Skill、MCP Remote等）

## 二、Phase 0 — 框架能力补齐（第负一优先级）

### 2.1 目标
让*Forge项目可以通过YAML配置驱动，而非代码继承

### 2.2 关键交付物
| 编号 | 交付物 | 影响 | 预期效果 |
|------|--------|------|---------|
| FWK-01 | Workflow YAML Compiler | 全部4个项目 | YAML定义→执行图自动编译，消除5个独立Orchestrator |
| FWK-02 | Conditional Router | CF/NF/MF | 根据条件选择不同prompt/工具链/路径，消除if-else硬编码 |
| FWK-03 | Fallback Chain | CF/NF/MF | 工具调用有序回退链声明式定义，消除4处硬编码回退 |
| FWK-04 | State Param Mapping | CF/NF | 从state自动填充agent输入参数 |
| FWK-05 | Persona Auto-Inject | CF | persona SOUL/MEMORY/CREATION自动注入prompt |
| FWK-06 | Reflexion Loop | CF/DF | max_rounds+threshold+check_tool+retry_prompt声明式定义 |
| FWK-07 | Agent Pipeline | MF | 串行步骤定义+步骤间数据传递 |
| FWK-08 | Scoring Rubric | CF | 维度/权重/阈值/风险规则声明式定义 |
| FWK-09 | DeclarativeAgent增强 | NF | state_updates/permissions/tools/max_steps/hidden配置 |

### 2.3 验收标准
- Agent配置驱动率从0%提升到≥80%
- Tool配置驱动率从0%提升到≥60%
- Workflow配置驱动率从17%提升到≥90%
- *Forge项目可删除约7871行重复代码

## 三、Phase 1 — 基础设施加固（P0级）

### 3.1 FlowForge 基础设施
| 编号 | 交付物 | OpenCode借鉴 | 优先级 |
|------|--------|-------------|--------|
| INF-01 | LLM路由层重构 | Protocol/Route/Provider三层分离 | P0 |
| INF-02 | Session持久化与恢复 | 事件溯源+RunCoordinator | P0 |
| INF-03 | DI容器升级 | — | P0 |
| INF-04 | Tool输出边界 | ToolOutputStore | P0 |
| INF-05 | 增量摘要Compaction | 双阈值+Overflow恢复 | P0 |
| INF-06 | 指数退避重试 | retry+瞬态错误检测 | P0 |
| INF-07 | SSE超时保护 | wrapSSE | P0 |
| INF-08 | 十层安全防御 | — | P0 |
| INF-09 | 架构边界清理 | — | P0 |

### 3.2 DevForge 基础设施
| 编号 | 交付物 | 优先级 |
|------|--------|--------|
| DEV-01 | 四种任务类型workflow模板 | P0 |
| DEV-02 | 金丝雀发布与自动回滚 | P0 |
| DEV-03 | 代码执行沙箱 | P0 |

### 3.3 ContentForge 基础设施
| 编号 | 交付物 | 优先级 |
|------|--------|--------|
| CTF-01 | 六大专家Agent实现 | P0 |
| CTF-02 | 多Agent Workflow协作 | P0 |
| CTF-03 | Playwright多平台发布 | P0 |
| CTF-04 | Web控制台6大页面 | P0 |

### 3.4 NovelForge 基础设施
| 编号 | 交付物 | 优先级 |
|------|--------|--------|
| NVF-01 | 一致性检测5个Tool实现 | P0 |
| NVF-02 | 八大阶段Agent执行模式修正 | P0 |

## 四、Phase 2 — 核心能力升级（P1级）

### 4.1 FlowForge 核心能力
| 编号 | 交付物 | OpenCode借鉴 |
|------|--------|-------------|
| CAP-01 | System Context代数系统 | Source<A>代数 |
| CAP-02 | Permission V2有序规则集 | findLast+ask三态 |
| CAP-03 | Stale Tool Rejection | identity版本控制 |
| CAP-04 | Agent步数限制+隐藏Agent | max_steps+hidden |
| CAP-05 | Agent权限规则集 | per-agent permissions |
| CAP-06 | Agent工具过滤 | per-agent tool visibility |
| CAP-07 | 文件编辑Stale Content检测 | 乐观锁 |
| CAP-08 | Token估算+小模型选择 | estimate+small() |
| CAP-09 | Context Epoch | 上下文快照+乐观锁 |
| CAP-10 | 流式工具并行执行 | Eager tool settlement |
| CAP-11 | 持久化事件流 | Durable Event Stream |
| CAP-12 | Credential安全存储 | CredentialTable |
| CAP-13 | 配置层级搜索 | Global→Project→.flowforge |

### 4.2 DevForge 核心能力
| 编号 | 交付物 |
|------|--------|
| DEV-CAP-01 | 门禁三种投票策略 |
| DEV-CAP-02 | 门禁超时策略 |
| DEV-CAP-03 | 门禁人工确认和升级 |
| DEV-CAP-04 | 14个业务Agent执行模式修正 |
| DEV-CAP-05 | Git操作安全防护 |
| DEV-CAP-06 | 部署环境隔离 |

### 4.3 ContentForge 核心能力
| 编号 | 交付物 |
|------|--------|
| CTF-CAP-01 | LangGraph SOP检查点验证 |
| CTF-CAP-02 | 选题搜索三级降级 |
| CTF-CAP-03 | 模型治理健康检查+自动切换 |

### 4.4 NovelForge 核心能力
| 编号 | 交付物 |
|------|--------|
| NVF-CAP-01 | SOUL 8维度完整定义 |
| NVF-CAP-02 | 伏笔回收率追踪 |
| NVF-CAP-03 | 全局一致性分析 |
| NVF-CAP-04 | Reflexion降级机制 |

## 五、Phase 3 — 生态与体验完善（P2级）

| 编号 | 交付物 | OpenCode借鉴 |
|------|--------|-------------|
| ECO-01 | Plugin Hook增强 | Immer Draft模式 |
| ECO-02 | Markdown Skill系统 | SKILL.md frontmatter |
| ECO-03 | MCP Remote模式+OAuth | Local/Remote双模式 |
| ECO-04 | 文件快照+Undo | Session级diff聚合 |
| ECO-05 | DevForge通用逻辑下沉 | — |
| ECO-06 | HTTP录制测试 | cassette测试 |
| ECO-07 | VS Code扩展 | — |
| ECO-08 | 自动标题/摘要生成 | title/summary agent |

## 六、各项目落地时间线

### 6.1 FlowForge
| 阶段 | 关键里程碑 | 交付物 |
|------|-----------|--------|
| Phase 0 | FWK-01~09框架能力 | Workflow Compiler + Conditional Router + Fallback Chain + DeclarativeAgent增强 |
| Phase 1 | 基础设施加固 | LLM路由层 + Session持久化 + DI容器 + Tool输出边界 + 安全防御 |
| Phase 2 | 核心能力升级 | System Context代数 + Permission V2 + Agent权限 + 流式工具并行 |
| Phase 3 | 生态完善 | Plugin Hook + Markdown Skill + MCP Remote + 文件快照 |

### 6.2 DevForge
| 阶段 | 关键里程碑 | 交付物 |
|------|-----------|--------|
| Phase 0 | 配置驱动化 | 4种workflow YAML模板 + 门禁YAML配置 |
| Phase 1 | 核心功能实现 | 金丝雀发布 + 代码沙箱 + Git安全防护 |
| Phase 2 | Agent能力升级 | 14个Agent执行模式修正 + 门禁投票策略 |
| Phase 3 | 生态集成 | 通用逻辑下沉 + VS Code扩展 |

### 6.3 ContentForge
| 阶段 | 关键里程碑 | 交付物 |
|------|-----------|--------|
| Phase 0 | 配置驱动化 | 6个专家Agent YAML定义 + SOP YAML定义 |
| Phase 1 | 核心功能实现 | 6个专家Agent + Playwright发布 + Web控制台 |
| Phase 2 | 能力升级 | 模型治理 + 选题降级链 + RAG知识中枢 |
| Phase 3 | 生态完善 | Markdown Skill + MCP Remote |

### 6.4 NovelForge
| 阶段 | 关键里程碑 | 交付物 |
|------|-----------|--------|
| Phase 0 | 配置驱动化 | 8个阶段Agent YAML定义 + 质量门YAML配置 |
| Phase 1 | 核心功能实现 | 一致性检测5个Tool + Agent执行模式修正 |
| Phase 2 | 能力升级 | SOUL完整8维度 + 伏笔追踪 + 全局一致性 |
| Phase 3 | 生态完善 | 冻结续写完善 + 版本管理 + 回溯修改 |

## 七、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| FWK-01 Workflow Compiler复杂度高 | Phase 0延期 | 先实现核心子集（顺序/条件/并行），迭代扩展 |
| LLM路由重构影响现有功能 | 回归风险 | 保留旧LLMClient适配器，新路由并行运行 |
| Session持久化性能开销 | 响应变慢 | 异步写入+批量提交，关键路径同步 |
| *Forge删除重复代码可能引入Bug | 功能回归 | 分批删除，每批后全量回归测试 |
| DevForge金丝雀发布依赖K8s | 环境限制 | 先实现Docker Compose版本，再扩展K8s |

## 八、验收标准总览

| 阶段 | 验收标准 |
|------|---------|
| Phase 0 | Agent配置驱动率≥80%, Tool≥60%, Workflow≥90%; *Forge可删除7871行重复代码 |
| Phase 1 | 新增Provider仅需1-2行配置; Session崩溃可恢复; 十层安全防御生效; DevForge 4种workflow可运行 |
| Phase 2 | 上下文变更只发差异; 权限支持ask三态; Agent有步数限制; 流式工具可并行执行 |
| Phase 3 | 插件可注册10+Hook; Skill支持Markdown定义; MCP支持Remote; 文件操作支持Undo |

---

## 九、当前状态评估

### 9.1 版本差距
| 项目 | 设计文档版本 | 代码版本 | 差距程度 |
|------|------------|---------|---------|
| FlowForge | v6.0/v7.0 | v0.1.0 | 严重 |
| DevForge | v2.0 | v0.1.0 | 严重 |
| ContentForge | v2.0 | v0.1.0 | 严重 |
| NovelForge | v1.0 | v0.1.0 | 严重 |

### 9.2 问题统计（来自task.md审计）
| 严重等级 | FlowForge | ContentForge | NovelForge | 公共 | 提示词 | 配置 | P14A | 合计 |
|----------|:---------:|:------------:|:----------:|:----:|:------:|:----:|:----:|:----:|
| P0 致命 | 0 | 0 | 1 | 0 | 3 | 1 | 31 | 36 |
| P1 严重 | 0 | 3 | 5 | 1 | 0 | 1 | 69 | 79 |
| P2 一般 | 5 | 2 | 3 | 2 | 0 | 1 | 106 | 119 |
| **合计** | **5** | **5** | **9** | **3** | **3** | **2** | **206** | **234** |

### 9.3 架构边界违反统计
- FlowForge含特定领域代码: 23处（~1100行 + 5配置文件）
- ContentForge含重复服务代码: 12处（~2867行）
- NovelForge含重复服务代码: 5处（~2027行）
- DevForge含重复服务代码: 7处（~1877行）
- **总计可删除重复代码: ~7871行**

### 9.4 配置驱动率
| 项目 | Agent配置声明 | Agent代码继承 | Tool配置声明 | Tool代码继承 | Workflow配置 | Workflow代码编排 |
|------|:-----------:|:-----------:|:-----------:|:-----------:|:-----------:|:-------------:|
| ContentForge | 0 | 7 | 0 | 3 | 0 | 3 SOP |
| NovelForge | 0 | 12 | 0 | 7 | 0 | 1 |
| DevForge | 0 | 20 | 0 | 5 | 0 | 1 |
| **合计** | **0** | **45** | **0** | **21** | **1** | **5** |

**当前配置驱动率**: Agent 0%, Tool 0%, Workflow 17%

### 9.5 硬编码提示词统计
FlowForge 77处 + ContentForge 24处 + NovelForge 14处 = **115处**

### 9.6 违反铁律统计
- 铁律5（禁止硬编码）: 80+ 处
- 铁律2（禁止假数据/假逻辑）: 15+ 处
- 铁律3（禁止绕过DI容器）: 8+ 处
- 铁律4（禁止直接SQL）: 12+ 处

---

## 十、OpenCode 对标差距总览

### 10.1 FlowForge 对标差距（30项）
| 优先级 | 数量 | 关键差距 |
|--------|------|---------|
| P0 | 8 | Session持久化、LLM路由、Tool输出边界、Compaction、安全防御、DeclarativeAgent增强 |
| P1 | 21 | System Context增量、Permission ask三态、Agent步数限制、Stale检测、Token估算等 |
| P2 | 1 | Skill版本管理 |

### 10.2 DevForge 对标差距（10项）
| 优先级 | 数量 | 关键差距 |
|--------|------|---------|
| P0 | 3 | 4种workflow模板、金丝雀发布、代码沙箱 |
| P1 | 7 | 门禁投票策略、Agent执行模式、Git安全、环境隔离 |

### 10.3 ContentForge 对标差距（8项）
| 优先级 | 数量 | 关键差距 |
|--------|------|---------|
| P0 | 4 | 六大专家Agent、多Agent协作、Playwright发布、Web控制台 |
| P1 | 4 | SOP检查点、选题降级链、模型治理 |

### 10.4 NovelForge 对标差距（6项）
| 优先级 | 数量 | 关键差距 |
|--------|------|---------|
| P0 | 2 | 一致性检测Tool、Agent执行模式 |
| P1 | 4 | SOUL 8维度、伏笔追踪、全局一致性、Reflexion降级 |

---

## 十一、实施策略

### 11.1 Phase 0 实施顺序
1. FWK-01 Workflow YAML Compiler → 消除5个独立Orchestrator
2. FWK-02 Conditional Router → 消除if-else策略路由
3. FWK-03 Fallback Chain → 消除硬编码回退逻辑
4. FWK-09 DeclarativeAgent增强 → 15个Agent可YAML化
5. FWK-04~08 按项目优先级逐步实现

### 11.2 架构边界清理顺序
1. FlowForge移出23处特定领域代码（~1100行）
2. ContentForge删除12处重复服务代码（~2867行）
3. NovelForge删除5处重复服务代码（~2027行）
4. DevForge删除7处重复服务代码（~1877行）

### 11.3 质量保障
- 每个Phase完成后进行全量回归测试
- 分批删除重复代码，每批后验证功能完整性
- 新增功能必须通过Prompt外置验证（禁止硬编码提示词）
- 所有新代码必须通过DI容器注入（禁止直接实例化）

---

> **本文档与各项目 docs/ 下的设计文档互补。各*Forge项目的具体落地计划见各自 docs/landing_plan.md。**
---

# [审核修订 v2.1] 六方联合审核修订增补

> 审核日期：2026-06-15 | 修订版本：v2.1

## 优先级调整 [审核修订 v2.1]

| 原项 | 原优先级 | 调整后 | 原因 |
|------|---------|--------|------|
| CAP-01 Source<A>代数 | P1 | **P3（推迟）** | 过度设计，当前阶段简单Dict足够 |
| INF-08 十层安全防御 | P0 | **P1（先实现L5/L6）** | 设计过于粗略，先实现两层 |
| ECO-07 VS Code扩展 | P2 | **P1（提前）** | DevForge核心竞争力 |
| CAP-10 FiberSet | P1 | **P2（降级）** | DevForge/ContentForge当前用不到 |

## 新增交付物 [审核修订 v2.1]

| 编号 | 交付物 | 优先级 | Phase | 说明 |
|------|--------|--------|-------|------|
| FWK-10 | 领域代码迁移方案 | P0 | Phase 0 | 23处领域代码~1100行迁移到*Forge |
| FWK-PROMPT | PromptManager统一设计 | P0 | Phase 0 | 115处硬编码提示词统一方案 |
| INF-11 | Repository层统一重构 | P1 | Phase 1 | 10+存储模块直接SQL重构 |
| INF-12 | 配置外置系统性整改 | P1 | Phase 1 | 数据库路径等硬编码外置 |
| NEW-01 | PromptManager统一协议 | P0 | Phase 0 | YAML Schema + 热加载 + 版本管理 |
| NEW-02 | Checkpoint Schema统一格式 | P1 | Phase 1 | 四个项目检查点格式统一 |
| NEW-03 | Workflow Compiler MVP验收用例 | P0 | Phase 0 | dev_hotfix.yaml能跑通 |
| NEW-04 | AgenticRAG vs OpenSieve边界 | P1 | Phase 1 | 避免检索能力重复建设 |
| NEW-05 | 性能基线设计 | P2 | Phase 2 | 关键组件性能指标 |
| NEW-06 | Playwright发布引擎详细设计 | P0 | Phase 1 | 登录态/反检测/选择器维护 |
| NEW-07 | 前端架构设计 | P1 | Phase 1 | ContentForge Web控制台技术方案 |
| NEW-DB-01 | Doubao Provider规格文件 | P0 | Phase 0 | models.yaml补全Doubao规格 |
| NEW-DB-02 | BaseTool function call Schema | P0 | Phase 0 | parameters_schema + to_function_call() |
| NEW-DB-03 | 统一提示词外置+Doubao重写 | P0 | Phase 0 | 115处硬编码提示词外置+最佳实践重写 |
| NEW-DB-04 | Persona注入规范化 | P1 | Phase 1 | ≤512 token + 成本审计 |
| NEW-DB-05 | Provider级成本/配额管理 | P1 | Phase 1 | ProviderQuotaManager |
| NEW-DB-06 | Doubao moderation内容安全层 | P0 | Phase 1 | 内容发布/代码生成前预检 |
| NEW-DB-07 | 多模型级联策略 | P1 | Phase 1 | Doubao主+Qwen/DeepSeek次级 |
| NEW-DB-08 | 中文格式规范检查 | P2 | Phase 2 | 标点/编号/日期/单位统一 |
| NEW-DB-09 | 流式输出一致性测试 | P2 | Phase 2 | Doubao SSE响应格式验证 |
| NEW-DB-10 | Doubao multi-modal接入规范 | P3 | Phase 3 | 封面图/插画/角色头像 |
| NEW-DB-11 | Agent模式与Doubao能力矩阵 | P1 | Phase 1 | 每个Agent推荐模式+A/B验证 |
| NEW-DB-12 | Skill系统知识沉淀机制 | P2 | Phase 2 | Agent成功产出自动写入Skill |
| NEW-DB-13 | Doubao对话上下文checkpoint | P1 | Phase 1 | 冻结续写checkpoint含对话历史 |
| NEW-DB-14 | 伏笔标记统一JSON Schema | P1 | Phase 1 | NovelForge伏笔半自动化标记 |
| NEW-DB-15 | 门禁打分prompt标准化 | P1 | Phase 1 | gate YAML增加gate_prompts块 |

## 实施节奏修订 [审核修订 v2.1]

从并行改为串行+小步快跑：

```
Week 1-2:   FWK-01 MVP（sequence + conditional + gate）
Week 2-3:   FWK-09 MVP（DeclarativeAgent YAML加载器）
Week 3-4:   FlowForge内部清理（删GAP-C01反向依赖 + BUG-FF-09/10）
Week 4-5:   ContentForge 6 Agent YAML化 + 4 SOP YAML化
Week 5-6:   DevForge 14 Agent + 8 Evaluator + 10 Gate YAML化
Week 6-7:   NovelForge 8 Agent + 6 QualityGate YAML化
Week 7-8:   FlowForge 12内置Agent + 14 Tool YAML化
Week 8-9:   INF-01 LLMRouter + 1个迁移示例
Week 9-10:  INF-02 EventStore MVP
Week 10-12: *Forge Phase 1核心功能
Week 12+:   Phase 2能力升级
```

## FWK-01 MVP里程碑 [审核修订 v2.1]

| 里程碑 | 支持StepType | 验收用例 |
|--------|-------------|---------|
| MVP-1 | SEQUENCE | 3步顺序执行workflow |
| MVP-2 | + CONDITIONAL | 条件分支workflow |
| MVP-3 | + GATE | dev_hotfix.yaml跑通 |
| 完整版 | + PARALLEL/FALLBACK/LOOP | dev_greenfield.yaml跑通 |

---

# [审核修订 v2.2] 六方联合审核修订增补（v2.1未覆盖项）

> 审核日期：2026-06-16 | 修订版本：v2.2 | 来源：6份专家审核意见并集，v2.1未覆盖部分

## 一、向后兼容切换策略时间线 [来源：审核FWK-01/FWK-06/INF-01]

每个Phase需明确新旧路径切换策略和旧代码删除时间线。

### Phase 0 切换策略

| 设计项 | 切换策略 | Feature Flag | 旧代码删除时间线 | 验收标准 |
|--------|---------|-------------|----------------|---------|
| FWK-01 WorkflowCompiler MVP | Feature Flag | `features.use_workflow_compiler` | Flag开启后2个minor版本 | dev_hotfix.yaml跑通 |
| FWK-09 DeclarativeAgent | Feature Flag | `features.use_declarative_agent` | Flag开启后1个minor版本 | 15个Agent可YAML加载 |
| FWK-10 领域代码迁移 | 硬切换 | N/A | 迁移完成后立即删除 | FlowForge中0处领域代码 |
| GAP-C01 反向依赖修复 | 硬切换 | N/A | 修复后立即删除 | flowforge.py无反向import |

### Phase 1 切换策略

| 设计项 | 切换策略 | Feature Flag | 旧代码删除时间线 | 验收标准 |
|--------|---------|-------------|----------------|---------|
| FWK-06 TurnTransitionEngine | Feature Flag | `features.use_turn_transition_v2` | Flag开启后1个minor版本 | 9状态覆盖原6+7状态 |
| INF-01 LLMRouter | A-B并行验证 | `features.use_llm_router` | 并行验证通过后1个minor版本 | 路由结果一致率≥99.5% |
| INF-02 EventStore | A-B并行验证 | `features.use_event_store` | 并行验证通过后1个minor版本 | 事件写入/读取一致性100% |
| INF-05 Compaction | Feature Flag | `features.use_dual_threshold_compactor` | Flag开启后1个minor版本 | 压缩后上下文可用性≥95% |
| INF-11 Repository层 | 硬切换 | N/A | 单PR合入后立即删除 | 所有SQL操作通过Repository |
| INF-12 配置外置 | 硬切换 | N/A | 单PR合入后立即删除 | 0处硬编码路径/密钥 |
| CAP-14 ArchitectureConstraint | Feature Flag | `features.use_constraint_engine` | Flag开启后1个minor版本 | 检测到循环依赖/跨层导入 |

### Phase 2+ 切换策略

| 设计项 | 切换策略 | Feature Flag | 旧代码删除时间线 |
|--------|---------|-------------|----------------|
| CAP-01 Source<A>代数 | Feature Flag | `features.use_context_algebra` | Flag开启后2个minor版本 |
| CAP-10 FiberSet | Feature Flag | `features.use_fiber_set` | Flag开启后1个minor版本 |
| ECO-07 VS Code扩展 | 新增 | N/A | N/A |

## 二、灾备降级设计纳入计划 [来源：审核INF-01/INF-02/CAP-02]

每个Phase 1核心功能配降级决策树。

### Phase 0 降级项

| 组件 | 降级策略 | 降级触发条件 | 恢复条件 |
|------|---------|------------|---------|
| WorkflowCompiler | 使用硬编码SOP | YAML编译失败 | YAML修复后重新编译 |

### Phase 1 降级项

| 组件 | 降级策略 | 降级触发条件 | 恢复条件 |
|------|---------|------------|---------|
| LLMRouter | 切换到备选Provider | 主Provider连续3次超时 | 主Provider健康检查通过 |
| EventStore | 内存List暂存+定期flush | SQLite写入失败3次 | SQLite恢复写入 |
| PersonaInjector | 使用默认Persona | Persona文件损坏/缺失 | Persona文件修复 |
| Compaction | 丢弃最旧消息 | LLM摘要失败 | LLM恢复可用 |
| Gate评估 | fail-open（放行+告警） | 评估超时10s | 评估服务恢复 |

### 降级事件契约

```python
@dataclass
class DegradeToHumanEvent:
    task_id: str
    component: str
    original_error: str
    degradation_reason: str
    context_snapshot: Dict[str, Any]
    suggested_action: str
    urgency: Literal["low", "medium", "high", "critical"]
    created_at: datetime
```

## 三、测试策略纳入计划 [来源：审核FWK-01/INF-01/CAP-14]

### 3.1 测试套件规划

```
tests/
├── config/                                 # Phase 0 新增
│   ├── test_workflow_yaml_validation.py    # YAML Schema校验
│   ├── test_persona_yaml_validation.py     # Persona格式校验
│   ├── test_model_routes_yaml.py           # 模型路由配置校验
│   └── test_system_yaml_defaults.py        # 系统配置默认值校验
├── integration/                            # Phase 1 新增
│   ├── test_workflow_e2e.py                # Workflow端到端
│   ├── test_llm_router_e2e.py              # LLM路由端到端
│   ├── test_event_store_e2e.py             # EventStore端到端
│   ├── test_gate_e2e.py                    # Gate评估端到端
│   ├── test_doubao_stream.py               # SSE流式输出一致性
│   └── test_degradation_e2e.py             # 降级链路端到端
├── cassettes/                              # HTTP Cassette录制目录
│   ├── doubao_chat_response.yaml
│   ├── helixrag_search_response.yaml
│   └── qwen_fallback_response.yaml
└── unit/                                   # 现有单元测试
```

### 3.2 各Phase测试交付物

| Phase | 新增测试 | 验收标准 |
|-------|---------|---------|
| Phase 0 | config/ 4个测试文件 | 所有YAML配置校验通过 |
| Phase 1 | integration/ 6个测试文件 | 所有E2E测试通过（含Cassette回放） |
| Phase 2 | 性能基线测试 | 所有SLO指标达标 |

### 3.3 HTTP Cassette录制策略

```python
# conftest.py
@pytest.fixture
def vcr_config():
    return {
        "cassette_library_dir": "tests/cassettes",
        "record_mode": "once",  # 首次录制，后续回放
        "filter_headers": ["authorization"],
        "decode_compressed_response": True,
    }
```

## 四、SSE一致性测试纳入计划 [来源：审核NEW-DB-09]

### Phase 1 新增：test_doubao_stream.py

```python
# tests/integration/test_doubao_stream.py
@pytest.mark.vcr
async def test_doubao_sse_format_consistency():
    """验证Doubao SSE响应格式与OpenAI兼容"""
    client = LLMClient(provider="doubao")
    chunks = []
    async for chunk in client.chat_stream(
        model="doubao-seed2",
        messages=[{"role": "user", "content": "请用三句话描述微服务架构的优势"}],
    ):
        chunks.append(chunk)
        assert hasattr(chunk, "choices")
        assert hasattr(chunk.choices[0], "delta")

    full_response = await client.chat(
        model="doubao-seed2",
        messages=[{"role": "user", "content": "请用三句话描述微服务架构的优势"}],
    )
    streamed_content = "".join(c.choices[0].delta.content or "" for c in chunks)
    assert streamed_content == full_response.content
```

| 里程碑 | 测试项 | 验收标准 |
|--------|--------|---------|
| Phase 1 Week 9 | test_doubao_stream.py | SSE格式兼容+流式拼接一致 |

## 五、中文格式规范检查纳入计划 [来源：审核NEW-DB-08]

### Phase 1 新增：ChineseFormatChecker

| 里程碑 | 交付物 | 验收标准 |
|--------|--------|---------|
| Phase 1 Week 5 | ChineseFormatChecker实现 | 4条规则（标点/编号/日期/单位）检测通过 |
| Phase 1 Week 5 | persona/base.yaml format_guidelines段 | Persona注入后中文格式违规率<5% |

```python
class ChineseFormatChecker:
    RULES = {
        "punctuation": {"pattern": r'[\u4e00-\u9fff]\s*[,.!?;:]\s*[\u4e00-\u9fff]', ...},
        "numbering": {"pattern": r'第\s*(\d+)\s*章', ...},
        "date_format": {"pattern": r'\d{4}/\d{1,2}/\d{1,2}', ...},
        "unit_spacing": {"pattern": r'\d+\s*(个|次|篇|章|节|条|项|款|种|类|份|期|轮|遍|套|组|批|段|步|层|级)', ...},
    }
```

## 六、多模态接入纳入计划 [来源：审核NEW-DB-10]

| Phase | 交付物 | 验收标准 |
|-------|--------|---------|
| Phase 0 | doubao-seed2 文本模型接入 | 文本生成正常 |
| Phase 3 | doubao-seed2-vision 图像理解 | 封面图审核/素材分析 |
| Phase 3 | doubao-seed2-image 图像生成 | 封面图/插画/角色头像 |
| Phase 4+ | 音频模态 | 语音播报 |

### MultiModalProvider接口

```python
class MultiModalProvider:
    SUPPORTED_MODALITIES = ["text", "image", "audio", "video"]
    async def generate(self, modality: str, prompt: str, model: str, **kwargs) -> MultiModalResult: ...
```

## 七、Skill知识沉淀纳入计划 [来源：审核NEW-DB-12]

| Phase | 交付物 | 验收标准 |
|-------|--------|---------|
| Phase 2 | SkillKnowledgePrecipitator实现 | 成功任务自动提取知识 |
| Phase 2 | config/system.yaml skill_precipitation配置 | min_quality_score=0.8 |

```python
class SkillKnowledgePrecipitator:
    async def precipitate(self, task_result: TaskResult) -> Optional[SkillEntry]:
        if not task_result.success:
            return None
        decisions = self._extract_decisions(task_result.trace)
        prompt_patterns = self._extract_prompt_patterns(task_result.trace)
        tool_chains = self._extract_tool_chains(task_result.trace)
        if decisions or prompt_patterns or tool_chains:
            return SkillEntry(skill_id=f"auto-{task_result.task_id}", ...)
```

## 八、密钥迁移纳入计划 [来源：审核INF-12/CAP-02]

| Phase | 交付物 | 验收标准 |
|-------|--------|---------|
| Phase 1 Week 8 | CredentialMigrationRunbook | 旧SecretStore→新CredentialStore迁移脚本 |
| Phase 1 Week 8 | FLOWFORGE_MASTER_KEY环境变量 | 所有密钥加密存储 |

### 迁移步骤

```
1. 设置 FLOWFORGE_MASTER_KEY 环境变量
2. 初始化新 CredentialStore
3. 读取旧 SecretStore 所有密钥
4. 写入新 CredentialStore
5. 验证迁移完整性（逐条比对）
6. 备份旧存储
7. 更新 config/system.yaml: credential_store.backend: "encrypted"
```

## 九、删除代码回归测试纳入计划 [来源：审核FWK-10/INF-11]

| Phase | 删除项 | 回归测试策略 |
|-------|--------|------------|
| Phase 0 | GAP-C01 反向import | git grep验证0引用 + pytest回归 |
| Phase 0 | FWK-10 领域代码迁移（23处~1100行） | HTTP Cassette录制外部服务响应，回放验证 |
| Phase 1 | 旧Orchestrator | test_old_orchestrator_removed + Cassette回放 |
| Phase 1 | 旧SecretStore | 密钥迁移Runbook验证 |
| Phase 1 | 直接SQL操作 | Repository层测试覆盖 |

### 删除验收流程

```
1. git grep 搜索旧代码所有引用 → 0引用
2. pytest --collect-only 确认无测试依赖旧路径
3. 运行全量E2E测试（含HTTP Cassette录制回放）
4. 删除旧代码 + 删除Feature Flag
5. 再次全量回归验证
```

## 十、CAP-14 Harness护栏集成纳入计划 [来源：审核CAP-14]

| Phase | 交付物 | 验收标准 |
|-------|--------|---------|
| Phase 1 Week 6 | ArchitectureConstraintEngine实现 | 检测到循环依赖/跨层导入 |
| Phase 1 Week 6 | EntropyManager实现 | 熵值>0.3时告警 |
| Phase 1 Week 6 | CI集成 | PR提交时自动检查架构约束 |

```yaml
# CI新增步骤
- name: Architecture Constraint Check
  run: |
    python -m flowforge.core.constraints check --path flowforge/
    python -m flowforge.core.entropy measure --path flowforge/ --max-entropy 0.3
```

## 十一、INF-01 LLM路由层代码设计纳入计划 [来源：审核INF-01]

| Phase | 交付物 | 验收标准 |
|-------|--------|---------|
| Phase 1 Week 8 | LLMRouter实现 | 多Provider智能路由+健康检查+限流 |
| Phase 1 Week 8 | ProviderHealthChecker实现 | 连续3次失败自动标记不健康 |
| Phase 1 Week 8 | config/models.yaml路由配置 | openroute+openrouter双Provider |

### LLMRouter核心接口

```python
class LLMRouter:
    async def chat(self, model: str, messages: List[Dict], **kwargs) -> LLMResponse:
        # 按优先级尝试Provider，含健康检查+限流+回退
        ...
```

## 十二、Agent DX设计纳入计划 [来源：审核ECO-07]

| Phase | 交付物 | 验收标准 |
|-------|--------|---------|
| Phase 1 Week 10 | CLI调试命令 `flowforge agent debug` | 单步模式+轨迹输出 |
| Phase 2 | 执行轨迹JSON格式 | trace_id全链路追踪 |
| Phase 2 | VS Code扩展集成 | launch.json配置一键调试 |

### CLI调试命令

```bash
flowforge agent debug \
  --agent devforge:coder \
  --input '{"task": "修复登录页面CSS错位"}' \
  --trace-dir ./traces \
  --step  # 单步模式
```

## 十三、Helm可视化体验纳入计划 [来源：审核ECO-07]

| Phase | 交付物 | 验收标准 |
|-------|--------|---------|
| Phase 1 Week 10 | Helm基础交互 | 工作区切换+任务列表+步骤进度 |
| Phase 2 | 工具调用链面板 | 折叠式展示input/output/latency |
| Phase 2 | Agent节点图标 | workflow🧩/agent🤖/llm💬/tool🔧 |
| Phase 2 | 长任务防卡死 | 虚拟滚动+分页加载 |

### 关键交互规范

| 交互元素 | 规范 | 实现要点 |
|---------|------|---------|
| 工作区切换 | 左侧面板，点击即切换 | WebSocket推送 |
| 步骤进度条 | ▶运行/■暂停/✓完成/✗失败 | SSE实时更新 |
| 工具调用链 | 底部面板，折叠式 | 记录input/output/latency |
| 长任务防卡死 | 虚拟滚动+分页（每页50条） | IntersectionObserver |

## 十四、用户引导路径纳入计划 [来源：审核ECO-07/CAP-02]

| Phase | 交付物 | 验收标准 |
|-------|--------|---------|
| Phase 2 | 新手引导流程 | 首次登录→选模板→一键部署→创建任务 |
| Phase 2 | 模板市场 | 至少4个模板（Dev/Content/Novel/Mall） |
| Phase 2 | 一键部署 | TemplateDeployer实现 |

### 模板市场

```yaml
templates:
  - id: "dev-hotfix"
    name: "热修复工作流"
    project: "devforge"
    workflow_file: "dev_hotfix.yaml"
    persona: "devforge:coder"
  - id: "content-article"
    name: "文章创作工作流"
    project: "contentforge"
    workflow_file: "content_article.yaml"
    persona: "contentforge:writer"
```

## 十五、API版本管理纳入计划 [来源：审核FWK-01/INF-01]

| Phase | 交付物 | 验收标准 |
|-------|--------|---------|
| Phase 1 Week 10 | API版本前缀 `/api/v1/` | 所有端点带版本前缀 |
| Phase 1 Week 10 | FlowForgeClient兼容性检查 | 启动时检查API版本匹配 |
| Phase 2 | API兼容性矩阵 | v1.x向后兼容，v2.0需适配 |

### 版本兼容性矩阵

| FlowForge API版本 | ContentForge | DevForge | NovelForge | MallForge |
|------------------|-------------|----------|-----------|----------|
| v1.0 | ✅ | ✅ | ✅ | ✅ |
| v1.1 (新增端点) | ✅ 向后兼容 | ✅ 向后兼容 | ✅ 向后兼容 | ✅ 向后兼容 |
| v2.0 (Breaking) | 需适配 | 需适配 | 需适配 | 需适配 |

## 实施节奏修订（v2.2补充） [审核修订 v2.2]

在v2.1实施节奏基础上，补充以下里程碑：

```
Week 1-2:   FWK-01 MVP + Feature Flag基础设施
Week 2-3:   FWK-09 MVP + 降级决策树基础
Week 3-4:   FlowForge内部清理 + 删除代码回归测试框架
Week 4-5:   ContentForge YAML化 + ChineseFormatChecker
Week 5-6:   DevForge YAML化 + CAP-14 ArchitectureConstraintEngine
Week 6-7:   NovelForge YAML化 + EntropyManager
Week 7-8:   FlowForge内置Agent YAML化 + CredentialMigrationRunbook
Week 8-9:   INF-01 LLMRouter + ProviderHealthChecker + 密钥迁移
Week 9-10:  INF-02 EventStore MVP + test_doubao_stream.py
Week 10-12: *Forge Phase 1核心功能 + Helm基础交互 + Agent DX CLI
Week 12+:   Phase 2能力升级 + 模板市场 + API版本管理 + 多模态
```

---

# [审核修订 v3.0] 六方联合审核修订增补（v2.1/v2.2未覆盖项）

> 审核日期：2026-06-16 | 修订版本：v3.0 | 来源：6份专家审核意见并集，排除v2.1/v2.2已覆盖项
> 侧重：实施计划与里程碑层面

### LP3.0-1: FWK-01三阶段拆分里程碑
- **审核来源**：review_landing_design.md 问题1
- **修订方案**：FWK-01拆分为Parser(Week1)→Validator(Week1)→CodeGen(Week2)，IR可视化调试Week3
- **交付物**：FWK-01-PARSER / FWK-01-VALIDATOR / FWK-01-CODEGEN / FWK-01-IR-VIS
- **优先级**：P0

### LP3.0-2: INF-02 EventStore WAL改造里程碑
- **审核来源**：review_landing_design.md 问题2
- **修订方案**：WAL模式+批量提交Week1，RunCoordinator持久化Week2，snapshot compaction Week3
- **交付物**：INF-02-WAL / INF-02-BATCH / INF-02-COMPACTION
- **优先级**：P0

### LP3.0-3: INF-05 Compaction死循环防护里程碑
- **审核来源**：review_landing_design.md 问题3
- **修订方案**：最大次数限制Week1，强制截断Week1，降级策略Week2
- **交付物**：INF-05-GUARD / INF-05-DEGRADE
- **优先级**：P0

### LP3.0-4: CAP-01降级为P3
- **审核来源**：review_landing_design.md 问题4, kimi, mm
- **修订方案**：Phase 2用Dict[str, ContextFragment]，Source<A>代数推到Phase 3
- **交付物**：CAP-01-SIMPLE (Phase 2) / CAP-01-ALGEBRA (Phase 3)
- **优先级**：P3（原P1）

### LP3.0-5: TurnKind+LoopPhase统一状态机里程碑
- **审核来源**：review_landing_design.md 问题5, kimi, mm
- **修订方案**：统一状态机设计Week1，LoopContext封装Week2，Transition条件表Week2
- **交付物**：FWK-06-UNIFIED-STATE / FWK-06-LOOP-CONTEXT
- **优先级**：P0

### LP3.0-6: 底座净化ARCH-00里程碑
- **审核来源**：deepseek 问题②, mm
- **修订方案**：23处领域代码迁移，Phase 0 Week1-2完成
- **交付物**：ARCH-00-PURIFY (~1100行移出)
- **优先级**：P0

### LP3.0-7: OpenCode模式优先级矩阵
- **审核来源**：deepseek 问题③
- **修订方案**：65+模式按阻塞性×复用性评估，P0模式8项/P1模式12项/P2模式10项
- **交付物**：OPENCODE-PRIORITY-MATRIX
- **优先级**：P1

### LP3.0-8: FWK-01 MVP里程碑与并行降级方案
- **审核来源**：deepseek 问题④
- **修订方案**：MVP-1(SEQUENCE,Week1)→MVP-2(+CONDITIONAL,Week2)→MVP-3(+GATE,Week3)，各*Forge保留Orchestrator fallback
- **交付物**：FWK-01-MVP1 / FWK-01-MVP2 / FWK-01-MVP3
- **优先级**：P0

### LP3.0-9: 新旧路径切换策略
- **审核来源**：deepseek 问题⑤
- **修订方案**：feature flag切换为主，A-B验证为辅，硬切换仅限安全修复
- **交付物**：SWITCH-STRATEGY
- **优先级**：P1

### LP3.0-10: CAP-14 Harness护栏集成里程碑
- **审核来源**：deepseek 问题⑥
- **修订方案**：Phase 2 Week1-2完成四根护栏与LoopEngine对接
- **交付物**：CAP-14-HARNESS
- **优先级**：P1

### LP3.0-11: models.yaml Doubao规格补全里程碑
- **审核来源**：doubao DB-P0-01
- **修订方案**：Phase 0 Week1完成所有模型规格定义
- **交付物**：MODELS-SPEC-COMPLETE
- **优先级**：P0

### LP3.0-12: BaseTool function call Schema里程碑
- **审核来源**：doubao DB-P0-02
- **修订方案**：Phase 0 Week2完成parameters_schema和to_function_call()
- **交付物**：BASETOOL-FUNCALL
- **优先级**：P0

### LP3.0-13: Persona注入规范化里程碑
- **审核来源**：doubao DB-P0-03
- **修订方案**：Phase 1 Week1完成结构化格式+SOUL限制+成本审计
- **交付物**：PERSONA-NORM
- **优先级**：P1

### LP3.0-14: LLMCallEvent事件里程碑
- **审核来源**：doubao DB-P1-05
- **修订方案**：Phase 1 Week2完成LLMCallEvent+Metrics汇总
- **交付物**：LLM-CALL-EVENT
- **优先级**：P1

### LP3.0-15: Plugin协议扩展里程碑
- **审核来源**：kimi, mm
- **修订方案**：Phase 0 Week3完成协议扩展+*Forge适配
- **交付物**：PLUGIN-V2
- **优先级**：P1

### LP3.0-16: ConfigVersion里程碑
- **审核来源**：kimi, mm
- **修订方案**：Phase 1 Week3完成配置版本控制
- **交付物**：CONFIG-VERSION
- **优先级**：P1

### LP3.0-17: GAP-C01反向依赖修复里程碑
- **审核来源**：kimi, mm
- **修订方案**：Phase 0 Week1完成反向import删除
- **交付物**：GAP-C01-FIX
- **优先级**：P0

### LP3.0-18: 跨项目统一规范里程碑
- **审核来源**：所有6份审核文档
- **修订方案**：Phase 0 Week2完成变量引用/命名空间/状态输出/执行策略/检查点五项统一
- **交付物**：CROSS-PROJECT-UNIFY
- **优先级**：P0

### LP3.0-19: 用户旅程图里程碑
- **审核来源**：mm
- **修订方案**：Phase 0 Week3完成4个项目用户旅程图
- **交付物**：USER-JOURNEY-MAP
- **优先级**：P0

### LP3.0-20: 失败UX设计里程碑
- **审核来源**：mm
- **修订方案**：Phase 1 Week1完成FAIL路径UX流程图
- **交付物**：FAIL-UX-DESIGN
- **优先级**：P0

### LP3.0-21: 可观测性设计里程碑
- **审核来源**：mm
- **修订方案**：Phase 1 Week2-3完成trace_id/审计日志/LLM记录/Grafana仪表盘
- **交付物**：OBSERVABILITY
- **优先级**：P0

### LP3.0-22: 灾备降级设计里程碑
- **审核来源**：mm
- **修订方案**：Phase 1 Week2完成降级决策树
- **交付物**：DISASTER-RECOVERY
- **优先级**：P0

### LP3.0-23: CAP-02 PermissionV2完善里程碑
- **审核来源**：mm
- **修订方案**：Phase 1 Week1完成WebSocketApprovalProvider+ASK超时+审计日志
- **交付物**：PERMISSION-V2-COMPLETE
- **优先级**：P0

### LP3.0-24: ProviderQuotaManager里程碑
- **审核来源**：doubao
- **修订方案**：Phase 1 Week3完成TPM/RPM/成本预算管理
- **交付物**：PROVIDER-QUOTA
- **优先级**：P1

### LP3.0-25: Doubao moderation内容安全层里程碑
- **审核来源**：doubao
- **修订方案**：Phase 1 Week1完成L5层Doubao moderation集成
- **交付物**：MODERATION-LAYER
- **优先级**：P0

### LP3.0-26: 多模型级联策略里程碑
- **审核来源**：doubao
- **修订方案**：Phase 1 Week2完成llm_route.yaml+failover条件
- **交付物**：LLM-CASCADE
- **优先级**：P1

### LP3.0-27: 性能基线SLO里程碑
- **审核来源**：mm, review_landing_design.md
- **修订方案**：Phase 1 Week3完成8项SLO定义+基准测试
- **交付物**：PERFORMANCE-SLO
- **优先级**：P1

### LP3.0-28: 测试策略里程碑
- **审核来源**：所有审核文档
- **修订方案**：Phase 0 Week3完成配置驱动率自动验证+HTTP Cassette+E2E测试套件
- **交付物**：TEST-STRATEGY
- **优先级**：P0

### LP3.0-29: 配置驱动率阶段性里程碑
- **审核来源**：所有审核文档
- **修订方案**：Phase 0完成≥30%，Phase 1完成≥60%，Phase 2完成≥80%
- **交付物**：CONFIG-DRIVE-MILESTONES
- **优先级**：P1

### LP3.0-30: 事件总线统一里程碑
- **审核来源**：review_landing_design.md
- **修订方案**：Phase 1 Week3完成EventBus+DurableEventStream统一
- **交付物**：EVENTBUS-UNIFY
- **优先级**：P1

### LP3.0-31: 凭证迁移Runbook里程碑
- **审核来源**：mm
- **修订方案**：Phase 1 Week3完成SecretStore→CredentialStore迁移
- **交付物**：CREDENTIAL-MIGRATE
- **优先级**：P1

### LP3.0-32: 实施节奏重排（串行化）
- **审核来源**：mm
- **修订方案**：4个*Forge从并行改为串行+小步快跑：先ContentForge跑通模式，再DevForge/NovelForge
- **交付物**：SERIAL-SCHEDULE
- **优先级**：P1

### LP3.0-33: DeprecationWarning保留时长定义
- **审核来源**：mm
- **修订方案**：3个minor版本或6个月以先到者为准
- **交付物**：DEPRECATION-POLICY
- **优先级**：P1

### LP3.0-34: Skill知识沉淀里程碑
- **审核来源**：doubao
- **修订方案**：Phase 3完成Agent成功产出→Skill系统
- **交付物**：SKILL-PRECIPITATION
- **优先级**：P2

### LP3.0-35: SSE一致性测试里程碑
- **审核来源**：doubao
- **修订方案**：Phase 2完成test_doubao_stream.py
- **交付物**：SSE-CONSISTENCY-TEST
- **优先级**：P2
