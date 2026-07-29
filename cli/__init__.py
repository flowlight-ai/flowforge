"""flowforge.cli — command-line entry point.

Sub-commands (v0.1):
    python -m flowforge --version           # print version
    python -m flowforge evolve --dry-run    # evaluate without executing
    python -m flowforge evolve --target FOO # evaluate targeting a specific forgekin
    python -m flowforge forgekin list       # list built-in example forgekins
    python -m flowforge loop run            # run a stub loop for smoke testing
"""

from __future__ import annotations

from flowforge.cli.__main__ import main

__all__ = ["main"]
