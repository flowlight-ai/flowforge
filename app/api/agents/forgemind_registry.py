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
from flowforge.forgemind.forging.pipeline import ForgePipeline
from flowforge.forgemind.base import ForgekinBase

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

    def _resolve_id(self, forgekin_id: str) -> str:
        """规范化 forgekin_id — 兼容短 ID 和带前缀 ID.

        YAML 中 forgekin_id 为 ``forgemind:luban``，但 API 调用方
        可能传入短 ID ``luban``。本方法将短 ID 补全为 ``forgemind:{fid}``，
        若已带前缀则原样返回。
        """
        if not forgekin_id:
            return forgekin_id
        if ":" in forgekin_id:
            return forgekin_id
        return f"forgemind:{forgekin_id}"

    def get(self, forgekin_id: str) -> ForgekinBase | None:
        """获取已锻造的Forgekin实例（兼容短 ID 和带前缀 ID）。"""
        full_id = self._resolve_id(forgekin_id)
        # 优先精确匹配，回退到短 ID
        return self._instances.get(full_id) or self._instances.get(forgekin_id)

    def register(self, forgekin: ForgekinBase) -> None:
        """注册Forgekin实例（同时注册带前缀 ID 和短 ID 两个键）。"""
        self._instances[forgekin.forgekin_id] = forgekin
        # 同时注册短 ID（去掉 ``forgemind:`` 前缀），便于 API 层按短 ID 查找
        if ":" in forgekin.forgekin_id:
            short_id = forgekin.forgekin_id.split(":", 1)[1]
            self._instances[short_id] = forgekin
        logger.info(f"Forgekin已注册: {forgekin.forgekin_id}")

    def list_instances(self) -> list[dict[str, Any]]:
        """列出所有已锻造Forgekin的描述（去重，每个实例只返回一次）。"""
        seen: set[int] = set()
        result: list[dict[str, Any]] = []
        for fk in self._instances.values():
            if id(fk) in seen:
                continue
            seen.add(id(fk))
            result.append(fk.describe())
        return result

    async def get_pipeline(self) -> ForgePipeline:
        """获取 ForgePipeline 实例（延迟初始化）。"""
        if self._pipeline is None:
            self._pipeline = ForgePipeline()
        return self._pipeline

    async def get_trae_client(self) -> Any:
        """获取 TraeLLMClient 实例（延迟初始化）.

        Trae CN 桥接方案：operator 通过 Trae CN IDE 充当 LLM 与监工。
        TraeLLMClient 通过文件桥接（data/trae_bridge/）与 Trae AI 通信。
        """
        if self._trae_client is None:
            try:
                from flowforge.llm.trae.client import TraeLLMClient
                self._trae_client = TraeLLMClient()
                logger.info("TraeLLMClient 已初始化（Trae CN 桥接模式）")
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    f"TraeLLMClient 初始化失败，Forgekin将使用降级模式: {exc}"
                )
                self._trae_client = None
        return self._trae_client


# 全局单例
_registry = _ForgekinRegistry()
