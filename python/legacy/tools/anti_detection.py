"""反检测系统 — 浏览器行为模拟与智能选择器维护.

提供 Playwright 发布场景下的反检测能力：
- 人类行为模拟（随机延迟、模拟点击、模拟输入、模拟滚动）
- 智能选择器维护（DOM 变更分析、选择器更新建议）
"""

import asyncio
import hashlib
import random
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from flowforge.core.tracing import get_logger

logger = get_logger("tools.anti_detection")


class HumanBehaviorSimulator:
    """人类行为模拟器 — 模拟真实用户操作以规避反爬检测.

    所有方法均为 async，需在 Playwright page 上下文中调用。
    """

    def __init__(self, profile: Optional[Dict[str, Any]] = None):
        self._profile = profile or {}

    async def random_delay(self, min_s: float = 0.5, max_s: float = 2.0) -> None:
        """随机延迟."""
        delay = random.uniform(min_s, max_s)
        logger.debug(
            f"random_delay: range=[{min_s}, {max_s}] actual_delay={delay:.4f}s"
        )
        await asyncio.sleep(delay)

    async def simulate_click(
        self, page: Any, selector: str, offset_x: float = 0, offset_y: float = 0
    ) -> None:
        """模拟点击 — 带随机偏移和前后延迟.

        Args:
            page: Playwright Page 对象
            selector: CSS 选择器
            offset_x: X 轴偏移（像素）
            offset_y: Y 轴偏移（像素）
        """
        logger.debug(
            f"simulate_click: enter selector={selector!r} offset=({offset_x}, {offset_y})"
        )
        await self.random_delay(0.3, 1.0)

        # 添加随机偏移（模拟人手不精确的点击）
        jitter_x = random.uniform(-3, 3)
        jitter_y = random.uniform(-3, 3)
        logger.debug(
            f"simulate_click: jitter=({jitter_x:.2f}, {jitter_y:.2f}) "
            f"selector={selector!r}"
        )

        element = await page.query_selector(selector)
        if element:
            box = await element.bounding_box()
            if box:
                click_x = box["x"] + box["width"] / 2 + offset_x + jitter_x
                click_y = box["y"] + box["height"] / 2 + offset_y + jitter_y
                logger.debug(
                    f"simulate_click: click_at=({click_x:.2f}, {click_y:.2f}) "
                    f"selector={selector!r} mode=mouse_click"
                )
                await page.mouse.click(click_x, click_y)
            else:
                logger.debug(
                    f"simulate_click: fallback element.click selector={selector!r} "
                    f"reason=no_bounding_box"
                )
                await element.click()
        else:
            logger.debug(
                f"simulate_click: fallback page.click selector={selector!r} "
                f"reason=element_not_found"
            )
            await page.click(selector)

        await self.random_delay(0.2, 0.8)

    async def simulate_type_text(
        self, page: Any, selector: str, text: str, keystroke_delay: float = 0.05
    ) -> None:
        """模拟逐字输入 — 带随机按键延迟.

        Args:
            page: Playwright Page 对象
            selector: CSS 选择器
            text: 要输入的文本
            keystroke_delay: 按键间隔基准（秒），实际会有随机波动
        """
        logger.debug(
            f"simulate_type_text: enter selector={selector!r} "
            f"text_length={len(text)} keystroke_delay={keystroke_delay}"
        )
        await page.click(selector)
        await self.random_delay(0.2, 0.5)

        for char in text:
            await page.keyboard.type(char)
            # 随机按键延迟（基准值的 50%-200%）
            delay = keystroke_delay * random.uniform(0.5, 2.0)
            await asyncio.sleep(delay)

        logger.debug(
            f"simulate_type_text: done selector={selector!r} "
            f"chars_typed={len(text)}"
        )
        await self.random_delay(0.3, 0.8)

    async def simulate_scroll(
        self, page: Any, distance: int = 300, steps: int = 3
    ) -> None:
        """模拟滚动 — 带动量和随机暂停.

        Args:
            page: Playwright Page 对象
            distance: 滚动总距离（像素）
            steps: 分几步滚动（模拟人手滚动）
        """
        step_distance = distance // steps
        logger.debug(
            f"simulate_scroll: enter distance={distance} steps={steps} "
            f"step_distance={step_distance}"
        )
        for i in range(steps):
            await page.mouse.wheel(0, step_distance)
            logger.debug(
                f"simulate_scroll: step={i + 1}/{steps} "
                f"wheel_delta={step_distance}"
            )
            await self.random_delay(0.1, 0.4)

    async def simulate_mouse_movement(self, page: Any, target_x: float, target_y: float) -> None:
        """模拟鼠标移动 — 贝塞尔曲线轨迹."""
        current = await page.evaluate("() => ({x: window.scrollX, y: window.scrollY})")
        # 简单的渐进式移动
        steps = random.randint(5, 15)
        for i in range(steps):
            progress = (i + 1) / steps
            x = target_x * progress + random.uniform(-2, 2)
            y = target_y * progress + random.uniform(-2, 2)
            await page.mouse.move(x, y)
            await asyncio.sleep(random.uniform(0.01, 0.05))


@dataclass
class SelectorChange:
    """选择器变更记录."""

    selector: str
    change_type: str  # added / removed / modified
    old_value: str = ""
    new_value: str = ""
    confidence: float = 0.0


@dataclass
class SelectorUpdateSuggestion:
    """选择器更新建议."""

    old_selector: str
    new_selector: str
    reason: str
    confidence: float


class AntiDetectionAdvisor:
    """智能选择器维护器 — 分析 DOM 变更并建议选择器更新.

    当平台更新页面结构时，原有 CSS 选择器可能失效。
    此组件通过对比变更前后的 DOM，智能推荐新选择器。
    """

    def analyze_page_changes(
        self, before_html: str, after_html: str
    ) -> Dict[str, Any]:
        """分析页面 DOM 变更.

        Args:
            before_html: 变更前的 HTML
            after_html: 变更后的 HTML

        Returns:
            变更分析结果 {changes: List[SelectorChange], summary: str}
        """
        logger.debug(
            f"analyze_page_changes: enter before_len={len(before_html)} "
            f"after_len={len(after_html)}"
        )
        changes: List[SelectorChange] = []

        # 提取所有 id 和 class 属性
        before_attrs = self._extract_attributes(before_html)
        after_attrs = self._extract_attributes(after_html)
        logger.debug(
            f"analyze_page_changes: extracted before_attrs={len(before_attrs)} "
            f"after_attrs={len(after_attrs)}"
        )

        # 检测新增的元素
        for selector, value in after_attrs.items():
            if selector not in before_attrs:
                changes.append(
                    SelectorChange(
                        selector=selector,
                        change_type="added",
                        new_value=value,
                        confidence=0.7,
                    )
                )

        # 检测删除的元素
        for selector, value in before_attrs.items():
            if selector not in after_attrs:
                changes.append(
                    SelectorChange(
                        selector=selector,
                        change_type="removed",
                        old_value=value,
                        confidence=0.8,
                    )
                )

        # 检测修改的元素
        for selector in before_attrs:
            if selector in after_attrs and before_attrs[selector] != after_attrs[selector]:
                changes.append(
                    SelectorChange(
                        selector=selector,
                        change_type="modified",
                        old_value=before_attrs[selector],
                        new_value=after_attrs[selector],
                        confidence=0.6,
                    )
                )

        summary = (
            f"检测到 {len(changes)} 处变更: "
            f"{sum(1 for c in changes if c.change_type == 'added')} 新增, "
            f"{sum(1 for c in changes if c.change_type == 'removed')} 删除, "
            f"{sum(1 for c in changes if c.change_type == 'modified')} 修改"
        )

        added_count = sum(1 for c in changes if c.change_type == "added")
        removed_count = sum(1 for c in changes if c.change_type == "removed")
        modified_count = sum(1 for c in changes if c.change_type == "modified")
        logger.info(f"AntiDetectionAdvisor: {summary}")
        logger.debug(
            f"analyze_page_changes: result total={len(changes)} "
            f"added={added_count} removed={removed_count} modified={modified_count}"
        )

        return {"changes": changes, "summary": summary}

    def suggest_selector_updates(
        self, changes: List[SelectorChange]
    ) -> List[SelectorUpdateSuggestion]:
        """根据 DOM 变更建议选择器更新.

        Args:
            changes: analyze_page_changes 返回的变更列表

        Returns:
            选择器更新建议列表
        """
        logger.debug(
            f"suggest_selector_updates: enter changes_count={len(changes)}"
        )
        suggestions: List[SelectorUpdateSuggestion] = []

        for change in changes:
            if change.change_type == "removed":
                # 选择器被删除，建议用相似的选择器替代
                similar = self._find_similar_selector(change.selector, changes)
                if similar:
                    suggestions.append(
                        SelectorUpdateSuggestion(
                            old_selector=change.selector,
                            new_selector=similar,
                            reason=f"原选择器已删除，找到相似选择器替代",
                            confidence=0.6,
                        )
                    )
                    logger.debug(
                        f"suggest_selector_updates: removed→similar "
                        f"old={change.selector!r} new={similar!r} confidence=0.6"
                    )
                else:
                    suggestions.append(
                        SelectorUpdateSuggestion(
                            old_selector=change.selector,
                            new_selector="",
                            reason="原选择器已删除，未找到相似替代，需人工检查",
                            confidence=0.3,
                        )
                    )
                    logger.debug(
                        f"suggest_selector_updates: removed→manual_check "
                        f"old={change.selector!r} confidence=0.3 "
                        f"reason=no_similar_found"
                    )

            elif change.change_type == "modified":
                # 选择器被修改，建议更新
                suggestions.append(
                    SelectorUpdateSuggestion(
                        old_selector=change.selector,
                        new_selector=change.new_value,
                        reason=f"选择器属性已修改",
                        confidence=change.confidence,
                    )
                )
                logger.debug(
                    f"suggest_selector_updates: modified→update "
                    f"old={change.selector!r} new={change.new_value!r} "
                    f"confidence={change.confidence}"
                )

        if suggestions:
            avg_conf = sum(s.confidence for s in suggestions) / len(suggestions)
            logger.info(
                f"suggest_selector_updates: generated {len(suggestions)} suggestions "
                f"avg_confidence={avg_conf:.2f}"
            )
        else:
            logger.info(
                f"suggest_selector_updates: generated 0 suggestions "
                f"(no actionable changes)"
            )
        return suggestions

    async def validate_selector(self, page: Any, selector: str) -> bool:
        """验证选择器是否仍然有效.

        Args:
            page: Playwright Page 对象
            selector: CSS 选择器

        Returns:
            选择器是否有效
        """
        logger.debug(f"validate_selector: enter selector={selector!r}")
        try:
            element = await page.query_selector(selector)
            valid = element is not None
            logger.debug(
                f"validate_selector: result selector={selector!r} valid={valid} "
                f"element_found={element is not None}"
            )
            return valid
        except Exception as e:
            logger.debug(
                f"validate_selector: error selector={selector!r} error={e}"
            )
            return False

    def _extract_attributes(self, html: str) -> Dict[str, str]:
        """从 HTML 中提取 id 和 class 属性."""
        attrs = {}

        # 提取 id 属性
        for match in re.finditer(r'id="([^"]+)"', html):
            attrs[f"#{match.group(1)}"] = match.group(1)

        # 提取 class 属性
        for match in re.finditer(r'class="([^"]+)"', html):
            classes = match.group(1).split()
            for cls in classes:
                attrs[f".{cls}"] = cls

        return attrs

    def _find_similar_selector(
        self, removed_selector: str, changes: List[SelectorChange]
    ) -> Optional[str]:
        """在新增的选择器中找相似的."""
        for change in changes:
            if change.change_type == "added":
                # 简单的相似度判断：选择器前缀相同
                if (
                    removed_selector.startswith("#")
                    and change.selector.startswith("#")
                    or removed_selector.startswith(".")
                    and change.selector.startswith(".")
                ):
                    return change.selector
        return None
