import pytest
import tempfile
import os
from pathlib import Path
from flowforge.core.config import SystemConfig, ConfigLoader


def test_system_config_defaults():
    config = SystemConfig()
    assert config.db_url == "sqlite:///data/flowforge.db"
    assert config.log_level == "INFO"
    assert config.server_host == "0.0.0.0"
    assert config.server_port == 8000
    assert config.workers == 1
    assert config.opensieve_enabled is True
    assert config.scheduler_enabled is True
    assert config.scheduler_timezone == "Asia/Shanghai"
    assert config.metrics_enabled is True


def test_system_config_override_from_env():
    os.environ["SERVER_PORT"] = "9000"
    try:
        config = SystemConfig()
        assert config.server_port == 9000
    finally:
        del os.environ["SERVER_PORT"]


def test_config_loader_default_dir():
    loader = ConfigLoader()
    assert loader.config_dir.exists()


def test_config_loader_load_yaml_nonexistent():
    loader = ConfigLoader(config_dir=Path(tempfile.mkdtemp()))
    result = loader.load_yaml("nonexistent.yaml")
    assert result == {}


def test_config_loader_save_and_load_yaml():
    tmp_dir = Path(tempfile.mkdtemp())
    loader = ConfigLoader(config_dir=tmp_dir)
    data = {"key": "value", "nested": {"a": 1}}
    loader.save_yaml("test_config.yaml", data)
    loaded = loader.load_yaml("test_config.yaml")
    assert loaded["key"] == "value"
    assert loaded["nested"]["a"] == 1


def test_config_loader_get_models_config():
    tmp_dir = Path(tempfile.mkdtemp())
    loader = ConfigLoader(config_dir=tmp_dir)
    result = loader.get_models_config()
    assert result == {}


def test_config_loader_save_unicode():
    tmp_dir = Path(tempfile.mkdtemp())
    loader = ConfigLoader(config_dir=tmp_dir)
    data = {"name": "中文测试", "items": ["项目一", "项目二"]}
    loader.save_yaml("unicode_config.yaml", data)
    loaded = loader.load_yaml("unicode_config.yaml")
    assert loaded["name"] == "中文测试"
    assert loaded["items"][0] == "项目一"
