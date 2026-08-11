#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FlowForge 一键安装所有依赖环境 (install_all)

安装所有 9 个灵智体所需的依赖环境：
  1. Python 虚拟环境 (.venv)
  2. 后端 Python 依赖 (pip install -e .[dev])
  3. 前端 Node.js 依赖 (pnpm install)
  4. 7 个 AI CLI 工具 (claude/codex/gemini/opencode/codebuddy/qodercli/iflow)
  5. Kimi CLI (可选, pip install kimi-cli)
  6. .env 配置文件初始化
  7. 协议转换代理配置

支持代理:
  --npm-registry URL    设置 npm 镜像（如 https://registry.npmmirror.com）
  --pip-index-url URL   设置 pip 镜像
  --proxy URL           设置 HTTP/HTTPS 代理（如 http://127.0.0.1:7890）

用法:
  python scripts/install_all.py                              # 交互式安装
  python scripts/install_all.py --all                        # 安装全部
  python scripts/install_all.py --cli-only                   # 仅安装 CLI 工具
  python scripts/install_all.py --npm-registry https://registry.npmmirror.com
  python scripts/install_all.py --proxy http://127.0.0.1:7890
"""

from __future__ import annotations

import argparse
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

# 所有需要安装的 CLI 工具
CLI_TOOLS = [
    {
        "name": "claude",
        "package": "@anthropic-ai/claude-code",
        "forgekin": "vangogh (梵高)",
        "install": "npm",
        "env_key": "ANTHROPIC_API_KEY",
        "env_desc": "Anthropic API Key (claude-opus-4-6 等)",
    },
    {
        "name": "codex",
        "package": "@openai/codex",
        "forgekin": "sherlock (夏洛克)",
        "install": "npm",
        "env_key": "CODEX_API_KEY",
        "env_desc": "OpenAI API Key (gpt-5.3-codex 等)",
    },
    {
        "name": "gemini",
        "package": "@google/gemini-cli",
        "forgekin": "luban (鲁班)",
        "install": "npm",
        "env_key": "GEMINI_API_KEY",
        "env_desc": "Google Gemini API Key",
    },
    {
        "name": "opencode",
        "package": "@opencode-ai/cli",
        "forgekin": "wenxin/davinci/humming/sqrl",
        "install": "npm",
        "env_key": "",
        "env_desc": "无需 API key（内置默认模型）",
    },
    {
        "name": "codebuddy",
        "package": "codebuddy-cli",
        "forgekin": "davinci (达芬奇)",
        "install": "npm",
        "env_key": "CODEBUDDY_API_KEY",
        "env_desc": "CodeBuddy API Key (腾讯)",
    },
    {
        "name": "iflow",
        "package": "@iflow/cli",
        "forgekin": "keane (鹰·凯恩)",
        "install": "npm",
        "env_key": "IFLOW_API_KEY",
        "env_desc": "iFlow API Key (OpenAI-Compatible)",
    },
    {
        "name": "kimi",
        "package": "kimi-cli",
        "forgekin": "可选",
        "install": "pip",
        "env_key": "KIMI_API_KEY",
        "env_desc": "Moonshot Kimi API Key",
    },
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


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None, check: bool = True) -> int:
    """运行命令并实时输出"""
    print(f"  $ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, env=env)
    if check and result.returncode != 0:
        fail(f"命令失败 (exit {result.returncode}): {' '.join(cmd)}")
    return result.returncode


def find_binary(name: str) -> str | None:
    """查找可执行文件"""
    path = shutil.which(name)
    if path:
        return path
    if sys.platform == "win32":
        for ext in (".cmd", ".exe", ".bat"):
            p = shutil.which(f"{name}{ext}")
            if p:
                return p
    return None


def step_python_venv(npm_registry: str | None, pip_index: str | None, proxy: str | None) -> bool:
    """步骤 1: Python 虚拟环境"""
    section("[1/6] Python 虚拟环境")

    if sys.version_info < (3, 11):
        fail(f"Python {sys.version_info.major}.{sys.version_info.minor} 版本过低，需要 3.11+")
        return False

    ok(f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.micro}")

    if not VENV_DIR.exists():
        info("创建虚拟环境 .venv ...")
        run([sys.executable, "-m", "venv", str(VENV_DIR)])
    else:
        ok(".venv 已存在")

    # 激活虚拟环境（通过使用 venv 内的 pip）
    if sys.platform == "win32":
        pip = str(VENV_DIR / "Scripts" / "pip.exe")
        python = str(VENV_DIR / "Scripts" / "python.exe")
    else:
        pip = str(VENV_DIR / "bin" / "pip")
        python = str(VENV_DIR / "bin" / "python")

    # 安装后端依赖
    info("安装后端 Python 依赖 ...")
    cmd = [pip, "install", "-e", ".[dev]"]
    if pip_index:
        cmd += ["-i", pip_index]
    if proxy:
        cmd += ["--proxy", proxy]
    run(cmd, cwd=PROJECT_ROOT)

    return True


def step_web_deps(npm_registry: str | None, proxy: str | None) -> bool:
    """步骤 2: 前端依赖"""
    section("[2/6] 前端 Node.js 依赖")

    if not WEB_DIR.exists():
        fail(f"web 目录不存在: {WEB_DIR}")
        return False

    pnpm = shutil.which("pnpm") or shutil.which("pnpm.cmd")
    npm = shutil.which("npm") or shutil.which("npm.cmd")

    if not pnpm and not npm:
        fail("npm/pnpm 未安装，请先安装 Node.js 18+")
        return False

    pkg_manager = pnpm or npm
    pkg_name = "pnpm" if pnpm else "npm"

    # 设置镜像
    env = os.environ.copy()
    if npm_registry:
        env["npm_config_registry"] = npm_registry
        info(f"使用 npm 镜像: {npm_registry}")
    if proxy:
        env["HTTP_PROXY"] = proxy
        env["HTTPS_PROXY"] = proxy
        info(f"使用代理: {proxy}")

    node_modules = WEB_DIR / "node_modules"
    if node_modules.exists():
        ok("node_modules 已存在，跳过安装（如需重装请先删除）")
    else:
        info(f"使用 {pkg_name} 安装前端依赖 ...")
        if pkg_name == "pnpm":
            run([pkg_manager, "install"], cwd=WEB_DIR, env=env)
        else:
            run([pkg_manager, "install"], cwd=WEB_DIR, env=env)

    return True


def step_install_cli_tools(npm_registry: str | None, pip_index: str | None, proxy: str | None) -> dict:
    """步骤 3: 安装 AI CLI 工具"""
    section("[3/6] AI CLI 工具安装")

    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        fail("npm 未安装，无法安装 CLI 工具")
        return {"installed": [], "failed": [t["name"] for t in CLI_TOOLS]}

    env = os.environ.copy()
    if npm_registry:
        env["npm_config_registry"] = npm_registry
    if proxy:
        env["HTTP_PROXY"] = proxy
        env["HTTPS_PROXY"] = proxy

    installed = []
    failed = []

    for tool in CLI_TOOLS:
        name = tool["name"]
        package = tool["package"]
        forgekin = tool["forgekin"]

        # 检查是否已安装
        existing = find_binary(name)
        if existing:
            ok(f"{name:12s} 已安装 ({existing}) -> {forgekin}")
            installed.append(name)
            continue

        info(f"安装 {name} ({package}) -> {forgekin} ...")

        if tool["install"] == "npm":
            cmd = [npm, "install", "-g", package]
            if npm_registry:
                cmd += ["--registry", npm_registry]
            result = run(cmd, env=env, check=False)
        elif tool["install"] == "pip":
            if sys.platform == "win32":
                pip = str(VENV_DIR / "Scripts" / "pip.exe")
            else:
                pip = str(VENV_DIR / "bin" / "pip")
            cmd = [pip, "install", package]
            if pip_index:
                cmd += ["-i", pip_index]
            if proxy:
                cmd += ["--proxy", proxy]
            result = run(cmd, check=False)
        else:
            warn(f"{name}: 未知安装方式 {tool['install']}")
            failed.append(name)
            continue

        if result == 0:
            # 验证安装
            verify = find_binary(name)
            if verify:
                ok(f"{name:12s} 安装成功 ({verify})")
                installed.append(name)
            else:
                warn(f"{name:12s} 安装完成但未在 PATH 中找到（可能需要重启终端）")
                installed.append(name)
        else:
            fail(f"{name:12s} 安装失败")
            failed.append(name)

    return {"installed": installed, "failed": failed}


def step_env_file() -> bool:
    """步骤 4: 生成 .env 配置文件"""
    section("[4/6] .env 配置文件")

    if ENV_FILE.exists():
        ok(".env 已存在，跳过生成（如需重新生成请先备份并删除）")
        return True

    if ENV_EXAMPLE.exists():
        info("从 .env.example 复制 ...")
        shutil.copy(ENV_EXAMPLE, ENV_FILE)
        ok(".env 已生成")
    else:
        info("创建最小 .env ...")
        minimal_env = """# FlowForge 环境配置
# 请填入你的 API key（运行 python scripts/doctor.py 检测配置状态）

# === AI CLI API Keys ===
ANTHROPIC_API_KEY=
CODEX_API_KEY=
GEMINI_API_KEY=
CODEBUDDY_API_KEY=
IFLOW_API_KEY=
KIMI_API_KEY=

# === OpenRoute (统一转发) ===
OPENROUTE_API_KEY=
OPENROUTE_BASE_URL=https://openrouter.ai/api/v1

# === 代理服务 ===
CLAUDE_CODE_ROUTER_PORT=3456
RESPONSES_PROXY_PORT=8084
GEMINI_PROXY_PORT=8082

# === Trae 桥接 ===
FLOWFORGE_BRIDGE_DIR=

# === 后端 ===
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8000

# === 前端 ===
FRONTEND_PORT=5174
"""
        ENV_FILE.write_text(minimal_env, encoding="utf-8")
        ok(".env 已生成（最小配置）")

    warn("请编辑 .env 填入 API key，或通过 Web 界面的灵智训练营引导配置")
    return True


def step_proxy_config(proxy: str | None) -> bool:
    """步骤 5: 协议转换代理配置"""
    section("[5/6] 协议转换代理")

    if proxy:
        info(f"配置 HTTP 代理: {proxy}")
        # 写入 .env
        if ENV_FILE.exists():
            content = ENV_FILE.read_text(encoding="utf-8")
            if "HTTP_PROXY=" not in content:
                content += f"\n# 代理\nHTTP_PROXY={proxy}\nHTTPS_PROXY={proxy}\n"
                ENV_FILE.write_text(content, encoding="utf-8")
                ok(f"已将代理配置写入 .env")
            else:
                ok(".env 中已有代理配置")
    else:
        info("未指定代理（如需代理请使用 --proxy 参数）")
        info("协议转换代理（claude-code-router/responses-proxy/gemini-proxy）")
        info("  这些代理将 CLI 请求转发到 OpenRoute，无需单独 API key")
        info("  启动时由 scripts/start.py 自动管理")

    return True


def step_summary(installed: list, failed: list) -> None:
    """步骤 6: 汇总"""
    section("[6/6] 安装汇总")

    print(f"\n  已安装 CLI: {len(installed)}/{len(CLI_TOOLS)}")
    if installed:
        for name in installed:
            print(f"    [OK] {name}")
    if failed:
        print(f"\n  安装失败: {len(failed)}")
        for name in failed:
            print(f"    [FAIL] {name}")

    print(f"\n  下一步:")
    print(f"    1. 编辑 .env 填入 API key（或通过 Web 界面灵智训练营配置）")
    print(f"    2. 运行 python scripts/doctor.py 检测环境")
    print(f"    3. 运行 python scripts/start.py 启动 FlowForge")
    print(f"    4. 访问 http://localhost:5174 开始使用")


def main():
    parser = argparse.ArgumentParser(description="FlowForge 一键安装所有依赖环境")
    parser.add_argument("--all", action="store_true", help="安装全部（不交互）")
    parser.add_argument("--cli-only", action="store_true", help="仅安装 CLI 工具")
    parser.add_argument("--npm-registry", default=None, help="npm 镜像 URL")
    parser.add_argument("--pip-index-url", default=None, help="pip 镜像 URL")
    parser.add_argument("--proxy", default=None, help="HTTP/HTTPS 代理 URL")
    args = parser.parse_args()

    print("FlowForge 一键安装")
    print(f"项目根目录: {PROJECT_ROOT}")
    print(f"Python: {sys.executable}")

    # 设置默认镜像（中国用户友好）
    npm_registry = args.npm_registry
    pip_index = args.pip_index_url
    proxy = args.proxy

    if args.cli_only:
        step_install_cli_tools(npm_registry, pip_index, proxy)
        return

    # 全量安装
    step1_ok = step_python_venv(npm_registry, pip_index, proxy)
    step2_ok = step_web_deps(npm_registry, proxy)
    cli_result = step_install_cli_tools(npm_registry, pip_index, proxy)
    step_env_file()
    step_proxy_config(proxy)
    step_summary(cli_result["installed"], cli_result["failed"])

    if not step1_ok or not step2_ok:
        fail("部分步骤失败，请按上述提示修复")
        sys.exit(1)


if __name__ == "__main__":
    main()