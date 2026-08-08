"""配置版本控制 — 版本管理和向后兼容

支持配置文件的版本声明、迁移和向后兼容检查。
当配置格式发生变更时，通过迁移链自动升级旧版本配置。

使用方式：
    manager = ConfigVersionManager()

    # 检查版本
    version = manager.check_version(config_dict)

    # 判断是否需要迁移
    if manager.needs_migration(config_dict):
        config_dict = manager.migrate(config_dict)

    # 保存带版本号的配置
    manager.save_with_version(config_loader, "agents/my_agent.yaml", config_dict)
"""
import warnings
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class CompatibilityLevel(str, Enum):
    """兼容性级别"""
    MAJOR = "major"      # 破坏性变更，不向后兼容
    MINOR = "minor"      # 新增功能，向后兼容
    PATCH = "patch"      # Bug 修复，完全兼容


class ConfigVersion(BaseModel):
    """配置版本信息"""
    version: str = "1.0.0"
    compatibility: CompatibilityLevel = CompatibilityLevel.MINOR
    changelog: List[str] = Field(default_factory=list)
    deprecated_keys: Dict[str, str] = Field(default_factory=dict)  # key -> migration_guide
    renamed_keys: Dict[str, str] = Field(default_factory=dict)     # old_key -> new_key


class ConfigVersionManager:
    """配置版本管理器

    维护配置版本迁移链，支持：
    - 版本检查
    - 自动迁移
    - 废弃 key 警告
    - 重命名 key 映射
    """

    CURRENT_VERSION = "2.0.0"

    MIGRATIONS: Dict[str, Dict[str, Any]] = {
        "1.0.0": {
            "target": "1.1.0",
            "compatibility": CompatibilityLevel.MINOR,
            "changelog": ["Renamed 'mode' to 'default_mode', 'prompt' to 'system_prompt'"],
            "renamed_keys": {
                "mode": "default_mode",
                "prompt": "system_prompt",
            },
            "deprecated_keys": {},
        },
        "1.1.0": {
            "target": "2.0.0",
            "compatibility": CompatibilityLevel.MAJOR,
            "changelog": [
                "Renamed 'context_injection' to 'input_mapping'",
                "Renamed 'handoffs' to 'next_agents'",
                "Deprecated 'base_agent_class'",
            ],
            "renamed_keys": {
                "context_injection": "input_mapping",
                "handoffs": "next_agents",
            },
            "deprecated_keys": {
                "base_agent_class": "Use declarative agent YAML instead",
            },
        },
    }

    def check_version(self, config: dict) -> ConfigVersion:
        """检查配置版本

        Args:
            config: 配置字典

        Returns:
            ConfigVersion 信息
        """
        version = config.get("version", "1.0.0")
        return ConfigVersion(version=version)

    def needs_migration(self, config: dict) -> bool:
        """判断配置是否需要迁移

        Args:
            config: 配置字典

        Returns:
            是否需要迁移
        """
        version = config.get("version", "1.0.0")
        return version != self.CURRENT_VERSION

    def migrate(self, config: dict) -> dict:
        """迁移配置到最新版本

        沿迁移链逐步升级，每步处理重命名和废弃 key。
        迁移完成后更新 version 字段。

        Args:
            config: 旧版本配置字典

        Returns:
            迁移后的配置字典
        """
        import copy

        config = copy.deepcopy(config)
        version = config.get("version", "1.0.0")

        max_steps = len(self.MIGRATIONS) + 1  # 防止无限循环
        for _ in range(max_steps):
            if version == self.CURRENT_VERSION:
                break

            migration = self.MIGRATIONS.get(version)
            if not migration:
                # 无法找到迁移路径，停止
                break

            # 应用重命名
            for old_key, new_key in migration.get("renamed_keys", {}).items():
                if old_key in config:
                    config[new_key] = config.pop(old_key)

            # 标记废弃
            for key, guide in migration.get("deprecated_keys", {}).items():
                if key in config:
                    warnings.warn(
                        f"Config key '{key}' is deprecated: {guide}",
                        DeprecationWarning,
                        stacklevel=2,
                    )

            version = migration["target"]
            config["version"] = version

        return config

    def get_migration_path(self, from_version: str) -> List[str]:
        """获取从指定版本到最新版本的迁移路径

        Args:
            from_version: 起始版本号

        Returns:
            版本迁移路径列表
        """
        path = [from_version]
        version = from_version
        max_steps = len(self.MIGRATIONS) + 1

        for _ in range(max_steps):
            if version == self.CURRENT_VERSION:
                break
            migration = self.MIGRATIONS.get(version)
            if not migration:
                break
            version = migration["target"]
            path.append(version)

        return path

    def save_with_version(
        self,
        config_loader: Any,
        filename: str,
        config: dict,
    ) -> None:
        """保存配置时自动附加版本号

        Args:
            config_loader: ConfigLoader 实例
            filename: 配置文件名
            config: 配置字典
        """
        if "version" not in config:
            config["version"] = self.CURRENT_VERSION
        config_loader.save_yaml(filename, config)
