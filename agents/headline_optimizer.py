import json
import re
from core.base_agent import BaseAgent, AgentInput, AgentOutput
from core.base_tool import ToolInput
from core.task_context import TaskContext


class HeadlineOptimizerAgent(BaseAgent):
    name = "headline_optimizer"
    description = "标题 A/B 测试、点击率优化"
    default_mode = "reflexion"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        topic = input.params.get("topic", "")
        draft_title = input.params.get("title", "")
        llm = context.tools.get_tool("llm")
        prompt = (
            f"为以下文章生成 3 个优化标题候选，目标是提高点击率。"
            f"输出 JSON: {{\"headlines\": [\"标题1\", \"标题2\", \"标题3\"]}}\n"
            f"主题: {topic}\n原标题: {draft_title}"
        )
        result = await llm.execute(
            ToolInput(params={"messages": [{"role": "user", "content": prompt}]})
        )
        content = result.result.get("content", "{}")
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
                return AgentOutput(result={"headlines": data.get("headlines", [draft_title])})
            except json.JSONDecodeError:
                pass
        return AgentOutput(result={"headlines": [draft_title]})
