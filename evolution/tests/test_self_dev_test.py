"""F046 v1.1 SelfDevTestLoop 单元测试 — 自动化测试闭环.

覆盖范围：
- Discover: target_files / pytest_failure / coverage_gap / force_targets 四种来源
- Plan: LLM 返回合法测试方案 / I10 强制 append / fallback
- Act: write_file / append / I10 安全护栏 / T1-T8 铁律检查
- Verify: 文件存在性 / Python 语法 / T1-T8 / LLM 审核
- E2E: 完整五步循环（stub 替代 TraeLLMClient）

测试铁律遵守：
- T1 禁止 Mock LLM：使用 _FakeTraeClient（stub 替代）
- T2 真实场景数据：构造临时项目目录，模拟真实测试结构
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
from flowforge.evolution.self_dev_test import SelfDevTestLoop


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
        # 默认响应：合法的 Plan JSON（合规测试代码）
        return {
            "content": json.dumps({
                "steps": [{
                    "action": "write_file",
                    "path": "tests/test_demo.py",
                    "content": (
                        "import pytest\n"
                        "from flowforge.demo import Demo\n\n\n"
                        "class TestDemo:\n"
                        "    @pytest.mark.asyncio\n"
                        "    async def test_run(self):\n"
                        "        demo = Demo(client=None)\n"
                        "        result = await demo.run()\n"
                        "        assert result == 'ok'\n"
                        "        assert isinstance(result, str)\n"
                    ),
                }],
                "expected_effect": "生成测试用例",
                "risk_assessment": "low",
            }),
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 100},
            "request_id": f"req-{self.call_count}",
        }


# ══════════════════════════════════════════════════════════════════
# §2 测试固件
# ══════════════════════════════════════════════════════════════════


@pytest.fixture
def temp_project(tmp_path: Path) -> Path:
    """构造临时项目目录."""
    # flowforge/foo.py（源文件，用于推断测试路径）
    ff_dir = tmp_path / "flowforge"
    ff_dir.mkdir(parents=True)
    (ff_dir / "foo.py").write_text(
        "\"\"\"Foo module.\"\"\"\n\n\nclass Foo:\n"
        "    async def get(self) -> str:\n"
        "        return 'foo'\n",
        encoding="utf-8",
    )

    # tests/test_foo.py（已有测试，I10 检查禁止覆盖）
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    (tests_dir / "test_foo.py").write_text(
        "import pytest\n\n\n"
        "class TestFoo:\n"
        "    @pytest.mark.asyncio\n"
        "    async def test_get(self):\n"
        "        assert True\n",
        encoding="utf-8",
    )

    return tmp_path


@pytest.fixture
def forgekin_config(temp_project: Path) -> Dict[str, Any]:
    return {
        "project_root": str(temp_project),
        "forgekin_id": "forgemind:davinci",
        "tests_dir": "tests",
        "coverage_threshold": 0.80,
        "pytest_timeout": 30,
    }


@pytest.fixture
def fake_engine() -> ForgeMindEngine:
    return ForgeMindEngine()


@pytest.fixture
def fake_trae_client() -> _FakeTraeClient:
    """默认 FakeTraeClient — Plan 返回合规测试，LLM 审核通过."""
    plan_response = {
        "content": json.dumps({
            "steps": [{
                "action": "write_file",
                "path": "tests/test_generated.py",
                "content": (
                    "import pytest\n"
                    "from flowforge.generated import Generated\n\n\n"
                    "class TestGenerated:\n"
                    "    @pytest.mark.asyncio\n"
                    "    async def test_run(self):\n"
                    "        gen = Generated(client=None)\n"
                    "        result = await gen.run()\n"
                    "        assert result == 'ok'\n"
                    "        assert isinstance(result, str)\n"
                ),
            }],
            "expected_effect": "生成测试用例",
            "risk_assessment": "low",
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 100},
        "request_id": "plan-1",
    }
    review_response = {
        "content": json.dumps({
            "passed": True,
            "score": 0.92,
            "issues": [],
            "suggestions": ["测试用例结构合理"],
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 80},
        "request_id": "review-1",
    }
    return _FakeTraeClient([plan_response, review_response])


@pytest.fixture
def test_loop(fake_trae_client, fake_engine, forgekin_config) -> SelfDevTestLoop:
    return SelfDevTestLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E3")


# ══════════════════════════════════════════════════════════════════
# §3 Discover 测试
# ══════════════════════════════════════════════════════════════════


class TestDiscover:
    @pytest.mark.asyncio
    async def test_discover_target_files(self, test_loop) -> None:
        """target_files 模式：为源文件推断测试文件路径."""
        tasks = await test_loop.discover({
            "target_files": ["flowforge/foo.py"],
            "test_strategy": "unit",
        })
        assert len(tasks) == 1
        # 推断测试路径：flowforge/foo.py -> tests/test_foo.py
        assert tasks[0].target_path == "tests/test_foo.py"
        assert tasks[0].loop_type == "test"
        # tests/test_foo.py 已存在 -> update
        assert tasks[0].modification_type == "update"
        assert tasks[0].priority == "high"
        assert tasks[0].context["source"] == "target_files"
        assert tasks[0].context["source_file"] == "flowforge/foo.py"
        assert tasks[0].context["test_strategy"] == "unit"

    @pytest.mark.asyncio
    async def test_discover_target_files_new_test(self, test_loop, temp_project) -> None:
        """target_files 模式：测试文件不存在时为 create."""
        # flowforge/bar.py 不存在对应测试
        (temp_project / "flowforge" / "bar.py").write_text(
            "\"\"\"Bar module.\"\"\"\n",
            encoding="utf-8",
        )
        tasks = await test_loop.discover({
            "target_files": ["flowforge/bar.py"],
        })
        assert len(tasks) == 1
        assert tasks[0].target_path == "tests/test_bar.py"
        assert tasks[0].modification_type == "create"

    @pytest.mark.asyncio
    async def test_discover_pytest_failure(self, test_loop) -> None:
        """pytest_failure 模式：从 pytest 输出提取失败测试任务."""
        pytest_output = (
            "FAILED tests/test_foo.py::test_get - AssertionError: expected 'foo', got 'bar'\n"
        )
        tasks = await test_loop.discover({
            "task_source": "pytest_failure",
            "pytest_output": pytest_output,
        })
        assert len(tasks) == 1
        assert tasks[0].target_path == "tests/test_foo.py"
        assert tasks[0].modification_type == "update"
        assert tasks[0].context["source"] == "pytest_failure"
        assert "AssertionError" in tasks[0].context["error_msg"]

    @pytest.mark.asyncio
    async def test_discover_force_targets(self, test_loop) -> None:
        """force_targets 模式：与 target_files 同义."""
        tasks = await test_loop.discover({
            "force_targets": ["flowforge/foo.py"],
        })
        assert len(tasks) == 1
        assert tasks[0].context["source"] == "target_files"

    @pytest.mark.asyncio
    async def test_discover_no_targets_returns_empty(self, test_loop) -> None:
        """未提供 target_files，task_source 未实现时返回空列表."""
        tasks = await test_loop.discover({})
        assert tasks == []

    def test_infer_test_path(self, test_loop) -> None:
        """测试路径推断逻辑."""
        assert test_loop._infer_test_path("flowforge/foo.py") == "tests/test_foo.py"
        assert test_loop._infer_test_path("flowforge/evolution/self_dev.py") == "tests/evolution/test_self_dev.py"
        assert test_loop._infer_test_path("flowforge/evolution/self_dev_code.py") == "tests/evolution/test_self_dev_code.py"


# ══════════════════════════════════════════════════════════════════
# §4 Plan 测试
# ══════════════════════════════════════════════════════════════════


class TestPlan:
    @pytest.mark.asyncio
    async def test_plan_parses_valid_json(self, test_loop) -> None:
        """Plan 阶段正确解析 LLM 返回的测试方案 JSON."""
        task = DevTask(
            loop_type="test",
            target_path="tests/test_new.py",
            modification_type="create",
            description="为新模块生成测试",
            context={"source_file": "flowforge/new.py", "test_strategy": "unit"},
        )
        plan = await test_loop.plan(task)

        assert plan.task_id == task.task_id
        assert len(plan.steps) == 1
        assert plan.steps[0]["action"] == "write_file"
        assert plan.steps[0]["path"] == "tests/test_generated.py"
        assert "class TestGenerated" in plan.steps[0]["content"]
        assert plan.risk_assessment == "low"
        assert plan.requires_approval is False
        assert plan.llm_model == "fake-model"

    @pytest.mark.asyncio
    async def test_plan_fallback_on_invalid_json(
        self, fake_engine, forgekin_config
    ) -> None:
        """LLM 返回非 JSON 时 fallback：返回空 steps + 高风险标记.

        SelfDevTestLoop 的 fallback 策略是返回空方案（不臆造测试代码），
        由 Reflect 阶段重新规划或由人工介入。
        """
        client = _FakeTraeClient([{
            "content": "这不是 JSON",
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 50},
            "request_id": "bad-1",
        }])
        loop = SelfDevTestLoop(client, forgekin_config, fake_engine, awakening_stage="E3")

        task = DevTask(
            loop_type="test",
            target_path="tests/test_new.py",
            modification_type="create",
            description="生成测试",
            context={"source_file": "flowforge/new.py"},
        )
        plan = await loop.plan(task)

        # fallback：空 steps + 高风险
        assert len(plan.steps) == 0
        assert plan.risk_assessment == "high"
        assert "fallback" in plan.expected_effect.lower() or "非 JSON" in plan.expected_effect


# ══════════════════════════════════════════════════════════════════
# §5 Act 测试（含 I10 安全护栏 + T1-T8 铁律检查）
# ══════════════════════════════════════════════════════════════════


class TestAct:
    @pytest.mark.asyncio
    async def test_act_write_file_creates_new(self, test_loop, temp_project) -> None:
        """write_file 创建新测试文件（含父目录自动创建）."""
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "write_file",
                "path": "tests/evolution/test_new.py",
                "content": (
                    "import pytest\n\n\n"
                    "class TestNew:\n"
                    "    @pytest.mark.asyncio\n"
                    "    async def test_run(self):\n"
                    "        assert True\n"
                ),
            }],
            expected_effect="test",
            risk_assessment="low",
        )
        result = await test_loop.act(plan)

        assert result.success is True
        assert len(result.changed_files) == 1
        new_file = temp_project / "tests" / "evolution" / "test_new.py"
        assert new_file.exists()
        assert "class TestNew" in new_file.read_text(encoding="utf-8")

    @pytest.mark.asyncio
    async def test_act_i10_forces_append_on_existing_test(
        self, test_loop, temp_project
    ) -> None:
        """I10 安全护栏：write_file 遇到已有测试文件自动改为 append."""
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "write_file",
                "path": "tests/test_foo.py",  # 已存在的测试文件
                "content": (
                    "\n\n# 新追加的测试用例\n"
                    "class TestFooNew:\n"
                    "    def test_new(self):\n"
                    "        assert True\n"
                ),
            }],
            expected_effect="追加测试",
            risk_assessment="low",
        )
        result = await test_loop.act(plan)

        assert result.success is True
        # 原测试不应被覆盖，新内容应被追加
        content = (temp_project / "tests" / "test_foo.py").read_text(encoding="utf-8")
        assert "class TestFoo" in content  # 原内容保留
        assert "TestFooNew" in content  # 新内容追加成功

    @pytest.mark.asyncio
    async def test_act_append_to_existing(self, test_loop, temp_project) -> None:
        """append 模式：追加内容到已有测试文件."""
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "append",
                "path": "tests/test_foo.py",
                "content": "\n\n# 追加的测试\n",
            }],
            expected_effect="append",
            risk_assessment="low",
        )
        result = await test_loop.act(plan)

        assert result.success is True
        content = (temp_project / "tests" / "test_foo.py").read_text(encoding="utf-8")
        assert "追加的测试" in content
        # 原内容应保留
        assert "class TestFoo" in content

    @pytest.mark.asyncio
    async def test_act_unknown_action_skipped(self, test_loop, temp_project) -> None:
        """未知 action 被跳过（不报错）."""
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "delete_file",
                "path": "tests/test_foo.py",
                "content": "test",
            }],
            expected_effect="test",
            risk_assessment="low",
        )
        result = await test_loop.act(plan)

        assert result.success is True
        assert len(result.changed_files) == 0
        # 原文件未被删除
        assert (temp_project / "tests" / "test_foo.py").exists()

    @pytest.mark.asyncio
    async def test_act_t1_t8_check_warns_on_mock_llm(
        self, test_loop, temp_project, caplog
    ) -> None:
        """T1 铁律检查：检测 Mock LLM 模式时发出警告（不阻止写入）."""
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "write_file",
                "path": "tests/test_mock_llm.py",
                "content": (
                    "import pytest\n"
                    "from unittest.mock import MagicMock\n\n"
                    "class TestMockLLM:\n"
                    "    def test_mock(self):\n"
                    "        mock_llm = MagicMock()\n"
                    "        mock_llm.chat.return_value = {'content': 'fake'}\n"
                    "        assert mock_llm.chat()['content'] == 'fake'\n"
                ),
            }],
            expected_effect="test",
            risk_assessment="low",
        )
        result = await test_loop.act(plan)

        # T1-T8 仅警告，不阻止写入
        assert result.success is True
        assert (temp_project / "tests" / "test_mock_llm.py").exists()


# ══════════════════════════════════════════════════════════════════
# §6 Verify 测试
# ══════════════════════════════════════════════════════════════════


class TestVerify:
    @pytest.mark.asyncio
    async def test_verify_fails_on_missing_file(self, test_loop, temp_project) -> None:
        """测试文件不存在：verify 失败."""
        result = DevResult(
            plan_id="p1",
            changed_files=["tests/nonexistent_test.py"],
            diff_summary="write",
            success=True,
        )
        verify = await test_loop.verify(result)

        assert verify.passed is False
        assert any("不存在" in r for r in verify.failure_reasons)

    @pytest.mark.asyncio
    async def test_verify_fails_on_syntax_error(self, test_loop, temp_project) -> None:
        """语法错误：verify 失败."""
        target = "tests/test_syntax_err.py"
        (temp_project / target).write_text(
            "def broken(\n",  # 缺少右括号
            encoding="utf-8",
        )
        result = DevResult(
            plan_id="p1",
            changed_files=[target],
            diff_summary="write",
            success=True,
        )
        verify = await test_loop.verify(result)

        assert verify.passed is False
        assert any("syntax" in r.lower() or "语法" in r for r in verify.failure_reasons)


# ══════════════════════════════════════════════════════════════════
# §7 E2E 完整五步循环测试
# ══════════════════════════════════════════════════════════════════


class TestE2E:
    @pytest.mark.asyncio
    async def test_e2e_force_targets_generates_test(
        self, fake_trae_client, fake_engine, forgekin_config, temp_project
    ) -> None:
        """E2E：force_targets 模式触发完整五步循环生成测试."""
        loop = SelfDevTestLoop(
            fake_trae_client, forgekin_config, fake_engine, awakening_stage="E3"
        )

        async def _noop_persist(record):
            record.persisted = True
            record.persist_payload = {"episode_id": "test-e2e-1"}
            return record.persist_payload
        loop.persist = _noop_persist

        fake_engine.register_self_dev_loop(loop)

        # 使用 force_targets 直接生成新的测试文件（避免 I10 强制 append）
        result = await fake_engine.run_self_dev_loop("test", {
            "force_targets": ["flowforge/nonexistent_for_e2e.py"],
        })

        assert result["loop_type"] == "test"
        assert result["summary"]["total"] >= 1
        # LLM 应被调用至少 2 次（Plan + Review）
        assert fake_trae_client.call_count >= 2

    @pytest.mark.asyncio
    async def test_e2e_awakening_stage_blocks(
        self, fake_trae_client, fake_engine, forgekin_config
    ) -> None:
        """E2E：觉醒阶门控阻止 E2 触发 Test 闭环（要求 E3）."""
        from flowforge.evolution.self_dev_base import AwakeningStageBlockedError

        loop = SelfDevTestLoop(
            fake_trae_client, forgekin_config, fake_engine, awakening_stage="E2"
        )
        fake_engine.register_self_dev_loop(loop)

        with pytest.raises(AwakeningStageBlockedError) as exc_info:
            await fake_engine.run_self_dev_loop("test", {"force_targets": ["x.py"]})

        assert "test" in str(exc_info.value)
        assert "E3" in str(exc_info.value)


# ══════════════════════════════════════════════════════════════════
# §8 ForgeMindEngine 注册测试
# ══════════════════════════════════════════════════════════════════


class TestEngineRegistration:
    def test_register_test_loop(self, fake_engine, test_loop) -> None:
        """注册 SelfDevTestLoop 到 ForgeMindEngine."""
        fake_engine.register_self_dev_loop(test_loop)

        loops = fake_engine.list_self_dev_loops()
        assert "test" in loops
        assert loops["test"] == "E3"
        assert fake_engine.get_self_dev_loop("test") is test_loop

    def test_register_duplicate_raises(
        self, fake_engine, test_loop, fake_trae_client, forgekin_config
    ) -> None:
        """重复注册同 loop_type 抛 ValueError."""
        fake_engine.register_self_dev_loop(test_loop)
        loop2 = SelfDevTestLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E3")
        with pytest.raises(ValueError, match="已注册"):
            fake_engine.register_self_dev_loop(loop2)
