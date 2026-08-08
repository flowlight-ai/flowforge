"""T7 LLM 审核 DOM 可用性模块 — 供 T8 v3 测试 L8 层调用。

按 WEB-FUSION-DESIGN.md §13.2 L8 层规范实现：
- 对关键页面截图调用真实 LLM 审核可用性（T1: 禁止 Mock LLM）
- LLM 返回 passed/reason/score 三元组，便于程序解析
- 复用 T7Reviewer 的 API Key 解析逻辑与 OpenRoute 通道

铁律 T7：凡 LLM 生成的内容必须经 LLM 审核通过。
铁律 T8：Web 功能必须操控浏览器验证 DOM，且对 DOM 内容调用 LLM 审核质量。

使用方式：
    from flowforge.tests.e2e.libs.t7_llm_auditor import T7LLMAuditor

    auditor = T7LLMAuditor()
    result = await auditor.audit_dom_usability(
        screenshot=png_bytes,
        route="/admin/agents",
        criteria=["布局是否完整", "是否有视觉破损"],
    )
    assert result.passed, f"DOM 可用性审核失败: {result.reason}"
"""
from __future__ import annotations

import base64
import logging
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# LLM 审核 DOM 单次调用超时（秒）— 视觉模型响应可能较慢
T7_AUDIT_TIMEOUT_SECONDS = 180

# LLM 审核重试次数（小模型可能不遵守格式）
T7_AUDIT_MAX_RETRIES = 3

# T7 DOM 审核 system message — 强格式约束
T7_AUDIT_SYSTEM_MESSAGE = (
    "你是严格的 Web 可用性审核员。你的唯一输出格式是：\n"
    "VERDICT: PASS\n"
    "SCORE: <0-1 之间的浮点数>\n"
    "REASON: <简短原因>\n"
    "或\n"
    "VERDICT: FAIL\n"
    "SCORE: <0-1 之间的浮点数>\n"
    "REASON: <简短原因>\n"
    "\n"
    "禁止输出任何说明性文字、问候、解释、前言。"
    "第一行必须是 VERDICT: PASS 或 VERDICT: FAIL。"
)

# T7 DOM 审核提示词模板
T7_AUDIT_PROMPT = """你是严格的 Web 可用性审核员。请审核以下页面截图的 DOM 可用性。

【页面路由】
{route}

【审核维度】
{criteria_text}

【审核原则】
- 布局完整：必须有顶部导航/侧边栏/主内容区的基本结构
- 视觉无破损：无明显元素重叠、溢出、错位、空白区域过大
- 可用性达标：符合现代 Web 应用的可用性标准（按钮可点击、文字可读）
- 不暴露测试元素：不应在页面中显示 T7/T8/test 等测试相关字样
- 内容充实：页面应有实质内容，不能是空白页或加载失败页

【输出格式】严格按以下格式输出，禁止输出任何其他内容：
VERDICT: PASS
SCORE: <0-1>
REASON: <原因>

或

VERDICT: FAIL
SCORE: <0-1>
REASON: <原因>

注意：第一行必须是 VERDICT: PASS 或 VERDICT: FAIL，不要输出前言、问候、解释。
"""


@dataclass
class AuditResult:
    """LLM 审核 DOM 可用性结果。

    Attributes:
        passed: 审核是否通过（verdict == "PASS"）
        reason: 审核原因（仅记录，不参与判定）
        score: 可用性评分（0-1 之间，越高越好）
        verdict: 原始判定值 PASS/FAIL
        raw_response: LLM 原始响应（截断保留前 500 字符）
        review_model: 实际使用的审核模型
    """
    passed: bool = False
    reason: str = ""
    score: float = 0.0
    verdict: str = ""
    raw_response: str = ""
    review_model: str = ""


class T7LLMAuditor:
    """T7 LLM 审核 DOM 可用性 — 调用真实 LLM 审核截图可用性。

    供 T8 v3 测试 L8 层使用。复用 T7Reviewer 的 API Key 解析逻辑，
    但发送视觉+文本混合请求（截图 base64 + 审核维度）。

    使用方式：
        auditor = T7LLMAuditor()
        result = await auditor.audit_dom_usability(
            screenshot=png_bytes,
            route="/admin/agents",
            criteria=["布局是否完整", "是否有视觉破损"],
        )
        assert result.passed
    """

    def __init__(
        self,
        openroute_base: str = "http://127.0.0.1:13001",
        model: str = "GLM-5.1",
        api_key: str = "",
    ):
        self.openroute_base = openroute_base.rstrip("/")
        # 默认使用 GLM-5.1（与 T7Reviewer 保持一致，Doubao 通道当前超时）
        self.model = model
        self.api_key = api_key or self._resolve_api_key()
        self.results: list[AuditResult] = []

    @staticmethod
    def _resolve_api_key() -> str:
        """从 flowforge config 或环境变量自动解析 OpenRoute API Key。

        复用 T7Reviewer 的解析逻辑：优先 models.yaml，环境变量备选。
        路径计算：本文件在 flowforge/tests/e2e/libs/ 下，
        parents[4] = openclaw（项目根），然后查找 flowforge/config/models.yaml。
        """
        import os
        from pathlib import Path

        # 1. 优先从 flowforge/config/models.yaml 的 api_key_default 读取
        try:
            import yaml
            # 本文件路径: flowforge/tests/e2e/libs/t7_llm_auditor.py
            # parents[0]=libs, [1]=e2e, [2]=tests, [3]=flowforge, [4]=openclaw(项目根)
            project_root = Path(__file__).resolve().parents[4]
            models_yaml = project_root / "flowforge" / "config" / "models.yaml"
            if not models_yaml.exists():
                # 退化：尝试从 flowforge 目录向上找
                models_yaml = Path(__file__).resolve().parents[3] / "config" / "models.yaml"
            if models_yaml.exists():
                with open(models_yaml, "r", encoding="utf-8") as f:
                    cfg = yaml.safe_load(f) or {}
                providers = cfg.get("providers", {})
                or_cfg = providers.get("openroute", {}) if isinstance(providers, dict) else {}
                default_key = or_cfg.get("api_key_default", "")
                if default_key:
                    return default_key
        except Exception as e:
            logger.warning(f"T7Auditor 加载 API Key 失败: {e}")
        # 2. 环境变量备选
        for env_var in ("OPENROUTE_API_KEY", "OR_API_KEY"):
            val = os.getenv(env_var, "").strip()
            if val:
                return val
        return ""

    async def audit_dom_usability(
        self,
        screenshot: bytes,
        route: str,
        criteria: list[str] | None = None,
        model: str = "",
        dom_text: str = "",
    ) -> AuditResult:
        """调用 LLM 审核截图的 DOM 可用性。

        优先尝试视觉模式（截图 base64），若 LLM 不支持视觉或返回"无法回答"，
        自动降级为文本模式（发送 DOM 文本内容审核）。

        Args:
            screenshot: 页面截图二进制数据（PNG/JPEG）
            route: 页面路由（如 "/admin/agents"）供 LLM 上下文参考
            criteria: 审核维度列表（如 ["布局是否完整", "是否有视觉破损"]）
            model: 指定审核模型（覆盖默认）
            dom_text: 页面 DOM 文本内容（body innerText），用于视觉降级时的文本审核

        Returns:
            AuditResult: 含 passed/reason/score 的审核结果
        """
        if not screenshot and not dom_text:
            result = AuditResult(
                passed=False,
                reason="截图和 DOM 文本均为空",
                score=0.0,
                verdict="FAIL",
                review_model="rule-based",
            )
            self.results.append(result)
            return result

        if criteria is None:
            criteria = [
                "布局是否完整（有顶部导航、侧边栏、主内容区）",
                "是否有明显的视觉破损或元素重叠",
                "是否符合现代 Web 应用的可用性标准",
                "是否暴露了测试相关元素（如 T7/T8 字样）",
            ]

        criteria_text = "\n".join(f"{i+1}. {c}" for i, c in enumerate(criteria))
        use_model = model or self.model

        # 优先尝试视觉模式（如果有截图）
        if screenshot:
            vision_result = await self._audit_with_vision(
                screenshot=screenshot,
                route=route,
                criteria_text=criteria_text,
                use_model=use_model,
            )
            # 视觉模式成功（VERDICT 可解析且非视觉能力不足）
            vision_failure_keywords = (
                "无法回答", "未提供", "截图", "看不到", "无法看到",
                "没有图片", "无图片", "无法识别图片", "不支持图片",
            )
            is_vision_failure = (
                not vision_result.verdict
                or any(kw in vision_result.reason for kw in vision_failure_keywords)
            )
            if not is_vision_failure:
                self.results.append(vision_result)
                return vision_result
            logger.warning(
                f"[T7Auditor] 视觉模式失败（LLM 可能不支持视觉），降级为文本模式: {vision_result.reason[:80]}"
            )

        # 降级：文本模式（发送 DOM 文本内容）
        if dom_text:
            text_result = await self._audit_with_text(
                dom_text=dom_text,
                route=route,
                criteria_text=criteria_text,
                use_model=use_model,
            )
            self.results.append(text_result)
            return text_result

        # 视觉失败且无 DOM 文本，返回视觉模式的结果
        if screenshot:
            self.results.append(vision_result)
            return vision_result

        # 不应到达此处
        result = AuditResult(
            passed=False,
            reason="审核失败: 无可用输入",
            score=0.0,
            verdict="FAIL",
        )
        self.results.append(result)
        return result

    async def _audit_with_vision(
        self,
        screenshot: bytes,
        route: str,
        criteria_text: str,
        use_model: str,
    ) -> AuditResult:
        """视觉模式审核 — 发送截图 base64 给 LLM。"""
        prompt = T7_AUDIT_PROMPT.format(route=route, criteria_text=criteria_text)
        screenshot_b64 = base64.b64encode(screenshot).decode("utf-8")
        review_model = use_model
        last_error = ""

        for attempt in range(1, T7_AUDIT_MAX_RETRIES + 1):
            try:
                import httpx
                headers = {"Content-Type": "application/json"}
                if self.api_key:
                    headers["Authorization"] = f"Bearer {self.api_key}"

                user_content: list[dict[str, Any]] = [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{screenshot_b64}"},
                    },
                ]

                async with httpx.AsyncClient(timeout=T7_AUDIT_TIMEOUT_SECONDS) as client:
                    resp = await client.post(
                        f"{self.openroute_base}/v1/chat/completions",
                        headers=headers,
                        json={
                            "model": use_model,
                            "messages": [
                                {"role": "system", "content": T7_AUDIT_SYSTEM_MESSAGE},
                                {"role": "user", "content": user_content},
                            ],
                            "temperature": 0.1,
                            "max_tokens": 300,
                        },
                    )
                    if resp.status_code != 200:
                        last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
                        logger.error(f"T7Auditor 视觉模式 LLM 调用失败 (attempt {attempt}): {last_error}")
                        continue

                    data = resp.json()
                    choices = data.get("choices", [])
                    if not choices:
                        last_error = "LLM 返回空 choices"
                        continue

                    review_text = choices[0].get("message", {}).get("content", "")
                    review_model = data.get("model", use_model)

                    if not review_text.strip():
                        last_error = "LLM 返回空 content"
                        continue

                    verdict = self._parse_verdict(review_text)
                    if verdict:
                        score = self._parse_score(review_text)
                        reason = self._parse_reason(review_text)
                        return AuditResult(
                            passed=(verdict == "PASS"),
                            reason=reason,
                            score=score,
                            verdict=verdict,
                            raw_response=review_text[:500],
                            review_model=review_model,
                        )
                    else:
                        last_error = f"LLM 审核返回格式异常: {review_text[:80]}"
                        logger.warning(f"T7Auditor 视觉模式 VERDICT 解析失败 (attempt {attempt}): {review_text[:80]}")
                        continue

            except Exception as e:
                last_error = str(e) or type(e).__name__
                logger.error(f"T7Auditor 视觉模式异常 (attempt {attempt}): {last_error}")
                continue

        return AuditResult(
            passed=False,
            reason=f"视觉模式审核失败(重试{T7_AUDIT_MAX_RETRIES}次): {last_error}",
            score=0.0,
            verdict="",
            raw_response="",
            review_model=review_model,
        )

    async def _audit_with_text(
        self,
        dom_text: str,
        route: str,
        criteria_text: str,
        use_model: str,
    ) -> AuditResult:
        """文本模式审核 — 发送 DOM 文本内容给 LLM（视觉降级方案）。

        当 LLM 不支持视觉输入时，发送 body innerText 进行文本审核。
        虽然无法审核视觉破损，但可验证内容完整性、可用性、是否暴露测试字样。
        """
        # 文本模式提示词（基于 DOM 文本内容）
        text_prompt = (
            f"你是严格的 Web 可用性审核员。请审核以下页面路由 {route} 的 DOM 文本内容可用性。\n\n"
            f"【审核维度】\n{criteria_text}\n\n"
            f"【页面 DOM 文本内容】\n{dom_text[:2000]}\n\n"
            f"【审核原则】\n"
            f"- 内容完整性：页面应有实质内容，不能是空白页或加载失败页\n"
            f"- 可用性达标：文本内容应包含导航、功能入口等关键元素\n"
            f"- 不暴露测试元素：不应在页面中显示 T7/T8/test 等测试相关字样\n"
            f"- 布局推断：从 DOM 文本结构推断布局是否完整\n\n"
            f"【输出格式】严格按以下格式输出：\n"
            f"VERDICT: PASS\nSCORE: <0-1>\nREASON: <原因>\n"
            f"或\nVERDICT: FAIL\nSCORE: <0-1>\nREASON: <原因>\n"
        )

        review_model = use_model
        last_error = ""

        for attempt in range(1, T7_AUDIT_MAX_RETRIES + 1):
            try:
                import httpx
                headers = {"Content-Type": "application/json"}
                if self.api_key:
                    headers["Authorization"] = f"Bearer {self.api_key}"

                async with httpx.AsyncClient(timeout=T7_AUDIT_TIMEOUT_SECONDS) as client:
                    resp = await client.post(
                        f"{self.openroute_base}/v1/chat/completions",
                        headers=headers,
                        json={
                            "model": use_model,
                            "messages": [
                                {"role": "system", "content": T7_AUDIT_SYSTEM_MESSAGE},
                                {"role": "user", "content": text_prompt},
                            ],
                            "temperature": 0.1,
                            "max_tokens": 300,
                        },
                    )
                    if resp.status_code != 200:
                        last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
                        logger.error(f"T7Auditor 文本模式 LLM 调用失败 (attempt {attempt}): {last_error}")
                        continue

                    data = resp.json()
                    choices = data.get("choices", [])
                    if not choices:
                        last_error = "LLM 返回空 choices"
                        continue

                    review_text = choices[0].get("message", {}).get("content", "")
                    review_model = data.get("model", use_model)

                    if not review_text.strip():
                        last_error = "LLM 返回空 content"
                        continue

                    logger.info(f"T7Auditor 文本模式 LLM 响应 (attempt {attempt}): len={len(review_text)}")

                    verdict = self._parse_verdict(review_text)
                    if verdict:
                        score = self._parse_score(review_text)
                        reason = self._parse_reason(review_text)
                        result = AuditResult(
                            passed=(verdict == "PASS"),
                            reason=f"[文本模式] {reason}",
                            score=score,
                            verdict=verdict,
                            raw_response=review_text[:500],
                            review_model=review_model,
                        )
                        logger.info(
                            f"[T7Auditor] 路由 {route} 文本审核完成: verdict={verdict}, score={score}, model={review_model}"
                        )
                        return result
                    else:
                        last_error = f"LLM 审核返回格式异常: {review_text[:80]}"
                        logger.warning(f"T7Auditor 文本模式 VERDICT 解析失败 (attempt {attempt}): {review_text[:80]}")
                        continue

            except Exception as e:
                last_error = str(e) or type(e).__name__
                logger.error(f"T7Auditor 文本模式异常 (attempt {attempt}): {last_error}")
                continue

        return AuditResult(
            passed=False,
            reason=f"文本模式审核失败(重试{T7_AUDIT_MAX_RETRIES}次): {last_error}",
            score=0.0,
            verdict="FAIL",
            raw_response="",
            review_model=review_model,
        )

    @staticmethod
    def _parse_verdict(review_text: str) -> str:
        """解析 VERDICT — 支持中英文 + 容错解析。

        支持格式（严格度递减）：
        1. VERDICT: PASS / VERDICT: FAIL
        2. VERDICT：通过 / VERDICT：不通过 / VERDICT：合格 / VERDICT：不合格
        3. 独立的 PASS / FAIL 关键词（容错）
        4. 独立的 通过 / 不通过 / 合格 / 不合格 关键词（容错）
        """
        # 1. 严格 VERDICT: 格式
        verdict_match = re.search(
            r"VERDICT\s*[:：]\s*(PASS|FAIL|通过|不通过|合格|不合格)",
            review_text,
            re.IGNORECASE,
        )
        if verdict_match:
            verdict_raw = verdict_match.group(1).upper()
            if verdict_raw in ("PASS", "通过", "合格"):
                return "PASS"
            return "FAIL"

        # 2. 容错：独立的 PASS/FAIL 关键词（短文本才启用，避免误匹配）
        if len(review_text) <= 200:
            pass_match = re.search(r"\bPASS\b", review_text, re.IGNORECASE)
            fail_match = re.search(r"\bFAIL\b", review_text, re.IGNORECASE)
            if fail_match and not pass_match:
                return "FAIL"
            if pass_match and not fail_match:
                return "PASS"

        # 3. 容错：中文
        if "不通过" in review_text or "不合格" in review_text:
            return "FAIL"
        if "审核通过" in review_text or "可用性合格" in review_text:
            return "PASS"
        if len(review_text) <= 100 and ("通过" in review_text or "合格" in review_text):
            return "PASS"

        return ""

    @staticmethod
    def _parse_score(review_text: str) -> float:
        """解析 SCORE — 0-1 之间的浮点数。

        解析失败返回 0.0（不参与判定，仅记录）。
        """
        score_match = re.search(
            r"SCORE\s*[:：]\s*([0-9]*\.?[0-9]+)",
            review_text,
            re.IGNORECASE,
        )
        if score_match:
            try:
                score = float(score_match.group(1))
                # 归一化到 0-1 区间（LLM 可能返回 0-100）
                if score > 1.0:
                    score = score / 100.0
                return max(0.0, min(1.0, score))
            except (ValueError, IndexError):
                pass
        return 0.0

    @staticmethod
    def _parse_reason(review_text: str) -> str:
        """解析 REASON — 仅记录不参与判定。"""
        reason_match = re.search(
            r"REASON\s*[:：]\s*(.+?)(?:\n|$)",
            review_text,
            re.IGNORECASE | re.DOTALL,
        )
        return reason_match.group(1).strip() if reason_match else ""

    def report(self) -> str:
        """生成 T7 DOM 审核报告。"""
        if not self.results:
            return "[T7Auditor] 无审核记录"
        lines = ["\n[T7Auditor] LLM DOM 可用性审核报告:"]
        passed = sum(1 for r in self.results if r.passed)
        lines.append(f"审核: {passed}/{len(self.results)} 通过")
        for r in self.results:
            icon = "PASS" if r.passed else "FAIL"
            lines.append(
                f"  [{icon}] score={r.score:.2f} model={r.review_model} — {r.reason[:60]}"
            )
        return "\n".join(lines)
