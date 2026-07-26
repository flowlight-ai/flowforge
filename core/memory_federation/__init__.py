"""FlowForge MemoryFederation 模块 — 多域记忆联邦。

实现 roleagent.md §4 "团队记忆：从 grep 到多域知识联邦"：
    - L4 Collection: 记忆集合（collection.py）
    - 三检索入口: grep / 语义 / 索引（retrieval_entries.py）
    - 治理三要素: 权威 / 消费 / 衰减（governance.py）
    - 消费加权排序（consumption_weighted.py）
    - L5 MindCodex: MindCodex可检索知识库（mind_codex.py）

设计依据：
    - roleagent.md §4（多域记忆联邦六层架构）
    - F014-F017 + F039 features
    - 铁律 4：禁止直接操作数据库（所有持久化通过 backend 抽象层）
    - 铁律 5：禁止硬编码路径/密钥（参数全部 DI 注入）
    - 命名 v7.0：使用 memory_federation 避免与现有 memory/ 目录冲突

公开 API:
    - MemoryCollection / MemoryEntry / CollectionManager
    - RetrievalEntryType / RetrievalRequest / RetrievalResult
    - GrepEntry / SemanticEntry / IndexEntry / RetrievalCoordinator
    - MemoryGovernance / GovernanceConfig
    - ConsumptionWeightedRanker / RecencyFactor
    - MindCodexEntry / MindCodex

License: MIT
"""

from __future__ import annotations

from flowforge.core.memory_federation.collection import (
    CollectionManager,
    MemoryCollection,
    MemoryEntry,
)
from flowforge.core.memory_federation.consumption_weighted import (
    ConsumptionWeightedRanker,
    RecencyFactor,
)
from flowforge.core.memory_federation.governance import (
    GovernanceConfig,
    MemoryGovernance,
)
from flowforge.core.memory_federation.mind_codex import (
    MindCodex,
    MindCodexEntry,
)
from flowforge.core.memory_federation.retrieval_entries import (
    GrepEntry,
    IndexEntry,
    RetrievalCoordinator,
    RetrievalEntryType,
    RetrievalRequest,
    RetrievalResult,
    SemanticEntry,
)

__all__ = [
    # Collection
    "MemoryCollection",
    "MemoryEntry",
    "CollectionManager",
    # Retrieval
    "RetrievalEntryType",
    "RetrievalRequest",
    "RetrievalResult",
    "GrepEntry",
    "SemanticEntry",
    "IndexEntry",
    "RetrievalCoordinator",
    # Governance
    "MemoryGovernance",
    "GovernanceConfig",
    # Ranking
    "ConsumptionWeightedRanker",
    "RecencyFactor",
    # MindCodex
    "MindCodex",
    "MindCodexEntry",
]

__version__ = "0.1.0"
