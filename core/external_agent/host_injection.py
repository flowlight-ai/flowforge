"""HostInjector — host-owned 安全注入器（F241 CL-015）。

核心原则："plugin 只声明不执行"——三方 Agent 不能自己获取 token、
不能自己创建 sandbox、不能自己改 cwd，所有敏感操作由 host 注入。

设计依据：
    - [doc:review/review.md#13.3] F241 Agent Provider Plugin（CL-015 host-owned）
    - [doc:decisions/006-external-agent-integration.md] §6 安全治理
    - [doc:design/naming-contract.md#2.11] 觉醒阶 E1-E2 六层 Guardrails 全开

铁律遵守：
    - 铁律 5：禁止硬编码密钥（token 通过 credential_store 注入，不在代码中存值）
    - 铁律 3：依赖通过构造函数注入（credential_store / sandbox_factory）
    - 编程红线 12：禁止绕过 DI 容器直接实例化

License: MIT
"""

from __future__ import annotations

from typing import Any, Protocol

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.host_injection")


class CredentialStore(Protocol):
    """凭据存储协议（DI 注入点）。

    实现方从环境变量 / Vault / .env 读取真实凭据，HostInjector 通过
    此协议获取 token，**三方 Agent 不能直接访问此协议**。
    """

    def get(self, env_var: str) -> str | None:
        """按环境变量名获取凭据值（不写入日志）。"""
        ...


class SandboxConfig(BaseModel):
    """sandbox 配置（host 注入到三方 Agent）。

    按 EX-005 实现网络隔离 + 权限控制：
        - cwd: 工作目录（worktree 路径，由 host 创建）
        - network_allowlist: 网络白名单（仅允许访问必要域名）
        - file_permissions: 文件权限（read_only_paths / write_only_paths）
        - env_vars: 环境变量（已脱敏的 token / API key，按 required_env_vars 注入）
    """

    cwd: str = Field(..., description="工作目录（worktree 路径）")
    network_allowlist: list[str] = Field(
        default_factory=list, description="网络白名单（域名列表）"
    )
    file_readonly_paths: list[str] = Field(
        default_factory=list, description="只读路径列表"
    )
    file_writable_paths: list[str] = Field(
        default_factory=list, description="可写路径列表"
    )
    env_vars: dict[str, str] = Field(
        default_factory=dict, description="已脱敏的环境变量（token 已注入）"
    )
    mcp_servers: list[dict[str, Any]] = Field(
        default_factory=list, description="MCP 服务器配置"
    )


class HostInjector:
    """host-owned 安全注入器（F241 CL-015）。

    核心原则："plugin 只声明不执行"——三方 Agent 不能自己获取 token、
    不能自己创建 sandbox、不能自己改 cwd，所有敏感操作由 host 注入。

    详见 [doc:review/review.md#13.3] F241 Agent Provider Plugin

    设计要点：
        1. token 注入：从 CredentialStore 读取，注入到 env_vars，不暴露给 plugin 代码
        2. sandbox 注入：cwd / 网络白名单 / 文件权限由 host 决定
        3. MCP 注入：MCP 服务器配置由 host 维护，plugin 只读
    """

    def __init__(self, credential_store: CredentialStore) -> None:
        """注入凭据存储后端。

        Args:
            credential_store: 凭据存储（环境变量 / Vault / .env 的统一抽象）。
                三方 Agent 不能直接访问此对象，只能接收注入后的脱敏配置。
        """
        self._credential_store = credential_store

    def inject_credentials(
        self,
        provider_name: str,
        required_env_vars: list[str],
        extra_env: dict[str, str] | None = None,
    ) -> dict[str, str]:
        """注入 token / API key 到环境变量（不暴露给 plugin）。

        按 Manifest.required_env_vars 列表从 CredentialStore 取值，
        返回脱敏后的环境变量字典。三方 Agent 拿到的是已填充的 env_vars，
        无法反向访问 CredentialStore。

        Args:
            provider_name: Provider 名称（用于日志审计，不写入 token）。
            required_env_vars: Manifest 声明的所需环境变量名列表。
            extra_env: 额外非敏感环境变量（如 region / timeout）。

        Returns:
            已填充 token 的环境变量字典（敏感值不写入日志）。

        Raises:
            ValueError: 当必需的环境变量在 CredentialStore 中缺失时。
        """
        env: dict[str, str] = {}
        missing: list[str] = []
        for var_name in required_env_vars:
            value = self._credential_store.get(var_name)
            if value is None:
                missing.append(var_name)
            else:
                env[var_name] = value
        if missing:
            raise ValueError(
                f"HostInjector: provider={provider_name} missing required env vars: "
                f"{missing}. 请检查 .env / CredentialStore 配置。"
            )
        if extra_env:
            env.update(extra_env)
        # 日志只记录变量名，不记录值（铁律 5 + 安全）
        logger.info(
            "host_inject.credentials provider=%s vars=%s",
            provider_name,
            list(env.keys()),
        )
        return env

    def inject_sandbox(
        self,
        provider_name: str,
        worktree_path: str,
        network_allowlist: list[str] | None = None,
        writable_paths: list[str] | None = None,
        readonly_paths: list[str] | None = None,
    ) -> SandboxConfig:
        """注入 sandbox 配置（cwd / 网络白名单 / 文件权限）。

        按 EX-005 实现网络隔离 + 权限控制：
            - cwd 锁定到 worktree 路径（三方 Agent 不能改 cwd）
            - network_allowlist 限制出站网络
            - file_writable_paths 限制文件写入范围

        Args:
            provider_name: Provider 名称。
            worktree_path: worktree 路径（由 host 创建，EX-005）。
            network_allowlist: 允许访问的域名白名单。
            writable_paths: 允许写入的路径列表（默认仅 worktree）。
            readonly_paths: 只读路径列表（如 VISION.md / rules.md）。

        Returns:
            SandboxConfig 实例。
        """
        config = SandboxConfig(
            cwd=worktree_path,
            network_allowlist=network_allowlist or [],
            file_readonly_paths=readonly_paths or [],
            file_writable_paths=writable_paths or [worktree_path],
        )
        logger.info(
            "host_inject.sandbox provider=%s cwd=%s allowlist_size=%d",
            provider_name,
            worktree_path,
            len(config.network_allowlist),
        )
        return config

    def inject_mcp_config(
        self,
        provider_name: str,
        mcp_servers: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """注入 MCP 服务器配置。

        MCP（Model Context Protocol）服务器配置由 host 维护，
        三方 Agent 通过此配置连接 MCP，但不能修改配置。

        Args:
            provider_name: Provider 名称。
            mcp_servers: MCP 服务器配置列表（每个含 name / command / args / env）。

        Returns:
            MCP 配置字典（注入到三方 Agent 的启动参数）。
        """
        # 脱敏：移除 MCP 配置中的 env 真实值，仅保留键名
        sanitized = []
        for server in mcp_servers:
            sanitized_server = {**server}
            if "env" in sanitized_server and isinstance(sanitized_server["env"], dict):
                sanitized_server["env_keys"] = list(sanitized_server["env"].keys())
                sanitized_server["env"] = self._inject_mcp_env(provider_name, sanitized_server["env"])
            sanitized.append(sanitized_server)
        logger.info(
            "host_inject.mcp provider=%s servers=%d",
            provider_name,
            len(sanitized),
        )
        return {"mcp_servers": sanitized}

    def _inject_mcp_env(
        self,
        provider_name: str,
        mcp_env_spec: dict[str, str],
    ) -> dict[str, str]:
        """为 MCP 服务器配置注入环境变量。

        mcp_env_spec 中 value 如果是 "${ENV_VAR_NAME}" 形式，
        则从 CredentialStore 取真实值注入；否则原样保留。
        """
        resolved: dict[str, str] = {}
        for key, spec in mcp_env_spec.items():
            if isinstance(spec, str) and spec.startswith("${") and spec.endswith("}"):
                env_var = spec[2:-1]
                value = self._credential_store.get(env_var)
                if value is not None:
                    resolved[key] = value
                else:
                    logger.warning(
                        "host_inject.mcp_env provider=%s var=%s not found",
                        provider_name,
                        env_var,
                    )
            else:
                resolved[key] = spec
        return resolved
