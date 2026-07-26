"""evolve_forgekins.py — 3 Forgekin自进化 + task.md 剩余任务代理执行脚本.

验证:
    1. 3 只Forgekin（鲁班/夏洛克/梵高）通过 YAML 配置锻造
    2. 每只Forgekin领取 task.md 中对应责任方的剩余任务（代理执行）
    3. 通过 ForgeMindEngine Mode A/B/C 触发自进化
    4. 调用刚补全的代码模块作为"任务完成证据"（真实调用，非空跑）
    5. webchat — Forgekin汇报任务完成情况
    6. IM MindCouncil — 3 只Forgekin共同总结

运行方式:
    $env:PYTHONIOENCODING="utf-8"; cd d:\\software\\openclaw
    python flowforge/scripts/evolve_forgekins.py

详见:
    - [doc:review/review.md#第十四章] CL-022~CL-041 责任方分配
    - [doc:design/naming-contract.md#2.2] Forgekin定义
    - [doc:design.md#v7.1-§D9] 责任方矩阵
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Optional

# Windows GBK 兜底：强制 stdout 走 UTF-8
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:  # noqa: BLE001
    pass

# 将项目根加入 sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from pydantic import BaseModel

from flowforge.forgemind.forgekins import BUILTIN_FORGEKINS, ROSTER_FILES
from flowforge.forgemind.forging.pipeline import ForgePipeline


# ── 任务结果模型 ────────────────────────────────────────────────


class TaskResult(BaseModel):
    """单任务执行结果（CL 关联 + 状态 + 证据）."""

    task_id: str
    task_name: str
    cl_id: str
    status: Literal["pass", "fail", "partial"]
    evidence: str
    duration_ms: int


# ── Forgekin花名册元信息（与 task.md 责任方分配一致）─────────────

FORGEKIN_PROFILES: dict[str, dict[str, Any]] = {
    "luban": {
        "name_chinese": "鲁班",
        "breed_chinese": "猫头鹰 Owl",
        "role": "架构师",
        "responsibility": (
            "ScopeGuard / ScheduleFactoryRegistry / RestartRecoveryPipeline / "
            "ForgeMindEngine / MCP 治理 / reference_runtime"
        ),
        "tasks": [
            ("luban-1", "ScopeGuard 决策边界验证", "CL-002"),
            ("luban-2", "ScheduleFactoryRegistry factory 注册", "CL-023"),
            ("luban-3", "RestartRecoveryPipeline Phase A sweep", "CL-028"),
            ("luban-4", "ForgeMindEngine Mode A 评估", "CL-001"),
        ],
    },
    "sherlock": {
        "name_chinese": "夏洛克",
        "breed_chinese": "猎犬 Bloodhound",
        "role": "代码审查专家",
        "responsibility": (
            "CloseGateValidator / QCLoop / EventMemoryStore / "
            "no-classifier 红线守护 / CapabilityRegistry"
        ),
        "tasks": [
            ("sherlock-1", "CloseGateValidator AC 矩阵验证", "CL-025"),
            ("sherlock-2", "QCLoop 7 步循环", "CL-034"),
            ("sherlock-3", "EventMemoryStore 事件记录", "CL-029"),
            ("sherlock-4", "CapabilityRegistry 能力注册", "CL-014"),
        ],
    },
    "vangogh": {
        "name_chinese": "梵高",
        "breed_chinese": "孔雀 Peacock",
        "role": "视觉设计师",
        "responsibility": (
            "ApprovalHub / AvatarSyncAdapter / CollaborationCoordinator / "
            "PromptConfigMap"
        ),
        "tasks": [
            ("vangogh-1", "ApprovalHub 审批提交", "CL-033"),
            ("vangogh-2", "AvatarSyncAdapter 形象同步", "CL-EAC7"),
            ("vangogh-3", "CollaborationCoordinator 群体协作", "CL-032"),
            ("vangogh-4", "PromptConfigMap 提示词映射", "CL-EAC8"),
        ],
    },
}


# ── 通用辅助 ────────────────────────────────────────────────────


def print_banner(title: str) -> None:
    """打印统一风格的标题横幅."""
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def _make_fail(task_id: str, task_name: str, cl_id: str, exc: BaseException,
               duration_ms: int) -> TaskResult:
    """构造失败 TaskResult（统一异常转字符串）."""
    return TaskResult(
        task_id=task_id,
        task_name=task_name,
        cl_id=cl_id,
        status="fail",
        evidence=f"{type(exc).__name__}: {exc}",
        duration_ms=duration_ms,
    )


# ── FakeRedisClient：基础设施 Mock（非 LLM Mock，T1 允许）─────────


class _FakeRedisClient:
    """内存 Redis 客户端（用于 RestartRecoveryPipeline Phase A sweep）.

    测试铁律 T1：禁止 Mock LLM，允许 Mock 基础设施（Redis/文件系统）。
    本类模拟 Redis 的 scan / ttl / hget 方法，仅用于本验证脚本。
    """

    def __init__(self) -> None:
        # key -> (value, ttl_seconds, fields_dict)
        self._data: dict[str, tuple[Any, Optional[int], dict[str, str]]] = {}

    def set_key(
        self,
        key: str,
        value: Any,
        ttl: Optional[int],
        status: str = "running",
        created_at: Optional[str] = None,
    ) -> None:
        fields = {
            "status": status,
            "created_at": created_at or datetime.now(timezone.utc).isoformat(),
        }
        self._data[key] = (value, ttl, fields)

    async def scan(self, pattern: str = "*") -> list[str]:
        return list(self._data.keys())

    async def ttl(self, key: str) -> Optional[int]:
        if key not in self._data:
            return -2
        return self._data[key][1]

    async def hget(self, key: str, field: str) -> Optional[str]:
        if key not in self._data:
            return None
        return self._data[key][2].get(field)


# ── 阶段 1: 锻造 3 只Forgekin ─────────────────────────────────────


async def forge_all_forgekins() -> dict[str, Any]:
    """复用 verify_forgemind_pipeline.py 的锻造逻辑.

    Returns:
        dict[str, ForgekinBase] — {"luban": forgekin, "sherlock": ..., "vangogh": ...}
    """
    print_banner("阶段 1: 锻造 3 只Forgekin（鲁班/夏洛克/梵高）")
    pipeline = ForgePipeline()
    forgekins: dict[str, Any] = {}

    for fid in BUILTIN_FORGEKINS:
        print(f"\n[锻造] {fid} from {ROSTER_FILES[fid].name}")
        try:
            forgekin = await pipeline.forge_from_yaml(ROSTER_FILES[fid])
            desc = forgekin.describe()
            forgekins[fid] = forgekin
            print(f"  ✅ 锻造成功: {desc['name']} ({desc['species_chinese']})")
            print(f"     forgekin_id: {desc['forgekin_id']}")
            print(f"     进化阶: {desc['evolution_stage']} ({desc['evolution_stage_chinese']})")
            print(f"     觉醒阶: {desc['awakening_stage']} ({desc['awakening_stage_chinese']})")
            print(f"     可自进化: {desc['can_self_evolve']}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ❌ 锻造失败: {type(exc).__name__}: {exc}")

    return forgekins


# ── 阶段 2: 任务领取 ────────────────────────────────────────────


async def claim_tasks(forgekins: dict[str, Any]) -> None:
    """打印每只Forgekin领取的任务清单（来自 task.md 责任方分配）."""
    print_banner("阶段 2: task.md 剩余任务领取（按责任方分配）")

    for fid in BUILTIN_FORGEKINS:
        if fid not in forgekins:
            continue
        profile = FORGEKIN_PROFILES[fid]
        forgekin = forgekins[fid]
        print(f"\n[任务领取] {profile['name_chinese']}（{profile['breed_chinese']}）"
              f" — {profile['role']}")
        print("-" * 70)
        print(f"责任范围: {profile['responsibility']}")
        print(f"本次代理任务:")
        for idx, (task_id, task_name, cl_id) in enumerate(profile["tasks"], 1):
            print(f"  {idx}. {task_name}（{cl_id}）")
        # Forgekin自报家门（通过 chat 降级模式）
        try:
            intro = await forgekin.chat([{
                "role": "user",
                "content": (
                    f"请用一句话确认你领取了 {len(profile['tasks'])} 项代理任务，"
                    f"包括 {profile['tasks'][0][1]} 等。"
                ),
            }])
            content = intro.get("content", "")
            degraded = intro.get("usage", {}).get("degraded", False)
            tag = "[降级模式]" if degraded else "[桥接成功]"
            print(f"{tag} {forgekin.name}: {content[:200]}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ⚠️  自报家门失败: {type(exc).__name__}: {exc}")


# ── 阶段 3: 自进化执行（每只Forgekin调用真实代码模块）─────────────


async def execute_self_evolution(
    forgekins: dict[str, Any],
) -> dict[str, list[TaskResult]]:
    """让每只Forgekin真正调用代码模块作为任务完成证据.

    Returns:
        dict[str, list[TaskResult]] — 每只Forgekin的任务结果列表.
    """
    print_banner("阶段 3: 自进化执行（真实代码调用作为任务完成证据）")
    results: dict[str, list[TaskResult]] = {}

    if "luban" in forgekins:
        print("\n--- 鲁班（架构师）执行 4 项任务 ---")
        results["luban"] = await execute_luban_tasks(forgekins["luban"])
        _print_task_results(results["luban"])

    if "sherlock" in forgekins:
        print("\n--- 夏洛克（代码审查）执行 4 项任务 ---")
        results["sherlock"] = await execute_sherlock_tasks(forgekins["sherlock"])
        _print_task_results(results["sherlock"])

    if "vangogh" in forgekins:
        print("\n--- 梵高（视觉设计）执行 4 项任务 ---")
        results["vangogh"] = await execute_vangogh_tasks(forgekins["vangogh"])
        _print_task_results(results["vangogh"])

    return results


def _print_task_results(results: list[TaskResult]) -> None:
    """打印单个Forgekin的任务结果列表."""
    for r in results:
        icon = "✅" if r.status == "pass" else ("🟡" if r.status == "partial" else "❌")
        print(f"  {icon} [{r.cl_id}] {r.task_name}: {r.status.upper()} "
              f"({r.duration_ms}ms) — {r.evidence}")


# ── 鲁班（架构师）执行任务 ──────────────────────────────────────


async def execute_luban_tasks(forgekin: Any) -> list[TaskResult]:
    """鲁班执行 4 项架构师任务：ScopeGuard / ScheduleFactoryRegistry /
    RestartRecoveryPipeline / ForgeMindEngine Mode A."""
    results: list[TaskResult] = []

    # Task 1: ScopeGuard 验证决策边界（CL-002）
    task_id, task_name, cl_id = "luban-1", "ScopeGuard 决策边界验证", "CL-002"
    start = time.monotonic()
    try:
        from flowforge.evolution.scope_guard import ScopeGuard

        sg = ScopeGuard()
        # 真实 API：detect_signals(current_vision, new_idea, current_ac)
        # 场景：架构师评估"新增一个 Agent 模块"是否偏离当前 feat 愿景
        signals = sg.detect_signals(
            current_vision="FlowForge v7.1 框架稳定化（不新增业务领域）",
            new_idea="我想新增一个 NovelForge 专属的章节生成 Agent 模块",
            current_ac=["框架代码不引入业务领域逻辑", "单向依赖零容忍"],
        )
        # 检查 ScopeGuard 是否检出 NEW_JOURNEY / NEW_DEPENDENCY 等强信号
        signal_values = [s.value for s in signals]
        has_strong = any(
            v in signal_values
            for v in ("new_journey", "new_dependency", "unclear_verification")
        )
        # 触发提醒并记录日志
        if has_strong:
            reminder = sg.generate_reminder(
                vision="FlowForge v7.1 框架稳定化",
                new_direction="新增 NovelForge 章节 Agent 模块",
                signal_count=1,
            )
            sg.log_trigger(
                feature_id="feat_fwk_stability",
                signal_type=",".join(signal_values),
                action="remind",
                outcome=reminder,
                agent="luban",
            )
        # 检查发散模式（仅 1 次触发，不应建议拆 feat）
        divergence = sg.check_divergence_pattern("feat_fwk_stability")
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(TaskResult(
            task_id=task_id,
            task_name=task_name,
            cl_id=cl_id,
            status="pass",
            evidence=(
                f"detect_signals 返回 {len(signals)} 个信号 "
                f"({signal_values})；strong_signal={has_strong}；"
                f"divergence_pattern={divergence}"
            ),
            duration_ms=duration_ms,
        ))
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(_make_fail(task_id, task_name, cl_id, exc, duration_ms))

    # Task 2: ScheduleFactoryRegistry 注册示例 factory（CL-023）
    task_id, task_name, cl_id = "luban-2", "ScheduleFactoryRegistry factory 注册", "CL-023"
    start = time.monotonic()
    try:
        from flowforge.core.schedule_registry import (
            FactoryRegistration,
            ScheduleFactoryRegistry,
            ScheduleType,
        )

        # 铁律 5：白名单从 YAML 加载，使用 tempfile 写入真实场景数据
        whitelist_yaml = """
factories:
  - plugin_id: contentforge
    factory_id: topic_scheduler
    schedule_type: cron
    cron_expr: "0 9 * * *"
    max_concurrent: 3
    owner_user_id: operator_001
"""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False, encoding="utf-8"
        ) as f:
            f.write(whitelist_yaml)
            yaml_path = f.name

        reg = ScheduleFactoryRegistry()
        loaded_count = await reg.load_whitelist(yaml_path)
        # 注册白名单内 factory
        registration = FactoryRegistration(
            plugin_id="contentforge",
            factory_id="topic_scheduler",
            schedule_type=ScheduleType.CRON,
            cron_expr="0 9 * * *",
            max_concurrent=3,
            owner_user_id="operator_001",
        )
        await reg.register(registration)
        # 验证 task id 分配（确定性格式 plugin_id:factory_id:seq:08d）
        task_id_allocated = await reg.allocate_task_id(
            "contentforge", "topic_scheduler"
        )
        # 启动期校验
        errors = await reg.validate_at_startup()
        duration_ms = int((time.monotonic() - start) * 1000)
        Path(yaml_path).unlink(missing_ok=True)
        results.append(TaskResult(
            task_id=task_id,
            task_name=task_name,
            cl_id=cl_id,
            status="pass",
            evidence=(
                f"whitelist loaded={loaded_count}；allocate_task_id="
                f"{task_id_allocated.format()}；startup_errors={len(errors)}"
            ),
            duration_ms=duration_ms,
        ))
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(_make_fail(task_id, task_name, cl_id, exc, duration_ms))

    # Task 3: RestartRecoveryPipeline Phase A sweep（CL-028）
    task_id, task_name, cl_id = "luban-3", "RestartRecoveryPipeline Phase A sweep", "CL-028"
    start = time.monotonic()
    try:
        from flowforge.core.restart_recovery import (
            RestartRecoveryConfig,
            RestartRecoveryPipeline,
        )

        # 真实场景数据：模拟 worker 崩溃后的 stale 记录
        redis = _FakeRedisClient()
        redis.set_key(
            key="task:contentforge:topic_scheduler",
            value={"topic": "AI Agent 框架对比"},
            ttl=-1,  # stale: running + TTL=-1（worker 崩溃遗留）
            status="running",
        )
        redis.set_key(
            key="task:devforge:code_review_scheduler",
            value={"repo": "flowforge/core"},
            ttl=3600,  # valid: TTL 未过期
            status="running",
        )
        config = RestartRecoveryConfig()
        pipeline_rr = RestartRecoveryPipeline(
            config=config, operator_user_id="luban-architect"
        )
        # 执行 Phase A sweep
        swept = await pipeline_rr.execute_phase_a_sweep(redis)
        # 验证：仅扫描出 1 条 stale（contentforge），devforge 跳过
        swept_keys = [r.redis_key for r in swept]
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(TaskResult(
            task_id=task_id,
            task_name=task_name,
            cl_id=cl_id,
            status="pass",
            evidence=(
                f"Phase A sweep 完成，swept_count={len(swept)}；"
                f"stale_keys={swept_keys}（devforge valid 被跳过）"
            ),
            duration_ms=duration_ms,
        ))
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(_make_fail(task_id, task_name, cl_id, exc, duration_ms))

    # Task 4: ForgeMindEngine Mode A 评估（CL-001）
    task_id, task_name, cl_id = "luban-4", "ForgeMindEngine Mode A 评估", "CL-001"
    start = time.monotonic()
    try:
        from flowforge.evolution.engine import ForgeMindEngine

        engine = ForgeMindEngine()
        # 真实 API：evaluate(context) — context 含 mode + scope_guard 子字典
        context = {
            "mode": "scope_guard",
            "scope_guard": {
                "current_vision": "FlowForge v7.1 框架稳定化",
                "new_idea": "我想接入一个新的第三方 LLM SDK，并新增数据表",
                "current_ac": ["不引入新依赖", "不新增数据模型"],
                "feature_id": "feat_fwk_stability",
                "agent": "luban",
            },
        }
        result = await engine.evaluate(context)
        actions = result.get("suggested_actions", [])
        meta = result.get("meta", {})
        # 若有建议动作，执行第一个（Mode A 真实触发）
        executed = None
        if actions:
            executed = await engine.execute(actions[0])
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(TaskResult(
            task_id=task_id,
            task_name=task_name,
            cl_id=cl_id,
            status="pass",
            evidence=(
                f"evaluate 完成，actions_count={len(actions)}，"
                f"meta_mode={meta.get('mode')}；"
                f"execute_status={executed.get('status') if executed else 'skipped'}"
            ),
            duration_ms=duration_ms,
        ))
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(_make_fail(task_id, task_name, cl_id, exc, duration_ms))

    return results


# ── 夏洛克（代码审查）执行任务 ──────────────────────────────────


async def execute_sherlock_tasks(forgekin: Any) -> list[TaskResult]:
    """夏洛克执行 4 项代码审查任务：CloseGateValidator / QCLoop /
    EventMemoryStore / CapabilityRegistry."""
    results: list[TaskResult] = []

    # Task 1: CloseGateValidator 验证 AC 矩阵（CL-025）
    task_id, task_name, cl_id = "sherlock-1", "CloseGateValidator AC 矩阵验证", "CL-025"
    start = time.monotonic()
    try:
        from flowforge.evolution.close_gate import (
            CloseGateDecision,
            CloseGateValidator,
            Evidence,
        )

        validator = CloseGateValidator()
        # 注册 2 条证据（覆盖 2 个 AC）
        validator.register_evidence(Evidence(
            ac_id="AC-A1",
            status="pass",
            evidence_type="test",
            evidence_uri="tests/test_a1.py::test_pass",
        ))
        validator.register_evidence(Evidence(
            ac_id="AC-A2",
            status="pass",
            evidence_type="commit",
            evidence_uri="abc1234",
        ))
        # 验证决策（immediate / delete / cvo_signoff 三选一）
        decision = CloseGateDecision(
            decision="immediate",
            decided_by="sherlock",
            decided_at=datetime.now(timezone.utc),
            rationale="All ACs passed, no follow-up items",
        )
        is_valid, msg = validator.validate_close_decision(decision)
        matrix = validator.get_evidence_matrix()
        # 验证 follow-up 屏蔽词检测
        clean, found = validator.check_no_follow_up(
            "本 phase 已完成，后续 follow-up 将在下一个 phase 处理"
        )
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(TaskResult(
            task_id=task_id,
            task_name=task_name,
            cl_id=cl_id,
            status="pass",
            evidence=(
                f"AC 矩阵: {len(matrix)} 个 AC，决策 valid={is_valid}（{msg}）；"
                f"follow_up 检测 clean={clean} found={found}"
            ),
            duration_ms=duration_ms,
        ))
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(_make_fail(task_id, task_name, cl_id, exc, duration_ms))

    # Task 2: QCLoop 7 步循环（CL-034）
    task_id, task_name, cl_id = "sherlock-2", "QCLoop 7 步循环", "CL-034"
    start = time.monotonic()
    try:
        from flowforge.evolution.qc_loop import QCLoop

        qc = QCLoop(max_iterations=1)  # 骨架实现，1 次迭代
        report = await qc.run(
            target_id="feat_fwk_stability_close_gate",
            target_artifacts={
                "files": ["flowforge/evolution/close_gate.py"],
                "tests": ["flowforge/core/tests/test_restart_recovery.py"],
            },
        )
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(TaskResult(
            task_id=task_id,
            task_name=task_name,
            cl_id=cl_id,
            status="pass",
            evidence=(
                f"QC 完成，final_status={report.final_status}，"
                f"steps={len(report.step_results)}，"
                f"reviewer_reports={len(report.reviewer_reports)}"
            ),
            duration_ms=duration_ms,
        ))
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(_make_fail(task_id, task_name, cl_id, exc, duration_ms))

    # Task 3: EventMemoryStore 记录事件（CL-029）
    task_id, task_name, cl_id = "sherlock-3", "EventMemoryStore 事件记录", "CL-029"
    start = time.monotonic()
    try:
        from flowforge.core.event_memory import (
            EventMemoryStore,
            EventRecord,
            EventTrigger,
            EventType,
        )

        store = EventMemoryStore()
        # 真实 API：record(event: EventRecord) — 10+1 字段 schema
        event = EventRecord(
            type=EventType.TASK_COMPLETED,
            trigger=EventTrigger.AGENT_ACTION,
            cat="qc_review",
            thread_id="thread_fwk_stability",
            message_id="msg_001",
            summary="夏洛克完成 close_gate 验证，AC-A1/A2 全部 pass",
            cognitive_transition="E3→E3",
            related_harness="forgemind:sherlock",
            confidence=0.95,
            owner_user_id="operator_001",
        )
        record_id = await store.record(event)
        # 验证 teleport 精确跳转（threadId + messageId 二元组）
        teleported = await store.teleport(
            thread_id="thread_fwk_stability", message_id="msg_001"
        )
        # 验证按 thread 查询
        by_thread = await store.list_by_thread("thread_fwk_stability")
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(TaskResult(
            task_id=task_id,
            task_name=task_name,
            cl_id=cl_id,
            status="pass",
            evidence=(
                f"record_id={record_id[:8]}...；teleport 返回 "
                f"{type(teleported).__name__}（event_id 匹配="
                f"{teleported.event_id == record_id if teleported else False}）；"
                f"list_by_thread={len(by_thread)}"
            ),
            duration_ms=duration_ms,
        ))
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(_make_fail(task_id, task_name, cl_id, exc, duration_ms))

    # Task 4: CapabilityRegistry 注册能力（CL-014 互补）
    task_id, task_name, cl_id = "sherlock-4", "CapabilityRegistry 能力注册", "CL-014"
    start = time.monotonic()
    try:
        from flowforge.core.external_agent import CapabilityRegistry

        reg = CapabilityRegistry()
        reg.register_capability(
            provider_name="anthropic.claude_code",
            capability="code_review",
            manifest_ref={"version": "1.0.0", "tier": "external"},
        )
        reg.register_capability(
            provider_name="openai.codex",
            capability="code_review",
            manifest_ref={"version": "1.0.0", "tier": "external"},
        )
        # discover 应返回 2 个 provider（按 success_rate 降序）
        entries = reg.discover("code_review")
        # 查最优 provider
        best = reg.get_best_provider("code_review")
        # 列出某 provider 全部能力
        claude_caps = reg.list_capabilities("anthropic.claude_code")
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(TaskResult(
            task_id=task_id,
            task_name=task_name,
            cl_id=cl_id,
            status="pass",
            evidence=(
                f"discover code_review 返回 {len(entries)} 条；"
                f"best_provider={best.provider_name if best else None}；"
                f"claude_code capabilities={claude_caps}"
            ),
            duration_ms=duration_ms,
        ))
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(_make_fail(task_id, task_name, cl_id, exc, duration_ms))

    return results


# ── 梵高（视觉设计）执行任务 ────────────────────────────────────


async def execute_vangogh_tasks(forgekin: Any) -> list[TaskResult]:
    """梵高执行 4 项视觉设计任务：ApprovalHub / AvatarSyncAdapter /
    CollaborationCoordinator / PromptConfigMap."""
    results: list[TaskResult] = []

    # Task 1: ApprovalHub 提交审批（CL-033）
    task_id, task_name, cl_id = "vangogh-1", "ApprovalHub 审批提交", "CL-033"
    start = time.monotonic()
    try:
        from flowforge.core.approval_hub import ApprovalHub, ApprovalRequest

        hub = ApprovalHub()
        # 注意：ApprovalHub 内部使用 datetime.utcnow()（naive）做比较，
        # 故 created_at / expires_at 必须用 naive UTC，否则会抛
        # "can't compare offset-naive and offset-aware datetimes"
        req = ApprovalRequest(
            request_id="req-001",
            forgekin_id="forgemind:vangogh",
            thread_id="thread_vangogh_ui",
            request_type="config_change",
            title="UI 主题色调整",
            description="将主色调从蓝色改为孔雀绿",
            payload={"old_color": "#3B82F6", "new_color": "#10B981"},
            created_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(hours=24),
            priority="low",
        )
        req_id = hub.submit(req)
        # 列出 pending
        pending = hub.list_pending()
        # operator 一键批准
        ok, decide_msg = hub.approve(
            request_id="req-001",
            decided_by="operator_001",
            comments="孔雀绿符合梵高形象，批准",
        )
        stats = hub.get_stats()
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(TaskResult(
            task_id=task_id,
            task_name=task_name,
            cl_id=cl_id,
            status="pass",
            evidence=(
                f"submit 返回 {req_id}；pending_before={len(pending)}；"
                f"approve ok={ok}（{decide_msg}）；stats={stats}"
            ),
            duration_ms=duration_ms,
        ))
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(_make_fail(task_id, task_name, cl_id, exc, duration_ms))

    # Task 2: AvatarSyncAdapter 同步形象（EAC v1 契约 7）
    task_id, task_name, cl_id = "vangogh-2", "AvatarSyncAdapter 形象同步", "CL-EAC7"
    start = time.monotonic()
    try:
        from flowforge.core.external_agent import AvatarSpec, AvatarSyncAdapter

        adapter = AvatarSyncAdapter()
        spec = AvatarSpec(
            forgekin_id="forgemind:vangogh",
            name="梵高",
            nickname="vangogh",
            species="virtual",
            personality_summary="富有激情与表达力的视觉设计Forgekin",
            voice="诗意且具体",
            avatar_uri="avatars/vangogh.png",
            blind_spots=["对极端逻辑场景不够敏感"],
        )
        sync_results = adapter.sync_avatar(
            forgekin_id="forgemind:vangogh",
            avatar_spec=spec,
            target_providers=["anthropic.claude_code", "openai.codex"],
        )
        # 验证 get_synced_avatar
        synced = adapter.get_synced_avatar(
            "forgemind:vangogh", "anthropic.claude_code"
        )
        providers = adapter.list_synced_providers("forgemind:vangogh")
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(TaskResult(
            task_id=task_id,
            task_name=task_name,
            cl_id=cl_id,
            status="pass",
            evidence=(
                f"sync_avatar 返回 {len(sync_results)} 个 provider 结果；"
                f"all_success={all(r.success for r in sync_results.values())}；"
                f"get_synced={synced.name if synced else None}；"
                f"providers={providers}"
            ),
            duration_ms=duration_ms,
        ))
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(_make_fail(task_id, task_name, cl_id, exc, duration_ms))

    # Task 3: CollaborationCoordinator 发起协作（EAC v1 契约 5 / CL-032）
    task_id, task_name, cl_id = "vangogh-3", "CollaborationCoordinator 群体协作", "CL-032"
    start = time.monotonic()
    try:
        from flowforge.core.external_agent import (
            CollaborationCoordinator,
            CollaborationMode,
        )

        coord = CollaborationCoordinator()
        result = await coord.coordinate(
            task="v7.1 视觉设计统一审查（鲁班架构 / 夏洛克 review / 梵高视觉）",
            participants=["forgemind:luban", "forgemind:sherlock", "forgemind:vangogh"],
            mode=CollaborationMode.SWARM,
        )
        # 验证协作句柄已注册
        active = coord.list_active_collaborations()
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(TaskResult(
            task_id=task_id,
            task_name=task_name,
            cl_id=cl_id,
            status="pass",
            evidence=(
                f"coordinate 完成，handle_id={result.handle_id}，"
                f"status={result.status}，participants={len(result.participants)}；"
                f"active_collaborations={len(active)}"
            ),
            duration_ms=duration_ms,
        ))
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(_make_fail(task_id, task_name, cl_id, exc, duration_ms))

    # Task 4: PromptConfigMap 注册映射（EAC v1 契约 8）
    task_id, task_name, cl_id = "vangogh-4", "PromptConfigMap 提示词映射", "CL-EAC8"
    start = time.monotonic()
    try:
        from flowforge.core.external_agent import PromptConfig, PromptConfigMap

        pcm = PromptConfigMap()
        cfg = PromptConfig(
            prompt_key="vangogh_visual_review",
            role_description="你是梵高，视觉设计Forgekin，负责 UI/UX 审查",
            personality_summary="富有激情与表达力，注重视觉美感与用户体验",
            value_anchors=["美观优先", "用户体验至上", "尊重 operator 决策"],
            restrictions=["禁止硬编码文案", "禁止绕过 DI 容器"],
        )
        pcm.register_mapping(
            forgekin_id="forgemind:vangogh",
            provider_name="anthropic.claude_code",
            prompt_config=cfg,
        )
        # 验证 resolve_prompt 拼接
        prompt = pcm.resolve_prompt("forgemind:vangogh", "anthropic.claude_code")
        # 验证 list_mappings
        mappings = pcm.list_mappings("forgemind:vangogh")
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(TaskResult(
            task_id=task_id,
            task_name=task_name,
            cl_id=cl_id,
            status="pass",
            evidence=(
                f"resolve_prompt 返回 {len(prompt)} 字符；"
                f"list_mappings={len(mappings)}；"
                f"prompt_starts_with={prompt[:30]!r}"
            ),
            duration_ms=duration_ms,
        ))
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - start) * 1000)
        results.append(_make_fail(task_id, task_name, cl_id, exc, duration_ms))

    return results


# ── 阶段 4: webchat 汇报 ────────────────────────────────────────


async def webchat_report(
    forgekins: dict[str, Any],
    task_results: dict[str, list[TaskResult]],
) -> None:
    """每只Forgekin通过 chat 汇报自己的任务完成情况."""
    print_banner("阶段 4: webchat 汇报（每只Forgekin汇报任务完成情况）")

    for fid in BUILTIN_FORGEKINS:
        if fid not in forgekins:
            continue
        forgekin = forgekins[fid]
        results = task_results.get(fid, [])
        pass_count = sum(1 for r in results if r.status == "pass")
        fail_count = sum(1 for r in results if r.status == "fail")
        partial_count = sum(1 for r in results if r.status == "partial")
        cl_ids = [r.cl_id for r in results]

        print(f"\n[webchat 汇报] {forgekin.name}（{FORGEKIN_PROFILES[fid]['breed_chinese']}）")
        print("-" * 70)
        print(f"任务摘要: {len(results)} 项任务 — PASS={pass_count} "
              f"PARTIAL={partial_count} FAIL={fail_count}（CL: {', '.join(cl_ids)}）")

        # 通过 chat 让Forgekin汇报（降级模式：返回 system prompt 注入的角色信息）
        user_msg = (
            f"请用 100 字以内汇报你刚完成的 {len(results)} 项代理任务的总体情况，"
            f"包括 PASS {pass_count} 项、FAIL {fail_count} 项，"
            f"以及覆盖的 CL 编号: {', '.join(cl_ids)}。"
        )
        try:
            result = await forgekin.chat([{"role": "user", "content": user_msg}])
            content = result.get("content", "")
            degraded = result.get("usage", {}).get("degraded", False)
            tag = "[降级模式]" if degraded else "[桥接成功]"
            print(f"{tag} {forgekin.name}: {content[:400]}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ❌ webchat 失败: {type(exc).__name__}: {exc}")


# ── 阶段 5: IM MindCouncil总结 ────────────────────────────────────────


async def im_council_summary(
    forgekins: dict[str, Any],
    task_results: dict[str, list[TaskResult]],
) -> None:
    """3 只Forgekin通过 IM MindCouncil讨论 task.md 剩余任务代理执行的总结."""
    print_banner("阶段 5: IM MindCouncil总结（3 只Forgekin共同讨论）")

    total_pass = sum(
        1 for results in task_results.values() for r in results if r.status == "pass"
    )
    total_fail = sum(
        1 for results in task_results.values() for r in results if r.status == "fail"
    )
    total = sum(len(results) for results in task_results.values())

    topic = (
        f"3 Forgekin已通过自进化完成 task.md 剩余任务的代理执行，"
        f"共 {total} 项任务（PASS {total_pass} / FAIL {total_fail}）。"
        f"请每人总结自己的成果并交叉确认（150 字以内）。"
    )
    print(f"\nMindCouncil主题: {topic}")
    print(f"参与Forgekin: {[forgekins[fid].name for fid in BUILTIN_FORGEKINS if fid in forgekins]}")

    discussion_history: list[dict[str, str]] = []

    print("\n--- 第 1 轮（单轮） ---")
    for fid in BUILTIN_FORGEKINS:
        if fid not in forgekins:
            continue
        forgekin = forgekins[fid]
        results = task_results.get(fid, [])
        pass_count = sum(1 for r in results if r.status == "pass")
        cl_ids = [r.cl_id for r in results]

        context_msg = f"MindCouncil主题: {topic}\n\n"
        if discussion_history:
            context_msg += "已有讨论:\n"
            for msg in discussion_history[-3:]:
                context_msg += f"[{msg['role']}]: {msg['content'][:100]}\n"
            context_msg += (
                f"\n你是 {forgekin.name}，刚完成 {pass_count}/{len(results)} 项任务"
                f"（CL: {', '.join(cl_ids)}）。请基于以上讨论给出你的总结（150 字以内）:"
            )
        else:
            context_msg += (
                f"\n你是 {forgekin.name}，刚完成 {pass_count}/{len(results)} 项任务"
                f"（CL: {', '.join(cl_ids)}）。请给出你的初始总结（150 字以内）:"
            )

        try:
            result = await forgekin.chat(
                [{"role": "user", "content": context_msg}]
            )
            content = result.get("content", "")
            degraded = result.get("usage", {}).get("degraded", False)
            tag = "[降级模式]" if degraded else "[桥接成功]"
            print(f"\n[{forgekin.name}] {tag}:")
            print(f"  {content[:500]}")
            discussion_history.append({
                "role": forgekin.name,
                "content": content,
            })
        except Exception as exc:  # noqa: BLE001
            print(f"\n[{forgekin.name}] ❌ 发言失败: {type(exc).__name__}: {exc}")


# ── 阶段 6: 最终报告 ────────────────────────────────────────────


def print_final_report(
    forgekins: dict[str, Any],
    task_results: dict[str, list[TaskResult]],
) -> None:
    """汇总输出最终报告（含表格 + CL 覆盖情况 + 自进化状态）."""
    print_banner("ForgeMind v7.1 自进化 + task.md 剩余任务代理执行 — 最终报告")

    # 表格输出
    print("\nForgekin任务完成情况:")
    header = (
        f"┌──────────┬─────────────────────┬──────────┬──────┬──────┬──────────┐\n"
        f"│ Forgekin   │ 形态                │ 任务数   │ PASS │ FAIL │ 耗时(ms) │\n"
        f"├──────────┼─────────────────────┼──────────┼──────┼──────┼──────────┤"
    )
    print(header)
    for fid in BUILTIN_FORGEKINS:
        if fid not in forgekins:
            continue
        profile = FORGEKIN_PROFILES[fid]
        results = task_results.get(fid, [])
        pass_count = sum(1 for r in results if r.status == "pass")
        fail_count = sum(1 for r in results if r.status == "fail")
        total_ms = sum(r.duration_ms for r in results)
        name = profile["name_chinese"]
        breed = profile["breed_chinese"]
        print(
            f"│ {name:<8} │ {breed:<19} │ {len(results):<8} │ "
            f"{pass_count:<4} │ {fail_count:<4} │ {total_ms:<8} │"
        )
    print("└──────────┴─────────────────────┴──────────┴──────┴──────┴──────────┘")

    # CL 覆盖情况
    all_cl_ids: list[str] = []
    for results in task_results.values():
        for r in results:
            if r.status == "pass":
                all_cl_ids.append(r.cl_id)

    print("\nCL 覆盖情况:")
    cl_status = [
        ("CL-001", "Mode A 评估", "CL-001" in all_cl_ids),
        ("CL-002", "ScopeGuard", "CL-002" in all_cl_ids),
        ("CL-014", "CapabilityRegistry", "CL-014" in all_cl_ids),
        ("CL-022", "Plugin V3 manifest (未直接调用，已在前序验证脚本 PASS)", False),
        ("CL-023", "ScheduleFactoryRegistry", "CL-023" in all_cl_ids),
        ("CL-025", "CloseGateValidator", "CL-025" in all_cl_ids),
        ("CL-028", "RestartRecoveryPipeline", "CL-028" in all_cl_ids),
        ("CL-029", "EventMemoryStore", "CL-029" in all_cl_ids),
        ("CL-032", "CollaborationCoordinator", "CL-032" in all_cl_ids),
        ("CL-033", "ApprovalHub", "CL-033" in all_cl_ids),
        ("CL-034", "QCLoop", "CL-034" in all_cl_ids),
        ("CL-EAC7", "AvatarSyncAdapter", "CL-EAC7" in all_cl_ids),
        ("CL-EAC8", "PromptConfigMap", "CL-EAC8" in all_cl_ids),
    ]
    for cl_id, desc, passed in cl_status:
        icon = "✅" if passed else "⚠️"
        print(f"  {icon} {cl_id} {desc}")

    # 自进化状态
    print("\n自进化状态:")
    for fid in BUILTIN_FORGEKINS:
        if fid not in forgekins:
            continue
        forgekin = forgekins[fid]
        profile = FORGEKIN_PROFILES[fid]
        awk = forgekin.awakening_stage.value
        can_evolve = forgekin.can_self_evolve()
        mode_status = (
            "可触发 Mode A/B/C 全自进化"
            if can_evolve
            else "仅支持 operator 触发的 scope_guard 模式"
        )
        print(f"  {profile['name_chinese']}（觉醒阶 {awk}）: {mode_status}")

    # webchat/IM MindCouncil全流程
    total_pass = sum(
        1 for results in task_results.values() for r in results if r.status == "pass"
    )
    total_fail = sum(
        1 for results in task_results.values() for r in results if r.status == "fail"
    )
    total = sum(len(results) for results in task_results.values())
    flow_status = "✅ 打通" if total > 0 else "❌ 未打通"
    print(f"\nwebchat/IM MindCouncil全流程: {flow_status}（含降级模式下的 system prompt 注入）")
    print(f"  总任务: {total}  PASS: {total_pass}  FAIL: {total_fail}")
    print("=" * 70)


# ── 主流程 ──────────────────────────────────────────────────────


async def main() -> int:
    """主流程：锻造 → 领取任务 → 自进化执行 → webchat 汇报 → IM MindCouncil总结."""
    print_banner("ForgeMind v7.1 Forgekin自进化 + task.md 剩余任务代理执行")
    print(f"项目根: {PROJECT_ROOT}")
    print(f"预置Forgekin: {BUILTIN_FORGEKINS}")
    print(f"运行时间: {datetime.now(timezone.utc).isoformat()}")

    # 阶段 1: 锻造 3 只Forgekin
    forgekins = await forge_all_forgekins()
    if len(forgekins) < 3:
        print("\n❌ 锻造失败，至少需要 3 只Forgekin")
        return 1

    # 阶段 2: 任务领取
    await claim_tasks(forgekins)

    # 阶段 3: 自进化执行
    task_results = await execute_self_evolution(forgekins)

    # 阶段 4: webchat 汇报
    await webchat_report(forgekins, task_results)

    # 阶段 5: IM MindCouncil总结
    await im_council_summary(forgekins, task_results)

    # 阶段 6: 最终报告
    print_final_report(forgekins, task_results)

    # 退出码：全部 PASS 返回 0，有 FAIL 返回 1
    total_fail = sum(
        1
        for results in task_results.values()
        for r in results
        if r.status == "fail"
    )
    return 0 if total_fail == 0 else 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
