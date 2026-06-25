"""LoopResult 内容提取工具 — 从 LoopExecutor 的执行结果中提取内容、分数、标题。

重构后 contentforge/brain/orchestrator.py 会被删除，
其中的内容提取逻辑迁移到此模块，作为 flowforge 的通用能力。

使用方式:
    from flowforge.loop.result_extractor import (
        extract_content, extract_quality_score, extract_title, extract_result_summary
    )
"""
import logging
from typing import Any

from flowforge.loop.state import LoopResult

logger = logging.getLogger(__name__)


def extract_content(result: LoopResult, task_context=None) -> str:
    """从 LoopResult 递归深度提取内容。

    支持多种输出格式:
    - 格式1: Agent直接输出 → output有draft/response键
    - 格式2: plan_execute回退 → output有中文step名(如'撰写文章')，内容在嵌套结构中
    - 格式3: WorkflowExecutor包装 → output有result子字段
    """
    content = ""

    if result.output and isinstance(result.output, dict):
        content = _deep_extract_content(result.output)
        if content:
            logger.info(f"[result_extractor] 深度提取到内容, len={len(content)}")
        else:
            logger.warning(f"[result_extractor] 深度提取未找到内容, output keys={list(result.output.keys())}")

    # 也尝试从 task_context 提取（Agent 可能通过 state_updates 传递）
    if not content and task_context is not None:
        state = getattr(task_context, 'state', None)
        if state and isinstance(state, dict):
            content = _deep_extract_content(state)
            if content:
                logger.info(f"[result_extractor] 从 task_context.state 提取到内容, len={len(content)}")

    return content


def extract_quality_score(result: LoopResult) -> float:
    """从 LoopResult 提取最后一次评审分数。"""
    quality_score = 0.0
    if result.state and hasattr(result.state, 'verification_history') and result.state.verification_history:
        last_verdict = result.state.verification_history[-1]
        quality_score = last_verdict.get("score", 0.0)
    elif result.state and hasattr(result.state, 'last_score'):
        quality_score = result.state.last_score or 0.0
    return quality_score


def extract_title(content: str) -> str:
    """从 Markdown 内容中提取第一个标题。"""
    if not content:
        return ""
    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("#"):
            return line.lstrip("#").strip()[:60]
    return ""


def extract_result_summary(result: LoopResult, task_context=None) -> dict:
    """一次性提取所有结果信息：内容、分数、标题、迭代次数。"""
    content = extract_content(result, task_context)
    quality_score = extract_quality_score(result)
    title = extract_title(content)
    iterations = result.total_attempts

    return {
        "content": content,
        "title": title,
        "word_count": len(content) if content else 0,
        "quality_score": quality_score,
        "iterations": iterations,
        "loop_success": result.success,
    }


def _deep_extract_content(data: dict, depth: int = 0) -> str:
    """递归提取内容：优先查找已知键，然后遍历所有值找长文本。"""
    if depth > 3 or not isinstance(data, dict):
        return ""
    # 1. 优先查找已知内容键
    for key in ("draft", "edited_draft", "content", "response"):
        val = data.get(key, "")
        if isinstance(val, str) and len(val.strip()) > 100:
            return val
    # 2. 查找嵌套的result/output字段
    for key in ("result", "output", "results"):
        inner = data.get(key)
        if isinstance(inner, dict):
            found = _deep_extract_content(inner, depth + 1)
            if found:
                return found
        elif isinstance(inner, str) and len(inner.strip()) > 100:
            return inner
    # 3. 遍历所有值，查找长文本（可能是中文step名的输出）
    for key, val in data.items():
        if key.startswith("_"):  # 跳过内部字段
            continue
        if isinstance(val, str) and len(val.strip()) > 200:
            return val
        if isinstance(val, dict):
            found = _deep_extract_content(val, depth + 1)
            if found:
                return found
    return ""
