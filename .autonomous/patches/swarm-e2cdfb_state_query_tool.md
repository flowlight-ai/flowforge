# 自主任务产出审阅

- **task_id**: swarm-e2cdfb16ce4f
- **title**: 修复代码 TODO: flowforge\core\state_query_tool.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-08-01T03:30:44.206857+00:00
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

# 文件路径：flowforge/tools/state_query_tool.py

python

```
import importlib
import logging
from typing import Optional

from flowforge.core.tool import ToolInput, ToolOutput

logger = logging.getLogger(__name__)

class StateQueryTool:
    def __init__(self, memory=None, llm_client=None):
        self._memory = memory
        self._llm_client = llm_client
        self._web_search = None
        # Template key for memory state storage, should be defined in subclass
        self.state_key_template: Optional[str] = None
        # Field name used for scope number filtering
        self.state_scope_field: Optional[str] = None
        # Dict-type fields to merge via dict.update()
        self.state_merge_fields: list[str] = []
        # List-type fields to merge via list.extend()
        self.state_list_fields: list[str] = []

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
        """从 FlowForge Memory 加载状态数据。 使用 state_key_template 构造 key，按 scope 过滤，按字段类型合并。 """
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
                # Scope filtering: skip entries beyond scope if configured
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
        # 
```