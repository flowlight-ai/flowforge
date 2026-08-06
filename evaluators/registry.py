"""Evaluator Registry — 评估器配置注册中心，支持从 config/evaluators/ 自动加载 YAML 配置。"""

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.evaluators.registry")


class ScoringRule(BaseModel):
    """评分规则."""
    field: str  # submission 中的字段名
    weight: float = 1.0
    present_score: float = 1.0  # 字段存在时的分数
    absent_score: float = 0.0  # 字段不存在时的分数
    threshold: float | None = None  # 可选阈值


class EvaluatorConfig(BaseModel):
    """评估器配置 — 从 YAML 文件加载."""
    name: str
    description: str = ""
    dimension: str  # 评估维度名称
    evaluator_agent: str = ""  # 对应的 EvaluatorAgent 类名
    scoring_rules: list[ScoringRule] = Field(default_factory=list)
    default_score: float = 0.0
    default_confidence: float = 0.0
    weight: float = 1.0  # 在 gate 中的权重
    threshold: float = 0.8  # 通过阈值
    metadata: dict[str, Any] = Field(default_factory=dict)

    class Config:
        extra = "allow"


class EvaluatorRegistry:
    """评估器配置注册中心 — 支持从 YAML 目录自动加载."""

    def __init__(self, config_dir: str | None = None):
        self._configs: dict[str, EvaluatorConfig] = {}
        self._instances: dict[str, Any] = {}  # 缓存 evaluator 实例
        if config_dir:
            self.load_from_dir(config_dir)

    def load_from_dir(self, dir_path: str | Path) -> int:
        """从目录加载所有 YAML 评估器配置."""
        count = 0
        eval_path = Path(dir_path)
        if not eval_path.is_dir():
            workspace_root = Path.cwd()
            eval_path = workspace_root / dir_path
        if not eval_path.is_dir():
            logger.debug(f"EvaluatorRegistry: directory '{dir_path}' not found, skipping")
            return 0

        for yaml_file in sorted(eval_path.glob("*.y*ml")):
            try:
                data = yaml.safe_load(yaml_file.read_text(encoding="utf-8"))
                if not data or "name" not in data:
                    logger.warning(f"EvaluatorRegistry: skipping {yaml_file}, missing 'name' field")
                    continue
                config = EvaluatorConfig(**data)
                self._configs[config.name] = config
                count += 1
                logger.info(f"EvaluatorRegistry: loaded evaluator '{config.name}' from {yaml_file.name}")
            except Exception as e:
                logger.warning(f"EvaluatorRegistry: failed to load evaluator from {yaml_file}: {e}")

        logger.info(f"EvaluatorRegistry: {count} evaluator(s) loaded from '{dir_path}'")
        return count

    def register(self, name: str, evaluator: Any) -> None:
        """注册评估器（兼容旧接口，支持配置字典或实例）."""
        if isinstance(evaluator, dict):
            if "name" not in evaluator:
                evaluator["name"] = name
            self._configs[name] = EvaluatorConfig(**evaluator)
        elif isinstance(evaluator, EvaluatorConfig):
            self._configs[name] = evaluator
        else:
            # Evaluator 实例
            self._instances[name] = evaluator
        logger.info(f"EvaluatorRegistry: registered evaluator '{name}'")

    def get(self, name: str) -> EvaluatorConfig | Any | None:
        """获取评估器配置或实例."""
        if name in self._instances:
            return self._instances[name]
        return self._configs.get(name)

    def get_config(self, name: str) -> EvaluatorConfig | None:
        """获取评估器配置."""
        return self._configs.get(name)

    def list_evaluators(self) -> list[str]:
        """列出所有已注册的评估器名称."""
        return list(set(list(self._configs.keys()) + list(self._instances.keys())))

    def get_all_configs(self) -> dict[str, EvaluatorConfig]:
        """获取所有评估器配置."""
        return dict(self._configs)
