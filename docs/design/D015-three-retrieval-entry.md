# D015: 三检索入口 详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者灵智体（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.4]（FR-CORE-004）
> **对应 arch.md**: [doc:../arch.md#§3.4]
> **对应 design.md**: [doc:../design.md#§3.4]
> **对应 Feature**: [doc:../features/F015-three-retrieval-entry.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A015-three-retrieval-entry.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/008-memory-federation.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 详细设计上下文

### 1.1 设计问题

A015 架构设计已确定三检索入口（grep / semantic / index）并行调度 + RRF 融合 + authority_floor 前置过滤的协议。本详细设计下沉到代码层，需解决以下子问题：

1. **三入口并行调度的具体编排**：`asyncio.gather` 与 `asyncio.gather(return_exceptions=True)` 的选择，单入口失败时是否影响整体。
2. **ripgrep 子进程调用的封装**：subprocess 的超时控制、大输出截断、错误码映射。
3. **OpenSieve SDK 调用的具体接口契约**：URL、请求体、响应解析、错误码归一化。
4. **sqlite_fts 索引同步**：何时写入 fts 索引，与 CollectionEntry 写入的事务边界。
5. **RRF 算法的工程实现**：`k=60` 从配置加载，相同 entry_id 在多个入口命中时分数合并。
6. **authority_floor 过滤的执行时机**：在 RRF 融合之前对每个入口结果独立过滤，避免低权威命中干扰排名。
7. **查询扩展禁令的代码层强约束**：静态扫描如何检测引擎内的 LLM 调用 / regex 扩展。

### 1.2 设计约束

- **单向依赖约束**：`flowforge/core/memory/retrieval/` 依赖 F014 Collection 层与 OpenSieve，禁止被 F014 反向依赖，禁止 import F016/F017/F020/F039/F040。
- **域隔离约束**：三入口均必须强制 `collections` 参数，无此参数的查询在入口处拒绝。
- **配置驱动约束**：grep/semantic/index 三引擎的具体实现路径（ripgrep 二进制路径、OpenSieve URL、sqlite_fts 表名）外置 YAML。
- **OpenSieve 约束**：semantic 入口的非结构化检索走 OpenSieve 聚合检索中台，不另起向量服务。
- **简单系统约束**：roleagent.md 第 4 章要求"查询扩展由 agent 做，不在引擎里加 regex/小模型"——本设计禁止在检索引擎内做任何 LLM 调用或 regex 扩展。
- **异步约束**：所有 I/O 操作使用 `async/await`；subprocess 调用使用 `asyncio.create_subprocess_exec`。
- **超时约束**：单入口超时 1s，整体检索超时 2s（并行 + RRF）。

### 1.3 设计影响

- **对 F014 Collection 层**：三入口在调用前必须向 CollectionRegistry 校验 collection_ids 是否跨域。本设计需缓存 `collection_id → type` 映射以降低查询延迟。
- **对 F016 治理层**：authority_floor 过滤先于 RRF 融合，过滤后的结果交 F016 治理层做权威排序。
- **对 F017 消费排序**：RRF 融合后的 RetrievalHit 列表是 F017 的输入。本设计需保证 `RetrievalHit.entry_id` 与 F014 对齐。
- **对 F020 归因矩阵**：grep 入口为"轨迹检索"提供工具支撑，归因器可通过 grep 检索历史失败 Episode。
- **对 F039 锻典可检索**：Mind Codex 通过 index 入口按 trigger 字段精确查询锻典条目。
- **对 F040 控制面**：每次检索的 elapsed_ms 与 hit_count 信号写入 F040 Eval Hub。
- **对 OpenSieve 服务**：semantic 入口的批量调用模式，需考虑 OpenSieve 的限流（默认 100 QPS）。
- **对系统依赖**：需安装 ripgrep 二进制（`rg` 命令），通过 `config/system.yaml` 声明路径。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌────────────────────────────────────────────────────────────────────────┐
│                    <<module>> retrieval                                 │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  <<enum>> RetrievalEntryType         <<model>> RetrievalQuery           │
│  + GREP                              + query_id: str                     │
│  + SEMANTIC                          + entry_type: RetrievalEntryType    │
│  + INDEX                             + pattern: str [min_length=1]       │
│                                      + collections: list[str] [≥1]      │
│  <<model>> RetrievalHit              + authority_floor: int [1..5]       │
│  + entry_id: str                     + include_deprecated: bool         │
│  + collection_id: str                + max_results: int [1..200]         │
│  + score: float                                                         │
│  + rank: int                        <<model>> RetrievalResult           │
│  + matched_by: RetrievalEntryType   + query_id: str                     │
│  + payload_excerpt: str              + entry_type: RetrievalEntryType   │
│                                      + hits: list[RetrievalHit]          │
│  <<interface>> RetrievalEntry        + elapsed_ms: int                    │
│  + search(query): RetrievalResult                                       │
│                                                                        │
│  <<interface>> GrepEntry            <<interface>> SemanticEntry          │
│  (ripgrep subprocess)               (OpenSieve SDK)                       │
│                                                                        │
│  <<interface>> IndexEntry           <<interface>> RRFCombiner             │
│  (sqlite_fts)                       + fuse(results, k): list[Hit]        │
│                                                                        │
│  <<interface>> RetrievalFusion                                           │
│  + search(query): list[RetrievalHit]                                     │
│  + cross_domain_check(ids): void                                         │
│                                                                        │
│  <<model>> RetrievalConfig                                              │
│  + rrf_k: int = 60                                                       │
│  + entry_timeout_ms: int = 1000                                         │
│  + fusion_timeout_ms: int = 2000                                         │
│  + ripgrep_path: str                                                     │
│  + opensieve_url: str                                                    │
│  + fts_table_name: str                                                   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/core/memory/retrieval/fusion.py
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class RetrievalEntryType(str, Enum):
    GREP = "grep"
    SEMANTIC = "semantic"
    INDEX = "index"


class RetrievalQuery(BaseModel):
    query_id: str = Field(min_length=1)
    entry_type: RetrievalEntryType
    pattern: str = Field(min_length=1)
    collections: list[str] = Field(min_length=1)  # 必须非空
    authority_floor: int = Field(default=1, ge=1, le=5)
    include_deprecated: bool = False
    max_results: int = Field(default=20, ge=1, le=200)


class RetrievalHit(BaseModel):
    entry_id: str
    collection_id: str
    score: float
    rank: int = Field(ge=1)
    matched_by: RetrievalEntryType
    payload_excerpt: str = Field(max_length=500)


class RetrievalResult(BaseModel):
    query_id: str
    entry_type: RetrievalEntryType
    hits: list[RetrievalHit]
    elapsed_ms: int = Field(ge=0)


class CrossDomainJoinForbidden(Exception):
    """跨域查询在 RetrievalFusion 入口层被拒绝"""
    def __init__(self, collection_ids: list[str]):
        self.collection_ids = collection_ids
        super().__init__(f"Cross-domain join forbidden: {collection_ids}")


class EmptyCollectionsError(ValueError):
    """collections 参数为空"""
    pass


class RetrievalTimeoutError(Exception):
    """检索超时"""
    def __init__(self, entry_type: RetrievalEntryType, timeout_ms: int):
        self.entry_type = entry_type
        self.timeout_ms = timeout_ms
        super().__init__(
            f"Retrieval timeout: {entry_type.value} exceeded {timeout_ms}ms"
        )


class RetrievalEntry(ABC):
    """三入口统一抽象"""

    @abstractmethod
    async def search(self, query: RetrievalQuery) -> RetrievalResult:
        """单入口检索；必须先校验 collections 非空与 authority_floor 范围"""


class RRFCombiner(ABC):
    """RRF 融合算法"""

    @abstractmethod
    def fuse(
        self,
        results: list[RetrievalResult],
        k: int = 60,
    ) -> list[RetrievalHit]:
        """
        RRF 公式：score = sum(1 / (k + rank_i))  for each result list i
        相同 entry_id 在多入口命中时分数累加
        k 默认 60，从配置加载
        """


class RetrievalFusion(ABC):
    """三入口调度器 + RRF 融合器"""

    @abstractmethod
    async def search(
        self,
        query: RetrievalQuery,
        enable_entries: Optional[list[RetrievalEntryType]] = None,
    ) -> list[RetrievalHit]:
        """
        1. 校验 collections 参数（域隔离）
        2. 并行调度三入口（默认全开，可由 enable_entries 关闭部分）
        3. authority_floor 过滤（每入口独立）
        4. RRF 融合
        5. 返回 RetrievalHit 列表（交 F017 重排）
        """

    @abstractmethod
    async def cross_domain_check(self, collection_ids: list[str]) -> None:
        """跨域校验；调用 F014 CollectionRegistry"""
```

### 2.3 数据结构 Pydantic Models

```python
# flowforge/core/memory/retrieval/models.py
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field
from .fusion import RetrievalEntryType


class RetrievalConfig(BaseModel):
    """YAML 配置加载结果"""
    rrf_k: int = Field(default=60, ge=1)
    entry_timeout_ms: int = Field(default=1000, ge=100)
    fusion_timeout_ms: int = Field(default=2000, ge=500)
    ripgrep_path: str = "rg"
    opensieve_url: str = "http://localhost:8100"
    opensieve_timeout_ms: int = Field(default=800, ge=100)
    fts_table_name: str = "collection_entries_fts"
    max_excerpt_length: int = Field(default=500, ge=50)
    forbidden_llm_in_engine: bool = True  # 引擎内禁 LLM 调用
    forbidden_regex_expansion: bool = True  # 引擎内禁 regex 查询扩展
    default_authority_floor: int = Field(default=1, ge=1, le=5)


class GrepSearchRequest(BaseModel):
    """ripgrep 调用请求"""
    pattern: str = Field(min_length=1)
    search_paths: list[str] = Field(min_length=1)
    max_matches: int = Field(default=50, ge=1, le=500)
    case_sensitive: bool = False
    include_globs: list[str] = Field(default_factory=list)


class SemanticSearchRequest(BaseModel):
    """OpenSieve 调用请求"""
    query_text: str = Field(min_length=1)
    collections: list[str] = Field(min_length=1)
    top_k: int = Field(default=20, ge=1, le=200)
    min_score: float = Field(default=0.3, ge=0.0, le=1.0)


class IndexSearchRequest(BaseModel):
    """sqlite_fts 调用请求"""
    fts_query: str = Field(min_length=1)
    collections: list[str] = Field(min_length=1)
    authority_floor: int = Field(default=1, ge=1, le=5)
    limit: int = Field(default=50, ge=1, le=500)


class OpenSieveResponse(BaseModel):
    """OpenSieve SDK 响应"""
    hit_id: str
    collection_id: str
    score: float
    payload_excerpt: str
    metadata: dict = Field(default_factory=dict)
```

### 2.4 关键算法伪代码

#### 2.4.1 三入口并行调度 + RRF 融合

```
function search(query: RetrievalQuery) -> list[RetrievalHit]:
    # 1. 校验 collections 非空
    if query.collections is empty:
        raise EmptyCollectionsError

    # 2. 跨域 join 仲裁
    await cross_domain_check(query.collections)

    # 3. authority_floor 范围校验（Pydantic 已保证）

    # 4. 并行调度三入口（return_exceptions=True 防止单入口失败拖垮整体）
    tasks = []
    if GREP in enable_entries:
        tasks.append(grep_entry.search(query))
    if SEMANTIC in enable_entries:
        tasks.append(semantic_entry.search(query))
    if INDEX in enable_entries:
        tasks.append(index_entry.search(query))

    results_raw = await asyncio.wait_for(
        asyncio.gather(*tasks, return_exceptions=True),
        timeout=config.fusion_timeout_ms / 1000
    )

    # 5. 过滤失败的入口（记录到 Eval 信号）
    results = []
    for r in results_raw:
        if isinstance(r, Exception):
            await eval_signal_collector.record_entry_failure(r)
            continue
        results.append(r)

    # 6. authority_floor 过滤（每入口独立）
    filtered = []
    for r in results:
        filtered_hits = [h for h in r.hits if get_authority(h.collection_id) >= query.authority_floor]
        filtered.append(RetrievalResult(
            query_id=r.query_id,
            entry_type=r.entry_type,
            hits=filtered_hits,
            elapsed_ms=r.elapsed_ms,
        ))

    # 7. RRF 融合
    fused = rrf_combiner.fuse(filtered, k=config.rrf_k)

    # 8. 排序按 fused score 降序
    fused.sort(key=lambda h: h.score, reverse=True)

    # 9. 截断 max_results
    return fused[:query.max_results]
```

#### 2.4.2 RRF 融合算法

```
function fuse(results: list[RetrievalResult], k: int = 60) -> list[RetrievalHit]:
    # 1. 为每个入口结果建立 entry_id → rank 映射
    rank_maps = []
    for r in results:
        rank_map = {}
        for rank, hit in enumerate(r.hits, start=1):
            rank_map[hit.entry_id] = rank
        rank_maps.append(rank_map)

    # 2. 收集所有 entry_id（去重）
    all_entry_ids = set()
    for rm in rank_maps:
        all_entry_ids.update(rm.keys())

    # 3. 计算每个 entry_id 的 RRF 分数
    scores = {}
    for entry_id in all_entry_ids:
        score = 0.0
        for rm in rank_maps:
            if entry_id in rm:
                score += 1.0 / (k + rm[entry_id])
        scores[entry_id] = score

    # 4. 取每个 entry_id 的最佳 hit（多入口命中时取 score 最高的）
    best_hits = {}
    for r in results:
        for hit in r.hits:
            if hit.entry_id not in best_hits or hit.score > best_hits[hit.entry_id].score:
                best_hits[hit.entry_id] = hit

    # 5. 更新 hit 的 score 与 rank
    fused = []
    for entry_id, score in scores.items():
        hit = best_hits[entry_id]
        hit.score = score
        fused.append(hit)

    # 6. 按 score 降序排序并赋 rank
    fused.sort(key=lambda h: h.score, reverse=True)
    for i, h in enumerate(fused, start=1):
        h.rank = i

    return fused
```

#### 2.4.3 authority_floor 前置过滤

```
function authority_floor_filter(hits: list[RetrievalHit], floor: int) -> list[RetrievalHit]:
    # 在 RRF 融合之前对每个入口结果独立过滤
    filtered = []
    for hit in hits:
        # 通过 collection_id 查询 authority_level（走 F014 CollectionRegistry 缓存）
        authority = await collection_registry.get_authority_level(hit.collection_id)
        if authority >= floor:
            filtered.append(hit)
    return filtered
```

**关键约束**：authority_floor 过滤必须在 RRF 融合之前，避免低权威结果通过 RRF 排名靠前（F016 治理层硬序要求 hard_rule > verified_decision > candidate_observation）。

---

## 3. 模块实现

### 3.1 关键代码片段

#### 3.1.1 GrepEntry ripgrep 实现

```python
# flowforge/core/memory/retrieval/grep.py
from __future__ import annotations
import asyncio
import json
from typing import Optional
from .fusion import RetrievalEntry, RetrievalQuery, RetrievalResult, RetrievalHit, RetrievalEntryType, RetrievalTimeoutError
from .models import RetrievalConfig
from ..collection.registry import CollectionRegistry


class RipgrepGrepEntry(RetrievalEntry):
    """基于 ripgrep 的精确符号检索"""

    def __init__(
        self,
        config: RetrievalConfig,
        collection_registry: CollectionRegistry,
    ):
        self._config = config
        self._registry = collection_registry

    async def search(self, query: RetrievalQuery) -> RetrievalResult:
        import time
        start = time.monotonic()

        # 1. 获取 collection 对应的物理路径（通过 source_uri）
        search_paths = []
        for cid in query.collections:
            collection = await self._registry.get_collection(cid)  # type: ignore
            if collection is not None:
                search_paths.append(collection.source_uri)

        # 2. 构造 ripgrep 命令（--json 输出便于解析）
        cmd = [
            self._config.ripgrep_path,
            "--json",
            "--max-count", str(query.max_results),
        ]
        if not query.case_sensitive:
            cmd.append("-i")
        cmd.extend([query.pattern] + search_paths)

        # 3. 子进程调用（带超时）
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(),
                timeout=self._config.entry_timeout_ms / 1000,
            )
        except asyncio.TimeoutError:
            proc.kill()
            raise RetrievalTimeoutError(
                RetrievalEntryType.GREP, self._config.entry_timeout_ms
            )

        # 4. 解析 ripgrep JSON 输出
        hits = []
        for line in stdout.decode("utf-8", errors="ignore").splitlines():
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") != "match":
                continue
            data = obj.get("data", {})
            hits.append(RetrievalHit(
                entry_id=data.get("path", {}).get("text", "") + ":" + str(data.get("line_number", 0)),
                collection_id=query.collections[0],  # 简化：实际应通过 path 反查
                score=1.0,  # grep 命中即 1.0，由 RRF 重新计算
                rank=0,  # 由 RRFCombiner 赋值
                matched_by=RetrievalEntryType.GREP,
                payload_excerpt=data.get("lines", {}).get("text", "")[:self._config.max_excerpt_length],
            ))

        elapsed_ms = int((time.monotonic() - start) * 1000)
        return RetrievalResult(
            query_id=query.query_id,
            entry_type=RetrievalEntryType.GREP,
            hits=hits,
            elapsed_ms=elapsed_ms,
        )
```

#### 3.1.2 SemanticEntry OpenSieve 实现

```python
# flowforge/core/memory/retrieval/semantic.py
from __future__ import annotations
import asyncio
import time
from typing import Optional
import httpx
from .fusion import RetrievalEntry, RetrievalQuery, RetrievalResult, RetrievalHit, RetrievalEntryType, RetrievalTimeoutError
from .models import RetrievalConfig, OpenSieveResponse


class OpenSieveSemanticEntry(RetrievalEntry):
    """基于 OpenSieve 聚合检索中台的语义检索"""

    def __init__(self, config: RetrievalConfig):
        self._config = config
        self._client = httpx.AsyncClient(
            base_url=config.opensieve_url,
            timeout=config.opensieve_timeout_ms / 1000,
        )

    async def search(self, query: RetrievalQuery) -> RetrievalResult:
        start = time.monotonic()

        # 1. 调用 OpenSieve /api/v1/search
        request_body = {
            "query": query.pattern,
            "collections": query.collections,
            "top_k": query.max_results,
            "min_score": 0.3,
        }

        try:
            response = await self._client.post(
                "/api/v1/search",
                json=request_body,
            )
            response.raise_for_status()
        except httpx.TimeoutException:
            raise RetrievalTimeoutError(
                RetrievalEntryType.SEMANTIC, self._config.opensieve_timeout_ms
            )
        except httpx.HTTPStatusError as e:
            # 错误码归一化（参考 F025 HostAbstraction）
            raise RuntimeError(f"OpenSieve error: {e.response.status_code}") from e

        # 2. 解析响应
        data = response.json()
        hits = []
        for i, item in enumerate(data.get("hits", []), start=1):
            osr = OpenSieveResponse(**item)
            hits.append(RetrievalHit(
                entry_id=osr.hit_id,
                collection_id=osr.collection_id,
                score=osr.score,
                rank=i,
                matched_by=RetrievalEntryType.SEMANTIC,
                payload_excerpt=osr.payload_excerpt[:self._config.max_excerpt_length],
            ))

        elapsed_ms = int((time.monotonic() - start) * 1000)
        return RetrievalResult(
            query_id=query.query_id,
            entry_type=RetrievalEntryType.SEMANTIC,
            hits=hits,
            elapsed_ms=elapsed_ms,
        )

    async def close(self):
        await self._client.aclose()
```

#### 3.1.3 IndexEntry sqlite_fts 实现

```python
# flowforge/core/memory/retrieval/index.py
from __future__ import annotations
import time
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from .fusion import RetrievalEntry, RetrievalQuery, RetrievalResult, RetrievalHit, RetrievalEntryType
from .models import RetrievalConfig
from ..collection.registry import CollectionRepository, CollectionLifecycle


class SqliteFtsIndexEntry(RetrievalEntry):
    """基于 sqlite_fts 的结构化过滤检索"""

    def __init__(
        self,
        config: RetrievalConfig,
        session_factory,
        collection_repository: CollectionRepository,
    ):
        self._config = config
        self._session_factory = session_factory
        self._collection_repo = collection_repository

    async def search(self, query: RetrievalQuery) -> RetrievalResult:
        start = time.monotonic()

        # 构造 FTS5 查询（参数化，防注入）
        fts_query = self._sanitize_fts_query(query.pattern)
        collections_param = ",".join([f"'{c}'" for c in query.collections])

        sql = text(f"""
            SELECT entry_id, collection_id, payload, authority, lifecycle_status
            FROM {self._config.fts_table_name}
            WHERE collection_id IN ({collections_param})
              AND authority >= :authority_floor
              AND {self._config.fts_table_name} MATCH :fts_query
            ORDER BY rank
            LIMIT :limit
        """)

        async with self._session_factory() as session:  # type: AsyncSession
            result = await session.execute(sql, {
                "authority_floor": query.authority_floor,
                "fts_query": fts_query,
                "limit": query.max_results,
            })
            rows = result.fetchall()

        hits = []
        for i, row in enumerate(rows, start=1):
            lifecycle = row[4]
            if lifecycle == CollectionLifecycle.ARCHIVED.value:
                continue  # archived 不参与检索
            if lifecycle == CollectionLifecycle.DEPRECATED.value and not query.include_deprecated:
                continue  # deprecated 默认不返回
            hits.append(RetrievalHit(
                entry_id=row[0],
                collection_id=row[1],
                score=1.0,  # BM25 score 由 sqlite 计算，简化为 1.0
                rank=i,
                matched_by=RetrievalEntryType.INDEX,
                payload_excerpt=str(row[2])[:self._config.max_excerpt_length],
            ))

        elapsed_ms = int((time.monotonic() - start) * 1000)
        return RetrievalResult(
            query_id=query.query_id,
            entry_type=RetrievalEntryType.INDEX,
            hits=hits,
            elapsed_ms=elapsed_ms,
        )

    def _sanitize_fts_query(self, pattern: str) -> str:
        """FTS5 查询语法转义，防止注入（注意：不是 regex 扩展，是安全转义）"""
        # 转义 FTS5 特殊字符
        safe = pattern.replace('"', '""')
        return f'"{safe}"'
```

#### 3.1.4 RRFCombiner 实现

```python
# flowforge/core/memory/retrieval/rrf.py
from __future__ import annotations
from .fusion import RRFCombiner, RetrievalResult, RetrievalHit


class DefaultRRFCombiner(RRFCombiner):
    """RRF 融合算法实现"""

    def fuse(
        self,
        results: list[RetrievalResult],
        k: int = 60,
    ) -> list[RetrievalHit]:
        if not results:
            return []

        # 1. 为每个入口结果建立 entry_id → rank 映射
        rank_maps: list[dict[str, int]] = []
        for r in results:
            rank_map: dict[str, int] = {}
            for rank, hit in enumerate(r.hits, start=1):
                # 多次命中相同 entry_id 取最佳 rank
                if hit.entry_id not in rank_map:
                    rank_map[hit.entry_id] = rank
            rank_maps.append(rank_map)

        # 2. 收集所有 entry_id（去重）
        all_entry_ids: set[str] = set()
        for rm in rank_maps:
            all_entry_ids.update(rm.keys())

        # 3. 计算每个 entry_id 的 RRF 分数
        scores: dict[str, float] = {}
        for entry_id in all_entry_ids:
            score = 0.0
            for rm in rank_maps:
                if entry_id in rm:
                    score += 1.0 / (k + rm[entry_id])
            scores[entry_id] = score

        # 4. 取每个 entry_id 的最佳 hit（多入口命中时取 score 最高的）
        best_hits: dict[str, RetrievalHit] = {}
        for r in results:
            for hit in r.hits:
                if (hit.entry_id not in best_hits
                        or hit.score > best_hits[hit.entry_id].score):
                    best_hits[hit.entry_id] = hit.model_copy()

        # 5. 更新 hit 的 score 与 rank
        fused: list[RetrievalHit] = []
        for entry_id, score in scores.items():
            hit = best_hits[entry_id]
            hit.score = score
            fused.append(hit)

        # 6. 按 score 降序排序并赋 rank
        fused.sort(key=lambda h: h.score, reverse=True)
        for i, h in enumerate(fused, start=1):
            h.rank = i

        return fused
```

#### 3.1.5 RetrievalFusion 实现

```python
# flowforge/core/memory/retrieval/fusion_impl.py
from __future__ import annotations
import asyncio
import time
from typing import Optional
from .fusion import (
    RetrievalFusion, RetrievalEntry, RetrievalQuery, RetrievalHit,
    RetrievalResult, RetrievalEntryType, EmptyCollectionsError,
    CrossDomainJoinForbidden,
)
from .rrf import DefaultRRFCombiner
from .models import RetrievalConfig
from ..collection.registry import CollectionRegistry


class DefaultRetrievalFusion(RetrievalFusion):
    """三入口调度器 + RRF 融合器实现"""

    def __init__(
        self,
        config: RetrievalConfig,
        grep_entry: RetrievalEntry,
        semantic_entry: RetrievalEntry,
        index_entry: RetrievalEntry,
        collection_registry: CollectionRegistry,
        rrf_combiner: Optional[DefaultRRFCombiner] = None,
    ):
        self._config = config
        self._entries: dict[RetrievalEntryType, RetrievalEntry] = {
            RetrievalEntryType.GREP: grep_entry,
            RetrievalEntryType.SEMANTIC: semantic_entry,
            RetrievalEntryType.INDEX: index_entry,
        }
        self._registry = collection_registry
        self._rrf = rrf_combiner or DefaultRRFCombiner()

    async def search(
        self,
        query: RetrievalQuery,
        enable_entries: Optional[list[RetrievalEntryType]] = None,
    ) -> list[RetrievalHit]:
        start = time.monotonic()

        # 1. 校验 collections 非空
        if not query.collections:
            raise EmptyCollectionsError("collections must be non-empty")

        # 2. 跨域 join 仲裁
        await self.cross_domain_check(query.collections)

        # 3. 选择启用的入口
        enabled = enable_entries or list(self._entries.keys())

        # 4. 并行调度三入口（return_exceptions=True 防止单入口失败拖垮整体）
        tasks = []
        for entry_type in enabled:
            entry = self._entries[entry_type]
            tasks.append(entry.search(query))

        try:
            results_raw = await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=self._config.fusion_timeout_ms / 1000,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(
                f"Retrieval fusion timeout: {self._config.fusion_timeout_ms}ms"
            )

        # 5. 过滤失败的入口
        results: list[RetrievalResult] = []
        for i, r in enumerate(results_raw):
            if isinstance(r, Exception):
                # 记录到 Eval 信号（F040 控制面）
                # await self._eval_signal.record_entry_failure(enabled[i], r)
                continue
            results.append(r)

        # 6. authority_floor 过滤（每入口独立）
        filtered: list[RetrievalResult] = []
        for r in results:
            filtered_hits = []
            for hit in r.hits:
                try:
                    authority = await self._registry.get_authority_level(hit.collection_id)  # type: ignore
                except KeyError:
                    continue  # collection 不存在，跳过
                if authority >= query.authority_floor:
                    filtered_hits.append(hit)
            filtered.append(RetrievalResult(
                query_id=r.query_id,
                entry_type=r.entry_type,
                hits=filtered_hits,
                elapsed_ms=r.elapsed_ms,
            ))

        # 7. RRF 融合
        fused = self._rrf.fuse(filtered, k=self._config.rrf_k)

        # 8. 截断 max_results
        return fused[:query.max_results]

    async def cross_domain_check(self, collection_ids: list[str]) -> None:
        await self._registry.cross_domain_join_check(collection_ids)  # type: ignore
```

### 3.2 关键流程时序图

#### 3.2.1 三入口并行检索时序图

```
Forgekin.chat()   RetrievalFusion   GrepEntry   SemanticEntry   IndexEntry   RRFCombiner   CollectionRegistry
    │                  │                  │             │              │             │                │
    │ search(query)   │                  │             │              │             │                │
    ├─────────────────▶                  │             │              │             │                │
    │                  │ collections 校验 │             │              │             │                │
    │                  │ cross_domain_check                                              │
    │                  ├──────────────────────────────────────────────────────────────────────────────▶
    │                  │                  │             │              │             │                │
    │                  │◀─── void / CrossDomainJoinForbidden ─────────────────────────────────────────┤
    │                  │                  │             │              │             │                │
    │                  │ 并行调度三入口（asyncio.gather）                                            │
    │                  ├─────────────────▶│             │              │             │                │
    │                  ├─────────────────────────────────▶              │             │                │
    │                  ├───────────────────────────────────────────────▶              │                │
    │                  │                  │             │              │             │                │
    │                  │                  │ subprocess  │ httpx.post   │ SELECT FTS   │                │
    │                  │                  │ ripgrep     │ OpenSieve    │ sqlite       │                │
    │                  │                  │             │              │             │                │
    │                  │◀── RetrievalResult(grep) ──────┤              │             │                │
    │                  │◀── RetrievalResult(semantic) ────────────────┤              │                │
    │                  │◀── RetrievalResult(index) ────────────────────────────────┤                │
    │                  │                  │             │              │             │                │
    │                  │ authority_floor 过滤（每入口独立）                                              │
    │                  │ get_authority_level(cid) ────────────────────────────────────────────────────▶
    │                  │◀── authority ─────────────────────────────────────────────────────────────────┤
    │                  │                  │             │              │             │                │
    │                  │ fuse(results, k=60)                                                            │
    │                  ├──────────────────────────────────────────────────────────────▶                │
    │                  │◀── fused hits ─────────────────────────────────────────────────┤                │
    │                  │                  │             │              │             │                │
    │                  │ 按 score 降序排序 + 截断 max_results                                            │
    │                  │                  │             │              │             │                │
    │◀── list[RetrievalHit] ─┤            │             │              │             │                │
```

### 3.3 错误处理

| 异常类型 | 触发场景 | 处理策略 | 调用方预期 |
|---------|---------|---------|-----------|
| `EmptyCollectionsError` | collections 参数为空列表 | 拒绝查询，返回 400 | 调用方补全 collections 后重试 |
| `CrossDomainJoinForbidden` | 跨域查询检测 | 拒绝查询，返回 403 | 调用方拆分为多次同域查询 |
| `RetrievalTimeoutError` | 单入口超时（grep > 1s / semantic > 800ms） | 该入口结果为空，不影响其他入口 | 调用方收到部分结果 |
| `RuntimeError("Retrieval fusion timeout")` | 整体检索超时 > 2s | 全部入口结果丢弃，返回空 | 调用方降级到缓存或重试 |
| `httpx.HTTPStatusError` | OpenSieve 返回 4xx/5xx | semantic 入口失败，记录 Eval 信号 | 其他入口正常返回 |
| `subprocess.CalledProcessError` | ripgrep 非零退出 | grep 入口失败，记录 Eval 信号 | 其他入口正常返回 |
| `sqlalchemy.OperationalError` | sqlite_fts 表不存在或锁 | index 入口失败，记录 Eval 信号 | 其他入口正常返回 |
| `json.JSONDecodeError` | ripgrep JSON 输出损坏 | 跳过损坏行，保留可解析命中 | 调用方收到部分结果 |

**单入口失败容忍策略**：

- `asyncio.gather(return_exceptions=True)` 保证单入口失败不影响其他入口。
- 失败的入口结果记为空列表（不抛异常到上层）。
- 失败事件写入 F040 Eval Hub 作为"检索质量"摩擦指标。
- 若所有三入口都失败，返回空列表 + 记录 RuntimeError。

### 3.4 性能优化

| 性能指标 | 目标值 | 优化手段 |
|---------|:------:|---------|
| grep 入口延迟 | < 50ms | ripgrep 是 Rust 实现，10w 文件库 < 50ms；subprocess 启动开销 < 10ms |
| semantic 入口延迟 | < 500ms | OpenSieve 内置 HNSW 索引；httpx 连接池复用 |
| index 入口延迟 | < 100ms | sqlite_fts5 内存索引；按 collection_id 索引 |
| 整体检索延迟 | < max(三入口) + RRF 融合延迟 | 三入口并行；RRF 融合 < 5ms |
| authority_floor 过滤 | < 5ms（10 hits） | 走 CollectionRegistry 类型缓存 |
| 跨域校验 | < 5ms（5 个 collection_ids） | 走 CollectionRegistry 类型缓存 |
| RRF 融合 | < 5ms（100 hits） | 纯内存计算，O(N×K) 复杂度 |
| OpenSieve 调用 QPS | < 100 QPS | httpx 连接池 max_connections=20 |

**缓存策略**：

- 不缓存检索结果：检索查询多样性高，缓存命中率低；语义检索结果实时性要求高。
- 缓存 `collection_id → authority_level`（与 F014 共享缓存）。
- OpenSieve httpx.AsyncClient 复用（连接池）。

**索引同步策略**：

- sqlite_fts 索引在 F014 CollectionRepository.insert_entry() 时同步写入（同事务）。
- 索引更新失败不阻塞 entry 写入，记录警告日志 + Eval 信号。
- 定期任务（每小时）校验 entry 与 fts 索引一致性，发现不一致重建索引。

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用本模块

#### 4.1.1 F014 Collection 层调用

F014 CollectionRegistry 提供 `cross_domain_join_check()` 与 `get_authority_level()` 接口，本模块在每次检索前调用：

```python
# 本模块内部调用 F014
class DefaultRetrievalFusion(RetrievalFusion):
    async def cross_domain_check(self, collection_ids: list[str]) -> None:
        await self._registry.cross_domain_join_check(collection_ids)
```

**集成测试点**：F014 注册 5 种 CollectionType 各 1 个，本模块用跨域 collection_ids 检索时必须抛 `CrossDomainJoinForbidden`。

#### 4.1.2 OpenSieve 聚合检索中台调用

OpenSieve（localhost:8100）提供 `/api/v1/search` 接口，本模块通过 httpx 调用。OpenSieve 负责向量检索 + 关键词检索的底层实现，本模块仅负责协议封装。

**集成测试点**：mock OpenSieve 返回固定响应，验证 SemanticEntry 解析正确；关闭 OpenSieve 时本模块应超时降级。

#### 4.1.3 ripgrep 二进制依赖

通过 `config/system.yaml` 声明 ripgrep 路径：

```yaml
# config/system.yaml（片段）
retrieval:
  ripgrep_path: "/usr/bin/rg"  # 或 Windows: "C:\\Program Files\\ripgrep\\rg.exe"
```

**集成测试点**：ripgrep 不存在时，grep 入口返回失败但不影响其他入口。

### 4.2 下游影响如何被调用

#### 4.2.1 F016 治理层消费本模块

F016 GovernanceFilter 接收本模块 RRF 融合后的 hits 列表：

```python
# F016 侧代码
class GovernanceFilterImpl:
    def __init__(self):
        self._retrieval_fusion = inject("retrieval_fusion")

    async def search_with_governance(self, query, context):
        hits = await self._retrieval_fusion.search(query)
        # 应用三要素过滤 + 权威硬序
        return await self.filter(hits, context)
```

#### 4.2.2 F017 消费排序消费本模块

F017 ConsumptionWeightedRanker 在本模块 RRF 融合结果基础上叠加消费加权：

```python
# F017 侧代码
class ConsumptionWeightedRankerImpl:
    def __init__(self):
        self._retrieval_fusion = inject("retrieval_fusion")
        self._governance_filter = inject("governance_filter")

    async def search_and_rank(self, query, context):
        hits = await self._retrieval_fusion.search(query)
        governed = await self._governance_filter.filter(hits, context)
        return await self.rank(governed, context)
```

#### 4.2.3 F020 归因矩阵消费本模块

F020 AttributionClassifier 通过 grep 入口检索历史失败 Episode：

```python
# F020 侧代码
class AttributionClassifierImpl:
    def __init__(self):
        self._retrieval_fusion = inject("retrieval_fusion")

    async def search_historical_failures(self, pattern: str):
        query = RetrievalQuery(
            query_id=str(uuid7()),
            entry_type=RetrievalEntryType.GREP,  # 单入口模式
            pattern=pattern,
            collections=["episodic_trace_default"],
            authority_floor=1,
            max_results=50,
        )
        return await self._retrieval_fusion.search(query, enable_entries=[RetrievalEntryType.GREP])
```

#### 4.2.4 F039 锻典可检索消费本模块

F039 MindCodexSearch 通过 index 入口按 trigger 字段精确查询：

```python
# F039 侧代码
class MindCodexSearchImpl:
    def __init__(self):
        self._retrieval_fusion = inject("retrieval_fusion")

    async def search_by_trigger(self, trigger: str):
        query = RetrievalQuery(
            query_id=str(uuid7()),
            entry_type=RetrievalEntryType.INDEX,
            pattern=trigger,
            collections=["mind_codex_default"],
            authority_floor=3,  # verified_decision
            max_results=10,
        )
        return await self._retrieval_fusion.search(query, enable_entries=[RetrievalEntryType.INDEX])
```

#### 4.2.5 F040 控制面消费本模块

F040 HarnessEvalControlPlane 订阅本模块的检索信号：

```python
# F040 侧代码（订阅事件）
class EvalHubSubscriber:
    def on_retrieval_completed(self, event):
        # event 包含 elapsed_ms / hit_count / entry_failures
        self._record_friction_metric("retrieval_latency_ms", event.elapsed_ms)
        self._record_friction_metric("retrieval_hit_count", event.hit_count)
```

### 4.3 集成测试点

| 测试编号 | 场景 | 验证点 |
|---------|------|-------|
| IT-D015-001 | collections 为空 | 抛 EmptyCollectionsError |
| IT-D015-002 | 跨域 collection_ids | 抛 CrossDomainJoinForbidden |
| IT-D015-003 | 三入口并行检索 | 总延迟 ≈ max(三入口延迟) |
| IT-D015-004 | grep 入口超时 | semantic/index 仍正常返回 |
| IT-D015-005 | semantic 入口超时 | grep/index 仍正常返回 |
| IT-D015-006 | authority_floor=3 过滤 | authority < 3 的 hit 被丢弃 |
| IT-D015-007 | RRF 融合相同 entry_id 多入口命中 | 分数累加正确 |
| IT-D015-008 | RRF k 值从配置加载 | 代码中无硬编码 60 |
| IT-D015-009 | ripgrep 不存在 | grep 入口失败，其他入口正常 |
| IT-D015-010 | OpenSieve 服务关闭 | semantic 入口超时，其他入口正常 |
| IT-D015-011 | sqlite_fts 表不存在 | index 入口失败，其他入口正常 |
| IT-D015-012 | enable_entries 仅 GREP | 仅 grep 入口执行 |
| IT-D015-013 | F017 调用 search_and_rank | RRF + governance + consumption 链式调用成功 |
| IT-D015-014 | F020 grep 检索历史 Episode | 返回历史失败归因 |
| IT-D015-015 | F039 index 按 trigger 查询 | 返回锻典条目 |
| IT-D015-016 | 引擎内无 LLM 调用代码 | 静态扫描确认 |
| IT-D015-017 | 引擎内无 regex 扩展代码 | 静态扫描确认 |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-F-1**: collections 空列表查询在入口处被拒绝（IT-D015-001）。
- [ ] **AC-F-2**: 跨域查询在 RetrievalFusion 层被拒绝，覆盖 5×5 类型组合（IT-D015-002）。
- [ ] **AC-F-3**: 三入口并行调度，总延迟 ≤ max(三入口延迟) + RRF 融合延迟（IT-D015-003）。
- [ ] **AC-F-4**: 单入口失败不影响其他入口（IT-D015-004/005/009/010/011）。
- [ ] **AC-F-5**: authority_floor 以下的命中在 RRF 融合前被丢弃（IT-D015-006）。
- [ ] **AC-F-6**: RRF 融合相同 entry_id 多入口命中时分数累加正确（IT-D015-007）。
- [ ] **AC-F-7**: RRF k 值从配置加载，代码中无硬编码 60（IT-D015-008）。
- [ ] **AC-F-8**: grep 入口可查精确符号（如 `def handoff_capsule`），延迟 < 50ms（IT-D015-003）。
- [ ] **AC-F-9**: semantic 入口经 OpenSieve SDK 调用，无直连向量库代码（IT-D015-010）。
- [ ] **AC-F-10**: index 入口经 sqlite_fts 查询，参数化防注入（IT-D015-011）。
- [ ] **AC-F-11**: enable_entries 可关闭部分入口（IT-D015-012）。
- [ ] **AC-F-12**: 引擎内无 LLM 调用、无 regex 查询扩展代码（IT-D015-016/017 静态扫描）。

### 5.2 性能验收

- [ ] **AC-P-1**: grep 入口延迟 < 50ms（P95，10w 文件库）。
- [ ] **AC-P-2**: semantic 入口延迟 < 500ms（P95，OpenSieve 单机）。
- [ ] **AC-P-3**: index 入口延迟 < 100ms（P95，sqlite_fts）。
- [ ] **AC-P-4**: 整体检索延迟 < max(三入口) + 10ms（RRF 融合 < 5ms）。
- [ ] **AC-P-5**: authority_floor 过滤延迟 < 5ms（10 hits，缓存命中）。
- [ ] **AC-P-6**: 跨域校验延迟 < 5ms（5 个 collection_ids，缓存命中）。
- [ ] **AC-P-7**: RRF 融合延迟 < 5ms（100 hits）。
- [ ] **AC-P-8**: 100 QPS 检索不触发 OpenSieve 限流。

### 5.3 安全验收

- [ ] **AC-S-1**: 单向依赖通过，`flowforge/core/memory/retrieval/` 不 import F016/F017/F020/F039/F040 任何模块（静态扫描确认）。
- [ ] **AC-S-2**: DI 容器注入通过，`RetrievalFusion` 通过 `inject("retrieval_fusion")` 获取。
- [ ] **AC-S-3**: 三入口均经 F014 CollectionRegistry 读条目，不直操作数据库。
- [ ] **AC-S-4**: sqlite_fts 查询使用参数化绑定（SQLAlchemy text + bindparams），无 SQL 注入风险。
- [ ] **AC-S-5**: ripgrep subprocess 调用使用 `asyncio.create_subprocess_exec`（非 shell=True），无命令注入风险。
- [ ] **AC-S-6**: FTS5 查询模式经过 `_sanitize_fts_query` 转义特殊字符。
- [ ] **AC-S-7**: OpenSieve 调用走 https（生产环境），httpx 自动证书校验。
- [ ] **AC-S-8**: 引擎内禁 LLM 调用与 regex 扩展（`forbidden_llm_in_engine` / `forbidden_regex_expansion` 配置 + 静态扫描）。

### 5.4 Eval 验收

- [ ] **AC-E-1**: 本模块作为 harness 组件，必须附 EvalContract（F018 五问）。
- [ ] **AC-E-2**: friction_metrics 包含：`retrieval_latency_ms` / `retrieval_hit_count` / `entry_failure_rate`。
- [ ] **AC-E-3**: regression_cases 覆盖 IT-D015-001 ~ IT-D015-017。
- [ ] **AC-E-4**: sunset_signals：`unused_days=120` / `friction_above_threshold=retrieval_latency > 1000ms` / `superseded_by`。
- [ ] **AC-E-5**: 信号采集器在 F019 SignalCollector 中注册：`retrieval_latency_probe`。
- [ ] **AC-E-6**: 三方信号交叉验证（F019）——retrieval_latency_ms 与 F018 friction_metrics 偏差 < 0.1 时无冲突。

---

## 6. 引用

- [doc:../spec.md#§3.4]
- [doc:../arch.md#§3.4]
- [doc:../design.md#§3.4]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F015-three-retrieval-entry.md]
- [doc:../features/F016-memory-governance.md]
- [doc:../features/F017-consumption-weighted-ranking.md]
- [doc:../features/F020-seven-attribution.md]
- [doc:../features/F039-mind-codex-searchable.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../architecture/A014-memory-collection.md]
- [doc:../architecture/A015-three-retrieval-entry.md]
- [doc:../decisions/008-memory-federation.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架 + 三入口实现 + RRF 算法 + 时序图 + 错误处理 + 性能优化 + 跨模块协作 + AC） | 开发者灵智体（猎犬·夏洛克） |
