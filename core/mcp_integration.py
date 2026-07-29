"""MCP Server Integration — Native Model Context Protocol support.

Connects to MCP (Model Context Protocol) servers and registers their
tools as FlowForge tools. This enables interoperability with the
growing MCP ecosystem.

Usage:
    from flowforge.core.mcp_integration import MCPIntegration

    mcp = MCPIntegration(tool_registry=tool_registry)

    # Connect to an MCP server via stdio
    await mcp.connect_server(
        name="filesystem",
        command="npx",
        args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    )

    # Or connect via HTTP/SSE
    await mcp.connect_server(
        name="remote-api",
        url="http://localhost:3001/sse",
    )

    # All MCP tools are now available as FlowForge tools
    result = await tool_registry.execute(
        "mcp.filesystem.read_file",
        ToolInput(params={"path": "/tmp/test.txt"}),
    )
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger
from flowforge.tools.registry import ToolRegistry

logger = get_logger("mcp_integration")


class MCPToolWrapper(BaseTool):
    """Wraps an MCP tool as a FlowForge BaseTool.

    The tool name is prefixed with ``mcp.{server_name}.`` so that it
    integrates cleanly into the FlowForge tool namespace without
    colliding with native tools.

    Attributes:
        name: Fully-qualified tool name (e.g. ``mcp.filesystem.read_file``).
        description: Human-readable description from the MCP tool metadata.
        parameters_schema: JSON Schema converted from MCP inputSchema.
        _server_name: The MCP server this tool belongs to.
        _mcp_tool_name: The original tool name on the MCP server.
        _integration: Back-reference to the MCPIntegration for dispatch.
    """

    safety_level: str = "normal"
    is_concurrency_safe: bool = True

    def __init__(
        self,
        server_name: str,
        tool_info: Dict[str, Any],
        integration: MCPIntegration,
    ) -> None:
        self._server_name = server_name
        self._mcp_tool_name: str = tool_info.get("name", "unknown")
        self._tool_info = tool_info
        self._integration = integration

        # Build the prefixed name
        self.name = f"mcp.{server_name}.{self._mcp_tool_name}"
        self.description = tool_info.get("description", "")
        self.parameters_schema = self._convert_schema(
            tool_info.get("inputSchema", {})
        )

    @staticmethod
    def _convert_schema(mcp_schema: Dict[str, Any]) -> Dict[str, Any]:
        """Convert MCP JSON Schema to FlowForge parameters_schema."""
        if not mcp_schema:
            return {"type": "object", "properties": {}}
        return {
            "type": mcp_schema.get("type", "object"),
            "properties": mcp_schema.get("properties", {}),
            "required": mcp_schema.get("required", []),
        }

    async def execute(self, input: ToolInput) -> ToolOutput:
        """Execute the MCP tool through the integration layer."""
        if not self._integration.is_available():
            return ToolOutput(
                result={},
                error="MCP integration is not available — no MCPClient could be loaded",
            )
        try:
            result = await self._integration._call_mcp_tool(
                server_name=self._server_name,
                tool_name=self._mcp_tool_name,
                arguments=input.params,
            )
            if isinstance(result, dict) and "error" in result and result.get("result") is None:
                return ToolOutput(result={}, error=result["error"])
            if isinstance(result, ToolOutput):
                return result
            return ToolOutput(
                result=result if isinstance(result, dict) else {"result": result}
            )
        except Exception as e:
            logger.error(
                f"MCP tool '{self.name}' execution failed: {e}"
            )
            return ToolOutput(result={}, error=str(e))

    def get_tool_info(self) -> Dict[str, Any]:
        """Return the original MCP tool metadata."""
        return dict(self._tool_info)


class MCPIntegration:
    """Bridges MCP Server tools into FlowForge's ToolRegistry.

    Manages connections to multiple MCP servers, auto-discovers their
    tools, and registers each as an :class:`MCPToolWrapper` in the
    target :class:`ToolRegistry`.

    Uses :class:`flowforge.mcp.client.MCPClient` for real JSON-RPC 2.0
    communication. If MCPClient is not available, the integration reports
    itself as unavailable via :meth:`is_available`.
    """

    def __init__(self, tool_registry: ToolRegistry) -> None:
        self._tool_registry = tool_registry
        # server_name -> {client, config, tools}
        self._servers: Dict[str, Dict[str, Any]] = {}
        self._mcp_client_available: Optional[bool] = None

    def is_available(self) -> bool:
        """Check whether the MCP client library is available.

        Returns False if the ``flowforge.mcp.client.MCPClient`` cannot
        be imported, meaning all MCP operations will fail gracefully.
        """
        if self._mcp_client_available is None:
            try:
                from flowforge.mcp.client import MCPClient  # noqa: F401
                self._mcp_client_available = True
            except ImportError:
                self._mcp_client_available = False
                logger.warning(
                    "MCPClient is not available — MCP integration is disabled. "
                    "Ensure flowforge.mcp.client is importable."
                )
        return self._mcp_client_available

    def _create_client(self, **kwargs) -> Any:
        """Instantiate an MCPClient, raising if unavailable."""
        from flowforge.mcp.client import MCPClient
        return MCPClient(config=kwargs)

    # ── Server lifecycle ────────────────────────────────────────────

    async def connect_server(
        self,
        name: str,
        command: Optional[str] = None,
        args: Optional[List[str]] = None,
        url: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
    ) -> None:
        """Connect to an MCP server and register its tools.

        Args:
            name: Logical name for this server (used as namespace prefix).
            command: Executable command for stdio transport.
            args: Command arguments for stdio transport.
            url: URL for HTTP/SSE transport.
            env: Extra environment variables for the server process.

        Raises:
            ValueError: If neither *command* nor *url* is provided, or
                a server with *name* is already connected.
            RuntimeError: If MCPClient is not available.
        """
        if not command and not url:
            raise ValueError("Either 'command' or 'url' must be provided")

        if name in self._servers:
            raise ValueError(f"MCP server '{name}' is already connected")

        if not self.is_available():
            raise RuntimeError(
                "Cannot connect to MCP server: MCPClient is not available. "
                "Ensure flowforge.mcp.client is importable."
            )

        # Create and connect the real MCPClient
        client = self._create_client(server_name=name)
        connected = await client.connect(
            command=command,
            args=args,
            url=url,
            server_name=name,
        )
        if not connected:
            raise RuntimeError(
                f"Failed to connect to MCP server '{name}' "
                f"(command={command}, url={url})"
            )

        transport = "stdio" if command else "sse"
        logger.info(
            f"MCP connection to {name} established "
            f"(transport={transport}, "
            f"command={command or 'N/A'}, "
            f"url={url or 'N/A'})"
        )

        server_config: Dict[str, Any] = {
            "name": name,
            "transport": transport,
            "command": command,
            "args": args or [],
            "url": url,
            "env": env or {},
            "connected": True,
            "client": client,
        }

        # Discover tools via the real MCPClient
        discovered_tools = await self._discover_tools(name, server_config)

        # Wrap and register each tool
        wrappers: List[MCPToolWrapper] = []
        for tool_info in discovered_tools:
            wrapper = MCPToolWrapper(
                server_name=name,
                tool_info=tool_info,
                integration=self,
            )
            self._tool_registry.register(wrapper)
            wrappers.append(wrapper)
            logger.info(
                f"Registered MCP tool: {wrapper.name} "
                f"(from server '{name}')"
            )

        server_config["tools"] = wrappers
        self._servers[name] = server_config

        logger.info(
            f"MCP server '{name}' connected: "
            f"{len(wrappers)} tool(s) registered"
        )

    async def disconnect_server(self, name: str) -> None:
        """Disconnect from an MCP server and unregister its tools.

        Args:
            name: The logical server name used in :meth:`connect_server`.

        Raises:
            KeyError: If no server with *name* is connected.
        """
        if name not in self._servers:
            raise KeyError(f"MCP server '{name}' is not connected")

        server = self._servers[name]

        # Disconnect the real MCPClient
        client = server.get("client")
        if client:
            try:
                await client.disconnect()
            except Exception as e:
                logger.warning(f"Error disconnecting MCP client for '{name}': {e}")

        for wrapper in server.get("tools", []):
            try:
                self._tool_registry.unregister(wrapper.name)
            except KeyError:
                logger.debug(
                    f"Tool '{wrapper.name}' already unregistered"
                )

        del self._servers[name]
        logger.info(f"MCP server '{name}' disconnected")

    # ── Query helpers ───────────────────────────────────────────────

    async def list_servers(self) -> List[Dict[str, Any]]:
        """List all connected MCP servers.

        Returns:
            A list of dicts with keys: name, transport, tool_count, connected.
        """
        result: List[Dict[str, Any]] = []
        for name, server in self._servers.items():
            result.append({
                "name": name,
                "transport": server.get("transport", "unknown"),
                "tool_count": len(server.get("tools", [])),
                "connected": server.get("connected", False),
            })
        return result

    async def list_tools(
        self, server_name: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List available MCP tools, optionally filtered by server.

        Args:
            server_name: If provided, only list tools from this server.

        Returns:
            A list of tool info dicts with keys: name, server, description.
        """
        tools: List[Dict[str, Any]] = []
        for name, server in self._servers.items():
            if server_name and name != server_name:
                continue
            for wrapper in server.get("tools", []):
                tools.append({
                    "name": wrapper.name,
                    "server": name,
                    "description": wrapper.description,
                })
        return tools

    # ── Internal dispatch ────────────────────────────────────────────

    async def _call_mcp_tool(
        self,
        server_name: str,
        tool_name: str,
        arguments: Dict[str, Any],
    ) -> Any:
        """Dispatch a tool call to the MCP server via MCPClient."""
        server = self._servers.get(server_name)
        if not server or not server.get("connected"):
            return {"result": None, "error": f"MCP server '{server_name}' is not connected"}

        client = server.get("client")
        if not client:
            return {"result": None, "error": f"No MCPClient for server '{server_name}'"}

        logger.info(
            f"MCP tool call: mcp.{server_name}.{tool_name} "
            f"(args keys: {list(arguments.keys())})"
        )

        try:
            response = await client.call_tool(
                tool_name=tool_name,
                arguments=arguments,
                server_name=server_name,
            )
            error = response.get("error")
            result = response.get("result")
            if error:
                return {"result": None, "error": error}
            return result if isinstance(result, dict) else {"result": result}
        except Exception as e:
            logger.error(f"MCP tool call failed: {e}")
            return {"result": None, "error": str(e)}

    async def _discover_tools(
        self,
        server_name: str,
        server_config: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """Discover tools exposed by an MCP server via MCPClient."""
        client = server_config.get("client")
        if not client:
            logger.warning(f"No MCPClient for server '{server_name}', cannot discover tools")
            return []

        transport = server_config.get("transport", "unknown")
        logger.info(
            f"Discovering tools from MCP server '{server_name}' "
            f"(transport={transport})"
        )

        try:
            tools = await client.list_tools(server_name=server_name)
            if tools:
                logger.info(f"Discovered {len(tools)} tool(s) from MCP server '{server_name}'")
                return tools
            logger.info(f"No tools discovered from MCP server '{server_name}'")
            return []
        except Exception as e:
            logger.error(f"Tool discovery failed for MCP server '{server_name}': {e}")
            return []

    # ── P2-024 MCP 1→3 server 拆分（CL-037） ────────────────────────
    #
    # 将单个臃肿的 MCP server 拆分为 3 个聚焦的 server：
    # - collab:  协作类工具（agents / sessions / handoffs / council）
    # - memory:  记忆类工具（episodes / methods / codex / knowledge）
    # - signals: 信号类工具（metrics / events / telemetry / observability）
    #
    # 同时支持 prompt 瘦身 50%：每个 wrapper 的 description 截断到 256 字符，
    # 并去除冗余示例和重复说明。
    #
    # 详见 [doc:review/review.md#CL-037] MCP 1→3 server 拆分

    # 三类拆分的工具名关键词映射
    SPLIT_KEYWORDS: Dict[str, List[str]] = {
        "collab": [
            "agent", "session", "handoff", "council", "forgekin",
            "swarm", "team", "collaborate", "delegate", "approval",
        ],
        "memory": [
            "memory", "episode", "method", "codex", "knowledge",
            "echo", "mind", "soul", "experience", "distill",
        ],
        "signals": [
            "metric", "event", "telemetry", "observability", "trace",
            "log", "monitor", "alert", "health", "status",
        ],
    }

    # prompt 瘦身后最大长度（原 50% 目标）
    SLIMMED_DESCRIPTION_MAX_LENGTH = 256

    @classmethod
    def _classify_tool(cls, tool_name: str, tool_description: str = "") -> str:
        """根据工具名和描述分类到 collab / memory / signals 之一.

        匹配优先级：collab > memory > signals（默认）。
        """
        text = f"{tool_name} {tool_description}".lower()
        for category in ("collab", "memory", "signals"):
            keywords = cls.SPLIT_KEYWORDS[category]
            if any(kw in text for kw in keywords):
                return category
        # 默认归入 signals（无关键词匹配时）
        return "signals"

    @classmethod
    def _slim_description(cls, description: str) -> str:
        """prompt 瘦身 50% — 截断到 256 字符并去除冗余.

        规则：
        1. 移除多行示例块（```...``` 之间的内容）
        2. 移除"Example:" / "示例:" 之后的内容
        3. 截断到 SLIMMED_DESCRIPTION_MAX_LENGTH 字符
        """
        if not description:
            return ""
        import re
        # 移除代码块示例
        slimmed = re.sub(r"```[\s\S]*?```", "", description)
        # 移除 "Example:" / "示例:" 后的内容
        slimmed = re.split(r"\b(?:Example|示例)\b\s*:", slimmed, maxsplit=1)[0]
        # 压缩多余空白
        slimmed = " ".join(slimmed.split())
        # 截断
        if len(slimmed) > cls.SLIMMED_DESCRIPTION_MAX_LENGTH:
            slimmed = slimmed[: cls.SLIMMED_DESCRIPTION_MAX_LENGTH - 3] + "..."
        return slimmed.strip()

    async def split_server(
        self,
        source_server: str,
        target_prefix: Optional[str] = None,
    ) -> Dict[str, int]:
        """将已连接的 MCP server 工具拆分到 3 个虚拟 server 命名空间.

        P2-024 / CL-037: MCP 1→3 server 拆分。

        不会创建新的 MCP 连接，而是在 ToolRegistry 中按新命名空间
        重新注册 wrapper，原 server 的工具会被注销。

        Args:
            source_server: 原 server 名称（必须已 connect_server）
            target_prefix: 新 server 命名空间前缀，默认为 source_server 名

        Returns:
            dict 形如 {"collab": 3, "memory": 5, "signals": 2}，记录每类工具数

        Raises:
            KeyError: source_server 未连接
        """
        if source_server not in self._servers:
            raise KeyError(f"MCP server '{source_server}' is not connected")

        server = self._servers[source_server]
        prefix = target_prefix or source_server
        wrappers: List[MCPToolWrapper] = server.get("tools", [])

        # 按类别分组
        grouped: Dict[str, List[MCPToolWrapper]] = {
            "collab": [], "memory": [], "signals": [],
        }
        for wrapper in wrappers:
            category = self._classify_tool(
                wrapper._mcp_tool_name, wrapper.description
            )
            grouped[category].append(wrapper)

        # 注销原 wrapper
        for wrapper in wrappers:
            try:
                self._tool_registry.unregister(wrapper.name)
            except KeyError:
                logger.debug(f"Tool '{wrapper.name}' already unregistered")

        # 重新注册到新命名空间 + 应用 prompt 瘦身
        new_servers_config: Dict[str, Dict[str, Any]] = {}
        for category, cat_wrappers in grouped.items():
            new_server_name = f"{prefix}-{category}"
            new_wrappers: List[MCPToolWrapper] = []
            for wrapper in cat_wrappers:
                # 创建新 wrapper（新命名空间）
                new_tool_info = dict(wrapper._tool_info)
                # 应用 prompt 瘦身
                original_desc = new_tool_info.get("description", "")
                new_tool_info["description"] = self._slim_description(original_desc)
                new_wrapper = MCPToolWrapper(
                    server_name=new_server_name,
                    tool_info=new_tool_info,
                    integration=self,
                )
                self._tool_registry.register(new_wrapper)
                new_wrappers.append(new_wrapper)
                logger.info(
                    f"Re-registered MCP tool: {new_wrapper.name} "
                    f"(category={category})"
                )
            new_servers_config[new_server_name] = {
                "name": new_server_name,
                "transport": server.get("transport", "unknown"),
                "command": server.get("command"),
                "args": server.get("args", []),
                "url": server.get("url"),
                "env": server.get("env", {}),
                "connected": True,
                "client": server.get("client"),  # 共享原 client
                "tools": new_wrappers,
                "split_from": source_server,
                "category": category,
            }

        # 删除原 server 条目，添加 3 个新 server 条目
        del self._servers[source_server]
        self._servers.update(new_servers_config)

        counts = {cat: len(items) for cat, items in grouped.items()}
        logger.info(
            f"MCP server '{source_server}' split into 3 servers: "
            f"collab={counts['collab']} memory={counts['memory']} "
            f"signals={counts['signals']}"
        )
        return counts

    def get_split_status(self) -> Dict[str, List[str]]:
        """查询当前所有 server 的拆分状态.

        Returns:
            dict 形如 {"original": [...], "split": [...]}，分别列出
            未拆分和已拆分的 server 名称。
        """
        original: List[str] = []
        split_servers: List[str] = []
        for name, server in self._servers.items():
            if server.get("split_from"):
                split_servers.append(name)
            else:
                original.append(name)
        return {"original": original, "split": split_servers}
