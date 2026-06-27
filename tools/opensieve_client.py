"""FlowForge 通用 OpenSieve 客户端工具。

聚合 OpenSieve 服务的两类能力：
1. 非结构化语义检索（公告/研报/新闻/网页）— 通过 /api/v1/retrieve 端点
2. 结构化数据源协议（DataSource Protocol）— 通过 /api/v1/datasource/* 端点
   - register_data_source: 注册数据源适配器（如 baostock/akshare/tushare）
   - fetch_data: 拉取结构化数据（kline/financial/fund_nav 等），三源容错
   - list_data_sources: 列出已注册数据源及健康状态

设计原则：
- 配置驱动：endpoint/api_key 通过环境变量注入（铁律5）
- 单一工具多操作：通过 action 参数路由，避免工具数量膨胀
- 向后兼容：默认 action="search" 保持与现有调用方兼容
- 异步 I/O：所有 HTTP 调用使用 httpx.AsyncClient
"""
import os
from typing import Any, Dict, List, Optional

import httpx

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("opensieve_client")


class OpenSieveClient(BaseTool):
    """OpenSieve 聚合检索中台客户端（FlowForge 通用工具）。

    通过单一工具支持非结构化检索和结构化数据源协议两类操作，
    由 ``action`` 参数路由：

    - ``action="search"``（默认）: 非结构化语义检索
      必填参数: ``query``；可选: ``max_results`` / ``min_score`` / ``max_age_days``
    - ``action="fetch_data"``: 结构化数据拉取（三源容错）
      必填参数: ``data_type`` / ``data_params``
    - ``action="register_source"``: 注册数据源适配器
      必填参数: ``source_name``；可选: ``priority``
    - ``action="list_sources"``: 列出已注册数据源
    - ``action="health"``: 检查 OpenSieve 服务可用性
    """

    name = "opensieve_search"
    description = (
        "OpenSieve 聚合检索中台：非结构化语义检索 + 结构化数据源协议。"
        "通过 action 参数选择操作：search(默认)/fetch_data/register_source/list_sources/health。"
    )
    parameters_schema = {
        "type": "object",
        "required": ["action"],
        "properties": {
            "action": {
                "type": "string",
                "enum": ["search", "fetch_data", "register_source", "list_sources", "health"],
                "default": "search",
                "description": "操作类型",
            },
            # search 参数
            "query": {"type": "string", "description": "搜索查询（action=search 时必填）"},
            "max_results": {"type": "integer", "default": 5, "description": "最大返回结果数"},
            "min_score": {"type": "number", "default": 0.3, "description": "最低相关度分数"},
            "max_age_days": {"type": "integer", "default": 30, "description": "最大天数"},
            # fetch_data 参数
            "data_type": {
                "type": "string",
                "description": "结构化数据类型：kline/financial/fund_nav 等（action=fetch_data 时必填）",
            },
            "data_params": {
                "type": "object",
                "description": "结构化数据查询参数（action=fetch_data 时必填）",
            },
            # register_source 参数
            "source_name": {
                "type": "string",
                "description": "数据源名称：baostock/akshare/tushare（action=register_source 时必填）",
            },
            "priority": {
                "type": "integer",
                "default": 10,
                "description": "数据源优先级（数字越小越优先）",
            },
        },
    }
    safety_level = "read"
    is_concurrency_safe = True

    def __init__(self, endpoint: Optional[str] = None, timeout: int = 120) -> None:
        # 基础 URL（去掉 /api/v1/retrieve 后缀，统一用 base）
        raw = endpoint or os.getenv(
            "OPENSIEVE_ENDPOINT", "http://localhost:8100"
        )
        # 兼容旧配置：如果传入的是 /api/v1/retrieve 全路径，提取 base
        if raw.endswith("/api/v1/retrieve"):
            raw = raw[: -len("/api/v1/retrieve")]
        raw = raw.rstrip("/")
        self.base_url = raw
        self.api_key = os.getenv("OPENSIEVE_API_KEY", "")
        self.timeout = timeout

    # ── 工具入口 ────────────────────────────────────────────────────

    async def execute(self, input: ToolInput) -> ToolOutput:
        action = input.params.get("action", "search")
        try:
            if action == "search":
                return await self._do_search(input.params)
            if action == "fetch_data":
                return await self._do_fetch_data(input.params)
            if action == "register_source":
                return await self._do_register_source(input.params)
            if action == "list_sources":
                return await self._do_list_sources()
            if action == "health":
                ok = await self._do_health_check()
                return ToolOutput(result={"healthy": ok, "endpoint": self.base_url})
            return ToolOutput(error=f"Unknown action: {action}")
        except httpx.ConnectError as e:
            logger.warning(f"OpenSieve service unavailable at {self.base_url}: {e}")
            return ToolOutput(error=f"service unavailable: {e}", result={"results": []})
        except Exception as e:
            logger.error(f"OpenSieve {action} error: {e}")
            return ToolOutput(error=str(e), result={"results": []})

    # ── 直接调用方法（供非 ToolRegistry 调用方使用）──────────────────

    async def search(
        self,
        query: str,
        *,
        max_results: int = 5,
        min_score: float = 0.3,
        max_age_days: int = 30,
    ) -> List[Dict[str, Any]]:
        """非结构化语义检索（便捷方法）。

        Args:
            query: 搜索查询
            max_results: 最大返回结果数
            min_score: 最低相关度分数
            max_age_days: 最大天数

        Returns:
            检索结果列表；服务不可用时返回空列表
        """
        out = await self._do_search({
            "query": query,
            "max_results": max_results,
            "min_score": min_score,
            "max_age_days": max_age_days,
        })
        return out.result.get("results", []) if out.result else []

    async def fetch_data(
        self,
        data_type: str,
        params: Dict[str, Any],
    ) -> Dict[str, Any]:
        """结构化数据拉取（便捷方法，三源容错）。

        Args:
            data_type: 数据类型（kline/financial/fund_nav 等）
            params: 查询参数（如 {"code": "600519", "start_date": "...", "end_date": "..."}）

        Returns:
            含 data/columns/row_count/source 字段的字典

        Raises:
            RuntimeError: 所有数据源均不可用
        """
        out = await self._do_fetch_data({
            "data_type": data_type,
            "data_params": params,
        })
        if out.error:
            raise RuntimeError(out.error)
        return out.result or {}

    async def register_data_source(
        self,
        source_name: str,
        priority: int = 10,
    ) -> Dict[str, Any]:
        """注册数据源适配器到 OpenSieve（便捷方法）。

        Args:
            source_name: 数据源名称（baostock/akshare/tushare）
            priority: 优先级（数字越小越优先）

        Returns:
            注册结果字典
        """
        out = await self._do_register_source({
            "source_name": source_name,
            "priority": priority,
        })
        if out.error:
            raise RuntimeError(out.error)
        return out.result or {}

    async def list_data_sources(self) -> Dict[str, Any]:
        """列出已注册数据源（便捷方法）。"""
        out = await self._do_list_sources()
        return out.result or {}

    async def health_check(self) -> bool:
        """检查 OpenSieve 服务可用性（便捷方法）。"""
        return await self._do_health_check()

    # ── 内部实现 ────────────────────────────────────────────────────

    def _headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def _do_search(self, params: Dict[str, Any]) -> ToolOutput:
        query = params.get("query")
        if not query:
            return ToolOutput(error="query is required for action=search")
        payload = {
            "query": query,
            "max_results": params.get("max_results", 5),
            "min_score": params.get("min_score", 0.3),
            "max_age_days": params.get("max_age_days", 30),
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/retrieve",
                json=payload,
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", data.get("items", []))
            return ToolOutput(result={"results": results, "source": "opensieve"})

    async def _do_fetch_data(self, params: Dict[str, Any]) -> ToolOutput:
        data_type = params.get("data_type")
        data_params = params.get("data_params") or {}
        if not data_type:
            return ToolOutput(error="data_type is required for action=fetch_data")
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/datasource/fetch",
                json={"data_type": data_type, "params": data_params},
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
            if not data.get("success", False):
                return ToolOutput(error=data.get("error", "fetch failed"))
            return ToolOutput(result={
                "data": data.get("data", []),
                "columns": data.get("columns", []),
                "row_count": data.get("row_count", 0),
                "source": data.get("source", ""),
            })

    async def _do_register_source(self, params: Dict[str, Any]) -> ToolOutput:
        source_name = params.get("source_name")
        if not source_name:
            return ToolOutput(error="source_name is required for action=register_source")
        priority = params.get("priority", 10)
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/datasource/register",
                json={"source_name": source_name, "priority": priority},
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
            return ToolOutput(result=data)

    async def _do_list_sources(self) -> ToolOutput:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                f"{self.base_url}/api/v1/datasource/list",
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
            return ToolOutput(result=data)

    async def _do_health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self.base_url}/health")
                return resp.status_code == 200
        except Exception:
            return False
