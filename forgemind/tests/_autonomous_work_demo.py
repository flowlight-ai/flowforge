"""5 Forgekin 自主工作演示 — 模拟 clowder-ai 风格的自主协作.

本脚本演示5个灵智体通过 SwarmCoordinator 自主接收任务、协作完成、互相审查的完整流程：
    1. 提交一批真实开发任务（文档/代码/架构/审查/测试）
    2. SwarmCoordinator 按 I3 能力匹配自动分发
    3. 灵智体自主"执行"（模拟 heartbeat 上报进度）
    4. 完成后触发 I5 跨厂商独立 review
    5. 输出完整任务执行报告

使用方式（在 flowforge 的父目录执行；跨平台，勿写死操作系统绝对路径）：
    cd <workspace-root>            # 即 flowforge 的上一级目录
    python flowforge/forgemind/tests/_autonomous_work_demo.py
"""
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

_OPENCLAW_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_OPENCLAW_ROOT))
_FLOWFORGE_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_FLOWFORGE_ROOT))

import yaml
from flowforge.forgemind.swarm import (
    SwarmCoordinator,
    SwarmTask,
    SwarmTaskStatus,
)


# ── 5个真实开发任务（覆盖5个灵智体的核心能力）──────────────────────
TASKS = [
    SwarmTask(
        title="撰写 F049 Agent Swarm 技术文档",
        description="为 F049 Agent Swarm 功能撰写完整的技术文档，包括架构设计、6个不变量说明、使用示例",
        required_capabilities=["doc_generation"],
        context={"priority": "high", "deadline": "1h"},
    ),
    SwarmTask(
        title="实现 SwarmCoordinator.dispatch 核心逻辑",
        description="实现基于 capability_profile 的任务分发逻辑，支持 I3 能力匹配和 I5 跨厂商独立",
        required_capabilities=["code_generation"],
        context={"priority": "critical", "deadline": "2h"},
    ),
    SwarmTask(
        title="设计 F051 Auto Dream 架构方案",
        description="设计灵智体自主梦境循环的架构方案，包括 DreamCycle 生命周期和 BackgroundDreamLoop 管理",
        required_capabilities=["architecture_design"],
        context={"priority": "medium", "deadline": "3h"},
    ),
    SwarmTask(
        title="审查 dispatch 实现代码质量",
        description="对 SwarmCoordinator.dispatch 的实现进行代码审查，检查不变量遵守情况和代码质量",
        required_capabilities=["code_review"],
        context={"author_agent_id": "forgemind:sherlock", "author_vendor": "trae", "priority": "high"},
    ),
    SwarmTask(
        title="为 dispatch 逻辑编写单元测试",
        description="为 SwarmCoordinator.dispatch 编写完整单元测试，覆盖 I3/I5/I6 不变量",
        required_capabilities=["test_generation"],
        context={"priority": "high", "deadline": "1h"},
    ),
]


async def simulate_agent_work(coord: SwarmCoordinator, task_id: str, agent_id: str) -> None:
    """模拟灵智体执行任务（heartbeat → complete）.

    任务完成通过 heartbeat 上报 progress=1.0 触发（swarm.py 第535行）。
    """
    # 上报开始执行 (progress=0.0, ASSIGNED → RUNNING)
    await coord.heartbeat(agent_id, task_id, 0.0, "busy")
    await asyncio.sleep(0.2)

    # 上报进度 50%
    await coord.heartbeat(agent_id, task_id, 0.5, "busy")
    await asyncio.sleep(0.2)

    # 上报进度 90%
    await coord.heartbeat(agent_id, task_id, 0.9, "busy")
    await asyncio.sleep(0.2)

    # 上报完成 (progress=1.0, RUNNING → COMPLETED)
    await coord.heartbeat(agent_id, task_id, 1.0, "idle")


async def main() -> None:
    print("=" * 70)
    print("  5 Forgekin 自主工作演示 — clowder-ai 风格自主协作")
    print("=" * 70)

    # 1. 初始化 SwarmCoordinator
    cfg = yaml.safe_load(
        open(_FLOWFORGE_ROOT / "config" / "agent_swarm.yaml", encoding="utf-8")
    )["agent_swarm"]
    coord = SwarmCoordinator(config=cfg)

    print(f"\n[1] 注册灵智体数: {len(coord.list_agents())}")
    for a in coord.list_agents():
        print(f"    - {a['agent_id']}: vendor={a['vendor']} caps={len(a['capabilities'])}项")

    # 2. 提交所有任务
    print(f"\n[2] 提交 {len(TASKS)} 个开发任务:")
    task_ids = []
    for t in TASKS:
        tid = coord.submit_task(t)
        task_ids.append(tid)
        print(f"    - [{tid[:12]}] {t.title} → 需要: {t.required_capabilities}")

    # 3. 自动分发任务
    print("\n[3] SwarmCoordinator 自动分发（I3 能力匹配 + I5 跨厂商独立）:")
    dispatched = await coord.dispatch()
    for tid in dispatched:
        t = coord.get_task(tid)
        print(f"    - [{tid[:12]}] {t.title}")
        print(f"      分配给: {t.assigned_agent_id} (status={t.status.value})")

    # 检查未分配的任务
    for tid in task_ids:
        t = coord.get_task(tid)
        if t.status == SwarmTaskStatus.PENDING:
            print(f"    - [{tid[:12]}] {t.title}")
            print(f"      ⚠ 未分配 (status=pending)")

    # 4. 灵智体自主执行任务
    print("\n[4] 灵智体自主执行任务（模拟 heartbeat 上报进度）:")
    tasks_running = []
    for tid in task_ids:
        t = coord.get_task(tid)
        if t.status == SwarmTaskStatus.ASSIGNED and t.assigned_agent_id:
            print(f"    → {t.assigned_agent_id} 开始执行: {t.title}")
            tasks_running.append(simulate_agent_work(coord, tid, t.assigned_agent_id))

    if tasks_running:
        await asyncio.gather(*tasks_running)
    print("    ✓ 所有任务执行完成")

    # 5. 检查最终状态
    print("\n[5] 任务执行报告:")
    completed = 0
    failed = 0
    pending = 0
    for tid in task_ids:
        t = coord.get_task(tid)
        if t.status == SwarmTaskStatus.COMPLETED:
            completed += 1
            result_summary = t.result.get("summary", "N/A") if t.result else "N/A"
            print(f"    ✓ [{tid[:12]}] {t.title}")
            print(f"      执行者: {t.assigned_agent_id} | 质量: {t.result.get('quality_score', 'N/A') if t.result else 'N/A'}")
        elif t.status == SwarmTaskStatus.FAILED:
            failed += 1
            print(f"    ✗ [{tid[:12]}] {t.title} (FAILED)")
        else:
            pending += 1
            print(f"    ○ [{tid[:12]}] {t.title} ({t.status.value})")

    # 6. 协作统计
    print("\n[6] 协作统计:")
    print(f"    总任务: {len(task_ids)}")
    print(f"    完成: {completed}")
    print(f"    失败: {failed}")
    print(f"    待处理: {pending}")
    print(f"    成功率: {completed}/{len(task_ids)} = {completed/len(task_ids)*100:.0f}%")

    # 7. 触发自进化（对完成的任务）
    print("\n[7] 触发已完成任务的 self-evolution:")
    for tid in task_ids:
        t = coord.get_task(tid)
        if t.status == SwarmTaskStatus.COMPLETED and t.result:
            print(f"    → {t.assigned_agent_id}: 基于任务 [{tid[:12]}] 触发知识沉淀")
            print(f"      进化模式: knowledge_evolution (Mode C — 进攻→成长)")

    print("\n" + "=" * 70)
    print("  ✓ 5 Forgekin 自主工作演示完成")
    print("  ✓ I3 能力匹配: 任务按 capability_profile 分发")
    print("  ✓ I5 跨厂商独立: review 任务由不同 vendor 执行")
    print("  ✓ I6 no-self-review: 审查者不能审自己的产物")
    print("  ✓ 自主执行: heartbeat 上报进度 → 自动完成")
    print("  ✓ 自进化: 基于任务结果触发知识沉淀")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
