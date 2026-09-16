"""测试配置版本管理器"""
import warnings
from pathlib import Path
import tempfile

import pytest

from flowforge.core.config_version import (
    CompatibilityLevel,
    ConfigVersion,
    ConfigVersionManager,
)


class TestConfigVersion:
    """ConfigVersion 模型测试"""

    def test_default_version(self):
        v = ConfigVersion()
        assert v.version == "1.0.0"
        assert v.compatibility == CompatibilityLevel.MINOR
        assert v.changelog == []
        assert v.deprecated_keys == {}
        assert v.renamed_keys == {}

    def test_custom_version(self):
        v = ConfigVersion(
            version="2.0.0",
            compatibility=CompatibilityLevel.MAJOR,
            changelog=["Breaking change"],
            deprecated_keys={"old_key": "Use new_key"},
            renamed_keys={"old_key": "new_key"},
        )
        assert v.version == "2.0.0"
        assert v.compatibility == CompatibilityLevel.MAJOR
        assert len(v.changelog) == 1


class TestConfigVersionManager:
    """ConfigVersionManager 测试"""

    def setup_method(self):
        self.manager = ConfigVersionManager()

    def test_check_version_default(self):
        """测试默认版本检查"""
        config = {}
        version = self.manager.check_version(config)
        assert version.version == "1.0.0"

    def test_check_version_explicit(self):
        """测试显式版本检查"""
        config = {"version": "1.1.0"}
        version = self.manager.check_version(config)
        assert version.version == "1.1.0"

    def test_needs_migration_from_1_0_0(self):
        """测试从 1.0.0 需要迁移"""
        config = {"version": "1.0.0"}
        assert self.manager.needs_migration(config) is True

    def test_needs_migration_from_current(self):
        """测试当前版本不需要迁移"""
        config = {"version": self.manager.CURRENT_VERSION}
        assert self.manager.needs_migration(config) is False

    def test_needs_migration_no_version(self):
        """测试无版本号需要迁移"""
        config = {}
        assert self.manager.needs_migration(config) is True

    def test_migrate_1_0_0_to_latest(self):
        """测试从 1.0.0 迁移到最新版本"""
        config = {
            "version": "1.0.0",
            "name": "test_agent",
            "mode": "react",
            "prompt": "You are a helpful assistant.",
        }

        result = self.manager.migrate(config)

        # 验证版本已更新
        assert result["version"] == self.manager.CURRENT_VERSION

        # 验证重命名已应用
        assert "mode" not in result
        assert "default_mode" in result
        assert result["default_mode"] == "react"

        assert "prompt" not in result
        assert "system_prompt" in result
        assert result["system_prompt"] == "You are a helpful assistant."

        # 原有字段保留
        assert result["name"] == "test_agent"

    def test_migrate_1_1_0_to_latest(self):
        """测试从 1.1.0 迁移到最新版本"""
        config = {
            "version": "1.1.0",
            "name": "test_agent",
            "context_injection": {"key": "value"},
            "handoffs": ["agent_a", "agent_b"],
        }

        result = self.manager.migrate(config)

        assert result["version"] == self.manager.CURRENT_VERSION
        assert "context_injection" not in result
        assert "input_mapping" in result
        assert result["input_mapping"] == {"key": "value"}
        assert "handoffs" not in result
        assert "next_agents" in result
        assert result["next_agents"] == ["agent_a", "agent_b"]

    def test_migrate_with_deprecated_key(self):
        """测试迁移时废弃 key 发出警告"""
        config = {
            "version": "1.1.0",
            "name": "test_agent",
            "base_agent_class": "SomeBaseAgent",
        }

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            result = self.manager.migrate(config)

            # 应该有 DeprecationWarning
            deprecation_warnings = [
                x for x in w if issubclass(x.category, DeprecationWarning)
            ]
            assert len(deprecation_warnings) > 0
            assert "base_agent_class" in str(deprecation_warnings[0].message)

    def test_migrate_does_not_modify_original(self):
        """测试迁移不修改原始配置"""
        config = {
            "version": "1.0.0",
            "mode": "react",
            "prompt": "test",
        }
        original_mode = config["mode"]

        self.manager.migrate(config)

        # 原始配置不应被修改
        assert config["mode"] == original_mode

    def test_migrate_already_current(self):
        """测试当前版本迁移不变"""
        config = {
            "version": self.manager.CURRENT_VERSION,
            "name": "test_agent",
        }
        result = self.manager.migrate(config)
        assert result == config

    def test_migrate_unknown_version(self):
        """测试未知版本迁移（无法迁移时停止）"""
        config = {
            "version": "99.0.0",
            "name": "test_agent",
        }
        result = self.manager.migrate(config)
        # 无法找到迁移路径，保持原样
        assert result["version"] == "99.0.0"

    def test_get_migration_path(self):
        """测试获取迁移路径"""
        path = self.manager.get_migration_path("1.0.0")
        assert path[0] == "1.0.0"
        assert path[-1] == self.manager.CURRENT_VERSION
        assert "1.1.0" in path

    def test_get_migration_path_current(self):
        """测试当前版本的迁移路径"""
        path = self.manager.get_migration_path(self.manager.CURRENT_VERSION)
        assert path == [self.manager.CURRENT_VERSION]

    def test_save_with_version(self):
        """测试保存时自动附加版本号"""
        from flowforge.core.config import ConfigLoader

        with tempfile.TemporaryDirectory() as tmp:
            loader = ConfigLoader(config_dir=Path(tmp))
            config = {"name": "test_agent", "model": "gpt-4"}

            self.manager.save_with_version(loader, "test_agent.yaml", config)

            loaded = loader.load_yaml("test_agent.yaml")
            assert loaded["version"] == self.manager.CURRENT_VERSION
            assert loaded["name"] == "test_agent"

    def test_save_with_version_preserves_existing(self):
        """测试保存时保留已有版本号"""
        from flowforge.core.config import ConfigLoader

        with tempfile.TemporaryDirectory() as tmp:
            loader = ConfigLoader(config_dir=Path(tmp))
            config = {"version": "1.0.0", "name": "test_agent"}

            self.manager.save_with_version(loader, "test_agent.yaml", config)

            loaded = loader.load_yaml("test_agent.yaml")
            # 已有版本号应保留
            assert loaded["version"] == "1.0.0"

    def test_full_migration_chain(self):
        """测试完整迁移链：1.0.0 → 1.1.0 → 2.0.0"""
        config = {
            "version": "1.0.0",
            "name": "test_agent",
            "mode": "react",
            "prompt": "Hello",
            "context_injection": {"key": "val"},
            "handoffs": ["agent_a"],
        }

        result = self.manager.migrate(config)

        # 1.0.0 → 1.1.0: mode → default_mode, prompt → system_prompt
        assert "default_mode" in result
        assert "system_prompt" in result

        # 1.1.0 → 2.0.0: context_injection → input_mapping, handoffs → next_agents
        assert "input_mapping" in result
        assert "next_agents" in result

        # 最终版本
        assert result["version"] == self.manager.CURRENT_VERSION
