"""T8 v3 测试工具函数 — 供 8 层验证体系共用。

按 WEB-FUSION-DESIGN.md §13.2 规范实现：
- BrowserManager: 浏览器生命周期管理（懒加载，参考 DOMVerifier 模式）
- wait_for_selector_safe: 安全等待选择器（失败返回 None 而非抛异常）
- assert_element_visible: 断言元素可见（T3: 必须有具体断言）
- get_bbox_size: 获取元素 bounding box 尺寸
- count_elements: 统计匹配选择器的元素数量
- goto_safe: 安全跳转（使用 domcontentloaded 避免 Next.js HMR 超时）

设计原则：
- 所有函数返回可断言的值（bool/None/int/dict），不在内部抛异常
- 超时设置合理（5-10 秒，避免拖慢测试）
- 复用 domcontentloaded 等待条件（参考 t8_dom_verifier.py）
- BrowserManager 懒加载浏览器实例，避免与 pytest-asyncio 事件循环冲突
"""
from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


class BrowserManager:
    """浏览器生命周期管理器 — 懒加载模式（参考 DOMVerifier）。

    避免 module-scoped fixture 中使用 run_until_complete 与 pytest-asyncio 冲突。
    浏览器实例在首次 new_page() 时启动，模块结束时调用 close() 释放。

    使用方式：
        manager = BrowserManager()  # sync 构造，不启动浏览器
        page = await manager.new_page()  # 首次调用时启动浏览器
        # ... 使用 page ...
        await manager.close()  # 模块结束时释放
    """

    def __init__(self, browser_type: str = "chromium"):
        self.browser_type = browser_type
        self._playwright = None
        self._browser = None

    async def _ensure_browser(self):
        """确保浏览器实例可用（懒加载 + 失效后自动重建）。"""
        # 检测现有实例是否仍然可用
        if self._browser is not None:
            try:
                if self._browser.is_connected():
                    return self._browser
                logger.warning("[BrowserManager] 浏览器实例已断开，尝试重建...")
                self._browser = None
            except Exception:
                self._browser = None

        # 清理可能残留的 playwright 实例
        if self._playwright is not None:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None

        try:
            from playwright.async_api import async_playwright
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(headless=True)
            logger.info(f"[BrowserManager] 浏览器启动成功: {self.browser_type}")
            return self._browser
        except ImportError:
            logger.error(
                "[BrowserManager] playwright 未安装，请运行: "
                "pip install playwright && playwright install chromium"
            )
            raise
        except Exception as e:
            logger.error(f"[BrowserManager] 浏览器启动失败: {e}")
            raise

    async def new_page(self):
        """创建新页面（首次调用时启动浏览器）。"""
        browser = await self._ensure_browser()
        try:
            return await browser.new_page()
        except Exception as ne:
            # new_page 失败可能是浏览器实例已失效，强制重置并重建后重试一次
            logger.warning(f"[BrowserManager] new_page 失败，重建浏览器实例: {ne}")
            self._browser = None
            browser = await self._ensure_browser()
            return await browser.new_page()

    async def close(self):
        """关闭浏览器实例（模块结束时调用）。"""
        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None
        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None

# 默认选择器等待超时（毫秒）— 5 秒避免拖慢测试
DEFAULT_SELECTOR_TIMEOUT_MS = 5000

# 默认页面跳转超时（毫秒）— 10 秒避免 Next.js 开发模式慢加载
DEFAULT_GOTO_TIMEOUT_MS = 10000


async def goto_safe(page, url: str, timeout_ms: int = DEFAULT_GOTO_TIMEOUT_MS) -> bool:
    """安全跳转到指定 URL。

    使用 domcontentloaded 等待条件（参考 t8_dom_verifier.py），
    避免 Next.js HMR/websocket 持续网络活动导致 networkidle 永远不满足。

    Args:
        page: Playwright Page 对象
        url: 目标 URL
        timeout_ms: 超时（毫秒）

    Returns:
        bool: 跳转是否成功
    """
    try:
        await page.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
        return True
    except Exception as e:
        logger.warning(f"goto_safe 跳转失败 url={url}: {e}")
        return False


async def wait_for_selector_safe(
    page,
    selector: str,
    timeout_ms: int = DEFAULT_SELECTOR_TIMEOUT_MS,
) -> Optional[Any]:
    """安全等待选择器出现。

    失败时返回 None 而非抛异常，便于上层做断言。

    Args:
        page: Playwright Page 对象
        selector: CSS 选择器
        timeout_ms: 超时（毫秒）

    Returns:
        ElementHandle 或 None（未找到）
    """
    try:
        element = await page.wait_for_selector(selector, timeout=timeout_ms)
        return element
    except Exception as e:
        logger.debug(f"wait_for_selector_safe 未找到 selector='{selector}': {e}")
        return None


async def query_selector_safe(page, selector: str) -> Optional[Any]:
    """安全查询单个选择器（不等待，立即返回）。

    Args:
        page: Playwright Page 对象
        selector: CSS 选择器

    Returns:
        ElementHandle 或 None
    """
    try:
        return await page.query_selector(selector)
    except Exception as e:
        logger.debug(f"query_selector_safe 异常 selector='{selector}': {e}")
        return None


async def query_selector_all_safe(page, selector: str) -> list[Any]:
    """安全查询所有匹配选择器（不等待，立即返回）。

    Args:
        page: Playwright Page 对象
        selector: CSS 选择器

    Returns:
        ElementHandle 列表（可能为空）
    """
    try:
        return await page.query_selector_all(selector)
    except Exception as e:
        logger.debug(f"query_selector_all_safe 异常 selector='{selector}': {e}")
        return []


async def assert_element_visible(
    page,
    selector: str,
    timeout_ms: int = DEFAULT_SELECTOR_TIMEOUT_MS,
) -> tuple[bool, str]:
    """断言元素可见 — 返回 (是否可见, 详情说明)。

    T3 铁律：必须有具体断言。此函数返回可断言的元组，
    上层用 assert result[0], result[1] 形式断言。

    Args:
        page: Playwright Page 对象
        selector: CSS 选择器
        timeout_ms: 超时（毫秒）

    Returns:
        (visible: bool, detail: str)
    """
    element = await wait_for_selector_safe(page, selector, timeout_ms)
    if element is None:
        return False, f"未找到元素 selector='{selector}'"
    try:
        is_visible = await element.is_visible()
        if is_visible:
            return True, f"元素可见 selector='{selector}'"
        return False, f"元素存在但不可见 selector='{selector}'"
    except Exception as e:
        return False, f"检查可见性异常 selector='{selector}': {e}"


async def get_bbox_size(page, selector: str) -> Optional[dict[str, float]]:
    """获取元素 bounding box 尺寸。

    Args:
        page: Playwright Page 对象
        selector: CSS 选择器

    Returns:
        {"width": float, "height": float, "x": float, "y": float} 或 None
    """
    element = await query_selector_safe(page, selector)
    if element is None:
        return None
    try:
        bbox = await element.bounding_box()
        if bbox is None:
            return None
        return {"width": bbox["width"], "height": bbox["height"], "x": bbox["x"], "y": bbox["y"]}
    except Exception as e:
        logger.debug(f"get_bbox_size 异常 selector='{selector}': {e}")
        return None


async def count_elements(page, selector: str) -> int:
    """统计匹配选择器的元素数量。

    Args:
        page: Playwright Page 对象
        selector: CSS 选择器

    Returns:
        元素数量（0 表示无匹配或异常）
    """
    elements = await query_selector_all_safe(page, selector)
    return len(elements)


async def get_attribute_safe(page, selector: str, attr: str) -> Optional[str]:
    """安全获取元素属性值。

    Args:
        page: Playwright Page 对象
        selector: CSS 选择器
        attr: 属性名（如 "data-active", "data-mode"）

    Returns:
        属性值字符串或 None
    """
    element = await query_selector_safe(page, selector)
    if element is None:
        return None
    try:
        return await element.get_attribute(attr)
    except Exception as e:
        logger.debug(f"get_attribute_safe 异常 selector='{selector}' attr='{attr}': {e}")
        return None


async def get_body_text(page) -> str:
    """获取 body 的 innerText。

    Args:
        page: Playwright Page 对象

    Returns:
        body 文本内容（异常时返回空字符串）
    """
    try:
        return await page.evaluate("() => document.body.innerText")
    except Exception as e:
        logger.debug(f"get_body_text 异常: {e}")
        return ""


async def get_computed_style(page, js_expr: str, prop: str) -> str:
    """获取元素的计算样式。

    Args:
        page: Playwright Page 对象
        js_expr: JS 选择器表达式（如 "document.body"）
        prop: CSS 属性名（如 "backgroundColor", "fontFamily"）

    Returns:
        CSS 属性值字符串（异常时返回空字符串）
    """
    try:
        return await page.evaluate(
            f"() => getComputedStyle({js_expr}).{prop}"
        )
    except Exception as e:
        logger.debug(f"get_computed_style 异常 prop='{prop}': {e}")
        return ""


async def click_safe(page, selector: str, timeout_ms: int = DEFAULT_SELECTOR_TIMEOUT_MS) -> bool:
    """安全点击元素。

    Args:
        page: Playwright Page 对象
        selector: CSS 选择器
        timeout_ms: 超时（毫秒）

    Returns:
        bool: 点击是否成功
    """
    try:
        await page.click(selector, timeout=timeout_ms)
        return True
    except Exception as e:
        logger.warning(f"click_safe 点击失败 selector='{selector}': {e}")
        return False


async def wait_for_url_contains(page, fragment: str, timeout_ms: int = DEFAULT_SELECTOR_TIMEOUT_MS) -> bool:
    """等待 URL 中包含指定片段（用于重定向验证）。

    Args:
        page: Playwright Page 对象
        fragment: URL 片段（如 "/solo", "mode=council"）
        timeout_ms: 超时（毫秒）

    Returns:
        bool: URL 是否包含指定片段
    """
    try:
        await page.wait_for_url(f"*{fragment}*", timeout=timeout_ms)
        return True
    except Exception as e:
        logger.debug(f"wait_for_url_contains 异常 fragment='{fragment}': {e}")
        return False


async def take_screenshot_safe(page, full_page: bool = True) -> Optional[bytes]:
    """安全截图。

    Args:
        page: Playwright Page 对象
        full_page: 是否截整页

    Returns:
        截图二进制数据或 None
    """
    try:
        return await page.screenshot(full_page=full_page)
    except Exception as e:
        logger.warning(f"take_screenshot_safe 截图失败: {e}")
        return None


def build_url(base_url: str, route: str) -> str:
    """构建完整 URL（处理 base_url 末尾斜杠和 route 开头斜杠）。

    Args:
        base_url: 基础 URL（如 "http://localhost:5174"）
        route: 路由（如 "/admin/agents"）

    Returns:
        完整 URL（如 "http://localhost:5174/admin/agents"）
    """
    return base_url.rstrip("/") + "/" + route.lstrip("/")
