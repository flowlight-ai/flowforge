"""RestartRecoveryPipeline 单元测试（CL-028 P0 必修）.

测试铁律遵守（project_rules.md T1-T8）：
    - T1: 禁止使用 Mock LLM —— 本模块不涉及 LLM，仅 Mock Redis / EventBus
          基础设施（T1 允许 Mock 基础设施，禁止 Mock LLM）。
    - T2: 禁止使用假数据 —— 测试数据使用真实场景 key
          （task:contentforge:topic_scheduler / task:devforge:code_review_scheduler 等）。
    - T3: 禁止跳过验证 —— 每个用例均有具体断言。
    - T5: 未实现即 Bug —— 覆盖所有公开方法。
    - T6: 必须采集指标 —— 单元测试无 MetricsCollector 要求（适用于 E2E）。

设计依据：
    - [doc:design.md#v7.1-§D9.2] ADR-010 补全
    - [doc:decisions/010-distributed-reliability.md] §Restart Recovery Pipeline
    - [doc:rules.md] 测试铁律 T1-T8
"""

from __future__ import annotations

import json
import pickle
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import pytest

from flowforge.core.restart_recovery import (
    QueueStateSnapshot,
    RestartNotification,
    RestartRecoveryConfig,
    RestartRecoveryPipeline,
    StaleRecord,
)


# ── FakeRedisClient：基础设施 Mock（非 LLM Mock，T1 允许）─────────


class FakeRedisClient:
    """模拟 Redis 客户端（基础设施 Mock，不是 LLM Mock）.

    测试铁律 T1 允许 Mock 基础设施（Redis/文件系统），但禁止 Mock LLM。
    本 Mock 模拟 Redis 的 scan / ttl / hget / dump 方法，用于单元测试。

    数据结构：
        self._data[key] = (value, ttl_seconds, fields_dict)
        - value: 原始值（任意可 pickle 对象）
        - ttl_seconds: TTL（秒）；-1=无过期，-2=key 不存在，0=禁止
        - fields_dict: hash 字段（如 {"status": "running", "created_at": "..."}）
    """

    def __init__(self) -> None:
        self._data: dict[str, tuple[Any, Optional[int], dict[str, str]]] = {}

    def set_key(
        self,
        key: str,
        value: Any,
        ttl: Optional[int],
        status: str = "running",
        created_at: Optional[str] = None,
    ) -> None:
        """注入测试 key（真实场景数据）。"""
        fields = {
            "status": status,
            "created_at": created_at or datetime.now(timezone.utc).isoformat(),
        }
        self._data[key] = (value, ttl, fields)

    async def scan(self, pattern: str = "*") -> list[str]:
        """模拟 SCAN 命令（返回所有 key，简化 pattern 匹配为 *）。"""
        return list(self._data.keys())

    async def ttl(self, key: str) -> Optional[int]:
        """模拟 TTL 命令。"""
        if key not in self._data:
            return -2
        return self._data[key][1]

    async def hget(self, key: str, field: str) -> Optional[str]:
        """模拟 HGET 命令。"""
        if key not in self._data:
            return None
        return self._data[key][2].get(field)

    async def dump(self, key: str) -> Optional[bytes]:
        """模拟 DUMP 命令（pickle 序列化整个 tuple）。"""
        if key not in self._data:
            return None
        return pickle.dumps(self._data[key])


# ── FakeEventBus：基础设施 Mock（非 LLM Mock，T1 允许）─────────


class FakeEventBus:
    """模拟事件总线（基础设施 Mock，记录所有 publish 调用）。"""

    def __init__(self) -> None:
        self.published: list[tuple[str, Any]] = []

    async def publish(self, event_type: str, payload: Any) -> None:
        """模拟 EventBus.publish（async）。"""
        self.published.append((event_type, payload))


# ── 真实场景数据 fixtures ─────────────────────────────────────


@pytest.fixture
def config_with_tmp_paths(tmp_path: Path) -> RestartRecoveryConfig:
    """配置对象，AOF/RDB 路径指向临时目录（铁律 5：禁止硬编码路径）。"""
    return RestartRecoveryConfig(
        default_ttl_seconds=86400,
        max_ttl_seconds=604800,
        min_ttl_seconds=60,
        forbid_zero_ttl=True,
        aof_log_path=str(tmp_path / "aof.log"),
        rdb_snapshot_path=str(tmp_path / "rdb_snapshot.json"),
    )


@pytest.fixture
def pipeline(config_with_tmp_paths: RestartRecoveryConfig) -> RestartRecoveryPipeline:
    """注入配置的 RestartRecoveryPipeline（铁律 5 + 红线 12）。"""
    return RestartRecoveryPipeline(
        config=config_with_tmp_paths,
        operator_user_id="luban-architect",
    )


@pytest.fixture
def redis_with_stale_and_valid() -> FakeRedisClient:
    """真实场景数据：含 stale（running + TTL<0）与 valid 记录的 Redis。

    场景：ContentForge / DevForge / NovelForge / MallForge 四个项目的调度任务
    分布在 Redis 中，部分因 worker 崩溃导致 status=running 但 TTL 已失效。
    """
    client = FakeRedisClient()
    # stale: running + TTL=-1（无显式过期，worker 崩溃后遗留）
    client.set_key(
        key="task:contentforge:topic_scheduler",
        value={"topic": "AI Agent 框架对比", "persona": "life"},
        ttl=-1,
        status="running",
        created_at="2026-07-17T10:30:00+00:00",
    )
    # stale: running + TTL=-2（key 已逻辑删除但元数据残留）
    client.set_key(
        key="task:devforge:code_review_scheduler",
        value={"repo": "flowforge/core", "pr": 42},
        ttl=-2,
        status="running",
        created_at="2026-07-17T11:00:00+00:00",
    )
    # valid: completed + TTL=3600（正常完成，TTL 未过期）
    client.set_key(
        key="task:novelforge:chapter_writer",
        value={"chapter": 7, "title": "灵智体觉醒"},
        ttl=3600,
        status="completed",
        created_at="2026-07-18T08:00:00+00:00",
    )
    # valid: running + TTL=1800（正常运行，TTL 未过期）
    client.set_key(
        key="task:mallforge:product_lister",
        value={"product": "SKU-9981", "platform": "taobao"},
        ttl=1800,
        status="running",
        created_at="2026-07-18T09:00:00+00:00",
    )
    # valid: failed + TTL=600（失败任务，TTL 未过期）
    client.set_key(
        key="task:contentforge:seo_optimizer",
        value={"article": "ai-agent-frameworks", "keyword": "AI Agent"},
        ttl=600,
        status="failed",
        created_at="2026-07-18T09:30:00+00:00",
    )
    return client


# ── 测试用例 1: Phase A 扫描过期记录 ──────────────────────────


async def test_phase_a_sweep_stale_records(
    pipeline: RestartRecoveryPipeline,
    redis_with_stale_and_valid: FakeRedisClient,
) -> None:
    """Phase A 应扫描出 status=running 且 TTL<0 的过期记录（不删除，仅标记）。"""
    swept = await pipeline.execute_phase_a_sweep(redis_with_stale_and_valid)

    # 断言：仅扫描出 2 条 stale 记录（contentforge + devforge），不删除
    assert len(swept) == 2, f"期望 2 条 stale 记录，实际 {len(swept)}"
    swept_keys = {r.redis_key for r in swept}
    assert "task:contentforge:topic_scheduler" in swept_keys
    assert "task:devforge:code_review_scheduler" in swept_keys

    # 断言：每条记录字段完整（T3：具体断言）
    for record in swept:
        assert isinstance(record, StaleRecord)
        assert record.original_status == "running"
        assert record.ttl_seconds < 0, f"TTL 应 < 0，实际 {record.ttl_seconds}"
        assert record.swept_at is not None
        assert record.created_at is not None

    # 断言：原 Redis 数据未被删除（仅标记，保留审计痕迹）
    assert "task:contentforge:topic_scheduler" in redis_with_stale_and_valid._data
    assert "task:devforge:code_review_scheduler" in redis_with_stale_and_valid._data


# ── 测试用例 2: Phase A 跳过有效记录 ──────────────────────────


async def test_phase_a_skips_valid_records(
    pipeline: RestartRecoveryPipeline,
    redis_with_stale_and_valid: FakeRedisClient,
) -> None:
    """Phase A 应跳过 status!=running 或 TTL>=0 的有效记录。"""
    swept = await pipeline.execute_phase_a_sweep(redis_with_stale_and_valid)
    swept_keys = {r.redis_key for r in swept}

    # 断言：completed 状态的记录被跳过
    assert "task:novelforge:chapter_writer" not in swept_keys, \
        "status=completed 的记录不应被标记为 stale"
    # 断言：failed 状态的记录被跳过
    assert "task:contentforge:seo_optimizer" not in swept_keys, \
        "status=failed 的记录不应被标记为 stale"
    # 断言：running 但 TTL 未过期的记录被跳过
    assert "task:mallforge:product_lister" not in swept_keys, \
        "status=running 但 TTL=1800>0 的记录不应被标记为 stale"


# ── 测试用例 3: Phase A+ 发布 restart_notification 事件 ────────


async def test_phase_a_plus_notify_publishes_event(
    pipeline: RestartRecoveryPipeline,
    redis_with_stale_and_valid: FakeRedisClient,
) -> None:
    """Phase A+ 应发布 restart_notification 事件，含 restart_id/swept_count/operator。"""
    swept = await pipeline.execute_phase_a_sweep(redis_with_stale_and_valid)
    event_bus = FakeEventBus()

    notification = await pipeline.execute_phase_a_plus_notify(swept, event_bus)

    # 断言：事件已发布到 EventBus（T3：具体断言）
    assert len(event_bus.published) == 1, \
        f"期望发布 1 个事件，实际 {len(event_bus.published)}"
    event_type, payload = event_bus.published[0]
    assert event_type == "restart_notification"

    # 断言：通知载荷字段完整
    assert isinstance(notification, RestartNotification)
    assert notification.restart_id  # UUID 非空
    assert len(notification.restart_id) == 36  # UUID 字符串长度
    assert notification.swept_records_count == 2
    assert notification.operator_user_id == "luban-architect"
    assert notification.timestamp is not None

    # 断言：payload 与 notification 一致
    assert payload["restart_id"] == notification.restart_id
    assert payload["swept_records_count"] == 2
    assert payload["operator_user_id"] == "luban-architect"


# ── 测试用例 4: Phase B 拒绝 TTL=0 的 key ─────────────────────


async def test_phase_b_persist_validates_ttl_zero_forbidden(
    config_with_tmp_paths: RestartRecoveryConfig,
    tmp_path: Path,
) -> None:
    """Phase B persist 应对 TTL=0 的 key raises ValueError（红线）。"""
    pipeline = RestartRecoveryPipeline(
        config=config_with_tmp_paths,
        operator_user_id="test-operator",
    )
    redis = FakeRedisClient()
    # 注入 TTL=0 的违规 key（真实场景：配置错误导致 TTL=0）
    redis.set_key(
        key="task:contentforge:topic_scheduler",
        value={"topic": "AI Agent 框架对比"},
        ttl=0,  # 红线违规
        status="running",
    )

    with pytest.raises(ValueError, match="TTL=0 forbidden"):
        await pipeline.execute_phase_b_persist(redis, tmp_path / "rdb.json")


# ── 测试用例 5: Phase B 拒绝 TTL=None 的 key ──────────────────


async def test_phase_b_persist_validates_ttl_none_forbidden(
    config_with_tmp_paths: RestartRecoveryConfig,
    tmp_path: Path,
) -> None:
    """Phase B persist 应对 TTL=None 的 key raises ValueError（forbid_zero_ttl=True）。"""
    pipeline = RestartRecoveryPipeline(
        config=config_with_tmp_paths,
        operator_user_id="test-operator",
    )
    redis = FakeRedisClient()
    # 注入 TTL=None 的违规 key（真实场景：未设置过期时间）
    redis.set_key(
        key="task:devforge:code_review_scheduler",
        value={"repo": "flowforge/core", "pr": 42},
        ttl=None,  # 无显式 TTL
        status="running",
    )

    with pytest.raises(ValueError, match="TTL=None forbidden"):
        await pipeline.execute_phase_b_persist(redis, tmp_path / "rdb.json")


# ── 测试用例 6: Phase B 写入 RDB 快照文件 ─────────────────────


async def test_phase_b_persist_writes_rdb_snapshot(
    pipeline: RestartRecoveryPipeline,
    tmp_path: Path,
) -> None:
    """Phase B persist 应写入 RDB 快照文件（JSON 格式），含所有 key 状态。"""
    redis = FakeRedisClient()
    # 注入全部合规的 key（TTL > 0）
    redis.set_key(
        key="task:contentforge:topic_scheduler",
        value={"topic": "AI Agent 框架对比"},
        ttl=3600,
        status="completed",
        created_at="2026-07-18T08:00:00+00:00",
    )
    redis.set_key(
        key="task:devforge:code_review_scheduler",
        value={"repo": "flowforge/core", "pr": 42},
        ttl=7200,
        status="running",
        created_at="2026-07-18T09:00:00+00:00",
    )

    snapshot_path = tmp_path / "rdb_snapshot.json"
    snapshot = await pipeline.execute_phase_b_persist(redis, snapshot_path)

    # 断言：快照文件已写入磁盘
    assert snapshot_path.exists(), "RDB 快照文件应已写入"
    # 断言：文件内容为合法 JSON
    raw = snapshot_path.read_text(encoding="utf-8")
    data = json.loads(raw)
    # 断言：快照元数据完整
    assert "snapshot_id" in data
    assert "taken_at" in data
    assert "queue_states" in data
    assert "aof_tail_position" in data
    # 断言：两个 key 均已持久化
    assert len(data["queue_states"]) == 2
    assert "task:contentforge:topic_scheduler" in data["queue_states"]
    assert "task:devforge:code_review_scheduler" in data["queue_states"]
    # 断言：每个 key 的 TTL / status 已记录
    cf_state = data["queue_states"]["task:contentforge:topic_scheduler"]
    assert cf_state["ttl"] == 3600
    assert cf_state["status"] == "completed"
    df_state = data["queue_states"]["task:devforge:code_review_scheduler"]
    assert df_state["ttl"] == 7200
    assert df_state["status"] == "running"
    # 断言：返回的 QueueStateSnapshot 与文件内容一致
    assert isinstance(snapshot, QueueStateSnapshot)
    assert snapshot.snapshot_id == data["snapshot_id"]
    assert len(snapshot.queue_states) == 2


# ── 测试用例 7: Phase B 重放恢复状态 ──────────────────────────


async def test_phase_b_replay_restores_state(
    config_with_tmp_paths: RestartRecoveryConfig,
    tmp_path: Path,
) -> None:
    """Phase B replay 应加载 RDB 快照并 replay AOF 日志，返回恢复统计。"""
    pipeline = RestartRecoveryPipeline(
        config=config_with_tmp_paths,
        operator_user_id="test-operator",
    )

    # 步骤 1：先用 persist 生成 RDB 快照（含 2 个 key）
    redis = FakeRedisClient()
    redis.set_key(
        key="task:contentforge:topic_scheduler",
        value={"topic": "AI Agent 框架对比"},
        ttl=3600,
        status="completed",
    )
    redis.set_key(
        key="task:devforge:code_review_scheduler",
        value={"repo": "flowforge/core"},
        ttl=7200,
        status="running",
    )
    rdb_path = tmp_path / "rdb_snapshot.json"
    aof_path = tmp_path / "aof.log"
    snapshot = await pipeline.execute_phase_b_persist(redis, rdb_path)
    # 此时 aof_tail_position = 0（AOF 文件尚不存在）

    # 步骤 2：追加 AOF 日志（模拟快照后的队列状态变更）
    # 新增一个 key（set），删除一个 key（del）
    aof_entries = [
        {
            "op": "set",
            "key": "task:novelforge:chapter_writer",
            "value": {"chapter": 8},
            "ttl": 1800,
            "timestamp": "2026-07-18T10:00:00+00:00",
        },
        {
            "op": "del",
            "key": "task:devforge:code_review_scheduler",
            "timestamp": "2026-07-18T10:05:00+00:00",
        },
    ]
    aof_content = "\n".join(json.dumps(e) for e in aof_entries) + "\n"
    aof_path.write_text(aof_content, encoding="utf-8")

    # 步骤 3：replay
    result = await pipeline.execute_phase_b_replay(aof_path, rdb_path)

    # 断言：恢复结果字段完整
    assert "restored_keys_count" in result
    assert "replayed_entries_count" in result
    assert "final_keys_count" in result
    assert "snapshot_id" in result
    # 断言：从快照恢复 2 个 key
    assert result["restored_keys_count"] == 2
    # 断言：replay 了 2 条 AOF 条目
    assert result["replayed_entries_count"] == 2
    # 断言：最终 key 数 = 2（快照）+ 1（set）- 1（del）= 2
    assert result["final_keys_count"] == 2
    # 断言：snapshot_id 与快照一致
    assert result["snapshot_id"] == snapshot.snapshot_id


# ── 测试用例 8: TTL 合规性验证返回违规列表 ────────────────────


async def test_validate_ttl_compliance_returns_violations(
    config_with_tmp_paths: RestartRecoveryConfig,
) -> None:
    """validate_ttl_compliance 应返回 TTL=0 / None / 超长 的违规 key 列表。"""
    pipeline = RestartRecoveryPipeline(
        config=config_with_tmp_paths,
        operator_user_id="test-operator",
    )
    redis = FakeRedisClient()
    # 合规 key
    redis.set_key(
        key="task:contentforge:topic_scheduler",
        value={"topic": "AI Agent"},
        ttl=3600,
        status="running",
    )
    # 违规：TTL=0（红线）
    redis.set_key(
        key="task:devforge:code_review_scheduler",
        value={"repo": "flowforge"},
        ttl=0,
        status="running",
    )
    # 违规：TTL=None（无显式 TTL）
    redis.set_key(
        key="task:novelforge:chapter_writer",
        value={"chapter": 1},
        ttl=None,
        status="running",
    )
    # 违规：TTL > max_ttl_seconds（604800）
    redis.set_key(
        key="task:mallforge:product_lister",
        value={"sku": "SKU-1"},
        ttl=999999,  # > 604800
        status="running",
    )

    violations = await pipeline.validate_ttl_compliance(redis)

    # 断言：3 个违规 key（TTL=0 / None / 超长）
    assert len(violations) == 3, f"期望 3 个违规，实际 {len(violations)}"
    assert "task:devforge:code_review_scheduler" in violations
    assert "task:novelforge:chapter_writer" in violations
    assert "task:mallforge:product_lister" in violations
    # 断言：合规 key 不在违规列表中
    assert "task:contentforge:topic_scheduler" not in violations


# ── 测试用例 9: 完整流水线返回汇总报告 ────────────────────────


async def test_run_full_pipeline_returns_summary(
    config_with_tmp_paths: RestartRecoveryConfig,
    tmp_path: Path,
) -> None:
    """run_full_pipeline 应执行 Phase A→A+→B 并返回汇总报告 dict.

    场景：所有 key TTL>0（全合规），pipeline 完整执行不抛错。
    含一个 status=completed + TTL>0 的 key（不会被 Phase A 扫描为 stale）。
    """
    config = config_with_tmp_paths.model_copy(update={
        "rdb_snapshot_path": str(tmp_path / "rdb_full.json"),
        "aof_log_path": str(tmp_path / "aof_full.log"),
    })
    pipeline = RestartRecoveryPipeline(
        config=config,
        operator_user_id="luban-architect",
    )
    redis = FakeRedisClient()
    # 全部合规 key（TTL > 0），覆盖多项目真实场景
    redis.set_key(
        key="task:contentforge:topic_scheduler",
        value={"topic": "AI Agent 框架对比", "persona": "life"},
        ttl=3600,
        status="completed",
        created_at="2026-07-18T08:00:00+00:00",
    )
    redis.set_key(
        key="task:devforge:code_review_scheduler",
        value={"repo": "flowforge/core", "pr": 42},
        ttl=7200,
        status="running",
        created_at="2026-07-18T09:00:00+00:00",
    )
    event_bus = FakeEventBus()

    report = await pipeline.run_full_pipeline(redis, event_bus)

    # 断言：汇总报告字段完整（T3：具体断言）
    assert isinstance(report, dict)
    assert "swept_records" in report
    assert "notification" in report
    assert "snapshot" in report
    assert "ttl_violations" in report
    # 断言：Phase A 无 stale 记录（completed 状态 + TTL>0 的 running 均非 stale）
    assert len(report["swept_records"]) == 0
    # 断言：Phase A+ 通知已发布，restart_id 为合法 UUID
    assert report["notification"]["swept_records_count"] == 0
    assert report["notification"]["operator_user_id"] == "luban-architect"
    assert len(report["notification"]["restart_id"]) == 36
    # 断言：EventBus 收到 restart_notification 事件
    assert len(event_bus.published) == 1
    assert event_bus.published[0][0] == "restart_notification"
    # 断言：Phase B 快照已生成，含 2 个 key
    assert report["snapshot"]["queue_states"]
    assert len(report["snapshot"]["queue_states"]) == 2
    # 断言：TTL 合规性验证无违规
    assert report["ttl_violations"] == []
    # 断言：RDB 文件已写入磁盘
    assert (tmp_path / "rdb_full.json").exists()


async def test_run_full_pipeline_raises_on_stale_ttl_violation(
    config_with_tmp_paths: RestartRecoveryConfig,
    tmp_path: Path,
) -> None:
    """run_full_pipeline 在 Redis 含 stale key（TTL<0）时，Phase B 应 raises ValueError.

    场景：Phase A 扫描到 stale 记录，但 stale key 仍在 Redis 中且 TTL<0，
    Phase B persist 验证 TTL 时会因 TTL<0（forbid_zero_ttl=True）抛 ValueError。
    这验证了 stale 记录不会被盲目持久化到快照（需先清理或修复 TTL）。
    """
    config = config_with_tmp_paths.model_copy(update={
        "rdb_snapshot_path": str(tmp_path / "rdb_stale.json"),
        "aof_log_path": str(tmp_path / "aof_stale.log"),
    })
    pipeline = RestartRecoveryPipeline(
        config=config,
        operator_user_id="luban-architect",
    )
    redis = FakeRedisClient()
    # stale key（running + TTL=-1，Phase A 会扫描出，但 Phase B 会拒绝）
    redis.set_key(
        key="task:contentforge:topic_scheduler",
        value={"topic": "AI Agent"},
        ttl=-1,
        status="running",
    )
    event_bus = FakeEventBus()

    # 断言：Phase B persist 因 TTL<0 raises ValueError
    with pytest.raises(ValueError, match="TTL=-1 forbidden"):
        await pipeline.run_full_pipeline(redis, event_bus)

    # 断言：Phase A+ 的事件在 ValueError 抛出前已发布
    assert len(event_bus.published) == 1
    assert event_bus.published[0][0] == "restart_notification"
    assert event_bus.published[0][1]["swept_records_count"] == 1


# ── 测试用例 10: TTL=0 红线验证（即使配置允许也拒绝）──────────


async def test_forbid_zero_ttl_red_line(tmp_path: Path) -> None:
    """TTL=0 是红线：即使 config.forbid_zero_ttl=False，TTL=0 仍被拒绝。

    这是 CL-028 的核心铁律："强制所有 Redis key 显式 TTL（默认 24h，禁止 0）"。
    forbid_zero_ttl 配置项控制 None/<0 是否违规，但 TTL=0 始终违规。
    """
    # 构造 forbid_zero_ttl=False 的配置（模拟"宽松"模式）
    config = RestartRecoveryConfig(
        default_ttl_seconds=86400,
        max_ttl_seconds=604800,
        min_ttl_seconds=60,
        forbid_zero_ttl=False,  # 显式关闭 forbid_zero_ttl
        aof_log_path=str(tmp_path / "aof.log"),
        rdb_snapshot_path=str(tmp_path / "rdb.json"),
    )
    pipeline = RestartRecoveryPipeline(
        config=config,
        operator_user_id="test-operator",
    )
    redis = FakeRedisClient()
    # TTL=0 的 key（即使 forbid_zero_ttl=False 也必须拒绝）
    redis.set_key(
        key="task:contentforge:topic_scheduler",
        value={"topic": "AI Agent"},
        ttl=0,
        status="running",
    )

    # 断言：Phase B persist 仍 raises ValueError（红线）
    with pytest.raises(ValueError, match="TTL=0 forbidden"):
        await pipeline.execute_phase_b_persist(redis, tmp_path / "rdb.json")

    # 断言：validate_ttl_compliance 仍报告 TTL=0 为违规
    redis2 = FakeRedisClient()
    redis2.set_key(
        key="task:devforge:code_review_scheduler",
        value={"repo": "flowforge"},
        ttl=0,
        status="running",
    )
    # 同时注入一个 TTL=None 的 key（forbid_zero_ttl=False 时不应违规）
    redis2.set_key(
        key="task:novelforge:chapter_writer",
        value={"chapter": 1},
        ttl=None,
        status="running",
    )
    violations = await pipeline.validate_ttl_compliance(redis2)
    # 断言：仅 TTL=0 违规，TTL=None 不违规（因 forbid_zero_ttl=False）
    assert len(violations) == 1, \
        f"forbid_zero_ttl=False 时仅 TTL=0 违规，实际 {len(violations)}"
    assert "task:devforge:code_review_scheduler" in violations
    assert "task:novelforge:chapter_writer" not in violations


# ── 额外用例: Phase B replay 仅快照无 AOF ─────────────────────


async def test_phase_b_replay_snapshot_only(
    config_with_tmp_paths: RestartRecoveryConfig,
    tmp_path: Path,
) -> None:
    """Phase B replay 在 AOF 不存在时应仅用快照恢复（不报错）。"""
    pipeline = RestartRecoveryPipeline(
        config=config_with_tmp_paths,
        operator_user_id="test-operator",
    )
    redis = FakeRedisClient()
    redis.set_key(
        key="task:contentforge:topic_scheduler",
        value={"topic": "AI Agent"},
        ttl=3600,
        status="completed",
    )
    rdb_path = tmp_path / "rdb.json"
    aof_path = tmp_path / "missing_aof.log"  # 不存在的 AOF
    await pipeline.execute_phase_b_persist(redis, rdb_path)

    result = await pipeline.execute_phase_b_replay(aof_path, rdb_path)

    # 断言：仅快照恢复，无 AOF replay
    assert result["restored_keys_count"] == 1
    assert result["replayed_entries_count"] == 0
    assert result["final_keys_count"] == 1


# ── 额外用例: Phase B replay 快照不存在 raises FileNotFoundError ──


async def test_phase_b_replay_missing_snapshot_raises(
    config_with_tmp_paths: RestartRecoveryConfig,
    tmp_path: Path,
) -> None:
    """Phase B replay 在快照不存在时应 raises FileNotFoundError。"""
    pipeline = RestartRecoveryPipeline(
        config=config_with_tmp_paths,
        operator_user_id="test-operator",
    )
    missing_rdb = tmp_path / "nonexistent.json"

    with pytest.raises(FileNotFoundError, match="RDB snapshot not found"):
        await pipeline.execute_phase_b_replay(tmp_path / "aof.log", missing_rdb)
