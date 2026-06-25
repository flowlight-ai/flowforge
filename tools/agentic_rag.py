"""Agentic RAG Knowledge Hub — intelligent retrieval with multi-source fusion.

Implements:
- Hybrid retrieval: vector + keyword + graph search
- RRF (Reciprocal Rank Fusion) for result merging
- SimHash deduplication
- Time-decay weighting
- Knowledge accumulation: auto-index published articles
- Query understanding: intent classification + query expansion
"""
import hashlib
import math
import re
from datetime import datetime, timezone
from typing import Optional
from dataclasses import dataclass, field

from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


@dataclass
class RetrievalResult:
    """Single retrieval result."""
    content: str
    source: str
    source_type: str  # "vector", "keyword", "graph"
    score: float = 0.0
    metadata: dict = field(default_factory=dict)
    doc_id: str = ""


class SimHashDeduplicator:
    """SimHash-based near-duplicate detection."""

    def __init__(self, hash_bits: int = 64):
        self._hash_bits = hash_bits
        self._hashes: dict[str, int] = {}

    def _compute_simhash(self, text: str) -> int:
        """Compute SimHash for text."""
        tokens = re.findall(r'\w+', text.lower())
        if not tokens:
            return 0
        v = [0] * self._hash_bits
        for token in tokens:
            token_hash = int(hashlib.md5(token.encode()).hexdigest(), 16)
            for i in range(self._hash_bits):
                if token_hash & (1 << i):
                    v[i] += 1
                else:
                    v[i] -= 1
        fingerprint = 0
        for i in range(self._hash_bits):
            if v[i] >= 0:
                fingerprint |= (1 << i)
        return fingerprint

    def hamming_distance(self, h1: int, h2: int) -> int:
        x = h1 ^ h2
        count = 0
        while x:
            count += 1
            x &= x - 1
        return count

    def is_duplicate(self, doc_id: str, text: str, threshold: int = 3) -> bool:
        """Check if document is near-duplicate of existing documents."""
        new_hash = self._compute_simhash(text)
        for existing_id, existing_hash in self._hashes.items():
            if self.hamming_distance(new_hash, existing_hash) <= threshold:
                return True
        self._hashes[doc_id] = new_hash
        return False


class RRFFusion:
    """Reciprocal Rank Fusion for merging multi-source results."""

    def __init__(self, k: int = 60):
        self._k = k  # RRF constant

    def fuse(self, result_lists: list[list[RetrievalResult]]) -> list[RetrievalResult]:
        """Merge multiple ranked result lists using RRF."""
        scores: dict[str, float] = {}
        results: dict[str, RetrievalResult] = {}

        for result_list in result_lists:
            for rank, result in enumerate(result_list):
                doc_id = result.doc_id or hashlib.md5(result.content.encode()).hexdigest()[:16]
                rrf_score = 1.0 / (self._k + rank + 1)
                scores[doc_id] = scores.get(doc_id, 0.0) + rrf_score
                if doc_id not in results:
                    results[doc_id] = result

        # Sort by fused score
        sorted_ids = sorted(scores.keys(), key=lambda x: scores[x], reverse=True)
        fused_results = []
        for doc_id in sorted_ids:
            result = results[doc_id]
            result.score = scores[doc_id]
            fused_results.append(result)

        return fused_results


class TimeDecayWeighter:
    """Apply time-decay weighting to retrieval results."""

    def __init__(self, half_life_days: float = 30.0):
        self._half_life = half_life_days
        self._decay_constant = math.log(2) / half_life_days

    def weight(self, results: list[RetrievalResult]) -> list[RetrievalResult]:
        """Apply time-decay weighting to results."""
        now = datetime.now(timezone.utc)
        for result in results:
            published_at = result.metadata.get("published_at")
            if published_at:
                try:
                    if isinstance(published_at, str):
                        pub_date = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
                    else:
                        pub_date = published_at
                    age_days = (now - pub_date).total_seconds() / 86400
                    decay = math.exp(-self._decay_constant * age_days)
                    result.score *= decay
                except (ValueError, TypeError):
                    pass
        return results


class QueryUnderstanding:
    """Query understanding: intent classification + query expansion."""

    INTENT_KEYWORDS = {
        "factual": ["是什么", "什么是", "定义", "多少", "which", "what", "how many"],
        "analytical": ["为什么", "原因", "分析", "影响", "why", "analysis", "impact"],
        "procedural": ["怎么做", "如何", "步骤", "方法", "how to", "steps"],
        "comparative": ["对比", "比较", "区别", "vs", "compare", "difference"],
    }

    def classify_intent(self, query: str) -> str:
        """Classify query intent."""
        query_lower = query.lower()
        scores = {}
        for intent, keywords in self.INTENT_KEYWORDS.items():
            scores[intent] = sum(1 for kw in keywords if kw in query_lower)
        best = max(scores, key=scores.get)
        return best if scores[best] > 0 else "factual"

    def expand_query(self, query: str, intent: str) -> list[str]:
        """Expand query with related terms."""
        expansions = [query]
        if intent == "factual":
            expansions.append(f"{query} 定义")
            expansions.append(f"{query} 最新数据")
        elif intent == "analytical":
            expansions.append(f"{query} 深度分析")
            expansions.append(f"{query} 行业报告")
        elif intent == "comparative":
            expansions.append(f"{query} 对比分析")
        return expansions


class AgenticRAG:
    """Agentic RAG Knowledge Hub — main entry point."""

    def __init__(self, config: Optional[dict] = None):
        self._config = config or {}
        self._deduplicator = SimHashDeduplicator()
        self._fusion = RRFFusion(k=self._config.get("rrf_k", 60))
        self._decay = TimeDecayWeighter(half_life_days=self._config.get("half_life_days", 30))
        self._query_understanding = QueryUnderstanding()
        self._indexed_docs: dict[str, dict] = {}  # Knowledge accumulation
        self._tool_registry = None  # Injected via set_tool_registry

    def set_tool_registry(self, registry) -> None:
        """Set tool registry for dependency injection (search tools)."""
        self._tool_registry = registry

    async def _search_with_tool(self, tool_name: str, query: str) -> list[RetrievalResult]:
        """Try calling a search tool via tool_registry, return results or empty list."""
        if self._tool_registry is None:
            return []
        try:
            result = await self._tool_registry.execute(tool_name, {"query": query})
            items = []
            raw = result.result if hasattr(result, "result") else result
            if isinstance(raw, list):
                for item in raw:
                    if isinstance(item, dict):
                        items.append(RetrievalResult(
                            content=item.get("content", item.get("text", item.get("snippet", ""))),
                            source=item.get("source", item.get("url", tool_name)),
                            source_type=item.get("source_type", "tool"),
                            score=item.get("score", item.get("relevance_score", 0.0)),
                            metadata=item.get("metadata", {}),
                            doc_id=item.get("doc_id", item.get("id", "")),
                        ))
                    elif isinstance(item, str):
                        items.append(RetrievalResult(
                            content=item,
                            source=tool_name,
                            source_type="tool",
                        ))
            return items
        except Exception as e:
            logger.warning(f"Tool {tool_name} search failed for query '{query}': {e}")
            return []

    def _keyword_search_local(self, query: str) -> list[RetrievalResult]:
        """Fallback: keyword matching in the local knowledge base."""
        results = []
        query_terms = set(re.findall(r'\w+', query.lower()))
        for doc_id, doc_data in self._indexed_docs.items():
            content = doc_data.get("content", "")
            content_terms = set(re.findall(r'\w+', content.lower()))
            overlap = len(query_terms & content_terms)
            if overlap > 0:
                score = overlap / max(len(query_terms), 1)
                results.append(RetrievalResult(
                    content=content,
                    source="local_kb",
                    source_type="keyword",
                    score=score,
                    metadata=doc_data.get("metadata", {}),
                    doc_id=doc_id,
                ))
        results.sort(key=lambda r: r.score, reverse=True)
        return results

    async def search(self, query: str, max_results: int = 10) -> list[RetrievalResult]:
        """Intelligent search with multi-source fusion."""
        # Query understanding
        intent = self._query_understanding.classify_intent(query)
        expanded_queries = self._query_understanding.expand_query(query, intent)

        # Multi-source retrieval
        all_results: list[list[RetrievalResult]] = []
        for q in expanded_queries:
            source_results: list[RetrievalResult] = []

            # 1. Try helixrag_search tool
            helixrag_results = await self._search_with_tool("helixrag_search", q)
            source_results.extend(helixrag_results)

            # 2. Try web_search tool
            web_results = await self._search_with_tool("web_search", q)
            source_results.extend(web_results)

            # 3. Fallback: keyword matching in local knowledge base
            if not source_results:
                local_results = self._keyword_search_local(q)
                source_results.extend(local_results)

            if source_results:
                all_results.append(source_results)

        # RRF Fusion
        fused = self._fusion.fuse(all_results) if all_results else []

        # Time decay
        weighted = self._decay.weight(fused)

        # Deduplication
        unique = []
        for result in weighted:
            doc_id = result.doc_id or hashlib.md5(result.content.encode()).hexdigest()[:16]
            if not self._deduplicator.is_duplicate(doc_id, result.content):
                unique.append(result)

        return unique[:max_results]

    def index_document(self, doc_id: str, content: str, metadata: dict = None) -> None:
        """Index a document for knowledge accumulation."""
        self._indexed_docs[doc_id] = {
            "content": content,
            "metadata": metadata or {},
            "indexed_at": datetime.now(timezone.utc).isoformat(),
        }
        logger.info(f"Indexed document: {doc_id}")

    def get_indexed_document(self, doc_id: str) -> Optional[dict]:
        """Retrieve an indexed document."""
        return self._indexed_docs.get(doc_id)
