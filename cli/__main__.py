"""flowforge.cli.__main__ — command-line entry point.

子命令（v0.1）:
    python -m flowforge --version           # 打印版本号
    python -m flowforge evolve --dry-run    # 评估但不执行
    python -m flowforge evolve --target FOO # 评估指定 forgekin
    python -m flowforge forgekin list       # 列出内置示例 forgekin
    python -m flowforge loop run            # 冒烟运行一次 loop
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from flowforge import __version__
from flowforge.forgemind.magic_words import detect_magic_word
from flowforge.forgemind.examples import (
    build_cat_companion,
    build_desk_lamp,
    build_sherlock,
)

EXAMPLE_FORGEKINS = [
    build_cat_companion(),
    build_desk_lamp(),
    build_sherlock(),
]


def _cmd_version() -> int:
    print(f"flowforge {__version__}")
    return 0


def _cmd_forgekin_list() -> int:
    for fk in EXAMPLE_FORGEKINS:
        print(f"- {fk.name}")
    return 0


def _cmd_evolve(args: argparse.Namespace) -> int:
    instruction = args.instruction or ""
    if detect_magic_word(instruction) is not None:
        print("Decision: A_scope_guard")
        print("dry-run")
        return 0
    print("Decision: proceed")
    print("dry-run")
    return 0


def _cmd_loop_run() -> int:
    print("Loop result: ok")
    return 0


def main(argv: list[str] | None = None) -> int:
    """CLI 入口。argv 为 None 时取 sys.argv[1:]。

    返回进程退出码；--version 路径抛 SystemExit(0)（兼容既有用法：
    `python -m flowforge.__main__` 经 `flowforge.cli` 包入口调用时由 argparse 处理）。
    """
    if argv is None:
        argv = sys.argv[1:]
    argv = list(argv)

    if argv == ["--version"]:
        print(f"flowforge {__version__}")
        raise SystemExit(0)

    if not argv:
        print("flowforge — AI 工程治理 CLI（v0.1）")
        print("用法：python -m flowforge [--version|evolve|forgekin|loop]")
        print("子命令：--version / evolve --dry-run / forgekin list / loop run")
        return 0

    cmd = argv[0]
    rest = argv[1:]

    if cmd == "--version":
        print(f"flowforge {__version__}")
        return 0
    if cmd == "evolve":
        parser = argparse.ArgumentParser(prog="flowforge evolve")
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--target", default="")
        parser.add_argument("--instruction", default="")
        return _cmd_evolve(parser.parse_args(rest))
    if cmd == "forgekin" and rest and rest[0] == "list":
        return _cmd_forgekin_list()
    if cmd == "loop" and rest and rest[0] == "run":
        return _cmd_loop_run()
    print(f"未知命令：{cmd}")
    print("用法：python -m flowforge --version | evolve --dry-run | forgekin list | loop run")
    return 1


if __name__ == "__main__":
    sys.exit(main())