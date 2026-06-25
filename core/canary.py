"""Canary Deployment Framework — 金丝雀发布框架.

提供渐进式发布、健康检查、自动回滚的金丝雀部署能力。
通过 YAML 配置驱动，无需编写代码即可使用。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

import yaml
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.canary")


class CanaryStageConfig(BaseModel):
    """金丝雀阶段配置."""
    percentage: int = 10
    duration_seconds: int = 300
    health_check_url: str | None = None
    success_threshold: float = 0.99
    error_rate_threshold: float = 0.01
    latency_p99_threshold_ms: int = 2000


class CanaryDeploymentConfig(BaseModel):
    """金丝雀部署配置 — 从 YAML 文件加载."""
    name: str
    description: str = ""
    enabled: bool = True
    stages: list[CanaryStageConfig] = Field(default_factory=lambda: [
        CanaryStageConfig(percentage=10, duration_seconds=300),
        CanaryStageConfig(percentage=50, duration_seconds=300),
        CanaryStageConfig(percentage=100, duration_seconds=0),
    ])
    auto_rollback: bool = True
    rollback_on_error_rate: float = 0.05
    rollback_on_latency_multiplier: float = 2.0
    health_check_interval_seconds: int = 30
    health_check_timeout_seconds: int = 10
    observation_seconds: int = 300
    metadata: dict[str, Any] = Field(default_factory=dict)

    class Config:
        extra = "allow"


class CanaryDeploymentRegistry:
    """金丝雀部署配置注册中心 — 支持从 YAML 目录自动加载."""

    def __init__(self, config_dir: str | None = None):
        self._configs: dict[str, CanaryDeploymentConfig] = {}
        if config_dir:
            self.load_from_dir(config_dir)

    def load_from_dir(self, dir_path: str | Path) -> int:
        """从目录加载所有金丝雀部署配置."""
        count = 0
        canary_path = Path(dir_path)
        if not canary_path.is_dir():
            workspace_root = Path.cwd()
            canary_path = workspace_root / dir_path
        if not canary_path.is_dir():
            logger.debug(f"CanaryDeploymentRegistry: directory '{dir_path}' not found, skipping")
            return 0

        for yaml_file in sorted(canary_path.glob("*.y*ml")):
            try:
                data = yaml.safe_load(yaml_file.read_text(encoding="utf-8"))
                if not data or "name" not in data:
                    logger.warning(f"CanaryDeploymentRegistry: skipping {yaml_file}, missing 'name'")
                    continue
                config = CanaryDeploymentConfig(**data)
                self._configs[config.name] = config
                count += 1
                logger.info(f"CanaryDeploymentRegistry: loaded '{config.name}' from {yaml_file.name}")
            except Exception as e:
                logger.warning(f"CanaryDeploymentRegistry: failed to load from {yaml_file}: {e}")

        logger.info(f"CanaryDeploymentRegistry: {count} config(s) loaded from '{dir_path}'")
        return count

    def register(self, name: str, config: dict[str, Any] | CanaryDeploymentConfig) -> None:
        """注册金丝雀部署配置."""
        if isinstance(config, CanaryDeploymentConfig):
            self._configs[name] = config
        else:
            self._configs[name] = CanaryDeploymentConfig(name=name, **config)

    def get(self, name: str) -> Optional[CanaryDeploymentConfig]:
        return self._configs.get(name)

    def list_deployments(self) -> list[str]:
        return list(self._configs.keys())

    def get_all(self) -> dict[str, CanaryDeploymentConfig]:
        return dict(self._configs)
