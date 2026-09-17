"""Agent 命名空间规范 — 通用工具。

提供命名空间前缀解析和转换的通用工具函数。
各项目（DevForge、ContentForge等）通过注册自己的命名空间映射来使用。

从 DevForge 迁移至 FlowForge 通用框架，去除项目特定的命名空间映射。
"""

from __future__ import annotations

from typing import Any


# 项目命名空间注册表 — 各项目在初始化时注册自己的映射
_NAMESPACE_REGISTRY: dict[str, dict[str, str]] = {}

# 默认命名空间前缀
NAMESPACE_PREFIX = "flowforge"


def register_namespace(project: str, agent_map: dict[str, str]) -> None:
    """注册项目的命名空间映射。

    Args:
        project: 项目名称，如 "devforge", "contentforge"
        agent_map: 命名空间到本地名称的映射，如 {"devforge:coder": "coder"}
    """
    _NAMESPACE_REGISTRY[project] = agent_map


def resolve_agent_name(name: str) -> str:
    """解析Agent名称，支持带命名空间和不带命名空间两种格式。

    Examples:
        resolve_agent_name("devforge:coder") -> "coder"
        resolve_agent_name("coder") -> "coder"
    """
    if ":" in name:
        # 在所有已注册的命名空间中查找
        for project, agent_map in _NAMESPACE_REGISTRY.items():
            if name in agent_map:
                return agent_map[name]
        # 未找到则去掉前缀返回
        return name.split(":", 1)[1]
    return name


def to_namespace_name(local_name: str, project: str | None = None) -> str:
    """将本地名称转换为命名空间格式。

    Args:
        local_name: 本地Agent名称
        project: 项目名称，默认使用 NAMESPACE_PREFIX

    Examples:
        to_namespace_name("coder") -> "flowforge:coder"
        to_namespace_name("coder", project="devforge") -> "devforge:coder"
    """
    prefix = project or NAMESPACE_PREFIX
    return f"{prefix}:{local_name}"


def get_namespace_map(project: str) -> dict[str, str]:
    """获取指定项目的命名空间映射。"""
    return _NAMESPACE_REGISTRY.get(project, {})


def get_all_namespaces() -> dict[str, dict[str, str]]:
    """获取所有已注册的命名空间映射。"""
    return dict(_NAMESPACE_REGISTRY)
