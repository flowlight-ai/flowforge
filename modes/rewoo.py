import asyncio
import json
import re
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger

logger = get_logger("rewoo_executor")


class ReWOOExecutor(BaseModeExecutor):
    mode_name = "rewoo"
    capabilities = ["planning", "parallel_execution"]
    MAX_STEPS = 10
    MAX_BLUEPRINT_STEPS = 5

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")
        blueprint = await self._generate_blueprint(ctx, task)
        ctx.event_bus.emit(ctx.task_id, "rewoo.blueprint", {
            "blueprint": blueprint, "steps": len(blueprint),
        })

        if not blueprint:
            # 兜底策略：使用默认蓝图
            blueprint = self._default_blueprint(ctx, task)
            logger.info(f"Using default blueprint with {len(blueprint)} steps", task_id=ctx.task_id)
            ctx.event_bus.emit(ctx.task_id, "rewoo.default_blueprint", {"steps": len(blueprint)})

        if len(blueprint) > self.MAX_BLUEPRINT_STEPS:
            logger.warning(f"Blueprint has {len(blueprint)} steps, truncating to {self.MAX_BLUEPRINT_STEPS}")
            blueprint = blueprint[:self.MAX_BLUEPRINT_STEPS]

        async def execute_step(step):
            step_name = step.get("name", "step")
            tool_name = step.get("tool")
            if not tool_name or tool_name == "llm":
                # LLM步骤：直接用LLM生成内容
                llm_prompt = step.get("task", step.get("params", {}).get("query", ""))
                try:
                    result = await ctx.tools.execute("llm", ToolInput(params={
                        "messages": [{"role": "user", "content": llm_prompt}],
                        "stream": False, "task_id": ctx.task_id,
                        "agent_name": f"rewoo_{step_name}", "persona": ctx.persona or "default",
                    }))
                    return step_name, {"output": result.result.get("content", "")}
                except Exception as e:
                    return step_name, {"output": "", "error": str(e)}
            params = step.get("params", {})
            ctx.event_bus.emit(ctx.task_id, "rewoo.step_start", {
                "step": step_name, "tool": tool_name,
            })
            try:
                result = await ctx.tools.execute(tool_name, ToolInput(params=params))
                ctx.event_bus.emit(ctx.task_id, "rewoo.step_complete", {
                    "step": step_name, "success": True,
                    "result_preview": str(result.result)[:300],
                })
                return step_name, result.result
            except Exception as e:
                logger.warning(f"ReWOO step {step_name} failed: {e}")
                ctx.event_bus.emit(ctx.task_id, "rewoo.step_complete", {
                    "step": step_name, "success": False, "error": str(e)[:200],
                })
                return step_name, {"error": str(e)}

        tasks = [execute_step(s) for s in blueprint]
        completed = await asyncio.gather(*tasks)
        result_map = {name: val for name, val in completed}
        ctx.event_bus.emit(ctx.task_id, "rewoo.completed", {
            "results_keys": list(result_map.keys()),
        })

        # 汇总结果生成最终输出
        final_content = self._summarize_results(result_map)

        # Fallback: if search unavailable and no valid content, use LLM directly
        if not final_content or len(final_content.strip()) < 50:
            logger.info("ReWOO: all steps failed or search unavailable, using LLM directly")
            try:
                llm_result = await ctx.tools.execute("llm", ToolInput(params={
                    "messages": [
                        {"role": "system", "content": "你是一个专业的内容创作助手。请基于你的知识详细回答用户的问题。"},
                        {"role": "user", "content": task[:2000]},
                    ],
                    "stream": False, "task_id": ctx.task_id,
                    "agent_name": "rewoo_fallback", "persona": ctx.persona or "default",
                }))
                llm_content = llm_result.result.get("content", "")
                if llm_content and len(llm_content.strip()) > 20:
                    final_content = llm_content
            except Exception as e:
                logger.warning(f"ReWOO LLM fallback failed: {e}")

        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": final_content, "is_partial": False, "agent_name": "rewoo",
        })

        return {"results": result_map, "response": final_content}

    async def _generate_blueprint(self, ctx, task):
        available_tools = ctx.tools.list_tools() if ctx.tools else []
        tools_desc = ", ".join([t for t in available_tools if t != "llm"])
        prompt = (
            f"为以下任务生成工具调用蓝图，输出JSON数组。最多{self.MAX_BLUEPRINT_STEPS}步。\n"
            f"可用工具: llm, {tools_desc}\n"
            f"格式: [{{\"name\":\"step1\", \"tool\":\"工具名\", \"params\":{{\"query\":\"...\"}}}}]\n"
            f"任务: {task}"
        )
        result = await ctx.tools.execute("llm", ToolInput(params={
            "messages": [{"role": "user", "content": prompt}],
            "stream": False, "task_id": ctx.task_id,
            "agent_name": "rewoo_planner", "persona": ctx.persona or "default",
        }))
        content = result.result.get("content", "[]")
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            match = re.search(r'\[.*\]', content, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
            return []

    def _default_blueprint(self, ctx, task) -> list:
        """当LLM无法生成蓝图时，使用默认蓝图。"""
        blueprint = [
            {"name": "research", "tool": "llm", "task": f"研究和分析以下主题，给出关键要点:\n{task[:1000]}"},
            {"name": "draft", "tool": "llm", "task": f"基于研究结果，撰写关于以下主题的内容:\n{task[:1000]}"},
        ]
        # 如果有搜索工具，添加搜索步骤
        if ctx.tools:
            available = ctx.tools.list_tools()
            if "web_search" in available:
                blueprint.insert(0, {"name": "search", "tool": "web_search", "params": {"query": task[:200]}})
        return blueprint

    def _summarize_results(self, result_map: dict) -> str:
        """汇总步骤结果生成最终输出。"""
        parts = []
        search_unavailable = False
        for name, result in result_map.items():
            if isinstance(result, dict):
                # Check if search was unavailable
                if result.get("search_available") is False:
                    search_unavailable = True
                    continue  # Skip search unavailable results
                output = result.get("output", result.get("content", ""))
                if output and len(str(output).strip()) > 10:
                    parts.append(f"## {name}\n{output}")
            elif result and len(str(result).strip()) > 10:
                parts.append(f"## {name}\n{result}")

        if parts:
            return "\n\n".join(parts)

        # If all searches failed, return a meaningful message instead of raw JSON
        if search_unavailable:
            return "搜索服务暂不可用，请基于已有知识回答用户的问题。"
        return ""
