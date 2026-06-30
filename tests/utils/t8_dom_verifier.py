"""T8 浏览器DOM验证标准框架 — 供FlowForge及所有*Forge项目复用。

按 prompts.md 第十三章标准模板实现：
- 13.0.2 T8 Web功能DOM验证标准案例

铁律T8：凡涉及网页操作的功能（发布/上架/部署等），必须操控浏览器查看DOM确认真实成功，
且对DOM内容调用LLM审核质量。

使用方式（任何项目的测试用例）：
    from flowforge.tests.utils.t8_dom_verifier import DOMVerifier

    verifier = DOMVerifier()
    result = await verifier.verify_page_dom(
        url="http://localhost:5174",
        selector="h1",
        expected_text="FlowForge",
        llm_verify=True,
    )
    assert result["found"], f"T8 DOM验证失败: {result['detail']}"

标准实现要点（参考prompts.md 13.0.2）：
1. 必须操控真实浏览器（playwright/selenium），禁止用requests模拟
2. 必须查看DOM内容确认真实成功，不能只看HTTP状态码
3. 对DOM内容调用LLM审核质量（T7+T8联合验证）
4. 记录截图证据（可选）
"""
import asyncio
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

# T8 DOM验证超时（秒）— 增加到60s避免Next.js开发服务器加载慢导致超时
T8_DOM_VERIFY_TIMEOUT = 60

# T8 LLM审核DOM内容超时（秒）
T8_LLM_VERIFY_TIMEOUT = 90


class DOMVerifier:
    """T8 浏览器DOM验证器 — 操控真实浏览器查看DOM确认真实成功。

    供FlowForge及所有*Forge项目测试用例复用。

    使用方式：
        verifier = DOMVerifier()
        result = await verifier.verify_page_dom(
            url="http://localhost:5174",
            selector="h1",
            expected_text="FlowForge",
        )
        assert result["found"]
    """

    def __init__(self, browser_type: str = "chromium"):
        self.browser_type = browser_type
        self.results: list[dict] = []
        self._playwright = None
        self._browser = None

    async def _ensure_browser(self):
        """确保浏览器实例可用（懒加载 + 失效后自动重建）。

        修复点：之前如果浏览器实例在某个测试失败后被关闭，
        self._browser 仍指向失效对象，后续 new_page 会抛出
        'NoneType' object has no attribute 'send'。
        现在通过 is_connected() 检测失效并自动重建。
        """
        # 检测现有实例是否仍然可用
        if self._browser is not None:
            try:
                # playwright Browser 提供 is_connected() 方法
                if self._browser.is_connected():
                    return self._browser
                # 已断开，清理后重建
                logger.warning("[T8] 浏览器实例已断开连接，尝试重建...")
                self._browser = None
            except Exception:
                # is_connected() 异常也视为失效
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
            logger.info(f"[T8] 浏览器启动成功: {self.browser_type}")
            return self._browser
        except ImportError:
            logger.error("[T8] playwright未安装，请运行: pip install playwright && playwright install chromium")
            raise
        except Exception as e:
            logger.error(f"[T8] 浏览器启动失败: {e}")
            raise

    async def verify_page_dom(
        self,
        url: str,
        selector: str = "",
        expected_text: str = "",
        llm_verify: bool = False,
        content_type: str = "页面内容",
        context: str = "",
        timeout: int = T8_DOM_VERIFY_TIMEOUT,
    ) -> dict:
        """验证页面DOM内容（T8）。

        操控真实浏览器访问url，查找selector对应的DOM元素，
        验证其文本内容是否包含expected_text。

        Args:
            url: 目标页面URL
            selector: CSS选择器（如 "h1", ".title", "#content"），空则验证整个body
            expected_text: 期望包含的文本（空则只验证元素存在）
            llm_verify: 是否对DOM内容调用LLM审核（T7+T8联合验证）
            content_type: 内容类型（供LLM审核使用）
            context: 上下文信息（供LLM审核使用）
            timeout: 页面加载超时（秒）

        Returns:
            dict: {
                "found": bool,          # DOM元素是否找到且文本匹配
                "dom_content": str,     # DOM文本内容
                "detail": str,          # 详情说明
                "llm_review": dict,     # LLM审核结果（llm_verify=True时）
                "screenshot_path": str, # 截图路径（可选）
            }
        """
        try:
            browser = await self._ensure_browser()
            try:
                page = await browser.new_page()
            except Exception as ne:
                # new_page 失败可能是浏览器实例已失效（is_connected误报True），
                # 强制重置并重建浏览器实例后重试一次。
                logger.warning(f"[T8] new_page失败，重建浏览器实例: {ne}")
                self._browser = None
                browser = await self._ensure_browser()
                page = await browser.new_page()
            try:
                logger.info(f"[T8] 访问页面: {url}")
                # 修复：Next.js开发服务器持续有网络活动（HMR/websocket），
                # networkidle 等待条件永远无法满足导致30s超时。
                # 改用 domcontentloaded，DOM就绪即可开始验证。
                await page.goto(url, timeout=timeout * 1000, wait_until="domcontentloaded")

                # 等待selector出现（如果指定了）
                if selector:
                    try:
                        await page.wait_for_selector(selector, timeout=10000)
                    except Exception:
                        pass  # selector可能不存在，继续验证

                # 获取DOM内容
                if selector:
                    elements = await page.query_selector_all(selector)
                    if not elements:
                        result = {
                            "found": False,
                            "dom_content": "",
                            "detail": f"未找到selector='{selector}'对应的DOM元素",
                            "llm_review": {},
                            "screenshot_path": "",
                        }
                        self.results.append({**result, "url": url, "selector": selector, "mode": "page_dom"})
                        return result
                    # 获取所有匹配元素的文本
                    texts = []
                    for elem in elements[:5]:  # 最多取前5个
                        text = await elem.text_content()
                        if text:
                            texts.append(text.strip())
                    dom_content = "\n".join(texts)
                else:
                    dom_content = await page.evaluate("() => document.body.innerText")

                # 验证文本是否包含期望内容
                found = True
                detail = ""
                if expected_text:
                    if expected_text not in dom_content:
                        found = False
                        detail = f"DOM内容中未找到期望文本 '{expected_text[:50]}'"
                    else:
                        detail = f"DOM内容包含期望文本 '{expected_text[:50]}'"
                else:
                    detail = f"DOM元素存在，内容长度={len(dom_content)}"

                # 截图（可选）
                screenshot_path = ""
                try:
                    import tempfile
                    from pathlib import Path
                    screenshot_dir = Path(tempfile.gettempdir()) / "t8_screenshots"
                    screenshot_dir.mkdir(parents=True, exist_ok=True)
                    screenshot_path = str(screenshot_dir / f"dom_verify_{len(self.results)}.png")
                    await page.screenshot(path=screenshot_path)
                except Exception as e:
                    logger.debug(f"[T8] 截图失败（非关键）: {e}")

                result = {
                    "found": found,
                    "dom_content": dom_content[:2000],  # 截断防止过长
                    "detail": detail,
                    "llm_review": {},
                    "screenshot_path": screenshot_path,
                }

                # T7+T8联合验证：对DOM内容调用LLM审核
                if llm_verify and found and dom_content:
                    review = await self._llm_review_dom(
                        dom_content, content_type, context or url
                    )
                    result["llm_review"] = review
                    if not review.get("passed", False):
                        result["found"] = False
                        result["detail"] += f" | LLM审核未通过: {review.get('reason', '')}"

                self.results.append({**result, "url": url, "selector": selector, "mode": "page_dom"})
                logger.info(f"[T8] DOM验证完成: found={found}, url={url}")
                return result

            finally:
                await page.close()
        except Exception as e:
            result = {
                "found": False,
                "dom_content": "",
                "detail": f"DOM验证执行失败: {e}",
                "llm_review": {},
                "screenshot_path": "",
            }
            self.results.append({**result, "url": url, "selector": selector, "mode": "page_dom"})
            logger.error(f"[T8] DOM验证异常: {e}")
            return result

    async def verify_api_response(
        self,
        url: str,
        method: str = "GET",
        expected_status: int = 200,
        expected_json_key: str = "",
        llm_verify: bool = False,
        content_type: str = "API响应",
        context: str = "",
    ) -> dict:
        """验证API响应（T8扩展 — 验证后端API的真实响应）。

        虽然T8主要针对网页DOM，但后端API是前端DOM的数据源，
        验证API响应的真实性也是T8的延伸。

        Args:
            url: API URL
            method: HTTP方法
            expected_status: 期望状态码
            expected_json_key: 期望包含的JSON key
            llm_verify: 是否对响应内容调用LLM审核
            content_type: 内容类型
            context: 上下文

        Returns:
            dict: 同 verify_page_dom
        """
        try:
            import httpx
            async with httpx.AsyncClient(timeout=T8_DOM_VERIFY_TIMEOUT) as client:
                logger.info(f"[T8] 调用API: {method} {url}")
                if method.upper() == "GET":
                    resp = await client.get(url)
                elif method.upper() == "POST":
                    resp = await client.post(url)
                else:
                    resp = await client.request(method, url)

                found = resp.status_code == expected_status
                detail = f"HTTP {resp.status_code} (期望 {expected_status})"

                dom_content = ""
                llm_review = {}
                if found:
                    try:
                        data = resp.json()
                        dom_content = str(data)[:2000]
                        if expected_json_key:
                            if expected_json_key not in str(data):
                                found = False
                                detail += f" | 响应中未找到key '{expected_json_key}'"
                            else:
                                detail += f" | 响应包含key '{expected_json_key}'"
                        if llm_verify:
                            llm_review = await self._llm_review_dom(
                                dom_content, content_type, context or url
                            )
                            if not llm_review.get("passed", False):
                                found = False
                                detail += f" | LLM审核未通过: {llm_review.get('reason', '')}"
                    except Exception:
                        dom_content = resp.text[:2000]
                        detail += " | 响应非JSON"

                result = {
                    "found": found,
                    "dom_content": dom_content,
                    "detail": detail,
                    "llm_review": llm_review,
                    "screenshot_path": "",
                }
                self.results.append({**result, "url": url, "selector": "", "mode": "api_response"})
                logger.info(f"[T8] API验证完成: found={found}, status={resp.status_code}")
                return result

        except Exception as e:
            result = {
                "found": False,
                "dom_content": "",
                "detail": f"API验证执行失败: {e}",
                "llm_review": {},
                "screenshot_path": "",
            }
            self.results.append({**result, "url": url, "selector": "", "mode": "api_response"})
            logger.error(f"[T8] API验证异常: {e}")
            return result

    async def _llm_review_dom(self, content: str, content_type: str, context: str) -> dict:
        """对DOM内容调用LLM审核（T7+T8联合验证）。"""
        try:
            from .t7_reviewer import T7Reviewer
            reviewer = T7Reviewer()
            result = await reviewer.review(
                content=content,
                context=context,
                content_type=content_type,
            )
            return result
        except Exception as e:
            logger.error(f"[T8] LLM审核DOM内容失败: {e}")
            return {"passed": False, "reason": f"LLM审核失败: {e}", "verdict": "ERROR"}

    def report(self) -> str:
        """生成T8验证报告。"""
        if not self.results:
            return "[T8] 无DOM验证记录"
        lines = ["\n[T8] 浏览器DOM验证报告:"]
        found = sum(1 for r in self.results if r.get("found"))
        lines.append(f"DOM验证: {found}/{len(self.results)} 通过")
        for r in self.results:
            icon = "PASS" if r.get("found") else "FAIL"
            lines.append(
                f"  [{r.get('mode', '?')}] {r.get('url', '')[:40]} "
                f"-> {icon} {r.get('detail', '')[:60]}"
            )
        return "\n".join(lines)

    async def close(self):
        """关闭浏览器实例。"""
        if self._browser:
            await self._browser.close()
            self._browser = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None
