"""Restart Recovery Pipeline — 重启恢复流水线（CL-028 P0 必修）.

Phase A: sweep Redis stale records
Phase A+: emit restart_notification event
Phase B: 队列状态持久化（AOF + RDB 双层）

铁律：
    - 铁律 4：禁止直接操作数据库（通过 Repository 层）
    - 铁律 5：禁止硬编码（TTL / 路径 / 阈值从配置加载）
    - 编程红线 12：禁止绕过 DI 容器直接实例化

设计依据：
    - [doc:design.md#v7.1-§D9.2] ADR-010 补全
    - [doc:decisions/010-distributed-reliability.md] §Restart Recovery Pipeline

License: MIT
"""

from __future__ import annotations

import asyncio
import inspect
import json
import pickle
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("restart_recovery")


# ── Pydantic 数据模型 ──────────────────────────────────────────


class StaleRecord(BaseModel):
    """Phase A 扫描发现的过期记录（不删除，仅标记，保留审计痕迹）.

    Attributes:
        redis_key: Redis 中的 key 名。
        original_status: 原始 status 字段值（如 "running"）。
        ttl_seconds: 扫描时该 key 的 TTL（秒），< 0 表示已过期或无显式 TTL。
        created_at: 记录创建时间（从 Redis hash 中读取，若不存在则用扫描时间）。
        swept_at: 被标记为 stale 的时间。
    """

    redis_key: str
    original_status: str
    ttl_seconds: int
    created_at: datetime
    swept_at: datetime


class RestartNotification(BaseModel):
    """Phase A+ 发布的重启通知事件载荷.

    灵智体订阅 ``restart_notification`` 事件后，可依据此载荷触发自身的
    restart recovery 流程。

    Attributes:
        restart_id: 本次重启恢复的唯一 ID（UUID）。
        swept_records_count: Phase A 扫描到的过期记录数量。
        timestamp: 事件发布时间。
        operator_user_id: 触发重启的操作者用户 ID。
    """

    restart_id: str
    swept_records_count: int
    timestamp: datetime
    operator_user_id: str


class RestartRecoveryConfig(BaseModel):
    """重启恢复流水线配置（铁律 5：禁止硬编码，所有阈值从配置注入）.

    Attributes:
        default_ttl_seconds: 默认 TTL（秒），默认 24h = 86400。
        max_ttl_seconds: 最大允许 TTL（秒），默认 7 天 = 604800。
        min_ttl_seconds: 最小允许 TTL（秒），默认 60。
        forbid_zero_ttl: 是否禁止 TTL=0 / None / 无显式 TTL（红线，默认 True）。
        aof_log_path: AOF 日志文件路径（追加写）。
        rdb_snapshot_path: RDB 快照文件路径（JSON 格式）。
    """

    default_ttl_seconds: int = Field(default=86400, ge=1)
    max_ttl_seconds: int = Field(default=604800, ge=1)
    min_ttl_seconds: int = Field(default=60, ge=1)
    forbid_zero_ttl: bool = Field(default=True)
    aof_log_path: str = Field(default="data/restart_recovery/aof.log")
    rdb_snapshot_path: str = Field(default="data/restart_recovery/rdb_snapshot.json")


class QueueStateSnapshot(BaseModel):
    """Phase B 生成的队列状态快照（RDB）.

    Attributes:
        snapshot_id: 快照唯一 ID（UUID）。
        taken_at: 快照时间。
        queue_states: key -> ``{"value": ..., "ttl": int, "status": str}`` 映射。
        aof_tail_position: 快照时刻 AOF 文件的字节偏移量，replay 时从此处开始。
    """

    snapshot_id: str
    taken_at: datetime
    queue_states: dict[str, dict] = Field(default_factory=dict)
    aof_tail_position: int = 0


# ── RestartRecoveryPipeline 主类 ──────────────────────────────


class RestartRecoveryPipeline:
    """重启恢复流水线（CL-028 P0 必修）.

    三阶段执行：

        - **Phase A**: 扫描 Redis 过期记录（``status="running"`` 且 ``TTL < 0``）。
          不删除，仅标记，保留审计痕迹。
        - **Phase A+**: 发布 ``restart_notification`` 事件到 EventBus，
          灵智体订阅后触发自身的 restart recovery 流程。
        - **Phase B**: 队列状态持久化（AOF + RDB 双层）。
          强制所有 Redis key 显式 TTL（默认 24h，**禁止 0**）。
          重启时先加载 RDB 快照，再 replay AOF 日志。

    所有 I/O 操作使用 ``async/await``，文件操作通过 ``asyncio.to_thread`` 包装
    同步文件 I/O，避免阻塞事件循环。

    单向依赖（架构铁律）：本模块位于 ``core/`` 层，不依赖 ``forgemind`` /
    ``app`` / ``tools`` 等上层模块。
    """

    def __init__(
        self,
        config: Optional[RestartRecoveryConfig] = None,
        operator_user_id: str = "system",
    ) -> None:
        """初始化重启恢复流水线.

        Args:
            config: 配置对象（None 则使用默认 RestartRecoveryConfig）。
            operator_user_id: 触发重启的操作者用户 ID，写入通知事件载荷。
        """
        self._config = config or RestartRecoveryConfig()
        self._operator_user_id = operator_user_id

    # ── Phase A: sweep Redis stale records ────────────────────

    async def execute_phase_a_sweep(self, redis_client: Any) -> list[StaleRecord]:
        """Phase A: 扫描 Redis 中的过期记录.

        使用 SCAN 命令遍历 keys（不用 KEYS，避免阻塞 Redis）。
        对每个 key：检查 TTL + status 字段。
        若 ``status="running"`` 且 ``TTL < 0``（已过期但未被清理 / 无显式 TTL）：
        标记为 stale。不删除，仅标记，保留审计痕迹。

        Args:
            redis_client: Redis 客户端，需支持 ``scan(pattern=...)`` /
                ``ttl(key)`` / ``hget(key, field)`` 方法（sync 或 async 均可）。

        Returns:
            扫描到的 StaleRecord 列表（可能为空）。
        """
        logger.info("Phase A: 开始扫描 Redis 过期记录")
        swept: list[StaleRecord] = []
        now = datetime.now(timezone.utc)

        keys = await self._scan_keys(redis_client, pattern="*")
        logger.info(f"Phase A: 扫描到 {len(keys)} 个 key")

        for key in keys:
            ttl = await self._safe_ttl(redis_client, key)
            status = await self._safe_hget(redis_client, key, "status")

            if status == "running" and ttl is not None and ttl < 0:
                created_at_str = await self._safe_hget(redis_client, key, "created_at")
                created_at = self._parse_datetime(created_at_str) or now
                record = StaleRecord(
                    redis_key=key,
                    original_status=status,
                    ttl_seconds=ttl,
                    created_at=created_at,
                    swept_at=now,
                )
                swept.append(record)
                logger.warning(
                    f"Phase A: 发现过期记录 key={key} ttl={ttl} status={status}"
                )

        logger.info(f"Phase A: 扫描完成，发现 {len(swept)} 条过期记录")
        return swept

    # ── Phase A+: emit restart_notification event ─────────────

    async def execute_phase_a_plus_notify(
        self,
        swept_records: list[StaleRecord],
        event_bus: Any,
    ) -> RestartNotification:
        """Phase A+: 发布 ``restart_notification`` 事件.

        生成 ``restart_id``（UUID），构造 RestartNotification 事件，
        通过 ``event_bus.publish("restart_notification", payload)`` 发布。
        灵智体订阅此事件，触发自身的 restart recovery 流程。

        Args:
            swept_records: Phase A 扫描到的过期记录列表。
            event_bus: 事件总线，需支持 ``publish(event_type, payload)`` 方法
                （sync 或 async 均可；若无 ``publish`` 则回退到 ``emit``）。

        Returns:
            构造的 RestartNotification 对象。
        """
        restart_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc)
        notification = RestartNotification(
            restart_id=restart_id,
            swept_records_count=len(swept_records),
            timestamp=timestamp,
            operator_user_id=self._operator_user_id,
        )
        payload = notification.model_dump(mode="json")
        await self._publish_event(event_bus, "restart_notification", payload)
        logger.info(
            f"Phase A+: 发布 restart_notification 事件 "
            f"restart_id={restart_id} swept_count={len(swept_records)}"
        )
        return notification

    # ── Phase B: 队列状态持久化 ────────────────────────────────

    async def execute_phase_b_persist(
        self,
        redis_client: Any,
        snapshot_path: Optional[Path] = None,
    ) -> QueueStateSnapshot:
        """Phase B: 持久化队列状态到 RDB 快照.

        验证所有 key 显式 TTL（**禁止 TTL=0 或 TTL=None**，违反则 raises
        ``ValueError``）。生成快照（DUMP 所有 key + value + TTL），写入 RDB
        文件（JSON 格式）。

        Args:
            redis_client: Redis 客户端，需支持 ``scan`` / ``ttl`` / ``dump`` /
                ``hget`` 方法。
            snapshot_path: 快照文件路径（None 则使用 ``config.rdb_snapshot_path``）。

        Returns:
            生成的 QueueStateSnapshot。

        Raises:
            ValueError: 若存在 TTL 违规（TTL=0 红线 / TTL=None / TTL<0 当
                ``forbid_zero_ttl=True``）。
        """
        target_path = (
            Path(snapshot_path) if snapshot_path else Path(self._config.rdb_snapshot_path)
        )
        logger.info(f"Phase B: 开始持久化队列状态到 {target_path}")

        keys = await self._scan_keys(redis_client, pattern="*")
        queue_states: dict[str, dict] = {}

        for key in keys:
            ttl = await self._safe_ttl(redis_client, key)
            self._enforce_ttl_red_line(key, ttl)  # raises ValueError on violation

            value_bytes = await self._safe_dump(redis_client, key)
            status = await self._safe_hget(redis_client, key, "status")
            value = self._deserialize_value(value_bytes)
            value = self._ensure_json_safe(value)

            queue_states[key] = {
                "value": value,
                "ttl": ttl,
                "status": status or "",
            }

        aof_tail = await self._get_aof_tail_position()
        snapshot = QueueStateSnapshot(
            snapshot_id=str(uuid.uuid4()),
            taken_at=datetime.now(timezone.utc),
            queue_states=queue_states,
            aof_tail_position=aof_tail,
        )

        await self._write_rdb_snapshot(snapshot, target_path)
        logger.info(
            f"Phase B: 快照写入完成 snapshot_id={snapshot.snapshot_id} "
            f"keys={len(queue_states)} aof_tail={aof_tail}"
        )
        return snapshot

    async def execute_phase_b_replay(
        self,
        aof_log_path: Optional[Path] = None,
        rdb_snapshot_path: Optional[Path] = None,
    ) -> dict:
        """Phase B: 重放 AOF 日志恢复状态.

        加载 RDB 快照，然后从 ``aof_tail_position`` 开始 replay AOF 日志。
        AOF 每行格式为 JSON：``{"op": "set"|"del", "key": "...", "value": ..., "ttl": N}``。

        Args:
            aof_log_path: AOF 日志文件路径（None 则使用 ``config.aof_log_path``）。
            rdb_snapshot_path: RDB 快照文件路径（None 则使用
                ``config.rdb_snapshot_path``）。

        Returns:
            恢复结果 dict：

                - ``restored_keys_count``: 从快照恢复的 key 数量。
                - ``replayed_entries_count``: replay 的 AOF 条目数。
                - ``final_keys_count``: 最终 key 总数（快照 + AOF set - AOF del）。
                - ``snapshot_id``: 使用的快照 ID。

        Raises:
            FileNotFoundError: 若 RDB 快照文件不存在。
        """
        aof_path = (
            Path(aof_log_path) if aof_log_path else Path(self._config.aof_log_path)
        )
        rdb_path = (
            Path(rdb_snapshot_path)
            if rdb_snapshot_path
            else Path(self._config.rdb_snapshot_path)
        )

        logger.info(f"Phase B replay: 加载 RDB 快照 {rdb_path}")
        snapshot = await self._read_rdb_snapshot(rdb_path)

        restored_keys: set[str] = set(snapshot.queue_states.keys())
        replayed = 0

        if aof_path.exists():
            logger.info(
                f"Phase B replay: 从 offset {snapshot.aof_tail_position} replay AOF {aof_path}"
            )
            entries = await self._read_aof_entries(aof_path, snapshot.aof_tail_position)
            for entry in entries:
                replayed += 1
                op = entry.get("op")
                key = entry.get("key", "")
                if op == "set":
                    restored_keys.add(key)
                elif op == "del":
                    restored_keys.discard(key)
            logger.info(f"Phase B replay: replayed {replayed} 条 AOF 条目")
        else:
            logger.info(f"Phase B replay: AOF 文件不存在 {aof_path}，仅使用快照")

        result = {
            "restored_keys_count": len(snapshot.queue_states),
            "replayed_entries_count": replayed,
            "final_keys_count": len(restored_keys),
            "snapshot_id": snapshot.snapshot_id,
        }
        logger.info(f"Phase B replay 完成: {result}")
        return result

    # ── TTL 合规性验证 ────────────────────────────────────────

    async def validate_ttl_compliance(self, redis_client: Any) -> list[str]:
        """验证所有 Redis key 的 TTL 合规性（仅报告，不抛错）.

        违规条件：

            - TTL == 0（红线，始终违规，即使 ``forbid_zero_ttl=False``）。
            - TTL is None（当 ``forbid_zero_ttl=True``）。
            - TTL < 0（当 ``forbid_zero_ttl=True``，无显式过期或 key 缺失）。
            - TTL > ``max_ttl_seconds``。

        Args:
            redis_client: Redis 客户端。

        Returns:
            违规 key 列表（按扫描顺序）。
        """
        keys = await self._scan_keys(redis_client, pattern="*")
        violations: list[str] = []

        for key in keys:
            ttl = await self._safe_ttl(redis_client, key)
            reason = self._check_ttl_violation(ttl)
            if reason is not None:
                violations.append(key)
                logger.warning(f"TTL 违规: key={key} ttl={ttl} reason={reason}")

        logger.info(
            f"TTL 合规性验证: 扫描 {len(keys)} 个 key，发现 {len(violations)} 个违规"
        )
        return violations

    # ── 完整流水线 ────────────────────────────────────────────

    async def run_full_pipeline(
        self,
        redis_client: Any,
        event_bus: Any,
    ) -> dict:
        """执行完整重启恢复流水线（Phase A → A+ → B）.

        Args:
            redis_client: Redis 客户端。
            event_bus: 事件总线。

        Returns:
            汇总报告 dict：

                - ``swept_records``: Phase A 扫描的过期记录列表（序列化为 dict）。
                - ``notification``: Phase A+ 发布的通知（序列化为 dict）。
                - ``snapshot``: Phase B 生成的快照（序列化为 dict）。
                - ``ttl_violations``: TTL 违规 key 列表。
        """
        logger.info("===== 开始执行 Restart Recovery Pipeline =====")

        # Phase A
        swept = await self.execute_phase_a_sweep(redis_client)

        # Phase A+
        notification = await self.execute_phase_a_plus_notify(swept, event_bus)

        # TTL 合规性验证（在 Phase B 之前，仅报告不抛错）
        ttl_violations = await self.validate_ttl_compliance(redis_client)

        # Phase B（若存在 TTL=0 红线违规会抛 ValueError，由调用方处理）
        snapshot = await self.execute_phase_b_persist(redis_client)

        report = {
            "swept_records": [r.model_dump(mode="json") for r in swept],
            "notification": notification.model_dump(mode="json"),
            "snapshot": snapshot.model_dump(mode="json"),
            "ttl_violations": ttl_violations,
        }
        logger.info("===== Restart Recovery Pipeline 执行完成 =====")
        return report

    # ── 内部辅助方法 ──────────────────────────────────────────

    async def _scan_keys(self, redis_client: Any, pattern: str = "*") -> list[str]:
        """使用 SCAN 遍历 keys（不阻塞 Redis）.

        兼容多种 scan 签名：
            - ``scan(pattern="*") -> list[str]``
            - ``scan() -> list[str]``
            - ``scan(pattern="*") -> (cursor, list[str])``  （redis-py 风格）
        """
        scan = getattr(redis_client, "scan", None)
        if scan is None:
            return []
        try:
            sig = inspect.signature(scan)
            if "pattern" in sig.parameters:
                result = scan(pattern=pattern)
            else:
                result = scan()
        except (TypeError, ValueError):
            result = scan()

        result = await self._maybe_await(result)
        # redis-py 的 scan 返回 (cursor, keys) 元组
        if isinstance(result, tuple) and len(result) == 2:
            return list(result[1])
        if isinstance(result, (list, set, tuple)):
            return list(result)
        return []

    async def _safe_ttl(self, redis_client: Any, key: str) -> Optional[int]:
        """安全读取 key 的 TTL（None 表示客户端不支持或 key 不存在）。"""
        ttl_method = getattr(redis_client, "ttl", None)
        if ttl_method is None:
            return None
        result = await self._maybe_await(ttl_method(key))
        return result

    async def _safe_hget(self, redis_client: Any, key: str, field: str) -> str:
        """安全读取 hash 字段（空字符串表示不存在或客户端不支持）。"""
        hget = getattr(redis_client, "hget", None)
        if hget is None:
            return ""
        result = await self._maybe_await(hget(key, field))
        if result is None:
            return ""
        if isinstance(result, bytes):
            return result.decode("utf-8", errors="ignore")
        return str(result)

    async def _safe_dump(self, redis_client: Any, key: str) -> bytes:
        """安全 DUMP key 的值（空 bytes 表示不存在或客户端不支持）。"""
        dump = getattr(redis_client, "dump", None)
        if dump is None:
            return b""
        result = await self._maybe_await(dump(key))
        if result is None:
            return b""
        if isinstance(result, str):
            result = result.encode("utf-8")
        return bytes(result)

    @staticmethod
    async def _maybe_await(value: Any) -> Any:
        """若 value 是 coroutine/awaitable 则 await，否则直接返回。

        兼容 sync 与 async 两种 Redis 客户端实现。
        """
        if inspect.isawaitable(value):
            return await value
        return value

    @staticmethod
    def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
        """解析 ISO 格式时间字符串（失败返回 None）。"""
        if not value:
            return None
        try:
            return datetime.fromisoformat(value)
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _deserialize_value(raw: bytes) -> Any:
        """反序列化 DUMP 的值.

        优先 pickle，回退 JSON，再回退 UTF-8 文本。全部失败返回 None。
        """
        if not raw:
            return None
        try:
            return pickle.loads(raw)
        except Exception:
            pass
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            try:
                return raw.decode("utf-8", errors="ignore")
            except Exception:
                return None

    @staticmethod
    def _ensure_json_safe(value: Any) -> Any:
        """确保 value 可 JSON 序列化（不可序列化则转 str）。"""
        try:
            json.dumps(value)
            return value
        except (TypeError, ValueError):
            return str(value)

    def _enforce_ttl_red_line(self, key: str, ttl: Optional[int]) -> None:
        """强制 TTL 红线（Phase B persist 调用，违反 raises ValueError）.

        红线规则：

            - TTL == 0：**始终禁止**（即使 ``config.forbid_zero_ttl=False``）。
            - TTL is None：当 ``forbid_zero_ttl=True`` 时禁止。
            - TTL < 0：当 ``forbid_zero_ttl=True`` 时禁止
              （-1 = 无显式过期，-2 = key 缺失）。
        """
        if ttl == 0:
            raise ValueError(
                f"TTL=0 forbidden for key={key!r} "
                "(red line: TTL=0 is always rejected)"
            )
        if self._config.forbid_zero_ttl:
            if ttl is None:
                raise ValueError(
                    f"TTL=None forbidden for key={key!r} "
                    "(explicit TTL required by config.forbid_zero_ttl)"
                )
            if ttl < 0:
                raise ValueError(
                    f"TTL={ttl} forbidden for key={key!r} "
                    "(explicit TTL required: negative means no expiration or key missing)"
                )

    def _check_ttl_violation(self, ttl: Optional[int]) -> Optional[str]:
        """检查 TTL 合规性，返回违规原因字符串（无违规返回 None）.

        用于 ``validate_ttl_compliance``，仅报告不抛错。
        """
        if ttl == 0:
            return "TTL=0 (red line)"
        if ttl is None:
            if self._config.forbid_zero_ttl:
                return "TTL=None (no explicit TTL)"
            return None
        if ttl < 0:
            if self._config.forbid_zero_ttl:
                return f"TTL={ttl} (no explicit expiration)"
            return None
        if ttl > self._config.max_ttl_seconds:
            return f"TTL={ttl} exceeds max_ttl_seconds={self._config.max_ttl_seconds}"
        return None

    async def _get_aof_tail_position(self) -> int:
        """获取 AOF 文件当前字节大小（作为快照时刻的 tail position）。"""
        aof_path = Path(self._config.aof_log_path)
        if not aof_path.exists():
            return 0
        try:
            stat_result = await asyncio.to_thread(aof_path.stat)
            return stat_result.st_size
        except OSError:
            return 0

    async def _write_rdb_snapshot(
        self, snapshot: QueueStateSnapshot, path: Path
    ) -> None:
        """写入 RDB 快照文件（JSON 格式，通过 asyncio.to_thread 包装）。"""
        payload = snapshot.model_dump_json(indent=2)

        def _write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(payload, encoding="utf-8")

        await asyncio.to_thread(_write)

    async def _read_rdb_snapshot(self, path: Path) -> QueueStateSnapshot:
        """读取 RDB 快照文件并反序列化为 QueueStateSnapshot.

        Raises:
            FileNotFoundError: 若快照文件不存在。
        """
        if not path.exists():
            raise FileNotFoundError(f"RDB snapshot not found: {path}")

        def _read() -> str:
            return path.read_text(encoding="utf-8")

        text = await asyncio.to_thread(_read)
        data = json.loads(text)
        return QueueStateSnapshot.model_validate(data)

    async def _read_aof_entries(
        self, path: Path, start_offset: int
    ) -> list[dict]:
        """读取 AOF 日志条目（从 start_offset 字节开始，每行一个 JSON 对象）。"""
        def _read() -> list[dict]:
            entries: list[dict] = []
            with open(path, "r", encoding="utf-8") as f:
                if start_offset > 0:
                    f.seek(start_offset)
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
            return entries

        return await asyncio.to_thread(_read)

    async def _publish_event(
        self, event_bus: Any, event_type: str, payload: Any
    ) -> None:
        """发布事件到 EventBus（兼容 sync/async publish 与 emit 回退）.

        优先调用 ``event_bus.publish(event_type, payload)``（spec 规定）。
        若不存在 ``publish`` 方法，回退到 ``event_bus.emit("", event_type, payload)``。
        """
        publish = getattr(event_bus, "publish", None)
        if publish is not None:
            result = publish(event_type, payload)
            if inspect.isawaitable(result):
                await result
            return
        emit = getattr(event_bus, "emit", None)
        if emit is not None:
            emit("", event_type, payload)
