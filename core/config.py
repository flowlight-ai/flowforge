import os
import copy
import yaml
from pathlib import Path
from typing import Any, Dict, Optional
from pydantic_settings import BaseSettings


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Deep merge override into base. Override values take precedence.

    List merging strategy:
    - Lists of simple values (str/int/float): concatenate and deduplicate.
    - Lists of dicts with an ``id`` key: merge by id — override replaces
      matching items, new items are appended.
    - Other lists: concatenate.
    """
    result = copy.deepcopy(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        elif key in result and isinstance(result[key], list) and isinstance(value, list):
            result[key] = _merge_lists(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def _merge_lists(base_list: list, override_list: list) -> list:
    """Merge two lists with smart deduplication.

    - If items are dicts with an ``id`` key, merge by id.
    - If items are simple values, deduplicate while preserving order.
    - Otherwise, concatenate.
    """
    if not base_list:
        return copy.deepcopy(override_list)
    if not override_list:
        return copy.deepcopy(base_list)

    # Detect list-of-dicts-with-id
    if (
        isinstance(base_list[0], dict)
        and "id" in base_list[0]
        and isinstance(override_list[0], dict)
        and "id" in override_list[0]
    ):
        return _merge_list_of_dicts_by_id(base_list, override_list)

    # Detect list of simple values (str/int/float/bool)
    if all(isinstance(v, (str, int, float, bool)) for v in base_list) and all(
        isinstance(v, (str, int, float, bool)) for v in override_list
    ):
        seen = set()
        merged: list = []
        for v in base_list + override_list:
            if v not in seen:
                seen.add(v)
                merged.append(v)
        return merged

    # Fallback: concatenate
    return copy.deepcopy(base_list) + copy.deepcopy(override_list)


def _merge_list_of_dicts_by_id(base_list: list, override_list: list) -> list:
    """Merge lists of dicts sharing an ``id`` key. Override replaces by id."""
    base_by_id = {item["id"]: item for item in base_list}
    override_by_id = {item["id"]: item for item in override_list}

    # Start with base order, apply overrides, then append new items
    merged: list = []
    for item in base_list:
        item_id = item["id"]
        if item_id in override_by_id:
            merged.append(copy.deepcopy(override_by_id[item_id]))
        else:
            merged.append(copy.deepcopy(item))

    # Append items that only exist in override
    for item in override_list:
        if item["id"] not in base_by_id:
            merged.append(copy.deepcopy(item))

    return merged


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
    mcp_server_enabled: bool = False
    mcp_server_port: int = 9000

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


class ConfigLoader:
    """Configuration loader with extends/override support.

    Business projects can use ``extends`` in their default.yaml to inherit
    from flowforge's base config and only override the differences:

        # contentforge/config/default.yaml
        extends: "flowforge/config/default.yaml"
        system:
          db_url: "sqlite:///data/contentforge.db"
          server_port: 8001
        contentforge:
          default_persona: "education"
    """

    FLOWFORGE_ROOT: Path  # set below after module load

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
            data = yaml.safe_load(f) or {}

        # Resolve extends
        extends = data.pop("extends", None)
        if extends:
            base_data = self._load_extends(extends)
            data = _deep_merge(base_data, data)
        return data

    def _load_extends(self, extends_path: str) -> Dict[str, Any]:
        """Load a base config from an absolute or relative path."""
        p = Path(extends_path)
        if not p.is_absolute():
            # Resolve relative to flowforge package root
            p = self.FLOWFORGE_ROOT / extends_path
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                base = yaml.safe_load(f) or {}
            # Recursively resolve extends in base
            base_extends = base.pop("extends", None)
            if base_extends:
                parent = self._load_extends(base_extends)
                base = _deep_merge(parent, base)
            return base
        return {}

    def save_yaml(self, filename: str, data: Dict[str, Any]):
        file_path = self.config_dir / filename
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    def get_models_config(self) -> Dict[str, Any]:
        return self.load_yaml("models.yaml")


# Set flowforge root (parent of core/)
ConfigLoader.FLOWFORGE_ROOT = Path(__file__).parent.parent

system_config = SystemConfig()
