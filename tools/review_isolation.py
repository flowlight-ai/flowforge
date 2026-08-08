"""盲评隔离模块 — 多审核者并发安全隔离.

提供审核场景下的盲评隔离能力：
- 创建隔离的审核上下文（移除作者身份信息）
- 按 reviewer 分配审核维度子集
- 仲裁者查看所有审核但不知审核者身份
"""

import copy
import hashlib
from dataclasses import dataclass, field
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("tools.review_isolation")


@dataclass
class IsolatedContext:
    """隔离的审核上下文."""

    reviewer_id: str
    anonymous_id: str  # 匿名 ID（哈希）
    assigned_dimensions: list[str] = field(default_factory=list)
    content: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    # 隔离标记
    is_isolated: bool = True
    author_identity_removed: bool = True


@dataclass
class ArbitratorView:
    """仲裁者视图 — 汇总所有审核但隐藏审核者身份."""

    reviews: list[dict[str, Any]] = field(default_factory=list)
    dimension_scores: dict[str, list[float]] = field(default_factory=dict)
    anonymous_reviewer_map: dict[str, str] = field(default_factory=dict)


class ReviewIsolation:
    """盲评隔离器 — 确保多审核者并发安全.

    核心能力：
    1. create_isolated_context: 为每个审核者创建隔离上下文
    2. isolation_copy: 深拷贝任务上下文，移除身份信息
    3. subset_view: 按 reviewer 分配审核维度子集
    4. get_arbitrator_view: 仲裁者汇总视图（匿名化）
    """

    # 需要移除的身份标识字段
    IDENTITY_FIELDS = {
        "author_name",
        "author_id",
        "author_email",
        "writer_name",
        "creator",
        "created_by",
        "user_name",
        "user_id",
    }

    def __init__(self, dimensions: list[str] | None = None):
        """初始化.

        Args:
            dimensions: 审核维度列表（如 ["plot", "character", "style", "logic", "emotion"]）
        """
        self._dimensions = dimensions or [
            "plot",
            "character",
            "style",
            "logic",
            "emotion",
        ]
        self._isolated_contexts: dict[str, IsolatedContext] = {}

    def create_isolated_context(
        self,
        task_context: dict[str, Any],
        reviewer_id: str,
        assigned_dimensions: list[str] | None = None,
    ) -> IsolatedContext:
        """为审核者创建隔离上下文.

        Args:
            task_context: 原始任务上下文（含作者信息）
            reviewer_id: 审核者 ID
            assigned_dimensions: 分配的审核维度（None 则自动分配）

        Returns:
            隔离的审核上下文
        """
        logger.debug(
            f"create_isolated_context: enter reviewer_id={reviewer_id!r} "
            f"assigned_dimensions={assigned_dimensions} "
            f"task_context_keys={list(task_context.keys())}"
        )
        # 生成匿名 ID
        anonymous_id = self._hash_id(reviewer_id)

        # 自动分配维度（如果未指定）
        if assigned_dimensions is None:
            assigned_dimensions = self._auto_assign_dimensions(reviewer_id)
            logger.debug(
                f"create_isolated_context: auto_assigned_dimensions "
                f"reviewer_id={reviewer_id!r} dimensions={assigned_dimensions}"
            )
        else:
            logger.debug(
                f"create_isolated_context: explicit_dimensions "
                f"reviewer_id={reviewer_id!r} dimensions={assigned_dimensions}"
            )

        # 深拷贝并移除身份信息
        isolated_content = self.isolation_copy(task_context)
        removed_identity_fields = [
            k for k in task_context.keys() if k.lower() in self.IDENTITY_FIELDS
        ]

        context = IsolatedContext(
            reviewer_id=reviewer_id,
            anonymous_id=anonymous_id,
            assigned_dimensions=assigned_dimensions,
            content=isolated_content,
            metadata={
                "created_at": task_context.get("created_at", ""),
                "task_id": task_context.get("task_id", ""),
                "novel_id": task_context.get("novel_id", ""),
                "chapter_id": task_context.get("chapter_id", ""),
            },
        )

        self._isolated_contexts[reviewer_id] = context
        logger.info(
            f"ReviewIsolation: 创建隔离上下文 reviewer={anonymous_id} "
            f"dimensions={assigned_dimensions}"
        )
        logger.debug(
            f"create_isolated_context: done reviewer_id={reviewer_id!r} "
            f"anonymous_id={anonymous_id} dimensions={assigned_dimensions} "
            f"identity_fields_removed={removed_identity_fields} "
            f"removed_count={len(removed_identity_fields)}"
        )

        return context

    def isolation_copy(self, task_context: dict[str, Any]) -> dict[str, Any]:
        """深拷贝任务上下文并移除身份信息.

        Args:
            task_context: 原始任务上下文

        Returns:
            移除了身份信息的副本
        """
        logger.debug(
            f"isolation_copy: enter context_keys={list(task_context.keys())}"
        )
        isolated = copy.deepcopy(task_context)

        # 移除身份标识字段
        removed = []
        for field_name in list(isolated.keys()):
            if field_name.lower() in self.IDENTITY_FIELDS:
                removed.append(field_name)
                isolated[field_name] = "[REDACTED]"

        if removed:
            logger.info(
                f"ReviewIsolation: 移除身份字段: {removed}"
            )
        logger.debug(
            f"isolation_copy: done removed_fields={removed} "
            f"removed_count={len(removed)} remaining_keys={list(isolated.keys())}"
        )

        return isolated

    def subset_view(
        self, reviewer_id: str, full_content: dict[str, Any]
    ) -> dict[str, Any]:
        """按 reviewer 分配审核维度子集视图.

        每个审核者只能看到自己分配的维度内容。

        Args:
            reviewer_id: 审核者 ID
            full_content: 完整内容

        Returns:
            过滤后的子集视图
        """
        logger.debug(
            f"subset_view: enter reviewer_id={reviewer_id!r} "
            f"full_content_keys={list(full_content.keys())}"
        )
        context = self._isolated_contexts.get(reviewer_id)
        if not context:
            logger.warning(f"ReviewIsolation: 未找到 reviewer={reviewer_id} 的上下文")
            logger.debug(
                f"subset_view: return_empty reviewer_id={reviewer_id!r} "
                f"reason=context_not_found"
            )
            return {}

        assigned = set(context.assigned_dimensions)
        subset = {}
        filtered_fields = []

        for key, value in full_content.items():
            if key in assigned or key not in self._dimensions:
                # 分配的维度或非审核维度（如 metadata）都可见
                subset[key] = value
            else:
                # 未分配的审核维度不可见
                subset[key] = "[NOT_ASSIGNED]"
                filtered_fields.append(key)

        logger.debug(
            f"subset_view: done reviewer_id={reviewer_id!r} "
            f"anonymous_id={context.anonymous_id} "
            f"assigned_dimensions={context.assigned_dimensions} "
            f"visible_count={len(subset) - len(filtered_fields)} "
            f"filtered_fields={filtered_fields} filtered_count={len(filtered_fields)}"
        )
        return subset

    def get_arbitrator_view(
        self, reviews: list[dict[str, Any]]
    ) -> ArbitratorView:
        """生成仲裁者视图 — 汇总所有审核但隐藏审核者身份.

        Args:
            reviews: 所有审核者的审核结果列表

        Returns:
            仲裁者视图（审核者 ID 已匿名化）
        """
        logger.debug(
            f"get_arbitrator_view: enter review_count={len(reviews)}"
        )
        anonymous_reviews = []
        dimension_scores: dict[str, list[float]] = {}
        anonymous_map: dict[str, str] = {}

        for review in reviews:
            reviewer_id = review.get("reviewer_id", "")
            anonymous_id = self._hash_id(reviewer_id)
            anonymous_map[anonymous_id] = reviewer_id

            # 匿名化审核
            anon_review = copy.deepcopy(review)
            anon_review["reviewer_id"] = anonymous_id
            anon_review.pop("reviewer_name", None)
            anonymous_reviews.append(anon_review)

            # 汇总维度分数
            scores = review.get("dimension_scores", {})
            for dim, score in scores.items():
                if dim not in dimension_scores:
                    dimension_scores[dim] = []
                dimension_scores[dim].append(score)

        logger.info(
            f"get_arbitrator_view: aggregated reviews={len(anonymous_reviews)} "
            f"dimensions={list(dimension_scores.keys())}"
        )
        logger.debug(
            f"get_arbitrator_view: done review_count={len(anonymous_reviews)} "
            f"dimension_scores={{{', '.join(f'{k}: {len(v)} scores' for k, v in dimension_scores.items())}}} "
            f"anonymous_reviewer_count={len(anonymous_map)}"
        )
        return ArbitratorView(
            reviews=anonymous_reviews,
            dimension_scores=dimension_scores,
            anonymous_reviewer_map=anonymous_map,
        )

    def _hash_id(self, original_id: str) -> str:
        """将 ID 哈希为匿名 ID."""
        hashed = hashlib.sha256(original_id.encode("utf-8")).hexdigest()[:12]
        logger.debug(
            f"_hash_id: original={original_id!r} hashed={hashed}"
        )
        return hashed

    def _auto_assign_dimensions(self, reviewer_id: str) -> list[str]:
        """自动为审核者分配审核维度.

        策略：轮询分配，确保每个维度至少有一个审核者。
        """
        logger.debug(
            f"_auto_assign_dimensions: enter reviewer_id={reviewer_id!r} "
            f"existing_contexts={len(self._isolated_contexts)} "
            f"total_dimensions={len(self._dimensions)}"
        )
        if not self._isolated_contexts:
            # 第一个审核者分配所有维度
            assigned = list(self._dimensions)
            logger.debug(
                f"_auto_assign_dimensions: first_reviewer "
                f"reviewer_id={reviewer_id!r} assigned={assigned} "
                f"reason=all_dimensions (first reviewer)"
            )
            return assigned

        # 后续审核者分配不同的维度子集
        existing_count = len(self._isolated_contexts)
        total_dims = len(self._dimensions)

        # 轮询分配
        start_idx = existing_count % total_dims
        assigned = []
        for i in range(total_dims):
            idx = (start_idx + i) % total_dims
            assigned.append(self._dimensions[idx])

        logger.debug(
            f"_auto_assign_dimensions: subsequent_reviewer "
            f"reviewer_id={reviewer_id!r} assigned={assigned} "
            f"start_idx={start_idx} existing_count={existing_count}"
        )
        return assigned
