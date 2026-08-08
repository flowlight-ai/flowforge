#!/usr/bin/env python
"""FlowForge one-click environment setup (cross-platform: Windows/macOS/Linux).

Checks Python 3.11+ and Node.js 18+, creates a virtualenv (.venv), installs
backend dependencies (pip install -e .[dev]), installs and builds the Next.js
frontend, and seeds .env from .env.example.

Run:  python scripts/setup.py
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = PROJECT_ROOT / "web"
VENV_DIR = PROJECT_ROOT / ".venv"
ENV_EXAMPLE = PROJECT_ROOT / ".env.example"
ENV_FILE = PROJECT_ROOT / ".env"

MIN_PYTHON = (3, 11)
MIN_NODE = (18, 0)


def section(title: str) -> None:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def ok(msg: str) -> None:
    print(f"  [OK] {msg}")


def fail(msg: str) -> None:
    print(f"  [FAIL] {msg}")


def venv_python() -> Path:
    """Return the venv interpreter path for the current platform."""
    if sys.platform == "win32":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def npm_args(extra: list[str]) -> list[str]:
    """Build a cross-platform npm invocation (handles Windows npm.cmd)."""
    if sys.platform == "win32":
        # npm is a .cmd shim on Windows; CreateProcess cannot run .cmd directly,
        # so route through cmd.exe. This is the standard platform adaptation,
        # not a shell pipeline.
        return ["cmd", "/c", "npm", *extra]
    return ["npm", *extra]


def run(cmd: list[str], cwd: Path | None = None) -> int:
    """Run a command, streaming output to the console. Returns exit code."""
    print(f"  $ {' '.join(str(c) for c in cmd)}")
    return subprocess.call(cmd, cwd=str(cwd) if cwd else None)


def _parse_version(text: str) -> tuple[int, int]:
    """Parse a 'v18.19.0' style version into a (major, minor) tuple."""
    clean = text.strip().lstrip("v")
    parts = clean.split(".")
    try:
        return int(parts[0]), int(parts[1])
    except (ValueError, IndexError):
        return (0, 0)


def check_python() -> bool:
    section("Step 1: Check Python >= 3.11")
    if sys.version_info >= MIN_PYTHON:
        ok(f"Python {sys.version.split()[0]} ({sys.executable})")
        return True
    fail(f"Python {sys.version.split()[0]} is too old; require >= {MIN_PYTHON[0]}.{MIN_PYTHON[1]}")
    print("    Install from https://www.python.org/downloads/")
    return False


def check_node() -> bool:
    section("Step 2: Check Node.js >= 18 (and npm)")
    node = shutil.which("node")
    npm = shutil.which("npm")
    if not node:
        fail("node not found in PATH")
        print("    Install from https://nodejs.org/")
        return False
    if not npm:
        fail("npm not found in PATH")
        print("    npm ships with Node.js: https://nodejs.org/")
        return False
    try:
        out = subprocess.check_output([node, "--version"], text=True).strip()
    except subprocess.CalledProcessError as e:
        fail(f"node --version failed: {e}")
        return False
    ver = _parse_version(out)
    if ver >= MIN_NODE:
        ok(f"Node {out} ({node})")
        ok(f"npm available ({npm})")
        return True
    fail(f"Node {out} is too old; require >= {MIN_NODE[0]}")
    print("    Upgrade at https://nodejs.org/")
    return False


def create_venv() -> bool:
    section("Step 3: Create virtual environment (.venv)")
    if venv_python().exists():
        ok(f".venv already exists at {VENV_DIR}")
        return True
    print(f"  Creating venv at {VENV_DIR} ...")
    rc = run([sys.executable, "-m", "venv", str(VENV_DIR)])
    if rc == 0 and venv_python().exists():
        ok(f"Virtualenv created ({venv_python()})")
        return True
    fail("Failed to create virtualenv")
    print("    Try manually: python -m venv .venv")
    return False


def install_backend() -> bool:
    section("Step 4: Install backend dependencies (pip install -e .[dev])")
    py = str(venv_python())
    run([py, "-m", "pip", "install", "--upgrade", "pip"], cwd=PROJECT_ROOT)
    rc = run([py, "-m", "pip", "install", "-e", ".[dev]"], cwd=PROJECT_ROOT)
    if rc == 0:
        ok("Backend dependencies installed")
        return True
    fail("pip install -e .[dev] failed")
    print("    Check network/proxy, then re-run with the venv pip.")
    return False


def install_frontend() -> bool:
    section("Step 5: Install frontend dependencies (npm install)")
    if not WEB_DIR.is_dir():
        fail(f"web/ directory not found at {WEB_DIR}")
        return False
    rc = run(npm_args(["install"]), cwd=WEB_DIR)
    if rc == 0:
        ok("Frontend dependencies installed")
        return True
    fail("npm install failed")
    print("    Try manually: cd web && npm install")
    return False


def build_frontend() -> bool:
    section("Step 6: Build frontend (npm run build)")
    rc = run(npm_args(["run", "build"]), cwd=WEB_DIR)
    if rc == 0:
        ok("Frontend built")
        return True
    fail("npm run build failed")
    print("    Try manually: cd web && npm run build")
    return False


def seed_env() -> bool:
    section("Step 7: Seed .env from .env.example")
    if ENV_FILE.exists():
        ok(f".env already exists ({ENV_FILE})")
        return True
    if not ENV_EXAMPLE.exists():
        fail(f".env.example not found at {ENV_EXAMPLE}")
        return False
    shutil.copyfile(ENV_EXAMPLE, ENV_FILE)
    ok(f"Copied .env.example -> .env ({ENV_FILE})")
    print("    Edit .env to fill in API keys before running.")
    return True


def print_next_steps() -> None:
    section("Setup Complete")
    print("Next steps:")
    if sys.platform == "win32":
        print("  1. Activate venv:  .venv\\Scripts\\activate")
    else:
        print("  1. Activate venv:  source .venv/bin/activate")
    print("  2. Edit .env and fill in required API keys")
    print("  3. Install external coding agents:  python scripts/install_agents.py")
    print("  4. Start the stack:                 python scripts/start.py")
    print("  5. Verify forgekins:               python scripts/verify_five_forgekins.py")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="FlowForge one-click environment setup (cross-platform).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Steps performed:\n"
            "  1. Check Python >= 3.11 and Node.js >= 18\n"
            "  2. Create .venv virtual environment\n"
            "  3. pip install -e .[dev] (backend)\n"
            "  4. npm install (frontend)\n"
            "  5. npm run build (frontend)\n"
            "  6. Copy .env.example -> .env (if missing)\n"
        ),
    )
    parser.parse_args()

    print("=" * 72)
    print("FlowForge Environment Setup")
    print(f"  Platform: {sys.platform}")
    print(f"  Project:  {PROJECT_ROOT}")
    print("=" * 72)

    steps: list[tuple[str, object]] = [
        ("Python", check_python),
        ("Node.js", check_node),
        ("Virtualenv", create_venv),
        ("Backend deps", install_backend),
        ("Frontend deps", install_frontend),
        ("Frontend build", build_frontend),
        (".env seed", seed_env),
    ]
    results: list[tuple[str, bool]] = []
    for name, fn in steps:
        try:
            passed = bool(fn())
        except Exception as e:  # noqa: BLE001
            print(f"  [ERROR] {name} raised: {e}")
            passed = False
        results.append((name, passed))
        # Abort early on missing prerequisites.
        if not passed and name in ("Python", "Node.js"):
            section("Aborting: prerequisite missing")
            for n, r in results:
                print(f"  {'OK' if r else 'FAIL':<5} {n}")
            print("\nFix the failing prerequisite, then re-run this script.")
            return 1

    section("Summary")
    for n, r in results:
        print(f"  {'OK' if r else 'FAIL':<5} {n}")
    failed = [n for n, r in results if not r]
    if failed:
        print(f"\n{len(failed)} step(s) failed: {', '.join(failed)}")
        print("Resolve the issues above, then re-run this script.")
        return 1
    print_next_steps()
    return 0


if __name__ == "__main__":
    sys.exit(main())
