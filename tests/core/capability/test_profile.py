"""Tests for the capability profile (能力画像) subsystem — P1-1.

Covers: add_skill / add_blind_spot, blind-spot conflict detection,
gap_analysis, complementary pairing, YAML round-trip, to_dict/from_dict.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from flowforge.core.capability import (
    CapabilityAnalyzer,
    CapabilityProfile,
    CognitiveStyle,
    ProfileLoader,
)
from flowforge.core.errors import CapabilityError


# ---- fixtures ----


@pytest.fixture
def profile_a() -> CapabilityProfile:
    """Coder profile: strong at coding, blind at design."""
    p = CapabilityProfile(
        forgekin_id="fk-coder", cognitive_style=CognitiveStyle.ANALYTICAL
    )
    p.add_skill("coding", 0.9, evidence=["commit abc", "pr 123"])
    p.add_blind_spot("design", 0.7, mitigation="delegate to designer")
    return p


@pytest.fixture
def profile_b() -> CapabilityProfile:
    """Designer profile: strong at design, blind at coding."""
    p = CapabilityProfile(
        forgekin_id="fk-designer", cognitive_style=CognitiveStyle.INNOVATIVE
    )
    p.add_skill("design", 0.85, evidence=["mockup v2"])
    p.add_blind_spot("coding", 0.6, mitigation="delegate to coder")
    return p


# ---- add_skill / add_blind_spot ----


def test_add_skill_records_package_and_updates_timestamp(
    profile_a: CapabilityProfile,
) -> None:
    assert "coding" in profile_a.skill_packages
    skill = profile_a.skill_packages["coding"]
    assert skill.proficiency == pytest.approx(0.9)
    assert skill.evidence == ["commit abc", "pr 123"]
    assert skill.last_assessed_at is not None


def test_add_skill_rejects_empty_name() -> None:
    p = CapabilityProfile(forgekin_id="fk-x")
    with pytest.raises(CapabilityError, match="name must not be empty"):
        p.add_skill("  ", 0.5)


def test_add_skill_rejects_out_of_range_proficiency() -> None:
    p = CapabilityProfile(forgekin_id="fk-x")
    with pytest.raises(CapabilityError, match="proficiency"):
        p.add_skill("coding", 1.5)


def test_add_blind_spot_records_entry(profile_a: CapabilityProfile) -> None:
    assert len(profile_a.blind_spots) == 1
    spot = profile_a.blind_spots[0]
    assert spot.name == "design"
    assert spot.severity == pytest.approx(0.7)
    assert spot.mitigation == "delegate to designer"
    assert spot.discovered_at is not None


def test_add_blind_spot_rejects_out_of_range_severity() -> None:
    p = CapabilityProfile(forgekin_id="fk-x")
    with pytest.raises(CapabilityError, match="severity"):
        p.add_blind_spot("design", -0.1)


# ---- blind spot conflict ----


def test_blind_spot_conflict_when_strength_is_others_blind_spot(
    profile_a: CapabilityProfile, profile_b: CapabilityProfile
) -> None:
    # A's strength "coding" is B's blind spot "coding" → conflict
    assert profile_a.has_blind_spot_conflict(profile_b) is True
    # symmetric: B's strength "design" is A's blind spot "design"
    assert profile_b.has_blind_spot_conflict(profile_a) is True


def test_no_blind_spot_conflict_when_strengths_do_not_match_blind_spots() -> None:
    p1 = CapabilityProfile(forgekin_id="fk-1")
    p1.add_skill("coding", 0.9)
    p2 = CapabilityProfile(forgekin_id="fk-2")
    p2.add_skill("coding", 0.9)
    # both strong at coding, no blind spots → no conflict
    assert p1.has_blind_spot_conflict(p2) is False


def test_no_conflict_when_skill_below_strength_threshold() -> None:
    p1 = CapabilityProfile(forgekin_id="fk-1")
    p1.add_skill("coding", 0.3)  # below 0.5 threshold → not a strength
    p2 = CapabilityProfile(forgekin_id="fk-2")
    p2.add_blind_spot("coding", 0.8)
    assert p1.has_blind_spot_conflict(p2) is False


# ---- gap_analysis ----


def test_gap_analysis_returns_missing_and_matching(
    profile_a: CapabilityProfile,
) -> None:
    analyzer = CapabilityAnalyzer()
    report = analyzer.gap_analysis(profile_a, ["coding", "design", "writing"])
    assert "coding" in report.matching_skills
    assert set(report.missing_skills) == {"design", "writing"}
    assert report.total_gap_score == pytest.approx(2.0)


def test_gap_analysis_no_gap_when_all_required_present(
    profile_a: CapabilityProfile,
) -> None:
    analyzer = CapabilityAnalyzer()
    report = analyzer.gap_analysis(profile_a, ["coding"])
    assert report.missing_skills == []
    assert report.matching_skills == ["coding"]
    assert report.total_gap_score == 0.0


def test_gap_analysis_respects_proficiency_threshold() -> None:
    p = CapabilityProfile(forgekin_id="fk-x")
    p.add_skill("coding", 0.4)  # below default 0.5
    analyzer = CapabilityAnalyzer(proficiency_threshold=0.5)
    report = analyzer.gap_analysis(p, ["coding"])
    assert report.missing_skills == ["coding"]
    assert report.matching_skills == []


# ---- complementary pairing ----


def test_find_complementary_pair_true_when_each_covers_others_gap(
    profile_a: CapabilityProfile, profile_b: CapabilityProfile
) -> None:
    analyzer = CapabilityAnalyzer()
    # A has coding (lacks design), B has design (lacks coding) → together cover
    assert (
        analyzer.find_complementary_pair(profile_a, profile_b, ["coding", "design"])
        is True
    )


def test_find_complementary_pair_false_when_both_lack_same_skill(
    profile_a: CapabilityProfile, profile_b: CapabilityProfile
) -> None:
    analyzer = CapabilityAnalyzer()
    # neither has "writing"
    assert (
        analyzer.find_complementary_pair(profile_a, profile_b, ["coding", "writing"])
        is False
    )


# ---- compute_overlap ----


def test_compute_overlap_full_when_identical_skills() -> None:
    p1 = CapabilityProfile(forgekin_id="fk-1")
    p1.add_skill("coding", 0.9)
    p2 = CapabilityProfile(forgekin_id="fk-2")
    p2.add_skill("coding", 0.8)
    analyzer = CapabilityAnalyzer()
    assert analyzer.compute_overlap(p1, p2) == pytest.approx(1.0)


def test_compute_overlap_zero_when_disjoint_skills(
    profile_a: CapabilityProfile, profile_b: CapabilityProfile
) -> None:
    analyzer = CapabilityAnalyzer()
    assert analyzer.compute_overlap(profile_a, profile_b) == pytest.approx(0.0)


def test_compute_overlap_partial() -> None:
    p1 = CapabilityProfile(forgekin_id="fk-1")
    p1.add_skill("coding", 0.9)
    p1.add_skill("design", 0.5)
    p2 = CapabilityProfile(forgekin_id="fk-2")
    p2.add_skill("coding", 0.8)
    p2.add_skill("writing", 0.6)
    analyzer = CapabilityAnalyzer()
    # intersection {coding}=1, union {coding,design,writing}=3 → 1/3
    assert analyzer.compute_overlap(p1, p2) == pytest.approx(1.0 / 3.0)


def test_compute_overlap_zero_when_both_empty() -> None:
    p1 = CapabilityProfile(forgekin_id="fk-1")
    p2 = CapabilityProfile(forgekin_id="fk-2")
    analyzer = CapabilityAnalyzer()
    assert analyzer.compute_overlap(p1, p2) == 0.0


# ---- serialization to_dict / from_dict ----


def test_to_dict_from_dict_round_trip(profile_a: CapabilityProfile) -> None:
    data = profile_a.to_dict()
    restored = CapabilityProfile.from_dict(data)
    assert restored.forgekin_id == profile_a.forgekin_id
    assert restored.cognitive_style == profile_a.cognitive_style
    assert set(restored.skill_packages.keys()) == set(profile_a.skill_packages.keys())
    assert restored.skill_packages["coding"].proficiency == pytest.approx(0.9)
    assert restored.skill_packages["coding"].evidence == ["commit abc", "pr 123"]
    assert len(restored.blind_spots) == len(profile_a.blind_spots)
    assert restored.blind_spots[0].name == "design"
    # datetime round-trips via isoformat exactly
    assert restored.last_updated_at == profile_a.last_updated_at


def test_from_dict_rejects_missing_forgekin_id() -> None:
    with pytest.raises(CapabilityError, match="forgekin_id"):
        CapabilityProfile.from_dict({"cognitive_style": "analytical"})


def test_from_dict_rejects_invalid_cognitive_style() -> None:
    with pytest.raises(CapabilityError, match="cognitive_style"):
        CapabilityProfile.from_dict(
            {"forgekin_id": "fk-x", "cognitive_style": "bogus"}
        )


def test_capability_profile_rejects_empty_forgekin_id() -> None:
    with pytest.raises(CapabilityError, match="forgekin_id"):
        CapabilityProfile(forgekin_id="  ")


# ---- YAML round-trip ----


@pytest.mark.asyncio
async def test_yaml_round_trip(tmp_path: Path, profile_a: CapabilityProfile) -> None:
    loader = ProfileLoader()
    target = tmp_path / "profile_a.yaml"
    await loader.save_to_yaml(profile_a, target)
    assert target.exists()
    restored = await loader.load_from_yaml(target)
    assert restored.forgekin_id == profile_a.forgekin_id
    assert restored.cognitive_style == profile_a.cognitive_style
    assert set(restored.skill_packages.keys()) == {"coding"}
    assert restored.skill_packages["coding"].proficiency == pytest.approx(0.9)
    assert restored.skill_packages["coding"].evidence == ["commit abc", "pr 123"]
    assert len(restored.blind_spots) == 1
    assert restored.blind_spots[0].name == "design"
    assert restored.blind_spots[0].severity == pytest.approx(0.7)


@pytest.mark.asyncio
async def test_yaml_round_trip_preserves_all_fields(
    tmp_path: Path, profile_b: CapabilityProfile
) -> None:
    loader = ProfileLoader()
    target = tmp_path / "profile_b.yaml"
    await loader.save_to_yaml(profile_b, target)
    restored = await loader.load_from_yaml(target)
    # Full equality via to_dict comparison (datetimes round-trip via isoformat)
    assert restored.to_dict() == profile_b.to_dict()


@pytest.mark.asyncio
async def test_yaml_round_trip_with_explicit_schema(tmp_path: Path) -> None:
    """Load a YAML file matching the documented schema (ADR-004 / F001)."""
    loader = ProfileLoader()
    target = tmp_path / "schema.yaml"
    target.write_text(
        """
forgekin_id: fk-001
cognitive_style: analytical
skill_packages:
  - name: coding
    proficiency: 0.85
    evidence: ["commit abc", "pr 123"]
blind_spots:
  - name: design
    severity: 0.7
    mitigation: delegate to designer
""",
        encoding="utf-8",
    )
    profile = await loader.load_from_yaml(target)
    assert profile.forgekin_id == "fk-001"
    assert profile.cognitive_style == CognitiveStyle.ANALYTICAL
    assert profile.skill_packages["coding"].proficiency == pytest.approx(0.85)
    assert profile.blind_spots[0].name == "design"
    assert profile.blind_spots[0].mitigation == "delegate to designer"


@pytest.mark.asyncio
async def test_load_from_yaml_raises_on_missing_file(tmp_path: Path) -> None:
    loader = ProfileLoader()
    with pytest.raises(CapabilityError, match="not found"):
        await loader.load_from_yaml(tmp_path / "nope.yaml")


@pytest.mark.asyncio
async def test_load_from_yaml_raises_on_empty_file(tmp_path: Path) -> None:
    loader = ProfileLoader()
    target = tmp_path / "empty.yaml"
    target.write_text("", encoding="utf-8")
    with pytest.raises(CapabilityError, match="empty"):
        await loader.load_from_yaml(target)
