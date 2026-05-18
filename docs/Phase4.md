当前flowforge中的Agent 易犯错、会偷懒、会忘事"，我们引入专家后，给出了如下方案，请帮忙评审。

多 Agent 系统在工程落地中最核心的三个维度：任务分解、协作通信、弹性扩展。这与我们 FlowForge 的“模式即执行器”设计理念高度互补。下面我从 FlowForge 架构的角度，给出具体的融合方案和实施计划。

---

## 一、融合方案概览

我们将方案中的三类策略直接融入 `MultiAgentExecutor`，作为其**内置的执行子模式**。同时，将上下文隔离、共享状态、通信信箱、并发锁等基础设施增强分别纳入核心模块。

| 策略 | 对应 FlowForge 子模式 | 实现位置 | 优先级 |
|------|----------------------|---------|--------|
| **Subagents** | `strategy: "subagents"` | `modes/multi_agent.py` | **P0 – 立即实现** |
| **Agent Teams** | `strategy: "agent_teams"` | `modes/multi_agent.py` | **P1 – Phase 4 实现** |
| **Agent Swarms** | `strategy: "swarms"` | `modes/multi_agent.py` | **P2 – Phase 5 实现** |

基础设施增强：

| 增强项 | 对应模块 | 优先级 |
|--------|---------|--------|
| 上下文隔离（默认重置） | `BaseAgent`, `TaskContext` | P0 |
| 共享任务板（TaskBoard） | `memory/task_board.py`（新增） | P1 |
| 通信信箱（Mailbox） | `memory/mailbox.py`（新增） | P1 |
| 文件锁/乐观锁 Tool | `tools/file_lock.py`（新增） | P1 |
| 三层防御（超时/熔断/自修正） | `executor/defense_layer.py`（新增） | P2 |

---

## 二、立即实施：Subagents 策略（P0）

这个策略完全兼容我们现有的 `MultiAgentExecutor`，只需在 `_execute_core` 中增加一个分支。

### 1. 修改 `MultiAgentExecutor`

```python
# modes/multi_agent.py

class MultiAgentExecutor(BaseModeExecutor):
    mode_name = "multi_agent"
    capabilities = ["collaboration"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        strategy = ctx.metadata.get("strategy", "agent_teams")

        if strategy == "subagents":
            return await self._run_subagents(ctx)
        elif strategy == "agent_teams":
            return await self._run_agent_teams(ctx)
        elif strategy == "swarms":
            return await self._run_swarms(ctx)
        else:
            raise ValueError(f"Unknown multi-agent strategy: {strategy}")

    async def _run_subagents(self, ctx: TaskContext) -> dict:
        """Subagents 模式：无状态、并行、隔离"""
        tasks = ctx.metadata.get("sub_tasks", [])
        if not tasks:
            # 自动拆解任务
            tasks = await self._decompose_task(ctx)

        async def execute_sub_task(task):
            # 每个子任务独立的上下文（关键：上下文隔离）
            sub_ctx = TaskContext.from_parent(
                ctx,
                input_data={"task": task.get("prompt", task.get("name"))},
                state={},  # 空状态，无历史污染
            )
            # 使用 LLM 直接执行，或指定 Agent
            agent = ctx.agents.get(task.get("agent", "default_actor"))
            if agent is None:
                from modes.default_llm_actors import DefaultLLMActor
                agent = DefaultLLMActor()
            agent_input = AgentInput(params={"task": task.get("prompt", task.get("name"))})
            if hasattr(agent, 'execute_with_context'):
                output = await agent.execute_with_context(agent_input, sub_ctx)
            else:
                output = await agent.execute(agent_input)
            # 返回压缩摘要
            summary = await self._summarize(sub_ctx, output.result)
            return task.get("name", task.get("source")), summary

        # 并行执行所有子任务
        results = await asyncio.gather(*[execute_sub_task(t) for t in tasks])
        return {"results": dict(results)}

    async def _summarize(self, ctx, result: dict) -> str:
        llm = ctx.tools.get_tool("llm")
        prompt = f"将以下内容压缩为最多 3 句话的摘要:\n{json.dumps(result, ensure_ascii=False)}"
        res = await llm.execute(ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        return res.result.get("content", "")

    async def _decompose_task(self, ctx: TaskContext) -> list:
        """自动将任务拆解为子任务列表"""
        llm = ctx.tools.get_tool("llm")
        prompt = f"将以下任务拆解为多个可并行的子任务，返回 JSON 数组: \n{ctx.input_data.get('task')}\n格式: [{{\"name\": \"子任务1\", \"prompt\": \"...\", \"agent\": \"...\"}}]"
        res = await llm.execute(ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        import json
        try:
            return json.loads(res.result.get("content", "[]"))
        except:
            return []
```

### 2. SOP 模板中使用

```yaml
# workflows/deep_research.yaml
steps:
  - name: research_multiple_sources
    mode: multi_agent
    strategy: subagents
    sub_tasks:
      - name: "source_baidu"
        prompt: "从百度搜索关于{{topic}}的最新报告"
      - name: "source_arxiv"
        prompt: "从 arXiv 搜索关于{{topic}}的最新论文"
      - name: "source_news"
        prompt: "从新闻源搜索关于{{topic}}的报道"
```

---

## 三、基础设施增强：上下文隔离（P0）

在我们的 `TaskContext.from_parent()` 中，`state` 默认是深拷贝的，已经提供了隔离基础。为了强化 Subagents 的隔离性，我们在创建子上下文时显式传入空状态。

```python
sub_ctx = TaskContext.from_parent(ctx, input_data={"task": "..."}, state={})
```

这确保了子 Agent 不会看到父 Agent 的对话历史，实现真正的“无污染”执行。

---

## 四、基础设施增强：共享任务板 TaskBoard（P1）

`TaskBoard` 为 Agent Teams 和 Swarms 提供状态共享与任务分发能力。我们使用 SQLite 实现（Phase 4 可升级为 Redis）。

```python
# memory/task_board.py
import json
import sqlite3
import time
from typing import Any, Optional

class TaskBoard:
    """多 Agent 共享任务板"""
    def __init__(self, db_path: str = "data/task_board.db"):
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS board (
                id TEXT PRIMARY KEY,
                task TEXT,
                status TEXT DEFAULT 'pending',
                assigned_to TEXT,
                result TEXT,
                created_at REAL,
                updated_at REAL
            )
        """)
        self.conn.commit()

    def add_task(self, task_id: str, task_data: dict):
        self.conn.execute(
            "INSERT OR REPLACE INTO board (id, task, status, created_at) VALUES (?, ?, 'pending', ?)",
            (task_id, json.dumps(task_data), time.time())
        )
        self.conn.commit()

    def claim_task(self, agent_id: str) -> Optional[dict]:
        """原子认领一个待处理任务"""
        row = self.conn.execute(
            "SELECT id, task FROM board WHERE status='pending' ORDER BY created_at LIMIT 1"
        ).fetchone()
        if not row:
            return None
        self.conn.execute(
            "UPDATE board SET status='running', assigned_to=?, updated_at=? WHERE id=? AND status='pending'",
            (agent_id, time.time(), row[0])
        )
        self.conn.commit()
        return {"id": row[0], "task": json.loads(row[1])}

    def complete_task(self, task_id: str, result: dict):
        self.conn.execute(
            "UPDATE board SET status='done', result=?, updated_at=? WHERE id=?",
            (json.dumps(result), time.time(), task_id)
        )
        self.conn.commit()
```

---

## 五、基础设施增强：通信信箱 Mailbox（P1）

`Mailbox` 实现 Agent 间的异步消息传递。

```python
# memory/mailbox.py
import json
import sqlite3

class Mailbox:
    """Agent 间通信信箱"""
    def __init__(self, db_path: str = "data/mailbox.db"):
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT,
                recipient TEXT,
                subject TEXT,
                body TEXT,
                read INTEGER DEFAULT 0,
                created_at TEXT
            )
        """)
        self.conn.commit()

    def send(self, sender: str, recipient: str, subject: str, body: str):
        import datetime
        self.conn.execute(
            "INSERT INTO messages (sender, recipient, subject, body, created_at) VALUES (?, ?, ?, ?, ?)",
            (sender, recipient, subject, body, datetime.datetime.utcnow().isoformat())
        )
        self.conn.commit()

    def receive(self, recipient: str, unread_only: bool = True) -> list:
        q = "SELECT id, sender, subject, body FROM messages WHERE recipient = ?"
        if unread_only:
            q += " AND read = 0"
        rows = self.conn.execute(q, (recipient,)).fetchall()
        # 标记已读
        ids = [r[0] for r in rows]
        if ids:
            self.conn.executemany("UPDATE messages SET read=1 WHERE id=?", [(i,) for i in ids])
            self.conn.commit()
        return [{"sender": r[1], "subject": r[2], "body": r[3]} for r in rows]
```

---

## 六、实施路线图

| 阶段 | 内容 | 产出 |
|------|------|------|
| **Phase 3** (本周) | Subagents 策略 + 上下文隔离 | `MultiAgentExecutor._run_subagents()` |
| **Phase 4** | Agent Teams 策略 + TaskBoard + Mailbox + FileLock Tool | 完整的 Teams 协作模式 |
| **Phase 5** | Swarms 策略 + 三层防御（超时/熔断/自修正） | 去中心化集群 + 自愈能力 |

---

这套融合方案让 FlowForge 从单一的“模式执行引擎”升级为真正的 **多 Agent 操作系统**。Subagents 可立即投入使用，Agent Teams 和 Swarms 为未来大规模分布式 Agent 系统打下基础。下边是我写的方初稿：


## FlowForge v4.0 深度融合 Claude Code 架构的完整方案

---

### 一、Claude Code 架构核心发现

通过对 1,906 个 TypeScript 源文件、51.2 万行代码的深度分析，Claude Code 架构揭示了以下关键设计决策：

**1. Agent Loop 的扁平化设计：TAOR (Think-Act-Observe-Repeat)**
Claude Code 的核心是一个极其"愚蠢"的 while 循环——它不做任何智能决策，只驱动模型调用工具、感知结果、继续循环。所有推理、规划和停止判断全部交由模型自身完成。QueryEngine 有 7 种恢复路径和 10 种终止条件，但这不是显式状态机，而是通过 State 结构体追踪的隐式状态转换。

**2. Harness 的工程化支撑**
512,000 行 TypeScript 代码中，大部分并非 Agent 逻辑，而是围绕 Agent 的"操作基础设施"：权限管理、记忆层、后台任务、IDE 桥接、MCP 管道。这被称为 Harness——"用工具、记忆和编排逻辑将 LLM 包裹在可行动的身体里"。

**3. 深度上下文与记忆管理**
Compressor 系统在上下文达到 92% 利用率时自动触发，将对话摘要写入 Markdown 文档作为项目记忆。四种记忆类型（user/feedback/project/reference）分层存储，突破了 LLM 固定上下文窗口的限制。

**4. 工具生态与安全边界**
仅有约 14 个工具（文件操作、Shell 命令、Web 访问、控制流），但每个工具都经过 Fail-closed 安全设计：默认不可并行、默认非只读、权限默认需要确认。新增能力 = 新增工具，没有"后门"。

**5. 分层多智能体**
Subagents（上下文完全隔离的临时工）→ Agent Teams（独立会话间协作）→ Swarms（去中心化集群），三层递进。核心设计原则：每个子 Agent 都有独立上下文窗口，避免上下文中毒。

---

### 二、针对 FlowForge 的全面融合方案

以下方案覆盖 **Agent 执行循环、记忆系统、工具系统、Multi-Agent 模式、上下文隔离** 五大维度。

#### 2.1 Agent 执行循环：TAOR 化 + 三层防御

**现状问题**：FlowForge 当前的 HybridExecutor 只是简单的"选择模式→执行→返回"，缺乏对 Agent 偷懒、循环、错误的防御机制。

**融合方案**：在 HybridExecutor 中引入 Claude Code 的 TAOR 循环设计和三层防御。

```python
# executor/hybrid_executor.py (增强版)

import asyncio
import time
from typing import Dict, Optional
from core.task_context import TaskContext
from core.errors import ConflictError, FlowForgeError

class HybridExecutor:
    """TAOR 循环 + 三层防御的混合执行器"""
    
    MAX_CONSECUTIVE_IDENTICAL = 3       # 重复内容检测阈值
    MAX_TOOL_CALLS_PER_TASK = 50        # 单任务最大工具调用次数
    TOOL_CALL_TIMEOUT = 120             # 单次工具调用超时（秒）
    REFLEXION_RETRY_COUNT = 2           # 自修正重试次数
    
    def __init__(self, mode_registry, agent_registry, tool_registry, event_bus,
                 task_repo=None, audit_repo=None):
        self.mode_registry = mode_registry
        self.agent_registry = agent_registry
        self.tool_registry = tool_registry
        self.event_bus = event_bus
        self._running_tasks: Dict[str, str] = {}
        self._task_stats: Dict[str, dict] = {}  # 统计信息
        
    async def run(self, context: TaskContext, mode_hint: str = None,
                  _is_substep: bool = False) -> dict:
        """TAOR 循环：Think → Act → Observe → Repeat"""
        persona = context.persona or "default"
        self._task_stats[context.task_id] = {
            "tool_calls": 0,
            "identical_responses": 0,
            "last_response_hash": None,
            "start_time": time.time()
        }
        
        # 模式选择（Think 阶段的一部分）
        mode = mode_hint or context.mode or self.mode_registry.suggest_mode(
            context.input_data.get("task", ""))
        executor = self.mode_registry.get(mode)
        
        # 注入运行时依赖
        context.tools = self.tool_registry
        context.agents = self.agent_registry
        context.executor = self
        context.mode = mode
        
        try:
            self.event_bus.emit(context.task_id, "task.start", {"mode": mode})
            
            # ===== 第一层防御：工具调用超时 =====
            result = await asyncio.wait_for(
                executor.run(context),
                timeout=self.TOOL_CALL_TIMEOUT * 2
            )
            
            # ===== 第二层防御：重复内容检测 =====
            result_hash = self._hash_result(result)
            stats = self._task_stats[context.task_id]
            if result_hash == stats.get("last_response_hash"):
                stats["identical_responses"] += 1
                if stats["identical_responses"] >= self.MAX_CONSECUTIVE_IDENTICAL:
                    self.event_bus.emit(context.task_id, "defense.repetition_detected", {})
                    # 触发自修正循环
                    result = await self._reflexion_retry(context, mode, result)
            stats["last_response_hash"] = result_hash
            
            self.event_bus.emit(context.task_id, "task.completed", {"result": result})
            return result
            
        except asyncio.TimeoutError:
            self.event_bus.emit(context.task_id, "defense.timeout", {})
            # ===== 第三层防御：自修正循环 =====
            return await self._reflexion_retry(context, mode, 
                {"error": "Task timed out", "summary": "执行超时"})
        except Exception as e:
            self.event_bus.emit(context.task_id, "task.error", {"error": str(e)})
            return await self._reflexion_retry(context, mode,
                {"error": str(e), "summary": f"执行异常: {str(e)[:200]}"})
    
    async def _reflexion_retry(self, context, mode, last_result):
        """自修正循环：使用 Reflexion 模式分析失败原因后重试"""
        for attempt in range(self.REFLEXION_RETRY_COUNT):
            self.event_bus.emit(context.task_id, "defense.reflexion_retry", 
                              {"attempt": attempt + 1})
            # 注入失败分析 prompt
            context.input_data["_last_error"] = last_result
            context.input_data["_retry_attempt"] = attempt + 1
            
            executor = self.mode_registry.get("reflexion")
            result = await executor.run(context)
            
            # 检查是否仍有问题
            if not self._has_error(result):
                return result
        
        return {"error": "All retry attempts failed", "last_result": last_result}
    
    def _hash_result(self, result: dict) -> int:
        return hash(str(result))
    
    def _has_error(self, result: dict) -> bool:
        return "error" in result or result.get("score", 1.0) < 0.5
```

#### 2.2 记忆系统：分层压缩 + 任务检查点

**现状问题**：FlowForge 的 Memory 模块只有基本 CRUD，缺乏 Claude Code 那种"上下文压缩"和"经验沉淀"能力。

**融合方案**：重构 MemoryManager，引入上下文压缩器和检查点机制。

```python
# memory/compressor.py (新增)

class ContextCompressor:
    """上下文压缩器：在上下文接近窗口限制时自动触发压缩"""
    
    COMPRESSION_THRESHOLD = 0.85  # 上下文利用率阈值
    
    def __init__(self, llm_client):
        self.llm = llm_client
    
    async def compress(self, messages: list, context: TaskContext) -> dict:
        """将长对话压缩为结构化记忆摘要"""
        # 1. 计算当前上下文利用率
        total_chars = sum(len(str(m)) for m in messages)
        estimated_tokens = total_chars // 4
        utilization = estimated_tokens / 200000  # 假设 200K 窗口
        
        if utilization < self.COMPRESSION_THRESHOLD:
            return {"compressed": False, "messages": messages}
        
        # 2. 分类消息：决策 vs 临时
        decisions = []
        temporary = []
        for msg in messages:
            if self._is_decision(msg):
                decisions.append(msg)
            else:
                temporary.append(msg)
        
        # 3. LLM 压缩临时消息
        summary = await self._summarize_temporary(temporary, context)
        
        # 4. 保留决策 + 压缩摘要
        compressed = decisions + [{"role": "system", "content": f"[上下文摘要] {summary}"}]
        
        # 5. 存储到长期记忆
        await context.memory.save("long_term", f"compression_{context.task_id}", {
            "original_count": len(temporary),
            "compressed_summary": summary,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        return {"compressed": True, "messages": compressed, "summary": summary}
    
    def _is_decision(self, msg: dict) -> bool:
        """判断消息是否包含关键决策"""
        content = str(msg.get("content", ""))
        decision_keywords = ["设计决策", "架构选择", "接口定义", "修复方案", "最终采用"]
        return any(kw in content for kw in decision_keywords)
    
    async def _summarize_temporary(self, messages: list, context) -> str:
        prompt = f"将以下 Agent 执行过程压缩为最多 5 句话的摘要，保留关键操作和结果:\n{str(messages[:20])}"
        result = await self.llm.chat([{"role": "user", "content": prompt}])
        return result.get("content", "")[:500]
```

```python
# memory/checkpoint.py (新增)

import json
import sqlite3
import time
from typing import Any, Optional

class CheckpointManager:
    """任务检查点管理器：支持暂停/恢复/回滚"""
    
    def __init__(self, db_path: str = "data/checkpoints.db"):
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS checkpoints (
                id TEXT PRIMARY KEY,
                task_id TEXT,
                state_json TEXT,
                messages_json TEXT,
                created_at REAL,
                label TEXT
            )
        """)
        self.conn.commit()
    
    def save(self, task_id: str, state: dict, messages: list, label: str = "") -> str:
        checkpoint_id = f"{task_id}_{int(time.time())}"
        self.conn.execute(
            "INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?, ?)",
            (checkpoint_id, task_id, json.dumps(state), 
             json.dumps(messages), time.time(), label)
        )
        self.conn.commit()
        return checkpoint_id
    
    def restore(self, task_id: str, checkpoint_id: Optional[str] = None) -> dict:
        if checkpoint_id:
            row = self.conn.execute(
                "SELECT state_json, messages_json FROM checkpoints WHERE id=?",
                (checkpoint_id,)
            ).fetchone()
        else:
            row = self.conn.execute(
                "SELECT state_json, messages_json FROM checkpoints WHERE task_id=? ORDER BY created_at DESC LIMIT 1",
                (task_id,)
            ).fetchone()
        if row:
            return {"state": json.loads(row[0]), "messages": json.loads(row[1])}
        return {}
    
    def list_checkpoints(self, task_id: str) -> list:
        rows = self.conn.execute(
            "SELECT id, label, created_at FROM checkpoints WHERE task_id=? ORDER BY created_at",
            (task_id,)
        ).fetchall()
        return [{"id": r[0], "label": r[1], "created_at": r[2]} for r in rows]
```

#### 2.3 工具系统：Fail-closed 安全设计

**现状问题**：FlowForge 的工具没有统一的安全边界，Agent 可能执行危险操作。

**融合方案**：所有工具增加权限标记和安全检查。

```python
# tools/secure_registry.py (增强 ToolRegistry)

class SecureToolRegistry(ToolRegistry):
    """安全增强的工具注册表"""
    
    def __init__(self):
        super().__init__()
        self._permission_cache: Dict[str, bool] = {}
    
    async def execute(self, name: str, input: ToolInput, 
                      context: TaskContext = None,
                      require_approval: bool = True) -> ToolOutput:
        tool = self.get_tool(name)
        
        # 1. 工具能力检查
        if hasattr(tool, 'is_readonly') and tool.is_readonly():
            pass  # 只读工具，无需审批
        elif hasattr(tool, 'is_dangerous') and tool.is_dangerous():
            if require_approval and context:
                self.event_bus.emit(context.task_id, "permission.requested", 
                                  {"tool": name, "params": input.params})
                # 等待人工审批（通过 TaskContext 中的回调）
                if hasattr(context, '_approval_callback'):
                    approved = await context._approval_callback(name, input.params)
                    if not approved:
                        return ToolOutput(result={}, error="User denied permission")
        
        # 2. 并发安全检查
        if not getattr(tool, 'is_concurrency_safe', False):
            if self._is_tool_running(name):
                return ToolOutput(result={}, error=f"Tool '{name}' is not concurrency safe")
        
        # 3. 执行工具
        return await super().execute(name, input)
```

#### 2.4 Multi-Agent：Teams 策略完整实现

```python
# modes/multi_agent_teams.py (新增)

import asyncio
from memory.task_board import TaskBoard
from memory.mailbox import Mailbox

class AgentTeamsStrategy:
    """Agent Teams 策略：共享任务板 + 信箱通信 + 三层防御"""
    
    def __init__(self):
        self.task_board = TaskBoard()
        self.mailbox = Mailbox()
        self.max_team_size = 10
        self.max_idle_rounds = 3     # 最大空闲轮次（防止死循环）
        self.identical_response_limit = 3  # 重复响应限制（防止卡住）
    
    async def execute(self, ctx: TaskContext, agents: dict) -> dict:
        # 1. Lead Agent 创建任务列表
        lead = agents.get("lead") or self._get_default_lead(ctx)
        task_list = await self._create_task_board(ctx, lead)
        
        # 2. 启动团队
        team = self._spawn_team(ctx, agents, task_list)
        
        # 3. 协作循环（带防御机制）
        idle_rounds = 0
        last_result_hash = None
        
        while not self._all_tasks_done(task_list) and idle_rounds < self.max_idle_rounds:
            progress_made = False
            
            for member in team:
                # 认领任务
                task = self.task_board.claim_task(member.name)
                if task:
                    result = await self._execute_task(member, task, ctx)
                    self.task_board.complete_task(task["id"], result)
                    
                    # 检查是否有重要发现需要通知 Lead
                    if result.get("important"):
                        self.mailbox.send(member.name, "lead", 
                                        f"发现: {result['important']}")
                    progress_made = True
            
            # 检查 Lead 的信箱
            messages = self.mailbox.receive("lead")
            for msg in messages:
                if self._needs_replanning(msg):
                    await self._replan(lead, task_list, ctx)
            
            # 防御：检测进度
            current_hash = self._hash_task_board(task_list)
            if current_hash == last_result_hash:
                idle_rounds += 1
            else:
                idle_rounds = 0
                last_result_hash = current_hash
        
        # 4. 聚合结果
        return await self._aggregate_results(lead, task_list, ctx)
    
    async def _create_task_board(self, ctx, lead) -> list:
        """Lead Agent 分解任务并发布到任务板"""
        task_desc = ctx.input_data.get("task", "")
        prompt = f"""将以下任务分解为可并行/串行的子任务列表，输出 JSON:
{task_desc}
格式: [{{"id": "1", "title": "...", "description": "...", "depends_on": [], "agent_type": "writer"}}]
要求:
1. 每个子任务必须有明确的输入和预期输出
2. 标注任务间的依赖关系
3. 每个任务指定最合适的 Agent 类型"""
        
        llm = ctx.tools.get_tool("llm")
        result = await llm.execute(ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        import json
        tasks = json.loads(result.result.get("content", "[]"))
        for task in tasks:
            self.task_board.add_task(task["id"], task)
        return tasks
```

#### 2.5 Subagents：上下文完全隔离架构

```python
# modes/subagent.py (新增)

class SubAgentExecutor:
    """Subagent 执行器：每个子任务完全独立的上下文窗口"""
    
    async def execute(self, ctx: TaskContext, sub_tasks: list) -> dict:
        """
        为每个子任务创建独立上下文窗口，并行执行后聚合摘要。
        这是 Claude Code 最核心的设计模式：保持主上下文干净。
        """
        async def run_in_isolation(task):
            # 创建完全隔离的子上下文（无历史、无污染）
            isolated_ctx = TaskContext.from_parent(
                ctx,
                input_data={"task": task.get("prompt", "")},
                state={},                    # 空状态
                metadata={
                    "isolation": "full",     # 标记为完全隔离
                    "parent_task": ctx.task_id
                }
            )
            
            # 限制工具访问
            allowed_tools = task.get("tools", ["llm", "web_search"])
            isolated_ctx.tools = self._filter_tools(ctx.tools, allowed_tools)
            
            # 执行
            agent = self._get_agent(ctx, task.get("agent_type", "default"))
            result = await agent.execute_with_context(
                AgentInput(params={"task": task.get("prompt", "")}),
                isolated_ctx
            )
            
            # 压缩结果
            summary = await self._compress_result(isolated_ctx, result.result)
            return {"task_id": task.get("id", ""), "summary": summary}
        
        # 并行执行所有子任务
        results = await asyncio.gather(*[run_in_isolation(t) for t in sub_tasks])
        return {"sub_results": results}
    
    def _filter_tools(self, tools, allowed: list):
        """过滤工具：只暴露子任务需要的工具"""
        filtered = ToolRegistry()
        for name in allowed:
            try:
                filtered.register(tools.get_tool(name))
            except KeyError:
                pass
        return filtered
    
    async def _compress_result(self, ctx, result: dict) -> str:
        """将子任务结果压缩为结构化摘要（减少上下文污染）"""
        llm = ctx.tools.get_tool("llm")
        prompt = f"""将以下执行结果压缩为结构化摘要:
{json.dumps(result, ensure_ascii=False)[:3000]}

输出 JSON 格式:
{{"status": "success/partial/failed", "key_findings": ["发现1", "发现2"], "files_changed": [], "next_steps": []}}"""
        
        res = await llm.execute(ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        import json
        try:
            return json.loads(res.result.get("content", "{}"))
        except:
            return {"status": "unknown", "key_findings": [str(result)[:500]]}
```

---

### 三、SOP 模板使用示例

```yaml
# workflows/defense_article.yaml (新增：带三层防御的内容创作流程)
name: "defense_article"
version: "1.0"
description: "防偷懒、防遗忘、防犯错的文章创作流程"

# 全局防御配置
defense:
  max_tool_calls: 50
  tool_timeout: 120
  repetition_limit: 3
  reflexion_retries: 2
  checkpoint_enabled: true

steps:
  - name: "research_sources"
    mode: multi_agent
    strategy: subagents      # 使用 Subagents 策略并行检索
    sub_tasks:
      - id: "search_1"
        prompt: "搜索关于{{topic}}的最新报道"
        tools: ["web_search"]
      - id: "search_2"  
        prompt: "搜索关于{{topic}}的学术研究"
        tools: ["helixrag_search"]
      - id: "search_3"
        prompt: "搜索关于{{topic}}的社交媒体讨论"
        tools: ["web_search"]
    
  - name: "collaborative_writing"
    mode: multi_agent
    strategy: agent_teams    # 使用 Teams 策略协作写作
    team_size: 3
    roles:
      - type: "writer"
        prompt: "基于素材撰写初稿"
      - type: "reviewer"
        prompt: "检查事实准确性和逻辑一致性"
      - type: "editor"
        prompt: "优化标题和段落结构"
    
  - name: "quality_check"
    mode: reflexion           # 使用 Reflexion 自修正
    quality_threshold: 0.85
    max_iterations: 3
    
  - name: "human_review"
    human: true
    checkpoint: true          # 审核前自动保存检查点
    
  - name: "publish"
    agent: "publishing"
    mode: plan_execute
```

---

### 四、总结

这套融合方案从五大维度解决了"Agent 易犯错、会偷懒、会忘事"的问题：

| 问题 | 根因 | 融合方案 | 来源 |
|------|------|---------|------|
| **易犯错** | 无防御机制 | TAOR 循环 + 三层防御（超时/重复检测/自修正） | Claude Code Agent Loop |
| **会偷懒** | 上下文膨胀导致注意力分散 | Subagents 完全隔离 + 上下文压缩（92% 阈值触发） | Compressor wU2 系统 |
| **会忘事** | 缺乏长期记忆和检查点 | 分层记忆（4种类型）+ CheckpointManager | Claude Code Memory 系统 |
| **协同混乱** | 多 Agent 无结构化通信 | Agent Teams 共享任务板 + Mailbox + 重复检测 | Agent Teams 架构 |
| **安全风险** | 工具无权限边界 | Fail-closed 工具注册表 + 并发安全检查 | Claude Code 工具设计 |