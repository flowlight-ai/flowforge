"""统一变量引用解析器 — 跨项目规范。

将4个项目的变量引用统一为 ${prefix.path} 格式：
- ${state.xxx}       — 工作流状态
- ${params.xxx}      — 输入参数
- ${result.xxx}      — 上一步执行结果
- ${outputs.xxx.yyy} — 指定步骤的输出
- ${config.xxx}      — 系统配置

向后兼容：旧的 {{state.xxx}} / $outputs.xxx / {output.xxx} 仍可工作。

Usage:
    from flowforge.core.variable_resolver import VariableResolver

    resolver = VariableResolver(context={
        "state": {"topic": "AI趋势", "score": 85},
        "params": {"limit": 10},
        "result": {"content": "文章内容"},
        "outputs": {"research": {"materials": [...]}},
        "config": {"data_dir": "/data"},
    })

    resolved = resolver.resolve("选题: ${state.topic}, 分数: ${state.score}")
    # "选题: AI趋势, 分数: 85"
"""

from __future__ import annotations

import re
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("variable_resolver")

# ── 正则模式 ──────────────────────────────────────────────────

# 新规范: ${prefix.path} 或 ${prefix.path[0].sub}
CANONICAL_PATTERN = re.compile(r'\$\{(\w+)\.([\w.\[\]]+)\}')

# 旧格式兼容: {{state.xxx}}, {{auto.persona}} (workflow_compiler 已有)
LEGACY_BRACE_PATTERN = re.compile(r'\{\{(\w+)\.([\w.\[\]]+)\}\}')

# 旧格式兼容: $outputs.xxx, $state.xxx (不带花括号)
LEGACY_DOLLAR_PATTERN = re.compile(r'\$(outputs|state|params|result|config)\.([\w.\[\]]+)')

# 旧格式兼容: {output.xxx} (单花括号)
LEGACY_SINGLE_BRACE_PATTERN = re.compile(r'\{(output|state|params|result)\.([\w.\[\]]+)\}')

# 前缀别名映射 (旧 → 新)
PREFIX_ALIASES: dict[str, str] = {
    "output": "outputs",
    "auto": "state",  # auto.persona → state.persona (向后兼容)
}


class VariableResolver:
    """解析 ${prefix.path} 格式的变量引用。

    支持5种前缀: state / params / result / outputs / config
    支持嵌套路径: ${state.novel.chapters[0].title}
    支持表达式求值: ${result.score < 70}
    向后兼容旧格式: {{state.xxx}}, $outputs.xxx, {output.xxx}
    """

    def __init__(self, context: dict[str, Any]) -> None:
        self._context = context

    def resolve(self, template: str) -> str:
        """解析模板中的所有变量引用。

        按优先级依次尝试: ${prefix.path} → {{prefix.path}} → $prefix.path → {prefix.path}

        Args:
            template: 包含变量引用的模板字符串。

        Returns:
            解析后的字符串。未匹配的引用保持原样。
        """
        if not isinstance(template, str):
            return str(template)

        # 1. 新规范: ${prefix.path}
        result = CANONICAL_PATTERN.sub(self._canonical_replacer, template)

        # 2. 旧格式: {{prefix.path}}
        result = LEGACY_BRACE_PATTERN.sub(self._legacy_replacer, result)

        # 3. 旧格式: $outputs.xxx
        result = LEGACY_DOLLAR_PATTERN.sub(self._legacy_replacer_dollar, result)

        # 4. 旧格式: {output.xxx}
        result = LEGACY_SINGLE_BRACE_PATTERN.sub(self._legacy_replacer_single, result)

        return result

    def resolve_value(self, template: str) -> Any:
        """解析模板，如果整个字符串是单个变量引用则保留原始类型。

        类似 workflow_compiler.interpolate_template 的类型保留行为。

        Args:
            template: 包含变量引用的模板字符串。

        Returns:
            解析后的值，单个引用保留原始类型，否则返回字符串。
        """
        if not isinstance(template, str):
            return template

        # 检查是否是单个 ${prefix.path} 引用
        match = CANONICAL_PATTERN.fullmatch(template.strip())
        if match:
            prefix, path = match.group(1), match.group(2)
            prefix = PREFIX_ALIASES.get(prefix, prefix)
            value = self._resolve_path(prefix, path)
            return value if value is not None else template

        return self.resolve(template)

    def resolve_state_updates(
        self, updates: dict[str, str]
    ) -> dict[str, Any]:
        """解析 state_updates 配置中的表达式。

        规范格式:
            state_updates:
              review_score: "${result.score}"
              needs_rewrite: "${result.score < 70}"
              chapter_content: "${result.rewritten_content}"

        支持简单比较表达式: ${result.score < 70} → True/False

        Args:
            updates: state_updates 配置字典，值为表达式字符串。

        Returns:
            解析后的字典，值替换为实际值。
        """
        resolved: dict[str, Any] = {}
        for key, expr in updates.items():
            if isinstance(expr, str):
                resolved[key] = self._resolve_expression(expr)
            else:
                resolved[key] = expr
        return resolved

    def _resolve_expression(self, expr: str) -> Any:
        """解析单个表达式，支持变量引用和简单比较运算。"""
        # 先尝试纯变量引用
        value = self.resolve_value(expr)
        if value is not expr:  # 成功解析
            return value

        # 尝试比较表达式: ${result.score < 70}
        # 提取所有变量引用，替换为实际值后求值
        comparison_ops = ["<=", ">=", "!=", "==", ">", "<"]
        for op in comparison_ops:
            if op in expr:
                parts = expr.split(op, 1)
                if len(parts) == 2:
                    left = self.resolve_value(parts[0].strip())
                    right = self.resolve_value(parts[1].strip())
                    if left is not parts[0].strip() and right is not parts[1].strip():
                        try:
                            return self._compare(left, right, op)
                        except (TypeError, ValueError):
                            pass

        # 兜底: 字符串替换
        return self.resolve(expr)

    @staticmethod
    def _compare(left: Any, right: Any, op: str) -> bool:
        """执行比较运算。"""
        if op == "<":
            return left < right
        elif op == "<=":
            return left <= right
        elif op == ">":
            return left > right
        elif op == ">=":
            return left >= right
        elif op == "==":
            return left == right
        elif op == "!=":
            return left != right
        return False

    def _canonical_replacer(self, match: re.Match) -> str:
        """${prefix.path} 格式的替换回调。"""
        prefix, path = match.group(1), match.group(2)
        prefix = PREFIX_ALIASES.get(prefix, prefix)
        value = self._resolve_path(prefix, path)
        return str(value) if value is not None else match.group(0)

    def _legacy_replacer(self, match: re.Match) -> str:
        """{{prefix.path}} 格式的替换回调。"""
        prefix, path = match.group(1), match.group(2)
        prefix = PREFIX_ALIASES.get(prefix, prefix)
        value = self._resolve_path(prefix, path)
        return str(value) if value is not None else match.group(0)

    def _legacy_replacer_dollar(self, match: re.Match) -> str:
        """$prefix.path 格式的替换回调。"""
        prefix, path = match.group(1), match.group(2)
        prefix = PREFIX_ALIASES.get(prefix, prefix)
        value = self._resolve_path(prefix, path)
        return str(value) if value is not None else match.group(0)

    def _legacy_replacer_single(self, match: re.Match) -> str:
        """{prefix.path} 格式的替换回调。"""
        prefix, path = match.group(1), match.group(2)
        prefix = PREFIX_ALIASES.get(prefix, prefix)
        value = self._resolve_path(prefix, path)
        return str(value) if value is not None else match.group(0)

    def _resolve_path(self, prefix: str, path: str) -> Any:
        """按前缀查找值，支持嵌套路径和列表索引。

        Args:
            prefix: 上下文前缀 (state/params/result/outputs/config)。
            path: 点分隔的嵌套路径，如 "novel.chapters[0].title"。

        Returns:
            解析后的值，未找到返回 None。
        """
        source = self._context.get(prefix)
        if source is None:
            return None

        # 解析路径: "novel.chapters[0].title" → ["novel", "chapters", 0, "title"]
        parts = self._parse_path(path)
        current: Any = source

        for part in parts:
            if current is None:
                return None
            if isinstance(part, int):
                # 列表索引
                if isinstance(current, (list, tuple)):
                    try:
                        current = current[part]
                    except IndexError:
                        return None
                else:
                    return None
            else:
                # 字典字段
                if isinstance(current, dict):
                    if part in current:
                        current = current[part]
                    else:
                        return None
                elif hasattr(current, part):
                    # 支持 Pydantic 模型属性访问
                    current = getattr(current, part)
                else:
                    return None

        return current

    @staticmethod
    def _parse_path(path: str) -> list[str | int]:
        """将路径字符串解析为段列表。

        "novel.chapters[0].title" → ["novel", "chapters", 0, "title"]
        "audit_result.score" → ["audit_result", "score"]
        "items[0][1]" → ["items", 0, 1]
        """
        segments: list[str | int] = []
        tokens = re.findall(r'[^.\[\]]+|\[\d+\]', path)
        for token in tokens:
            if token.startswith("[") and token.endswith("]"):
                try:
                    segments.append(int(token[1:-1]))
                except ValueError:
                    segments.append(token)
            else:
                segments.append(token)
        return segments


def create_resolver_from_state(
    state: dict[str, Any],
    params: dict[str, Any] | None = None,
    result: dict[str, Any] | None = None,
    outputs: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
) -> VariableResolver:
    """从常见上下文组件创建 VariableResolver 的便捷工厂。

    Args:
        state: 工作流状态字典。
        params: 输入参数字典。
        result: 上一步执行结果。
        outputs: 各步骤输出字典。
        config: 系统配置字典。

    Returns:
        配置好的 VariableResolver 实例。
    """
    return VariableResolver(context={
        "state": state,
        "params": params or {},
        "result": result or {},
        "outputs": outputs or {},
        "config": config or {},
    })
