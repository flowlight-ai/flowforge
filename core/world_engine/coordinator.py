"""运行时协调器（Runtime Coordinator）— 导演。

F093 Bridge Layer 的"导演"角色。Runtime Coordinator 决定：
    - 何时戴面具（进入场景）
    - 何时摘面具（退出场景）
    - 何时入典（提议 Canon）

是 :class:`~flowforge.core.world_engine.core_identity.CoreIdentityLayer`
与 :class:`~flowforge.core.world_engine.world.WorldLayer` 之间的协议协调者。

职责:
    - **场景进出**：``enter_scene`` 戴上 L4/L5 面具；``exit_scene`` 摘下
      L4/L5 面具，防止场景皮肤污染本体能力（CL-011）。
    - **Canon 提议**：``propose_canon`` 委托给
      :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`，
      不直接写入 CanonMemory（CL-010 铁律）。
    - **身份校验**：每次进入场景前，校验 Core Identity 的魂印一致性。

修复的问题:
    - CL-012：v7.0 无 Bridge Layer / runtime coordinator，灵智体直接用
      persona 介入任务，无协议隔离 Core Identity 与 World。本类是"导演"，
      统一协调跨层操作。

详见:
    - [doc:review/review.md#13.2] CL-012（三协议 + runtime coordinator 未设计）
    - [doc:features/F093-cats-and-u-world-engine.md] 世界引擎 Feature 规格
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from flowforge.core.world_engine.citizens import Scene, Turn
from flowforge.core.world_engine.core_identity import CoreIdentityLayer
from flowforge.core.world_engine.role_mask import RoleMask, RoleMaskLayer

if TYPE_CHECKING:
    from flowforge.core.world_engine.bridge import BridgeLayer
    from flowforge.core.world_engine.world import WorldLayer


class RuntimeCoordinator:
    """运行时协调器（Runtime Coordinator）— 导演。

    决定何时戴面具 / 何时摘面具 / 何时入典。是 Core Identity 与 World
    之间的协议协调者。

    使用模式:
        >>> coordinator = RuntimeCoordinator(
        ...     core_identity=identity,
        ...     world=world_layer,
        ...     bridge=bridge_layer,
        ... )
        >>> await coordinator.enter_scene(scene, role_mask)
        >>> # ... 灵智体在场景内 RP ...
        >>> proposal_id = await coordinator.propose_canon(turn)
        >>> await coordinator.exit_scene()

    身份校验:
        每次进入场景前，校验 ``core_identity.soul_imprint_hash`` 与
        ``bridge.role_mask_protocol`` 持有者一致。不一致则拒绝进入场景
        （防止身份冒用）。

    详见:
        - [doc:review/review.md#13.2] CL-012
    """

    def __init__(
        self,
        core_identity: CoreIdentityLayer,
        world: "WorldLayer",
        bridge: "BridgeLayer",
    ) -> None:
        if core_identity is None:
            raise ValueError("core_identity 不能为 None。")
        if world is None:
            raise ValueError("world 不能为 None。")
        if bridge is None:
            raise ValueError("bridge 不能为 None。")

        self._core_identity: CoreIdentityLayer = core_identity
        self._world: "WorldLayer" = world
        self._bridge: "BridgeLayer" = bridge
        # 当前所处场景（None 表示不在场景中）
        self._current_scene: Scene | None = None
        # 当前活跃 RoleMask（由调用方传入，coordinator 持有引用）
        self._active_role_mask: RoleMask | None = None

    @property
    def core_identity(self) -> CoreIdentityLayer:
        """返回核心身份层。"""
        return self._core_identity

    @property
    def current_scene(self) -> Scene | None:
        """返回当前所处场景（None 表示不在场景中）。"""
        return self._current_scene

    @property
    def is_in_scene(self) -> bool:
        """返回是否在场景中。"""
        return self._current_scene is not None

    async def enter_scene(
        self,
        scene: Scene,
        role_mask: RoleMask,
    ) -> None:
        """进入场景（戴上面具）。

        本方法:
            1. 校验 scene 归属当前世界。
            2. 校验 role_mask 持有者与 core_identity 一致。
            3. 设置当前场景 + 活跃 role_mask。

        Args:
            scene: 待进入的场景。
            role_mask: 待戴上的 RoleMask（应已 wear L4/L5 场景层面具）。

        Raises:
            ValueError: 当 scene 不属于当前世界，或 role_mask 持有者与
                core_identity 不一致时。
        """
        if scene.world_id != self._world.world_id:
            raise ValueError(
                f"场景 world_id={scene.world_id!r} 与当前世界 "
                f"world_id={self._world.world_id!r} 不一致，拒绝进入场景。"
            )
        if role_mask.forgekin_id != self._core_identity.forgekin_id:
            raise ValueError(
                f"RoleMask 持有者 {role_mask.forgekin_id!r} 与 CoreIdentity "
                f"{self._core_identity.forgekin_id!r} 不一致，拒绝进入场景"
                "（防止身份冒用）。详见 [doc:review/review.md#13.2] CL-012"
            )
        if self._current_scene is not None:
            raise ValueError(
                f"已在场景 {self._current_scene.scene_id!r} 中，"
                "必须先 exit_scene 再进入新场景。"
            )
        self._current_scene = scene
        self._active_role_mask = role_mask

    async def exit_scene(self) -> dict[RoleMaskLayer, dict[str, Any]]:
        """退出场景（摘下面具）。

        本方法:
            1. 摘下 role_mask 的所有场景相关层（L4 / L5），防止场景皮肤
               污染本体能力（CL-011 铁律）。
            2. 清空当前场景 + 活跃 role_mask。

        Returns:
            被摘下的层 -> 面具内容映射。

        Raises:
            ValueError: 当不在场景中时。
        """
        if self._current_scene is None:
            raise ValueError("当前不在场景中，无法 exit_scene。")
        taken: dict[RoleMaskLayer, dict[str, Any]] = {}
        if self._active_role_mask is not None:
            taken = self._active_role_mask.take_off_scene_layers()
        self._current_scene = None
        self._active_role_mask = None
        return taken

    async def propose_canon(self, turn: Turn) -> str:
        """提议入典（委托给 CanonSyncProtocol）。

        铁律（CL-010）：本方法**不直接写入 CanonMemory**，仅委托给
        :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol.propose_canon`
        创建一个 pending 提案。必须由 operator / canon_driver 调用
        ``confirm_canon`` 确认后才会真正入典。

        Args:
            turn: 待入典的 Turn。

        Returns:
            proposal_id（由 CanonSyncProtocol 生成）。

        Raises:
            ValueError: 当不在场景中时（提议入典必须在场景内进行）。
        """
        if self._current_scene is None:
            raise ValueError(
                "当前不在场景中，无法提议入典。必须先 enter_scene。"
            )
        # 委托给 BridgeLayer 持有的 CanonSyncProtocol
        return await self._bridge.canon_sync_protocol.propose_canon(
            turn=turn,
            proposer=self._core_identity.forgekin_id,
        )

    def describe(self) -> dict[str, Any]:
        """返回协调器状态描述（用于日志 / 调试）。

        Returns:
            描述字典。
        """
        return {
            "forgekin_id": self._core_identity.forgekin_id,
            "world_id": self._world.world_id,
            "is_in_scene": self.is_in_scene,
            "current_scene_id": self._current_scene.scene_id
            if self._current_scene
            else None,
            "role_mask_active": self._active_role_mask is not None,
            "role_mask_layers": list(self._active_role_mask.get_active_mask().keys())
            if self._active_role_mask
            else [],
        }


__all__ = ["RuntimeCoordinator"]
