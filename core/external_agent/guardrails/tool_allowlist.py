"""L3 Tool Allowlist — 工具白名单 Guardrail。

按 EX-005 实现第三层 Guardrail：三方 Agent 只能调用 allow-list 内工具，
防止越权调用（如 git push / rm / 数据库写入）。

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-005 安全沙箱不足
    - [doc:decisions/006-external-agent-integration.md] §6 安全治理 L3
    - 铁律 5：白名单外置到 config/tool_allowlist.yaml

License: MIT
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.guardrails.tool_allowlist")


class ToolAllowlistConfig(BaseModel):
    """工具白名单配置（外置到 config/tool_allowlist.yaml）。"""

    # 默认允许的工具（所有 Provider 共享）
    default_allowed: list[str] = Field(
        default_factory=lambda: [
            "file_read",
            "file_write",
            "file_list",
            "git_status",
            "git_diff",
            "run_tests",
            "lint",
        ],
        description="默认允许的工具列表",
    )
    # 默认禁止的工具（即使 Provider 声明需要也拒绝）
    default_forbidden: list[str] = Field(
        default_factory=lambda: [
            "git_push",
            "git_force_push",
            "rm",
            "rmdir",
            "sudo",
            "database_write",
            "network_request_unauthorized",
        ],
        description="默认禁止的工具列表",
    )
    # 按 Provider 定制的白名单（key=provider_name, value=允许列表）
    per_provider: dict[str, list[str]] = Field(
        default_factory=dict, description="按 Provider 定制的白名单"
    )


class AllowlistResult(BaseModel):
    """白名单校验结果。"""

    allowed: bool = Field(..., description="是否允许调用")
    tool: str = Field(..., description="请求调用的工具")
    reason: str = Field(default="", description="拒绝原因（allowed=False 时）")


class ToolAllowlistGuardrail:
    """L3 工具白名单 Guardrail。

    三方 Agent 只能调用 allow-list 内工具，防止越权调用。

    详见 [doc:review/review.md#第九章§9.2] EX-005

    白名单来源：
        1. config/tool_allowlist.yaml — 默认 + per-provider 配置
        2. Provider Manifest.required_permissions — Provider 声明所需权限
        3. 两者取交集（最小权限原则）
    """

    def __init__(self, config: ToolAllowlistConfig | None = None) -> None:
        self._config = config or ToolAllowlistConfig()

    def check(
        self,
        provider_name: str,
        tool: str,
        declared_permissions: list[str] | None = None,
    ) -> AllowlistResult:
        """检查工具是否允许调用。

        Args:
            provider_name: Provider 名称。
            tool: 请求调用的工具名。
            declared_permissions: Provider Manifest 声明的所需权限。

        Returns:
            AllowlistResult 校验结果。
        """
        # 1. 检查是否在禁止列表
        if tool in self._config.default_forbidden:
            return AllowlistResult(
                allowed=False,
                tool=tool,
                reason=f"tool in default_forbidden: {tool}",
            )

        # 2. 获取该 Provider 的允许列表（per-provider 优先）
        per_provider_allowed = self._config.per_provider.get(provider_name, [])
        allowed_set = set(self._config.default_allowed) | set(
            per_provider_allowed
        )

        # 3. 与 Provider 声明权限取交集（最小权限原则）
        if declared_permissions is not None:
            declared_set = set(declared_permissions)
            # 工具必须在 Provider 声明的权限范围内
            if tool not in declared_set:
                return AllowlistResult(
                    allowed=False,
                    tool=tool,
                    reason=(
                        f"tool '{tool}' not in provider declared_permissions: "
                        f"{declared_permissions}"
                    ),
                )

        # 4. 检查是否在允许列表
        if tool not in allowed_set:
            return AllowlistResult(
                allowed=False,
                tool=tool,
                reason=(
                    f"tool '{tool}' not in allowlist "
                    f"(default + per_provider[{provider_name}])"
                ),
            )

        return AllowlistResult(allowed=True, tool=tool)

    def load_from_yaml(self, yaml_path: str | Path) -> None:
        """从 YAML 加载白名单配置（铁律 5 配置驱动）。

        Args:
            yaml_path: config/tool_allowlist.yaml 路径。
        """
        path = Path(yaml_path)
        if not path.exists():
            raise FileNotFoundError(f"Tool allowlist yaml not found: {path}")
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"Invalid tool allowlist yaml: {path}")
        self._config = ToolAllowlistConfig(**data)
        logger.info(
            "tool_allowlist.loaded default_allowed=%d default_forbidden=%d per_provider=%d",
            len(self._config.default_allowed),
            len(self._config.default_forbidden),
            len(self._config.per_provider),
        )

    def get_allowed_tools(self, provider_name: str) -> list[str]:
        """获取某 Provider 的允许工具列表（用于运行时查询）。"""
        per_provider = self._config.per_provider.get(provider_name, [])
        return list(set(self._config.default_allowed) | set(per_provider))
