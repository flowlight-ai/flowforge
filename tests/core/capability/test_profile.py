"""Tests for the capability profile (能力画像) subsystem — P1-1.

Covers: profile construction, skill packages, blind-spot conflict detection,
gap_analysis (compute_gap), complementary pairing (recommend_pairing),
blind-spot conflict detection, JSON/YAML round-trip.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from flowforge.core.capability import (
    BlindSpot,
    BlindSpotCategory,
    CapabilityProfile,
    CognitiveStyle,
    ModelCapability,
    ProfileAnalyzer,
    ProfileLoader,
    SkillPackage,
    TaskProfile,
    ToolBoundary,
)


# ---- fixtures ----

_MC_CODER = ModelCapability(
    provider="anthropic",
    model_name="claude-sonnet-4",
    context_window=200000,
    strengths=["code_generation", "refactoring"],
    limitations=["spatial_reasoning"],
    reasoning_capability=0.9,
    creativity_capability=0.6,
)

_MC_DESIGNER = ModelCapability(
    provider="google",
    model_name="gemini-2-pro",
    context_window=1000000,
    strengths=["design", "creative_writing"],
    limitations=["code_consistency"],
    reasoning_capability=0.8,
    creativity_capability=0.95,
)


@pytest.fixture
def profile_a() -> CapabilityProfile:
    """Coder profile: strong at coding, blind at design."""
    return CapabilityProfile(
        profile_id="fk-coder",
        agent_id="fk-coder",
        model_capability=_MC_CODER,
        cognitive_style=CognitiveStyle(explanation_style="structured"),
        skill_packages=[
            SkillPackage(name="coding", domain="programming", proficiency=0.9),
        ],
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.SPATIAL_REASONING,
                description="weak at visual/spatial design",
            ),
        ],
    )


@pytest.fixture
def profile_b() -> CapabilityProfile:
    """Designer profile: strong at design, blind at math."""
    return CapabilityProfile(
        profile_id="fk-designer",
        agent_id="fk-designer",
        model_capability=_MC_DESIGNER,
        cognitive_style=CognitiveStyle(explanation_style="narrative"),
        skill_packages=[
            SkillPackage(name="design", domain="design", proficiency=0.85),
        ],
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.MATH_COMPUTATION,
                description="weak at precise math",
            ),
        ],
    )


# ---- profile construction ----

def test_profile_requires_profile_id_and_agent_id() -> None:
    with pytest.raises(ValueError, match="profile_id"):
        CapabilityProfile(
            agent_id="x",
            model_capability=_MC_CODER,
        )
    with pytest.raises(ValueError, match="agent_id"):
        CapabilityProfile(
            profile_id="x",
            model_capability=_MC_CODER,
        )


def test_profile_requires_model_capability() -> None:
    with pytest.raises(ValueError, match="model_capability"):
        CapabilityProfile(profile_id="x", agent_id="x")


def test_profile_accepts_defaults() -> None:
    p = CapabilityProfile(
        profile_id="fk-x",
        agent_id="fk-x",
        model_capability=_MC_CODER,
    )
    assert p.skill_packages == []
    assert p.blind_spots == []
    assert p.tool_boundary.allowed_tools == []
    assert p.harness_fit_score.overall == pytest.approx(0.5)


def test_profile_rejects_invalid_cognitive_style() -> None:
    with pytest.raises(ValueError, match="explanation_style"):
        CognitiveStyle(explanation_style="bogus")


def test_profile_rejects_invalid_mood() -> None:
    from flowforge.core.capability import AgentState

    with pytest.raises(ValueError, match="mood"):
        AgentState(mood="bogus")


def test_skill_package_rejects_out_of_range_proficiency() -> None:
    with pytest.raises(ValueError, match="proficiency"):
        SkillPackage(name="coding", domain="programming", proficiency=1.5)


def test_blind_spot_rejects_out_of_range_confidence() -> None:
    with pytest.raises(ValueError, match="confidence"):
        BlindSpot(
            category=BlindSpotCategory.OTHER,
            description="x",
            confidence=1.5,
        )


# ---- skill / blind spot accessors ----

def test_has_skill_detects_loaded_package(profile_a: CapabilityProfile) -> None:
    assert profile_a.has_skill("coding") is True
    assert profile_a.has_skill("design") is False


def test_skill_package_records_proficiency_and_evidence() -> None:
    p = CapabilityProfile(
        profile_id="fk-x",
        agent_id="fk-x",
        model_capability=_MC_CODER,
        skill_packages=[
            SkillPackage(name="coding", domain="programming", proficiency=0.9),
        ],
    )
    skill = p.skill_packages[0]
    assert skill.name == "coding"
    assert skill.proficiency == pytest.approx(0.9)
    assert skill.domain == "programming"


def test_blind_spot_records_entry(profile_a: CapabilityProfile) -> None:
    spot = profile_a.blind_spots[0]
    assert spot.category is BlindSpotCategory.SPATIAL_REASONING
    assert spot.description == "weak at visual/spatial design"
    assert spot.compensation_strategy == "cross_vendor_review"


# ---- blind spot conflict ----

def test_same_vendor_same_category_conflicts() -> None:
    p1 = CapabilityProfile(
        profile_id="fk-1",
        agent_id="fk-1",
        model_capability=_MC_CODER,
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.MATH_COMPUTATION,
                description="weak at math",
            ),
        ],
    )
    p2 = CapabilityProfile(
        profile_id="fk-2",
        agent_id="fk-2",
        model_capability=_MC_CODER,  # same provider
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.MATH_COMPUTATION,
                description="weak at math too",
            ),
        ],
    )
    assert p1.has_blind_spot_conflict(p2) is True
    assert p2.has_blind_spot_conflict(p1) is True


def test_cross_vendor_never_conflicts() -> None:
    p1 = CapabilityProfile(
        profile_id="fk-1",
        agent_id="fk-1",
        model_capability=_MC_CODER,
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.MATH_COMPUTATION,
                description="weak at math",
            ),
        ],
    )
    p2 = CapabilityProfile(
        profile_id="fk-2",
        agent_id="fk-2",
        model_capability=_MC_DESIGNER,  # different provider
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.MATH_COMPUTATION,
                description="weak at math too",
            ),
        ],
    )
    assert p1.has_blind_spot_conflict(p2) is False


def test_same_vendor_different_category_no_conflict() -> None:
    p1 = CapabilityProfile(
        profile_id="fk-1",
        agent_id="fk-1",
        model_capability=_MC_CODER,
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.MATH_COMPUTATION,
                description="weak at math",
            ),
        ],
    )
    p2 = CapabilityProfile(
        profile_id="fk-2",
        agent_id="fk-2",
        model_capability=_MC_CODER,
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.SPATIAL_REASONING,
                description="weak at spatial",
            ),
        ],
    )
    assert p1.has_blind_spot_conflict(p2) is False


# ---- gap_analysis / compute_gap ----

def test_gap_analysis_returns_missing_and_matching(
    profile_a: CapabilityProfile,
) -> None:
    task = TaskProfile(
        task_id="t1",
        task_type="code_generation",
        required_skills=["coding", "design", "writing"],
    )
    report = ProfileAnalyzer.compute_gap(profile_a, task)
    assert report.missing_skills == ["design", "writing"]
    assert report.has_critical_gap is True


def test_gap_analysis_no_gap_when_all_required_present(
    profile_a: CapabilityProfile,
) -> None:
    task = TaskProfile(
        task_id="t2",
        task_type="code_generation",
        required_skills=["coding"],
    )
    report = ProfileAnalyzer.compute_gap(profile_a, task)
    assert report.missing_skills == []
    assert report.has_critical_gap is False


def test_gap_analysis_missing_tools(profile_a: CapabilityProfile) -> None:
    task = TaskProfile(
        task_id="t3",
        task_type="code_generation",
        required_tools=["git_push"],
    )
    report = ProfileAnalyzer.compute_gap(profile_a, task)
    assert report.missing_tools == ["git_push"]


def test_gap_analysis_tool_in_forbidden_list_is_missing(
    profile_a: CapabilityProfile,
) -> None:
    profile_a.tool_boundary = ToolBoundary(forbidden_tools=["db_drop"])
    task = TaskProfile(
        task_id="t4",
        task_type="migration",
        required_tools=["db_drop"],
    )
    report = ProfileAnalyzer.compute_gap(profile_a, task)
    assert report.missing_tools == ["db_drop"]


def test_gap_analysis_blind_spot_risk(profile_a: CapabilityProfile) -> None:
    task = TaskProfile(
        task_id="t5",
        task_type="ui_redesign",
        forbidden_blind_spot_categories=[BlindSpotCategory.SPATIAL_REASONING],
    )
    report = ProfileAnalyzer.compute_gap(profile_a, task)
    assert len(report.blind_spot_risks) == 1
    cat, _ = report.blind_spot_risks[0]
    assert cat == BlindSpotCategory.SPATIAL_REASONING.value


def test_gap_analysis_context_window_insufficient(
    profile_a: CapabilityProfile,
) -> None:
    task = TaskProfile(
        task_id="t6",
        task_type="analysis",
        min_context_window=1000000,
    )
    report = ProfileAnalyzer.compute_gap(profile_a, task)
    assert report.context_window_insufficient is True


def test_gap_analysis_cognitive_style_mismatch(
    profile_a: CapabilityProfile,
) -> None:
    task = TaskProfile(
        task_id="t7",
        task_type="narrative_writing",
        preferred_cognitive_styles=["narrative"],
    )
    report = ProfileAnalyzer.compute_gap(profile_a, task)
    assert report.cognitive_style_mismatch is True


def test_gap_analysis_generates_recommendations(
    profile_a: CapabilityProfile,
) -> None:
    task = TaskProfile(
        task_id="t8",
        task_type="code_generation",
        required_skills=["writing"],
    )
    report = ProfileAnalyzer.compute_gap(profile_a, task)
    assert any("writing" in r for r in report.recommendations)


# ---- complementary pairing / recommend_pairing ----

def test_recommend_pairing_picks_cross_vendor_reviewer(
    profile_a: CapabilityProfile, profile_b: CapabilityProfile
) -> None:
    reviewer = ProfileAnalyzer.recommend_pairing(profile_a, [profile_b])
    assert reviewer is profile_b  # different vendor → structural separation


def test_recommend_pairing_none_when_no_cross_vendor(
    profile_a: CapabilityProfile,
) -> None:
    same_vendor = CapabilityProfile(
        profile_id="fk-same",
        agent_id="fk-same",
        model_capability=_MC_CODER,
        skill_packages=[
            SkillPackage(name="design", domain="design", proficiency=0.9),
        ],
    )
    reviewer = ProfileAnalyzer.recommend_pairing(profile_a, [same_vendor])
    assert reviewer is None


def test_recommend_pairing_prefers_non_overlapping_blind_spots() -> None:
    author = CapabilityProfile(
        profile_id="fk-a",
        agent_id="fk-a",
        model_capability=_MC_CODER,
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.MATH_COMPUTATION,
                description="weak at math",
            ),
        ],
    )
    overlapping = CapabilityProfile(
        profile_id="fk-overlap",
        agent_id="fk-overlap",
        model_capability=_MC_DESIGNER,
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.MATH_COMPUTATION,
                description="also weak at math",
            ),
        ],
    )
    non_overlapping = CapabilityProfile(
        profile_id="fk-clean",
        agent_id="fk-clean",
        model_capability=_MC_DESIGNER,
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.SPATIAL_REASONING,
                description="weak at spatial",
            ),
        ],
    )
    reviewer = ProfileAnalyzer.recommend_pairing(
        author, [overlapping, non_overlapping]
    )
    assert reviewer is non_overlapping


def test_detect_blind_spot_conflicts_finds_same_vendor_pairs() -> None:
    p1 = CapabilityProfile(
        profile_id="fk-1",
        agent_id="fk-1",
        model_capability=_MC_CODER,
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.MATH_COMPUTATION,
                description="weak at math",
            ),
        ],
    )
    p2 = CapabilityProfile(
        profile_id="fk-2",
        agent_id="fk-2",
        model_capability=_MC_CODER,  # same vendor as p1
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.MATH_COMPUTATION,
                description="also weak at math",
            ),
        ],
    )
    p3 = CapabilityProfile(
        profile_id="fk-3",
        agent_id="fk-3",
        model_capability=_MC_DESIGNER,  # different vendor
        blind_spots=[
            BlindSpot(
                category=BlindSpotCategory.MATH_COMPUTATION,
                description="weak at math",
            ),
        ],
    )
    conflicts = ProfileAnalyzer.detect_blind_spot_conflicts([p1, p2, p3])
    assert ("fk-1", "fk-2", "math_computation") in conflicts
    assert all(c[2] == "math_computation" for c in conflicts)
    # cross-vendor pair (fk-1, fk-3) is NOT a conflict
    assert ("fk-1", "fk-3", "math_computation") not in conflicts


# ---- serialization ----

def test_to_dict_round_trip(profile_a: CapabilityProfile) -> None:
    data = profile_a.to_dict()
    restored = CapabilityProfile.model_validate(data)
    assert restored.profile_id == profile_a.profile_id
    assert restored.agent_id == profile_a.agent_id
    assert restored.cognitive_style == profile_a.cognitive_style
    assert [sp.name for sp in restored.skill_packages] == ["coding"]
    assert restored.skill_packages[0].proficiency == pytest.approx(0.9)
    assert restored.blind_spots[0].category is BlindSpotCategory.SPATIAL_REASONING
    assert restored.created_at == profile_a.created_at


def test_to_dict_excludes_load_fn() -> None:
    from flowforge.core.capability import SkillPackage

    p = CapabilityProfile(
        profile_id="fk-x",
        agent_id="fk-x",
        model_capability=_MC_CODER,
        skill_packages=[
            SkillPackage(
                name="coding",
                domain="programming",
                proficiency=0.9,
                load_fn=lambda: None,
            ),
        ],
    )
    data = p.to_dict()
    assert "load_fn" not in data["skill_packages"][0]


def test_to_summary_includes_profile_id(profile_a: CapabilityProfile) -> None:
    summary = profile_a.to_summary()
    assert "fk-coder" in summary
    assert "anthropic" in summary


# ---- YAML round-trip ----

@pytest.mark.asyncio
async def test_yaml_round_trip(tmp_path: Path, profile_a: CapabilityProfile) -> None:
    loader = ProfileLoader()
    target = tmp_path / "profile_a.yaml"
    await loader.dump_to_yaml(profile_a, target)
    assert target.exists()
    restored = await loader.load_from_yaml(target)
    assert restored.profile_id == profile_a.profile_id
    assert restored.agent_id == profile_a.agent_id
    assert restored.cognitive_style == profile_a.cognitive_style
    assert [sp.name for sp in restored.skill_packages] == ["coding"]
    assert restored.skill_packages[0].proficiency == pytest.approx(0.9)
    assert len(restored.blind_spots) == 1
    assert restored.blind_spots[0].category is BlindSpotCategory.SPATIAL_REASONING


@pytest.mark.asyncio
async def test_yaml_round_trip_preserves_all_fields(
    tmp_path: Path, profile_b: CapabilityProfile
) -> None:
    loader = ProfileLoader()
    target = tmp_path / "profile_b.yaml"
    await loader.dump_to_yaml(profile_b, target)
    restored = await loader.load_from_yaml(target)
    assert restored.to_dict() == profile_b.to_dict()


@pytest.mark.asyncio
async def test_yaml_round_trip_with_explicit_schema(tmp_path: Path) -> None:
    """Load a YAML file matching the documented schema (ADR-004 / F001)."""
    loader = ProfileLoader()
    target = tmp_path / "schema.yaml"
    target.write_text(
        """
profile_id: fk-001
agent_id: fk-001
model_capability:
  provider: anthropic
  model_name: claude-sonnet-4
  context_window: 200000
  strengths: ["code_generation"]
  limitations: ["math_computation"]
cognitive_style:
  explanation_style: concise
  reasoning_depth: 0.9
  abstraction_level: 0.8
  risk_appetite: 0.3
skill_packages:
  - name: coding
    domain: programming
    proficiency: 0.85
blind_spots:
  - category: math_computation
    description: weak at math
""",
        encoding="utf-8",
    )
    profile = await loader.load_from_yaml(target)
    assert profile.profile_id == "fk-001"
    assert profile.model_capability.provider == "anthropic"
    assert profile.skill_packages[0].proficiency == pytest.approx(0.85)
    assert profile.blind_spots[0].category is BlindSpotCategory.MATH_COMPUTATION


@pytest.mark.asyncio
async def test_load_from_yaml_raises_on_missing_file(tmp_path: Path) -> None:
    loader = ProfileLoader()
    with pytest.raises(FileNotFoundError, match="not found"):
        await loader.load_from_yaml(tmp_path / "nope.yaml")


@pytest.mark.asyncio
async def test_load_from_yaml_raises_on_empty_file(tmp_path: Path) -> None:
    loader = ProfileLoader()
    target = tmp_path / "empty.yaml"
    target.write_text("", encoding="utf-8")
    with pytest.raises(ValueError, match="Empty YAML"):
        await loader.load_from_yaml(target)


@pytest.mark.asyncio
async def test_load_from_yaml_raises_missing_model_capability(
    tmp_path: Path,
) -> None:
    loader = ProfileLoader()
    target = tmp_path / "bad.yaml"
    target.write_text("profile_id: fk-x\nagent_id: fk-x\n", encoding="utf-8")
    with pytest.raises(ValueError, match="model_capability"):
        await loader.load_from_yaml(target)
