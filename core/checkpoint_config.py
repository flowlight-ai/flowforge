"""统一检查点配置 — 跨项目规范。

将4个项目的检查点配置统一为标准格式：

    checkpoint:
      enabled: true
      backend: "sqlite"          # sqlite | memory | file
      path: "${config.data_dir}/checkpoints"
      every_n_steps: 5
      keep_latest: 10
      auto_restore: true
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field, field_validator

from flowforge.core.tracing import get_logger

logger = get_logger("checkpoint_config")


class CheckpointBackend(str, Enum):
    """检查点存储后端。"""

    SQLITE = "sqlite"
    MEMORY = "memory"
    FILE = "file"


class CheckpointConfig(BaseModel):
    """统一检查点配置模型。

    Attributes:
        enabled: 是否启用检查点。
        backend: 存储后端: sqlite | memory | file。
        path: 存储路径（sqlite 数据库文件路径或 file 目录路径）。
            支持变量引用: "${config.data_dir}/checkpoints"
        every_n_steps: 每隔 N 步自动保存一次检查点。
        keep_latest: 保留最近 N 个检查点版本，0 表示全部保留。
        auto_restore: 任务恢复时是否自动从最新检查点恢复。
        compress: 是否压缩存储（仅 file 后端）。
    """

    enabled: bool = Field(default=True, description="是否启用检查点")
    backend: CheckpointBackend = Field(
        default=CheckpointBackend.SQLITE,
        description="存储后端: sqlite | memory | file",
    )
    path: str = Field(
        default="data/checkpoints.db",
        description="存储路径，支持变量引用",
    )
    every_n_steps: int = Field(
        default=5,
        ge=1,
        description="每隔 N 步自动保存",
    )
    keep_latest: int = Field(
        default=10,
        ge=0,
        description="保留最近 N 个版本，0=全部保留",
    )
    auto_restore: bool = Field(
        default=True,
        description="是否自动从最新检查点恢复",
    )
    compress: bool = Field(
        default=False,
        description="是否压缩存储（仅 file 后端）",
    )

    model_config = {"extra": "allow"}

    def resolve_path(self, config: Optional[Dict[str, Any]] = None) -> str:
        """解析路径中的变量引用。

        将 ${config.data_dir}/checkpoints 替换为实际值。

        Args:
            config: 系统配置字典，用于解析 ${config.xxx} 引用。

        Returns:
            解析后的路径字符串。
        """
        import re

        resolved = self.path
        if config and "${config." in resolved:
            def _replace(match: re.Match) -> str:
                key = match.group(1)
                value = config.get(key, match.group(0))
                return str(value)
            resolved = re.sub(r'\$\{config\.(\w+)\}', _replace, resolved)
        return resolved

    def to_checkpoint_manager_kwargs(self, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """转换为 CheckpointManager 构造参数。

        Args:
            config: 系统配置字典，用于路径解析。

        Returns:
            适合传给 CheckpointManager 的参数字典。
        """
        return {
            "db_path": self.resolve_path(config),
        }


# ── 预定义配置模板 ────────────────────────────────────────────

CHECKPOINT_TEMPLATES: Dict[str, CheckpointConfig] = {
    "default": CheckpointConfig(),
    "lightweight": CheckpointConfig(
        enabled=True,
        backend=CheckpointBackend.MEMORY,
        every_n_steps=10,
        keep_latest=5,
    ),
    "durable": CheckpointConfig(
        enabled=True,
        backend=CheckpointBackend.SQLITE,
        every_n_steps=3,
        keep_latest=20,
        auto_restore=True,
    ),
    "development": CheckpointConfig(
        enabled=True,
        backend=CheckpointBackend.SQLITE,
        path="data/dev_checkpoints.db",
        every_n_steps=1,
        keep_latest=50,
        auto_restore=True,
    ),
    "production": CheckpointConfig(
        enabled=True,
        backend=CheckpointBackend.SQLITE,
        path="${config.data_dir}/checkpoints.db",
        every_n_steps=5,
        keep_latest=10,
        auto_restore=True,
    ),
}


def get_checkpoint_config(name: str = "default") -> CheckpointConfig:
    """获取预定义检查点配置模板。

    Args:
        name: 配置名称: default | lightweight | durable | development | production

    Returns:
        对应的 CheckpointConfig 实例。未知名称返回 default。
    """
    config = CHECKPOINT_TEMPLATES.get(name)
    if config is None:
        logger.warning(f"Unknown checkpoint template '{name}', using 'default'")
        return CheckpointConfig()
    return config.model_copy()


def checkpoint_config_from_dict(config: Dict[str, Any]) -> CheckpointConfig:
    """从配置字典创建 CheckpointConfig。

    支持 template 字段指定预定义模板，再用配置字段覆盖。

    Args:
        config: 配置字典，如:
            {"template": "durable", "every_n_steps": 3}

    Returns:
        配置好的 CheckpointConfig 实例。
    """
    template_name = config.pop("template", "default") if isinstance(config, dict) else "default"
    base = get_checkpoint_config(template_name)
    override = {k: v for k, v in config.items() if v is not None}
    if not override:
        return base
    return base.model_copy(update=override)
