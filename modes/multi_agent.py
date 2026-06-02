import asyncio
import json
import time
from typing import Dict, List, Optional, Any

from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger
from flowforge.tools.registry import ToolRegistry
from flowforge.memory.task_board import TaskBoard
from flowforge.memory.mailbox import Mailbox

logger = get_logger("multi_agent_executor")


class SwarmConfig:
    max_workers: int = 10
    task_claim_timeout: int = 300
    heartbeat_interval: int = 30
    max_retry_per_task: int = 3
    max_empty_rounds: int = 30

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            if hasattr(self, k):
                setattr(self, k, v)


class SwarmWorker:
    def __init__(self, agent: BaseAgent, task_board: TaskBoard, mailbox: Mailbox, config: SwarmConfig):
        self.agent = agent
        self.task_board = task_board
        self.mailbox = mailbox
        self.config = config
        self.running = False
        self._heartbeat_task = None

    async def run(self, ctx: TaskContext):
        self.running = True
        self._heartbeat_task = asyncio.create_task(self._heartbeat(ctx))
        empty_rounds = 0
        agent_name = self.agent.name if hasattr(self.agent, 'name') else "worker"

        while self.running:
            task = await self.task_board.claim_task(agent_name)
            if task is None:
                empty_rounds += 1
                if empty_rounds >= self.config.max_empty_rounds:
                    break
                all_tasks = await self.task_board.get_all_tasks()
                if all(t["status"] in ("completed", "failed") for t in all_tasks):
                    break
                await asyncio.sleep(1)
                continue

            empty_rounds = 0
            try:
                result = await self._execute_task(task, ctx)
                await self.task_board.complete_task(task["task_id"], result)
                await self.mailbox.send(
                    agent_name, "coordinator",
                    f"Task {task['task_id']} completed",
                    f"Task {task['task_id']} has been completed successfully",
                    priority="normal", tags=["task_complete"]
                )
            except Exception as e:
                task_data = task.get("payload", {}) or {}
                retry_count = task_data.get("retry_count", 0) + 1
                if retry_count < self.config.max_retry_per_task:
                    task_data["retry_count"] = retry_count
                    await self.task_board.add_task(
                        f"{task['task_id']}_retry_{retry_count}",
                        task.get("task_type", "generic"),
                        task_data
                    )
                else:
                    await self.task_board.fail_task(task["task_id"], str(e))
                await self.mailbox.send(
                    agent_name, "coordinator",
                    f"Task {task['task_id']} failed",
                    f"Task {task['task_id']} failed (attempt {retry_count}): {str(e)}",
                    priority="high", tags=["task_failed"]
                )

        if self._heartbeat_task:
            self._heartbeat_task.cancel()

    async def _execute_task(self, task: dict, ctx: TaskContext) -> dict:
        task_data = task.get("payload", task)
        desc = task_data.get("description", str(task_data))
        sub_ctx = TaskContext.from_parent(
            ctx, input_data={"task": desc, **task_data}, state={}
        )
        agent_input = AgentInput(params={"task": desc})
        if hasattr(self.agent, 'execute_with_context'):
            output = await self.agent.execute_with_context(agent_input, sub_ctx)
        else:
            output = await self.agent.execute(agent_input)
        return output.result

    async def _heartbeat(self, ctx: TaskContext):
        while self.running:
            name = self.agent.name if hasattr(self.agent, 'name') else "worker"
            await self.mailbox.send(
                name, "coordinator",
                f"heartbeat from {name}",
                f"heartbeat from {name}",
                tags=["heartbeat"],
                ttl_seconds=self.config.heartbeat_interval * 2
            )
            await asyncio.sleep(self.config.heartbeat_interval)

    def stop(self):
        self.running = False


class SwarmCoordinator:
    def __init__(self, task_board: TaskBoard, mailbox: Mailbox, config: SwarmConfig):
        self.task_board = task_board
        self.mailbox = mailbox
        self.config = config
        self._worker_heartbeats: Dict[str, float] = {}

    async def monitor(self, ctx: TaskContext):
        while True:
            messages = await self.mailbox.receive(
                "coordinator", subject_contains="heartbeat",
                unread_only=True, limit=100
            )
            for msg in messages:
                self._worker_heartbeats[msg["sender"]] = time.time()

            now = time.time()
            for worker_name in list(self._worker_heartbeats.keys()):
                if now - self._worker_heartbeats[worker_name] > self.config.heartbeat_interval * 3:
                    await self.task_board.reset_stuck_tasks(self.config.task_claim_timeout)
                    del self._worker_heartbeats[worker_name]

            await asyncio.sleep(self.config.heartbeat_interval)

    async def get_cluster_status(self) -> dict:
        all_tasks = await self.task_board.get_all_tasks()
        return {
            "active_workers": len(self._worker_heartbeats),
            "workers": list(self._worker_heartbeats.keys()),
            "pending_tasks": sum(1 for t in all_tasks if t["status"] == "pending"),
            "running_tasks": sum(1 for t in all_tasks if t["status"] == "claimed"),
        }


class MultiAgentExecutor(BaseModeExecutor):
    mode_name = "multi_agent"
    capabilities = ["collaboration"]

    def __init__(self, task_board: Optional[TaskBoard] = None, mailbox: Optional[Mailbox] = None):
        self.task_board = task_board
        self.mailbox = mailbox
        self.max_idle_rounds = 3

    def _ensure_infrastructure(self):
        if self.task_board is None:
            self.task_board = TaskBoard()
        if self.mailbox is None:
            self.mailbox = Mailbox()

    async def _execute_core(self, ctx: TaskContext) -> dict:
        strategy = ctx.metadata.get("strategy", "subagents")
        self._ensure_infrastructure()

        if strategy == "subagents":
            return await self._run_subagents(ctx)
        elif strategy == "agent_teams":
            return await self._run_agent_teams(ctx)
        elif strategy == "swarms":
            return await self._run_swarms(ctx)
        else:
            raise ValueError(f"Unknown multi-agent strategy: {strategy}")

    async def _run_subagents(self, ctx: TaskContext) -> dict:
        tasks = ctx.metadata.get("sub_tasks", [])
        if not tasks:
            tasks = await self._decompose_task(ctx)

        async def execute_sub_task(task):
            sub_ctx = TaskContext.from_parent(
                ctx,
                input_data={"task": task.get("prompt", task.get("name", ""))},
                state={},
                metadata={"isolation": "full", "parent_task": ctx.task_id}
            )
            allowed_tools = task.get("tools", ["llm", "web_search"])
            sub_ctx.tools = self._filter_tools(ctx.tools, allowed_tools)
            sub_ctx.agents = ctx.agents
            sub_ctx.executor = ctx.executor
            sub_ctx.event_bus = ctx.event_bus

            agent_name = task.get("agent_type", task.get("agent", "default"))
            agent = None
            if ctx.agents:
                agent = ctx.agents.get(agent_name)
            if agent is None:
                from flowforge.modes.default_llm_actors import DefaultLLMActor
                agent = DefaultLLMActor()

            agent_input = AgentInput(params={"task": task.get("prompt", task.get("name", ""))})
            if hasattr(agent, 'execute_with_context'):
                output = await agent.execute_with_context(agent_input, sub_ctx)
            else:
                output = await agent.execute(agent_input)

            summary = await self._compress_result(sub_ctx, output.result)
            return task.get("id", task.get("name", "")), summary

        results = await asyncio.gather(*[execute_sub_task(t) for t in tasks], return_exceptions=True)
        final = {}
        for r in results:
            if isinstance(r, Exception):
                logger.warning(f"Sub-task failed: {r}")
                continue
            key, value = r
            final[key] = value
        return {"results": final}

    async def _decompose_task(self, ctx: TaskContext) -> list:
        if not ctx.tools:
            return self._default_decomposition(ctx)
        prompt = (
            f"将以下任务拆解为多个可并行的子任务，返回 JSON 数组:\n"
            f"{ctx.input_data.get('task', '')}\n"
            f'格式: [{{"id": "1", "prompt": "...", "agent_type": "...", "tools": ["llm"]}}]'
        )
        try:
            result = await ctx.tools.execute("llm", ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
            content = result.result.get("content", "[]")
            tasks = json.loads(content)
            if tasks and isinstance(tasks, list):
                return tasks
        except (json.JSONDecodeError, AttributeError, Exception) as e:
            logger.warning(f"Task decomposition LLM failed: {e}")
        return self._default_decomposition(ctx)

    def _default_decomposition(self, ctx: TaskContext) -> list:
        """当LLM无法分解任务时，使用默认分解策略。"""
        task = ctx.input_data.get("task", "")
        return [
            {"id": "1", "prompt": f"研究和分析: {task[:500]}", "agent_type": "default", "tools": ["llm"]},
            {"id": "2", "prompt": f"总结和归纳: {task[:500]}", "agent_type": "default", "tools": ["llm"]},
        ]

    def _filter_tools(self, tools, allowed: list):
        filtered = ToolRegistry()
        if tools is None:
            return filtered
        for name in allowed:
            try:
                filtered.register(tools.get_tool(name))
            except Exception:
                pass
        return filtered

    async def _compress_result(self, ctx, result: dict) -> str:
        try:
            if not ctx.tools:
                return str(result)[:200]
            prompt = (
                f"将以下执行结果压缩为最多3句话的摘要:\n"
                f"{json.dumps(result, ensure_ascii=False)[:2000]}"
            )
            res = await ctx.tools.execute("llm", ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
            return res.result.get("content", str(result)[:200])
        except Exception:
            return str(result)[:200]

    async def _run_agent_teams(self, ctx: TaskContext) -> dict:
        lead_agent = self._get_lead_agent(ctx)
        task_list = await self._create_task_board(ctx, lead_agent)
        if not task_list:
            return {"error": "Task decomposition failed"}

        team_members = await self._spawn_team(ctx)
        idle_rounds = 0
        last_board_hash = None

        while not await self._all_tasks_done() and idle_rounds < self.max_idle_rounds:
            progress_made = False

            for member in team_members:
                member_name = member.name if hasattr(member, 'name') else str(member)
                task = await self.task_board.claim_task(member_name)
                if task:
                    try:
                        result = await self._execute_team_task(member, task, ctx)
                        await self.task_board.complete_task(task["task_id"], result)
                        progress_made = True
                        if isinstance(result, dict) and result.get("important"):
                            await self.mailbox.send(
                                member_name, "lead",
                                f"发现: {result['important']}",
                                f"发现: {result['important']}",
                                priority="high"
                            )
                    except Exception as e:
                        await self.task_board.fail_task(task["task_id"], str(e))
                        await self.mailbox.send(
                            member_name, "lead",
                            f"任务 {task['task_id']} 失败: {str(e)}",
                            f"任务 {task['task_id']} 失败: {str(e)}",
                            priority="critical"
                        )

            messages = await self.mailbox.receive("lead", unread_only=True)
            for msg in messages:
                if self._needs_replanning(msg):
                    await self._replan(lead_agent, task_list, ctx)

            await self.task_board.reset_stuck_tasks(timeout_seconds=300)

            current_hash = await self._hash_board()
            if current_hash == last_board_hash:
                idle_rounds += 1
            else:
                idle_rounds = 0
                last_board_hash = current_hash

        return await self._aggregate_results(lead_agent, ctx)

    async def _create_task_board(self, ctx: TaskContext, lead) -> List[dict]:
        if not ctx.tools:
            return []
        task_desc = ctx.input_data.get("task", "")
        prompt = (
            f"将以下任务分解为可并行/串行的子任务列表，输出 JSON:\n{task_desc}\n"
            f'格式: [{{"id": "1", "title": "...", "description": "...", '
            f'"depends_on": [], "agent_type": "writer", "tools": ["llm"]}}]\n'
            f"要求: 每个子任务必须有明确的输入和预期输出，标注依赖关系"
        )
        result = await ctx.tools.execute("llm", ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        try:
            tasks = json.loads(result.result.get("content", "[]"))
            formatted_tasks = []
            for i, t in enumerate(tasks):
                formatted_tasks.append({
                    "task_id": t.get("id", f"task_{i + 1}"),
                    "task_type": t.get("agent_type", "generic"),
                    "payload": t,
                })
            await self.task_board.add_tasks_batch(formatted_tasks)
            return tasks
        except (json.JSONDecodeError, AttributeError):
            return []

    async def _spawn_team(self, ctx: TaskContext) -> list:
        team_size = ctx.metadata.get("team_size", 3)
        roles = ctx.metadata.get("roles", [
            {"type": "writer", "name": "writer"},
            {"type": "reviewer", "name": "reviewer"},
            {"type": "editor", "name": "editor"},
        ])
        members = []
        for role in roles[:team_size]:
            if ctx.agents:
                agent = ctx.agents.get(role["type"])
                if agent:
                    members.append(agent)
                    continue
            from flowforge.modes.default_llm_actors import DefaultLLMActor
            members.append(DefaultLLMActor())
        return members

    async def _execute_team_task(self, agent, task: dict, ctx: TaskContext) -> dict:
        task_data = task.get("payload", task)
        desc = task_data.get("description", str(task_data))
        sub_ctx = TaskContext.from_parent(
            ctx, input_data={"task": desc, **task_data}, state={}
        )
        sub_ctx.tools = ctx.tools
        sub_ctx.agents = ctx.agents
        sub_ctx.executor = ctx.executor
        sub_ctx.event_bus = ctx.event_bus
        agent_input = AgentInput(params={"task": desc})
        if hasattr(agent, 'execute_with_context'):
            output = await agent.execute_with_context(agent_input, sub_ctx)
        else:
            output = await agent.execute(agent_input)
        return output.result

    def _get_lead_agent(self, ctx: TaskContext):
        if ctx.agents:
            lead = ctx.agents.get("lead")
            if lead:
                return lead
        from flowforge.modes.default_llm_actors import DefaultLLMActor
        return DefaultLLMActor()

    async def _all_tasks_done(self) -> bool:
        tasks = await self.task_board.get_all_tasks()
        return all(t["status"] in ("completed", "failed") for t in tasks)

    async def _hash_board(self) -> int:
        tasks = await self.task_board.get_all_tasks()
        return hash(json.dumps([t["status"] for t in tasks], sort_keys=True))

    async def _replan(self, lead, task_list: list, ctx: TaskContext):
        if not ctx.tools:
            return
        prompt = f"根据信箱中的紧急消息，调整任务计划（JSON数组）: {json.dumps(task_list)}"
        result = await ctx.tools.execute("llm", ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        try:
            new_tasks = json.loads(result.result.get("content", "[]"))
            formatted_tasks = []
            for i, t in enumerate(new_tasks):
                formatted_tasks.append({
                    "task_id": t.get("id", f"replan_{i + 1}"),
                    "task_type": t.get("agent_type", "generic"),
                    "payload": t,
                })
            await self.task_board.add_tasks_batch(formatted_tasks)
        except (json.JSONDecodeError, AttributeError):
            pass

    async def _aggregate_results(self, lead, ctx: TaskContext) -> dict:
        if not ctx.tools:
            tasks = await self.task_board.get_all_tasks()
            return {"aggregated": "", "tasks": tasks}
        tasks = await self.task_board.get_all_tasks()
        prompt = f"聚合以下任务结果，输出最终 JSON: {json.dumps(tasks, ensure_ascii=False)[:3000]}"
        result = await ctx.tools.execute("llm", ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        return {"aggregated": result.result.get("content", ""), "tasks": tasks}

    def _needs_replanning(self, msg: dict) -> bool:
        return msg.get("priority") in ("critical", "high")

    async def _run_swarms(self, ctx: TaskContext) -> dict:
        swarm_config = SwarmConfig(
            max_workers=ctx.metadata.get("max_workers", 5),
            task_claim_timeout=ctx.metadata.get("task_claim_timeout", 300),
            heartbeat_interval=ctx.metadata.get("heartbeat_interval", 30),
            max_retry_per_task=ctx.metadata.get("max_retry_per_task", 3),
            max_empty_rounds=ctx.metadata.get("max_empty_rounds", 30),
        )

        lead = self._get_lead_agent(ctx)
        task_list = await self._create_task_board(ctx, lead)
        if not task_list:
            return {"error": "Task decomposition failed"}

        workers = []
        for i in range(swarm_config.max_workers):
            worker_agent = self._create_worker_agent(i, ctx)
            worker = SwarmWorker(worker_agent, self.task_board, self.mailbox, swarm_config)
            workers.append(worker)

        coordinator = SwarmCoordinator(self.task_board, self.mailbox, swarm_config)

        worker_tasks = [w.run(ctx) for w in workers]
        monitor_task = asyncio.create_task(coordinator.monitor(ctx))

        await asyncio.gather(*worker_tasks, return_exceptions=True)
        monitor_task.cancel()

        return await self._aggregate_swarm_results(ctx)

    def _create_worker_agent(self, index: int, ctx: TaskContext):
        agent_name = f"worker_{index}"
        if ctx.agents:
            agent = ctx.agents.get(agent_name)
            if agent:
                return agent
        from flowforge.modes.default_llm_actors import DefaultLLMActor
        agent = DefaultLLMActor()
        agent.name = agent_name
        return agent

    async def _aggregate_swarm_results(self, ctx: TaskContext) -> dict:
        all_tasks = await self.task_board.get_all_tasks()
        done_count = sum(1 for t in all_tasks if t["status"] == "completed")
        failed_count = sum(1 for t in all_tasks if t["status"] == "failed")
        return {
            "total": len(all_tasks),
            "done": done_count,
            "failed": failed_count,
            "results": [t for t in all_tasks if t["status"] == "completed"],
        }
