"""LLMClient — orchestrates providers with retry + cross-vendor fallback.

Algorithm (per project_memory hard constraints):
1. For each (model, provider) in fallback chain (cross-vendor ordered):
   a. Try up to max_retries times with exponential backoff
      backoff = retry_delay * 2^attempt
   b. Skip retries if error is permanent or empty
   c. Detect silent failure (HTTP 200 + disguised error) and treat as permanent
2. If all providers fail, raise LLMError

Every call logs: prompt length, model, provider, latency, outcome.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

from flowforge.core.errors import LLMError
from flowforge.core.tracing import get_logger
from flowforge.llm.errors import (
    EmptyResponseError,
    LLMErrorKind,
    SilentFailureError,
    classify_error,
    is_invalid_content,
)
from flowforge.llm.provider import LLMProvider, ProviderResponse

logger = get_logger("flowforge.llm.client")


@dataclass(frozen=True)
class FallbackEntry:
    """One entry in the cross-vendor fallback chain."""

    model: str
    provider: LLMProvider
    priority: int = 0  # lower = tried first


class LLMClient:
    """Orchestrates one or more providers with retry + fallback."""

    def __init__(
        self,
        fallback_chain: list[FallbackEntry],
        max_retries: int = 3,
        retry_delay: float = 1.0,
        prefer_api: bool = True,
    ) -> None:
        if not fallback_chain:
            raise ValueError("fallback_chain must not be empty")
        # Sort by priority (ascending)
        self._chain = sorted(fallback_chain, key=lambda e: e.priority)
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.prefer_api = prefer_api
        self._call_log: list[dict[str, Any]] = []

    async def complete(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
        timeout: float = 90.0,
        **kwargs: Any,
    ) -> ProviderResponse:
        """Try every provider in the fallback chain until one succeeds."""
        last_exc: Exception | None = None
        for entry in self._chain:
            try:
                resp = await self._try_with_retry(
                    entry,
                    prompt,
                    system_prompt=system_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout=timeout,
                    **kwargs,
                )
                # Validate the response is not a silent refusal
                if is_invalid_content(resp.text):
                    logger.warning(
                        f"llm invalid/refusal content from {entry.provider.vendor}/{entry.model}"
                    )
                    last_exc = EmptyResponseError(
                        f"refusal content from {entry.provider.vendor}/{entry.model}"
                    )
                    continue
                return resp
            except (EmptyResponseError, SilentFailureError) as exc:
                logger.info(
                    f"llm skip {entry.provider.vendor}/{entry.model}: {exc.__class__.__name__}"
                )
                last_exc = exc
                continue
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    f"llm {entry.provider.vendor}/{entry.model} failed: {exc!r}"
                )
                last_exc = exc
                continue
        raise LLMError(
            f"All providers in fallback chain exhausted (last error: {last_exc!r})",
            cause=last_exc,
        )

    async def _try_with_retry(
        self,
        entry: FallbackEntry,
        prompt: str,
        *,
        system_prompt: str | None,
        temperature: float,
        max_tokens: int,
        timeout: float,
        **kwargs: Any,
    ) -> ProviderResponse:
        """Try one provider up to max_retries with exponential backoff."""
        attempt = 0
        last_exc: Exception | None = None
        while attempt < self.max_retries:
            attempt += 1
            start = time.perf_counter()
            try:
                resp = await entry.provider.complete(
                    prompt,
                    model=entry.model,
                    system_prompt=system_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout=timeout,
                    **kwargs,
                )
                elapsed_ms = (time.perf_counter() - start) * 1000
                self._log_call(
                    entry=entry,
                    prompt_len=len(prompt),
                    response=resp,
                    elapsed_ms=elapsed_ms,
                    attempt=attempt,
                    outcome="success",
                )
                # Silent failure detection: HTTP 200 with disguised error
                if resp.finish_reason == "error" or _looks_like_silent_failure(resp.text):
                    raise SilentFailureError(
                        f"silent failure from {entry.provider.vendor}/{entry.model}: "
                        f"{resp.text[:120]!r}"
                    )
                if not resp.text.strip():
                    raise EmptyResponseError(
                        f"empty response from {entry.provider.vendor}/{entry.model}"
                    )
                return resp
            except (EmptyResponseError, SilentFailureError):
                # Do not retry empty/silent failures — fall through to next provider
                raise
            except Exception as exc:  # noqa: BLE001
                elapsed_ms = (time.perf_counter() - start) * 1000
                kind = classify_error(exc)
                self._log_call(
                    entry=entry,
                    prompt_len=len(prompt),
                    response=None,
                    elapsed_ms=elapsed_ms,
                    attempt=attempt,
                    outcome=f"error:{kind.value}",
                    error=str(exc)[:200],
                )
                last_exc = exc
                if kind in (LLMErrorKind.PERMANENT, LLMErrorKind.SILENT_FAILURE):
                    # Skip retry entirely — fall through to next provider
                    raise
                # Temporary: exponential backoff
                backoff = self.retry_delay * (2 ** (attempt - 1))
                logger.debug(
                    f"llm retry backoff: {entry.provider.vendor}/{entry.model} "
                    f"attempt={attempt} wait={backoff:.2f}s"
                )
                await asyncio.sleep(backoff)
        # Loop exited without success — re-raise the last error
        raise last_exc if last_exc else LLMError(f"Unknown failure on {entry.model}")

    def _log_call(
        self,
        *,
        entry: FallbackEntry,
        prompt_len: int,
        response: ProviderResponse | None,
        elapsed_ms: float,
        attempt: int,
        outcome: str,
        error: str | None = None,
    ) -> None:
        record = {
            "vendor": entry.provider.vendor,
            "model": entry.model,
            "prompt_len": prompt_len,
            "response_len": len(response.text) if response else 0,
            "elapsed_ms": round(elapsed_ms, 2),
            "attempt": attempt,
            "outcome": outcome,
        }
        if error:
            record["error"] = error
        self._call_log.append(record)
        logger.info(
            f"llm call: vendor={entry.provider.vendor} model={entry.model} "
            f"attempt={attempt} elapsed={elapsed_ms:.0f}ms outcome={outcome}"
        )

    def get_call_log(self) -> list[dict[str, Any]]:
        return list(self._call_log)


def _looks_like_silent_failure(text: str) -> bool:
    """Check if text contains a silent-failure pattern (re-exported helper)."""
    from flowforge.llm.errors import is_silent_failure

    return is_silent_failure(text)
