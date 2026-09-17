"""Feature Flags 机制 — 支持新旧路径切换、灰度发布、A-B验证

设计文档参考：spec.md v2.2 FeatureFlag数据结构
"""
from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

import yaml


class SwitchStrategy(str, Enum):
    FEATURE_FLAG = "feature_flag"
    AB_PARALLEL = "ab_parallel"
    HARD_SWITCH = "hard_switch"


@dataclass
class FeatureFlag:
    name: str
    enabled: bool = False
    rollout_percentage: int = 0
    allowed_projects: List[str] = field(default_factory=list)
    fallback_to_old: bool = True
    switch_strategy: SwitchStrategy = SwitchStrategy.FEATURE_FLAG
    created_at: float = field(default_factory=time.time)
    expires_at: Optional[float] = None
    description: str = ""


class FeatureFlagManager:
    """Feature Flag 管理器"""

    def __init__(self, config_path: Optional[str] = None):
        self._flags: Dict[str, FeatureFlag] = {}
        if config_path:
            self.load_from_yaml(config_path)

    def load_from_yaml(self, path: str) -> None:
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        features = data.get("features", {})
        for name, config in features.items():
            if isinstance(config, bool):
                self._flags[name] = FeatureFlag(name=name, enabled=config)
            elif isinstance(config, dict):
                self._flags[name] = FeatureFlag(
                    name=name,
                    enabled=config.get("enabled", False),
                    rollout_percentage=config.get("rollout_percentage", 0),
                    allowed_projects=config.get("allowed_projects", []),
                    fallback_to_old=config.get("fallback_to_old", True),
                    switch_strategy=SwitchStrategy(config.get("switch_strategy", "feature_flag")),
                    description=config.get("description", ""),
                )

    def is_enabled(self, name: str, project: Optional[str] = None) -> bool:
        flag = self._flags.get(name)
        if flag is None:
            return False
        if not flag.enabled:
            return False
        if flag.allowed_projects and project:
            if project not in flag.allowed_projects:
                return False
        if flag.rollout_percentage < 100:
            hash_val = int(hashlib.md5(f"{name}:{project or 'default'}".encode()).hexdigest(), 16)
            if (hash_val % 100) >= flag.rollout_percentage:
                return False
        if flag.expires_at and time.time() > flag.expires_at:
            return True
        return True

    def get_flag(self, name: str) -> Optional[FeatureFlag]:
        return self._flags.get(name)

    def set_flag(self, name: str, enabled: bool) -> None:
        if name in self._flags:
            self._flags[name].enabled = enabled
        else:
            self._flags[name] = FeatureFlag(name=name, enabled=enabled)

    def should_fallback(self, name: str) -> bool:
        flag = self._flags.get(name)
        return flag.fallback_to_old if flag else True

    def all_flags(self) -> Dict[str, FeatureFlag]:
        return dict(self._flags)
