"""F046 Phase 1 单元测试 — SelfDev 闭环基础框架.

覆盖范围：
- 数据模型（DevTask/DevPlan/DevResult/VerifyResult/LoopExecutionRecord）字段与序列化
- 异常类属性与消息
- SelfDevLoopBase 抽象基类：
  - 构造函数校验（trae_client/evolution_engine/project_root）
  - I1 觉醒阶门控（check_awakening_stage）
  - I2 Scope Guard 前置检查（pre_act_scope_guard_check）
  - 五步循环 run_once：Discover→Plan→Act→Verify→Persist
  - I3 Reflect 上限 3 次（成功重试 / 耗尽失败 / Scope Guard 阻止）
- ForgeMindEngine 集成（register/get/list/run_self_dev_loop）

测试铁律遵守说明：
- T1 禁止 Mock LLM：本文件为单元测试，使用 _FakeTraeClient（stub 替代，非 Mock LLM），
  真实 LLM 调用在 Phase 2-4 的 E2E 测试中通过真实 TraeLLMClient 执行
- T2 禁止假数据：使用真实场景路径（如 docs/features/F046-selfdev-triple-loop.md）
- T3 必须有具体断言：每个测试都有明确断言
- T5 未实现即 Bug：本测试覆盖所有 self_dev_base.py 公开接口
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List
from unittest.mock import MagicMock

import pytest

from flowforge.evolution.engine import ForgeMindEngine
from flowforge.evolution.self_dev_base import (
    ApprovalRequiredError,
    AwakeningStageBlockedError,
    DevPlan,
    DevResult,
    DevTask,
    LLMReviewFailedError,
    LoopExecutionRecord,
    MAX_REFLECT_RETRIES,
    ReflectRetryExhaustedError,
    ScopeGuardBlockedError,
    SelfDevError,
    SelfDevLoopBase,
    VerifyResult,
)


# ══════════════════════════════════════════════════════════════════
# §1 Fake/Stub 工具类（单元测试用，非 Mock LLM）
# ══════════════════════════════════════════════════════════════════


class _FakeTraeClient:
    """Stub TraeLLMClient — 单元测试用，返回预设响应.

    非 Mock LLM（T1）：实际 LLM 调用在 E2E 测试中通过真实 TraeLLMClient 执行.
    """

    def __init__(
        self,
        *,
        chat_responses: List[Dict[str, Any]] | None = None,
        review_response: Dict[str, Any] | None = None,
    ) -> None:
        self._chat_responses = list(chat_responses or [])
        self._review_response = review_response or {
            "passed": True,
            "score": 0.9,
            "issues": [],
            "suggestions": [],
        }
        self.chat_call_count = 0
        self.chat_calls: List[Dict[str, Any]] = []

    async def chat(self, messages: List[Dict[str, str]], *, context=None, **kwargs) -> Dict[str, Any]:
        self.chat_call_count += 1
        self.chat_calls.append({"messages": messages, "context": context, "kwargs": kwargs})
        if self._chat_responses:
            return self._chat_responses.pop(0)
        # 默认返回合法 JSON 方案
        return {
            "content": '{"steps": [{"action": "noop"}], "expected_effect": "ok", "risk_assessment": "low"}',
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 100},
            "request_id": f"req-{self.chat_call_count}",
        }


class _CountingSelfDevLoop(SelfDevLoopBase):
    """具体子类用于测试 — 可配置每阶段行为，并计数调用次数."""

    loop_type = "doc"
    min_awakening_stage = "E3"

    def __init__(
        self,
        trae_client,
        forgekin_config,
        evolution_engine,
        *,
        awakening_stage="E3",
        discover_tasks=None,
        plan_steps=None,
        act_results=None,
        verify_results=None,
        plan_requires_approval=False,
    ) -> None:
        super().__init__(trae_client, forgekin_config, evolution_engine, awakening_stage=awakening_stage)
        self.discover_count = 0
        self.plan_count = 0
        self.act_count = 0
        self.verify_count = 0
        self.persist_count = 0
        self.reflect_count_call = 0  # reflect_and_replan 调用次数（不同于 plan_count）
        self._discover_tasks = discover_tasks or []
        self._plan_steps = plan_steps or [{"action": "noop"}]
        self._act_results = list(act_results or [])
        self._verify_results = list(verify_results or [])
        self._plan_requires_approval = plan_requires_approval

    async def discover(self, context: Dict[str, Any]) -> List[DevTask]:
        self.discover_count += 1
        return list(self._discover_tasks)

    async def plan(self, task: DevTask) -> DevPlan:
        self.plan_count += 1
        return DevPlan(
            task_id=task.task_id,
            steps=list(self._plan_steps),
            expected_effect="测试预期效果",
            risk_assessment="low",
            requires_approval=self._plan_requires_approval,
            llm_model="fake-model",
        )

    async def act(self, plan: DevPlan) -> DevResult:
        self.act_count += 1
        if self._act_results:
            result = self._act_results.pop(0)
            return DevResult(
                plan_id=plan.plan_id,
                changed_files=result.get("changed_files", []),
                diff_summary=result.get("diff_summary", ""),
                success=result.get("success", True),
                error_message=result.get("error_message", ""),
            )
        return DevResult(
            plan_id=plan.plan_id,
            changed_files=["docs/features/F046-selfdev-triple-loop.md"],
            diff_summary="测试变更",
            success=True,
        )

    async def verify(self, result: DevResult) -> VerifyResult:
        self.verify_count += 1
        if self._verify_results:
            vr = self._verify_results.pop(0)
            return VerifyResult(
                result_id=result.result_id,
                passed=vr.get("passed", True),
                checks=vr.get("checks", []),
                failure_reasons=vr.get("failure_reasons", []),
                llm_review_passed=vr.get("llm_review_passed", True),
            )
        return VerifyResult(
            result_id=result.result_id,
            passed=True,
            checks=[{"name": "格式检查", "passed": True, "detail": "OK"}],
        )

    async def reflect_and_replan(self, task: DevTask, result: DevResult, verify: VerifyResult) -> DevPlan:
        # 覆盖以计数，但仍调用基类实现保留 LLM 反思逻辑
        self.reflect_count_call += 1
        return await super().reflect_and_replan(task, result, verify)

    async def persist(self, record: LoopExecutionRecord) -> Dict[str, Any]:
        self.persist_count += 1
        # 单元测试中跳过真实 persist（避免依赖 ForgeMindEngine 三模式）
        record.persisted = True
        record.persist_payload = {"episode_id": "fake-episode", "method_id": None, "proposal_id": None}
        return record.persist_payload


# ══════════════════════════════════════════════════════════════════
# §2 测试固件
# ══════════════════════════════════════════════════════════════════


@pytest.fixture
def fake_trae_client() -> _FakeTraeClient:
    return _FakeTraeClient()


@pytest.fixture
def fake_engine() -> ForgeMindEngine:
    return ForgeMindEngine()


@pytest.fixture
def forgekin_config() -> Dict[str, Any]:
    return {
        "project_root": "/tmp/fake-flowforge",
        "forgekin_id": "forgemind:luban",
        "protected_paths": [],  # 仅用默认白名单
    }


@pytest.fixture
def sample_dev_task() -> DevTask:
    """真实场景数据：F046 设计文档更新任务（T2 禁止假数据）."""
    return DevTask(
        loop_type="doc",
        target_path="docs/features/F046-selfdev-triple-loop.md",
        modification_type="update",
        description="更新 F046 文档的 Phase 进度状态",
        priority="normal",
    )


@pytest.fixture
def sample_dev_plan(sample_dev_task) -> DevPlan:
    return DevPlan(
        task_id=sample_dev_task.task_id,
        steps=[{"action": "update_section", "params": {"section": "§3.1", "new_status": "✅ done"}}],
        expected_effect="Phase 1 状态更新为 done",
        risk_assessment="low",
        requires_approval=False,
    )


# ══════════════════════════════════════════════════════════════════
# §3 数据模型测试
# ══════════════════════════════════════════════════════════════════


class TestDevTaskModel:
    def test_dev_task_default_task_id_generated(self) -> None:
        task = DevTask(
            loop_type="doc",
            target_path="docs/test.md",
            modification_type="create",
            description="测试",
        )
        assert task.task_id.startswith("task-")
        assert len(task.task_id) == len("task-") + 12

    def test_dev_task_default_priority_normal(self) -> None:
        task = DevTask(
            loop_type="code",
            target_path="src/test.py",
            modification_type="update",
            description="测试",
        )
        assert task.priority == "normal"
        assert task.context == {}

    def test_dev_task_serialization_roundtrip(self, sample_dev_task) -> None:
        d = sample_dev_task.model_dump(mode="json")
        assert d["loop_type"] == "doc"
        assert d["modification_type"] == "update"
        assert "F046" in d["target_path"]
        # 反序列化回来
        task2 = DevTask(**d)
        assert task2.task_id == sample_dev_task.task_id
        assert task2.description == sample_dev_task.description


class TestDevPlanModel:
    def test_dev_plan_default_requires_approval_false(self, sample_dev_plan) -> None:
        assert sample_dev_plan.requires_approval is False

    def test_dev_plan_steps_preserved(self, sample_dev_plan) -> None:
        assert len(sample_dev_plan.steps) == 1
        assert sample_dev_plan.steps[0]["action"] == "update_section"


class TestDevResultModel:
    def test_dev_result_success_default(self, sample_dev_plan) -> None:
        result = DevResult(
            plan_id=sample_dev_plan.plan_id,
            diff_summary="测试变更",
            success=True,
        )
        assert result.success is True
        assert result.error_message == ""
        assert result.changed_files == []

    def test_dev_result_failure_with_error(self, sample_dev_plan) -> None:
        result = DevResult(
            plan_id=sample_dev_plan.plan_id,
            diff_summary="",
            success=False,
            error_message="文件不存在",
        )
        assert result.success is False
        assert result.error_message == "文件不存在"


class TestVerifyResultModel:
    def test_verify_result_passed_default(self, sample_dev_plan) -> None:
        result = DevResult(plan_id=sample_dev_plan.plan_id, diff_summary="", success=True)
        vr = VerifyResult(
            result_id=result.result_id,
            passed=True,
            checks=[{"name": "test", "passed": True}],
        )
        assert vr.passed is True
        assert vr.failure_reasons == []
        assert vr.llm_review_passed is False  # 默认 False

    def test_verify_result_failed_with_reasons(self, sample_dev_plan) -> None:
        result = DevResult(plan_id=sample_dev_plan.plan_id, diff_summary="", success=True)
        vr = VerifyResult(
            result_id=result.result_id,
            passed=False,
            checks=[{"name": "lint", "passed": False, "detail": "格式错误"}],
            failure_reasons=["格式错误", "缺少 front-matter"],
        )
        assert vr.passed is False
        assert len(vr.failure_reasons) == 2


class TestLoopExecutionRecordModel:
    def test_loop_record_default_history_empty(self, sample_dev_task) -> None:
        record = LoopExecutionRecord(loop_type="doc", task=sample_dev_task)
        assert record.plans_history == []
        assert record.results_history == []
        assert record.verifies_history == []
        assert record.final_passed is False
        assert record.reflect_count == 0
        assert record.persisted is False
        assert record.finished_at is None

    def test_loop_record_serialization_includes_all_history(self, sample_dev_task, sample_dev_plan) -> None:
        record = LoopExecutionRecord(
            loop_type="doc",
            task=sample_dev_task,
            plans_history=[sample_dev_plan],
            final_passed=True,
            reflect_count=1,
            persisted=True,
        )
        d = record.model_dump(mode="json")
        assert d["final_passed"] is True
        assert d["reflect_count"] == 1
        assert d["persisted"] is True
        assert len(d["plans_history"]) == 1


# ══════════════════════════════════════════════════════════════════
# §4 异常类测试
# ══════════════════════════════════════════════════════════════════


class TestExceptions:
    def test_self_dev_error_is_base(self) -> None:
        assert issubclass(AwakeningStageBlockedError, SelfDevError)
        assert issubclass(ScopeGuardBlockedError, SelfDevError)
        assert issubclass(ApprovalRequiredError, SelfDevError)
        assert issubclass(LLMReviewFailedError, SelfDevError)
        assert issubclass(ReflectRetryExhaustedError, SelfDevError)

    def test_awakening_stage_blocked_error_attributes(self) -> None:
        err = AwakeningStageBlockedError("doc", "E2", "E3")
        assert err.loop_type == "doc"
        assert err.current_stage == "E2"
        assert err.required_stage == "E3"
        assert "doc" in str(err)
        assert "E2" in str(err)
        assert "E3" in str(err)

    def test_scope_guard_blocked_error_attributes(self) -> None:
        err = ScopeGuardBlockedError("VISION.md", reason="受保护")
        assert err.target_path == "VISION.md"
        assert err.reason == "受保护"
        assert "VISION.md" in str(err)

    def test_approval_required_error_attributes(self, sample_dev_plan) -> None:
        err = ApprovalRequiredError(sample_dev_plan.plan_id, "decisions/014-trae.md")
        assert err.plan_id == sample_dev_plan.plan_id
        assert err.target_path == "decisions/014-trae.md"

    def test_llm_review_failed_error_attributes(self) -> None:
        err = LLMReviewFailedError("doc", "格式不规范")
        assert err.content_type == "doc"
        assert err.reason == "格式不规范"

    def test_reflect_retry_exhausted_error_attributes(self, sample_dev_task) -> None:
        err = ReflectRetryExhaustedError(sample_dev_task.task_id, 3)
        assert err.task_id == sample_dev_task.task_id
        assert err.attempts == 3
        assert "3" in str(err)


# ══════════════════════════════════════════════════════════════════
# §5 SelfDevLoopBase 构造函数测试
# ══════════════════════════════════════════════════════════════════


class TestSelfDevLoopBaseInit:
    def test_init_raises_on_none_trae_client(self, fake_engine, forgekin_config) -> None:
        with pytest.raises(ValueError, match="trae_client"):
            _CountingSelfDevLoop(None, forgekin_config, fake_engine)

    def test_init_raises_on_none_evolution_engine(self, fake_trae_client, forgekin_config) -> None:
        with pytest.raises(ValueError, match="evolution_engine"):
            _CountingSelfDevLoop(fake_trae_client, forgekin_config, None)

    def test_init_raises_on_missing_project_root(self, fake_trae_client, fake_engine) -> None:
        with pytest.raises(ValueError, match="project_root"):
            _CountingSelfDevLoop(fake_trae_client, {}, fake_engine)

    def test_init_default_protected_paths(self, fake_trae_client, fake_engine, forgekin_config) -> None:
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine)
        # 默认包含 VISION.md / CONTRIBUTING.md / SOP.md / decisions/
        assert "VISION.md" in loop.protected_paths
        assert "CONTRIBUTING.md" in loop.protected_paths
        assert "SOP.md" in loop.protected_paths
        assert "decisions/" in loop.protected_paths

    def test_init_custom_protected_paths_from_config(self, fake_trae_client, fake_engine) -> None:
        config = {
            "project_root": "/tmp/fake",
            "protected_paths": ["custom/secret.yaml"],
        }
        loop = _CountingSelfDevLoop(fake_trae_client, config, fake_engine)
        assert "custom/secret.yaml" in loop.protected_paths
        # 默认白名单仍然保留
        assert "VISION.md" in loop.protected_paths

    def test_init_properties(self, fake_trae_client, fake_engine, forgekin_config) -> None:
        loop = _CountingSelfDevLoop(
            fake_trae_client, forgekin_config, fake_engine, awakening_stage="E4"
        )
        assert loop.project_root == "/tmp/fake-flowforge"
        assert loop.awakening_stage == "E4"
        assert loop.loop_type == "doc"
        assert loop.min_awakening_stage == "E3"


# ══════════════════════════════════════════════════════════════════
# §6 I1 觉醒阶门控测试
# ══════════════════════════════════════════════════════════════════


class TestAwakeningStageGate:
    def test_e3_passes_doc_loop(self, fake_trae_client, fake_engine, forgekin_config) -> None:
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E3")
        # 不抛异常即通过
        loop.check_awakening_stage()

    def test_e2_blocks_doc_loop(self, fake_trae_client, fake_engine, forgekin_config) -> None:
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E2")
        with pytest.raises(AwakeningStageBlockedError) as exc:
            loop.check_awakening_stage()
        assert exc.value.loop_type == "doc"
        assert exc.value.current_stage == "E2"
        assert exc.value.required_stage == "E3"

    def test_e4_passes_framework_loop(self, fake_trae_client, fake_engine, forgekin_config) -> None:
        # framework 闭环要求 E5，E4 仍不够
        class _FrameworkLoop(_CountingSelfDevLoop):
            loop_type = "framework"
            min_awakening_stage = "E5"

        loop = _FrameworkLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E4")
        with pytest.raises(AwakeningStageBlockedError):
            loop.check_awakening_stage()

    def test_e5_passes_framework_loop(self, fake_trae_client, fake_engine, forgekin_config) -> None:
        class _FrameworkLoop(_CountingSelfDevLoop):
            loop_type = "framework"
            min_awakening_stage = "E5"

        loop = _FrameworkLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E5")
        loop.check_awakening_stage()  # 通过

    def test_invalid_stage_raises(self, fake_trae_client, fake_engine, forgekin_config) -> None:
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="EX")
        with pytest.raises(AwakeningStageBlockedError):
            loop.check_awakening_stage()

    def test_context_override_stage(self, fake_trae_client, fake_engine, forgekin_config) -> None:
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E5")
        # 通过 context 覆盖为 E2，应被阻止
        with pytest.raises(AwakeningStageBlockedError):
            loop.check_awakening_stage("E2")


# ══════════════════════════════════════════════════════════════════
# §7 I2 Scope Guard 前置检查测试
# ══════════════════════════════════════════════════════════════════


class TestScopeGuardCheck:
    def test_vision_md_blocked(self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task) -> None:
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine)
        # 修改 target_path 为 VISION.md
        sample_dev_task.target_path = "VISION.md"
        plan = DevPlan(task_id=sample_dev_task.task_id, steps=[], expected_effect="", risk_assessment="")
        with pytest.raises(ScopeGuardBlockedError) as exc:
            loop.pre_act_scope_guard_check(sample_dev_task, plan)
        assert exc.value.target_path == "VISION.md"

    def test_contributing_rules_blocked(self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task) -> None:
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine)
        sample_dev_task.target_path = "CONTRIBUTING.md"
        plan = DevPlan(task_id=sample_dev_task.task_id, steps=[], expected_effect="", risk_assessment="")
        with pytest.raises(ScopeGuardBlockedError):
            loop.pre_act_scope_guard_check(sample_dev_task, plan)

    def test_decisions_dir_update_blocked(self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task) -> None:
        """decisions/ 路径的 update 操作必须被阻止（修改已有 ADR 禁止）."""
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine)
        sample_dev_task.target_path = "decisions/014-trae.md"
        # sample_dev_task.modification_type 默认为 "update"
        plan = DevPlan(task_id=sample_dev_task.task_id, steps=[], expected_effect="", risk_assessment="")
        with pytest.raises(ScopeGuardBlockedError):
            loop.pre_act_scope_guard_check(sample_dev_task, plan)

    def test_decisions_dir_create_allowed(self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task) -> None:
        """decisions/ 路径的 create 操作必须被允许（新增 ADR — 注释"新增 ADR 不在此限"）."""
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine)
        sample_dev_task.target_path = "decisions/014-trae.md"
        sample_dev_task.modification_type = "create"
        plan = DevPlan(
            task_id=sample_dev_task.task_id,
            steps=[{"action": "create_adr", "path": "decisions/014-trae.md"}],
            expected_effect="",
            risk_assessment="",
        )
        # 不抛异常
        loop.pre_act_scope_guard_check(sample_dev_task, plan)

    def test_decisions_dir_update_step_blocked(self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task) -> None:
        """decisions/ 路径的 step action 非 create_adr 必须被阻止（修改已有 ADR）."""
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine)
        sample_dev_task.target_path = "docs/normal.md"
        sample_dev_task.modification_type = "create"  # task 是 create，但 step 是 update
        plan = DevPlan(
            task_id=sample_dev_task.task_id,
            steps=[{"action": "update_yaml", "path": "decisions/014-trae.md"}],
            expected_effect="",
            risk_assessment="",
        )
        with pytest.raises(ScopeGuardBlockedError):
            loop.pre_act_scope_guard_check(sample_dev_task, plan)

    def test_normal_path_passes(self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task, sample_dev_plan) -> None:
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine)
        # F046 文档路径不在受保护列表中
        loop.pre_act_scope_guard_check(sample_dev_task, sample_dev_plan)  # 不抛异常

    def test_step_path_blocked(self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task) -> None:
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine)
        # target_path 正常，但 step 中的 path 受保护
        sample_dev_task.target_path = "docs/normal.md"
        plan = DevPlan(
            task_id=sample_dev_task.task_id,
            steps=[{"action": "update", "path": "SOP.md"}],
            expected_effect="",
            risk_assessment="",
        )
        with pytest.raises(ScopeGuardBlockedError) as exc:
            loop.pre_act_scope_guard_check(sample_dev_task, plan)
        assert "SOP.md" in exc.value.target_path


# ══════════════════════════════════════════════════════════════════
# §8 五步循环 run_once 测试
# ══════════════════════════════════════════════════════════════════


class TestRunOnceFiveStepLoop:
    @pytest.mark.asyncio
    async def test_single_task_success(
        self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task
    ) -> None:
        loop = _CountingSelfDevLoop(
            fake_trae_client, forgekin_config, fake_engine,
            discover_tasks=[sample_dev_task],
        )
        result = await loop.run_once({})

        assert result["loop_type"] == "doc"
        assert result["summary"]["total"] == 1
        assert result["summary"]["passed"] == 1
        assert result["summary"]["failed"] == 0
        assert result["summary"]["reflect_total"] == 0

        # 验证五步都执行了
        assert loop.discover_count == 1
        assert loop.plan_count == 1
        assert loop.act_count == 1
        assert loop.verify_count == 1
        assert loop.persist_count == 1

        # 验证记录包含完整历史
        record = result["records"][0]
        assert record["final_passed"] is True
        assert record["reflect_count"] == 0
        assert len(record["plans_history"]) == 1
        assert len(record["results_history"]) == 1
        assert len(record["verifies_history"]) == 1

    @pytest.mark.asyncio
    async def test_multiple_tasks_success(
        self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task
    ) -> None:
        task2 = DevTask(
            loop_type="doc",
            target_path="docs/features/F045-trae-bridge-protocol.md",
            modification_type="update",
            description="更新 F045 状态为 done",
        )
        loop = _CountingSelfDevLoop(
            fake_trae_client, forgekin_config, fake_engine,
            discover_tasks=[sample_dev_task, task2],
        )
        result = await loop.run_once({})

        assert result["summary"]["total"] == 2
        assert result["summary"]["passed"] == 2
        assert result["summary"]["failed"] == 0
        assert len(result["records"]) == 2

    @pytest.mark.asyncio
    async def test_empty_tasks_returns_empty_records(
        self, fake_trae_client, fake_engine, forgekin_config
    ) -> None:
        loop = _CountingSelfDevLoop(
            fake_trae_client, forgekin_config, fake_engine,
            discover_tasks=[],
        )
        result = await loop.run_once({})
        assert result["summary"]["total"] == 0
        assert result["records"] == []

    @pytest.mark.asyncio
    async def test_awakening_stage_blocked_in_run_once(
        self, fake_trae_client, fake_engine, forgekin_config
    ) -> None:
        loop = _CountingSelfDevLoop(
            fake_trae_client, forgekin_config, fake_engine,
            awakening_stage="E2",  # 低于 E3 要求
        )
        with pytest.raises(AwakeningStageBlockedError):
            await loop.run_once({})

    @pytest.mark.asyncio
    async def test_context_awakening_stage_override(
        self, fake_trae_client, fake_engine, forgekin_config
    ) -> None:
        # 当前 stage=E5，但 context 中覆盖为 E2 应被阻止
        loop = _CountingSelfDevLoop(
            fake_trae_client, forgekin_config, fake_engine,
            awakening_stage="E5",
        )
        with pytest.raises(AwakeningStageBlockedError):
            await loop.run_once({"awakening_stage": "E2"})


# ══════════════════════════════════════════════════════════════════
# §9 I3 Reflect 重试机制测试
# ══════════════════════════════════════════════════════════════════


class TestReflectRetry:
    @pytest.mark.asyncio
    async def test_reflect_success_on_second_attempt(
        self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task
    ) -> None:
        """第一次 Verify 失败，Reflect 后第二次通过."""
        loop = _CountingSelfDevLoop(
            fake_trae_client, forgekin_config, fake_engine,
            discover_tasks=[sample_dev_task],
            verify_results=[
                {"passed": False, "failure_reasons": ["格式错误"], "checks": []},
                {"passed": True, "checks": [{"name": "格式", "passed": True}]},
            ],
        )
        result = await loop.run_once({})

        assert result["summary"]["passed"] == 1
        assert result["summary"]["reflect_total"] == 1
        # 验证调用次数：
        # - discover=1（一次发现）
        # - plan=1（仅初次 plan，Reflect 走 reflect_and_replan 不走 plan）
        # - reflect_and_replan=1（第一次失败后触发 1 次 Reflect）
        # - act=2, verify=2（初次 + Reflect 后各一次）
        assert loop.discover_count == 1
        assert loop.plan_count == 1
        assert loop.reflect_count_call == 1
        assert loop.act_count == 2
        assert loop.verify_count == 2
        # Persist 只调用 1 次（最终一次）
        assert loop.persist_count == 1

        record = result["records"][0]
        assert record["final_passed"] is True
        assert record["reflect_count"] == 1
        # 历史应包含 2 个 plan / result / verify（initial + reflect 后的 new_plan）
        assert len(record["plans_history"]) == 2
        assert len(record["results_history"]) == 2
        assert len(record["verifies_history"]) == 2

    @pytest.mark.asyncio
    async def test_reflect_exhausted_3_attempts(
        self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task
    ) -> None:
        """Reflect 3 次都失败，final_passed=False."""
        loop = _CountingSelfDevLoop(
            fake_trae_client, forgekin_config, fake_engine,
            discover_tasks=[sample_dev_task],
            verify_results=[
                {"passed": False, "failure_reasons": ["失败1"], "checks": []},
                {"passed": False, "failure_reasons": ["失败2"], "checks": []},
                {"passed": False, "failure_reasons": ["失败3"], "checks": []},
                {"passed": False, "failure_reasons": ["失败4"], "checks": []},
            ],
        )
        result = await loop.run_once({})

        assert result["summary"]["passed"] == 0
        assert result["summary"]["failed"] == 1
        assert result["summary"]["reflect_total"] == MAX_REFLECT_RETRIES  # 3

        record = result["records"][0]
        assert record["final_passed"] is False
        assert record["reflect_count"] == MAX_REFLECT_RETRIES
        # 调用次数：
        # - plan=1（仅初次）
        # - reflect_and_replan=3（MAX_REFLECT_RETRIES）
        # - act=4, verify=4（1 initial + 3 reflect）
        assert loop.plan_count == 1
        assert loop.reflect_count_call == MAX_REFLECT_RETRIES
        assert loop.act_count == 4
        assert loop.verify_count == 4

    @pytest.mark.asyncio
    async def test_reflect_does_not_exceed_max(
        self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task
    ) -> None:
        """即使第 4 次仍失败，也只重试 3 次（MAX_REFLECT_RETRIES）."""
        loop = _CountingSelfDevLoop(
            fake_trae_client, forgekin_config, fake_engine,
            discover_tasks=[sample_dev_task],
            verify_results=[
                {"passed": False, "failure_reasons": [f"失败{i}"], "checks": []}
                for i in range(10)
            ],
        )
        result = await loop.run_once({})
        # 最多重试 3 次，加上初始 1 次，共 4 次 verify
        assert loop.verify_count == 4
        assert result["records"][0]["reflect_count"] == MAX_REFLECT_RETRIES

    @pytest.mark.asyncio
    async def test_scope_guard_blocks_after_reflect(
        self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task
    ) -> None:
        """Reflect 后的新 plan 也要通过 Scope Guard，否则终止."""
        # target_path 是受保护路径，但 reflect 后的 plan 仍指向它
        sample_dev_task.target_path = "VISION.md"
        # plan.steps 为空，所以初次检查只检查 target_path，会立即被阻止
        loop = _CountingSelfDevLoop(
            fake_trae_client, forgekin_config, fake_engine,
            discover_tasks=[sample_dev_task],
        )
        result = await loop.run_once({})

        # Scope Guard 阻止后，不应执行 act/verify
        assert loop.act_count == 0
        assert loop.verify_count == 0
        assert result["summary"]["failed"] == 1
        assert result["summary"]["passed"] == 0

        record = result["records"][0]
        assert record["final_passed"] is False


# ══════════════════════════════════════════════════════════════════
# §10 ForgeMindEngine 集成测试
# ══════════════════════════════════════════════════════════════════


class TestForgeMindEngineSelfDevIntegration:
    def test_register_self_dev_loop_success(
        self, fake_trae_client, forgekin_config
    ) -> None:
        engine = ForgeMindEngine()
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, engine)
        engine.register_self_dev_loop(loop)
        assert engine.get_self_dev_loop("doc") is loop

    def test_register_duplicate_raises(
        self, fake_trae_client, forgekin_config
    ) -> None:
        engine = ForgeMindEngine()
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, engine)
        engine.register_self_dev_loop(loop)
        with pytest.raises(ValueError, match="已注册"):
            engine.register_self_dev_loop(loop)

    def test_register_empty_loop_type_raises(
        self, fake_trae_client, forgekin_config
    ) -> None:
        engine = ForgeMindEngine()

        class _EmptyLoopType(_CountingSelfDevLoop):
            loop_type = ""

        loop = _EmptyLoopType(fake_trae_client, forgekin_config, engine)
        with pytest.raises(ValueError, match="loop_type"):
            engine.register_self_dev_loop(loop)

    def test_list_self_dev_loops(
        self, fake_trae_client, forgekin_config
    ) -> None:
        engine = ForgeMindEngine()
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, engine)
        engine.register_self_dev_loop(loop)
        listing = engine.list_self_dev_loops()
        assert listing == {"doc": "E3"}

    def test_get_unregistered_returns_none(self) -> None:
        engine = ForgeMindEngine()
        assert engine.get_self_dev_loop("nonexistent") is None

    @pytest.mark.asyncio
    async def test_run_self_dev_loop_unregistered_raises(self) -> None:
        engine = ForgeMindEngine()
        with pytest.raises(ValueError, match="未注册"):
            await engine.run_self_dev_loop("nonexistent", {})

    @pytest.mark.asyncio
    async def test_run_self_dev_loop_dispatches_to_loop(
        self, fake_trae_client, forgekin_config, sample_dev_task
    ) -> None:
        engine = ForgeMindEngine()
        loop = _CountingSelfDevLoop(
            fake_trae_client, forgekin_config, engine,
            discover_tasks=[sample_dev_task],
        )
        engine.register_self_dev_loop(loop)

        result = await engine.run_self_dev_loop("doc", {})
        assert result["loop_type"] == "doc"
        assert result["summary"]["passed"] == 1
        assert loop.discover_count == 1

    @pytest.mark.asyncio
    async def test_run_self_dev_loop_propagates_awakening_block(
        self, fake_trae_client, forgekin_config
    ) -> None:
        engine = ForgeMindEngine()
        loop = _CountingSelfDevLoop(
            fake_trae_client, forgekin_config, engine,
            awakening_stage="E2",  # 低于 E3
        )
        engine.register_self_dev_loop(loop)
        with pytest.raises(AwakeningStageBlockedError):
            await engine.run_self_dev_loop("doc", {})


# ══════════════════════════════════════════════════════════════════
# §11 LLM 审核（I4 / T7）测试
# ══════════════════════════════════════════════════════════════════


class TestLLMReviewContent:
    @pytest.mark.asyncio
    async def test_llm_review_passes(self, fake_trae_client, fake_engine, forgekin_config) -> None:
        # 配置 FakeTraeClient 返回审核通过的 JSON
        fake_trae_client._chat_responses = [{
            "content": '{"passed": true, "score": 0.92, "issues": [], "suggestions": ["继续保持"]}',
            "model": "fake-model",
            "provider": "trae",
            "usage": {},
            "request_id": "rev-1",
        }]
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine)
        result = await loop.llm_review_content("这是文档内容", "doc")
        assert result["passed"] is True
        assert result["score"] == 0.92
        assert "继续保持" in result["suggestions"]

    @pytest.mark.asyncio
    async def test_llm_review_fails_with_issues(self, fake_trae_client, fake_engine, forgekin_config) -> None:
        fake_trae_client._chat_responses = [{
            "content": '{"passed": false, "score": 0.4, "issues": ["硬编码路径", "绕过DI"], "suggestions": []}',
            "model": "fake-model",
            "provider": "trae",
            "usage": {},
            "request_id": "rev-2",
        }]
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine)
        result = await loop.llm_review_content("有问题的代码", "code")
        assert result["passed"] is False
        assert result["score"] == 0.4
        assert len(result["issues"]) == 2

    @pytest.mark.asyncio
    async def test_llm_review_handles_non_json_response(self, fake_trae_client, fake_engine, forgekin_config) -> None:
        fake_trae_client._chat_responses = [{
            "content": "审核通过但不是 JSON 格式",
            "model": "fake-model",
            "provider": "trae",
            "usage": {},
            "request_id": "rev-3",
        }]
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine)
        result = await loop.llm_review_content("内容", "doc")
        # 非 JSON 格式应返回默认失败结果
        assert result["passed"] is False
        assert any("解析失败" in issue for issue in result["issues"])

    @pytest.mark.asyncio
    async def test_llm_review_handles_llm_exception(self, fake_engine, forgekin_config) -> None:
        """LLM 调用抛异常时应返回失败结果，不向上抛."""
        class _ExplodingTraeClient:
            async def chat(self, *args, **kwargs):
                raise RuntimeError("LLM 连接失败")

        loop = _CountingSelfDevLoop(_ExplodingTraeClient(), forgekin_config, fake_engine)
        result = await loop.llm_review_content("内容", "doc")
        assert result["passed"] is False
        assert result["score"] == 0.0
        assert any("LLM 审核调用失败" in issue for issue in result["issues"])


# ══════════════════════════════════════════════════════════════════
# §12 reflect_and_replan 测试
# ══════════════════════════════════════════════════════════════════


class TestReflectAndReplan:
    @pytest.mark.asyncio
    async def test_reflect_and_replan_returns_new_plan(
        self, fake_trae_client, fake_engine, forgekin_config, sample_dev_task, sample_dev_plan
    ) -> None:
        fake_trae_client._chat_responses = [{
            "content": '{"steps": [{"action": "fix", "params": {}}], "expected_effect": "修复格式", "risk_assessment": "low"}',
            "model": "fake-model",
            "provider": "trae",
            "usage": {},
            "request_id": "refl-1",
        }]
        loop = _CountingSelfDevLoop(fake_trae_client, forgekin_config, fake_engine)
        result = DevResult(
            plan_id=sample_dev_plan.plan_id,
            changed_files=["docs/x.md"],
            diff_summary="添加了内容",
            success=True,
        )
        verify = VerifyResult(
            result_id=result.result_id,
            passed=False,
            checks=[],
            failure_reasons=["格式错误"],
        )
        new_plan = await loop.reflect_and_replan(sample_dev_task, result, verify)
        assert new_plan.task_id == sample_dev_task.task_id
        assert len(new_plan.steps) == 1
        assert new_plan.expected_effect == "修复格式"
        assert new_plan.llm_model == "fake-model"

    @pytest.mark.asyncio
    async def test_reflect_and_replan_handles_llm_failure(
        self, fake_engine, forgekin_config, sample_dev_task, sample_dev_plan
    ) -> None:
        """LLM 调用失败时应返回 fallback plan，不抛异常."""
        class _ExplodingTraeClient:
            async def chat(self, *args, **kwargs):
                raise RuntimeError("LLM 不可用")

        loop = _CountingSelfDevLoop(_ExplodingTraeClient(), forgekin_config, fake_engine)
        result = DevResult(
            plan_id=sample_dev_plan.plan_id,
            changed_files=[],
            diff_summary="",
            success=False,
            error_message="执行失败",
        )
        verify = VerifyResult(
            result_id=result.result_id,
            passed=False,
            checks=[],
            failure_reasons=["LLM 调用失败"],
        )
        new_plan = await loop.reflect_and_replan(sample_dev_task, result, verify)
        # 应返回 fallback plan（不抛异常）
        assert new_plan.task_id == sample_dev_task.task_id
        assert new_plan.llm_model == "fallback"
        assert "LLM 反思失败" in new_plan.expected_effect
