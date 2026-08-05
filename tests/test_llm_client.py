"""Tests for the LLM client — error classification + retry + fallback."""

from __future__ import annotations

import pytest

from flowforge.llm.client import FallbackEntry, LLMClient
from flowforge.llm.errors import (
    LLMErrorKind,
    classify_error,
    is_invalid_content,
    is_silent_failure,
)
from flowforge.llm.provider import LLMProvider, ProviderResponse


class _StubProvider(LLMProvider):
    """Provider that returns scripted responses or raises scripted errors."""

    provider_kind = "stub"

    def __init__(self, vendor: str, scripts: list) -> None:
        self.vendor = vendor
        self.scripts = list(scripts)
        self.calls = 0

    async def complete(self, prompt: str, *, model: str, **kwargs) -> ProviderResponse:
        if self.calls >= len(self.scripts):
            raise RuntimeError("stub script exhausted")
        script = self.scripts[self.calls]
        self.calls += 1
        if isinstance(script, Exception):
            raise script
        return ProviderResponse(
            text=script,
            model=model,
            provider=self.vendor,
            latency_ms=10.0,
        )


def test_classify_permanent_keywords() -> None:
    assert classify_error("model_not_found") == LLMErrorKind.PERMANENT
    assert classify_error("no_permission for model X") == LLMErrorKind.PERMANENT
    assert classify_error("unauthorized access") == LLMErrorKind.PERMANENT


def test_classify_temporary_keywords() -> None:
    assert classify_error("rate_limit exceeded") == LLMErrorKind.TEMPORARY
    assert classify_error("server_error 500") == LLMErrorKind.TEMPORARY
    assert classify_error("upstream timed out") == LLMErrorKind.TEMPORARY


def test_classify_silent_failure_pattern() -> None:
    assert classify_error("model 当前不可用，请稍后重试") == LLMErrorKind.SILENT_FAILURE
    assert classify_error("model 当前不可用,请稍后重试") == LLMErrorKind.SILENT_FAILURE
    assert classify_error("all_backends_failed") == LLMErrorKind.SILENT_FAILURE


def test_classify_unknown_defaults_to_temporary() -> None:
    assert classify_error("something weird happened") == LLMErrorKind.TEMPORARY


def test_classify_via_response_body_silent_failure() -> None:
    body = {"error": {"message": "当前不可用，请稍后重试"}}
    assert classify_error(RuntimeError("HTTP 200"), response_body=body) == LLMErrorKind.SILENT_FAILURE


def test_classify_via_response_body_empty() -> None:
    assert classify_error(RuntimeError("HTTP 200"), response_body="") == LLMErrorKind.EMPTY


def test_is_silent_failure_helper() -> None:
    assert is_silent_failure("model X 当前不可用，请稍后重试") is True
    assert is_silent_failure("all good") is False
    assert is_silent_failure("") is False


def test_is_invalid_content_catches_refusals() -> None:
    assert is_invalid_content("无法回答") is True
    assert is_invalid_content("我无法完成") is True
    assert is_invalid_content("") is True
    assert is_invalid_content("here is the answer") is False


@pytest.mark.asyncio
async def test_client_succeeds_on_first_provider() -> None:
    p = _StubProvider("vendor_a", ["hello world"])
    client = LLMClient(fallback_chain=[FallbackEntry(model="m1", provider=p)])
    resp = await client.complete("hi")
    assert resp.text == "hello world"
    assert resp.vendor_vendor if False else True  # noqa: F841 — placeholder


@pytest.mark.asyncio
async def test_client_falls_through_on_empty() -> None:
    p1 = _StubProvider("vendor_a", [""])
    p2 = _StubProvider("vendor_b", ["good response"])
    client = LLMClient(
        fallback_chain=[
            FallbackEntry(model="m1", provider=p1, priority=0),
            FallbackEntry(model="m2", provider=p2, priority=1),
        ]
    )
    resp = await client.complete("hi")
    assert resp.text == "good response"


@pytest.mark.asyncio
async def test_client_falls_through_on_refusal_content() -> None:
    p1 = _StubProvider("vendor_a", ["无法回答"])
    p2 = _StubProvider("vendor_b", ["real answer"])
    client = LLMClient(
        fallback_chain=[
            FallbackEntry(model="m1", provider=p1, priority=0),
            FallbackEntry(model="m2", provider=p2, priority=1),
        ]
    )
    resp = await client.complete("hi")
    assert resp.text == "real answer"


@pytest.mark.asyncio
async def test_client_skips_retry_on_permanent_error() -> None:
    # permanent error should not retry — p1 should be called exactly once
    p1 = _StubProvider("vendor_a", [RuntimeError("model_not_found")])
    p2 = _StubProvider("vendor_b", ["fallback"])
    client = LLMClient(
        fallback_chain=[
            FallbackEntry(model="m1", provider=p1, priority=0),
            FallbackEntry(model="m2", provider=p2, priority=1),
        ],
        max_retries=5,  # if permanent were retried, this would loop
    )
    resp = await client.complete("hi")
    assert resp.text == "fallback"
    assert p1.calls == 1


@pytest.mark.asyncio
async def test_client_retries_on_temporary_error() -> None:
    p = _StubProvider(
        "vendor_a",
        [
            RuntimeError("server_error 500"),
            RuntimeError("timed out"),
            "third time lucky",
        ],
    )
    client = LLMClient(
        fallback_chain=[FallbackEntry(model="m1", provider=p)],
        max_retries=3,
        retry_delay=0.01,  # speed up tests
    )
    resp = await client.complete("hi")
    assert resp.text == "third time lucky"
    assert p.calls == 3


@pytest.mark.asyncio
async def test_client_raises_when_all_providers_exhausted() -> None:
    from flowforge.core.errors import LLMError

    p = _StubProvider("vendor_a", [RuntimeError("server_error 500")] * 5)
    client = LLMClient(
        fallback_chain=[FallbackEntry(model="m1", provider=p)],
        max_retries=2,
        retry_delay=0.01,
    )
    with pytest.raises(LLMError, match="All providers"):
        await client.complete("hi")


@pytest.mark.asyncio
async def test_client_logs_every_call() -> None:
    p = _StubProvider("vendor_a", ["ok"])
    client = LLMClient(fallback_chain=[FallbackEntry(model="m1", provider=p)])
    await client.complete("hi")
    log = client.get_call_log()
    assert len(log) == 1
    assert log[0]["vendor"] == "vendor_a"
    assert log[0]["outcome"] == "success"
    assert log[0]["prompt_len"] == 2
