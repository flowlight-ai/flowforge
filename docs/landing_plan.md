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
