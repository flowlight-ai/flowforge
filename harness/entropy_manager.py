"""Entropy Management Guardrail - Technical debt and rule evolution.

Implements FR-HRN-04: Built-in core capability (not a plugin).
- DocGardener: Daily document freshness scan
- DebtTracker: Weekly technical debt scan
- RuleEvolution: Convert failures into new rules
- GarbageCollection: Scheduled cleanup

Entropy management is an internal core capability, not available
through the plugin marketplace. The actual scanning and repair
runs as background Cron tasks. pre_execute only does lightweight checks.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from flowforge.core.tracing import get_logger
from flowforge.core.task_context import TaskContext

logger = get_logger("harness.entropy_manager")


# ---------------------------------------------------------------------------
# DocGardener
# ---------------------------------------------------------------------------

@dataclass
class DocEntry:
    """Tracks freshness metadata for a documentation file.

    Attributes:
        path: File path of the documentation.
        last_modified: Timestamp of last modification (epoch seconds).
        last_checked: Timestamp of last freshness check.
        staleness_score: 0.0 (fresh) to 1.0 (completely stale).
        linked_sources: Set of source file paths this doc depends on.
    """
    path: str
    last_modified: float = 0.0
    last_checked: float = 0.0
    staleness_score: float = 0.0
    linked_sources: Set[str] = field(default_factory=set)


class DocGardener:
    """Tracks documentation freshness and flags stale documentation.

    Monitors documentation files and their linked source files. When a
    source file is modified after its documentation, the documentation
    is considered stale. Staleness is scored from 0.0 (fresh) to 1.0
    (completely stale).

    Performance optimizations:
    - Batch stat: uses os.scandir() to fetch mtimes for all files in a
      directory at once, instead of individual Path.stat() calls.
    - mtime cache: caches source file mtimes with a configurable TTL
      (default 60s), avoiding redundant filesystem calls.
    - Skip recently checked docs: docs checked within the cooldown
      period are skipped unless forced.

    Attributes:
        stale_threshold: Staleness score above which a doc is flagged.
        entries: Registry of tracked documentation entries.
        mtime_cache_ttl: Seconds before cached mtimes expire.
    """

    def __init__(self, stale_threshold: float = 0.7, mtime_cache_ttl: float = 60.0) -> None:
        self.stale_threshold = stale_threshold
        self.mtime_cache_ttl = mtime_cache_ttl
        self.entries: Dict[str, DocEntry] = {}
        # Cache: {file_path: (mtime, timestamp_when_cached)}
        self._mtime_cache: Dict[str, tuple] = {}
        # Batch stat cache: {dir_path: {filename: mtime, ...}}
        self._dir_cache: Dict[str, Dict[str, float]] = {}
        self._dir_cache_ts: Dict[str, float] = {}

    def _get_mtime(self, file_path: str) -> Optional[float]:
        """Get file mtime using cache + batch stat fallback.

        1. Check in-memory mtime cache (fastest).
        2. Check directory-level batch cache (os.scandir).
        3. Fall back to individual stat().

        Returns:
            mtime as float, or None if file doesn't exist.
        """
        now = time.time()

        # 1. Check mtime cache
        if file_path in self._mtime_cache:
            cached_mtime, cached_at = self._mtime_cache[file_path]
            if now - cached_at < self.mtime_cache_ttl:
                return cached_mtime

        # 2. Try batch stat via directory cache
        path_obj = Path(file_path)
        if not path_obj.exists():
            self._mtime_cache[file_path] = (None, now)
            return None

        parent = str(path_obj.parent)
        filename = path_obj.name

        # Refresh directory cache if expired
        if parent not in self._dir_cache or now - self._dir_cache_ts.get(parent, 0) >= self.mtime_cache_ttl:
            try:
                dir_entries = {}
                for entry in os.scandir(parent):
                    try:
                        dir_entries[entry.name] = entry.stat(follow_symlinks=False).st_mtime
                    except OSError:
                        pass
                self._dir_cache[parent] = dir_entries
                self._dir_cache_ts[parent] = now
            except OSError:
                self._dir_cache.pop(parent, None)
                self._dir_cache_ts.pop(parent, None)

        # Look up in directory cache
        dir_entries = self._dir_cache.get(parent, {})
        if filename in dir_entries:
            mtime = dir_entries[filename]
            self._mtime_cache[file_path] = (mtime, now)
            return mtime

        # 3. Fallback to individual stat
        try:
            mtime = path_obj.stat().st_mtime
            self._mtime_cache[file_path] = (mtime, now)
            return mtime
        except OSError:
            self._mtime_cache[file_path] = (None, now)
            return None

    def invalidate_cache(self, file_path: Optional[str] = None) -> None:
        """Invalidate mtime cache for a specific file or all files.

        Args:
            file_path: If provided, invalidate only this file's cache.
                If None, invalidate all caches.
        """
        if file_path is None:
            self._mtime_cache.clear()
            self._dir_cache.clear()
            self._dir_cache_ts.clear()
        else:
            self._mtime_cache.pop(file_path, None)
            # Also invalidate the parent directory cache
            path_obj = Path(file_path)
            parent = str(path_obj.parent)
            self._dir_cache.pop(parent, None)
            self._dir_cache_ts.pop(parent, None)

    def register_doc(
        self,
        doc_path: str,
        linked_sources: Optional[Set[str]] = None,
    ) -> None:
        """Register a documentation file for freshness tracking.

        Args:
            doc_path: Path to the documentation file.
            linked_sources: Set of source file paths this doc depends on.
        """
        now = time.time()
        mtime = self._get_mtime(doc_path)
        last_modified = mtime if mtime is not None else now

        self.entries[doc_path] = DocEntry(
            path=doc_path,
            last_modified=last_modified,
            last_checked=now,
            staleness_score=0.0,
            linked_sources=linked_sources or set(),
        )

    async def check_freshness(self, *, force: bool = False) -> List[Dict[str, Any]]:
        """Check freshness of all tracked documentation.

        Updates staleness scores based on source file modification times
        and returns a list of stale documents.

        Uses batch stat (os.scandir) and mtime caching to minimize
        filesystem calls. Docs checked within the cache TTL are skipped
        unless ``force=True``.

        Args:
            force: If True, re-check all docs regardless of cache.

        Returns:
            A list of dictionaries for stale docs with ``path``,
            ``staleness_score``, and ``reason``.
        """
        now = time.time()
        stale: List[Dict[str, Any]] = []

        for doc_path, entry in self.entries.items():
            # Skip recently checked docs (unless forced)
            if not force and (now - entry.last_checked) < self.mtime_cache_ttl:
                # Use cached staleness score
                if entry.staleness_score >= self.stale_threshold:
                    stale.append({
                        "path": doc_path,
                        "staleness_score": round(entry.staleness_score, 3),
                        "reason": "cached_stale",
                    })
                continue

            entry.last_checked = now

            max_source_staleness = 0.0
            stale_sources: List[str] = []

            for source_path in entry.linked_sources:
                source_mtime = self._get_mtime(source_path)

                if source_mtime is None:
                    stale_sources.append(source_path)
                    max_source_staleness = max(max_source_staleness, 0.5)
                    continue

                if source_mtime > entry.last_modified:
                    age_days = (now - entry.last_modified) / 86400
                    source_staleness = min(1.0, age_days / 30.0)
                    max_source_staleness = max(max_source_staleness, source_staleness)
                    stale_sources.append(source_path)

            # Also refresh doc's own mtime
            doc_mtime = self._get_mtime(doc_path)
            if doc_mtime is not None:
                entry.last_modified = doc_mtime

            doc_age_days = (now - entry.last_modified) / 86400
            age_staleness = min(1.0, doc_age_days / 90.0)

            entry.staleness_score = max(max_source_staleness, age_staleness)

            if entry.staleness_score >= self.stale_threshold:
                reason_parts: List[str] = []
                if stale_sources:
                    reason_parts.append(f"sources modified: {', '.join(stale_sources[:3])}")
                if age_staleness >= self.stale_threshold:
                    reason_parts.append(f"doc age: {doc_age_days:.0f} days")
                stale.append({
                    "path": doc_path,
                    "staleness_score": round(entry.staleness_score, 3),
                    "reason": "; ".join(reason_parts) if reason_parts else "high staleness",
                })

        if stale:
            logger.info("Stale documentation detected", stale_count=len(stale))
        return stale


# ---------------------------------------------------------------------------
# DebtTracker
# ---------------------------------------------------------------------------

class DebtSeverity(str, Enum):
    """Technical debt severity levels."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class DebtStatus(str, Enum):
    """Technical debt item status."""
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    WONT_FIX = "wont_fix"


@dataclass
class DebtItem:
    """A single technical debt item.

    Attributes:
        id: Unique identifier for the debt item.
        description: Human-readable description of the debt.
        severity: Severity level.
        status: Current status.
        created_at: Epoch timestamp when the debt was recorded.
        source: Origin of the debt (e.g. "harness_violation", "manual").
        metadata: Additional key-value metadata.
    """
    id: str
    description: str
    severity: DebtSeverity = DebtSeverity.MEDIUM
    status: DebtStatus = DebtStatus.OPEN
    created_at: float = 0.0
    source: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


class DebtTracker:
    """Tracks technical debt items with severity and status.

    Records debt items from harness violations, manual entries, and
    automated detection. Provides querying and aggregation.

    Attributes:
        items: Registry of debt items keyed by ID.
    """

    def __init__(self) -> None:
        self.items: Dict[str, DebtItem] = {}
        self._next_id = 1

    def record(
        self,
        description: str,
        severity: DebtSeverity = DebtSeverity.MEDIUM,
        source: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Record a new technical debt item.

        Args:
            description: Description of the debt.
            severity: Severity level.
            source: Origin of the debt.
            metadata: Additional metadata.

        Returns:
            The ID of the recorded debt item.
        """
        item_id = f"DEBT-{self._next_id:04d}"
        self._next_id += 1

        self.items[item_id] = DebtItem(
            id=item_id,
            description=description,
            severity=severity,
            status=DebtStatus.OPEN,
            created_at=time.time(),
            source=source,
            metadata=metadata or {},
        )

        logger.info(
            "Debt recorded",
            item_id=item_id,
            severity=severity.value,
            source=source,
        )
        return item_id

    def update_status(self, item_id: str, status: DebtStatus) -> bool:
        """Update the status of a debt item.

        Args:
            item_id: The debt item ID.
            status: The new status.

        Returns:
            ``True`` if the item was found and updated, ``False`` otherwise.
        """
        item = self.items.get(item_id)
        if item is None:
            return False
        item.status = status
        return True

    def get_open_items(self) -> List[DebtItem]:
        """Get all open (non-resolved) debt items.

        Returns:
            A list of open DebtItem instances.
        """
        return [
            item for item in self.items.values()
            if item.status in (DebtStatus.OPEN, DebtStatus.ACKNOWLEDGED, DebtStatus.IN_PROGRESS)
        ]

    def get_summary(self) -> Dict[str, Any]:
        """Get a summary of the current debt landscape.

        Returns:
            A dictionary with total counts by severity and status.
        """
        by_severity: Dict[str, int] = {s.value: 0 for s in DebtSeverity}
        by_status: Dict[str, int] = {s.value: 0 for s in DebtStatus}

        for item in self.items.values():
            by_severity[item.severity.value] += 1
            by_status[item.status.value] += 1

        return {
            "total_items": len(self.items),
            "open_items": len(self.get_open_items()),
            "by_severity": by_severity,
            "by_status": by_status,
        }


# ---------------------------------------------------------------------------
# RuleEvolution
# ---------------------------------------------------------------------------

class RuleLifecycle(str, Enum):
    """Rule lifecycle stages."""
    PROPOSED = "proposed"
    ACTIVE = "active"
    DEPRECATED = "deprecated"
    RETIRED = "retired"


@dataclass
class EvolvingRule:
    """A rule with lifecycle tracking and mutation history.

    Attributes:
        id: Unique rule identifier.
        name: Human-readable rule name.
        description: What the rule enforces.
        lifecycle: Current lifecycle stage.
        version: Rule version number.
        created_at: Epoch timestamp of creation.
        mutated_at: Epoch timestamp of last mutation.
        mutation_count: Number of times the rule has been mutated.
        parent_id: ID of the rule this evolved from, if any.
        metadata: Additional rule metadata.
    """
    id: str
    name: str
    description: str
    lifecycle: RuleLifecycle = RuleLifecycle.PROPOSED
    version: int = 1
    created_at: float = 0.0
    mutated_at: float = 0.0
    mutation_count: int = 0
    parent_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class RuleEvolution:
    """Manages rule lifecycle (creation, mutation, deprecation).

    Tracks rules as they evolve over time, supporting versioning and
    lifecycle transitions. Rules can be proposed, activated, deprecated,
    and retired.

    Attributes:
        rules: Registry of evolving rules keyed by ID.
    """

    def __init__(self) -> None:
        self.rules: Dict[str, EvolvingRule] = {}
        self._next_id = 1

    def propose(
        self,
        name: str,
        description: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Propose a new rule.

        Args:
            name: Rule name.
            description: Rule description.
            metadata: Additional metadata.

        Returns:
            The ID of the proposed rule.
        """
        rule_id = f"RULE-{self._next_id:04d}"
        self._next_id += 1
        now = time.time()

        self.rules[rule_id] = EvolvingRule(
            id=rule_id,
            name=name,
            description=description,
            lifecycle=RuleLifecycle.PROPOSED,
            version=1,
            created_at=now,
            mutated_at=now,
            metadata=metadata or {},
        )

        logger.info("Rule proposed", rule_id=rule_id, name=name)
        return rule_id

    def activate(self, rule_id: str) -> bool:
        """Activate a proposed rule.

        Args:
            rule_id: The rule ID to activate.

        Returns:
            ``True`` if the rule was activated, ``False`` otherwise.
        """
        rule = self.rules.get(rule_id)
        if rule is None or rule.lifecycle != RuleLifecycle.PROPOSED:
            return False
        rule.lifecycle = RuleLifecycle.ACTIVE
        logger.info("Rule activated", rule_id=rule_id)
        return True

    def mutate(
        self,
        rule_id: str,
        new_description: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """Mutate an active rule, creating a new version.

        The original rule is deprecated and a new rule with an incremented
        version is created.

        Args:
            rule_id: The rule ID to mutate.
            new_description: Updated rule description.
            metadata: Additional metadata for the new version.

        Returns:
            The ID of the new rule version, or ``None`` if mutation failed.
        """
        rule = self.rules.get(rule_id)
        if rule is None or rule.lifecycle != RuleLifecycle.ACTIVE:
            return None

        rule.lifecycle = RuleLifecycle.DEPRECATED
        rule.mutated_at = time.time()

        new_id = f"RULE-{self._next_id:04d}"
        self._next_id += 1
        now = time.time()

        self.rules[new_id] = EvolvingRule(
            id=new_id,
            name=rule.name,
            description=new_description,
            lifecycle=RuleLifecycle.ACTIVE,
            version=rule.version + 1,
            created_at=now,
            mutated_at=now,
            mutation_count=rule.mutation_count + 1,
            parent_id=rule_id,
            metadata=metadata or {},
        )

        logger.info(
            "Rule mutated",
            old_rule_id=rule_id,
            new_rule_id=new_id,
            new_version=rule.version + 1,
        )
        return new_id

    def deprecate(self, rule_id: str) -> bool:
        """Deprecate an active rule.

        Args:
            rule_id: The rule ID to deprecate.

        Returns:
            ``True`` if the rule was deprecated, ``False`` otherwise.
        """
        rule = self.rules.get(rule_id)
        if rule is None or rule.lifecycle != RuleLifecycle.ACTIVE:
            return False
        rule.lifecycle = RuleLifecycle.DEPRECATED
        rule.mutated_at = time.time()
        logger.info("Rule deprecated", rule_id=rule_id)
        return True

    def retire(self, rule_id: str) -> bool:
        """Retire a deprecated rule.

        Args:
            rule_id: The rule ID to retire.

        Returns:
            ``True`` if the rule was retired, ``False`` otherwise.
        """
        rule = self.rules.get(rule_id)
        if rule is None or rule.lifecycle != RuleLifecycle.DEPRECATED:
            return False
        rule.lifecycle = RuleLifecycle.RETIRED
        rule.mutated_at = time.time()
        logger.info("Rule retired", rule_id=rule_id)
        return True

    def get_active_rules(self) -> List[EvolvingRule]:
        """Get all currently active rules.

        Returns:
            A list of active EvolvingRule instances.
        """
        return [r for r in self.rules.values() if r.lifecycle == RuleLifecycle.ACTIVE]


# ---------------------------------------------------------------------------
# GarbageCollection
# ---------------------------------------------------------------------------

@dataclass
class GCSchedule:
    """A garbage collection schedule entry.

    Attributes:
        resource_type: Type of resource to clean up.
        max_age_days: Maximum age in days before cleanup.
        last_run: Epoch timestamp of last GC run.
        interval_hours: Hours between GC runs.
    """
    resource_type: str
    max_age_days: float = 30.0
    last_run: float = 0.0
    interval_hours: float = 24.0


class GarbageCollection:
    """Schedules and executes cleanup of stale resources.

    Manages garbage collection schedules for different resource types
    (e.g., old checkpoints, expired sessions, stale cache entries).

    Attributes:
        schedules: Registry of GC schedules keyed by resource type.
    """

    def __init__(self) -> None:
        self.schedules: Dict[str, GCSchedule] = {}
        self._register_default_schedules()

    def _register_default_schedules(self) -> None:
        """Register default GC schedules for common resource types."""
        defaults = [
            GCSchedule(resource_type="checkpoints", max_age_days=7.0, interval_hours=24.0),
            GCSchedule(resource_type="sessions", max_age_days=1.0, interval_hours=6.0),
            GCSchedule(resource_type="cache_entries", max_age_days=30.0, interval_hours=12.0),
            GCSchedule(resource_type="task_states", max_age_days=14.0, interval_hours=24.0),
        ]
        for schedule in defaults:
            self.schedules[schedule.resource_type] = schedule

    def register_schedule(self, schedule: GCSchedule) -> None:
        """Register a custom GC schedule.

        Args:
            schedule: The GCSchedule to register.
        """
        self.schedules[schedule.resource_type] = schedule

    async def check_and_collect(self) -> Dict[str, Any]:
        """Check all schedules and execute GC for due resources.

        Returns:
            A dictionary with ``collected`` (list of resource types cleaned)
            and ``details`` (per-type collection info).
        """
        now = time.time()
        collected: List[str] = []
        details: Dict[str, Any] = {}

        for resource_type, schedule in self.schedules.items():
            hours_since_last = (now - schedule.last_run) / 3600
            if hours_since_last < schedule.interval_hours:
                continue

            result = await self._collect_resource(resource_type, schedule)
            schedule.last_run = now
            collected.append(resource_type)
            details[resource_type] = result

        if collected:
            logger.info("Garbage collection executed", collected=collected)

        return {"collected": collected, "details": details}

    async def _collect_resource(
        self,
        resource_type: str,
        schedule: GCSchedule,
    ) -> Dict[str, Any]:
        now = time.time()
        max_age_seconds = schedule.max_age_days * 86400
        cutoff = now - max_age_seconds
        data_dir = Path("data")
        tmp_extensions = {".tmp", ".bak", ".log", ".temp", ".cache"}
        deleted_files: List[str] = []
        total_size: int = 0

        if data_dir.exists():
            for filepath in data_dir.rglob("*"):
                if not filepath.is_file():
                    continue
                try:
                    stat = filepath.stat()
                    if stat.st_mtime < cutoff and filepath.suffix in tmp_extensions:
                        total_size += stat.st_size
                        filepath.unlink()
                        deleted_files.append(str(filepath))
                except OSError:
                    continue

        if deleted_files:
            logger.info(
                "GC collected files",
                resource_type=resource_type,
                count=len(deleted_files),
                size_bytes=total_size,
            )

        return {
            "resource_type": resource_type,
            "max_age_days": schedule.max_age_days,
            "status": "completed",
            "deleted_count": len(deleted_files),
            "freed_bytes": total_size,
            "deleted_files": deleted_files[:50],
        }


# ---------------------------------------------------------------------------
# EntropyManager (facade)
# ---------------------------------------------------------------------------

class EntropyManager:
    """Entropy management guardrail.

    Manages technical debt, document freshness, and rule evolution.
    Background tasks handle the heavy lifting; pre_execute only
    does lightweight flag checks.

    Sub-components:
        doc_gardener: Documentation freshness tracker.
        debt_tracker: Technical debt tracker.
        rule_evolution: Rule lifecycle manager.
        garbage_collection: Garbage collection scheduler.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.doc_gardener_enabled = self.config.get("doc_gardener_enabled", True)
        self.debt_tracker_enabled = self.config.get("debt_tracker_enabled", True)
        self.rule_evolution_enabled = self.config.get("rule_evolution_enabled", True)
        self._pre_check_count = 0
        self._post_track_count = 0
        self._entropy_flags: Dict[str, Any] = {}

        # Instantiate sub-components based on config flags
        self.doc_gardener = DocGardener(
            stale_threshold=self.config.get("doc_stale_threshold", 0.7),
        ) if self.doc_gardener_enabled else None

        self.debt_tracker = DebtTracker() if self.debt_tracker_enabled else None

        self.rule_evolution = RuleEvolution() if self.rule_evolution_enabled else None

        self.garbage_collection = GarbageCollection()

    async def pre_check(self, ctx) -> None:
        """Lightweight entropy check before execution.

        Only checks flags set by background tasks, does not
        perform any scanning or repair.
        """
        self._pre_check_count += 1
        task_id = getattr(ctx, 'task_id', 'unknown')
        flags_active = {k: v for k, v in self._entropy_flags.items() if v}
        logger.info(f"[EntropyManager] ▶ PRE_CHECK  | task={task_id} "
                     f"flags_active={flags_active or '{}'} "
                     f"total={self._pre_check_count}")

        # Check for entropy flags from background tasks
        if self._entropy_flags.get("high_debt_alert"):
            if hasattr(ctx, 'metadata'):
                ctx.metadata["entropy_alert"] = "high_technical_debt"
                logger.warning(f"[EntropyManager] ⚠ DEBT ALERT | task={task_id} "
                                f"flag=high_debt_alert → injected entropy_alert")

        if self._entropy_flags.get("stale_docs_alert"):
            if hasattr(ctx, 'metadata'):
                ctx.metadata["stale_docs"] = True
                logger.info(f"[EntropyManager] ⚠ STALE DOCS | task={task_id} "
                             f"flag=stale_docs_alert → injected stale_docs=True")

    async def post_track(self, result: dict, ctx) -> None:
        """Track execution result for entropy analysis.

        Records failures for rule evolution and debt tracking.
        Also records errors and quality_warnings as DebtItems.
        """
        self._post_track_count += 1
        task_id = getattr(ctx, 'task_id', 'unknown')
        status = result.get("status", "unknown")
        has_error = bool(result.get("error"))
        has_quality_warning = bool(result.get("quality_warning"))
        feedback = result.get("_feedback", {})
        gate = feedback.get("gate", "N/A") if feedback else "N/A"

        logger.info(f"[EntropyManager] ◀ POST_TRACK | task={task_id} "
                     f"status={status} gate={gate} "
                     f"error={has_error} quality_warn={has_quality_warning} "
                     f"total={self._post_track_count}")

        # Record errors as debt items
        error = result.get("error")
        if error:
            await self._record_failure(result, ctx)
            if self.debt_tracker is not None:
                error_preview = error[:200] if len(error) > 200 else error
                self.debt_tracker.record(
                    description=f"Execution error on task {task_id}: {error_preview}",
                    severity=DebtSeverity.HIGH,
                    source="harness_error",
                    metadata={"task_id": task_id, "status": status},
                )

        # Track quality warnings as potential entropy signals and debt items
        if has_quality_warning:
            self._entropy_flags["last_quality_warning"] = task_id
            logger.info(f"[EntropyManager] ⚠ ENTROPY ↑  | task={task_id} "
                         f"quality_warning recorded as entropy signal, "
                         f"flags={dict(self._entropy_flags)}")
            if self.debt_tracker is not None:
                quality_warning = result.get("quality_warning", "")
                warning_preview = str(quality_warning)[:200] if quality_warning else ""
                self.debt_tracker.record(
                    description=f"Quality warning on task {task_id}: {warning_preview}",
                    severity=DebtSeverity.MEDIUM,
                    source="quality_warning",
                    metadata={"task_id": task_id, "gate": gate},
                )

    async def _record_failure(self, result: dict, ctx) -> None:
        """Record a failure for potential rule evolution.

        Logs the failure and proposes it as a candidate rule if rule_evolution is enabled.
        """
        task_id = getattr(ctx, 'task_id', 'unknown')
        error = result.get("error", "unknown")
        error_preview = error[:100] if len(error) > 100 else error
        logger.warning(f"[EntropyManager] ✖ FAILURE    | task={task_id} "
                       f"error={error_preview} "
                       f"total_failures={self._post_track_count}")

        # Propose a rule from the failure pattern
        if self.rule_evolution is not None:
            self.rule_evolution.propose(
                name=f"Prevent failure: {task_id}",
                description=f"Rule proposed from failure — {error_preview}",
                metadata={"task_id": task_id, "error": error_preview},
            )

    async def run_doc_gardener(self) -> List[dict]:
        """Run document freshness scan (background Cron task).

        Scans project documentation for:
        - Outdated references
        - Broken links
        - Stale version numbers
        - Missing documentation

        Returns list of issues found.
        """
        if not self.doc_gardener_enabled or self.doc_gardener is None:
            return []

        logger.info("[DocGardener] Starting document freshness scan")
        stale_docs = await self.doc_gardener.check_freshness()

        if stale_docs:
            self._entropy_flags["stale_docs_alert"] = True
            logger.info(f"[DocGardener] Stale docs detected: {len(stale_docs)} items")
        else:
            self._entropy_flags["stale_docs_alert"] = False

        return stale_docs

    async def run_debt_tracker(self) -> List[dict]:
        """Run technical debt scan (background Cron task).

        Scans for:
        - TODO/FIXME/HACK comments
        - Deprecated API usage
        - Missing error handling
        - Circular dependencies

        Returns list of debt items found.
        """
        if not self.debt_tracker_enabled or self.debt_tracker is None:
            return []

        logger.info("[DebtTracker] Starting technical debt scan")
        open_items = self.debt_tracker.get_open_items()

        # Check for high debt alert threshold
        high_severity_count = sum(
            1 for item in open_items
            if item.severity in (DebtSeverity.HIGH, DebtSeverity.CRITICAL)
        )
        debt_threshold = self.config.get("high_debt_threshold", 5)
        if high_severity_count >= debt_threshold:
            self._entropy_flags["high_debt_alert"] = True
            logger.warning(f"[DebtTracker] ⚠ HIGH DEBT ALERT | "
                           f"high_severity={high_severity_count} threshold={debt_threshold}")
        else:
            self._entropy_flags["high_debt_alert"] = False

        return [
            {
                "id": item.id,
                "description": item.description,
                "severity": item.severity.value,
                "status": item.status.value,
                "source": item.source,
            }
            for item in open_items
        ]

    async def run_rule_evolution(self, failures: List[dict]) -> List[dict]:
        """Analyze failures and suggest new rules.

        Delegates to RuleEvolution to propose rules from failure patterns.

        Args:
            failures: List of failure records

        Returns:
            List of suggested new rules
        """
        if not self.rule_evolution_enabled or self.rule_evolution is None:
            return []

        if not failures:
            return []

        logger.info(f"[RuleEvolution] Analyzing {len(failures)} failures")
        proposed: List[dict] = []

        for failure in failures:
            task_id = failure.get("task_id", "unknown")
            error = failure.get("error", "unknown")
            error_preview = error[:100] if len(error) > 100 else error

            rule_id = self.rule_evolution.propose(
                name=f"Prevent failure: {task_id}",
                description=f"Rule proposed from failure — {error_preview}",
                metadata=failure,
            )
            proposed.append({
                "rule_id": rule_id,
                "name": f"Prevent failure: {task_id}",
                "description": f"Rule proposed from failure — {error_preview}",
                "lifecycle": "proposed",
            })

        return proposed

    async def check(self, ctx: TaskContext) -> Dict[str, Any]:
        """Run all entropy checks and return a combined report.

        Checks documentation freshness, runs garbage collection, and
        returns a combined entropy report. Debt tracking and rule
        evolution are queried but not automatically triggered.

        Args:
            ctx: The current TaskContext.

        Returns:
            A dictionary with ``doc_freshness``, ``debt_summary``,
            ``active_rules_count``, and ``gc_result``.
        """
        stale_docs = (
            await self.doc_gardener.check_freshness()
            if self.doc_gardener is not None
            else []
        )
        debt_summary = self.debt_tracker.get_summary() if self.debt_tracker is not None else {}
        active_rules = self.rule_evolution.get_active_rules() if self.rule_evolution is not None else []
        gc_result = await self.garbage_collection.check_and_collect()

        # Record any harness violations as debt
        if self.debt_tracker is not None:
            violations = ctx.state.get("harness_violations", [])
            for violation in violations:
                if isinstance(violation, dict):
                    self.debt_tracker.record(
                        description=violation.get("violation", "Unknown harness violation"),
                        severity=DebtSeverity.HIGH,
                        source="harness_violation",
                        metadata=violation,
                    )

            # Record linter violations as debt
            linter_violations = ctx.state.get("linter_violations", [])
            for lv in linter_violations:
                if isinstance(lv, dict):
                    severity = DebtSeverity.HIGH if lv.get("severity") == "error" else DebtSeverity.MEDIUM
                    self.debt_tracker.record(
                        description=f"Linter violation: {lv.get('rule_name', 'unknown')} — {lv.get('description', '')}",
                        severity=severity,
                        source="linter",
                        metadata=lv,
                    )

        result: Dict[str, Any] = {
            "doc_freshness": {
                "stale_count": len(stale_docs),
                "stale_docs": stale_docs[:10],
            },
            "debt_summary": debt_summary,
            "active_rules_count": len(active_rules),
            "gc_result": gc_result,
        }

        logger.info(
            "Entropy check completed",
            task_id=ctx.task_id,
            stale_docs=len(stale_docs),
            open_debt=debt_summary.get("open_items", 0),
            active_rules=len(active_rules),
        )

        return result

    def set_entropy_flag(self, flag_name: str, value: Any):
        """Set an entropy flag (called by background tasks)."""
        old_value = self._entropy_flags.get(flag_name)
        self._entropy_flags[flag_name] = value
        logger.info(f"[EntropyManager] 🔧 FLAG SET    | {flag_name} "
                     f"{old_value} → {value}")

    def get_status(self) -> dict:
        """Get entropy manager status."""
        return {
            "enabled": True,
            "doc_gardener_enabled": self.doc_gardener_enabled,
            "debt_tracker_enabled": self.debt_tracker_enabled,
            "rule_evolution_enabled": self.rule_evolution_enabled,
            "pre_check_count": self._pre_check_count,
            "post_track_count": self._post_track_count,
            "entropy_flags": dict(self._entropy_flags),
        }
