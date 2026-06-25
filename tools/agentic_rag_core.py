"""AgenticRAG Core — Doubao dual-role: QueryExpander + ContentSynthesizer.

Enhances the existing agentic_rag module with LLM-powered capabilities:
1. QueryExpander: Uses LLM (Doubao) to understand and expand user queries
   - Query rewriting: Rephrase for better retrieval recall
   - Query decomposition: Break complex queries into sub-queries
   - Query expansion: Generate semantically related variations
2. ContentSynthesizer: Uses LLM (Doubao) to synthesize retrieved content
   - Multi-document fusion into coherent output
   - Style injection (academic, casual, news, etc.)
   - Conflict detection and discrepancy noting
3. AgenticRAG: Combined pipeline with multi-source search and dedup

Dependencies:
- Reuses SimHashDeduplicator from agentic_rag for deduplication
- Uses LLMClient (via tool_registry) for all LLM calls — never imports SDK directly
- Follows DI pattern: all external deps injected via constructor or set_tool_registry
"""
import hashlib
import re
from typing import Dict, List, Optional

from flowforge.core.tracing import get_logger

from flowforge.tools.agentic_rag import (
    RetrievalResult,
    RRFFusion,
    SimHashDeduplicator,
    TimeDecayWeighter,
)

logger = get_logger(__name__)


# ── QueryExpander: LLM-powered query understanding and expansion ────────

class QueryExpander:
    """LLM-powered query expander — generates multiple query variations.

    Uses Doubao (via LLMClient) to perform:
    - Query rewriting: Rephrase the original query for better retrieval
    - Query decomposition: Break complex queries into focused sub-queries
    - Query expansion: Generate semantically related search variations

    All LLM calls go through tool_registry.execute("llm", {...}), never
    importing any SDK directly.
    """

    REWRITE_PROMPT = (
        "你是一个专业的搜索查询优化专家。请将以下用户查询改写为3个不同的搜索查询，"
        "使其更适合信息检索。每个改写应侧重不同角度，但保持原始意图不变。\n\n"
        "原始查询: {query}\n\n"
        "上下文信息: {context}\n\n"
        "请以JSON数组格式返回改写后的查询，例如: [\"改写1\", \"改写2\", \"改写3\"]\n"
        "只返回JSON数组，不要其他内容。"
    )

    DECOMPOSE_PROMPT = (
        "你是一个专业的搜索查询分解专家。如果以下查询是复杂查询，"
        "请将其分解为2-4个更简单的子查询，每个子查询聚焦一个方面。\n"
        "如果查询本身足够简单，则返回原始查询即可。\n\n"
        "原始查询: {query}\n\n"
        "请以JSON数组格式返回分解后的子查询，例如: [\"子查询1\", \"子查询2\"]\n"
        "只返回JSON数组，不要其他内容。"
    )

    EXPAND_PROMPT = (
        "你是一个专业的搜索查询扩展专家。请为以下查询生成3个语义相关的扩展查询，"
        "用于提高检索召回率。扩展查询应包含同义词、相关术语或不同表述方式。\n\n"
        "原始查询: {query}\n\n"
        "上下文信息: {context}\n\n"
        "请以JSON数组格式返回扩展查询，例如: [\"扩展1\", \"扩展2\", \"扩展3\"]\n"
        "只返回JSON数组，不要其他内容。"
    )

    def __init__(self, tool_registry=None, model: str = "doubao-pro-32k"):
        self._tool_registry = tool_registry
        self._model = model

    def set_tool_registry(self, registry) -> None:
        """Set tool registry for LLM calls (DI pattern)."""
        self._tool_registry = registry

    async def _call_llm(self, prompt: str) -> str:
        """Call LLM via tool_registry, return response text or empty string."""
        if self._tool_registry is None:
            logger.warning("QueryExpander: tool_registry not set, cannot call LLM")
            return ""
        try:
            result = await self._tool_registry.execute("llm", {
                "messages": [{"role": "user", "content": prompt}],
                "model": self._model,
                "temperature": 0.3,
                "max_tokens": 1000,
            })
            raw = result.result if hasattr(result, "result") else result
            if isinstance(raw, dict):
                return raw.get("content", "")
            return str(raw) if raw else ""
        except Exception as e:
            logger.warning(f"QueryExpander LLM call failed: {e}")
            return ""

    def _parse_json_list(self, text: str) -> List[str]:
        """Parse a JSON array from LLM response text."""
        if not text:
            return []
        # Try to extract JSON array from text
        match = re.search(r'\[.*?\]', text, re.DOTALL)
        if not match:
            return []
        import json
        try:
            items = json.loads(match.group())
            if isinstance(items, list):
                return [str(item).strip() for item in items if str(item).strip()]
        except json.JSONDecodeError:
            pass
        return []

    async def expand(
        self, query: str, context: Optional[Dict] = None
    ) -> List[str]:
        """Expand a query into multiple variations using LLM.

        Steps:
        1. Rewrite: Generate rephrased versions of the query
        2. Decompose: Break complex query into sub-queries
        3. Expand: Generate semantically related variations

        Returns:
            List containing the original query + all expanded variations.
            Always includes the original query as the first element.
        """
        context_str = ""
        if context:
            context_str = ", ".join(
                f"{k}: {v}" for k, v in context.items() if v is not None
            )

        all_variations: List[str] = [query]  # Always start with original

        # Step 1: Rewrite
        rewrite_prompt = self.REWRITE_PROMPT.format(
            query=query, context=context_str or "无"
        )
        rewrite_text = await self._call_llm(rewrite_prompt)
        rewrites = self._parse_json_list(rewrite_text)
        all_variations.extend(rewrites)

        # Step 2: Decompose
        decompose_prompt = self.DECOMPOSE_PROMPT.format(query=query)
        decompose_text = await self._call_llm(decompose_prompt)
        decompositions = self._parse_json_list(decompose_text)
        all_variations.extend(decompositions)

        # Step 3: Expand
        expand_prompt = self.EXPAND_PROMPT.format(
            query=query, context=context_str or "无"
        )
        expand_text = await self._call_llm(expand_prompt)
        expansions = self._parse_json_list(expand_text)
        all_variations.extend(expansions)

        # Deduplicate while preserving order
        seen = set()
        unique: List[str] = []
        for v in all_variations:
            normalized = v.strip().lower()
            if normalized and normalized not in seen:
                seen.add(normalized)
                unique.append(v.strip())

        logger.info(
            f"QueryExpander: '{query[:50]}' → {len(unique)} variations "
            f"(rewrites={len(rewrites)}, decompose={len(decompositions)}, "
            f"expand={len(expansions)})"
        )
        return unique


# ── ContentSynthesizer: LLM-powered content synthesis ───────────────────

class ContentSynthesizer:
    """LLM-powered content synthesizer — fuses retrieved documents into coherent output.

    Uses Doubao (via LLMClient) to:
    - Synthesize multiple retrieved documents into a coherent answer
    - Inject style (academic, casual, news, etc.)
    - Detect and note conflicting information across sources
    """

    SYNTHESIZE_PROMPT = (
        "你是一个专业的内容综合专家。请根据以下检索到的文档，综合回答用户的问题。\n\n"
        "要求:\n"
        "1. 综合所有文档中的相关信息，不要遗漏重要内容\n"
        "2. 如果不同文档之间存在矛盾或冲突，请明确指出并说明差异\n"
        "3. 在回答末尾标注信息来源\n"
        "4. 使用{style}风格撰写\n\n"
        "用户问题: {query}\n\n"
        "检索到的文档:\n{documents}\n\n"
        "请综合以上信息，撰写一个完整、准确的回答。"
    )

    CONFLICT_CHECK_PROMPT = (
        "请检查以下文档之间是否存在事实性矛盾或冲突信息。\n\n"
        "文档:\n{documents}\n\n"
        "如果存在冲突，请以JSON格式列出:\n"
        "[{{\"claim\": \"冲突的观点\", \"source_a\": \"文档A的表述\", \"source_b\": \"文档B的表述\"}}]\n"
        "如果没有冲突，返回空数组 []\n"
        "只返回JSON数组，不要其他内容。"
    )

    STYLE_MAP = {
        "academic": "学术严谨",
        "casual": "轻松通俗",
        "news": "新闻报道",
        "professional": "专业正式",
        "social": "社交媒体",
    }

    def __init__(self, tool_registry=None, model: str = "doubao-pro-32k"):
        self._tool_registry = tool_registry
        self._model = model

    def set_tool_registry(self, registry) -> None:
        """Set tool registry for LLM calls (DI pattern)."""
        self._tool_registry = registry

    async def _call_llm(self, prompt: str) -> str:
        """Call LLM via tool_registry, return response text or empty string."""
        if self._tool_registry is None:
            logger.warning("ContentSynthesizer: tool_registry not set, cannot call LLM")
            return ""
        try:
            result = await self._tool_registry.execute("llm", {
                "messages": [{"role": "user", "content": prompt}],
                "model": self._model,
                "temperature": 0.5,
                "max_tokens": 4000,
            })
            raw = result.result if hasattr(result, "result") else result
            if isinstance(raw, dict):
                return raw.get("content", "")
            return str(raw) if raw else ""
        except Exception as e:
            logger.warning(f"ContentSynthesizer LLM call failed: {e}")
            return ""

    def _format_documents(self, documents: List[Dict]) -> str:
        """Format documents for inclusion in LLM prompt."""
        parts = []
        for i, doc in enumerate(documents, 1):
            content = doc.get("content", doc.get("text", ""))
            source = doc.get("source", doc.get("url", f"来源{i}"))
            parts.append(f"[文档{i}] (来源: {source})\n{content}")
        return "\n\n---\n\n".join(parts)

    async def _check_conflicts(self, documents: List[Dict]) -> List[Dict]:
        """Check for conflicting information across documents.

        Returns list of conflict dicts with claim, source_a, source_b.
        """
        if len(documents) < 2:
            return []

        doc_text = self._format_documents(documents)
        prompt = self.CONFLICT_CHECK_PROMPT.format(documents=doc_text)
        response = await self._call_llm(prompt)

        if not response:
            return []

        import json
        match = re.search(r'\[.*?\]', response, re.DOTALL)
        if not match:
            return []
        try:
            conflicts = json.loads(match.group())
            if isinstance(conflicts, list):
                return [c for c in conflicts if isinstance(c, dict)]
        except json.JSONDecodeError:
            pass
        return []

    async def synthesize(
        self,
        query: str,
        documents: List[Dict],
        style: Optional[str] = None,
    ) -> str:
        """Synthesize multiple retrieved documents into coherent output.

        Args:
            query: The original user query.
            documents: List of document dicts with 'content' and 'source' keys.
            style: Optional style injection (e.g., "academic", "casual", "news").

        Returns:
            Synthesized answer string. If LLM is unavailable, returns a
            basic concatenation of document contents.
        """
        if not documents:
            return ""

        style_label = self.STYLE_MAP.get(style, "专业正式") if style else "专业正式"

        # Check for conflicts first
        conflicts = await self._check_conflicts(documents)
        conflict_note = ""
        if conflicts:
            conflict_parts = []
            for c in conflicts:
                conflict_parts.append(
                    f"- 观点冲突: {c.get('claim', '未知')} "
                    f"(来源A: {c.get('source_a', '')}, "
                    f"来源B: {c.get('source_b', '')})"
                )
            conflict_note = "\n\n⚠️ 信息冲突提示:\n" + "\n".join(conflict_parts)

        # Synthesize
        doc_text = self._format_documents(documents)
        prompt = self.SYNTHESIZE_PROMPT.format(
            query=query,
            documents=doc_text,
            style=style_label,
        )
        synthesized = await self._call_llm(prompt)

        if not synthesized:
            # Fallback: basic concatenation when LLM is unavailable
            logger.warning("ContentSynthesizer: LLM unavailable, using basic concatenation")
            parts = []
            for i, doc in enumerate(documents, 1):
                content = doc.get("content", doc.get("text", ""))
                source = doc.get("source", doc.get("url", f"来源{i}"))
                parts.append(f"[{source}] {content}")
            synthesized = "\n\n---\n\n".join(parts)

        # Append conflict note if any
        if conflict_note:
            synthesized += conflict_note

        logger.info(
            f"ContentSynthesizer: synthesized {len(documents)} docs "
            f"for query '{query[:50]}', style={style}, "
            f"conflicts={len(conflicts)}, output_len={len(synthesized)}"
        )
        return synthesized


# ── AgenticRAG: Combined pipeline ───────────────────────────────────────

class AgenticRAGCore:
    """AgenticRAG with Doubao dual-role — main entry point.

    Pipeline: expand query → multi-source search → deduplicate → synthesize

    Multi-source search strategy:
    1. HelixRAG (primary) — vector + keyword + graph via helixrag_search
    2. web_search (fallback) — web crawl based search
    3. Local cached results — keyword match in indexed docs

    Deduplication: SimHash-based (reuses agentic_rag.SimHashDeduplicator)

    Returns:
        {
            "query": str,
            "expanded_queries": List[str],
            "documents": List[Dict],
            "synthesized_answer": str,
            "sources": List[str],
        }
    """

    def __init__(self, config: Optional[Dict] = None):
        self._config = config or {}
        self._deduplicator = SimHashDeduplicator(
            hash_bits=self._config.get("simhash_bits", 64)
        )
        self._fusion = RRFFusion(k=self._config.get("rrf_k", 60))
        self._decay = TimeDecayWeighter(
            half_life_days=self._config.get("half_life_days", 30)
        )
        self._query_expander = QueryExpander(
            model=self._config.get("expander_model", "doubao-pro-32k")
        )
        self._content_synthesizer = ContentSynthesizer(
            model=self._config.get("synthesizer_model", "doubao-pro-32k")
        )
        self._tool_registry = None
        self._indexed_docs: Dict[str, dict] = {}

    def set_tool_registry(self, registry) -> None:
        """Set tool registry for dependency injection (LLM + search tools)."""
        self._tool_registry = registry
        self._query_expander.set_tool_registry(registry)
        self._content_synthesizer.set_tool_registry(registry)

    async def _search_with_tool(
        self, tool_name: str, query: str
    ) -> List[RetrievalResult]:
        """Try calling a search tool via tool_registry, return results or empty list."""
        if self._tool_registry is None:
            return []
        try:
            result = await self._tool_registry.execute(tool_name, {"query": query})
            items: List[RetrievalResult] = []
            raw = result.result if hasattr(result, "result") else result
            if isinstance(raw, list):
                for item in raw:
                    if isinstance(item, dict):
                        items.append(RetrievalResult(
                            content=item.get(
                                "content", item.get("text", item.get("snippet", ""))
                            ),
                            source=item.get("source", item.get("url", tool_name)),
                            source_type=item.get("source_type", "tool"),
                            score=item.get(
                                "score", item.get("relevance_score", 0.0)
                            ),
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
            logger.warning(f"Tool {tool_name} search failed for '{query[:50]}': {e}")
            return []

    def _keyword_search_local(self, query: str) -> List[RetrievalResult]:
        """Fallback: keyword matching in the local knowledge base."""
        results: List[RetrievalResult] = []
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

    async def search(
        self,
        query: str,
        style: Optional[str] = None,
        max_results: int = 10,
    ) -> Dict:
        """Main entry point — full AgenticRAG pipeline.

        Steps:
        1. Expand query using QueryExpander (LLM-powered)
        2. Multi-source search for each expanded query
        3. RRF fusion of all results
        4. Time-decay weighting
        5. SimHash deduplication
        6. Content synthesis using ContentSynthesizer (LLM-powered)

        Args:
            query: User's original query string.
            style: Optional style for synthesis (academic, casual, news, etc.).
            max_results: Maximum number of documents to return.

        Returns:
            Dict with keys: query, expanded_queries, documents,
            synthesized_answer, sources.
        """
        # Step 1: Expand query
        expanded_queries = await self._query_expander.expand(query)

        # Step 2: Multi-source search
        all_result_lists: List[List[RetrievalResult]] = []
        for q in expanded_queries:
            source_results: List[RetrievalResult] = []

            # 2a. HelixRAG (primary)
            helixrag_results = await self._search_with_tool("helixrag_search", q)
            source_results.extend(helixrag_results)

            # 2b. web_search (fallback)
            web_results = await self._search_with_tool("web_search", q)
            source_results.extend(web_results)

            # 2c. Local cached results (last resort)
            if not source_results:
                local_results = self._keyword_search_local(q)
                source_results.extend(local_results)

            if source_results:
                all_result_lists.append(source_results)

        # Step 3: RRF Fusion
        fused = self._fusion.fuse(all_result_lists) if all_result_lists else []

        # Step 4: Time decay
        weighted = self._decay.weight(fused)

        # Step 5: Deduplication
        unique: List[RetrievalResult] = []
        for result in weighted:
            doc_id = result.doc_id or hashlib.md5(
                result.content.encode()
            ).hexdigest()[:16]
            if not self._deduplicator.is_duplicate(doc_id, result.content):
                unique.append(result)

        top_results = unique[:max_results]

        # Step 6: Content synthesis
        doc_dicts = [
            {
                "content": r.content,
                "source": r.source,
                "source_type": r.source_type,
                "score": r.score,
                "metadata": r.metadata,
            }
            for r in top_results
        ]

        synthesized = await self._content_synthesizer.synthesize(
            query, doc_dicts, style=style
        )

        sources = list({
            r.source for r in top_results if r.source
        })

        result = {
            "query": query,
            "expanded_queries": expanded_queries,
            "documents": doc_dicts,
            "synthesized_answer": synthesized,
            "sources": sources,
        }

        logger.info(
            f"AgenticRAGCore: query='{query[:50]}' "
            f"expanded={len(expanded_queries)} "
            f"docs={len(doc_dicts)} "
            f"sources={len(sources)} "
            f"answer_len={len(synthesized)}"
        )

        return result

    def index_document(
        self, doc_id: str, content: str, metadata: Optional[Dict] = None
    ) -> None:
        """Index a document for knowledge accumulation."""
        self._indexed_docs[doc_id] = {
            "content": content,
            "metadata": metadata or {},
        }
        logger.info(f"AgenticRAGCore: indexed document {doc_id}")

    def get_indexed_document(self, doc_id: str) -> Optional[Dict]:
        """Retrieve an indexed document."""
        return self._indexed_docs.get(doc_id)
