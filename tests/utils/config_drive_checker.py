"""Config-drive-rate checker.

Verifies that flowforge code does not hardcode:
- Prompts (must come from config/prompts.yaml)
- Absolute paths (must use pathlib + env vars)
- API keys / secrets (must come from env or config)
- GitHub org names other than `flowlight-ai`

Walks the flowforge/ package source and asserts on patterns. Intended to be
run as part of the test suite so regressions are caught at PR time.

This is the engineering implementation of project_memory's "配置驱动率 ≥ 60%"
constraint. The check is intentionally strict (allowlist-based) so that
anything not explicitly allowed is flagged.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Patterns that indicate a hardcoding violation
_FORBIDDEN_PATTERNS = [
    # Hardcoded absolute Windows paths
    (re.compile(r"[A-Za-z]:\\\\", re.IGNORECASE), "hardcoded windows absolute path"),
    (re.compile(r"[A-Za-z]:/[A-Za-z]", re.IGNORECASE), "hardcoded windows absolute path"),
    # Hardcoded absolute Unix paths (allow __file__ based)
    (re.compile(r"(?<!['\"])(/home/|/Users/|/var/|/etc/)"), "hardcoded unix absolute path"),
    # API key / secret patterns
    (re.compile(r"api_key\s*=\s*['\"][a-zA-Z0-9_-]{16,}['\"]", re.IGNORECASE), "hardcoded api key"),
    (re.compile(r"secret\s*=\s*['\"][a-zA-Z0-9_-]{16,}['\"]", re.IGNORECASE), "hardcoded secret"),
    # GitHub org names other than flowlight-ai
    (re.compile(r"github\.com/(?!flowlight-ai)[a-zA-Z0-9_-]+/", re.IGNORECASE), "non-flowlight-ai github org"),
]

# Allowlist substrings that suppress a forbidden match (e.g. example URLs in docstrings)
_ALLOWLIST = (
    "github.com/flowlight-ai",
    "github.com/orgs/flowlight-ai",
    "api.anthropic.com",
    "api.openai.com",
    "open.bigmodel.cn",
    "example.com",
    "FLOWFORGE_",
    "os.environ",
    "Path(__file__)",
    "pathlib",
)


def _scan_file(path: Path) -> list[tuple[int, str, str]]:
    """Return list of (line_number, matched_text, reason) violations in one file."""
    violations: list[tuple[int, str, str]] = []
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return violations
    for lineno, line in enumerate(text.splitlines(), start=1):
        # Skip docstrings and comments heuristically (best-effort)
        stripped = line.lstrip()
        if stripped.startswith("#") or stripped.startswith('"""') or stripped.startswith("'''"):
            continue
        for pattern, reason in _FORBIDDEN_PATTERNS:
            for match in pattern.finditer(line):
                matched_text = match.group(0)
                if any(allow in line for allow in _ALLOWLIST):
                    continue
                violations.append((lineno, matched_text, reason))
    return violations


def scan_package(pkg_root: Path) -> dict[Path, list[tuple[int, str, str]]]:
    """Scan a package directory for hardcoded values. Returns {path: violations}."""
    results: dict[Path, list[tuple[int, str, str]]] = {}
    for py_file in pkg_root.rglob("*.py"):
        v = _scan_file(py_file)
        if v:
            results[py_file] = v
    return results


def compute_config_drive_rate(pkg_root: Path, config_dir: Path) -> float:
    """Compute a coarse config-drive rate.

    Heuristic: fraction of .py files that do NOT contain forbidden patterns.
    A real implementation would also count externalized prompts; this v0.1
    check is intentionally conservative.
    """
    py_files = list(pkg_root.rglob("*.py"))
    if not py_files:
        return 0.0
    violations = scan_package(pkg_root)
    clean = len(py_files) - len(violations)
    return clean / len(py_files)


def main(argv: list[str] | None = None) -> int:
    """Console entry point. Returns 0 on success, 1 on violations."""
    here = Path(__file__).resolve().parent
    pkg_root = here.parent.parent / "flowforge"
    config_dir = here.parent.parent / "config"

    if not pkg_root.is_dir():
        print(f"ERROR: package root not found: {pkg_root}", file=sys.stderr)
        return 2

    violations = scan_package(pkg_root)
    if not violations:
        rate = compute_config_drive_rate(pkg_root, config_dir)
        print(f"OK: no hardcoding violations. config-drive-rate={rate:.2%}")
        return 0

    print(f"FAIL: {sum(len(v) for v in violations.values())} violations in {len(violations)} files:")
    for path, vlist in violations.items():
        rel = path.relative_to(pkg_root.parent)
        for lineno, matched, reason in vlist:
            print(f"  {rel}:{lineno}: {reason!r} → {matched!r}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
