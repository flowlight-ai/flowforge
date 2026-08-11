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
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VENV_DIR = PROJECT_ROOT / ".venv"
WEB_DIR = PROJECT_ROOT / "web"
ENV_FILE = PROJECT_ROOT / ".env"
ENV_EXAMPLE = PROJECT_ROOT / ".env.example"

# 9 个灵智体对应的 CLI 工具
CLI_TOOLS = [
    {"name": "claude", "package": "@anthropic-ai/claude-code", "forgekin": "vangogh (梵高)", "install": "npm", "note": "经 claude-code-router 转发"},
    {"name": "codex", "package": "@openai/codex", "forgekin": "sherlock (夏洛克)", "install": "npm", "note": "经 responses proxy 转发"},
    {"name": "gemini", "package": "@google/gemini-cli", "forgekin": "luban (鲁班)", "install": "npm", "note": "经 gemini proxy 转发"},
    {"name": "opencode", "package": "@opencode-ai/cli", "forgekin": "wenxin/davinci/humming/sqrl", "install": "npm", "note": "直连"},
    {"name": "codebuddy", "package": "codebuddy-cli", "forgekin": "davinci (达芬奇)", "install": "npm", "note": "直连 hy3"},
    {"name": "qodercli", "package": "@qoder/cli", "forgekin": "未绑定", "install": "npm", "note": "需 Qoder 账号"},
    {"name": "iflow", "package": "@iflow/cli", "forgekin": "keane (鹰·凯恩)", "install": "npm", "note": "OpenAI-Compatible"},
    {"name": "kimi", "package": "kimi-cli", "forgekin": "可选", "install": "pip", "note": "需 Python 3.12+"},
]

# 代理服务
PROXIES = [
    {"name": "claude-code-router", "port": 3456, "desc": "Claude Code 转发代理"},
    {"name": "responses-proxy", "port": 8084, "desc": "Codex responses 转发代理"},
    {"name": "gemini-proxy", "port": 8082, "desc": "Gemini CLI 转发代理"},
]

# 额外的 CLI PATH 搜索目录
EXTRA_PATH_DIRS = [
    os.path.expanduser("~/.npm-global/bin"),
    os.path.expanduser("~/.local/bin"),
    os.path.expanduser("~/.opencode/bin"),
    os.path.expanduser("~/.codex/bin"),
    os.path.expanduser("~/.volta/bin"),
    os.path.expanduser("~/.bun/bin"),
    os.path.expanduser("~/go/bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
]


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


def find_binary(name: str) -> str | None:
    """在 PATH 和额外目录中查找可执行文件"""
    # 标准 PATH 查找
    path = shutil.which(name)
    if path:
        return path
    # Windows .cmd shim
    if sys.platform == "win32":
        path = shutil.which(f"{name}.cmd") or shutil.which(f"{name}.exe")
        if path:
            return path
    # 额外目录查找
    for d in EXTRA_PATH_DIRS:
        if not os.path.isdir(d):
            continue
        candidate = os.path.join(d, name)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
        if sys.platform == "win32":
            for ext in (".cmd", ".exe", ".bat"):
                candidate_ext = os.path.join(d, f"{name}{ext}")
                if os.path.isfile(candidate_ext):
                    return candidate_ext
    # nvm 版本化目录
    nvm_dir = os.path.expanduser("~/.nvm/versions/node")
    if os.path.isdir(nvm_dir):
        for ver in os.listdir(nvm_dir):
            bin_dir = os.path.join(nvm_dir, ver, "bin")
            candidate = os.path.join(bin_dir, name)
            if os.path.isfile(candidate):
                return candidate
    return None


def get_version(cmd: list[str]) -> str | None:
    """获取工具版本号"""
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return result.stdout.strip().split("\n")[0][:80]
    except Exception:
        pass
    return None


def check_python() -> dict:
    """检测 Python 版本"""
    section("Python 环境")
    version = sys.version_info
    version_str = f"{version.major}.{version.minor}.{version.micro}"
    if version >= (3, 11):
        ok(f"Python {version_str} ({sys.executable})")
        return {"name": "python", "status": "ok", "version": version_str}
    else:
        fail(f"Python {version_str} 版本过低，需要 3.11+")
        return {"name": "python", "status": "fail", "version": version_str, "required": "3.11+"}


def check_node() -> dict:
    """检测 Node.js 和 pnpm"""
    section("Node.js 环境")
    node_path = shutil.which("node") or shutil.which("node.exe")
    if node_path:
        version = get_version(["node", "--version"])
        if version:
            # 解析版本号 v18.x.x -> 18
            try:
                major = int(version.lstrip("v").split(".")[0])
                if major >= 18:
                    ok(f"Node.js {version} ({node_path})")
                    node_status = {"name": "node", "status": "ok", "version": version}
                else:
                    fail(f"Node.js {version} 版本过低，需要 18+")
                    node_status = {"name": "node", "status": "fail", "version": version, "required": "18+"}
            except Exception:
                ok(f"Node.js {version} ({node_path})")
                node_status = {"name": "node", "status": "ok", "version": version}
        else:
            ok(f"Node.js found ({node_path})")
            node_status = {"name": "node", "status": "ok"}
    else:
        fail("Node.js 未安装，请从 https://nodejs.org/ 安装")
        node_status = {"name": "node", "status": "fail"}

    npm_path = shutil.which("npm") or shutil.which("npm.cmd")
    if npm_path:
        npm_ver = get_version(["npm", "--version"])
        ok(f"npm {npm_ver or ''} ({npm_path})")
    else:
        fail("npm 未找到（随 Node.js 安装）")

    pnpm_path = shutil.which("pnpm") or shutil.which("pnpm.cmd")
    if pnpm_path:
        pnpm_ver = get_version(["pnpm", "--version"])
        ok(f"pnpm {pnpm_ver or ''} ({pnpm_path})")
    else:
        warn("pnpm 未安装，将使用 npm（建议安装 pnpm: npm install -g pnpm）")

    return node_status


def check_git() -> dict:
    """检测 Git"""
    section("Git")
    git_path = shutil.which("git") or shutil.which("git.exe")
    if git_path:
        version = get_version(["git", "--version"])
        ok(f"Git {version or ''} ({git_path})")
        return {"name": "git", "status": "ok", "version": version}
    else:
        fail("Git 未安装，请从 https://git-scm.com/ 安装")
        return {"name": "git", "status": "fail"}


def check_cli_tools() -> list:
    """检测所有 CLI 工具"""
    section("AI CLI 工具（9 个灵智体所需）")
    results = []
    for tool in CLI_TOOLS:
        path = find_binary(tool["name"])
        if path:
            version = get_version([tool["name"], "--version"])
            ok(f"{tool['name']:12s} {version or '':30s} -> {tool['forgekin']}")
            results.append({"name": tool["name"], "status": "ok", "path": path, "version": version})
        else:
            fail(f"{tool['name']:12s} 未安装 -> {tool['forgekin']}（{tool['note']}）")
            info(f"           安装: {'npm install -g ' + tool['package'] if tool['install'] == 'npm' else 'pip install ' + tool['package']}")
            results.append({"name": tool["name"], "status": "missing", "install_cmd": f"npm install -g {tool['package']}"})
    return results


def check_proxies() -> list:
    """检测代理服务"""
    section("协议转换代理")
    results = []
    import socket
    for proxy in PROXIES:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        try:
            result = sock.connect_ex(("127.0.0.1", proxy["port"]))
            if result == 0:
                ok(f"{proxy['name']:25s} 端口 {proxy['port']} 正在运行")
                results.append({"name": proxy["name"], "status": "running", "port": proxy["port"]})
            else:
                warn(f"{proxy['name']:25s} 端口 {proxy['port']} 未运行（对应 CLI 将直连，可能需要 API key）")
                results.append({"name": proxy["name"], "status": "stopped", "port": proxy["port"]})
        except Exception:
            warn(f"{proxy['name']:25s} 端口 {proxy['port']} 检测失败")
            results.append({"name": proxy["name"], "status": "unknown", "port": proxy["port"]})
        finally:
            sock.close()
    return results


def check_env_file() -> dict:
    """检测 .env 配置文件"""
    section("配置文件")
    if ENV_FILE.exists():
        ok(f".env 文件存在 ({ENV_FILE})")
        # 检查关键配置项
        content = ENV_FILE.read_text(encoding="utf-8")
        keys = ["ANTHROPIC_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "OPENROUTE_API_KEY"]
        for key in keys:
            if key in content and f"{key}=" in content:
                line = [l for l in content.split("\n") if l.startswith(f"{key}=")]
                if line and len(line[0]) > len(f"{key}=") + 10:
                    ok(f"  {key} 已配置")
                else:
                    warn(f"  {key} 未配置（空值）")
            else:
                warn(f"  {key} 未配置")
        return {"name": ".env", "status": "ok"}
    else:
        warn(f".env 文件不存在，从 .env.example 复制")
        if ENV_EXAMPLE.exists():
            info(f"运行: copy .env.example .env（然后填写 API key）")
        return {"name": ".env", "status": "missing"}


def check_venv() -> dict:
    """检测虚拟环境"""
    section("Python 虚拟环境")
    if VENV_DIR.exists():
        ok(f".venv 存在 ({VENV_DIR})")
        return {"name": ".venv", "status": "ok"}
    else:
        warn(".venv 不存在，运行 python -m venv .venv 创建")
        return {"name": ".venv", "status": "missing"}


def check_web_deps() -> dict:
    """检测前端依赖"""
    section("前端依赖")
    node_modules = WEB_DIR / "node_modules"
    if node_modules.exists():
        ok(f"web/node_modules 存在")
        return {"name": "web_deps", "status": "ok"}
    else:
        warn("web/node_modules 不存在，运行 cd web && pnpm install")
        return {"name": "web_deps", "status": "missing"}


def check_trae_bridge() -> dict:
    """检测 Trae 桥接目录"""
    section("Trae 桥接（butterfly 灵智体）")
    bridge_dir = os.environ.get("FLOWFORGE_BRIDGE_DIR", "")
    if bridge_dir and os.path.isdir(bridge_dir):
        ok(f"Trae 桥接目录: {bridge_dir}")
        return {"name": "trae_bridge", "status": "ok"}
    else:
        warn("Trae 桥接目录未配置（FLOWFORGE_BRIDGE_DIR 环境变量）")
        info("butterfly (蝴蝶) 灵智体需要 Trae IDE 桥接，配置 FLOWFORGE_BRIDGE_DIR 环境变量")
        return {"name": "trae_bridge", "status": "missing"}


def run_doctor(json_output: bool = False) -> dict:
    """运行全量检测"""
    results = {
        "python": check_python(),
        "node": check_node(),
        "git": check_git(),
        "cli_tools": check_cli_tools(),
        "proxies": check_proxies(),
        "env_file": check_env_file(),
        "venv": check_venv(),
        "web_deps": check_web_deps(),
        "trae_bridge": check_trae_bridge(),
    }

    # 汇总
    section("汇总")
    total = 0
    ok_count = 0
    warn_count = 0
    fail_count = 0
    for category, result in results.items():
        if isinstance(result, list):
            for item in result:
                total += 1
                if item.get("status") == "ok" or item.get("status") == "running":
                    ok_count += 1
                elif item.get("status") == "missing" or item.get("status") == "stopped":
                    warn_count += 1
                else:
                    fail_count += 1
        elif isinstance(result, dict):
            total += 1
            status = result.get("status", "unknown")
            if status in ("ok", "running"):
                ok_count += 1
            elif status in ("missing", "stopped"):
                warn_count += 1
            else:
                fail_count += 1

    print(f"\n  总计: {total} 项  |  通过: {ok_count}  |  警告: {warn_count}  |  失败: {fail_count}")
    if fail_count == 0 and warn_count == 0:
        print("\n  所有检测项通过！FlowForge 环境就绪。")
    elif fail_count == 0:
        print(f"\n  核心环境就绪，但有 {warn_count} 个警告项需要关注。")
    else:
        print(f"\n  有 {fail_count} 个必须修复的问题，请按上述提示操作。")

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