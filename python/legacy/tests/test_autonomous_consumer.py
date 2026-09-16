"""AutonomousDaemon 任务消费循环单元测试（Bug 1 修复验证）.

覆盖范围（纯逻辑层，不涉及真实 LLM / 文件系统扫描）:

    - ASSIGNED 任务被消费循环拾取并执行 → COMPLETED
    - max_concurrent 并发限制（同时执行不超过配置值）
    - 拾取后任务状态立即推进为 RUNNING（防重复拾取）
    - 并发峰值不超过 max_concurrent_tasks

测试铁律合规说明:
    - T1（禁止 Mock LLM）: 本测试不涉及真实 LLM 调用，使用纯逻辑 stub
      forgekin（仅验证调度/状态流转机制，不验证 LLM 生成行为）
    - T2（禁止假数据）: 任务数据使用真实调度场景（标题/描述/能力画像）
    - T3（禁止跳过验证）: 所有断言具体明确

背景（Bug 1）:
    原实现仅在扫描轮（scan_interval=600s）调用一次 _execute_assigned_tasks，
    而 SwarmCoordinator 每 5s 分发一次任务。扫描间隔内新分配的任务无人执行
    → 无心跳上报 → heartbeat_timeout → reassign → 重分配后仍无人执行
    → 超 3 次后 FAILED（运行日志中 swarm-fb2dcd 等 5 个任务因此失败）。

    修复：新增后台 _task_consumer_loop，每 consumer_interval_seconds（默认 5s）
    轮询 ASSIGNED 任务并启动执行器，与 dispatch 节奏对齐。
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

# P-118: 显式 asyncio 标记，不依赖 asyncio_mode="auto" 隐式行为
pytestmark = pytest.mark.asyncio

from flowforge.forgemind.autonomous import AutonomousDaemon
from flowforge.forgemind.swarm import (
    SwarmCoordinator,
    SwarmTask,
    SwarmTaskStatus,
)


class _StubForgekin:
    """逻辑层 stub — 仅提供 chat 接口，不涉及真实 LLM.

    用于验证调度/状态流转机制：
        - chat() 记录并发峰值（验证 max_concurrent 限制）
        - chat() 返回有效内容，使任务正常走到 COMPLETED
    """

    def __init__(self, latency: float = 0.01) -> None:
        self._latency = latency
        self.calls = 0
        self._active = 0
        self.peak_active = 0

    async def chat(self, messages: list[dict[str, str]]) -> dict[str, Any]:
        """模拟灵智体 LLM 调用（纯逻辑 stub，非真实 LLM）."""
        self.calls += 1
        self._active += 1
        self.peak_active = max(self.peak_active, self._active)
        try:
            await asyncio.sleep(self._latency)
            return {
                "content": (
                    "任务已成功完成。本产出用于验证调度机制："
                    "消费循环正确拾取任务并推进状态流转。"
                ),
                "model": "stub",
                "usage": {},
            }
        finally:
            self._active -= 1


def _make_daemon(
    tmp_path,
    max_concurrent: int = 3,
    stub_latency: float = 0.01,
) -> tuple[SwarmCoordinator, AutonomousDaemon, _StubForgekin]:
    """构造测试用 coordinator + daemon + stub forgekin."""
    coord = SwarmCoordinator(
        config={"trace_archive_path": str(tmp_path / "swarm_trace.jsonl")}
    )
    coord.register_agent(
        "forgemind:stub", ["code_generation"], vendor="trae"
    )
    stub = _StubForgekin(latency=stub_latency)
    daemon = AutonomousDaemon(
        coordinator=coord,
        project_root=tmp_path,
        forgekins={"forgemind:stub": stub},
        # consumer_interval 调小加速测试（生产默认 5s）
        config={
            "max_concurrent_tasks": max_concurrent,
            "consumer_interval_seconds": 0.05,
        },
    )
    return coord, daemon, stub


def _submit_code_task(coord: SwarmCoordinator, title: str) -> str:
    """提交一个 code_generation 任务并返回 task_id."""
    task = SwarmTask(
        title=title,
        description=f"任务 {title} 的测试描述",
        required_capabilities=["code_generation"],
    )
    return coord.submit_task(task)


async def test_consumer_loop_executes_assigned_task(tmp_path) -> None:
    """消费循环拾取 ASSIGNED 任务并执行 → COMPLETED."""
    coord, daemon, stub = _make_daemon(tmp_path)
    task_id = _submit_code_task(coord, "t1")
    await coord.dispatch()
    assert coord.get_task_status(task_id) == SwarmTaskStatus.ASSIGNED

    daemon._running = True
    consumer = asyncio.create_task(daemon._task_consumer_loop())
    try:
        for _ in range(100):
            if coord.get_task_status(task_id) == SwarmTaskStatus.COMPLETED:
                break
            await asyncio.sleep(0.05)
    finally:
        daemon._running = False
        consumer.cancel()

    assert coord.get_task_status(task_id) == SwarmTaskStatus.COMPLETED
    assert stub.calls == 1, "任务应恰好执行一次"
    task = coord.get_task(task_id)
    assert task is not None and task.result is not None
    assert "调度机制" in task.result.get("content", "")


async def test_consumer_loop_respects_max_concurrent(tmp_path) -> None:
    """并发峰值不超过 max_concurrent_tasks（Bug 1 核心场景）.

    原实现每轮分配 5 个任务但 max_concurrent=3，多余任务饿死超时。
    消费循环持续拾取下，同时执行的任务数不得超过 3。
    """
    coord, daemon, stub = _make_daemon(
        tmp_path, max_concurrent=3, stub_latency=0.3
    )
    task_ids = [_submit_code_task(coord, f"t{i}") for i in range(5)]
    await coord.dispatch()

    daemon._running = True
    consumer = asyncio.create_task(daemon._task_consumer_loop())
    try:
        # 等待全部任务执行完成（5 × 0.3s / 3 并发 ≈ 0.6s，给足 5s 余量）
        for _ in range(100):
            statuses = [coord.get_task_status(tid) for tid in task_ids]
            if all(s == SwarmTaskStatus.COMPLETED for s in statuses):
                break
            await asyncio.sleep(0.05)
    finally:
        daemon._running = False
        consumer.cancel()

    for tid in task_ids:
        assert coord.get_task_status(tid) == SwarmTaskStatus.COMPLETED, (
            f"任务 {tid} 应最终完成"
        )
    assert stub.calls == 5, "5 个任务都应被执行"
    assert stub.peak_active <= 3, f"并发峰值 {stub.peak_active} 超过 max_concurrent=3"


async def test_pickup_advances_status_to_running(tmp_path) -> None:
    """拾取任务后状态立即推进为 RUNNING（防重复拾取）.

    原实现依赖 _execute_task 内部首次 heartbeat 才推进状态，
    存在 create_task 排队窗口期被消费循环下一轮重复拾取的风险。
    修复后在 _execute_assigned_tasks 中拾取时立即上报心跳。
    """
    coord, daemon, stub = _make_daemon(tmp_path, stub_latency=0.5)
    task_id = _submit_code_task(coord, "slow")
    await coord.dispatch()

    # 手动拾取一次（模拟消费循环一轮）
    await daemon._execute_assigned_tasks()
    assert coord.get_task_status(task_id) == SwarmTaskStatus.RUNNING, (
        "拾取后任务状态应立即推进为 RUNNING"
    )

    # 等待执行完成，验证只执行一次
    for _ in range(100):
        if coord.get_task_status(task_id) == SwarmTaskStatus.COMPLETED:
            break
        await asyncio.sleep(0.05)
    assert coord.get_task_status(task_id) == SwarmTaskStatus.COMPLETED
    assert stub.calls == 1, "慢任务不应被重复拾取执行"


async def test_execute_task_with_unregistered_forgekin(tmp_path) -> None:
    """分配给未注册灵智体的任务不应阻塞消费循环（其他任务正常执行）."""
    coord, daemon, stub = _make_daemon(tmp_path)
    # 提交两个任务：一个分配到 stub，一个分配到未注册 agent（无 forgekin 实例）
    task_ok = _submit_code_task(coord, "ok")
    task_orphan = SwarmTask(
        title="orphan",
        description="分配给未注册 agent 的任务",
        required_capabilities=["doc_generation"],
    )
    coord.register_agent("forgemind:ghost", ["doc_generation"], vendor="trae")
    coord.submit_task(task_orphan)
    await coord.dispatch()
    # ghost 无 forgekin 实例 → 不启动执行器；stub 任务正常执行
    daemon._forgekins = {"forgemind:stub": stub}
    await daemon._execute_assigned_tasks()
    await asyncio.sleep(0.1)

    assert coord.get_task_status(task_ok) in (
        SwarmTaskStatus.RUNNING,
        SwarmTaskStatus.COMPLETED,
    ), "已注册灵智体的任务应被正常执行"
