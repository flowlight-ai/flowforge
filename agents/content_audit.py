import json
import re
from core.base_agent import BaseAgent, AgentInput, AgentOutput
from core.base_tool import ToolInput
from core.task_context import TaskContext


class ContentAuditAgent(BaseAgent):
    name = "content_audit"
    description = "LLM 质量评分、问题检测与分类"
    default_mode = "agent_judge"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        draft = input.params.get("draft", "")
        llm = context.tools.get_tool("llm")
        prompt = (
            f"对以下文章进行质量评分（0-1）并列出所有问题。"
            f"严格输出 JSON: {{\"score\": 0.85, \"issues\": [\"问题1\", \"问题2\"]}}\n\n"
            f"文章内容: {draft}"
        )
        result = await llm.execute(
            ToolInput(params={"messages": [{"role": "user", "content": prompt}]})
        )
        content = result.result.get("content", "{}")
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
                return AgentOutput(result={"score": data.get("score", 0.5), "issues": data.get("issues", [])})
            except json.JSONDecodeError:
                pass
        return AgentOutput(result={"score": 0.5, "issues": ["无法解析评估结果"]})
