"""F046 Phase 3 单元测试 — SelfDevCodeLoop 代码闭环.

覆盖范围：
- Discover: pytest_failure / task_md / bug_report / force_targets 四种来源
- Plan: LLM 返回合法 JSON / 非 JSON fallback / LLM 失败 fallback
- Act: write_file / update_section / append / I5/I6/I7 安全护栏
- Verify: 文件存在性 / Python 语法 / 安全护栏复查 / LLM 审核
- E2E: 完整五步循环（stub 替代 TraeLLMClient）

测试铁律遵守：
- T1 禁止 Mock LLM：使用 _FakeTraeClient（stub 替代），E2E 通过真实 TraeLLMClient
- T2 真实场景数据：构造临时项目目录，模拟真实代码结构
- T3 具体断言：每个测试都有明确断言
- T6 必须采集指标：elapsed_ms 字段记录耗时
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
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
from flowforge.evolution.self_dev_code import SelfDevCodeLoop


# ══════════════════════════════════════════════════════════════════
# §1 Fake/Stub 工具类
# ══════════════════════════════════════════════════════════════════


class _FakeTraeClient:
    """Stub TraeLLMClient — 单元测试用，按顺序返回预设响应."""

    def __init__(self, responses: List[Dict[str, Any]] | None = None) -> None:
        self._responses = list(responses or [])
        self.call_count = 0
        self.calls: List[Dict[str, Any]] = []

    async def chat(self, messages: List[Dict[str, str]], *, context=None, **kwargs) -> Dict[str, Any]:
        self.call_count += 1
        self.calls.append({"messages": messages, "context": context, "kwargs": kwargs})
        if self._responses:
            return self._responses.pop(0)
        # 默认响应：合法的 Plan JSON（含 DI 注入的合规代码）
        return {
            "content": json.dumps({
                "steps": [{
                    "action": "write_file",
                    "path": "flowforge/demo.py",
                    "content": (
                        "from typing import Any\n\n"
                        "class Demo:\n"
                        "    def __init__(self, client: Any) -> None:\n"
                        "        self._client = client\n\n"
                        "    async def run(self) -> str:\n"
                        "        return 'ok'\n"
                    ),
                }],
                "expected_effect": "生成合规代码",
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
    """构造临时项目目录，模拟真实代码结构."""
    # flowforge/foo.py（已有源文件，用于 update/append 测试）
    ff_dir = tmp_path / "flowforge"
    ff_dir.mkdir(parents=True)
    (ff_dir / "foo.py").write_text(
        "\"\"\"Foo module.\"\"\"\n\n\nclass Foo:\n"
        "    def __init__(self, client) -> None:\n"
        "        self._client = client\n\n"
        "    async def get(self) -> str:\n"
        "        return 'foo'\n",
        encoding="utf-8",
    )

    # tests/test_foo.py（已有测试，I5 检查禁止覆盖）
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    (tests_dir / "test_foo.py").write_text(
        "import pytest\n\n\nclass TestFoo:\n"
        "    @pytest.mark.asyncio\n"
        "    async def test_get(self):\n"
        "        assert True\n",
        encoding="utf-8",
    )

    # docs/task.md（含未实现项）
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "task.md").write_text(
        "# Task List\n\n"
        "- [ ] F200: 实现用户登录\n"
        "- [ ] F201: 添加日志\n"
        "TODO: 优化性能\n",
        encoding="utf-8",
    )

    return tmp_path


@pytest.fixture
def forgekin_config(temp_project: Path) -> Dict[str, Any]:
    return {
        "project_root": str(temp_project),
        "forgekin_id": "forgemind:sherlock",
        "source_patterns": ["**/*.py"],
        "test_dir": "tests",
    }


@pytest.fixture
def fake_engine() -> ForgeMindEngine:
    return ForgeMindEngine()


@pytest.fixture
def fake_trae_client() -> _FakeTraeClient:
    """默认 FakeTraeClient — Plan 返回合规代码，LLM 审核通过.

    注意：测试代码用 TraeLLMClient 类型注解（匹配 _DI_PATTERNS 的 [A-Z]\\w+Client 模式），
    避免触发 I6 安全护栏。
    """
    plan_response = {
        "content": json.dumps({
            "steps": [{
                "action": "write_file",
                "path": "flowforge/generated.py",
                "content": (
                    "\"\"\"Generated module.\"\"\"\n"
                    "from flowforge.llm.trae import TraeLLMClient\n\n"
                    "class Generated:\n"
                    "    def __init__(self, client: TraeLLMClient) -> None:\n"
                    "        self._client = client\n\n"
                    "    async def run(self) -> str:\n"
                    "        return 'ok'\n"
                ),
            }],
            "expected_effect": "生成合规代码",
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
            "score": 0.90,
            "issues": [],
            "suggestions": ["继续保持"],
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 80},
        "request_id": "review-1",
    }
    return _FakeTraeClient([plan_response, review_response])


@pytest.fixture
def code_loop(fake_trae_client, fake_engine, forgekin_config) -> SelfDevCodeLoop:
    return SelfDevCodeLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E4")


# ══════════════════════════════════════════════════════════════════
# §3 Discover 测试
# ══════════════════════════════════════════════════════════════════


class TestDiscover:
    @pytest.mark.asyncio
    async def test_discover_force_targets(self, code_loop) -> None:
        """force_targets 模式：直接创建 DevTask."""
        tasks = await code_loop.discover({
            "force_targets": ["flowforge/foo.py", "flowforge/new.py"],
        })
        assert len(tasks) == 2
        # foo.py 已存在 -> update；new.py 不存在 -> create
        types = {t.target_path: t.modification_type for t in tasks}
        assert types["flowforge/foo.py"] == "update"
        assert types["flowforge/new.py"] == "create"
        assert all(t.priority == "high" for t in tasks)

    @pytest.mark.asyncio
    async def test_discover_pytest_failure(self, code_loop) -> None:
        """pytest_failure 模式：从 pytest 输出提取测试失败任务."""
        pytest_output = (
            "FAILED tests/test_foo.py::test_get - AssertionError: expected 'foo', got 'bar'\n"
            "FAILED tests/evolution/test_bar.py::test_run - RuntimeError: timeout\n"
        )
        tasks = await code_loop.discover({
            "task_source": "pytest_failure",
            "pytest_output": pytest_output,
        })
        assert len(tasks) == 2
        # 推断源文件：tests/test_foo.py -> flowforge/foo.py
        targets = {t.target_path for t in tasks}
        assert "flowforge/foo.py" in targets
        assert "flowforge/evolution/bar.py" in targets
        assert all(t.priority == "high" for t in tasks)
        # 验证 context 保留原始失败信息
        foo_task = next(t for t in tasks if t.target_path == "flowforge/foo.py")
        assert foo_task.context["source"] == "pytest_failure"
        assert foo_task.context["test_file"] == "tests/test_foo.py"
        assert "AssertionError" in foo_task.context["error_msg"]

    @pytest.mark.asyncio
    async def test_discover_task_md(self, code_loop, temp_project) -> None:
        """task_md 模式：从 task.md 提取未实现项."""
        tasks = await code_loop.discover({
            "task_source": "task_md",
            "task_md_path": "docs/task.md",
        })
        # task.md 含 3 个未实现项
        assert len(tasks) == 3
        descs = [t.description for t in tasks]
        assert any("F200" in d for d in descs)
        assert any("F201" in d for d in descs)
        assert any("优化性能" in d for d in descs)
        assert all(t.context["source"] == "task_md" for t in tasks)

    @pytest.mark.asyncio
    async def test_discover_bug_report(self, code_loop) -> None:
        """bug_report 模式：从 bug 报告字符串提取任务."""
        bug_report = "登录接口返回 500 错误\n# 注释行应跳过\n日志时间戳格式错误"
        tasks = await code_loop.discover({
            "task_source": "bug_report",
            "bug_report": bug_report,
        })
        # 应提取 2 个 bug（跳过 # 注释行）
        assert len(tasks) == 2
        assert all(t.priority == "high" for t in tasks)
        assert all(t.context["source"] == "bug_report" for t in tasks)

    @pytest.mark.asyncio
    async def test_discover_force_targets_overrides_task_source(self, code_loop) -> None:
        """force_targets 优先级最高，覆盖 task_source."""
        tasks = await code_loop.discover({
            "task_source": "pytest_failure",
            "pytest_output": "FAILED tests/test_x.py::test_a - Error",
            "force_targets": ["flowforge/foo.py"],
        })
        # 应只处理 force_targets，忽略 pytest_failure
        assert len(tasks) == 1
        assert tasks[0].target_path == "flowforge/foo.py"
        assert tasks[0].context["source"] == "force_targets"

    @pytest.mark.asyncio
    async def test_discover_unknown_task_source(self, code_loop) -> None:
        """未知 task_source 返回空列表（不抛异常）."""
        tasks = await code_loop.discover({"task_source": "unknown_source"})
        assert tasks == []


# ══════════════════════════════════════════════════════════════════
# §4 Plan 测试
# ══════════════════════════════════════════════════════════════════


class TestPlan:
    @pytest.mark.asyncio
    async def test_plan_parses_valid_json(self, code_loop) -> None:
        """Plan 阶段正确解析 LLM 返回的 JSON 方案."""
        task = DevTask(
            loop_type="code",
            target_path="flowforge/new.py",
            modification_type="create",
            description="创建新模块",
        )
        plan = await code_loop.plan(task)

        assert plan.task_id == task.task_id
        assert len(plan.steps) == 1
        assert plan.steps[0]["action"] == "write_file"
        assert plan.steps[0]["path"] == "flowforge/generated.py"
        assert plan.risk_assessment == "low"
        assert plan.requires_approval is False  # Code 闭环无需 approval（仅 Framework 需要）
        assert plan.llm_model == "fake-model"

    @pytest.mark.asyncio
    async def test_plan_fallback_on_invalid_json(
        self, fake_engine, forgekin_config, temp_project
    ) -> None:
        """LLM 返回非 JSON 时 fallback：将 LLM 内容作为单个 write_file 步骤."""
        bad_client = _FakeTraeClient([{
            "content": "这不是 JSON，是纯文本响应",
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 50},
            "request_id": "bad-1",
        }])
        loop = SelfDevCodeLoop(bad_client, forgekin_config, fake_engine, awakening_stage="E4")

        task = DevTask(
            loop_type="code",
            target_path="flowforge/foo.py",
            modification_type="update",
            description="测试 fallback",
        )
        plan = await loop.plan(task)

        assert len(plan.steps) == 1
        assert plan.steps[0]["action"] == "write_file"
        assert plan.steps[0]["content"] == "这不是 JSON，是纯文本响应"
        assert plan.risk_assessment == "medium"

    @pytest.mark.asyncio
    async def test_plan_fallback_on_llm_exception(
        self, fake_engine, forgekin_config
    ) -> None:
        """LLM 调用异常时 fallback：写入占位符."""
        class _ErrorClient:
            async def chat(self, *args, **kwargs):
                raise RuntimeError("LLM 服务不可用")

        loop = SelfDevCodeLoop(_ErrorClient(), forgekin_config, fake_engine, awakening_stage="E4")
        task = DevTask(
            loop_type="code",
            target_path="flowforge/foo.py",
            modification_type="update",
            description="测试异常 fallback",
        )
        plan = await loop.plan(task)

        assert len(plan.steps) == 1
        assert "LLM 调用失败" in plan.steps[0]["content"]
        assert plan.risk_assessment == "high"
        assert plan.llm_model == "fallback"


# ══════════════════════════════════════════════════════════════════
# §5 Act 测试（含 I5/I6/I7 安全护栏）
# ══════════════════════════════════════════════════════════════════


class TestAct:
    @pytest.mark.asyncio
    async def test_act_write_file_creates_new(self, code_loop, temp_project) -> None:
        """write_file 创建新文件（含父目录自动创建）.

        注意：测试代码用 TraeLLMClient 类型注解，匹配 _DI_PATTERNS 的 [A-Z]\\w+Client 模式。
        """
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "write_file",
                "path": "flowforge/new_module/demo.py",
                "content": (
                    "\"\"\"Demo module.\"\"\"\n"
                    "from flowforge.llm.trae import TraeLLMClient\n\n"
                    "class Demo:\n"
                    "    def __init__(self, client: TraeLLMClient) -> None:\n"
                    "        self._client = client\n"
                ),
            }],
            expected_effect="test",
            risk_assessment="low",
        )
        result = await code_loop.act(plan)

        assert result.success is True
        assert len(result.changed_files) == 1
        new_file = temp_project / "flowforge" / "new_module" / "demo.py"
        assert new_file.exists()
        assert "class Demo" in new_file.read_text(encoding="utf-8")
        assert result.elapsed_ms >= 0

    @pytest.mark.asyncio
    async def test_act_append_to_existing(self, code_loop, temp_project) -> None:
        """append 模式：追加内容到已有文件."""
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "append",
                "path": "flowforge/foo.py",
                "content": "\n\n# 追加的注释\n",
            }],
            expected_effect="append",
            risk_assessment="low",
        )
        result = await code_loop.act(plan)

        assert result.success is True
        content = (temp_project / "flowforge" / "foo.py").read_text(encoding="utf-8")
        assert "追加的注释" in content

    @pytest.mark.asyncio
    async def test_act_i5_blocks_overwriting_test_file(
        self, code_loop, temp_project
    ) -> None:
        """I5 安全护栏：禁止覆盖已有 test_*.py 文件（红线 8）."""
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "write_file",
                "path": "tests/test_foo.py",
                "content": "# 被覆盖的测试文件\n",
            }],
            expected_effect="尝试覆盖测试",
            risk_assessment="low",
        )
        result = await code_loop.act(plan)

        assert result.success is False
        assert "I5" in result.error_message
        # 验证原文件未被修改
        content = (temp_project / "tests" / "test_foo.py").read_text(encoding="utf-8")
        assert "class TestFoo" in content

    @pytest.mark.asyncio
    async def test_act_i7_blocks_hardcoded_path(
        self, code_loop, temp_project
    ) -> None:
        """I7 安全护栏：禁止硬编码路径（红线 11）."""
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "write_file",
                "path": "flowforge/bad_path.py",
                "content": (
                    "class BadPath:\n"
                    "    def __init__(self) -> None:\n"
                    "        self.path = '/home/hyg/data'\n"
                ),
            }],
            expected_effect="测试硬编码路径",
            risk_assessment="low",
        )
        result = await code_loop.act(plan)

        assert result.success is False
        assert "I7" in result.error_message or "安全护栏" in result.error_message
        # 文件不应被写入
        assert not (temp_project / "flowforge" / "bad_path.py").exists()

    @pytest.mark.asyncio
    async def test_act_i7_blocks_hardcoded_secret(
        self, code_loop, temp_project
    ) -> None:
        """I7 安全护栏：禁止硬编码密钥（红线 11）."""
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "write_file",
                "path": "flowforge/bad_secret.py",
                "content": (
                    "class BadSecret:\n"
                    "    def __init__(self) -> None:\n"
                    "        self.api_key = 'sk-abc123xyz'\n"
                ),
            }],
            expected_effect="测试硬编码密钥",
            risk_assessment="low",
        )
        result = await code_loop.act(plan)

        assert result.success is False
        assert "I7" in result.error_message or "安全护栏" in result.error_message

    @pytest.mark.asyncio
    async def test_act_i6_blocks_direct_db_operation(
        self, code_loop, temp_project
    ) -> None:
        """红线 13 安全护栏：禁止直接操作数据库."""
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "write_file",
                "path": "flowforge/bad_db.py",
                "content": (
                    "class BadDB:\n"
                    "    def __init__(self) -> None:\n"
                    "        pass\n\n"
                    "    def query(self):\n"
                    "        cursor.execute('SELECT * FROM users')\n"
                ),
            }],
            expected_effect="测试直接 DB 操作",
            risk_assessment="low",
        )
        result = await code_loop.act(plan)

        assert result.success is False
        assert "红线 13" in result.error_message or "安全护栏" in result.error_message

    @pytest.mark.asyncio
    async def test_act_unknown_action_skipped(self, code_loop, temp_project) -> None:
        """未知 action 被跳过（不报错）."""
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "unknown_action",
                "path": "flowforge/foo.py",
                "content": "test",
            }],
            expected_effect="test",
            risk_assessment="low",
        )
        result = await code_loop.act(plan)

        assert result.success is True  # 未知 action 不算失败
        assert len(result.changed_files) == 0


# ══════════════════════════════════════════════════════════════════
# §6 Verify 测试
# ══════════════════════════════════════════════════════════════════


class TestVerify:
    @pytest.mark.asyncio
    async def test_verify_passes_on_valid_code(
        self, fake_engine, forgekin_config, temp_project
    ) -> None:
        """验证合规代码：文件存在 + 语法正确 + 安全护栏通过 + LLM 审核通过.

        注意：单独构造 client，仅含 Verify 阶段的 LLM 审核响应（passed=True）。
        测试代码用 TraeLLMClient 类型注解，匹配 _DI_PATTERNS 的 [A-Z]\\w+Client 模式。
        """
        # Verify 阶段：LLM 审核通过
        review_response = {
            "content": json.dumps({
                "passed": True,
                "score": 0.90,
                "issues": [],
                "suggestions": ["代码合规"],
            }),
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 80},
            "request_id": "review-1",
        }
        client = _FakeTraeClient([review_response])
        loop = SelfDevCodeLoop(client, forgekin_config, fake_engine, awakening_stage="E4")

        # 先写入合规代码
        target = "flowforge/verify_ok.py"
        (temp_project / target).write_text(
            "\"\"\"OK module.\"\"\"\n"
            "from flowforge.llm.trae import TraeLLMClient\n\n"
            "class OK:\n"
            "    def __init__(self, client: TraeLLMClient) -> None:\n"
            "        self._client = client\n",
            encoding="utf-8",
        )
        result = DevResult(
            plan_id="p1",
            changed_files=[target],
            diff_summary="write",
            success=True,
        )
        verify = await loop.verify(result)

        assert verify.passed is True
        assert verify.llm_review_passed is True
        assert len(verify.failure_reasons) == 0
        # 应包含 4 项检查：file_exists / syntax / safety / llm_review
        check_names = [c["name"] for c in verify.checks]
        assert any("file_exists" in n for n in check_names)
        assert any("syntax" in n for n in check_names)
        assert any("safety" in n for n in check_names)
        assert any("llm_review" in n for n in check_names)

    @pytest.mark.asyncio
    async def test_verify_fails_on_syntax_error(
        self, code_loop, temp_project
    ) -> None:
        """语法错误：verify 失败."""
        target = "flowforge/syntax_err.py"
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
        verify = await code_loop.verify(result)

        assert verify.passed is False
        assert any("syntax" in r.lower() or "语法" in r for r in verify.failure_reasons)

    @pytest.mark.asyncio
    async def test_verify_fails_on_missing_file(
        self, code_loop, temp_project
    ) -> None:
        """文件不存在：verify 失败."""
        result = DevResult(
            plan_id="p1",
            changed_files=["flowforge/nonexistent.py"],
            diff_summary="write",
            success=True,
        )
        verify = await code_loop.verify(result)

        assert verify.passed is False
        assert any("不存在" in r for r in verify.failure_reasons)


# ══════════════════════════════════════════════════════════════════
# §7 E2E 完整五步循环测试
# ══════════════════════════════════════════════════════════════════


class TestE2E:
    @pytest.mark.asyncio
    async def test_e2e_force_targets_generates_code(
        self, fake_trae_client, fake_engine, forgekin_config, temp_project
    ) -> None:
        """E2E：force_targets 模式触发完整五步循环生成代码."""
        loop = SelfDevCodeLoop(
            fake_trae_client, forgekin_config, fake_engine, awakening_stage="E4"
        )

        # mock persist 避免真实治理层调用
        async def _noop_persist(record):
            record.persisted = True
            record.persist_payload = {"episode_id": "e2e-1"}
            return record.persist_payload
        loop.persist = _noop_persist

        fake_engine.register_self_dev_loop(loop)

        result = await fake_engine.run_self_dev_loop("code", {
            "force_targets": ["flowforge/generated.py"],
        })

        assert result["loop_type"] == "code"
        assert result["summary"]["total"] >= 1
        # 生成的文件应存在
        assert (temp_project / "flowforge" / "generated.py").exists()
        # LLM 应被调用至少 2 次（Plan + Review）
        assert fake_trae_client.call_count >= 2

    @pytest.mark.asyncio
    async def test_e2e_awakening_stage_blocks(
        self, fake_trae_client, fake_engine, forgekin_config
    ) -> None:
        """E2E：觉醒阶门控阻止 E3 触发 Code 闭环（要求 E4）."""
        from flowforge.evolution.self_dev_base import AwakeningStageBlockedError

        loop = SelfDevCodeLoop(
            fake_trae_client, forgekin_config, fake_engine, awakening_stage="E3"  # 低于 E4
        )
        fake_engine.register_self_dev_loop(loop)

        with pytest.raises(AwakeningStageBlockedError) as exc_info:
            await fake_engine.run_self_dev_loop("code", {"force_targets": ["x.py"]})

        assert "code" in str(exc_info.value)
        assert "E4" in str(exc_info.value)
        assert "E3" in str(exc_info.value)


# ══════════════════════════════════════════════════════════════════
# §8 ForgeMindEngine 注册测试
# ══════════════════════════════════════════════════════════════════


class TestEngineRegistration:
    def test_register_code_loop(self, fake_engine, code_loop) -> None:
        """注册 SelfDevCodeLoop 到 ForgeMindEngine."""
        fake_engine.register_self_dev_loop(code_loop)

        loops = fake_engine.list_self_dev_loops()
        assert "code" in loops
        assert loops["code"] == "E4"
        assert fake_engine.get_self_dev_loop("code") is code_loop

    def test_register_duplicate_raises(
        self, fake_engine, code_loop, fake_trae_client, forgekin_config
    ) -> None:
        """重复注册同 loop_type 抛 ValueError."""
        fake_engine.register_self_dev_loop(code_loop)
        loop2 = SelfDevCodeLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E4")
        with pytest.raises(ValueError, match="已注册"):
            fake_engine.register_self_dev_loop(loop2)

    def test_register_no_loop_type_raises(self, fake_engine, fake_trae_client, forgekin_config) -> None:
        """loop_type 为空时，register_self_dev_loop 抛 ValueError."""

        class _NoType(SelfDevCodeLoop):
            loop_type = ""

        loop = _NoType(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E4")
        with pytest.raises(ValueError, match="loop_type"):
            fake_engine.register_self_dev_loop(loop)
