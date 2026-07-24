"""P3-009 Skill 沉淀与共享 — 单元测试.

覆盖范围：
- Skill 数据模型字段默认值与校验（maturity / confidence / name）
- SkillInvocation 数据模型字段
- SkillLibrary 初始化与持久化
- register_skill / update_skill / unregister_skill / get_skill
- list_skills 多维过滤（species / tags / maturity_min）
- search_skills 关键词搜索
- match_skills trigger 匹配 + 前置条件 + 排序
- invoke_skill + record_invocation_result 调用记录与统计更新
- evolve_skill 进化（procedure / anti_patterns / confidence / maturity）
- export_skill / import_skill 往返
- get_skill_statistics / get_library_status
- SkillMarket publish / browse / install / rate / get_market_status
- metrics_collector 集成
- event_bus 集成

测试铁律遵守说明：
- T1 禁止 Mock LLM：本测试不涉及 LLM 调用，SkillLibrary 仅记录元数据
  而不执行业务逻辑（设计契约），故无需 Mock LLM
- T2 禁止假数据：使用真实场景技能名（"代码审查"/"文档生成"/"性能分析"
  /"测试用例生成"/"API 设计"），不用 "test"/"hello" 等
- T3 必须有具体断言：每个测试用例均有明确断言
- T5 未实现即 Bug：覆盖 SkillLibrary/SkillMarket 所有公开接口
- T6 必须采集指标：通过 _FakeMetricsCollector 验证指标上报
- 文件系统隔离：所有测试使用 tmp_path fixture
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

import pytest
import yaml

from flowforge.core.skill_library import (
    Skill,
    SkillInvocation,
    SkillLibrary,
    SkillMarket,
    _check_precondition,
    _match_trigger_pattern,
    _parse_semver,
)


# ══════════════════════════════════════════════════════════════════
# §1 测试辅助 — Stub 工具类（非 Mock LLM）
# ══════════════════════════════════════════════════════════════════


class _FakeMetricsCollector:
    """Stub 指标采集器，记录所有调用供断言.

    实现 MetricsCollector 的 inc_counter / observe_histogram / set_gauge 接口。
    非 Mock LLM（T1）：本测试不涉及 LLM，仅记录指标调用。
    """

    def __init__(self) -> None:
        self.counters: list[tuple[str, float, dict | None]] = []
        self.histograms: list[tuple[str, float, dict | None]] = []
        self.gauges: list[tuple[str, float, dict | None]] = []

    def inc_counter(
        self, name: str, value: float = 1.0, labels: dict | None = None
    ) -> None:
        self.counters.append((name, value, labels))

    def observe_histogram(
        self, name: str, value: float, labels: dict | None = None,
        buckets: list[float] | None = None,
    ) -> None:
        self.histograms.append((name, value, labels))

    def set_gauge(
        self, name: str, value: float, labels: dict | None = None
    ) -> None:
        self.gauges.append((name, value, labels))


class _FakeEventBus:
    """Stub 事件总线，记录所有 emit 调用供断言."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def emit(self, task_id: str, event_type: str, payload: dict) -> None:
        self.events.append({
            "task_id": task_id,
            "type": event_type,
            "payload": payload,
        })


# ══════════════════════════════════════════════════════════════════
# §2 fixtures
# ══════════════════════════════════════════════════════════════════


@pytest.fixture
def storage_dir(tmp_path: Path) -> Path:
    """每个测试独立的技能存储目录（文件系统隔离）."""
    return tmp_path / "skills"


@pytest.fixture
def market_dir(tmp_path: Path) -> Path:
    """每个测试独立的市场目录."""
    return tmp_path / "market"


@pytest.fixture
def metrics() -> _FakeMetricsCollector:
    return _FakeMetricsCollector()


@pytest.fixture
def event_bus() -> _FakeEventBus:
    return _FakeEventBus()


@pytest.fixture
def library(
    storage_dir: Path,
    metrics: _FakeMetricsCollector,
    event_bus: _FakeEventBus,
) -> SkillLibrary:
    """构造一个干净的 SkillLibrary（已注入 metrics 与 event_bus）."""
    return SkillLibrary(
        storage_dir=storage_dir,
        metrics_collector=metrics,
        event_bus=event_bus,
    )


@pytest.fixture
def market(library: SkillLibrary, market_dir: Path) -> SkillMarket:
    return SkillMarket(library=library, market_dir=market_dir)


@pytest.fixture
def code_review_skill() -> Skill:
    """真实场景技能：代码审查.

    注意：trigger_patterns 不使用 ``\\b`` 边界——Python regex 的 ``\\b`` 对
    CJK 字符无效（CJK 在默认 regex 中被视为非单词字符，因此 ``\\b代码审查\\b``
    无法匹配 "请进行代码审查"）。改用纯子串或显式 alternation。
    """
    return Skill(
        name="代码审查",
        description="对代码差异进行结构化审查，覆盖正确性/安全性/可读性/最佳实践四维度",
        forgekin_species="luban",
        version="1.2.0",
        maturity_level=3,
        trigger_patterns=[r"代码审查", r"code\s*review"],
        procedure="读取 diff → 路由到语言审查器 → 生成 findings → 汇总",
        preconditions=["diff=provided"],
        postconditions=["findings_count >= 1"],
        anti_patterns=["只看退出码不检查输出质量"],
        inputs=["diff", "repo_root"],
        outputs=["findings", "summary"],
        confidence=0.82,
        created_by="forgemind:luban_001",
        tags=["code-review", "quality"],
        is_public=True,
    )


@pytest.fixture
def doc_gen_skill() -> Skill:
    """真实场景技能：技术文档生成."""
    return Skill(
        name="技术文档生成",
        description="基于代码签名生成 API 参考文档与示例",
        forgekin_species="luban",
        version="1.0.0",
        maturity_level=2,
        trigger_patterns=["生成.*文档", r"\bAPI 文档\b"],
        procedure="扫描 docstring → 组织骨架 → 补充示例 → 输出 Markdown",
        preconditions=["source_dir"],
        inputs=["source_dir", "output_format"],
        outputs=["markdown", "toc"],
        confidence=0.7,
        created_by="forgemind:luban_001",
        tags=["documentation", "markdown"],
        is_public=True,
    )


@pytest.fixture
def perf_analysis_skill() -> Skill:
    """真实场景技能：性能瓶颈分析."""
    return Skill(
        name="性能瓶颈分析",
        description="通过采样 profile 数据定位热点函数并给出优化建议",
        forgekin_species="sherlock",
        version="0.9.0",
        maturity_level=1,
        trigger_patterns=["性能.*分析", "profile"],
        procedure="加载 profile → 火焰图 → top-N 热点 → 优化建议",
        preconditions=["profile_data"],
        anti_patterns=["未实际采样即给出猜测"],
        inputs=["profile_data", "top_n"],
        outputs=["hotspots", "suggestions"],
        confidence=0.6,
        created_by="forgemind:sherlock_002",
        tags=["performance", "profiling"],
        is_public=True,
    )


# ══════════════════════════════════════════════════════════════════
# §3 Skill 模型测试
# ══════════════════════════════════════════════════════════════════


class TestSkillModel:
    """Skill 数据模型字段与校验."""

    def test_skill_default_values(self) -> None:
        """默认值: version=1.0.0, maturity=1, confidence=0.5, is_public=True."""
        skill = Skill(name="测试用例生成")
        assert skill.version == "1.0.0"
        assert skill.maturity_level == 1
        assert skill.confidence == 0.5
        assert skill.is_public is True
        assert skill.usage_count == 0
        assert skill.success_count == 0
        assert skill.failure_count == 0
        assert skill.tags == []
        assert skill.trigger_patterns == []
        assert skill.metadata == {}
        assert skill.forgekin_species == ""

    def test_skill_auto_generates_skill_id(self) -> None:
        """未提供 skill_id 时自动生成（uuid4 前缀）."""
        skill1 = Skill(name="代码审查")
        skill2 = Skill(name="代码审查")
        assert skill1.skill_id.startswith("skill_")
        assert skill2.skill_id.startswith("skill_")
        assert skill1.skill_id != skill2.skill_id  # 唯一性

    def test_skill_auto_generates_timestamps(self) -> None:
        """created_at / updated_at 自动生成为 ISO 8601."""
        skill = Skill(name="文档生成")
        assert skill.created_at
        assert skill.updated_at
        # 验证 ISO 8601 格式
        assert "T" in skill.created_at
        assert "T" in skill.updated_at

    def test_skill_maturity_validation_valid(self) -> None:
        """maturity_level 在 1-5 范围内合法."""
        for v in (1, 2, 3, 4, 5):
            skill = Skill(name="API 设计", maturity_level=v)
            assert skill.maturity_level == v

    def test_skill_maturity_validation_invalid_low(self) -> None:
        """maturity_level < 1 抛出 ValidationError."""
        with pytest.raises(Exception):
            Skill(name="API 设计", maturity_level=0)

    def test_skill_maturity_validation_invalid_high(self) -> None:
        """maturity_level > 5 抛出 ValidationError."""
        with pytest.raises(Exception):
            Skill(name="API 设计", maturity_level=6)

    def test_skill_confidence_validation_valid(self) -> None:
        """confidence 在 0.0-1.0 范围内合法."""
        for v in (0.0, 0.5, 1.0):
            skill = Skill(name="测试用例生成", confidence=v)
            assert skill.confidence == v

    def test_skill_confidence_validation_invalid_negative(self) -> None:
        """confidence < 0 抛出 ValidationError."""
        with pytest.raises(Exception):
            Skill(name="测试用例生成", confidence=-0.1)

    def test_skill_confidence_validation_invalid_over_one(self) -> None:
        """confidence > 1.0 抛出 ValidationError."""
        with pytest.raises(Exception):
            Skill(name="测试用例生成", confidence=1.5)

    def test_skill_name_must_not_be_empty(self) -> None:
        """name 为空抛出 ValidationError."""
        with pytest.raises(Exception):
            Skill(name="")

    def test_skill_name_strips_whitespace(self) -> None:
        """name 自动 strip 空白."""
        skill = Skill(name="  代码审查  ")
        assert skill.name == "代码审查"

    def test_skill_default_collections_independent(self) -> None:
        """两个 Skill 实例的可变默认字段互不影响（pydantic v2 default_factory）."""
        s1 = Skill(name="代码审查")
        s2 = Skill(name="文档生成")
        s1.tags.append("quality")
        s1.trigger_patterns.append("foo")
        s1.metadata["k"] = "v"
        assert s2.tags == []
        assert s2.trigger_patterns == []
        assert s2.metadata == {}

    def test_skill_success_rate_zero_when_no_usage(self) -> None:
        """无使用记录时 success_rate 返回 0.0."""
        skill = Skill(name="性能分析")
        assert skill.success_rate() == 0.0

    def test_skill_success_rate_computed(self) -> None:
        """success_rate = success_count / usage_count."""
        skill = Skill(name="代码审查", usage_count=10, success_count=8)
        assert skill.success_rate() == pytest.approx(0.8)


# ══════════════════════════════════════════════════════════════════
# §4 SkillInvocation 模型测试
# ══════════════════════════════════════════════════════════════════


class TestSkillInvocationModel:
    """SkillInvocation 数据模型."""

    def test_invocation_default_values(self) -> None:
        """默认值: success=False, duration_seconds=0.0, error/feedback 空串."""
        inv = SkillInvocation(skill_id="skill_x", invoked_by="forgemind:luban_001")
        assert inv.success is False
        assert inv.duration_seconds == 0.0
        assert inv.error == ""
        assert inv.feedback == ""
        assert inv.inputs == {}
        assert inv.outputs == {}

    def test_invocation_auto_generates_id(self) -> None:
        """invocation_id 自动生成（inv_ 前缀）."""
        inv1 = SkillInvocation(skill_id="skill_x", invoked_by="forgemind:luban_001")
        inv2 = SkillInvocation(skill_id="skill_x", invoked_by="forgemind:luban_001")
        assert inv1.invocation_id.startswith("inv_")
        assert inv2.invocation_id.startswith("inv_")
        assert inv1.invocation_id != inv2.invocation_id

    def test_invocation_auto_generates_timestamp(self) -> None:
        """invoked_at 自动生成为 ISO 8601."""
        inv = SkillInvocation(skill_id="skill_x", invoked_by="forgemind:luban_001")
        assert "T" in inv.invoked_at


# ══════════════════════════════════════════════════════════════════
# §5 SkillLibrary 初始化与注册
# ══════════════════════════════════════════════════════════════════


class TestSkillLibraryInit:
    """SkillLibrary 初始化."""

    def test_init_creates_storage_dir(self, tmp_path: Path) -> None:
        """初始化时自动创建 storage_dir."""
        storage = tmp_path / "new_skills_dir"
        assert not storage.exists()
        SkillLibrary(storage_dir=storage)
        assert storage.exists()

    def test_init_loads_existing_skills(self, tmp_path: Path) -> None:
        """初始化时加载 storage_dir 下已有技能 YAML."""
        storage = tmp_path / "skills"
        storage.mkdir()
        # 预先写一个技能 YAML
        skill_data = {
            "skill_id": "skill_loaded_existing",
            "name": "代码审查",
            "forgekin_species": "luban",
            "confidence": 0.8,
        }
        with open(storage / "skill_loaded_existing.yaml", "w", encoding="utf-8") as f:
            yaml.safe_dump(skill_data, f, allow_unicode=True)
        # 重新初始化应加载
        lib = SkillLibrary(storage_dir=storage)
        loaded = asyncio.run(lib.get_skill("skill_loaded_existing"))
        assert loaded is not None
        assert loaded.name == "代码审查"


class TestSkillLibraryRegister:
    """SkillLibrary 注册/更新/注销."""

    async def test_register_returns_skill_id(self, library: SkillLibrary, code_review_skill: Skill) -> None:
        """register_skill 返回 skill_id."""
        sid = await library.register_skill(code_review_skill)
        assert sid == code_review_skill.skill_id

    async def test_register_persists_yaml_file(self, library: SkillLibrary, code_review_skill: Skill, storage_dir: Path) -> None:
        """register_skill 持久化 YAML 文件."""
        sid = await library.register_skill(code_review_skill)
        yaml_file = storage_dir / f"{sid}.yaml"
        assert yaml_file.exists()
        # 文件内容应为合法 YAML 且可还原
        with open(yaml_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["name"] == "代码审查"
        assert data["forgekin_species"] == "luban"

    async def test_register_assigns_new_id_on_conflict(self, library: SkillLibrary, code_review_skill: Skill) -> None:
        """ID 冲突时自动生成新 ID（不覆盖既有技能）."""
        original_id = code_review_skill.skill_id
        await library.register_skill(code_review_skill)
        # 再次注册同一对象应生成新 ID
        dup = Skill(**code_review_skill.model_dump())  # 复制一份
        dup.skill_id = original_id
        new_id = await library.register_skill(dup)
        assert new_id != original_id
        # 原技能仍存在
        orig = await library.get_skill(original_id)
        assert orig is not None

    async def test_update_skill_modifies_fields(self, library: SkillLibrary, code_review_skill: Skill) -> None:
        """update_skill 修改字段并持久化."""
        sid = await library.register_skill(code_review_skill)
        updated = await library.update_skill(sid, {
            "confidence": 0.9,
            "description": "更新后的描述",
        })
        assert updated.confidence == 0.9
        assert updated.description == "更新后的描述"
        # 内存与磁盘都应同步
        loaded = await library.get_skill(sid)
        assert loaded is not None
        assert loaded.confidence == 0.9

    async def test_update_skill_unknown_raises(self, library: SkillLibrary) -> None:
        """update_skill 不存在的技能抛出 KeyError."""
        with pytest.raises(KeyError):
            await library.update_skill("skill_unknown", {"confidence": 0.5})

    async def test_update_skill_does_not_change_skill_id(self, library: SkillLibrary, code_review_skill: Skill) -> None:
        """update_skill 不能修改 skill_id."""
        sid = await library.register_skill(code_review_skill)
        updated = await library.update_skill(sid, {"skill_id": "skill_hacker"})
        assert updated.skill_id == sid  # 未改变

    async def test_unregister_skill_removes_record(self, library: SkillLibrary, code_review_skill: Skill, storage_dir: Path) -> None:
        """unregister_skill 删除内存与磁盘记录."""
        sid = await library.register_skill(code_review_skill)
        assert (storage_dir / f"{sid}.yaml").exists()
        ok = await library.unregister_skill(sid)
        assert ok is True
        # 内存中已删除
        assert await library.get_skill(sid) is None
        # 磁盘文件已删除
        assert not (storage_dir / f"{sid}.yaml").exists()

    async def test_unregister_skill_unknown_returns_false(self, library: SkillLibrary) -> None:
        """unregister_skill 不存在时返回 False."""
        ok = await library.unregister_skill("skill_unknown")
        assert ok is False


# ══════════════════════════════════════════════════════════════════
# §6 SkillLibrary 检索
# ══════════════════════════════════════════════════════════════════


class TestSkillLibraryLookup:
    """SkillLibrary 检索与过滤."""

    async def test_get_skill_returns_none_for_unknown(self, library: SkillLibrary) -> None:
        """get_skill 不存在时返回 None."""
        assert await library.get_skill("skill_unknown") is None

    async def test_list_skills_no_filter(
        self, library: SkillLibrary, code_review_skill: Skill, doc_gen_skill: Skill, perf_analysis_skill: Skill
    ) -> None:
        """list_skills 无过滤返回所有技能."""
        await library.register_skill(code_review_skill)
        await library.register_skill(doc_gen_skill)
        await library.register_skill(perf_analysis_skill)
        result = await library.list_skills()
        assert len(result) == 3

    async def test_list_skills_filter_by_species(
        self, library: SkillLibrary, code_review_skill: Skill, doc_gen_skill: Skill, perf_analysis_skill: Skill
    ) -> None:
        """list_skills 按 forgekin_species 过滤."""
        await library.register_skill(code_review_skill)  # luban
        await library.register_skill(doc_gen_skill)        # luban
        await library.register_skill(perf_analysis_skill)  # sherlock
        result = await library.list_skills(forgekin_species="luban")
        assert len(result) == 2
        assert all(s.forgekin_species == "luban" for s in result)

    async def test_list_skills_filter_by_tags(
        self, library: SkillLibrary, code_review_skill: Skill, doc_gen_skill: Skill
    ) -> None:
        """list_skills 按 tags 过滤（任一标签匹配）."""
        await library.register_skill(code_review_skill)  # tags: [code-review, quality]
        await library.register_skill(doc_gen_skill)       # tags: [documentation, markdown]
        result = await library.list_skills(tags=["quality"])
        assert len(result) == 1
        assert result[0].name == "代码审查"
        # 多标签 OR 匹配
        result = await library.list_skills(tags=["code-review", "markdown"])
        assert len(result) == 2

    async def test_list_skills_filter_by_maturity_min(
        self, library: SkillLibrary, code_review_skill: Skill, doc_gen_skill: Skill, perf_analysis_skill: Skill
    ) -> None:
        """list_skills 按 maturity_min 过滤."""
        await library.register_skill(code_review_skill)  # maturity=3
        await library.register_skill(doc_gen_skill)        # maturity=2
        await library.register_skill(perf_analysis_skill)  # maturity=1
        result = await library.list_skills(maturity_min=2)
        assert len(result) == 2
        assert all(s.maturity_level >= 2 for s in result)

    async def test_search_skills_by_name(
        self, library: SkillLibrary, code_review_skill: Skill, doc_gen_skill: Skill
    ) -> None:
        """search_skills 按 name 子串匹配.

        使用完整技能名作为查询以避免误匹配描述中的 "代码" 字样.
        """
        await library.register_skill(code_review_skill)
        await library.register_skill(doc_gen_skill)
        # doc_gen 描述也含 "代码" 字样，故用完整名 "代码审查" 作为查询
        result = await library.search_skills("代码审查")
        assert len(result) == 1
        assert result[0].name == "代码审查"

    async def test_search_skills_by_description(
        self, library: SkillLibrary, code_review_skill: Skill, doc_gen_skill: Skill
    ) -> None:
        """search_skills 按 description 子串匹配."""
        await library.register_skill(code_review_skill)
        await library.register_skill(doc_gen_skill)
        result = await library.search_skills("API")
        assert len(result) == 1
        assert result[0].name == "技术文档生成"

    async def test_search_skills_by_tags(
        self, library: SkillLibrary, code_review_skill: Skill, doc_gen_skill: Skill
    ) -> None:
        """search_skills 按 tags 匹配."""
        await library.register_skill(code_review_skill)
        await library.register_skill(doc_gen_skill)
        result = await library.search_skills("markdown")
        assert len(result) == 1
        assert result[0].name == "技术文档生成"

    async def test_search_skills_respects_limit(
        self, library: SkillLibrary, code_review_skill: Skill, doc_gen_skill: Skill
    ) -> None:
        """search_skills limit 截断."""
        await library.register_skill(code_review_skill)
        await library.register_skill(doc_gen_skill)
        # 两个都包含 "生成" 字样（doc_gen 的 name + code_review 的 procedure 不计入）
        # 仅 doc_gen name 含 "生成"；code_review description 不含
        result = await library.search_skills("生成", limit=5)
        # 至少返回一个（文档生成），limit 不超过实际匹配数
        assert len(result) >= 1
        # limit=0 应返回空
        assert await library.search_skills("生成", limit=0) == []

    async def test_search_skills_empty_query_returns_empty(self, library: SkillLibrary) -> None:
        """search_skills 空查询返回空列表."""
        assert await library.search_skills("") == []


# ══════════════════════════════════════════════════════════════════
# §7 SkillLibrary match_skills
# ══════════════════════════════════════════════════════════════════


class TestMatchTriggerPatternHelper:
    """_match_trigger_pattern 辅助函数."""

    def test_regex_match(self) -> None:
        """regex 模式匹配.

        注意：``\\b`` 对 CJK 字符无效（Python regex 把 CJK 视为非单词字符），
        故中文 regex 不使用 ``\\b`` 边界。
        """
        # Latin 字符可以使用 \b 边界
        assert _match_trigger_pattern(r"\breview\b", "please review this") is True
        # 中文 regex 直接子串匹配
        assert _match_trigger_pattern(r"代码审查", "请进行代码审查") is True
        # 含 \s* 的 regex
        assert _match_trigger_pattern(r"code\s*review", "please code review this") is True

    def test_keyword_substring_match(self) -> None:
        """关键词子串匹配（regex 不合法时回退）."""
        assert _match_trigger_pattern("性能分析", "请做性能分析") is True
        # 非法 regex 应回退到子串匹配
        assert _match_trigger_pattern("[invalid", "包含 [invalid 字符") is True

    def test_no_match(self) -> None:
        """不匹配返回 False."""
        assert _match_trigger_pattern("代码审查", "请生成文档") is False
        assert _match_trigger_pattern(r"\bfoo\b", "bar baz") is False

    def test_case_insensitive(self) -> None:
        """匹配大小写不敏感."""
        assert _match_trigger_pattern("Code Review", "please code review") is True
        assert _match_trigger_pattern("CODE REVIEW", "please Code Review") is True


class TestCheckPreconditionHelper:
    """_check_precondition 辅助函数."""

    def test_key_value_format_satisfied(self) -> None:
        """key=value 格式且满足."""
        assert _check_precondition("diff=provided", {"diff": "provided"}) is True

    def test_key_value_format_not_satisfied(self) -> None:
        """key=value 格式但值不匹配."""
        assert _check_precondition("diff=provided", {"diff": "missing"}) is False

    def test_key_value_format_missing_key(self) -> None:
        """key=value 格式但 key 缺失."""
        assert _check_precondition("diff=provided", {}) is False

    def test_key_colon_format(self) -> None:
        """key:value 格式也支持."""
        assert _check_precondition("diff:provided", {"diff": "provided"}) is True

    def test_descriptive_precondition_no_context_satisfied(self) -> None:
        """描述性前置条件（无 = 或 :），无 context 时视为满足."""
        assert _check_precondition("repo_root", {}) is True

    def test_descriptive_precondition_in_context_satisfied(self) -> None:
        """描述性前置条件，context 中存在同名 key."""
        assert _check_precondition("repo_root", {"repo_root": "/path"}) is True


class TestSkillLibraryMatch:
    """SkillLibrary.match_skills."""

    async def test_match_by_keyword_pattern(
        self, library: SkillLibrary, code_review_skill: Skill, doc_gen_skill: Skill
    ) -> None:
        """match_skills 按关键词模式匹配.

        code_review_skill 的 preconditions 为 ``diff=provided``，
        故需提供 context 满足前置条件。
        """
        await library.register_skill(code_review_skill)
        await library.register_skill(doc_gen_skill)
        result = await library.match_skills(
            "请进行代码审查", context={"diff": "provided"}
        )
        assert len(result) == 1
        assert result[0].name == "代码审查"

    async def test_match_by_regex_pattern(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """match_skills 按 regex 模式匹配."""
        await library.register_skill(code_review_skill)
        result = await library.match_skills(
            "please code review this PR",
            context={"diff": "provided"},
        )
        assert len(result) == 1
        assert result[0].name == "代码审查"

    async def test_match_filters_by_preconditions(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """preconditions 不满足时技能被过滤."""
        await library.register_skill(code_review_skill)
        # code_review_skill.preconditions = ["diff=provided"]
        # context 不含 diff → 不应匹配
        result = await library.match_skills("请进行代码审查", context={})
        assert len(result) == 0
        # context 含 diff=provided → 匹配
        result = await library.match_skills(
            "请进行代码审查", context={"diff": "provided"}
        )
        assert len(result) == 1

    async def test_match_sorts_by_confidence_times_success_rate(
        self, library: SkillLibrary
    ) -> None:
        """match_skills 按 confidence * success_rate 降序排序."""
        # 创建两个技能都匹配 "test"
        high_score = Skill(
            name="高置信技能",
            trigger_patterns=["test"],
            confidence=0.9,
            usage_count=10,
            success_count=9,  # success_rate=0.9 → score=0.81
        )
        low_score = Skill(
            name="低置信技能",
            trigger_patterns=["test"],
            confidence=0.5,
            usage_count=10,
            success_count=4,  # success_rate=0.4 → score=0.20
        )
        await library.register_skill(high_score)
        await library.register_skill(low_score)
        result = await library.match_skills("test trigger")
        assert len(result) == 2
        assert result[0].name == "高置信技能"
        assert result[1].name == "低置信技能"

    async def test_match_no_trigger_patterns_excluded(
        self, library: SkillLibrary
    ) -> None:
        """无 trigger_patterns 的技能不参与匹配."""
        no_trigger = Skill(name="无触发模式技能")
        await library.register_skill(no_trigger)
        result = await library.match_skills("anything")
        assert len(result) == 0


# ══════════════════════════════════════════════════════════════════
# §8 SkillLibrary invoke + record_invocation_result
# ══════════════════════════════════════════════════════════════════


class TestSkillLibraryInvoke:
    """SkillLibrary.invoke_skill + record_invocation_result."""

    async def test_invoke_creates_invocation(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """invoke_skill 创建调用记录并返回 invocation_id."""
        sid = await library.register_skill(code_review_skill)
        inv = await library.invoke_skill(
            sid, {"diff": "sample diff"}, invoked_by="forgemind:luban_001"
        )
        assert inv.invocation_id
        assert inv.skill_id == sid
        assert inv.invoked_by == "forgemind:luban_001"
        assert inv.inputs == {"diff": "sample diff"}
        # 默认 success=False（pending），duration=0.0
        assert inv.success is False
        assert inv.duration_seconds == 0.0

    async def test_invoke_unknown_skill_raises(
        self, library: SkillLibrary
    ) -> None:
        """invoke_skill 不存在的技能抛出 KeyError."""
        with pytest.raises(KeyError):
            await library.invoke_skill(
                "skill_unknown", {}, invoked_by="forgemind:luban_001"
            )

    async def test_invoke_emits_event(
        self, library: SkillLibrary, event_bus: _FakeEventBus, code_review_skill: Skill
    ) -> None:
        """invoke_skill 发出 skill.invoked 事件."""
        sid = await library.register_skill(code_review_skill)
        await library.invoke_skill(sid, {}, invoked_by="forgemind:luban_001")
        # 至少有一条 invoked 事件
        invoked_events = [e for e in event_bus.events if e["type"] == "skill.invoked"]
        assert len(invoked_events) >= 1
        assert invoked_events[-1]["payload"]["skill_id"] == sid

    async def test_record_invocation_result_updates_counts_success(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """record_invocation_result 成功时更新 success_count + usage_count."""
        sid = await library.register_skill(code_review_skill)
        inv = await library.invoke_skill(sid, {}, "forgemind:luban_001")
        await library.record_invocation_result(
            inv.invocation_id,
            success=True,
            outputs={"findings": ["issue1"]},
        )
        skill = await library.get_skill(sid)
        assert skill is not None
        assert skill.usage_count == 1
        assert skill.success_count == 1
        assert skill.failure_count == 0

    async def test_record_invocation_result_updates_counts_failure(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """record_invocation_result 失败时更新 failure_count + usage_count."""
        sid = await library.register_skill(code_review_skill)
        inv = await library.invoke_skill(sid, {}, "forgemind:luban_001")
        await library.record_invocation_result(
            inv.invocation_id,
            success=False,
            error="timeout",
            feedback="需要重试",
        )
        skill = await library.get_skill(sid)
        assert skill is not None
        assert skill.usage_count == 1
        assert skill.failure_count == 1
        assert skill.success_count == 0
        # 调用记录本身也被更新
        assert inv.success is False
        assert inv.error == "timeout"
        assert inv.feedback == "需要重试"

    async def test_record_invocation_result_records_metrics(
        self, library: SkillLibrary, metrics: _FakeMetricsCollector, code_review_skill: Skill
    ) -> None:
        """record_invocation_result 上报 histogram 指标."""
        sid = await library.register_skill(code_review_skill)
        inv = await library.invoke_skill(sid, {}, "forgemind:luban_001")
        await library.record_invocation_result(
            inv.invocation_id, success=True, outputs={}
        )
        # 应有 invocation_duration_seconds histogram 上报
        duration_metrics = [
            m for m in metrics.histograms
            if "invocation_duration" in m[0]
        ]
        assert len(duration_metrics) >= 1
        # 标签应包含 skill_id 和 success
        labels = duration_metrics[0][2] or {}
        assert labels.get("skill_id") == sid
        assert labels.get("success") == "true"

    async def test_record_invocation_result_emits_event(
        self, library: SkillLibrary, event_bus: _FakeEventBus, code_review_skill: Skill
    ) -> None:
        """record_invocation_result 发出 skill.invocation.completed 事件."""
        sid = await library.register_skill(code_review_skill)
        inv = await library.invoke_skill(sid, {}, "forgemind:luban_001")
        await library.record_invocation_result(
            inv.invocation_id, success=True, outputs={}
        )
        completed_events = [
            e for e in event_bus.events
            if e["type"] == "skill.invocation.completed"
        ]
        assert len(completed_events) >= 1
        assert completed_events[-1]["payload"]["success"] is True

    async def test_record_invocation_result_unknown_id_warns(
        self, library: SkillLibrary
    ) -> None:
        """record_invocation_result 对未知 invocation_id 静默返回（仅 warning）."""
        # 不应抛异常
        await library.record_invocation_result(
            "inv_unknown", success=True, outputs={}
        )


# ══════════════════════════════════════════════════════════════════
# §9 SkillLibrary evolve_skill
# ══════════════════════════════════════════════════════════════════


class TestSkillLibraryEvolve:
    """SkillLibrary.evolve_skill."""

    async def test_evolve_updates_procedure(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """evolve_skill 更新 procedure."""
        sid = await library.register_skill(code_review_skill)
        original_procedure = code_review_skill.procedure
        evolved = await library.evolve_skill(
            sid, {"procedure": "改进后的流程：读取 → 静态分析 → 生成 findings"}
        )
        assert evolved.procedure == "改进后的流程：读取 → 静态分析 → 生成 findings"
        assert evolved.procedure != original_procedure

    async def test_evolve_appends_anti_patterns(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """evolve_skill 追加新反模式（去重）."""
        sid = await library.register_skill(code_review_skill)
        original_count = len(code_review_skill.anti_patterns)
        evolved = await library.evolve_skill(
            sid,
            {
                "anti_patterns": [
                    "忽略测试覆盖率",
                    code_review_skill.anti_patterns[0],  # 重复项应被去重
                ]
            },
        )
        assert len(evolved.anti_patterns) == original_count + 1
        assert "忽略测试覆盖率" in evolved.anti_patterns

    async def test_evolve_adjusts_confidence(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """evolve_skill 基于最近调用成功率调整 confidence."""
        sid = await library.register_skill(code_review_skill)
        original_conf = code_review_skill.confidence
        # 制造 5 次成功调用
        for _ in range(5):
            inv = await library.invoke_skill(sid, {}, "forgemind:luban_001")
            await library.record_invocation_result(
                inv.invocation_id, success=True, outputs={}
            )
        evolved = await library.evolve_skill(sid, {})
        # 平滑更新：new = old * 0.7 + 1.0 * 0.3
        expected = round(original_conf * 0.7 + 1.0 * 0.3, 4)
        assert evolved.confidence == pytest.approx(expected, abs=0.01)
        assert evolved.confidence > original_conf

    async def test_evolve_promotes_maturity(
        self, library: SkillLibrary
    ) -> None:
        """evolve_skill 在 success_rate > 0.9 且 usage_count > 10 时提升 maturity."""
        skill = Skill(
            name="性能瓶颈分析",
            maturity_level=2,
            confidence=0.7,
        )
        sid = await library.register_skill(skill)
        # 制造 11 次成功调用
        for _ in range(11):
            inv = await library.invoke_skill(sid, {}, "forgemind:luban_001")
            await library.record_invocation_result(
                inv.invocation_id, success=True, outputs={}
            )
        evolved = await library.evolve_skill(sid, {})
        assert evolved.maturity_level == 3  # 提升一级

    async def test_evolve_does_not_promote_above_max(
        self, library: SkillLibrary
    ) -> None:
        """maturity 已达 5（_MATURITY_MAX）时不再提升."""
        skill = Skill(
            name="性能瓶颈分析",
            maturity_level=5,
            confidence=0.95,
        )
        sid = await library.register_skill(skill)
        # 制造 12 次成功调用
        for _ in range(12):
            inv = await library.invoke_skill(sid, {}, "forgemind:luban_001")
            await library.record_invocation_result(
                inv.invocation_id, success=True, outputs={}
            )
        evolved = await library.evolve_skill(sid, {})
        assert evolved.maturity_level == 5  # 不超过 max

    async def test_evolve_unknown_skill_raises(self, library: SkillLibrary) -> None:
        """evolve_skill 不存在的技能抛出 KeyError."""
        with pytest.raises(KeyError):
            await library.evolve_skill("skill_unknown", {})


# ══════════════════════════════════════════════════════════════════
# §10 SkillLibrary 导入导出
# ══════════════════════════════════════════════════════════════════


class TestSkillLibraryImportExport:
    """SkillLibrary.export_skill / import_skill."""

    async def test_export_skill_returns_dict(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """export_skill 返回完整字段 dict."""
        sid = await library.register_skill(code_review_skill)
        data = await library.export_skill(sid)
        assert data["skill_id"] == sid
        assert data["name"] == "代码审查"
        assert data["forgekin_species"] == "luban"
        assert data["confidence"] == 0.82

    async def test_export_skill_unknown_raises(self, library: SkillLibrary) -> None:
        """export_skill 不存在抛出 KeyError."""
        with pytest.raises(KeyError):
            await library.export_skill("skill_unknown")

    async def test_import_skill_creates_new(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """import_skill 创建新技能."""
        sid = await library.register_skill(code_review_skill)
        data = await library.export_skill(sid)
        # 修改 ID 后导入
        data["skill_id"] = "skill_imported_new"
        imported = await library.import_skill(data, overwrite=False)
        assert imported.skill_id == "skill_imported_new"
        assert await library.get_skill("skill_imported_new") is not None

    async def test_import_skill_generates_new_id_on_conflict(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """import_skill ID 冲突且 overwrite=False 时生成新 ID."""
        sid = await library.register_skill(code_review_skill)
        data = await library.export_skill(sid)
        # 不修改 ID 直接导入，应生成新 ID
        imported = await library.import_skill(data, overwrite=False)
        assert imported.skill_id != sid
        # 原技能仍存在
        assert await library.get_skill(sid) is not None

    async def test_import_skill_overwrite_replaces(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """import_skill overwrite=True 时覆盖原技能."""
        sid = await library.register_skill(code_review_skill)
        data = await library.export_skill(sid)
        # 修改 confidence 后覆盖导入
        data["confidence"] = 0.95
        imported = await library.import_skill(data, overwrite=True)
        assert imported.skill_id == sid
        assert imported.confidence == 0.95

    async def test_export_import_roundtrip(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """export → import 往返保持字段一致."""
        sid = await library.register_skill(code_review_skill)
        data = await library.export_skill(sid)
        data["skill_id"] = "skill_roundtrip"
        imported = await library.import_skill(data)
        # 关键字段一致
        assert imported.name == code_review_skill.name
        assert imported.forgekin_species == code_review_skill.forgekin_species
        assert imported.confidence == code_review_skill.confidence
        assert imported.maturity_level == code_review_skill.maturity_level
        assert imported.trigger_patterns == code_review_skill.trigger_patterns


# ══════════════════════════════════════════════════════════════════
# §11 SkillLibrary 统计
# ══════════════════════════════════════════════════════════════════


class TestSkillLibraryStatistics:
    """SkillLibrary.get_skill_statistics / get_library_status."""

    def test_get_skill_statistics_empty(self, library: SkillLibrary) -> None:
        """get_skill_statistics 不存在的技能返回空 dict."""
        assert library.get_skill_statistics("skill_unknown") == {}

    async def test_get_skill_statistics_with_invocations(
        self, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """get_skill_statistics 返回完整统计字段."""
        sid = await library.register_skill(code_review_skill)
        # 3 次调用，2 次成功 1 次失败
        inv1 = await library.invoke_skill(sid, {}, "forgemind:luban_001")
        await library.record_invocation_result(inv1.invocation_id, True, {})
        inv2 = await library.invoke_skill(sid, {}, "forgemind:luban_001")
        await library.record_invocation_result(inv2.invocation_id, True, {})
        inv3 = await library.invoke_skill(sid, {}, "forgemind:luban_001")
        await library.record_invocation_result(inv3.invocation_id, False, error="x")
        stats = library.get_skill_statistics(sid)
        assert stats["skill_id"] == sid
        assert stats["usage_count"] == 3
        assert stats["success_count"] == 2
        assert stats["failure_count"] == 1
        assert stats["success_rate"] == pytest.approx(0.6667, abs=0.01)
        assert stats["avg_duration_seconds"] >= 0.0
        assert stats["invocation_count"] == 3
        assert stats["confidence"] == code_review_skill.confidence
        assert stats["maturity_level"] == code_review_skill.maturity_level

    async def test_get_library_status(
        self, library: SkillLibrary, code_review_skill: Skill, perf_analysis_skill: Skill
    ) -> None:
        """get_library_status 返回整体状态."""
        await library.register_skill(code_review_skill)      # luban, maturity=3
        await library.register_skill(perf_analysis_skill)     # sherlock, maturity=1
        # 制造 2 次调用
        inv1 = await library.invoke_skill(code_review_skill.skill_id, {}, "f1")
        await library.record_invocation_result(inv1.invocation_id, True, {})
        inv2 = await library.invoke_skill(code_review_skill.skill_id, {}, "f1")
        await library.record_invocation_result(inv2.invocation_id, True, {})

        status = library.get_library_status()
        assert status["total_skills"] == 2
        assert status["public_skills"] == 2
        assert status["total_invocations"] == 2
        assert status["by_species"].get("luban") == 1
        assert status["by_species"].get("sherlock") == 1
        assert status["by_maturity"].get(3) == 1
        assert status["by_maturity"].get(1) == 1
        assert "storage_dir" in status


# ══════════════════════════════════════════════════════════════════
# §12 SkillMarket
# ══════════════════════════════════════════════════════════════════


class TestSkillMarket:
    """SkillMarket publish / browse / install / rate."""

    async def test_publish_to_market_writes_file(
        self, market: SkillMarket, library: SkillLibrary, code_review_skill: Skill, market_dir: Path
    ) -> None:
        """publish_to_market 拷贝技能到市场目录."""
        sid = await library.register_skill(code_review_skill)
        ok = await market.publish_to_market(sid)
        assert ok is True
        assert (market_dir / f"{sid}.yaml").exists()

    async def test_publish_to_market_rejects_non_public(
        self, market: SkillMarket, library: SkillLibrary
    ) -> None:
        """publish_to_market 拒绝非公开技能."""
        skill = Skill(name="私有技能", is_public=False)
        sid = await library.register_skill(skill)
        ok = await market.publish_to_market(sid)
        assert ok is False

    async def test_publish_to_market_unknown_returns_false(
        self, market: SkillMarket
    ) -> None:
        """publish_to_market 不存在的技能返回 False."""
        ok = await market.publish_to_market("skill_unknown")
        assert ok is False

    async def test_browse_market_no_filter(
        self, market: SkillMarket, library: SkillLibrary,
        code_review_skill: Skill, perf_analysis_skill: Skill
    ) -> None:
        """browse_market 无过滤返回所有市场技能."""
        sid1 = await library.register_skill(code_review_skill)
        sid2 = await library.register_skill(perf_analysis_skill)
        await market.publish_to_market(sid1)
        await market.publish_to_market(sid2)
        result = await market.browse_market()
        assert len(result) == 2

    async def test_browse_market_filter_by_species(
        self, market: SkillMarket, library: SkillLibrary,
        code_review_skill: Skill, perf_analysis_skill: Skill
    ) -> None:
        """browse_market 按 forgekin_species 过滤."""
        sid1 = await library.register_skill(code_review_skill)
        sid2 = await library.register_skill(perf_analysis_skill)
        await market.publish_to_market(sid1)   # luban
        await market.publish_to_market(sid2)   # sherlock
        result = await market.browse_market(forgekin_species="sherlock")
        assert len(result) == 1
        assert result[0].forgekin_species == "sherlock"

    async def test_browse_market_filter_by_tags(
        self, market: SkillMarket, library: SkillLibrary,
        code_review_skill: Skill, perf_analysis_skill: Skill
    ) -> None:
        """browse_market 按 tags 过滤."""
        sid1 = await library.register_skill(code_review_skill)  # tags: code-review, quality
        sid2 = await library.register_skill(perf_analysis_skill)  # tags: performance, profiling
        await market.publish_to_market(sid1)
        await market.publish_to_market(sid2)
        result = await market.browse_market(tags=["performance"])
        assert len(result) == 1
        assert result[0].name == "性能瓶颈分析"

    async def test_browse_market_sort_by_usage_count(
        self, market: SkillMarket, library: SkillLibrary
    ) -> None:
        """browse_market 默认按 usage_count 降序."""
        skill_low = Skill(name="低使用技能", trigger_patterns=["x"], usage_count=1)
        skill_high = Skill(name="高使用技能", trigger_patterns=["x"], usage_count=100)
        sid_low = await library.register_skill(skill_low)
        sid_high = await library.register_skill(skill_high)
        await market.publish_to_market(sid_low)
        await market.publish_to_market(sid_high)
        result = await market.browse_market(sort_by="usage_count")
        assert result[0].name == "高使用技能"
        assert result[1].name == "低使用技能"

    async def test_browse_market_sort_by_confidence(
        self, market: SkillMarket, library: SkillLibrary
    ) -> None:
        """browse_market 按 confidence 排序."""
        skill_low = Skill(name="低置信", confidence=0.3)
        skill_high = Skill(name="高置信", confidence=0.95)
        sid_low = await library.register_skill(skill_low)
        sid_high = await library.register_skill(skill_high)
        await market.publish_to_market(sid_low)
        await market.publish_to_market(sid_high)
        result = await market.browse_market(sort_by="confidence")
        assert result[0].name == "高置信"

    async def test_install_from_market_copies_to_library(
        self, market: SkillMarket, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """install_from_market 将市场技能拷贝到本地库."""
        sid = await library.register_skill(code_review_skill)
        await market.publish_to_market(sid)
        # 注销本地后再从市场安装
        await library.unregister_skill(sid)
        assert await library.get_skill(sid) is None
        installed = await market.install_from_market(sid)
        assert installed.skill_id == sid
        assert await library.get_skill(sid) is not None

    async def test_install_from_market_unknown_raises(
        self, market: SkillMarket
    ) -> None:
        """install_from_market 市场中不存在抛出 KeyError."""
        with pytest.raises(KeyError):
            await market.install_from_market("skill_unknown")

    async def test_rate_skill_appends_rating(
        self, market: SkillMarket, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """rate_skill 追加评分到 metadata."""
        sid = await library.register_skill(code_review_skill)
        await market.publish_to_market(sid)
        await market.rate_skill(sid, rating=5, comment="非常实用")
        await market.rate_skill(sid, rating=4, comment="总体不错")
        # 重新加载市场技能验证评分
        skills = await market.browse_market()
        rated = next(s for s in skills if s.skill_id == sid)
        ratings = rated.metadata.get(SkillMarket.MARKET_RATINGS_KEY, [])
        assert len(ratings) == 2
        assert ratings[0]["rating"] == 5
        assert ratings[0]["comment"] == "非常实用"

    async def test_rate_skill_invalid_rating_raises(
        self, market: SkillMarket, library: SkillLibrary, code_review_skill: Skill
    ) -> None:
        """rate_skill rating 不在 [1,5] 抛出 ValueError."""
        sid = await library.register_skill(code_review_skill)
        await market.publish_to_market(sid)
        with pytest.raises(ValueError):
            await market.rate_skill(sid, rating=0)
        with pytest.raises(ValueError):
            await market.rate_skill(sid, rating=6)

    async def test_rate_skill_unknown_raises(
        self, market: SkillMarket
    ) -> None:
        """rate_skill 市场中不存在抛出 KeyError."""
        with pytest.raises(KeyError):
            await market.rate_skill("skill_unknown", rating=5)

    async def test_get_market_status(
        self, market: SkillMarket, library: SkillLibrary,
        code_review_skill: Skill, perf_analysis_skill: Skill
    ) -> None:
        """get_market_status 返回市场整体状态."""
        sid1 = await library.register_skill(code_review_skill)
        sid2 = await library.register_skill(perf_analysis_skill)
        await market.publish_to_market(sid1)
        await market.publish_to_market(sid2)
        await market.rate_skill(sid1, rating=5)
        await market.rate_skill(sid1, rating=3)
        status = await market.get_market_status()
        assert status["total_skills"] == 2
        assert status["by_species"].get("luban") == 1
        assert status["by_species"].get("sherlock") == 1
        assert status["rating_count"] == 2
        assert status["avg_rating"] == 4.0  # (5+3)/2
        assert "market_dir" in status

    async def test_get_market_status_empty(self, market: SkillMarket) -> None:
        """空市场状态正确."""
        status = await market.get_market_status()
        assert status["total_skills"] == 0
        assert status["rating_count"] == 0
        assert status["avg_rating"] == 0.0


# ══════════════════════════════════════════════════════════════════
# §13 metrics_collector 与 event_bus 集成
# ══════════════════════════════════════════════════════════════════


class TestMetricsAndEventIntegration:
    """metrics_collector 与 event_bus 集成测试."""

    async def test_register_skill_records_metrics(
        self, library: SkillLibrary, metrics: _FakeMetricsCollector, code_review_skill: Skill
    ) -> None:
        """register_skill 上报注册计数与 library size gauge."""
        await library.register_skill(code_review_skill)
        # 应有 registered counter
        registered = [
            c for c in metrics.counters if "registered" in c[0]
        ]
        assert len(registered) >= 1
        # 应有 library size gauge
        size_gauges = [
            g for g in metrics.gauges if "library_size" in g[0]
        ]
        assert len(size_gauges) >= 1
        assert size_gauges[-1][1] == 1.0  # 1 个技能

    async def test_unregister_skill_updates_gauge(
        self, library: SkillLibrary, metrics: _FakeMetricsCollector, code_review_skill: Skill
    ) -> None:
        """unregister_skill 后 library size gauge 减少."""
        sid = await library.register_skill(code_review_skill)
        await library.unregister_skill(sid)
        size_gauges = [
            g for g in metrics.gauges if "library_size" in g[0]
        ]
        # 最后一次应反映 size=0
        assert size_gauges[-1][1] == 0.0

    async def test_register_skill_emits_event(
        self, library: SkillLibrary, event_bus: _FakeEventBus, code_review_skill: Skill
    ) -> None:
        """register_skill 发出 skill.registered 事件."""
        sid = await library.register_skill(code_review_skill)
        registered_events = [
            e for e in event_bus.events if e["type"] == "skill.registered"
        ]
        assert len(registered_events) >= 1
        assert registered_events[-1]["payload"]["skill_id"] == sid

    async def test_metrics_collector_failure_does_not_break(
        self, storage_dir: Path, event_bus: _FakeEventBus, code_review_skill: Skill
    ) -> None:
        """metrics_collector 抛异常时主流程不受影响."""
        class _BrokenMetrics:
            def inc_counter(self, *args, **kwargs):
                raise RuntimeError("metrics broken")
            def observe_histogram(self, *args, **kwargs):
                raise RuntimeError("metrics broken")
            def set_gauge(self, *args, **kwargs):
                raise RuntimeError("metrics broken")

        lib = SkillLibrary(
            storage_dir=storage_dir,
            metrics_collector=_BrokenMetrics(),
            event_bus=event_bus,
        )
        # 注册不应抛异常
        sid = await lib.register_skill(code_review_skill)
        assert sid == code_review_skill.skill_id

    async def test_event_bus_failure_does_not_break(
        self, storage_dir: Path, metrics: _FakeMetricsCollector, code_review_skill: Skill
    ) -> None:
        """event_bus 抛异常时主流程不受影响."""
        class _BrokenEventBus:
            def emit(self, *args, **kwargs):
                raise RuntimeError("event bus broken")

        lib = SkillLibrary(
            storage_dir=storage_dir,
            metrics_collector=metrics,
            event_bus=_BrokenEventBus(),
        )
        # 注册不应抛异常
        sid = await lib.register_skill(code_review_skill)
        assert sid == code_review_skill.skill_id


# ══════════════════════════════════════════════════════════════════
# §14 _parse_semver 辅助函数
# ══════════════════════════════════════════════════════════════════


class TestParseSemver:
    """_parse_semver 辅助函数."""

    def test_full_version(self) -> None:
        assert _parse_semver("1.2.3") == (1, 2, 3)

    def test_short_version(self) -> None:
        assert _parse_semver("1.2") == (1, 2, 0)
        assert _parse_semver("1") == (1, 0, 0)

    def test_non_numeric_parts_become_zero(self) -> None:
        assert _parse_semver("1.x.3") == (1, 0, 3)

    def test_empty_string(self) -> None:
        assert _parse_semver("") == (0, 0, 0)
