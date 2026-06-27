"""T7 LLM内容审核标准框架 — 供FlowForge及所有*Forge项目复用。

按 prompts.md 第十三章标准模板实现：
- 13.0.1 T7 LLM二次审核标准案例
- V1 LLM生成内容审核验证（6维度）

铁律T7：凡LLM生成的内容（文章/评论/回复/文案等），必须再调用LLM审核通过后才算验证通过。

使用方式（任何项目的测试用例）：
    from flowforge.tests.utils.t7_reviewer import T7Reviewer

    reviewer = T7Reviewer()
    result = await reviewer.review(content=llm_output, context="原始需求", content_type="文章")
    assert result["verdict"] == "PASS", f"T7审核未通过: {result['reason']}"

标准实现要点（参考prompts.md 13.0.1）：
1. 生成与审核使用不同模型（避免同模型自评放水）
2. 审核提示词只做客观拦截：指令泄露、AI痕迹、格式异常、内容违规、纯套话
3. 审核提示词明确要求"只输出 VERDICT 和 REASON"，便于程序解析
4. 解析 VERDICT: PASS/FAIL 作为通过判定，REASON 仅记录不参与判定
5. 候选链 fallback 时，跳过当前模型尝试下一个，避免单点故障
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# T7审核单次LLM调用超时（用户指示：长文章可能需要2分钟，设为90s）
T7_REVIEW_TIMEOUT_SECONDS = 90

# T7审核重试次数（小模型可能不遵守格式，参考test_base.py LLMReviewer）
T7_MAX_RETRIES = 3

# T7 system message（参考test_base.py第183行）
T7_SYSTEM_MESSAGE = "你是审核员。只输出VERDICT: PASS或VERDICT: FAIL，不要输出其他内容。"

# T7 审核提示词模板（按prompts.md V1规范 + browser_verify.py标准格式）
T7_REVIEW_PROMPT = """你是严格的内容审核员。请审核以下{content_type}内容是否合格。

【审核内容】
{content}

【上下文信息】
{context}

【审核维度】
1. 自然度 — 是否有AI生成痕迹（"作为一个AI"、免责声明、模板化表达、套话空话等）
2. 相关性 — 是否与上下文主题相关，是否答非所问、回避问题、说"无法回答"
3. 格式 — 是否符合预期格式，有无异常字符或格式
4. 长度 — 仅极端过短（<5字）或明显过长（>5000字）才不合格，不因字数略低于建议范围而判失败
5. 内容 — 是否含广告/引流/违规/敏感内容，是否含错误响应、是否有意义（不能是无意义字符或"无法回答"）
6. 连贯性 — 语句是否通顺、逻辑是否自洽、是否有实质内容

【审核原则】
- 严格审核：内容必须实质性回应上下文需求，不能答非所问或回避
- 以下情况必须判FAIL：
  * 回答"无法回答"、"我不知道"、空泛套话
  * 明显答非所问（上下文问A，回答B）
  * 内容过短且无实质信息（<10字且非特殊场景）
  * 含AI生成痕迹（"作为AI"、"我是人工智能"等）
- 以下情况判PASS：口语化、简短但有实质内容、有情绪表达

【输出格式】严格按以下格式输出：
VERDICT: PASS
或
VERDICT: FAIL
REASON: <原因>
"""


class T7Reviewer:
    """T7 LLM内容审核器 — 按prompts.md标准模板调用真实LLM进行6维度审核。

    供FlowForge及所有*Forge项目测试用例复用。

    使用方式：
        reviewer = T7Reviewer()
        result = await reviewer.review(content=llm_output, context="原始需求")
        assert result["verdict"] == "PASS"
    """

    def __init__(self, openroute_base: str = "http://127.0.0.1:13001",
                 model: str = "Doubao-Seed2.0", api_key: str = ""):
        self.openroute_base = openroute_base.rstrip("/")
        # 默认使用Doubao-Seed2.0（实测13-16s返回，最稳定）；auto模型会路由到超时模型
        self.model = model
        self.api_key = api_key or self._resolve_api_key()
        self.results: list[dict] = []

    @staticmethod
    def _resolve_api_key() -> str:
        """从 flowforge config 或环境变量自动解析 OpenRoute API Key。

        优先从 models.yaml 读取 api_key_default（确保获取正确的 or- 开头key），
        环境变量作为备选（环境变量可能被其他服务污染，如 OPENROUTER_API_KEY）。
        """
        import os
        from pathlib import Path
        # 1. 优先从 flowforge/config/models.yaml 的 api_key_default 读取
        try:
            import yaml
            project_root = Path(__file__).resolve().parents[3]
            models_yaml = project_root / "flowforge" / "config" / "models.yaml"
            if not models_yaml.exists():
                models_yaml = Path(__file__).resolve().parents[2] / "config" / "models.yaml"
            if models_yaml.exists():
                with open(models_yaml, "r", encoding="utf-8") as f:
                    cfg = yaml.safe_load(f) or {}
                providers = cfg.get("providers", {})
                or_cfg = providers.get("openroute", {}) if isinstance(providers, dict) else {}
                default_key = or_cfg.get("api_key_default", "")
                if default_key:
                    return default_key
        except Exception as e:
            logger.warning(f"T7审核器加载API Key失败: {e}")
        # 2. 环境变量备选（仅当models.yaml读取失败时）
        for env_var in ("OPENROUTE_API_KEY", "OR_API_KEY"):
            val = os.getenv(env_var, "").strip()
            if val:
                return val
        return ""

    async def review(self, content: str, context: str = "",
                     model: str = "", content_type: str = "内容") -> dict:
        """对LLM生成内容进行T7审核。

        Args:
            content: 待审核的LLM生成内容
            context: 上下文信息（如原始需求、文章标题等）
            model: 指定审核模型（覆盖默认）
            content_type: 内容类型（文章/评论/回复/代码/文案/标题等）

        Returns:
            dict: {
                "verdict": "PASS" | "FAIL",
                "reason": str,
                "raw_response": str,
                "review_model": str,
                "passed": bool  # 便捷字段: verdict == "PASS"
            }
        """
        if not content or not content.strip():
            result = {
                "verdict": "FAIL",
                "reason": "内容为空",
                "raw_response": "",
                "review_model": "rule-based",
                "passed": False,
            }
            self.results.append({**result, "content_type": content_type, "content_preview": ""})
            return result

        # 按标准模板构建提示词（content[:800], context[:300]）
        prompt = T7_REVIEW_PROMPT.format(
            content_type=content_type,
            content=self._truncate_at_boundary(content, 800),
            context=self._truncate_at_boundary(context, 300) if context else "无",
        )
        use_model = model or self.model

        # T7审核：调用真实LLM进行6维度审核（T1: 禁止Mock LLM）
        # 重试3次（小模型可能不遵守格式，参考test_base.py LLMReviewer）
        review_model = use_model
        last_error = ""
        for attempt in range(1, T7_MAX_RETRIES + 1):
            try:
                import httpx
                headers = {"Content-Type": "application/json"}
                if self.api_key:
                    headers["Authorization"] = f"Bearer {self.api_key}"
                async with httpx.AsyncClient(timeout=T7_REVIEW_TIMEOUT_SECONDS) as client:
                    resp = await client.post(
                        f"{self.openroute_base}/v1/chat/completions",
                        headers=headers,
                        json={
                            "model": use_model,
                            "messages": [
                                {"role": "system", "content": T7_SYSTEM_MESSAGE},
                                {"role": "user", "content": prompt},
                            ],
                            "temperature": 0.1,
                            "max_tokens": 100,  # 审核只需VERDICT+REASON，不需要长输出
                        },
                    )
                    if resp.status_code != 200:
                        last_error = f"HTTP {resp.status_code}"
                        logger.error(
                            f"T7审核LLM调用失败 (attempt {attempt}/{T7_MAX_RETRIES}): "
                            f"status={resp.status_code}, body={resp.text[:200]}"
                        )
                        continue

                    data = resp.json()
                    choices = data.get("choices", [])
                    if not choices:
                        last_error = "LLM返回空choices"
                        logger.error(f"T7审核LLM返回空choices (attempt {attempt}/{T7_MAX_RETRIES})")
                        continue
                    review_text = choices[0].get("message", {}).get("content", "")
                    review_model = data.get("model", use_model)

                    if not review_text.strip():
                        last_error = "LLM返回空content"
                        logger.error(f"T7审核LLM返回空content (attempt {attempt}/{T7_MAX_RETRIES})")
                        continue

                    logger.info(f"T7审核LLM响应 (attempt {attempt}/{T7_MAX_RETRIES}): len={len(review_text)}")

                    # 解析VERDICT（支持中英文，参考test_base.py第198-206行）
                    verdict = self._parse_verdict(review_text)
                    if verdict:
                        reason = self._parse_reason(review_text)
                        result = {
                            "verdict": verdict,
                            "reason": reason,
                            "raw_response": review_text[:500],
                            "review_model": review_model,
                            "passed": verdict == "PASS",
                        }
                        self.results.append({
                            **result,
                            "content_type": content_type,
                            "content_preview": content[:50],
                        })
                        logger.info(f"[T7] {content_type}审核完成: verdict={verdict}, model={review_model}")
                        return result
                    else:
                        last_error = f"LLM审核返回格式异常: {review_text[:80]}"
                        logger.warning(f"T7审核VERDICT解析失败 (attempt {attempt}/{T7_MAX_RETRIES}): {review_text[:80]}")
                        continue

            except Exception as e:
                last_error = str(e) or type(e).__name__
                logger.error(f"T7审核异常 (attempt {attempt}/{T7_MAX_RETRIES}): {last_error}")
                continue

        # 所有重试均失败
        result = {
            "verdict": "FAIL",
            "reason": f"审核失败(重试{T7_MAX_RETRIES}次): {last_error}",
            "raw_response": "",
            "review_model": review_model,
            "passed": False,
        }
        self.results.append({
            **result,
            "content_type": content_type,
            "content_preview": content[:50],
        })
        return result

    @staticmethod
    def _truncate_at_boundary(text: str, max_len: int) -> str:
        """按句子边界截断文本，避免在句子中间截断导致审核员误判。

        修复：T7审核器之前使用 content[:800] 硬截断，如果截断点正好在
        句子中间（如"这一任务"被截断为"这一任"），审核员会误判为
        "未完成句子"。此方法优先在句号/换行处截断。
        """
        if not text or len(text) <= max_len:
            return text if text else ""
        # 在 max_len 范围内查找最后一个句子边界
        truncated = text[:max_len]
        # 从末尾向前查找句子结束符
        for i in range(len(truncated) - 1, max(0, len(truncated) - 200), -1):
            if truncated[i] in '。！？\n.!?？':
                return truncated[:i + 1]
        # 如果没有找到句子边界，在最后一个空格或逗号处截断
        for i in range(len(truncated) - 1, max(0, len(truncated) - 100), -1):
            if truncated[i] in '，,、 ':
                return truncated[:i + 1]
        # 最后兜底：直接截断
        return truncated

    @staticmethod
    def _parse_verdict(review_text: str) -> str:
        """解析VERDICT — 支持中英文（参考test_base.py第198-206行）.

        支持格式：
        - VERDICT: PASS / VERDICT: FAIL
        - VERDICT：通过 / VERDICT：不通过
        - VERDICT: 合格 / VERDICT: 不合格
        """
        verdict_match = re.search(
            r'VERDICT\s*[:：]\s*(PASS|FAIL|通过|不通过|合格|不合格)',
            review_text,
            re.IGNORECASE,
        )
        if not verdict_match:
            return ""
        verdict_raw = verdict_match.group(1).upper()
        if verdict_raw in ("PASS", "通过", "合格"):
            return "PASS"
        return "FAIL"

    @staticmethod
    def _parse_reason(review_text: str) -> str:
        """解析REASON — 仅记录不参与判定（参考prompts.md 13.0.1实现要点4）."""
        reason_match = re.search(r'REASON\s*[:：]\s*(.+?)(?:\n|$)', review_text, re.IGNORECASE)
        return reason_match.group(1).strip() if reason_match else ""

    def report(self) -> str:
        """生成T7审核报告（参考test_base.py LLMReviewer.report）."""
        if not self.results:
            return "[T7] 无审核记录"
        lines = ["\n[T7] LLM内容审核报告:"]
        passed = sum(1 for r in self.results if r.get("passed"))
        lines.append(f"审核: {passed}/{len(self.results)} 通过")
        for r in self.results:
            icon = "PASS" if r.get("passed") else "FAIL"
            lines.append(
                f"  [{r.get('content_type', '?')}] {r.get('content_preview', '')[:30]}... "
                f"-> {icon} {r.get('reason', '')}"
            )
        return "\n".join(lines)

    def review_sync(self, content: str, context: str = "",
                    model: str = "", content_type: str = "内容") -> dict:
        """同步版本的T7审核 — 供sync测试脚本/urllib测试使用。

        内部通过asyncio.run()调用async review()。
        语义、参数、返回值与review()完全一致。
        """
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # 已在事件循环中 — 创建新线程运行避免冲突
                import threading
                result_box: dict = {}
                error_box: list = []
                def _runner():
                    try:
                        new_loop = asyncio.new_event_loop()
                        try:
                            result_box["r"] = new_loop.run_until_complete(
                                self.review(content=content, context=context,
                                            model=model, content_type=content_type)
                            )
                        finally:
                            new_loop.close()
                    except Exception as e:
                        error_box.append(e)
                t = threading.Thread(target=_runner)
                t.start()
                t.join()
                if error_box:
                    raise error_box[0]
                return result_box["r"]
        except RuntimeError:
            pass
        return asyncio.run(self.review(
            content=content, context=context,
            model=model, content_type=content_type,
        ))


def format_t7_report(results: list[dict]) -> str:
    """按V6模板格式化T7审核报告。"""
    lines = ["### T7 LLM内容审核结果", "", "| # | verdict | reason |", "|---|---------|--------|"]
    for i, r in enumerate(results, 1):
        lines.append(
            f"| {i} | {r.get('verdict', 'N/A')} | {r.get('reason', '')[:80]} |"
        )

    passed = sum(1 for r in results if r.get("verdict") == "PASS")
    lines.append(f"\n**T7统计**: {passed}/{len(results)} 通过")
    return "\n".join(lines)
