"""HumanBehaviorSimulator 和 AntiDetectionAdvisor 单元测试.

验证浏览器行为模拟（随机延迟）和智能选择器维护（DOM 变更分析、选择器更新建议）。
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from flowforge.tools.anti_detection import (
    AntiDetectionAdvisor,
    HumanBehaviorSimulator,
    SelectorChange,
    SelectorUpdateSuggestion,
)


# ═══════════════════════════════════════════════════════════════════════
# HumanBehaviorSimulator 测试
# ═══════════════════════════════════════════════════════════════════════


class TestHumanBehaviorSimulator:
    """人类行为模拟器测试."""

    @patch("asyncio.sleep", new_callable=AsyncMock)
    def test_random_delay(self, mock_sleep):
        """随机延迟值应在 [min_s, max_s] 范围内."""
        simulator = HumanBehaviorSimulator()
        asyncio.run(simulator.random_delay(0.5, 2.0))

        mock_sleep.assert_called_once()
        delay = mock_sleep.call_args[0][0]
        assert 0.5 <= delay <= 2.0

    @patch("asyncio.sleep", new_callable=AsyncMock)
    def test_random_delay_custom_range(self, mock_sleep):
        """自定义范围的随机延迟."""
        simulator = HumanBehaviorSimulator()
        asyncio.run(simulator.random_delay(1.0, 3.0))

        mock_sleep.assert_called_once()
        delay = mock_sleep.call_args[0][0]
        assert 1.0 <= delay <= 3.0

    @patch("asyncio.sleep", new_callable=AsyncMock)
    def test_random_delay_default_range(self, mock_sleep):
        """默认范围 [0.5, 2.0] 的随机延迟."""
        simulator = HumanBehaviorSimulator()
        asyncio.run(simulator.random_delay())

        mock_sleep.assert_called_once()
        delay = mock_sleep.call_args[0][0]
        assert 0.5 <= delay <= 2.0


# ═══════════════════════════════════════════════════════════════════════
# AntiDetectionAdvisor 测试
# ═══════════════════════════════════════════════════════════════════════


class TestAntiDetectionAdvisor:
    """智能选择器维护器测试."""

    def test_analyze_page_changes(self):
        """分析页面 DOM 变更 — 检测新增、删除、修改的元素."""
        advisor = AntiDetectionAdvisor()
        before = (
            '<div id="old" class="container">Hello</div>'
            '<span class="label">text</span>'
        )
        after = '<div id="new" class="container modified">World</div>'

        result = advisor.analyze_page_changes(before, after)
        changes = result["changes"]
        change_map = {c.selector: c for c in changes}

        # #old removed, #new added
        assert "#old" in change_map
        assert change_map["#old"].change_type == "removed"
        assert change_map["#old"].confidence == 0.8

        assert "#new" in change_map
        assert change_map["#new"].change_type == "added"
        assert change_map["#new"].confidence == 0.7

        # .label removed, .modified added
        assert ".label" in change_map
        assert change_map[".label"].change_type == "removed"

        assert ".modified" in change_map
        assert change_map[".modified"].change_type == "added"

        # .container same value → no change
        assert ".container" not in change_map

        # Summary contains counts
        assert "新增" in result["summary"]
        assert "删除" in result["summary"]
        assert "修改" in result["summary"]

    def test_analyze_page_changes_no_changes(self):
        """相同 HTML 无变更."""
        advisor = AntiDetectionAdvisor()
        html = '<div id="main" class="container">Hello</div>'

        result = advisor.analyze_page_changes(html, html)
        assert len(result["changes"]) == 0
        assert "0 处变更" in result["summary"]

    def test_analyze_page_changes_all_added(self):
        """全部新增的元素."""
        advisor = AntiDetectionAdvisor()
        before = "<div>empty</div>"
        after = '<div id="new-id" class="new-class">content</div>'

        result = advisor.analyze_page_changes(before, after)
        changes = result["changes"]
        assert all(c.change_type == "added" for c in changes)
        assert any(c.selector == "#new-id" for c in changes)
        assert any(c.selector == ".new-class" for c in changes)

    def test_suggest_selector_updates(self):
        """根据 DOM 变更建议选择器更新."""
        advisor = AntiDetectionAdvisor()
        changes = [
            SelectorChange(
                selector="#old-id",
                change_type="removed",
                old_value="old-id",
                confidence=0.8,
            ),
            SelectorChange(
                selector="#new-id",
                change_type="added",
                new_value="new-id",
                confidence=0.7,
            ),
            SelectorChange(
                selector=".old-class",
                change_type="removed",
                old_value="old-class",
                confidence=0.8,
            ),
            SelectorChange(
                selector=".container",
                change_type="modified",
                old_value="container",
                new_value="container-v2",
                confidence=0.6,
            ),
        ]

        suggestions = advisor.suggest_selector_updates(changes)

        # #old-id removed, #new-id added (similar # prefix) → suggest #new-id
        old_id_suggestion = next(
            s for s in suggestions if s.old_selector == "#old-id"
        )
        assert old_id_suggestion.new_selector == "#new-id"
        assert old_id_suggestion.confidence == 0.6
        assert "相似" in old_id_suggestion.reason

        # .old-class removed, no similar . added → suggest ""
        old_class_suggestion = next(
            s for s in suggestions if s.old_selector == ".old-class"
        )
        assert old_class_suggestion.new_selector == ""
        assert old_class_suggestion.confidence == 0.3
        assert "人工检查" in old_class_suggestion.reason

        # .container modified → suggest new_value
        container_suggestion = next(
            s for s in suggestions if s.old_selector == ".container"
        )
        assert container_suggestion.new_selector == "container-v2"
        assert container_suggestion.confidence == 0.6

    def test_suggest_selector_updates_empty(self):
        """无变更时返回空建议列表."""
        advisor = AntiDetectionAdvisor()
        suggestions = advisor.suggest_selector_updates([])
        assert suggestions == []

    def test_validate_selector_valid(self):
        """验证有效选择器返回 True."""
        advisor = AntiDetectionAdvisor()
        page = MagicMock()
        page.query_selector = AsyncMock(return_value=MagicMock())

        result = asyncio.run(advisor.validate_selector(page, "#valid-element"))
        assert result is True

    def test_validate_selector_invalid(self):
        """验证无效选择器返回 False."""
        advisor = AntiDetectionAdvisor()
        page = MagicMock()
        page.query_selector = AsyncMock(return_value=None)

        result = asyncio.run(advisor.validate_selector(page, "#missing-element"))
        assert result is False

    def test_validate_selector_exception(self):
        """验证选择器时抛异常返回 False."""
        advisor = AntiDetectionAdvisor()
        page = MagicMock()
        page.query_selector = AsyncMock(
            side_effect=RuntimeError("page closed")
        )

        result = asyncio.run(advisor.validate_selector(page, "#broken"))
        assert result is False
