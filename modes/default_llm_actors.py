import json
import re
from core.base_agent import BaseAgent, AgentInput, AgentOutput
from core.base_tool import ToolInput
from core.task_context import TaskContext

class DefaultLLMActor(BaseAgent):
    name = "default_actor"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm = context.tools.get_tool("llm") if context and context.tools else None
        if llm is None:
            return AgentOutput(result={"output": "LLMTool not available"})
        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "user", "content": input.params.get("task", "")}]
        }))
        return AgentOutput(result={"output": result.result.get("content", "")})

class DefaultLLMEvaluator(BaseAgent):
    name = "default_evaluator"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm = context.tools.get_tool("llm") if context and context.tools else None
        if llm is None:
            return AgentOutput(result={"score": 0.5, "issues": ["No LLM tool"]})
        prompt = (
            "评估以下输出质量，给出 0-1 分数和问题列表。"
            "严格输出 JSON: {\"score\": 0.85, \"issues\": [\"问题1\", \"问题2\"]}\n\n"
            f"输出内容: {input.params.get('output', '')}"
        )
        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "user", "content": prompt}]
        }))
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
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        llm = context.tools.get_tool("llm") if context and context.tools else None
        if llm is None:
            return AgentOutput(result={"reflection": "无法连接到 LLM"})
        prompt = (
            "分析以下失败案例，总结失败原因和具体改进建议。"
            "输出 JSON: {\"reflection\": \"分析结果...\"}\n\n"
            f"输出内容: {input.params.get('output', '')}\n"
            f"问题列表: {input.params.get('issues', [])}"
        )
        result = await llm.execute(ToolInput(params={
            "messages": [{"role": "user", "content": prompt}]
        }))
        content = result.result.get("content", "{}")
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                return AgentOutput(result=json.loads(match.group()))
            except json.JSONDecodeError:
                pass
        return AgentOutput(result={"reflection": content[:200]})
