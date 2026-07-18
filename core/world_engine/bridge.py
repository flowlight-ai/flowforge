"""桥接层（Bridge Layer）— 连接 Core Identity 与 World 的协议。

F093 三层世界引擎的第三层。Bridge Layer 是"协议层"，不持有业务状态，仅
通过三协议 + runtime coordinator 协调 Core Identity Layer 与 World Layer
的交互。

三协议（CL-012）:
    - **Role Mask Protocol**：角色面具协议（
      :class:`~flowforge.core.world_engine.role_mask.RoleMask`）——
      五层分类，防止 L4 场景皮肤污染 L3 本体能力。
    - **Canon Sync Protocol**：典藏同步协议（
      :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`）——
      铁律"RP 台词不自动入典"。
    - **World Driver Protocol**：世界驱动协议（
      :class:`~flowforge.core.world_engine.driver.WorldDriver`）——
      世界自转 + Canon 写入权限控制。

runtime coordinator:
    :class:`~flowforge.core.world_engine.coordinator.RuntimeCoordinator`
    是"导演"，决定何时戴面具 / 何时摘面具 / 何时入典。

修复的问题:
    - CL-012：v7.0 无 Bridge Layer 概念，灵智体直接用 persona 介入任务，
      无协议隔离 Core Identity 与 World。本类是三协议 + coordinator 的
      聚合容器。

铁律:
    Bridge Layer 是 Core Identity 与 World 之间的**唯一通道**。任何跨层
    操作（戴面具 / 入典 / 世界自转）必须经过 Bridge Layer，禁止 Core
    Identity 直接操作 World，也禁止 World 直接修改 Core Identity。

详见:
    - [doc:review/review.md#13.2] CL-012（三协议 + runtime coordinator 未设计）
    - [doc:features/F093-cats-and-u-world-engine.md] 世界引擎 Feature 规格
"""

from __future__ import annotations

from typing import Any

from flowforge.core.world_engine.canon_sync import CanonSyncProtocol
from flowforge.core.world_engine.coordinator import RuntimeCoordinator
from flowforge.core.world_engine.driver import WorldDriver
from flowforge.core.world_engine.role_mask import RoleMask


class BridgeLayer:
    """桥接层（Bridge Layer）— 连接 Core Identity 与 World 的协议。

    三协议：Role Mask Protocol / Canon Sync Protocol / World Driver Protocol
    + runtime coordinator（运行时协调器）。

    职责:
        - 持有三协议实例（RoleMask / CanonSyncProtocol / WorldDriver）。
        - 持有 runtime coordinator（RuntimeCoordinator）。
        - 提供"跨层操作"的统一入口，禁止 Core Identity 与 World 直接交互。

    使用模式:
        >>> bridge = BridgeLayer(
        ...     role_mask_protocol=role_mask,
        ...     canon_sync_protocol=canon_sync,
        ...     world_driver=driver,
        ...     coordinator=coordinator,
        ... )
        >>> await coordinator.enter_scene(scene, role_mask)
        >>> proposal_id = await coordinator.propose_canon(turn)

    铁律:
        Bridge Layer 是 Core Identity 与 World 之间的**唯一通道**。

    详见:
        - [doc:review/review.md#13.2] CL-012
    """

    def __init__(
        self,
        role_mask_protocol: RoleMask,
        canon_sync_protocol: CanonSyncProtocol,
        world_driver: WorldDriver,
        coordinator: RuntimeCoordinator,
    ) -> None:
        if role_mask_protocol is None:
            raise ValueError("role_mask_protocol 不能为 None。")
        if canon_sync_protocol is None:
            raise ValueError("canon_sync_protocol 不能为 None。")
        if world_driver is None:
            raise ValueError("world_driver 不能为 None。")
        if coordinator is None:
            raise ValueError("coordinator 不能为 None。")

        self._role_mask_protocol: RoleMask = role_mask_protocol
        self._canon_sync_protocol: CanonSyncProtocol = canon_sync_protocol
        self._world_driver: WorldDriver = world_driver
        self._coordinator: RuntimeCoordinator = coordinator

    @property
    def role_mask_protocol(self) -> RoleMask:
        """返回 Role Mask 协议实例。"""
        return self._role_mask_protocol

    @property
    def canon_sync_protocol(self) -> CanonSyncProtocol:
        """返回 Canon Sync 协议实例。"""
        return self._canon_sync_protocol

    @property
    def world_driver(self) -> WorldDriver:
        """返回 World Driver 协议实例。"""
        return self._world_driver

    @property
    def coordinator(self) -> RuntimeCoordinator:
        """返回 runtime coordinator 实例。"""
        return self._coordinator

    def describe(self) -> dict[str, Any]:
        """返回桥接层描述（用于日志 / 调试）。

        Returns:
            描述字典。
        """
        return {
            "layer": "bridge",
            "protocols": [
                "role_mask",
                "canon_sync",
                "world_driver",
            ],
            "coordinator": self._coordinator.describe(),
            "role_mask": self._role_mask_protocol.describe(),
            "world_driver_tick_count": self._world_driver.tick_count,
        }


__all__ = ["BridgeLayer"]
