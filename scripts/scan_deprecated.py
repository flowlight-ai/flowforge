#!/usr/bin/env python3
"""Scan for deprecated pre-v6.0 code files in the FlowForge harness module.

Identifies files in subdirectory modules (constraints/, context/, entropy/,
feedback/) that duplicate functionality now merged into root-level harness
modules. These subdirectory modules have 0% test coverage and are superseded
by the v6.0 merged implementations.

Usage:
    python flowforge/scripts/scan_deprecated.py
    python flowforge/scripts/scan_deprecated.py --delete  # Actually delete files
"""

from __future__ import annotations

import ast
import os
import sys
from pathlib import Path

# Root-level harness modules (the v6.0 merged implementations)
ROOT_MODULES = {
    "context_engine.py": "ContextEngine",
    "session_manager.py": "SessionManager",
    "entropy_manager.py": "EntropyManager",
    "feedback_loop.py": "FeedbackLoop",
    "orchestrator.py": "HarnessOrchestrator",
}

# Subdirectory modules that duplicate root-level modules
# Maps: subdirectory_path -> (root_module, duplicate_class)
DUPLICATE_SUBDIRS = {
    "harness/context/context_engine.py": ("context_engine.py", "ContextEngine"),
    "harness/context/session_manager.py": ("session_manager.py", "SessionManager"),
    "harness/entropy/entropy_manager.py": ("entropy_manager.py", "EntropyManager"),
    "harness/feedback/feedback_loop.py": ("feedback_loop.py", "FeedbackLoop"),
}

# Subdirectory modules that are new (no root-level duplicate)
# but have 0% coverage — need test coverage, not deletion
NEW_SUBDIRS = [
    "harness/constraints/arch_constraint_engine.py",
    "harness/constraints/linter_rules.py",
    "harness/constraints/linter_runner.py",
]

# __init__.py files in subdirectories
INIT_FILES = [
    "harness/constraints/__init__.py",
    "harness/context/__init__.py",
    "harness/entropy/__init__.py",
    "harness/feedback/__init__.py",
]


def get_project_root() -> Path:
    """Find the project root directory."""
    candidates = [Path(__file__).parent.parent.parent]
    for p in candidates:
        if (p / "flowforge" / "harness" / "__init__.py").exists():
            return p
    return Path.cwd()


def check_import_references(project_root: Path, module_path: str) -> list[str]:
    """Check if a module is imported by any other file in the project.

    Returns a list of files that import from this module.
    """
    referrers = []
    module_name = module_path.replace(os.sep, ".").replace("/", ".").replace(".py", "")

    # Only scan flowforge/ directory to avoid node_modules etc.
    scan_dir = project_root / "flowforge"
    if not scan_dir.exists():
        return referrers

    for py_file in scan_dir.rglob("*.py"):
        rel = py_file.relative_to(project_root)
        rel_str = str(rel)
        if str(rel) == module_path or "test_" in py_file.name:
            continue
        if "node_modules" in rel_str or ".git" in rel_str:
            continue
        if py_file.is_symlink() and not py_file.exists():
            continue

        try:
            source = py_file.read_text(encoding="utf-8")
            tree = ast.parse(source)
        except (SyntaxError, UnicodeDecodeError, FileNotFoundError, OSError):
            continue

        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                if node.module and module_name in node.module:
                    referrers.append(str(rel))
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if module_name in alias.name:
                        referrers.append(str(rel))

    return referrers


def classify_file(
    project_root: Path, rel_path: str
) -> tuple[str, str | None, list[str]]:
    """Classify a file as deprecated/new/init.

    Returns:
        (category, root_duplicate, import_referrers)
    """
    if rel_path in DUPLICATE_SUBDIRS:
        root_mod, _ = DUPLICATE_SUBDIRS[rel_path]
        referrers = check_import_references(project_root, rel_path)
        return ("duplicate", root_mod, referrers)
    elif rel_path in NEW_SUBDIRS:
        referrers = check_import_references(project_root, rel_path)
        return ("new_no_coverage", None, referrers)
    elif rel_path in INIT_FILES:
        return ("init", None, [])
    else:
        return ("unknown", None, [])


def main(delete: bool = False) -> None:
    project_root = get_project_root()
    harness_dir = project_root / "flowforge" / "harness"

    if not harness_dir.exists():
        print(f"ERROR: harness directory not found at {harness_dir}")
        sys.exit(1)

    all_subdir_files = list(DUPLICATE_SUBDIRS.keys()) + NEW_SUBDIRS + INIT_FILES

    print("=" * 72)
    print("FlowForge v6.0 Deprecated Code Scanner")
    print("=" * 72)
    print(f"Project root: {project_root}")
    print(f"Harness dir:  {harness_dir}")
    print()

    # Check which files actually exist
    existing_files = []
    missing_files = []
    for rel_path in all_subdir_files:
        full_path = project_root / "flowforge" / rel_path
        if full_path.exists():
            existing_files.append(rel_path)
        else:
            missing_files.append(rel_path)

    if missing_files:
        print("Already removed:")
        for f in missing_files:
            print(f"  - {f}")
        print()

    # Classify and report
    duplicates = []
    new_no_coverage = []
    inits = []

    for rel_path in existing_files:
        category, root_dup, referrers = classify_file(project_root, rel_path)
        full_path = project_root / "flowforge" / rel_path
        size = full_path.stat().st_size

        if category == "duplicate":
            # If only referenced by same-directory __init__.py, it's safe to delete
            safe_referrers = [
                r for r in referrers
                if not any(
                    r.endswith(f"/{subdir}/__init__.py") or r.endswith(f"\\{subdir}\\__init__.py")
                    for subdir in ["context", "entropy", "feedback", "constraints"]
                )
            ]
            is_safe = len(safe_referrers) == 0
            duplicates.append((rel_path, root_dup, referrers, safe_referrers, size, is_safe))
        elif category == "new_no_coverage":
            new_no_coverage.append((rel_path, referrers, size))
        elif category == "init":
            inits.append((rel_path, size))

    # Report duplicates
    print("-" * 72)
    print("DUPLICATE FILES (superseded by root-level v6.0 implementations)")
    print("-" * 72)
    total_dup_size = 0
    for rel_path, root_dup, referrers, safe_referrers, size, is_safe in duplicates:
        total_dup_size += size
        status = "SAFE TO DELETE" if is_safe else "NEEDS REVIEW"
        print(f"  [{status}] {rel_path} ({size:,} bytes)")
        print(f"    Superseded by: harness/{root_dup}")
        if safe_referrers:
            print(f"    External imports: {', '.join(safe_referrers)}")
        else:
            print("    External imports: (none — only __init__.py refs)")

    print(f"\n  Total duplicate code: {total_dup_size:,} bytes ({total_dup_size // 1024} KB)")

    # Report new modules with no coverage
    print()
    print("-" * 72)
    print("NEW MODULES (0% test coverage — need tests, not deletion)")
    print("-" * 72)
    total_new_size = 0
    for rel_path, referrers, size in new_no_coverage:
        total_new_size += size
        status = "NEEDS TESTS" if not referrers else "NEEDS TESTS + HAS REFS"
        print(f"  [{status}] {rel_path} ({size:,} bytes)")
        if referrers:
            print(f"    Imported by: {', '.join(referrers)}")

    print(f"\n  Total new untested code: {total_new_size:,} bytes ({total_new_size // 1024} KB)")

    # Report init files
    print()
    print("-" * 72)
    print("INIT FILES (subdirectory __init__.py)")
    print("-" * 72)
    for rel_path, size in inits:
        print(f"  {rel_path} ({size:,} bytes)")

    # Summary
    print()
    print("=" * 72)
    print("SUMMARY")
    print("=" * 72)
    safe_to_delete = [d for d in duplicates if d[5]]  # is_safe
    needs_review = [d for d in duplicates if not d[5]]

    print(f"  Duplicate files (safe to delete): {len(safe_to_delete)}")
    print(f"  Duplicate files (needs review):   {len(needs_review)}")
    print(f"  New modules (need tests):         {len(new_no_coverage)}")
    print(f"  Init files:                       {len(inits)}")
    print(f"  Already removed:                  {len(missing_files)}")

    if safe_to_delete:
        print()
        print("Recommended deletion commands:")
        for rel_path, _, _, _, _, _ in safe_to_delete:
            full_path = project_root / "flowforge" / rel_path
            print(f"  del \"{full_path}\"")

    # Delete if requested
    if delete:
        print()
        print("=" * 72)
        print("DELETING SAFE-TO-DELETE FILES...")
        print("=" * 72)
        for rel_path, _, _, _, _, _ in safe_to_delete:
            full_path = project_root / "flowforge" / rel_path
            try:
                os.remove(full_path)
                print(f"  DELETED: {rel_path}")
            except OSError as e:
                print(f"  FAILED:  {rel_path} — {e}")

        # Also delete init files in same subdirectories
        for rel_path, size in inits:
            full_path = project_root / "flowforge" / rel_path
            try:
                os.remove(full_path)
                print(f"  DELETED: {rel_path}")
            except OSError as e:
                print(f"  FAILED:  {rel_path} — {e}")

        # Try to remove empty subdirectories
        for subdir in ["constraints", "context", "entropy", "feedback"]:
            sub_path = harness_dir / subdir
            if sub_path.exists() and not list(sub_path.iterdir()):
                os.rmdir(sub_path)
                print(f"  REMOVED EMPTY DIR: harness/{subdir}/")


if __name__ == "__main__":
    delete_mode = "--delete" in sys.argv
    main(delete=delete_mode)
