"""Gate Registry — 门控配置注册中心，支持从 config/gates/ 自动加载 YAML 配置。"""

from pathlib import Path
from typing import Any, Optional

import yaml
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.gate.registry")


class GateDimensionConfig(BaseModel):
    """单个评估维度配置."""

    name: str
    weight: float = 1.0
    evaluator_agent: str | None = None
    evaluator: str | None = None
    threshold: float = 0.8
    required: bool = True
    description: str = ""


class GateOnRejectConfig(BaseModel):
    """门控拒绝策略配置."""

    action: str = "retry"  # retry | abort | escalate
    max_retries: int = 3
    retry_strategy: str = "reflexion"
    fallback: str = "escalate_to_human"


class GateConfig(BaseModel):
    """门控配置 — 从 YAML 文件加载."""

    name: str
    description: str = ""
    type: str = "automated"  # automated | manual | hybrid | technical | decision
    required: bool = True
    pass_threshold: float = 0.8
    dimensions: list[GateDimensionConfig] = Field(default_factory=list)
    voting_strategy: str = "weighted"  # weighted | consensus | majority
    veto_dimensions: list[str] = Field(default_factory=list)
    on_reject: GateOnRejectConfig | str = Field(default_factory=lambda: GateOnRejectConfig())
    human_required: bool = False
    timeout_seconds: int = 3600
    timeout_start_trigger: str = "gate_start"
    auto_pass_on_timeout: bool = False
    audit_log_required: bool = True
    max_retries: int = 3
    metadata: dict[str, Any] = Field(default_factory=dict)

    class Config:
        extra = "allow"


class GateRegistry:
    """门控配置注册中心 — 支持从 YAML 目录自动加载."""

    def __init__(self, config_dir: str | None = None):
        self._gates: dict[str, GateConfig] = {}
        logger.info(f"GateRegistry: 初始化, config_dir={config_dir}")
        if config_dir:
            self.load_from_dir(config_dir)

    def load_from_dir(self, dir_path: str | Path) -> int:
        """从目录加载所有 YAML 门控配置."""
        count = 0
        gates_path = Path(dir_path)
        if not gates_path.is_dir():
            # Try relative to workspace root
            workspace_root = Path.cwd()
            gates_path = workspace_root / dir_path
        if not gates_path.is_dir():
            logger.debug(f"GateRegistry: directory '{dir_path}' not found, skipping")
            return 0

        logger.info(f"GateRegistry: 开始从 '{gates_path}' 加载门控配置")
        yaml_files = sorted(gates_path.glob("*.y*ml"))
        logger.info(f"GateRegistry: 发现 {len(yaml_files)} 个 YAML 文件")

        for yaml_file in yaml_files:
            try:
                logger.info(f"GateRegistry: 正在加载 {yaml_file.name}")
                data = yaml.safe_load(yaml_file.read_text(encoding="utf-8"))
                if not data or "name" not in data:
                    logger.warning(f"GateRegistry: skipping {yaml_file}, missing 'name' field")
                    continue
                config = GateConfig(**data)
                self._gates[config.name] = config
                count += 1
                logger.info(f"GateRegistry: loaded gate '{config.name}' from {yaml_file.name}")
            except Exception as e:
                logger.warning(f"GateRegistry: failed to load gate from {yaml_file}: {e}")

        logger.info(f"GateRegistry: {count} gate(s) loaded from '{dir_path}'")
        return count

    def register(self, name: str, config: dict[str, Any] | GateConfig) -> None:
        """注册门控配置（兼容旧接口）."""
        if name in self._gates:
            logger.warning(f"GateRegistry: '{name}' already registered, overwriting")
        if isinstance(config, GateConfig):
            self._gates[name] = config
        else:
            # Ensure name is set correctly; avoid duplicate key if config already has 'name'
            cfg = dict(config)
            cfg["name"] = name
            self._gates[name] = GateConfig(**cfg)
        logger.info(f"GateRegistry: registered gate '{name}' (total: {len(self._gates)})")

    def get(self, name: str) -> Optional[GateConfig]:
        """获取门控配置."""
        config = self._gates.get(name)
        if config:
            logger.debug(f"GateRegistry: get gate '{name}' — found")
        else:
            logger.debug(f"GateRegistry: get gate '{name}' — not found")
        return config

    def list_gates(self) -> list[str]:
        """列出所有已注册的门控名称."""
        return list(self._gates.keys())

    def get_all(self) -> dict[str, GateConfig]:
        """获取所有门控配置."""
        return dict(self._gates)
