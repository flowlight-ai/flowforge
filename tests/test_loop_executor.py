"""Tests for LoopExecutor 新架构（v7.0）— 状态模型 / ReflexionReflector 规则反思 / 快速失败静态逻辑。

P-14 修复：旧 API（action_fn / Verifier(reviewer=) / Reflector(reflector_fn=) /
LoopState.should_terminate 等）已随 v7.0 Harness 驾驭层重构删除，原用例无法移植。
按源码现状重写为可单元测试的部分：LoopState/LoopResult/Verdict/Reflection 模型、
ReflexionReflector（无 LLM client 时的规则反思）、LoopExecutor 静态快速失败逻辑。
"""

from __future__ import annotations

import pytest

from flowforge.core.task_context import TaskContext
from flowforge.loop.executor import LoopExecutor
from flowforge.loop.reflector import ReflexionReflector
from flowforge.loop.state import LoopResult, LoopState, Reflection, Verdict


def _make_task() -> TaskContext:
    return TaskContext(task_id="test-task-1", input_data={"draft": "测试草稿"})


def _make_state() -> LoopState:
    return LoopState(loop_id="test-loop", task_id="test-task-1", template_name="test")


# ── 状态模型 ──────────────────────────────────────────────────────────


def test_loop_state_defaults() -> None:
    state = _make_state()
    assert state.phase.value == "planning"
    assert state.attempt == 0
    assert state.max_retries == 3
    assert state.past_errors == []
    assert state.verification_history == []
    assert state.reflection_history == []


def test_verdict_model_fields() -> None:
    verdict = Verdict(passed=False, score=0.3, errors=["质量不足"])
    assert verdict.passed is False
    assert verdict.score == 0.3
    assert verdict.errors == ["质量不足"]


def test_reflection_model_fields() -> None:
    reflection = Reflection(
        suggestions=["补充示例"],
        root_cause="提示词不清晰",
        plan_adjustments=[{"step": 1}],
    )
    dumped = reflection.model_dump()
    assert dumped["root_cause"] == "提示词不清晰"
    assert dumped["suggestions"] == ["补充示例"]
    assert dumped["plan_adjustments"] == [{"step": 1}]


def test_loop_result_fields() -> None:
    result = LoopResult(success=False, error="boom", total_attempts=2, state=None)
    assert result.success is False
    assert result.error == "boom"
    assert result.total_attempts == 2


# ── ReflexionReflector（无 LLM client → 规则反思）────────────────────


@pytest.mark.asyncio
async def test_reflector_empty_errors_returns_empty_reflection() -> None:
    reflector = ReflexionReflector(llm_client=None)
    reflection = await reflector.reflect([], _make_task(), _make_state())
    assert isinstance(reflection, Reflection)
    assert reflection.suggestions == []
    assert reflection.root_cause == ""
    assert reflection.plan_adjustments == []


@pytest.mark.asyncio
async def test_reflector_rule_based_timeout_suggestion() -> None:
    reflector = ReflexionReflector(llm_client=None)
    reflection = await reflector.reflect(
        ["execution timeout after 120s"], _make_task(), _make_state()
    )
    assert "执行超时" in reflection.root_cause
    assert any("超时" in s for s in reflection.suggestions)


@pytest.mark.asyncio
async def test_reflector_rule_based_unknown_error() -> None:
    reflector = ReflexionReflector(llm_client=None)
    reflection = await reflector.reflect(
        ["奇怪的错误 abc123"], _make_task(), _make_state()
    )
    assert "未分类错误" in reflection.root_cause
    assert reflection.suggestions  # 有兜底建议


def test_parse_reflection_response_json() -> None:
    reflector = ReflexionReflector(llm_client=None)
    parsed = reflector._parse_reflection_response(
        '{"root_cause": "提示词不清晰", "suggestions": ["补充示例", "明确格式"], '
        '"plan_adjustments": []}'
    )
    assert parsed is not None
    assert parsed.root_cause == "提示词不清晰"
    assert parsed.suggestions == ["补充示例", "明确格式"]


def test_parse_reflection_response_markdown_json() -> None:
    reflector = ReflexionReflector(llm_client=None)
    parsed = reflector._parse_reflection_response(
        '```json\n{"root_cause": "内容为空", "suggestions": ["检查LLM调用"]}\n```'
    )
    assert parsed is not None
    assert parsed.root_cause == "内容为空"
    assert parsed.suggestions == ["检查LLM调用"]


# ── LoopExecutor 静态逻辑（快速失败 / 退避 / 内容有效性）──────────────


def test_is_refusal_result_detects_llm_refusal() -> None:
    # 明确拒绝响应（INVALID_RESPONSES 精确匹配）
    assert LoopExecutor._is_refusal_result({"content": "无法回答"}) is True
    # silent failure 模式（INVALID_RESPONSE_PATTERNS 子串匹配）
    assert LoopExecutor._is_refusal_result({"content": "当前不可用，请稍后重试"}) is True
    # 正常内容 → 不触发快速失败
    assert LoopExecutor._is_refusal_result({"content": "正常生成的文章内容"}) is False
    # 非 dict → 不触发
    assert LoopExecutor._is_refusal_result("无法回答") is False
    # 嵌套 JSON 包装也需识别
    assert LoopExecutor._is_refusal_result(
        {"content": '{"draft": "无法回答"}'}
    ) is True


def test_calc_backoff_strategies() -> None:
    assert LoopExecutor._calc_backoff("fixed", 2, 0) == 2.0
    assert LoopExecutor._calc_backoff("linear", 2, 2) == 6.0
    assert LoopExecutor._calc_backoff("exponential", 2, 2) == 8.0
    assert LoopExecutor._calc_backoff("unknown", 2, 1) == 2.0


def test_is_valid_recovered_content() -> None:
    # prompt 模板片段（### 三级标题）→ 无效
    assert LoopExecutor._is_valid_recovered_content("### 合规红线\n规则内容") is False
    # 二级标题且无一级标题 → 无效
    assert LoopExecutor._is_valid_recovered_content("## 引言\n段落内容") is False
    # 一级标题开头 → 有效
    assert LoopExecutor._is_valid_recovered_content("# 测试文章\n正文内容……") is True
    # 中文 ≥50 字 → 有效
    long_cn = (
        "这是一段包含五十个以上中文字符的正文内容，用于验证恢复内容有效性判定逻辑"
        "是否正常工作，请继续补充更多文字以确保达到阈值要求，这里再添一些内容。"
    )
    assert LoopExecutor._is_valid_recovered_content(long_cn) is True
    # 空/空白 → 无效
    assert LoopExecutor._is_valid_recovered_content("   ") is False
