#!/usr/bin/env python
"""Start FlowForge backend + frontend dev servers (cross-platform).

Launches the FastAPI backend (uvicorn) and the Next.js dev server as
background processes, streams their output to logs/, waits for readiness,
prints access URLs, and gracefully stops both on Ctrl+C.

Run:  python scripts/start.py
Options: --backend-only / --frontend-only
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = PROJECT_ROOT / "web"
LOGS_DIR = PROJECT_ROOT / "logs"
VENV_DIR = PROJECT_ROOT / ".venv"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_BACKEND_PORT = 8000
DEFAULT_FRONTEND_PORT = 5175

BACKEND_READY_TIMEOUT = 90.0  # backend imports many modules; allow generous time
FRONTEND_READY_TIMEOUT = 90.0  # Next.js first compile can be slow


def section(title: str) -> None:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def venv_python() -> str:
    """Preferred Python interpreter: venv if present, else current interpreter."""
    if sys.platform == "win32":
        candidate = VENV_DIR / "Scripts" / "python.exe"
    else:
        candidate = VENV_DIR / "bin" / "python"
    if candidate.exists():
        return str(candidate)
    return sys.executable


def npm_args(extra: list[str]) -> list[str]:
    """Build a cross-platform npm invocation (handles Windows npm.cmd)."""
    if sys.platform == "win32":
        return ["cmd", "/c", "npm", *extra]
    return ["npm", *extra]


def start_process(
    cmd: list[str],
    log_path: Path,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> tuple[subprocess.Popen, object]:
    """Start a background process whose stdout+stderr append to log_path.

    Returns (Popen, opened_log_file). The caller is responsible for closing
    the log file after terminating the process.
    """
    log_file = log_path.open("a", encoding="utf-8")
    kwargs: dict = {
        "stdout": log_file,
        "stderr": subprocess.STDOUT,
        "cwd": str(cwd) if cwd else None,
    }
    if env is not None:
        kwargs["env"] = env
    if sys.platform == "win32":
        # New process group so CTRL_BREAK_EVENT can reach the whole tree
        # (npm spawns child processes — killing only npm would orphan them).
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        # New session so SIGTERM reaches the whole process group.
        kwargs["start_new_session"] = True
    proc = subprocess.Popen(cmd, **kwargs)
    return proc, log_file


def terminate(proc: subprocess.Popen, log_file: object | None) -> None:
    """Gracefully terminate a process and its children, then close its log."""
    if proc.poll() is not None:
        if log_file is not None:
            try:
                log_file.close()
            except OSError:
                pass
        return
    if sys.platform == "win32":
        try:
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        except OSError:
            proc.terminate()
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except OSError:
            proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            proc.wait(timeout=3)
        except OSError:
            pass
    if log_file is not None:
        try:
            log_file.close()
        except OSError:
            pass


def wait_for_url(url: str, timeout: float, name: str) -> bool:
    """Poll a URL until it responds (2xx-4xx) or timeout. Returns readiness."""
    print(f"  Waiting for {name} at {url} ...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if 200 <= resp.status < 500:
                    return True
        except OSError:
            time.sleep(1)
    return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Start FlowForge backend + frontend dev servers (cross-platform).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Default services:\n"
            "  backend  : uvicorn on http://127.0.0.1:8000  (logs/backend.log)\n"
            "  frontend : next dev  on http://127.0.0.1:5175  (logs/frontend.log)\n"
            "Press Ctrl+C to stop both services gracefully.\n"
        ),
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--backend-only",
        action="store_true",
        help="start only the backend (uvicorn)",
    )
    mode.add_argument(
        "--frontend-only",
        action="store_true",
        help="start only the frontend (next dev)",
    )
    parser.add_argument(
        "--host",
        default=DEFAULT_HOST,
        help=f"backend bind host (default: {DEFAULT_HOST})",
    )
    parser.add_argument(
        "--backend-port",
        type=int,
        default=DEFAULT_BACKEND_PORT,
        help=f"backend port (default: {DEFAULT_BACKEND_PORT})",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    start_backend = not args.frontend_only
    start_frontend = not args.backend_only

    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    backend_log = LOGS_DIR / "backend.log"
    frontend_log = LOGS_DIR / "frontend.log"

    print("=" * 72)
    print("FlowForge Dev Server Launcher")
    print(f"  Platform: {sys.platform}")
    print(f"  Project:  {PROJECT_ROOT}")
    print(f"  Logs dir: {LOGS_DIR}")
    print("=" * 72)

    # Light preflight checks with actionable hints.
    if start_backend and not VENV_DIR.exists():
        print(f"\n  [WARN] .venv not found at {VENV_DIR}")
        print("         Run `python scripts/setup.py` first, or activate your venv.")
    if start_frontend and not (WEB_DIR / "node_modules").is_dir():
        print(f"\n  [WARN] web/node_modules not found")
        print("         Run `python scripts/setup.py` (or `cd web && npm install`) first.")

    procs: list[tuple[str, subprocess.Popen, object]] = []

    try:
        if start_backend:
            section("Starting backend (uvicorn)")
            py = venv_python()
            cmd = [
                py, "-m", "uvicorn", "flowforge.app.main:app",
                "--host", args.host, "--port", str(args.backend_port),
            ]
            # The repo root IS the ``flowforge`` package (root __init__.py), so
            # the parent directory must be importable for ``flowforge.app.main``.
            env = dict(os.environ)
            parent = str(PROJECT_ROOT.parent)
            existing = env.get("PYTHONPATH", "")
            env["PYTHONPATH"] = f"{parent}{os.pathsep}{existing}" if existing else parent
            print(f"  $ {' '.join(cmd)}")
            print(f"  log -> {backend_log}")
            proc, lf = start_process(cmd, backend_log, cwd=PROJECT_ROOT, env=env)
            procs.append(("backend", proc, lf))

        if start_frontend:
            section("Starting frontend (next dev)")
            cmd = npm_args(["run", "dev"])
            print(f"  $ {' '.join(cmd)}")
            print(f"  log -> {frontend_log}")
            proc, lf = start_process(cmd, frontend_log, cwd=WEB_DIR)
            procs.append(("frontend", proc, lf))

        # Wait for readiness.
        ready_ok = True
        if start_backend:
            health_url = f"http://{args.host}:{args.backend_port}/health"
            if wait_for_url(health_url, BACKEND_READY_TIMEOUT, "backend"):
                print(f"  [OK] backend ready")
            else:
                print(f"  [FAIL] backend not ready after {BACKEND_READY_TIMEOUT:.0f}s")
                print(f"         check {backend_log}")
                ready_ok = False
        if start_frontend:
            web_url = f"http://127.0.0.1:{DEFAULT_FRONTEND_PORT}/"
            if wait_for_url(web_url, FRONTEND_READY_TIMEOUT, "frontend"):
                print(f"  [OK] frontend ready")
            else:
                print(f"  [FAIL] frontend not ready after {FRONTEND_READY_TIMEOUT:.0f}s")
                print(f"         check {frontend_log}")
                ready_ok = False

        section("Access URLs")
        if start_backend:
            print(f"  Backend API : http://{args.host}:{args.backend_port}")
            print(f"  Health      : http://{args.host}:{args.backend_port}/health")
            print(f"  Docs (API)  : http://{args.host}:{args.backend_port}/docs")
        if start_frontend:
            print(f"  Web UI      : http://127.0.0.1:{DEFAULT_FRONTEND_PORT}")
        print(f"\n  Logs: {backend_log}  /  {frontend_log}")
        print("  Press Ctrl+C to stop both services.\n")

        if not ready_ok:
            print("  [WARN] one or more services failed to become ready.")
            print("         Keeping the other service alive; Ctrl+C to exit.")

        # Block until any service exits or user interrupts.
        while True:
            for name, proc, _ in procs:
                rc = proc.poll()
                if rc is not None:
                    print(f"\n  [WARN] {name} exited (code={rc}). See its log file.")
                    raise KeyboardInterrupt
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping services ...")
    finally:
        for name, proc, lf in procs:
            print(f"  stopping {name} (pid={proc.pid}) ...")
            terminate(proc, lf)
        print("All services stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
