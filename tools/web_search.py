import asyncio
import json

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.tracing import get_logger

logger = get_logger("web_search")

_ENGINE_TIMEOUTS: dict[str, float] = {
    "opensieve_search": 45.0,  # v2.1: 双端点策略（retrieve 15s + search fallback 30s）
    "duckduckgo_search": 8.0,
}

_LLM_SEARCH_TIMEOUT = 60.0

_ENGINE_MODULE_MAP: dict[str, tuple[str, str]] = {
    "opensieve_search": ("flowforge.tools.opensieve_client", "OpenSieveClient"),
    "duckduckgo_search": ("flowforge.tools.duckduckgo_search", "DuckDuckGoSearchTool"),
    "tavily_search": ("flowforge.tools.tavily_search", "TavilySearchTool"),
}


class WebSearchTool(BaseTool):
    name = "web_search"
    description = "网络搜索聚合工具：HelixRAG→DuckDuckGo→LLM联网搜索回退链"
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string", "description": "搜索查询"},
            "max_results": {"type": "integer", "default": 5, "description": "最大结果数"},
        },
    }

    def __init__(self, fallback_chain: list = None):
        self.fallback_chain = fallback_chain or [
            "opensieve_search", "duckduckgo_search"
        ]
        self._plugin_registry = None
        self._llm_client = None
        self._unavailable_engines: set[str] = set()

    def set_plugin_registry(self, plugin_registry):
        self._plugin_registry = plugin_registry

    def set_llm_client(self, llm_client):
        self._llm_client = llm_client

    def _check_engine_available(self, engine: str) -> bool:
        if engine in self._unavailable_engines:
            return False
        if engine not in _ENGINE_MODULE_MAP:
            return True
        module_path, class_name = _ENGINE_MODULE_MAP[engine]
        try:
            import importlib
            mod = importlib.import_module(module_path)
            if not hasattr(mod, class_name):
                logger.warning(f"Engine {engine}: module {module_path} has no class {class_name}, skipping")
                self._unavailable_engines.add(engine)
                return False
            return True
        except ImportError as e:
            logger.warning(f"Engine {engine}: module {module_path} not available ({e}), skipping")
            self._unavailable_engines.add(engine)
            return False

    async def execute(self, input: ToolInput) -> ToolOutput:
        query = input.params["query"]
        max_results = input.params.get("max_results", 5)

        for engine in self.fallback_chain:
            if not self._check_engine_available(engine):
                logger.info(f"Skipping unavailable engine: {engine}")
                continue

            timeout = _ENGINE_TIMEOUTS.get(engine, 15.0)
            try:
                result = await asyncio.wait_for(
                    self._try_engine(engine, query, max_results),
                    timeout=timeout,
                )
                if result and result.get("results"):
                    logger.info(f"Search succeeded with engine: {engine}")
                    return ToolOutput(result=result)
                logger.info(f"Search engine {engine} returned empty, trying next")
            except TimeoutError:
                logger.warning(f"Search engine {engine} timed out after {timeout}s, trying next")
                continue
            except Exception as e:
                logger.warning(f"Search engine {engine} failed: {e}")
                continue

        try:
            llm_result = await asyncio.wait_for(
                self._llm_web_search(query, max_results),
                timeout=_LLM_SEARCH_TIMEOUT,
            )
            if llm_result and llm_result.get("results"):
                return ToolOutput(result=llm_result)
        except TimeoutError:
            logger.warning(f"LLM WebChat search timed out after {_LLM_SEARCH_TIMEOUT}s")
        except Exception as e:
            logger.warning(f"LLM WebChat search failed: {e}")

        return ToolOutput(result={"results": [], "error": "All search engines and LLM fallback failed", "search_available": False})

    async def _try_engine(self, engine: str, query: str, max_results: int) -> dict:
        if self._plugin_registry:
            try:
                plugin = self._plugin_registry.get_plugin(engine)
                if plugin:
                    result = await plugin.execute({"query": query, "max_results": max_results})
                    if isinstance(result, dict) and result.get("results"):
                        return result
            except Exception as e:
                logger.debug(f"Plugin {engine} failed: {e}")

        if engine not in _ENGINE_MODULE_MAP:
            return {"results": []}

        module_path, class_name = _ENGINE_MODULE_MAP[engine]
        try:
            import importlib
            mod = importlib.import_module(module_path)
            tool_cls = getattr(mod, class_name)
        except (ImportError, AttributeError):
            return {"results": []}

        tool = tool_cls()
        result = await tool.execute(ToolInput(params={"query": query, "max_results": max_results}))
        if result.result.get("results"):
            return result.result

        return {"results": []}

    async def _llm_web_search(self, query: str, max_results: int) -> dict:
        logger.info(f"Falling back to LLM WebChat search for: {query[:50]}")
        prompt = get_prompt("tools.web_search.search_prompt", topic=query)
        search_system = get_prompt("tools.web_search.search_system")
        messages = [
            {"role": "system", "content": search_system},
            {"role": "user", "content": prompt},
        ]

        if self._llm_client:
            try:
                result = await self._llm_client.execute(ToolInput(params={
                    "messages": messages,
                    "stream": False,
                    "agent_name": "web_search",
                    "persona": "default",
                    "model": "web/chat",
                }))
                content = result.result.get("content", "")
                return self._parse_llm_results(content, query)
            except Exception as e:
                logger.warning(f"LLM client WebChat search failed: {e}")

        try:
            from flowforge.tools.llm_client import LLMClient
            llm = LLMClient()
            result = await llm.execute(ToolInput(params={
                "messages": messages,
                "stream": False,
                "agent_name": "web_search",
                "persona": "default",
                "model": "web/chat",
            }))
            content = result.result.get("content", "")
            return self._parse_llm_results(content, query)
        except Exception as e:
            logger.warning(f"LLM fallback WebChat search failed: {e}")
            return {"results": []}

    def _parse_llm_results(self, content: str, query: str) -> dict:
        if not content:
            return {"results": []}
        import re
        match = re.search(r'\{[\s\S]*\}', content)
        if match:
            try:
                data = json.loads(match.group())
                results = data.get("results", [])
                for r in results:
                    r.setdefault("source_type", "llm_web_search")
                    r.setdefault("url", "")
                    r.setdefault("content", r.get("snippet", ""))
                return {"results": results, "source": "llm_web_search"}
            except json.JSONDecodeError:
                pass
        return {"results": [{"title": f"LLM搜索: {query[:30]}", "url": "", "content": content[:500], "source_type": "llm_web_search"}], "source": "llm_web_search"}
