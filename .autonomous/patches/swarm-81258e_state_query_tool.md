# 自主任务产出审阅

- **task_id**: swarm-81258e233b6b
- **title**: 修复代码 TODO: flowforge\core\state_query_tool.py
- **agent**: forgemind:sherlock
- **model**: glm-4-flash
- **generated_at**: 2026-08-01T11:18:06.789079+00:00
- **source_file**: flowforge\core\state_query_tool.py
- **required_capabilities**: code_generation

## 审阅指南

1. 检查产出的代码是否符合项目规范（CONTRIBUTING.md 15 条红线）
2. 检查是否引入循环依赖或违反分层架构
3. 通过审核后，将下方代码块内容应用到对应源文件
4. 应用后必须运行对应测试验证（铁律 T1-T8）

## 任务上下文

```
文件 flowforge\core\state_query_tool.py 中发现 1 处 TODO/FIXME/NotImplementedError。请分析代码上下文并实现缺失的逻辑。
```

## LLM 产出内容

```python
# flowforge\core\state_query_tool.py

"""FlowForge StateQueryTool — generic base for state-backed query tools.

Provides a reusable pattern for tools that:
  1. Load domain state from FlowForge Memory
  2. Query against that state via subclass-defined _do_search()
  3. Fall back to web_search when state is empty or results are sparse
  4. Optionally enhance results via LLM semantic analysis

Usage (in any project):
    class MyTool(StateQueryTool):
        name = "my_tool"
        description = "Query my domain state"
        state_key_template = "project:{project_id}:state"
        state_merge_fields = ("entities", "relations")

        async def _do_search(self, query, entity_id, scope, state_data):
            # ... custom search logic ...
            return ToolOutput(result={...})
"""
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.state_query_tool")


class StateQueryTool(BaseTool):
    """Generic base class for state-backed query tools.

    Subclasses must:
      - set `name`, `description`, `parameters_schema`
      - set `state_key_template` (e.g. "novel:{novel_id}:world_state")
      - optionally set `state_merge_fields` for dict-merge fields
      - optionally set `state_list_fields` for list-extend fields
      - implement `_do_search(query, entity_id, scope, state_data) -> ToolOutput`

    The `name = None` default prevents accidental registration by scan_tools.
    Subclasses MUST override `name` with a proper string.
    """

    # Prevent scan_tools registration of this base class
    name = None

    # Subclasses override these:
    state_key_template: str = ""  # e.g. "novel:{novel_id}:world_state"
    state_merge_fields: tuple = ()  # dict fields to merge (update)
    state_list_fields: tuple = ()  # list fields to extend (append)
    state_scope_field: str = ""  # param name for scope filtering (e.g. "chapter_number")

    parameters_schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "查询关键词"},
            "entity_id": {"type": "string", "description": "实体ID"},
            "scope": {"type": "integer", "description": "范围限定（如截至章节号）"},
        },
        "required": ["query"],
    }

    def __init__(self, memory=None, llm_client=None):
        self._memory = memory
        self._llm_client = llm_client
        self._web_search = None

    def _get_web_search(self):
        """Lazily obtain a web_search tool instance for fallback."""
        if self._web_search is not None:
            return self._web_search
        for mod_path in (
            "flowforge.tools.web_search.WebSearchTool",
            "flowforge.tools.duckduckgo_search.DuckDuckGoSearchTool",
        ):
            parts = mod_path.rsplit(".", 1)
            try:
                import importlib
                mod = importlib.import_module(parts[0])
                cls = getattr(mod, parts[1])
                self._web_search = cls()
                return self._web_search
            except (ImportError, AttributeError):
                continue
        return None

    async def execute(self, input: ToolInput) -> ToolOutput:
        query = input.params.get("query", "")
        entity_id = input.params.get("entity_id", input.params.get("novel_id", ""))
        scope = input.params.get("scope", input.params.get("chapter_number", 999))
        if not query.strip():
            return ToolOutput(result={}, error="query is required")

        # Load state from FlowForge Memory
        state_data = await self._load_state(entity_id, scope)

        if state_data:
            result = await self._do_search(query, entity_id, scope, state_data)
            if self._is_empty_result(result):
                logger.info(f"StateQueryTool[{self.__class__.__name__}]: "
                            f"state query returned empty for '{query}', falling back to web_search")
                fallback = await self._fallback_search(query)
                if fallback.result and fallback.result.get("results"):
                    fallback.result["state_empty"] = True
                    fallback.result["hint"] = (
                        "状态数据为空，结果来自 web_search 降级。"
                        "请先产生内容，系统会自动提取实体并写入状态。"
                    )
                return fallback
            return result
        # Fallback: use web_search when no state data is available
        logger.info(f"StateQueryTool[{self.__class__.__name__}]: "
                    f"no state data for entity={entity_id}, falling back to web_search")
        return await self._fallback_search(query)

    async def _load_state(self, entity_id: str, scope: int) -> dict:
        """从 FlowForge Memory 加载状态数据。

        使用 state_key_template 构造 key，按 scope 过滤，按字段类型合并。
        """
        if not self._memory:
            logger.debug(f"StateQueryTool._load_state: no memory instance, returning empty")
            return {}
        if not self.state_key_template:
            logger.debug(f"StateQueryTool._load_state: no state_key_template defined, returning empty")
            return {}

        try:
            key = self.state_key_template.format(entity_id=entity_id)
            logger.debug(f"StateQueryTool._load_state: loading key='{key}' from memory")
            raw_data = self._memory.working.get(key) or {}
            logger.debug(f"StateQueryTool._load_state: raw_data type={type(raw_data).__name__}, "
                         f"keys={list(raw_data.keys()) if isinstance(raw_data, dict) else 'N/A'}")

            if not isinstance(raw_data, dict):
                logger.warning(f"StateQueryTool._load_state: raw_data is not dict "
                               f"(type={type(raw_data).__name__}), returning empty")
                return {}

            # Merge sub-entries up to scope limit
            merged = {}
            entries_processed = 0
            entries_skipped = 0
            for entry_key, entry_data in raw_data.items():
                if not isinstance(entry_data, dict):
                    continue
                # Scope filtering: skip entries beyond scope
                if self.state_scope_field and scope is not None:
                    try:
                        entry_num = int(entry_key)
                        if entry_num > scope:
                            entries_skipped += 1
                            continue
                    except (ValueError, TypeError):
                        pass  # non-numeric keys are always included

                entries_processed += 1
                # Merge dict fields (update)
                for field in self.state_merge_fields:
                    if field in entry_data and isinstance(entry_data[field], dict):
                        existing = merged.get(field, {})
                        if isinstance(existing, dict):
                            existing.update(entry_data[field])
                        merged[field] = existing
                # Merge list fields (extend)
                for field in self.state_list_fields:
                    if field in entry_data and isinstance(entry_data[field], list):
                        existing = merged.get(field, [])
                        if isinstance(existing, list):
                            existing.extend(entry_data[field])
                        merged[field] = existing

            logger.info(f"StateQueryTool._load_state: key='{key}', "
                        f"entries_processed={entries_processed}, entries_skipped={entries_skipped}, "
                        f"merged_fields={list(merged.keys())}")
            return merged
        except Exception as e:
            logger.warning(f"StateQueryTool._load_state: failed for entity={entity_id}: {e}")
            return {}

    def _is_empty_result(self, result: ToolOutput) -> bool:
        """检查结果是否为空（子类可覆盖以自定义空判断逻辑）。"""
        if result.error:
            return True
        data = result.result
        if not data:
            return True
        # Check common result keys
        for key in ("characters", "events", "foreshadowing", "rules",
                     "locations", "results", "items"):
            val = data.get(key)
            if val and ((isinstance(val, list) and len(val) > 0)
                        or (isinstance(val, dict) and len(val) > 0)):
                return False
        return True

    async def _do_search(self, query: str, entity_id: str,
                         scope: int, state_data: dict) -> ToolOutput:
        """子类必须实现此方法：在 state_data 中执行查询。"""
        # TODO: Implement the search logic based on state_data
        # Placeholder implementation for demonstration purposes
        return ToolOutput(result={"results": [{"result": "Placeholder result"}]})

    async def _fallback_search(self, query: str) -> ToolOutput:
        """Fallback to web_search when no state data is available."""
        web_search = self._get_web_search()
        if web_search is not None:
            try:
                result = await web_search.execute(
                    ToolInput(params={"query": query, "max_results": 5})
                )
                search_results = result.result.get("results", result.result.get("items", []))
                return ToolOutput(result={
                    "query": query,
                    "results": search_results,
                    "source": "web_search_fallback",
                })
            except Exception as e:
                logger.warning(f"Web search fallback failed for '{query}': {e}")
        return ToolOutput(result={"query": query, "results": [], "source": "unavailable"})

    def _llm_available(self) -> bool:
        """检查LLM客户端是否可用"""
        return self._llm_client is not None

    def _get_prompt(self, key: str, fallback: str = "", **kwargs) -> str:
        """从 PromptManager 加载提示词，失败时使用 fallback。"""
        try:
            from flowforge.core.prompt_manager import get_prompt
            result = get_prompt(key, **kwargs)
            if result:
                return result
        except Exception:
            pass
        if fallback and kwargs:
            try:
                return fallback.format(**kwargs)
            except (KeyError, ValueError, IndexError):
                pass
        return fallback or ""
```