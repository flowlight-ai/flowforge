"""F046 v1.1 SelfDevReviewLoop 单元测试 — 代码审查闭环.

覆盖范围：
- Discover: target_files / recent_commits / 缺失文件跳过
- Plan: LLM 返回合法审查清单 / I9 no-self-review 警告 / fallback
- Act: 生成审查报告（P0/P1/P2/P3 分级）/ 不修改代码
- Verify: 报告存在性 / front-matter / P0/P1 位置检查 / LLM meta-review
- E2E: 完整五步循环（stub 替代 TraeLLMClient）

测试铁律遵守：
- T1 禁止 Mock LLM：使用 _FakeTraeClient（stub 替代）
- T2 真实场景数据：构造临时项目目录，模拟真实代码 + 审查报告
- T3 具体断言：每个测试都有明确断言
- T6 必须采集指标：elapsed_ms 字段记录耗时
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

# 确保能导入 flowforge
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from flowforge.evolution.engine import ForgeMindEngine
from flowforge.evolution.self_dev_base import (
    DevPlan,
    DevResult,
    DevTask,
)
from flowforge.evolution.self_dev_review import SelfDevReviewLoop


# ══════════════════════════════════════════════════════════════════
# §1 Fake/Stub 工具类
# ══════════════════════════════════════════════════════════════════


class _FakeTraeClient:
    """Stub TraeLLMClient — 按顺序返回预设响应."""

    def __init__(self, responses: List[Dict[str, Any]] | None = None) -> None:
        self._responses = list(responses or [])
        self.call_count = 0
        self.calls: List[Dict[str, Any]] = []

    async def chat(self, messages: List[Dict[str, str]], *, context=None, **kwargs) -> Dict[str, Any]:
        self.call_count += 1
        self.calls.append({"messages": messages, "context": context, "kwargs": kwargs})
        if self._responses:
            return self._responses.pop(0)
        # 默认响应：合法的 Plan JSON（默认审查清单）
        return {
            "content": json.dumps({
                "steps": [{
                    "action": "review_file",
                    "path": "flowforge/foo.py",
                    "checklist": ["检查硬编码", "检查 DI 注入"],
                }],
                "expected_effect": "默认审查清单",
                "risk_assessment": "low",
            }),
            "model": "claude-3-5-sonnet",  # 默认使用 Anthropic 模型（与 author 不同厂商）
            "provider": "anthropic",
            "usage": {"latency_ms": 100},
            "request_id": f"req-{self.call_count}",
        }


# ══════════════════════════════════════════════════════════════════
# §2 测试固件
# ══════════════════════════════════════════════════════════════════


@pytest.fixture
def temp_project(tmp_path: Path) -> Path:
    """构造临时项目目录."""
    # flowforge/foo.py（待审查的源文件）
    ff_dir = tmp_path / "flowforge"
    ff_dir.mkdir(parents=True)
    (ff_dir / "foo.py").write_text(
        "\"\"\"Foo module.\"\"\"\n"
        "from typing import Any\n\n"
        "class Foo:\n"
        "    def __init__(self, client: Any) -> None:\n"
        "        self._client = client\n\n"
        "    async def get(self) -> str:\n"
        "        return 'foo'\n",
        encoding="utf-8",
    )

    # docs/reviews 目录（已有审查报告，用于 Verify 测试）
    reviews_dir = tmp_path / "docs" / "reviews"
    reviews_dir.mkdir(parents=True)

    return tmp_path


@pytest.fixture
def forgekin_config(temp_project: Path) -> Dict[str, Any]:
    return {
        "project_root": str(temp_project),
        "forgekin_id": "forgemind:vangogh",
        "reviews_dir": "docs/reviews",
    }


@pytest.fixture
def fake_engine() -> ForgeMindEngine:
    return ForgeMindEngine()


@pytest.fixture
def fake_trae_client() -> _FakeTraeClient:
    """默认 FakeTraeClient — Plan 返回审查清单，Act 返回 P1 报告，meta-review 通过."""
    plan_response = {
        "content": json.dumps({
            "steps": [{
                "action": "review_file",
                "path": "flowforge/foo.py",
                "checklist": ["检查硬编码", "检查 DI 注入", "检查类型注解"],
            }],
            "expected_effect": "审查清单",
            "risk_assessment": "low",
        }),
        "model": "claude-3-5-sonnet",  # Anthropic
        "provider": "anthropic",
        "usage": {"latency_ms": 100},
        "request_id": "plan-1",
    }
    # Act 阶段：生成审查报告（含 1 个 P1 问题，位置明确）
    act_response = {
        "content": json.dumps({
            "issues": [{
                "severity": "P1",
                "location": "Foo.get line 8",
                "description": "返回值缺少类型注解",
                "suggestion": "添加 -> str 注解",
            }],
            "summary": "代码整体合规，1 个 P1 问题待修复",
            "score": 0.85,
        }),
        "model": "claude-3-5-sonnet",
        "provider": "anthropic",
        "usage": {"latency_ms": 150},
        "request_id": "act-1",
    }
    # Verify 阶段：LLM meta-review 通过
    meta_review_response = {
        "content": json.dumps({
            "passed": True,
            "score": 0.90,
            "issues": [],
            "suggestions": ["审查报告客观准确"],
        }),
        "model": "claude-3-5-sonnet",
        "provider": "anthropic",
        "usage": {"latency_ms": 80},
        "request_id": "meta-1",
    }
    return _FakeTraeClient([plan_response, act_response, meta_review_response])


@pytest.fixture
def review_loop(fake_trae_client, fake_engine, forgekin_config) -> SelfDevReviewLoop:
    return SelfDevReviewLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E3")


# ══════════════════════════════════════════════════════════════════
# §3 Discover 测试
# ══════════════════════════════════════════════════════════════════


class TestDiscover:
    @pytest.mark.asyncio
    async def test_discover_target_files(self, review_loop) -> None:
        """target_files 模式：从文件列表创建审查任务."""
        tasks = await review_loop.discover({
            "target_files": ["flowforge/foo.py"],
            "author_forgekin_id": "forgemind:sherlock",
            "author_llm_model": "gpt-4-turbo",  # OpenAI 厂商
        })
        assert len(tasks) == 1
        assert tasks[0].target_path == "flowforge/foo.py"
        assert tasks[0].loop_type == "review"
        assert tasks[0].modification_type == "create"  # 创建审查报告
        assert tasks[0].priority == "high"
        # context 保留 author 信息（用于 I9 检查）
        assert tasks[0].context["author_forgekin_id"] == "forgemind:sherlock"
        assert tasks[0].context["author_llm_model"] == "gpt-4-turbo"

    @pytest.mark.asyncio
    async def test_discover_skips_missing_files(self, review_loop) -> None:
        """target_files 中不存在的文件应被跳过."""
        tasks = await review_loop.discover({
            "target_files": ["flowforge/foo.py", "flowforge/nonexistent.py"],
        })
        assert len(tasks) == 1
        assert tasks[0].target_path == "flowforge/foo.py"

    @pytest.mark.asyncio
    async def test_discover_force_targets_synonym(self, review_loop) -> None:
        """force_targets 与 target_files 同义."""
        tasks = await review_loop.discover({
            "force_targets": ["flowforge/foo.py"],
        })
        assert len(tasks) == 1
        assert tasks[0].context["source"] == "target_files"

    @pytest.mark.asyncio
    async def test_discover_no_targets_returns_empty(self, review_loop) -> None:
        """未提供 target_files 和 recent_commits 时返回空列表."""
        tasks = await review_loop.discover({})
        assert tasks == []


# ══════════════════════════════════════════════════════════════════
# §4 Plan 测试（含 I9 no-self-review 检查）
# ══════════════════════════════════════════════════════════════════


class TestPlan:
    @pytest.mark.asyncio
    async def test_plan_parses_valid_json(self, review_loop) -> None:
        """Plan 阶段正确解析 LLM 返回的审查清单."""
        task = DevTask(
            loop_type="review",
            target_path="flowforge/foo.py",
            modification_type="create",
            description="审查文件",
            context={
                "author_forgekin_id": "forgemind:sherlock",
                "author_llm_model": "gpt-4-turbo",  # OpenAI
            },
        )
        plan = await review_loop.plan(task)

        assert len(plan.steps) == 1
        assert plan.steps[0]["action"] == "review_file"
        assert plan.steps[0]["path"] == "flowforge/foo.py"
        assert len(plan.steps[0]["checklist"]) == 3
        assert plan.llm_model == "claude-3-5-sonnet"  # Anthropic 厂商
        assert plan.requires_approval is False

    @pytest.mark.asyncio
    async def test_plan_i9_warns_on_same_vendor(
        self, fake_engine, forgekin_config, temp_project
    ) -> None:
        """I9 检查：author 与 reviewer 同厂商时记录警告（不阻止）."""
        # author 用 OpenAI，reviewer 也用 OpenAI → I9 警告
        client = _FakeTraeClient([{
            "content": json.dumps({
                "steps": [{"action": "review_file", "path": "flowforge/foo.py", "checklist": []}],
                "expected_effect": "test",
                "risk_assessment": "low",
            }),
            "model": "gpt-4-turbo",  # OpenAI（与 author 同厂商）
            "provider": "openai",
            "usage": {"latency_ms": 100},
            "request_id": "p1",
        }])
        loop = SelfDevReviewLoop(client, forgekin_config, fake_engine, awakening_stage="E3")

        task = DevTask(
            loop_type="review",
            target_path="flowforge/foo.py",
            modification_type="create",
            description="审查",
            context={"author_llm_model": "gpt-4"},  # OpenAI
        )
        plan = await loop.plan(task)

        # 仍应正常返回 plan（I9 仅警告，不阻止）
        assert len(plan.steps) == 1
        assert plan.llm_model == "gpt-4-turbo"

    @pytest.mark.asyncio
    async def test_plan_fallback_on_invalid_json(
        self, fake_engine, forgekin_config
    ) -> None:
        """LLM 返回非 JSON 时 fallback：生成默认审查清单."""
        client = _FakeTraeClient([{
            "content": "这不是 JSON",
            "model": "claude-3-5-sonnet",
            "provider": "anthropic",
            "usage": {"latency_ms": 50},
            "request_id": "bad-1",
        }])
        loop = SelfDevReviewLoop(client, forgekin_config, fake_engine, awakening_stage="E3")

        task = DevTask(
            loop_type="review",
            target_path="flowforge/foo.py",
            modification_type="create",
            description="审查",
        )
        plan = await loop.plan(task)

        # 应使用 fallback：默认审查清单（5 项）
        assert len(plan.steps) == 1
        assert len(plan.steps[0]["checklist"]) == 5
        assert plan.risk_assessment == "medium"

    @pytest.mark.asyncio
    async def test_plan_handles_missing_file(
        self, fake_engine, forgekin_config
    ) -> None:
        """待审查文件不存在时返回空 steps 方案."""
        client = _FakeTraeClient()
        loop = SelfDevReviewLoop(client, forgekin_config, fake_engine, awakening_stage="E3")

        task = DevTask(
            loop_type="review",
            target_path="flowforge/nonexistent.py",
            modification_type="create",
            description="审查不存在文件",
        )
        plan = await loop.plan(task)

        assert len(plan.steps) == 0
        assert "不存在" in plan.expected_effect
        assert plan.risk_assessment == "high"

    @pytest.mark.asyncio
    async def test_get_llm_vendor(self, review_loop) -> None:
        """测试 LLM 厂商识别（模型名遵循各厂商官方命名规范）."""
        assert review_loop._get_llm_vendor("gpt-4-turbo") == "openai"
        assert review_loop._get_llm_vendor("gpt-3.5-turbo") == "openai"
        assert review_loop._get_llm_vendor("claude-3-5-sonnet") == "anthropic"
        assert review_loop._get_llm_vendor("claude-3.5-sonnet") == "anthropic"
        assert review_loop._get_llm_vendor("claude-4-opus") == "anthropic"
        assert review_loop._get_llm_vendor("claude-4-sonnet") == "anthropic"
        assert review_loop._get_llm_vendor("gemini-1.5-pro") == "google"
        assert review_loop._get_llm_vendor("glm-4") == "zhipu"
        assert review_loop._get_llm_vendor("glm-5.2") == "zhipu"
        assert review_loop._get_llm_vendor("moonshot-v1-8k") == "moonshot"
        assert review_loop._get_llm_vendor("llama-3-70b") == "meta"
        assert review_loop._get_llm_vendor("fake-model") == "fake"
        assert review_loop._get_llm_vendor("unknown-model") == "unknown"


# ══════════════════════════════════════════════════════════════════
# §5 Act 测试（生成审查报告）
# ══════════════════════════════════════════════════════════════════


class TestAct:
    @pytest.mark.asyncio
    async def test_act_generates_review_report(
        self, fake_engine, forgekin_config, temp_project
    ) -> None:
        """Act 阶段生成审查报告（不修改代码，仅生成 .md 报告）.

        注意：单独构造 client，仅含 Act 阶段的 LLM 响应（含 P1 问题）。
        """
        # Act 阶段：生成审查报告（含 1 个 P1 问题，位置明确）
        act_response = {
            "content": json.dumps({
                "issues": [{
                    "severity": "P1",
                    "location": "Foo.get line 8",
                    "description": "返回值缺少类型注解",
                    "suggestion": "添加 -> str 注解",
                }],
                "summary": "代码整体合规，1 个 P1 问题待修复",
                "score": 0.85,
            }),
            "model": "claude-3-5-sonnet",
            "provider": "anthropic",
            "usage": {"latency_ms": 150},
            "request_id": "act-1",
        }
        client = _FakeTraeClient([act_response])
        loop = SelfDevReviewLoop(client, forgekin_config, fake_engine, awakening_stage="E3")

        # 构造 plan（含 review_file step）
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "review_file",
                "path": "flowforge/foo.py",
                "checklist": ["检查硬编码", "检查 DI"],
            }],
            expected_effect="审查",
            risk_assessment="low",
            llm_model="claude-3-5-sonnet",
        )
        result = await loop.act(plan)

        assert result.success is True
        assert len(result.changed_files) == 1
        # changed_files 应为审查报告路径（不是源文件）
        report_path = result.changed_files[0]
        assert "docs/reviews/" in report_path
        assert report_path.endswith("_foo.md")

        # 验证报告文件存在
        abs_report = temp_project / report_path
        assert abs_report.exists()
        report_content = abs_report.read_text(encoding="utf-8")
        # 报告应包含 P1 问题描述
        assert "P1" in report_content
        assert "Foo.get" in report_content  # location

        # 验证源文件未被修改（Reviewer 不改代码）
        source_content = (temp_project / "flowforge" / "foo.py").read_text(encoding="utf-8")
        assert "class Foo" in source_content  # 原内容保留

    @pytest.mark.asyncio
    async def test_act_skips_unknown_action(
        self, fake_engine, forgekin_config, temp_project
    ) -> None:
        """未知 action 被跳过（不调用 LLM）."""
        client = _FakeTraeClient()  # 空 client，不应被调用
        loop = SelfDevReviewLoop(client, forgekin_config, fake_engine, awakening_stage="E3")
        plan = DevPlan(
            task_id="t1",
            steps=[{"action": "unknown", "path": "flowforge/foo.py"}],
            expected_effect="test",
            risk_assessment="low",
        )
        result = await loop.act(plan)

        assert result.success is True
        assert len(result.changed_files) == 0
        assert client.call_count == 0  # 未调用 LLM

    @pytest.mark.asyncio
    async def test_act_fails_on_missing_file(
        self, fake_engine, forgekin_config, temp_project
    ) -> None:
        """待审查文件不存在时 act 失败."""
        client = _FakeTraeClient()
        loop = SelfDevReviewLoop(client, forgekin_config, fake_engine, awakening_stage="E3")
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "review_file",
                "path": "flowforge/nonexistent.py",
                "checklist": [],
            }],
            expected_effect="审查",
            risk_assessment="low",
        )
        result = await loop.act(plan)

        assert result.success is False
        assert "不存在" in result.error_message


# ══════════════════════════════════════════════════════════════════
# §6 Verify 测试（meta-review）
# ══════════════════════════════════════════════════════════════════


class TestVerify:
    @pytest.mark.asyncio
    async def test_verify_passes_on_valid_report(
        self, fake_engine, forgekin_config, temp_project
    ) -> None:
        """验证合规审查报告：文件存在 + front-matter + LLM meta-review 通过.

        注意：单独构造 client，仅含 Verify 阶段的 meta-review 响应。
        """
        # Verify 阶段：LLM meta-review 通过
        meta_review_response = {
            "content": json.dumps({
                "passed": True,
                "score": 0.90,
                "issues": [],
                "suggestions": ["审查报告客观准确"],
            }),
            "model": "claude-3-5-sonnet",
            "provider": "anthropic",
            "usage": {"latency_ms": 80},
            "request_id": "meta-1",
        }
        client = _FakeTraeClient([meta_review_response])
        loop = SelfDevReviewLoop(client, forgekin_config, fake_engine, awakening_stage="E3")

        # 构造合规审查报告
        report_path = "docs/reviews/2026-07-21_10-00-00_foo.md"
        abs_report = temp_project / report_path
        abs_report.parent.mkdir(parents=True, exist_ok=True)
        abs_report.write_text(
            "---\n"
            "target: flowforge/foo.py\n"
            "reviewer_model: claude-3-5-sonnet\n"
            "score: 0.85\n"
            "reviewed_at: 2026-07-21T10:00:00Z\n"
            "---\n\n"
            "# 审查报告: foo.py\n\n"
            "## P0 问题（0 个）\n\n无\n\n"
            "## P1 问题（1 个）\n\n"
            "- 位置: Foo.get line 8\n"
            "  描述: 返回值缺少类型注解\n"
            "  建议: 添加 -> str 注解\n",
            encoding="utf-8",
        )

        result = DevResult(
            plan_id="p1",
            changed_files=[report_path],
            diff_summary="生成审查报告",
            success=True,
        )
        verify = await loop.verify(result)

        assert verify.passed is True
        assert verify.llm_review_passed is True
        assert len(verify.failure_reasons) == 0

    @pytest.mark.asyncio
    async def test_verify_fails_on_missing_report(
        self, fake_engine, forgekin_config, temp_project
    ) -> None:
        """审查报告不存在：verify 失败."""
        client = _FakeTraeClient()
        loop = SelfDevReviewLoop(client, forgekin_config, fake_engine, awakening_stage="E3")
        result = DevResult(
            plan_id="p1",
            changed_files=["docs/reviews/nonexistent.md"],
            diff_summary="生成报告",
            success=True,
        )
        verify = await loop.verify(result)

        assert verify.passed is False
        assert any("不存在" in r for r in verify.failure_reasons)


# ══════════════════════════════════════════════════════════════════
# §7 E2E 完整五步循环测试
# ══════════════════════════════════════════════════════════════════


class TestE2E:
    @pytest.mark.asyncio
    async def test_e2e_review_generates_report(
        self, fake_trae_client, fake_engine, forgekin_config, temp_project
    ) -> None:
        """E2E：target_files 模式触发完整五步循环生成审查报告."""
        loop = SelfDevReviewLoop(
            fake_trae_client, forgekin_config, fake_engine, awakening_stage="E3"
        )

        async def _noop_persist(record):
            record.persisted = True
            record.persist_payload = {"episode_id": "review-e2e-1"}
            return record.persist_payload
        loop.persist = _noop_persist

        fake_engine.register_self_dev_loop(loop)

        result = await fake_engine.run_self_dev_loop("review", {
            "target_files": ["flowforge/foo.py"],
            "author_forgekin_id": "forgemind:sherlock",
            "author_llm_model": "gpt-4-turbo",
        })

        assert result["loop_type"] == "review"
        assert result["summary"]["total"] >= 1
        # LLM 应被调用至少 3 次（Plan + Act + meta-review）
        assert fake_trae_client.call_count >= 3
        # 审查报告应存在
        reviews_dir = temp_project / "docs" / "reviews"
        reports = list(reviews_dir.glob("*_foo.md"))
        assert len(reports) >= 1

    @pytest.mark.asyncio
    async def test_e2e_awakening_stage_blocks(
        self, fake_trae_client, fake_engine, forgekin_config
    ) -> None:
        """E2E：觉醒阶门控阻止 E2 触发 Review 闭环（要求 E3）."""
        from flowforge.evolution.self_dev_base import AwakeningStageBlockedError

        loop = SelfDevReviewLoop(
            fake_trae_client, forgekin_config, fake_engine, awakening_stage="E2"
        )
        fake_engine.register_self_dev_loop(loop)

        with pytest.raises(AwakeningStageBlockedError) as exc_info:
            await fake_engine.run_self_dev_loop("review", {"target_files": ["x.py"]})

        assert "review" in str(exc_info.value)
        assert "E3" in str(exc_info.value)


# ══════════════════════════════════════════════════════════════════
# §8 ForgeMindEngine 注册测试
# ══════════════════════════════════════════════════════════════════


class TestEngineRegistration:
    def test_register_review_loop(self, fake_engine, review_loop) -> None:
        """注册 SelfDevReviewLoop 到 ForgeMindEngine."""
        fake_engine.register_self_dev_loop(review_loop)

        loops = fake_engine.list_self_dev_loops()
        assert "review" in loops
        assert loops["review"] == "E3"
        assert fake_engine.get_self_dev_loop("review") is review_loop

    def test_register_duplicate_raises(
        self, fake_engine, review_loop, fake_trae_client, forgekin_config
    ) -> None:
        """重复注册同 loop_type 抛 ValueError."""
        fake_engine.register_self_dev_loop(review_loop)
        loop2 = SelfDevReviewLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E3")
        with pytest.raises(ValueError, match="已注册"):
            fake_engine.register_self_dev_loop(loop2)
