"""Forgekin 注册表 — 从 forgemind.py 提取的 _ForgekinRegistry 实现.

本模块提供 Forgekin 实例的进程内单例注册表，跨 HTTP 请求保持会话状态。
从 flowforge/app/api/agents/forgemind.py 提取，保持逻辑不变。

详见:
    - forgemind.py — ForgeMind API endpoints
    - forgemind/base.py — ForgekinBase
"""

from __future__ import annotations

from typing import Any

from flowforge.core.tracing import get_logger
from flowforge.forgemind.base import ForgekinBase
from flowforge.forgemind.forging.pipeline import ForgePipeline

logger = get_logger("api.forgemind")


class _ForgekinRegistry:
    """Forgekin实例注册表（进程内单例）.

    管理已锻造的Forgekin实例，跨 HTTP 请求保持会话状态。
    每个 forgekin_id 对应一个 ForgekinBase 实例。
    """

    def __init__(self) -> None:
        self._instances: dict[str, ForgekinBase] = {}
        self._pipeline: ForgePipeline | None = None
        self._trae_client: Any | None = None

    def get(self, forgekin_id: str) -> ForgekinBase | None:
        """获取已锻造的Forgekin实例。"""
        return self._instances.get(forgekin_id)

    def register(self, forgekin: ForgekinBase) -> None:
        """注册Forgekin实例。"""
        self._instances[forgekin.forgekin_id] = forgekin
        logger.info(f"Forgekin已注册: {forgekin.forgekin_id}")

    def list_instances(self) -> list[dict[str, Any]]:
        """列出所有已锻造Forgekin的描述。"""
        return [fk.describe() for fk in self._instances.values()]

    async def get_pipeline(self) -> ForgePipeline:
        """获取 ForgePipeline 实例（延迟初始化）。"""
        if self._pipeline is None:
            self._pipeline = ForgePipeline()
        return self._pipeline

    async def get_trae_client(self) -> Any:
        """获取 TraeLLMClient 实例（延迟初始化）.

        Trae CN 桥接方案：operator 通过 Trae CN IDE 充当 LLM 与监工。
        TraeLLMClient 通过文件桥接（data/trae_bridge/）与 Trae AI 通信。

        环境变量 ``FLOWFORGE_FORGEMIND_LLM=openroute`` 可切换为 OpenRoute
        网关降级模式（当 Trae CN IDE 未运行、桥接目录无响应时使用）。
        """
        if self._trae_client is None:
            import os
            llm_backend = os.getenv("FLOWFORGE_FORGEMIND_LLM", "trae").strip().lower()
            if llm_backend == "openroute":
                try:
                    from flowforge.forgemind.openroute_adapter import OpenRouteLLMClient
                    self._trae_client = OpenRouteLLMClient()
                    logger.info("Forgekin LLM 后端: OpenRoute 网关（环境变量降级）")
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        f"OpenRouteLLMClient 初始化失败: {exc}，回退到 TraeLLMClient"
                    )
                    self._trae_client = self._init_trae_client()
            else:
                self._trae_client = self._init_trae_client()
        return self._trae_client

    def _init_trae_client(self) -> Any:
        """初始化 TraeLLMClient（Trae CN 桥接模式）."""
        try:
            from flowforge.llm.trae.client import TraeLLMClient
            client = TraeLLMClient()
            logger.info("TraeLLMClient 已初始化（Trae CN 桥接模式）")
            return client
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                f"TraeLLMClient 初始化失败，Forgekin将使用降级模式: {exc}"
            )
            return None


# 全局单例
_registry = _ForgekinRegistry()
