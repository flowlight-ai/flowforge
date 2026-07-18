﻿﻿# FlowForge v3.0 Agent Harness 进化需求规格说明书 — spec_face

> **版本**：v3.0 (face)
> **日期**：2026-07-14
> **状态**：待用户审核
> **定位**：本文档为 FlowForge v3.0 Agent Harness 进化需求规格说明书，基于 2025-2026 年国内主流大厂 Agent Harness 岗位面试信息创建，是 `flowforge/docs/face/` 目录下的补充规格文档。
> **权威源声明**：本文档与 `flowforge/docs/spec.md` v7.0（灵智养成体系权威源）、`flowforge/docs/arch.md` v7.0（七层架构权威源）、`hiclaw/rules.md`（开发规范）、`hiclaw/prompts.md`（提示词模板库）共同构成完整规格体系。当本文档与 v7.0 权威源发生冲突时，以 v7.0 为准；本文档负责将大厂面试诉求落地为 v3.0 工程需求，并通过"M18-M20 v7.0 融合映射"章节与灵智养成体系无缝对齐。
> **规范约束**：严格遵守 `hiclaw/rules.md`、`hiclaw/prompts.md`、单向依赖、DI 合规、配置驱动、测试铁律 T1-T15。所有实现禁止使用 Mock LLM / 假数据 / 跳过验证。

---

## 第一章：背景与目标

### 1.1 项目背景

FlowForge 生态历经 Phase 0~5 迭代，已建立 v2.1 六层 Harness 架构（基础设施层 / 能力层 / 执行引擎层 / Harness 驾驭层 / 接入层 / 应用层），沉淀了 9 大执行模式、30+ 通用 Agent、50+ 工具、Skill 系统、MCP 集成、Memory 系统、Helm Web UI 等基础能力。v2.1 已能支撑 ContentForge / DevForge / NovelForge / MallForge / StockForge 等上层 *Forge 项目通过 Plugin 协议组合扩展。

然而 v2.1 在工业级生产化方面仍存在明显短板：跨厂 Agent 互联能力缺失、MCP 协议版本滞后、上下文工程仍是"系统提示词硬塞"模式、Guardrails 缺少闭环、可观测性非标准化、长程任务无 Durable 保障、自我纠错机制单一、成本治理粗放、HITL 中断不可恢复、Agent 治理缺位、Computer Use 未覆盖、协议栈不完整、故障恢复薄弱、多租户未隔离、Skill 无市场。这些短板在国内大厂 Agent Harness 岗位的面试考察中集中暴露，构成 v3.0 进化的直接驱动力。

### 1.2 调研方法

本次需求规格基于候选人 2025-2026 年面试国内主流大厂 Agent Harness 岗位的真实记录，覆盖字节跳动 / 抖音、阿里国际、高德、腾讯 WXG / 企微、百度、华为、网易、商汤、小米、深信服等 10+ 公司，原始面试信息沉淀于 `flowforge/docs/face/face.md`。

调研采用"能力维度归纳法"：将面试问题按 9 大能力维度归类——① Memory 与上下文管理；② Multi-agent 协作、路由与终止条件；③ Harness、Skill 与自进化；④ Eval、Benchmark 与模型选择；⑤ 工程交付、质量与复杂代码仓；⑥ 架构、产品定位与差异化；⑦ 企业治理、组织知识与规模化 Adoption；⑧ 用户价值、商业化与未来工作方式；⑨ 候选人角色与职业判断。每个维度提取反复出现的"全局信号"，转化为 v3.0 的 17 大需求模块（M1-M17）。所有需求均基于真实大厂面试信息，禁止使用 Mock / 假数据。

### 1.3 v3.0 总目标

v3.0 的总目标是从 v2.1 的"Agent 驾驭层"进化为"工业级 Agent OS + Agent 互联网节点"。具体拆解为三个子目标：

1. **工业级 Agent OS**：补齐 Durable Execution、六层 Guardrails 闭环、OTel GenAI 标准化可观测、Eval-gated 发布门禁、AgentBOM 治理、HITL 中断恢复、成本治理、多租户隔离等工业级能力，达到 CSA AGMM Level 4（工业可用）。
2. **Agent 互联网节点**：通过 A2A 协议实现跨厂 Agent 互联，通过 MCP 2026 Spec RC 实现标准化工具生态，通过三层协议栈（ACP/MCP/A2A）实现完整协议覆盖，让 FlowForge 成为 Agent 互联网的联邦节点。
3. **为 v7.0 灵智养成体系提供工程支撑**：v3.0 的 M1-M17 是 v7.0 七层架构第 1-6 层的工程实现，为第 7 层（自进化层）的 ForgekinEngine / SpiritForge / MindEcho / MindCouncil 提供协议、上下文、安全、可观测、评估、长程、纠错、成本、部署、HITL、治理、Computer Use、协议栈、故障恢复、多租户、Skill 市场等基础能力支撑。

### 1.4 设计原则

| 原则 | 说明 |
|------|------|
| **配置驱动 > 代码继承** | 所有策略 YAML 化，禁止硬编码路径 / 密钥 / 端口 / 提示词（红线 11、P16、P34） |
| **协议优先** | 优先采用国际标准（MCP 2026 / A2A / OTel GenAI / IETF CHEQ），自建仅作补齐 |
| **向后兼容** | v2.1 接口不破坏，新能力通过 Feature Flag 渐进启用，降级路径完整 |
| **可观测即默认** | 所有 Agent / Tool / Loop 自动埋点 OTel Trace，gen_ai.* schema 标准化 |
| **治理即代码** | 策略 YAML + CI/CD 门禁 + AgentBOM + Blast-radius Gate |
| **测试铁律不退化** | T1-T8 沿用，新增 T10-T15 覆盖 v3.0 新能力，禁止 Mock LLM / 假数据 / 跳过验证 |
| **组合优于继承** | 禁止用继承替代组合 / 插件（红线 9），*Forge 通过 Plugin 协议组合扩展 |
| **单向依赖** | 上层 → 下层，FlowForge 禁止 import *Forge，循环依赖零容忍 |

### 1.5 九大能力维度与全局信号

基于 face.md 原始面试信息，按 9 大能力维度归纳，每个维度提取"全局信号"（面试官真正关心的核心问题），映射到 M1-M17 需求模块：

**维度 1：Memory 与上下文管理**（★★★★★ 全六厂唯一全高频）
- 反复问题：权威与生命周期（谁能把聊天消息晋级为架构决策？低权威记忆如何晋级？过期记忆如何退役？）、合并与冲突（不同 Agent 写入冲突结论时按来源 / 时间 / 范围还是人工裁决？）、隔离（Session / 项目 / 用户 / 租户如何隔离？）、Shared state 边界、检索（Grep / BM25 / 向量 / 图谱 / 外部知识库）、短期与长期（短期全文加载，长期压缩分层按需召回）、压缩与恢复（长任务中途压缩怎么办？沉睡 Agent 被 @ 如何补齐增量？）、本地与云端、竞品比较（MemOS / Hermes / Claude Code / OpenClaw / RAG）。
- **全局信号**：市场已不满足于"有向量库"，而是在考"真相治理 + 上下文编排 + 证据可追溯"。
- **映射模块**：M3 Context Engineering 2.0 + M7 Durable Execution（长程上下文恢复）+ M16 多租户隔离（Memory 隔离）。

**维度 2：Multi-agent 协作、路由与终止条件**（★★★★★）
- 反复问题：首个 Agent 如何选择？什么条件触发拉入新 Agent？不使用强状态机时如何不漂移？A2A 为什么自建？单 / 多 Agent 协议边界坑？如何防止无限聊天？子 Agent 幻觉如何处理？多猫是否互相看到完整上下文？
- **全局信号**：面试官真正担心的不是"Agent 不够聪明"，而是"责任边界不清、无限循环、错误传染和上下文错配"。
- **映射模块**：M1 A2A 协议 + M14 三层协议栈 + M15 故障恢复（终止条件治理）。

**维度 3：Harness、Skill 与自进化**（★★★★★）
- 反复问题：为什么用 Claude Code 等成熟 Harness 而非直接调 API？模型与 Harness 如何解耦？Skill 如何从真实任务长出来？怎样证明十步变五步是能力提升？自进化产物落在哪里？事故驱动护栏如何升级为系统性防线？Agent 如何开发自己的 Harness？
- **全局信号**：真正可信的自进化不是"让模型反思"，而是把经验按风险逐级固化为"软约束 + 硬护栏 + Eval 证据"。
- **映射模块**：M2 MCP 2026 + M4 六层 Guardrails + M8 自我纠错 2.0 + M10 生产化部署（自指修改防漂移）+ M17 Skill 市场。

**维度 4：Eval、Benchmark 与模型选择**（★★★★★）
- 反复问题：A2A / Memory / Tracing / 自进化分别用什么 Eval？Harness 改完如何回归？为什么做或不做每日曲线？如何准备带真实工具的虚拟环境？模型升级如何比较？Eval 暴露多少？Memory / Skill 沉淀如何衡量？组织提效如何衡量？
- **全局信号**：面试官不再只问模型 Benchmark，而是在问"Agent + Harness + 环境 + 人类流程的系统级评测"。
- **映射模块**：M5 OTel GenAI + M6 评估与基准。

**维度 5：工程交付、质量与复杂代码仓**（★★★★）
- 反复问题：Agent 生成代码如何管理 Env / 依赖 / Git worktree？大仓 / 多仓 / 跨模块缺陷如何建依赖图？存量项目如何 Agent-first 改造？需求变化时 Spec / 计划 / 测试 / 实现如何同步？TDD / Review / Merge Gate / CI/CD 如何保证？新功能如何避免老功能漂移？长程任务跨几天如何保持一致？云端 Sandbox 如何管理？
- **全局信号**：大型软件的瓶颈不是生成速度，而是"验证、集成与维护的木桶短板"。
- **映射模块**：M7 Durable Execution + M10 生产化部署 + M11 HITL 2.0 + M12 Agent 治理 + M13 Computer Use（多模态 Web 测试）。

**维度 6：架构、产品定位与差异化**（★★★★）
- 反复问题：架构为什么这样分层？最突出的两个设计？Shared state 是什么？与 Claude Code / OpenClaw / Hermes 核心差异？Cat Café 是通用 Agent / Coding Agent / Agentic Work OS？能力市场解决什么？底层模型 / 框架 / API？为什么开源？成熟度如何？
- **全局信号**：好的回答不能只列功能，必须给出"问题定义、设计取舍、适用边界和反例"。
- **映射模块**：第三章架构演进 + M17 Skill 市场（能力市场）。

**维度 7：企业治理、组织知识与规模化 Adoption**（★★★★）
- 反复问题：ToC 开放 Skills 与 ToB 规范 / 安全 / 审计如何平衡？飞书 / 企业知识库 / 内部系统凭证如何管理？如何从千人研发轨迹抽最佳实践？个人 / 项目 / 语言 / 模型 / 组织知识如何分层？平台与业务团队如何分工？PM / SE / 开发 / 测试与 Agent 如何协作？如何避免重复建设和规则膨胀？如何推动不同接纳程度团队使用？
- **全局信号**：从个人到千人团队后，核心对象从"一个 Agent 的能力"变成"组织的约束、知识流和生产关系"。
- **映射模块**：M12 Agent 治理 + M16 多租户隔离 + M17 Skill 市场（组织经验推广）+ M11 HITL 2.0（IPD 对接）。

**维度 8：用户价值、商业化与未来工作方式**（★★★）
- 反复问题：项目是否真有人用？产生什么收益？为什么做这个产品？本地如何走向 24×7 云端？图片 / 视频长任务如何降低等待感？Agentic Work OS 终局？未来人负责什么？企业投入如何落地？
- **全局信号**：从技术 Demo 到真实价值，需要回答"谁在用、用得好、愿意付费"。
- **映射模块**：M9 Cost 优化 + M13 Computer Use（长任务等待优化）+ M15 故障恢复（24×7 可用性）+ M16 多租户（商业化基础）。

**维度 9：候选人角色与职业判断**（★★★）
- 反复问题：你在团队实际负责什么？人与 Agent 怎样分工？项目代码是不是 Vibe Coding？你本人掌握了什么？当前级别？为什么考虑离开？项目为何能开源？进入企业做平台 / 业务 / 推广？
- **全局信号**：这类问题验证候选人对项目的真实理解深度，而非仅看功能清单。
- **映射模块**：无直接映射，但影响项目定位和路线图优先级。

---

## 第二章：差距分析

### 2.1 当前架构成熟度自评（CSA AGMM）

参照 Cloud Security Alliance Agent Governance Maturity Model（AGMM）五级模型（L1 初始 / L2 受控 / L3 定义 / L4 工业可用 / L5 行业领先），对 v2.1 现状自评如下：

| 维度 | v2.1 现状 | 成熟度 | v3.0 目标 |
|------|----------|--------|----------|
| Identity（身份） | Agent 有 ID 但无 BOM | L2 | L4 |
| Observability（可观测） | 有 Tracing 但非 OTel 标准 | L2 | L4 |
| Safety（安全） | 有 PermissionPipeline 但非闭环 | L2 | L4 |
| Compliance（合规） | 有审计但缺 Blast-radius | L2 | L4 |
| Lifecycle（生命周期） | 有 Loop 但无 Durable | L2 | L4 |
| Collaboration（协作） | 有 Multi-agent 但无 A2A 协议 | L1 | L4 |
| Evaluation（评估） | 有 T7 但无 τ-bench | L2 | L4 |
| Governance（治理） | 无 AgentBOM | L1 | L4 |

**结论**：v2.1 整体处于 L2（受控），v3.0 目标是全面达到 L4（工业可用）。Level 5 行业领先因需行业认证投入大、ROI 不高，留待后续。

### 2.1.1 v2.1 各维度现状详细描述

**Identity（身份）— L2 受控**：v2.1 已为每个 Agent 分配唯一 ID（命名空间 `项目前缀:角色名`，如 `contentforge:writer`），通过 AgentRegistry 集中管理。但缺少 AgentBOM（物料清单），无法追溯 Agent 的依赖关系、版本变更、能力声明、权限清单和来源审计。Agent 变更无版本化记录，无法回答"这个 Agent 上周改了什么、谁改的、为什么改"。

**Observability（可观测）— L2 受控**：v2.1 已实现 Tracing 系统（`core/tracing.py` 的 `get_logger` 自动注入 trace_id），MetricsCollector 采集完整指标。但 Tracing 非 OTel GenAI 标准，Span schema 自定义，无法与 Jaeger / LangSmith / Langfuse / Phoenix 等行业工具互通；Metrics 命名非 `gen_ai.*` 标准，无法接入 Prometheus 标准看板。

**Safety（安全）— L2 受控**：v2.1 已有 PermissionPipeline 前馈控制（参数 / 权限 / Schema 校验），但缺少后馈验证（Output Validation / Action Confirmation / Cost Ceilings），不构成闭环。Injection 检出率未度量，System Prompt 泄露未防护，高风险 Action 无二次确认。

**Compliance（合规）— L2 受控**：v2.1 已有审计日志（操作记录入库），但缺 Blast-radius Gate（影响范围评估），高风险操作无双人审批，无升级审批机制。审计可查但不可主动拦截，合规是事后追溯而非事前预防。

**Lifecycle（生命周期）— L2 受控**：v2.1 已有 LoopExecutor 执行循环（创作 / 润色两个独立 Loop 接口），5 评委并行评审，质量分阈值 0.85。但无 Durable Execution，进程崩溃即丢失全部进度；无 Checkpoint 机制，长程任务无法暂停 / 恢复；无 Saga 模式，失败步骤无补偿。

**Collaboration（协作）— L1 初始**：v2.1 已有内部 Multi-agent 协作（Agent 间通过 Shared State 通信），但无 A2A 协议，无法跨厂互联；无 Agent Card / Directory，外部无法发现 FlowForge Agent；无跨厂鉴权（Bearer / OAuth2 / mTLS）。

**Evaluation（评估）— L2 受控**：v2.1 已有 T7 LLM 审核（LLM 生成内容必须再调用 LLM 审核通过），T8 DOM 验证（Web 功能操控浏览器）。但无 τ-bench / SWE-bench Pro 行业基准，无回归测试套件，无法回答"模型从 4.6 升到 4.7 如何比较"、"Harness 改完是否漂移"。

**Governance（治理）— L1 初始**：v2.1 无 AgentBOM，无 Blast-radius Gate，无治理策略版本化，无测试 Agent。Agent 变更无审批门禁，影响范围不可评估。

### 2.2 关键差距矩阵（G1-G18）

| 编号 | 差距 | 对应模块 | 优先级 | 面试信号来源 |
|------|------|---------|--------|------------|
| G1 | 跨厂 Agent 互联协议缺失 | M1 A2A | P0 | 字节二面"A2A 为什么自建" |
| G2 | MCP 协议版本滞后（v2024 vs 2026 RC） | M2 MCP | P0 | 深信服"Harness 与模型解耦" |
| G3 | 上下文工程仍是"硬塞"模式 | M3 Context | P0 | 全六厂高频"Memory 与上下文管理" |
| G4 | Guardrails 无闭环（仅前馈无后馈） | M4 Guardrails | P0 | 小米"事故驱动护栏" |
| G5 | 可观测性非 OTel 标准 | M5 OTel | P0 | 阿里"自进化如何做 Eval" |
| G6 | 评估缺 τ-bench / SWE-bench Pro | M6 Eval | P1 | 阿里/小米"Eval 怎么做" |
| G7 | 无 Durable Execution + 长程任务无保障 | M7 Durable | P1 | 深信服"长程任务如何恢复" |
| G8 | 自我纠错单一（仅 Reflexion） | M8 纠错 | P1 | 小米"软+硬+Eval 三层 Harness" |
| G9 | 无 Prompt Caching + 成本治理粗放 | M9 Cost | P1 | 阿里"Sandbox economics" |
| G10 | 无灰度 / A/B / Eval-gated 回滚 | M10 Deploy | P1 | 小米"CI/CD 自动修复到哪一步" |
| G11 | HITL 中断不可恢复 | M11 HITL | P1 | 深信服"长程任务压缩丢失" |
| G12 | 无 AgentBOM / Blast-radius Gate | M12 治理 | P2 | 腾讯"如何保证老功能不漂移" |
| G13 | 无 Computer Use / Browser Use | M13 Computer | P2 | 深信服"多模态 Web 测试" |
| G14 | 协议栈不完整（缺 ACP） | M14 协议栈 | P2 | 字节"单 Agent 与多 Agent 协议边界" |
| G15 | 故障恢复薄弱（无 Self-healing / Saga） | M15 恢复 | P1 | 字节一面"failure mode" |
| G16 | 多租户未隔离 | M16 多租户 | P2 | 腾讯"云端逻辑多租户" |
| G17 | Skill 无市场（无打包 / 签名 / 分发） | M17 Skill | P2 | 阿里"能力市场" |
| G18 | v3.0 能力与 v7.0 灵智体系融合路径不清 | M18-M20 融合 | P0 | 全六厂"自进化如何实现" |

---

## 第三章：v3.0 总体架构演进

### 3.1 七层架构模型（v2.1 六层 + 互联层）

v3.0 在 v2.1 六层架构基础上新增第 7 层"互联层"，并强化 2/3/4 层。第 7 层"自进化层"由 v7.0 灵智养成体系承接，v3.0 通过 M1-M17 为其提供工程支撑（详见 M18-M20 融合映射章节）。

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 7. 互联层 (Interconnect Layer) ★ v3.0 新增                                │
│    A2A Server/Client | ACP Orchestrator | Agent Directory | 租户路由       │
├──────────────────────────────────────────────────────────────────────────┤
│ 6. 应用层 (Application Layer)                                              │
│    ContentForge / NovelForge / DevForge / MallForge / StockForge          │
├──────────────────────────────────────────────────────────────────────────┤
│ 5. 接入层 (Gateway Layer)                                                  │
│    FastAPI REST + WebSocket(Helm/Events) + Web UI + CLI + A2A Endpoint    │
├──────────────────────────────────────────────────────────────────────────┤
│ 4. Harness 驾驭层 (Harness Layer) ★ v3.0 强化                              │
│    Context Eng 2.0(JIT/MemoryTool/Editing) | 六层 Guardrails | 反馈循环    │
│    熵管理 | HITL(CHEQ) | AgentBOM | Blast-radius | 权限管线              │
├──────────────────────────────────────────────────────────────────────────┤
│ 3. 执行引擎层 (Engine Layer) ★ v3.0 强化                                   │
│    HybridExecutor(TAOR) | 9大模式 | Durable Execution | Long-Run Mgr     │
│    Scheduler | PreFlect | VIGIL | SAGE                                    │
├──────────────────────────────────────────────────────────────────────────┤
│ 2. 能力层 (Capability Layer) ★ v3.0 强化                                   │
│    MCP 2026(Stateless/Apps/OAuth) | Skill市场 | Prompt Cache              │
│    Agent库 | Memory(Enhanced) | Computer Use | Browser Agent             │
├──────────────────────────────────────────────────────────────────────────┤
│ 1. 基础设施层 (Infrastructure Layer) ★ v3.0 强化                           │
│    SQLite/PostgreSQL | Redis | Qdrant | LangGraph | OTel Collector        │
│    LLM API(多Provider配额池) | A2A Registry | Eval Backend                │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 控制回路演进（Durable 持久回路 + Eval-gated 闭环 + Blast-radius 闸门 + CHEQ 中断恢复）

v2.1 控制回路（前馈 + 反馈 + 熵管理）→ v3.0 新增 4 条回路：

1. **Durable 持久回路**：每个 Step 写入 Durable Event Log → 故障从 Checkpoint 恢复。
2. **CHEQ 中断点**：HITL 中断持久化 → 重启后自动恢复至中断状态（IETF CHEQ 标准）。
3. **Eval-gated 闭环**：金丝雀发布前自动跑 τ-bench → pass^k 未达标自动回滚。
4. **Blast-radius 闸门**：高风险 Action 影响范围评估 → 双签 / 升级审批。

完整控制回路顺序：用户意图 → 前馈控制（沿用 v2.1）→ Durable 持久回路（v3.0 新增）→ Agent 执行（9 大模式，每步 OTel Span）→ CHEQ 中断点（v3.0 新增）→ 反馈控制（沿用 v2.1 + 六层 Guardrails 后馈）→ Eval-gated 闭环（v3.0 新增）→ Blast-radius 闸门（v3.0 新增）→ AgentBOM 落库 + 审计。

### 3.3 核心数据流

```
用户意图
  → Gateway（认证 + 限流 + 租户路由 + A2A Endpoint）
  → Harness（Context Eng JIT 注入 + 六层 Guardrails 前馈 + AgentBOM 加载）
  → Engine（Durable Execution 启动 + PreFlect 预检 + OTel Span 开启）
  → 9 大模式执行（每步 Checkpoint + OTel Span + VIGIL 监控）
  → 工具调用（MCP 2026 / A2A / Skill，全部沙箱化）
  → HITL 中断点（CHEQ 持久化，可恢复）
  → 输出（六层 Guardrails 后馈验证 + T7 LLM 审核）
  → Eval-gated 发布门禁（τ-bench pass^k）
  → 反馈循环（Reflexion / VIGIL / SAGE）
  → AgentBOM 落库 + 审计链 + OTel Trace 上报
```

### 3.4 七层架构组件清单

| 层级 | v2.1 现有组件 | v3.0 新增 / 升级组件 | 对应模块 |
|------|-------------|-------------------|---------|
| **7. 互联层** | 无（v3.0 新增层） | A2A Server / Client / Directory / Agent Card / 跨厂鉴权 / ACP Orchestrator / 协议适配器 / 租户路由 | M1 / M14 / M16 |
| **6. 应用层** | ContentForge / DevForge / NovelForge / MallForge / StockForge | Plugin V3 协议升级（支持 A2A / Skill 市场组合）/ 灵智角色注册 | M17 / v7.0 FR-EVO |
| **5. 接入层** | FastAPI REST / WebSocket / Helm Web UI / CLI | A2A Endpoint（`/.well-known/agent.json` / `/a2a/`）/ MCP Manifest Endpoint / Marketplace API / 健康检查端点（`/health` `/ready` `/live`）| M1 / M2 / M15 |
| **4. Harness 驾驭层** | PermissionPipeline / ContextLayerManager | Context Eng 2.0（JIT / Memory Tool / Editing / Caching）/ 六层 Guardrails Orchestrator / HITL CHEQ / AgentBOM / Blast-radius / Prompt Cache / Cost Router | M3 / M4 / M9 / M11 / M12 |
| **3. 执行引擎层** | HybridExecutor / 9 大模式 / LoopExecutor | Durable Execution（Event Log / Checkpoint / Saga / Outbox）/ PreFlect / VIGIL / SAGE / Long-Run Manager | M7 / M8 |
| **2. 能力层** | MCP v2024 / Skill 系统 / Agent 库 / Memory | MCP 2026 RC（Stateless / Apps / Elision / EMA / Sandbox）/ Skill 市场（打包 / 签名 / 分发 / 评价）/ Computer Use / Browser Agent / Enhanced Memory | M2 / M13 / M17 |
| **1. 基础设施层** | SQLite / LangGraph / LLM API | PostgreSQL（Durable）/ Redis（Cache + Session）/ Qdrant（向量）/ OTel Collector / A2A Registry / Eval Backend / 多 Provider 配额池 | M5 / M7 / M9 / M15 |

### 3.5 v3.0 新增模块与文件清单

v3.0 新增以下核心模块（均在 `flowforge/` 目录下），所有模块通过 DI 注入（红线 12），配置驱动（红线 11），OTel Trace 全覆盖（M5 协同）：

```
flowforge/
├── interconnect/              # M1/M14 互联层（v3.0 新增）
│   ├── a2a/                   # A2A 协议
│   │   ├── server.py          # A2A Server（FastAPI 路由）
│   │   ├── client.py          # A2A Client（ToolRegistry 注册）
│   │   ├── directory.py       # Agent Directory（注册中心）
│   │   ├── authenticator.py   # 跨厂鉴权（Bearer/OAuth2/mTLS）
│   │   ├── card_builder.py    # Agent Card 生成
│   │   ├── models.py          # Pydantic 数据模型
│   │   └── routes.py          # FastAPI 路由定义
│   └── acp/                   # ACP 协议（M14）
│       ├── orchestrator.py    # ACP 协调器
│       ├── message_router.py  # 消息路由
│       └── session_manager.py # 会话管理
├── mcp_v2026/                 # M2 MCP 2026 升级
│   ├── manifest_registry.py   # Manifest 自动发现
│   ├── elision.py             # Tool Result Elision
│   └── ema.py                 # Enterprise MCP Aggregator
├── harness/                   # M3/M4/M9/M11 Harness 驾驭层升级
│   ├── context_engine.py      # Context Eng 2.0（JIT 模式）
│   ├── prompt_cache.py        # M9 Prompt Caching
│   ├── cost_router.py         # M9 Cost-Aware Routing
│   ├── quota_pool.py          # M9 配额池
│   ├── cost_ledger.py         # M9 成本归因
│   └── hitl_cheq.py           # M11 HITL CHEQ
├── security/guardrails/       # M4 六层 Guardrails
│   ├── orchestrator.py        # Guardrails 编排器
│   ├── input_validator.py     # L1 Input Validation
│   ├── system_prompt_guard.py # L2 System Prompt
│   ├── tool_allowlist.py      # L3 Tool Allowlist
│   ├── output_validator.py    # L4 Output Validation
│   ├── action_confirmation.py # L5 Action Confirmation
│   └── cost_ceiling.py        # L6 Cost Ceilings
├── observability/             # M5 OTel GenAI
│   ├── genai_tracer.py        # gen_ai.* Span Tracer
│   ├── eval_gate.py           # Eval-gated Deploy Gate
│   └── alerts.py              # 告警规则
├── eval/                      # M6 评估与基准
│   ├── runner.py              # 评估执行器
│   ├── benchmarks/            # τ-bench / SWE-bench Pro
│   ├── regression/            # 回归测试套件
│   └── report/                # 评估报告
├── engine/durable/            # M7 Durable Execution
│   ├── event_log.py           # 事件日志
│   ├── checkpoint_manager.py  # 检查点管理
│   ├── saga_coordinator.py    # Saga 协调器
│   ├── outbox_relay.py        # Outbox 投递
│   └── recovery_manager.py    # 恢复管理器
├── engine/                    # M8 自我纠错 2.0
│   ├── preflight.py           # PreFlect 事前预检
│   ├── vigil.py               # VIGIL 多假设监控
│   └── sage.py                # SAGE 事故驱动
├── deploy/                    # M10 生产化部署
│   ├── canary_manager.py      # 灰度发布
│   ├── ab_test_manager.py     # A/B 测试
│   ├── eval_gate.py           # Eval 门禁
│   └── pipeline.py            # CI/CD 集成
├── governance/                # M12 Agent 治理
│   ├── agent_bom.py           # AgentBOM
│   ├── blast_radius.py        # Blast-radius Gate
│   ├── policy_manager.py      # 策略管理
│   └── audit_trail.py         # 审计追踪
├── tools/                     # M13 Computer Use
│   ├── computer_use/          # GUI Agent
│   └── browser_use/           # Browser Agent
├── runtime/                   # M15 故障恢复
│   ├── self_healing.py        # Self-healing Runtime
│   ├── bulkhead.py            # Bulkhead 隔离
│   ├── degradation.py         # 降级链路
│   └── health_check.py        # 健康检查
└── marketplace/               # M17 Skill 市场
    ├── registry.py            # Skill 注册中心
    ├── packager.py            # 打包工具
    ├── signer.py              # 签名验签
    ├── distributor.py         # 分发管理
    ├── rating.py              # 评价系统
    └── sandbox.py             # Skill 沙箱
```

---

## 第四章：核心需求模块（17 大模块 M1-M17）

> 每个模块包含：背景、需求（M{N}.1-M{N}.x 子需求）、设计要点、验收标准。所有需求基于真实大厂面试信息，禁止 Mock / 假数据。

### 4.1 M1 A2A 协议集成（跨厂 Agent 互联）

**背景**：字节二面追问"A2A 为什么不用 Google 的协议而要自建"，腾讯问"Multi-agent 互相 A2A、无限聊下去"如何防止，反映跨厂 Agent 互联是 v3.0 核心差异化能力。FlowForge 需同时作为 A2A Server（被外部调用）和 A2A Client（调用外部），并支持联邦查询。v2.1 仅有内部 Multi-agent 协作，无跨厂协议，无法接入 Agent 互联网生态。

**需求**：
- **M1.1 A2A Server**：将 FlowForge Agent 暴露为符合 Google A2A Spec 2026 的 HTTP 服务端点，复用 FastAPI 路由（不另起服务），路由包括 `/.well-known/agent.json` 自动发现、`POST /a2a/{agent_id}/tasks` 下发任务、`GET /a2a/{agent_id}/tasks/{task_id}/status` 查询状态、`GET /a2a/{agent_id}/tasks/{task_id}/result` 获取结果、`DELETE /a2a/{agent_id}/tasks/{task_id}` 取消、`POST /a2a/{agent_id}/stream` SSE 流式、`POST /a2a/{agent_id}/tasks/{task_id}/subscribe` 订阅长任务推送、`GET /a2a/directory/search` 目录查询。任务生命周期 pending → running → completed → failed → cancelled，支持 progress（0.0-1.0）进度上报。
- **M1.2 A2A Client**：让 FlowForge Agent 可作为客户端调用外部 A2A Agent，通过 ToolRegistry 注册为 `a2a_invoke` 工具（继承 BaseTool，DI 合规），支持同步 / 流式两种调用模式，支持长任务轮询 / 订阅，自动发现外部 Agent Card（`/.well-known/agent.json`），超时可配置（默认 300s）。
- **M1.3 Agent Card 规范**：YAML 配置化（红线 11），包含 agent_id（命名空间 `项目前缀:角色名`，如 `contentforge:writer`）/ name / description / version / url / capabilities（streaming / push_notifications / state_transition）/ skills（id / name / tags / input_schema）/ authentication（schemes / oauth2 token_url / scopes）/ default_input_modes / default_output_modes。Agent Card 由 `card_builder.py` 从 AgentRegistry 自动生成，写入 `config/a2a/agent_cards/`，并通过 `/.well-known/agent.json` 自动暴露。
- **M1.4 Agent Directory**：内部 Agent 注册中心，启动时扫描 `config/a2a/agent_cards/*.yaml`，支持手动 register / unregister，支持联邦查询（跨实例），缓存 + 定时刷新。`GET /a2a/directory/search?skill=&tags=&federation=` 支持 skill / tags 维度查询，联邦查询透传鉴权。
- **M1.5 跨厂鉴权**：Bearer Token（内部调用，API Key + JWT 签名）/ OAuth2 Client Credentials（跨厂调用，标准 OAuth2 流程）/ mTLS（高安全场景，双向 TLS 证书）三种方式，与 `middleware/auth.py` 集成。鉴权链路：请求 → Gateway（API Key 认证 + 限流）→ A2A Server（Bearer / OAuth2 校验）→ Agent 执行（Tenant 上下文注入）→ 工具调用（权限管线二次校验）。

**数据模型**：`A2ATaskRequest`（task_id / input / input_mode / output_mode / streaming / push_notification_url / metadata）、`A2ATaskStatus`（task_id / state / progress / created_at / updated_at / error）、`A2ATaskResult`（task_id / output / output_mode / artifacts）、`AgentCard`、`Artifact`，全部 Pydantic 模型校验。

**设计要点**：复用现有 TaskStore 任务持久化（扩展 state 字段）、HybridExecutor 异步执行、ToolRegistry 工具注册、OTel Tracing；新增 `flowforge/interconnect/a2a/` 模块（server / client / directory / authenticator / card_builder / models / routes）。所有 A2A 调用生成 OTel Span（M5 协同），支持 Distributed Tracing（跨 A2A 调用 trace_id 传播）。与 v7.0 FR-EVO-09 A2A 通信协议直接融合（@mention 路由 + thread isolation + structured handoff）。

**验收标准**：T11 A2A 协议合规测试通过（Agent Card / Task / SSE 标准）；外部 Client 可下发任务并收到响应；FlowForge Agent 可调用外部 A2A Agent；50+ Agent 注册与联邦查询可用；鉴权通过 Bearer + OAuth2；`curl /.well-known/agent.json` 返回标准 Card；SSE 流式响应可用；T8 浏览器 DOM 验证（A2A Web UI）。

### 4.2 M2 MCP 2026 Spec RC 升级

**背景**：深信服追问"为什么底层选择 Claude Code 等现成 Agent 而非直接调 API"，本质是 Harness 与模型 / 工具解耦问题。MCP 2026 Spec RC 引入 Stateless Core / MCP Apps / Tool Result Elision / EMA / 工具沙箱强化，是 v3.0 能力层升级的核心。v2.1 的 MCP 是 v2024 版本，状态内置于 Server，无法水平扩展，且缺少 Manifest 自动发现、OAuth 用户级授权、工具结果裁剪等关键能力。

**需求**：
- **M2.1 Stateless Core**：MCP Server 无状态，所有状态由 Client 维护（Session ID 透传），Server 可水平扩展，状态外置到 Redis。重构现有 `flowforge/mcp/server.py` 移除状态字段，`mcp/broker.py` 增加 Session 状态路由（Session ID → Redis Key 映射），`mcp/client.py` 增加 Session ID 透传。状态外置流程：MCP Client → MCP Server（无状态）→ Redis（get_state / set_state）。Server 重启不影响进行中会话，多副本可水平扩展。
- **M2.2 MCP Apps**：Manifest 自动发现（`.well-known/mcp-manifest.json`），包含 name / version / description / tools（name / description / input_schema）/ oauth（authorization_url / token_url / scopes）/ sandbox（container / network_egress_allowlist）配置，支持 Marketplace 集成（M17 协同）和版本管理。新增 `mcp/manifest_registry.py` 实现 Manifest 解析与注册。
- **M2.3 Tool Result Elision**：工具结果自动裁剪，> 4K tokens 自动摘要，历史 N 次后折叠为摘要，与 M3 Context Editing 协同，配置驱动（YAML）。新增 `mcp/elision.py`，策略：token 计数 → 阈值判断 → LLM 摘要 → 替换原结果（保留摘要 + 原始指针）。Elision 触发率监控（OTel Metric）。
- **M2.4 EMA（Enterprise MCP Aggregator）**：企业内部 MCP 网关聚合，统一鉴权 / 审计 / 限流，多版本兼容（v2024 / v2026 RC），支持 OAuth Authorization Code Flow（用户级授权，非全局 API Key）。OAuth Flow：用户 → Agent → MCP Client → MCP Server（redirect）→ 用户授权页（FlowForge Web UI）→ Authorization Code → MCP Client → Token Endpoint → Access Token → MCP Server（Bearer Token）。Token 加密存储复用 `core/secret_store.py`，支持 Token 刷新。
- **M2.5 工具沙箱强化**：Container Isolation（Docker per tool），Resource Limit（CPU / Memory / Network），Network Egress Allowlist，CVE-2025-47241 修复（路径遍历防护 `path.normalize()` + 白名单 / YAML 安全加载 `yaml.safe_load()` + schema 校验强化 / 依赖版本锁定 `requirements.txt` pin），与 M4 L3 Tool Allowlist 协同。沙箱策略 YAML 化：`config/mcp_v2026/sandbox_policy.yaml` 定义 default / per-tool 的 container / cpu_limit / memory_limit / network_egress / timeout。

**集成点**：`flowforge/mcp/` 重构为 v2026 RC 兼容、`core/native_tool_server.py` 升级沙箱执行、`tools/registry.py` MCP 工具自动注册、`core/secret_store.py` OAuth Token 加密存储、`middleware/auth.py` OAuth Authorization Code Flow、`core/di.py` MCP 组件 DI 注入。Feature Flag 兼容旧版（v2024），Spec 微调时适配层调整即可。

**设计要点**：所有 MCP 组件通过 DI 注入（红线 12），配置驱动（红线 11），OTel Trace 全覆盖（M5 协同）。与 v7.0 FR-EVO-07 外部编码工具集成延伸融合（Stateless Core / Sandbox 为 CLI Wrapper 和 Trae Bridge 提供工具沙箱基础）。

**验收标准**：Stateless 重启后会话不中断（T12 协同）；Manifest 自动发现可用（`curl /.well-known/mcp-manifest.json` 返回标准 Manifest）；OAuth Flow 跑通（用户级授权，Token 加密存储）；Elision 触发率监控（> 4K tokens 自动摘要）；Sandbox 隔离测试通过（CVE-2025-47241 修复验证）；多版本兼容（v2024 / v2026 RC 并存）。

### 4.3 M3 Context Engineering 2.0

**背景**：全六厂高频触达"Memory 与上下文管理"，市场已不满足于"有向量库"，而在考"真相治理 + 上下文编排 + 证据可追溯"。v2.1 的"系统提示词硬塞"模式必须升级为 JIT 按需加载 + Memory Tool + Context Editing 的 2.0 模式。决策 4 推荐"渐进式：System / Persona 预加载 + Task / Working JIT"，兼顾性能与稳定。

**需求**：
- **M3.1 JIT Context**：Agent 执行前不预加载所有上下文，通过 `context_fetch` 工具按需获取。System / Persona 层必加载（Cache 命中高），Task / Working 层标记 lazy 按需加载，Token 预算检查超限触发 Context Editing。`build_context(agent_id, task_input, session_id)` 构建流程：①加载 System 层（永久，必加载）；②加载 Persona 层（持久，必加载）；③Task 层标记 lazy 的不加载，等 Agent 调用 context_fetch；④Working 层全部 lazy；⑤Token 预算检查，超限触发 Context Editing。
- **M3.2 Memory Tool**：让 LLM 自己管理记忆，取代"系统提示词硬塞"模式。4 个 API：`memory_save(key, value, ttl, scope)` 保存记忆（scope: session / task / agent / global）、`memory_recall(query, top_k)` 语义检索、`memory_forget(key)` 主动遗忘、`memory_compress(threshold)` 压缩旧记忆。通过 ToolRegistry 注册为 `memory_save` / `memory_recall` / `memory_forget` / `memory_compress` 工具，遵守 DI（红线 12）。
- **M3.3 Context Editing**：上下文自动裁剪，Token 预算管理（默认 32K），历史消息滑动窗口（keep_first_last，保留首尾，中间摘要），工具结果折叠（与 M2 Elision 协同），多轮对话压缩（50 轮后触发），策略 YAML 配置化（`config/context_engine/editing.yaml`：token_budget / history_window / tool_result_elision / dialogue_compression / summary_trigger）。
- **M3.4 Context Layer Manager 升级**：System（priority 100, lazy false, cache true, source AGENTS.md）/ Persona（priority 90, lazy false, cache true, source config/personas/*.yaml）/ Task（priority 70, lazy true, source TaskStore）/ Working（priority 50, lazy true, source WorkingMemory）/ Episodic（priority 30, lazy true, source EpisodicMemory）五层，Token 不足时丢弃低优先级层。升级 `core/context_layer_manager.py` 支持 lazy + priority + cache 字段。
- **M3.5 Context Caching**：与 M9 Prompt Caching 协同，Cache Key 为 `sha256(content + persona_id + agent_id)`，TTL 默认 1h，Persona 更新触发主动失效，Cache 失效率监控（OTel Metric `flowforge.cache.hit_rate`）。Cache 流程：Agent 调用 → 检查 Cache（content hash）→ Hit 直接返回（免重算）/ Miss 构建 Context → 写入 Cache → 返回。System / Persona 层 Cache 命中率最高。

**集成点**：`harness/context_engine.py` 升级为 JIT 模式、`core/context_layer_manager.py` 升级支持 lazy + priority、`memory/` 全部 Memory store 增强 + Memory Tool API、`tools/registry.py` 注册 context_fetch / memory_* 工具、`loop/executor.py` Loop 每步构建 Context、`core/tracing.py` Context 操作 OTel Span、`core/di.py` Context 组件 DI 注入。

**设计要点**：Loop 每步构建 Context，T7 审核通过率不下降（质量底线）。与 v7.0 FR-EVO-02 Mind Echo + ForgekinEngine 步骤 1-4 深度融合（JIT Context / Memory Tool / Context Editor 直接服务于 ForgekinEngine.execute() 的 soul.load() + echo.recall() + imprint.load() + build_soul_prompt() 步骤；M3 五层 Context Layer 对应 Mind Echo 三层记忆 L1 Working / L2 Episode / L3 Semantic）。

**验收标准**：JIT 模式 Token 下降 ≥ 40%（决策 4 渐进式目标 20-30%，全 JIT 目标 40%+）；Memory Tool 4 API 全部可用；50 轮对话 Token 稳定 32K 内；Cache 命中率 ≥ 60%；T7 审核通过率不下降（质量底线）；Context 操作 OTel Span 完整（T10 协同）。

### 4.4 M4 六层 Guardrails 闭环

**背景**：小米追问"事故驱动护栏如何从一次失败升级为系统性防线"，"软 + 硬 + Eval 三层 Harness 如何工作：软层承载 Skill / Convention，硬层负责检查与拦截，Eval 负责验证闭环"。v2.1 仅有 PermissionPipeline 前馈，缺少后馈验证和闭环。v3.0 必须建立六层闭环 Guardrails，覆盖输入 / 系统提示 / 工具 / 输出 / 动作 / 成本全链路。

**需求**：
- **M4.1 Input Validation（L1）**：Prompt Injection 检测（LLM-as-Judge）/ Jailbreak 检测（关键词 + 模式匹配）/ PII 检测（身份证 / 手机 / 邮箱 / 银行卡）/ 长度限制 / 多语言识别。新增 `security/guardrails/input_validator.py`，策略 YAML 配置化（`config/guardrails/input_validation.yaml`）。
- **M4.2 System Prompt Constraints（L2）**：自动注入 AGENTS.md（项目规则）/ Skill 白名单 / Linter 规则 / 权限管线（M11 CHEQ 协同），System Prompt 防泄露（标记 system role + 输出过滤检测是否泄露 system prompt 内容 + OTel 记录注入内容）。新增 `security/guardrails/system_prompt_guard.py`。
- **M4.3 Tool Allow-lists（L3）**：每个 Agent 声明可用工具集（YAML `config/guardrails/tool_allowlist.yaml`），运行时强制校验（不在白名单不可调用），工具参数 Schema 校验（Pydantic），工具调用频率限制（rate_limit: 30/min 等），与 M2 MCP 沙箱协同。新增 `security/guardrails/tool_allowlist.py`。
- **M4.4 Output Validation（L4）**：内容审核（豆包 moderation）/ 事实核查（fact_check 工具强制调用）/ 代码安全扫描（bandit / semgrep）/ AI 痕迹检测（T7 标准）/ 格式校验（JSON Schema / Markdown）。新增 `security/guardrails/output_validator.py`，违规内容被拦截。
- **M4.5 Action Confirmation（L5）**：高风险 Action 列表（YAML `config/guardrails/action_confirmation.yaml`：publish_to_production / database_migration / deployment 等），二次确认机制（Web UI / 即时通讯），Blast-radius Gate（影响范围评估，M12 协同，blast_radius_threshold 触发双人审批），时间窗口限制（24h 可撤销 revocation_window），多人会签（M-of-N approvers min_count）。新增 `security/guardrails/action_confirmation.py`。
- **M4.6 Cost Ceilings（L6）**：每会话成本上限（默认 $10）/ 每日成本上限（默认 $100）/ 每月成本上限（默认 $1000）/ 超额自动熔断 / 实时成本仪表盘（Web UI）。新增 `security/guardrails/cost_ceiling.py`，与 M9 成本归因协同，按 tenant + agent_id 维度限流配额。

**编排器**：新增 `security/guardrails/orchestrator.py` 的 `GuardrailsOrchestrator`，编排前馈 `pre_check(request)`（L1 Input + L2 System Prompt + L3 Tool Allowlist）和后馈 `post_check(response)`（L4 Output + L5 Action Confirm + L6 Cost），与 HybridExecutor 集成（执行前后调用），通过 DI 注入，OTel Trace 全覆盖。

**集成点**：`security/permission_pipeline.py` 升级为 L2 / L3、`security/moderation.py` 升级为 L4 内容审核、`security/arch_constraint.py` 架构约束、`core/circuit_breaker.py` L6 Cost 超限熔断、`core/gate/orchestrator.py` L5 Action Confirm、`tools/registry.py` L3 工具白名单校验、`core/di.py` Guardrails 组件 DI 注入。

**设计要点**：六层闭环 = 前馈（L1+L2+L3，执行前拦截）+ 后馈（L4+L5+L6，执行后验证）。与 v7.0 SR-01~08 安全红线延伸融合（M4 六层 Guardrails 是 v7.0 安全红线的工程落地：SR-01 no-classifier / SR-03 Provoke 频率硬限 / SR-04 高风险域升级 / SR-06 worktree 隔离 / SR-08 跨 *Forge 可审计）。

**验收标准**：T13 Guardrails 闭环测试通过（六层全部触发）；Injection 检出率 ≥ 95%（50 例测试集）；高风险 Action 100% 二次确认；超额熔断生效；System Prompt 不泄露给用户；白名单外工具被拦截；违规内容被拦截。

### 4.5 M5 OTel GenAI v1.30

**背景**：阿里追问"自进化如何做 Eval"，"为什么不做每日曲线"。可观测性是所有模块的基础，v2.1 的 Tracing 非 OTel 标准，无法与行业工具（Jaeger / LangSmith / Langfuse / Phoenix）互通。v3.0 必须对齐 OTel GenAI v1.30 的 `gen_ai.*` schema，实现端到端 Trace 串联和 Eval-gated 发布门禁。M5 是所有模块的基础，建议最先实施。

**需求**：
- **M5.1 gen_ai.* Span Schema**：定义 `gen_ai.llm` / `gen_ai.tool` / `gen_ai.agent` Span 属性（gen_ai.system / gen_ai.request.model / gen_ai.usage.input_tokens / gen_ai.usage.output_tokens / gen_ai.response.finish_reason / gen_ai.prompt / gen_ai.completion），定义 Span 层级关系（root → gateway → agent → context_engine → llm → tool → mcp）。升级 `observability/tracer.py` 为 `observability/genai_tracer.py`，实现 `trace_llm_call(model, input, output, usage)` / `trace_tool_call(tool_name, input, output)` / `trace_agent_exec(agent_id, input)`。
- **M5.2 Metrics 标准化**：`gen_ai.client.token_usage`（Counter，Token 使用量）/ `gen_ai.client.operation_duration`（Histogram，操作延迟）/ `gen_ai.server.active_requests`（UpDownCounter，活跃请求数）/ `flowforge.cache.hit_rate`（Gauge，Cache 命中率）/ `flowforge.guardrails.block_count`（Counter，Guardrails 拦截数）/ `flowforge.a2a.task_duration`（Histogram，A2A 任务延迟）。与现有 `metrics_collector.py` 协同。
- **M5.3 Exporter 多后端**：OTLP gRPC（默认，endpoint localhost:4317）/ LangSmith（按需，api_key 环境变量）/ Langfuse（按需，public_key + secret_key 环境变量）/ Phoenix（按需，endpoint localhost:6006），配置驱动选择 `config/observability/exporters.yaml`。至少 2 个 Exporter 可用。
- **M5.4 Trace 端到端串联**：Gateway 请求生成 root Span（`gateway.handle`），Harness / Engine / Agent / Tool / LLM 阶段生成子 Span（`guardrails.pre_check` / `gen_ai.agent` / `context_engine.build_context` / `gen_ai.llm` / `gen_ai.tool` / `mcp.call` / `guardrails.post_check` / `hitl.checkpoint` / `audit.log`），全链路一个 Trace ID 传递（context propagation），支持 Distributed Tracing（跨 A2A 调用，M1 协同，trace_id 透传）。
- **M5.5 Eval-gated Deploy Gate**：发布前自动跑 τ-bench（k=5），pass^5 ≥ 80% 才允许发布，失败自动回滚，评估报告 OTel Trace 化（M6 协同，P1 可先桩实现）。新增 `observability/eval_gate.py` 的 `EvalGatedDeploy.pre_deploy_check(version)` 接口。

**告警规则**：`config/observability/alerts.yaml` 定义 LLM 失败率 > 5% 告警（5m 窗口）、平均延迟 > 30s 告警（5m 窗口）、Token 异常增长告警、Cache 命中率 < 50% 告警（1h 窗口，M9 协同）。

**Helm UI Trace View**：新增 `TraceView.tsx` 组件，Span 树形展开（可折叠），LLM Input / Output 可查看（支持折叠长内容），错误 Span 高亮（红色），慢 Span 高亮（黄色，> P95），与现有 `ToolCallCard.tsx` / `LLMCallCard.tsx` 协同。

**集成点**：`observability/tracer.py` 升级为 gen_ai.* schema、`observability/metrics_collector.py` 对齐 gen_ai Metrics、`observability/alerts.py` 升级告警规则、`core/tracing.py` `get_logger` 增加 OTel Span 上下文、`llm/provider.py` LLM 调用生成 gen_ai.llm Span、`tools/registry.py` 工具调用生成 gen_ai.tool Span、`core/di.py` OTel 组件 DI 注入。

**设计要点**：所有模块依赖 M5（Trace 基础），建议最先实施。与 v7.0 可观测性指标（附录 12.4）直接融合（M5 的 gen_ai.* Span / Metrics 直接对应 v7.0 的 forgekin_active_total / auto_forge_runs_total / soul_echo_episodes_total / a2a_messages_total 等指标）。

**验收标准**：T10 OTel Trace 完整性测试通过（每个 Span 完整生成）；Metrics 上报 Prometheus 格式正确；至少 2 个 Exporter 可用；用户→LLM 一个 Trace ID 完整串联；不合格版本被阻断（T14 测试）；告警规则全部触发测试通过；Helm UI Trace 视图可用，Span 树完整展示。

### 4.6 M6 评估与基准测试

**背景**：阿里 / 小米反复追问"Eval 怎么做"、"Harness 改完如何做回归"、"为什么不做每日曲线"。v2.1 仅有 T7 LLM 审核，缺少行业基准和回归套件，无法回答"模型从 4.6 升到 4.7 如何比较"、"Gemini 与 Opus、不同 thinking level 的 ROI 如何计算"。v3.0 必须建立 τ-bench / SWE-bench Pro / 回归测试三位一体的评估体系，覆盖 Agent + Harness + 环境 + 人类流程的系统级评测。

**需求**：
- **M6.1 τ-bench pass^k 集成**：集成 τ-bench 基准测试，支持 pass^k 指标（k=5 默认，可配置 k=1/3/5/10），用于 Eval-gated 发布门禁（M5.5 协同），支持自定义任务集。任务集存储于 `eval/benchmarks/tau-bench/`，包含 retail / airline / retail-complex 三类场景，每类 ≥ 20 case。评估执行流程：CI 触发 → 拉取任务集 → 并行执行（k 次）→ 统计 pass^k → 生成报告（OTel Trace 化）→ 门禁判定。
- **M6.2 SWE-bench Pro 集成**：集成 SWE-bench Pro 代码修复基准，针对 DevForge 场景，评估真实 GitHub Issue 修复能力。支持按语言（Python / TypeScript / Java / Go）筛选任务，支持 Docker 沙箱执行测试用例（与 M2 工具沙箱协同）。评估指标：resolved / unresolved / partial / error，同时记录首次修复成功率与多轮修复成功率。
- **M6.3 回归测试套件**：金标准任务集（≥ 50 case），覆盖 9 大模式（ReAct / Plan-Execute / Reflexion / CoT / Reflexion+ / TAOR 等）/ 30+ Agent / 50+ Tool。Harness 改完自动回归，旧能力漂移检测（对比 baseline 报告，分数下降 > 5% 告警）。回归套件存储于 `eval/regression/golden/`，每个 case 包含 input / expected_output / eval_criteria / tolerance。
- **M6.4 在线评估**：线上任务采样评估（非每日全量曲线，避免 Goodhart / SR-02 协同），离线 Benchmark 与真实线上任务的关系建模（建立映射表：Benchmark pass^k → 线上成功率预测）。Eval 应该对用户暴露多少：隐藏复杂度但保留可解释性（用户可见"本次任务质量分 0.87"但不可见内部 τ-bench 细节）。
- **M6.5 Memory / Skill 沉淀评估**：衡量 Memory / Skill 沉淀以后真的被召回、被使用并改善结果，而非堆积日志。指标：Memory 召回率（被检索 / 总存储）、Memory 命中率（被检索且被 LLM 引用 / 被检索）、Skill 使用频率、Skill 成功率（成功执行 / 总调用）、Skill 质量分趋势（是否随版本提升）。
- **M6.6 组织提效衡量**：速度（任务完成时间 / P50 / P95）、质量（一次性通过率 / 返工率）、合入率（PR merge / PR total）、人工检查点占比（需人工介入 / 总步骤）、业务结果（ContentForge 文章通过率 / DevForge 代码合入率）。按 tenant / project / agent 维度归因。

**设计要点**：新增 `eval/` 模块（benchmarks / regression / online / metrics / report），与 M5 OTel 集成（评估报告 Trace 化，每个 Eval case 生成独立 Span）。不做每日曲线（避免 Goodhart，SR-02 协同），只采高信号样本。与 M10 生产化部署协同（Eval-gated 门禁）。与 v7.0 FR-EVO-06 Skill 自生成的 Eval Ledger 深度融合（最小可信 case 数 5，覆盖 3 类），与 FR-EVO-14 炉启训练协同（新灵智入门评估）。

**集成点**：`eval/runner.py` 评估执行器、`eval/benchmarks/` τ-bench / SWE-bench Pro 集成、`eval/regression/` 回归套件、`eval/metrics/` 指标采集（复用 M5 OTel Metric）、`eval/report/` 报告生成（OTel Trace + Markdown）、CI/CD pipeline 集成（GitHub Actions / GitLab CI）。

**验收标准**：T14 Eval-gated 阻断测试通过（τ-bench pass^5 未达标自动阻断）；τ-bench pass^5 ≥ 80%；SWE-bench Pro 可运行（Docker 沙箱测试通过）；回归套件覆盖 50+ case（9 大模式全覆盖）；Memory / Skill 召回率可度量；组织提效指标仪表盘可用。

### 4.7 M7 Durable Execution + 长程任务

**背景**：深信服追问"长程任务中发生上下文压缩、丢失细节时如何恢复"，小米问"长流程开发如何保持上下文一致，一个 Feature 做五天时如何不偏离目标"，腾讯问"需求变更时怎么处理，尤其是 SDD 中的需求变更"。v2.1 无 Durable Execution，长程任务无保障，进程崩溃即丢失全部进度。v3.0 必须支持 30+ 小时连续运行，中途可暂停 / 恢复，不丢失上下文和进度。

**需求**：
- **M7.1 Durable Event Log**：每个 Step 写入 Durable Event Log（PostgreSQL `durable_events` 表），记录 step_id / agent_id / task_id / input / output / state_snapshot / timestamp / trace_id / parent_step_id。事件类型：step_start / step_complete / step_error / checkpoint / hitl_pause / hitl_resume。故障恢复流程：进程重启 → 读取最近 checkpoint → 重放 checkpoint 之后的 events → 恢复至崩溃前状态。
- **M7.2 Checkpoint 机制**：定期 Checkpoint（每 N 步默认 10，或时间窗口默认 5min，可配置 `config/durable/checkpoint.yaml`），Checkpoint 包含完整 State 快照（Agent State + Working Memory + Tool State），存储于 `durable_checkpoints` 表。重启后自动恢复至最近 Checkpoint，然后重放后续 events。Checkpoint 采用增量 + 全量混合策略（每 N 次增量后一次全量，避免无限增长）。
- **M7.3 30+ 小时连续运行**：支持长程任务（30+ 小时），中途可暂停 / 恢复，不丢失上下文和进度。暂停机制：用户主动暂停（HITL）/ 系统暂停（资源不足 / 维护窗口）/ 自动暂停（超时阈值触发）。恢复机制：从最近 Checkpoint 恢复 → 重放 events → 重建上下文（与 M3 Context Editor 协同，沉睡 Agent 被 @ 时增量补齐）→ 继续执行。
- **M7.4 Saga 模式**：长程任务拆分为 Saga 步骤，每步有补偿动作（compensation），失败时按逆序回滚已执行步骤。Saga 定义 YAML 化：`config/durable/sagas/{saga_name}.yaml` 定义 steps（name / action / compensation / timeout / retry_policy）。Saga 协调器（`engine/durable/saga_coordinator.py`）管理 Saga 执行状态机（running / compensating / completed / failed / aborted）。
- **M7.5 Outbox 模式**：事件与状态变更原子写入（Outbox 表 `durable_outbox`），保证至少一次投递（at-least-once），与 EventBus 协同。Outbox Relay 进程定期扫描未投递事件，投递成功后标记为 delivered。与 M15 故障恢复协同（Outbox 是故障恢复的基础设施）。
- **M7.6 需求变更处理**：长程任务执行中需求变更时，支持 Spec / 计划 / 测试 / 实现同步更新（腾讯问"SDD 需求变更"）。变更流程：暂停任务 → 更新 Spec（diff 记录）→ 重新规划剩余步骤（增量规划，不重做已完成步骤）→ 恢复执行。变更审计完整记录。

**设计要点**：新增 `engine/durable/` 模块（event_log / checkpoint_manager / saga_coordinator / outbox_relay / recovery_manager），复用 PostgreSQL 持久化（与 SQLite 任务表并存，PostgreSQL 专供 Durable）。与 M3 Context Editor 协同（长任务中途压缩，摘要 + 证据指针，沉睡 Agent 被 @ 时增量补齐）。与 M11 CHEQ 协同（HITL 中断持久化）。与 M15 故障恢复协同（Self-healing 从 Checkpoint 恢复）。

**集成点**：`engine/durable/event_log.py` 事件日志、`engine/durable/checkpoint_manager.py` 检查点管理、`engine/durable/saga_coordinator.py` Saga 协调器、`engine/durable/outbox_relay.py` Outbox 投递、`engine/durable/recovery_manager.py` 恢复管理器、`core/repository.py` 数据访问层（红线 4，禁止直接操作数据库）、`events/event_bus.py` 事件总线协同。

**验收标准**：T12 Durable Execution 测试通过；重启后任务从 Checkpoint 恢复（≤ 5s 恢复时间）；30+ 小时连续运行不中断；Saga 回滚生效（补偿动作正确执行）；Outbox 至少一次投递（无丢失）；需求变更后增量重规划可用。

### 4.8 M8 自我纠错 2.0

**背景**：小米追问"软 + 硬 + Eval 三层 Harness 如何工作：软层承载 Skill / Convention，硬层负责检查与拦截，Eval 负责验证闭环"，深信服问"使用 GLM 等较弱模型时 Tool calling 不准确如何治理"。v2.1 仅有 Reflexion 单一纠错（事后反思），缺乏事前预防和事中监控。v3.0 必须升级为 PreFlect（事前预防）+ VIGIL（事中监控）+ SAGE（事故驱动）三层纠错体系。

**需求**：
- **M8.1 PreFlect（事前预防）**：Agent 执行前预检，预测所需上下文（与 M3 JIT 协同，预加载高概率需要的 Memory / Skill），预测可能失败模式（基于历史 SAGE 事故库 + 任务特征），注入预防性 Convention（软层 Skill / Convention）。PreFlect 输出：`{predicted_context: [...], predicted_failures: [...], injected_conventions: [...]}`。预检耗时 ≤ 2s（不阻塞主流程）。
- **M8.2 VIGIL（多假设归因）**：执行中实时监控，多假设归因异常根因，不锁定单一假设（避免错误归因导致错误纠错）。VIGIL 维护假设列表 `[{hypothesis: "...", confidence: 0.7, evidence: [...]}, ...]`，每步更新。异常检测信号：OTel Span 异常（M5 协同）、Tool 调用失败率突增、LLM 输出异常模式（重复 / 空响应 / 幻觉指标）、State 漂移检测。触发 VIGIL 后不立即纠错，而是收集更多证据直到置信度 > 0.8。
- **M8.3 SAGE（事故驱动）**：任务失败 / 异常时多假设根因分析，失败模式分类（context_missing / tool_failure / llm_hallucination / logic_error / permission_denied / timeout / resource_exhausted），生成护栏规则草案（YAML），人工确认后注入 M4 Guardrails，防止同类问题再次发生。SAGE 输出：`{root_cause: "...", failure_pattern: "...", guardrail_rule: {layer: "L3", rule: "...", action: "block"}, similar_incidents: [...]}`。
- **M8.4 迭代上限**：Error-driven Reflection 迭代上限 3-5 次（可配置 `config/engine/reflection.yaml`），避免无限循环。每次 Reflection 记录原因和改进措施，超过上限后升级为 SAGE 事故处理（触发人工介入 M11 CHEQ）。
- **M8.5 弱模型 Tool Calling 治理**：针对 GLM 等较弱模型 Tool calling 不准确问题（深信服面试信号），实现 Tool Schema 简化（弱模型用简化版 Schema）、Tool Call 验证（调用前参数校验）、Tool Call 重试（参数错误自动修正重试 ≤ 2 次）、Tool Call 降级（连续失败后降级为内置工具或人工介入）。

**设计要点**：新增 `engine/preflect.py`（事前预检）、`engine/vigil.py`（事中多假设监控）、`engine/sage.py`（事故驱动护栏生成）。与 M4 Guardrails Orchestrator 协同（SAGE 产出护栏规则注入 M4 六层 Guardrails）。与 M5 OTel 协同（VIGIL 基于 OTel Span 异常检测）。与 v7.0 FR-EVO-04 SpiritForge 深度融合（PreFlect 对应灵锻"读留痕"、VIGIL 对应"画线"、SAGE 对应"写日记"——详见 M18-M20 融合映射）。

**集成点**：`engine/preflect.py` 事前预检模块、`engine/vigil.py` 多假设监控模块、`engine/sage.py` 事故驱动模块、`config/engine/reflection.yaml` 反射配置、`config/guardrails/sage_rules/` SAGE 生成的护栏规则存储、`core/tracing.py` 日志协同（OTel Span 异常检测）。

**验收标准**：PreFlect 上下文预测准确率 ≥ 70%；VIGIL 多假设归因可用（假设列表动态更新）；SAGE 事故驱动护栏草案自动生成（YAML 格式正确）；迭代上限 3-5 次生效（超限升级 SAGE）；弱模型 Tool Calling 治理可用（GLM 模型 Tool calling 成功率 ≥ 85%）。

### 4.9 M9 Prompt Caching + 成本优化

**背景**：阿里追问"Sandbox economics"、"一人一 Sandbox 成本过高时有什么轻量化隔离方案"，深信服问"大仓 / 多仓 / 弱模型 / 质量 / 安全 / 组织知识 / 商业交付"中的成本问题。v2.1 成本治理粗放，无 Prompt Caching，无 cost-aware routing，无配额池，无成本归因。v3.0 必须实现 45-80% 缓存命中率和 cost-aware routing，控制整体 LLM 调用成本。

**需求**：
- **M9.1 Prompt Caching**：System / Persona 层 Cache（命中率最高，因变化少），Cache Key 为 content hash（SHA-256），TTL 默认 1h（可配置 `config/harness/prompt_cache.yaml`），Persona 更新触发主动失效（version 字段比对）。Cache 存储于 Redis（`prompt_cache:{hash}` → content），与 M3 Context Caching 协同。目标命中率 45-80%（System / Persona 层命中率应 > 80%，Task / Working 层因 JIT 不缓存）。Cache 命中率监控（OTel Metric `prompt_cache_hit_total` / `prompt_cache_miss_total`）。
- **M9.2 Cost-Aware Routing**：根据任务复杂度路由到不同模型（简单任务用便宜模型如 DeepSeek-V3 / 通义千问-Turbo，复杂任务用强模型如 Claude Opus / GPT-4o），与 OpenRoute 多模型 API 网关协同。复杂度评估信号：任务类型（创作 / 推理 / 编码 / 检索）、输入长度、历史同类任务成本、用户偏好（质量优先 / 成本优先）。路由策略 YAML 化：`config/harness/cost_router.yaml` 定义 rules（condition → model → fallback）。
- **M9.3 配额池**：多 Provider 配额池（DeepSeek / 通义千问 / 智谱 / OpenAI / Anthropic / 豆包），配额耗尽自动切换（与 project_rules.md "Flowforge must use backup models when configured models fail" 一致），与 M4 L6 Cost Ceilings 协同。配额池配置：`config/models/quota_pool.yaml` 定义 providers（name / api_key_env / qps_limit / daily_token_limit / cost_per_1k_tokens / health_check_url）。配额状态实时监控（OTel Metric）。
- **M9.4 成本归因**：按 tenant / project / agent / task / tool 维度归因成本，预留 tenant_id 字段（M16 协同），实时成本仪表盘（Helm UI）。成本记录表 `cost_ledger`（tenant_id / project_id / agent_id / task_id / tool_name / model / input_tokens / output_tokens / cost / timestamp）。成本告警（日预算超限 / 单任务成本超限 / 配额即将耗尽）。
- **M9.5 Sandbox 成本优化**：轻量化隔离方案（阿里问"一人一 Sandbox 成本过高"）：容器共享（同租户共享容器，进程级隔离）、按需启动（空闲超 30min 自动关闭）、冷启动优化（预热镜像 / layered cache）、成本归因到租户（M16 协同）。与 M2 工具沙箱协同。

**设计要点**：新增 `harness/prompt_cache.py`（Redis Cache + 失效策略）、`harness/cost_router.py`（复杂度评估 + 模型路由）、`harness/quota_pool.py`（配额池管理 + 自动切换）、`harness/cost_ledger.py`（成本归因 + 仪表盘数据）。Cache 失效率监控（OTel Metric）。与 M5 OTel 协同（Cache 命中率 / 成本 Metric）。与 v7.0 性能 SLO 协同（SpiritForge < 5min / Mind Echo 写入 < 100ms / Skill 验证 < 10min 需要成本优化支撑）。

**集成点**：`harness/prompt_cache.py` Prompt 缓存、`harness/cost_router.py` 成本路由、`harness/quota_pool.py` 配额池、`harness/cost_ledger.py` 成本归因、`config/harness/prompt_cache.yaml` 缓存配置、`config/harness/cost_router.yaml` 路由配置、`config/models/quota_pool.yaml` 配额池配置、`core/llm_client.py` LLM 客户端集成（Cache + Routing 透明注入）、Helm UI 成本仪表盘组件。

**验收标准**：Cache 命中率 45-80%（System / Persona 层 > 80%）；Cost-Aware Routing 生效（简单任务路由到便宜模型）；配额池自动切换（主 Provider 耗尽自动切换备用）；成本归因可查（按 tenant / agent / task 维度）；Sandbox 成本优化可用（共享容器 + 按需启动）。

### 4.10 M10 生产化部署

**背景**：小米问"CI/CD 发现问题后，自动修复、验证和合入应该做到哪一步"，"如何判断修改真的更好"，腾讯问"如何保证新功能加入后老功能不漂移"。v2.1 无灰度 / A/B / Eval-gated 回滚，Harness 修改直接全量上线，风险不可控。v3.0 必须建立生产化部署体系，包括灰度发布、A/B 测试、Eval-gated 自动回滚、自指修改防漂移。

**需求**：
- **M10.1 灰度发布**：1% → 10% → 50% → 100% 渐进发布（可配置阶段 `config/deploy/canary.yaml`），与 M5 Eval-gated 协同，线上监控异常自动回滚。灰度策略：按 tenant 灰度（先内部租户后外部租户）、按流量灰度（百分比路由）、按功能灰度（Feature Flag 控制新功能可见性）。灰度期间监控指标：错误率 / 延迟 P95 / τ-bench pass^k / 用户满意度，任一指标恶化 > 阈值自动回滚。
- **M10.2 A/B 测试**：新旧版本并行，按流量比例分流（50/50 或自定义比例），统计显著性检验（t-test / Mann-Whitney U，p < 0.05 视为显著），自动选择优胜版本。A/B 测试配置：`config/deploy/ab_test.yaml` 定义 experiment_id / variant_a / variant_b / traffic_split / metrics / duration / significance_threshold。A/B 测试结果记录完整，支持回溯分析。
- **M10.3 Eval-gated 自动回滚**：发布前自动跑 τ-bench（M5.5），pass^k 未达标自动回滚，评估报告 OTel Trace 化。Eval-gated 配置：`config/deploy/eval_gate.yaml` 定义 benchmark / pass_threshold / k_value / timeout / on_fail（block / rollback / notify）。支持多层门禁：单元测试 → 集成测试 → 回归套件 → τ-bench → 灰度监控，任一层失败阻断后续。
- **M10.4 自指修改防漂移**：Agent 修改 Harness 配置时触发检查链：①Eval 回归测试（金标准任务集 M6.3，分数下降 > 5% 阻断）；②人工审批（M11 CHEQ，高风险修改需 operator 确认）；③灰度发布（先 1% 流量验证）；④线上监控异常自动回滚；⑤完整审计记录（谁改了什么 / 为什么改 / 何时改 / 影响范围）。与 v7.0 FR-EVO-04 SpiritForge 协同（自指修改 100% 经 Eval + 审批 + 灰度）。
- **M10.5 CI/CD Pipeline 集成**：与 GitHub Actions / GitLab CI 集成，PR 提交触发：lint → type check → unit test → integration test → regression test → τ-bench → SWE-bench Pro → build → deploy canary → monitor → promote / rollback。Pipeline 配置 YAML 化，支持并行执行加速。

**设计要点**：新增 `deploy/` 模块（canary / ab_test / eval_gate / drift_prevention / pipeline）。与 M5 Eval-gated / M6 τ-bench / M11 CHEQ 协同。与 v7.0 FR-EVO-04 SpiritForge 融合（自指修改防漂移是自进化的安全护栏，灵锻产出的代码修改必须经 Eval-gated + 审批 + 灰度才能合入）。

**集成点**：`deploy/canary_manager.py` 灰度发布管理、`deploy/ab_test_manager.py` A/B 测试管理、`deploy/eval_gate.py` Eval 门禁、`deploy/drift_prevention.py` 防漂移检查、`deploy/pipeline.py` CI/CD 集成、`config/deploy/canary.yaml` / `ab_test.yaml` / `eval_gate.yaml` 配置、`core/feature_flag.py` Feature Flag 管理、GitHub Actions / GitLab CI workflow 文件。

**验收标准**：灰度发布 1%→10%→50%→100% 可控（每阶段可暂停 / 回滚）；A/B 测试统计显著（p < 0.05 自动选择优胜）；Eval-gated 阻断不合格版本（τ-bench pass^k 未达标自动回滚）；自指修改全链路防漂移（Eval + 审批 + 灰度 + 监控 + 审计）；CI/CD Pipeline 集成可用（PR 触发全流程）。

### 4.11 M11 HITL 2.0（IETF CHEQ）

**背景**：深信服追问"长程任务中发生上下文压缩、丢失细节时如何恢复"，本质是 HITL 中断恢复问题。小米问"产品经理 / SE / 开发 / 测试如何与 Agent 协同，哪些环节可以闭环，哪些检查点必须由人负责"。v2.1 HITL 中断不可恢复，进程重启后 HITL 等待状态丢失。v3.0 必须对齐 IETF CHEQ（Coordinated Human Evaluation and Qualification）标准，实现中断持久化与恢复。

**需求**：
- **M11.1 标准化中断恢复**：HITL 中断持久化（CHEQ 标准），重启后自动恢复至中断状态，中断点上下文完整保留。中断状态存储于 `hitl_checkpoints` 表（checkpoint_id / task_id / agent_id / step_id / context_snapshot / pause_reason / paused_at / resumed_at / status）。恢复流程：进程重启 → 扫描 `hitl_checkpoints` 状态为 paused 的记录 → 恢复上下文（从 context_snapshot 重建）→ 等待 operator 响应 → 恢复执行。CHEQ 标准字段对齐：session_id / interaction_id / state / context / metadata。
- **M11.2 HotL（Human-on-the-Loop）**：低风险中断异步通知 operator（飞书 / 邮件 / Web UI 通知），operator 可批量处理。HotL 场景：Skill 审批（新 Skill 上线需 operator 确认）、Persona 更新审批、SAGE 护栏规则确认。通知渠道配置：`config/harness/hitl_channels.yaml` 定义 channels（webhook_url / email / feishu_bot / slack_channel）。operator 响应超时默认 24h（可配置），超时后升级为 HoverL 或自动拒绝。
- **M11.3 HoverL（Human-over-the-Loop）**：高风险中断同步等待 operator，实时干预（M4 L5 Action Confirmation 协同）。HoverL 场景：生产环境部署（需 operator 实时确认）、高 Blast-radius Action（影响 > 100 用户）、自指修改 Harness（需 operator 实时审批）、跨 *Forge 协作（SR-08 需 operator 可见）。HoverL 等待界面（Helm UI）展示完整上下文 + 影响范围 + 建议操作，operator 可 approve / reject / modify。
- **M11.4 DevForge IPD 对接**：与 DevForge IPD（集成产品开发）流程对接，产品经理 / SE / 开发 / 测试与 Agent 协同。IPD 检查点矩阵：需求评审（人主导，Agent 辅助）/ 架构设计（Agent 提案，人审批）/ 编码实现（Agent 主导，人 Review）/ 测试验证（Agent 自动化，人确认关键路径）/ 发布部署（人审批，Agent 执行）。哪些环节可以闭环（编码 / 测试），哪些检查点必须由人负责（需求 / 架构 / 发布）。
- **M11.5 中断上下文管理**：中断时保存完整上下文（Agent State + Working Memory + Tool State + Trace），恢复时完整重建。与 M7 Durable Execution 协同（HITL 中断是 Durable 的特殊事件类型）。与 M3 Context Editor 协同（长任务中断恢复后，上下文可能需要压缩 + 增量补齐）。

**设计要点**：新增 `harness/hitl_cheq.py`（CHEQ 标准中断恢复 + HotL / HoverL 调度）。与 M4 L5 Action Confirmation / M7 Durable Execution / M10 灰度发布协同。与 v7.0 operator 审批节点直接融合（E6 创建灵智需 operator 授权 / Mind Imprint proposal 需 operator 审批 / Provoke 需 operator 反馈——详见 M18-M20 融合映射）。

**集成点**：`harness/hitl_cheq.py` HITL CHEQ 管理器、`config/harness/hitl_channels.yaml` 通知渠道配置、`config/harness/hitl_policy.yaml` 中断策略（HotL / HoverL 触发条件）、Helm UI 中断等待界面组件、`middleware/notify.py` 多渠道通知（飞书 / 邮件 / Webhook）、`engine/durable/event_log.py` Durable 事件协同。

**验收标准**：HITL 中断持久化，重启后恢复（≤ 10s 恢复时间，上下文完整）；HotL 异步通知可用（飞书 / 邮件 / Web UI 多渠道）；HoverL 同步等待可用（Helm UI 实时干预界面）；DevForge IPD 对接跑通（5 检查点矩阵落地）；中断上下文完整重建（无信息丢失）。

### 4.12 M12 Agent 治理

**背景**：腾讯问"如何保证新功能加入后老功能不漂移"、"是否有专门的测试 Agent"，小米问"当前发布成熟度如何"、"平台如何沉淀最佳实践、标准工作范式和治理规则"。v2.1 无 AgentBOM / Blast-radius Gate，Agent 变更无审计，影响范围不可评估。v3.0 必须达到 CSA AGMM Level 4（工业可用），建立完整的 Agent 治理体系。

**需求**：
- **M12.1 AgentBOM**：每个 Agent 生成 BOM（Bill of Materials），包含 dependencies（依赖的 Agent / Tool / Model / Memory）/ version（语义化版本 major.minor.patch）/ capabilities（能力声明）/ permissions（权限清单）/ provenance（来源：谁创建 / 何时创建 / 修改历史）/ license（许可证）。支持 SBOM（Software Bill of Materials）标准格式（SPDX / CycloneDX）。AgentBOM 存储 `agent_bom` 表，每次 Agent 变更自动更新 BOM 版本。BOM 查询 API：`GET /api/v1/governance/agents/{agent_id}/bom`。
- **M12.2 Blast-radius Gates**：高风险 Action 影响范围评估（影响用户数 / 资源 / 数据 / 不可逆性），阈值触发双签 / 升级审批（M4 L5 协同）。Blast-radius 评估维度：affected_users（影响用户数）、affected_resources（影响资源数：文件 / 数据库 / 服务）、data_sensitivity（数据敏感度：public / internal / confidential / restricted）、irreversibility（不可逆性：reversible / compensable / irreversible）。评估结果：low（< 10 用户，reversible）→ 自动执行；medium（10-100 用户，compensable）→ 单签；high（> 100 用户，irreversible）→ 双签 + 升级审批。
- **M12.3 CSA AGMM Level 4**：Identity（身份：AgentBOM + forgekin_id）/ Observability（可观测：OTel 全覆盖）/ Safety（安全：六层 Guardrails 闭环）/ Compliance（合规：审计 + Blast-radius）/ Lifecycle（生命周期：Durable + Checkpoint）/ Collaboration（协作：A2A 协议）/ Evaluation（评估：τ-bench + 回归）/ Governance（治理：AgentBOM + 策略版本化）全部达到 L4（工业可用）。L4 标准：每个维度有文档化流程 + 自动化工具 + 指标监控 + 定期审计。
- **M12.4 治理即代码**：策略 YAML + CI/CD 门禁，AgentBOM 变更需审批，治理规则版本化。治理策略存储 `config/governance/policies/*.yaml`，每次变更 Git 版本化 + PR 审批。CI/CD 门禁：PR 提交时检查 AgentBOM 完整性 / 权限变更 / 依赖变更 / Blast-radius 评估，高风险变更触发人工审批。治理规则热加载（不停机更新）。
- **M12.5 测试 Agent**：专门的测试 Agent（腾讯问"是否有专门的测试 Agent"），负责回归测试 / 集成测试 / Eval 执行 / 质量监控。测试 Agent 配置：`config/agents/test_agent.yaml`，能力：自动运行 M6 回归套件、τ-bench 评估、SWE-bench Pro、生成测试报告、触发回滚（M10 协同）。

**设计要点**：新增 `governance/` 模块（agent_bom / blast_radius / policy_manager / audit_trail）。与 M4 Guardrails / M5 OTel / M6 Eval / M10 生产化部署协同。与 v7.0 FR-EVO-01 灵智身份系统融合（AgentBOM 为 forgekin_id / Mind Profile / 觉醒阶段追踪提供治理基础），与 SR-05 E6 创建灵智需 operator 授权协同（详见 M18-M20 融合映射）。

**集成点**：`governance/agent_bom.py` AgentBOM 管理、`governance/blast_radius.py` Blast-radius 评估、`governance/policy_manager.py` 策略管理、`governance/audit_trail.py` 审计追踪、`config/governance/policies/` 策略 YAML 存储、`config/agents/test_agent.yaml` 测试 Agent 配置、CI/CD 门禁集成、Helm UI 治理仪表盘组件。

**验收标准**：T15 AgentBOM 完整性测试通过（dependencies / version / capabilities / permissions / provenance / license 全字段）；Blast-radius Gate 生效（high 风险双签 + 升级审批）；CSA AGMM 全维度 L4（8 维度全部达标）；治理规则版本化（Git + PR 审批 + 热加载）；测试 Agent 可用（自动回归 + Eval + 报告 + 回滚）。

### 4.13 M13 Computer Use / Browser Use

**背景**：深信服问"如何用 TDD、逻辑修复检查、多模态 Web 测试和安全 Review 保证代码质量"，阿里问"图片 / 视频等长任务如何降低等待感"。v2.1 无 Computer Use / Browser Use，Web 功能测试依赖人工或简单 HTTP 请求，无法验证 DOM 真实状态（T8 测试铁律要求"Web 功能必须操控浏览器验证 DOM"）。v3.0 必须覆盖桌面 + 浏览器（移动端 ROI 低，决策 7 推荐留待 v3.1）。

**需求**：
- **M13.1 GUI Agent**：桌面 GUI 自动化（点击 / 输入 / 截图 / 识别 / 拖拽 / 滚动），支持 Windows / macOS / Linux 三平台。基于 pyautogui / pywinauto（Windows）/ AppKit（macOS）/ xdotool（Linux）实现跨平台抽象层。GUI 操作 API：`click(x, y)` / `input_text(text)` / `screenshot()` / `find_element(image_or_text)` / `drag(start, end)` / `scroll(direction, amount)`。操作前自动截图 + 元素定位，操作后验证截图确认执行。
- **M13.2 Browser Agent**：浏览器自动化（导航 / 表单 / 截图 / DOM 检查 / 网络拦截 / Cookie 管理），与 T8 测试铁律协同（Web 功能必须操控浏览器验证 DOM）。基于 Playwright（Chromium / Firefox / WebKit 三引擎）实现。Browser 操作 API：`navigate(url)` / `click(selector)` / `fill(selector, value)` / `screenshot()` / `get_dom()` / `wait_for(selector, state)` / `intercept_network(pattern)`。DOM 内容调用 LLM 审核质量（T8 协同，DOM 内容长度验证 + LLM 审核无 AI 痕迹）。
- **M13.3 Visual Grounding**：视觉定位（截图 → 元素坐标），支持多模态 LLM（GPT-4V / Claude Vision / 通义千问-VL）。定位流程：截图 → LLM 分析（输出元素描述 + 坐标）→ 验证坐标（二次截图比对）→ 执行操作。支持 OCR 文本定位（pytesseract / PaddleOCR）和图像匹配定位（OpenCV template matching）。定位准确率目标 ≥ 90%（像素级偏差 < 5px）。
- **M13.4 多模态 Web 测试**：Web 功能测试自动化，DOM 内容调用 LLM 审核质量（T8 协同）。测试流程：导航到目标页面 → 等待 DOM 加载（`wait_until="domcontentloaded"`，不用 `networkidle` 避免 Next.js HMR 超时）→ 获取 DOM → HTTP 200 状态检查 → DOM 内容长度验证 → LLM 审核内容质量（无 AI 痕迹 / 信息完整 / 格式正确）。测试报告 OTel Trace 化（M5 协同）。
- **M13.5 长任务等待优化**：图片 / 视频等长任务降低用户等待感（阿里问"图片 / 视频生成耗时较长如何减少等待感"）。策略：进度条实时反馈（SSE 推送 progress）、异步通知（任务完成后飞书 / 邮件通知）、预加载（预测用户下一步操作提前加载）、后台处理（不阻塞主会话）。

**设计要点**：新增 `tools/computer_use/`（GUI Agent 跨平台抽象层）、`tools/browser_use/`（Browser Agent Playwright 封装）。决策 7 推荐"仅桌面 + 浏览器"，移动端碎片化严重（Android / iOS 差异大）ROI 低。与 T8 测试铁律协同（Browser Agent 是 T8 的基础设施）。与 M5 OTel 协同（所有 GUI / Browser 操作生成 Span）。

**集成点**：`tools/computer_use/gui_agent.py` GUI Agent、`tools/computer_use/platform/windows.py` / `macos.py` / `linux.py` 平台适配、`tools/browser_use/browser_agent.py` Browser Agent、`tools/browser_use/visual_grounding.py` 视觉定位、`tools/browser_use/web_test.py` 多模态 Web 测试、`tools/registry.py` 工具注册（DI 合规）、`config/tools/computer_use.yaml` / `browser_use.yaml` 配置。

**验收标准**：GUI Agent 可操作桌面应用（三平台覆盖）；Browser Agent 可验证 DOM（T8 协同，6/6 测试用例通过）；Visual Grounding 定位准确（准确率 ≥ 90%，偏差 < 5px）；多模态 Web 测试可用（HTTP 200 + DOM 长度 + LLM 审核）；长任务等待优化可用（进度反馈 + 异步通知）。

### 4.14 M14 三层协议栈

**背景**：字节问"单 Agent 与多 Agent 的协议边界分别有哪些坑"，"设计时要注意什么"。v2.1 仅有 MCP（v2024），缺少 ACP（Agent Communication Protocol）和 A2A（Agent-to-Agent）的完整协议栈。单 Agent 协议边界（MCP 工具调用）和多 Agent 协议边界（A2A 跨 Agent 通信）的坑不同：单 Agent 关注 Schema / 权限 / 重试 / 验证，多 Agent 关注路由 / 会话 / 终止条件 / 错误传染。v3.0 必须建立 ACP / MCP / A2A 三层协议栈，明确各层职责。

**需求**：
- **M14.1 ACP（Agent Communication Protocol）**：Agent 间通信协议（高于 A2A 应用层），定义消息格式 / 路由 / 会话管理。ACP 消息格式：`{message_id, from_agent, to_agent, message_type, payload, session_id, trace_id, timestamp}`。消息类型：request / response / notification / broadcast / handoff。会话管理：会话创建 / 加入 / 离开 / 终止，会话状态机（active / paused / terminated）。路由策略：直接路由（to_agent 指定）/ 组播路由（to_agents 列表）/ 广播路由（all）。ACP 是 A2A 的底层传输协议。
- **M14.2 MCP（Model Context Protocol）**：工具调用协议（M2 升级到 2026 Spec RC），负责 Agent 与 Tool 之间的通信。MCP 协议层职责：工具发现（Manifest）/ 工具调用（input_schema 校验）/ 工具结果（output_schema 校验）/ 工具沙箱（隔离执行）/ OAuth 授权（用户级）。单 Agent 协议边界坑：Schema 不匹配（弱模型 Tool calling 不准确 → M8.5 协同）、权限不足（L3 Tool Allowlist 拦截）、重试策略（永久错误不重试，临时错误指数退避）、结果验证（output_schema 校验失败触发纠错）。
- **M14.3 A2A（Agent-to-Agent）**：跨厂 Agent 互联协议（M1 实现），负责 Agent 与 Agent 之间的跨厂通信。A2A 协议层职责：Agent 发现（Agent Card）/ 任务下发（Task lifecycle）/ 流式响应（SSE）/ 长任务订阅（push notification）/ 跨厂鉴权（Bearer / OAuth2 / mTLS）。多 Agent 协议边界坑：无限聊天（终止条件：轮数 / 工具进展 / 任务状态 → M1 协同）、错误传染（子 Agent 幻觉 → 上游验证证据，不照单全收）、上下文错配（只看相关内容，需要时追溯全局 → M3 Context 协同）、责任边界不清（Blast-radius Gate → M12 协同）。
- **M14.4 协议适配器**：三层协议适配器，统一注册到 ToolRegistry，支持协议转换（ACP ↔ MCP ↔ A2A）。适配器配置：`config/interconnect/protocol_adapters.yaml` 定义 adapters（name / source_protocol / target_protocol / transform_rules）。协议转换场景：Agent 通过 ACP 发消息 → 适配器转换为 MCP 工具调用 → 工具执行 → 结果转回 ACP 响应。适配器支持同步 / 异步 / 流式三种模式。

**设计要点**：新增 `interconnect/acp/orchestrator.py`（ACP 协调器，管理 Agent 间消息路由和会话）。与 M1 A2A / M2 MCP 协同（三层协议栈完整）。P2 优先级（Phase 6.2 实施，M1 / M2 完成后 ACP 作为补充层）。与 v7.0 FR-EVO-09 A2A 通信协议和 FR-EVO-10 灵议多渠道协作提供协议基础。

**集成点**：`interconnect/acp/orchestrator.py` ACP 协调器、`interconnect/acp/message_router.py` 消息路由、`interconnect/acp/session_manager.py` 会话管理、`interconnect/protocol_adapter.py` 协议适配器、`config/interconnect/protocol_adapters.yaml` 适配器配置、`tools/registry.py` 统一工具注册、`core/tracing.py` OTel Trace 跨协议传播。

**验收标准**：三层协议栈完整（ACP / MCP / A2A 各层职责清晰）；协议适配器可用（ACP ↔ MCP ↔ A2A 转换正确）；协议转换正确（消息格式 / 路由 / 会话状态保持）；单 Agent 协议边界坑已覆盖（Schema / 权限 / 重试 / 验证）；多 Agent 协议边界坑已覆盖（终止条件 / 错误传染 / 上下文 / 责任边界）。

### 4.15 M15 故障恢复与降级

**背景**：字节一面追问"failure mode"、"主子模式下子 Agent 产生幻觉怎么办"，阿里问"两个 Agent 自由协同时可能一直瞎聊，如何设置终止条件"。v2.1 故障恢复薄弱，无 Self-healing Runtime，无 Bulkhead 隔离，无降级链路。v3.0 必须建立 Self-healing Runtime + Saga + Outbox + Bulkhead + 降级链路完整的故障恢复体系。

**需求**：
- **M15.1 Self-healing Runtime**：自动检测故障（健康检查 + OTel 异常 + 心跳超时），自动重启 / 切换 / 降级。健康检查维度：进程存活（PID 检查）、端口监听（TCP 探测）、API 可用（HTTP /health）、LLM 可达（OpenRoute /health）、DB 连通（PostgreSQL / SQLite ping）、Redis 连通（ping）。检测间隔 30s（可配置），连续 3 次失败触发自愈。自愈动作：重启进程 → 切换备用实例 → 降级模式（关闭非核心功能）→ 告警通知（M11 协同）。
- **M15.2 Saga 模式**：长程任务 Saga 步骤 + 补偿动作（M7.4 协同），失败时按逆序回滚已执行步骤。Saga 状态机：running →（成功）→ completed /（失败）→ compensating →（补偿成功）→ aborted /（补偿失败）→ manual_intervention。补偿动作幂等设计（可重复执行不产生副作用）。Saga 超时处理：单步超时触发补偿，整体超时触发全量回滚。
- **M15.3 Outbox 模式**：事件与状态变更原子写入（M7.5 协同），至少一次投递（at-least-once）。Outbox Relay 进程定期扫描未投递事件（间隔 5s），投递成功标记 delivered，投递失败重试（指数退避，最多 5 次），超过重试上限告警。消费者幂等处理（基于 event_id 去重）。Outbox 表定期清理（已投递 > 7 天的记录归档）。
- **M15.4 Bulkhead 隔离**：资源隔离（线程池 / 进程池 / 容器），防止级联故障。Bulkhead 策略：按 Agent 隔离（每个 Agent 独立线程池）、按租户隔离（每个租户独立进程池，M16 协同）、按任务类型隔离（创作 / 推理 / 编码独立资源池）、按工具隔离（高风险工具独立容器）。隔离配置：`config/runtime/bulkhead.yaml` 定义 pools（name / type / size / queue_size / timeout）。线程池满时拒绝策略：abort（拒绝）/ caller_runs（调用方执行）/ discard（丢弃 oldest）。
- **M15.5 降级链路**：完整降级链路，逐级降级保证核心功能可用。①A2A 不可用 → 内部 Agent（M1 协同，跨厂调用失败回退到内部 Agent）；②MCP 工具不可用 → 内置工具（M2 协同，外部工具超时回退到内置工具）；③外部 LLM 不可用 → 备用 Provider（M9.3 协同，主 Provider 耗尽切换备用）；④Memory 不可用 → 短期上下文（M3 协同，长期记忆不可用时只用 Working Memory）；⑤Browser Agent 不可用 → HTTP 请求（M13 协同，浏览器自动化失败回退到简单 HTTP）；⑥Trae Bridge 超时 → 内置 Agent（SR-07 协同，外部编码工具超时降级）。
- **M15.6 终止条件治理**：两个 Agent 自由协同时防止无限聊天（阿里问"一直瞎聊如何终止"）。终止条件：轮数上限（默认 10 轮，可配置）、工具进展检测（连续 3 轮无工具调用 → 终止）、任务状态检测（task_state = completed / failed → 终止）、外部事件（用户取消 / 超时 → 终止）、循环检测（相同消息重复 ≥ 3 次 → 终止）。

**设计要点**：新增 `runtime/self_healing.py`（健康检查 + 自愈）、`runtime/bulkhead.py`（资源隔离）、`runtime/degradation.py`（降级链路管理）。与 M7 Durable / M1 A2A / M2 MCP / M3 Context / M9 Cost / M13 Computer Use 协同。与 v7.0 降级策略协同（ForgekinEngine → HybridExecutor，SpiritForge → 跳过，External Tool → 内置 Agent，Trae Bridge → 内置 Agent，Council → 单渠道，A2A → 直接调用——详见 M18-M20 融合映射）。

**集成点**：`runtime/self_healing.py` 自愈管理器、`runtime/bulkhead.py` Bulkhead 隔离、`runtime/degradation.py` 降级链路、`runtime/health_check.py` 健康检查、`config/runtime/bulkhead.yaml` 隔离配置、`config/runtime/degradation.yaml` 降级策略配置、`middleware/health.py` 健康检查端点（`/health` / `/ready` / `/live`）。

**验收标准**：Self-healing 自动恢复（检测故障 → 重启 / 切换 / 降级 ≤ 60s）；Saga 回滚生效（补偿动作幂等正确执行）；Outbox 至少一次投递（无丢失，消费者幂等）；Bulkhead 隔离生效（级联故障阻断）；降级链路全部可用（6 条降级路径全部验证）；终止条件治理生效（无限聊天 ≤ 10 轮自动终止）。

### 4.16 M16 多租户隔离

**背景**：腾讯问"云端版本如何设计，逻辑多租户怎么做"、"Session 隔离和 Memory 隔离怎么做"、"其他项目的记忆会不会污染当前项目"。v2.1 多租户未隔离，所有租户共享数据空间，存在跨租户数据泄露风险。v3.0 决策 5 推荐"延后到 v3.1"（先技术后商业），但必须预留 tenant_id 字段，确保 v3.1 启用时无需大规模重构。

**需求**：
- **M16.1 数据隔离**：每租户独立数据空间，禁止跨租户数据访问。隔离层级（决策 5 推荐 v3.0 用行级，v3.1 升级到 Schema 级）：①行级隔离（所有表增加 tenant_id 字段，查询自动注入 `WHERE tenant_id = ?`，通过 ORM interceptor 实现，v3.0 预留）；②Schema 级隔离（每租户独立 PostgreSQL Schema，v3.1 升级）；③数据库级隔离（每租户独立数据库，v3.2 大客户专用）。数据隔离覆盖：tasks / agents / memory / skills / personas / guardrails / cost_ledger / audit_trail 全表。
- **M16.2 资源隔离**：每租户独立配额（QPS / Token / 存储 / 并发任务），超额限流。配额配置：`config/tenant/quotas/{tenant_id}.yaml` 定义 qps_limit / daily_token_limit / storage_limit / max_concurrent_tasks / max_agents / max_skills。配额超限策略：QPS 超限 → 429 Too Many Requests + Retry-After；Token 超限 → 降级到便宜模型（M9.2 协同）或拒绝；存储超限 → 拒绝写入 + 告警；并发超限 → 排队等待。与 M15.4 Bulkhead 协同（按租户隔离资源池）。
- **M16.3 配置隔离**：每租户独立配置（Agent / Skill / Persona / Guardrails 策略）。配置目录结构：`config/tenant/{tenant_id}/agents/` / `skills/` / `personas/` / `guardrails/` / `models/`。租户配置优先级高于全局配置（全局 → 租户覆盖）。配置加载流程：加载全局配置 → 加载租户配置覆盖 → 生成最终配置。Feature Flag 支持租户级控制（某些功能只对特定租户开放）。
- **M16.4 计费**：按租户计费（用量 / 资源 / 功能），与 M9 成本归因协同。计费模型：按用量（Token / 任务数 / Agent 调用次数）、按资源（存储 / 计算 / 带宽）、按功能（基础版 / 专业版 / 企业版功能解锁）。计费账单：`billing_ledger` 表记录每租户每日费用明细。计费报表：月度账单 + 使用量趋势 + 成本优化建议。与 M9.4 成本归因深度协同（cost_ledger 表的 tenant_id 字段是计费基础）。
- **M16.5 Session / Memory 隔离**：Session 隔离（每租户独立 Session 空间，禁止跨租户 Session 访问）、Memory 隔离（每租户独立 Memory 存储，禁止跨租户 Memory 检索，腾讯问"其他项目记忆污染"的解决方案）。Memory 检索自动注入 tenant_id 过滤，Session 查询自动注入 tenant_id 过滤。

**设计要点**：决策 5 推荐"延后 v3.1"，v3.0 预留 tenant_id 字段（所有表 / 所有 API / 所有配置）。商业化 SaaS 时机决策 11 推荐 v3.1（配套多租户 + 计费）。v3.0 实施内容：①所有数据表增加 tenant_id 字段；②所有 API 支持 tenant_id 透传（Header / Token）；③配置目录结构预留 `config/tenant/{tenant_id}/`；④M9 Cost 归因按 tenant_id 分组。v3.1 实施内容：①行级 → Schema 级升级；②配额限流生效；③计费系统上线；④Session / Memory 隔离验证。

**集成点**：`middleware/tenant.py` 租户上下文中间件（从 Token / Header 提取 tenant_id 注入 Context）、`core/repository.py` ORM interceptor（自动注入 tenant_id 过滤）、`config/tenant/` 租户配置目录、`core/di.py` 租户级 DI 容器（每租户独立 Agent / Tool 实例）、`middleware/rate_limit.py` 租户级限流、Helm UI 租户管理界面。

**验收标准**：数据隔离无渗透（跨租户查询返回空）；资源配额限流生效（QPS / Token / 存储 / 并发超限拒绝）；配置隔离可用（租户配置覆盖全局）；计费准确（月度账单与实际用量一致）；Session / Memory 隔离生效（跨租户访问禁止）。

### 4.17 M17 Skill 市场

**背景**：阿里问"能力市场是什么，能力如何发现、安装、治理和复用"，高德问"'能力市场'是什么，能力如何发现、安装、治理和复用"，小米问"如何把个人 AI-native 经验推广成组织经验"。v2.1 Skill 无市场（无打包 / 签名 / 分发 / 评价 / 沙箱），Skill 只能手动复制配置文件，无法版本管理、无法验证来源、无法评价质量。v3.0 决策 6 推荐"v3.0 内部市场，v3.1 开放市场"（安全沙箱 + 评价体系需先成熟）。

**需求**：
- **M17.1 Skill 打包**：Skill 标准化打包格式（YAML + 依赖 + 元数据 + 签名），版本管理（语义化版本 major.minor.patch）。打包格式：`.fskill`（ZIP 压缩包），包含 `skill.yaml`（元数据：name / version / description / author / license / dependencies / permissions / input_schema / output_schema）、`prompt.yaml`（提示词外置，红线 11+P16+P34）、`code/`（可选代码实现）、`tests/`（测试用例）、`README.md`（文档）。打包工具：`flowforge skill pack ./my-skill/` 生成 `.fskill` 文件。
- **M17.2 Skill 签名**：Skill 数字签名（防篡改），证书链验证。签名流程：开发者生成 RSA 密钥对 → 私钥签名 `.fskill` 包 → 公钥证书上传到 Marketplace → 用户安装时验证签名。证书链：Root CA → Organization CA → Developer Certificate。签名算法：RSA-2048 + SHA-256。验签失败拒绝安装，记录审计日志。与 M12 AgentBOM 协同（Skill 签名信息记录到 AgentBOM dependencies）。
- **M17.3 Skill 分发**：Marketplace 平台（内部 v3.0，开放 v3.1），搜索 / 安装 / 更新 / 卸载。Marketplace 功能：搜索（按 name / tags / category / author 搜索）、安装（`flowforge skill install {skill_name}@{version}`）、更新（`flowforge skill update {skill_name}`）、卸载（`flowforge skill uninstall {skill_name}`）、列表（`flowforge skill list`）。Marketplace API：`GET /api/v1/marketplace/skills` / `POST /api/v1/marketplace/skills/{id}/install` / `DELETE /api/v1/marketplace/skills/{id}`。内部 Marketplace 存储于 `marketplace/` 目录 + PostgreSQL `marketplace_skills` 表。
- **M17.4 Skill 评价**：Skill 评分（使用次数 / 成功率 / 用户评价 / 质量分趋势），排行榜，劣质 Skill 自动下架。评分维度：使用次数（popularity）、成功率（success_rate = 成功执行 / 总调用）、用户评价（1-5 星 + 评论）、质量分趋势（M6 Eval 协同，Skill 版本升级后质量分是否提升）。排行榜：按 category 分组（content / coding / research / publish / test），每类 Top 10。自动下架规则：成功率 < 50% 连续 7 天 / 用户评价 < 2.0 / 安全违规 → 自动下架 + 通知作者。
- **M17.5 Skill 沙箱**：Skill 在沙箱中执行（M2 工具沙箱协同），限制权限。沙箱策略：Container Isolation（Docker per Skill，M2.5 协同）、Resource Limit（CPU / Memory / Network / Timeout）、Permission Limit（文件系统白名单 / 网络白名单 / 环境变量白名单）、Skill 间隔离（Skill A 不能访问 Skill B 的内部状态）。沙箱策略配置：`config/marketplace/sandbox_policy.yaml`。
- **M17.6 组织经验推广**：个人 Skill → 组织 Skill 推广机制（小米问"个人 AI-native 经验推广成组织经验"）。推广流程：个人创建 Skill → 内部 Marketplace 发布 → 组织评审（质量 / 安全 / 复用性）→ 通过后标记为"组织推荐" → 全组织可见可安装 → 使用数据反馈 → 持续优化。组织级 Skill 优先级高于个人 Skill（路由优先级排序）。

**设计要点**：决策 6 推荐"v3.0 内部，v3.1 开放"。与 M2 MCP Apps（Manifest 自动发现）协同、M6 Eval（Skill 评价）协同、M12 AgentBOM（Skill 依赖追踪）协同。与 v7.0 FR-EVO-05 灵典（Mind Codex）五级进化阶梯和 FR-EVO-06 三模式自生成的 Skill 入库与分发直接融合（详见 M18-M20 融合映射）。

**集成点**：`marketplace/registry.py` Skill 注册中心、`marketplace/packager.py` 打包工具、`marketplace/signer.py` 签名验签、`marketplace/distributor.py` 分发管理、`marketplace/rating.py` 评价系统、`marketplace/sandbox.py` Skill 沙箱（复用 M2.5）、`config/marketplace/sandbox_policy.yaml` 沙箱策略、CLI 工具 `flowforge skill` 命令、Helm UI Marketplace 界面、API 端点 `/api/v1/marketplace/`。

**验收标准**：Skill 打包格式标准（`.fskill` 包含 skill.yaml / prompt.yaml / code / tests / README）；签名验证生效（RSA-2048 + SHA-256，验签失败拒绝安装）；内部 Marketplace 可用（搜索 / 安装 / 更新 / 卸载 / 列表）；评价体系可用（使用次数 / 成功率 / 用户评价 / 质量分趋势 + 排行榜 + 自动下架）；沙箱隔离生效（Container / Resource / Permission / Skill 间隔离）；组织经验推广可用（个人 → 组织评审 → 推荐 → 全组织）。

---

## 模块 M18-M20：v7.0 灵智养成体系融合映射（★ 核心修正章节）

> **本章是本次修正的核心章节**。原 M18（ForgeMindEngine）/ M19（ForgeMindEngine）/ M20（ForgeMindEngine）三个模块已删除，因为与 `flowforge/docs/spec.md` v7.0 已设计的灵智养成体系（FR-EVO-01~15）完全重复且术语冲突。本节改为融合映射，说明 face 目录下 M1-M17 如何融入 v7.0 灵智养成体系，避免重复设计和术语冲突。

### 修正说明

在 v3.0 早期设计过程中，face 目录曾基于大厂面试中"自进化"信号设计 M18 ForgeMindEngine、M19 ForgeMindEngine、M20 ForgeMindEngine 三个模块。但随后 `flowforge/docs/spec.md` 升级到 v7.0，正式引入"灵智养成体系"（FR-EVO-01~15），覆盖了自我进化、记忆治理、协作决策的全部能力，并采用"灵智 / 灵忆 / 灵印 / 灵锻 / 灵典 / 灵议 / 觉醒阶"等更体系化的术语。

经审核，原 M18 / M19 / M20 的需求与 v7.0 FR-EVO 体系完全重复且术语冲突：

| 原 face 模块 | 重复的 v7.0 需求 | 冲突点 |
|-------------|----------------|--------|
| M18 SelfEvolutionEngine（三层 Harness + Skill 自动提取 + 经验逐级固化 + 事故驱动护栏 + 自指修改防漂移 + VDD） | FR-EVO-04 SpiritForge + FR-EVO-05 Mind Codex + FR-EVO-06 Skill 自生成 | "SelfEvolution" 与 "SpiritForge" 术语冲突；"Skill 自动提取" 与 "三模式自生成" 重复 |
| M19 MemoryGovernanceManager（4 级权威 + 晋级退役 + 冲突仲裁 + 五层记忆 + Shared State） | FR-EVO-02 Mind Echo + FR-EVO-03 Mind Imprint + FR-EVO-05 Mind Codex 五级进化阶 | "MemoryGovernance" 与 "Mind Echo / Mind Imprint" 术语冲突；"4 级权威" 与 "五级进化阶 Evolution Hierarchy" 重复 |
| M20 FirstTouchRouter（首接路由 + 动态拉入门 + 终止条件 + 球权契约） | FR-EVO-09 A2A 通信协议 + FR-EVO-10 灵议 Mind Council + FR-EVO-11 两类智能体无缝衔接 | "FirstTouchRouter" 与 "A2A @mention 路由 + TaskRouter" 重复；"球权契约" 与 "structured handoff" 重复 |

**修正决策**：删除原 M18 / M19 / M20 三个模块的详细需求，改为本融合映射章节。M1-M17 作为 v3.0 的工程实现，为 v7.0 第 7 层（自进化层）的 ForgekinEngine / SpiritForge / MindEcho / MindCouncil 提供支撑。原 M18 / M19 / M20 的工程任务保留在 `task_face.md` 中（已标注"v4.0 融合"），但其需求规格统一由 v7.0 FR-EVO-01~15 承接，face 目录不再重复定义。

### v7.0 术语对齐表

face 目录与 v7.0 灵智养成体系的术语对齐如下，所有 face 目录文档（spec_face / arch_face / task_face）在涉及自进化、记忆、协作概念时，必须使用 v7.0 术语，禁止使用原 M18 / M19 / M20 术语。

| v7.0 术语 | 含义 | 对标 clowder-ai | 原 face 术语（已废弃） |
|----------|------|----------------|----------------------|
| 灵智 Forgekin | 自进化智能体（具备独立身份、记忆、人格，可自主成长和进化） | Cat（猫猫） | SelfEvolutionAgent |
| 灵群 Kinship | 协作的灵智群（类似开发团队） | Clowder（猫群） | Multi-agent Team |
| 育灵 Forge Nurturing | 灵智从诞生到升华的全过程 | 养猫 | Agent Lifecycle |
| 灵忆 Mind Echo | 三层记忆（L1 Working / L2 Episode / L3 Semantic），对标 MemGPT | Memory（F102） | MemoryGovernance |
| 灵印 Mind Imprint | 认知画像（双层：结构化字段 + cat_note 主观日记），no-classifier 红线 | Profile Capsule（F231） | Agent Profile |
| 灵锻 SpiritForge | 无人驱动时的自主思考与进化（双层：Consolidation 后台 + Surface 前台），对标 Auto-Dream F255 | Auto-Dream | SelfEvolutionEngine |
| 灵典 Mind Codex | 五级进化阶知识库（E-L0 Episode / E-L1 Pattern / E-L2 Draft / E-L3 Validated / E-L4 Standard） | Skill Library + L0-L4 Knowledge | Skill Library |
| 灵议 Mind Council | IM 多渠道协作（Web Chat 灵议 / 飞书 / 微信 / Slack / Discord / GitHub PR） | IM 团队协作 | CollaborationGate |
| 觉醒阶 E1-E6 | 成长阶段（E1 Initiation 灵启 / E2 Awakening 觉醒 / E3 Mastery 精通 / E4 Evoling 进化 / E5 Excellence 卓越 / E6 ForgeMind 灵智） | 9 Lives | Agent Maturity Level |

### M1-M17 到 v7.0 FR-EVO 体系融合映射表

下表说明 face 目录 M1-M17 每个模块如何融入 v7.0 FR-EVO-01~15 需求，融合方式分三类：**直接融合**（face 模块是 v7.0 需求的工程实现）、**深度融合**（face 模块与 v7.0 需求双向协同）、**延伸融合**（face 模块为 v7.0 需求提供基础支撑）。

| face 模块 | 对应 v7.0 FR-EVO 需求 | 融合方式 | 优先级 | 融合说明 |
|---------|---------------------|---------|--------|---------|
| **M1 A2A 协议集成** | FR-EVO-09 A2A 通信协议 | 直接融合 | P0 | M1 是 FR-EVO-09 的工程实现：@mention 路由 + thread isolation + structured handoff，M1 的 Agent Card / Directory / 跨厂鉴权直接服务于灵智间协作 |
| **M2 MCP 2026 升级** | FR-EVO-07 外部编码工具集成（间接） | 延伸融合 | P0 | M2 的 Stateless Core / Sandbox 为 FR-EVO-07 CLI Wrapper（Claude Code / Codex / OpenCode）和 FR-EVO-08 Trae Bridge 提供工具沙箱基础 |
| **M3 Context Eng 2.0** | FR-EVO-02 Mind Echo（灵忆）+ ForgekinEngine 步骤 1-4 | 深度融合 | P0 | M3 的 JIT Context / Memory Tool / Context Editor 直接服务于 ForgekinEngine.execute() 的 soul.load() + echo.recall() + imprint.load() + build_soul_prompt() 步骤；M3 五层 Context Layer 对应 Mind Echo 三层记忆 |
| **M4 六层 Guardrails** | SR-01~08 安全红线 | 延伸融合 | P0 | M4 六层 Guardrails 是 v7.0 安全红线（SR-01 no-classifier / SR-03 Provoke 频率硬限 / SR-04 高风险域升级 / SR-06 worktree 隔离 / SR-08 跨 *Forge 可审计）的工程落地 |
| **M5 OTel GenAI** | v7.0 可观测性指标（附录 12.4） | 直接融合 | P0 | M5 的 gen_ai.* Span / Metrics 直接对应 v7.0 的 forgekin_active_total / auto_forge_runs_total / soul_echo_episodes_total / a2a_messages_total 等指标 |
| **M6 评估与基准** | FR-EVO-06 Skill 自生成（Eval Ledger）+ FR-EVO-14 炉启训练 | 深度融合 | P1 | M6 的 τ-bench / SWE-bench Pro / 回归套件直接服务于 FR-EVO-06 的 Eval Ledger（最小可信 case 数 5，覆盖 3 类）和 FR-EVO-14 Forge Initiation 入门训练 |
| **M7 Durable Execution** | ForgekinEngine 长程任务（间接） | 延伸融合 | P1 | M7 的 Durable Event Log / Checkpoint / Saga 为 ForgekinEngine 的长程自进化任务（如多日 SpiritForge）提供持久化基础 |
| **M8 自我纠错 2.0** | FR-EVO-04 SpiritForge（灵锻）+ FR-EVO-06 Skill 蒸馏 | 深度融合 | P1 | M8 的 PreFlect / VIGIL / SAGE 三层纠错与 FR-EVO-04 SpiritForge 的"读留痕 → 画线 → 写日记"深度融合；SAGE 事故驱动护栏与 FR-EVO-06 Mode B Process Evolution 协同 |
| **M9 Prompt Caching + 成本** | v7.0 性能 SLO（附录 12.1） | 延伸融合 | P1 | M9 的 Prompt Caching / Cost-Aware Routing / 配额池为 v7.0 的 SpiritForge < 5min / Mind Echo 写入 < 100ms / Skill 验证 < 10min 等 SLO 提供成本基础 |
| **M10 生产化部署** | FR-EVO-04 SpiritForge（自指修改防漂移） | 深度融合 | P1 | M10 的灰度发布 / Eval-gated 自动回滚 / 自指修改防漂移直接服务于 FR-EVO-04 的灵锻安全（自指修改 100% 经 Eval + 审批 + 灰度） |
| **M11 HITL 2.0（CHEQ）** | v7.0 operator 审批节点 | 直接融合 | P1 | M11 的 CHEQ 中断恢复 / HotL / HoverL 直接对应 v7.0 的 operator 审批节点（E6 创建灵智需 operator 授权 / Mind Imprint proposal 需 operator 审批 / Provoke 需 operator 反馈） |
| **M12 Agent 治理** | FR-EVO-01 灵智身份系统 + SR-05 E6 创建授权 | 延伸融合 | P2 | M12 的 AgentBOM / Blast-radius Gate 为 FR-EVO-01 的 forgekin_id / Mind Profile / 觉醒阶段追踪提供治理基础；SR-05 E6 创建灵智需 operator 授权依赖 M12 |
| **M13 Computer Use** | FR-EVO-07 外部编码工具（间接）+ T8 DOM 验证 | 延伸融合 | P2 | M13 的 Browser Agent 为 T8 测试铁律（Web 功能必须操控浏览器验证 DOM）提供基础；GUI Agent 为 FR-EVO-07 CLI Wrapper 的桌面场景扩展 |
| **M14 三层协议栈** | FR-EVO-09 A2A + FR-EVO-10 灵议 | 延伸融合 | P2 | M14 的 ACP / MCP / A2A 三层协议栈为 FR-EVO-09 A2A 通信协议和 FR-EVO-10 灵议多渠道协作提供协议基础 |
| **M15 故障恢复与降级** | v7.0 降级策略（arch 21.2） | 直接融合 | P1 | M15 的降级链路直接对应 v7.0 的降级策略（ForgekinEngine → HybridExecutor / SpiritForge → 跳过 / External Tool → 内置 Agent / Trae Bridge → 内置 Agent / Council → 单渠道 / A2A → 直接调用） |
| **M16 多租户隔离** | FR-EVO-11 两类智能体衔接（间接） | 延伸融合 | P2 | M16 的数据 / 资源 / 配置隔离为 FR-EVO-11 Forgekin 委托 Static Agent 的多租户场景提供隔离基础（v3.1 商业化时启用） |
| **M17 Skill 市场** | FR-EVO-05 灵典（Mind Codex）+ FR-EVO-06 Skill 自生成 | 直接融合 | P2 | M17 的 Skill 打包 / 签名 / 分发 / 评价 / 沙箱直接服务于 FR-EVO-05 Mind Codex 五级进化阶梯和 FR-EVO-06 三模式自生成的 Skill 入库与分发 |

### 融合结论

M1-M17 完美融入 v7.0 灵智养成体系，无需新增 M18 / M19 / M20 三个模块。具体结论：

1. **M1-M17 是 v7.0 七层架构第 1-6 层的工程实现**：v3.0 的互联层 / 应用层 / 接入层 / Harness 驾驭层 / 执行引擎层 / 能力层 / 基础设施层对应 v7.0 七层架构的第 1-6 层（v7.0 第 7 层"自进化层"由 ForgekinEngine / SpiritForge / MindEcho / MindCouncil 承接）。
2. **M1-M17 为第 7 层（自进化层）提供支撑**：协议（M1 A2A / M2 MCP / M14 三层协议栈）、上下文（M3 Context Eng）、安全（M4 Guardrails）、可观测（M5 OTel）、评估（M6 Eval）、长程（M7 Durable）、纠错（M8 自我纠错）、成本（M9 Cost）、部署（M10 生产化）、HITL（M11 CHEQ）、治理（M12 AgentBOM）、Computer Use（M13）、故障恢复（M15）、多租户（M16）、Skill 市场（M17）共 15 类基础能力，为 ForgekinEngine 的自进化闭环提供工程支撑。
3. **原 M18 / M19 / M20 的需求由 v7.0 FR-EVO-01~15 承接**：自我进化 → FR-EVO-04 SpiritForge；记忆治理 → FR-EVO-02 Mind Echo + FR-EVO-03 Mind Imprint + FR-EVO-05 Mind Codex；协作决策 → FR-EVO-09 A2A + FR-EVO-10 灵议 + FR-EVO-11 两类智能体衔接。face 目录不再重复定义，避免术语冲突。
4. **原 M18 / M19 / M20 的工程任务保留在 task_face.md**：task_face.md 中标注"v4.0 融合"的 M18 / M19 / M20 任务（如 M19-I-01 记忆权威分级、M18-I-02 Skill 自动提取）仍然需要执行，但其需求规格和验收标准统一引用 v7.0 FR-EVO-01~15，face 目录不重复定义。

### v7.0 Phase 路线对齐表

v7.0 路线图（spec.md 第十三章）的 Phase 6.1-6.7 与 face 目录 M1-M17 的支撑关系如下：

| v7.0 Phase | 内容 | 核心交付 | face 目录支撑模块 | 优先级 |
|-----------|------|---------|-----------------|--------|
| **Phase 6.1** | 灵智基础设施 | Forgekin 身份 + Mind Echo + Mind Imprint + 觉醒阶段 | M3 Context Eng（Mind Echo 三层记忆）+ M5 OTel（forgekin 指标）+ M12 AgentBOM（身份治理） | P0 |
| **Phase 6.2** | 灵锻引擎 | SpiritForge Engine + 日记本 + Provoke + 灵典 | M8 自我纠错（PreFlect / VIGIL / SAGE 与灵锻协同）+ M10 生产化（自指修改防漂移）+ M17 Skill 市场（灵典分发） | P0 |
| **Phase 6.3** | 外部工具集成 | CLI Wrapper（Claude / Codex / OpenCode）+ Trae Bridge | M2 MCP 2026（工具沙箱）+ M13 Computer Use（桌面扩展）+ M15 故障恢复（CLI 超时降级） | P0 |
| **Phase 6.4** | IM 与协作 | A2A 协议 + 灵议 Web Chat 升级 + 飞书渠道 | M1 A2A 协议（@mention / thread / handoff）+ M14 三层协议栈（ACP / MCP / A2A） | P0 |
| **Phase 6.5** | Skill 自生成 | 三模式自进化 + 五级进化阶梯 + Eval Ledger | M6 评估（τ-bench / Eval Ledger）+ M17 Skill 市场（打包 / 评价）+ M8 SAGE（事故驱动护栏） | P1 |
| **Phase 6.6** | *Forge 自进化 | 各 *Forge 灵智角色 + 业务方向进化 | M1-M17 全部（各 *Forge 通过 Plugin V3 协议组合 M1-M17 能力 + 注册灵智角色） | P1 |
| **Phase 6.7** | 元认知与治理 | 元认知能力 + 跨模型评审 + 灵智治理 | M12 Agent 治理（AgentBOM / Blast-radius）+ M6 评估（跨模型评审）+ M4 Guardrails（元认知红线） | P2 |

### 融合迁移策略

v3.0 M1-M17 与 v7.0 灵智养成体系的融合不是一次性迁移，而是按 Phase 渐进式融合。以下是每个 Phase 的融合迁移步骤：

**Phase 6.0 融合迁移（P0 基础）**：
1. **M5 OTel → v7.0 可观测性指标**：M5 的 gen_ai.* Span / Metrics 上报后，v7.0 的 forgekin_active_total / auto_forge_runs_total / soul_echo_episodes_total / a2a_messages_total 指标自动可用（同一指标体系）。
2. **M3 Context Eng → v7.0 Mind Echo**：M3 的五层 Context Layer 升级后，将 Working 层映射到 Mind Echo L1 Working Memory，Episodic 层映射到 L2 Episode Memory，Semantic 层映射到 L3 Semantic Memory。迁移步骤：①M3 实现五层 Context Layer；②v7.0 ForgekinEngine 步骤 1-4（soul.load + echo.recall + imprint.load + build_soul_prompt）调用 M3 Context Layer API；③数据双向同步（M3 Memory ↔ Mind Echo）。
3. **M4 Guardrails → v7.0 SR-01~08**：M4 六层 Guardrails 实现后，v7.0 安全红线 SR-01~08 自动落地（M4 是 SR 的工程实现）。无需额外迁移，M4 配置即 SR 配置。

**Phase 6.1 融合迁移（P1 复杂）**：
1. **M8 自我纠错 → v7.0 SpiritForge**：M8 的 PreFlect / VIGIL / SAGE 三层纠错与 v7.0 SpiritForge 的"读留痕 → 画线 → 写日记"深度融合。迁移步骤：①M8 实现 PreFlect / VIGIL / SAGE；②v7.0 SpiritForge 的 Consolidation 后台调用 M8 SAGE（事故驱动护栏生成）；③v7.0 SpiritForge 的 Surface 前台调用 M8 PreFlect（事前预检）。
2. **M10 生产化 → v7.0 自指修改防漂移**：M10 的 Eval-gated + 审批 + 灰度直接服务于 v7.0 SpiritForge 的自指修改安全。迁移步骤：①M10 实现灰度 + Eval-gated；②v7.0 SpiritForge 的灵锻代码修改经 M10 Eval-gated 门禁；③SAGE 产出的事故护栏经 M10 灰度发布。
3. **M11 HITL → v7.0 operator 审批**：M11 的 CHEQ / HotL / HoverL 直接对应 v7.0 operator 审批节点。迁移步骤：①M11 实现 CHEQ 中断恢复；②v7.0 E6 创建灵智 / Mind Imprint proposal / Provoke 经 M11 HITL 审批。
4. **M7 Durable → v7.0 长程自进化**：M7 的 Durable Event Log / Checkpoint 为 v7.0 ForgekinEngine 长程自进化任务提供持久化。迁移步骤：①M7 实现 Durable Execution；②v7.0 多日 SpiritForge 任务经 M7 Checkpoint 持久化。

**Phase 6.2 融合迁移（P2 增强）**：
1. **M17 Skill 市场 → v7.0 Mind Codex**：M17 的 Skill 打包 / 签名 / 分发 / 评价直接服务于 v7.0 Mind Codex 五级进化阶梯。迁移步骤：①M17 实现 Skill 市场；②v7.0 Mind Codex 的 E-L3 Validated / E-L4 Standard 火种通过 M17 Marketplace 分发；③FR-EVO-06 三模式自生成的 Skill 经 M17 打包入库。
2. **M12 Agent 治理 → v7.0 灵智身份**：M12 的 AgentBOM / Blast-radius 为 v7.0 FR-EVO-01 灵智身份系统提供治理基础。迁移步骤：①M12 实现 AgentBOM；②v7.0 forgekin_id 关联 AgentBOM；③SR-05 E6 创建灵智需 operator 授权经 M12 Blast-radius Gate。
3. **M1 A2A → v7.0 FR-EVO-09**：M1 的 A2A 协议直接服务于 v7.0 灵智间协作。迁移步骤：①M1 实现 A2A Server / Client；②v7.0 Mind Council 的 @mention 路由 / thread isolation / structured handoff 经 M1 A2A 协议传输。
4. **M15 故障恢复 → v7.0 降级策略**：M15 的降级链路直接对应 v7.0 降级策略。迁移步骤：①M15 实现 6 条降级路径；②v7.0 ForgekinEngine → HybridExecutor / SpiritForge → 跳过 / External Tool → 内置 Agent / Trae Bridge → 内置 Agent / Council → 单渠道 / A2A → 直接调用，全部经 M15 降级链路管理。

**融合迁移原则**：
- **渐进式**：每个 Phase 只迁移该 Phase 完成的模块，不提前迁移未完成模块。
- **双向兼容**：迁移期间 v3.0 和 v7.0 并存，v7.0 未完成的模块由 v3.0 降级支撑。
- **术语统一**：迁移期间所有文档（spec_face / arch_face / task_face）必须使用 v7.0 术语（灵智 / 灵忆 / 灵印 / 灵锻 / 灵典 / 灵议 / 觉醒阶），禁止使用原 M18 / M19 / M20 术语。
- **审计可追溯**：每个迁移步骤记录审计日志（迁移时间 / 迁移内容 / 迁移结果 / 回滚方案）。

---

## 第五章：跨模块需求

> **注意**：本章节为 v3.0 跨模块需求的唯一定义，不含重复标题。所有跨模块需求统一在本章定义，M1-M17 模块章节不再重复。

### 5.1 配置驱动统一

v3.0 所有策略 YAML 化，禁止硬编码路径 / 密钥 / 端口 / 提示词（红线 11、P16、P34）。配置文件统一管理在 `flowforge/config/` 目录下，按模块分子目录：

```
flowforge/config/
├── a2a/                    # M1
│   ├── agent_cards/
│   └── auth.yaml
├── mcp_v2026/              # M2
│   ├── manifests/
│   ├── sandbox_policy.yaml
│   └── elision.yaml
├── context_engine/         # M3
│   ├── layers.yaml
│   ├── memory_policy.yaml
│   └── editing.yaml
├── guardrails/             # M4
│   ├── input_validation.yaml
│   ├── tool_allowlist.yaml
│   ├── action_confirmation.yaml
│   └── cost_ceilings.yaml
├── observability/          # M5
│   ├── exporters.yaml
│   ├── alerts.yaml
│   └── eval_gate.yaml
└── ...                     # M6-M17
```

配置驱动率目标：Phase 6.0 完成后 ≥ 30%，Phase 6.1 完成后 ≥ 60%，Phase 6.2 完成后 ≥ 80%（沿用 project_rules.md 目标）。

### 5.2 测试铁律扩展（T10-T15）

v3.0 在 T1-T8 基础上新增 T10-T15 测试铁律（决策 8 推荐"P0 配 T10-T13，P2 配 T14-T15"）：

| 编号 | 铁律 | 说明 | 对应模块 | 阶段 |
|------|------|------|---------|------|
| **T10** | OTel Trace 完整性 | 每个Span 完整生成，gen_ai.* schema 标准 | M5 | P0 |
| **T11** | A2A 协议合规 | Agent Card / Task / SSE 标准合规 | M1 | P0 |
| **T12** | Durable Execution | 重启后从 Checkpoint 恢复，30h 连续运行 | M7 | P0 |
| **T13** | Guardrails 闭环 | 六层全部触发，Injection 检出 ≥ 95% | M4 | P0 |
| **T14** | Eval-gated 阻断 | τ-bench pass^k 未达标自动阻断发布 | M5/M6/M10 | P2 |
| **T15** | AgentBOM 完整性 | AgentBOM 字段完整，Blast-radius Gate 生效 | M12 | P2 |

**T1-T8 沿用不退化**：禁止 Mock LLM（T1）、禁止假数据（T2）、禁止跳过验证（T3）、禁止 Mock 工具（T4）、未实现即 Bug（T5）、必须采集指标（T6）、LLM 内容必须经 LLM 审核（T7）、Web 功能必须操控浏览器验证 DOM（T8）。

### 5.3 安全红线扩展

v3.0 在 project_rules.md 15 条编程红线基础上，扩展安全红线（SR-01~08 由 v7.0 定义，face 目录遵守）：

| 红线 | 说明 | 来源 |
|------|------|------|
| SR-01 | 禁止后台 classifier | v7.0（Mind Imprint no-classifier） |
| SR-02 | 禁止 Goodhart（telemetry-not-KPI） | v7.0（灵锻价值是少量高信号 consolidation） |
| SR-03 | Provoke 频率硬限（每天 ≤1，hyperfocus=0，连拍 3 次冬眠） | v7.0 |
| SR-04 | 高风险域升级（action_confidence < 0.85 时只做结构化分析 + 明确升级） | v7.0 |
| SR-05 | E6 创建灵智需 operator 授权 | v7.0 |
| SR-06 | 外部工具调用需 worktree 隔离 | v7.0 |
| SR-07 | Trae Bridge 超时降级 | v7.0 |
| SR-08 | 跨 *Forge 协作需 operator 可见 | v7.0 |

**v3.0 工程红线**（face 目录新增）：①所有 A2A 调用必须 OTel Trace；②所有 MCP 工具必须沙箱化；③所有高风险 Action 必须 Blast-radius Gate；④所有 HITL 中断必须 CHEQ 持久化；⑤所有自指修改必须 Eval-gated + 审批 + 灰度。

### 5.4 非功能性需求

| 维度 | 指标 | 目标值 | 对应模块 | 验证方法 |
|------|------|--------|---------|---------|
| **性能 - LLM 调用延迟** | P50 / P95 | P50 ≤ 15s / P95 ≤ 30s | M5 / M9 | OTel Histogram `gen_ai.client.operation_duration` |
| **性能 - A2A 任务延迟** | P50 / P95 | P50 ≤ 60s / P95 ≤ 300s | M1 | OTel Histogram `flowforge.a2a.task_duration` |
| **性能 - Durable 恢复时间** | 故障后恢复 | ≤ 5s（Checkpoint 恢复） | M7 | T12 Durable Execution 测试 |
| **性能 - HITL 中断恢复** | 重启后恢复 | ≤ 10s | M11 | CHEQ 中断恢复测试 |
| **性能 - Self-healing** | 故障检测 + 恢复 | ≤ 60s | M15 | Self-healing 自动恢复测试 |
| **性能 - Context 构建** | JIT Context 构建 | ≤ 500ms | M3 | OTel Span `context_engine.build_context` |
| **性能 - Prompt Cache 命中** | 命中率 | 45-80%（System/Persona > 80%）| M9 | OTel Metric `prompt_cache_hit_rate` |
| **可用性 - 系统可用率** | 月度可用率 | ≥ 99.5%（P0）/ ≥ 99.9%（P1） | M15 | 健康检查 + 告警 |
| **可用性 - 降级成功率** | 降级链路可用率 | 100%（6 条降级路径全部可用）| M15 | 降级链路测试 |
| **安全 - Injection 检出率** | Prompt Injection 检出 | ≥ 95%（50 例测试集） | M4 | T13 Guardrails 闭环测试 |
| **安全 - 沙箱逃逸** | 容器沙箱隔离 | 0 逃逸 | M2 / M17 | CVE-2025-47241 修复验证 |
| **安全 - 数据隔离** | 跨租户数据泄露 | 0 泄露 | M16 | 多租户隔离测试 |
| **可扩展性 - Agent 规模** | 注册 Agent 数 | ≥ 50（联邦查询可用） | M1 | T11 A2A 协议合规测试 |
| **可扩展性 - 并发任务** | 并发任务数 | ≥ 100（Bulkhead 隔离生效） | M15 | Bulkhead 隔离测试 |
| **可扩展性 - 长程任务** | 连续运行时长 | ≥ 30h（不中断） | M7 | T12 Durable Execution 测试 |
| **成本 - LLM 月度成本** | 月度 LLM 费用 | ≤ $1000（Cost-Aware Routing 生效）| M9 | 成本归因仪表盘 |
| **成本 - Cache 节省** | Cache 节省比例 | ≥ 40%（Prompt Caching 节省） | M9 | OTel Metric Cache 命中率 |
| **可观测性 - Trace 覆盖率** | OTel Span 覆盖 | 100%（所有 Agent / Tool / LLM 调用） | M5 | T10 OTel Trace 完整性测试 |
| **可观测性 - 指标采集** | Metrics 采集率 | 100%（gen_ai.* schema 标准） | M5 | Prometheus 指标验证 |

### 5.5 向后兼容与迁移策略

v3.0 严格遵守向后兼容原则（设计原则第 3 条），v2.1 接口不破坏，新能力通过 Feature Flag 渐进启用，降级路径完整。

**5.5.1 Feature Flag 策略**：
- 所有 v3.0 新功能通过 Feature Flag 控制（`config/feature_flags.yaml`），默认关闭，逐步开启。
- Feature Flag 层级：全局 Flag → 租户 Flag → Agent Flag，优先级递增。
- Feature Flag 热加载（不停机切换），支持灰度开启（按百分比）。
- 关键 Feature Flag：`a2a_enabled` / `mcp_v2026_enabled` / `context_jit_enabled` / `guardrails_closed_loop_enabled` / `otel_genai_enabled` / `durable_execution_enabled` / `hitl_cheq_enabled`。

**5.5.2 MCP 版本兼容**：
- v2024 和 v2026 RC 并存（M2.1 Stateless Core 通过适配层兼容旧版）。
- MCP Client 自动探测 Server 版本（`/.well-known/mcp-manifest.json` 存在 → v2026 RC，不存在 → v2024）。
- 版本适配层：`mcp/version_adapter.py` 负责协议转换（v2024 ↔ v2026 RC）。
- 旧版 MCP Server 不强制升级，但推荐升级以获得 Stateless / Sandbox / Elision 能力。

**5.5.3 数据库迁移**：
- v2.1 SQLite → v3.0 SQLite + PostgreSQL（PostgreSQL 专供 Durable Execution，M7）。
- 迁移策略：SQLite 保留（任务 / 审计），PostgreSQL 新增（Durable Event Log / Checkpoint / Outbox），两库并存。
- 迁移工具：`scripts/migrate_v3.py` 自动创建 PostgreSQL 表结构 + 迁移必要数据。
- 回滚策略：PostgreSQL 不可用时自动降级到 SQLite-only 模式（Durable 功能降级，核心功能不受影响）。

**5.5.4 配置迁移**：
- v2.1 配置 → v3.0 配置自动迁移（`scripts/migrate_config_v3.py`）。
- 迁移规则：v2.1 配置保留，v3.0 新增配置默认值填充，不破坏现有配置。
- 配置版本号：每个 YAML 文件增加 `version: "3.0"` 字段，启动时检查版本兼容性。

### 5.6 跨模块集成矩阵

以下矩阵说明 M1-M17 之间的集成关系（★ = 强依赖，◇ = 协同，空白 = 无直接关系）：

| | M1 | M2 | M3 | M4 | M5 | M6 | M7 | M8 | M9 | M10 | M11 | M12 | M13 | M14 | M15 | M16 | M17 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **M1** | - | ◇ | ◇ | ◇ | ★ | | | | | | | ◇ | | ★ | ★ | | |
| **M2** | ◇ | - | ◇ | ★ | ★ | | | | | | | ◇ | | ★ | ★ | | ◇ |
| **M3** | ◇ | ◇ | - | ◇ | ★ | | ◇ | ◇ | ◇ | | ◇ | | | | ◇ | | |
| **M4** | ◇ | ★ | ◇ | - | ★ | | | ★ | ◇ | | ★ | ★ | | | ★ | | |
| **M5** | ★ | ★ | ★ | ★ | - | ★ | ★ | ★ | ★ | ★ | ★ | ★ | ★ | ★ | ★ | ★ | ★ |
| **M6** | | | | | ★ | - | | ◇ | | ★ | | ◇ | | | | | ◇ |
| **M7** | | | ◇ | | ★ | | - | | | | ★ | | | | ★ | | |
| **M8** | | | ◇ | ★ | ★ | ◇ | | - | | ◇ | ◇ | | | | | | |
| **M9** | | ◇ | ◇ | ◇ | ★ | | | | - | | | | | | ◇ | ★ | |
| **M10** | | | | | ★ | ★ | | ◇ | | - | ★ | ◇ | | | | | |
| **M11** | | | ◇ | ★ | ★ | | ★ | ◇ | | ★ | - | ◇ | | | | | |
| **M12** | ◇ | ◇ | | ★ | ★ | ◇ | | | | ◇ | ◇ | - | | | | | ◇ |
| **M13** | | | | | ★ | | | | | | | | - | | ◇ | | |
| **M14** | ★ | ★ | | | ★ | | | | | | | | | - | | | |
| **M15** | ★ | ★ | ◇ | ★ | ★ | | ★ | | ◇ | | | | ◇ | | - | ◇ | |
| **M16** | | | | | ★ | | | | ★ | | | | | | ◇ | - | |
| **M17** | | ◇ | | | ★ | ◇ | | | | | | ◇ | | | | | - |

**关键集成路径**：
- **M5 OTel 是所有模块的基础**：17 个模块全部依赖 M5（★ 或 ◇），M5 必须最先实施。
- **M4 Guardrails 是安全核心**：M1 / M2 / M8 / M11 / M12 / M15 依赖 M4，Guardrails 闭环是安全基础。
- **M7 Durable 是长程基础**：M3 / M11 / M15 依赖 M7，Durable Execution 是长程任务和故障恢复的基础。
- **M15 故障恢复是可用性保障**：M1 / M2 / M3 / M4 / M7 / M9 / M13 / M16 与 M15 协同，降级链路保证可用性。

---

## 第六章：v3.0 路线图

v3.0 路线图分三个 Phase（决策 9 推荐"2+3+2 节奏"）：

### 6.1 Phase 6.0（P0 基础）：2 个月

**目标**：建立 v3.0 协议 / 上下文 / 安全 / 可观测全栈基础。

**交付**：M1 A2A + M2 MCP 2026 + M3 Context Eng 2.0 + M4 六层 Guardrails + M5 OTel GenAI。

**里程碑**：
- Week 1-2：M5 OTel 基础（Span / Metric / Exporter）+ M4 Guardrails L1-L4
- Week 3-4：M3 Context Eng JIT + Memory Tool
- Week 4-5：M2 MCP 2026 Stateless + Sandbox
- Week 5-6：M1 A2A Server + Client + Directory
- Week 7-8：集成联调 + T10-T13 测试

**详细交付物**：
- M5 OTel GenAI：`observability/genai_tracer.py`（gen_ai.* Span Tracer）、`observability/eval_gate.py`（Eval-gated Deploy Gate）、`config/observability/exporters.yaml`（多后端配置）、Helm UI `TraceView.tsx` 组件。
- M4 六层 Guardrails：`security/guardrails/orchestrator.py`（编排器）、L1-L6 六层组件、`config/guardrails/*.yaml` 策略配置。
- M3 Context Eng 2.0：`harness/context_engine.py`（JIT 模式）、Memory Tool 4 API（save / recall / forget / compress）、`config/context_engine/*.yaml` 配置。
- M2 MCP 2026：`mcp_v2026/manifest_registry.py`（Manifest 注册）、`mcp_v2026/elision.py`（Result Elision）、`mcp_v2026/ema.py`（EMA 网关）、Stateless Core 重构。
- M1 A2A 协议：`interconnect/a2a/` 全套模块（server / client / directory / authenticator / card_builder / models / routes）。

**Phase 6.0 验收标准**：
- T10 OTel Trace 完整性测试通过（100% Span 覆盖，gen_ai.* 字段完整）。
- T11 A2A 协议合规测试通过（Agent Card / Task / SSE 标准，50+ Agent 注册）。
- T12 Durable Execution 先桩实现（Checkpoint 接口可用，完整实现留 Phase 6.1）。
- T13 Guardrails 闭环测试通过（六层全部触发，Injection 检出 ≥ 95%）。
- JIT 模式 Token 下降 ≥ 20%（决策 4 渐进式目标）。
- MCP 2026 Stateless 重启后会话不中断。
- 配置驱动率 ≥ 30%。

### 6.2 Phase 6.1（P1 复杂）：3 个月

**目标**：建立 v3.0 评估 / 长程 / 纠错 / 成本 / 部署 / HITL / 故障恢复复杂能力。

**交付**：M6 评估 + M7 Durable + M8 自我纠错 + M9 Cost + M10 生产化 + M11 HITL + M15 故障恢复。

**里程碑**：
- Month 1：M6 评估框架 + M7 Durable Execution
- Month 2：M8 自我纠错 2.0 + M9 Prompt Caching
- Month 3：M10 生产化部署 + M11 HITL 2.0 + M15 故障恢复

**详细交付物**：
- M6 评估：`eval/runner.py` 评估执行器、`eval/benchmarks/tau-bench/` τ-bench 集成、`eval/regression/golden/` 50+ case 回归套件、`eval/report/` OTel Trace 化报告。
- M7 Durable Execution：`engine/durable/` 全套（event_log / checkpoint_manager / saga_coordinator / outbox_relay / recovery_manager）、PostgreSQL `durable_events` / `durable_checkpoints` / `durable_outbox` 表。
- M8 自我纠错 2.0：`engine/preflect.py`（事前预检）、`engine/vigil.py`（多假设监控）、`engine/sage.py`（事故驱动护栏）、`config/engine/reflection.yaml`。
- M9 Cost：`harness/prompt_cache.py`（Redis Cache）、`harness/cost_router.py`（Cost-Aware Routing）、`harness/quota_pool.py`（配额池）、`harness/cost_ledger.py`（成本归因）。
- M10 生产化部署：`deploy/canary_manager.py`（灰度）、`deploy/ab_test_manager.py`（A/B）、`deploy/eval_gate.py`（Eval 门禁）、`deploy/pipeline.py`（CI/CD 集成）。
- M11 HITL 2.0：`harness/hitl_cheq.py`（CHEQ 中断恢复）、HotL / HoverL 调度、`config/harness/hitl_channels.yaml` 多渠道通知。
- M15 故障恢复：`runtime/self_healing.py`（自愈）、`runtime/bulkhead.py`（隔离）、`runtime/degradation.py`（6 条降级链路）。

**Phase 6.1 验收标准**：
- τ-bench pass^5 ≥ 80%（金标准任务集）。
- T12 Durable Execution 完整测试通过（重启 ≤ 5s 恢复，30h 连续运行）。
- PreFlect 上下文预测准确率 ≥ 70%；SAGE 护栏草案自动生成。
- Cache 命中率 45-80%；Cost-Aware Routing 生效；配额池自动切换。
- 灰度发布 1%→100% 可控；Eval-gated 阻断不合格版本。
- HITL 中断持久化，重启后恢复（≤ 10s）；DevForge IPD 5 检查点落地。
- Self-healing ≤ 60s 恢复；6 条降级链路全部可用。
- 配置驱动率 ≥ 60%。

### 6.3 Phase 6.2（P2 增强）：2 个月

**目标**：建立 v3.0 治理 / Computer Use / 协议栈 / 多租户 / Skill 市场增强能力。

**交付**：M12 Agent 治理 + M13 Computer Use + M14 三层协议栈 + M16 多租户 + M17 Skill 市场。

**里程碑**：
- Month 1：M12 Agent 治理 + M13 Computer Use
- Month 2：M14 三层协议栈 + M16 多租户 + M17 Skill 市场

**详细交付物**：
- M12 Agent 治理：`governance/agent_bom.py`（AgentBOM）、`governance/blast_radius.py`（Blast-radius Gate）、`governance/policy_manager.py`（策略版本化）、`governance/audit_trail.py`（审计）、`config/agents/test_agent.yaml`（测试 Agent）。
- M13 Computer Use：`tools/computer_use/`（GUI Agent 三平台适配）、`tools/browser_use/`（Browser Agent Playwright 封装 + Visual Grounding + 多模态 Web 测试）。
- M14 三层协议栈：`interconnect/acp/orchestrator.py`（ACP 协调器）、`interconnect/acp/message_router.py`、`interconnect/acp/session_manager.py`、`interconnect/protocol_adapter.py`（协议适配器）。
- M16 多租户：v3.0 预留 tenant_id 字段（所有表 / API / 配置）、`middleware/tenant.py`（租户上下文中间件）、`config/tenant/` 目录结构。
- M17 Skill 市场：`marketplace/` 全套（registry / packager / signer / distributor / rating / sandbox）、CLI 工具 `flowforge skill` 命令、Helm UI Marketplace 界面。

**Phase 6.2 验收标准**：
- T14 Eval-gated 阻断测试通过（τ-bench 未达标自动阻断）。
- T15 AgentBOM 完整性测试通过（全字段完整，Blast-radius Gate 生效）。
- CSA AGMM 全维度 L4（8 维度全部达标）。
- GUI Agent 三平台覆盖；Browser Agent 6/6 测试用例通过（T8 协同）。
- 三层协议栈完整（ACP / MCP / A2A 协议适配器可用）。
- 多租户 tenant_id 预留完整（v3.1 启用时无需重构）。
- Skill 打包 / 签名 / 分发 / 评价 / 沙箱全部可用。
- 配置驱动率 ≥ 80%。

### 6.4 风险评估与缓解

| 风险 ID | 风险描述 | 影响 | 概率 | 严重度 | 缓解措施 | 对应模块 |
|---------|---------|------|------|--------|---------|---------|
| **R-01** | A2A 协议 Spec 2026 变更（Google 调整标准） | M1 返工 | 中 | 高 | 适配层设计 + Spec 变更跟踪 + Community 参与 | M1 |
| **R-02** | MCP 2026 RC 未正式发布（仍是 RC 版本） | M2 API 变更 | 高 | 中 | Feature Flag 兼容 v2024 + 适配层 + RC 版本跟踪 | M2 |
| **R-03** | Context JIT 模式导致 T7 审核通过率下降 | 质量退化 | 中 | 高 | 渐进式实施（决策 4）+ T7 质量底线监控 + 回退到预加载 | M3 |
| **R-04** | Guardrails 闭环导致延迟增加 | 性能退化 | 中 | 中 | 异步后馈（L4-L6 不阻塞主流程）+ 缓存 + 并行执行 | M4 |
| **R-05** | OTel GenAI v1.30 schema 变更 | M5 返工 | 低 | 中 | 版本锁定 + schema 兼容层 + 升级测试 | M5 |
| **R-06** | τ-bench / SWE-bench Pro 集成复杂度高 | M6 延期 | 高 | 中 | 先桩实现（P1）+ 逐步集成 + 社区支持 | M6 |
| **R-07** | PostgreSQL Durable 性能瓶颈 | M7 性能不达标 | 中 | 高 | 读写分离 + 索引优化 + 分区表 + Redis 缓存热点 | M7 |
| **R-08** | SAGE 事故驱动护栏误报 | M8 误拦截 | 中 | 中 | 人工确认（M11 CHEQ）+ 置信度阈值 + 白名单 | M8 |
| **R-09** | Cost-Aware Routing 路由错误（简单任务用了贵模型） | 成本超支 | 低 | 中 | 路由策略审计 + 成本告警 + 人工干预 | M9 |
| **R-10** | Eval-gated 误阻断（τ-bench 暂时性下降） | M10 阻塞发布 | 中 | 中 | 手动覆盖机制 + 历史趋势分析 + 宽限期 | M10 |
| **R-11** | CHEQ 标准未正式发布 | M11 规范变更 | 中 | 低 | 草案对齐 + 版本跟踪 + 适配层 | M11 |
| **R-12** | AgentBOM 字段过多导致维护负担 | M12 可用性差 | 低 | 低 | 自动生成 + 模板化 + CI 自动校验 | M12 |
| **R-13** | Playwright 跨平台兼容性问题 | M13 不稳定 | 中 | 中 | 三引擎 fallback + 平台特定适配 + 持续集成测试 | M13 |
| **R-14** | 三层协议栈复杂度过高 | M14 延期 | 高 | 中 | P2 优先级延后 + 先 M1+M2 + ACP 后补 | M14 |
| **R-15** | 降级链路测试覆盖不足 | M15 降级失败 | 中 | 高 | 6 条降级路径全部测试 + 混沌工程 + 故障注入 | M15 |
| **R-16** | 多租户隔离不彻底（数据泄露） | M16 安全事故 | 低 | 高 | v3.0 预留 tenant_id + v3.1 充分测试 + 安全审计 | M16 |
| **R-17** | Skill 市场恶意 Skill 上传 | M17 安全风险 | 中 | 高 | 签名验证 + 沙箱隔离 + 人工审核 + 评价体系自动下架 | M17 |
| **R-18** | v3.0 与 v7.0 融合路径偏差 | 整体返工 | 低 | 高 | M18-M20 融合映射 + 术语对齐 + Phase 对齐表 + 定期审核 | M18-M20 |

**风险缓解原则**：①高严重度风险（R-01/03/07/15/16/17/18）必须有明确的降级方案和回退路径；②中概率以上风险必须有早期验证（Spike / PoC）；③所有风险每月复审，新增风险及时纳入。

### 6.5 资源需求估算

| Phase | 时间 | 人力（人月）| 基础设施 | 外部依赖 | 估算成本 |
|-------|------|-----------|---------|---------|---------|
| **Phase 6.0** | 2 个月 | 10 PM（5 人 × 2 月）| PostgreSQL + Redis + OTel Collector | MCP 2026 RC + A2A Spec 2026 | ~$2000（LLM API + 基础设施）|
| **Phase 6.1** | 3 个月 | 15 PM（5 人 × 3 月）| + Qdrant + Eval Backend | τ-bench + SWE-bench Pro | ~$3500（LLM API + 基础设施 + Eval）|
| **Phase 6.2** | 2 个月 | 10 PM（5 人 × 2 月）| + Docker Sandbox | Playwright + Signing CA | ~$2500（LLM API + 基础设施 + CA）|
| **总计** | 7 个月 | 35 PM | - | - | ~$8000 |

**人力配置建议**：
- **Tech Lead × 1**：架构设计 + 代码审查 + 风险管理（全程）
- **后端工程师 × 2**：M1-M8 / M10-M12 / M14-M15 核心开发（全程）
- **前端工程师 × 1**：Helm UI 升级 + Trace View + Marketplace UI + 租户管理（Phase 6.0 后半 + 6.1 + 6.2）
- **QA / SRE × 1**：T10-T15 测试 + CI/CD + 监控 + Eval（全程）

**基础设施需求**：
- PostgreSQL 15+（Durable Execution，4C8G 起步）
- Redis 7+（Cache + Session，2C4G 起步）
- Qdrant 1.7+（向量检索，2C4G 起步）
- OTel Collector + Jaeger（可观测性，2C4G 起步）
- Docker / Docker Compose（Sandbox 隔离，按需）
- LLM API（多 Provider 配额池，月度 $1000-2000）

---

## 第七章：优先级与依赖

### 7.1 优先级分组

| 优先级 | 模块 | Phase | 说明 |
|--------|------|-------|------|
| **P0** | M1 A2A / M2 MCP / M3 Context / M4 Guardrails / M5 OTel | Phase 6.0 | 协议 / 上下文 / 安全 / 可观测全栈基础 |
| **P1** | M6 Eval / M7 Durable / M8 纠错 / M9 Cost / M10 部署 / M11 HITL / M15 恢复 | Phase 6.1 | 评估 / 长程 / 纠错 / 成本 / 部署 / HITL / 恢复复杂能力 |
| **P2** | M12 治理 / M13 Computer / M14 协议栈 / M16 多租户 / M17 Skill | Phase 6.2 | 治理 / Computer Use / 协议栈 / 多租户 / Skill 市场增强能力 |

### 7.2 模块依赖关系

```
M5 OTel GenAI ◄── 所有模块依赖（Trace 基础，最先实施）
     ▲
     │
M4 Guardrails ◄── M1 A2A（Action Confirm）/ M2 MCP（Sandbox）/ M3 Context（Output Validation）
     ▲
     │
M3 Context Eng ◄── M1 A2A（Context 构建）/ M2 MCP（Result Elision）
     ▲
     │
M2 MCP 2026 ◄── M1 A2A（工具调用）
     ▲
     │
M1 A2A（顶层互联）
```

**关键依赖**：
- M5 OTel 是所有模块的基础（先实施）
- M4 Guardrails 依赖 M5（Trace 拦截记录）
- M3 Context Eng 依赖 M5（Trace 上下文操作）
- M2 MCP 依赖 M4（沙箱）+ M5（Trace）
- M1 A2A 依赖 M2（工具）+ M3（上下文）+ M4（鉴权）+ M5（Trace）
- M6-M11 + M15 依赖 M1-M5（P1 依赖 P0）
- M12-M17 依赖 M1-M11 + M15（P2 依赖 P0 + P1）

### 7.3 建议实施顺序

```
Week 1-2: M5 OTel GenAI 基础（Span/Metric/Exporter）
Week 2-3: M4 Guardrails L1-L4（与 M5 并行）
Week 3-4: M3 Context Eng JIT + Memory Tool
Week 4-5: M2 MCP 2026 Stateless + Sandbox
Week 5-6: M1 A2A Server + Client + Directory
Week 7-8: 集成联调 + T10-T13 测试
Month 3-5: M6-M11 + M15（P1）
Month 6-7: M12-M17（P2）
```

### 7.4 优先级排序理由

**P0 优先（Phase 6.0）**：M1-M5 是 v3.0 全栈基础，缺一不可。M5 OTel 是所有模块的可观测基础（17 个模块全部依赖 M5）；M4 Guardrails 是安全闭环（前馈 + 后馈）；M3 Context Eng 是上下文工程核心（JIT + Memory Tool）；M2 MCP 2026 是工具协议升级（Stateless + Sandbox）；M1 A2A 是跨厂互联核心差异化（字节面试最高频信号）。P0 不完成，P1/P2 无法启动。

**P1 优先（Phase 6.1）**：M6-M11 + M15 是工业级生产化能力。M6 Eval 回答"模型升级如何比较"（阿里 / 小米高频）；M7 Durable 解决"长程任务崩溃丢失"（深信服 / 小米高频）；M8 纠错实现"软+硬+Eval 三层 Harness"（小米明确追问）；M9 Cost 控制"Sandbox economics"（阿里追问）；M10 部署实现"CI/CD 自动修复"（小米追问）；M11 HITL 解决"长程任务压缩丢失恢复"（深信服追问）；M15 故障恢复解决"failure mode"（字节一面追问）。

**P2 优先（Phase 6.2）**：M12-M17 是增强能力，非阻塞。M12 治理达到 CSA AGMM L4（腾讯 / 小米问）；M13 Computer Use 覆盖 T8 DOM 验证（深信服问多模态 Web 测试）；M14 协议栈补齐 ACP 层（字节问协议边界）；M16 多租户预留 tenant_id（腾讯问云端多租户，决策 5 延后 v3.1）；M17 Skill 市场实现能力市场（阿里 / 高德 / 小米问，决策 6 v3.0 内部）。

### 7.5 关键路径与并行度

**关键路径**（决定总周期的最长依赖链）：
M5 OTel → M4 Guardrails → M3 Context Eng → M2 MCP 2026 → M1 A2A → 集成联调 → T10-T13 测试（Phase 6.0，8 周）→ M7 Durable → M11 HITL → M15 故障恢复（Phase 6.1，12 周）→ M12 治理 → M17 Skill 市场（Phase 6.2，8 周）。关键路径总长 28 周（7 个月）。

**并行度优化**：
- Phase 6.0 内：M5 与 M4 L1-L4 可并行（Week 1-2）；M3 与 M2 可部分并行（Week 3-5）；M1 在 M2/M3 完成后启动（Week 5-6）。
- Phase 6.1 内：M6 与 M7 可并行（Month 1）；M8 与 M9 可并行（Month 2）；M10 / M11 / M15 可并行（Month 3）。
- Phase 6.2 内：M12 与 M13 可并行（Month 1）；M14 / M16 / M17 可并行（Month 2）。
- 最大并行度 5 人（Tech Lead + 后端 × 2 + 前端 + QA/SRE）。

---

## 第八章：待用户审核决策点（12 项）

> 以下 12 项决策点已由 task_face.md 第一章给出对比分析与推荐，请用户审核标注"同意 / 调整"。

| # | 决策项 | 推荐方案 | 理由摘要 |
|---|--------|---------|---------|
| 1 | P0 / P1 / P2 优先级排序 | **A（当前排序）** | A2A 是 v3.0 核心差异化（跨厂互联），延后会丧失先发优势；协议变化风险可通过适配层缓解 |
| 2 | A2A 集成深度 | **A（完整 Server + Client）** | FlowForge 定位为"Agent 互联网节点"，单向能力无法支撑联邦生态；Server 复用 FastAPI 增量小 |
| 3 | MCP 2026 升级时机 | **A（立即启动，兼容旧版）** | Feature Flag 兼容旧版，Spec 微调时适配层调整即可；等 RC 会阻塞整个 P0 路线 |
| 4 | Context Engineering 范围 | **B（渐进式：System / Persona 预加载 + Task / Working JIT）** | 全 JIT 改动过大风险高；渐进式先保 System / Persona 稳定（Cache 命中高），Task / Working 按 JIT 加载，兼顾性能与稳定 |
| 5 | 多租户策略 | **B（延后 v3.1）** | v3.0 聚焦技术能力，多租户是商业化能力，技术能力稳定后再做多租户更稳妥；但 M9 Cost 归因预留 tenant_id 字段 |
| 6 | Skill 市场开放时机 | **B（v3.0 内部，v3.1 开放）** | 安全沙箱（M2）+ 评价体系（M6）需先成熟，否则开放市场风险高；v3.0 先内部跑通，v3.1 正式开放 |
| 7 | Computer Use 范围 | **B（仅桌面 + 浏览器）** | 移动端碎片化严重（Android / iOS 差异大），ROI 低；桌面 + 浏览器已覆盖 DevForge / ContentForge 主要场景 |
| 8 | T10-T15 测试铁律分阶段 | **B（P0 配 T10-T13，P2 配 T14-T15）** | T10(OTel) / T11(A2A) / T12(Durable) / T13(Guardrails) 对应 P0，必须配套；T14(Eval-gated) / T15(AgentBOM) 对应 P2，延后合理 |
| 9 | 路线图时间调整 | **A（6.0=2 月，6.1=3 月，6.2=2 月）** | 2+3+2 节奏合理，P0 基础需充分（2 月），P1 复杂需更多时间（3 月），P2 相对独立（2 月）；压缩会牺牲质量 |
| 10 | CSA AGMM 目标 | **B（稳定 Level 4）** | Level 4 已达工业可用（Identity / Observability / Safety / Compliance / Lifecycle / Collaboration 全 L4）；Level 5 需行业认证投入大，ROI 不高 |
| 11 | 商业化 SaaS 时机 | **B（v3.1 SaaS）** | v3.0 先打磨技术能力，多租户延后（决策 5），v3.1 配套多租户 + 计费再 SaaS 化更稳妥 |
| 12 | 大厂动态遗漏补充 | **暂不纳入联邦学习 / 隐私计算；端侧 / 多模态 / 记忆标准化留 v3.1 考察** | 当前 17 大方向已覆盖核心，联邦学习 / 隐私计算与 Agent Harness 关联弱；端侧 / 多模态 / 记忆标准化依赖 Computer Use 和 Memory Tool，留 v3.1 考察 |

### 8.1 关键决策详细分析

以下对 5 个最关键决策（决策 1 / 2 / 4 / 5 / 9）给出详细分析，包括备选方案、优劣势对比、风险评估。

**决策 1：P0 / P1 / P2 优先级排序**

| 方案 | 内容 | 优势 | 劣势 | 风险 |
|------|------|------|------|------|
| **A（推荐）** | P0=A2A+MCP+Context+Guardrails+OTel | A2A 是核心差异化，先发优势；协议 / 上下文 / 安全 / 可观测全栈基础 | A2A Spec 2026 可能变更（R-01）；MCP RC 未正式发布（R-02） | 中（适配层缓解） |
| B | P0=Context+Guardrails+OTel+Eval+Durable | 先补齐核心能力（上下文 / 安全 / 可观测 / 评估 / 长程），A2A 延后 | A2A 延后丧失先发优势；跨厂互联是面试最高频信号 | 低 |
| C | P0=MCP+Context+Guardrails+OTel（无 A2A） | 最保守，只升级现有能力 | 完全没有差异化，与 v2.1 差距不大 | 低 |

**推荐 A 的理由**：①字节二面明确追问"A2A 为什么自建"，这是 v3.0 核心差异化能力；②A2A Spec 变更风险可通过适配层缓解（R-01 缓解措施）；③跨厂互联是 Agent 互联网的基础，延后会丧失生态先发优势。

**决策 2：A2A 集成深度**

| 方案 | 内容 | 优势 | 劣势 | 风险 |
|------|------|------|------|------|
| **A（推荐）** | 完整 Server + Client | 双向能力支撑联邦生态；Server 复用 FastAPI 增量小 | 开发量略大（Server + Client + Directory） | 低 |
| B | 仅 Client | 开发量小；能调用外部 Agent | 无法被外部调用，不是真正的"互联网节点" | 中（丧失 Server 能力） |
| C | 仅 Server | 能被外部调用 | 无法调用外部 Agent，联邦查询受限 | 中（丧失 Client 能力） |

**推荐 A 的理由**：①FlowForge 定位为"Agent 互联网节点"，需要双向能力；②Server 复用现有 FastAPI 路由（不另起服务），增量开发量可控；③Client 通过 ToolRegistry 注册为工具，与现有工具体系无缝集成。

**决策 4：Context Engineering 范围**

| 方案 | 内容 | 优势 | 劣势 | 风险 |
|------|------|------|------|------|
| A | 全 JIT（所有层按需加载） | Token 下降最大（≥ 40%） | 改动过大，System / Persona 不加载可能导致 Agent 行为异常 | 高（质量退化 R-03） |
| **B（推荐）** | 渐进式（System / Persona 预加载 + Task / Working JIT） | 兼顾性能与稳定；System / Persona Cache 命中高 | Token 下降幅度中等（20-30%） | 低 |
| C | 不变（全预加载） | 零改动，零风险 | Token 浪费严重，无法解决"上下文硬塞"问题 | 低（但未解决问题） |

**推荐 B 的理由**：①全 JIT 风险太高（R-03 质量退化），System / Persona 是 Agent 行为基础必须预加载；②渐进式先保 System / Persona 稳定（Cache 命中 > 80%），Task / Working 按 JIT 加载，兼顾性能与稳定；③后续可逐步扩大 JIT 范围（v3.1 可考虑全 JIT）。

**决策 5：多租户策略**

| 方案 | 内容 | 优势 | 劣势 | 风险 |
|------|------|------|------|------|
| A | v3.0 实现完整多租户 | 商业化基础完备 | 分散 P0/P1 技术能力开发精力；多租户测试复杂 | 中 |
| **B（推荐）** | v3.0 预留 tenant_id，v3.1 完整实现 | v3.0 聚焦技术能力；预留字段确保 v3.1 无需重构 | v3.0 无多租户能力 | 低（预留字段） |
| C | v3.0 不做，v3.2 再考虑 | 最小化 v3.0 范围 | v3.1/v3.2 商业化延后 | 低 |

**推荐 B 的理由**：①v3.0 聚焦技术能力（协议 / 上下文 / 安全 / 可观测 / 评估 / 长程），多租户是商业化能力；②技术能力稳定后再做多租户更稳妥（避免技术债 + 多租户复杂度叠加）；③v3.0 预留 tenant_id 字段（所有表 / API / 配置），v3.1 启用时无需大规模重构。

**决策 9：路线图时间调整**

| 方案 | 内容 | 优势 | 劣势 | 风险 |
|------|------|------|------|------|
| **A（推荐）** | 6.0=2月 + 6.1=3月 + 6.2=2月（2+3+2） | P0 基础充分（2月），P1 复杂需更多时间（3月），P2 相对独立（2月） | 总周期 7 月较长 | 低 |
| B | 6.0=1.5月 + 6.1=2.5月 + 6.2=1.5月（1.5+2.5+1.5） | 总周期 5.5 月较短 | 压缩 P0 可能导致基础不牢；P1 复杂能力压缩风险高 | 高（质量退化） |
| C | 6.0=2月 + 6.1=4月 + 6.2=2月（2+4+2） | P1 充分时间 | 总周期 8 月过长 | 低 |

**推荐 A 的理由**：①P0 是全栈基础（协议 / 上下文 / 安全 / 可观测），2 月充分但不冗余；②P1 是最复杂的 Phase（评估 / 长程 / 纠错 / 成本 / 部署 / HITL / 恢复 7 大模块），3 月合理；③P2 相对独立（治理 / Computer Use / 协议栈 / 多租户 / Skill 市场），2 月可控；④压缩会牺牲质量（R-03 / R-06 / R-07），延长则 ROI 下降。

### 8.2 决策审核清单

用户审核决策点时，建议按以下清单逐项确认：

- [ ] 决策 1：P0/P1/P2 优先级排序是否同意 A（A2A 优先）？
- [ ] 决策 2：A2A 集成深度是否同意 A（完整 Server + Client）？
- [ ] 决策 3：MCP 2026 升级时机是否同意 A（立即启动，兼容旧版）？
- [ ] 决策 4：Context Engineering 范围是否同意 B（渐进式）？
- [ ] 决策 5：多租户策略是否同意 B（延后 v3.1，预留 tenant_id）？
- [ ] 决策 6：Skill 市场开放时机是否同意 B（v3.0 内部，v3.1 开放）？
- [ ] 决策 7：Computer Use 范围是否同意 B（仅桌面 + 浏览器）？
- [ ] 决策 8：T10-T15 测试铁律分阶段是否同意 B（P0 配 T10-T13，P2 配 T14-T15）？
- [ ] 决策 9：路线图时间调整是否同意 A（2+3+2 节奏）？
- [ ] 决策 10：CSA AGMM 目标是否同意 B（稳定 Level 4）？
- [ ] 决策 11：商业化 SaaS 时机是否同意 B（v3.1 SaaS）？
- [ ] 决策 12：大厂动态遗漏补充是否同意（暂不纳入联邦学习 / 隐私计算）？

**审核完成后**：将标注"同意 / 调整"的决策表反馈，据以更新 spec_face.md / arch_face.md / task_face.md，然后启动 Phase 6.0 实施。

---

## 第九章：附录

### 9.1 术语表

| 术语 | 全称 | 说明 |
|------|------|------|
| A2A | Agent-to-Agent | 跨厂 Agent 互联协议（Google A2A Spec 2026） |
| ACP | Agent Communication Protocol | Agent 间通信协议 |
| AgentBOM | Agent Bill of Materials | Agent 物料清单（依赖 / 版本 / 能力 / 权限 / 来源 / 许可证） |
| AGMM | Agent Governance Maturity Model | CSA Agent 治理成熟度模型（L1-L5） |
| Blast-radius | 爆炸半径 | 高风险 Action 影响范围 |
| CHEQ | IETF CHEQ | IETF HITL 中断恢复标准 |
| Context Eng | Context Engineering | 上下文工程 |
| CSA | Cloud Security Alliance | 云安全联盟 |
| Durable Exec | Durable Execution | 持久化执行 |
| EMA | Enterprise MCP Aggregator | 企业 MCP 网关聚合 |
| Eval-gated | Evaluation-gated | 评估驱动发布门禁 |
| Forgekin | 灵智 | v7.0 自进化智能体（对标 clowder-ai Cat） |
| Mind Council | 灵议 | v7.0 IM 多渠道协作（对标 clowder-ai IM 团队协作） |
| Mind Codex | 灵典 | v7.0 五级进化阶知识库（对标 Skill Library + L0-L4） |
| SpiritForge | 灵锻 | v7.0 无人驱动时自主思考与进化（对标 Auto-Dream） |
| Mind Echo | 灵忆 | v7.0 三层记忆（对标 Memory） |
| Mind Imprint | 灵印 | v7.0 认知画像（对标 Profile Capsule） |
| HITL | Human-in-the-Loop | 人在环中 |
| HotL | Human-on-the-Loop | 人在环上（异步通知） |
| HoverL | Human-over-the-Loop | 人在环上方（同步干预） |
| JIT | Just-in-Time | 即时（上下文按需加载） |
| MCP | Model Context Protocol | 模型上下文协议（2026 Spec RC） |
| OTel | OpenTelemetry | 开放遥测（GenAI v1.30） |
| PreFlect | 事前预防 | M8 自我纠错事前预检 |
| Provoke | 沙砾气泡 | v7.0 灵锻产出的主动建议（每天 ≤1） |
| SAGE | 事故驱动 | M8 自我纠错事故驱动护栏 |
| Skill | 技能 | 可复用能力单元 |
| SOP | Standard Operating Procedure | 标准作业程序 |
| τ-bench | tau-bench | Agent 基准测试（pass^k 指标） |
| VDD | Vision-Driven Development | 愿景驱动开发 |
| VIGIL | 多假设归因 | M8 自我纠错执行中监控 |

### 9.2 参考文档

| 文档 | 路径 | 说明 |
|------|------|------|
| **v7.0 灵智养成体系权威源** | `flowforge/docs/spec.md` 第七章~第十三章 | FR-EVO-01~15 需求规格（line 2900-3640） |
| **v7.0 七层架构权威源** | `flowforge/docs/arch.md` 第 15-23 章 | ForgekinEngine / SpiritForge / MindEcho / MindCouncil 架构（line 5290-6500） |
| **v3.0 架构详设** | `flowforge/docs/face/arch_face.md` | M1-M5 + M18/M19/M20 架构详设 |
| **v3.0 任务清单** | `flowforge/docs/face/task_face.md` | 12+3 项决策对比 + P0 详细任务 + 依赖分析 |
| **大厂面试原始信息** | `flowforge/docs/face/face.md` | 字节 / 阿里 / 腾讯 / 百度 / 华为 / 网易 / 商汤 / 小米 / 深信服面试记录 |
| **v4.0 下一代需求** | `flowforge/docs/face/ds.md` | 自我进化与育灵体系权威源（EVO / MEM / COL 九大能力维度） |
| **开发规范** | `hiclaw/rules.md` | 架构总览 / 实例定位 / 文件差异 / 代码风格 / 开发规范 / AI 行为准则 |
| **提示词模板库** | `hiclaw/prompts.md` | 13 大类 100+ 模板（公共 P1-P40 / FlowForge FF1-FF21 / *Forge / HicLaw） |
| **项目规则** | `.trae/rules/project_rules.md` | FlowForge 生态项目规则（测试铁律 T1-T8 + 编程红线 15 条） |
| **FlowForge 原始规格** | `flowforge/docs/spec.md` | v7.0 完整规格（含 v2.1 历史版本） |
| **FlowForge 原始架构** | `flowforge/docs/arch.md` | v7.0 完整架构（含 v2.1 历史版本） |

### 9.3 测试铁律 T10-T15 详细说明

> T1-T8 沿用 project_rules.md 不退化，以下为 v3.0 新增 T10-T15 详细说明。

**T10 OTel Trace 完整性测试**：
- **目标**：验证所有 Agent / Tool / LLM 调用生成完整 OTel Span，gen_ai.* schema 标准。
- **测试方法**：执行一个完整的 Agent 任务（含 LLM 调用 + 工具调用 + Memory 操作），收集 OTel Trace，验证 Span 树完整性（root → gateway → agent → context_engine → llm → tool → mcp → guardrails → audit），Span 属性 gen_ai.* 字段完整。
- **通过标准**：100% Span 覆盖（无遗漏），gen_ai.* 字段完整，Trace ID 端到端串联。
- **对应模块**：M5 OTel GenAI。
- **实施阶段**：P0（Phase 6.0 Week 7-8）。

**T11 A2A 协议合规测试**：
- **目标**：验证 FlowForge A2A Server / Client 符合 Google A2A Spec 2026。
- **测试方法**：①外部 Client 下发任务到 FlowForge A2A Server，验证 Task lifecycle（pending → running → completed）；②FlowForge A2A Client 调用外部 A2A Agent，验证响应正确；③`curl /.well-known/agent.json` 验证 Agent Card 标准；④SSE 流式响应验证；⑤联邦查询验证（跨实例 Agent Directory）。
- **通过标准**：Agent Card / Task / SSE / 联邦查询全部合规；50+ Agent 注册可用；Bearer + OAuth2 鉴权通过。
- **对应模块**：M1 A2A 协议集成。
- **实施阶段**：P0（Phase 6.0 Week 7-8）。

**T12 Durable Execution 测试**：
- **目标**：验证 Durable Execution 持久化和故障恢复能力。
- **测试方法**：①启动长程任务（模拟 30+ 步骤），中途 kill 进程，重启后验证从 Checkpoint 恢复；②模拟 Saga 步骤失败，验证补偿动作正确执行；③模拟 Outbox 投递失败，验证至少一次投递；④30 小时连续运行测试（模拟长程任务，验证不中断）。
- **通过标准**：重启后 ≤ 5s 恢复（Checkpoint 恢复）；Saga 回滚生效（补偿动作幂等）；Outbox 无丢失；30h 连续运行不中断。
- **对应模块**：M7 Durable Execution。
- **实施阶段**：P0（Phase 6.0 Week 7-8，先桩实现；Phase 6.1 完整实现）。

**T13 Guardrails 闭环测试**：
- **目标**：验证六层 Guardrails 闭环（前馈 L1-L3 + 后馈 L4-L6）。
- **测试方法**：①构造 50 例 Prompt Injection 测试集，验证 L1 检出率 ≥ 95%；②验证 L2 System Prompt 不泄露；③验证 L3 工具白名单外调用被拦截；④验证 L4 违规内容被拦截（豆包 moderation）；⑤验证 L5 高风险 Action 二次确认；⑥验证 L6 成本超限熔断。
- **通过标准**：六层全部触发；Injection 检出率 ≥ 95%；高风险 Action 100% 二次确认；超额熔断生效。
- **对应模块**：M4 六层 Guardrails。
- **实施阶段**：P0（Phase 6.0 Week 7-8）。

**T14 Eval-gated 阻断测试**：
- **目标**：验证 Eval-gated 发布门禁自动阻断不合格版本。
- **测试方法**：①构造一个"劣化"版本（故意降低 τ-bench pass^k），验证 Eval-gated 自动阻断发布；②构造一个"正常"版本，验证 Eval-gated 允许发布；③验证评估报告 OTel Trace 化。
- **通过标准**：τ-bench pass^k 未达标自动阻断；正常版本允许发布；评估报告 Trace 完整。
- **对应模块**：M5 / M6 / M10。
- **实施阶段**：P2（Phase 6.2）。

**T15 AgentBOM 完整性测试**：
- **目标**：验证 AgentBOM 字段完整性和 Blast-radius Gate 生效。
- **测试方法**：①查询所有 Agent 的 BOM，验证 dependencies / version / capabilities / permissions / provenance / license 全字段完整；②构造高 Blast-radius Action（影响 > 100 用户），验证双签 + 升级审批触发；③构造低 Blast-radius Action（影响 < 10 用户），验证自动执行。
- **通过标准**：AgentBOM 全字段完整；high 风险双签 + 升级审批；low 风险自动执行。
- **对应模块**：M12 Agent 治理。
- **实施阶段**：P2（Phase 6.2）。

### 9.4 配置文件清单

v3.0 新增 / 升级的配置文件清单（均在 `flowforge/config/` 目录下）：

| 配置文件 | 对应模块 | 说明 | 格式 |
|---------|---------|------|------|
| `config/a2a/agent_cards/*.yaml` | M1 | Agent Card 配置（agent_id / name / capabilities / skills / authentication） | YAML |
| `config/a2a/auth.yaml` | M1 | 跨厂鉴权配置（Bearer / OAuth2 / mTLS） | YAML |
| `config/mcp_v2026/manifests/*.json` | M2 | MCP Manifest 配置（name / tools / oauth / sandbox） | JSON |
| `config/mcp_v2026/sandbox_policy.yaml` | M2 | 工具沙箱策略（container / cpu / memory / network） | YAML |
| `config/mcp_v2026/elision.yaml` | M2 | Tool Result Elision 策略（token_threshold / summary_trigger） | YAML |
| `config/context_engine/layers.yaml` | M3 | Context Layer 配置（priority / lazy / cache / source） | YAML |
| `config/context_engine/memory_policy.yaml` | M3 | Memory 策略（save / recall / forget / compress） | YAML |
| `config/context_engine/editing.yaml` | M3 | Context Editing 策略（token_budget / history_window） | YAML |
| `config/guardrails/input_validation.yaml` | M4 | L1 Input Validation 策略（injection / jailbreak / PII） | YAML |
| `config/guardrails/tool_allowlist.yaml` | M4 | L3 Tool Allowlist（per-agent 工具白名单） | YAML |
| `config/guardrails/action_confirmation.yaml` | M4 | L5 Action Confirmation（高风险 Action 列表） | YAML |
| `config/guardrails/cost_ceilings.yaml` | M4 | L6 Cost Ceilings（session / daily / monthly 上限） | YAML |
| `config/observability/exporters.yaml` | M5 | OTel Exporter 配置（OTLP / LangSmith / Langfuse / Phoenix） | YAML |
| `config/observability/alerts.yaml` | M5 | 告警规则（失败率 / 延迟 / Token / Cache 命中率） | YAML |
| `config/observability/eval_gate.yaml` | M5 | Eval-gated 配置（benchmark / pass_threshold / k_value） | YAML |
| `config/durable/checkpoint.yaml` | M7 | Checkpoint 策略（every_n_steps / time_window） | YAML |
| `config/durable/sagas/*.yaml` | M7 | Saga 定义（steps / compensation / timeout） | YAML |
| `config/engine/reflection.yaml` | M8 | 反射配置（iteration_limit / confidence_threshold） | YAML |
| `config/harness/prompt_cache.yaml` | M9 | Prompt Cache 配置（ttl / invalidation_rules） | YAML |
| `config/harness/cost_router.yaml` | M9 | Cost-Aware Routing 策略（rules / model_mapping） | YAML |
| `config/models/quota_pool.yaml` | M9 | 多 Provider 配额池（providers / qps / daily_limit） | YAML |
| `config/deploy/canary.yaml` | M10 | 灰度发布策略（stages / traffic_split / rollback_rules） | YAML |
| `config/deploy/ab_test.yaml` | M10 | A/B 测试配置（experiment / variants / metrics） | YAML |
| `config/harness/hitl_channels.yaml` | M11 | HITL 通知渠道（webhook / email / feishu / slack） | YAML |
| `config/harness/hitl_policy.yaml` | M11 | HITL 中断策略（HotL / HoverL 触发条件） | YAML |
| `config/governance/policies/*.yaml` | M12 | 治理策略（AgentBOM / Blast-radius / 审计） | YAML |
| `config/tools/computer_use.yaml` | M13 | GUI Agent 配置（platform / timeout / screenshot） | YAML |
| `config/tools/browser_use.yaml` | M13 | Browser Agent 配置（engine / timeout / wait_until） | YAML |
| `config/interconnect/protocol_adapters.yaml` | M14 | 协议适配器配置（ACP ↔ MCP ↔ A2A） | YAML |
| `config/runtime/bulkhead.yaml` | M15 | Bulkhead 隔离配置（pools / size / queue_size） | YAML |
| `config/runtime/degradation.yaml` | M15 | 降级链路配置（6 条降级路径 / 触发条件） | YAML |
| `config/tenant/quotas/*.yaml` | M16 | 租户配额配置（qps / token / storage / concurrent） | YAML |
| `config/marketplace/sandbox_policy.yaml` | M17 | Skill 沙箱策略（container / resource / permission） | YAML |
| `config/feature_flags.yaml` | 全局 | Feature Flag 配置（a2a_enabled / mcp_v2026_enabled 等） | YAML |

### 9.5 API 端点清单

v3.0 新增 / 升级的 API 端点清单：

| 端点 | 方法 | 对应模块 | 说明 |
|------|------|---------|------|
| `/.well-known/agent.json` | GET | M1 | A2A Agent Card 自动发现 |
| `/a2a/{agent_id}/tasks` | POST | M1 | A2A 任务下发 |
| `/a2a/{agent_id}/tasks/{task_id}/status` | GET | M1 | A2A 任务状态查询 |
| `/a2a/{agent_id}/tasks/{task_id}/result` | GET | M1 | A2A 任务结果获取 |
| `/a2a/{agent_id}/tasks/{task_id}` | DELETE | M1 | A2A 任务取消 |
| `/a2a/{agent_id}/stream` | POST | M1 | A2A SSE 流式 |
| `/a2a/{agent_id}/tasks/{task_id}/subscribe` | POST | M1 | A2A 长任务订阅 |
| `/a2a/directory/search` | GET | M1 | A2A 目录查询（联邦） |
| `/.well-known/mcp-manifest.json` | GET | M2 | MCP Manifest 自动发现 |
| `/api/v1/governance/agents/{agent_id}/bom` | GET | M12 | AgentBOM 查询 |
| `/api/v1/governance/blast-radius/evaluate` | POST | M12 | Blast-radius 评估 |
| `/api/v1/marketplace/skills` | GET | M17 | Skill 市场搜索 |
| `/api/v1/marketplace/skills/{id}/install` | POST | M17 | Skill 安装 |
| `/api/v1/marketplace/skills/{id}` | DELETE | M17 | Skill 卸载 |
| `/api/v1/marketplace/skills/{id}/rate` | POST | M17 | Skill 评价 |
| `/api/v1/eval/run` | POST | M6 | 评估执行（τ-bench / SWE-bench Pro / 回归） |
| `/api/v1/eval/report/{run_id}` | GET | M6 | 评估报告查询 |
| `/api/v1/deploy/canary` | POST | M10 | 灰度发布启动 |
| `/api/v1/deploy/canary/{id}/rollback` | POST | M10 | 灰度回滚 |
| `/api/v1/deploy/ab-test` | POST | M10 | A/B 测试启动 |
| `/api/v1/hitl/checkpoints` | GET | M11 | HITL 中断点列表 |
| `/api/v1/hitl/checkpoints/{id}/resume` | POST | M11 | HITL 中断恢复 |
| `/api/v1/hitl/checkpoints/{id}/approve` | POST | M11 | HITL 审批 |
| `/api/v1/durable/tasks/{task_id}/checkpoint` | GET | M7 | Durable Checkpoint 查询 |
| `/api/v1/durable/tasks/{task_id}/recover` | POST | M7 | Durable 任务恢复 |
| `/api/v1/cost/ledger` | GET | M9 | 成本归因查询 |
| `/api/v1/cost/dashboard` | GET | M9 | 成本仪表盘数据 |
| `/health` | GET | M15 | 健康检查（liveness） |
| `/ready` | GET | M15 | 就绪检查（readiness） |
| `/live` | GET | M15 | 存活检查（liveness probe） |

### 9.6 面试信号溯源矩阵

以下矩阵说明每个 M1-M17 模块对应的面试信号来源（面试公司 + 问题摘要）：

| 模块 | 面试公司 | 关键问题摘要 | 信号热度 |
|------|---------|------------|---------|
| M1 A2A | 字节 / 腾讯 | "A2A 为什么自建" / "无限聊下去如何防止" | ★★★★★ |
| M2 MCP | 深信服 / 字节 | "Harness 与模型解耦" / "协议边界坑" | ★★★★ |
| M3 Context | 全六厂 | "Memory 与上下文管理"（唯一全高频） | ★★★★★ |
| M4 Guardrails | 小米 / 深信服 | "事故驱动护栏" / "软+硬+Eval 三层" | ★★★★ |
| M5 OTel | 阿里 / 高德 | "自进化如何做 Eval" / "为什么不做每日曲线" | ★★★★ |
| M6 Eval | 阿里 / 小米 | "Eval 怎么做" / "Harness 改完如何回归" | ★★★★★ |
| M7 Durable | 深信服 / 小米 / 腾讯 | "长程任务如何恢复" / "Feature 做五天不偏离" | ★★★★ |
| M8 纠错 | 小米 / 深信服 | "三层 Harness" / "弱模型 Tool calling 治理" | ★★★★ |
| M9 Cost | 阿里 | "Sandbox economics" / "轻量化隔离" | ★★★ |
| M10 部署 | 小米 / 腾讯 | "CI/CD 自动修复到哪一步" / "老功能不漂移" | ★★★★ |
| M11 HITL | 深信服 / 小米 | "长程任务压缩丢失" / "人 Agent 协同检查点" | ★★★★ |
| M12 治理 | 腾讯 / 小米 | "测试 Agent" / "平台治理规则" | ★★★ |
| M13 Computer | 深信服 / 阿里 | "多模态 Web 测试" / "长任务等待感" | ★★★ |
| M14 协议栈 | 字节 | "单 / 多 Agent 协议边界坑" | ★★★ |
| M15 恢复 | 字节 / 阿里 | "failure mode" / "一直瞎聊如何终止" | ★★★★ |
| M16 多租户 | 腾讯 | "云端逻辑多租户" / "Memory 污染" | ★★★ |
| M17 Skill 市场 | 阿里 / 高德 / 小米 | "能力市场" / "个人→组织经验推广" | ★★★★ |

---

> **本文档为 FlowForge v3.0 Agent Harness 进化需求规格说明书（spec_face），待用户审核。**
> **请先审核第八章 12 项决策点，标注"同意 / 调整"。**
> **审核通过后按第六章路线图启动 Phase 6.0（P0 基础）实施。**
> **M1-M17 是 v7.0 灵智养成体系的工程支撑，原 M18 / M19 / M20 已删除并融合映射到 v7.0 FR-EVO-01~15。**
> **所有实现必须严格遵守 `hiclaw/rules.md` 和 `hiclaw/prompts.md`。**
