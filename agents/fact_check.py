import re
import httpx
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.task_context import TaskContext


class FactCheckAgent(BaseAgent):
    name = "fact_check"
    description = "链接有效性检查、数据交叉验证"
    default_mode = "react"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        draft = input.params.get("draft", "")
        issues = []
        urls = re.findall(r'(https?://[^\s\)\]\>]+)', draft)
        for url in urls[:5]:
            try:
                async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
                    resp = await client.head(url)
                    if resp.status_code >= 400:
                        issues.append(f"链接失效 ({resp.status_code}): {url}")
            except Exception:
                issues.append(f"链接无法访问: {url}")
        return AgentOutput(result={"issues": issues, "is_clean": len(issues) == 0})
