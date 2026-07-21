"""Cross-platform configuration loader.

Resolution order for each config key:
1. Environment variable FLOWFORGE_<UPPER_KEY>
2. Explicit value in YAML at <config_dir>/<name>.yaml
3. Default value provided by caller

Config files are searched at:
1. FLOWFORGE_CONFIG_DIR env var
2. <project_root>/config/ (project_root = parent of flowforge package)
3. <cwd>/config/
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

from flowforge.core.errors import ConfigError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.config")

_ENV_PREFIX = "FLOWFORGE_"


def _candidate_config_dirs() -> list[Path]:
    dirs: list[Path] = []
    env_dir = os.environ.get("FLOWFORGE_CONFIG_DIR")
    if env_dir:
        dirs.append(Path(env_dir).expanduser())
    # flowforge/core/config.py → flowforge/ → <project_root>/
    project_root = Path(__file__).resolve().parent.parent.parent
    dirs.append(project_root / "config")
    dirs.append(Path.cwd() / "config")
    return dirs


def resolve_config_path(name: str) -> Path | None:
    """Find <name>.yaml in any candidate config dir. Returns None if missing."""
    if not name.endswith((".yaml", ".yml")):
        name = f"{name}.yaml"
    for d in _candidate_config_dirs():
        candidate = d / name
        if candidate.is_file():
            return candidate
    return None


class ConfigLoader:
    """Loads YAML config files with env-var override.

    Each loader instance caches loaded files. Use reload() to invalidate.
    """

    def __init__(self) -> None:
        self._cache: dict[str, dict[str, Any]] = {}

    def load(self, name: str) -> dict[str, Any]:
        """Load <name>.yaml and apply env var overrides. Returns empty dict if absent."""
        if name in self._cache:
            return self._cache[name]

        path = resolve_config_path(name)
        if path is None:
            logger.debug(f"config not found: {name} (searched {_candidate_config_dirs()})")
            self._cache[name] = {}
            return {}

        try:
            with path.open("r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        except yaml.YAMLError as exc:
            raise ConfigError(f"Failed to parse {path}: {exc}") from exc

        if not isinstance(data, dict):
            raise ConfigError(f"Config {path} must be a YAML mapping at top level")

        data = self._apply_env_overrides(name, data)
        self._cache[name] = data
        logger.debug(f"config loaded: {name} ({len(data)} keys) from {path}")
        return data

    def _apply_env_overrides(self, name: str, data: dict[str, Any]) -> dict[str, Any]:
        """FLOWFORGE_<NAME>_<KEY> overrides data[KEY] (top-level only)."""
        prefix = f"{_ENV_PREFIX}{name.upper()}_"
        for env_key, env_val in os.environ.items():
            if not env_key.startswith(prefix):
                continue
            field = env_key[len(prefix) :].lower()
            if field:
                data[field] = self._coerce(env_val)
        return data

    @staticmethod
    def _coerce(raw: str) -> Any:
        """Coerce env string to int/float/bool/str (best-effort)."""
        low = raw.lower()
        if low in {"true", "yes", "1"}:
            return True
        if low in {"false", "no", "0"}:
            return False
        try:
            return int(raw)
        except ValueError:
            pass
        try:
            return float(raw)
        except ValueError:
            pass
        return raw

    def reload(self, name: str | None = None) -> None:
        if name is None:
            self._cache.clear()
        else:
            self._cache.pop(name, None)

    def get(self, name: str, key: str, default: Any = None) -> Any:
        return self.load(name).get(key, default)


# Process-wide default loader
_default_loader: ConfigLoader | None = None


def get_config(name: str) -> dict[str, Any]:
    """Convenience: load <name>.yaml via the default ConfigLoader."""
    global _default_loader
    if _default_loader is None:
        _default_loader = ConfigLoader()
    return _default_loader.load(name)
