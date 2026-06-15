"""Workflow validation and analysis logic.

Contains the WorkflowValidator class and associated constants for:
- Error content detection
- Execution plan parsing
- Simple message detection
- Intent type inference
- Step inference from intent
- Step content extraction
"""

import json
import re
from typing import Dict, List, Optional

from flowforge.core.prompt_manager import get_prompt
from flowforge.core.tracing import get_logger

logger = get_logger("workflow_validator")

# ── Error detection constants ──

_ERROR_KEYWORDS = {"error", "timeout", "timed out", "failed", "不可用", "失败", "超时"}

_ERROR_PREFIX_PATTERNS = [
    "error:", "error：", "failed:", "failed：", "timeout:", "timeout：",
    "超时", "失败", "不可用", "抱歉", "生成失败", "调用失败",
]

_CONVERSATIONAL_PATTERNS = [
    "需要我帮你", "需要我为您", "请提供", "请您提供", "请告诉我",
    "你能告诉我", "你能提供", "你想了解", "您想了解",
    "do you need", "would you like", "please provide", "could you tell",
    "can you provide", "what would you like",
]

_SEARCH_TOOLS = {"web_search", "opensieve_search", "tavily_search", "duckduckgo_search"}
_SEARCH_AGENTS = {"topic_research", "web_search_agent", "research_agent"}

TASK_TIMEOUT_SECONDS = 1200
STEP_TIMEOUT_SECONDS = 300


def is_error_content(text: str) -> bool:
    """Check if text is an error message rather than actual content.

    Only considers short text (< 300 chars) that contains error keywords,
    OR text that starts with an error prefix pattern. This avoids filtering
    out valid long-form content that happens to mention error-related terms.
    Also detects conversational replies where the LLM asks for clarification
    instead of producing content.
    """
    text_lower = text.lower().strip()
    if not text_lower:
        return True
    if len(text_lower) > 300:
        return False
    for prefix in _ERROR_PREFIX_PATTERNS:
        if text_lower.startswith(prefix.lower()):
            return True
    for pattern in _CONVERSATIONAL_PATTERNS:
        if pattern in text_lower:
            return True
    return any(kw in text_lower for kw in _ERROR_KEYWORDS)


class WorkflowValidator:
    """Validates and analyses workflow inputs and outputs.

    Provides methods for parsing execution plans, detecting simple
    messages, inferring intent types, and extracting step content.
    """

    # Intent keywords for fallback detection from user input
    _INTENT_KEYWORDS: Dict[str, List[str]] = {
        "creation": ["写一篇", "写篇文章", "创作文章", "创作一篇", "撰写文章", "撰写一篇", "写一篇文章", "帮我写一篇", "写一篇关于", "write an article", "create an article"],
        "write": ["写", "文章", "创作", "撰写", "编写", "write", "article", "generate"],
        "search": ["搜索", "搜", "查", "search", "find", "lookup"],
        "research": ["研究", "调研", "分析", "research", "investigate", "study"],
        "code": ["代码", "编程", "函数", "code", "program", "function", "python", "javascript", "算法", "排序", "程序", "脚本", "script", "java", "c++", "rust", "golang", "typescript"],
        "translate": ["翻译", "translate", "translation"],
        "analyze": ["分析", "评估", "analyze", "evaluate", "assess"],
    }

    _CODE_STRONG_KEYWORDS = {"python", "javascript", "java", "c++", "rust", "golang", "typescript", "代码", "编程", "程序", "脚本", "code", "program", "script", "算法"}

    _CREATION_STRONG_KEYWORDS = {"写一篇", "写篇文章", "创作文章", "创作一篇", "撰写文章", "撰写一篇", "写一篇文章", "帮我写一篇", "写一篇关于", "write an article", "create an article"}

    _INTENT_STEP_TEMPLATES: Dict[str, List[dict]] = {
        "creation": [
            {"name": "选题研究", "type": "agent", "agent": "topic_research", "input": {}, "description": "研究选题角度"},
            {"name": "搜索素材", "type": "tool", "tool": "web_search", "input": {}, "description": "搜索相关素材"},
            {"name": "撰写文章", "type": "agent", "agent": "article_writing", "input": {}, "description": "撰写文章初稿"},
            {"name": "文章评估", "type": "agent", "agent": "article_eval", "input": {}, "description": "评估文章质量"},
            {"name": "内容审核", "type": "agent", "agent": "content_audit", "input": {}, "description": "内容合规审核"},
        ],
        "write": [
            {"name": "搜索素材", "type": "tool", "tool": "web_search", "input": {}, "description": "搜索相关素材"},
            {"name": "撰写内容", "type": "agent", "agent": "article_writing", "input": {}, "description": "撰写文章内容"},
        ],
        "search": [
            {"name": "搜索信息", "type": "tool", "tool": "web_search", "input": {}, "description": "搜索相关信息"},
            {"name": "整理回复", "type": "generate", "description": "整理搜索结果并回复"},
        ],
        "research": [
            {"name": "搜索资料", "type": "tool", "tool": "web_search", "input": {}, "description": "搜索研究资料"},
            {"name": "深度研究", "type": "agent", "agent": "research_agent", "input": {}, "description": "深度研究分析"},
            {"name": "整理报告", "type": "generate", "description": "整理研究报告"},
        ],
        "code": [
            {"name": "编写代码", "type": "agent", "agent": "code_writer_agent", "input": {}, "description": "编写代码"},
        ],
        "translate": [
            {"name": "翻译文本", "type": "agent", "agent": "multilingual", "input": {}, "description": "翻译文本"},
        ],
        "analyze": [
            {"name": "搜索信息", "type": "tool", "tool": "web_search", "input": {}, "description": "搜索相关信息"},
            {"name": "分析整理", "type": "generate", "description": "分析并整理结果"},
        ],
    }

    _SIMPLE_PATTERNS = [
        (r'^(你好|hi|hello|hey|嗨|哈喽|在吗|在不在|有人吗|hello there)[\s!！。.]*$', True),
        (r'^(谢谢|感谢|thanks|thank you|thx|3q|多谢)[\s!！。.]*$', True),
        (r'^(好的|ok|okay|行|可以|明白了|知道了|懂了|收到|了解|get it|got it)[\s!！。.]*$', True),
        (r'^(再见|拜拜|bye|goodbye|88|晚安|早安|早上好|中午好|晚上好|下午好)[\s!！。.]*$', True),
        (r'^(你是谁|你叫什么|what are you|who are you|what is your name)[\s?？!！。.]*(你能做什么|what can you do|介绍一下你自己|自我介绍|介绍下你自己)?[\s?？!！。.]*$', True),
        (r'^(你能做什么|what can you do|介绍一下你自己|自我介绍|介绍下你自己)[\s?？!！。.]*$', True),
    ]

    _COMPLEX_PATTERNS = [
        (r'写.*文章|创作|写一篇|帮我写|写个|generate.*article|write.*article|写.*报告', False),
        (r'搜索|帮我搜|search.*for|搜一下|查一下|帮我查|研究.*现状|research|调研', False),
        (r'分析|analyze|深度分析|帮我分析|分析一下', False),
        (r'翻译|translate|帮我翻译|翻译成', False),
        (r'写.*代码|编程|帮我写.*代码|generate.*code|write.*code|写个.*程序', False),
    ]

    def parse_execution_plan(self, content: str) -> dict:
        """Robust JSON extraction from potentially malformed LLM output.

        Handles: JSON inside markdown blocks, extra text before/after JSON,
        conversational responses (treats as simple chat), and partial JSON.
        Also handles LLM outputting intent classification without full plan
        by inferring steps from intent_type.
        """
        if not content or not content.strip():
            return {"intent_type": "chat", "complexity": "simple", "plan": []}

        cleaned = content.strip()

        for marker in ["```json", "```JSON", "```"]:
            if marker in cleaned:
                start = cleaned.find(marker) + len(marker)
                end = cleaned.rfind("```")
                if end > start:
                    cleaned = cleaned[start:end].strip()
                else:
                    cleaned = cleaned[start:].strip()
                break

        try:
            json_match = re.search(r'\{[\s\S]*\}', cleaned)
            if json_match:
                candidate = json_match.group()
                plan = json.loads(candidate)
                if "plan" in plan or "intent_type" in plan:
                    if not isinstance(plan.get("plan"), list):
                        plan["plan"] = []
                    validated_steps = []
                    for step in plan.get("plan", []):
                        if isinstance(step, dict):
                            step_name = step.get("name") or step.get("step")
                            if step_name:
                                if "name" not in step:
                                    step["name"] = step_name
                                validated_steps.append(step)
                    plan["plan"] = validated_steps
                    return plan
        except (json.JSONDecodeError, KeyError, ValueError):
            pass

        if len(content) > 100 and '{' not in content:
            logger.info("Planning output is conversational → treating as simple chat")

        return {"intent_type": "chat", "complexity": "simple", "plan": []}

    def is_simple_message(self, intent: str) -> bool:
        """Detect trivial messages that don't need planning phase."""
        if not intent or not isinstance(intent, str):
            return True
        stripped = intent.strip()

        for pattern, _ in self._COMPLEX_PATTERNS:
            if re.search(pattern, stripped, re.IGNORECASE):
                return False

        for pattern, _ in self._SIMPLE_PATTERNS:
            if re.search(pattern, stripped, re.IGNORECASE):
                return True

        if len(stripped) <= 8:
            return True

        return False

    def infer_intent_type_from_text(self, text: str) -> str:
        """Infer intent type from user input text using keyword matching."""
        if not text:
            return "chat"
        text_lower = text.lower()
        for kw in self._CREATION_STRONG_KEYWORDS:
            if kw in text_lower:
                return "creation"
        best_type = "chat"
        best_score = 0
        for intent_type, keywords in self._INTENT_KEYWORDS.items():
            if intent_type == "creation":
                continue
            score = 0
            for kw in keywords:
                if kw in text_lower:
                    if intent_type == "code" and kw in self._CODE_STRONG_KEYWORDS:
                        score += 2
                    else:
                        score += 1
            if score > best_score:
                best_score = score
                best_type = intent_type
        return best_type if best_score > 0 else "chat"

    def infer_steps_from_intent(self, intent_type: str, intent: str) -> list:
        """Infer execution steps from intent_type when planner returns empty plan."""
        template = self._INTENT_STEP_TEMPLATES.get(intent_type, [])
        if not template:
            return []

        inferred = []
        for step in template:
            s = dict(step)
            if not s.get("input"):
                s["input"] = {}
            s["input"].setdefault("query", intent)
            s["input"].setdefault("topic", intent)
            s["input"].setdefault("task", intent)
            if s.get("agent") != "multilingual":
                s["input"].setdefault("text", intent)
            inferred.append(s)
        return inferred

    def extract_step_content(self, sr: dict) -> str:
        """Extract readable text content from a step result dict."""
        if sr.get("content"):
            return sr["content"]

        result = sr.get("result")
        if not result:
            return ""

        if isinstance(result, str):
            return result

        if isinstance(result, dict):
            for key in ["content", "text", "output", "draft", "result", "response", "answer"]:
                val = result.get(key)
                if val:
                    if isinstance(val, str) and len(val.strip()) > 5:
                        return val
                    if isinstance(val, dict):
                        for k2 in ["content", "text", "output", "draft"]:
                            v2 = val.get(k2)
                            if isinstance(v2, str) and len(v2.strip()) > 5:
                                return v2
            longest = ""
            for v in result.values():
                if isinstance(v, str) and len(v) > len(longest):
                    longest = v
                elif isinstance(v, dict):
                    for v2 in v.values():
                        if isinstance(v2, str) and len(v2) > len(longest):
                            longest = v2
            if longest.strip():
                return longest

        return str(result) if result else ""

    def find_best_text_in_context(self, step_context: dict) -> str:
        """Find the best text content from accumulated step context."""
        best = ""
        for key, val in step_context.items():
            if not isinstance(val, str):
                continue
            if key.startswith("_output_") and len(val) > len(best):
                best = val
        last = step_context.get("_last_output", "")
        if isinstance(last, str) and len(last) > len(best):
            best = last
        return best
