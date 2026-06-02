# FlowForge v6.1 功能特性规格说明书（修订版）

> **版本**：v6.1（基于审核意见修订）
> **日期**：2026-05-26
> **修订依据**：CEO/产品专家/架构师/Agent工程师/全栈工程师联合审核意见
> **修订原则**：砍方向、降预期、修Bug、补基础
> **定位**：从"全场景覆盖"收缩为"单点极致"——先让ContentForge内容创作Workflow真正可用

---

## 第一章：修订概要

### 1.1 修订背景

v6.0规格说明书经多角色联合审核后，发现以下核心问题：
1. **功能范围过度膨胀**：40个场景、18个商业化方向、30+Agent库，远超当前代码实现能力
2. **代码与文档严重不符**：大量功能仅停留在设计文档，实际代码未实现或存在Bug
3. **时间线过于激进**：6个月实现平台化的目标不现实
4. **工程基础薄弱**：前端未实现、测试覆盖不足、DevOps成熟度低

### 1.2 修订原则

| 原则 | 说明 |
|------|------|
| **聚焦单点** | 前3个月只做"AI内容批量化生产"一个场景 |
| **文档服从代码** | 删除所有未实现功能的描述，只保留已验证功能 |
| **Bug优先于功能** | 修复B1-B4阻塞级Bug优先于任何新功能开发 |
| **用户价值导向** | 从"我们能做什么"转向"用户愿意付费什么" |

### 1.3 版本范围调整

```
v6.0规划范围                    v6.1修订范围
┌─────────────────────┐        ┌─────────────────────┐
│ 40个自动化场景      │   →    │ 2个核心场景         │
│ 18个商业化方向      │   →    │ 1个商业化方向       │
│ 30+通用Agent库      │   →    │ 7个核心Agent        │
│ 9大模式完整实现     │   →    │ 4个核心模式         │
│ 三件套独立产品      │   →    │ FlowForge单产品     │
│ 6个月平台化         │   →    │ 12个月平台化        │
└─────────────────────┘        └─────────────────────┘
```

---

## 第二章：产品概述与愿景（修订）

### 2.1 产品定位修订

**v6.0定位**：企业级Agent Harness平台，覆盖40个场景
**v6.1定位**：**AI内容创作助手**——为内容创作者提供从选题到发布的全链路自动化能力

### 2.2 核心公式（不变）

```
Agent = Model (Brain) + Harness (Body)
FlowForge = Harness Layer = 前馈控制 + 反馈控制 + 熵管理 + 可观测性
```

### 2.3 用户角色修订

| 角色 | v6.0定义 | v6.1修订 | 修订原因 |
|------|---------|---------|---------|
| AI应用开发者 | 核心用户 | 次要用户 | 当前阶段聚焦终端用户 |
| 平台管理员 | 核心用户 | 暂不服务 | 无SaaS多租户能力 |
| 业务专家（内容创作者） | 次要用户 | **核心用户** | 唯一可服务的客群 |
| AI主编/指挥 | 内置角色 | 保留 | 调度核心不变 |

### 2.4 核心业务场景修订

**v6.1仅保留以下场景**：

1. **被动创作（On-Demand）**：用户输入选题意图，系统自动完成选题→研究→写作→审核→发布
2. **主动创作（Scheduled）**：配置Cron定时任务，系统自动完成选题→创作→审核提示
3. **审核与干预（Human-in-the-Loop）**：AI生成内容在发布前推送审核，用户可通过/编辑/驳回

**删除以下场景（延期至v7.0+）**：
- 级联自愈、系统监控、Agent-to-Agent Review、技术债自动回收、数据分析决策等

---

## 第三章：系统架构总览（修订）

### 3.1 六层架构模型（精简版）

```
┌─────────────────────────────────────────────────────────────────────┐
│  6. 应用层 (Application Layer)                                      │
│     ContentForge（唯一应用）                                        │
├─────────────────────────────────────────────────────────────────────┤
│  5. 接入层 (Gateway Layer)                                          │
│     FastAPI REST API + CLI（Web UI延期至v6.2）                      │
├─────────────────────────────────────────────────────────────────────┤
│  4. Harness 驾驭层 (Harness Layer) ★ v6.1 核心（部分实现）          │
│     上下文工程 | 反馈循环（精简版）| 会话管理                       │
├─────────────────────────────────────────────────────────────────────┤
│  3. 执行引擎层 (Engine Layer)                                       │
│     HybridExecutor | ModeRegistry（4大模式）| Scheduler             │
├─────────────────────────────────────────────────────────────────────┤
│  2. 能力层 (Capability Layer)                                       │
│     Tool生态 | Agent库（7个核心）| Memory（3种策略）                │
├─────────────────────────────────────────────────────────────────────┤
│  1. 基础设施层 (Infrastructure Layer)                               │
│     PostgreSQL（替换SQLite）| Redis | LLM API                       │
└─────────────────────────────────────────────────────────────────────┘
```

**修订说明**：
- 删除Qdrant/Milvus（当前未使用向量存储）
- 删除LangGraph（与自研引擎边界不清，延期使用）
- SQLite → PostgreSQL（支撑生产环境）

### 3.2 Harness层修订

**v6.1仅保留以下Harness能力**：

| 能力 | 实现状态 | 说明 |
|------|---------|------|
| 上下文工程（ContextEngine） | ✅ 保留 | AGENTS.md注入 + 历史失败案例检索 |
| 反馈循环（FeedbackLoop） | ⚠️ 精简 | 仅保留lightweight模式（1次LLM调用） |
| 会话管理（SessionManager） | ✅ 保留 | 92%阈值压缩 + 工具输出截断 |
| 架构约束（ArchConstraintEngine） | ❌ 延期 | v6.2实现 |
| 熵管理（EntropyManager） | ❌ 延期 | v6.3实现 |
| 权限管线（PermissionPipeline） | ❌ 延期 | v6.2实现 |

### 3.3 模式注册中心修订

**v6.1仅保留4种核心模式**：

| 模式 | 适用场景 | 实现优先级 |
|------|---------|-----------|
| `react` | 多步动态检索 | P0 |
| `plan_execute` | 路径明确的任务 | P0 |
| `reflexion` | 内容自审优化 | P0 |
| `workflow` | DeepArticle端到端流水线 | P0 |

**延期至v6.2+的模式**：
- multi_agent、rewoo、self_discover、agent_judge、graph_of_thoughts

---

## 第四章：核心功能需求（修订）

### 4.1 执行引擎（Engine Layer）

**FR-ENG-01：HybridExecutor 混合执行器（修订）**

- TAOR循环（Think-Act-Observe-Repeat）
- Persona锁：同一persona同一时间只允许一个任务运行
- **_is_substep参数：Workflow子步骤跳过锁检查**
- 错误处理：支持`abort/skip/retry`三种策略（删除reflexion_retry，因Reflexion模式未闭环）
- **新增：Workflow步骤mode强制生效**（修复B3 Bug）

**FR-ENG-02：ModeRegistry 模式注册中心（修订）**

- 仅注册/获取4种核心模式
- 智能模式推荐延期至v6.2

**FR-ENG-03：三层防御机制（修订）**

| 层级 | 机制 | 修订 |
|------|------|------|
| L1 | ToolRegistry.execute()超时（120s） | 不变 |
| L2 | BaseModeExecutor._on_exit()重复检测 | 不变 |
| L3 | WorkflowExecutor on_error="reflexion_retry" | **删除**（改为简单retry） |

**FR-ENG-04：轨迹记录（修订）**

- 记录Agent执行全过程的工具调用轨迹
- **删除**：Episode持久化到CheckpointManager（延期）
- **删除**：分类闸门自动质量判定（延期）

### 4.2 Harness 驾驭层（修订）

**FR-HRN-01：上下文工程引擎（保留）**

- AGENTS.md动态知识注入
- 历史失败案例检索
- 会话交接物构建

**FR-HRN-02：反馈循环引擎（精简）**

- **删除**：四维评分体系（Design Quality / Originality / Craft / Functionality）
- **保留**：分类闸门（仅判断工具执行结果）
- evaluation_mode仅保留`lightweight`和`skip`两档

**FR-HRN-03：会话管理器（保留）**

- 92%阈值触发上下文压缩
- 保留最近3轮完整对话 + 压缩早期历史
- 工具输出Token截断（25000 tokens）

### 4.3 能力层（修订）

**FR-CAP-01：Tool 生态（修订）**

| 工具 | 状态 | 说明 |
|------|------|------|
| LLM Client | ✅ 保留 | 统一调用接口 |
| Web Search | ✅ 保留 | Tavily + DuckDuckGo |
| Web Scraper | ⚠️ 保留 | 基础实现 |
| File RW | ✅ 保留 | 路径穿越防护 |
| Webhook | ✅ 保留 | 通知推送 |
| WeChat Publisher | ⚠️ 保留 | 公众号草稿箱 |
| **删除工具**：Python沙箱、Shell执行、Git操作、邮件发送、图片搜索 | | 延期至v6.2 |

**FR-CAP-02：Agent 库（修订为7个核心Agent）**

| Agent | 优先级 | 状态 |
|-------|--------|------|
| TopicResearchAgent | P0 | 已部分实现，需修复缓存策略 |
| MaterialCollectionAgent | P0 | 已部分实现，需实现并行检索 |
| ArticleWritingAgent | P0 | 已部分实现，需增加Reflexion自审 |
| SEOOptimizationAgent | P0 | 已部分实现，需实现关键词密度检查 |
| FactCheckAgent | P0 | 已部分实现，需增加内容比对 |
| ContentAuditAgent | P0 | **需修复B1 Bug（支持judge_model）** |
| PublishingAgent | P0 | 已部分实现，需完善错误处理 |

**删除Agent（延期至v6.2+）**：
ContentRepurposer、TrendAnalysis、ImageResearch、Multilingual、HeadlineOptimizer
以及所有小说创作类和代码工具类Agent

**FR-CAP-03：Memory 系统（修订）**

v6.1仅保留3种记忆策略：
- Working Memory（工作记忆）
- Short-term Memory（短期记忆）
- Long-term Memory（长期记忆）

**删除（延期）**：Semantic Memory、Episodic Memory、TaskBoard、Mailbox

**FR-CAP-04：Workflow 库（修订）**

v6.1仅保留1个核心Workflow：
- DeepArticleWorkflow（8步端到端内容创作）

**删除（延期）**：QuickPost、TrendArticle、MultiPlatform、SEOContent、ImageArticle、Multilingual、ReportGeneration、DefenseArticle

---

## 第五章：多 Agent 策略（延期）

**v6.1声明**：Multi-Agent策略（Subagents/Teams/Swarms）延期至v6.2实现。

原因：
1. 当前代码仅Teams有基础实现，Subagents和Swarms完全未实现
2. 内容创作场景在v6.1阶段可通过单Agent Workflow满足
3. Multi-Agent的调试复杂度极高，需要稳定的单Agent基础

---

## 第六章：接口设计（不变）

BaseAgent、BaseTool、TaskContext接口与v6.0保持一致，确保向后兼容。

**唯一修订**：TaskContext新增`judge_model`字段（修复B1 Bug）

```python
class TaskContext:
    # ... v6.0字段不变 ...
    judge_model: Optional[str] = None  # ★ v6.1新增：独立评判模型
```

---

## 第七章：修订后的里程碑

| 里程碑 | 时间 | 验证标准 | 通过条件 |
|--------|------|---------|---------|
| M1：引擎可用 | 第2-4周 | 核心Workflow端到端执行成功率 | >90% |
| M2：Bug修复 | 第2-4周 | B1-B4四个阻塞级Bug修复 | 全部通过 |
| M3：内容可用 | 第5-8周 | 生成文章人工审核通过率 | >70% |
| M4：前端可用 | 第9-12周 | 基础Web UI（任务列表+审核面板）| 可用 |
| M5：用户验证 | 第13-16周 | 10个种子用户连续使用7天 | 留存率>50% |
| M6：付费验证 | 第17-20周 | 首批付费用户NPS评分 | >40 |
| M7：平台化 | 第9-12个月 | 模板市场+多租户 | 延期 |

---

## 第八章：商业化方向修订

**v6.1仅保留1个商业化方向**：

| 方向 | 名称 | 定价 | 目标客户 |
|------|------|------|---------|
| P0 | AI内容批量化生产 | ¥99-499/月 | 自媒体、内容创作者 |

**删除方向（延期）**：
- 企业AI知识库、AI自动化办公、AI客服、简历优化、数据分析等全部延期

**OpenRoute和OpenSieve定位修订**：
- 从"独立产品"降级为"FlowForge内置模块"
- OpenRoute：仅作为FlowForge的模型路由组件
- OpenSieve：仅作为FlowForge的检索增强组件

---

## 附录：修订对照表

| 项目 | v6.0 | v6.1 | 修订原因 |
|------|------|------|---------|
| 场景数量 | 40个 | 2个 | 聚焦单点 |
| Agent数量 | 30+ | 7个 | 代码能力限制 |
| 模式数量 | 9种 | 4种 | 核心优先 |
| 记忆策略 | 5种 | 3种 | 简化实现 |
| Workflow模板 | 15+ | 1个 | 聚焦核心 |
| 商业化方向 | 18个 | 1个 | 验证PMF |
| 产品矩阵 | 三件套 | 单产品 | 资源聚焦 |
| 平台化时间 | 第13周 | 第9-12个月 | 现实评估 |
| 前端实现 | 宣称已设计 | 延期至v6.2 | 未实现 |
| 数据库 | SQLite | PostgreSQL | 生产需求 |
