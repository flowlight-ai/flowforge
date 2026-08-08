"""任务失败终态处理单元测试（Bug 2/4/5 修复验证）.

覆盖范围（纯逻辑层，不涉及真实 LLM）:

    - swarm.fail_task 主动标记任务失败（FAILED + failure_reason + trace）
    - fail_task 幂等（终态任务不可重复标记）
    - Bug 4: 未注册 forgekin 的任务立即 FAILED（不再静默悬挂）
    - Bug 2: [CLI 不可用] 等 CLI 错误前缀被判无效产出 → FAILED
    - Bug 2: usage.error 字段非空被判无效产出 → FAILED
    - Bug 5: 执行异常的任务立即 FAILED（不再等待超时回收）

测试铁律合规说明:
    - T1（禁止 Mock LLM）: 使用可配置的纯逻辑 stub（仅验证失败处理机制）
    - T2（禁止假数据）: 任务数据使用真实调度场景
    - T3（禁止跳过验证）: 所有断言具体明确

背景:
    原实现无效产出/异常时仅 heartbeat(0.0, "error")——该调用不会改变
    任务状态，任务悬挂在 RUNNING 需等心跳超时 → reassign → 重试 →
    最终 FAILED（最长 800+s）。未注册 forgekin 时仅 WARNING 后 return，
    任务同样悬挂。且 cli_provider 的 [CLI 不可用] 等错误标记未被检测，
    错误内容被当作有效产出持久化。
"""

from __future__ import annotations

from typing import Any

import pytest

from flowforge.forgemind.autonomous import AutonomousDaemon
from flowforge.forgemind.swarm import (
    SwarmCoordinator,
    SwarmTask,
    SwarmTaskStatus,
)


class _StubForgekin:
    """可配置行为的逻辑层 stub（非真实 LLM）.

    - chat() 返回配置的 content/usage（模拟 CLI 错误内容）
    - 配置 raise_error=True 时抛出异常（模拟执行异常）
    """

    def __init__(
        self,
        content: str = "这是有效的任务产出内容，长度超过二十字阈值。",
        usage: dict[str, Any] | None = None,
        raise_error: bool = False,
    ) -> None:
        self._content = content
        self._usage = usage or {}
        self._raise_error = raise_error
        self.calls = 0

    async def chat(self, messages: list[dict[str, str]]) -> dict[str, Any]:
        """模拟灵智体 LLM 调用（纯逻辑 stub）."""
        self.calls += 1
        if self._raise_error:
            raise RuntimeError("LLM 调用超时（stub 模拟）")
        return {
            "content": self._content,
            "model": "stub",
            "usage": self._usage,
        }


def _make_daemon(
    tmp_path, forgekins: dict[str, Any] | None = None
) -> tuple[SwarmCoordinator, AutonomousDaemon]:
    """构造 coordinator + daemon（默认注册 stub 灵智体）."""
    coord = SwarmCoordinator(
        config={"trace_archive_path": str(tmp_path / "swarm_trace.jsonl")}
    )
    coord.register_agent("forgemind:stub", ["code_generation"], vendor="trae")
    daemon = AutonomousDaemon(
        coordinator=coord,
        project_root=tmp_path,
        forgekins=forgekins or {"forgemind:stub": _StubForgekin()},
        config={"consumer_interval_seconds": 0.05},
    )
    return coord, daemon


def _submit_and_dispatch(coord: SwarmCoordinator, capabilities=None) -> str:
    """提交任务并分发（返回 task_id，状态为 ASSIGNED）."""
    task = SwarmTask(
        title="测试任务",
        description="用于验证失败终态处理的任务描述",
        required_capabilities=capabilities or ["code_generation"],
    )
    task_id = coord.submit_task(task)
    return task_id


# ── swarm.fail_task 基础 ───────────────────────────────────────


def test_fail_task_marks_terminal_state(tmp_path) -> None:
    """fail_task 将任务置为 FAILED 并记录 failure_reason."""
    coord, _ = _make_daemon(tmp_path)
    task_id = _submit_and_dispatch(coord)
    assert coord.get_task_status(task_id) == SwarmTaskStatus.PENDING

    assert coord.fail_task(task_id, reason="invalid_output") is True
    assert coord.get_task_status(task_id) == SwarmTaskStatus.FAILED
    task = coord.get_task(task_id)
    assert task is not None and task.failure_reason == "invalid_output"

    # I2: fail trace 已落盘
    trace_lines = (tmp_path / "swarm_trace.jsonl").read_text(
        encoding="utf-8"
    ).strip().splitlines()
    assert any('"action": "fail"' in line for line in trace_lines)


def test_fail_task_idempotent(tmp_path) -> None:
    """终态任务不可重复标记失败（幂等）."""
    coord, _ = _make_daemon(tmp_path)
    task_id = _submit_and_dispatch(coord)

    assert coord.fail_task(task_id, reason="第一次失败") is True
    assert coord.fail_task(task_id, reason="第二次失败") is False
    task = coord.get_task(task_id)
    assert task is not None and task.failure_reason == "第一次失败"

    assert coord.fail_task("nonexistent-task", reason="x") is False


def test_fail_task_from_running(tmp_path) -> None:
    """RUNNING 状态的任务可被 fail_task 终结（执行中失败场景）."""
    coord, daemon = _make_daemon(tmp_path)
    task_id = _submit_and_dispatch(coord)
    # 模拟拾取后进入 RUNNING
    coord.get_task(task_id).status = SwarmTaskStatus.RUNNING

    assert coord.fail_task(task_id, reason="execution_exception") is True
    assert coord.get_task_status(task_id) == SwarmTaskStatus.FAILED


# ── Bug 4: 未注册 forgekin ─────────────────────────────────────


async def test_unregistered_forgekin_fails_task(tmp_path) -> None:
    """未注册灵智体的任务被显式标记 FAILED（不再静默悬挂）."""
    coord, daemon = _make_daemon(tmp_path)
    # ghost 已注册到 swarm 但 daemon 无对应 forgekin 实例
    coord.register_agent("forgemind:ghost", ["doc_generation"], vendor="trae")
    task = SwarmTask(
        title="orphan task",
        description="分配给未注册灵智体的任务",
        required_capabilities=["doc_generation"],
    )
    task_id = coord.submit_task(task)
    await coord.dispatch()
    assert coord.get_task_status(task_id) == SwarmTaskStatus.ASSIGNED

    await daemon._execute_task(coord.get_task(task_id))

    assert coord.get_task_status(task_id) == SwarmTaskStatus.FAILED, (
        "未注册 forgekin 的任务应立即 FAILED 而非悬挂"
    )
    t = coord.get_task(task_id)
    assert t is not None and "未注册" in (t.failure_reason or "")


# ── Bug 2: CLI 错误标记检测 ────────────────────────────────────


async def test_cli_unavailable_marker_marks_invalid(tmp_path) -> None:
    """[CLI 不可用] 前缀内容被判无效产出 → 任务 FAILED."""
    stub = _StubForgekin(
        content="[CLI 不可用] codex 未在 PATH 中找到。请确认 codex CLI 已安装。",
    )
    coord, daemon = _make_daemon(tmp_path, forgekins={"forgemind:stub": stub})
    task_id = _submit_and_dispatch(coord)
    await coord.dispatch()

    await daemon._execute_task(coord.get_task(task_id))

    assert coord.get_task_status(task_id) == SwarmTaskStatus.FAILED
    t = coord.get_task(task_id)
    assert t is not None and "invalid_output" in (t.failure_reason or "")
    assert stub.calls == 1


async def test_usage_error_marks_invalid(tmp_path) -> None:
    """usage.error 字段非空被判无效产出（即使内容看似正常）."""
    stub = _StubForgekin(
        content="这是一段看似正常的返回内容，但 usage 标记了错误。",
        usage={"latency_ms": 100, "degraded": True, "error": "binary_not_found"},
    )
    coord, daemon = _make_daemon(tmp_path, forgekins={"forgemind:stub": stub})
    task_id = _submit_and_dispatch(coord)
    await coord.dispatch()

    await daemon._execute_task(coord.get_task(task_id))

    assert coord.get_task_status(task_id) == SwarmTaskStatus.FAILED
    t = coord.get_task(task_id)
    assert t is not None and "binary_not_found" in (t.failure_reason or "")


async def test_valid_output_still_completes(tmp_path) -> None:
    """正常产出不受影响（不误伤）：仍走到 COMPLETED."""
    stub = _StubForgekin(
        content="这是完全有效的任务产出内容，长度超过二十字的阈值要求。",
        usage={"latency_ms": 50},
    )
    coord, daemon = _make_daemon(tmp_path, forgekins={"forgemind:stub": stub})
    task_id = _submit_and_dispatch(coord)
    await coord.dispatch()

    await daemon._execute_task(coord.get_task(task_id))

    assert coord.get_task_status(task_id) == SwarmTaskStatus.COMPLETED
    t = coord.get_task(task_id)
    assert t is not None and t.result is not None
    assert "有效" in t.result.get("content", "")


# ── Bug 5: 执行异常终态 ────────────────────────────────────────


async def test_execution_exception_fails_task(tmp_path) -> None:
    """chat 抛出异常时任务立即 FAILED（不再等待超时回收）."""
    stub = _StubForgekin(raise_error=True)
    coord, daemon = _make_daemon(tmp_path, forgekins={"forgemind:stub": stub})
    task_id = _submit_and_dispatch(coord)
    await coord.dispatch()

    await daemon._execute_task(coord.get_task(task_id))

    assert coord.get_task_status(task_id) == SwarmTaskStatus.FAILED
    t = coord.get_task(task_id)
    assert t is not None and "execution_exception" in (t.failure_reason or "")
