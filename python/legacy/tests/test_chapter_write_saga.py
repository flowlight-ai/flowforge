"""ChapterWriteSaga 单元测试.

验证多步骤原子性写入 Saga 的状态机、步骤失败处理、补偿机制和自定义步骤注册。
"""

import asyncio

import pytest

from flowforge.tools.chapter_write_saga import (
    ChapterWriteSaga,
    SagaContext,
    SagaState,
    SagaStep,
    SagaStepResult,
)


# ═══════════════════════════════════════════════════════════════════════
# ChapterWriteSaga 测试
# ═══════════════════════════════════════════════════════════════════════


class TestChapterWriteSaga:
    """章节写入 Saga 测试."""

    def test_saga_success(self):
        """所有步骤成功 → COMPLETED 状态."""
        saga = ChapterWriteSaga()
        context = SagaContext(chapter_id="ch1", novel_id="novel1")

        result = asyncio.run(saga.execute(context))

        assert saga.get_state() == SagaState.COMPLETED
        assert len(result.step_results) == 5
        assert all(r.success for r in result.step_results)
        assert result.step_results[0].step_name == "write_draft"
        assert result.step_results[1].step_name == "consistency_check"
        assert result.step_results[2].step_name == "style_alignment"
        assert result.step_results[3].step_name == "quality_gate"
        assert result.step_results[4].step_name == "finalize"
        # 默认步骤设置的 state
        assert context.state.get("draft") == ""
        assert context.state.get("style_aligned") is True

    def test_saga_step_failure(self):
        """步骤 1 失败 → FAILED 状态，触发补偿机制."""
        saga = ChapterWriteSaga()

        async def failing_draft(ctx):
            raise RuntimeError("draft generation failed")

        async def compensate_draft(ctx):
            ctx.state["compensated"] = True

        saga.register_step(
            "write_draft", failing_draft, compensate_draft, "failing draft"
        )

        context = SagaContext(chapter_id="ch1", novel_id="novel1")
        context.state["initial"] = "state"

        result = asyncio.run(saga.execute(context))

        assert saga.get_state() == SagaState.FAILED
        assert len(result.step_results) == 1
        assert result.step_results[0].success is False
        assert result.step_results[0].step_name == "write_draft"
        assert "draft generation failed" in result.step_results[0].error
        # pre_saga_snapshot 应已保存（补偿机制的一部分）
        assert "initial" in result.pre_saga_snapshot
        assert result.pre_saga_snapshot["initial"] == "state"

    def test_saga_consistency_check_failure(self):
        """步骤 2（一致性检查）失败 → 标记后继续，最终 COMPLETED."""
        saga = ChapterWriteSaga()

        async def failing_check(ctx):
            raise RuntimeError("consistency check failed")

        async def noop_compensate(ctx):
            pass

        saga.register_step(
            "consistency_check", failing_check, noop_compensate, "failing check"
        )

        context = SagaContext(chapter_id="ch1")
        result = asyncio.run(saga.execute(context))

        assert saga.get_state() == SagaState.COMPLETED
        assert context.state.get("has_inconsistencies") is True
        # consistency_check 步骤失败
        check_result = next(
            r for r in result.step_results if r.step_name == "consistency_check"
        )
        assert check_result.success is False
        assert "consistency check failed" in check_result.error
        # 所有 5 步都执行了
        assert len(result.step_results) == 5

    def test_saga_style_alignment_failure(self):
        """步骤 3（风格对齐）失败 → 使用原始草稿，最终 COMPLETED."""
        saga = ChapterWriteSaga()

        async def failing_align(ctx):
            raise RuntimeError("style alignment failed")

        async def noop_compensate(ctx):
            pass

        saga.register_step(
            "style_alignment", failing_align, noop_compensate, "failing align"
        )

        context = SagaContext(chapter_id="ch1")
        result = asyncio.run(saga.execute(context))

        assert saga.get_state() == SagaState.COMPLETED
        assert context.state.get("style_aligned") is False
        # style_alignment 步骤失败
        align_result = next(
            r for r in result.step_results if r.step_name == "style_alignment"
        )
        assert align_result.success is False
        assert "style alignment failed" in align_result.error
        # 所有 5 步都执行了
        assert len(result.step_results) == 5

    def test_register_step_replaces_existing(self):
        """注册自定义步骤替换已有步骤."""
        saga = ChapterWriteSaga()
        called = []

        async def custom_action(ctx):
            called.append("custom_action")
            return {"custom": True}

        async def custom_compensate(ctx):
            called.append("custom_compensate")

        saga.register_step(
            "write_draft", custom_action, custom_compensate, "custom draft"
        )

        # 验证步骤被替换
        step = next(s for s in saga._steps if s.name == "write_draft")
        assert step.description == "custom draft"
        assert step.action is custom_action
        assert step.compensate is custom_compensate

        # 执行并验证自定义步骤被调用
        context = SagaContext(chapter_id="ch1")
        asyncio.run(saga.execute(context))

        assert "custom_action" in called

    def test_register_step_appends_new(self):
        """注册新步骤追加到末尾."""
        saga = ChapterWriteSaga()
        initial_count = len(saga._steps)

        async def extra_action(ctx):
            return {"extra": True}

        async def extra_compensate(ctx):
            pass

        saga.register_step("extra_step", extra_action, extra_compensate, "extra")

        assert len(saga._steps) == initial_count + 1
        assert saga._steps[-1].name == "extra_step"
        assert saga._steps[-1].description == "extra"

    def test_saga_pre_saga_snapshot_saved(self):
        """执行前保存 pre_saga 快照."""
        saga = ChapterWriteSaga()
        context = SagaContext(chapter_id="ch1")
        context.state["before"] = "data"

        result = asyncio.run(saga.execute(context))

        assert result.pre_saga_snapshot.get("before") == "data"

    def test_saga_initial_state_pending(self):
        """新建 Saga 初始状态为 PENDING."""
        saga = ChapterWriteSaga()
        assert saga.get_state() == SagaState.PENDING

    def test_saga_default_steps_count(self):
        """默认有 5 个步骤."""
        saga = ChapterWriteSaga()
        assert len(saga._steps) == 5
        step_names = [s.name for s in saga._steps]
        assert step_names == [
            "write_draft",
            "consistency_check",
            "style_alignment",
            "quality_gate",
            "finalize",
        ]
