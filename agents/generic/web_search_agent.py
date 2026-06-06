import json
import re
from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from typing import Optional

_LLM_WEB_SEARCH_PROMPT = (
    "你是一个专业的信息搜索助手。请利用你的联网能力，搜索关于{topic}的最新信息。\n"
    "要求：\n"
    "1. 搜索至少3个不同角度的信息\n"
    "2. 每个信息点包含：标题、摘要、来源\n"
    "3. 标注信息的时间范围\n"
    "4. 如果无法获取实时信息，明确说明\n"
    "5. 严格输出JSON数组: [{{\"title\": \"标题\", \"url\": \"https://...\", \"content\": \"摘要内容\"}}]"
)


class WebSearchAgent(GenericAgent):
    name = "web_search_agent"
    description = "网络搜索：HelixRAG→Web搜索→LLM联网搜索回退链"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        query = input.params.get("query", input.params.get("task", ""))
        mode = input.params.get("mode", "search")
        max_results = input.params.get("max_results", 5)

        if mode == "plan":
            prompt = (
                "优化以下搜索查询，生成多个搜索变体以提高搜索覆盖率。\n"
                '输出JSON: {"optimized_queries": ["变体1"], "search_strategy": "搜索策略"}\n\n'
                f"原始查询: {query}"
            )
            content = await self._call_llm(context, prompt)
            data = self._extract_json(content)
            if isinstance(data, str):
                data = {"optimized_queries": [query], "search_strategy": data}
            return AgentOutput(result={"search_plan": data}, state_updates={"search_plan": data})

        if mode == "summarize":
            results = input.params.get("results", [])
            prompt = (
                "整理和去重以下搜索结果，生成摘要。\n"
                '输出JSON数组: [{"title": "标题", "url": "URL", "summary": "摘要"}]\n\n'
                f"搜索结果: {results}"
            )
            content = await self._call_llm(context, prompt)
            data = self._extract_json(content)
            if isinstance(data, str):
                data = []
            if isinstance(data, dict):
                data = [data]
            return AgentOutput(result={"summarized": data}, state_updates={"search_summarized": data})

        # Fallback 1: HelixRAG/OpenSieve
        try:
            search_result = await self._call_tool(context, "opensieve_search", {
                "query": query,
                "max_results": max_results,
            })
            if search_result and search_result.get("results"):
                return AgentOutput(
                    result={"search_results": search_result, "source": "helixrag"},
                    state_updates={"search_results": search_result},
                )
        except Exception as e:
            pass

        # Fallback 2: web_search tool (DuckDuckGo/Tavily)
        try:
            search_result = await self._call_tool(context, "web_search", {
                "query": query,
                "max_results": max_results,
            })
            if search_result and search_result.get("results"):
                return AgentOutput(
                    result={"search_results": search_result, "source": "web_search"},
                    state_updates={"search_results": search_result},
                )
        except Exception as e:
            pass

        # Fallback 3: LLM WebChat 联网搜索
        try:
            search_prompt = _LLM_WEB_SEARCH_PROMPT.format(topic=query)
            content = await self._call_llm_with_model(context, search_prompt, "web/chat")
            data = self._extract_json(content)
            if isinstance(data, str):
                data = []
            if isinstance(data, dict):
                data = [data]
            return AgentOutput(
                result={"search_results": data, "fallback": True, "source": "llm_web_search"},
                state_updates={"search_results": data},
            )
        except Exception:
            pass

        # Fallback 4: 纯LLM生成
        prompt = (
            f"你是一个搜索助手。请为以下查询生成{max_results}条搜索结果。\n"
            f'严格输出JSON数组: [{{"title": "标题", "url": "https://...", "content": "摘要内容"}}]\n'
            f"查询: {query}"
        )
        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = []
        if isinstance(data, dict):
            data = [data]
        return AgentOutput(
            result={"search_results": data, "fallback": True},
            state_updates={"search_results": data},
        )

    async def _call_llm_with_model(self, context: Optional[TaskContext], prompt: str, model: str) -> str:
        messages = [{"role": "user", "content": prompt}]
        tool_params = {"messages": messages, "model": model}
        if context is not None and context.tools is not None:
            llm = context.tools.get_tool("llm")
            result = await llm.execute(ToolInput(params=tool_params))
            return result.result.get("content", "")
        if self._llm_client is not None:
            result = await self._llm_client.execute(ToolInput(params=tool_params))
            return result.result.get("content", "")
        raise RuntimeError("No LLM client available")
