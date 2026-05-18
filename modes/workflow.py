import asyncio
import json
import re
import time
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_agent import AgentInput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.core.errors import WorkflowRecursionError
from flowforge.core.tracing import get_logger
from flowforge.core.prompt_manager import get_prompt

logger = get_logger("workflow_executor")

TASK_TIMEOUT_SECONDS = 90


class WorkflowExecutor(BaseModeExecutor):
    mode_name = "workflow"
    capabilities = ["orchestration", "planning"]

    DEFAULT_DEFENSE = {
        "max_tool_calls": 50,
        "tool_timeout": 120,
        "repetition_limit": 3,
        "reflexion_retries": 2,
        "checkpoint_enabled": True,
    }

    async def _execute_core(self, ctx: TaskContext) -> dict:
        sop_steps = ctx.metadata.get("sop_steps", [])
        context_data = ctx.input_data.copy()
        depth = ctx.metadata.get("_workflow_depth", 0)
        if depth >= 3:
            raise WorkflowRecursionError("Max workflow depth exceeded")

        if not sop_steps:
            interaction_mode = ctx.interaction_mode
            if interaction_mode == "normal":
                return await self._execute_normal_chat(ctx, context_data)
            elif interaction_mode == "auto":
                return await self._execute_intelligent_chat(ctx, context_data, is_auto=True)
            else:
                return await self._execute_intelligent_chat(ctx, context_data, is_auto=False)

        return await self._execute_sop_steps(ctx, sop_steps, context_data, depth)

    async def _execute_sop_steps(self, ctx, sop_steps, context_data, depth):
        defense_config = {**self.DEFAULT_DEFENSE, **ctx.metadata.get("defense", {})}
        ctx.metadata["_defense"] = defense_config

        if defense_config.get("checkpoint_enabled") and hasattr(ctx, 'checkpoint') and ctx.checkpoint:
            await self._save_checkpoint(ctx, context_data)

        for step in sop_steps:
            if step.get("prompt"):
                step["prompt"] = self._render_template(step["prompt"], context_data)

            step_name = step["name"]
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                "step": step_name, "label": step_name,
                "order": 1, "total": len(sop_steps),
            })

            if step.get("human"):
                auto_approve = ctx.metadata.get("auto_approve_review", False)
                if not auto_approve:
                    await self._pause_for_review(ctx, step)
                continue

            if step.get("parallel_group"):
                results = await self._execute_parallel(ctx, step["parallel_group"], context_data)
                context_data.update(results)
                continue

            agent_name = step.get("agent")
            if agent_name and ctx.agents:
                agent = ctx.agents.get(agent_name)
                if agent:
                    merged_data = {**ctx.state, **context_data}
                    try:
                        agent_input = AgentInput(params=merged_data)
                        agent_output = await agent.execute_with_context(agent_input, ctx)
                        context_data.update(agent_output.result)
                        if step.get("output") and step["output"] not in agent_output.result:
                            context_data[step["output"]] = agent_output.result
                        if hasattr(agent_output, 'state_updates') and agent_output.state_updates:
                            ctx.state.update(agent_output.state_updates)
                            context_data.update(agent_output.state_updates)
                    except Exception as e:
                        on_error = step.get("on_error", "abort")
                        if on_error == "skip":
                            continue
                        elif on_error == "retry":
                            retry_count = min(step.get("retry_count", 1), 3)
                            for i in range(retry_count):
                                try:
                                    await asyncio.sleep(step.get("retry_delay", 2))
                                    merged_data = {**ctx.state, **context_data}
                                    agent_input = AgentInput(params=merged_data)
                                    agent_output = await agent.execute_with_context(agent_input, ctx)
                                    context_data.update(agent_output.result)
                                    break
                                except Exception:
                                    if i == retry_count - 1:
                                        raise
                        elif on_error == "reflexion_retry":
                            reflexion_ctx = TaskContext.from_parent(
                                ctx,
                                input_data={"task": f"分析步骤'{step['name']}'失败原因并修正: {str(e)}"},
                                metadata={"mode": "reflexion"}
                            )
                            reflexion_result = await ctx.executor.run(reflexion_ctx, mode_hint="reflexion", _is_substep=True)
                            context_data["_reflexion_fix"] = reflexion_result
                            retry_count = step.get("retry_count", 2)
                            for i in range(retry_count):
                                try:
                                    merged_data = {**ctx.state, **context_data}
                                    agent_input = AgentInput(params=merged_data)
                                    agent_output = await agent.execute_with_context(agent_input, ctx)
                                    context_data.update(agent_output.result)
                                    if step.get("output") and step["output"] not in agent_output.result:
                                        context_data[step["output"]] = agent_output.result
                                    if hasattr(agent_output, 'state_updates') and agent_output.state_updates:
                                        ctx.state.update(agent_output.state_updates)
                                        context_data.update(agent_output.state_updates)
                                    break
                                except Exception:
                                    if i == retry_count - 1:
                                        raise
                        else:
                            raise
                    ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step_name})
                    continue

            mode = step.get("mode", "plan_execute")
            if mode == "workflow":
                raise ValueError("Nested workflow mode is forbidden")

            sub_ctx = TaskContext.from_parent(ctx, input_data=context_data,
                                              metadata={"_workflow_depth": depth + 1})
            try:
                sub_result = await ctx.executor.run(sub_ctx, mode_hint=mode, _is_substep=True)
                context_data[step.get("output", step_name)] = sub_result
            except Exception as e:
                on_error = step.get("on_error", "abort")
                if on_error == "skip":
                    continue
                elif on_error == "reflexion_retry":
                    reflexion_ctx = TaskContext.from_parent(
                        ctx,
                        input_data={"task": f"分析步骤'{step['name']}'失败原因并修正: {str(e)}"},
                        metadata={"mode": "reflexion"}
                    )
                    reflexion_result = await ctx.executor.run(reflexion_ctx, mode_hint="reflexion", _is_substep=True)
                    context_data["_reflexion_fix"] = reflexion_result
                    retry_count = step.get("retry_count", 2)
                    for i in range(retry_count):
                        try:
                            sub_result = await ctx.executor.run(sub_ctx, mode_hint=step.get("mode"), _is_substep=True)
                            context_data[step.get("output", step_name)] = sub_result
                            break
                        except Exception:
                            if i == retry_count - 1:
                                raise
                else:
                    raise

            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step_name})

        return context_data

    async def _execute_normal_chat(self, ctx: TaskContext, context_data: dict) -> dict:
        intent = context_data.get("task", context_data.get("intent", ""))
        model_hint = ctx.metadata.get("model", "auto")
        persona = ctx.persona or "default"

        ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
            "step": "normal_chat", "label": "普通对话", "order": 1, "total": 1,
        })

        system_prompt = get_prompt("response.normal")
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": intent}]

        result_content = ""
        try:
            result_content = await self._call_llm(ctx, messages, model_hint, "normal_assistant", persona)
        except Exception as e:
            logger.error(f"Normal chat LLM call failed: {e}")
            result_content = f"AI 调用失败: {str(e)[:200]}"

        ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": "normal_chat"})
        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": result_content, "is_partial": False, "agent_name": "solo_assistant",
        })

        return {**context_data, "response": result_content}

    async def _execute_intelligent_chat(self, ctx: TaskContext, context_data: dict, is_auto: bool = False) -> dict:
        intent = context_data.get("task", context_data.get("intent", ""))
        model_hint = ctx.metadata.get("model", "auto")
        persona = ctx.persona or "default"
        mode_label = "全自动" if is_auto else "Solo"

        ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
            "step": "planning", "label": f"{mode_label}意图识别",
            "order": 1, "total": 2, "stage": "planning",
        })

        planning_prompt = get_prompt("planning.system", tool_descriptions="无额外工具")
        plan_messages = [{"role": "system", "content": planning_prompt}, {"role": "user", "content": intent}]

        plan_content = ""
        try:
            plan_content = await self._call_llm(ctx, plan_messages, model_hint, "planner", persona)
        except Exception as e:
            logger.warning(f"Planning LLM call failed: {e}")

        plan = self._parse_execution_plan(plan_content)
        is_simple = plan.get("complexity", "simple") == "simple" or not plan.get("plan")

        ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {
            "step": "planning",
            "intent_type": plan.get("intent_type", "chat"),
            "is_simple": is_simple,
        })

        if is_simple:
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                "step": "response", "label": "生成回复",
                "order": 2, "total": 2, "stage": "response",
            })

            response_prompt = get_prompt("response.simple")
            response_messages = [{"role": "system", "content": response_prompt}, {"role": "user", "content": intent}]

            result_content = ""
            try:
                result_content = await self._call_llm(ctx, response_messages, model_hint, "solo_assistant", persona)
            except Exception as e:
                result_content = f"生成回复失败: {str(e)[:200]}"

            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": "response"})
            ctx.event_bus.emit(ctx.task_id, "draft.update", {
                "content": result_content, "is_partial": False, "agent_name": "solo_assistant",
            })
            return {**context_data, "response": result_content}

        ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
            "step": "execution", "label": f"执行任务",
            "order": 2, "total": 2, "stage": "execution",
        })

        tool_schemas = self._build_function_schemas(ctx)
        react_result = await self._run_react_loop(ctx, intent, tool_schemas, model_hint, persona)

        ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": "execution"})

        collected = react_result.get("collected_context", "")
        response_prompt = get_prompt("response.solo",
            intent=intent,
            collected_context=collected[:3000] if collected else '无')
        response_messages = [{"role": "system", "content": response_prompt}, {"role": "user", "content": intent}]

        final_content = ""
        try:
            final_content = await self._call_llm(ctx, response_messages, model_hint, "solo_assistant", persona)
        except Exception as e:
            final_content = collected[:3000] if collected else f"执行失败: {e}"

        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": final_content, "is_partial": False, "agent_name": "solo_assistant",
        })

        return {
            **context_data,
            "response": final_content,
            "plan": plan,
            "execution_trace": react_result.get("execution_trace", []),
        }

    async def _run_react_loop(self, ctx: TaskContext, intent: str,
                               tool_schemas: list, model_hint: str, persona: str) -> dict:
        defense_config = ctx.metadata.get("_defense", self.DEFAULT_DEFENSE)
        max_tool_calls = defense_config.get("max_tool_calls", 50)
        tool_timeout = defense_config.get("tool_timeout", 120)
        repetition_limit = defense_config.get("repetition_limit", 3)

        tool_desc_text = self._build_tool_descriptions_text(ctx)
        system_prompt = get_prompt("react.orchestrator", tool_descriptions=tool_desc_text)

        all_messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": intent}]

        execution_trace = []
        collected_context = ""
        tool_calls_made = 0
        tool_call_history = []
        max_iterations = 3

        for iteration in range(max_iterations):
            if tool_calls_made >= max_tool_calls:
                logger.warning(f"Tool call limit reached: {tool_calls_made}/{max_tool_calls}")
                break

            if len(all_messages) > 10:
                all_messages = [all_messages[0]] + all_messages[-8:]

            llm_params = {
                "messages": all_messages,
                "stream": False,
                "persona": persona,
                "agent_name": "react_orchestrator",
                "task_id": ctx.task_id,
            }
            if tool_schemas:
                llm_params["tools"] = tool_schemas
            if model_hint and model_hint != "auto":
                llm_params["model"] = model_hint

            tool_input = ToolInput(params=llm_params)
            try:
                tool_output = await ctx.tools.execute("llm", tool_input)
            except Exception as e:
                logger.error(f"ReAct LLM call failed: {e}")
                break

            if not tool_output or not tool_output.result:
                break

            result = tool_output.result
            content_text = result.get("content", "")
            tool_calls = result.get("tool_calls")
            raw_message = result.get("raw_message")

            if not tool_calls:
                if content_text:
                    collected_context += f"\n\n{content_text[:2000]}"
                break

            assistant_msg = raw_message if raw_message else {"role": "assistant", "content": content_text}
            if "role" not in assistant_msg:
                assistant_msg["role"] = "assistant"
            all_messages.append(assistant_msg)

            if content_text:
                collected_context += f"\n\n## 思考\n{content_text[:500]}"

            for tool_call in tool_calls:
                if tool_calls_made >= max_tool_calls:
                    logger.warning(f"Tool call limit reached during tool_calls processing")
                    break

                func_info = tool_call.get("function", {})
                call_name = func_info.get("name", "")
                arguments_str = func_info.get("arguments", "{}")
                tool_call_id = tool_call.get("id", "")

                try:
                    arguments = json.loads(arguments_str) if isinstance(arguments_str, str) else arguments_str
                except json.JSONDecodeError:
                    arguments = {}

                ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                    "step": call_name, "label": f"调用 {call_name}",
                    "stage": call_name, "iteration": iteration + 1,
                })

                tool_result = await self._execute_tool_or_agent(ctx, call_name, arguments)

                tool_call_history.append(call_name)
                if len(tool_call_history) >= repetition_limit:
                    recent = tool_call_history[-repetition_limit:]
                    if len(set(recent)) == 1:
                        logger.warning(f"ReAct loop detected: {call_name} called {repetition_limit} times in a row, forcing stop")
                        collected_context += f"\n\n## {call_name} 已完成（检测到重复调用，自动终止）"
                        break

                tool_result_content = json.dumps(tool_result, ensure_ascii=False)[:1500]
                all_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": tool_result_content,
                })

                tool_calls_made += 1

                if tool_result.get("success"):
                    result_data = tool_result.get("result", {})
                    result_summary = json.dumps(result_data, ensure_ascii=False)[:1000]
                    collected_context += f"\n\n## {call_name} 结果\n{result_summary}"
                else:
                    collected_context += f"\n\n## {call_name} 失败\n{tool_result.get('error', '未知错误')}"

                execution_trace.append({
                    "iteration": iteration + 1,
                    "name": call_name,
                    "success": tool_result.get("success", False),
                })

                ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {
                    "step": call_name,
                    "success": tool_result.get("success", False),
                })

        return {
            "iterations": iteration + 1 if 'iteration' in dir() else 0,
            "tool_calls_made": tool_calls_made,
            "collected_context": collected_context,
            "execution_trace": execution_trace,
        }

    async def _execute_tool_or_agent(self, ctx: TaskContext, name: str, arguments: dict) -> dict:
        if ctx.agents:
            agent = ctx.agents.get(name)
            if agent:
                try:
                    task_desc = arguments.get("task", arguments.get("query", arguments.get("intent", str(arguments))))
                    agent_input = AgentInput(params={"task": task_desc, **arguments})
                    result = await agent.execute_with_context(agent_input, ctx)
                    return {"success": True, "result": result.result}
                except NotImplementedError:
                    try:
                        agent_input = AgentInput(params={"task": task_desc, **arguments})
                        result = await agent.execute(agent_input)
                        return {"success": True, "result": result.result}
                    except Exception as e:
                        return {"success": False, "error": str(e)[:300]}
                except Exception as e:
                    logger.warning(f"Agent {name} execution failed: {e}")
                    return {"success": False, "error": str(e)[:300]}

        if ctx.tools:
            try:
                tool = ctx.tools.get_tool(name)
                tool_input = ToolInput(params=arguments)
                tool_output = await tool.execute(tool_input)
                return {"success": True, "result": tool_output.result}
            except Exception as e:
                logger.warning(f"Tool {name} execution failed: {e}")
                return {"success": False, "error": str(e)[:300]}

        return {"success": False, "error": f"Unknown tool/agent: {name}"}

    def _build_function_schemas(self, ctx: TaskContext) -> list:
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

    def _build_tool_descriptions_text(self, ctx: TaskContext) -> str:
        lines = []
        if ctx.tools:
            try:
                for name in ctx.tools.list_tools():
                    if name == "llm":
                        continue
                    try:
                        tool = ctx.tools.get_tool(name)
                        desc = getattr(tool, 'description', '') or ''
                        lines.append(f"- **{name}** (Tool): {desc}")
                    except Exception:
                        lines.append(f"- **{name}** (Tool)")
            except Exception:
                pass
        return "\n".join(lines) if lines else "无可用工具"

    async def _call_llm(self, ctx: TaskContext, messages: list, model_hint: str,
                         agent_name: str = "solo_assistant", persona: str = "default") -> str:
        llm_params = {
            "messages": messages,
            "stream": False,
            "persona": persona,
            "agent_name": agent_name,
            "task_id": ctx.task_id,
        }
        if model_hint and model_hint != "auto":
            llm_params["model"] = model_hint

        if ctx.tools:
            tool_input = ToolInput(params=llm_params)
            tool_output = await ctx.tools.execute("llm", tool_input)
            content = tool_output.result.get("content", "") if tool_output.result else ""
            error = tool_output.result.get("error", "") if tool_output.result else ""
            if not content and error:
                logger.warning(f"LLM call returned empty content, error: {error[:200]}")
            return content
        else:
            from flowforge.tools.llm_client import LLMClient
            llm = LLMClient(event_bus=ctx.event_bus)
            tool_input = ToolInput(params=llm_params)
            tool_output = await llm.execute(tool_input)
            return tool_output.result.get("content", "") if tool_output.result else ""

    def _parse_execution_plan(self, content: str) -> dict:
        try:
            json_match = re.search(r'\{[\s\S]*\}', content)
            if json_match:
                plan = json.loads(json_match.group())
                if "plan" in plan or "intent_type" in plan:
                    return plan
        except (json.JSONDecodeError, KeyError):
            pass
        return {"intent_type": "chat", "complexity": "simple", "plan": []}

    async def _pause_for_review(self, ctx, step):
        ctx.event_bus.emit(ctx.task_id, "review.ready", {"step": step["name"]})
        review_event = ctx.executor.register_review_wait(ctx.task_id)
        ctx._review_event = review_event
        await review_event.wait()

    async def _execute_parallel(self, ctx, group, context_data):
        results = {}
        tasks = []
        for item in group:
            mode = item.get("mode", "plan_execute")
            sub_ctx = TaskContext.from_parent(ctx, input_data=context_data)
            tasks.append(ctx.executor.run(sub_ctx, mode_hint=mode, _is_substep=True))
        completed = await asyncio.gather(*tasks, return_exceptions=True)
        for item, result in zip(group, completed):
            if isinstance(result, Exception):
                if item.get("on_error", "abort") == "skip":
                    continue
                raise result
            results[item.get("output", item["name"])] = result
        return results

    async def _save_checkpoint(self, ctx, state):
        if hasattr(ctx, 'checkpoint') and ctx.checkpoint:
            ctx.checkpoint.save(ctx.task_id, "auto", state)

    def _render_template(self, text: str, context_data: dict) -> str:
        def replace_var(match):
            key = match.group(1)
            return str(context_data.get(key, match.group(0)))
        return re.sub(r'\{\{(\w+)\}\}', replace_var, text)
