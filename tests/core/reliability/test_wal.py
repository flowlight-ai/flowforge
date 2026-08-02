"""Tests for the distributed reliability subsystem (task.md P1-6, F021-F025).

Covers all five reliability primitives in one module per task.md P1-6:
- WriteAheadLog append/get/mark_committed/mark_rolled_back + list_uncommitted
- TierRecoveryService register_policy + handle_failure (RETRY/FAILOVER/ROLLBACK/ESCALATE)
- LivenessProbe register + run_probe + run_all (healthy / unhealthy / raising)
- StateWorkflowComparator classify_workflow (STRONG/WEAK/HYBRID) + recommend_pattern
- ProviderHost select_provider by priority (unhealthy skipped, exclude honored)
"""

from __future__ import annotations

import pytest

from flowforge.core.errors import ReliabilityError

# The reliability subsystem is specified in docs/decisions/010-distributed-reliability.md
# but is NOT yet implemented. Skip these spec tests until it lands.
pytest.importorskip(
    "flowforge.core.reliability",
    reason="flowforge.core.reliability not implemented (docs/decisions/010-distributed-reliability.md) — TODO",
)

from flowforge.core.reliability import (  # noqa: E402
    FailureContext,
    LivenessProbe,
    LivenessSpec,
    ProviderHost,
    RecoveryActionType,
    RecoveryPolicy,
    RecoveryTier,
    StateWorkflowComparator,
    TierRecoveryService,
    WalStatus,
    WorkflowStep,
    WorkflowStrength,
    WriteAheadLog,
)


# ---------------------------------------------------------------------------
# 1. WriteAheadLog — append / get / mark_committed / mark_rolled_back
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wal_append_returns_id_and_get_roundtrips() -> None:
    wal = WriteAheadLog()
    entry_id = await wal.append(
        action="publish_article",
        target="wechat:column-life",
        params={"title": "晨间手记", "tags": ["life", "morning"]},
    )

    assert isinstance(entry_id, str)
    assert entry_id  # non-empty

    entry = await wal.get(entry_id)
    assert entry.entry_id == entry_id
    assert entry.action == "publish_article"
    assert entry.target == "wechat:column-life"
    assert entry.params["title"] == "晨间手记"
    assert entry.params["tags"] == ["life", "morning"]
    assert entry.status == WalStatus.PENDING
    assert entry.created_at is not None


@pytest.mark.asyncio
async def test_wal_append_deep_copies_params() -> None:
    wal = WriteAheadLog()
    params = {"payload": "draft-v1"}
    entry_id = await wal.append("save", "db:articles", params)

    # Mutate the caller's dict; the stored entry must be unaffected.
    params["payload"] = "draft-v2-MUTATED"
    params["injected"] = True

    entry = await wal.get(entry_id)
    assert entry.params == {"payload": "draft-v1"}


@pytest.mark.asyncio
async def test_wal_get_unknown_raises() -> None:
    wal = WriteAheadLog()
    with pytest.raises(ReliabilityError):
        await wal.get("nonexistent-id")


@pytest.mark.asyncio
async def test_wal_append_rejects_empty_action_or_target() -> None:
    wal = WriteAheadLog()
    with pytest.raises(ReliabilityError):
        await wal.append("", "target")
    with pytest.raises(ReliabilityError):
        await wal.append("action", "")


@pytest.mark.asyncio
async def test_wal_mark_committed_transitions_status() -> None:
    wal = WriteAheadLog()
    entry_id = await wal.append("send_email", "smtp:server-1", {"to": "user@x.com"})

    await wal.mark_committed(entry_id)
    entry = await wal.get(entry_id)
    assert entry.status == WalStatus.COMMITTED


@pytest.mark.asyncio
async def test_wal_mark_rolled_back_transitions_status() -> None:
    wal = WriteAheadLog()
    entry_id = await wal.append("charge_card", "stripe:acct-9", {"amount": 4200})

    await wal.mark_rolled_back(entry_id)
    entry = await wal.get(entry_id)
    assert entry.status == WalStatus.ROLLED_BACK


@pytest.mark.asyncio
async def test_wal_mark_committed_unknown_raises() -> None:
    wal = WriteAheadLog()
    with pytest.raises(ReliabilityError):
        await wal.mark_committed("ghost")


@pytest.mark.asyncio
async def test_wal_cannot_commit_from_non_pending() -> None:
    wal = WriteAheadLog()
    entry_id = await wal.append("a", "b")
    await wal.mark_committed(entry_id)
    # COMMITTED -> COMMITTED is illegal
    with pytest.raises(ReliabilityError):
        await wal.mark_committed(entry_id)
    # COMMITTED -> ROLLED_BACK is illegal
    with pytest.raises(ReliabilityError):
        await wal.mark_rolled_back(entry_id)


@pytest.mark.asyncio
async def test_wal_list_uncommitted_returns_only_pending() -> None:
    wal = WriteAheadLog()
    e1 = await wal.append("a", "t1")
    e2 = await wal.append("b", "t2")
    e3 = await wal.append("c", "t3")
    e4 = await wal.append("d", "t4")

    await wal.mark_committed(e1)
    await wal.mark_rolled_back(e3)

    uncommitted = await wal.list_uncommitted()
    uncommitted_ids = {e.entry_id for e in uncommitted}
    assert uncommitted_ids == {e2, e4}
    # Every returned entry must be PENDING.
    assert all(e.status == WalStatus.PENDING for e in uncommitted)


@pytest.mark.asyncio
async def test_wal_list_uncommitted_empty_when_all_settled() -> None:
    wal = WriteAheadLog()
    e1 = await wal.append("a", "t1")
    e2 = await wal.append("b", "t2")
    await wal.mark_committed(e1)
    await wal.mark_rolled_back(e2)

    assert await wal.list_uncommitted() == []
    assert wal.count() == 2  # settled entries are still retained for audit


# ---------------------------------------------------------------------------
# 2. TierRecoveryService — register_policy + handle_failure
# ---------------------------------------------------------------------------


def _build_recovery_service() -> TierRecoveryService:
    svc = TierRecoveryService()
    svc.register_policy(
        "timeout",
        RecoveryPolicy(
            tier=RecoveryTier.TIER_1_RETRY,
            max_retries=3,
            retry_delay_seconds=0.5,
        ),
    )
    svc.register_policy(
        "provider_down",
        RecoveryPolicy(
            tier=RecoveryTier.TIER_2_FAILOVER,
            failover_targets=["provider-b", "provider-c"],
        ),
    )
    svc.register_policy(
        "side_effect_failed",
        RecoveryPolicy(
            tier=RecoveryTier.TIER_3_ROLLBACK,
            rollback_strategy="wal_replay",
        ),
    )
    svc.register_policy(
        "data_corruption",
        RecoveryPolicy(tier=RecoveryTier.TIER_4_ESCALATE),
    )
    return svc


@pytest.mark.asyncio
async def test_tier_recovery_timeout_returns_retry() -> None:
    svc = _build_recovery_service()
    ctx = FailureContext(
        error_type="timeout",
        error_message="upstream timed out after 30s",
        source="provider-a",
    )
    action = await svc.handle_failure(ctx)

    assert action.tier == RecoveryTier.TIER_1_RETRY
    assert action.action == RecoveryActionType.RETRY
    assert action.target == "provider-a"
    assert "3" in action.notes  # max_retries mentioned


@pytest.mark.asyncio
async def test_tier_recovery_provider_down_returns_failover() -> None:
    svc = _build_recovery_service()
    ctx = FailureContext(
        error_type="provider_down",
        error_message="provider-a 5xx rate spiked",
        source="provider-a",
    )
    action = await svc.handle_failure(ctx)

    assert action.tier == RecoveryTier.TIER_2_FAILOVER
    assert action.action == RecoveryActionType.FAILOVER
    assert action.target == "provider-b"  # first failover target
    assert "provider-c" in action.notes  # alternatives listed


@pytest.mark.asyncio
async def test_tier_recovery_side_effect_failed_returns_rollback() -> None:
    svc = _build_recovery_service()
    wal = WriteAheadLog()
    e1 = await wal.append("publish", "wechat:col-1", {"id": 100})
    e2 = await wal.append("sync_index", "opensieve:idx", {"id": 100})

    entries = [await wal.get(e1), await wal.get(e2)]
    ctx = FailureContext(
        error_type="side_effect_failed",
        error_message="publish ok but index sync threw",
        source="publish-pipeline",
        wal_entries=entries,
    )
    action = await svc.handle_failure(ctx)

    assert action.tier == RecoveryTier.TIER_3_ROLLBACK
    assert action.action == RecoveryActionType.ROLLBACK
    assert action.target == "publish-pipeline"
    assert "2" in action.notes  # 2 WAL entries mentioned
    assert "wal_replay" in action.notes


@pytest.mark.asyncio
async def test_tier_recovery_unknown_error_escalates() -> None:
    svc = _build_recovery_service()
    ctx = FailureContext(
        error_type="totally_unknown_blowup",
        error_message="cosmic ray flipped a bit",
        source="worker-x",
    )
    action = await svc.handle_failure(ctx)

    assert action.tier == RecoveryTier.TIER_4_ESCALATE
    assert action.action == RecoveryActionType.ESCALATE
    assert action.target is None
    assert "totally_unknown_blowup" in action.notes


@pytest.mark.asyncio
async def test_tier_recovery_rollback_without_wal_entries_degrades_to_escalate() -> None:
    svc = _build_recovery_service()
    ctx = FailureContext(
        error_type="side_effect_failed",
        error_message="something failed but nothing was logged",
        source="worker-y",
        wal_entries=[],
    )
    action = await svc.handle_failure(ctx)

    # Degrades: nothing to roll back -> escalate.
    assert action.action == RecoveryActionType.ESCALATE
    assert action.tier == RecoveryTier.TIER_4_ESCALATE


@pytest.mark.asyncio
async def test_tier_recovery_failover_without_targets_degrades_to_escalate() -> None:
    svc = TierRecoveryService()
    svc.register_policy(
        "provider_down",
        RecoveryPolicy(tier=RecoveryTier.TIER_2_FAILOVER, failover_targets=[]),
    )
    ctx = FailureContext(
        error_type="provider_down",
        error_message="no failover configured",
        source="provider-a",
    )
    action = await svc.handle_failure(ctx)
    assert action.action == RecoveryActionType.ESCALATE
    assert action.tier == RecoveryTier.TIER_4_ESCALATE


def test_tier_recovery_register_duplicate_raises() -> None:
    svc = TierRecoveryService()
    svc.register_policy("timeout", RecoveryPolicy(tier=RecoveryTier.TIER_1_RETRY))
    with pytest.raises(ReliabilityError):
        svc.register_policy("timeout", RecoveryPolicy(tier=RecoveryTier.TIER_1_RETRY))


def test_tier_recovery_register_empty_error_type_raises() -> None:
    svc = TierRecoveryService()
    with pytest.raises(ReliabilityError):
        svc.register_policy("", RecoveryPolicy(tier=RecoveryTier.TIER_1_RETRY))


# ---------------------------------------------------------------------------
# 3. LivenessProbe — register + run_probe + run_all (healthy / unhealthy)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_liveness_run_probe_healthy() -> None:
    probe = LivenessProbe()

    async def db_ping() -> bool:
        return True

    probe.register_probe("db_ping", db_ping)
    result = await probe.run_probe("db_ping")

    assert result.name == "db_ping"
    assert result.healthy is True
    assert result.error is None
    assert result.latency_ms >= 0.0
    assert result.last_checked is not None


@pytest.mark.asyncio
async def test_liveness_run_probe_unhealthy() -> None:
    probe = LivenessProbe()

    async def dying_queue() -> bool:
        return False

    probe.register_probe("queue_depth", dying_queue)
    result = await probe.run_probe("queue_depth")

    assert result.healthy is False
    assert result.error is None  # returned False, did not raise


@pytest.mark.asyncio
async def test_liveness_probe_captures_exception_into_error() -> None:
    probe = LivenessProbe()

    async def broken_check() -> bool:
        raise RuntimeError("connection refused")

    probe.register_probe("broken_endpoint", broken_check)
    result = await probe.run_probe("broken_endpoint")

    assert result.healthy is False
    assert result.error is not None
    assert "connection refused" in result.error


@pytest.mark.asyncio
async def test_liveness_run_all_runs_every_probe_independently() -> None:
    probe = LivenessProbe()

    async def healthy_check() -> bool:
        return True

    async def unhealthy_check() -> bool:
        return False

    async def raising_check() -> bool:
        raise ValueError("boom")

    probe.register_probe("ok", healthy_check)
    probe.register_probe("down", unhealthy_check)
    probe.register_probe("broken", raising_check)

    results = await probe.run_all()
    by_name = {r.name: r for r in results}

    assert set(by_name.keys()) == {"ok", "down", "broken"}
    assert by_name["ok"].healthy is True
    assert by_name["down"].healthy is False
    assert by_name["broken"].healthy is False
    assert by_name["broken"].error is not None
    # One broken probe must not have aborted the others.
    assert len(results) == 3


@pytest.mark.asyncio
async def test_liveness_run_probe_unknown_raises() -> None:
    probe = LivenessProbe()
    with pytest.raises(ReliabilityError):
        await probe.run_probe("never_registered")


def test_liveness_register_duplicate_raises() -> None:
    probe = LivenessProbe()

    async def check() -> bool:
        return True

    probe.register_probe("dup", check)
    with pytest.raises(ReliabilityError):
        probe.register_probe("dup", check)


def test_liveness_spec_metadata_preserved() -> None:
    probe = LivenessProbe()

    async def check() -> bool:
        return True

    spec = LivenessSpec(
        name="search_backend",
        description="OpenSieve query path",
        sla_seconds=2.5,
        required_for=["retrieval", "fact_check"],
    )
    probe.register_spec(spec, check)

    retrieved = probe.get_spec("search_backend")
    assert retrieved.description == "OpenSieve query path"
    assert retrieved.sla_seconds == 2.5
    assert retrieved.required_for == ["retrieval", "fact_check"]
    assert probe.count() == 1


# ---------------------------------------------------------------------------
# 4. StateWorkflowComparator — classify STRONG / WEAK / HYBRID
# ---------------------------------------------------------------------------


def test_state_workflow_classifies_strong_when_all_compensatable_and_idempotent() -> None:
    comparator = StateWorkflowComparator()
    steps = [
        WorkflowStep(name="draft", has_compensation=True, idempotent=True),
        WorkflowStep(name="review", has_compensation=True, idempotent=True),
        WorkflowStep(name="publish", has_compensation=True, idempotent=True),
    ]
    strength = comparator.classify_workflow(steps)
    assert strength == WorkflowStrength.STRONG
    assert comparator.recommend_pattern(strength) == "use workflow engine"


def test_state_workflow_classifies_weak_when_no_compensation() -> None:
    comparator = StateWorkflowComparator()
    steps = [
        WorkflowStep(name="send_otp", has_compensation=False, idempotent=False),
        WorkflowStep(name="deduct_wallet", has_compensation=False, idempotent=False),
    ]
    strength = comparator.classify_workflow(steps)
    assert strength == WorkflowStrength.WEAK
    assert comparator.recommend_pattern(strength) == "use state machine"


def test_state_workflow_classifies_hybrid_when_mixed() -> None:
    comparator = StateWorkflowComparator()
    steps = [
        WorkflowStep(name="save_draft", has_compensation=True, idempotent=True),
        WorkflowStep(name="charge_card", has_compensation=False, idempotent=False),
        WorkflowStep(name="send_receipt", has_compensation=True, idempotent=True),
    ]
    strength = comparator.classify_workflow(steps)
    assert strength == WorkflowStrength.HYBRID
    assert comparator.recommend_pattern(strength) == "hybrid"


def test_state_workflow_strong_degrades_to_hybrid_when_external_state_required() -> None:
    comparator = StateWorkflowComparator()
    # All compensatable + idempotent, but one step touches external state —
    # replay could desync, so the workflow is no longer STRONG.
    steps = [
        WorkflowStep(
            name="sync_third_party",
            has_compensation=True,
            idempotent=True,
            requires_external_state=True,
        ),
        WorkflowStep(name="local_save", has_compensation=True, idempotent=True),
    ]
    strength = comparator.classify_workflow(steps)
    assert strength == WorkflowStrength.HYBRID


def test_state_workflow_classify_empty_raises() -> None:
    comparator = StateWorkflowComparator()
    with pytest.raises(ReliabilityError):
        comparator.classify_workflow([])


def test_state_workflow_recommend_pattern_covers_all_strengths() -> None:
    comparator = StateWorkflowComparator()
    assert comparator.recommend_pattern(WorkflowStrength.STRONG) == "use workflow engine"
    assert comparator.recommend_pattern(WorkflowStrength.WEAK) == "use state machine"
    assert comparator.recommend_pattern(WorkflowStrength.HYBRID) == "hybrid"


# ---------------------------------------------------------------------------
# 5. ProviderHost — select_provider by priority (unhealthy skipped)
# ---------------------------------------------------------------------------


def test_provider_host_selects_highest_priority_healthy_provider() -> None:
    host = ProviderHost()
    host.register_provider("primary", priority=1)
    host.register_provider("secondary", priority=2)
    host.register_provider("tertiary", priority=3)

    assert host.select_provider() == "primary"


def test_provider_host_skips_unhealthy_and_falls_to_next_priority() -> None:
    host = ProviderHost()
    host.register_provider("primary", priority=1)
    host.register_provider("secondary", priority=2)
    host.register_provider("tertiary", priority=3)

    host.mark_unhealthy("primary")
    # primary is unhealthy -> secondary (next priority) is selected.
    assert host.select_provider() == "secondary"

    host.mark_unhealthy("secondary")
    assert host.select_provider() == "tertiary"


def test_provider_host_returns_none_when_all_unhealthy() -> None:
    host = ProviderHost()
    host.register_provider("only", priority=1)
    host.mark_unhealthy("only")

    assert host.select_provider() is None


def test_provider_host_exclude_list_honored_for_failover() -> None:
    host = ProviderHost()
    host.register_provider("primary", priority=1)
    host.register_provider("secondary", priority=2)
    host.register_provider("tertiary", priority=3)

    # Simulate failover: exclude the failed primary.
    assert host.select_provider(exclude=["primary"]) == "secondary"
    # Exclude both primary and secondary.
    assert host.select_provider(exclude=["primary", "secondary"]) == "tertiary"
    # Exclude everything -> None.
    assert host.select_provider(exclude=["primary", "secondary", "tertiary"]) is None


def test_provider_host_mark_healthy_restores_selection() -> None:
    host = ProviderHost()
    host.register_provider("primary", priority=1)
    host.register_provider("secondary", priority=2)

    host.mark_unhealthy("primary")
    assert host.select_provider() == "secondary"

    host.mark_healthy("primary")
    assert host.select_provider() == "primary"


def test_provider_host_list_providers_returns_snapshot() -> None:
    host = ProviderHost()
    host.register_provider("a", priority=2)
    host.register_provider("b", priority=1, healthy=False)

    infos = host.list_providers()
    assert len(infos) == 2
    by_name = {i.name: i for i in infos}
    assert by_name["a"].priority == 2
    assert by_name["a"].healthy is True
    assert by_name["b"].priority == 1
    assert by_name["b"].healthy is False
    assert by_name["a"].last_state_change is not None

    # Mutating the snapshot must not affect internal state.
    by_name["a"].healthy = False
    assert host.is_healthy("a") is True


def test_provider_host_register_duplicate_raises() -> None:
    host = ProviderHost()
    host.register_provider("dup", priority=1)
    with pytest.raises(ReliabilityError):
        host.register_provider("dup", priority=2)


def test_provider_host_mark_unknown_raises() -> None:
    host = ProviderHost()
    with pytest.raises(ReliabilityError):
        host.mark_unhealthy("ghost")
    with pytest.raises(ReliabilityError):
        host.mark_healthy("ghost")


def test_provider_host_priority_tiebreak_keeps_registration_order() -> None:
    host = ProviderHost()
    # Same priority -> first registered wins (stable sort).
    host.register_provider("first", priority=1)
    host.register_provider("second", priority=1)

    assert host.select_provider() == "first"


# ---------------------------------------------------------------------------
# 6. Package-level import sanity — all main types re-exported
# ---------------------------------------------------------------------------


def test_reliability_package_exports_all_types() -> None:
    # If this import fails or a name is missing, the test errors out.
    from flowforge.core import reliability as rel

    for name in (
        "WalStatus",
        "WalEntry",
        "WriteAheadLog",
        "RecoveryTier",
        "RecoveryActionType",
        "RecoveryPolicy",
        "FailureContext",
        "RecoveryAction",
        "TierRecoveryService",
        "ProbeResult",
        "LivenessSpec",
        "LivenessProbe",
        "WorkflowStrength",
        "WorkflowStep",
        "StateWorkflowComparator",
        "ProviderInfo",
        "ProviderHost",
    ):
        assert hasattr(rel, name), f"reliability package missing export {name!r}"
