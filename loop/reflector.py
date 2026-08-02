"""Reflector — error-driven reflection with iterative retry (max 3-5 rounds).

Reflection is invoked when the Verifier fails. The reflector:
1. Reads the failure (low quality score, missing criteria, reviewer pushback)
2. Asks for a corrected artifact (caller supplies the correction function)
3. Returns the corrected artifact for another verify pass

This is NOT a generic brainstorming loop — it only fires on concrete error
signals. Max iterations cap prevents runaway reflection.
"""

from __future__ import annotations

from typing import Any, Callable

from flowforge.core.errors import LoopError
from flowforge.core.tracing import get_logger
from flowforge.loop.state import LoopState

logger = get_logger("flowforge.loop.reflector")

DEFAULT_MAX_REFLECTIONS = 3


class Reflector:
    """Error-driven reflector — produces a corrected artifact for re-verification."""

    def __init__(
        self,
        max_reflections: int = DEFAULT_MAX_REFLECTIONS,
        reflector_fn: Callable[[str, dict[str, Any]], str] | None = None,
    ) -> None:
        self.max_reflections = max_reflections
        # `reflector_fn(artifact, failure_info) -> corrected_artifact`
        # Production wires this to LLMClient with prompt-from-YAML.
        self.reflector_fn = reflector_fn

    def reflect(
        self,
        state: LoopState,
        artifact: str,
        failure_info: dict[str, Any],
    ) -> str:
        """Produce a corrected artifact from the failure info. Raises LoopError on cap exceeded."""
        if state.iteration >= self.max_reflections:
            raise LoopError(
                f"Reflection cap reached: iteration={state.iteration} "
                f"max={self.max_reflections}"
            )
        if self.reflector_fn is None:
            # Default: return artifact unchanged (forces the loop to terminate via max_iter)
            logger.warning("reflector has no reflector_fn — returning artifact unchanged")
            return artifact
        try:
            corrected = self.reflector_fn(artifact, failure_info)
        except Exception as exc:  # noqa: BLE001
            raise LoopError("Reflector function raised", cause=exc) from exc
        logger.info(
            f"reflector produced correction: iter={state.iteration} "
            f"old_len={len(artifact)} new_len={len(corrected)}"
        )
        return corrected
