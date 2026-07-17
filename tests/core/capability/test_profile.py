"""CapabilityProfile 单元测试。

覆盖 F001 §5.1 单元测试要求 + task.md P1-1 验收标准：
    1. 测试 CapabilityProfile 创建
    2. 测试 has_blind_spot_conflict 同厂商盲点（应返回 True）
    3. 测试 has_blind_spot_conflict 不同厂商盲点（应返回 False）
    4. 测试 gap_analysis 任务画像匹配
    5. 测试 ProfileLoader YAML 加载

附加覆盖：
    - ProfileAnalyzer.detect_blind_spot_conflicts 批量冲突检测
    - ProfileAnalyzer.recommend_pairing 跨厂商配对
    - to_summary 摘要生成
    - prompts.yaml 外置模板加载（铁律 5+P16）

License: MIT
"""

from __future__ import annotations

from pathlib import Path

import pytest

from flowforge.core.capability import (
    AgentState,
    BlindSpot,
    BlindSpotCategory,
    CapabilityProfile,
    CognitiveStyle,
    GapReport,
    HarnessFitScore,
    ModelCapability,
    PerformanceLog,
    ProfileAnalyzer,
    ProfileLoader,
    SkillPackage,
    TaskProfile,
    ToolBoundary,
)


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


def _make_model_capability(
    provider: str = "anthropic",
    model_name: str = "claude-sonnet-4",
) -> ModelCapability:
    return ModelCapability(
        provider=provider,
        model_name=model_name,
        context_window=200000,
        strengths=["code_generation", "long_context_reasoning"],
        limitations=["math_computation"],
        supports_tool_call=True,
        supports_vision=False,
        reasoning_capability=0.92,
        creativity_capability=0.85,
    )


def _make_blind_spot(
    category: BlindSpotCategory = BlindSpotCategory.SELF_REFERENTIAL_LOGIC,
    description: str = "倾向信任自身生成的代码而不做对抗性验证",
) -> BlindSpot:
    return BlindSpot(
        category=category,
        description=description,
        example="review 自己刚生成的并发代码时，未发现 race condition",
        scenario="self_code_review",
        evidence=["trace-eval-001"],
        compensation_strategy="cross_vendor_review",
        confidence=0.85,
    )


def _make_profile(
    profile_id: str = "claude-code-001",
    agent_id: str = "claude-code-forgekin",
    provider: str = "anthropic",
    model_name: str = "claude-sonnet-4",
    blind_spot_categories: list[BlindSpotCategory] | None = None,
) -> CapabilityProfile:
    """构造测试用 CapabilityProfile。

    Args:
        profile_id: 画像 ID。
        agent_id: 灵智体 ID。
        provider: 厂商。
        model_name: 模型名。
        blind_spot_categories: 盲点类别列表（None 时使用默认 self_referential_logic）。
    """
    if blind_spot_categories is None:
        blind_spot_categories = [BlindSpotCategory.SELF_REFERENTIAL_LOGIC]
    blind_spots = [
        _make_blind_spot(category=cat) for cat in blind_spot_categories
    ]
    return CapabilityProfile(
        profile_id=profile_id,
        agent_id=agent_id,
        model_capability=_make_model_capability(provider, model_name),
        cognitive_style=CognitiveStyle(
            reasoning_depth=0.9,
            abstraction_level=0.8,
            risk_appetite=0.3,
            explanation_style="structured",
        ),
        blind_spots=blind_spots,
        skill_packages=[
            SkillPackage(
                name="python_async",
                domain="programming",
                version="1.0.0",
                proficiency=0.9,
            )
        ],
        tool_boundary=ToolBoundary(
            allowed_tools=["file_read", "file_write", "shell_exec"],
            forbidden_tools=["db_drop"],
            prefer_tools=["file_read"],
        ),
        historical_performance=[
            PerformanceLog(
                task_type="code_generation",
                success_rate=0.92,
                avg_latency=2.5,
                token_usage=15000,
                sample_count=100,
                wilson_lower_bound=0.88,
            )
        ],
        current_state=AgentState(
            current_load=0.3,
            fatigue=0.1,
            mood="focused",
            active_tasks=2,
        ),
        harness_fit_score=HarnessFitScore(
            overall=0.85,
            durable_state=0.9,
            tool_mediation=0.85,
            governance=0.8,
            retrieval=0.7,
            observability=0.9,
        ),
    )


@pytest.fixture
def claude_profile() -> CapabilityProfile:
    return _make_profile(
        profile_id="claude-code-001",
        agent_id="claude-code-forgekin",
        provider="anthropic",
        model_name="claude-sonnet-4",
    )


@pytest.fixture
def another_claude_profile() -> CapabilityProfile:
    """同厂商（anthropic）的另一个灵智体——共享 self_referential_logic 盲点。"""
    return _make_profile(
        profile_id="claude-reviewer-002",
        agent_id="claude-reviewer-forgekin",
        provider="anthropic",
        model_name="claude-opus-4",
    )


@pytest.fixture
def gpt5_profile() -> CapabilityProfile:
    """不同厂商（openai）的灵智体——同类别盲点但厂商不同。"""
    return _make_profile(
        profile_id="gpt5-researcher-001",
        agent_id="gpt5-researcher-forgekin",
        provider="openai",
        model_name="gpt-5",
    )


# ──────────────────────────────────────────────────────────────────────────────
# 测试 1: CapabilityProfile 创建
# ──────────────────────────────────────────────────────────────────────────────


def test_capability_profile_creation(claude_profile: CapabilityProfile) -> None:
    """测试 CapabilityProfile 可创建并包含六维度字段。"""
    profile = claude_profile

    # 基本字段
    assert profile.profile_id == "claude-code-001"
    assert profile.agent_id == "claude-code-forgekin"
    assert profile.created_at != ""
    assert profile.updated_at != ""

    # 六维度存在
    assert isinstance(profile.model_capability, ModelCapability)
    assert isinstance(profile.cognitive_style, CognitiveStyle)
    assert isinstance(profile.blind_spots, list)
    assert isinstance(profile.skill_packages, list)
    assert isinstance(profile.tool_boundary, ToolBoundary)
    assert isinstance(profile.historical_performance, list)
    assert isinstance(profile.current_state, AgentState)
    assert isinstance(profile.harness_fit_score, HarnessFitScore)

    # 模型能力内容
    assert profile.model_capability.provider == "anthropic"
    assert profile.model_capability.model_name == "claude-sonnet-4"
    assert profile.model_capability.context_window == 200000
    assert "code_generation" in profile.model_capability.strengths

    # 盲点必须写入（F001 AC-3 精神：画像不能为空盲点）
    assert len(profile.blind_spots) >= 1
    assert profile.blind_spots[0].category == BlindSpotCategory.SELF_REFERENTIAL_LOGIC

    # 序列化往返
    dumped = profile.model_dump(mode="json")
    assert dumped["profile_id"] == "claude-code-001"
    # load_fn 应被排除
    for sp in dumped["skill_packages"]:
        assert "load_fn" not in sp


# ──────────────────────────────────────────────────────────────────────────────
# 测试 2: has_blind_spot_conflict 同厂商盲点（应返回 True）
# ──────────────────────────────────────────────────────────────────────────────


def test_blind_spot_conflict_same_vendor_returns_true(
    claude_profile: CapabilityProfile,
    another_claude_profile: CapabilityProfile,
) -> None:
    """同厂商（anthropic）+ 同类别盲点（self_referential_logic）→ True。

    ADR 004 §5：Claude review Claude 漏掉同一类错误，必须跨厂商 review。
    """
    # 两者都是 anthropic 厂商，都有 self_referential_logic 盲点
    assert (
        claude_profile.model_capability.provider
        == another_claude_profile.model_capability.provider
        == "anthropic"
    )

    # 同类别盲点存在
    claude_cats = {bs.category for bs in claude_profile.blind_spots}
    other_cats = {bs.category for bs in another_claude_profile.blind_spots}
    assert claude_cats & other_cats  # 类别有重叠

    # 冲突应为 True（需要跨厂商 review 补偿）
    assert claude_profile.has_blind_spot_conflict(another_claude_profile) is True
    assert another_claude_profile.has_blind_spot_conflict(claude_profile) is True


# ──────────────────────────────────────────────────────────────────────────────
# 测试 3: has_blind_spot_conflict 不同厂商盲点（应返回 False）
# ──────────────────────────────────────────────────────────────────────────────


def test_blind_spot_conflict_different_vendor_returns_false(
    claude_profile: CapabilityProfile,
    gpt5_profile: CapabilityProfile,
) -> None:
    """不同厂商（anthropic vs openai）+ 同类别盲点 → False。

    roleagent.md §0：不同厂商训练分布偏差已天然分散，无需强制跨厂商 review。
    """
    # 厂商不同
    assert (
        claude_profile.model_capability.provider
        != gpt5_profile.model_capability.provider
    )

    # 但盲点类别相同（都是 self_referential_logic）
    claude_cats = {bs.category for bs in claude_profile.blind_spots}
    gpt5_cats = {bs.category for bs in gpt5_profile.blind_spots}
    assert claude_cats & gpt5_cats  # 类别有重叠

    # 不同厂商 → 无冲突（不需跨厂商 review，已天然分散）
    assert claude_profile.has_blind_spot_conflict(gpt5_profile) is False
    assert gpt5_profile.has_blind_spot_conflict(claude_profile) is False


def test_blind_spot_conflict_same_vendor_different_category_returns_false() -> None:
    """同厂商但不同类别盲点 → False（盲点类别不重叠）。"""
    profile_a = _make_profile(
        profile_id="a",
        agent_id="a-forgekin",
        blind_spot_categories=[BlindSpotCategory.SELF_REFERENTIAL_LOGIC],
    )
    profile_b = _make_profile(
        profile_id="b",
        agent_id="b-forgekin",
        blind_spot_categories=[BlindSpotCategory.MATH_COMPUTATION],
    )
    # 同厂商
    assert (
        profile_a.model_capability.provider
        == profile_b.model_capability.provider
    )
    # 不同盲点类别 → 无冲突
    assert profile_a.has_blind_spot_conflict(profile_b) is False


# ──────────────────────────────────────────────────────────────────────────────
# 测试 4: gap_analysis 任务画像匹配
# ──────────────────────────────────────────────────────────────────────────────


def test_gap_analysis_task_profile_matching(claude_profile: CapabilityProfile) -> None:
    """测试 gap_analysis 任务画像 × 能力画像 gap 分析。"""
    # 构造一个有缺失技能 + 缺失工具 + 盲点风险的任务画像
    task = TaskProfile(
        task_id="task-001",
        task_type="code_generation",
        required_skills=["python_async", "rust_ffi"],  # rust_ffi 未加载
        required_tools=["file_read", "debugger"],  # debugger 未授权
        forbidden_blind_spot_categories=[
            BlindSpotCategory.SELF_REFERENTIAL_LOGIC
        ],  # 与灵智体盲点重叠
        preferred_cognitive_styles=["structured"],
        min_context_window=100000,  # 灵智体 200000 够用
    )

    report = claude_profile.gap_analysis(task)

    # 返回 GapReport
    assert isinstance(report, GapReport)

    # 缺失技能检测正确
    assert "rust_ffi" in report.missing_skills
    assert "python_async" not in report.missing_skills

    # 缺失工具检测正确
    assert "debugger" in report.missing_tools
    assert "file_read" not in report.missing_tools

    # 盲点风险检测正确（self_referential_logic 是任务禁忌）
    assert len(report.blind_spot_risks) == 1
    risk_category, risk_desc = report.blind_spot_risks[0]
    assert risk_category == "self_referential_logic"
    assert "对抗性验证" in risk_desc or "race" in risk_desc or risk_desc != ""

    # 上下文窗口够用 → False
    assert report.context_window_insufficient is False

    # 认知风格匹配（structured in preferred）
    assert report.cognitive_style_mismatch is False

    # 存在关键 gap
    assert report.has_critical_gap is True

    # 推荐文案非空（至少包含缺失技能 + 缺失工具 + 盲点风险 3 条）
    assert len(report.recommendations) >= 3


def test_gap_analysis_context_window_insufficient() -> None:
    """测试 gap_analysis 上下文窗口不足检测。"""
    profile = _make_profile()
    # 缩小上下文窗口
    profile.model_capability.context_window = 50000
    task = TaskProfile(
        task_id="task-002",
        task_type="long_document_writing",
        required_skills=[],
        required_tools=[],
        forbidden_blind_spot_categories=[],
        preferred_cognitive_styles=[],
        min_context_window=100000,
    )
    report = profile.gap_analysis(task)
    assert report.context_window_insufficient is True
    assert report.has_critical_gap is True


def test_gap_analysis_cognitive_style_mismatch() -> None:
    """测试 gap_analysis 认知风格不匹配检测。"""
    profile = _make_profile()
    # 灵智体风格是 structured，任务期望 narrative/concise
    task = TaskProfile(
        task_id="task-003",
        task_type="creative_writing",
        required_skills=[],
        required_tools=[],
        forbidden_blind_spot_categories=[],
        preferred_cognitive_styles=["narrative", "concise"],
    )
    report = profile.gap_analysis(task)
    assert report.cognitive_style_mismatch is True


def test_gap_analysis_no_gap_when_fully_matched() -> None:
    """测试完全匹配时无 gap。"""
    profile = _make_profile()
    task = TaskProfile(
        task_id="task-004",
        task_type="code_generation",
        required_skills=["python_async"],
        required_tools=["file_read"],
        forbidden_blind_spot_categories=[],  # 不禁忌灵智体的盲点
        preferred_cognitive_styles=["structured"],
        min_context_window=100000,
    )
    report = profile.gap_analysis(task)
    assert report.missing_skills == []
    assert report.missing_tools == []
    assert report.blind_spot_risks == []
    assert report.context_window_insufficient is False
    assert report.cognitive_style_mismatch is False
    assert report.has_critical_gap is False


# ──────────────────────────────────────────────────────────────────────────────
# 测试 5: ProfileLoader YAML 加载
# ──────────────────────────────────────────────────────────────────────────────


def _get_profiles_dir() -> Path:
    """获取示例 Profile YAML 目录路径。

    使用相对源码路径定位，避免硬编码绝对路径（铁律 5）。
    """
    # tests/core/capability/test_profile.py → flowforge/core/capability/config/profiles
    # __file__ 是测试文件路径，向上找到 flowforge 根目录
    test_file = Path(__file__).resolve()
    # tests/core/capability/ → 向上 3 级到 flowforge/
    flowforge_root = test_file.parents[3]
    return flowforge_root / "core" / "capability" / "config" / "profiles"


def _get_prompts_path() -> Path:
    """获取 prompts.yaml 路径（铁律 5+P16：外置提示词）。"""
    test_file = Path(__file__).resolve()
    flowforge_root = test_file.parents[3]
    return flowforge_root / "core" / "capability" / "config" / "prompts.yaml"


@pytest.mark.asyncio
async def test_profile_loader_load_single_yaml() -> None:
    """测试 ProfileLoader 加载单个 YAML 文件。"""
    profiles_dir = _get_profiles_dir()
    claude_yaml = profiles_dir / "claude_code_profile.yaml"

    loader = ProfileLoader()
    profile = await loader.load_from_yaml(claude_yaml)

    # 验证字段解析正确
    assert profile.profile_id == "claude-code-001"
    assert profile.agent_id == "claude-code-forgekin"
    assert profile.model_capability.provider == "anthropic"
    assert profile.model_capability.model_name == "claude-sonnet-4"
    assert profile.model_capability.context_window == 200000

    # 盲点解析
    assert len(profile.blind_spots) == 2
    assert profile.blind_spots[0].category == BlindSpotCategory.SELF_REFERENTIAL_LOGIC
    assert profile.blind_spots[1].category == BlindSpotCategory.OVER_CONFIDENCE

    # 知识包解析
    assert len(profile.skill_packages) == 2
    assert profile.skill_packages[0].name == "python_async"
    assert profile.skill_packages[0].domain == "programming"

    # 工具边界解析
    assert "file_read" in profile.tool_boundary.allowed_tools
    assert "db_drop" in profile.tool_boundary.forbidden_tools

    # 历史表现解析
    assert len(profile.historical_performance) == 2
    assert profile.historical_performance[0].task_type == "code_generation"

    # Harness 契合度解析
    assert profile.harness_fit_score.overall == 0.85


@pytest.mark.asyncio
async def test_profile_loader_load_all_profiles() -> None:
    """测试 ProfileLoader 批量加载所有 Profile YAML。"""
    profiles_dir = _get_profiles_dir()
    loader = ProfileLoader()
    profiles = await loader.load_all(profiles_dir)

    # 应加载 2 个 profile
    assert len(profiles) == 2
    assert "claude-code-001" in profiles
    assert "gpt5-researcher-001" in profiles

    claude = profiles["claude-code-001"]
    gpt5 = profiles["gpt5-researcher-001"]

    # 验证厂商不同
    assert claude.model_capability.provider == "anthropic"
    assert gpt5.model_capability.provider == "openai"

    # 验证盲点冲突逻辑（核心跨厂商 review 演示）
    # 同类别盲点 self_referential_logic，但厂商不同 → 无冲突
    assert claude.has_blind_spot_conflict(gpt5) is False
    assert gpt5.has_blind_spot_conflict(claude) is False


@pytest.mark.asyncio
async def test_profile_loader_file_not_found() -> None:
    """测试加载不存在的文件应抛 FileNotFoundError。"""
    loader = ProfileLoader()
    with pytest.raises(FileNotFoundError):
        await loader.load_from_yaml("/nonexistent/profile.yaml")


@pytest.mark.asyncio
async def test_profile_loader_invalid_yaml(tmp_path: Path) -> None:
    """测试加载无效 YAML 应抛 ValueError。"""
    invalid_yaml = tmp_path / "invalid.yaml"
    invalid_yaml.write_text(":\n  - this is not valid: [", encoding="utf-8")
    loader = ProfileLoader()
    with pytest.raises((ValueError, Exception)):
        await loader.load_from_yaml(invalid_yaml)


# ──────────────────────────────────────────────────────────────────────────────
# 附加测试: ProfileAnalyzer 静态方法 + prompts.yaml 外置模板
# ──────────────────────────────────────────────────────────────────────────────


def test_profile_analyzer_detect_blind_spot_conflicts(
    claude_profile: CapabilityProfile,
    another_claude_profile: CapabilityProfile,
    gpt5_profile: CapabilityProfile,
) -> None:
    """测试 ProfileAnalyzer.detect_blind_spot_conflicts 批量冲突检测。"""
    candidates = [claude_profile, another_claude_profile, gpt5_profile]
    conflicts = ProfileAnalyzer.detect_blind_spot_conflicts(candidates)

    # claude vs another_claude 同厂商同类别 → 冲突
    # claude vs gpt5 不同厂商 → 无冲突
    # another_claude vs gpt5 不同厂商 → 无冲突
    assert len(conflicts) >= 1
    # 检查冲突中包含 claude-code-001 vs claude-reviewer-002
    conflict_pairs = {(c[0], c[1]) for c in conflicts}
    assert (
        "claude-code-001",
        "claude-reviewer-002",
    ) in conflict_pairs or (
        "claude-reviewer-002",
        "claude-code-001",
    ) in conflict_pairs
    # 冲突类别应为 self_referential_logic
    assert any(c[2] == "self_referential_logic" for c in conflicts)


def test_profile_analyzer_recommend_pairing(
    claude_profile: CapabilityProfile,
    another_claude_profile: CapabilityProfile,
    gpt5_profile: CapabilityProfile,
) -> None:
    """测试 ProfileAnalyzer.recommend_pairing 跨厂商 reviewer 推荐。"""
    # 作者为 claude，候选为另一个 claude + gpt5
    # 应优先推荐 gpt5（跨厂商）
    candidates = [another_claude_profile, gpt5_profile]
    reviewer = ProfileAnalyzer.recommend_pairing(claude_profile, candidates)

    assert reviewer is not None
    assert reviewer.model_capability.provider != "anthropic"
    assert reviewer.profile_id == "gpt5-researcher-001"


def test_profile_analyzer_recommend_pairing_no_cross_vendor(
    claude_profile: CapabilityProfile,
    another_claude_profile: CapabilityProfile,
) -> None:
    """测试无跨厂商候选时返回 None。"""
    candidates = [another_claude_profile]  # 同厂商
    reviewer = ProfileAnalyzer.recommend_pairing(claude_profile, candidates)
    assert reviewer is None


def test_to_summary(claude_profile: CapabilityProfile) -> None:
    """测试 to_summary 人类可读摘要生成。"""
    summary = claude_profile.to_summary()
    assert isinstance(summary, str)
    assert "claude-code-001" in summary
    assert "claude-code-forgekin" in summary
    assert "anthropic" in summary
    assert "claude-sonnet-4" in summary
    assert "self_referential_logic" in summary


def test_get_performance_and_has_skill(claude_profile: CapabilityProfile) -> None:
    """测试 get_performance / has_skill 查询方法。"""
    # 历史表现查询
    perf = claude_profile.get_performance("code_generation")
    assert perf is not None
    assert perf.success_rate == 0.92

    perf_missing = claude_profile.get_performance("nonexistent_task")
    assert perf_missing is None

    # 知识包查询
    assert claude_profile.has_skill("python_async") is True
    assert claude_profile.has_skill("rust_ffi") is False


def test_gap_analysis_with_external_prompts_yaml(
    claude_profile: CapabilityProfile,
) -> None:
    """测试 gap_analysis 使用外置 prompts.yaml 模板（铁律 5+P16）。"""
    prompts_path = _get_prompts_path()
    assert prompts_path.exists(), f"prompts.yaml not found at {prompts_path}"

    task = TaskProfile(
        task_id="task-005",
        task_type="code_generation",
        required_skills=["missing_skill_xyz"],
        required_tools=["missing_tool_xyz"],
        forbidden_blind_spot_categories=[],
        preferred_cognitive_styles=[],
    )
    report = ProfileAnalyzer.compute_gap(
        claude_profile, task, prompts_path=prompts_path
    )

    # 推荐文案应包含外置模板内容
    assert any("建议加载技能包" in r for r in report.recommendations)
    assert any("建议授权工具" in r for r in report.recommendations)


# ──────────────────────────────────────────────────────────────────────────────
# 附加测试: dump_to_yaml 序列化往返
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_profile_loader_dump_and_reload_roundtrip(
    claude_profile: CapabilityProfile,
    tmp_path: Path,
) -> None:
    """测试 dump_to_yaml + load_from_yaml 序列化往返。"""
    out_path = tmp_path / "roundtrip.yaml"
    loader = ProfileLoader()

    await loader.dump_to_yaml(claude_profile, out_path)
    assert out_path.exists()

    reloaded = await loader.load_from_yaml(out_path)
    assert reloaded.profile_id == claude_profile.profile_id
    assert reloaded.agent_id == claude_profile.agent_id
    assert (
        reloaded.model_capability.provider
        == claude_profile.model_capability.provider
    )
    assert (
        reloaded.model_capability.context_window
        == claude_profile.model_capability.context_window
    )
    assert len(reloaded.blind_spots) == len(claude_profile.blind_spots)
    assert (
        reloaded.blind_spots[0].category == claude_profile.blind_spots[0].category
    )
