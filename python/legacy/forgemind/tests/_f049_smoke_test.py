"""F049 smoke test — 验证 SwarmCoordinator 核心流程与 I1-I6 不变量."""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

# 把 openclaw 根目录加入 sys.path，使 flowforge 包可被导入
_OPENCLAW_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_OPENCLAW_ROOT))
# 把 flowforge 目录加入 sys.path，使 config/ 等相对路径可访问
_FLOWFORGE_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_FLOWFORGE_ROOT))

from flowforge.forgemind.swarm import SwarmCoordinator, SwarmTask, SwarmTaskStatus


def main() -> None:
    cfg = yaml.safe_load(open(_FLOWFORGE_ROOT / "config" / "agent_swarm.yaml", encoding="utf-8"))["agent_swarm"]
    coord = SwarmCoordinator(config=cfg)
    print("注册 agent 数:", len(coord.list_agents()))
    for a in coord.list_agents():
        print(f"  - {a['agent_id']}: vendor={a['vendor']} caps={len(a['capabilities'])}项 workload={a['workload']}")

    # 任务1: doc_generation（应分给 wenxin）
    task1 = SwarmTask(
        title="写 F049 文档",
        description="...",
        required_capabilities=["doc_generation"],
    )
    tid1 = coord.submit_task(task1)
    print(f"提交任务1: {tid1}")

    # 任务2: code_review（author=sherlock/trae，I5 跨厂商应分给 vangogh/claude）
    task2 = SwarmTask(
        title="审查代码",
        description="...",
        required_capabilities=["code_review"],
        context={"author_agent_id": "forgemind:sherlock", "author_vendor": "trae"},
    )
    tid2 = coord.submit_task(task2)
    print(f"提交任务2: {tid2}")

    # 任务3: I6 自审测试（author=vangogh，reviewer 不能是 vangogh 自己）
    # 仅 vangogh 是 claude，I5+I6 双重过滤后应无候选 → PENDING
    task3 = SwarmTask(
        title="梵高自审测试",
        description="...",
        required_capabilities=["code_review"],
        context={"author_agent_id": "forgemind:vangogh", "author_vendor": "claude"},
    )
    tid3 = coord.submit_task(task3)
    print(f"提交任务3: {tid3}")

    async def run_dispatch() -> None:
        dispatched = await coord.dispatch()
        print(f"dispatch 分配成功: {dispatched}")
        for tid in [tid1, tid2, tid3]:
            t = coord.get_task(tid)
            print(f"  task {tid}: status={t.status.value} assigned={t.assigned_agent_id}")

    asyncio.run(run_dispatch())

    # I3 验证：未知能力应保持 PENDING
    task4 = SwarmTask(
        title="未知能力",
        description="...",
        required_capabilities=["unknown_capability"],
    )
    tid4 = coord.submit_task(task4)
    asyncio.run(coord.dispatch())
    t4 = coord.get_task(tid4)
    print(f"未知能力任务: status={t4.status.value} (应保持 pending)")
    assert t4.status == SwarmTaskStatus.PENDING, "I3 失败：未知能力任务不应被分发"

    # I5/I6 验证
    t1 = coord.get_task(tid1)
    t2 = coord.get_task(tid2)
    t3 = coord.get_task(tid3)
    assert t1.assigned_agent_id == "forgemind:wenxin", f"doc_generation 应分给 wenxin，实际 {t1.assigned_agent_id}"
    assert t2.assigned_agent_id == "forgemind:vangogh", f"code_review 应跨厂商分给 vangogh，实际 {t2.assigned_agent_id}"
    assert t3.status == SwarmTaskStatus.PENDING, "I6 失败：梵高不能自审"
    print("I3/I5/I6 不变量验证通过")

    # I4 验证：模拟 31s 前分配但无心跳 → reassign
    t1.assigned_at = datetime.now(timezone.utc) - timedelta(seconds=31)
    t1.heartbeat_at = None

    async def run_timeout() -> None:
        return await coord.check_timeouts()

    reassigned = asyncio.run(run_timeout())
    print(f"超时 reassign: {reassigned}")
    t1_after = coord.get_task(tid1)
    print(f"  task1 status={t1_after.status.value} retry_count={t1_after.retry_count}")
    assert tid1 in reassigned, "I4 失败：超时任务应被 reassign"
    assert t1_after.status == SwarmTaskStatus.REASSIGNED, f"I4 失败：状态应为 reassigned，实际 {t1_after.status}"
    assert t1_after.retry_count == 1, f"I4 失败：retry_count 应为 1，实际 {t1_after.retry_count}"
    print("I4 不变量验证通过")

    # I4 升级验证：连续 4 次 reassign 后应 FAILED
    t1_after.status = SwarmTaskStatus.ASSIGNED
    t1_after.assigned_agent_id = "forgemind:wenxin"
    t1_after.assigned_at = datetime.now(timezone.utc) - timedelta(seconds=31)
    t1_after.heartbeat_at = None
    asyncio.run(run_timeout())  # retry=2
    t1_after.status = SwarmTaskStatus.ASSIGNED
    t1_after.assigned_agent_id = "forgemind:wenxin"
    t1_after.assigned_at = datetime.now(timezone.utc) - timedelta(seconds=31)
    t1_after.heartbeat_at = None
    asyncio.run(run_timeout())  # retry=3
    t1_after.status = SwarmTaskStatus.ASSIGNED
    t1_after.assigned_agent_id = "forgemind:wenxin"
    t1_after.assigned_at = datetime.now(timezone.utc) - timedelta(seconds=31)
    t1_after.heartbeat_at = None
    asyncio.run(run_timeout())  # retry=4 > max_retries → FAILED
    t1_final = coord.get_task(tid1)
    print(f"  task1 最终 status={t1_final.status.value} retry_count={t1_final.retry_count} reason={t1_final.failure_reason[:50]}")
    assert t1_final.status == SwarmTaskStatus.FAILED, f"I4 升级失败：应 FAILED，实际 {t1_final.status}"
    print("I4 max_retries 升级 FAILED 验证通过")

    # heartbeat + 自动完成验证
    task5 = SwarmTask(
        title="heartbeat 测试",
        description="...",
        required_capabilities=["test_generation"],
    )
    tid5 = coord.submit_task(task5)
    asyncio.run(coord.dispatch())

    async def run_heartbeat() -> None:
        await coord.heartbeat("forgemind:davinci", task_id=tid5, progress=0.5)
        await coord.heartbeat("forgemind:davinci", task_id=tid5, progress=1.0)

    asyncio.run(run_heartbeat())
    t5 = coord.get_task(tid5)
    print(f"  task5 status={t5.status.value} (应 completed)")
    assert t5.status == SwarmTaskStatus.COMPLETED, f"heartbeat 完成验证失败：状态 {t5.status}"
    print("heartbeat 自动完成验证通过")

    # 能力互补验证：提交需要 doc+code 的任务（无单一 agent 同时覆盖两者）
    # wenxin 有 doc_generation，sherlock 有 code_generation
    # 主 agent 应为 wenxin 或 sherlock（覆盖度相同），complement 推荐搭档
    task6 = SwarmTask(
        title="多能力任务",
        description="...",
        required_capabilities=["doc_generation", "code_generation"],
    )
    tid6 = coord.submit_task(task6)
    asyncio.run(coord.dispatch())
    t6 = coord.get_task(tid6)
    complements = t6.context.get("complement_agents", {})
    print(f"  task6 complement_agents: {complements}")
    assert len(complements) >= 1, f"能力互补推荐缺失（实际: {complements}）"
    # 验证推荐的是真实有该能力的 agent
    for cap, complement_aid in complements.items():
        complement_caps = coord.list_agents()
        complement_info = next((a for a in complement_caps if a["agent_id"] == complement_aid), None)
        assert complement_info is not None, f"complement {complement_aid} 未注册"
        assert cap in complement_info["capabilities"], f"complement {complement_aid} 不具备 {cap}"
    print("能力互补 _find_complement_agent 验证通过")

    # run_continuously 验证：启动后立即 cancel
    async def run_loop() -> None:
        task = asyncio.create_task(coord.run_continuously(interval=0.1))
        await asyncio.sleep(0.3)  # 让它跑 3 轮
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(run_loop())
    print("run_continuously 持续调度循环验证通过")

    print("=== F049 所有不变量与核心流程验证通过 ===")


if __name__ == "__main__":
    main()
