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
        """桥接模式的任务文件目录（向后兼容，等同于 requests_dir）."""
        return f"{self.bridge_dir}/tasks"

    @property
    def bridge_responses_dir(self) -> str:
        """桥接模式的响应文件目录."""
        return f"{self.bridge_dir}/responses"


# ── TraeBridgeConfig — F045 §2.2 桥接配置（对应 trae_bridge.yaml）──


class TraeBridgeConfig(BaseSettings):
    """Trae 桥接协议配置 — F045 §2.2 + §2.3 不变量.

    对应 flowforge/config/trae_bridge.yaml 配置文件。
    支持：
    - 从 YAML 文件加载（load_from_yaml 类方法）
    - 环境变量覆盖（FLOWFORGE_BRIDGE_* 前缀）
    - ${ENV_VAR:default} 占位符展开（不变量 6 路径不硬编码）

    与 TraeConfig 的关系：
    - TraeConfig 是 LLM 客户端配置（mode/api_url/api_key 等）
    - TraeBridgeConfig 是桥接协议配置（目录/超时/归档等）
    - TraeLLMClient 同时使用两者：TraeConfig 决定模式，TraeBridgeConfig 决定桥接细节
    """

    # ── 基础开关 ────────────────────────────────────────────────────
    enabled: bool = Field(
        default=True,
        description="是否启用桥接（false 时 chat 直接抛 TraeBridgeConfigError）",
    )

    # ── 目录配置（不变量 6 路径不硬编码）───────────────────────────
    shared_dir: str = Field(
        default="d:/software/openclaw/flowforge/.trae_bridge",
        description="共享目录路径（支持 ${ENV_VAR:default} 占位符）",
    )
    requests_dir: str = Field(
        default="requests",
        description="请求文件子目录名（request_{uuid}.json）",
    )
    responses_dir: str = Field(
        default="responses",
        description="响应文件子目录名（response_{uuid}.json）",
    )
    cancels_dir: str = Field(
        default="cancels",
        description="取消文件子目录名（cancel_{uuid}.json，不变量 8 逃生舱）",
    )
    acks_dir: str = Field(
        default="acks",
        description="确认文件子目录名（ack_{uuid}.json，可选）",
    )
    archive_dir: str = Field(
        default="archive",
        description="归档子目录名（不变量 4 不丢数据）",
    )

    # ── 轮询与超时（不变量 3 超时保证）─────────────────────────────
    poll_interval_seconds: float = Field(
        default=2.0,
        ge=0.5,
        description="轮询响应文件间隔秒数（最小 0.5）",
    )
    default_timeout_seconds: int = Field(
        default=300,
        ge=1,
        description="默认超时秒数（5 分钟）",
    )
    long_task_timeout_seconds: int = Field(
        default=1800,
        ge=1,
        description="长任务超时秒数（30 分钟，文档生成等）",
    )
    ack_timeout_seconds: int = Field(
        default=60,
        ge=0,
        description="等待 operator ack 的超时秒数（0=不等待）",
    )

    # ── 归档机制（不变量 4 不丢数据）───────────────────────────────
    archive_completed: bool = Field(
        default=True,
        description="完成的请求是否归档到 archive/",
    )
    max_archive_files: int = Field(
        default=1000,
        ge=1,
        description="归档目录最大文件数（超过自动清理最旧）",
    )
    cleanup_on_startup: bool = Field(
        default=False,
        description="启动时清理遗留 pending 请求（标记为 timeout）",
    )

    # ── 状态总览 ───────────────────────────────────────────────────
    update_status_on_write: bool = Field(
        default=True,
        description="写入 request 时是否更新 status.json",
    )
    update_status_on_complete: bool = Field(
        default=True,
        description="完成响应时是否更新 status.json",
    )

    # ── 流式响应（F045 §2.1 双向通信支持，预留）────────────────────
    stream_enabled: bool = Field(
        default=False,
        description="是否启用流式响应（Phase 3 实现）",
    )
    stream_chunk_interval: float = Field(
        default=0.5,
        ge=0.1,
        description="流式轮询间隔秒数",
    )

    # ── 健康检查 ───────────────────────────────────────────────────
    health_check_on_init: bool = Field(
        default=True,
        description="初始化时检查目录可写性",
    )

    model_config = {
        "env_prefix": "FLOWFORGE_BRIDGE_",
        "env_file": ".env",
        "extra": "ignore",
        "case_sensitive": False,
    }

    @classmethod
    def load_from_yaml(cls, yaml_path: str) -> TraeBridgeConfig:
        """从 trae_bridge.yaml 加载配置.

        支持 ${ENV_VAR:default} 占位符展开（不变量 6 路径不硬编码）。

        Args:
            yaml_path: trae_bridge.yaml 文件路径

        Returns:
            TraeBridgeConfig 实例
        """
        import os
        import re

        try:
            with open(yaml_path, "r", encoding="utf-8") as f:
                raw = f.read()
        except FileNotFoundError:
            # 配置文件不存在时使用默认值
            return cls()

        # 展开 ${ENV_VAR:default} 占位符
        def _expand(match: re.Match) -> str:
            expr = match.group(1)
            if ":" in expr:
                env_key, default = expr.split(":", 1)
                return os.environ.get(env_key.strip(), default.strip())
            return os.environ.get(expr.strip(), "")

        raw = re.sub(r"\$\{([^}]+)\}", _expand, raw)

        try:
            import yaml

            data = yaml.safe_load(raw) or {}
        except Exception:
            data = {}

        bridge_data = data.get("bridge", {})
        # 环境变量优先级高于 YAML（pydantic-settings 自动处理）
        return cls(**bridge_data)

    @property
    def requests_path(self) -> str:
        """请求文件完整目录路径."""
        return f"{self.shared_dir}/{self.requests_dir}"

    @property
    def responses_path(self) -> str:
        """响应文件完整目录路径."""
        return f"{self.shared_dir}/{self.responses_dir}"

    @property
    def cancels_path(self) -> str:
        """取消文件完整目录路径."""
        return f"{self.shared_dir}/{self.cancels_dir}"

    @property
    def acks_path(self) -> str:
        """确认文件完整目录路径."""
        return f"{self.shared_dir}/{self.acks_dir}"

    @property
    def archive_path(self) -> str:
        """归档文件完整目录路径."""
        return f"{self.shared_dir}/{self.archive_dir}"

    @property
    def status_file(self) -> str:
        """状态总览文件完整路径."""
        return f"{self.shared_dir}/status.json"
