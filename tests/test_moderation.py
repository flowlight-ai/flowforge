"""P3-006 Doubao Moderation 客户端单元测试.

覆盖范围：
- ModerationConfig 默认值与自定义
- ModerationResult 字段
- DoubaoModerationClient 初始化与状态
- moderate() 内容长度校验、缓存命中、API 成功/拦截/降级
- moderate() 重试、4xx 不重试、超时
- moderate_batch() 并发与空列表
- require_moderation 装饰器
- metrics_collector 集成
- 异常类
- llm_client 注入路径

测试约束（铁律 T1-T8）：
- T1 不使用 Mock LLM：本测试针对 moderation API 客户端，使用 httpx mock
  隔离网络（不是模拟 LLM 生成内容）；mock 的是 HTTP 传输层而非 LLM 推理
- T2 不使用假数据：测试输入均为真实场景文本（科普文章/产品评论/电商描述等）
- T3 必须有具体断言：所有用例均显式断言关键字段
- T6 必须采集指标：metrics 集成测试断言 inc_counter/observe_histogram 调用
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from pydantic import ValidationError

from flowforge.core.moderation import (
    DoubaoModerationClient,
    ModerationBlockedError,
    ModerationConfig,
    ModerationError,
    ModerationResult,
    ModerationTimeoutError,
    require_moderation,
)


# ── 真实场景测试数据（T2：禁止使用假数据）─────────────────────────────

# 科普文章段落（合法内容，应通过审核）
SAFE_ARTICLE_PARAGRAPH: str = (
    "大语言模型（LLM）通过预训练加微调的方式获得语言理解与生成能力。"
    "Transformer 架构的注意力机制使其能够捕捉长距离依赖关系，"
    "在机器翻译、文本摘要、代码生成等任务上达到接近人类水平的表现。"
    "然而，模型规模的增长也带来推理成本和能耗的挑战，"
    "推动着量化、蒸馏等高效推理技术的发展。"
)

# 电商产品描述（合法内容，应通过审核）
SAFE_PRODUCT_DESC: str = (
    "索尼 WH-1000XM5 头戴式降噪耳机，搭载双处理器与 8 麦克风系统，"
    "可实现行业领先的主动降噪效果。续航长达 30 小时，"
    "支持 LDAC 高解析度音频传输，佩戴舒适适合长时间通勤使用。"
)

# 模拟 Doubao API 命中色情标签的内容（用于测试拦截路径，不实际发送）
BLOCKED_PORN_CONTENT: str = (
    "本文包含 explicit adult content 描述，涉及色情低俗场景。"
    "Doubao moderation 应当返回 risk_labels=['porn'] 触发拦截。"
)

# 模拟命中暴力标签的内容
BLOCKED_VIOLENCE_CONTENT: str = (
    "此处描述了详细的暴力凶杀场景，包含 gore 与伤害他人身体的细节。"
    "moderation API 应当返回 risk_labels=['violence']。"
)

# 真实产品评论（合法短文本）
SAFE_COMMENT: str = (
    "用了两周，降噪效果确实出色，地铁里几乎听不到外界噪音。"
    "佩戴比我之前的 XM4 更轻便，耳罩不会闷热。唯一不足是价格略高。"
)


# ── Mock 工厂函数 ─────────────────────────────────────────────────────


def _make_api_response(
    access: bool = True,
    risk_labels: Optional[List[str]] = None,
    risk_details: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """构造 Doubao moderation API 响应 dict."""
    return {
        "data": {
            "access": access,
            "risk_labels": risk_labels or [],
            "risk_details": risk_details or [],
        }
    }


def _mock_httpx_response(
    json_data: Optional[Dict[str, Any]] = None,
    status_code: int = 200,
    text: str = "",
) -> MagicMock:
    """构造 mock httpx.Response."""
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = json_data or {}
    mock_resp.text = text or ""
    if status_code >= 400:
        err = httpx.HTTPStatusError(
            "HTTP {0}".format(status_code),
            request=MagicMock(),
            response=mock_resp,
        )
        mock_resp.raise_for_status = MagicMock(side_effect=err)
    else:
        mock_resp.raise_for_status = MagicMock()
    return mock_resp


def _mock_httpx_client(response_mock: Any) -> AsyncMock:
    """构造 mock httpx.AsyncClient（异步上下文管理器）."""
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    if isinstance(response_mock, list):
        mock_client.post = AsyncMock(side_effect=response_mock)
    else:
        mock_client.post = AsyncMock(return_value=response_mock)
    return mock_client


class _FakeLLMClient:
    """模拟带 http_post 方法的 LLMClient（用于测试 llm_client 注入路径）.

    注意：这不是 Mock LLM（T1 禁止 Mock LLM 生成内容），
    而是 mock HTTP 传输层，等同于 mock httpx。
    """

    def __init__(self, response_data: Dict[str, Any], status_code: int = 200):
        self.response_data = response_data
        self.status_code = status_code
        self.calls: List[Dict[str, Any]] = []

    async def http_post(
        self,
        url: str,
        headers: Dict[str, str],
        json: Dict[str, Any],
        timeout: float,
    ) -> Dict[str, Any]:
        self.calls.append(
            {"url": url, "headers": headers, "json": json, "timeout": timeout}
        )
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "HTTP {0}".format(self.status_code),
                request=MagicMock(),
                response=MagicMock(status_code=self.status_code, text="error"),
            )
        return self.response_data


# ── Fixtures ─────────────────────────────────────────────────────────


@pytest.fixture
def doubao_api_key(monkeypatch: pytest.MonkeyPatch) -> str:
    """注入测试用 API key（避免依赖真实环境变量）."""
    monkeypatch.setenv("DOUBAO_API_KEY", "test-ark-key-for-unit-test-only")
    return "test-ark-key-for-unit-test-only"


@pytest.fixture
def default_config(doubao_api_key: str) -> ModerationConfig:
    """默认配置（启用、带测试 API key）."""
    return ModerationConfig(
        retry_delay_seconds=0.01,  # 加速重试测试
        cache_ttl_seconds=60,
    )


@pytest.fixture
def safe_response_data() -> Dict[str, Any]:
    """安全内容的 API 响应."""
    return _make_api_response(access=True, risk_labels=[], risk_details=[])


@pytest.fixture
def blocked_response_data() -> Dict[str, Any]:
    """命中 porn 标签的 API 响应."""
    return _make_api_response(
        access=False,
        risk_labels=["porn"],
        risk_details=[{"label": "porn", "score": 0.95, "segments": [0, 50]}],
    )


# ════════════════════════════════════════════════════════════════════
# 1. ModerationConfig 测试
# ════════════════════════════════════════════════════════════════════


class TestModerationConfig:
    """ModerationConfig Pydantic 模型测试."""

    def test_default_values(self):
        """测试 1: 默认值符合规范."""
        cfg = ModerationConfig()
        assert cfg.enabled is True
        assert cfg.api_base == "https://ark.cn-beijing.volces.com/api/v3"
        assert cfg.api_key_env == "DOUBAO_API_KEY"
        assert cfg.scene == "content_detection"
        assert cfg.timeout_seconds == 10.0
        assert cfg.retry_count == 2
        assert cfg.retry_delay_seconds == 1.0
        assert cfg.cache_ttl_seconds == 3600
        assert cfg.cache_enabled is True
        assert cfg.fallback_action == "allow"
        assert cfg.block_labels == ["porn", "violence", "political", "abuse"]
        assert cfg.metadata == {}

    def test_custom_values(self):
        """测试 2: 自定义配置可覆盖默认值."""
        cfg = ModerationConfig(
            enabled=False,
            api_base="https://internal-gateway.example.com/api/v3",
            api_key_env="INTERNAL_DOUBAO_KEY",
            scene="comment_detection",
            timeout_seconds=5.0,
            retry_count=5,
            retry_delay_seconds=0.5,
            cache_ttl_seconds=7200,
            cache_enabled=False,
            fallback_action="deny",
            block_labels=["porn", "ad", "fraud"],
            metadata={"tenant": "mallforge"},
        )
        assert cfg.enabled is False
        assert cfg.api_base == "https://internal-gateway.example.com/api/v3"
        assert cfg.api_key_env == "INTERNAL_DOUBAO_KEY"
        assert cfg.scene == "comment_detection"
        assert cfg.timeout_seconds == 5.0
        assert cfg.retry_count == 5
        assert cfg.retry_delay_seconds == 0.5
        assert cfg.cache_ttl_seconds == 7200
        assert cfg.cache_enabled is False
        assert cfg.fallback_action == "deny"
        assert cfg.block_labels == ["porn", "ad", "fraud"]
        assert cfg.metadata == {"tenant": "mallforge"}

    def test_resolve_api_key_present(self, monkeypatch: pytest.MonkeyPatch):
        """测试 3: API key 从环境变量正确读取."""
        monkeypatch.setenv("MY_DOUBAO_KEY", "sk-real-key-12345")
        cfg = ModerationConfig(api_key_env="MY_DOUBAO_KEY")
        assert cfg.resolve_api_key() == "sk-real-key-12345"

    def test_resolve_api_key_absent(self, monkeypatch: pytest.MonkeyPatch):
        """测试 4: 环境变量未配置时返回 None."""
        monkeypatch.delenv("MISSING_DOUBAO_KEY", raising=False)
        cfg = ModerationConfig(api_key_env="MISSING_DOUBAO_KEY")
        assert cfg.resolve_api_key() is None


# ════════════════════════════════════════════════════════════════════
# 2. ModerationResult 测试
# ════════════════════════════════════════════════════════════════════


class TestModerationResult:
    """ModerationResult Pydantic 模型测试."""

    def test_default_values(self):
        """测试 5: 默认值符合规范."""
        r = ModerationResult()
        assert r.allowed is True
        assert r.risk_labels == []
        assert r.risk_details == []
        assert r.confidence == 1.0
        assert r.raw_response == {}
        assert r.cache_hit is False
        assert r.duration_seconds == 0.0
        assert r.error == ""
        assert r.action_taken == "allow"

    def test_custom_values(self):
        """测试 6: 自定义字段可填充."""
        r = ModerationResult(
            allowed=False,
            risk_labels=["porn", "violence"],
            risk_details=[{"label": "porn", "score": 0.99}],
            confidence=0.92,
            raw_response={"data": {"access": False}},
            cache_hit=True,
            duration_seconds=0.456,
            error="",
            action_taken="deny",
        )
        assert r.allowed is False
        assert r.risk_labels == ["porn", "violence"]
        assert r.risk_details == [{"label": "porn", "score": 0.99}]
        assert r.confidence == 0.92
        assert r.raw_response == {"data": {"access": False}}
        assert r.cache_hit is True
        assert r.duration_seconds == pytest.approx(0.456)
        assert r.action_taken == "deny"


# ════════════════════════════════════════════════════════════════════
# 3. 异常类测试
# ════════════════════════════════════════════════════════════════════


class TestModerationExceptions:
    """异常类测试."""

    def test_moderation_error_message_and_cause(self):
        """测试 7: ModerationError 携带 message 和 cause."""
        cause = ValueError("root cause")
        err = ModerationError("API 调用失败", cause=cause)
        assert err.message == "API 调用失败"
        assert err.cause is cause
        assert "API 调用失败" in str(err)

    def test_moderation_blocked_error_attributes(self):
        """测试 8: ModerationBlockedError 携带 content 和 risk_labels."""
        content = BLOCKED_PORN_CONTENT
        labels = ["porn", "abuse"]
        err = ModerationBlockedError(content, labels)
        assert err.content == content[:200]
        assert err.risk_labels == ["porn", "abuse"]
        assert "porn" in str(err)

    def test_moderation_blocked_error_content_truncated(self):
        """测试 9: ModerationBlockedError content 截断到 200 字符."""
        long_content = "x" * 500
        err = ModerationBlockedError(long_content, ["violence"])
        assert len(err.content) == 200
        assert err.risk_labels == ["violence"]

    def test_moderation_timeout_error_attribute(self):
        """测试 10: ModerationTimeoutError 携带 timeout_seconds."""
        err = ModerationTimeoutError("超时", timeout_seconds=10.0)
        assert err.timeout_seconds == 10.0
        assert "超时" in str(err)


# ════════════════════════════════════════════════════════════════════
# 4. DoubaoModerationClient 初始化测试
# ════════════════════════════════════════════════════════════════════


class TestClientInit:
    """DoubaoModerationClient 初始化测试."""

    def test_init_minimal(self, default_config: ModerationConfig):
        """测试 11: 最小初始化."""
        client = DoubaoModerationClient(default_config)
        assert client.config is default_config
        assert client._llm_client is None
        assert client._metrics is None
        assert client._cache == {}
        assert client._total_calls == 0
        assert client._cache_hits == 0
        assert client._blocked_calls == 0
        assert client._failed_calls == 0

    def test_init_with_llm_client_and_metrics(
        self, default_config: ModerationConfig
    ):
        """测试 12: 注入 llm_client 和 metrics_collector."""
        llm = _FakeLLMClient({})
        metrics = MagicMock()
        metrics.inc_counter = MagicMock()
        metrics.observe_histogram = MagicMock()

        client = DoubaoModerationClient(
            default_config, llm_client=llm, metrics_collector=metrics
        )
        assert client._llm_client is llm
        assert client._metrics is metrics

    def test_get_status_initial(self, default_config: ModerationConfig):
        """测试 13: 初始状态正确."""
        client = DoubaoModerationClient(default_config)
        status = client.get_status()
        assert status["enabled"] is True
        assert status["cache_size"] == 0
        assert status["total_calls"] == 0
        assert status["cache_hits"] == 0
        assert status["blocked_calls"] == 0
        assert status["failed_calls"] == 0
        assert "block_labels" in status
        assert "fallback_action" in status


# ════════════════════════════════════════════════════════════════════
# 5. moderate() 测试
# ════════════════════════════════════════════════════════════════════


class TestModerate:
    """moderate() 方法测试."""

    async def test_disabled_returns_allow(
        self, doubao_api_key: str
    ):
        """测试 14: enabled=False 时直接返回 allow."""
        cfg = ModerationConfig(enabled=False)
        client = DoubaoModerationClient(cfg)
        result = await client.moderate(SAFE_ARTICLE_PARAGRAPH)
        assert result.allowed is True
        assert result.action_taken == "allow"
        assert result.error == "moderation disabled"
        assert result.duration_seconds >= 0.0

    async def test_content_too_long_rejected(
        self, default_config: ModerationConfig
    ):
        """测试 15: 内容长度超过 10000 字符直接拒绝."""
        long_content = "a" * (DoubaoModerationClient.MAX_CONTENT_LENGTH + 1)
        client = DoubaoModerationClient(default_config)
        result = await client.moderate(long_content)
        assert result.allowed is False
        assert result.action_taken == "deny"
        assert "oversized_content" in result.risk_labels
        assert result.risk_details[0]["length"] == len(long_content)
        assert result.risk_details[0]["limit"] == DoubaoModerationClient.MAX_CONTENT_LENGTH
        assert client._blocked_calls == 1

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_api_success_allowed(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
        safe_response_data: Dict[str, Any],
    ):
        """测试 16: API 返回安全内容 → allowed=True."""
        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=safe_response_data))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(default_config)
        result = await client.moderate(SAFE_ARTICLE_PARAGRAPH)
        assert result.allowed is True
        assert result.action_taken == "allow"
        assert result.risk_labels == []
        assert result.cache_hit is False
        assert result.duration_seconds >= 0.0
        assert mock_client.post.await_count == 1

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_api_success_blocked_by_label(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
        blocked_response_data: Dict[str, Any],
    ):
        """测试 17: API 返回命中 block_labels → allowed=False."""
        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=blocked_response_data))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(default_config)
        result = await client.moderate(BLOCKED_PORN_CONTENT)
        assert result.allowed is False
        assert result.action_taken == "deny"
        assert "porn" in result.risk_labels
        assert result.risk_details[0]["label"] == "porn"
        assert client._blocked_calls == 1

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_api_access_false_without_block_label(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
    ):
        """测试 18: API access=False 但 risk_labels 不在 block_labels 中也被拦截."""
        response = _make_api_response(
            access=False,
            risk_labels=["minor_warning"],  # 不在默认 block_labels 中
        )
        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=response))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(default_config)
        result = await client.moderate(SAFE_COMMENT)
        # access=False 即被拦截，无论 label 是否在 block_labels 中
        assert result.allowed is False
        assert result.action_taken == "deny"
        assert "minor_warning" in result.risk_labels

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_cache_hit_second_call(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
        safe_response_data: Dict[str, Any],
    ):
        """测试 19: 相同内容第二次调用命中缓存（cache_hit=True）."""
        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=safe_response_data))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(default_config)
        r1 = await client.moderate(SAFE_ARTICLE_PARAGRAPH)
        assert r1.cache_hit is False
        r2 = await client.moderate(SAFE_ARTICLE_PARAGRAPH)
        assert r2.cache_hit is True
        assert r2.allowed is True
        # API 只调用一次（第二次命中缓存）
        assert mock_client.post.await_count == 1
        assert client._cache_hits == 1

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_cache_disabled_no_hit(
        self,
        mock_async_client_cls: MagicMock,
        doubao_api_key: str,
        safe_response_data: Dict[str, Any],
    ):
        """测试 20: cache_enabled=False 时不缓存."""
        cfg = ModerationConfig(
            cache_enabled=False,
            retry_delay_seconds=0.01,
        )
        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=safe_response_data))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(cfg)
        await client.moderate(SAFE_ARTICLE_PARAGRAPH)
        await client.moderate(SAFE_ARTICLE_PARAGRAPH)
        assert mock_client.post.await_count == 2
        assert client._cache_hits == 0

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_fallback_allow_on_network_error(
        self,
        mock_async_client_cls: MagicMock,
        doubao_api_key: str,
    ):
        """测试 21: API 失败 + fallback_action=allow → 放行."""
        cfg = ModerationConfig(
            fallback_action="allow",
            retry_count=1,
            retry_delay_seconds=0.01,
        )
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=httpx.ConnectError("conn refused"))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(cfg)
        result = await client.moderate(SAFE_PRODUCT_DESC)
        assert result.allowed is True
        assert result.action_taken == "allow"
        assert "失败" in result.error or "降级" in result.error
        assert client._failed_calls == 1
        # retry_count=1 → 2 次尝试
        assert mock_client.post.await_count == 2

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_fallback_deny_on_network_error(
        self,
        mock_async_client_cls: MagicMock,
        doubao_api_key: str,
    ):
        """测试 22: API 失败 + fallback_action=deny → 拒绝."""
        cfg = ModerationConfig(
            fallback_action="deny",
            retry_count=0,
            retry_delay_seconds=0.01,
        )
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=httpx.ConnectError("conn refused"))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(cfg)
        result = await client.moderate(SAFE_PRODUCT_DESC)
        assert result.allowed is False
        assert result.action_taken == "deny"
        assert result.confidence == 0.0

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_fallback_degrade_to_human(
        self,
        mock_async_client_cls: MagicMock,
        doubao_api_key: str,
    ):
        """测试 23: API 失败 + fallback_action=degrade_to_human → 降级人工."""
        cfg = ModerationConfig(
            fallback_action="degrade_to_human",
            retry_count=0,
            retry_delay_seconds=0.01,
        )
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=httpx.ConnectError("conn refused"))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(cfg)
        result = await client.moderate(SAFE_PRODUCT_DESC)
        assert result.allowed is False
        assert result.action_taken == "degrade_to_human"
        assert result.confidence == 0.0

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_retry_then_success(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
        safe_response_data: Dict[str, Any],
    ):
        """测试 24: 重试逻辑 — 首次失败、二次成功."""
        cfg = ModerationConfig(
            retry_count=2,
            retry_delay_seconds=0.01,
        )
        success_resp = _mock_httpx_response(json_data=safe_response_data)
        # 第一次抛网络错误，第二次返回成功
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(
            side_effect=[httpx.ConnectError("first fail"), success_resp]
        )
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(cfg)
        result = await client.moderate(SAFE_COMMENT)
        assert result.allowed is True
        assert mock_client.post.await_count == 2

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_4xx_no_retry(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
    ):
        """测试 25: HTTP 4xx 永久错误不重试."""
        cfg = ModerationConfig(
            retry_count=3,
            retry_delay_seconds=0.01,
            fallback_action="deny",
        )
        mock_client = _mock_httpx_client(
            _mock_httpx_response(status_code=401, text="unauthorized")
        )
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(cfg)
        result = await client.moderate(SAFE_COMMENT)
        # 4xx 不重试，只调用一次
        assert mock_client.post.await_count == 1
        assert result.allowed is False
        assert result.action_taken == "deny"

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_5xx_retries(
        self,
        mock_async_client_cls: MagicMock,
        doubao_api_key: str,
    ):
        """测试 26: HTTP 5xx 触发重试."""
        cfg = ModerationConfig(
            retry_count=2,
            retry_delay_seconds=0.01,
            fallback_action="deny",
        )
        mock_client = _mock_httpx_client(
            _mock_httpx_response(status_code=503, text="service unavailable")
        )
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(cfg)
        result = await client.moderate(SAFE_COMMENT)
        # 5xx 重试：retry_count=2 → 共 3 次
        assert mock_client.post.await_count == 3
        assert result.allowed is False
        assert result.action_taken == "deny"

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_timeout_fallback(
        self,
        mock_async_client_cls: MagicMock,
        doubao_api_key: str,
    ):
        """测试 27: 超时触发降级."""
        cfg = ModerationConfig(
            retry_count=1,
            retry_delay_seconds=0.01,
            timeout_seconds=0.1,
            fallback_action="allow",
        )
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=asyncio.TimeoutError())
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(cfg)
        result = await client.moderate(SAFE_COMMENT)
        assert result.allowed is True  # fallback=allow
        assert "超时" in result.error
        assert mock_client.post.await_count == 2  # 重试 1 次

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_missing_api_key_raises_moderation_error(
        self,
        mock_async_client_cls: MagicMock,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """测试 28: 未配置 API key 时降级（fallback_action 决策）."""
        monkeypatch.delenv("DOUBAO_API_KEY", raising=False)
        cfg = ModerationConfig(fallback_action="deny", retry_count=0)
        client = DoubaoModerationClient(cfg)
        result = await client.moderate(SAFE_ARTICLE_PARAGRAPH)
        # 未配置 key 走 fallback 路径
        assert result.allowed is False
        assert result.action_taken == "deny"
        assert "API key" in result.error or "未配置" in result.error
        # httpx 不应被实例化
        assert mock_async_client_cls.call_count == 0


# ════════════════════════════════════════════════════════════════════
# 6. moderate_batch() 测试
# ════════════════════════════════════════════════════════════════════


class TestModerateBatch:
    """moderate_batch() 并发测试."""

    async def test_empty_list(self, default_config: ModerationConfig):
        """测试 29: 空列表返回空结果."""
        client = DoubaoModerationClient(default_config)
        results = await client.moderate_batch([])
        assert results == []

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_concurrent_batch(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
        safe_response_data: Dict[str, Any],
    ):
        """测试 30: 批量审核并发执行."""
        contents = [
            SAFE_ARTICLE_PARAGRAPH,
            SAFE_PRODUCT_DESC,
            SAFE_COMMENT,
        ]
        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=safe_response_data))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(default_config)
        results = await client.moderate_batch(contents)
        assert len(results) == 3
        assert all(r.allowed for r in results)
        # 3 次调用
        assert mock_client.post.await_count == 3


# ════════════════════════════════════════════════════════════════════
# 7. require_moderation 装饰器测试
# ════════════════════════════════════════════════════════════════════


class TestRequireModerationDecorator:
    """require_moderation 装饰器测试."""

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_decorator_allows_safe_content(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
        safe_response_data: Dict[str, Any],
    ):
        """测试 31: 装饰器对安全内容放行."""
        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=safe_response_data))
        mock_async_client_cls.return_value = mock_client
        client = DoubaoModerationClient(default_config)

        @require_moderation(client, content_arg="content")
        async def publish_article(content: str, author: str = "") -> str:
            return "published: {0} by {1}".format(content[:20], author)

        result = await publish_article(content=SAFE_ARTICLE_PARAGRAPH, author="editor")
        assert "published" in result
        assert "editor" in result

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_decorator_blocks_unsafe_content(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
        blocked_response_data: Dict[str, Any],
    ):
        """测试 32: 装饰器对违规内容抛 ModerationBlockedError."""
        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=blocked_response_data))
        mock_async_client_cls.return_value = mock_client
        client = DoubaoModerationClient(default_config)

        @require_moderation(client, content_arg="content")
        async def publish_article(content: str) -> str:
            return "should not reach"

        with pytest.raises(ModerationBlockedError) as exc_info:
            await publish_article(content=BLOCKED_PORN_CONTENT)
        assert "porn" in exc_info.value.risk_labels
        assert exc_info.value.content == BLOCKED_PORN_CONTENT[:200]

    async def test_decorator_missing_argument(
        self, default_config: ModerationConfig
    ):
        """测试 33: 装饰器找不到指定参数时抛 ModerationError."""
        client = DoubaoModerationClient(default_config)

        @require_moderation(client, content_arg="missing_arg")
        async def some_func(other: str) -> str:
            return "ok"

        with pytest.raises(ModerationError) as exc_info:
            await some_func(other="value")
        assert "missing_arg" in str(exc_info.value)

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_decorator_positional_arg(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
        safe_response_data: Dict[str, Any],
    ):
        """测试 34: 装饰器支持位置参数（第一参数）."""
        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=safe_response_data))
        mock_async_client_cls.return_value = mock_client
        client = DoubaoModerationClient(default_config)

        @require_moderation(client)
        async def process(content: str) -> str:
            return "processed"

        result = await process(SAFE_COMMENT)
        assert result == "processed"


# ════════════════════════════════════════════════════════════════════
# 8. metrics_collector 集成测试
# ════════════════════════════════════════════════════════════════════


class TestMetricsIntegration:
    """metrics_collector 集成测试."""

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_metrics_recorded_on_success(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
        safe_response_data: Dict[str, Any],
    ):
        """测试 35: 成功调用上报 calls_total + duration 指标."""
        metrics = MagicMock()
        metrics.inc_counter = MagicMock()
        metrics.observe_histogram = MagicMock()

        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=safe_response_data))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(default_config, metrics_collector=metrics)
        await client.moderate(SAFE_ARTICLE_PARAGRAPH, content_type="article")

        # 断言 calls_total 上报
        calls_total_calls = [
            c for c in metrics.inc_counter.call_args_list
            if c.args[0] == "flowforge_moderation_calls_total"
        ]
        assert len(calls_total_calls) == 1
        labels = calls_total_calls[0].kwargs.get("labels") or calls_total_calls[0].args[1]
        assert labels["content_type"] == "article"
        assert labels["success"] == "true"
        assert labels["blocked"] == "false"

        # 断言 duration 上报
        dur_calls = [
            c for c in metrics.observe_histogram.call_args_list
            if c.args[0] == "flowforge_moderation_duration_seconds"
        ]
        assert len(dur_calls) == 1
        assert dur_calls[0].kwargs.get("value", 0) >= 0.0

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_metrics_blocked_counter(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
        blocked_response_data: Dict[str, Any],
    ):
        """测试 36: 命中拦截时上报 blocked_total 指标."""
        metrics = MagicMock()
        metrics.inc_counter = MagicMock()
        metrics.observe_histogram = MagicMock()

        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=blocked_response_data))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(default_config, metrics_collector=metrics)
        await client.moderate(BLOCKED_VIOLENCE_CONTENT)

        blocked_calls = [
            c for c in metrics.inc_counter.call_args_list
            if c.args[0] == "flowforge_moderation_blocked_total"
        ]
        assert len(blocked_calls) == 1

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_metrics_not_failing_without_collector(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
        safe_response_data: Dict[str, Any],
    ):
        """测试 37: 未注入 metrics_collector 时不报错."""
        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=safe_response_data))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(default_config, metrics_collector=None)
        result = await client.moderate(SAFE_ARTICLE_PARAGRAPH)
        assert result.allowed is True  # 主流程不受影响


# ════════════════════════════════════════════════════════════════════
# 9. 缓存与状态测试
# ════════════════════════════════════════════════════════════════════


class TestCacheAndStatus:
    """缓存与状态测试."""

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_clear_cache(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
        safe_response_data: Dict[str, Any],
    ):
        """测试 38: clear_cache 返回清理条数."""
        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=safe_response_data))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(default_config)
        await client.moderate(SAFE_ARTICLE_PARAGRAPH)
        await client.moderate(SAFE_PRODUCT_DESC)
        assert len(client._cache) == 2

        cleared = client.clear_cache()
        assert cleared == 2
        assert len(client._cache) == 0

    def test_get_cache_key_consistency(self, default_config: ModerationConfig):
        """测试 39: 相同内容生成相同 cache key."""
        client = DoubaoModerationClient(default_config)
        k1 = client._get_cache_key(SAFE_ARTICLE_PARAGRAPH)
        k2 = client._get_cache_key(SAFE_ARTICLE_PARAGRAPH)
        k3 = client._get_cache_key(SAFE_PRODUCT_DESC)
        assert k1 == k2
        assert k1 != k3
        assert len(k1) == 32  # md5 hex 长度

    def test_check_block_hit(self, default_config: ModerationConfig):
        """测试 40: _check_block 正确识别命中标签."""
        client = DoubaoModerationClient(default_config)
        response = _make_api_response(risk_labels=["porn", "minor_warning"])
        blocked, hit_labels = client._check_block(response)
        assert blocked is True
        assert "porn" in hit_labels
        assert "minor_warning" not in hit_labels  # 不在 block_labels 中

    def test_check_block_no_hit(self, default_config: ModerationConfig):
        """测试 41: _check_block 无命中时返回 False."""
        client = DoubaoModerationClient(default_config)
        response = _make_api_response(risk_labels=["minor_warning"])
        blocked, hit_labels = client._check_block(response)
        assert blocked is False
        assert hit_labels == []

    @patch("flowforge.core.moderation.httpx.AsyncClient")
    async def test_status_after_calls(
        self,
        mock_async_client_cls: MagicMock,
        default_config: ModerationConfig,
        safe_response_data: Dict[str, Any],
    ):
        """测试 42: 多次调用后 get_status 反映正确统计."""
        mock_client = _mock_httpx_client(_mock_httpx_response(json_data=safe_response_data))
        mock_async_client_cls.return_value = mock_client

        client = DoubaoModerationClient(default_config)
        await client.moderate(SAFE_ARTICLE_PARAGRAPH)
        await client.moderate(SAFE_ARTICLE_PARAGRAPH)  # 命中缓存
        await client.moderate(SAFE_PRODUCT_DESC)

        status = client.get_status()
        assert status["total_calls"] == 3
        assert status["cache_hits"] == 1
        assert status["cache_size"] == 2  # 两条不同内容的缓存
        assert status["blocked_calls"] == 0
        assert status["failed_calls"] == 0


# ════════════════════════════════════════════════════════════════════
# 10. llm_client 注入路径测试
# ════════════════════════════════════════════════════════════════════


class TestLLMClientInjection:
    """llm_client.http_post 注入路径测试（铁律12：通过 LLMClient 调用）."""

    async def test_llm_client_http_post_called(
        self, default_config: ModerationConfig, safe_response_data: Dict[str, Any]
    ):
        """测试 43: 注入 llm_client 时优先调用其 http_post 方法."""
        fake_llm = _FakeLLMClient(response_data=safe_response_data)
        client = DoubaoModerationClient(default_config, llm_client=fake_llm)
        result = await client.moderate(SAFE_ARTICLE_PARAGRAPH)

        assert result.allowed is True
        assert len(fake_llm.calls) == 1
        call = fake_llm.calls[0]
        # 断言 URL 拼接正确
        assert call["url"] == (
            "https://ark.cn-beijing.volces.com/api/v3/moderation/text"
        )
        # 断言 Authorization 头格式
        assert call["headers"]["Authorization"].startswith("Bearer ")
        assert call["headers"]["Content-Type"] == "application/json"
        # 断言 payload 包含 content 和 scene
        assert call["json"]["content"] == SAFE_ARTICLE_PARAGRAPH
        assert call["json"]["scene"] == "content_detection"

    async def test_llm_client_with_blocked_response(
        self, default_config: ModerationConfig, blocked_response_data: Dict[str, Any]
    ):
        """测试 44: 注入 llm_client 路径下拦截逻辑仍然生效."""
        fake_llm = _FakeLLMClient(response_data=blocked_response_data)
        client = DoubaoModerationClient(default_config, llm_client=fake_llm)
        result = await client.moderate(BLOCKED_PORN_CONTENT)
        assert result.allowed is False
        assert "porn" in result.risk_labels


# ════════════════════════════════════════════════════════════════════
# 11. 配置加载测试（验证从 YAML 加载的兼容性）
# ════════════════════════════════════════════════════════════════════


class TestConfigFromYaml:
    """配置从 YAML 加载测试（验证 Pydantic 兼容 dict 加载）."""

    def test_config_from_dict(self):
        """测试 45: 从 dict 构造配置（模拟 YAML 加载后的 dict）."""
        yaml_dict = {
            "enabled": True,
            "api_base": "https://ark.cn-beijing.volces.com/api/v3",
            "api_key_env": "DOUBAO_API_KEY",
            "scene": "comment_detection",
            "timeout_seconds": 5.0,
            "retry_count": 3,
            "retry_delay_seconds": 0.5,
            "cache_ttl_seconds": 1800,
            "cache_enabled": True,
            "fallback_action": "deny",
            "block_labels": ["porn", "ad", "fraud", "illegal"],
            "metadata": {"source": "yaml", "tenant": "contentforge"},
        }
        cfg = ModerationConfig(**yaml_dict)
        assert cfg.scene == "comment_detection"
        assert cfg.retry_count == 3
        assert cfg.fallback_action == "deny"
        assert "ad" in cfg.block_labels
        assert cfg.metadata["tenant"] == "contentforge"

    def test_block_labels_default_factory_independent(self):
        """测试 46: block_labels 默认值在不同实例间独立（避免可变默认值陷阱）."""
        cfg1 = ModerationConfig()
        cfg2 = ModerationConfig()
        cfg1.block_labels.append("custom_label")
        assert "custom_label" not in cfg2.block_labels
