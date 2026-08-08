"""P3-006 Doubao Moderation 内容审核客户端 — L5 平台审核层.

接入字节跳动豆包（Doubao）Ark 内容审核 API，对 Agent 生成/用户输入的
文本进行实时合规审核。本模块遵循下述铁律：

- 铁律5：禁止硬编码密钥/路径/端口 → API key 从环境变量读取（api_key_env 可配置）
- 铁律12：禁止绕过 DI 容器 → 通过 llm_client 注入 HTTP 调用能力，构造函数注入
- T1：禁止使用 Mock LLM → 本模块为真实 API 客户端，单测用 httpx mock 隔离网络
- async/await：所有 I/O 操作异步执行

Doubao moderation API 契约：
    端点: {api_base}/moderation/text
    鉴权: Bearer {api_key}
    请求: {"content": "待审核文本", "scene": "content_detection"}
    响应: {"data": {"access": true/false, "risk_labels": [...], "risk_details": [...]}}

典型用法（DI 注入）：
    config = ModerationConfig()
    client = DoubaoModerationClient(config, llm_client=my_llm_client,
                                    metrics_collector=metrics)
    result = await client.moderate("待审核文本")
    if not result.allowed:
        raise ModerationBlockedError("待审核文本", result.risk_labels)
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("core.moderation")


# ── 异常类 ──────────────────────────────────────────────────────────────


class ModerationError(Exception):
    """Moderation 调用失败（API 错误、解析失败等）.

    所有非业务拦截类的失败均使用此异常。包括：
    - 网络错误
    - HTTP 非 2xx
    - 响应解析失败
    - 配置错误（如未配置 API key）
    """

    def __init__(self, message: str, *, cause: BaseException | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.cause = cause


class ModerationBlockedError(Exception):
    """内容被拦截（命中 block_labels）.

    业务侧异常：内容确实命中了 block_labels 中的风险标签。
    调用方应捕获此异常并阻止后续流程（如发布、入库）。

    Attributes:
        content: 被拦截的内容（截断到 200 字符以避免日志爆炸）
        risk_labels: 命中的风险标签列表
    """

    def __init__(self, content: str, risk_labels: list[str]) -> None:
        self.content = content[:200]
        self.risk_labels = list(risk_labels)
        super().__init__(
            f"内容被拦截：risk_labels={risk_labels}, 预览={self.content[:80]!r}"
        )


class ModerationTimeoutError(Exception):
    """Moderation 调用超时.

    所有重试均超时后抛出。调用方应按 fallback_action 决策后续动作。
    """

    def __init__(self, message: str, *, timeout_seconds: float) -> None:
        self.timeout_seconds = timeout_seconds
        super().__init__(message)


# ── 配置与结果模型 ──────────────────────────────────────────────────────


class ModerationConfig(BaseModel):
    """Doubao moderation 客户端配置.

    所有可调参数均在此声明，禁止在代码中硬编码（铁律5）。
    建议从 config/moderation.yaml 加载后由 DI 容器注入。
    """

    enabled: bool = True
    # Ark API 基址（可配置覆盖，便于私有化部署或测试）
    api_base: str = "https://ark.cn-beijing.volces.com/api/v3"
    # 环境变量名，运行时读取实际 API key（不硬编码密钥）
    api_key_env: str = "DOUBAO_API_KEY"
    # Doubao moderation 场景，默认内容检测
    scene: str = "content_detection"
    # 单次请求超时
    timeout_seconds: float = 10.0
    # 失败重试次数（不含首次）
    retry_count: int = 2
    # 重试间隔（秒）
    retry_delay_seconds: float = 1.0
    # 结果缓存时长（秒）
    cache_ttl_seconds: int = 3600
    cache_enabled: bool = True
    # API 不可用时（网络/鉴权失败）的兜底动作
    #   allow: 放行（适用于审核非关键路径，例如内部草稿）
    #   deny: 拒绝（适用于面向用户发布前的强校验）
    #   degrade_to_human: 降级人工审核（适用于高风险场景）
    fallback_action: str = "allow"
    # 必须拦截的风险标签（命中任一即 allowed=False）
    block_labels: list[str] = Field(
        default_factory=lambda: ["porn", "violence", "political", "abuse"]
    )
    # 扩展元数据（业务可附加 trace_id、tenant_id 等）
    metadata: dict[str, Any] = Field(default_factory=dict)

    def resolve_api_key(self) -> str | None:
        """从环境变量解析 API key.

        Returns:
            API key 字符串；未配置时返回 None。
        """
        return os.environ.get(self.api_key_env) or None


class ModerationResult(BaseModel):
    """单次审核结果.

    一个 ModerationResult 实例对应一次 moderate() 调用，包含：
    - 业务决策（allowed / action_taken）
    - 风险详情（risk_labels / risk_details）
    - 调用元信息（cache_hit / duration_seconds / error）
    - 原始响应（raw_response，仅调试用）
    """

    # 是否允许通过（业务决策）
    allowed: bool = True
    # 命中的风险标签（来自 API 响应或本地匹配）
    risk_labels: list[str] = Field(default_factory=list)
    # 风险详情（API 原始结构，每个元素为 dict）
    risk_details: list[dict[str, Any]] = Field(default_factory=list)
    # 置信度 0.0-1.0（API 未返回时默认 1.0）
    confidence: float = 1.0
    # 原始响应（调试用，生产环境日志中可脱敏）
    raw_response: dict[str, Any] = Field(default_factory=dict)
    # 是否命中缓存
    cache_hit: bool = False
    # 本次调用耗时（秒），含重试
    duration_seconds: float = 0.0
    # 错误信息（如有），不抛异常时填充
    error: str = ""
    # 实际采取的动作：allow / deny / degrade_to_human
    action_taken: str = "allow"


# ── 客户端 ──────────────────────────────────────────────────────────────


class DoubaoModerationClient:
    """Doubao Ark moderation API 客户端.

    通过 llm_client 注入或 httpx.AsyncClient 调用真实 API。
    所有 I/O 操作异步执行；支持缓存、重试、metrics 上报。

    Args:
        config: ModerationConfig 配置实例
        llm_client: 可选的 LLMClient 实例，若提供 http_post 方法则优先使用
            （铁律12：Agent 禁止直接导入 LLM SDK，通过 LLMClient 调用）
        metrics_collector: 可选的 MetricsCollector 实例
        logger: 可选的日志器，默认使用本模块 logger
    """

    MODERATION_PATH: str = "/moderation/text"
    # 内容长度上限（Doubao API 限制）
    MAX_CONTENT_LENGTH: int = 10000

    def __init__(
        self,
        config: ModerationConfig,
        llm_client: Any = None,
        metrics_collector: Any = None,
        logger: Any = None,
    ) -> None:
        self.config: ModerationConfig = config
        self._llm_client: Any = llm_client
        self._metrics: Any = metrics_collector
        self._logger: Any = logger or globals()["logger"]

        # 缓存：{cache_key: (ModerationResult, expire_timestamp)}
        self._cache: dict[str, tuple[ModerationResult, float]] = {}

        # 调用统计
        self._total_calls: int = 0
        self._cache_hits: int = 0
        self._blocked_calls: int = 0
        self._failed_calls: int = 0

    # ── 公开接口 ──────────────────────────────────────────────────────

    async def moderate(
        self,
        content: str,
        content_type: str = "text",
    ) -> ModerationResult:
        """对单条内容执行审核.

        Args:
            content: 待审核文本
            content_type: 内容类型标记（text/comment/article 等），仅用于 metrics

        Returns:
            ModerationResult 审核结果

        Raises:
            ModerationError: 配置错误（如未启用、未配置 API key 且 fallback_action
                不为 allow/deny/degrade_to_human 之外的合法值）
        """
        start_ts: float = time.time()
        self._total_calls += 1

        # 1. 启用检查
        if not self.config.enabled:
            return self._build_disabled_result(start_ts)

        # 2. 内容长度校验（>MAX 直接拒绝，避免 API 限制）
        if len(content) > self.MAX_CONTENT_LENGTH:
            self._blocked_calls += 1
            self._record_metrics(
                content_type=content_type,
                success=False,
                blocked=True,
                duration=time.time() - start_ts,
            )
            result = ModerationResult(
                allowed=False,
                risk_labels=["oversized_content"],
                risk_details=[
                    {
                        "reason": "content_length_exceeded",
                        "length": len(content),
                        "limit": self.MAX_CONTENT_LENGTH,
                    }
                ],
                confidence=1.0,
                duration_seconds=time.time() - start_ts,
                error=f"内容长度超过上限 {self.MAX_CONTENT_LENGTH} 字符",
                action_taken="deny",
            )
            self._logger.warning(
                f"moderation 拒绝：内容长度 {len(content)} 超过上限 {self.MAX_CONTENT_LENGTH}"
            )
            return result

        # 3. 缓存查询
        cache_key: str = self._get_cache_key(content)
        cached: ModerationResult | None = self._lookup_cache(cache_key)
        if cached is not None:
            self._cache_hits += 1
            cached.cache_hit = True
            cached.duration_seconds = time.time() - start_ts
            self._logger.debug(f"moderation 缓存命中: key={cache_key[:12]}")
            return cached

        # 4. 调用 API
        try:
            raw_response: dict[str, Any] = await self._call_api(content)
        except ModerationTimeoutError as e:
            self._failed_calls += 1
            self._record_metrics(
                content_type=content_type,
                success=False,
                blocked=False,
                duration=time.time() - start_ts,
            )
            return self._build_fallback_result(
                error=f"moderation 超时: {e}",
                start_ts=start_ts,
            )
        except ModerationError as e:
            self._failed_calls += 1
            self._record_metrics(
                content_type=content_type,
                success=False,
                blocked=False,
                duration=time.time() - start_ts,
            )
            return self._build_fallback_result(
                error=f"moderation 失败: {e}",
                start_ts=start_ts,
            )

        # 5. 解析响应
        blocked, hit_labels = self._check_block(raw_response)
        data: dict[str, Any] = raw_response.get("data", raw_response or {})
        risk_labels: list[str] = list(data.get("risk_labels", []) or [])
        risk_details: list[dict[str, Any]] = list(data.get("risk_details", []) or [])
        access_flag: bool = bool(data.get("access", True))

        allowed: bool = (not blocked) and access_flag
        action_taken: str = "deny" if not allowed else "allow"

        result = ModerationResult(
            allowed=allowed,
            risk_labels=risk_labels if risk_labels else hit_labels,
            risk_details=risk_details,
            confidence=1.0,
            raw_response=raw_response,
            cache_hit=False,
            duration_seconds=time.time() - start_ts,
            error="",
            action_taken=action_taken,
        )

        if not allowed:
            self._blocked_calls += 1
            self._logger.info(
                f"moderation 拦截: labels={result.risk_labels}, 预览={content[:80]!r}"
            )

        # 6. 写入缓存
        self._write_cache(cache_key, result)

        # 7. metrics 上报
        self._record_metrics(
            content_type=content_type,
            success=True,
            blocked=not allowed,
            duration=time.time() - start_ts,
        )

        return result

    async def moderate_batch(
        self,
        contents: list[str],
        content_type: str = "text",
    ) -> list[ModerationResult]:
        """批量审核（并发调用 moderate）.

        使用 asyncio.gather 并发执行；单条失败不影响其他条目。

        Args:
            contents: 待审核文本列表
            content_type: 内容类型标记

        Returns:
            与 contents 等长的结果列表（顺序保持一致）
        """
        if not contents:
            return []
        tasks: list[Awaitable[ModerationResult]] = [
            self.moderate(c, content_type=content_type) for c in contents
        ]
        return await asyncio.gather(*tasks)

    def clear_cache(self) -> int:
        """清理全部缓存.

        Returns:
            清理的缓存条数
        """
        count: int = len(self._cache)
        self._cache.clear()
        if count > 0:
            self._logger.info(f"moderation 缓存已清理: {count} 条")
        return count

    def get_status(self) -> dict[str, Any]:
        """获取客户端状态.

        Returns:
            状态字典：enabled / cache_size / total_calls / cache_hits /
            blocked_calls / failed_calls / api_base / scene
        """
        return {
            "enabled": self.config.enabled,
            "api_base": self.config.api_base,
            "scene": self.config.scene,
            "cache_enabled": self.config.cache_enabled,
            "cache_ttl_seconds": self.config.cache_ttl_seconds,
            "cache_size": len(self._cache),
            "total_calls": self._total_calls,
            "cache_hits": self._cache_hits,
            "blocked_calls": self._blocked_calls,
            "failed_calls": self._failed_calls,
            "block_labels": list(self.config.block_labels),
            "fallback_action": self.config.fallback_action,
        }

    # ── 内部实现 ──────────────────────────────────────────────────────

    async def _call_api(self, content: str) -> dict[str, Any]:
        """调用 Doubao moderation API（带重试 + 超时）.

        Args:
            content: 待审核文本

        Returns:
            API 响应 JSON（dict）

        Raises:
            ModerationError: 配置错误或非超时类失败
            ModerationTimeoutError: 所有重试均超时
        """
        api_key: str | None = self.config.resolve_api_key()
        if not api_key:
            raise ModerationError(
                f"未配置 API key：环境变量 {self.config.api_key_env} 未设置"
            )

        url: str = self.config.api_base.rstrip("/") + self.MODERATION_PATH
        headers: dict[str, str] = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload: dict[str, Any] = {
            "content": content,
            "scene": self.config.scene,
        }

        last_error: BaseException | None = None
        timeouts: int = 0
        attempts: int = self.config.retry_count + 1

        for attempt in range(1, attempts + 1):
            try:
                response_dict: dict[str, Any] = await self._do_http_post(
                    url=url,
                    headers=headers,
                    payload=payload,
                )
                return response_dict
            except TimeoutError as e:
                timeouts += 1
                last_error = e
                self._logger.warning(
                    f"moderation 调用超时 attempt={attempt}/{attempts}"
                )
            except httpx.HTTPStatusError as e:
                last_error = e
                # 4xx 永久错误不重试
                if 400 <= e.response.status_code < 500:
                    raise ModerationError(
                        f"moderation HTTP {e.response.status_code}: {e.response.text[:200]}",
                        cause=e,
                    )
                self._logger.warning(
                    f"moderation HTTP {e.response.status_code} attempt={attempt}/{attempts}"
                )
            except (httpx.RequestError, httpx.HTTPError) as e:
                last_error = e
                self._logger.warning(
                    f"moderation 网络错误 attempt={attempt}/{attempts}: {e}"
                )

            # 末次重试后不再 sleep
            if attempt < attempts:
                await asyncio.sleep(self.config.retry_delay_seconds)

        if timeouts > 0:
            raise ModerationTimeoutError(
                f"moderation 重试 {timeouts} 次均超时",
                timeout_seconds=self.config.timeout_seconds,
            )
        raise ModerationError(
            f"moderation 重试 {self.config.retry_count + 1} 次均失败: {last_error}",
            cause=last_error,
        )

    async def _do_http_post(
        self,
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """执行 HTTP POST 请求.

        优先使用注入的 llm_client.http_post；否则使用 httpx.AsyncClient。
        单一职责：仅负责一次 HTTP 调用，不处理重试。

        Args:
            url: 完整 URL
            headers: 请求头
            payload: 请求体 dict

        Returns:
            响应 JSON dict

        Raises:
            asyncio.TimeoutError: 请求超时
            httpx.HTTPStatusError: HTTP 4xx/5xx
            httpx.RequestError: 网络错误
        """
        # 优先注入的 llm_client（铁律12：通过 LLMClient 调用）
        if self._llm_client is not None and hasattr(
            self._llm_client, "http_post"
        ):
            return await self._llm_client.http_post(
                url=url,
                headers=headers,
                json=payload,
                timeout=self.config.timeout_seconds,
            )

        # 回退到 httpx.AsyncClient（标准库依赖，pyproject 已声明）
        async with httpx.AsyncClient(
            timeout=self.config.timeout_seconds
        ) as client:
            response: httpx.Response = await client.post(
                url, headers=headers, json=payload
            )
            response.raise_for_status()
            return response.json()

    def _get_cache_key(self, content: str) -> str:
        """生成缓存 key（md5 哈希）.

        Args:
            content: 原始内容

        Returns:
            32 位十六进制 md5 字符串
        """
        scene_bytes: bytes = self.config.scene.encode("utf-8")
        content_bytes: bytes = content.encode("utf-8")
        return hashlib.md5(scene_bytes + b"|" + content_bytes).hexdigest()

    def _lookup_cache(self, cache_key: str) -> ModerationResult | None:
        """查询缓存，过期自动剔除.

        Returns:
            命中的 ModerationResult（拷贝）；未命中返回 None
        """
        if not self.config.cache_enabled:
            return None
        entry: tuple[ModerationResult, float] | None = self._cache.get(cache_key)
        if entry is None:
            return None
        result, expire_ts = entry
        if time.time() > expire_ts:
            # 过期清理
            self._cache.pop(cache_key, None)
            return None
        # 返回拷贝避免外部修改污染缓存
        return result.model_copy(deep=True)

    def _write_cache(self, cache_key: str, result: ModerationResult) -> None:
        """写入缓存（仅 cache_enabled 时）."""
        if not self.config.cache_enabled:
            return
        expire_ts: float = time.time() + self.config.cache_ttl_seconds
        self._cache[cache_key] = (result.model_copy(deep=True), expire_ts)

    def _check_block(self, result: dict[str, Any]) -> tuple[bool, list[str]]:
        """检查响应是否命中 block_labels.

        Args:
            result: API 响应 dict

        Returns:
            (is_blocked, hit_labels) 元组
        """
        data: dict[str, Any] = result.get("data", result or {})
        risk_labels: list[str] = list(data.get("risk_labels", []) or [])
        block_set: set = set(self.config.block_labels)
        hit: list[str] = [label for label in risk_labels if label in block_set]
        return (len(hit) > 0, hit)

    def _build_disabled_result(self, start_ts: float) -> ModerationResult:
        """构建禁用时的快速返回结果."""
        return ModerationResult(
            allowed=True,
            duration_seconds=time.time() - start_ts,
            action_taken="allow",
            error="moderation disabled",
        )

    def _build_fallback_result(
        self,
        error: str,
        start_ts: float,
    ) -> ModerationResult:
        """按 fallback_action 构建降级结果."""
        action: str = self.config.fallback_action
        if action not in ("allow", "deny", "degrade_to_human"):
            action = "allow"
            self._logger.warning(
                f"未知 fallback_action={self.config.fallback_action}，回退为 allow"
            )

        # action_taken 与 allowed 的对应关系
        #   allow           → allowed=True,  action_taken=allow
        #   deny            → allowed=False, action_taken=deny
        #   degrade_to_human → allowed=False, action_taken=degrade_to_human
        allowed: bool = action == "allow"

        self._logger.warning(
            f"moderation 降级: fallback_action={action}, error={error}"
        )
        return ModerationResult(
            allowed=allowed,
            risk_labels=[],
            risk_details=[],
            confidence=0.0,
            raw_response={},
            cache_hit=False,
            duration_seconds=time.time() - start_ts,
            error=error,
            action_taken=action,
        )

    def _record_metrics(
        self,
        content_type: str,
        success: bool,
        blocked: bool,
        duration: float,
    ) -> None:
        """上报 metrics.

        优先使用 metrics_collector 的高层 API；若不存在则回退到 inc_counter /
        observe_histogram 基础 API；若均不可用则跳过。
        """
        if self._metrics is None:
            return
        try:
            # 通用基础 API（所有 MetricsCollector 均具备）
            if hasattr(self._metrics, "inc_counter"):
                self._metrics.inc_counter(
                    "flowforge_moderation_calls_total",
                    labels={
                        "content_type": content_type,
                        "success": str(success).lower(),
                        "blocked": str(blocked).lower(),
                    },
                )
                if blocked:
                    self._metrics.inc_counter(
                        "flowforge_moderation_blocked_total",
                        labels={"content_type": content_type},
                    )
            if hasattr(self._metrics, "observe_histogram"):
                self._metrics.observe_histogram(
                    "flowforge_moderation_duration_seconds",
                    value=duration,
                    labels={"content_type": content_type},
                )
        except Exception as e:  # metrics 失败不影响主流程
            self._logger.warning(f"metrics 上报失败: {e}")


# ── 装饰器 ──────────────────────────────────────────────────────────────


def require_moderation(
    client: DoubaoModerationClient,
    content_arg: str = "content",
) -> Callable[..., Any]:
    """函数装饰器：自动审核指定参数.

    被装饰的异步函数在执行前会先对 content_arg 指定的参数进行审核。
    审核失败（allowed=False）则抛出 ModerationBlockedError，原函数不执行。

    Args:
        client: DoubaoModerationClient 实例
        content_arg: 待审核参数名（默认 "content"）

    Returns:
        装饰器函数

    Raises:
        ModerationBlockedError: 内容被拦截
        ModerationError: 配置错误等
    """

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            # 支持 content 在 kwargs 或位置参数中（简单处理：仅支持 kwargs
            # 与第一位置参数；复杂场景调用方应直接调 client.moderate）
            content: str | None = kwargs.get(content_arg)
            if content is None and args:
                # 假设第一参数为 content（最常见的函数签名形式）
                content = args[0]
            if content is None:
                raise ModerationError(
                    f"require_moderation 未找到参数: {content_arg}"
                )
            result: ModerationResult = await client.moderate(content)
            if not result.allowed:
                raise ModerationBlockedError(content, result.risk_labels)
            return await func(*args, **kwargs)

        # 保留原函数元信息
        wrapper.__name__ = getattr(func, "__name__", "wrapper")
        wrapper.__doc__ = getattr(func, "__doc__", None)
        wrapper.__wrapped__ = func  # type: ignore[attr-defined]
        return wrapper

    return decorator
