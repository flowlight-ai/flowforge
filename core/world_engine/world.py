"""世界层（World Layer）— Forgekin所在的世界设定。

F093 三层世界引擎的第二层。World Layer 包含 9 个一等公民 + 三路记忆，
是Forgekin进行 Role Play 的"舞台"。

组成:
    - **9 个一等公民**：World / Character / Scene / CanonDecision /
      Relationship / Artifact / Round / Branch / Turn（见
      :mod:`flowforge.core.world_engine.citizens`）
    - **三路记忆**：
        - :class:`~flowforge.core.world_engine.canon_memory.CanonMemory`
          （永久，世界级真相）
        - :class:`~flowforge.core.world_engine.relational_memory.RelationalMemory`
          （长期，角色间互动）
        - :class:`~flowforge.core.world_engine.session_memory.SessionMemory`
          （临时，单次回合）

与 Core Identity Layer 的隔离:
    World Layer 是"可变的世界"，Core Identity Layer 是"不可变的身份"。
    两者通过 :class:`~flowforge.core.world_engine.bridge.BridgeLayer` 协议
    连接，确保 RP 内容不污染核心身份（CL-007）。

修复的问题:
    - CL-008：v7.0 无 9 个一等公民建模。本类聚合 9 个一等公民 + 三路记忆。
    - CL-009：v7.0 EchoStore 单一记忆库。本类显式区分三路记忆。

详见:
    - [doc:review/review.md#13.2] CL-008 / CL-009
    - [doc:features/F093-cats-and-u-world-engine.md] 世界引擎 Feature 规格
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from flowforge.core.world_engine.canon_memory import CanonMemory
from flowforge.core.world_engine.citizens import (
    Artifact,
    Branch,
    Character,
    Relationship,
    Round,
    Scene,
    Turn,
    World,
)
from flowforge.core.world_engine.relational_memory import RelationalMemory
from flowforge.core.world_engine.session_memory import SessionMemory

if TYPE_CHECKING:
    pass


class WorldLayer:
    """世界层（World Layer）— Forgekin所在的世界设定。

    包含 9 个一等公民 + 三路记忆。一个 WorldLayer 实例对应一个虚拟世界
    （如"西游世界"、"现代办公室"）。

    职责:
        - 持有 :class:`World` 设定（不可变的世界元数据）。
        - 持有三路记忆实例（Canon / Relational / Session）。
        - 提供世界内实体的注册 / 查询接口（Character / Scene / Artifact 等）。
        - **不直接写入 Canon**——Canon 写入必须通过
          :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`。

    与 Bridge Layer 的关系:
        WorldLayer 不直接与 Core Identity Layer 交互。所有跨层操作必须
        经过 :class:`~flowforge.core.world_engine.bridge.BridgeLayer`，
        确保 RP 内容不污染核心身份。

    详见:
        - [doc:review/review.md#13.2] CL-008 / CL-009
    """

    def __init__(
        self,
        world: World,
        canon_memory: CanonMemory,
        relational_memory: RelationalMemory,
        session_memory: SessionMemory,
    ) -> None:
        if world is None:
            raise ValueError("world 不能为 None。")
        if canon_memory is None:
            raise ValueError("canon_memory 不能为 None。")
        if relational_memory is None:
            raise ValueError("relational_memory 不能为 None。")
        if session_memory is None:
            raise ValueError("session_memory 不能为 None。")

        self._world: World = world
        self._canon_memory: CanonMemory = canon_memory
        self._relational_memory: RelationalMemory = relational_memory
        self._session_memory: SessionMemory = session_memory

        # 世界内实体注册表（骨架：内存 dict）
        self._characters: dict[str, Character] = {}
        self._scenes: dict[str, Scene] = {}
        self._artifacts: dict[str, Artifact] = {}
        self._rounds: dict[str, Round] = {}
        self._branches: dict[str, Branch] = {}
        self._relationships: dict[str, Relationship] = {}

    @property
    def world(self) -> World:
        """返回世界设定。"""
        return self._world

    @property
    def world_id(self) -> str:
        """返回世界 ID。"""
        return self._world.world_id

    @property
    def canon_memory(self) -> CanonMemory:
        """返回 Canon 记忆实例。"""
        return self._canon_memory

    @property
    def relational_memory(self) -> RelationalMemory:
        """返回 Relational 记忆实例。"""
        return self._relational_memory

    @property
    def session_memory(self) -> SessionMemory:
        """返回 Session 记忆实例。"""
        return self._session_memory

    # ── 世界内实体注册 ──────────────────────────────────────────

    def register_character(self, character: Character) -> None:
        """注册一个角色到世界。

        Args:
            character: 角色实例。``character.world_id`` 必须与本世界一致。
        """
        if character.world_id != self.world_id:
            raise ValueError(
                f"角色 world_id={character.world_id!r} 与本世界 "
                f"world_id={self.world_id!r} 不一致。"
            )
        self._characters[character.character_id] = character

    def get_character(self, character_id: str) -> Character | None:
        """获取角色。"""
        return self._characters.get(character_id)

    def list_characters(self) -> list[Character]:
        """列出世界中的所有角色。"""
        return list(self._characters.values())

    def register_scene(self, scene: Scene) -> None:
        """注册一个场景到世界。"""
        if scene.world_id != self.world_id:
            raise ValueError(
                f"场景 world_id={scene.world_id!r} 与本世界不一致。"
            )
        self._scenes[scene.scene_id] = scene

    def get_scene(self, scene_id: str) -> Scene | None:
        """获取场景。"""
        return self._scenes.get(scene_id)

    def register_artifact(self, artifact: Artifact) -> None:
        """注册一个造物到世界。"""
        if artifact.world_id != self.world_id:
            raise ValueError(
                f"造物 world_id={artifact.world_id!r} 与本世界不一致。"
            )
        self._artifacts[artifact.artifact_id] = artifact

    def register_round(self, round_: Round) -> None:
        """注册一个回合到世界。"""
        self._rounds[round_.round_id] = round_

    def register_branch(self, branch: Branch) -> None:
        """注册一个分支到世界。"""
        self._branches[branch.branch_id] = branch

    def register_relationship(self, rel: Relationship) -> None:
        """注册一个关系到世界（同时记录到 RelationalMemory）。"""
        self._relationships[rel.relationship_id] = rel

    async def add_turn(self, turn: Turn) -> None:
        """添加一个 Turn 到 SessionMemory。

        铁律（CL-010）：本方法**只写入 SessionMemory**，不写入 CanonMemory。
        若要把 Turn 入典，必须通过
        :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`。

        Args:
            turn: 待添加的 Turn。
        """
        await self._session_memory.add_turn(turn)

    def describe(self) -> dict[str, Any]:
        """返回世界层描述（用于日志 / UI）。

        Returns:
            描述字典。
        """
        return {
            "world": self._world.model_dump(),
            "character_count": len(self._characters),
            "scene_count": len(self._scenes),
            "artifact_count": len(self._artifacts),
            "round_count": len(self._rounds),
            "branch_count": len(self._branches),
            "relationship_count": len(self._relationships),
            "layer": "world",
        }


__all__ = ["WorldLayer"]
