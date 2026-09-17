"""Loop Reflector — analyzes failures and generates improvements."""

import json
import logging
import os
import re
import time

from abc import ABC, abstractmethod
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.loop.state import LoopState, Reflection

logger = logging.getLogger(__name__)

# v4.6 调试日志开关：设置 CF_DEBUG=1 或 CF_DEBUG=true 启用详细日志
CF_DEBUG = os.environ.get("CF_DEBUG", "").lower() in ("1", "true", "yes")

# v5.33 反馈链修复：AI 模式过滤 pattern 列表
# 评委/Reflector 经常建议添加 "悬念/数字/互动/原创观点" 等 AI 模式内容，
# 这些内容会让下一轮 writer 引入 AI 痕迹，导致 T7 扣分。
# 在 _parse_reflection_response 返回前过滤掉包含这些 pattern 的建议。
_AI_SUGGESTION_FORBIDDEN_PATTERNS: list[re.Pattern] = [
    # === AI 互动模板（最严重，导致 T7 直接扣分）===
    re.compile(r'评论区'),
    re.compile(r'留言'),
    re.compile(r'你如何看待'),
    re.compile(r'你怎么看'),
    re.compile(r'你认为'),  # "你认为医保改革..."
    re.compile(r'你觉得'),
    re.compile(r'你的故事'),
    re.compile(r'你有什么'),
    re.compile(r'你是否'),
    re.compile(r'你是如何'),  # 宽泛匹配"你是如何应对"/"你是如何处理"
    re.compile(r'让我们一起'),
    re.compile(r'一起探究'),
    re.compile(r'一起看看'),
    re.compile(r'互动问题'),
    re.compile(r'互动时间'),
    re.compile(r'互动环节'),
    re.compile(r'互动性'),
    re.compile(r'互动式'),
    re.compile(r'互动内容'),
    re.compile(r'参与感'),
    re.compile(r'提出问题'),
    re.compile(r'提出.{0,8}问题'),  # "提出一个开放式问题"
    re.compile(r'开放式问题'),
    re.compile(r'欢迎.{0,5}聊'),
    re.compile(r'欢迎.{0,5}分享'),
    re.compile(r'欢迎.{0,5}讨论'),
    re.compile(r'引发读者思考'),
    re.compile(r'引发共鸣'),
    re.compile(r'引发讨论'),
    re.compile(r'引导读者'),
    re.compile(r'你对.{0,8}有何看法'),
    re.compile(r'分享你的'),
    re.compile(r'悬念设置'),
    re.compile(r'转发意愿'),
    re.compile(r'提升.{0,8}传播'),
    re.compile(r'增加传播元素'),
    re.compile(r'增加.{0,5}互动'),
    re.compile(r'加入.{0,5}互动'),
    re.compile(r'提升.{0,5}互动'),
    # === AI 场景代入/假设句式（"想象一下"/"如果你正"等）===
    re.compile(r'想象一下'),
    re.compile(r'想象.{0,3}你'),
    re.compile(r'如果你正'),
    re.compile(r'假如你'),
    re.compile(r'假设你'),
    re.compile(r'你会遇到'),
    re.compile(r'我们就来'),
    re.compile(r'让我们一起'),
    re.compile(r'引人入胜'),
    re.compile(r'吸引读者'),
    re.compile(r'吸引.{0,3}注意力'),
    re.compile(r'场景描述'),
    re.compile(r'场景代入'),
    # === 禁止建议添加具体数字/统计数据（禁区第1条）===
    re.compile(r'增加.{0,8}数字'),
    re.compile(r'加入.{0,8}数字'),
    re.compile(r'增加.{0,8}数据'),
    re.compile(r'加入.{0,8}数据'),
    re.compile(r'增加.{0,8}统计'),
    re.compile(r'加入.{0,8}统计'),
    re.compile(r'加入.{0,5}悬念'),
    re.compile(r'增加.{0,5}悬念'),
    re.compile(r'添加.{0,5}悬念'),
    # === AI 标题格式 ===
    re.compile(r'揭秘[！!]'),
    re.compile(r'真相令人震惊'),
    re.compile(r'你绝对想不到'),
    re.compile(r'令人震惊'),
    # === AI 套话 ===
    re.compile(r'揭示了'),
    re.compile(r'折射出'),
    re.compile(r'折射了'),
    re.compile(r'本质上[是是]'),
    re.compile(r'我们每个人都应该'),
    re.compile(r'令人深思'),
    re.compile(r'值得深思'),
    re.compile(r'值得反思'),
    re.compile(r'让我们思考'),
    re.compile(r'让我们不禁'),
    # === 编造数据/机构名 ===
    re.compile(r'增长\d+%'),
    re.compile(r'达到\d+亿'),
    re.compile(r'超过\d+%'),
    re.compile(r'根据.{0,15}(?:研究中心|研究所|机构|智库|研究院)'),
    re.compile(r'据.{0,15}(?:研究中心|研究所|机构|智库|研究院)'),
    # === AI 结构化标签 ===
    re.compile(r'\*\*[^*]{2,12}[：:]\*\*'),
    re.compile(r'\b案例[：:]'),
    re.compile(r'\b数据冲击[：:]'),
    re.compile(r'\b场景代入[：:]'),
    re.compile(r'\b背景[：:]'),
    re.compile(r'\b观点[：:]'),
    # === AI 套话式 "原创观点" 建议（让 writer 写套话）===
    re.compile(r'加入原创观点'),
    re.compile(r'增加原创观点'),
    re.compile(r'加入.{0,5}独到见解'),
    re.compile(r'增加.{0,5}独到见解'),
    re.compile(r'加强品牌建设'),
    re.compile(r'积极探索.{0,8}模式'),
]


# v5.65 修复: 恢复建议白名单 — 当 LLM 输出为空/占位符/偏题时, reflector 会生成
# "重新围绕选题创作一篇完整文章" 这类关键恢复建议。这些建议可能包含"场景代入"等
# AI 模式词, 但它们是修复失败的关键指导, 不应被过滤。
# 旧逻辑: 直接匹配 _AI_SUGGESTION_FORBIDDEN_PATTERNS 过滤, 导致 v5.63 的恢复建议
# "重新围绕选题'...'创作一篇完整文章...开头用具体场景代入" 被 '场景代入' 模式过滤,
# 第2轮 writer 收不到"重新围绕选题创作"的关键指导, 只收到"引用具体数据"的次要建议,
# 导致第2轮内容只有 601 字, 质量分 0.794 < 0.85。
# 新逻辑: 建议中包含恢复关键词时, 跳过 AI 模式过滤, 直接保留。
_RECOVERY_SUGGESTION_KEYWORDS: tuple[str, ...] = (
    "重新围绕选题",
    "创作一篇完整文章",
    "重新创作一篇",
    "重新撰写一篇",
    "从头创作",
    "围绕上述选题",
    "围绕该选题",
    "围绕此选题",
)


def _safe_topic_list(input_data: object) -> list[dict]:
    """v6.1 提示词泄漏修复: 从 task.input_data 只提取选题白名单字段。

    原实现把整个 task.input_data (含 system_prompt 人设 + research_materials +
    topic_list 全量) 塞给反射器，实测引发模型回显整条用户消息(泄漏 1.4万字符)。
    反射器只需要选题对齐检查所需的 title/angle/highlights。
    """
    safe: list[dict] = []
    try:
        src = input_data if isinstance(input_data, dict) else {}
        tlist = src.get("topic_list") or []
        if isinstance(tlist, list):
            for t in tlist:
                if not isinstance(t, dict):
                    continue
                entry: dict = {}
                for k in ("title", "angle", "highlights"):
                    v = t.get(k)
                    if isinstance(v, str) and v:
                        entry[k] = v
                    elif isinstance(v, (int, float)):
                        entry[k] = v
                if entry:
                    safe.append(entry)
        if not safe:
            for k in ("topic_title", "title"):
                v = src.get(k)
                if isinstance(v, str) and v:
                    safe.append({"title": v})
                    break
    except Exception as _e:
        logger.warning(f"[reflector] _safe_topic_list 失败: {_e}")
    return safe


def filter_ai_pattern_suggestions(suggestions: list[str]) -> tuple[list[str], list[str]]:
    """过滤包含 AI 模式内容的建议。

    Returns:
        (kept, dropped): 保留的建议列表，被过滤掉的建议列表
    """
    kept: list[str] = []
    dropped: list[str] = []
    for s in suggestions:
        s_str = str(s)
        # v5.65 修复: 恢复建议白名单优先级最高, 包含恢复关键词的建议直接保留
        # 这些建议是修复 LLM 失败的关键指导, 即使包含"场景代入"等词也不应过滤
        _is_recovery = any(_kw in s_str for _kw in _RECOVERY_SUGGESTION_KEYWORDS)
        if _is_recovery:
            kept.append(s_str)
            if CF_DEBUG:
                logger.info(f"[CF-DEBUG] reflector 保留恢复建议(白名单): suggestion={s_str[:100]!r}")
            continue
        matched_pattern = None
        for p in _AI_SUGGESTION_FORBIDDEN_PATTERNS:
            if p.search(s_str):
                matched_pattern = p.pattern
                break
        if matched_pattern:
            dropped.append(s_str)
            if CF_DEBUG:
                logger.info(f"[CF-DEBUG] reflector 过滤AI建议: pattern={matched_pattern!r}, "
                            f"suggestion={s_str[:100]!r}")
        else:
            kept.append(s_str)
    return kept, dropped

# Keyword-based root cause inference rules for fallback logic
# 支持中英文关键词匹配，确保中文错误信息也能被正确分类
_ERROR_PATTERNS = [
    ("timeout", "执行超时，考虑减少步骤数量或优化耗时操作"),
    ("超时", "执行超时，考虑减少步骤数量或优化耗时操作"),
    ("connection", "网络连接失败，考虑增加重试机制或检查服务可用性"),
    ("连接", "网络连接失败，考虑增加重试机制或检查服务可用性"),
    ("rate_limit", "API 速率限制，考虑降低请求频率或增加间隔"),
    ("quality", "质量不达标，考虑增加约束条件或细化执行步骤"),
    ("质量", "质量不达标，需要提升内容深度和结构"),
    ("低分", "存在低分维度，需要针对性改进"),
    ("content_depth", "内容深度不足，需要增加具体案例和数据"),
    ("structure", "结构不清晰，需要优化文章层次"),
    ("format", "输出格式错误，考虑在提示词中明确格式要求"),
    ("格式", "输出格式错误，考虑在提示词中明确格式要求"),
    ("占位符", "提示词中存在未替换的占位符，需要检查模板变量"),
    ("无法生成", "内容生成失败，需要检查素材和提示词"),
    ("内容为空", "内容为空，需要检查LLM调用是否成功"),
    ("permission", "权限不足，考虑检查访问控制配置"),
    ("not_found", "资源未找到，考虑验证输入数据或更新数据源"),
    ("parse", "解析失败，考虑校验输入数据格式或增加容错处理"),
    ("memory", "内存不足，考虑减少数据量或分批处理"),
    ("auth", "认证失败，考虑检查凭据配置"),
]


class LoopReflector(ABC):
    """Loop 复盘器接口。"""

    @abstractmethod
    async def reflect(self, errors: list[str], task: TaskContext, state: LoopState) -> Reflection:
        """分析失败原因，生成改进建议。"""


class ReflexionReflector(LoopReflector):
    """Uses reflexion pattern for self-correction."""

    def __init__(self, llm_client=None):
        self.llm_client = llm_client

    async def reflect(self, errors: list[str], task: TaskContext, state: LoopState) -> Reflection:
        if not errors:
            return Reflection(suggestions=[], root_cause="", plan_adjustments=[])

        logger.info(f"[reflector] 开始反思: task_id={task.task_id}, attempt={state.attempt}, "
                     f"errors_count={len(errors)}, errors_top3={errors[:3]}")
        if CF_DEBUG:
            logger.info(f"[CF-DEBUG] reflector 启动: task_id={task.task_id}, attempt={state.attempt}, "
                        f"has_llm_client={self.llm_client is not None}, "
                        f"errors_count={len(errors)}")

        if self.llm_client is not None:
            try:
                reflection = await self._llm_reflect(errors, task, state)
                if reflection:
                    logger.info(f"[reflector] LLM反思完成: root_cause={reflection.root_cause[:100]}, "
                                 f"suggestions_count={len(reflection.suggestions)}, "
                                 f"suggestions={reflection.suggestions[:3]}")
                    if CF_DEBUG:
                        logger.info(f"[CF-DEBUG] reflector 完成: root_cause={reflection.root_cause[:200]!r}, "
                                    f"suggestions_count={len(reflection.suggestions)}, "
                                    f"all_suggestions={reflection.suggestions}")
                    return reflection
                logger.warning("LLM reflect response could not be parsed, falling back to rule-based logic")
            except Exception as e:
                logger.warning("LLM reflect failed: %s, falling back to rule-based logic", e)

        reflection = self._rule_based_reflect(errors, task, state)
        logger.info(f"[reflector] 规则反思完成: root_cause={reflection.root_cause[:100]}, "
                     f"suggestions_count={len(reflection.suggestions)}")
        return reflection

    async def _llm_reflect(self, errors: list[str], task: TaskContext, state: LoopState) -> Reflection | None:
        """Use LLM to perform root cause analysis and generate suggestions."""
        history = state.reflection_history[-3:] if state.reflection_history else []
        history_str = json.dumps(history, ensure_ascii=False, default=str) if history else "None"

        # [修复Bug#3] 将上一轮draft内容传给Reflector，让反思建议更精准
        last_draft = ""
        if hasattr(task, "metadata") and task.metadata:
            last_draft = task.metadata.get("last_draft", "")
        last_draft_preview = last_draft[:2000] if last_draft else "无"

        if CF_DEBUG:
            _draft_preview = repr(last_draft[:200]) if last_draft else "None"
            logger.info(f"[CF-DEBUG] reflector 输入: task_id={task.task_id}, attempt={state.attempt}, "
                        f"errors_count={len(errors)}, errors_top3={errors[:3]}, "
                        f"last_draft_len={len(last_draft)}, "
                        f"last_draft_preview={_draft_preview}")

        # v5.33 修复: 提取选题标题传入模板，否则 {topic_title} 占位符会留下字面文本
        # 导致 Reflector LLM 看到损坏的 prompt，无法执行"选题对齐检查"
        topic_title = ""
        try:
            _input = task.input_data if isinstance(task.input_data, dict) else {}
            _topic_list = _input.get("topic_list", []) if isinstance(_input, dict) else []
            if _topic_list and isinstance(_topic_list, list):
                _first = _topic_list[0]
                if isinstance(_first, dict):
                    topic_title = str(_first.get("title", "")) or ""
            if not topic_title and isinstance(_input, dict):
                topic_title = str(_input.get("topic_title", "") or _input.get("title", "")) or ""
        except Exception as _e:
            logger.warning(f"[reflector] 提取选题标题失败: {_e}")
        if CF_DEBUG:
            logger.info(f"[CF-DEBUG] reflector 选题标题: {topic_title!r}")

        prompt = get_prompt("loop.reflector.reflect",
                            errors=json.dumps(errors, ensure_ascii=False),
                            task_id=task.task_id,
                            # v6.1 修复(P-L): 原`json.dumps(task.input_data)`把完整 system_prompt(人设+写作方法论)
                            # + research_materials + topic_list 整包塞给反射器，实测引发 Doubao 回显14423字
                            # 用户消息(提示词泄漏)。反射器只需选题对齐检查，白名单字段足够。
                            input_data=json.dumps({
                                "topic_list": _safe_topic_list(task.input_data),
                                "draft_preview": last_draft_preview,
                            }, ensure_ascii=False, default=str),
                            attempt=str(state.attempt),
                            history=history_str,
                            last_draft=last_draft_preview,
                            topic_title=topic_title)
        # v2.2 修复: 显式传入 agent_name="reflexion_evaluator"，让 LLMClient 走 reflector 路由(90s 超时)
        # 原来不传 agent_name 导致 LLMClient 走 default 路由(200s 超时)，实际耗时 124s+
        # llm_route.yaml 中 agent_routes.reflexion_evaluator → reflector 路由 (timeout_seconds=90)
        # v4.9: 移除 prefer_api=True — 用户要求评委/润色/反思使用 webchat 模型
        # v5.25: 恢复 prefer_api=True — webchat浏览器全面崩溃(echo/token=0/1)，
        #   Reflector用webchat导致Doubao-Seed2.0连续超时60s×9次=540s，必须走API通道
        #   API后端(siliconflow/aliyuncs/zhipu)响应1-3s，远快于webchat 120-300s
        _reflect_llm_start = time.monotonic()
        response = await self.llm_client.chat(
            prompt,
            agent_name="reflexion_evaluator",
            task_id=task.task_id,
            prefer_api=True,
        )
        _reflect_llm_dur = time.monotonic() - _reflect_llm_start
        # ModelCapability.chat returns a dict with "content" key;
        # LLMClient-style clients return a string. Handle both.
        _used_model = ""
        if isinstance(response, dict):
            _used_model = response.get("model", "?")
            response = response.get("content", "")
        logger.info(f"[⏱️ PERF] reflector.llm_chat task_id={task.task_id} 耗时={_reflect_llm_dur:.2f}s")
        if CF_DEBUG:
            _resp_preview = repr(response[:200]) if response else "EMPTY"
            logger.info(f"[CF-DEBUG] reflector LLM响应: model={_used_model or '?'}, "
                        f"assignment=reflexion_evaluator, prefer_api=False(webchat), "
                        f"耗时={_reflect_llm_dur:.2f}s, "
                        f"response_len={len(response) if response else 0}, "
                        f"response_preview={_resp_preview}")
        return self._parse_reflection_response(response)

    def _parse_reflection_response(self, response: str) -> Reflection | None:
        """Parse LLM response into a Reflection. Returns None on failure.

        Enhanced fault tolerance:
        1. Extract JSON from markdown code blocks
        2. Try direct JSON parse and { ... } extraction
        3. Try to extract a suggestions list from plain text
        4. Fall back to using the raw text as a single suggestion
        """
        if not response:
            return None

        text = response.strip()
        # Try to extract JSON from markdown code block
        if "```" in text:
            lines = text.split("\n")
            json_lines = []
            inside = False
            for line in lines:
                if line.strip().startswith("```"):
                    if inside:
                        break
                    inside = True
                    continue
                if inside:
                    json_lines.append(line)
            extracted = "\n".join(json_lines).strip()
            if extracted:
                text = extracted

        parsed: dict | None = None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    parsed = json.loads(text[start : end + 1])
                except json.JSONDecodeError:
                    parsed = None

        # Path 1: Successfully parsed JSON dict
        if isinstance(parsed, dict):
            root_cause = parsed.get("root_cause", "")
            suggestions = parsed.get("suggestions", [])
            plan_adjustments = parsed.get("plan_adjustments", [])

            if not isinstance(suggestions, list):
                suggestions = [str(suggestions)]
            if not isinstance(plan_adjustments, list):
                plan_adjustments = []

            # v5.33 反馈链修复: 过滤 AI 模式建议，防止下一轮 writer 引入 AI 痕迹
            suggestions_str = [str(s) for s in suggestions]
            kept_suggestions, dropped_suggestions = filter_ai_pattern_suggestions(suggestions_str)
            if dropped_suggestions:
                logger.info(f"[reflector] 过滤AI模式建议: "
                            f"原始{len(suggestions_str)}条, 保留{len(kept_suggestions)}条, "
                            f"过滤{len(dropped_suggestions)}条")
                if CF_DEBUG:
                    for d in dropped_suggestions:
                        logger.info(f"[CF-DEBUG] reflector 过滤建议: {d[:100]!r}")
                # 如果全部建议都被过滤，保留原始建议中前1条作为兜底（避免空建议导致 writer 无反馈）
                if not kept_suggestions and suggestions_str:
                    kept_suggestions = suggestions_str[:1]
                    logger.warning(f"[reflector] 所有建议都被AI过滤，使用原始首条作为兜底")

            return Reflection(
                root_cause=str(root_cause),
                suggestions=kept_suggestions,
                plan_adjustments=[a for a in plan_adjustments if isinstance(a, dict)],
            )

        # Path 2: JSON parse failed — try to extract suggestions from plain text
        # LLM may return plain-text suggestions like:
        #   1. 建议一
        #   2. 建议二
        #   - 建议三
        logger.warning(
            "LLM reflection response could not be parsed as JSON, "
            "attempting plain-text suggestion extraction"
        )
        text_suggestions = self._extract_suggestions_from_text(response)
        if text_suggestions:
            logger.info(
                f"Extracted {len(text_suggestions)} suggestions from plain-text response"
            )
            # v5.33 反馈链修复: 对纯文本提取的建议也应用 AI 模式过滤
            kept_text, dropped_text = filter_ai_pattern_suggestions(text_suggestions)
            if dropped_text:
                logger.info(f"[reflector] 纯文本建议过滤AI模式: "
                            f"原始{len(text_suggestions)}条, 保留{len(kept_text)}条, "
                            f"过滤{len(dropped_text)}条")
                if not kept_text:
                    kept_text = text_suggestions[:1]
            return Reflection(
                root_cause="LLM返回非JSON格式，已从文本中提取建议",
                suggestions=kept_text,
                plan_adjustments=[],
            )

        # Path 3: Could not extract structured suggestions — use raw text as fallback
        # At least preserve the LLM's reflection content instead of discarding it
        raw_text = response.strip()
        if len(raw_text) > 20:
            logger.warning(
                "LLM reflection response unparseable, using raw text as single suggestion"
            )
            # Truncate to avoid overly long suggestion
            # v5.33: 单条兜底建议不过滤（避免完全没有反馈）
            return Reflection(
                root_cause="LLM返回非JSON格式，使用原始文本作为建议",
                suggestions=[raw_text[:500]],
                plan_adjustments=[],
            )

        return None

    @staticmethod
    def _extract_suggestions_from_text(text: str) -> list[str]:
        """从纯文本中提取建议列表，支持多种常见格式.

        支持的格式:
        - 编号列表: "1. 建议" / "1) 建议" / "1、建议"
        - 符号列表: "- 建议" / "* 建议" / "• 建议"
        - 换行分隔的段落（每段视为一条建议）
        """
        import re

        if not text or not text.strip():
            return []

        lines = text.strip().split("\n")
        suggestions: list[str] = []

        # 策略1: 匹配编号/符号列表项
        list_pattern = re.compile(
            r"^\s*(?:\d+[.)\、]|[\-*•·])\s*(.+)"
        )
        for line in lines:
            match = list_pattern.match(line)
            if match:
                suggestion = match.group(1).strip()
                if suggestion and len(suggestion) > 5:
                    suggestions.append(suggestion)

        if suggestions:
            return suggestions

        # 策略2: 按空行分段，每段视为一条建议
        paragraphs = re.split(r"\n\s*\n", text.strip())
        for para in paragraphs:
            para = para.strip()
            # 跳过过短或明显是标题/元信息的段落
            if para and len(para) > 10 and not para.startswith("#"):
                suggestions.append(para)

        return suggestions

    def _rule_based_reflect(self, errors: list[str], task: TaskContext, state: LoopState) -> Reflection:
        """Fallback: infer root cause and suggestions from error keywords."""
        root_causes = []
        suggestions = []
        seen_causes = set()

        for error in errors:
            error_lower = error.lower()
            matched = False
            for keyword, cause in _ERROR_PATTERNS:
                if keyword in error_lower and cause not in seen_causes:
                    root_causes.append(cause)
                    seen_causes.add(cause)
                    matched = True
                    break
            if not matched:
                root_causes.append(f"未分类错误: {error[:100]}")

        # Generate specific suggestions based on error patterns
        error_text = " ".join(e.lower() for e in errors)
        if "timeout" in error_text:
            suggestions.append("减少执行步骤数量，或为耗时操作设置更长的超时时间")
        if "connection" in error_text or "network" in error_text:
            suggestions.append("检查网络连接和服务可用性，增加重试机制")
        if "rate_limit" in error_text:
            suggestions.append("降低请求频率，在步骤间增加等待间隔")
        if "quality" in error_text:
            suggestions.append("在提示词中增加质量约束和评分标准")
        if "format" in error_text:
            suggestions.append("在提示词中明确输出格式要求，并提供示例")
        if "parse" in error_text:
            suggestions.append("增加输出解析的容错处理，校验输入数据格式")
        if not suggestions:
            suggestions.append("检查错误日志，定位具体失败原因并针对性修复")

        root_cause = "; ".join(root_causes) if root_causes else "Unknown error"

        return Reflection(
            root_cause=root_cause,
            suggestions=suggestions,
            plan_adjustments=[],
        )
