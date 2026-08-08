"""CLILLMProvider PATH 兜底单元测试（Bug 6 修复验证）.

覆盖范围（真实文件系统 + 真实 subprocess，不涉及真实 LLM API）:

    - PATH 缺失时通过 ~/.npm-global/bin 兜底找到 CLI 二进制
    - 兜底成功后目录注入进程 PATH（幂等）
    - 找不到时仍返回 False（[CLI 不可用] 路径保留）
    - FLOWFORGE_CLI_EXTRA_PATH 环境变量扩展目录生效
    - chat() 在 PATH 缺失但兜底目录存在时真实调用 CLI 成功

测试铁律合规说明:
    - T1（禁止 Mock LLM）: 使用真实的临时可执行脚本（echo），
      通过真实 subprocess 调用，不 mock 任何 LLM 行为
    - T2（禁止假数据）: 所有文件真实落盘，PATH 通过 monkeypatch 真实修改
    - T3（禁止跳过验证）: 所有断言具体明确

背景（Bug 6）:
    contentforge 进程通过 systemd 启动时 PATH 不含 ~/.npm-global/bin，
    而 codex/opencode/claude 等 CLI 均安装在 ~/.npm-global/bin，
    导致 is_available() 全部判 False → [CLI 不可用] 无效产出。
"""

from __future__ import annotations

import os
import stat

import pytest

from flowforge.llm.cli_provider import (
    CLIProviderConfig,
    CLILLMProvider,
    _expand_extra_path_dirs,
)


def _make_fake_cli(bin_dir, name: str = "fakecli", output: str = "fake output") -> str:
    """在 bin_dir 下创建真实可执行的 fake CLI 脚本，返回路径."""
    bin_dir.mkdir(parents=True, exist_ok=True)
    script = bin_dir / name
    script.write_text(f"#!/bin/sh\necho '{output}'\n", encoding="utf-8")
    script.chmod(script.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return str(script)


@pytest.fixture
def clean_env(monkeypatch):
    """隔离 PATH / HOME / FLOWFORGE_CLI_EXTRA_PATH，避免污染真实环境."""
    monkeypatch.delenv("PATH", raising=False)
    monkeypatch.delenv("FLOWFORGE_CLI_EXTRA_PATH", raising=False)
    monkeypatch.setenv("PATH", "")


def _provider(binary: str = "fakecli") -> CLILLMProvider:
    return CLILLMProvider(
        CLIProviderConfig(
            provider="fake",
            binary=binary,
            cli_args=["-p"],
        )
    )


def test_available_in_regular_path(monkeypatch) -> None:
    """PATH 中存在时走常规路径（行为不变）."""
    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    provider = _provider("sh")
    assert provider.is_available() is True


def test_fallback_finds_cli_in_npm_global_bin(tmp_path, monkeypatch, clean_env) -> None:
    """PATH 缺失时通过 ~/.npm-global/bin 兜底找到 CLI（Bug 6 核心场景）."""
    npm_bin = tmp_path / ".npm-global" / "bin"
    _make_fake_cli(npm_bin, "fakecli")
    monkeypatch.setenv("HOME", str(tmp_path))

    provider = _provider("fakecli")
    assert provider.is_available() is True, "兜底目录应能找到 CLI"

    # 兜底成功后目录注入进程 PATH
    assert str(npm_bin) in os.environ["PATH"]
    # 注入幂等：再次调用不重复注入
    path_before = os.environ["PATH"]
    assert provider.is_available() is True
    assert os.environ["PATH"] == path_before


def test_fallback_not_found_returns_false(tmp_path, monkeypatch, clean_env) -> None:
    """所有目录都找不到时返回 False（[CLI 不可用] 路径保留）."""
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv(
        "FLOWFORGE_CLI_EXTRA_PATH", str(tmp_path / "nonexistent-bin")
    )
    provider = _provider("does_not_exist_xyz")
    assert provider.is_available() is False


def test_extra_path_env_extends_search(tmp_path, monkeypatch, clean_env) -> None:
    """FLOWFORGE_CLI_EXTRA_PATH 环境变量扩展目录生效."""
    custom_bin = tmp_path / "custom-bin"
    _make_fake_cli(custom_bin, "fakecli")
    monkeypatch.setenv("HOME", str(tmp_path / "empty-home"))
    monkeypatch.setenv("FLOWFORGE_CLI_EXTRA_PATH", str(custom_bin))

    provider = _provider("fakecli")
    assert provider.is_available() is True
    assert str(custom_bin) in os.environ["PATH"]


def test_expand_extra_path_dirs_env(monkeypatch, tmp_path) -> None:
    """_expand_extra_path_dirs 包含环境变量指定的目录."""
    custom = str(tmp_path / "a") + ":" + str(tmp_path / "b")
    monkeypatch.setenv("FLOWFORGE_CLI_EXTRA_PATH", custom)
    dirs = _expand_extra_path_dirs()
    assert str(tmp_path / "a") in dirs
    assert str(tmp_path / "b") in dirs


async def test_chat_invokes_cli_via_fallback(tmp_path, monkeypatch, clean_env) -> None:
    """PATH 缺失但兜底目录存在时，chat() 真实调用 CLI 成功.

    使用真实可执行脚本（T1 合规：非 mock LLM，真实 subprocess）。
    """
    npm_bin = tmp_path / ".npm-global" / "bin"
    _make_fake_cli(npm_bin, "fakecli", output="hello from fake cli")
    monkeypatch.setenv("HOME", str(tmp_path))

    provider = _provider("fakecli")
    result = await provider.chat(
        [{"role": "user", "content": "你好"}],
        session_id="test-session",
        timeout=10.0,
    )

    assert result["content"].strip() == "hello from fake cli"
    assert result["model"] == "fake"
    assert result["usage"]["latency_ms"] >= 0


async def test_chat_returns_unavailable_when_not_found(
    tmp_path, monkeypatch, clean_env
) -> None:
    """找不到二进制时返回 [CLI 不可用] 错误（原有行为保留）."""
    monkeypatch.setenv("HOME", str(tmp_path))
    provider = _provider("does_not_exist_xyz")
    result = await provider.chat(
        [{"role": "user", "content": "你好"}], session_id="s"
    )

    assert "[CLI 不可用]" in result["content"]
    assert result["usage"]["error"] == "binary_not_found"
