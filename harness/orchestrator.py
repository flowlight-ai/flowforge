"""Harness Orchestrator - Unified entry point for the Harness layer.

Two unified hooks integrate with HybridExecutor:
- pre_execute(ctx): context injection + entropy check
- post_execute(result, ctx): constraint validation + feedback evaluation

When harness is disabled (harness_enabled=False), all hooks are no-ops.
"""

import time
from typing import Optional, Dict, Any
from flowforge.core.tracing import get_logger
from flowforge.harness.context_engine import ContextEngine
from flowforge.harness.session_manager import SessionManager
from flowforge.harness.feedback_loop import FeedbackLoop
from flowforge.harness.entropy_manager import EntropyManager

logger = get_logger("harness.orchestrator")


class HarnessOrchestrator:
    """Unified entry point for the Harness layer.

    Encapsulates initialization and hook calling for all four guardrails
    plus infrastructure components.

    Attributes:
        context_engine: Context engineering guardrail
        session_manager: Session compression and handoff
        feedback_loop: Feedback evaluation guardrail
        entropy_manager: Entropy management guardrail
        enabled: Whether harness is active (gray-scale switch)
    """

    def __init__(
        self,
        context_engine=None,
        session_manager=None,
        feedback_loop=None,
        entropy_manager=None,
        config: Optional[Dict[str, Any]] = None,
    ):
        self.config = config or {}
        self.enabled = self.config.get("enabled", True)

        # Initialize guardrails
        self.context_engine = context_engine or ContextEngine(
            config=self.config.get("context_engine", {})
        )
        self.session_manager = session_manager or SessionManager(
            config=self.config.get("session_manager", {})
        )
        self.feedback_loop = feedback_loop or FeedbackLoop(
            config=self.config.get("feedback_loop", {})
        )
        self.entropy_manager = entropy_manager or EntropyManager(
            config=self.config.get("entropy_manager", {})
        )

        logger.info(f"HarnessOrchestrator initialized, enabled={self.enabled}")

    async def pre_execute(self, ctx) -> None:
        """Pre-execution hook: context injection + entropy check.

        Called by HybridExecutor before mode execution.
        When disabled, this is a no-op.
        """
        if not self.enabled:
            return

        # Check both ctx.harness_enabled attribute and ctx.metadata
        if hasattr(ctx, 'harness_enabled') and not ctx.harness_enabled:
            return
        if hasattr(ctx, 'metadata') and not ctx.metadata.get("harness_enabled", True):
            return

        start = time.time()

        # 1. Context injection (feedforward control)
        await self.context_engine.inject(ctx)

        # 2. Entropy check (lightweight, just check flags)
        await self.entropy_manager.pre_check(ctx)

        duration_ms = (time.time() - start) * 1000
        logger.info(f"[Harness] pre_execute completed in {duration_ms:.1f}ms")

    async def post_execute(self, result: dict, ctx) -> dict:
        """Post-execution hook: constraint validation + feedback evaluation.

        Called by HybridExecutor after mode execution.
        When disabled, returns result unchanged.
        """
        if not self.enabled:
            return result

        # Check both ctx.harness_enabled attribute and ctx.metadata
        if hasattr(ctx, 'harness_enabled') and not ctx.harness_enabled:
            return result
        if hasattr(ctx, 'metadata') and not ctx.metadata.get("harness_enabled", True):
            return result

        start = time.time()

        # 1. Constraint validation (architecture constraints)
        # Note: ArchitectureConstraintEngine is in security/ module
        # It's called separately via PermissionPipeline

        # 2. Feedback evaluation (feedback loop)
        result = await self.feedback_loop.evaluate(result, ctx)

        # 3. Entropy tracking (record execution for entropy analysis)
        await self.entropy_manager.post_track(result, ctx)

        duration_ms = (time.time() - start) * 1000
        logger.info(f"[Harness] post_execute completed in {duration_ms:.1f}ms")

        return result

    def get_status(self) -> dict:
        """Get harness status report."""
        return {
            "enabled": self.enabled,
            "context_engine": self.context_engine.get_status(),
            "session_manager": self.session_manager.get_status(),
            "feedback_loop": self.feedback_loop.get_status(),
            "entropy_manager": self.entropy_manager.get_status(),
        }
