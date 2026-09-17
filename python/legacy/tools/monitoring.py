"""FlowForge 监控工具 — 通过 Prometheus/Grafana HTTP API 查询监控指标和告警。"""

from __future__ import annotations

from typing import Any

import httpx

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput


class MonitoringTool(BaseTool):
    name: str = "monitoring"
    description: str = "Query monitoring metrics and alerts via Prometheus/Grafana HTTP API"
    parameters_schema: dict[str, Any] = {
        "type": "object",
        "required": ["action", "target_url"],
        "properties": {
            "action": {
                "type": "string",
                "enum": ["query", "alert", "health"],
            },
            "target_url": {"type": "string"},
            "metrics": {"type": "array", "items": {"type": "string"}},
            "duration": {"type": "string"},
            "token_env": {"type": "string"},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        action: str = input.params.get("action", "")
        target_url: str = input.params.get("target_url", "")

        if not target_url:
            return ToolOutput(result={"success": False}, error="target_url is required")

        if action == "query":
            return await self._query(input.params, target_url)
        elif action == "alert":
            return await self._alert(input.params, target_url)
        elif action == "health":
            return await self._health(input.params, target_url)
        else:
            return ToolOutput(
                result={"success": False},
                error=f"Unknown action: {action}. Supported: query, alert, health",
            )

    def _get_headers(self, params: dict[str, Any]) -> dict[str, str]:
        import os

        headers: dict[str, str] = {}
        token_env: str = params.get("token_env", "")
        if token_env:
            token: str = os.environ.get(token_env, "")
            if token:
                headers["Authorization"] = f"Bearer {token}"
        return headers

    async def _query(self, params: dict[str, Any], target_url: str) -> ToolOutput:
        metrics: list[str] = params.get("metrics", [])
        duration: str = params.get("duration", "1h")
        headers: dict[str, str] = self._get_headers(params)

        if not metrics:
            return ToolOutput(result={"success": False}, error="metrics list is required for query action")

        results: dict[str, Any] = {}
        base_url: str = target_url.rstrip("/")

        async with httpx.AsyncClient() as client:
            for metric_name in metrics:
                query: str = metric_name
                try:
                    response = await client.get(
                        f"{base_url}/api/v1/query",
                        params={"query": query},
                        headers=headers,
                        timeout=15.0,
                    )
                    if response.status_code == 200:
                        data: dict[str, Any] = response.json()
                        results[metric_name] = data.get("data", {})
                    else:
                        results[metric_name] = {
                            "error": f"HTTP {response.status_code}",
                            "status": "failed",
                        }
                except httpx.TimeoutException:
                    results[metric_name] = {"error": "Request timed out", "status": "timeout"}
                except Exception as e:
                    results[metric_name] = {"error": str(e), "status": "error"}

        return ToolOutput(result={
            "success": True,
            "action": "query",
            "duration": duration,
            "metrics_count": len(metrics),
            "results": results,
        })

    async def _alert(self, params: dict[str, Any], target_url: str) -> ToolOutput:
        headers: dict[str, str] = self._get_headers(params)
        base_url: str = target_url.rstrip("/")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{base_url}/api/v1/alerts",
                    headers=headers,
                    timeout=15.0,
                )

                if response.status_code == 200:
                    data: dict[str, Any] = response.json()
                    alerts: list[dict[str, Any]] = data.get("data", {}).get("alerts", [])

                    firing: list[dict[str, Any]] = [a for a in alerts if a.get("state") == "firing"]
                    pending: list[dict[str, Any]] = [a for a in alerts if a.get("state") == "pending"]
                    inactive: list[dict[str, Any]] = [a for a in alerts if a.get("state") == "inactive"]

                    return ToolOutput(result={
                        "success": True,
                        "action": "alert",
                        "total_alerts": len(alerts),
                        "firing_count": len(firing),
                        "pending_count": len(pending),
                        "inactive_count": len(inactive),
                        "firing": firing[:50],
                        "pending": pending[:20],
                    })
                else:
                    return ToolOutput(
                        result={"success": False, "status_code": response.status_code},
                        error=f"Alert query failed: HTTP {response.status_code}",
                    )
        except httpx.TimeoutException:
            return ToolOutput(result={"success": False}, error="Request timed out after 15s")
        except Exception as e:
            return ToolOutput(result={"success": False}, error=str(e))

    async def _health(self, params: dict[str, Any], target_url: str) -> ToolOutput:
        headers: dict[str, str] = self._get_headers(params)
        base_url: str = target_url.rstrip("/")
        checks: dict[str, bool] = {}
        details: dict[str, Any] = {}

        try:
            async with httpx.AsyncClient() as client:
                try:
                    response = await client.get(
                        f"{base_url}/-/healthy",
                        headers=headers,
                        timeout=10.0,
                    )
                    checks["healthy"] = response.status_code == 200
                    details["healthy_status_code"] = response.status_code
                except Exception as e:
                    checks["healthy"] = False
                    details["healthy_error"] = str(e)

                try:
                    response = await client.get(
                        f"{base_url}/-/ready",
                        headers=headers,
                        timeout=10.0,
                    )
                    checks["ready"] = response.status_code == 200
                    details["ready_status_code"] = response.status_code
                except Exception as e:
                    checks["ready"] = False
                    details["ready_error"] = str(e)

                try:
                    response = await client.get(
                        f"{base_url}/api/v1/status/config",
                        headers=headers,
                        timeout=10.0,
                    )
                    checks["config_accessible"] = response.status_code == 200
                    if response.status_code == 200:
                        details["config"] = response.json()
                except Exception as e:
                    checks["config_accessible"] = False
                    details["config_error"] = str(e)

        except Exception as e:
            return ToolOutput(result={"success": False}, error=str(e))

        healthy: bool = all(checks.values()) if checks else False

        return ToolOutput(result={
            "success": True,
            "action": "health",
            "healthy": healthy,
            "checks": checks,
            "details": details,
        })
