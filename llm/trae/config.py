"""Trae LLM Provider 配置.

通过 Pydantic 模型定义 Trae LLM 客户端的所有配置项，
支持从环境变量加载，遵循铁律5（禁止硬编码路径/密钥）。

三种工作模式：
- cli: 通过命令行调用 trae CLI（未来 trae CLI 可用时）
- bridge: 通过文件桥接，devforge 写任务到文件，Trae AI 读取并写回响应（当前主模式）
- api: 通过 HTTP API 调用（未来 trae API 可用时）
"""

from __future__ import annotations

import os
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class TraeConfig(BaseSettings):
    """Trae LLM 客户端配置.

    所有路径和密钥均从环境变量读取，禁止硬编码（铁律5）。
    """

    mode: str = Field(
        default="bridge",
        description="工作模式: cli | bridge | api",
    )

    # ── CLI 模式配置 ────────────────────────────────────────────────
    cli_command: str = Field(
        default="trae",
        description="CLI 模式的命令名",
    )
    cli_args: List[str] = Field(
        default_factory=lambda: ["--print", "--output-format", "json"],
        description="CLI 模式的参数列表",
    )

    # ── Bridge 模式配置 ─────────────────────────────────────────────
    bridge_dir: str = Field(
        default="data/trae_bridge",
        description="桥接模式的任务/响应目录（相对路径，基于项目根）",
    )
    bridge_timeout: int = Field(
        default=300,
        description="桥接模式超时秒数",
        ge=1,
    )
    bridge_poll_interval: int = Field(
        default=2,
        description="轮询响应文件的间隔秒数",
        ge=1,
    )

    # ── API 模式配置 ────────────────────────────────────────────────
    api_url: str = Field(
        default="",
        description="API 模式的 URL",
    )
    api_key: str = Field(
        default="",
        description="API 模式的 key（从环境变量 TRAE_API_KEY 读取）",
    )

    # ── 通用配置 ────────────────────────────────────────────────────
    default_model: str = Field(
        default="trae",
        description="默认模型名",
    )
    max_retries: int = Field(
        default=3,
        description="最大重试次数",
        ge=0,
    )
    timeout: int = Field(
        default=120,
        description="单次调用超时秒数",
        ge=1,
    )
    session_persistence: bool = Field(
        default=True,
        description="是否保持会话上下文",
    )

    model_config = {
        "env_prefix": "TRAE_LLM_",
        "env_file": ".env",
        "extra": "ignore",
        "case_sensitive": False,
    }

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, v: str) -> str:
        allowed = {"cli", "bridge", "api"}
        if v not in allowed:
            raise ValueError(f"mode 必须是 {allowed} 之一，得到: {v}")
        return v

    def __init__(self, **data):
        """初始化，支持从 TRAE_ 前缀环境变量读取覆盖配置.

        环境变量映射（不带 TRAE_LLM_ 前缀的兼容变量）：
        - TRAE_LLM_MODE: 模式
        - TRAE_CLI_COMMAND: CLI 命令
        - TRAE_BRIDGE_DIR: 桥接目录
        - TRAE_API_URL: API URL
        - TRAE_API_KEY: API key
        """
        # 兼容不带 _ 前缀的环境变量名
        env_map = {
            "mode": ("TRAE_LLM_MODE", "TRAE_MODE"),
            "cli_command": ("TRAE_CLI_COMMAND", "TRAE_LLM_CLI_COMMAND"),
            "bridge_dir": ("TRAE_BRIDGE_DIR", "TRAE_LLM_BRIDGE_DIR"),
            "api_url": ("TRAE_API_URL", "TRAE_LLM_API_URL"),
            "api_key": ("TRAE_API_KEY", "TRAE_LLM_API_KEY"),
        }
        for field_name, env_keys in env_map.items():
            if field_name not in data:
                for env_key in env_keys:
                    val = os.environ.get(env_key)
                    if val:
                        data[field_name] = val
                        break
        super().__init__(**data)

    @property
    def bridge_tasks_dir(self) -> str:
        """桥接模式的任务文件目录."""
        return f"{self.bridge_dir}/tasks"

    @property
    def bridge_responses_dir(self) -> str:
        """桥接模式的响应文件目录."""
        return f"{self.bridge_dir}/responses"
