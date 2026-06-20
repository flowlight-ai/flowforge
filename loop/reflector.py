"""Loop Reflector — analyzes failures and generates improvements."""

import json
import logging

from abc import ABC, abstractmethod
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.task_context import TaskContext
from flowforge.loop.state import LoopState, Reflection

logger = logging.getLogger(__name__)

# Keyword-based root cause inference rules for fallback logic
_ERROR_PATTERNS = [
    ("timeout", "执行超时，考虑减少步骤数量或优化耗时操作"),
    ("connection", "网络连接失败，考虑增加重试机制或检查服务可用性"),
    ("rate_limit", "API 速率限制，考虑降低请求频率或增加间隔"),
    ("quality", "质量不达标，考虑增加约束条件或细化执行步骤"),
    ("format", "输出格式错误，考虑在提示词中明确格式要求"),
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

        if self.llm_client is not None:
            try:
                reflection = await self._llm_reflect(errors, task, state)
                if reflection:
                    logger.info(f"[reflector] LLM反思完成: root_cause={reflection.root_cause[:100]}, "
                                 f"suggestions_count={len(reflection.suggestions)}, "
                                 f"suggestions={reflection.suggestions[:3]}")
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

        prompt = get_prompt("loop.reflector.reflect",
                            errors=json.dumps(errors, ensure_ascii=False),
                            task_id=task.task_id,
                            input_data=json.dumps(task.input_data, ensure_ascii=False, default=str),
                            attempt=str(state.attempt),
                            history=history_str)
        response = await self.llm_client.chat(prompt)
        return self._parse_reflection_response(response)

    def _parse_reflection_response(self, response: str) -> Reflection | None:
        """Parse LLM response into a Reflection. Returns None on failure."""
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
            text = "\n".join(json_lines).strip()

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            start = text.find("{")
            end = text.rfind("}")
            if start == -1 or end == -1:
                return None
            try:
                parsed = json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return None

        if not isinstance(parsed, dict):
            return None

        root_cause = parsed.get("root_cause", "")
        suggestions = parsed.get("suggestions", [])
        plan_adjustments = parsed.get("plan_adjustments", [])

        if not isinstance(suggestions, list):
            suggestions = [str(suggestions)]
        if not isinstance(plan_adjustments, list):
            plan_adjustments = []

        return Reflection(
            root_cause=str(root_cause),
            suggestions=[str(s) for s in suggestions],
            plan_adjustments=[a for a in plan_adjustments if isinstance(a, dict)],
        )

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
