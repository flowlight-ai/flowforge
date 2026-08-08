"""FlowForge LLM client layer — provider abstraction + error classification + retry.

Design principles (from project_memory):
- Exponential backoff for temporary errors
- Skip retry for permanent errors (model_not_found, no_permission, empty_response)
- Cross-vendor fallback chain
- Detect silent failures (HTTP 200 + content like "当前不可用，请稍后重试")
- Log input, output, and execution time for every call
"""

from __future__ import annotations

from flowforge.llm.client import LLMClient
from flowforge.llm.errors import (
    EmptyResponseError,
    LLMErrorKind,
    SilentFailureError,
    classify_error,
)
from flowforge.llm.provider import (
    DirectProvider,
    LLMProvider,
    LLMResponse,
    OpenRouteProvider,
    ProviderResponse,
    WebchatProvider,
)

__all__ = [
    "DirectProvider",
    "EmptyResponseError",
    "LLMClient",
    "LLMErrorKind",
    "LLMProvider",
    "LLMResponse",
    "OpenRouteProvider",
    "ProviderResponse",
    "SilentFailureError",
    "WebchatProvider",
    "classify_error",
]
