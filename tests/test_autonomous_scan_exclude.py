"""AutonomousDaemon 扫描排除第三方目录单元测试（Bug 3 修复验证）.

覆盖范围（纯逻辑层，真实文件系统操作，不涉及真实 LLM）:

    - _scan_code_todos 跳过 .venv 内的 TODO（第三方包不产生任务）
    - 跳过 node_modules / .git / __pycache__ / build / dist 等目录
    - tests 目录仍被排除（原有行为保留）
    - _scan_missing_tests 排除 tests 目录下的 .venv 等子目录
    - 正常源码目录的 TODO 仍被发现（不误伤）

测试铁律合规说明:
    - T1（禁止 Mock LLM）: 本测试不调用 LLM，仅扫描真实临时文件
    - T2（禁止假数据）: 文件系统内容为真实写入的临时文件
    - T3（禁止跳过验证）: 所有断言具体明确

背景（Bug 3）:
    原 _scan_code_todos 使用 rglob(\"*.py\") 扫描 flowforge 目录，
    未排除 .venv（63MB 第三方包），第三方包中的 TODO/NotImplementedError
    产生大量无意义任务，且扫描耗时长。
"""

from __future__ import annotations

from flowforge.forgemind.autonomous import AutonomousDaemon
from flowforge.forgemind.swarm import SwarmCoordinator


def _write_py(path, content: str) -> None:
    """写入一个真实 .py 临时文件（T2 禁止假数据：真实落盘）."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _make_daemon(tmp_path) -> AutonomousDaemon:
    """构造指向 tmp_path 的 daemon（不扫描真实项目）."""
    coord = SwarmCoordinator(config={"trace_archive_path": str(tmp_path / "t.jsonl")})
    return AutonomousDaemon(
        coordinator=coord,
        project_root=tmp_path,
        config={"scan_interval_seconds": 600},
    )


def test_scan_code_todos_excludes_venv(tmp_path) -> None:
    """.venv 内的 TODO 不产生任务（Bug 3 核心场景）."""
    _write_py(
        tmp_path / "flowforge" / "core" / "real.py",
        "# TODO: 实现真实模块逻辑\n",
    )
    # 第三方包：.venv 中的 TODO 不应被扫描到
    _write_py(
        tmp_path / "flowforge" / ".venv" / "lib" / "site-packages" / "third.py",
        "# TODO: 第三方包待实现\n",
    )

    daemon = _make_daemon(tmp_path)
    tasks = daemon._scan_code_todos()

    assert len(tasks) == 1, f"应只发现真实源码的 TODO，实际 {len(tasks)} 个任务"
    assert ".venv" not in tasks[0].title
    assert "real.py" in tasks[0].title


def test_scan_code_todos_excludes_common_vendor_dirs(tmp_path) -> None:
    """node_modules/.git/__pycache__/build/dist 均不产生任务."""
    vendor_dirs = [
        "node_modules/pkg",
        ".git/hooks",
        "__pycache__",
        "build/lib",
        "dist/pkg",
        ".pytest_cache",
        ".mypy_cache",
        "logs",
    ]
    for d in vendor_dirs:
        _write_py(
            tmp_path / "flowforge" / d / "gen.py",
            "# TODO: 生成物内容\nraise NotImplementedError\n",
        )
    # 真实源码仍有 TODO
    _write_py(
        tmp_path / "flowforge" / "app" / "main.py",
        "# TODO: 补全启动逻辑\n",
    )

    daemon = _make_daemon(tmp_path)
    tasks = daemon._scan_code_todos()

    assert len(tasks) == 1, f"仅真实源码应产生任务，实际 {len(tasks)}"
    assert "app/main.py" in tasks[0].title


def test_scan_code_todos_still_excludes_tests(tmp_path) -> None:
    """tests 目录原有排除行为保留."""
    _write_py(
        tmp_path / "flowforge" / "tests" / "test_x.py",
        "# TODO: 测试占位\n",
    )
    _write_py(
        tmp_path / "flowforge" / "core" / "mod.py",
        "# TODO: 核心逻辑\n",
    )

    daemon = _make_daemon(tmp_path)
    tasks = daemon._scan_code_todos()

    assert len(tasks) == 1
    assert "core/mod.py" in tasks[0].title


def test_scan_missing_tests_excludes_venv_in_tests_dir(tmp_path) -> None:
    """tests 目录下的 .venv 子目录中的测试文件不参与匹配."""
    # 目标模块（core_modules 之一，无对应测试 → 本应触发"补充测试"任务）
    _write_py(
        tmp_path / "flowforge" / "forgemind" / "base.py",
        "class ForgekinBase:\n    pass\n",
    )
    # 假测试：位于 tests/.venv 下，不应算作已覆盖
    _write_py(
        tmp_path / "flowforge" / "tests" / ".venv" / "test_base.py",
        "def test_base():\n    assert True\n",
    )

    daemon = _make_daemon(tmp_path)
    tasks = daemon._scan_missing_tests()

    assert any("forgemind/base.py" in t.title for t in tasks), (
        "tests/.venv 下的测试文件不应被视为已覆盖"
    )


def test_scan_missing_tests_finds_real_test(tmp_path) -> None:
    """真实 tests 目录中的测试文件正常参与匹配（不误伤）."""
    _write_py(
        tmp_path / "flowforge" / "forgemind" / "base.py",
        "class ForgekinBase:\n    pass\n",
    )
    _write_py(
        tmp_path / "flowforge" / "tests" / "test_base.py",
        "def test_base():\n    assert True\n",
    )

    daemon = _make_daemon(tmp_path)
    tasks = daemon._scan_missing_tests()

    assert not any("forgemind/base.py" in t.title for t in tasks), (
        "真实测试文件应命中匹配，不产生补充测试任务"
    )
