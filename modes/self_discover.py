import json
import re
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("self_discover_executor")


class SelfDiscoverExecutor(BaseModeExecutor):
    mode_name = "self_discover"
    capabilities = ["meta_cognition"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")

        # Phase 1: Select — 选择最合适的思维框架
        select_result = await self._select(ctx, task)
        recommended_mode = select_result.get("mode", "workflow")
        reasoning = select_result.get("reasoning", "")

        ctx.event_bus.emit(ctx.task_id, "self_discover.select", {
            "recommended_mode": recommended_mode, "reasoning": reasoning,
        })

        # Phase 2: Adapt — 根据任务调整框架参数
        adapt_result = await self._adapt(ctx, task, recommended_mode)
        adapted_params = adapt_result.get("params", {})
        adapted_prompt = adapt_result.get("prompt", task)

        ctx.event_bus.emit(ctx.task_id, "self_discover.adapt", {
            "mode": recommended_mode, "params": adapted_params,
        })

        # Phase 3: Execute — 使用调整后的框架执行任务
        execution_result = await self._execute(ctx, task, recommended_mode, adapted_params, adapted_prompt)

        ctx.event_bus.emit(ctx.task_id, "self_discover.execute", {
            "mode": recommended_mode, "result_preview": str(execution_result)[:300],
        })

        # 构建最终输出
        if isinstance(execution_result, dict):
            extracted_text = ""
            for key in ("content", "draft", "text", "output", "response", "answer"):
                val = execution_result.get(key)
                if val and isinstance(val, str) and len(val.strip()) > 10:
                    extracted_text = val
                    break
                if isinstance(val, dict):
                    for k2 in ("content", "draft", "text", "output"):
                        v2 = val.get(k2)
                        if v2 and isinstance(v2, str) and len(v2.strip()) > 10:
                            extracted_text = v2
                            break
                    if extracted_text:
                        break
            if extracted_text:
                final_content = extracted_text
            else:
                final_content = json.dumps(execution_result, ensure_ascii=False)
        else:
            final_content = execution_result if isinstance(execution_result, str) else json.dumps(execution_result, ensure_ascii=False)
        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": final_content, "is_partial": False, "agent_name": "self_discover",
        })

        return {
            "recommended_mode": recommended_mode,
            "reasoning": reasoning,
            "adapted_params": adapted_params,
            "execution_result": execution_result,
            "content": final_content,
        }

    async def _select(self, ctx: TaskContext, task: str) -> dict:
        """Phase 1: 选择最合适的思维框架。"""
        prompt = (
            f"分析以下任务，推荐最合适的思维框架或执行模式。\n"
            f"可选模式: react(推理+工具), reflexion(迭代优化), workflow(流水线), "
            f"rewoo(规划+并行), graph_of_thoughts(多角度推理)\n"
            f'输出 JSON: {{"mode": "模式名", "reasoning": "选择理由"}}\n'
            f"任务: {task[:2000]}"
        )
        result = await ctx.tools.execute("llm", ToolInput(params={
            "messages": [{"role": "user", "content": prompt}],
            "stream": False, "task_id": ctx.task_id,
            "agent_name": "self_discover_select", "persona": ctx.persona or "default",
        }))
        content = result.result.get("content", "{}")
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
                return {"mode": data.get("mode", "workflow"), "reasoning": data.get("reasoning", "")}
            except json.JSONDecodeError:
                pass
        return {"mode": "workflow", "reasoning": "auto"}

    async def _adapt(self, ctx: TaskContext, task: str, mode: str) -> dict:
        """Phase 2: 根据任务调整框架参数。"""
        prompt = (
            f"为以下任务调整'{mode}'执行模式的参数，使其更适合任务需求。\n"
            f'输出 JSON: {{"params": {{"key": "value"}}, "prompt": "调整后的任务提示"}}\n'
            f"任务: {task[:2000]}"
        )
        result = await ctx.tools.execute("llm", ToolInput(params={
            "messages": [{"role": "user", "content": prompt}],
            "stream": False, "task_id": ctx.task_id,
            "agent_name": "self_discover_adapt", "persona": ctx.persona or "default",
        }))
        content = result.result.get("content", "{}")
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
                return {"params": data.get("params", {}), "prompt": data.get("prompt", task)}
            except json.JSONDecodeError:
                pass
        return {"params": {}, "prompt": task}

    async def _execute(self, ctx: TaskContext, task: str, mode: str, params: dict, adapted_prompt: str) -> dict:
        """Phase 3: 使用推荐的模式执行任务。"""
        try:
            from flowforge.executor.mode_registry import mode_registry
            executor_cls = mode_registry.get(mode)
            if executor_cls and executor_cls.mode_name != "self_discover":
                executor = executor_cls()
                sub_ctx = TaskContext.from_parent(
                    ctx,
                    input_data={"task": adapted_prompt, **params},
                    state={},
                    metadata={**ctx.metadata, **params},
                )
                sub_ctx.tools = ctx.tools
                sub_ctx.agents = ctx.agents
                sub_ctx.executor = ctx.executor
                sub_ctx.event_bus = ctx.event_bus
                result = await executor._execute_core(sub_ctx)
                return result
        except Exception as e:
            logger.warning(f"Self-Discover execute with mode '{mode}' failed: {e}, falling back to direct LLM", task_id=ctx.task_id)

        # 回退：直接用LLM执行
        result = await ctx.tools.execute("llm", ToolInput(params={
            "messages": [{"role": "user", "content": adapted_prompt[:4000]}],
            "stream": False, "task_id": ctx.task_id,
            "agent_name": "self_discover_execute", "persona": ctx.persona or "default",
        }))
        content = result.result.get("content", "")
        return {"output": content}
