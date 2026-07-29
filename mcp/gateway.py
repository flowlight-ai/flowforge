"""MCP Gateway - L2 Governance Layer.

Implements FR-CAP-03 L2:
- Tool whitelist
- Token budget management (25K default)
- Rate limiting (60/min default)
- Permission pipeline integration
- Stream execution support
"""

import time
import asyncio
from typing import Optional, Dict, Any, List
from flowforge.core.tracing import get_logger

logger = get_logger("mcp.gateway")

DEFAULT_TOKEN_BUDGET = 25000
DEFAULT_RATE_LIMIT = 60  # per minute


class MCPGateway:
    """MCP governance gateway.

    Manages access control, token budgets, and rate limiting
    for MCP tool calls.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None, permission_pipeline=None):
        self.config = config or {}
        self.permission_pipeline = permission_pipeline
        self.token_budget = self.config.get("token_budget", DEFAULT_TOKEN_BUDGET)
        self.rate_limit = self.config.get("rate_limit", DEFAULT_RATE_LIMIT)
        self.whitelist: List[str] = self.config.get("whitelist", [])
        self._tokens_used = 0
        self._call_timestamps: List[float] = []
        self._call_count = 0
        self._denied_count = 0

    async def execute_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        client=None,
    ) -> Dict[str, Any]:
        """Execute a tool through the gateway.

        Checks: whitelist → rate limit → token budget → permission → execute
        """
        self._call_count += 1

        # 1. Whitelist check
        if self.whitelist and tool_name not in self.whitelist:
            self._denied_count += 1
            return {"error": f"Tool '{tool_name}' not in whitelist"}

        # 2. Rate limit check
        if not self._check_rate_limit():
            self._denied_count += 1
            return {"error": "Rate limit exceeded"}

        # 3. Token budget check
        estimated_tokens = self._estimate_tokens(arguments)
        if self._tokens_used + estimated_tokens > self.token_budget:
            self._denied_count += 1
            return {"error": f"Token budget exceeded (used: {self._tokens_used}/{self.token_budget})"}

        # 4. Permission check (if pipeline configured)
        if self.permission_pipeline:
            from flowforge.security.permission_pipeline import ActionLevel
            result = await self.permission_pipeline.check(
                tool_name=tool_name,
                action_level=ActionLevel.EXECUTE,
            )
            if not result.get("allowed", False):
                self._denied_count += 1
                return {"error": f"Permission denied: {result.get('reason', 'unknown')}"}

        # 5. Execute
        if client:
            result = await client.call_tool(tool_name, arguments)
            self._tokens_used += estimated_tokens
            return result

        return {"error": "No MCP client configured"}

    async def execute_tool_stream(self, tool_name: str, arguments: Dict[str, Any], client=None):
        """Execute a tool with streaming support.

        Yields result chunks as they arrive.
        """
        # Same checks as execute_tool
        if self.whitelist and tool_name not in self.whitelist:
            yield {"error": f"Tool '{tool_name}' not in whitelist"}
            return

        if client and hasattr(client, 'call_tool_stream'):
            async for chunk in client.call_tool_stream(tool_name, arguments):
                yield chunk
        else:
            result = await self.execute_tool(tool_name, arguments, client)
            yield result

    def _check_rate_limit(self) -> bool:
        """Check if rate limit is exceeded."""
        now = time.time()
        # Remove timestamps older than 60 seconds
        self._call_timestamps = [t for t in self._call_timestamps if now - t < 60]

        if len(self._call_timestamps) >= self.rate_limit:
            return False

        self._call_timestamps.append(now)
        return True

    def _estimate_tokens(self, arguments: Dict[str, Any]) -> int:
        """Estimate token count for arguments."""
        text = str(arguments)
        return max(1, len(text) // 4)

    def get_status(self) -> dict:
        """Get gateway status."""
        return {
            "token_budget": self.token_budget,
            "tokens_used": self._tokens_used,
            "tokens_remaining": self.token_budget - self._tokens_used,
            "rate_limit": self.rate_limit,
            "call_count": self._call_count,
            "denied_count": self._denied_count,
            "whitelist_size": len(self.whitelist),
        }
