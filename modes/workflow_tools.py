"""Workflow tool execution module.

Handles tool/agent execution, function schema building, and search fallbacks.
Extracted from WorkflowExecutor to reduce God Object complexity.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from flowforge.core.base_agent import AgentInput
from flowforge.core.base_tool import BaseTool, ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.tracing import get_logger

if TYPE_CHECKING:
    from flowforge.modes.workflow_executor import WorkflowExecutor

logger = get_logger("workflow_tools")


class ToolHandler:
    """工具调用处理器 - 负责工具/Agent执行、函数Schema构建和搜索回退"""

    def __init__(self, executor: WorkflowExecutor) -> None:
        self._executor = executor

    async def execute_tool_or_agent(self, ctx, name: str, arguments: dict) -> dict:
        logger.info(f"[ToolOrAgent] >>> Calling: name={name}, args_keys={list(arguments.keys()) if isinstance(arguments, dict) else 'N/A'}", task_id=ctx.task_id)

        if ctx.agents:
            logger.debug(f"[ToolOrAgent] Searching AgentRegistry for: {name}")
            agent = ctx.agents.get(name)
            if agent:
                try:
                    task_desc = arguments.get("task", arguments.get("query", arguments.get("intent", str(arguments))))
                    agent_input = AgentInput(params={"task": task_desc, **arguments})
                    ctx.event_bus.emit(ctx.task_id, "agent.start", {"agent_name": name, "task": task_desc[:200]})
                    result = await agent.execute_with_context(agent_input, ctx)
                    ctx.event_bus.emit(ctx.task_id, "agent.end", {"agent_name": name, "success": True})
                    _r = {"success": True, "result": result.result}
                    logger.info(f"[ToolOrAgent] <<< Result: name={name}, success={_r.get('success')}, has_error={'error' in _r}", task_id=ctx.task_id)
                    return _r
                except NotImplementedError:
                    try:
                        agent_input = AgentInput(params={"task": task_desc, **arguments})
                        result = await agent.execute(agent_input)
                        ctx.event_bus.emit(ctx.task_id, "agent.end", {"agent_name": name, "success": True})
                        _r = {"success": True, "result": result.result}
                        logger.info(f"[ToolOrAgent] <<< Result: name={name}, success={_r.get('success')}, has_error={'error' in _r}", task_id=ctx.task_id)
                        return _r
                    except Exception as e:
                        ctx.event_bus.emit(ctx.task_id, "agent.end", {"agent_name": name, "success": False, "error": str(e)[:200]})
                        _r = {"success": False, "error": str(e)[:300]}
                        logger.info(f"[ToolOrAgent] <<< Result: name={name}, success={_r.get('success')}, has_error={'error' in _r}", task_id=ctx.task_id)
                        return _r
                except Exception as e:
                    logger.warning(f"Agent {name} execution failed: {e}")
                    error_msg = str(e) if str(e) else type(e).__name__
                    ctx.event_bus.emit(ctx.task_id, "agent.end", {"agent_name": name, "success": False, "error": error_msg[:200]})
                    _r = {"success": False, "error": error_msg[:300]}
                    logger.info(f"[ToolOrAgent] <<< Result: name={name}, success={_r.get('success')}, has_error={'error' in _r}", task_id=ctx.task_id)
                    return _r

        if ctx.tools:
            logger.debug(f"[ToolOrAgent] Searching ToolRegistry for: {name}")
            try:
                tool = ctx.tools.get_tool(name)
                if isinstance(tool, BaseTool):
                    tool_input = ToolInput(params=arguments)
                    tool_output = await tool.execute(tool_input)
                    _r = {"success": True, "result": tool_output.result}
                    logger.info(f"[ToolOrAgent] <<< Result: name={name}, success={_r.get('success')}, has_error={'error' in _r}", task_id=ctx.task_id)
                    return _r
                else:
                    result = await tool.execute(arguments)
                    _r = {"success": True, "result": result}
                    logger.info(f"[ToolOrAgent] <<< Result: name={name}, success={_r.get('success')}, has_error={'error' in _r}", task_id=ctx.task_id)
                    return _r
            except Exception as e:
                logger.debug(f"Tool {name} execution in ToolRegistry failed: {e}, trying PluginRegistry")

        # Fallback: try PluginRegistry via TaskContext (DI, no app-layer import)
        logger.debug(f"[ToolOrAgent] Searching PluginRegistry for: {name}")
        plugin_registry = getattr(ctx, 'plugin_registry', None)
        if plugin_registry:
            try:
                plugin = plugin_registry.get_plugin(name)
                if plugin:
                    result = await plugin_registry.execute(name, arguments)
                    _r = {"success": True, "result": result}
                    logger.info(f"[ToolOrAgent] <<< Result: name={name}, success={_r.get('success')}, has_error={'error' in _r}", task_id=ctx.task_id)
                    return _r
            except Exception as e:
                logger.debug(f"Plugin {name} not found in PluginRegistry either: {e}")

        result = {"success": False, "error": f"Unknown tool/agent: {name}"}
        logger.info(f"[ToolOrAgent] <<< Result: name={name}, success={result.get('success')}, has_error={'error' in result}", task_id=ctx.task_id)
        return result

    def build_function_schemas(self, ctx) -> list:
        schemas = []
        if ctx.tools:
            try:
                for name in ctx.tools.list_tools():
                    if name in ("llm", "shell_command"):
                        continue
                    try:
                        tool = ctx.tools.get_tool(name)
                        desc = getattr(tool, 'description', '') or name
                        params = getattr(tool, 'parameters_schema', None) or {
                            "type": "object",
                            "properties": {"query": {"type": "string", "description": "查询内容"}},
                        }
                        schemas.append({
                            "type": "function",
                            "function": {"name": name, "description": desc[:200], "parameters": params},
                        })
                    except Exception:
                        continue
            except Exception:
                pass
        if len(schemas) > 8:
            schemas = schemas[:8]
        return schemas

    async def llm_web_search_fallback(self, ctx, intent: str, model_hint: str, persona: str) -> dict:
        search_prompt = get_prompt("tools.web_search.search_prompt", topic=intent)
        search_system = get_prompt("tools.web_search.search_system")
        try:
            content = await self._executor._call_llm(ctx, [
                {"role": "system", "content": search_system},
                {"role": "user", "content": search_prompt},
            ], "web/chat", "web_search_fallback", persona)
            if not content or not content.strip():
                return {}
            import json as _json
            match = re.search(r'\{[\s\S]*\}', content)
            if match:
                try:
                    data = _json.loads(match.group())
                    results = data.get("results", [])
                    if results:
                        return {"success": True, "result": {"results": results, "source": "llm_web_search"}}
                except _json.JSONDecodeError:
                    pass
            return {"success": True, "result": {"results": [{"title": f"LLM搜索: {intent[:30]}", "url": "", "content": content[:1000], "source_type": "llm_web_search"}], "source": "llm_web_search"}}
        except Exception as e:
            logger.warning(f"LLM WebChat search fallback failed: {e}", task_id=ctx.task_id)
            return {}
