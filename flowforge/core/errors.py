"""FlowForge exception hierarchy.

All FlowForge errors derive from FlowForgeError so callers can catch the
entire family with a single except clause, while still discriminating by
subclass when they need finer-grained handling.
"""

from __future__ import annotations


class FlowForgeError(Exception):
    """Base exception for everything raised by flowforge."""

    def __init__(self, message: str = "", *, cause: Exception | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.cause = cause

    def __str__(self) -> str:
        if self.cause:
            return f"{self.message} (cause: {self.cause!r})"
        return self.message


class ConfigError(FlowForgeError):
    """Configuration loading or validation failed."""


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
