# FlowForge v6.0 架构设计（精简版）

> **版本**：v6.0-LITE
> **日期**：2026-05-24
> **定位**：基于审核意见的精简版本，聚焦核心功能，删除过度设计
> **审核依据**：architect_review.md / agent_developer_review.md / fullstack_review.md

---

## 1. 架构总览（精简版）

### 1.1 四层架构模型

FlowForge v6.0-LITE 采用精简的四层架构：

```
┌─────────────────────────────────────────┐
│  4. 接入层 (Gateway Layer)              │
│     FastAPI REST API + WebSocket + Web UI │
├─────────────────────────────────────────┤
│  3. 执行引擎层 (Engine Layer)            │
│     HybridExecutor | ModeRegistry | 3模式 │
├─────────────────────────────────────────┤
│  2. 能力层 (Capability Layer)            │
│     Tool生态 | Agent库 | Memory        │
├─────────────────────────────────────────┤
│  1. 基础设施层 (Infrastructure Layer)    │
│     SQLite | Redis | LLM API           │
└─────────────────────────────────────────┘
```

### 1.2 完整架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        接入层 (Gateway Layer)                      │
│            FastAPI REST API + WebSocket + Next.js Web UI          │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────┐
│                      执行引擎层 (Engine Layer)                    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              HybridExecutor (核心调度器)                    │   │
│  │  · 模式选择 (react / reflexion / workflow)               │   │
│  │  · TAOR 循环 (Think-Act-Observe-Repeat)                 │   │
│  │  · LLMCallGuard 成本守卫                                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │          ModeRegistry (3大模式)                          │   │
│  │  react | reflexion | workflow                            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │          AgentRegistry + ToolRegistry                      │   │
│  │  5个核心Agent | 10个核心Tool                             │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────┐
│                      能力层 (Capability Layer)                    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │       MemoryManager (4种记忆)                             │   │
│  │  Working | Short-term | Long-term | Episodic             │   │
│  │  Semantic Memory (SQLite FTS 简化版)                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │       EventBus (事件系统)                                  │   │
│  │  10种核心事件 | WebSocket 推送                            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────┐
│                    基础设施层 (Infrastructure Layer)              │
│                                                                  │
│     SQLite (任务/记忆/审计)  |  Redis (缓存)  |  LLM API       │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 删除的组件

| 删除组件 | 理由 | 恢复计划 |
|---------|------|---------|
| Harness 驾驭层 | Phase1 不需要 | Phase2 再引入 |
| Skill 系统 | 增加复杂度 | Phase2 再引入 |
| MCP 模块 | 需要工具商支持 | Phase3 再引入 |
| Qdrant 向量库 | 运维复杂 | 使用 SQLite FTS |
| PostgreSQL | 过度设计 | Phase2 再引入 |

---

## 2. 核心接口设计

### 2.1 TaskContext — 任务上下文

```python
class TaskContext:
    task_id: str
    persona: Optional[str] = None
    input_data: dict
    metadata: dict
    state: dict
    tools: ToolRegistry
    agents: AgentRegistry
    mode: Optional[str] = None  # react / reflexion / workflow
    event_bus: EventBus
    memory: MemoryManager
```

**简化**：删除 harness_enabled、executor 等高级字段。

### 2.2 BaseAgent — Agent 抽象

```python
class BaseAgent(ABC):
    name: str
    description: str
    default_mode: str = "react"
    max_llm_calls: int = 10  # LLM 调用上限

    @abstractmethod
    async def execute(self, input: AgentInput) -> AgentOutput:
        pass
```

**简化**：固定 max_llm_calls 为 10，防止无限调用。

### 2.3 LLMCallGuard — 成本守卫

```python
class LLMCallGuard:
    """LLM 调用次数和成本守卫"""

    MAX_CALLS_PER_TASK = 20
    COST_PER_ARTICLE_BUDGET = 0.50  # ¥0.50

    def __init__(self, task_id: str):
        self.task_id = task_id
        self.calls_count = 0
        self.total_cost = 0.0

    async def on_llm_call(self, model: str, input_tokens: int, output_tokens: int):
        self.calls_count += 1
        cost = calculate_cost(model, input_tokens, output_tokens)
        self.total_cost += cost

        if self.calls_count > self.MAX_CALLS_PER_TASK:
            raise LLMOveruseError(f"Task {self.task_id} exceeded max calls")
        if self.total_cost > self.COST_PER_ARTICLE_BUDGET:
            raise CostOverrunError(f"Task {self.task_id} cost exceeded budget")
```

---

## 3. 三大内置模式详解

### 3.1 ReAct 模式

```python
class ReActExecutor(BaseModeExecutor):
    mode_name = "react"
    MAX_STEPS = 8

    async def _execute_core(self, ctx: TaskContext) -> dict:
        observation = ctx.input_data.get("task", "")
        action_history = []

        for step in range(self.MAX_STEPS):
            thought = await self._generate_thought(ctx, observation, action_history)
            action = await self._parse_action(ctx, thought)
            if action is None:
                break
            if self._is_loop(action_history, action):
                break
            action_history.append(action)
            observation = await self._execute_action(ctx, action)

        return {"final_answer": observation, "steps": step + 1}
```

### 3.2 Reflexion 模式

```python
class ReflexionExecutor(BaseModeExecutor):
    mode_name = "reflexion"
    MAX_ITERATIONS = 3  # 降低到3次，控制成本
    QUALITY_THRESHOLD = 0.8

    async def _execute_core(self, ctx: TaskContext) -> dict:
        memory, best_result, best_score = [], None, 0.0

        for iteration in range(self.MAX_ITERATIONS):
            actor = ctx.agents.get("reflexion_actor") or DefaultLLMActor()
            output = await actor.execute(...)
            evaluator = ctx.agents.get("reflexion_evaluator") or DefaultLLMEvaluator()
            eval_result = await evaluator.execute(...)

            score = eval_result.result.get("score", 0)
            if score > best_score:
                best_result, best_score = output.result, score
            if score >= self.QUALITY_THRESHOLD:
                break

            reflector = ctx.agents.get("reflexion_reflector") or DefaultLLMReflector()
            reflection = await reflector.execute(...)
            memory.append(reflection.result)

        return {"result": best_result, "score": best_score, "iterations": iteration + 1}
```

### 3.3 Workflow 模式

```python
class WorkflowExecutor(BaseModeExecutor):
    mode_name = "workflow"
    MAX_DEPTH = 2  # 限制深度

    async def _execute_core(self, ctx: TaskContext) -> dict:
        sop_steps = ctx.metadata.get("sop_steps", [])
        context_data = ctx.input_data

        for step in sop_steps:
            if step.get("human"):
                await self._pause_for_review(ctx, step)
                continue

            mode = step.get("mode", "react")
            sub_ctx = TaskContext.from_parent(ctx, input_data=context_data)
            sub_result = await ctx.executor.run(sub_ctx, mode=mode)
            context_data[step["output"]] = sub_result

        return context_data
```

---

## 4. P0 核心 Agent 库

### 4.1 5个核心 Agent

| Agent | 默认模式 | LLM上限 | 说明 |
|-------|---------|---------|------|
| **TopicResearchAgent** | rewoo | 3次 | 多级检索策略 |
| **MaterialCollectionAgent** | rewoo | 3次 | 并行多源检索 |
| **ArticleWritingAgent** | reflexion | 5次 | 三层生成管道 |
| **ContentAuditAgent** | agent_judge | 1次 | 质量评分 |
| **PublishingAgent** | plan_execute | 2次 | 多平台发布 |

### 4.2 Agent 实现示例

```python
class ArticleWritingAgent(BaseAgent):
    name = "article_writing"
    description = "根据研究结果撰写文章"
    default_mode = "reflexion"
    max_llm_calls = 5

    async def execute(self, input: AgentInput) -> AgentOutput:
        research_result = input.params.get("research_result")
        persona = input.params.get("persona")

        # Reflexion 模式执行
        executor = ReflexionExecutor(self.agent_registry, self.tool_registry)
        result = await executor.run(context)

        return AgentOutput(result=result)
```

---

## 5. P0 核心 Workflow（3个）

### 5.1 DeepArticleWorkflow（4步）

```yaml
name: deep_article
description: 深度文章创作流程
mode: workflow

steps:
  - name: research
    agent: topic_research
    mode: rewoo
    output: research_result

  - name: writing
    agent: article_writing
    mode: reflexion
    input:
      research_result: "{{research_result}}"
      persona: "{{persona}}"
    output: article_draft

  - name: audit
    agent: content_audit
    mode: agent_judge
    input:
      draft: "{{article_draft}}"
    output: audit_result

  - name: publish
    agent: publishing
    mode: plan_execute
    condition: "audit_result.score >= 0.8"
    input:
      article: "{{article_draft}}"
    output: publish_result
```

### 5.2 QuickPostWorkflow（3步）

```yaml
name: quick_post
description: 快速帖子生成
mode: workflow

steps:
  - name: research
    agent: topic_research
    mode: rewoo
    output: research_result

  - name: writing
    agent: article_writing
    mode: reflexion
    input:
      research_result: "{{research_result}}"
    output: post_draft

  - name: publish
    agent: publishing
    mode: plan_execute
    input:
      article: "{{post_draft}}"
    output: publish_result
```

### 5.3 MultiPlatformWorkflow（3步）

```yaml
name: multi_platform
description: 多平台内容分发
mode: workflow

steps:
  - name: writing
    agent: article_writing
    mode: reflexion
    output: article

  - name: repurposer
    agent: content_repurposer
    mode: plan_execute
    parallel: true
    input:
      article: "{{article}}"
      platforms: ["wechat", "xiaohongshu", "zhihu"]
    output: adapted_content

  - name: publish
    agent: publishing
    mode: multi_agent
    strategy: subagents
    input:
      contents: "{{adapted_content}}"
    output: publish_results
```

---

## 6. Memory 系统（精简版）

### 6.1 4种记忆策略

| 记忆类型 | 存储 | TTL | Phase1 |
|---------|------|-----|--------|
| Working | dict | - | ✅ |
| Short-term | SQLite | 24h | ✅ |
| Long-term | SQLite | 30d | ✅ |
| Semantic | SQLite FTS | - | ✅（简化版）|
| Episodic | SQLite | - | ✅ |

### 6.2 SQLite FTS 简化语义检索

```python
class SemanticMemory:
    """使用 SQLite FTS5 实现简化版语义检索"""

    def __init__(self, db_path: str):
        self.db = sqlite.connect(db_path)
        self.db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS semantic USING fts5(content, meta)")

    async def store(self, key: str, content: str, meta: dict = None):
        self.db.execute(
            "INSERT INTO semantic (rowid, content, meta) VALUES (?, ?, ?)",
            (hash(key), content, json.dumps(meta))
        )
        self.db.commit()

    async def search(self, query: str, top_k: int = 5) -> list:
        cursor = self.db.execute(
            "SELECT content, meta FROM semantic WHERE semantic MATCH ? LIMIT ?",
            (query, top_k)
        )
        return [{"content": row[0], "meta": json.loads(row[1])} for row in cursor]
```

**简化说明**：使用 SQLite FTS5 替代 Qdrant，向量检索精度降低，但部署复杂度大幅降低。

---

## 7. 部署架构（精简版）

### 7.1 Docker Compose 配置

```yaml
version: '3.8'

services:
  flowforge-api:
    build: ./api
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
    environment:
      - DATABASE_URL=sqlite:///data/flowforge.db
      - REDIS_URL=redis://redis:6379

  flowforge-web:
    build: ./web
    ports:
      - "3000:3000"
    depends_on:
      - flowforge-api

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"

volumes:
  data:
```

### 7.2 环境变量

```bash
# .env
OPENROUTER_API_KEY=sk-or-v1-xxx
LOG_LEVEL=INFO
DATABASE_URL=sqlite:///data/flowforge.db
REDIS_URL=redis://localhost:6379
LLM_BUDGET_PER_ARTICLE=0.50
MAX_LLM_CALLS_PER_TASK=20
```

---

## 8. 技术债务管理

### 8.1 技术债务清单

| 债务项 | 来源 | 优先级 | 偿还计划 |
|--------|------|--------|---------|
| SQLite FTS 精度不足 | Phase1 简化 | P2 | Phase2 切换 Qdrant |
| 缺少 Harness 层 | Phase1 简化 | P2 | Phase2 引入 |
| 3种模式限制 | Phase1 简化 | P1 | Phase2 增加 |
| 5个Agent限制 | Phase1 简化 | P1 | Phase2 增加 |

### 8.2 每周债务清理

```
每周预留 20% 时间清理技术债务：
- 周1：代码审查 + 重构
- 周2：测试覆盖补全
- 周3：文档更新
- 周4：性能优化
```

---

## 9. Phase2+ 扩展规划

### 9.1 Phase2 功能

| 功能 | 说明 | 依赖 |
|------|------|------|
| Skill 系统 | 4种格式适配 | Phase2 |
| Harness 基础 | 上下文注入 | Phase2 |
| SEOOptimizationAgent | SEO 优化 | Phase2 |
| Multi-Agent Subagents | 并行子任务 | Phase2 |

### 9.2 Phase3 功能

| 功能 | 说明 | 依赖 |
|------|------|------|
| OpenSieve 集成 | 聚合检索 | Phase3 |
| PostgreSQL | 数据扩展 | Phase3 |
| MCP 模块 | 外部工具 | Phase3 |
| Multi-Agent Teams | 多角色协作 | Phase3 |

### 9.3 删除的功能

| 功能 | 理由 |
|------|------|
| DevForge | 代码生成质量不可控 |
| NovelForge | 市场不明确 |
| 熵管理/文档园丁 | 非核心功能 |

---

## 10. 架构决策记录（ADR）

### ADR-001：Phase1 简化架构

**状态**：已采纳
**决策**：Phase1 使用四层架构 + 3种模式 + 5个Agent
**理由**：40个场景过度设计，1人团队无法支撑
**影响**：部分高级场景暂不支持
**恢复**：Phase2/3 按需扩展

### ADR-002：SQLite FTS 替代 Qdrant

**状态**：已采纳
**决策**：Phase1 使用 SQLite FTS5 替代 Qdrant
**理由**：降低部署复杂度，减少运维负担
**影响**：语义检索精度降低
**恢复**：Phase2 可切换到 Qdrant

### ADR-003：LLM 成本守卫

**状态**：已采纳
**决策**：每个任务 LLM 调用上限 20次，成本上限 ¥0.50
**理由**：防止成本失控
**影响**：部分复杂任务可能提前终止
**恢复**：大客户可配置更高限额

---

> **审核依据**：architect_review.md / agent_developer_review.md / fullstack_review.md
> **版本**：v6.0-LITE（精简版）
> **核心原则**：先跑通，再完善；不追求完整，追求可运行
