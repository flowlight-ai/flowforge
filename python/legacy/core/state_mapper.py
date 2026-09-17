"""State Param Mapping — 自动从state中提取并填充Agent输入参数。

FWK-04: 消除Agent中硬编码的参数注入逻辑，通过声明式映射规则
自动从state/extra/context中提取参数。

Usage:
    from flowforge.core.state_mapper import StateMapper, ParamMapping

    # 方式1: 直接创建映射规则
    mapper = StateMapper([
        ParamMapping(param_name="topic", source="state.topic_list[0]", required=True),
        ParamMapping(param_name="materials", source="state.research_materials"),
        ParamMapping(param_name="style", source="auto.persona", default="professional"),
    ])
    params = mapper.apply(state={"topic_list": ["AI趋势"], "research_materials": [...]})

    # 方式2: 从配置字典创建
    mapper = StateMapper.from_config({
        "topic": "state.topic_list[0]",
        "materials": "state.research_materials",
        "style": "auto.persona",
    })
"""

from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("state_mapper")


class ParamMapping(BaseModel):
    """单个参数映射规则。

    Attributes:
        param_name: 目标参数名（传给Agent的参数名）
        source: 源路径，如 "state.topic_list[0]" 或 "auto.persona"
        required: 是否必须（缺失时是否报错）
        default: 默认值（当源路径不存在且required=False时使用）
        transform: 可选转换函数名
    """

    model_config = {"extra": "allow"}

    param_name: str = Field(..., description="目标参数名")
    source: str = Field(..., description="源路径")
    required: bool = Field(default=True, description="是否必须")
    default: Any = Field(default=None, description="默认值")
    transform: str | None = Field(default=None, description="可选转换：json_parse, str_join, first, last, len, str, lower, upper")


class StateMapper:
    """State参数映射器 - 自动从state中提取并填充Agent输入。

    根据映射规则列表，从state字典中提取指定路径的值，
    支持嵌套字段、列表索引、自动注入和多种转换操作。
    """

    def __init__(self, mappings: list[ParamMapping]) -> None:
        self._mappings = mappings
        self._source_cache: dict[str, list[str]] = {}

    def apply(self, state: dict, extra: dict | None = None) -> dict:
        """根据映射规则从state中提取参数，返回params字典。

        Args:
            state: 当前任务状态字典
            extra: 额外输入参数（对应 input. 前缀）

        Returns:
            提取后的参数字典
        """
        params: dict[str, Any] = {}
        extra = extra or {}

        for mapping in self._mappings:
            try:
                value = self._resolve_source(mapping.source, state, extra)
                if value is _MISSING:
                    if mapping.required:
                        logger.warning(
                            f"StateMapper: required param '{mapping.param_name}' "
                            f"not found at source '{mapping.source}'"
                        )
                        continue
                    value = mapping.default

                if value is not _MISSING and mapping.transform:
                    value = self._apply_transform(value, mapping.transform)

                if value is not _MISSING:
                    params[mapping.param_name] = value

            except Exception as e:
                logger.error(
                    f"StateMapper: error resolving param '{mapping.param_name}' "
                    f"from source '{mapping.source}': {e}"
                )
                if mapping.required:
                    raise

        return params

    def _resolve_source(self, source: str, state: dict, extra: dict) -> Any:
        """解析源路径，提取值。

        支持的路径格式:
        - state.field_name
        - state.nested.field
        - state.list_field[0]
        - auto.persona / auto.soul / auto.memory
        - input.field
        - context.field
        """
        if source.startswith("state."):
            path = source[len("state."):]
            return self._traverse_path(state, path)

        if source.startswith("auto."):
            auto_key = source[len("auto."):]
            return self._resolve_auto(auto_key, state)

        if source.startswith("input."):
            path = source[len("input."):]
            return self._traverse_path(extra, path)

        if source.startswith("context."):
            context_data = state.get("context_data", {})
            path = source[len("context."):]
            return self._traverse_path(context_data, path)

        # 兜底：直接从state中取
        return self._traverse_path(state, source)

    def _traverse_path(self, data: dict, path: str) -> Any:
        """沿路径遍历字典，支持嵌套字段和列表索引。

        Examples:
            _traverse_path(data, "topic_list[0]") -> data["topic_list"][0]
            _traverse_path(data, "nested.field") -> data["nested"]["field"]
            _traverse_path(data, "items[2].name") -> data["items"][2]["name"]
        """
        if not data:
            return _MISSING

        # 将路径拆分为段，支持 "field[0].subfield" 格式
        segments = self._parse_path(path)
        current: Any = data

        for seg in segments:
            if current is None or current is _MISSING:
                return _MISSING

            if seg.startswith("[") and seg.endswith("]"):
                # 列表索引
                try:
                    index = int(seg[1:-1])
                    if isinstance(current, (list, tuple)) and -len(current) <= index < len(current):
                        current = current[index]
                    else:
                        return _MISSING
                except (ValueError, IndexError):
                    return _MISSING
            else:
                # 字典字段
                if isinstance(current, dict):
                    if seg in current:
                        current = current[seg]
                    else:
                        return _MISSING
                else:
                    return _MISSING

        return current

    def _parse_path(self, path: str) -> list[str]:
        """将路径字符串解析为段列表。

        "topic_list[0].name" -> ["topic_list", "[0]", "name"]
        "nested.field" -> ["nested", "field"]
        "items[0]" -> ["items", "[0]"]
        """
        if path in self._source_cache:
            return self._source_cache[path]

        segments: list[str] = []
        # 用正则拆分：字段名 或 [索引]
        tokens = re.findall(r'[^.\[\]]+|\[\d+\]', path)
        for token in tokens:
            segments.append(token)

        self._source_cache[path] = segments
        return segments

    def _resolve_auto(self, key: str, state: dict) -> Any:
        """解析 auto.* 路径。

        auto.persona -> state["persona"]
        auto.soul -> state["style_profile"]["soul"]
        auto.memory -> state["style_profile"]["memory"]
        auto.creation -> state["style_profile"]["creation"]
        """
        auto_map: dict[str, str] = {
            "persona": "state.persona",
            "soul": "state.style_profile.soul",
            "memory": "state.style_profile.memory",
            "creation": "state.style_profile.creation",
        }
        mapped_source = auto_map.get(key)
        if mapped_source:
            return self._resolve_source(mapped_source, state, {})
        return _MISSING

    @staticmethod
    def _apply_transform(value: Any, transform: str) -> Any:
        """对值应用转换操作。

        支持的转换:
        - json_parse: 字符串 -> JSON解析
        - str_join: 列表 -> 字符串连接
        - first: 取列表第一个
        - last: 取列表最后一个
        - len: 取长度
        - str: 转字符串
        - lower: 小写转换
        - upper: 大写转换
        """
        try:
            if transform == "json_parse":
                if isinstance(value, str):
                    return json.loads(value)
                return value

            if transform == "str_join":
                if isinstance(value, (list, tuple)):
                    return "\n".join(str(v) for v in value)
                return str(value)

            if transform == "first":
                if isinstance(value, (list, tuple)) and len(value) > 0:
                    return value[0]
                return value

            if transform == "last":
                if isinstance(value, (list, tuple)) and len(value) > 0:
                    return value[-1]
                return value

            if transform == "len":
                return len(value) if value is not None else 0

            if transform == "str":
                return str(value) if value is not None else ""

            if transform == "lower":
                return str(value).lower() if value is not None else ""

            if transform == "upper":
                return str(value).upper() if value is not None else ""

            logger.warning(f"StateMapper: unknown transform '{transform}'")
            return value

        except Exception as e:
            logger.warning(f"StateMapper: transform '{transform}' failed: {e}")
            return value

    @classmethod
    def from_config(cls, config: dict[str, str]) -> StateMapper:
        """从配置字典创建StateMapper。

        Args:
            config: 参数名到源路径的映射，如:
                {
                    "topic": "state.topic_list[0]",
                    "materials": "state.research_materials",
                    "style": "auto.persona",
                }

        Returns:
            配置好的StateMapper实例
        """
        mappings: list[ParamMapping] = []
        for param_name, source in config.items():
            mappings.append(ParamMapping(param_name=param_name, source=source))
        return cls(mappings)


class _MissingSentinel:
    """内部哨兵值，用于区分None和缺失。"""

    _instance: _MissingSentinel | None = None

    def __new__(cls) -> _MissingSentinel:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "<MISSING>"

    def __bool__(self) -> bool:
        return False


_MISSING = _MissingSentinel()
