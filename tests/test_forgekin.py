"""Tests for forgekin (灵族) + external agent adapters + council."""

from __future__ import annotations

import pytest

from flowforge.core.errors import ForgekinError
from flowforge.forgemind.council import CouncilChannel, CouncilVerdict
from flowforge.forgemind.examples import (
    build_cat_companion,
    build_desk_lamp,
    build_sherlock,
    build_team_spirit,
)
from flowforge.forgemind.external_agents import (
    DEFAULT_CONFIGS,
    ExternalAgentAdapter,
    ExternalAgentKind,
    build_default_adapters,
)
from flowforge.forgemind.forgekin import (
    BlindSpot,
    Capability,
    Forgekin,
    ForgekinType,
)
from flowforge.forgemind.magic_words import (
    MAGIC_WORDS,
    MagicWordTrigger,
    detect_magic_word,
)
from flowforge.forgemind.registry import ForgekinRegistry, get_registry


# ---- Forgekin basics ----


def test_forgekin_requires_name() -> None:
    with pytest.raises(ForgekinError, match="name must not be empty"):
        Forgekin(name="")


def test_forgekin_add_capability_and_blind_spot() -> None:
    fk = Forgekin(name="test")
    fk.add_capability(Capability(name="coding", proficiency=0.8))
    fk.add_blind_spot(BlindSpot(name="marketing", severity=0.7, mitigation="delegate"))
    assert fk.has_capability("coding")
    assert not fk.has_capability("marketing")  # not a capability
    assert len(fk.blind_spots) == 1


def test_forgekin_can_take_task_checks_capabilities_and_energy() -> None:
    fk = Forgekin(name="test")
    fk.add_capability(Capability(name="coding", proficiency=0.8))
    ok, missing = fk.can_take_task(["coding"])
    assert ok is True
    assert missing == []

    ok, missing = fk.can_take_task(["coding", "writing"])
    assert ok is False
    assert "writing" in missing


def test_forgekin_energy_depletes_and_recovers() -> None:
    fk = Forgekin(name="test")
    assert fk.state.energy == 1.0
    fk.spend_energy(0.4)
    assert fk.state.energy == pytest.approx(0.6)
    fk.spend_energy(1.0)  # over-spend clamps to 0
    assert fk.state.energy == 0.0
    fk.recover_energy(0.5)
    assert fk.state.energy == pytest.approx(0.5)


def test_forgekin_spend_energy_rejects_negative() -> None:
    fk = Forgekin(name="test")
    with pytest.raises(ForgekinError):
        fk.spend_energy(-0.1)


# ---- Registry ----


def test_registry_register_and_get() -> None:
    reg = ForgekinRegistry()
    fk = Forgekin(name="x")
    reg.register(fk)
    assert reg.get(fk.forgekin_id) is fk
    assert reg.count() == 1


def test_registry_duplicate_register_raises() -> None:
    reg = ForgekinRegistry()
    fk = Forgekin(name="x")
    reg.register(fk)
    with pytest.raises(ForgekinError, match="already registered"):
        reg.register(fk)


def test_registry_find_by_capability() -> None:
    reg = ForgekinRegistry()
    fk = Forgekin(name="coder")
    fk.add_capability(Capability(name="coding", proficiency=0.9))
    reg.register(fk)
    matches = reg.find_by_capability("coding", min_proficiency=0.8)
    assert fk in matches


def test_registry_select_owner_picks_most_capable() -> None:
    reg = ForgekinRegistry()
    weak = Forgekin(name="weak", vendor="vendor_a")
    weak.add_capability(Capability(name="coding", proficiency=0.6))
    strong = Forgekin(name="strong", vendor="vendor_b")
    strong.add_capability(Capability(name="coding", proficiency=0.95))
    reg.register(weak)
    reg.register(strong)
    owner = reg.select_owner(["coding"])
    assert owner is strong


def test_registry_select_owner_excludes_by_id() -> None:
    reg = ForgekinRegistry()
    fk = Forgekin(name="only")
    fk.add_capability(Capability(name="coding", proficiency=0.9))
    reg.register(fk)
    owner = reg.select_owner(["coding"], exclude=[fk.forgekin_id])
    assert owner is None


# ---- Examples ----


def test_cat_companion_has_empathy_not_coding() -> None:
    cat = build_cat_companion()
    assert cat.has_capability("empathy", min_proficiency=0.8)
    assert not cat.has_capability("coding", min_proficiency=0.5)


def test_team_spirit_has_architecture() -> None:
    team = build_team_spirit()
    assert team.has_capability("architecture_design", min_proficiency=0.8)


def test_desk_lamp_immobile_blind_spot() -> None:
    lamp = build_desk_lamp()
    assert any(b.name == "mobility" for b in lamp.blind_spots)


def test_sherlock_has_modern_tech_blind_spot() -> None:
    sherlock = build_sherlock()
    assert any(b.name == "modern_technology" for b in sherlock.blind_spots)


# ---- Magic words ----


def test_detect_magic_word_returns_first_match() -> None:
    mw = detect_magic_word("用第一性原理重新考虑")
    assert mw is not None
    assert mw.trigger == MagicWordTrigger.STOP_AND_AUDIT


def test_detect_magic_word_returns_none_on_clean_text() -> None:
    assert detect_magic_word("proceed normally") is None


def test_all_magic_words_have_unique_phrases() -> None:
    phrases = [mw.phrase for mw in MAGIC_WORDS]
    assert len(phrases) == len(set(phrases))


# ---- Council ----


def test_council_passes_with_two_distinct_vendors() -> None:
    council = CouncilChannel(min_reviewers=2, min_distinct_vendors=2, pass_threshold=0.85)
    reviewers = [
        Forgekin(name="r1", vendor="vendor_a"),
        Forgekin(name="r2", vendor="vendor_b"),
    ]
    session = council.convene(artifact="x", reviewers=reviewers)
    # Default stub review returns PASS at 0.85
    assert session.final_verdict == CouncilVerdict.PASS


def test_council_escalates_with_single_vendor() -> None:
    council = CouncilChannel(min_reviewers=2, min_distinct_vendors=2)
    reviewers = [
        Forgekin(name="r1", vendor="vendor_a"),
        Forgekin(name="r2", vendor="vendor_a"),
    ]
    session = council.convene(artifact="x", reviewers=reviewers)
    assert session.final_verdict == CouncilVerdict.ESCALATE


def test_council_fails_if_any_reviewer_fails() -> None:
    council = CouncilChannel()

    def review_fn(reviewer, artifact):
        from flowforge.forgemind.council import CouncilReview

        if reviewer.name == "r1":
            return CouncilReview(
                reviewer_id=reviewer.forgekin_id,
                reviewer_vendor=reviewer.vendor,
                verdict=CouncilVerdict.FAIL,
                score=0.2,
            )
        return CouncilReview(
            reviewer_id=reviewer.forgekin_id,
            reviewer_vendor=reviewer.vendor,
            verdict=CouncilVerdict.PASS,
            score=0.95,
        )

    reviewers = [
        Forgekin(name="r1", vendor="vendor_a"),
        Forgekin(name="r2", vendor="vendor_b"),
    ]
    session = council.convene(artifact="x", reviewers=reviewers, review_fn=review_fn)
    assert session.final_verdict == CouncilVerdict.FAIL


# ---- External agents ----


def test_default_adapters_built_for_all_four() -> None:
    adapters = build_default_adapters()
    assert ExternalAgentKind.CLAUDE_CODE in adapters
    assert ExternalAgentKind.CODEX in adapters
    assert ExternalAgentKind.OPENCODE in adapters
    assert ExternalAgentKind.TRAE in adapters


def test_external_adapter_is_available_returns_bool() -> None:
    cfg = DEFAULT_CONFIGS[ExternalAgentKind.CLAUDE_CODE]
    adapter = ExternalAgentAdapter(cfg)
    # is_available should not raise — actual value depends on host
    assert isinstance(adapter.is_available(), bool)


@pytest.mark.asyncio
async def test_external_adapter_raises_when_binary_missing() -> None:
    from flowforge.forgemind.external_agents import ExternalAgentConfig, ExternalAgentError

    cfg = ExternalAgentConfig(
        kind=ExternalAgentKind.CUSTOM,
        binary="definitely-not-on-path-xyz123",
        description="bogus",
    )
    adapter = ExternalAgentAdapter(cfg)
    with pytest.raises(ExternalAgentError, match="not found in PATH"):
        await adapter.invoke("hello")


# ---- get_registry singleton ----


def test_get_registry_returns_singleton() -> None:
    r1 = get_registry()
    r2 = get_registry()
    assert r1 is r2
