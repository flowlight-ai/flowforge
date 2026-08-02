# 自主任务产出审阅

- **task_id**: swarm-f449684398ff
- **title**: 修复代码 TODO: flowforge\core\state_query_tool.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-07-31T23:03:25.732290+00:00
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

# 文件路径：flowforge/tools/state_query/base.py

python

```
from typing import Optional
from flowforge.core.tool import ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("tools.state_query.base")

class BaseStateQueryTool:
    """
    状态查询工具基类
    提供内存状态加载、作用域过滤、字段合并、web搜索降级逻辑
    子类必须实现 _do_search 方法完成状态内检索
    """
    # 子类重写：状态存储key模板，支持 {entity_id} 占位符
    state_key_template: Optional[str] = None
    # 子类重写：用于scope过滤的字段名称
    state_scope_field: Optional[str] = None
    # 子类重写：执行dict.update合并的字段清单
    state_merge_fields: list[str] = []
    # 子类重写：执行list.extend合并的字段清单
    state_list_fields: list[str] = []

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
        query = input.params.get("query

```