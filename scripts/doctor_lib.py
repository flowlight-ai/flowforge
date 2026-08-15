#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FlowForge 环境检测核心库（doctor_lib）

从 doctor.py 提取的纯检测逻辑，**不输出 stdout**，只返回结构化 dict。
可被以下模块导入复用：
    - scripts/doctor.py         （CLI 入口，负责打印）
    - app/api/agents/bootcamp.py（bootcamp env-check 端点）

核心入口：
    - run_full_check() -> dict  返回 bootcamp env-check 端点所需的完整结构

检测覆盖：
    - 核心工具：python / node / npm / git / pnpm
    - AI CLI 工具：8 个灵智体所需的 claude/codex/gemini/opencode/codebuddy/qodercli/iflow/kimi
    - 协议代理：claude-code-router / responses-proxy / gemini-proxy
    - Trae 桥接目录（butterfly 灵智体）
    - .env 配置文件、.venv 虚拟环境、web/node_modules 前端依赖
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path
from typing import Any

# ── 项目路径常量 ───────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
VENV_DIR = PROJECT_ROOT / ".venv"
WEB_DIR = PROJECT_ROOT / "web"
ENV_FILE = PROJECT_ROOT / ".env"
ENV_EXAMPLE = PROJECT_ROOT / ".env.example"

# ── 8 个灵智体对应的 CLI 工具配置 ──────────────────────────────
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

# ── 协议代理服务配置 ──────────────────────────────────────────
PROXIES = [
    {"name": "claude-code-router", "port": 3456, "desc": "Claude Code 转发代理"},
    {"name": "responses-proxy", "port": 8084, "desc": "Codex responses 转发代理"},
    {"name": "gemini-proxy", "port": 8082, "desc": "Gemini CLI 转发代理"},
]

# 额外的 CLI PATH 搜索目录（覆盖 nvm/volta/bun/go 等）
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


# ── 工具函数（不输出 stdout）───────────────────────────────────

def find_binary(name: str) -> str | None:
    """在 PATH 和额外目录中查找可执行文件，返回绝对路径或 None。"""
    path = shutil.which(name)
    if path:
        return path
    # Windows .cmd / .exe shim
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
    """执行 `<tool> --version`，返回首行版本字符串或 None。"""
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return result.stdout.strip().split("\n")[0][:80]
    except Exception:
        pass
    return None


# ── 单项检测函数（不输出 stdout，返回结构化 dict）──────────────

def check_python() -> dict:
    """检测 Python 版本（要求 3.11+）"""
    version = sys.version_info
    version_str = f"{version.major}.{version.minor}.{version.micro}"
    if version >= (3, 11):
        return {
            "name": "python",
            "status": "ok",
            "version": version_str,
            "path": sys.executable,
        }
    return {
        "name": "python",
        "status": "fail",
        "version": version_str,
        "required": "3.11+",
        "path": sys.executable,
    }


def check_node() -> dict:
    """检测 Node.js（要求 18+）"""
    node_path = find_binary("node")
    if not node_path:
        return {"name": "node", "status": "fail", "required": "18+"}
    version = get_version(["node", "--version"]) or ""
    if not version:
        return {"name": "node", "status": "ok", "path": node_path, "version": ""}
    try:
        major = int(version.lstrip("v").split(".")[0])
        if major < 18:
            return {
                "name": "node",
                "status": "fail",
                "version": version,
                "required": "18+",
                "path": node_path,
            }
    except Exception:
        pass
    return {"name": "node", "status": "ok", "version": version, "path": node_path}


def check_npm() -> dict:
    """检测 npm（随 Node.js 安装）"""
    npm_path = find_binary("npm")
    if not npm_path:
        return {"name": "npm", "status": "fail"}
    version = get_version(["npm", "--version"]) or ""
    return {"name": "npm", "status": "ok", "version": version, "path": npm_path}


def check_pnpm() -> dict:
    """检测 pnpm（可选，缺失仅警告）"""
    pnpm_path = find_binary("pnpm")
    if not pnpm_path:
        return {"name": "pnpm", "status": "missing"}
    version = get_version(["pnpm", "--version"]) or ""
    return {"name": "pnpm", "status": "ok", "version": version, "path": pnpm_path}


def check_git() -> dict:
    """检测 Git"""
    git_path = find_binary("git")
    if not git_path:
        return {"name": "git", "status": "fail"}
    version = get_version(["git", "--version"]) or ""
    return {"name": "git", "status": "ok", "version": version, "path": git_path}


def check_cli_tools() -> list[dict]:
    """检测所有 AI CLI 工具（8 个灵智体所需）"""
    results = []
    for tool in CLI_TOOLS:
        path = find_binary(tool["name"])
        if path:
            version = get_version([tool["name"], "--version"]) or ""
            results.append({
                "name": tool["name"],
                "status": "ok",
                "path": path,
                "version": version,
                "forgekin": tool["forgekin"],
                "install_cmd": f"npm install -g {tool['package']}" if tool["install"] == "npm" else f"pip install {tool['package']}",
                "note": tool["note"],
            })
        else:
            install_cmd = (
                f"npm install -g {tool['package']}"
                if tool["install"] == "npm"
                else f"pip install {tool['package']}"
            )
            results.append({
                "name": tool["name"],
                "status": "missing",
                "forgekin": tool["forgekin"],
                "install_cmd": install_cmd,
                "note": tool["note"],
            })
    return results


def check_proxies() -> list[dict]:
    """检测 3 个协议代理服务（127.0.0.1 端口连通性）"""
    results = []
    for proxy in PROXIES:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        try:
            result = sock.connect_ex(("127.0.0.1", proxy["port"]))
            if result == 0:
                results.append({
                    "name": proxy["name"],
                    "status": "running",
                    "port": proxy["port"],
                    "desc": proxy["desc"],
                })
            else:
                results.append({
                    "name": proxy["name"],
                    "status": "stopped",
                    "port": proxy["port"],
                    "desc": proxy["desc"],
                })
        except Exception:
            results.append({
                "name": proxy["name"],
                "status": "unknown",
                "port": proxy["port"],
                "desc": proxy["desc"],
            })
        finally:
            sock.close()
    return results


def check_env_file() -> dict:
    """检测 .env 配置文件（含关键 API key 检测）"""
    if not ENV_FILE.exists():
        return {
            "name": ".env",
            "status": "missing",
            "exists": False,
            "has_api_keys": False,
        }
    content = ENV_FILE.read_text(encoding="utf-8")
    keys = ["ANTHROPIC_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "OPENROUTE_API_KEY"]
    configured = 0
    for key in keys:
        line = [l for l in content.split("\n") if l.startswith(f"{key}=")]
        if line and len(line[0]) > len(f"{key}=") + 10:
            configured += 1
    return {
        "name": ".env",
        "status": "ok",
        "exists": True,
        "has_api_keys": configured > 0,
        "configured_keys": configured,
        "total_keys": len(keys),
    }


def check_venv() -> dict:
    """检测 .venv 虚拟环境"""
    if VENV_DIR.exists():
        return {"name": ".venv", "status": "ok", "exists": True}
    return {"name": ".venv", "status": "missing", "exists": False}


def check_web_deps() -> dict:
    """检测前端依赖（web/node_modules）"""
    if (WEB_DIR / "node_modules").exists():
        return {"name": "web_deps", "status": "ok", "exists": True}
    return {"name": "web_deps", "status": "missing", "exists": False}


def check_trae_bridge() -> dict:
    """检测 Trae 桥接目录（butterfly 灵智体所需，FLOWFORGE_BRIDGE_DIR 环境变量）"""
    bridge_dir = os.environ.get("FLOWFORGE_BRIDGE_DIR", "")
    if bridge_dir and os.path.isdir(bridge_dir):
        return {
            "name": "trae_bridge",
            "status": "ok",
            "exists": True,
            "bridge_dir": bridge_dir,
        }
    return {
        "name": "trae_bridge",
        "status": "missing",
        "exists": False,
        "bridge_dir": "",
    }


# ── 主入口：返回 bootcamp env-check 端点所需的结构化结果 ───────

def run_full_check() -> dict[str, Any]:
    """运行全量检测，返回 bootcamp env-check 端点所需的结构化结果。

    返回格式与 bootcamp.py 的 EnvCheckResult 端点契约一致：
        {
            "core_tools": {tool_name: {ok, version, path}},
            "cli_tools": {tool_name: {ok, version/path 或 error, install_cmd, forgekin}},
            "proxy_services": {name: {ok, port, status}},
            "trae_bridge": {ok, dir, status},
            "env_file": {...},
            "venv": {...},
            "web_deps": {...},
            "all_ready": bool,           # 是否全部就绪（核心+CLI+代理+桥接）
            "missing": [str],            # 缺失项名称列表
            "install_hint": str,         # 给用户的安装提示文案
        }
    """
    python_r = check_python()
    node_r = check_node()
    npm_r = check_npm()
    pnpm_r = check_pnpm()
    git_r = check_git()
    cli_list = check_cli_tools()
    proxy_list = check_proxies()
    env_r = check_env_file()
    venv_r = check_venv()
    web_r = check_web_deps()
    trae_r = check_trae_bridge()

    # ── core_tools（5 项：python/node/npm/git/pnpm）──────────
    core_tools: dict[str, dict[str, Any]] = {
        "python": {
            "ok": python_r["status"] == "ok",
            "version": python_r.get("version", ""),
            "path": python_r.get("path", ""),
            "required": python_r.get("required", ""),
        },
        "node": {
            "ok": node_r["status"] == "ok",
            "version": node_r.get("version", ""),
            "path": node_r.get("path", ""),
            "required": node_r.get("required", ""),
        },
        "npm": {
            "ok": npm_r["status"] == "ok",
            "version": npm_r.get("version", ""),
            "path": npm_r.get("path", ""),
        },
        "git": {
            "ok": git_r["status"] == "ok",
            "version": git_r.get("version", ""),
            "path": git_r.get("path", ""),
        },
        "pnpm": {
            "ok": pnpm_r["status"] == "ok",
            "version": pnpm_r.get("version", ""),
            "path": pnpm_r.get("path", ""),
        },
    }

    # ── cli_tools（8 项：claude/codex/gemini/opencode/codebuddy/qodercli/iflow/kimi）
    cli_tools: dict[str, dict[str, Any]] = {}
    for item in cli_list:
        name = item["name"]
        if item["status"] == "ok":
            cli_tools[name] = {
                "ok": True,
                "version": item.get("version") or "",
                "path": item.get("path", ""),
                "forgekin": item.get("forgekin", ""),
                "note": item.get("note", ""),
            }
        else:
            cli_tools[name] = {
                "ok": False,
                "error": "not found",
                "install_cmd": item.get("install_cmd", ""),
                "forgekin": item.get("forgekin", ""),
                "note": item.get("note", ""),
            }

    # ── proxy_services（3 项：claude-code-router/responses-proxy/gemini-proxy）
    proxy_services: dict[str, dict[str, Any]] = {}
    for item in proxy_list:
        proxy_services[item["name"]] = {
            "ok": item["status"] == "running",
            "port": item.get("port"),
            "status": item["status"],
            "desc": item.get("desc", ""),
        }

    # ── trae_bridge（butterfly 灵智体所需）
    trae_bridge = {
        "ok": trae_r["status"] == "ok",
        "dir": trae_r.get("bridge_dir", ""),
        "status": trae_r["status"],
    }

    # ── 计算缺失项 ──────────────────────────────────────────
    missing: list[str] = []
    for name, r in core_tools.items():
        # pnpm 视为可选，不纳入"必须就绪"判定
        if name == "pnpm":
            continue
        if not r["ok"]:
            missing.append(name)
    for name, r in cli_tools.items():
        if not r["ok"]:
            missing.append(name)
    for name, r in proxy_services.items():
        if not r["ok"]:
            missing.append(name)
    if not trae_bridge["ok"]:
        missing.append("trae_bridge")

    all_ready = len(missing) == 0

    # ── 生成安装提示文案 ────────────────────────────────────
    if all_ready:
        install_hint = "✅ 环境就绪！可以开始使用 FlowForge。"
    else:
        install_hint = (
            f"检测到 {len(missing)} 项缺失: {', '.join(missing)}。"
            "请运行 install.bat（Windows）或 ./install.sh（Unix）一键安装。"
        )

    return {
        "core_tools": core_tools,
        "cli_tools": cli_tools,
        "proxy_services": proxy_services,
        "trae_bridge": trae_bridge,
        "env_file": env_r,
        "venv": venv_r,
        "web_deps": web_r,
        "all_ready": all_ready,
        "missing": missing,
        "install_hint": install_hint,
    }
