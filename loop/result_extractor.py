"""LoopResult 内容提取工具 — 从 LoopExecutor 的执行结果中提取内容、分数、标题。

重构后 contentforge/brain/orchestrator.py 会被删除，
其中的内容提取逻辑迁移到此模块，作为 flowforge 的通用能力。

使用方式:
    from flowforge.loop.result_extractor import (
        extract_content, extract_quality_score, extract_title, extract_result_summary
    )
"""
import json
import logging
import os
from typing import Any

from flowforge.loop.state import LoopResult

logger = logging.getLogger(__name__)

# v4.6 调试日志开关
CF_DEBUG = os.environ.get("CF_DEBUG", "").lower() in ("1", "true", "yes")


def _strip_json_wrapper(content: str) -> str:
    """剥离内容中的 JSON 包装，提取纯文本/markdown。

    ToolOutput result dict 在管道中可能被序列化为 JSON 字符串，
    导致提取到的 edited_draft/draft 字段值本身是
    '{"edited_draft": "# ...", "seo_title": "...", "refined": true}'。
    此函数递归解析（最多3层），提取纯内容。
    """
    if not content or not isinstance(content, str):
        return content
    stripped = content.strip()
    if not stripped.startswith("{"):
        return content
    for _ in range(3):
        try:
            parsed = json.loads(stripped)
            if not isinstance(parsed, dict):
                break
            extracted = ""
            for key in ("edited_draft", "draft", "content", "polished_content",
                        "output", "response", "result", "article", "text"):
                val = parsed.get(key, "")
                if isinstance(val, str) and val.strip():
                    extracted = val
                    break
            if not extracted:
                break
            stripped = extracted.strip()
            if not stripped.startswith("{"):
                return stripped
        except (json.JSONDecodeError, TypeError):
            break
    return content


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

    # v4.6 最终安全网: 确保返回纯 markdown，剥离任何残留的 JSON 包装
    if content and isinstance(content, str) and content.strip().startswith("{"):
        cleaned = _strip_json_wrapper(content)
        if cleaned != content:
            logger.warning(f"[result_extractor] 最终安全网剥离JSON: {len(content)} → {len(cleaned)}")
            if CF_DEBUG:
                logger.info(f"[CF-DEBUG] 最终剥离: before={content[:200]!r} → after={cleaned[:200]!r}")
            content = cleaned

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


def _looks_like_echo_or_instructions(content: str) -> bool:
    """检测内容是否为 LLM echo（回显提示词指令）而非真实文章。

    LLM 偶尔会将提示词指令作为内容返回，例如：
    - "我需要严格遵守以下规则..."
    - "让我思考一下..."
    - "按照以下要求撰写..."
    - "根据提示，我需要..."

    这类内容不能作为最终文章输出，必须跳过。
    """
    if not content or not isinstance(content, str):
        return False
    head = content[:500]  # 只检查开头500字（echo 通常在开头）
    echo_patterns = (
        "我需要严格遵守",
        "我需要严格按照",
        "让我思考一下",
        "让我数一下",
        "让我分析一下",
        "按照以下要求",
        "根据提示",
        "根据上述要求",
        "根据您的要求",
        "我需要遵循以下",
        "我需要按照",
        "我要按照以下",
        "我需要先",
        "我需要增加",
        "我需要确保",
        "我需要撰写",
        "我将按照",
        "我会按照",
        "我的任务",
        "根据规则",
        "根据以下规则",
        "严格按照规则",
        "下面我来",
        "接下来我",
        "我打算",
        "首先我需要",
    )
    for pat in echo_patterns:
        if pat in head:
            if CF_DEBUG:
                logger.info(f"[CF-DEBUG] echo检测命中: pattern={pat!r}, head={head[:100]!r}")
            return True
    return False


def _deep_extract_content(data: dict, depth: int = 0) -> str:
    """递归提取内容：优先查找已知键，然后遍历所有值找长文本。"""
    if depth > 3 or not isinstance(data, dict):
        return ""
    # v5.99.30 修复: echo 污染防护
    # 问题: glm-4-flash 等模型有时将提示词指令作为 draft 返回（如"我需要严格遵守以下规则..."），
    #   导致 draft 字段被 echo 污染且字数虚高（3819字 > edited_draft 2334字），
    #   旧逻辑"取较长者"会错误选中被污染的 draft。
    # 修复策略:
    #   1. 按优先级顺序遍历 (edited_draft > polished_content > content > response > draft)
    #   2. 跳过被 echo 污染的候选（_looks_like_echo_or_instructions）
    #   3. 返回第一个干净的候选（尊重优先级，而非取最长）
    #   4. 若全部被污染，取最长者兜底（总比返回空好，下游还有清洗逻辑）
    candidate = ""
    candidate_key = ""
    fallback = ""  # 被echo污染的候选中最长者（最后兜底用）
    fallback_key = ""
    for key in ("edited_draft", "polished_content", "content", "response", "draft"):
        val = data.get(key, "")
        if isinstance(val, str) and len(val.strip()) > 100:
            # v4.6 修复: 剥离可能存在的 JSON 包装（ToolOutput result dict 被序列化为 JSON 字符串）
            val = _strip_json_wrapper(val)
            if not isinstance(val, str) or len(val.strip()) <= 100:
                continue
            # v5.99.30: 检测 echo/指令污染，跳过被污染的候选
            if _looks_like_echo_or_instructions(val):
                logger.warning(f"[result_extractor] key={key} 疑似echo污染(len={len(val)})，跳过")
                if len(val) > len(fallback):
                    fallback = val
                    fallback_key = key
                continue
            # v5.99.30: 返回第一个干净候选（尊重优先级），不再取最长
            candidate = val
            candidate_key = key
            break
    # 若无干净候选，用被污染的最长者兜底（下游仍有 _strip_intent_echo 等清洗）
    if not candidate and fallback:
        logger.warning(f"[result_extractor] 所有候选均疑似echo污染，使用兜底 key={fallback_key} len={len(fallback)}")
        candidate = fallback
        candidate_key = fallback_key
    if candidate:
        if depth == 0:
            logger.info(f"[result_extractor] 提取自 key={candidate_key}, len={len(candidate)}")
        if CF_DEBUG and candidate.startswith("{"):
            logger.info(f"[CF-DEBUG] result_extractor 提取后仍以{{开头(异常): key={candidate_key}, preview={candidate[:200]!r}")
        return candidate
    # 2. 查找嵌套的result/output字段
    for key in ("result", "output", "results"):
        inner = data.get(key)
        if isinstance(inner, dict):
            found = _deep_extract_content(inner, depth + 1)
            if found:
                return found
        elif isinstance(inner, str) and len(inner.strip()) > 100:
            # v4.6 修复: 剥离 JSON 包装
            inner = _strip_json_wrapper(inner)
            if isinstance(inner, str) and len(inner.strip()) > 100:
                return inner
    # 3. 遍历所有值，查找长文本（可能是中文step名的输出）
    for key, val in data.items():
        if key.startswith("_"):  # 跳过内部字段
            continue
        if isinstance(val, str) and len(val.strip()) > 200:
            # v4.6 修复: 剥离 JSON 包装
            val = _strip_json_wrapper(val)
            if isinstance(val, str) and len(val.strip()) > 100:
                return val
        if isinstance(val, dict):
            found = _deep_extract_content(val, depth + 1)
            if found:
                return found
    return ""
