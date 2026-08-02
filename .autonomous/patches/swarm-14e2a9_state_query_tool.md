# 自主任务产出审阅

- **task_id**: swarm-14e2a92d0c20
- **title**: 修复代码 TODO: flowforge\core\state_query_tool.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-08-01T07:43:51.543169+00:00
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

python

```
# 文件路径: flowforge/tools/state_query/base.py
from __future__ import annotations

import importlib
from typing import Optional

from flowforge.core.tool_base import ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("tools.state_query")

class BaseStateQueryTool:
    """StateQueryTool 基础抽象类
    实现状态加载、scope过滤、降级web搜索公共逻辑，子类仅需实现 _do_search
    """
    # 子类必须覆盖以下类变量
    state_key_template: str = ""
    state_scope_field: Optional[str] = None
    state_merge_fields: list[str] = []
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
            
```