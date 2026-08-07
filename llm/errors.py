"""LLM error classification.

Categories (mutually exclusive):
- permanent: do NOT retry; skip to next provider in fallback chain
    - model_not_found, no_permission, invalid_argument
- temporary: retry with exponential backoff
    - rate_limited, upstream_timeout, server_error
- empty: do NOT retry current provider; fall through to next
    - empty_response
- silent_failure: HTTP 200 but body contains disguised error; treat as permanent
    - "model disabled", "all_backends_failed", "无权访问",
      "当前不可用，请稍后重试", "当前不可用,请稍后重试"
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from flowforge.core.errors import LLMError


class LLMErrorKind(str, Enum):
    PERMANENT = "permanent"
    TEMPORARY = "temporary"
    EMPTY = "empty"
    SILENT_FAILURE = "silent_failure"


PERMANENT_KEYWORDS = (
    "model_not_found",
    "model disabled",
    "no_permission",
    "无权访问",
    "invalid_argument",
    "all_backends_failed",
    "unauthorized",
    "authentication",
)

TEMPORARY_KEYWORDS = (
    "rate_limit",
    "rate limited",
    "timeout",
    "timed out",
    "server_error",
    "service_unavailable",
    "bad_gateway",
    "connection_reset",
)

SILENT_FAILURE_PATTERNS = (
    "当前不可用，请稍后重试",
    "当前不可用,请稍后重试",
    "当前不可用，请稍后",
    "当前不可用,请稍后",
    "model disabled",
    "all_backends_failed",
)

INVALID_RESPONSE_PATTERNS = (
    "无法回答",
    "无法回答这个问题",
    "我暂时无法回答",
    "我不能回答",
    "我无法提供",
    "我无法完成",
)


class EmptyResponseError(LLMError):
    """Provider returned HTTP 200 but the content was empty."""


class SilentFailureError(LLMError):
    """Provider returned HTTP 200 but body contains a disguised error message."""


def is_silent_failure(content: str) -> bool:
    """Return True if content matches any known silent-failure pattern."""
    if not content:
        return False
    return any(p in content for p in SILENT_FAILURE_PATTERNS)


def is_invalid_content(content: str) -> bool:
    """Return True if content is a refusal pattern that should trigger fallback.

    To avoid false positives on long responses that happen to contain a
    refusal phrase mid-text (e.g. "我无法提供具体的端口信息，但可以..."),
    we only flag as invalid when:
    - the content is very short (<= 80 chars) and contains a refusal pattern, OR
    - the content starts with a refusal pattern (first 40 chars).
    """
    if not content:
        return True
    stripped = content.strip()
    if not stripped:
        return True
    # Short refusal: the entire response is basically a refusal sentence.
    if len(stripped) <= 80 and any(p in stripped for p in INVALID_RESPONSE_PATTERNS):
        return True
    # Leading refusal: response begins with a refusal phrase.
    head = stripped[:40]
    if any(p in head for p in INVALID_RESPONSE_PATTERNS):
        return True
    return False


def classify_error(error: BaseException | str, response_body: Any = None) -> LLMErrorKind:
    """Classify an error or response body into one of LLMErrorKind.

    Order matters: silent_failure → permanent → temporary → empty.
    """
    # Inspect response_body first (silent failure detection)
    if response_body is not None:
        body_str = _stringify(response_body)
        if is_silent_failure(body_str):
            return LLMErrorKind.SILENT_FAILURE
        if not body_str.strip():
            return LLMErrorKind.EMPTY

    msg = str(error).lower() if not isinstance(error, str) else error.lower()

    if any(kw in msg for kw in SILENT_FAILURE_PATTERNS):
        return LLMErrorKind.SILENT_FAILURE
    if any(kw in msg for kw in PERMANENT_KEYWORDS):
        return LLMErrorKind.PERMANENT
    if any(kw in msg for kw in TEMPORARY_KEYWORDS):
        return LLMErrorKind.TEMPORARY
    if "empty" in msg or "no content" in msg:
        return LLMErrorKind.EMPTY
    # Default: treat unknown as temporary (safer to retry once)
    return LLMErrorKind.TEMPORARY


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        import json

        return json.dumps(value, ensure_ascii=False)
    except Exception:  # noqa: BLE001
        return str(value)
