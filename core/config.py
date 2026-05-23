import os
import yaml
from pathlib import Path
from typing import Any, Dict, Optional
from pydantic_settings import BaseSettings


class SystemConfig(BaseSettings):
    db_url: str = "sqlite:///data/flowforge.db"
    checkpointer_url: str = "sqlite:///data/checkpoints.db"
    log_level: str = "INFO"
    log_file: str = "logs/flowforge.log"
    log_format: str = "json"
    server_host: str = "0.0.0.0"
    server_port: int = 8000
    workers: int = 1
    secret_key: str = "changeme-in-production"
    opensieve_enabled: bool = True
    opensieve_endpoint: str = "http://localhost:18001/api/v1/retrieve"
    opensieve_timeout: int = 90
    scheduler_enabled: bool = True
    scheduler_timezone: str = "Asia/Shanghai"
    metrics_enabled: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


class ConfigLoader:
    def __init__(self, config_dir: Optional[Path] = None):
        if config_dir is None:
            self.config_dir = Path(__file__).parent.parent / "config"
        else:
            self.config_dir = config_dir

    def load_yaml(self, filename: str) -> Dict[str, Any]:
        file_path = self.config_dir / filename
        if not file_path.exists():
            return {}
        with open(file_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def save_yaml(self, filename: str, data: Dict[str, Any]):
        file_path = self.config_dir / filename
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    def get_models_config(self) -> Dict[str, Any]:
        return self.load_yaml("models.yaml")


system_config = SystemConfig()
