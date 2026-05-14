import json
import re
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext

class SelfDiscoverExecutor(BaseModeExecutor):
    mode_name = "self_discover"
    capabilities = ["meta_cognition"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")
        llm_tool = ctx.tools.get_tool("llm")
        prompt = f"分析以下任务，推荐最合适的思维框架或执行模式。输出 JSON: {{\"mode\": \"react\", \"reasoning\": \"...\"}}\n{task}"
        result = await llm_tool.execute(ToolInput(params={"messages": [{"role": "user", "content": prompt}]}))
        content = result.result.get("content", "{}")
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
                return {"recommended_mode": data.get("mode", "workflow"), "reasoning": data.get("reasoning", "")}
            except json.JSONDecodeError:
                pass
        return {"recommended_mode": "workflow", "reasoning": "auto"}
