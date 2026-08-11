#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FlowForge 一键启动脚本 (start_all)

启动所有 FlowForge 服务：
  1. 后端 FastAPI (uvicorn)
  2. 前端 Next.js dev server
  3. 协议转换代理 (claude-code-router / responses-proxy / gemini-proxy)
  4. Trae 桥接 operator (可选)

支持:
  --backend-only    仅启动后端
  --frontend-only   仅启动前端
  --prod            生产模式（前端 next start）
  --proxy           启动协议转换代理
  --daemon          后台运行

用法:
  python scripts/start_all.py                    # 开发模式启动全部
  python scripts/start_all.py --prod             # 生产模式
  python scripts/start_all.py --backend-only     # 仅后端
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VENV_DIR = PROJECT_ROOT / ".venv"
WEB_DIR = PROJECT_ROOT / "web"
LOGS_DIR = PROJECT_ROOT / "logs"
ENV_FILE = PROJECT_ROOT / ".env"

BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = 8000
FRONTEND_PORT = 5174

# 代理服务配置
PROXIES = [
    {"name": "claude-code-router", "port": 3456, "module": "claude_code_router"},
    {"name": "responses-proxy", "port": 8084, "module": "responses_proxy"},
    {"name": "gemini-proxy", "port": 8082, "module": "gemini_proxy"},
]

processes: list[subprocess.Popen] = []


def section(title: str) -> None:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def ok(msg: str) -> None:
    print(f"  [OK]   {msg}")


def fail(msg: str) -> None:
    print(f"  [FAIL] {msg}")


def info(msg: str) -> None:
    print(f"  [INFO] {msg}")


def warn(msg: str) -> None:
    print(f"  [WARN] {msg}")


def get_python() -> str:
    """获取虚拟环境中的 Python"""
    if sys.platform == "win32":
        p = VENV_DIR / "Scripts" / "python.exe"
    else:
        p = VENV_DIR / "bin" / "python"
    if p.exists():
        return str(p)
    return sys.executable


def get_pip() -> str:
    """获取虚拟环境中的 pip"""
    if sys.platform == "win32":
        return str(VENV_DIR / "Scripts" / "pip.exe")
    return str(VENV_DIR / "bin" / "pip")


def load_env() -> dict:
    """加载 .env 环境变量"""
    env = os.environ.copy()
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").split("\n"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and value:
                    env[key] = value
    return env


def wait_for_port(port: int, timeout: int = 60, name: str = "") -> bool:
    """等待端口就绪"""
    import socket
    start = time.time()
    while time.time() - start < timeout:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex(("127.0.0.1", port))
            sock.close()
            if result == 0:
                ok(f"{name} 就绪 (端口 {port})")
                return True
        except Exception:
            pass
        time.sleep(1)
    fail(f"{name} 启动超时 (端口 {port}, {timeout}s)")
    return False


def start_backend(env: dict, prod: bool = False) -> subprocess.Popen | None:
    """启动后端 FastAPI"""
    section("[1/3] 后端 FastAPI")

    python = get_python()
    cmd = [python, "-m", "uvicorn", "app.main:app", "--host", BACKEND_HOST, "--port", str(BACKEND_PORT)]
    if not prod:
        cmd.append("--reload")

    log_file = LOGS_DIR / "backend.log"
    log_file.parent.mkdir(exist_ok=True)

    info(f"启动后端: {' '.join(cmd)}")
    info(f"日志: {log_file}")

    with open(log_file, "w", encoding="utf-8") as f:
        proc = subprocess.Popen(
            cmd,
            cwd=PROJECT_ROOT,
            env=env,
            stdout=f,
            stderr=subprocess.STDOUT,
        )
    processes.append(proc)
    ok(f"后端进程 PID: {proc.pid}")

    if wait_for_port(BACKEND_PORT, timeout=60, name="后端"):
        return proc
    return None


def start_frontend(env: dict, prod: bool = False) -> subprocess.Popen | None:
    """启动前端 Next.js"""
    section("[2/3] 前端 Next.js")

    # 检测包管理器（shutil 已在文件顶部导入）
    pnpm = shutil.which("pnpm") or shutil.which("pnpm.cmd")
    npm = shutil.which("npm") or shutil.which("npm.cmd")

    if pnpm:
        pkg_manager = pnpm
        pkg_name = "pnpm"
    elif npm:
        pkg_manager = npm
        pkg_name = "npm"
    else:
        fail("npm/pnpm 未安装")
        return None

    if prod:
        # 生产模式：先 build 再 start
        info("构建前端 ...")
        subprocess.run([pkg_manager, "run", "build"], cwd=WEB_DIR, env=env)
        cmd = [pkg_manager, "run", "start", "--", "-p", str(FRONTEND_PORT)]
    else:
        cmd = [pkg_manager, "run", "dev", "--", "-p", str(FRONTEND_PORT)]

    env["PORT"] = str(FRONTEND_PORT)

    log_file = LOGS_DIR / "frontend.log"
    info(f"启动前端: {pkg_name} {' '.join(cmd[1:])}")
    info(f"日志: {log_file}")

    with open(log_file, "w", encoding="utf-8") as f:
        proc = subprocess.Popen(
            cmd,
            cwd=WEB_DIR,
            env=env,
            stdout=f,
            stderr=subprocess.STDOUT,
        )
    processes.append(proc)
    ok(f"前端进程 PID: {proc.pid}")

    if wait_for_port(FRONTEND_PORT, timeout=120, name="前端"):
        return proc
    return None


def start_proxies(env: dict) -> list[subprocess.Popen]:
    """启动协议转换代理"""
    section("[3/4] 协议转换代理")

    python = get_python()
    started = []

    for proxy in PROXIES:
        # 检查端口是否已被占用
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex(("127.0.0.1", proxy["port"]))
        sock.close()

        if result == 0:
            ok(f"{proxy['name']} 端口 {proxy['port']} 已被占用（可能已运行）")
            continue

        # 尝试启动代理（如果模块存在）
        log_file = LOGS_DIR / f"{proxy['name']}.log"
        try:
            cmd = [python, "-m", proxy["module"]]
            info(f"启动 {proxy['name']}: {' '.join(cmd)}")
            with open(log_file, "w", encoding="utf-8") as f:
                proc = subprocess.Popen(
                    cmd,
                    cwd=PROJECT_ROOT,
                    env=env,
                    stdout=f,
                    stderr=subprocess.STDOUT,
                )
            processes.append(proc)
            started.append(proc)
            ok(f"{proxy['name']} PID: {proc.pid}")
        except FileNotFoundError:
            warn(f"{proxy['name']} 模块未安装，跳过")
        except Exception as e:
            warn(f"{proxy['name']} 启动失败: {e}")

    return started


def start_bridge_operator(env: dict) -> subprocess.Popen | None:
    """启动 Trae 桥接 operator（butterfly 灵智体依赖）.

    butterfly 灵智体通过 TraeLLMClient 写入 request 文件，
    需要 bridge_operator 进程读取并调用 LLM 后写回 response 文件。
    若不启动此进程，butterfly 的所有请求会超时（5 分钟）。
    """
    section("[4/4] Trae 桥接 Operator")

    # 检查是否配置了 OpenRoute API key
    api_key = env.get("OPENROUTE_API_KEY", "")
    if not api_key:
        warn("OPENROUTE_API_KEY 未配置，butterfly 灵智体将无法使用 LLM 能力")
        warn("请在 .env 中设置 OPENROUTE_API_KEY=sk-or-v1-xxx")
        return None

    python = get_python()
    log_file = LOGS_DIR / "bridge_operator.log"

    # 检查 bridge_dir 是否配置
    bridge_dir = env.get("FLOWFORGE_BRIDGE_DIR", "")
    if not bridge_dir:
        bridge_dir = str(PROJECT_ROOT / ".trae_bridge")
        env["FLOWFORGE_BRIDGE_DIR"] = bridge_dir

    info(f"桥接目录: {bridge_dir}")
    info(f"启动 Trae 桥接 Operator ...")

    try:
        cmd = [python, "-m", "flowforge.llm.trae.bridge_operator"]
        with open(log_file, "w", encoding="utf-8") as f:
            proc = subprocess.Popen(
                cmd,
                cwd=PROJECT_ROOT,
                env=env,
                stdout=f,
                stderr=subprocess.STDOUT,
            )
        processes.append(proc)
        ok(f"Trae 桥接 Operator PID: {proc.pid}")
        ok(f"日志: {log_file}")
        return proc
    except FileNotFoundError:
        warn("flowforge.llm.trae.bridge_operator 模块未找到，跳过")
        return None
    except Exception as e:
        warn(f"Trae 桥接 Operator 启动失败: {e}")
        return None


def cleanup(signum=None, frame=None):
    """清理所有子进程"""
    section("停止服务")
    for proc in reversed(processes):
        if proc.poll() is None:
            info(f"停止 PID {proc.pid} ...")
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            except Exception:
                pass
    print("\n所有服务已停止")
    sys.exit(0)


def main():
    parser = argparse.ArgumentParser(description="FlowForge 一键启动")
    parser.add_argument("--backend-only", action="store_true", help="仅启动后端")
    parser.add_argument("--frontend-only", action="store_true", help="仅启动前端")
    parser.add_argument("--prod", action="store_true", help="生产模式")
    parser.add_argument("--no-proxy", action="store_true", help="不启动协议转换代理")
    parser.add_argument("--no-bridge", action="store_true", help="不启动 Trae 桥接 Operator")
    args = parser.parse_args()

    # 注册信号处理
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    env = load_env()
    LOGS_DIR.mkdir(exist_ok=True)

    print("FlowForge 一键启动")
    print(f"项目根目录: {PROJECT_ROOT}")
    print(f"后端: http://{BACKEND_HOST}:{BACKEND_PORT}")
    print(f"前端: http://localhost:{FRONTEND_PORT}")

    # 检查虚拟环境
    if not VENV_DIR.exists():
        fail(".venv 不存在，请先运行 python scripts/install_all.py")
        sys.exit(1)

    started_any = False

    if not args.frontend_only:
        if start_backend(env, prod=args.prod):
            started_any = True

    if not args.backend_only:
        if start_frontend(env, prod=args.prod):
            started_any = True

    if not args.no_proxy and not args.backend_only and not args.frontend_only:
        start_proxies(env)

    # 启动 Trae 桥接 Operator（butterfly 灵智体依赖）
    if not args.no_bridge and not args.backend_only and not args.frontend_only:
        start_bridge_operator(env)

    if started_any:
        section("启动完成")
        print(f"\n  FlowForge 已启动:")
        print(f"    前端: http://localhost:{FRONTEND_PORT}")
        print(f"    后端: http://{BACKEND_HOST}:{BACKEND_PORT}")
        print(f"    API 文档: http://{BACKEND_HOST}:{BACKEND_PORT}/docs")
        print(f"\n  日志目录: {LOGS_DIR}")
        print(f"\n  按 Ctrl+C 停止所有服务")
        print(f"\n  首次使用？访问 http://localhost:{FRONTEND_PORT}/council 点击'灵智训练营'按钮")

        # 等待所有进程结束
        try:
            for proc in processes:
                proc.wait()
        except KeyboardInterrupt:
            cleanup()
    else:
        fail("无服务启动成功")
        sys.exit(1)


if __name__ == "__main__":
    main()