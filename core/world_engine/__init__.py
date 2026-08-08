"""世界引擎（World Engine）— F093 三层架构。

FlowForge v7.0 Forge Nurturing体系的世界引擎，对应 F093 三层架构补审 7 项
（CL-007~CL-013）。

三层架构:
    1. **Core Identity Layer（核心身份层）**——Forgekin的不可变身份。
       即使Forgekin演了 1000 次"孙悟空"，核心身份仍是"写作Forgekin"。
       详见 :class:`~flowforge.core.world_engine.core_identity.CoreIdentityLayer`。

    2. **World Layer（世界层）**——Forgekin所在的世界设定。
       9 个一等公民 + 三路记忆（Canon 永久 / Relational 长期 / Session 临时）。
       详见 :class:`~flowforge.core.world_engine.world.WorldLayer`。

    3. **Bridge Layer（桥接层）**——连接 Core Identity 与 World 的协议。
       三协议（Role Mask / Canon Sync / World Driver）+ runtime coordinator。
       详见 :class:`~flowforge.core.world_engine.bridge.BridgeLayer`。

铁律:
    "RP 台词不自动入典"（CL-010）——Role Play 中Forgekin说的话不能自动
    进入 Canon 记忆，必须经过
    :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`
    显式确认（operator 或 Canon Driver 批准）。

详见:
    - [doc:review/review.md#13.2] CL-007~CL-013（F093 世界引擎三层架构补审）
    - [doc:design/naming-contract.md] 12 核心概念命名
    - [doc:features/F093-cats-and-u-world-engine.md] 世界引擎 Feature 规格
"""

from __future__ import annotations

from flowforge.core.world_engine.bridge import BridgeLayer
from flowforge.core.world_engine.canon_memory import (
    CanonMemory,
    CanonMemoryBase,
)
from flowforge.core.world_engine.canon_sync import (
    CanonProposal,
    CanonSyncProtocol,
    CanonSyncProtocolBase,
)
from flowforge.core.world_engine.citizens import (
    Artifact,
    Branch,
    CanonDecision,
    Character,
    Relationship,
    Round,
    Scene,
    Turn,
    World,
)
from flowforge.core.world_engine.coordinator import RuntimeCoordinator
from flowforge.core.world_engine.core_identity import CoreIdentityLayer
from flowforge.core.world_engine.driver import WorldDriver
from flowforge.core.world_engine.relational_memory import (
    RelationalMemory,
    RelationalMemoryBase,
)
from flowforge.core.world_engine.role_mask import RoleMask, RoleMaskLayer
from flowforge.core.world_engine.session_memory import (
    SessionMemory,
    SessionMemoryBase,
)
from flowforge.core.world_engine.world import WorldLayer

__all__ = [
    # 三层架构
    "CoreIdentityLayer",
    "WorldLayer",
    "BridgeLayer",
    # 9 个一等公民
    "World",
    "Character",
    "Scene",
    "CanonDecision",
    "Relationship",
    "Artifact",
    "Round",
    "Branch",
    "Turn",
    # 三路记忆
    "CanonMemory",
    "CanonMemoryBase",
    "RelationalMemory",
    "RelationalMemoryBase",
    "SessionMemory",
    "SessionMemoryBase",
    # Bridge Layer 三协议
    "RoleMask",
    "RoleMaskLayer",
    "CanonSyncProtocol",
    "CanonSyncProtocolBase",
    "CanonProposal",
    "WorldDriver",
    "RuntimeCoordinator",
]
