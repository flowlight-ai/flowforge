"""Schedule Factory Registry — 调度工厂注册表（CL-023 P0 必修）.

plugin-owned factory 边界 + deterministic runtime task id +
cross-plugin ownership collision 检测 + Schedule Factory Whitelist.

设计依据:
    - `docs/design.md` v7.1-§D5.5 ScheduleFactoryRegistry 规范
    - `docs/review/review.md` 第十四章 CL-023
    - F202 Phase 2 AC-F1~F5（Schedule Resource Contract）

AC 完整对齐:
    - AC-F1: Plugin 声明 ScheduleFactory 后，host 启动期加载并验证
    - AC-F2: 同名 factory 冲突时，启动失败并报告冲突 Plugin
    - AC-F3: runtime task id 格式：``{plugin_id}:{factory_id}:{seq:08d}``，确定性
    - AC-F4: 未在白名单中的 factory 调用被拒绝（raises PermissionError）
    - AC-F5: factory 注册信息含（plugin_id / factory_id / schedule_type /
      cron_expr_or_interval / max_concurrent / owner_user_id）

铁律遵守:
    - 铁律 5：禁止硬编码（白名单从 YAML 加载）
    - 编程红线 11：配置驱动 > 代码实现
    - 编程红线 12：禁止绕过 DI 容器直接实例化（本类为纯注册表，无外部依赖）
    - 铁律 6：所有 I/O 操作使用 async/await（YAML 读取用 asyncio.to_thread 包装）

License: MIT
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Union

import yaml
from pydantic import BaseModel, Field, model_validator

from flowforge.core.tracing import get_logger

logger = get_logger("schedule_registry")

PathLike = Union[str, Path]


class ScheduleType(str, Enum):
    """调度类型枚举。

    Attributes:
        CRON: 基于 cron 表达式的定时调度。
        INTERVAL: 基于固定间隔的循环调度。
        ONE_SHOT: 一次性调度（单次触发）。
        EVENT_TRIGGERED: 事件触发型调度（由外部事件驱动）。
    """

    CRON = "cron"
    INTERVAL = "interval"
    ONE_SHOT = "one_shot"
    EVENT_TRIGGERED = "event_triggered"


class FactoryRegistration(BaseModel):
    """工厂注册信息（Pydantic BaseModel）— AC-F5 字段契约.

    每个 ScheduleFactory 的注册信息必须包含：plugin_id / factory_id /
    schedule_type / cron_expr 或 interval_seconds / max_concurrent /
    owner_user_id。

    铁律:
        - 编程红线 9：使用组合（Pydantic 字段）而非继承
        - 本模型仅声明字段，不持有行为（行为在 ScheduleFactoryRegistry 中）

    Attributes:
        plugin_id: Plugin 标识（如 ``"contentforge"``）。
        factory_id: Factory 标识（plugin 内唯一，如 ``"topic_scheduler"``）。
        schedule_type: 调度类型（cron / interval / one_shot / event_triggered）。
        cron_expr: cron 表达式（schedule_type=cron 时必填，如 ``"0 9 * * *"``）。
        interval_seconds: 间隔秒数（schedule_type=interval 时必填，必须 > 0）。
        max_concurrent: 最大并发数（默认 1，必须 >= 1）。
        owner_user_id: 所有者用户 ID（如 ``"operator_001"``）。
    """

    plugin_id: str = Field(..., description="Plugin 标识")
    factory_id: str = Field(..., description="Factory 标识（plugin 内唯一）")
    schedule_type: ScheduleType = Field(..., description="调度类型")
    cron_expr: str | None = Field(
        None, description="cron 表达式（schedule_type=cron 时必填）"
    )
    interval_seconds: int | None = Field(
        None, description="间隔秒数（schedule_type=interval 时必填）"
    )
    max_concurrent: int = Field(default=1, ge=1, description="最大并发数")
    owner_user_id: str = Field(..., description="所有者用户 ID")

    @model_validator(mode="after")
    def validate_schedule_type_fields(self) -> FactoryRegistration:
        """根据 schedule_type 校验必填字段。

        - cron 类型必须提供 cron_expr
        - interval 类型必须提供 interval_seconds（且 > 0）
        """
        if self.schedule_type == ScheduleType.CRON and not self.cron_expr:
            raise ValueError(
                "schedule_type=cron 时 cron_expr 必填（AC-F5 字段契约）"
            )
        if self.schedule_type == ScheduleType.INTERVAL:
            if self.interval_seconds is None:
                raise ValueError(
                    "schedule_type=interval 时 interval_seconds 必填"
                    "（AC-F5 字段契约）"
                )
            if self.interval_seconds <= 0:
                raise ValueError("interval_seconds 必须大于 0")
        return self


@dataclass(frozen=True)
class RuntimeTaskId:
    """运行时任务 ID（确定性）— AC-F3.

    格式：``{plugin_id}:{factory_id}:{seq:08d}``

    确定性保证:
        - 相同 (plugin_id, factory_id) 的 sequence 单调递增
        - 不同 plugin 的 task id 不会冲突（plugin_id 前缀隔离）
        - 同一 plugin 不同 factory 的 task id 不会冲突（factory_id 隔离）

    Attributes:
        plugin_id: Plugin 标识。
        factory_id: Factory 标识。
        sequence: 序列号（从 1 开始，8 位零填充）。
    """

    plugin_id: str
    factory_id: str
    sequence: int

    def format(self) -> str:
        """格式化为确定性 task id 字符串。

        Returns:
            格式为 ``{plugin_id}:{factory_id}:{seq:08d}`` 的字符串。
        """
        return f"{self.plugin_id}:{self.factory_id}:{self.sequence:08d}"

    def __str__(self) -> str:
        return self.format()


class ScheduleFactoryRegistry:
    """调度工厂注册表 — CL-023 P0 必修.

    四大核心能力:
        1. **plugin-owned factory 边界**：每个 Plugin 注册自己的 ScheduleFactory
        2. **deterministic runtime task id**：plugin_id + factory_id + sequence
        3. **cross-plugin ownership collision 检测**：启动期检测同名 factory
        4. **Schedule Factory Whitelist**：未声明 factory 拒绝注册

    线程安全:
        ``_factories`` 和 ``_sequence_counters`` 字典用 ``asyncio.Lock`` 保护，
        所有读写操作都在锁内完成。

    使用示例::

        registry = ScheduleFactoryRegistry()
        await registry.load_whitelist("config/schedule_factories.yaml")
        registration = FactoryRegistration(
            plugin_id="contentforge",
            factory_id="topic_scheduler",
            schedule_type=ScheduleType.CRON,
            cron_expr="0 9 * * *",
            max_concurrent=3,
            owner_user_id="operator_001",
        )
        await registry.register(registration)
        task_id = await registry.allocate_task_id("contentforge", "topic_scheduler")
        print(task_id.format())  # "contentforge:topic_scheduler:00000001"

    详见:
        - [doc:design.md#§D5.5] ScheduleFactoryRegistry 规范
        - [doc:review/review.md#14] CL-023
    """

    def __init__(self) -> None:
        # (plugin_id, factory_id) -> FactoryRegistration
        self._factories: dict[tuple[str, str], FactoryRegistration] = {}
        # factory_id -> plugin_id（用于跨 plugin 冲突检测）
        self._factory_owners: dict[str, str] = {}
        # (plugin_id, factory_id) -> sequence counter
        self._sequence_counters: dict[tuple[str, str], int] = {}
        # 白名单：factory_id -> FactoryRegistration（声明式）
        self._whitelist: dict[str, FactoryRegistration] = {}
        # 锁保护并发访问
        self._lock: asyncio.Lock = asyncio.Lock()

    # ── 白名单加载（AC-F1）─────────────────────────────────────────

    async def load_whitelist(self, whitelist_yaml_path: PathLike) -> int:
        """从 YAML 加载白名单（启动期调用）— AC-F1.

        铁律 5：白名单从 YAML 加载，禁止硬编码。
        铁律 6：YAML 读取使用 async（asyncio.to_thread 包装同步 I/O）。

        YAML 格式::

            factories:
              - plugin_id: contentforge
                factory_id: topic_scheduler
                schedule_type: cron
                cron_expr: "0 9 * * *"
                max_concurrent: 3
                owner_user_id: operator_001

        Args:
            whitelist_yaml_path: 白名单 YAML 文件路径。

        Returns:
            加载的 factory 数量。

        Raises:
            FileNotFoundError: 文件不存在。
            ValueError: YAML 格式错误或 factory_id 重复。
            pydantic.ValidationError: 字段类型不匹配。
        """
        file_path = Path(whitelist_yaml_path)
        if not file_path.exists():
            raise FileNotFoundError(f"白名单文件不存在: {file_path}")

        raw_text = await asyncio.to_thread(self._read_text_sync, file_path)
        try:
            data = await asyncio.to_thread(yaml.safe_load, raw_text)
        except yaml.YAMLError as e:
            logger.error(f"YAML 解析错误 {file_path}: {e}")
            raise ValueError(f"YAML 解析错误 {file_path}: {e}") from e

        if data is None:
            logger.warning(f"白名单文件为空: {file_path}")
            async with self._lock:
                self._whitelist.clear()
            return 0
        if not isinstance(data, dict):
            raise ValueError(
                f"YAML 根必须是 mapping，got {type(data).__name__}"
            )

        factories_list = data.get("factories", [])
        if not isinstance(factories_list, list):
            raise ValueError(
                f"factories 字段必须是 list，got {type(factories_list).__name__}"
            )

        new_whitelist: dict[str, FactoryRegistration] = {}
        for entry in factories_list:
            registration = FactoryRegistration(**entry)
            if registration.factory_id in new_whitelist:
                raise ValueError(
                    f"白名单中 factory_id 重复: {registration.factory_id}"
                )
            new_whitelist[registration.factory_id] = registration

        async with self._lock:
            self._whitelist = new_whitelist

        logger.info(f"已加载 {len(new_whitelist)} 个 factory 白名单")
        return len(new_whitelist)

    # ── 注册 / 注销（AC-F1 / AC-F2 / AC-F4 / AC-F5）───────────────

    async def register(self, registration: FactoryRegistration) -> None:
        """注册一个 factory — AC-F1 / AC-F2 / AC-F4 / AC-F5.

        校验顺序:
            1. **白名单验证（AC-F4）**：若 factory_id 不在白名单中，
               raises ``PermissionError``。
            2. **跨 plugin 冲突检测（AC-F2）**：若 factory_id 已被其他
               plugin 注册，raises ``ValueError``。

        Args:
            registration: 工厂注册信息（AC-F5 字段契约）。

        Raises:
            PermissionError: factory_id 不在白名单中（AC-F4）。
            ValueError: factory_id 已被其他 plugin 注册（AC-F2 跨 plugin 冲突）。
        """
        async with self._lock:
            # AC-F4：白名单验证
            if registration.factory_id not in self._whitelist:
                raise PermissionError(
                    f"factory_id {registration.factory_id!r} 不在白名单中，"
                    f"拒绝注册（plugin_id={registration.plugin_id}）。"
                    f"详见 [doc:review/review.md#14] CL-023 AC-F4"
                )
            # AC-F2：跨 plugin 冲突检测
            existing_owner = self._factory_owners.get(registration.factory_id)
            if (
                existing_owner is not None
                and existing_owner != registration.plugin_id
            ):
                raise ValueError(
                    f"factory_id {registration.factory_id!r} 已被 plugin "
                    f"{existing_owner!r} 注册，plugin "
                    f"{registration.plugin_id!r} 无法注册"
                    f"（跨 plugin ownership 冲突，AC-F2）。"
                    f"详见 [doc:review/review.md#14] CL-023"
                )
            key = (registration.plugin_id, registration.factory_id)
            self._factories[key] = registration
            self._factory_owners[registration.factory_id] = (
                registration.plugin_id
            )
            # 初始化 sequence counter（若未存在）
            if key not in self._sequence_counters:
                self._sequence_counters[key] = 0

        logger.info(
            f"已注册 factory: plugin={registration.plugin_id} "
            f"factory={registration.factory_id} "
            f"type={registration.schedule_type.value}"
        )

    async def unregister(self, plugin_id: str, factory_id: str) -> bool:
        """注销 factory。

        注销后无法再分配 task id（``allocate_task_id`` 会 raises ``KeyError``）。

        Args:
            plugin_id: Plugin 标识。
            factory_id: Factory 标识。

        Returns:
            ``True`` 表示注销成功；``False`` 表示未注册。
        """
        async with self._lock:
            key = (plugin_id, factory_id)
            if key not in self._factories:
                return False
            del self._factories[key]
            # 仅当 owner 一致时才清除 owner 映射
            if self._factory_owners.get(factory_id) == plugin_id:
                del self._factory_owners[factory_id]
            # 清除 sequence counter
            self._sequence_counters.pop(key, None)

        logger.info(
            f"已注销 factory: plugin={plugin_id} factory={factory_id}"
        )
        return True

    # ── Task ID 分配（AC-F3）──────────────────────────────────────

    async def allocate_task_id(
        self,
        plugin_id: str,
        factory_id: str,
    ) -> RuntimeTaskId:
        """分配确定性 runtime task id — AC-F3.

        格式：``{plugin_id}:{factory_id}:{seq:08d}``

        内部维护 ``{(plugin_id, factory_id): sequence_counter}`` 字典，
        每次调用递增 sequence，返回 :class:`RuntimeTaskId`。

        确定性保证:
            - 相同 (plugin_id, factory_id) 的 sequence 单调递增
            - 不同 factory 的 sequence 独立递增

        Args:
            plugin_id: Plugin 标识。
            factory_id: Factory 标识。

        Returns:
            :class:`RuntimeTaskId` 实例（调用 ``.format()`` 获取字符串）。

        Raises:
            KeyError: factory 未注册。
        """
        async with self._lock:
            key = (plugin_id, factory_id)
            if key not in self._factories:
                raise KeyError(
                    f"factory 未注册: plugin={plugin_id} "
                    f"factory={factory_id}。无法分配 task id。"
                )
            self._sequence_counters[key] = (
                self._sequence_counters.get(key, 0) + 1
            )
            sequence = self._sequence_counters[key]

        return RuntimeTaskId(
            plugin_id=plugin_id,
            factory_id=factory_id,
            sequence=sequence,
        )

    # ── 查询接口 ──────────────────────────────────────────────────

    async def list_factories(
        self,
        plugin_id: str | None = None,
    ) -> list[FactoryRegistration]:
        """列出 factory。

        Args:
            plugin_id: 可选，按 plugin 过滤。``None`` 表示列出所有。

        Returns:
            :class:`FactoryRegistration` 列表（拷贝，外部修改不影响内部状态）。
        """
        async with self._lock:
            if plugin_id is None:
                return list(self._factories.values())
            return [
                reg
                for reg in self._factories.values()
                if reg.plugin_id == plugin_id
            ]

    async def get_factory(
        self,
        plugin_id: str,
        factory_id: str,
    ) -> FactoryRegistration | None:
        """查询单个 factory。

        Args:
            plugin_id: Plugin 标识。
            factory_id: Factory 标识。

        Returns:
            :class:`FactoryRegistration` 实例；未注册返回 ``None``。
        """
        async with self._lock:
            return self._factories.get((plugin_id, factory_id))

    # ── 启动期验证（AC-F1 / AC-F2 / AC-F4）────────────────────────

    async def validate_at_startup(self) -> list[str]:
        """启动期验证（返回冲突 / 未声明 factory 错误列表）.

        此方法作为安全网，用于在启动期 rehydrate 后验证注册表状态一致性。
        正常情况下 ``register`` 已阻止冲突和未声明 factory，但持久化恢复
        或外部状态注入可能绕过校验，故提供此方法做最终检查。

        Returns:
            错误列表（空列表表示 OK）。每条错误为人类可读字符串。
        """
        errors: list[str] = []

        # 1. 跨 plugin 冲突检测（AC-F2）
        collisions = await self.check_cross_plugin_collision()
        for factory_id, plugin_a, plugin_b in collisions:
            errors.append(
                f"factory_id {factory_id!r} 被 plugin {plugin_a!r} 和 "
                f"{plugin_b!r} 同时注册（跨 plugin ownership 冲突，AC-F2）"
            )

        # 2. 未声明 factory 检测（AC-F4）
        async with self._lock:
            for reg in self._factories.values():
                if reg.factory_id not in self._whitelist:
                    errors.append(
                        f"factory_id {reg.factory_id!r} "
                        f"(plugin={reg.plugin_id!r}) 未在白名单中声明"
                        f"（AC-F4）"
                    )

        return errors

    async def check_cross_plugin_collision(
        self,
    ) -> list[tuple[str, str, str]]:
        """检测跨 plugin 同名 factory 冲突 — AC-F2.

        扫描已注册的 factories，找出被多个 plugin 注册的同名 factory_id。

        Returns:
            ``(factory_id, plugin_a, plugin_b)`` 元组列表。
            每对冲突的 plugin 生成一个元组（plugin_a < plugin_b 保证输出确定性）。
        """
        # factory_id -> set of plugin_ids
        factory_to_plugins: dict[str, set[str]] = {}
        async with self._lock:
            for plugin_id, factory_id in self._factories.keys():
                factory_to_plugins.setdefault(factory_id, set()).add(plugin_id)

        collisions: list[tuple[str, str, str]] = []
        for factory_id, plugins in factory_to_plugins.items():
            if len(plugins) > 1:
                # 排序保证输出确定性
                sorted_plugins = sorted(plugins)
                for i in range(len(sorted_plugins)):
                    for j in range(i + 1, len(sorted_plugins)):
                        collisions.append(
                            (factory_id, sorted_plugins[i], sorted_plugins[j])
                        )
        return collisions

    # ── 内部辅助 ──────────────────────────────────────────────────

    def _read_text_sync(self, file_path: Path) -> str:
        """同步读取文件文本（供 asyncio.to_thread 包装）.

        铁律 6：async I/O 的同步部分拆分到此方法，由 asyncio.to_thread 包装。
        """
        with open(file_path, encoding="utf-8") as f:
            return f.read()


__all__ = [
    "ScheduleType",
    "FactoryRegistration",
    "RuntimeTaskId",
    "ScheduleFactoryRegistry",
]
