from flowforge.agents.generic.base import AgentInput, AgentOutput, GenericAgent
from flowforge.core.base_tool import ToolInput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext


class WebSearchAgent(GenericAgent):
    name = "web_search_agent"
    description = "网络搜索：HelixRAG→Web搜索→LLM联网搜索回退链"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: TaskContext | None) -> AgentOutput:
        query = input.params.get("query", input.params.get("task", ""))
        mode = input.params.get("mode", "search")
        max_results = input.params.get("max_results", 5)

        if mode == "plan":
            prompt = self._get_prompt(
                "flowforge.agent.web_search_plan",
                query=query,
            )
            content = await self._call_llm(context, prompt)
            data = self._extract_json(content)
            if isinstance(data, str):
                data = {"optimized_queries": [query], "search_strategy": data}
            return AgentOutput(result={"search_plan": data}, state_updates={"search_plan": data})

        if mode == "summarize":
            results = input.params.get("results", [])
            prompt = self._get_prompt(
                "flowforge.agent.web_search_summarize",
                results=results,
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
        except Exception:
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
        except Exception:
            pass

        # Fallback 3: LLM WebChat 联网搜索
        try:
            search_prompt = get_prompt("tools.web_search.search_prompt", topic=query)
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
        prompt = self._get_prompt(
            "flowforge.agent.web_search_fallback",
            max_results=max_results,
            query=query,
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

    async def _call_llm_with_model(self, context: TaskContext | None, prompt: str, model: str) -> str:
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
