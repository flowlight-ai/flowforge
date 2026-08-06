"""Context Engineering Guardrail - Dynamic knowledge injection.

Implements FR-HRN-01: Provides "new employee handbook" for agents.
- AGENTS.md dynamic knowledge injection (configured paths + workspace root)
- Historical failure case retrieval (via EntropyManager DebtTracker)
- Session handoff artifact construction
- Dynamic context assembly (persona, mode, metadata)
- On-demand context injection into both ctx.metadata and ctx.state
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("harness.context_engine")

_AGENTS_MD_FILENAME = "AGENTS.md"


class ContextEngine:
    """Context engineering guardrail.

    Injects relevant context into TaskContext before agent execution,
    ensuring agents have the knowledge they need to succeed.

    Supports two injection targets for backward compatibility:
    - ``ctx.metadata``: Legacy injection (agents_md, past_failures, handoff)
    - ``ctx.state["harness_context"]``: v6 structured context block
    """

    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or {}
        # Legacy: configured paths for AGENTS.md lookup
        self.agents_md_paths = self.config.get("agents_md_paths", [])
        self.failure_db_path = self.config.get("failure_db_path", "data/failures.db")
        # v6: workspace root for upward AGENTS.md search
        workspace_root_val = self.config.get("workspace_root")
        self.workspace_root = Path(workspace_root_val) if workspace_root_val else Path.cwd()
        # Caches: legacy per-persona cache + v6 single cache
        self._agents_md_cache: dict[str, str] = {}
        self._agents_md_v6_cache: str | None = None
        self._injection_count = 0

    async def inject(self, ctx) -> None:
        """Inject relevant context into TaskContext.

        1. Load AGENTS.md for the current persona (legacy path-based + v6 upward search)
        2. Retrieve relevant failure cases
        3. Build session handoff if resuming
        4. Collect handoff artifacts from previous agent steps
        5. Build dynamic context (persona, mode, metadata)
        6. Inject into both ctx.metadata (backward compat) and ctx.state["harness_context"]
        """
        persona = getattr(ctx, 'persona', None) or ''

        # 1. AGENTS.md injection — legacy path-based search
        agents_md = self._load_agents_md(persona)
        # Also try v6 upward search if legacy didn't find it
        if not agents_md:
            agents_md = await self._load_agents_md_v6(ctx)

        # 2. Failure case retrieval
        failures = await self._retrieve_failures(persona)

        # 3. Session handoff (if resuming from checkpoint) — legacy
        handoff = await self._build_handoff(ctx)

        # 4. Collect handoff artifacts from previous agent steps — v6
        handoff_artifacts = self._collect_handoff_artifacts(ctx)

        # 5. Build dynamic context — v6
        dynamic = self._build_dynamic_context(ctx)

        # --- Inject into ctx.metadata (backward compat) ---
        if hasattr(ctx, 'metadata'):
            if agents_md:
                ctx.metadata["agents_md"] = agents_md
            if failures:
                ctx.metadata["past_failures"] = failures
            if handoff:
                ctx.metadata["handoff"] = handoff

        # --- Inject into ctx.state["harness_context"] (v6) ---
        assembled: dict[str, Any] = {
            "agents_md": agents_md,
            "past_failures": failures,
            "handoff_artifacts": handoff_artifacts,
            "dynamic_context": dynamic,
        }
        if hasattr(ctx, 'state'):
            ctx.state["harness_context"] = assembled

        self._injection_count += 1
        logger.debug(
            f"Context injected for persona={persona}, "
            f"agents_md={bool(agents_md)}, failures={len(failures)}, "
            f"handoff_artifacts={len(handoff_artifacts)}"
        )

    # ------------------------------------------------------------------
    # AGENTS.md loading
    # ------------------------------------------------------------------

    def _load_agents_md(self, persona: str) -> str:
        """Load AGENTS.md for the given persona using configured paths.

        Searches for AGENTS.md in each configured base path, first under
        a persona-specific subdirectory, then at the base level.
        Results are cached per persona.
        """
        if persona in self._agents_md_cache:
            return self._agents_md_cache[persona]

        for base_path in self.agents_md_paths:
            candidates = [
                os.path.join(base_path, persona, "AGENTS.md"),
                os.path.join(base_path, "AGENTS.md"),
            ]
            for path in candidates:
                if os.path.exists(path):
                    try:
                        with open(path, encoding="utf-8") as f:
                            content = f.read()
                        self._agents_md_cache[persona] = content
                        return content
                    except Exception as e:
                        logger.warning(f"Failed to load AGENTS.md from {path}: {e}")

        return ""

    async def _load_agents_md_v6(self, ctx) -> str:
        """Locate and read AGENTS.md using v6 upward search.

        Searches from the workspace root upward to the filesystem root.
        Also checks persona-specific subdirectory first.
        Results are cached for the lifetime of the engine instance.
        """
        if self._agents_md_v6_cache is not None:
            return self._agents_md_v6_cache

        persona = getattr(ctx, 'persona', None) or ''
        search_paths = [self.workspace_root]
        if persona:
            search_paths.insert(0, self.workspace_root / "personas" / persona)

        for search_dir in search_paths:
            candidate = search_dir / _AGENTS_MD_FILENAME
            if candidate.is_file():
                try:
                    content = candidate.read_text(encoding="utf-8")
                    self._agents_md_v6_cache = content
                    logger.info(
                        "AGENTS.md loaded (v6 upward search)",
                        path=str(candidate),
                        size=len(content),
                    )
                    return content
                except OSError as exc:
                    logger.warning(
                        "Failed to read AGENTS.md",
                        path=str(candidate),
                        error=str(exc),
                    )

        self._agents_md_v6_cache = ""
        return ""

    # ------------------------------------------------------------------
    # Failure retrieval
    # ------------------------------------------------------------------

    async def _retrieve_failures(self, persona: str) -> list[dict]:
        entropy_manager = self.config.get("entropy_manager")
        if entropy_manager is not None and hasattr(entropy_manager, "debt_tracker"):
            debt_tracker = entropy_manager.debt_tracker
            if debt_tracker is not None and hasattr(debt_tracker, "get_open_items"):
                open_items = debt_tracker.get_open_items()
                failures: list[dict] = []
                for item in open_items:
                    failures.append({
                        "failure_type": item.severity.value if hasattr(item, "severity") else "unknown",
                        "description": item.description if hasattr(item, "description") else "",
                        "timestamp": item.created_at if hasattr(item, "created_at") else 0.0,
                        "source": item.source if hasattr(item, "source") else "",
                        "id": item.id if hasattr(item, "id") else "",
                    })
                if failures:
                    logger.debug(
                        f"Retrieved {len(failures)} failure records from DebtTracker for persona={persona}"
                    )
                return failures

        if entropy_manager is not None and hasattr(entropy_manager, "get_status"):
            status = entropy_manager.get_status()
            failure_count = status.get("post_track_count", 0)
            if failure_count > 0:
                logger.debug(
                    f"EntropyManager reports {failure_count} tracked failures for persona={persona}"
                )
                return [{
                    "failure_type": "unknown",
                    "description": f"EntropyManager reports {failure_count} tracked failures but no DebtTracker available",
                    "timestamp": 0.0,
                    "source": "entropy_manager",
                    "id": "",
                }]

        return []

    # ------------------------------------------------------------------
    # Handoff — legacy
    # ------------------------------------------------------------------

    async def _build_handoff(self, ctx) -> dict | None:
        """Build session handoff artifact for context resumption (legacy)."""
        if not hasattr(ctx, 'metadata'):
            return None

        state = getattr(ctx, 'state', None)
        if not state:
            return None

        handoff = {
            "init_script": state.get("_init_script", ""),
            "progress_log": state.get("_progress_log", []),
            "feature_checklist": state.get("_feature_checklist", []),
        }

        if any(handoff.values()):
            return handoff
        return None

    # ------------------------------------------------------------------
    # Handoff artifacts — v6
    # ------------------------------------------------------------------

    def _collect_handoff_artifacts(self, ctx) -> list[dict[str, Any]]:
        """Collect structured handoff artifacts from previous agent steps.

        Handoff artifacts are stored in ``ctx.state["handoff_artifacts"]`` as
        a list of dictionaries. Each artifact contains:
        - ``source_agent``: Name of the producing agent.
        - ``artifact_type``: Type classification (e.g. "research", "draft").
        - ``content``: The artifact payload.
        - ``timestamp``: ISO-8601 creation timestamp.
        """
        state = getattr(ctx, 'state', None)
        if not state:
            return []

        raw: list[Any] = state.get("handoff_artifacts", [])
        if not isinstance(raw, list):
            return []

        artifacts: list[dict[str, Any]] = []
        for item in raw:
            if isinstance(item, dict) and "source_agent" in item:
                artifacts.append(item)

        return artifacts

    # ------------------------------------------------------------------
    # Dynamic context — v6
    # ------------------------------------------------------------------

    def _build_dynamic_context(self, ctx) -> dict[str, Any]:
        """Build runtime-relevant dynamic context.

        Extracts persona, mode, task metadata, and other runtime information
        from the TaskContext to form a dynamic context block.
        """
        dynamic: dict[str, Any] = {
            "task_id": getattr(ctx, 'task_id', 'unknown'),
            "persona": getattr(ctx, 'persona', None) or "default",
            "mode": getattr(ctx, 'mode', None) or "unknown",
            "interaction_mode": getattr(ctx, 'interaction_mode', 'helm'),
            "created_at": getattr(ctx, 'created_at', ''),
        }

        metadata = getattr(ctx, 'metadata', None)
        if metadata:
            for key in ("project", "domain", "language", "priority"):
                if key in metadata:
                    dynamic[key] = metadata[key]

        return dynamic

    # ------------------------------------------------------------------
    # Formatting — v6
    # ------------------------------------------------------------------

    def format_context_block(self, assembled: dict[str, Any]) -> str:
        """Format the assembled context into a human-readable block for LLM injection.

        Args:
            assembled: The assembled context dictionary from ``inject()``.

        Returns:
            A formatted string ready to be prepended to the LLM prompt.
        """
        parts: list[str] = []

        agents_md = assembled.get("agents_md", "")
        if agents_md:
            parts.append(f"## Project Instructions (AGENTS.md)\n{agents_md}")

        handoff = assembled.get("handoff_artifacts", [])
        if handoff:
            parts.append("## Handoff Artifacts from Previous Steps")
            for artifact in handoff:
                source = artifact.get("source_agent", "unknown")
                atype = artifact.get("artifact_type", "generic")
                content = artifact.get("content", "")
                parts.append(f"### [{atype}] from {source}\n{content}")

        dynamic = assembled.get("dynamic_context", {})
        if dynamic:
            lines = [f"- {k}: {v}" for k, v in dynamic.items()]
            parts.append("## Runtime Context\n" + "\n".join(lines))

        return "\n\n".join(parts)

    # ------------------------------------------------------------------
    # Cache management
    # ------------------------------------------------------------------

    def clear_cache(self) -> None:
        """Clear all AGENTS.md caches, forcing a re-read on next inject."""
        self._agents_md_cache.clear()
        self._agents_md_v6_cache = None

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def get_status(self) -> dict:
        """Get context engine status."""
        return {
            "enabled": True,
            "agents_md_cached": len(self._agents_md_cache),
            "agents_md_v6_cached": self._agents_md_v6_cache is not None,
            "injection_count": self._injection_count,
            "configured_paths": len(self.agents_md_paths),
            "workspace_root": str(self.workspace_root),
        }
