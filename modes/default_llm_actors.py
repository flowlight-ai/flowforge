import json
import re
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.core.prompt_manager import get_prompt


class DefaultLLMActor(BaseAgent):
    name = "default_actor"

    async def execute(self, input: AgentInput) -> AgentOutput:
        from flowforge.events.event_bus import EventBus
        ctx = TaskContext(
            task_id=input.params.get("task_id", "standalone"),
            persona=input.params.get("persona", "default"),
            input_data=input.params,
        )
        # Use executor passed via params (DI) instead of importing from app layer
        executor = input.params.get("_executor")
        if executor:
            ctx.tools = executor.tool_registry
            ctx.agents = executor.agent_registry
            ctx.event_bus = executor.event_bus
            ctx.executor = executor
        else:
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm_available = context and context.tools
        if not llm_available:
            return AgentOutput(result={"output": "LLMTool not available"})
        task = input.params.get("task", "")
        memory = input.params.get("memory", [])
        memory_text = "\n".join(str(m) for m in memory[-3:]) if memory else ""
        system_prompt = get_prompt("reflexion.actor")
        if memory_text:
            system_prompt += f"\n\n之前的反思和改进建议:\n{memory_text}"
        persona = context.persona or "default"
        if persona == "default":
            task_lower = task.lower()
            code_keywords = ["代码", "编程", "写代码", "code", "python", "算法", "函数", "排序", "实现", "程序", "javascript", "java", "rust", "golang"]
            if any(kw in task_lower for kw in code_keywords):
                persona = "coding"
        result = await context.tools.execute("llm", ToolInput(params={
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": task[:2000]},
            ],
            "stream": False, "task_id": context.task_id,
            "agent_name": "reflexion_actor", "persona": persona,
        }))
        return AgentOutput(result={"output": result.result.get("content", "")})


class DefaultLLMEvaluator(BaseAgent):
    name = "default_evaluator"

    async def execute(self, input: AgentInput) -> AgentOutput:
        from flowforge.events.event_bus import EventBus
        ctx = TaskContext(
            task_id=input.params.get("task_id", "standalone"),
            persona=input.params.get("persona", "default"),
            input_data=input.params,
        )
        # Use executor passed via params (DI) instead of importing from app layer
        executor = input.params.get("_executor")
        if executor:
            ctx.tools = executor.tool_registry
            ctx.agents = executor.agent_registry
            ctx.event_bus = executor.event_bus
            ctx.executor = executor
        else:
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm_available = context and context.tools
        if not llm_available:
            return AgentOutput(result={"score": 0.5, "issues": ["No LLM tool"]})
        output_content = input.params.get("output", "")
        if isinstance(output_content, dict):
            output_content = output_content.get("output", output_content.get("draft", str(output_content)))
        prompt = get_prompt("reflexion.evaluator", output=str(output_content)[:2000])
        llm_params = {
            "messages": [{"role": "user", "content": prompt}],
            "stream": False, "task_id": context.task_id,
            "agent_name": "reflexion_evaluator", "persona": input.params.get("persona", context.persona or "default"),
        }
        # 支持外部指定模型（如agent_judge传入deepseek-web/chat）
        model_hint = input.params.get("model")
        if model_hint:
            llm_params["model"] = model_hint
        result = await context.tools.execute("llm", ToolInput(params=llm_params))
        content = result.result.get("content", "{}")
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                return AgentOutput(result=json.loads(match.group()))
            except json.JSONDecodeError:
                pass
        return AgentOutput(result={"score": 0.5, "issues": [f"无法解析评估: {content[:100]}"]})


class DefaultLLMReflector(BaseAgent):
    name = "default_reflector"

    async def execute(self, input: AgentInput) -> AgentOutput:
        from flowforge.events.event_bus import EventBus
        ctx = TaskContext(
            task_id=input.params.get("task_id", "standalone"),
            persona=input.params.get("persona", "default"),
            input_data=input.params,
        )
        # Use executor passed via params (DI) instead of importing from app layer
        executor = input.params.get("_executor")
        if executor:
            ctx.tools = executor.tool_registry
            ctx.agents = executor.agent_registry
            ctx.event_bus = executor.event_bus
            ctx.executor = executor
        else:
            ctx.event_bus = EventBus()
        return await self.execute_with_context(input, ctx)

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm_available = context and context.tools
        if not llm_available:
            return AgentOutput(result={"reflection": "无法连接到 LLM"})
        output_content = input.params.get("output", "")
        if isinstance(output_content, dict):
            output_content = output_content.get("output", output_content.get("draft", str(output_content)))
        issues = input.params.get('issues', [])
        if isinstance(issues, list):
            issues_text = "; ".join(str(i) for i in issues) if issues else "无"
        else:
            issues_text = str(issues)
        prompt = get_prompt("reflexion.reflector",
            output=str(output_content)[:2000],
            issues=issues_text)
        result = await context.tools.execute("llm", ToolInput(params={
            "messages": [{"role": "user", "content": prompt}],
            "stream": False, "task_id": context.task_id,
            "agent_name": "reflexion_reflector", "persona": input.params.get("persona", context.persona or "default"),
        }))
        content = result.result.get("content", "{}")
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                return AgentOutput(result=json.loads(match.group()))
            except json.JSONDecodeError:
                pass
        return AgentOutput(result={"reflection": content[:200]})
