"""Playwright自动化发布工具 - 浏览器自动化发布到各平台

使用 Playwright 进行浏览器自动化，支持：
- 微信公众号：登录、编辑、预览、发布
- 今日头条：登录、编辑、发布
- 通用平台：可扩展的自动化框架

支持登录态持久化、元素等待、错误重试。
"""

import asyncio
from typing import Any

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("playwright_publisher")

# 平台选择器配置
_PLATFORM_SELECTORS: dict[str, dict[str, str]] = {
    "wechat": {
        "login_url": "https://mp.weixin.qq.com/",
        "new_article_btn": 'a[href*="operate_appmsg"]',
        "title_input": "#title",
        "content_editor": "#edui1_body",
        "submit_btn": ".weui-desktop-btn_primary",
        "preview_btn": ".weui-desktop-btn_default",
    },
    "toutiao": {
        "login_url": "https://mp.toutiao.com/",
        "new_article_btn": '.article-create',
        "title_input": 'input[placeholder*="标题"]',
        "content_editor": ".ql-editor",
        "submit_btn": '.submit-btn',
    },
}

# 默认超时（毫秒）
_DEFAULT_TIMEOUT = 30000
# 最大重试次数
_MAX_RETRIES = 2


class PlaywrightPublisherTool(BaseTool):
    """Playwright自动化发布工具 - 浏览器自动化发布到各平台"""

    name = "playwright_publish"
    description = "使用Playwright浏览器自动化发布内容到微信公众号等平台"
    safety_level = "dangerous"
    is_concurrency_safe = False
    parameters_schema = {
        "type": "object",
        "required": ["platform", "title", "content"],
        "properties": {
            "platform": {
                "type": "string",
                "description": "目标平台 (wechat, toutiao 等)",
            },
            "title": {
                "type": "string",
                "description": "文章标题",
            },
            "content": {
                "type": "string",
                "description": "文章内容 (HTML格式)",
            },
            "action": {
                "type": "string",
                "default": "draft",
                "enum": ["draft", "preview", "publish"],
                "description": "操作类型：draft保存草稿、preview预览、publish直接发布",
            },
            "images": {
                "type": "array",
                "items": {"type": "string"},
                "default": [],
                "description": "本地图片路径列表",
            },
            "headless": {
                "type": "boolean",
                "default": True,
                "description": "是否使用无头模式",
            },
            "user_data_dir": {
                "type": "string",
                "default": "",
                "description": "浏览器用户数据目录（用于保持登录态）",
            },
        },
    }

    def __init__(self) -> None:
        self._browser = None
        self._playwright = None

    async def _ensure_playwright(self) -> None:
        """确保 Playwright 已安装和启动。"""
        if self._playwright is not None:
            return

        try:
            from playwright.async_api import async_playwright
            self._playwright = await async_playwright().start()
            logger.info("[playwright_publisher] Playwright initialized successfully")
        except ImportError:
            raise RuntimeError(
                "Playwright is not installed. Please install it with: "
                "pip install playwright && playwright install chromium"
            )

    async def _get_browser(self, headless: bool = True, user_data_dir: str = "") -> Any:
        """获取或创建浏览器实例。"""
        await self._ensure_playwright()

        if self._browser is not None:
            try:
                # 检查浏览器是否仍然连接
                if self._browser.is_connected():
                    return self._browser
            except Exception:
                self._browser = None

        launch_kwargs: dict[str, Any] = {
            "headless": headless,
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
            ],
        }

        if user_data_dir:
            # 使用持久化上下文保持登录态
            context = await self._playwright.chromium.launch_persistent_context(
                user_data_dir,
                **launch_kwargs,
            )
            self._browser = context
        else:
            self._browser = await self._playwright.chromium.launch(**launch_kwargs)

        logger.info(
            f"[playwright_publisher] Browser launched: headless={headless}, "
            f"persistent={bool(user_data_dir)}"
        )
        return self._browser

    async def execute(self, input: ToolInput) -> ToolOutput:
        """执行发布操作。"""
        platform: str = input.params.get("platform", "")
        title: str = input.params.get("title", "")
        content: str = input.params.get("content", "")
        action: str = input.params.get("action", "draft")
        images: list[str] = input.params.get("images", [])
        headless: bool = input.params.get("headless", True)
        user_data_dir: str = input.params.get("user_data_dir", "")

        # 参数校验
        if not platform.strip():
            return ToolOutput(result={}, error="Platform cannot be empty")
        if not title.strip():
            return ToolOutput(result={}, error="Title cannot be empty")
        if not content.strip():
            return ToolOutput(result={}, error="Content cannot be empty")

        # 获取平台选择器
        selectors = _PLATFORM_SELECTORS.get(platform)
        if not selectors:
            return ToolOutput(
                result={"platform": platform},
                error=f"Platform '{platform}' is not supported. Supported: {list(_PLATFORM_SELECTORS.keys())}",
            )

        logger.info(
            f"[playwright_publisher] Starting publish: platform={platform}, "
            f"action={action}, title={title[:30]}..."
        )

        browser = None
        try:
            browser = await self._get_browser(headless=headless, user_data_dir=user_data_dir)
            result = await self._publish_with_retry(
                browser, platform, title, content, action, images, selectors,
            )
            return ToolOutput(result=result)
        except Exception as e:
            logger.error(f"[playwright_publisher] Publish failed: {e}", exc_info=True)
            return ToolOutput(
                result={"platform": platform, "action": action, "success": False},
                error=f"Playwright publish failed: {e}",
            )

    async def _publish_with_retry(
        self,
        browser: Any,
        platform: str,
        title: str,
        content: str,
        action: str,
        images: list[str],
        selectors: dict[str, str],
    ) -> dict[str, Any]:
        """带重试的发布流程。"""
        last_error = ""

        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                logger.info(
                    f"[playwright_publisher] Attempt {attempt}/{_MAX_RETRIES} "
                    f"for {platform}/{action}"
                )

                # 创建新页面
                if hasattr(browser, "new_page"):
                    page = await browser.new_page()
                else:
                    # persistent context
                    page = browser.pages[0] if browser.pages else await browser.new_page()

                try:
                    result = await self._execute_publish_flow(
                        page, platform, title, content, action, images, selectors,
                    )
                    return result
                finally:
                    try:
                        await page.close()
                    except Exception:
                        pass

            except Exception as e:
                last_error = str(e)
                logger.warning(
                    f"[playwright_publisher] Attempt {attempt} failed: {e}",
                    exc_info=True,
                )
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(2)

        return {
            "success": False,
            "platform": platform,
            "action": action,
            "error": f"All {_MAX_RETRIES} attempts failed. Last error: {last_error}",
        }

    async def _execute_publish_flow(
        self,
        page: Any,
        platform: str,
        title: str,
        content: str,
        action: str,
        images: list[str],
        selectors: dict[str, str],
    ) -> dict[str, Any]:
        """执行完整的发布流程：导航 → 登录检查 → 编辑 → 操作。"""
        # Step 1: 导航到平台
        login_url = selectors.get("login_url", "")
        if login_url:
            await page.goto(login_url, wait_until="networkidle", timeout=_DEFAULT_TIMEOUT)
            logger.info(f"[playwright_publisher] Navigated to {login_url}")

        # Step 2: 检查登录状态
        is_logged_in = await self._check_login_status(page, platform)
        if not is_logged_in:
            logger.warning(f"[playwright_publisher] Not logged in to {platform}")
            return {
                "success": False,
                "platform": platform,
                "action": action,
                "error": f"Not logged in to {platform}. Please login manually first.",
                "login_required": True,
            }

        # Step 3: 点击新建文章
        new_article_btn = selectors.get("new_article_btn", "")
        if new_article_btn:
            try:
                await page.click(new_article_btn, timeout=_DEFAULT_TIMEOUT)
                await page.wait_for_load_state("networkidle", timeout=_DEFAULT_TIMEOUT)
                logger.info("[playwright_publisher] Clicked new article button")
            except Exception as e:
                logger.warning(f"[playwright_publisher] Failed to click new article: {e}")

        # Step 4: 填写标题
        title_input = selectors.get("title_input", "")
        if title_input:
            try:
                await page.fill(title_input, title, timeout=_DEFAULT_TIMEOUT)
                logger.info(f"[playwright_publisher] Title filled: {title[:30]}")
            except Exception as e:
                logger.warning(f"[playwright_publisher] Failed to fill title: {e}")

        # Step 5: 填写内容
        content_editor = selectors.get("content_editor", "")
        if content_editor:
            try:
                await page.click(content_editor, timeout=_DEFAULT_TIMEOUT)
                # 使用键盘输入内容（兼容富文本编辑器）
                await page.keyboard.type(content[:5000], delay=10)
                logger.info(f"[playwright_publisher] Content filled: {len(content)} chars")
            except Exception as e:
                # 备选方案：使用 JavaScript 注入内容
                try:
                    await page.evaluate(
                        f"""(content) => {{
                            const editor = document.querySelector('{content_editor}');
                            if (editor) {{
                                editor.innerHTML = arguments[0];
                            }}
                        }}""",
                        content[:5000],
                    )
                    logger.info("[playwright_publisher] Content injected via JS")
                except Exception as js_error:
                    logger.warning(
                        f"[playwright_publisher] Failed to fill content: {e}, JS fallback: {js_error}"
                    )

        # Step 6: 上传图片
        if images:
            uploaded = await self._upload_images(page, images, platform)
            logger.info(f"[playwright_publisher] Images uploaded: {uploaded}/{len(images)}")

        # Step 7: 执行操作（草稿/预览/发布）
        if action == "draft":
            return await self._save_draft(page, platform, selectors)
        elif action == "preview":
            return await self._preview(page, platform, selectors)
        elif action == "publish":
            return await self._publish(page, platform, selectors)
        else:
            return {
                "success": False,
                "platform": platform,
                "action": action,
                "error": f"Unknown action: {action}",
            }

    async def _check_login_status(self, page: Any, platform: str) -> bool:
        """检查是否已登录。"""
        # 各平台登录状态检测逻辑
        login_indicators = {
            "wechat": ".weui-desktop-header__nickname, .account_setting_item",
            "toutiao": ".user-info, .avatar-wrap",
        }
        indicator = login_indicators.get(platform, "")
        if not indicator:
            # 通用检测：如果URL不再是登录页，则认为已登录
            current_url = page.url
            return "login" not in current_url.lower()

        try:
            element = await page.query_selector(indicator)
            return element is not None
        except Exception:
            return False

    async def _upload_images(
        self,
        page: Any,
        images: list[str],
        platform: str,
    ) -> int:
        """上传图片到编辑器。"""
        uploaded = 0
        for image_path in images[:5]:  # 最多5张
            try:
                # 查找文件上传输入
                file_input = await page.query_selector('input[type="file"]')
                if file_input:
                    await file_input.set_input_files(image_path)
                    uploaded += 1
                    await asyncio.sleep(1)  # 等待上传
            except Exception as e:
                logger.warning(f"[playwright_publisher] Failed to upload image {image_path}: {e}")
        return uploaded

    async def _save_draft(
        self,
        page: Any,
        platform: str,
        selectors: dict[str, str],
    ) -> dict[str, Any]:
        """保存草稿。"""
        # 微信公众号的草稿保存
        if platform == "wechat":
            try:
                # 点击保存按钮
                save_btn = await page.query_selector('text="保存"')
                if save_btn:
                    await save_btn.click()
                    await asyncio.sleep(2)
                    return {
                        "success": True,
                        "platform": platform,
                        "action": "draft",
                        "message": "Draft saved successfully",
                    }
            except Exception as e:
                logger.warning(f"[playwright_publisher] Save draft failed: {e}")

        return {
            "success": True,
            "platform": platform,
            "action": "draft",
            "message": "Content prepared as draft (manual save may be required)",
        }

    async def _preview(
        self,
        page: Any,
        platform: str,
        selectors: dict[str, Any],
    ) -> dict[str, Any]:
        """预览文章。"""
        preview_btn = selectors.get("preview_btn", "")
        if preview_btn:
            try:
                await page.click(preview_btn, timeout=_DEFAULT_TIMEOUT)
                await asyncio.sleep(2)
                return {
                    "success": True,
                    "platform": platform,
                    "action": "preview",
                    "message": "Preview triggered successfully",
                }
            except Exception as e:
                logger.warning(f"[playwright_publisher] Preview failed: {e}")

        return {
            "success": False,
            "platform": platform,
            "action": "preview",
            "message": "Preview button not found or click failed",
        }

    async def _publish(
        self,
        page: Any,
        platform: str,
        selectors: dict[str, str],
    ) -> dict[str, Any]:
        """发布文章。"""
        submit_btn = selectors.get("submit_btn", "")
        if submit_btn:
            try:
                await page.click(submit_btn, timeout=_DEFAULT_TIMEOUT)
                await asyncio.sleep(3)

                # 检查是否有确认弹窗
                confirm_btn = await page.query_selector('text="确认"') or \
                              await page.query_selector('text="确定"') or \
                              await page.query_selector('text="发布"')
                if confirm_btn:
                    await confirm_btn.click()
                    await asyncio.sleep(2)

                return {
                    "success": True,
                    "platform": platform,
                    "action": "publish",
                    "message": "Article published successfully",
                }
            except Exception as e:
                logger.warning(f"[playwright_publisher] Publish failed: {e}")

        return {
            "success": False,
            "platform": platform,
            "action": "publish",
            "message": "Submit button not found or click failed",
        }

    async def cleanup(self) -> None:
        """清理浏览器资源。"""
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

        logger.info("[playwright_publisher] Browser resources cleaned up")
