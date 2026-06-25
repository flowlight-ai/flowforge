"""Loop Registry — Loop 模板注册中心，从 config/loops/ 加载 YAML 模板。"""

from pathlib import Path
import yaml
from pydantic import BaseModel


class LoopTemplateConfig(BaseModel):
    """Loop 模板配置 — 从 YAML 文件加载。"""
    name: str
    description: str
    version: float = 1.0
    max_retries: int = 3
    timeout_per_iteration: int = 300
    total_timeout: int = 1800
    backoff_strategy: str = "exponential"
    backoff_base: int = 2
    planner: dict
    worker: dict
    verifier: dict
    reflector: dict
    memory: dict = {}


class LoopRegistry:
    """Loop 模板注册中心。"""

    def __init__(self, config_dir: str = "config/loops/"):
        self._templates: dict[str, LoopTemplateConfig] = {}
        self.load_from_dir(config_dir)

    def load_from_dir(self, dir_path: str) -> None:
        for yaml_file in Path(dir_path).glob("*.yaml"):
            config = yaml.safe_load(yaml_file.read_text(encoding="utf-8"))
            template = LoopTemplateConfig(**config)
            self._templates[template.name] = template

    def get(self, name: str) -> LoopTemplateConfig | None:
        return self._templates.get(name)

    def register(self, name: str, config: dict) -> None:
        """Register a loop template from a config dict.

        This enables compatibility with _scan_yaml_dir and the
        auto-discover plugin mechanism.
        """
        template = LoopTemplateConfig(**config)
        self._templates[template.name] = template

    def list_templates(self) -> list[str]:
        return list(self._templates.keys())
