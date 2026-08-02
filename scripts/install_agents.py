#!/usr/bin/env python
"""Install external coding-agent CLIs for the 5 default Forgekins (cross-platform).

Installs the four CLI-based coding agents bound to FlowForge's default
forgekins, verifies each binary is callable, and reminds the user to install
Trae CN manually (it is an IDE, not a CLI).

Forgekin binding:
  wenxin   (文心)    -> Claude Code  (@anthropic-ai/claude-code)
  sherlock (夏洛克)  -> Codex        (@openai/codex)
  vangogh  (梵高)    -> Gemini CLI   (@google/gemini-cli)
  davinci  (达芬奇)  -> OpenCode CLI (@opencode-ai/cli)
  luban    (鲁班)    -> Trae CN      (IDE — manual install, skipped)

Run:  python scripts/install_agents.py
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

# Each CLI-based agent: name, forgekin it binds to, npm package, binary name.
AGENTS: list[dict[str, str]] = [
    {
        "name": "Claude Code",
        "forgekin": "wenxin (文心)",
        "package": "@anthropic-ai/claude-code",
        "binary": "claude",
    },
    {
        "name": "Codex",
        "forgekin": "sherlock (夏洛克)",
        "package": "@openai/codex",
        "binary": "codex",
    },
    {
        "name": "Gemini CLI",
        "forgekin": "vangogh (梵高)",
        "package": "@google/gemini-cli",
        "binary": "gemini",
    },
    {
        "name": "OpenCode CLI",
        "forgekin": "davinci (达芬奇)",
        "package": "@opencode-ai/cli",
        "binary": "opencode",
    },
]

# Trae CN binds to luban (鲁班) but is an IDE, not a CLI — skip with a hint.
TRAE_NOTE = (
    "Trae CN (for luban / 鲁班) is an IDE, not a CLI — skipped.\n"
    "    Download manually from https://www.trae.cn/ and install.\n"
    "    FlowForge bridges to Trae via TraeLLMClient (not a subprocess),\n"
    "    so no PATH binary is required."
)


def section(title: str) -> None:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def ok(msg: str) -> None:
    print(f"  [OK] {msg}")


def fail(msg: str) -> None:
    print(f"  [FAIL] {msg}")


def skip(msg: str) -> None:
    print(f"  [SKIP] {msg}")


def npm_args(extra: list[str]) -> list[str]:
    """Build a cross-platform npm invocation (handles Windows npm.cmd)."""
    if sys.platform == "win32":
        # npm is a .cmd shim on Windows; CreateProcess cannot run .cmd directly.
        return ["cmd", "/c", "npm", *extra]
    return ["npm", *extra]


def check_npm() -> bool:
    """Verify npm is available before attempting global installs."""
    section("Prerequisite: npm")
    npm = shutil.which("npm")
    if npm:
        ok(f"npm found ({npm})")
        return True
    fail("npm not found in PATH")
    print("    npm ships with Node.js — install from https://nodejs.org/")
    return False


def binary_available(binary: str) -> str | None:
    """Return the resolved binary path, or None if not on PATH."""
    return shutil.which(binary)


def verify_binary(binary: str) -> tuple[bool, str]:
    """Verify a binary is callable. Returns (available, detail).

    Availability is primarily determined by PATH resolution. If a version
    check succeeds, the first output line is included as detail.
    """
    path = binary_available(binary)
    if not path:
        return False, "not on PATH"
    # Best-effort version probe (some CLIs use -V/--version; tolerate failure).
    if sys.platform == "win32":
        cmd = ["cmd", "/c", binary, "--version"]
    else:
        cmd = [binary, "--version"]
    try:
        out = subprocess.check_output(
            cmd, text=True, timeout=20, stderr=subprocess.STDOUT
        ).strip()
        first = out.splitlines()[0] if out else path
        return True, first
    except Exception:  # noqa: BLE001
        # On PATH but version probe failed/timed out — still considered available.
        return True, path


def install_agent(agent: dict[str, str]) -> bool:
    """Install one agent CLI globally and verify the binary. Returns success."""
    name = agent["name"]
    pkg = agent["package"]
    binary = agent["binary"]
    forgekin = agent["forgekin"]

    section(f"{name}  (for {forgekin})")

    # Already installed?
    existing = binary_available(binary)
    if existing:
        ok(f"{binary} already installed -> {existing}")
        avail, detail = verify_binary(binary)
        if avail:
            ok(f"verified: {detail}")
            return True
        fail(f"{binary} on PATH but not callable")
        return False

    print(f"  Installing {pkg} globally ...")
    rc = subprocess.call(npm_args(["install", "-g", pkg]))
    if rc != 0:
        fail(f"npm install -g {pkg} failed (exit {rc})")
        print(f"    Try manually: npm install -g {pkg}")
        print("    On permission errors (EACCES) on macOS/Linux, either:")
        print("      - fix npm's global prefix, or")
        print("      - rerun with sudo (not recommended). See:")
        print("        https://docs.npmjs.com/resolving-eacces-permissions-errors")
        return False

    avail, detail = verify_binary(binary)
    if avail:
        ok(f"{binary} installed -> {detail}")
        return True
    fail(f"{binary} installed but not found on PATH")
    print(f"    The npm global bin dir may not be on your PATH.")
    print(f"    Run `npm config get prefix` to find it, then add its bin/ to PATH.")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Install external coding-agent CLIs for the 5 default Forgekins.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Installs via npm (global):\n"
            "  @anthropic-ai/claude-code  (claude)   -> wenxin\n"
            "  @openai/codex              (codex)    -> sherlock\n"
            "  @google/gemini-cli         (gemini)   -> vangogh\n"
            "  @opencode-ai/cli           (opencode) -> davinci\n"
            "Trae CN (luban) is an IDE and is skipped.\n"
        ),
    )
    parser.parse_args()

    print("=" * 72)
    print("FlowForge External Coding-Agent Installer")
    print(f"  Platform: {sys.platform}")
    print("=" * 72)

    if not check_npm():
        return 1

    results: list[tuple[str, bool]] = []
    for agent in AGENTS:
        try:
            passed = install_agent(agent)
        except Exception as e:  # noqa: BLE001
            print(f"  [ERROR] {agent['name']} raised: {e}")
            passed = False
        results.append((agent["name"], passed))

    section("Trae CN (IDE — manual)")
    skip(TRAE_NOTE)

    section("Summary")
    for name, passed in results:
        print(f"  {'OK' if passed else 'FAIL':<5} {name}")
    print(f"  {'SKIP':<5} Trae CN (IDE — install manually)")

    failed = [n for n, p in results if not p]
    if failed:
        print(f"\n{len(failed)} agent(s) failed: {', '.join(failed)}")
        print("See hints above; resolve and re-run this script.")
        return 1
    print("\nAll CLI agents installed and verified.")
    print("Next: python scripts/verify_five_forgekins.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
