"""FlowForge CI/CD 触发工具 — 通过 GitHub Actions 或 GitLab CI 触发流水线并查询状态。"""

from __future__ import annotations

import os
from typing import Any

import httpx

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput


class CICDTriggerTool(BaseTool):
    name: str = "cicd_trigger"
    description: str = "Trigger CI/CD pipelines and check status via GitHub Actions or GitLab CI"
    parameters_schema: dict[str, Any] = {
        "type": "object",
        "required": ["action", "provider", "api_url"],
        "properties": {
            "action": {
                "type": "string",
                "enum": ["trigger", "status"],
            },
            "pipeline_id": {"type": "string"},
            "provider": {
                "type": "string",
                "enum": ["github", "gitlab", "generic"],
            },
            "api_url": {"type": "string"},
            "token_env": {"type": "string"},
            "ref": {"type": "string"},
            "inputs": {"type": "object"},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        action: str = input.params.get("action", "")
        provider: str = input.params.get("provider", "generic")
        api_url: str = input.params.get("api_url", "")
        token_env: str = input.params.get("token_env", "")

        token: str = os.environ.get(token_env, "") if token_env else ""

        if action == "trigger":
            return await self._trigger(input.params, provider, api_url, token)
        elif action == "status":
            return await self._status(input.params, provider, api_url, token)
        else:
            return ToolOutput(
                result={"success": False},
                error=f"Unknown action: {action}. Supported: trigger, status",
            )

    async def _trigger(
        self, params: dict[str, Any], provider: str, api_url: str, token: str
    ) -> ToolOutput:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if token:
            if provider == "github":
                headers["Authorization"] = f"Bearer {token}"
            elif provider == "gitlab":
                headers["PRIVATE-TOKEN"] = token
            else:
                headers["Authorization"] = f"Bearer {token}"

        payload: dict[str, Any] = {}
        ref: str | None = params.get("ref")
        if ref:
            payload["ref"] = ref
        workflow_inputs: dict[str, Any] | None = params.get("inputs")
        if workflow_inputs:
            payload["inputs"] = workflow_inputs

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    api_url,
                    json=payload,
                    headers=headers,
                    timeout=30.0,
                )

                if response.status_code in (200, 201, 204):
                    data: dict[str, Any] = response.json() if response.text else {}
                    pipeline_id: str = ""
                    pipeline_url: str = ""

                    if provider == "github":
                        pipeline_id = str(data.get("id", ""))
                        pipeline_url = data.get("html_url", "")
                    elif provider == "gitlab":
                        pipeline_id = str(data.get("id", ""))
                        pipeline_url = data.get("web_url", "")
                    else:
                        pipeline_id = str(data.get("pipeline_id", data.get("id", "")))
                        pipeline_url = data.get("pipeline_url", data.get("web_url", ""))

                    return ToolOutput(result={
                        "success": True,
                        "pipeline_id": pipeline_id,
                        "pipeline_url": pipeline_url,
                        "provider": provider,
                        "status_code": response.status_code,
                    })
                else:
                    return ToolOutput(
                        result={"success": False, "status_code": response.status_code},
                        error=f"Pipeline trigger failed: HTTP {response.status_code} — {response.text[:500]}",
                    )
        except httpx.TimeoutException:
            return ToolOutput(result={"success": False}, error="Request timed out after 30s")
        except Exception as e:
            return ToolOutput(result={"success": False}, error=str(e))

    async def _status(
        self, params: dict[str, Any], provider: str, api_url: str, token: str
    ) -> ToolOutput:
        pipeline_id: str = params.get("pipeline_id", "")
        if not pipeline_id:
            return ToolOutput(result={"success": False}, error="pipeline_id is required for status check")

        headers: dict[str, str] = {}
        if token:
            if provider == "github":
                headers["Authorization"] = f"Bearer {token}"
            elif provider == "gitlab":
                headers["PRIVATE-TOKEN"] = token
            else:
                headers["Authorization"] = f"Bearer {token}"

        status_url: str = api_url.rstrip("/")
        if provider == "github":
            status_url = f"{api_url}/{pipeline_id}"
        elif provider == "gitlab":
            status_url = f"{api_url}/{pipeline_id}"
        else:
            status_url = f"{api_url}/{pipeline_id}"

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    status_url,
                    headers=headers,
                    timeout=30.0,
                )

                if response.status_code == 200:
                    data: dict[str, Any] = response.json()
                    status: str = ""
                    conclusion: str = ""

                    if provider == "github":
                        status = data.get("status", "unknown")
                        conclusion = data.get("conclusion", "")
                    elif provider == "gitlab":
                        status = data.get("status", "unknown")
                        conclusion = data.get("detailed_status", "")
                    else:
                        status = data.get("status", "unknown")
                        conclusion = data.get("conclusion", "")

                    return ToolOutput(result={
                        "success": True,
                        "pipeline_id": pipeline_id,
                        "status": status,
                        "conclusion": conclusion,
                        "provider": provider,
                        "raw": data,
                    })
                else:
                    return ToolOutput(
                        result={"success": False, "status_code": response.status_code},
                        error=f"Status check failed: HTTP {response.status_code}",
                    )
        except httpx.TimeoutException:
            return ToolOutput(result={"success": False}, error="Request timed out after 30s")
        except Exception as e:
            return ToolOutput(result={"success": False}, error=str(e))
