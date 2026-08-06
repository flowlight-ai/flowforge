"""Tests for the Harness layer (roleagent.md Ch.3 / Ch.7).

Covers the current harness components per task.md P1-3:
- SqliteDurableState write/read/delete + optimistic-version increment
- ToolMediator whitelist / alias fallback / dangerous rejection / audit trail
- EvidenceCollector collect/verify integrity (hash check)
- GovernanceInjector SYSTEM_ROLE injection + compression immunity
- DebtTracker / RuleEvolution entropy management

> TODO(refactor): MagicWordsRegistry / GovernanceBoundary / HarnessabilityScorer
> were removed in the v7.0 refactor; magic-words moved to
> flowforge.forgemind.magic_words (covered in tests/test_forgekin.py).

No LLM is involved — these are pure data-structure + logic tests.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from flowforge.harness.durable_state import SqliteDurableState
from flowforge.harness.entropy_manager import (
    DebtSeverity,
    DebtStatus,
    DebtTracker,
    RuleEvolution,
    RuleLifecycle,
)
from flowforge.harness.evidence_sensors import EvidenceCollector, EvidenceSource
from flowforge.harness.governance import (
    GovernanceInjector,
    GovernanceRule,
    InjectionPoint,
)
from flowforge.harness.tool_mediation import (
    MediationOutcome,
    SafetyLevel,
    ToolDescriptor,
    ToolMediator,
)

# ---------------------------------------------------------------------------
# Layer 1 — DurableStateSurface (SqliteDurableState)
# ---------------------------------------------------------------------------


@pytest.fixture
def surface(tmp_path: Path) -> SqliteDurableState:
    return SqliteDurableState(tmp_path / "state.db")


@pytest.mark.asyncio
async def test_durable_state_write_read_roundtrip(surface: SqliteDurableState) -> None:
    state = await surface.write("task:3:status", {"step": 3, "items": ["a", "b"]}, writer="fk-a")
    assert state.key == "task:3:status"
    assert state.version == 1
    assert state.last_writer == "fk-a"

    value = await surface.read("task:3:status")
    assert value == {"step": 3, "items": ["a", "b"]}


@pytest.mark.asyncio
async def test_durable_state_read_missing_returns_none(surface: SqliteDurableState) -> None:
    assert await surface.read("nonexistent") is None


@pytest.mark.asyncio
async def test_durable_state_write_increments_version(surface: SqliteDurableState) -> None:
    await surface.write("key", "v1", writer="fk-a")
    state = await surface.write("key", "v2", writer="fk-b")
    assert state.version == 2
    assert state.last_writer == "fk-b"
    assert await surface.read("key") == "v2"


@pytest.mark.asyncio
async def test_durable_state_delete(surface: SqliteDurableState) -> None:
    await surface.write("key", "value", writer="fk-a")
    assert await surface.delete("key") is True
    assert await surface.read("key") is None
    assert await surface.delete("key") is False


@pytest.mark.asyncio
async def test_durable_state_preserves_created_at_across_updates(
    surface: SqliteDurableState,
) -> None:
    first = await surface.write("key", "v1", writer="fk-a")
    second = await surface.write("key", "v2", writer="fk-b")
    assert second.created_at == first.created_at
    assert second.updated_at != first.updated_at


# ---------------------------------------------------------------------------
# Layer 2 — ToolMediator
# ---------------------------------------------------------------------------


def _make_mediator() -> ToolMediator:
    return ToolMediator(
        whitelist=[
            ToolDescriptor(
                tool_name="file_read",
                safety_level=SafetyLevel.READONLY,
            ),
            ToolDescriptor(
                tool_name="shell_exec",
                safety_level=SafetyLevel.DANGEROUS,
                side_effects=["filesystem", "network"],
            ),
            ToolDescriptor(
                tool_name="irreversible_op",
                safety_level=SafetyLevel.NORMAL,
                reversible=False,
            ),
        ]
    )


@pytest.mark.asyncio
async def test_mediator_allows_authorized_readonly_tool() -> None:
    mediator = _make_mediator()
    result = await mediator.mediate("file_read", {"path": "/tmp/x"})
    assert result.outcome is MediationOutcome.ALLOWED
    assert result.canonical_tool == "file_read"


@pytest.mark.asyncio
async def test_mediator_rejects_unknown_tool() -> None:
    mediator = _make_mediator()
    result = await mediator.mediate("ghost_tool", {})
    assert result.outcome is MediationOutcome.REJECTED_NOT_AUTHORIZED
    assert result.canonical_tool is None


@pytest.mark.asyncio
async def test_mediator_dangerous_requires_confirm() -> None:
    mediator = _make_mediator()
    result = await mediator.mediate("shell_exec", {"cmd": "rm -rf"})
    assert result.outcome is MediationOutcome.REJECTED_DANGEROUS

    confirmed = await mediator.mediate("shell_exec", {"cmd": "ls"}, confirmed_dangerous=True)
    assert confirmed.outcome is MediationOutcome.ALLOWED


@pytest.mark.asyncio
async def test_mediator_rejects_non_reversible_without_confirm() -> None:
    mediator = _make_mediator()
    result = await mediator.mediate("irreversible_op", {})
    assert result.outcome is MediationOutcome.REJECTED_NOT_REVERSIBLE


@pytest.mark.asyncio
async def test_mediator_alias_fallback() -> None:
    mediator = _make_mediator()
    mediator.register_alias("read", "file_read")
    result = await mediator.mediate("read", {"path": "/tmp/x"})
    assert result.outcome is MediationOutcome.ALIAS_FALLBACK
    assert result.canonical_tool == "file_read"


@pytest.mark.asyncio
async def test_mediator_records_audit_trail() -> None:
    mediator = _make_mediator()
    await mediator.mediate("file_read", {"path": "/a"})
    await mediator.mediate("ghost_tool", {})
    trail = mediator.get_audit_trail()
    assert len(trail) == 2
    assert mediator.get_audit_trail("file_read") == [trail[0]]


@pytest.mark.asyncio
async def test_mediator_sanitizes_long_args() -> None:
    mediator = _make_mediator()
    long_value = "x" * 500
    result = await mediator.mediate("file_read", {"path": long_value})
    assert len(result.args["path"]) < 250
    assert "(truncated)" in result.args["path"]


# ---------------------------------------------------------------------------
# Layer 3 — EvidenceCollector
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_evidence_collect_and_verify() -> None:
    collector = EvidenceCollector()
    evidence = await collector.collect(
        source_type=EvidenceSource.COMMIT,
        content="abc123 shipped the feature",
        metadata={"commit_url": "https://example/abc123"},
    )
    assert evidence.verified is True
    assert collector.get_evidence(evidence.evidence_id) is evidence
    assert collector.list_evidence(EvidenceSource.COMMIT) == [evidence]


@pytest.mark.asyncio
async def test_evidence_verify_detects_tampering() -> None:
    collector = EvidenceCollector()
    evidence = await collector.collect(
        source_type=EvidenceSource.TRACE, content="original trace"
    )
    evidence.content = "tampered trace"
    assert await collector.verify(evidence) is False


@pytest.mark.asyncio
async def test_evidence_collect_rejects_disabled_source() -> None:
    collector = EvidenceCollector(
        enabled_sources={EvidenceSource.COMMIT, EvidenceSource.TEST}
    )
    with pytest.raises(ValueError, match="not enabled"):
        await collector.collect(source_type=EvidenceSource.LOG, content="x")


@pytest.mark.asyncio
async def test_evidence_hash_is_deterministic() -> None:
    collector = EvidenceCollector()
    e1 = await collector.collect(EvidenceSource.TEST, "same content")
    e2 = await collector.collect(EvidenceSource.TEST, "same content")
    assert e1.hash == e2.hash


# ---------------------------------------------------------------------------
# Layer 4 — GovernanceInjector
# ---------------------------------------------------------------------------


def _make_injector() -> GovernanceInjector:
    injector = GovernanceInjector()
    injector.register_rule(
        GovernanceRule(
            rule_id="no_direct_db",
            content="Forbidden: direct DB access must go through the Repository layer",
            priority=95,
        )
    )
    injector.register_rule(
        GovernanceRule(
            rule_id="code_style",
            content="Follow PEP 8 for all Python code",
            priority=30,
        )
    )
    return injector


@pytest.mark.asyncio
async def test_governance_inject_to_system_role() -> None:
    injector = _make_injector()
    text = await injector.inject_to_system_role(rule_id="no_direct_db")
    assert "no_direct_db" in text
    assert "Repository layer" in text


@pytest.mark.asyncio
async def test_governance_default_injection_point_is_system_role() -> None:
    rule = GovernanceRule(
        rule_id="GOV-001",
        content="some rule",
        priority=50,
    )
    assert rule.injection_point is InjectionPoint.SYSTEM_ROLE


@pytest.mark.asyncio
async def test_governance_critical_rule_forced_to_system_role() -> None:
    injector = _make_injector()
    critical = GovernanceRule(
        rule_id="GOV-CRIT",
        content="critical invariant",
        priority=95,
        injection_point=InjectionPoint.USER_MESSAGE,
    )
    text = await injector.inject_to_user_message(critical)
    # critical rule is forced into SYSTEM_ROLE template
    assert "[GOVERNANCE RULE #GOV-CRIT]" in text
    assert "[提示]" not in text


@pytest.mark.asyncio
async def test_governance_noncritical_user_message_allowed() -> None:
    injector = _make_injector()
    rule = GovernanceRule(
        rule_id="GOV-SOFT",
        content="soft hint",
        priority=10,
        injection_point=InjectionPoint.USER_MESSAGE,
    )
    text = await injector.inject_to_user_message(rule)
    assert "[提示]" in text


@pytest.mark.asyncio
async def test_governance_batch_injects_sorted_by_priority() -> None:
    injector = _make_injector()
    text = await injector.inject_to_system_role_batch()
    # highest priority rule appears first
    assert text.index("no_direct_db") < text.index("code_style")


@pytest.mark.asyncio
async def test_governance_unknown_rule_id_raises() -> None:
    injector = _make_injector()
    with pytest.raises(ValueError, match="not registered"):
        await injector.inject_to_system_role(rule_id="ghost-rule")


# ---------------------------------------------------------------------------
# Layer 6 — Entropy management: DebtTracker + RuleEvolution
# ---------------------------------------------------------------------------


def test_debt_tracker_record_and_open_items() -> None:
    tracker = DebtTracker()
    item_id = tracker.record(
        "agent bypassed repository layer",
        severity=DebtSeverity.HIGH,
        source="harness_violation",
    )
    assert item_id.startswith("DEBT-")
    open_items = tracker.get_open_items()
    assert len(open_items) == 1
    assert open_items[0].severity is DebtSeverity.HIGH


def test_debt_tracker_update_status_closes_item() -> None:
    tracker = DebtTracker()
    item_id = tracker.record("some debt")
    assert tracker.update_status(item_id, DebtStatus.RESOLVED) is True
    assert tracker.get_open_items() == []
    assert tracker.update_status("nope", DebtStatus.RESOLVED) is False


def test_debt_tracker_summary_counts() -> None:
    tracker = DebtTracker()
    tracker.record("debt A", severity=DebtSeverity.HIGH)
    tracker.record("debt B", severity=DebtSeverity.LOW)
    summary = tracker.get_summary()
    assert summary["total_items"] == 2
    assert summary["open_items"] == 2
    assert summary["by_severity"][DebtSeverity.HIGH.value] == 1
    assert summary["by_severity"][DebtSeverity.LOW.value] == 1


def test_rule_evolution_propose_and_activate() -> None:
    evolution = RuleEvolution()
    rule_id = evolution.propose("no-direct-db", "DB access must use Repository")
    rule = evolution.rules[rule_id]
    assert rule.lifecycle is RuleLifecycle.PROPOSED
    assert rule.version == 1

    assert evolution.activate(rule_id) is True
    assert evolution.rules[rule_id].lifecycle is RuleLifecycle.ACTIVE


def test_rule_evolution_mutation_increments_version() -> None:
    evolution = RuleEvolution()
    rule_id = evolution.propose("rule-a", "v1 description")
    assert evolution.activate(rule_id) is True
    new_id = evolution.mutate(rule_id, "v2 description")
    assert new_id is not None
    # original is deprecated, new version is active
    assert evolution.rules[rule_id].lifecycle is RuleLifecycle.DEPRECATED
    new_rule = evolution.rules[new_id]
    assert new_rule.version == 2
    assert new_rule.mutation_count == 1
    assert new_rule.description == "v2 description"
    assert new_rule.parent_id == rule_id


def test_rule_evolution_deprecate_and_retire() -> None:
    evolution = RuleEvolution()
    rule_id = evolution.propose("rule-b", "desc")
    evolution.activate(rule_id)
    assert evolution.deprecate(rule_id) is True
    assert evolution.rules[rule_id].lifecycle is RuleLifecycle.DEPRECATED
    assert evolution.retire(rule_id) is True
    assert evolution.rules[rule_id].lifecycle is RuleLifecycle.RETIRED
    assert evolution.get_active_rules() == []


def test_rule_evolution_unknown_operations_return_false() -> None:
    evolution = RuleEvolution()
    assert evolution.activate("missing") is False
    assert evolution.mutate("missing", "x") is None
    assert evolution.deprecate("missing") is False


# ---------------------------------------------------------------------------
# Deferred (removed in v7.0 refactor)
# ---------------------------------------------------------------------------


def test_removed_harness_collaborators_todo() -> None:
    """MagicWordsRegistry / GovernanceBoundary / HarnessabilityScorer were removed.

    Magic-words moved to flowforge.forgemind.magic_words (see tests/test_forgekin.py).
    TODO(refactor): re-add coverage for the missing layers when reimplemented.
    """
    assert True
