"""FlowForge exception hierarchy.

All FlowForge errors derive from FlowForgeError so callers can catch the
entire family with a single except clause, while still discriminating by
subclass when they need finer-grained handling.

Merged HTTP-oriented errors and domain errors into a single hierarchy.
"""

from __future__ import annotations


class FlowForgeError(Exception):
    """Base exception for everything raised by flowforge.

    Supports both HTTP-oriented attributes (status_code, detail) and
    domain-oriented attributes (message, cause).
    """

    status_code: int = 500
    detail: str = "Internal flowforge error"

    def __init__(self, message: str = "", *, cause: Exception | None = None, **kwargs) -> None:
        super().__init__(message)
        self.message = message
        self.cause = cause
        if message:
            self.detail = message

    def __str__(self) -> str:
        if self.cause:
            return f"{self.message} (cause: {self.cause!r})"
        return self.message


# ── Old project HTTP-oriented errors ────────────────────────────────────────


class ConfigurationError(FlowForgeError):
    status_code = 400
    detail = "Configuration error"


class ModeNotFoundError(FlowForgeError):
    status_code = 404
    detail = "Mode not found"


class WorkflowRecursionError(FlowForgeError):
    status_code = 400
    detail = "Workflow recursion depth exceeded"


class ConflictError(FlowForgeError):
    status_code = 409
    detail = "Resource conflict"


class ToolNotFoundError(FlowForgeError):
    status_code = 404
    detail = "Tool not found"


class AgentNotFoundError(FlowForgeError):
    status_code = 404
    detail = "Agent not found"


class SandboxError(FlowForgeError):
    status_code = 400
    detail = "Sandbox execution error"


class AllModelsUnavailableError(FlowForgeError):
    status_code = 503
    detail = "All model candidates failed"


class ToolExecutionError(FlowForgeError):
    status_code = 500
    detail = "Tool execution error"


class HarnessViolationError(FlowForgeError):
    status_code = 422
    detail = "Harness guardrail violation"


class StepTimeoutError(FlowForgeError):
    status_code = 408
    detail = "Workflow step timed out"


# ── New project domain-oriented errors ──────────────────────────────────────


class ConfigError(FlowForgeError):
    """Configuration loading or validation failed."""

    status_code = 400


class PluginError(FlowForgeError):
    """Plugin registration or hook invocation failed."""


class LoopError(FlowForgeError):
    """Loop execution, verification, or reflection failed."""


class LLMError(FlowForgeError):
    """LLM client call failed (after exhausting retries/fallback)."""


class EvolutionError(FlowForgeError):
    """Self-evolution engine raised an unexpected condition."""


class EvalError(FlowForgeError):
    """Eval contract, signal aggregation, or attribution operation failed."""


class ForgekinError(FlowForgeError):
    """Forgekin lifecycle, registration, or council operation failed."""


class MemoryError(FlowForgeError):
    """Memory collection, retrieval, governance, or codex operation failed."""


class TeamActError(FlowForgeError):
    """TeamAct state machine, handoff, or routing protocol failed."""


class PartnershipError(FlowForgeError):
    """Partnership math (upper/lower bound, variance, token ledger) failed."""


class BoundaryViolationError(FlowForgeError):
    """A module crossed an architectural boundary (e.g. flowforge importing *forge)."""


class CapabilityError(FlowForgeError):
    """Capability profile construction, analysis, or persistence failed."""


class HarnessError(FlowForgeError):
    """Harness layer invariant failure (durable state, tool mediation, etc.)."""


class ToolAllowlistViolation(HarnessError):
    """A caller attempted to invoke a tool without allowlist permission."""


class ReliabilityError(FlowForgeError):
    """Distributed reliability subsystem failure (WAL, tier recovery, liveness, provider host)."""
