# FlowForge v6.0 功能特性规格说明书（精简版）

> **版本**：v6.0-LITE
> **日期**：2026-05-24
> **定位**：基于审核意见的精简版本，聚焦核心功能，删除过度设计
> **审核依据**：architect_review.md / agent_developer_review.md / fullstack_review.md

---

## 第一章：产品概述与愿景（精简版）

### 1.1 产品定位

FlowForge v6.0-LITE 是一个**轻量级 Agent 编排平台**，聚焦 OpenRoute API 网关 + 3个核心 Workflow + 5个核心 Agent，去除过度设计的复杂功能。

### 1.2 核心原则

```
Phase1 原则：
1. 先跑通，再完善
2. 不追求完整，追求可运行
3. 每个功能必须有测试，否则不许上线
```

### 1.3 用户角色定义

| 角色 | 描述 | 核心诉求 |
|------|------|---------|
| **开发者** | 使用 API 或 CLI 调用 Agent | 简单易用 |
| **内容创作者** | 使用 Web UI 创建任务 | 操作直观 |

---

## 第二章：核心功能需求（精简版）

### 2.1 执行引擎 (Engine Layer)

**FR-ENG-01：HybridExecutor 混合执行器**

- TAOR 循环（Think-Act-Observe-Repeat）
- 支持 3 种模式：react / reflexion / workflow
- 错误处理：abort / skip / retry

**FR-ENG-02：ModeRegistry 模式注册中心**

- 注册/获取/推荐模式
- 支持 3 种内置模式：react / reflexion / workflow

**FR-ENG-03：3 大内置 Agent 模式**

| 模式 | 核心机制 | 适用场景 |
|------|---------|---------|
| `react` | Thought → Action → Observation 循环（MAX_STEPS=8） | 多步动态检索或工具调用 |
| `reflexion` | Actor → Evaluator → Reflector 三 Agent 迭代（MAX_ITERATIONS=3） | 需要反复打磨的任务 |
| `workflow` | 预定义 DAG 流程，可混合其他模式 | 长流程、端到端业务流水线 |

**删除的模式**（Phase2+ 再考虑）：
- self_discover（实现过于复杂）
- agent_judge（作为独立 Agent 实现）
- graph_of_thoughts（实现过于复杂）

### 2.2 P0 核心 Agent 库（5个）

| Agent | 核心能力 | 模式 | LLM调用上限 |
|-------|---------|------|-------------|
| **TopicResearchAgent** | 多级检索策略 | rewoo | 3次 |
| **MaterialCollectionAgent** | 并行多源检索、素材清洗 | rewoo | 3次 |
| **ArticleWritingAgent** | 三层生成管道：大纲→初稿→润色 | reflexion | 5次 |
| **ContentAuditAgent** | LLM 质量评分 | agent_judge | 1次 |
| **PublishingAgent** | 多平台发布适配 | plan_execute | 2次 |

**删除的 Agent**（Phase2+ 再考虑）：
- SEOOptimizationAgent
- FactCheckAgent
- HeadlineOptimizer
- ContentRepurposer
- TrendAnalysisAgent
- ImageResearchAgent
- MultilingualAgent
- DevForge 系列（8个）
- NovelForge 系列（12个）

### 2.3 P0 核心 Workflow（3个）

| Workflow | 使用 Agent | 步骤数 |
|----------|-----------|--------|
| **DeepArticleWorkflow** | Research → Writing → Audit → Publish | 4步 |
| **QuickPostWorkflow** | Research → Writing → Publish | 3步 |
| **MultiPlatformWorkflow** | Writing → Repurposer → Publish(×N) | 3步 |

**简化原则**：
- 每个 Workflow 不超过 5 步
- SEO/FactCheck 作为可选步骤
- 减少 LLM 调用次数，降低成本

### 2.4 LLM 成本守卫（新增）

```python
class LLMCallGuard:
    """LLM 调用次数守卫"""
    MAX_CALLS_PER_TASK = 20
    COST_PER_ARTICLE_BUDGET = 0.50  # 每篇文章预算 ¥0.50

    def check(self, task_id, calls_count, estimated_cost):
        if calls_count > self.MAX_CALLS_PER_TASK:
            raise LLMOveruseError(f"Task {task_id} exceeded max calls")
        if estimated_cost > self.COST_PER_ARTICLE_BUDGET:
            raise CostOverrunError(f"Task {task_id} cost exceeded budget")
```

### 2.5 Tool 生态（精简版）

**P0 内置 Tool（10个）**：

| Tool | 功能 | safety_level |
|------|------|-------------|
| llm_client | LLM 调用 | normal |
| web_search | 网络搜索 | readonly |
| helixrag_search | 知识检索 | readonly |
| file_read | 文件读取 | readonly |
| file_write | 文件写入 | dangerous |
| http_request | HTTP 请求 | normal |
| wechat_publish | 微信发布 | dangerous |
| memory_store | 记忆存储 | normal |

**删除的 Tool**：Email / Slack / Git 等 - Phase2 再接入

### 2.6 Memory 系统（精简版）

| 记忆类型 | 存储 | Phase1 支持 |
|---------|------|-------------|
| Working | dict | ✅ |
| Short-term | SQLite | ✅ |
| Long-term | SQLite | ✅ |
| Semantic | SQLite FTS（替代 Qdrant）| ✅（简化版）|
| Episodic | SQLite | ✅ |

**简化**：使用 SQLite FTS 替代 Qdrant 向量检索，降低部署复杂度。

---

## 第三章：技术架构（精简版）

### 3.1 四层架构模型

```
┌─────────────────────────────────────────┐
│  4. 接入层 (Gateway Layer)              │
│     FastAPI REST API + WebSocket + Web UI │
├─────────────────────────────────────────┤
│  3. 执行引擎层 (Engine Layer)           │
│     HybridExecutor | ModeRegistry | 3模式 │
├─────────────────────────────────────────┤
│  2. 能力层 (Capability Layer)            │
│     Tool生态 | Agent库 | Memory        │
├─────────────────────────────────────────┤
│  1. 基础设施层 (Infrastructure Layer)    │
│     SQLite | Redis | LLM API           │
└─────────────────────────────────────────┘
```

**删除的层**：
- Harness 驾驭层（Phase2 再引入）
- Skill 系统（Phase2 再引入）
- MCP 模块（Phase2 再引入）

### 3.2 数据库架构（精简版）

```
SQLite：
├── tasks.db        # 任务表
├── memory.db      # 记忆存储
└── audit.db       # 审计日志
```

**删除**：PostgreSQL / Qdrant（Phase2 再引入）

### 3.3 部署架构（精简版）

```
Docker Compose（Phase1）：
├── flowforge-api    # FastAPI
├── flowforge-web    # Next.js
└── redis           # 缓存
```

---

## 第四章：Phase2+ 功能规划

### 4.1 Phase2 功能

| 功能 | 说明 |
|------|------|
| Skill 系统 | 4种格式适配 |
| Harness 基础 | 上下文注入 |
| SEOOptimizationAgent | SEO 优化 |
| FactCheckAgent | 事实核查 |
| Multi-Agent Subagents | 并行子任务 |

### 4.2 Phase3 功能

| 功能 | 说明 |
|------|------|
| OpenSieve 集成 | 聚合检索 |
| MCP 模块 | 外部工具接入 |
| PostgreSQL | 数据扩展 |
| Multi-Agent Teams | 多角色协作 |

### 4.3 删除的功能

| 功能 | 理由 |
|------|------|
| DevForge | 代码生成质量不可控 |
| NovelForge | 市场不明确 |
| 熵管理/文档园丁 | 非核心功能 |
| graph_of_thoughts | 实现过于复杂 |
| self_discover | 实现过于复杂 |

---

## 第五章：非功能需求

### 5.1 性能要求（精简版）

| 指标 | 目标 |
|------|------|
| 单 Agent 执行延迟（不含 LLM） | < 2s (P95) |
| Workflow 4 步骤执行（不含 LLM） | < 30s |
| WebSocket 事件延迟 | < 100ms (P95) |

### 5.2 可靠性要求

| 指标 | 目标 |
|------|------|
| 系统可用性 | > 99% |
| 人工审核通过率 | > 90% |
| Circuit Breaker 触发 | 5 次连续失败 |

---

## 第六章：测试要求

### 6.1 测试覆盖率目标

| 测试类型 | 覆盖率目标 | 执行频率 |
|---------|-----------|---------|
| 单元测试 | 70% | 每次提交 |
| 集成测试 | 50% | 每天 |
| E2E 测试 | 30% | 每周 |

### 6.2 LLM 调用测试

```python
async def test_article_writing_llm_budget():
    """验证文章创作的 LLM 调用次数不超过预算"""
    guard = LLMCallGuard(MAX_CALLS=20, BUDGET=0.50)
    # 执行写作任务
    result = await workflow.execute(topic="AI 趋势")
    # 验证不超限
    assert guard.check(task_id, result.llm_calls, result.estimated_cost)
```

---

## 附录 A：架构决策记录（ADR）

### ADR-001：使用 SQLite FTS 替代 Qdrant

**决策**：Phase1 使用 SQLite FTS 替代 Qdrant 向量检索
**理由**：降低部署复杂度，1人团队难以维护向量数据库
**影响**：语义检索精度降低，但可满足基本需求
**恢复**：Phase2 可切换到 Qdrant

### ADR-002：3种核心模式替代9种

**决策**：Phase1 只实现 3 种模式（react/reflexion/workflow）
**理由**：9种模式实现复杂度高，Phase1 聚焦核心场景
**影响**：部分高级场景暂不支持
**恢复**：Phase2 按需增加

### ADR-003：5个核心 Agent 替代 30+

**决策**：Phase1 只实现 5 个核心 Agent
**理由**：30+ Agent 大多数未经验证，过早引入增加技术债
**影响**：部分高级场景暂不支持
**恢复**：Phase2 按需增加

---

> **审核依据**：architect_review.md / agent_developer_review.md / fullstack_review.md
> **版本**：v6.0-LITE（精简版）
> **核心变化**：删除过度设计，聚焦核心功能
