"""FlowForge loop execution layer — Discover → Assign → Act → Verify → Persist.

Public API:
    LoopExecutor — five-step closed-loop driver
    LoopState — shared state with handoff capsule
    Verifier — quality-score + cross-agent reviewer
    Reflector — error-driven reflection (iterative, max 3-5 rounds)
"""

from __future__ import annotations

from flowforge.loop.executor import LoopExecutor
from flowforge.loop.reflector import Reflector
from flowforge.loop.state import LoopState
from flowforge.loop.verifier import Verifier

__all__ = ["LoopExecutor", "LoopState", "Reflector", "Verifier"]
