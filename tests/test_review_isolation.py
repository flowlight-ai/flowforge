"""ReviewIsolation 单元测试.

验证盲评隔离模块：身份信息移除、维度子集分配、仲裁者匿名化视图。
"""

import pytest

from flowforge.tools.review_isolation import (
    ArbitratorView,
    IsolatedContext,
    ReviewIsolation,
)


# ═══════════════════════════════════════════════════════════════════════
# ReviewIsolation 测试
# ═══════════════════════════════════════════════════════════════════════


class TestReviewIsolation:
    """盲评隔离器测试."""

    def test_create_isolated_context(self):
        """创建隔离上下文 — 身份字段被 redacted."""
        ri = ReviewIsolation()
        task_context = {
            "task_id": "task1",
            "chapter_id": "ch1",
            "novel_id": "novel1",
            "author_name": "张三",
            "author_id": "author_001",
            "author_email": "zhangsan@example.com",
            "content": "章节内容...",
        }

        ctx = ri.create_isolated_context(task_context, reviewer_id="reviewer_1")

        assert isinstance(ctx, IsolatedContext)
        assert ctx.reviewer_id == "reviewer_1"
        # 匿名 ID 不等于原始 ID
        assert ctx.anonymous_id != "reviewer_1"
        assert len(ctx.anonymous_id) == 12
        # 身份字段被 redacted
        assert ctx.content["author_name"] == "[REDACTED]"
        assert ctx.content["author_id"] == "[REDACTED]"
        assert ctx.content["author_email"] == "[REDACTED]"
        # 非身份字段保留
        assert ctx.content["content"] == "章节内容..."
        assert ctx.content["task_id"] == "task1"
        # 隔离标记
        assert ctx.is_isolated is True
        assert ctx.author_identity_removed is True
        # metadata 正确提取
        assert ctx.metadata["task_id"] == "task1"
        assert ctx.metadata["chapter_id"] == "ch1"
        assert ctx.metadata["novel_id"] == "novel1"

    def test_create_isolated_context_all_identity_fields(self):
        """所有身份标识字段都被 redacted."""
        ri = ReviewIsolation()
        task_context = {
            "author_name": "张三",
            "author_id": "001",
            "author_email": "a@test.com",
            "writer_name": "李四",
            "creator": "system",
            "created_by": "admin",
            "user_name": "user1",
            "user_id": "u001",
            "other_field": "kept",
        }

        ctx = ri.create_isolated_context(task_context, reviewer_id="r1")

        identity_fields = [
            "author_name",
            "author_id",
            "author_email",
            "writer_name",
            "creator",
            "created_by",
            "user_name",
            "user_id",
        ]
        for field_name in identity_fields:
            assert ctx.content[field_name] == "[REDACTED]", (
                f"身份字段 {field_name} 应被 redacted"
            )
        assert ctx.content["other_field"] == "kept"

    def test_isolation_copy(self):
        """深拷贝并移除身份字段 — 修改原对象不影响副本."""
        ri = ReviewIsolation()
        task_context = {
            "author_name": "张三",
            "data": {"nested": "value"},
            "list": [1, 2, 3],
        }

        copy_result = ri.isolation_copy(task_context)

        # 修改原对象
        task_context["data"]["nested"] = "changed"
        task_context["list"].append(4)

        # 副本不受影响（深拷贝）
        assert copy_result["data"]["nested"] == "value"
        assert copy_result["list"] == [1, 2, 3]
        # 身份字段被 redacted
        assert copy_result["author_name"] == "[REDACTED]"

    def test_isolation_copy_no_identity_fields(self):
        """无身份字段时正常拷贝."""
        ri = ReviewIsolation()
        task_context = {"content": "text", "task_id": "t1"}

        result = ri.isolation_copy(task_context)

        assert result["content"] == "text"
        assert result["task_id"] == "t1"

    def test_subset_view(self):
        """子集视图 — 只显示分配的审核维度."""
        ri = ReviewIsolation(
            dimensions=["plot", "character", "style", "logic", "emotion"]
        )
        task_context = {"task_id": "task1", "author_name": "张三"}
        ctx = ri.create_isolated_context(
            task_context,
            reviewer_id="r1",
            assigned_dimensions=["plot", "character"],
        )

        full_content = {
            "plot": "剧情内容",
            "character": "角色内容",
            "style": "风格内容",
            "logic": "逻辑内容",
            "emotion": "情感内容",
            "metadata": "元数据",
        }

        subset = ri.subset_view("r1", full_content)

        # 分配的维度可见
        assert subset["plot"] == "剧情内容"
        assert subset["character"] == "角色内容"
        # 未分配的审核维度不可见
        assert subset["style"] == "[NOT_ASSIGNED]"
        assert subset["logic"] == "[NOT_ASSIGNED]"
        assert subset["emotion"] == "[NOT_ASSIGNED]"
        # 非审核维度（如 metadata）始终可见
        assert subset["metadata"] == "元数据"

    def test_subset_view_no_context(self):
        """未创建上下文的 reviewer 返回空字典."""
        ri = ReviewIsolation()
        result = ri.subset_view("nonexistent", {"plot": "data"})
        assert result == {}

    def test_subset_view_all_assigned(self):
        """分配所有维度时全部可见."""
        ri = ReviewIsolation(dimensions=["plot", "character", "style"])
        task_context = {"task_id": "t1"}
        ri.create_isolated_context(
            task_context,
            reviewer_id="r1",
            assigned_dimensions=["plot", "character", "style"],
        )

        full_content = {
            "plot": "p",
            "character": "c",
            "style": "s",
        }
        subset = ri.subset_view("r1", full_content)

        assert subset["plot"] == "p"
        assert subset["character"] == "c"
        assert subset["style"] == "s"

    def test_get_arbitrator_view(self):
        """仲裁者视图 — 审核者身份匿名化."""
        ri = ReviewIsolation()
        reviews = [
            {
                "reviewer_id": "reviewer_1",
                "reviewer_name": "张三",
                "dimension_scores": {"plot": 0.8, "style": 0.7},
            },
            {
                "reviewer_id": "reviewer_2",
                "reviewer_name": "李四",
                "dimension_scores": {"plot": 0.6, "style": 0.9},
            },
        ]

        view = ri.get_arbitrator_view(reviews)

        assert isinstance(view, ArbitratorView)
        assert len(view.reviews) == 2

        # reviewer_id 应被匿名化
        for review in view.reviews:
            assert review["reviewer_id"] != "reviewer_1"
            assert review["reviewer_id"] != "reviewer_2"
            assert len(review["reviewer_id"]) == 12
            assert "reviewer_name" not in review

        # 维度分数汇总
        assert "plot" in view.dimension_scores
        assert "style" in view.dimension_scores
        assert len(view.dimension_scores["plot"]) == 2
        assert 0.8 in view.dimension_scores["plot"]
        assert 0.6 in view.dimension_scores["plot"]
        assert 0.7 in view.dimension_scores["style"]
        assert 0.9 in view.dimension_scores["style"]

        # 匿名映射表
        assert len(view.anonymous_reviewer_map) == 2
        # 映射表应能反向查找原始 ID
        anonymous_ids = list(view.anonymous_reviewer_map.keys())
        assert view.anonymous_reviewer_map[anonymous_ids[0]] in (
            "reviewer_1",
            "reviewer_2",
        )

    def test_get_arbitrator_view_empty(self):
        """空审核列表返回空视图."""
        ri = ReviewIsolation()
        view = ri.get_arbitrator_view([])

        assert view.reviews == []
        assert view.dimension_scores == {}
        assert view.anonymous_reviewer_map == {}

    def test_auto_assign_dimensions(self):
        """自动分配维度 — 第一个审核者获得全部维度."""
        ri = ReviewIsolation(
            dimensions=["plot", "character", "style", "logic", "emotion"]
        )
        task_context = {"task_id": "task1"}

        ctx1 = ri.create_isolated_context(task_context, reviewer_id="r1")

        # 第一个审核者获得全部维度
        assert set(ctx1.assigned_dimensions) == {
            "plot",
            "character",
            "style",
            "logic",
            "emotion",
        }

    def test_auto_assign_dimensions_rotation(self):
        """自动分配维度 — 后续审核者轮询分配."""
        ri = ReviewIsolation(
            dimensions=["plot", "character", "style", "logic", "emotion"]
        )
        task_context = {"task_id": "task1"}

        ctx1 = ri.create_isolated_context(task_context, reviewer_id="r1")
        ctx2 = ri.create_isolated_context(task_context, reviewer_id="r2")
        ctx3 = ri.create_isolated_context(task_context, reviewer_id="r3")

        # 所有审核者都获得全部维度（轮询顺序不同）
        assert set(ctx1.assigned_dimensions) == set(ctx2.assigned_dimensions)
        assert set(ctx2.assigned_dimensions) == set(ctx3.assigned_dimensions)

        # 顺序应不同（轮询）
        assert ctx1.assigned_dimensions != ctx2.assigned_dimensions
        assert ctx2.assigned_dimensions != ctx3.assigned_dimensions

    def test_custom_dimensions(self):
        """自定义审核维度."""
        ri = ReviewIsolation(dimensions=["custom1", "custom2"])
        task_context = {"task_id": "t1"}

        ctx = ri.create_isolated_context(
            task_context,
            reviewer_id="r1",
            assigned_dimensions=["custom1"],
        )

        full_content = {"custom1": "v1", "custom2": "v2", "meta": "m"}
        subset = ri.subset_view("r1", full_content)

        assert subset["custom1"] == "v1"
        assert subset["custom2"] == "[NOT_ASSIGNED]"
        assert subset["meta"] == "m"

    def test_default_dimensions(self):
        """默认审核维度为 plot/character/style/logic/emotion."""
        ri = ReviewIsolation()
        assert ri._dimensions == [
            "plot",
            "character",
            "style",
            "logic",
            "emotion",
        ]
