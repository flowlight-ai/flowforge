"""HealthChecker — Periodic model health checker with automatic failover.

Generic implementation that works with any ModelService instance.
Persona-specific logic is driven by the assignments config, not hardcoded lists.
"""
import asyncio

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.model_service")


class HealthChecker:
    """Periodic model health checker with automatic failover.

    Runs a background task that periodically checks model availability.
    When a model fails its health check, the checker automatically
    switches assignments to a healthy fallback model.

    Usage:
        from flowforge.tools.llm.model_service import ModelService
        service = ModelService()
        checker = HealthChecker(service, interval_seconds=300)
        await checker.start()
        # ... later ...
        await checker.stop()
    """

    def __init__(self, model_service, interval_seconds: int = 300):
        self._service = model_service
        self._interval = interval_seconds
        self._task: asyncio.Task | None = None
        self._running = False
        self._last_report: dict = {}

    async def start(self) -> None:
        """Start the periodic health check loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info(f"HealthChecker started with interval={self._interval}s")

    async def stop(self) -> None:
        """Stop the periodic health check loop."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("HealthChecker stopped")

    @property
    def last_report(self) -> dict:
        """Return the most recent health check report."""
        return dict(self._last_report)

    async def _run_loop(self) -> None:
        """Background loop that runs health checks at the configured interval."""
        while self._running:
            try:
                await self._check_and_failover()
            except Exception as e:
                logger.error(f"HealthChecker error: {e}", exc_info=True)
            await asyncio.sleep(self._interval)

    async def _check_and_failover(self) -> dict:
        """Check all models and auto-failover unhealthy ones.

        Returns a report dict with check results and failover actions taken.
        """
        results = await self._service.health_check_all(force=True)

        unhealthy_models = [
            r for r in results
            if r.get("status") not in (self._service.STATUS_AVAILABLE,)
        ]

        failovers: list[dict] = []
        for result in unhealthy_models:
            model_key = result.get("model_key", "")
            affected = self._find_affected_assignments(model_key)
            for assignment_key, sub_key in affected:
                fix = await self._auto_failover(assignment_key, sub_key, model_key)
                if fix:
                    failovers.append(fix)

        report = {
            "checked": len(results),
            "unhealthy": len(unhealthy_models),
            "failovers": failovers,
        }
        self._last_report = report

        if unhealthy_models:
            logger.info(
                f"HealthChecker: {len(unhealthy_models)} unhealthy model(s), "
                f"{len(failovers)} failover(s) applied"
            )

        return report

    def _find_affected_assignments(self, model_key: str) -> list[tuple]:
        """Find all (assignment_key, sub_key) pairs that use the given model as primary.

        Works with both flat assignments (key -> {primary, fallbacks})
        and nested assignments (key -> {sub_key -> {primary, fallbacks}}).
        """
        affected = []
        model_id = model_key.split("/", 1)[-1] if "/" in model_key else model_key
        for assignment_key, assignment_val in self._service.assignments.items():
            if not isinstance(assignment_val, dict):
                continue
            # Check if this is a nested assignment (sub-keys like persona/agent)
            # Heuristic: if any value is a dict with "primary" key, it's nested
            first_val = next(iter(assignment_val.values()), None)
            if isinstance(first_val, dict) and "primary" in first_val:
                # Nested: assignment_key -> {sub_key -> {primary, fallbacks}}
                for sub_key, cfg in assignment_val.items():
                    if not isinstance(cfg, dict):
                        continue
                    primary = cfg.get("primary", "")
                    if primary == model_id or primary == model_key:
                        affected.append((assignment_key, sub_key))
            else:
                # Flat: assignment_key -> {primary, fallbacks}
                primary = assignment_val.get("primary", "")
                if primary == model_id or primary == model_key:
                    affected.append((assignment_key, None))

        return affected

    async def _auto_failover(self, assignment_key: str, sub_key: str | None,
                             failed_model_key: str) -> dict | None:
        """Attempt to failover a single assignment to a healthy fallback.

        Returns a dict describing the failover, or None if no replacement found.
        """
        assignment_val = self._service.assignments.get(assignment_key, {})
        if sub_key is not None:
            agent_cfg = assignment_val.get(sub_key, {})
        else:
            agent_cfg = assignment_val

        if not isinstance(agent_cfg, dict):
            return None

        fallbacks = agent_cfg.get("fallbacks", [])
        for fb in fallbacks:
            fb_key = self._service._get_model_key(fb) or fb
            health = await self._service.health_check_single(fb_key, force=True)
            if health.get("status") == self._service.STATUS_AVAILABLE:
                old_primary = agent_cfg.get("primary", "")
                agent_cfg["primary"] = fb
                fallbacks_without_fb = [f for f in fallbacks if f != fb]
                if old_primary not in fallbacks_without_fb:
                    fallbacks_without_fb.insert(0, old_primary)
                agent_cfg["fallbacks"] = fallbacks_without_fb
                self._service._save_config()
                logger.info(
                    f"HealthChecker auto-failover: {assignment_key}"
                    f"{('/' + sub_key) if sub_key else ''} "
                    f"{old_primary} -> {fb}"
                )
                return {
                    "assignment_key": assignment_key,
                    "sub_key": sub_key,
                    "old_primary": old_primary,
                    "new_primary": fb,
                    "reason": f"model {failed_model_key} unhealthy",
                }

        replacement = await self._service._find_healthy_model()
        if replacement:
            old_primary = agent_cfg.get("primary", "")
            agent_cfg["primary"] = replacement
            if old_primary not in agent_cfg.get("fallbacks", []):
                agent_cfg.setdefault("fallbacks", []).insert(0, old_primary)
            self._service._save_config()
            logger.info(
                f"HealthChecker global failover: {assignment_key}"
                f"{('/' + sub_key) if sub_key else ''} "
                f"{old_primary} -> {replacement}"
            )
            return {
                "assignment_key": assignment_key,
                "sub_key": sub_key,
                "old_primary": old_primary,
                "new_primary": replacement,
                "reason": f"model {failed_model_key} unhealthy, no fallback available",
                "source": "global",
            }

        logger.warning(
            f"HealthChecker: no healthy replacement for {assignment_key}"
            f"{('/' + sub_key) if sub_key else ''} "
            f"(failed model: {failed_model_key})"
        )
        return None
