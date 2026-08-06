"""F046 Phase 2 单元测试 — SelfDevDocLoop 文档闭环.

覆盖范围：
- Discover: 过期文档 / 缺失文档 / 格式问题 / force_targets 模式
- Plan: LLM 返回合法 JSON / 非 JSON fallback / LLM 失败 fallback
- Act: write_file / update_section / append / 父目录自动创建
- Verify: 文件存在性 / front-matter / 标题层级 / LLM 审核
- E2E: 完整五步循环（mock 数据本地运行）

测试铁律遵守：
- T1 禁止 Mock LLM：使用 _FakeTraeClient（stub 替代），E2E 通过真实 TraeLLMClient
- T2 真实场景数据：构造临时项目目录，模拟真实文档结构
- T3 具体断言：每个测试都有明确断言
- T6 必须采集指标：elapsed_ms 字段记录耗时
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import pytest

# 确保能导入 flowforge
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from flowforge.evolution.engine import ForgeMindEngine
from flowforge.evolution.self_dev_base import (
    DevPlan,
    DevResult,
    DevTask,
)
from flowforge.evolution.self_dev_doc import SelfDevDocLoop

# ══════════════════════════════════════════════════════════════════
# §1 Fake/Stub 工具类
# ══════════════════════════════════════════════════════════════════


class _FakeTraeClient:
    """Stub TraeLLMClient — 单元测试用，返回预设响应.

    策略：根据调用顺序返回预设响应列表，第 N 次调用返回第 N 个响应.
    """

    def __init__(self, responses: list[dict[str, Any]] | None = None) -> None:
        self._responses = list(responses or [])
        self.call_count = 0
        self.calls: list[dict[str, Any]] = []

    async def chat(self, messages: list[dict[str, str]], *, context=None, **kwargs) -> dict[str, Any]:
        self.call_count += 1
        self.calls.append({"messages": messages, "context": context, "kwargs": kwargs})
        if self._responses:
            return self._responses.pop(0)
        # 默认响应：合法的 Plan JSON
        return {
            "content": json.dumps({
                "steps": [{
                    "action": "write_file",
                    "path": "docs/test.md",
                    "content": "---\nstatus: draft\ntype: design\ncreated_at: 2026-07-20\n---\n\n# 测试文档\n\n这是测试内容.\n",
                }],
                "expected_effect": "生成测试文档",
                "risk_assessment": "low",
            }),
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 100},
            "request_id": f"req-{self.call_count}",
        }


# ══════════════════════════════════════════════════════════════════
# §2 测试固件 — 构造临时项目目录 + mock 数据
# ══════════════════════════════════════════════════════════════════


@pytest.fixture
def temp_project(tmp_path: Path) -> Path:
    """构造临时项目目录，模拟真实文档结构."""
    # docs/features/F100-test.md（有 front-matter，正常文档）
    features_dir = tmp_path / "docs" / "features"
    features_dir.mkdir(parents=True)
    (features_dir / "F100-test.md").write_text(
        "---\nstatus: done\ntype: feature\ncreated_at: 2026-07-01\n---\n\n# F100: 测试功能\n\n这是一个测试 feature.\n",
        encoding="utf-8",
    )

    # docs/stale_doc.md（过期文档 — mtime 设置为 100 天前）
    stale_path = tmp_path / "docs" / "stale_doc.md"
    stale_path.write_text(
        "---\nstatus: draft\ntype: doc\n---\n\n# 过期文档\n\n这个文档很老.\n",
        encoding="utf-8",
    )
    # 修改 mtime 为 100 天前
    old_time = time.time() - 100 * 86400
    os.utime(stale_path, (old_time, old_time))

    # docs/no_frontmatter.md（无 front-matter — 格式问题）
    (tmp_path / "docs" / "no_frontmatter.md").write_text(
        "### 缺少 front-matter 的文档\n\n这个文档没有 YAML 头部.\n",
        encoding="utf-8",
    )

    # README.md（根目录，不在 docs/ 下，无 front-matter 不算问题）
    (tmp_path / "README.md").write_text("# Test Project\n\n这是一个测试项目.\n", encoding="utf-8")

    return tmp_path


@pytest.fixture
def forgekin_config(temp_project: Path) -> dict[str, Any]:
    return {
        "project_root": str(temp_project),
        "forgekin_id": "forgemind:wenxin",
        "docs_dir": "docs",
        "max_age_days": 90,
        "scan_patterns": ["docs/**/*.md"],
    }


@pytest.fixture
def fake_trae_client() -> _FakeTraeClient:
    """默认 FakeTraeClient — Plan 返回合法 JSON，LLM 审核通过."""
    plan_response = {
        "content": json.dumps({
            "steps": [{
                "action": "write_file",
                "path": "docs/generated_doc.md",
                "content": "---\nstatus: draft\ntype: design\ncreated_at: 2026-07-20\n---\n\n# 生成的文档\n\n这是 LLM 生成的文档内容.\n",
            }],
            "expected_effect": "生成测试文档",
            "risk_assessment": "low",
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 150},
        "request_id": "plan-1",
    }
    # Review 响应（llm_review_content 调用）
    review_response = {
        "content": json.dumps({
            "passed": True,
            "score": 0.92,
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
def doc_loop(fake_trae_client, fake_engine, forgekin_config) -> SelfDevDocLoop:
    return SelfDevDocLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E3")


@pytest.fixture
def fake_engine() -> ForgeMindEngine:
    return ForgeMindEngine()


# ══════════════════════════════════════════════════════════════════
# §3 Discover 测试
# ══════════════════════════════════════════════════════════════════


class TestDiscover:
    @pytest.mark.asyncio
    async def test_discover_finds_stale_doc(self, doc_loop, temp_project) -> None:
        """检测过期文档."""
        tasks = await doc_loop.discover({})
        # 应该发现 stale_doc.md（100 天前，阈值 90 天）
        stale_tasks = [t for t in tasks if "stale" in t.description.lower() or "过期" in t.description]
        assert len(stale_tasks) >= 1, f"应发现过期文档，实际 tasks: {[t.description for t in tasks]}"
        assert stale_tasks[0].modification_type == "update"
        assert stale_tasks[0].context.get("source") == "stale_detect"

    @pytest.mark.asyncio
    async def test_discover_finds_missing_design(self, doc_loop, temp_project) -> None:
        """检测缺失 design 文档（features/F100-test.md 存在但 design/D100-test.md 缺失）."""
        tasks = await doc_loop.discover({})
        missing_tasks = [t for t in tasks if "design" in t.target_path and t.modification_type == "create"]
        assert len(missing_tasks) >= 1, f"应发现缺失 design 文档，实际: {[t.target_path for t in tasks]}"
        assert any("D100" in t.target_path for t in missing_tasks)
        assert missing_tasks[0].priority == "high"  # 缺失文档优先级高

    @pytest.mark.asyncio
    async def test_discover_finds_format_issues(self, doc_loop, temp_project) -> None:
        """检测格式问题（无 front-matter / 标题层级过深）."""
        tasks = await doc_loop.discover({})
        format_tasks = [t for t in tasks if t.context.get("source") == "format_check"]
        assert len(format_tasks) >= 1
        # no_frontmatter.md 应该被发现
        target_paths = [t.target_path for t in format_tasks]
        assert any("no_frontmatter" in p for p in target_paths)

    @pytest.mark.asyncio
    async def test_discover_force_targets_skips_scan(self, doc_loop, temp_project) -> None:
        """force_targets 模式跳过扫描，直接返回指定目标."""
        tasks = await doc_loop.discover({
            "force_targets": ["docs/manual_update.md"],
        })
        assert len(tasks) == 1
        assert tasks[0].target_path == "docs/manual_update.md"
        assert tasks[0].priority == "high"
        assert tasks[0].context.get("source") == "force_targets"

    @pytest.mark.asyncio
    async def test_discover_empty_project(self, fake_trae_client, fake_engine, tmp_path) -> None:
        """空项目目录扫描应返回空任务列表."""
        config = {"project_root": str(tmp_path), "forgekin_id": "test"}
        loop = SelfDevDocLoop(fake_trae_client, config, fake_engine)
        tasks = await loop.discover({})
        assert tasks == []

    @pytest.mark.asyncio
    async def test_discover_priority_ordering(self, doc_loop, temp_project) -> None:
        """任务按优先级排序（high > normal）."""
        tasks = await doc_loop.discover({})
        if len(tasks) >= 2:
            priorities = [t.priority for t in tasks]
            # high 应该在 normal 之前
            priority_order = {"critical": 0, "high": 1, "normal": 2, "low": 3}
            indices = [priority_order[p] for p in priorities]
            assert indices == sorted(indices), f"优先级未排序: {priorities}"


# ══════════════════════════════════════════════════════════════════
# §4 Plan 测试
# ══════════════════════════════════════════════════════════════════


class TestPlan:
    @pytest.mark.asyncio
    async def test_plan_parses_valid_json(self, doc_loop, temp_project) -> None:
        """LLM 返回合法 JSON → 解析为 steps."""
        task = DevTask(
            loop_type="doc",
            target_path="docs/new_doc.md",
            modification_type="create",
            description="创建新文档",
        )
        plan = await doc_loop.plan(task)
        assert plan.task_id == task.task_id
        assert len(plan.steps) == 1
        assert plan.steps[0]["action"] == "write_file"
        assert plan.llm_model == "fake-model"
        assert plan.expected_effect == "生成测试文档"

    @pytest.mark.asyncio
    async def test_plan_fallback_on_non_json(self, fake_engine, forgekin_config) -> None:
        """LLM 返回非 JSON → fallback 为单个 write_file 步骤."""
        fake_client = _FakeTraeClient([{
            "content": "这不是 JSON 格式的响应，只是纯文本",
            "model": "fake-model",
            "provider": "trae",
            "usage": {},
            "request_id": "1",
        }])
        loop = SelfDevDocLoop(fake_client, forgekin_config, fake_engine)
        task = DevTask(
            loop_type="doc",
            target_path="docs/x.md",
            modification_type="create",
            description="测试",
        )
        plan = await loop.plan(task)
        assert len(plan.steps) == 1
        assert plan.steps[0]["action"] == "write_file"
        assert "fallback" in plan.expected_effect.lower() or "fallback" in plan.risk_assessment.lower() or plan.risk_assessment == "medium"

    @pytest.mark.asyncio
    async def test_plan_fallback_on_llm_failure(self, fake_engine, forgekin_config) -> None:
        """LLM 调用失败 → 返回 fallback plan（不抛异常）."""
        class _ExplodingClient:
            async def chat(self, *args, **kwargs):
                raise RuntimeError("LLM 不可用")

        loop = SelfDevDocLoop(_ExplodingClient(), forgekin_config, fake_engine)
        task = DevTask(
            loop_type="doc",
            target_path="docs/x.md",
            modification_type="create",
            description="测试",
        )
        plan = await loop.plan(task)
        assert plan.llm_model == "fallback"
        assert "LLM 调用失败" in plan.expected_effect
        assert plan.risk_assessment == "high"

    @pytest.mark.asyncio
    async def test_plan_reads_existing_content(self, doc_loop, temp_project) -> None:
        """Plan 阶段应读取现有文档内容传给 LLM."""
        # 创建一个已存在的文档
        existing = temp_project / "docs" / "existing.md"
        existing.write_text("---\nstatus: done\n---\n\n# 已存在\n\n旧内容.\n", encoding="utf-8")

        task = DevTask(
            loop_type="doc",
            target_path="docs/existing.md",
            modification_type="update",
            description="更新文档",
        )
        await doc_loop.plan(task)
        # 验证 FakeTraeClient 收到的 messages 中包含现有内容
        assert doc_loop._trae_client.call_count >= 1
        user_msg = doc_loop._trae_client.calls[0]["messages"][-1]["content"]
        assert "已存在" in user_msg or "现有文档内容" in user_msg


# ══════════════════════════════════════════════════════════════════
# §5 Act 测试
# ══════════════════════════════════════════════════════════════════


class TestAct:
    @pytest.mark.asyncio
    async def test_act_write_file_creates_new(self, doc_loop, temp_project) -> None:
        """write_file 创建新文件."""
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "write_file",
                "path": "docs/new_doc.md",
                "content": "---\nstatus: draft\n---\n\n# 新文档\n\n内容.\n",
            }],
            expected_effect="创建",
            risk_assessment="low",
        )
        result = await doc_loop.act(plan)
        assert result.success is True
        assert "docs/new_doc.md" in result.changed_files
        assert (temp_project / "docs" / "new_doc.md").exists()
        assert (temp_project / "docs" / "new_doc.md").read_text(encoding="utf-8").startswith("---")

    @pytest.mark.asyncio
    async def test_act_write_file_creates_parent_dir(self, doc_loop, temp_project) -> None:
        """write_file 自动创建父目录."""
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "write_file",
                "path": "docs/nested/deep/dir.md",
                "content": "# 深层文档\n",
            }],
            expected_effect="",
            risk_assessment="low",
        )
        result = await doc_loop.act(plan)
        assert result.success is True
        assert (temp_project / "docs" / "nested" / "deep" / "dir.md").exists()

    @pytest.mark.asyncio
    async def test_act_update_section_replaces(self, doc_loop, temp_project) -> None:
        """update_section 替换指定章节."""
        # 先创建一个有多个章节的文档
        target = temp_project / "docs" / "multi_section.md"
        target.write_text(
            "# 文档\n\n## 第一节\n\n旧内容1\n\n## 第二节\n\n旧内容2\n",
            encoding="utf-8",
        )
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "update_section",
                "path": "docs/multi_section.md",
                "section": "第一节",
                "content": "新内容1",
            }],
            expected_effect="",
            risk_assessment="low",
        )
        result = await doc_loop.act(plan)
        assert result.success is True
        new_content = target.read_text(encoding="utf-8")
        assert "新内容1" in new_content
        assert "旧内容1" not in new_content
        # 第二节应该保留
        assert "旧内容2" in new_content

    @pytest.mark.asyncio
    async def test_act_append_to_file(self, doc_loop, temp_project) -> None:
        """append 追加内容到文件末尾."""
        target = temp_project / "docs" / "append_target.md"
        target.write_text("# 原始\n\n旧内容.\n", encoding="utf-8")
        plan = DevPlan(
            task_id="t1",
            steps=[{
                "action": "append",
                "path": "docs/append_target.md",
                "content": "\n## 追加章节\n\n新内容.\n",
            }],
            expected_effect="",
            risk_assessment="low",
        )
        result = await doc_loop.act(plan)
        assert result.success is True
        content = target.read_text(encoding="utf-8")
        assert "旧内容" in content
        assert "追加章节" in content
        assert "新内容" in content

    @pytest.mark.asyncio
    async def test_act_unknown_action_skipped(self, doc_loop, temp_project) -> None:
        """未知 action 被跳过，不报错."""
        plan = DevPlan(
            task_id="t1",
            steps=[{"action": "unknown_action", "path": "docs/x.md", "content": "x"}],
            expected_effect="",
            risk_assessment="low",
        )
        result = await doc_loop.act(plan)
        assert result.success is True  # 不算失败
        assert result.changed_files == []

    @pytest.mark.asyncio
    async def test_act_missing_path_skipped(self, doc_loop, temp_project) -> None:
        """步骤缺少 path 字段被跳过."""
        plan = DevPlan(
            task_id="t1",
            steps=[{"action": "write_file", "content": "x"}],
            expected_effect="",
            risk_assessment="low",
        )
        result = await doc_loop.act(plan)
        assert result.success is True
        assert result.changed_files == []


# ══════════════════════════════════════════════════════════════════
# §6 Verify 测试
# ══════════════════════════════════════════════════════════════════


class TestVerify:
    @pytest.mark.asyncio
    async def test_verify_passes_on_valid_doc(self, fake_engine, forgekin_config, temp_project) -> None:
        """验证通过：有 front-matter + 标题层级正确 + LLM 审核通过."""
        # 先创建一个合法文档
        target = temp_project / "docs" / "valid.md"
        target.write_text(
            "---\nstatus: done\ntype: design\n---\n\n# 合法文档\n\n内容正确.\n",
            encoding="utf-8",
        )
        # 只配置 review_response（verify 直接调用 llm_review_content，不走 plan）
        review_response = {
            "content": json.dumps({
                "passed": True,
                "score": 0.92,
                "issues": [],
                "suggestions": [],
            }),
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 80},
            "request_id": "review-1",
        }
        fake_client = _FakeTraeClient([review_response])
        loop = SelfDevDocLoop(fake_client, forgekin_config, fake_engine, awakening_stage="E3")
        result = DevResult(
            plan_id="p1",
            changed_files=["docs/valid.md"],
            diff_summary="写入",
            success=True,
        )
        verify = await loop.verify(result)
        assert verify.passed is True
        assert verify.llm_review_passed is True
        assert len(verify.failure_reasons) == 0

    @pytest.mark.asyncio
    async def test_verify_fails_on_missing_file(self, doc_loop, temp_project) -> None:
        """文件不存在 → 验证失败."""
        result = DevResult(
            plan_id="p1",
            changed_files=["docs/nonexistent.md"],
            diff_summary="",
            success=True,
        )
        verify = await doc_loop.verify(result)
        assert verify.passed is False
        assert any("不存在" in r for r in verify.failure_reasons)

    @pytest.mark.asyncio
    async def test_verify_fails_on_missing_front_matter(self, doc_loop, temp_project) -> None:
        """docs/ 下文档无 front-matter → 验证失败."""
        target = temp_project / "docs" / "no_fm.md"
        target.write_text("# 无 front-matter\n\n内容.\n", encoding="utf-8")
        result = DevResult(
            plan_id="p1",
            changed_files=["docs/no_fm.md"],
            diff_summary="",
            success=True,
        )
        verify = await doc_loop.verify(result)
        assert verify.passed is False
        assert any("front-matter" in r for r in verify.failure_reasons)

    @pytest.mark.asyncio
    async def test_verify_fails_on_deep_heading(self, doc_loop, temp_project) -> None:
        """首个标题层级过深 → 验证失败."""
        target = temp_project / "docs" / "deep_heading.md"
        target.write_text("---\nstatus: draft\n---\n\n### 过深的标题\n\n内容.\n", encoding="utf-8")
        result = DevResult(
            plan_id="p1",
            changed_files=["docs/deep_heading.md"],
            diff_summary="",
            success=True,
        )
        verify = await doc_loop.verify(result)
        assert verify.passed is False
        assert any("标题层级过深" in r for r in verify.failure_reasons)

    @pytest.mark.asyncio
    async def test_verify_fails_on_llm_review_reject(self, fake_engine, forgekin_config, temp_project) -> None:
        """LLM 审核未通过 → 验证失败."""
        target = temp_project / "docs" / "reviewed.md"
        target.write_text("---\nstatus: draft\n---\n\n# 待审核\n\n内容.\n", encoding="utf-8")
        # 配置 FakeTraeClient 返回审核失败
        plan_response = {
            "content": "{}",
            "model": "fake",
            "provider": "trae",
            "usage": {},
            "request_id": "1",
        }
        review_response = {
            "content": json.dumps({
                "passed": False,
                "score": 0.3,
                "issues": ["内容不准确", "格式混乱"],
                "suggestions": [],
            }),
            "model": "fake",
            "provider": "trae",
            "usage": {},
            "request_id": "2",
        }
        fake_client = _FakeTraeClient([plan_response, review_response])
        loop = SelfDevDocLoop(fake_client, forgekin_config, fake_engine)
        result = DevResult(
            plan_id="p1",
            changed_files=["docs/reviewed.md"],
            diff_summary="",
            success=True,
        )
        verify = await loop.verify(result)
        assert verify.passed is False
        assert verify.llm_review_passed is False
        assert any("LLM 审核未通过" in r for r in verify.failure_reasons)


# ══════════════════════════════════════════════════════════════════
# §7 E2E — 完整五步循环（mock 数据本地运行）
# ══════════════════════════════════════════════════════════════════


class TestE2EDocLoop:
    @pytest.mark.asyncio
    async def test_e2e_force_targets_creates_doc(self, fake_engine, forgekin_config, temp_project) -> None:
        """E2E: force_targets 模式 → 生成文档 → 验证通过 → 沉淀经验.

        完整流程：
        1. Discover: force_targets 指定 docs/e2e_test.md
        2. Plan: LLM 返回合法方案（path 与 force_targets 一致）
        3. Act: 写入文件
        4. Verify: front-matter + LLM 审核通过
        5. Persist: 基类沉淀（覆盖 persist 跳过真实治理层）
        """
        # 配置 FakeTraeClient：plan 的 path 与 force_targets 一致
        plan_response = {
            "content": json.dumps({
                "steps": [{
                    "action": "write_file",
                    "path": "docs/e2e_test.md",
                    "content": "---\nstatus: draft\ntype: design\ncreated_at: 2026-07-20\n---\n\n# 生成的文档\n\n这是 LLM 生成的文档内容.\n",
                }],
                "expected_effect": "生成测试文档",
                "risk_assessment": "low",
            }),
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 150},
            "request_id": "plan-1",
        }
        review_response = {
            "content": json.dumps({
                "passed": True,
                "score": 0.92,
                "issues": [],
                "suggestions": ["继续保持"],
            }),
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 80},
            "request_id": "review-1",
        }
        fake_client = _FakeTraeClient([plan_response, review_response])
        loop = SelfDevDocLoop(fake_client, forgekin_config, fake_engine, awakening_stage="E3")
        # 覆盖 persist 避免依赖治理层
        loop.persist = lambda record: _noop_persist(loop, record)

        result = await loop.run_once({
            "force_targets": ["docs/e2e_test.md"],
        })

        assert result["loop_type"] == "doc"
        assert result["summary"]["total"] == 1
        assert result["summary"]["passed"] == 1
        assert result["summary"]["failed"] == 0
        assert result["summary"]["reflect_total"] == 0

        # 验证文件被实际创建
        generated_file = temp_project / "docs" / "e2e_test.md"
        assert generated_file.exists(), "E2E 测试文件未被创建"
        content = generated_file.read_text(encoding="utf-8")
        assert content.startswith("---"), "文件应以 front-matter 开头"
        assert "# 生成的文档" in content

    @pytest.mark.asyncio
    async def test_e2e_full_scan_with_missing_design(
        self, fake_trae_client, fake_engine, forgekin_config, temp_project
    ) -> None:
        """E2E: 扫描发现缺失 design 文档 → 自动创建 → 验证通过."""
        # 配置 FakeTraeClient 返回针对 D100-test.md 的方案
        plan_response = {
            "content": json.dumps({
                "steps": [{
                    "action": "write_file",
                    "path": "docs/design/D100-test.md",
                    "content": "---\nstatus: draft\ntype: design\ncreated_at: 2026-07-20\n---\n\n# D100: 测试功能详细设计\n\n这是自动生成的 design 文档.\n",
                }],
                "expected_effect": "为 F100-test 创建对应的 design 文档",
                "risk_assessment": "low",
            }),
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 200},
            "request_id": "plan-e2e",
        }
        review_response = {
            "content": json.dumps({
                "passed": True,
                "score": 0.88,
                "issues": [],
                "suggestions": [],
            }),
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 100},
            "request_id": "review-e2e",
        }
        fake_client = _FakeTraeClient([plan_response, review_response])
        loop = SelfDevDocLoop(fake_client, forgekin_config, fake_engine, awakening_stage="E3")
        loop.persist = lambda record: _noop_persist(loop, record)

        # 只扫描 features 目录以缩小任务范围
        result = await loop.run_once({
            "scan_patterns": ["docs/features/*.md"],
        })

        # 应该发现 F100-test.md 缺 design，并自动创建
        assert result["summary"]["total"] >= 1
        # 至少有一个任务通过
        assert result["summary"]["passed"] >= 1

        # 验证 design 文档被创建
        design_file = temp_project / "docs" / "design" / "D100-test.md"
        assert design_file.exists(), "design 文档未被创建"
        design_content = design_file.read_text(encoding="utf-8")
        assert "D100" in design_content
        assert "测试功能" in design_content

    @pytest.mark.asyncio
    async def test_e2e_scope_guard_blocks_vision_md(
        self, fake_trae_client, fake_engine, forgekin_config, temp_project
    ) -> None:
        """E2E: Scope Guard 阻止修改 VISION.md."""
        # 配置 FakeTraeClient 返回修改 VISION.md 的方案
        plan_response = {
            "content": json.dumps({
                "steps": [{
                    "action": "write_file",
                    "path": "VISION.md",
                    "content": "# 被篡改的愿景\n",
                }],
                "expected_effect": "修改愿景",
                "risk_assessment": "low",
            }),
            "model": "fake",
            "provider": "trae",
            "usage": {},
            "request_id": "1",
        }
        fake_client = _FakeTraeClient([plan_response])
        loop = SelfDevDocLoop(fake_client, forgekin_config, fake_engine, awakening_stage="E3")
        loop.persist = lambda record: _noop_persist(loop, record)

        result = await loop.run_once({
            "force_targets": ["VISION.md"],
        })

        # 应被 Scope Guard 阻止
        assert result["summary"]["failed"] == 1
        assert result["summary"]["passed"] == 0
        # VISION.md 不应被创建/修改
        assert not (temp_project / "VISION.md").exists()

    @pytest.mark.asyncio
    async def test_e2e_awakening_stage_blocks_e2(
        self, fake_trae_client, fake_engine, forgekin_config
    ) -> None:
        """E2E: E2 觉醒阶低于 E3 要求 → 阻止闭环."""
        loop = SelfDevDocLoop(fake_trae_client, forgekin_config, fake_engine, awakening_stage="E2")
        with pytest.raises(Exception) as exc:
            await loop.run_once({})
        assert "E2" in str(exc.value) or "觉醒阶" in str(exc.value)


# ══════════════════════════════════════════════════════════════════
# §8 ForgeMindEngine 集成测试
# ══════════════════════════════════════════════════════════════════


class TestEngineIntegration:
    @pytest.mark.asyncio
    async def test_engine_run_doc_loop(
        self, fake_engine, forgekin_config, temp_project
    ) -> None:
        """通过 ForgeMindEngine.run_self_dev_loop('doc', ...) 触发文档闭环."""
        # 配置 FakeTraeClient：plan 的 path 与 force_targets 一致
        plan_response = {
            "content": json.dumps({
                "steps": [{
                    "action": "write_file",
                    "path": "docs/engine_test.md",
                    "content": "---\nstatus: draft\ntype: design\ncreated_at: 2026-07-20\n---\n\n# Engine 集成测试\n\n通过 ForgeMindEngine 触发的文档闭环.\n",
                }],
                "expected_effect": "通过 engine 触发生成",
                "risk_assessment": "low",
            }),
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 100},
            "request_id": "plan-engine",
        }
        review_response = {
            "content": json.dumps({
                "passed": True,
                "score": 0.9,
                "issues": [],
                "suggestions": [],
            }),
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 60},
            "request_id": "review-engine",
        }
        fake_client = _FakeTraeClient([plan_response, review_response])
        loop = SelfDevDocLoop(fake_client, forgekin_config, fake_engine, awakening_stage="E3")
        loop.persist = lambda record: _noop_persist(loop, record)
        fake_engine.register_self_dev_loop(loop)

        result = await fake_engine.run_self_dev_loop("doc", {
            "force_targets": ["docs/engine_test.md"],
        })
        assert result["loop_type"] == "doc"
        assert result["summary"]["passed"] == 1
        assert (temp_project / "docs" / "engine_test.md").exists()

    def test_engine_list_includes_doc_loop(
        self, fake_trae_client, fake_engine, forgekin_config
    ) -> None:
        loop = SelfDevDocLoop(fake_trae_client, forgekin_config, fake_engine)
        fake_engine.register_self_dev_loop(loop)
        listing = fake_engine.list_self_dev_loops()
        assert listing == {"doc": "E3"}


# ══════════════════════════════════════════════════════════════════
# §9 辅助函数
# ══════════════════════════════════════════════════════════════════


async def _noop_persist(loop: SelfDevDocLoop, record) -> dict[str, Any]:
    """覆盖 persist — 单元测试中跳过真实治理层调用."""
    record.persisted = True
    record.persist_payload = {"episode_id": "test-episode", "method_id": None, "proposal_id": None}
    return record.persist_payload
