#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FlowForge 一键环境检测脚本 (doctor)

检测所有 9 个灵智体所需的依赖环境，包括：
  - Python 3.11+
  - Node.js 18+ / pnpm
  - Git
  - 7 个 CLI 工具 (claude/codex/gemini/opencode/codebuddy/qodercli/iflow)
  - Trae 桥接目录（butterfly 灵智体）
  - 代理服务（claude-code-router/responses-proxy/gemini-proxy）
  - .env 配置文件
  - 后端/前端依赖

用法:
  python scripts/doctor.py                # 全量检测
  python scripts/doctor.py --json         # JSON 格式输出
  python scripts/doctor.py --fix          # 检测并提示修复

检测逻辑委托给 doctor_lib（不输出 stdout），本文件只负责 CLI 打印。
"""

from __future__ import annotations

import argparse
import json

# 从 doctor_lib 导入核心检测逻辑（无 print，可被 bootcamp 等模块复用）
from doctor_lib import (
    CLI_TOOLS,
    PROXIES,
    PROJECT_ROOT,
    VENV_DIR,
    WEB_DIR,
    ENV_FILE,
    ENV_EXAMPLE,
    check_python,
    check_node,
    check_npm,
    check_pnpm,
    check_git,
    check_cli_tools,
    check_proxies,
    check_env_file,
    check_venv,
    check_web_deps,
    check_trae_bridge,
    run_full_check,
)


# ── 打印辅助函数（仅 CLI 使用）──────────────────────────────────

def section(title: str) -> None:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def ok(msg: str) -> None:
    print(f"  [OK]   {msg}")


def fail(msg: str) -> None:
    print(f"  [FAIL] {msg}")


def warn(msg: str) -> None:
    print(f"  [WARN] {msg}")


def info(msg: str) -> None:
    print(f"  [INFO] {msg}")


# ── 检测函数（调用 doctor_lib 获取数据 + 打印输出）─────────────

def detect_python() -> dict:
    """检测 Python 版本并打印"""
    section("Python 环境")
    r = check_python()
    if r["status"] == "ok":
        ok(f"Python {r['version']} ({r['path']})")
    else:
        fail(f"Python {r.get('version', '?')} 版本过低，需要 {r.get('required', '3.11+')}")
    return r


def detect_node() -> dict:
    """检测 Node.js 和 pnpm 并打印"""
    section("Node.js 环境")
    node_r = check_node()
    if node_r["status"] == "ok":
        version = node_r.get("version", "")
        ok(f"Node.js {version} ({node_r.get('path', '')})")
    else:
        if node_r.get("path"):
            fail(f"Node.js {node_r.get('version', '?')} 版本过低，需要 {node_r.get('required', '18+')}")
        else:
            fail("Node.js 未安装，请从 https://nodejs.org/ 安装")

    npm_r = check_npm()
    if npm_r["status"] == "ok":
        ok(f"npm {npm_r.get('version', '')} ({npm_r.get('path', '')})")
    else:
        fail("npm 未找到（随 Node.js 安装）")

    pnpm_r = check_pnpm()
    if pnpm_r["status"] == "ok":
        ok(f"pnpm {pnpm_r.get('version', '')} ({pnpm_r.get('path', '')})")
    else:
        warn("pnpm 未安装，将使用 npm（建议安装 pnpm: npm install -g pnpm）")

    return node_r


def detect_git() -> dict:
    """检测 Git 并打印"""
    section("Git")
    r = check_git()
    if r["status"] == "ok":
        ok(f"Git {r.get('version', '')} ({r.get('path', '')})")
    else:
        fail("Git 未安装，请从 https://git-scm.com/ 安装")
    return r


def detect_cli_tools() -> list:
    """检测所有 AI CLI 工具并打印"""
    section("AI CLI 工具（8 个灵智体所需）")
    results = check_cli_tools()
    for item in results:
        if item["status"] == "ok":
            ok(f"{item['name']:12s} {item.get('version', ''):30s} -> {item.get('forgekin', '')}")
        else:
            fail(f"{item['name']:12s} 未安装 -> {item.get('forgekin', '')}（{item.get('note', '')}）")
            info(f"           安装: {item.get('install_cmd', '')}")
    return results


def detect_proxies() -> list:
    """检测协议代理服务并打印"""
    section("协议转换代理")
    results = check_proxies()
    for item in results:
        if item["status"] == "running":
            ok(f"{item['name']:25s} 端口 {item['port']} 正在运行")
        elif item["status"] == "stopped":
            warn(f"{item['name']:25s} 端口 {item['port']} 未运行（对应 CLI 将直连，可能需要 API key）")
        else:
            warn(f"{item['name']:25s} 端口 {item['port']} 检测失败")
    return results


def detect_env_file() -> dict:
    """检测 .env 配置文件并打印"""
    section("配置文件")
    r = check_env_file()
    if r["status"] == "ok":
        ok(f".env 文件存在 ({ENV_FILE})")
        configured = r.get("configured_keys", 0)
        total = r.get("total_keys", 4)
        keys = ["ANTHROPIC_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "OPENROUTE_API_KEY"]
        content = ENV_FILE.read_text(encoding="utf-8")
        for key in keys:
            line = [l for l in content.split("\n") if l.startswith(f"{key}=")]
            if line and len(line[0]) > len(f"{key}=") + 10:
                ok(f"  {key} 已配置")
            else:
                warn(f"  {key} 未配置")
        info(f"  API key 配置率: {configured}/{total}")
    else:
        warn(".env 文件不存在，从 .env.example 复制")
        if ENV_EXAMPLE.exists():
            info("运行: copy .env.example .env（然后填写 API key）")
    return r


def detect_venv() -> dict:
    """检测 .venv 虚拟环境并打印"""
    section("Python 虚拟环境")
    r = check_venv()
    if r["status"] == "ok":
        ok(f".venv 存在 ({VENV_DIR})")
    else:
        warn(".venv 不存在，运行 python -m venv .venv 创建")
    return r


def detect_web_deps() -> dict:
    """检测前端依赖并打印"""
    section("前端依赖")
    r = check_web_deps()
    if r["status"] == "ok":
        ok("web/node_modules 存在")
    else:
        warn("web/node_modules 不存在，运行 cd web && pnpm install")
    return r


def detect_trae_bridge() -> dict:
    """检测 Trae 桥接目录并打印"""
    section("Trae 桥接（butterfly 灵智体）")
    r = check_trae_bridge()
    if r["status"] == "ok":
        ok(f"Trae 桥接目录: {r.get('bridge_dir', '')}")
    else:
        warn("Trae 桥接目录未配置（FLOWFORGE_BRIDGE_DIR 环境变量）")
        info("butterfly (蝴蝶) 灵智体需要 Trae IDE 桥接，配置 FLOWFORGE_BRIDGE_DIR 环境变量")
    return r


# ── 主入口：运行全量检测并打印汇总 ─────────────────────────────

def run_doctor(json_output: bool = False) -> dict:
    """运行全量检测（CLI 入口，会打印详细输出）。

    返回 doctor_lib.run_full_check() 的结构化结果，便于程序化消费。
    """
    # 1. 调用 doctor_lib 拿到结构化结果（不打印）
    results = run_full_check()

    # 2. 逐项打印 CLI 风格输出
    detect_python()
    detect_node()
    detect_git()
    detect_cli_tools()
    detect_proxies()
    detect_env_file()
    detect_venv()
    detect_web_deps()
    detect_trae_bridge()

    # 3. 汇总打印
    section("汇总")
    total = len(results["core_tools"]) + len(results["cli_tools"]) + len(results["proxy_services"]) + 1
    ok_count = sum(1 for r in results["core_tools"].values() if r["ok"])
    ok_count += sum(1 for r in results["cli_tools"].values() if r["ok"])
    ok_count += sum(1 for r in results["proxy_services"].values() if r["ok"])
    ok_count += 1 if results["trae_bridge"]["ok"] else 0
    fail_count = total - ok_count

    print(f"\n  总计: {total} 项  |  通过: {ok_count}  |  缺失: {fail_count}")
    if results["all_ready"]:
        print("\n  ✅ 所有检测项通过！FlowForge 环境就绪。")
    else:
        print(f"\n  ⚠ 有 {len(results['missing'])} 个缺失项: {', '.join(results['missing'])}")
        print("    请按上述提示操作，或运行 install.bat / ./install.sh 一键安装。")

    # 4. JSON 输出（--json 模式）
    if json_output:
        print("\n" + json.dumps(results, ensure_ascii=False, indent=2))

    return results


def main():
    parser = argparse.ArgumentParser(description="FlowForge 环境检测工具")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    args = parser.parse_args()
    run_doctor(json_output=args.json)


if __name__ == "__main__":
    main()
