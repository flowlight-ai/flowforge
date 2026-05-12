from core.base_agent import BaseAgent, AgentInput, AgentOutput
from core.base_tool import ToolInput
from core.task_context import TaskContext


class MultilingualAgent(BaseAgent):
    name = "multilingual"
    description = "多语言翻译与本地化适配"
    default_mode = "plan_execute"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        text = input.params.get("text", input.params.get("draft", ""))
        target_lang = input.params.get("target_lang", "en")
        llm = context.tools.get_tool("llm")
        prompt = f"将以下内容翻译为{target_lang}，保持原文风格和语气：\n{text[:2000]}"
        result = await llm.execute(
            ToolInput(params={"messages": [{"role": "user", "content": prompt}], "max_tokens": 2000})
        )
        return AgentOutput(result={"translated": result.result.get("content", ""), "target_lang": target_lang})
