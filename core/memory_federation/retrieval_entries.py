"""Three Retrieval Entry — 三检索入口。

实现 roleagent.md §4.2 三个检索入口：
    1. GrepEntry: 精确字符串搜索（ripgrep 风格，零幻觉，优先使用）
    2. SemanticEntry: 语义向量搜索（embedding 相似度，适合"类似的设计模式"）
    3. IndexEntry: 结构化字段搜索（倒排索引，按 tag/source 精确匹配）
    + RetrievalCoordinator: 根据 entry_type 路由到对应入口

设计依据：
    - F015-three-retrieval-entry.md
    - roleagent.md §4.1 "为什么 RAG 输给 grep"
    - roleagent.md §4.5 "简单系统 + 聪明 agent"

核心设计理念（roleagent.md §4.1）：
    - grep 简单、可预测、零幻觉——应优先使用
    - RAG 复杂、不可预测、易幻觉——仅在语义场景使用
    - 不要把复杂度压到检索系统，复杂度交给 agent

铁律遵守：
    - 铁律 3：通过构造函数注入 CollectionManager / embedding_fn
    - 编程红线 9：使用组合（三个 Entry 类 + Coordinator）而非继承

License: MIT
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field

from flowforge.core.memory_federation.collection import (
    MemoryCollection,
    MemoryEntry,
)
from flowforge.core.tracing import TraceLogger, get_logger

logger = get_logger("memory_federation.retrieval")


# ──────────────────────────────────────────────────────────────────────────────
# 枚举与数据模型
# ──────────────────────────────────────────────────────────────────────────────


class RetrievalEntryType(str, Enum):
    """检索入口类型枚举（roleagent.md §4.2）。

    不同认知模式走不同路：
        - GREP: 精确查找（适合"上次这个 bug 怎么修的"）
        - SEMANTIC: 语义关联（适合"类似的设计模式有哪些"）
        - INDEX: 结构化字段（适合"所有 python_async 标签的记忆"）
    """

    GREP = "grep"
    SEMANTIC = "semantic"
    INDEX = "index"


class RetrievalRequest(BaseModel):
    """检索请求。

    Attributes:
        query: 检索查询。
            - GREP: 子串（区分大小写敏感由 caller 控制，默认大小写敏感）
            - SEMANTIC: 自然语言描述
            - INDEX: 标签名（精确匹配）
        entry_type: 检索入口类型（默认 GREP——简单系统优先）。
        max_results: 最大返回数（默认 10）。
        filters: 过滤条件字典。
            常用键：domain（领域）/ source（来源）/ tags（标签子集）。
    """

    query: str = Field(..., description="检索查询")
    entry_type: RetrievalEntryType = Field(
        default=RetrievalEntryType.GREP, description="检索入口类型"
    )
    max_results: int = Field(
        default=10, gt=0, description="最大返回数"
    )
    filters: dict[str, Any] = Field(
        default_factory=dict, description="过滤条件"
    )


class RetrievalResult(BaseModel):
    """检索结果条目。

    Attributes:
        entry: 命中的 MemoryEntry。
        score: 相关性分数（0.0-1.0，不同入口算法不同）。
            - GREP: 基于匹配密度
            - SEMANTIC: 余弦相似度
            - INDEX: 精确匹配 = 1.0
        source_collection: 来源集合 ID。
    """

    entry: MemoryEntry
    score: float = Field(default=0.0, ge=0.0, le=1.0)
    source_collection: str = Field(
        default="", description="来源集合 ID"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Grep 入口：精确字符串搜索
# ──────────────────────────────────────────────────────────────────────────────


class GrepEntry:
    """Grep 入口——基于子串的精确文本搜索。

    roleagent.md §4.1：grep 简单、可预测、零幻觉，应优先使用。
    适合"上次这个 bug 怎么修的"这类精确查找场景。

    评分策略：基于匹配密度（匹配次数 / 内容长度）归一化到 0.5-1.0。
    """

    def __init__(
        self,
        collections: Optional[list[MemoryCollection]] = None,
        logger: Optional[TraceLogger] = None,
    ) -> None:
        self._collections: list[MemoryCollection] = collections or []
        self._logger: TraceLogger = logger or get_logger(
            "memory_federation.grep"
        )

    def set_collections(
        self, collections: list[MemoryCollection]
    ) -> None:
        """更新可搜索的集合列表。"""
        self._collections = collections

    async def search(
        self, request: RetrievalRequest
    ) -> list[RetrievalResult]:
        """执行 grep 搜索。

        Args:
            request: 检索请求。

        Returns:
            检索结果列表（按分数降序，最多 max_results 条）。
        """
        results: list[RetrievalResult] = []
        query = request.query
        if not query:
            return results

        for collection in self._collections:
            # 应用 domain 过滤
            if "domain" in request.filters:
                if collection.domain != request.filters["domain"]:
                    continue
            for entry in collection.entries:
                # 应用 source 过滤
                if "source" in request.filters:
                    if entry.source != request.filters["source"]:
                        continue
                # 应用 tags 过滤（entry 必须包含所有指定 tag）
                if "tags" in request.filters:
                    required_tags = set(request.filters["tags"])
                    if not required_tags.issubset(set(entry.tags)):
                        continue
                # 子串匹配
                count = entry.content.count(query)
                if count > 0:
                    score = self._compute_score(count, entry.content)
                    results.append(
                        RetrievalResult(
                            entry=entry,
                            score=score,
                            source_collection=collection.collection_id,
                        )
                    )

        results.sort(key=lambda r: r.score, reverse=True)
        return results[: request.max_results]

    @staticmethod
    def _compute_score(match_count: int, content: str) -> float:
        """计算 grep 匹配分数。

        基础分 0.5（命中即得）+ 匹配密度加成（归一化到 0.5-1.0）。
        """
        word_count = max(len(content.split()), 1)
        density = match_count / word_count
        return min(1.0, 0.5 + density * 0.5)


# ──────────────────────────────────────────────────────────────────────────────
# Semantic 入口：语义向量搜索
# ──────────────────────────────────────────────────────────────────────────────


class SemanticEntry:
    """Semantic 入口——基于 embedding 相似度的语义搜索。

    roleagent.md §4.1：语义入口适合"类似的设计模式有哪些"这类问题。
    embedding_fn 通过 DI 注入：
        - 测试场景：注入 mock embedding_fn（如基于词袋的伪向量）
        - 生产场景：注入真实 embedding 服务（如 OpenSieve 的 embedding API）

    无 embedding_fn 时退化为关键词重叠度（fallback，零依赖）。
    """

    def __init__(
        self,
        embedding_fn: Optional[Callable[[str], list[float]]] = None,
        collections: Optional[list[MemoryCollection]] = None,
        logger: Optional[TraceLogger] = None,
    ) -> None:
        self._embedding_fn = embedding_fn
        self._collections: list[MemoryCollection] = collections or []
        self._logger: TraceLogger = logger or get_logger(
            "memory_federation.semantic"
        )

    def set_collections(
        self, collections: list[MemoryCollection]
    ) -> None:
        self._collections = collections

    async def search(
        self, request: RetrievalRequest
    ) -> list[RetrievalResult]:
        """执行语义搜索。

        无 embedding_fn 时退化为关键词重叠度搜索（fallback）。

        Args:
            request: 检索请求。

        Returns:
            检索结果列表（按余弦相似度降序）。
        """
        if self._embedding_fn is None:
            self._logger.warning(
                "No embedding_fn injected, falling back to keyword overlap"
            )
            return await self._keyword_overlap_search(request)

        query_vec = self._embedding_fn(request.query)
        results: list[RetrievalResult] = []
        for collection in self._collections:
            if "domain" in request.filters:
                if collection.domain != request.filters["domain"]:
                    continue
            for entry in collection.entries:
                if "source" in request.filters:
                    if entry.source != request.filters["source"]:
                        continue
                entry_vec = self._embedding_fn(entry.content)
                score = self._cosine_similarity(query_vec, entry_vec)
                # 归一化到 0-1（余弦相似度本就在 [-1, 1]，截断到 [0, 1]）
                score = max(0.0, min(1.0, score))
                results.append(
                    RetrievalResult(
                        entry=entry,
                        score=score,
                        source_collection=collection.collection_id,
                    )
                )

        results.sort(key=lambda r: r.score, reverse=True)
        return results[: request.max_results]

    async def _keyword_overlap_search(
        self, request: RetrievalRequest
    ) -> list[RetrievalResult]:
        """关键词重叠度 fallback（无 embedding_fn 时使用）。

        简单词袋重叠：score = |query_terms ∩ entry_terms| / |query_terms|
        """
        query_terms = set(request.query.lower().split())
        if not query_terms:
            return []
        results: list[RetrievalResult] = []
        for collection in self._collections:
            if "domain" in request.filters:
                if collection.domain != request.filters["domain"]:
                    continue
            for entry in collection.entries:
                if "source" in request.filters:
                    if entry.source != request.filters["source"]:
                        continue
                entry_terms = set(entry.content.lower().split())
                overlap = len(query_terms & entry_terms)
                if overlap == 0:
                    continue
                score = overlap / len(query_terms)
                results.append(
                    RetrievalResult(
                        entry=entry,
                        score=min(1.0, score),
                        source_collection=collection.collection_id,
                    )
                )
        results.sort(key=lambda r: r.score, reverse=True)
        return results[: request.max_results]

    @staticmethod
    def _cosine_similarity(
        a: list[float], b: list[float]
    ) -> float:
        """计算余弦相似度。"""
        if not a or not b or len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(x * x for x in b) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)


# ──────────────────────────────────────────────────────────────────────────────
# Index 入口：结构化字段搜索
# ──────────────────────────────────────────────────────────────────────────────


class IndexEntry:
    """Index 入口——基于倒排索引的结构化字段搜索。

    roleagent.md §4.2：适合按标签 / 来源 / 领域过滤。
    通过 tag 倒排索引实现 O(1) 查找（按 tag 精确匹配）。

    排序策略：索引精确匹配 = 满分 1.0，按 consumption_count 降序
    （消费信号优先——被消费多的记忆优先返回）。
    """

    def __init__(
        self,
        collections: Optional[list[MemoryCollection]] = None,
        logger: Optional[TraceLogger] = None,
    ) -> None:
        self._collections: list[MemoryCollection] = collections or []
        self._logger: TraceLogger = logger or get_logger(
            "memory_federation.index"
        )
        self._tag_index: dict[str, list[tuple[str, MemoryEntry]]] = {}
        self._rebuild_index()

    def set_collections(
        self, collections: list[MemoryCollection]
    ) -> None:
        """更新集合并重建倒排索引。"""
        self._collections = collections
        self._rebuild_index()

    def _rebuild_index(self) -> None:
        """重建 tag 倒排索引。

        索引结构：{tag: [(collection_id, entry), ...]}
        每次集合更新后重建（简单实现，适合中小规模）。
        """
        self._tag_index.clear()
        for collection in self._collections:
            for entry in collection.entries:
                for tag in entry.tags:
                    self._tag_index.setdefault(tag, []).append(
                        (collection.collection_id, entry)
                    )
        self._logger.debug(
            f"Rebuilt tag index: {len(self._tag_index)} tags, "
            f"{sum(len(v) for v in self._tag_index.values())} entries"
        )

    async def search(
        self, request: RetrievalRequest
    ) -> list[RetrievalResult]:
        """执行索引搜索（按 tag 精确匹配）。

        Args:
            request: 检索请求。query 字段为要匹配的 tag 名。

        Returns:
            检索结果列表（按 consumption_count 降序）。
        """
        tag = request.query
        candidates = self._tag_index.get(tag, [])
        results: list[RetrievalResult] = []
        for collection_id, entry in candidates:
            # 应用 source 过滤
            if "source" in request.filters:
                if entry.source != request.filters["source"]:
                    continue
            results.append(
                RetrievalResult(
                    entry=entry,
                    score=1.0,  # 索引精确匹配 = 满分
                    source_collection=collection_id,
                )
            )
        # 索引精确匹配按 consumption_count 排序（消费信号优先）
        results.sort(
            key=lambda r: r.entry.consumption_count, reverse=True
        )
        return results[: request.max_results]


# ──────────────────────────────────────────────────────────────────────────────
# RetrievalCoordinator: 路由到对应入口
# ──────────────────────────────────────────────────────────────────────────────


class RetrievalCoordinator:
    """检索协调器——根据 entry_type 路由到对应入口。

    roleagent.md §4.5：简单系统 + 聪明 agent。
    Coordinator 只负责路由，不做复杂融合（避免把复杂度压到检索系统）。

    使用方式：
        1. 构造时注入三个 Entry（或使用默认）
        2. 调用 update_collections() 同步集合视图
        3. 调用 retrieve(request) 路由到对应入口

    Args:
        grep_entry: GrepEntry 实例（可选，缺省时懒构造）。
        semantic_entry: SemanticEntry 实例（可选）。
        index_entry: IndexEntry 实例（可选）。
        logger: TraceLogger 实例。
    """

    def __init__(
        self,
        grep_entry: Optional[GrepEntry] = None,
        semantic_entry: Optional[SemanticEntry] = None,
        index_entry: Optional[IndexEntry] = None,
        logger: Optional[TraceLogger] = None,
    ) -> None:
        self._logger: TraceLogger = logger or get_logger(
            "memory_federation.coordinator"
        )
        self._grep: GrepEntry = grep_entry or GrepEntry(logger=self._logger)
        self._semantic: SemanticEntry = semantic_entry or SemanticEntry(
            logger=self._logger
        )
        self._index: IndexEntry = index_entry or IndexEntry(
            logger=self._logger
        )

    def update_collections(
        self, collections: list[MemoryCollection]
    ) -> None:
        """同步更新所有入口的集合视图。

        Args:
            collections: 当前可搜索的集合列表。
        """
        self._grep.set_collections(collections)
        self._semantic.set_collections(collections)
        self._index.set_collections(collections)
        self._logger.debug(
            f"Updated collections for all entries: {len(collections)} collections"
        )

    async def retrieve(
        self, request: RetrievalRequest
    ) -> list[RetrievalResult]:
        """根据 entry_type 路由到对应入口执行检索。

        Args:
            request: 检索请求。

        Returns:
            检索结果列表（按分数降序）。
        """
        if request.entry_type == RetrievalEntryType.GREP:
            self._logger.debug(
                f"Routing to grep entry: query='{request.query}'"
            )
            return await self._grep.search(request)
        elif request.entry_type == RetrievalEntryType.SEMANTIC:
            self._logger.debug(
                f"Routing to semantic entry: query='{request.query}'"
            )
            return await self._semantic.search(request)
        elif request.entry_type == RetrievalEntryType.INDEX:
            self._logger.debug(
                f"Routing to index entry: query='{request.query}'"
            )
            return await self._index.search(request)
        else:
            # 理论不可达（Enum 已约束），防御性 fallback 到 grep
            self._logger.error(
                f"Unknown entry_type: {request.entry_type}, fallback to grep"
            )
            return await self._grep.search(request)
