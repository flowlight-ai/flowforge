"""FlowForge SDK — Unified entry point for upper-level projects.

This is the ONLY import upper projects need:

    from flowforge.sdk import FlowForgeSDK

    sdk = FlowForgeSDK()

    # Model access
    result = await sdk.llm.chat("Write something")

    # Tool registration
    @sdk.tool(name="my_tool", description="My custom tool")
    async def my_tool(query: str) -> dict:
        return {"result": query}

    # Agent registration
    @sdk.agent(name="my_agent", description="My custom agent")
    async def my_agent(task: str) -> dict:
        return {"output": task}

    # Event subscription
    @sdk.on_event("task.completed")
    async def on_task_completed(event):
        print(f"Task completed: {event}")

    # Plugin registration (for domain plugins)
    class MyPlugin(sdk.FlowForgePlugin):
        name = "my_plugin"
        ...

    # Access registries
    models = sdk.models.list_models()
    tools = sdk.tools.list_tools()
    agents = sdk.agents.list_agents()

极简接入 (Minimal Integration):

    sdk = FlowForgeSDK(project="contentforge")

    # Convention-over-configuration: auto-scan agents, tools, routes
    sdk.bootstrap()

    # Or use fine-grained scanning
    sdk.scan_agents("contentforge.agents")
    sdk.scan_tools("contentforge.tools")
    sdk.scan_routes("contentforge.app.api:router", prefix="/api/v1")

    # Declarative plugin creation
    plugin = sdk.create_plugin(
        name="contentforge",
        agents_package="contentforge.agents",
        tools_package="contentforge.tools",
    )

    # Pre-configured FastAPI app
    app = sdk.app
"""

from __future__ import annotations

import importlib
import inspect
import os
import pkgutil
import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Union

from flowforge.core.agent_registry import AgentRegistry
from flowforge.core.base_agent import AgentInput, AgentOutput, BaseAgent
from flowforge.core.base_tool import BaseTool, ToolInput
from flowforge.core.config import ConfigLoader
from flowforge.core.guardrails import GuardrailRegistry, GuardrailExecutor, InputGuardrail, OutputGuardrail
from flowforge.core.handoff import Handoff, HandoffManager
from flowforge.core.model_capability import ModelCapability
from flowforge.core.plugin_protocol import FlowForgePlugin, PluginManifest
from flowforge.core.tool_decorator import DecoratedTool, set_tool_registry, tool
from flowforge.core.tracing import get_logger
from flowforge.events.event_bus import EventBus
from flowforge.tools.llm.model_service import ModelService, get_model_service
from flowforge.tools.registry import ToolRegistry

logger = get_logger("sdk")


# ── Decorator-based Agent wrapper ───────────────────────────────────

class DecoratedAgent(BaseAgent):
    """A BaseAgent wrapper created by the @sdk.agent() decorator."""

    def __init__(
        self,
        func: Callable,
        name: str,
        description: str,
    ) -> None:
        self._func = func
        self.name = name
        self.description = description
        self.default_mode = None
        self._is_async = _is_async_func(func)

    async def execute(self, input: AgentInput) -> AgentOutput:
        """Execute the wrapped function with the input params."""
        try:
            if self._is_async:
                result = await self._func(**input.params)
            else:
                result = self._func(**input.params)

            if isinstance(result, dict):
                return AgentOutput(result=result)
            return AgentOutput(result={"result": result})

        except Exception as e:
            logger.error(f"Agent '{self.name}' execution failed: {e}")
            return AgentOutput(result={"error": str(e)})


def _is_async_func(func: Callable) -> bool:
    """Check if a function is async, handling functools.partial etc."""
    import asyncio
    return asyncio.iscoroutinefunction(func)


class FlowForgeSDK:
    """Unified entry point for upper-level projects.

    Provides lazy-initialized access to all FlowForge capabilities:
    - Model access (sdk.llm, sdk.models)
    - Tool registration (sdk.tool(), sdk.tools)
    - Agent registration (sdk.agent(), sdk.agents)
    - Event subscription (sdk.on_event(), sdk.events)
    - Memory access (sdk.memory)

    All services are lazily initialized on first access.
    """

    def __init__(
        self,
        project: str = "",
        config_dir: Optional[Union[str, Path]] = None,
    ) -> None:
        self._project: str = project
        self._config_dir: Optional[Path] = (
            Path(config_dir) if config_dir is not None else None
        )
        self._app: Optional[Any] = None
        self._auto_wire_pending: bool = bool(project)

        # If project is provided, set the domain module env var
        if project:
            os.environ.setdefault(
                "FLOWFORGE_DOMAIN_MODULE", f"{project}.plugins"
            )
            # Auto-detect config dir from project package if not provided
            if self._config_dir is None:
                try:
                    pkg = importlib.import_module(project)
                    pkg_path = Path(pkg.__file__).parent
                    candidate = pkg_path / "config"
                    if candidate.is_dir():
                        self._config_dir = candidate
                except (ImportError, AttributeError, TypeError):
                    pass

        self._agent_registry: Optional[AgentRegistry] = None
        self._tool_registry: Optional[ToolRegistry] = None
        self._event_bus: Optional[EventBus] = None
        self._model_capability: Optional[ModelCapability] = None
        self._model_service: Optional[ModelService] = None
        self._memory_manager: Optional[Any] = None
        self._config_loader: Optional[ConfigLoader] = None
        self._guardrail_registry: Optional[GuardrailRegistry] = None
        self._handoff_manager: Optional[HandoffManager] = None
        self._mcp_integration: Optional[Any] = None
        self._marketplace: Optional[Any] = None

    # ── Lazy property accessors ─────────────────────────────────────

    @property
    def project(self) -> str:
        """The project package name, if set during initialization."""
        return self._project

    @property
    def app(self) -> "FastAPI":
        """Pre-configured FastAPI instance.

        Lazily imports the framework's shared FastAPI app and optionally
        customizes the title based on the project name.
        """
        if self._app is None:
            from flowforge.app.main import app as _flowforge_app
            self._app = _flowforge_app
            if self._project:
                title = self._project.replace("_", " ").title() + " API"
                self._app.title = title
        return self._app

    @property
    def llm(self) -> ModelCapability:
        """Access the ModelCapability for zero-config LLM calls.

        The internal provider is accessible via ``sdk.llm.provider``
        for advanced model routing and health tracking.
        """
        if self._model_capability is None:
            self._model_capability = ModelCapability()
        return self._model_capability

    @property
    def models(self) -> ModelService:
        """Access the ModelService for model management and health checks."""
        if self._model_service is None:
            self._model_service = get_model_service()
        return self._model_service

    @property
    def tools(self) -> ToolRegistry:
        """Access the ToolRegistry for tool management."""
        if self._tool_registry is None:
            self._try_auto_wire()
        if self._tool_registry is None:
            self._tool_registry = ToolRegistry()
            set_tool_registry(self._tool_registry)
        return self._tool_registry

    @property
    def agents(self) -> AgentRegistry:
        """Access the AgentRegistry for agent management."""
        if self._agent_registry is None:
            self._try_auto_wire()
        if self._agent_registry is None:
            self._agent_registry = AgentRegistry()
        return self._agent_registry

    @property
    def events(self) -> EventBus:
        """Access the EventBus for event subscription and publishing."""
        if self._event_bus is None:
            self._try_auto_wire()
        if self._event_bus is None:
            self._event_bus = EventBus()
        return self._event_bus

    @property
    def memory(self) -> Any:
        """Access the MemoryManager for persistent storage."""
        if self._memory_manager is None:
            from flowforge.memory.manager import MemoryManager
            config = self.config.load_yaml("default.yaml")
            db_url = config.get("system", {}).get("db_url", "sqlite:///data/flowforge.db")
            self._memory_manager = MemoryManager({"db_url": db_url})
        return self._memory_manager

    @property
    def config(self) -> ConfigLoader:
        """Access the ConfigLoader for configuration management."""
        if self._config_loader is None:
            self._config_loader = ConfigLoader(config_dir=self._config_dir)
        return self._config_loader

    @property
    def guardrails(self) -> GuardrailRegistry:
        """Access the GuardrailRegistry for guardrail management."""
        if self._guardrail_registry is None:
            self._guardrail_registry = GuardrailRegistry()
        return self._guardrail_registry

    @property
    def handoffs(self) -> HandoffManager:
        """Access the HandoffManager for agent handoff management."""
        if self._handoff_manager is None:
            self._handoff_manager = HandoffManager(agent_registry=self.agents)
        return self._handoff_manager

    @property
    def mcp(self) -> Any:
        """Access the MCPIntegration for MCP server management.

        Lazily creates an :class:`MCPIntegration` bound to the SDK's
        ToolRegistry.  Use it to connect to MCP servers and auto-register
        their tools as FlowForge tools.

        Example::

            await sdk.mcp.connect_server(
                name="filesystem",
                command="npx",
                args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            )
        """
        if self._mcp_integration is None:
            from flowforge.core.mcp_integration import MCPIntegration
            self._mcp_integration = MCPIntegration(tool_registry=self.tools)
        return self._mcp_integration

    @property
    def marketplace(self) -> Any:
        """Access the Marketplace for plugin discovery and management.

        Lazily creates a :class:`Marketplace` instance. Use it to
        search, install, uninstall, and update FlowForge plugins.

        Example::

            # Search for plugins
            plugins = await sdk.marketplace.search("web search")

            # Install a plugin
            result = await sdk.marketplace.install("flowforge-web-search")

            # List installed plugins
            installed = await sdk.marketplace.list_installed()
        """
        if self._marketplace is None:
            from flowforge.core.marketplace import Marketplace
            self._marketplace = Marketplace()
        return self._marketplace

    @property
    def skills(self) -> Any:
        """Access the Skill system.

        Lazily creates a :class:`SkillManager` and loads skills from
        global and project directories.

        Example::

            # List all loaded skills
            all_skills = sdk.skills.list_skills()

            # Execute a skill
            result = await sdk.skills.execute_skill("my-skill", context)
        """
        if not hasattr(self, '_skills_manager'):
            from flowforge.skills.manager import SkillManager
            self._skills_manager = SkillManager()
            # Load global skills
            global_dir = os.path.join(
                os.path.dirname(os.path.dirname(__file__)), "config", "skills"
            )
            if os.path.exists(global_dir):
                self._skills_manager.load_skills(global_dir=global_dir)
            # Load project skills
            project_dir = os.path.join(os.getcwd(), "skills")
            if os.path.exists(project_dir):
                self._skills_manager.load_skills(project_dir=project_dir)
        return self._skills_manager

    # ── Decorator methods ───────────────────────────────────────────

    def tool(
        self,
        *,
        name: str,
        description: str = "",
        safety_level: str = "normal",
    ) -> Callable:
        """Decorator to register a function as a FlowForge tool.

        The decorated function is wrapped in a DecoratedTool and
        auto-registered with the SDK's ToolRegistry.

        Args:
            name: Unique tool identifier.
            description: Human-readable description.
            safety_level: "readonly", "normal", or "dangerous".

        Returns:
            A DecoratedTool instance.

        Example::

            @sdk.tool(name="my_search", description="Search my data")
            async def my_search(query: str, limit: int = 10) -> dict:
                return {"results": [...]}
        """
        # Ensure tool registry is initialized so auto-registration works
        _ = self.tools

        return tool(
            name=name,
            description=description,
            safety_level=safety_level,
            auto_register=True,
        )

    def agent(
        self,
        *,
        name: str,
        description: str = "",
    ) -> Callable:
        """Decorator to register a function as a FlowForge agent.

        The decorated function is wrapped in a DecoratedAgent and
        auto-registered with the SDK's AgentRegistry.

        Args:
            name: Unique agent identifier.
            description: Human-readable description.

        Returns:
            A DecoratedAgent instance.

        Example::

            @sdk.agent(name="writer", description="Content writer agent")
            async def writer(task: str, style: str = "formal") -> dict:
                return {"content": "..."}
        """
        def decorator(func: Callable) -> DecoratedAgent:
            wrapped = DecoratedAgent(
                func=func,
                name=name,
                description=description or inspect.getdoc(func) or "",
            )
            self.agents.register(wrapped)
            logger.info(f"SDK auto-registered agent: {name}")
            return wrapped

        import inspect
        return decorator

    def on_event(self, event_type: str) -> Callable:
        """Decorator to subscribe a function to an event type.

        Args:
            event_type: The event type to subscribe to (e.g. "task.completed").

        Returns:
            The original function (unchanged).

        Example::

            @sdk.on_event("task.completed")
            async def on_task_completed(event):
                print(f"Task completed: {event}")
        """
        def decorator(func: Callable) -> Callable:
            self.events.subscribe(event_type, func)
            logger.info(f"SDK subscribed to event: {event_type}")
            return func

        return decorator

    def input_guardrail(self, *, name: str) -> Callable:
        """Decorator to register a class as an input guardrail.

        The decorated class must be a subclass of InputGuardrail and
        will be auto-registered with the SDK's GuardrailRegistry.

        Args:
            name: Unique guardrail identifier.

        Returns:
            The original class (with name set), auto-registered.

        Example::

            @sdk.input_guardrail(name="content_safety")
            class ContentSafetyGuardrail(InputGuardrail):
                async def check(self, input_text: str, context: dict) -> GuardrailResult:
                    ...
        """
        def decorator(cls: type) -> type:
            if not (isinstance(cls, type) and issubclass(cls, InputGuardrail)):
                raise TypeError(f"@sdk.input_guardrail requires an InputGuardrail subclass, got {cls}")
            cls.name = name
            instance = cls()
            self.guardrails.register(instance)
            logger.info(f"SDK auto-registered input guardrail: {name}")
            return cls

        return decorator

    def output_guardrail(self, *, name: str) -> Callable:
        """Decorator to register a class as an output guardrail.

        The decorated class must be a subclass of OutputGuardrail and
        will be auto-registered with the SDK's GuardrailRegistry.

        Args:
            name: Unique guardrail identifier.

        Returns:
            The original class (with name set), auto-registered.

        Example::

            @sdk.output_guardrail(name="quality_check")
            class QualityGuardrail(OutputGuardrail):
                async def check(self, output_text: str, context: dict) -> GuardrailResult:
                    ...
        """
        def decorator(cls: type) -> type:
            if not (isinstance(cls, type) and issubclass(cls, OutputGuardrail)):
                raise TypeError(f"@sdk.output_guardrail requires an OutputGuardrail subclass, got {cls}")
            cls.name = name
            instance = cls()
            self.guardrails.register(instance)
            logger.info(f"SDK auto-registered output guardrail: {name}")
            return cls

        return decorator

    def declarative_agent(
        self,
        *,
        name: str,
        description: str = "",
        model: Optional[str] = None,
        tools: Optional[List[str]] = None,
        instructions: Optional[str] = None,
        handoffs: Optional[List[str]] = None,
        guardrails: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Callable:
        """Decorator to register a function as a declarative agent.

        Alias for the ``@agent()`` decorator from
        :mod:`flowforge.core.declarative_agent`.  The decorated function
        becomes the agent's execute logic; if the body is a placeholder
        (``...``), default LLM-based execution is used instead.

        The resulting :class:`DeclarativeAgent` is auto-registered with
        the SDK's AgentRegistry.

        Args:
            name: Unique agent identifier.
            description: Human-readable purpose.
            model: Preferred LLM model.
            tools: Tool names this agent can use.
            instructions: System prompt for LLM-based execution.
            handoffs: Agent names this agent can delegate to.
            guardrails: Guardrail names to enforce.
            metadata: Arbitrary metadata.

        Returns:
            The original function with a ``_declarative_agent`` attribute.

        Example::

            @sdk.declarative_agent(
                name="writer",
                description="Content writer",
                model="DeepSeek-V4-Pro",
                tools=["web_search"],
            )
            async def write(task: str, style: str = "professional") -> str:
                ...
        """
        from flowforge.core.declarative_agent import agent as _agent_decorator

        def decorator(func: Callable) -> Callable:
            # Apply the @agent() decorator logic
            inner = _agent_decorator(
                name=name,
                description=description,
                model=model,
                tools=tools,
                instructions=instructions,
                handoffs=handoffs,
                guardrails=guardrails,
                metadata=metadata,
            )
            result = inner(func)
            # Auto-register with the SDK's AgentRegistry
            da = result._declarative_agent
            self.agents.register(da)
            logger.info(f"SDK auto-registered declarative agent: {name}")
            return result

        return decorator

    # ── Plugin base class ───────────────────────────────────────────

    # Re-export FlowForgePlugin for convenience
    FlowForgePlugin = FlowForgePlugin

    # ── Wire into existing FlowForge instance ───────────────────────

    def wire(self, flowforge_instance: Any) -> None:
        """Wire this SDK into an existing FlowForge instance.

        After calling wire(), the SDK's registries are replaced with
        the ones from the FlowForge instance, so all registrations
        made via the SDK decorators are visible to the framework.

        Args:
            flowforge_instance: A flowforge.core.flowforge.FlowForge instance.
        """
        self._agent_registry = flowforge_instance.agent_registry
        self._tool_registry = flowforge_instance.tool_registry
        self._event_bus = flowforge_instance.event_bus
        self._memory_manager = flowforge_instance.memory_manager
        set_tool_registry(self._tool_registry)
        # Re-initialize handoff manager with the wired agent registry
        self._handoff_manager = HandoffManager(agent_registry=self._agent_registry)
        logger.info("SDK wired into FlowForge instance")

    def wire_from_context(self, context: Any) -> None:
        """Wire this SDK from a PluginContext.

        After calling wire_from_context(), the SDK's registries are
        replaced with the ones from the PluginContext, so all
        registrations made via the SDK decorators are visible to
        the framework.

        Args:
            context: A flowforge.core.plugin_protocol.PluginContext instance.
        """
        self._agent_registry = context.agent_registry
        self._tool_registry = context.tool_registry
        self._event_bus = context.event_bus
        self._memory_manager = context.memory_manager
        set_tool_registry(self._tool_registry)
        # Re-initialize handoff manager with the wired agent registry
        self._handoff_manager = HandoffManager(agent_registry=self._agent_registry)
        logger.info("SDK wired from PluginContext")

    # ── Auto-wiring ──────────────────────────────────────────────────

    def _try_auto_wire(self) -> None:
        """Try to wire SDK to framework's shared instances.

        When a project is set, attempts to import the framework's main
        module and reuse its shared registries.  This ensures that SDK
        registrations are visible to the running FlowForge application
        without explicit ``wire()`` calls.

        The method is idempotent — after the first call the
        ``_auto_wire_pending`` flag is cleared.
        """
        if not self._auto_wire_pending:
            return
        self._auto_wire_pending = False

        try:
            from flowforge.app import main as _main

            if hasattr(_main, "agent_registry") and _main.agent_registry is not None:
                self._agent_registry = _main.agent_registry
            if hasattr(_main, "tool_registry") and _main.tool_registry is not None:
                self._tool_registry = _main.tool_registry
                set_tool_registry(self._tool_registry)
            if hasattr(_main, "event_bus") and _main.event_bus is not None:
                self._event_bus = _main.event_bus
            if hasattr(_main, "model_service") and _main.model_service is not None:
                self._model_service = _main.model_service
            if hasattr(_main, "memory_manager") and _main.memory_manager is not None:
                self._memory_manager = _main.memory_manager
            if hasattr(_main, "llm_client") and _main.llm_client is not None:
                # Re-initialize handoff manager with the wired agent registry
                if self._agent_registry is not None:
                    self._handoff_manager = HandoffManager(
                        agent_registry=self._agent_registry
                    )

            logger.info("SDK auto-wired to framework shared instances")
        except (ImportError, AttributeError):
            logger.debug("SDK auto-wire skipped — framework main not available")

    # ── Auto-discovery methods ───────────────────────────────────────

    @staticmethod
    def _agent_class_to_name(cls: type, naming: str = "snake_case") -> str:
        """Convert an agent class to a registration name.

        For ``snake_case`` naming, strips the ``_Agent`` / ``Agent``
        suffix and converts CamelCase to snake_case.

        Args:
            cls: The agent class.
            naming: Naming convention — currently only ``snake_case``.

        Returns:
            The derived registration name.
        """
        name = cls.__name__
        # Strip Agent suffix
        if name.endswith("Agent"):
            name = name[: -len("Agent")]
        elif name.endswith("_Agent"):
            name = name[: -len("_Agent")]
        # CamelCase to snake_case (handle consecutive uppercase like SEO, LLM)
        if naming == "snake_case":
            # First, handle consecutive uppercase as a group: SEO -> seo, LLM -> llm
            name = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
            # Then handle normal CamelCase boundaries
            name = re.sub(r"([a-z\d])([A-Z])", r"\1_\2", name)
            name = name.lower()
        return name

    def scan_agents(self, package: str, *, naming: str = "snake_case") -> int:
        """Auto-discover and register all BaseAgent subclasses in a package.

        Iterates all modules in *package*, finds classes that inherit
        from :class:`BaseAgent` (excluding ``BaseAgent`` itself), and
        registers them with the SDK's :class:`AgentRegistry` via
        ``register_factory(name, cls)``.

        Args:
            package: Dotted package path, e.g. ``"contentforge.agents"``.
            naming: Naming convention for the registration key.
                ``snake_case`` strips the ``Agent`` suffix and converts
                CamelCase to snake_case.

        Returns:
            Number of agents registered.

        Example::

            count = sdk.scan_agents("contentforge.agents")
            print(f"Registered {count} agents")
        """
        count = 0
        try:
            pkg = importlib.import_module(package)
        except ImportError:
            logger.warning(f"scan_agents: package '{package}' not found")
            return 0

        pkg_path = getattr(pkg, "__path__", None)
        if pkg_path is None:
            logger.warning(f"scan_agents: '{package}' is not a package")
            return 0

        for _importer, mod_name, _ispkg in pkgutil.walk_packages(
            pkg_path, prefix=package + "."
        ):
            try:
                mod = importlib.import_module(mod_name)
            except ImportError as e:
                logger.warning(f"scan_agents: failed to import {mod_name}: {e}")
                continue

            for attr_name in dir(mod):
                try:
                    obj = getattr(mod, attr_name)
                except Exception:
                    continue
                if (
                    isinstance(obj, type)
                    and issubclass(obj, BaseAgent)
                    and obj is not BaseAgent
                    and obj is not DecoratedAgent
                ):
                    reg_name = self._agent_class_to_name(obj, naming)
                    try:
                        self.agents.register_factory(reg_name, obj)
                        count += 1
                        logger.info(
                            f"scan_agents: registered '{reg_name}' "
                            f"from {obj.__module__}.{obj.__qualname__}"
                        )
                    except Exception as e:
                        logger.warning(
                            f"scan_agents: failed to register '{reg_name}': {e}"
                        )

        logger.info(f"scan_agents: {count} agents discovered in '{package}'")
        return count

    def scan_tools(self, package: str) -> int:
        """Auto-discover and register all BaseTool subclasses in a package.

        Iterates all modules in *package*, finds classes that inherit
        from :class:`BaseTool` (excluding ``BaseTool`` itself),
        instantiates each, and registers it with the SDK's
        :class:`ToolRegistry`.

        Args:
            package: Dotted package path, e.g. ``"contentforge.tools"``.

        Returns:
            Number of tools registered.

        Example::

            count = sdk.scan_tools("contentforge.tools")
            print(f"Registered {count} tools")
        """
        count = 0
        try:
            pkg = importlib.import_module(package)
        except ImportError:
            logger.warning(f"scan_tools: package '{package}' not found")
            return 0

        pkg_path = getattr(pkg, "__path__", None)
        if pkg_path is None:
            logger.warning(f"scan_tools: '{package}' is not a package")
            return 0

        for _importer, mod_name, _ispkg in pkgutil.walk_packages(
            pkg_path, prefix=package + "."
        ):
            try:
                mod = importlib.import_module(mod_name)
            except ImportError as e:
                logger.warning(f"scan_tools: failed to import {mod_name}: {e}")
                continue

            for attr_name in dir(mod):
                try:
                    obj = getattr(mod, attr_name)
                except Exception:
                    continue
                if (
                    isinstance(obj, type)
                    and issubclass(obj, BaseTool)
                    and obj is not BaseTool
                ):
                    try:
                        instance = obj()
                        self.tools.register(instance)
                        count += 1
                        logger.info(
                            f"scan_tools: registered '{instance.name}' "
                            f"from {obj.__module__}.{obj.__qualname__}"
                        )
                    except ValueError:
                        # Already registered — skip
                        pass
                    except Exception as e:
                        logger.warning(
                            f"scan_tools: failed to register tool "
                            f"from {obj.__module__}.{obj.__qualname__}: {e}"
                        )
                elif (
                    isinstance(obj, BaseTool)
                    and not isinstance(obj, type)
                ):
                    # DecoratedTool instances created by @tool decorator
                    try:
                        self.tools.register(obj)
                        count += 1
                        logger.info(
                            f"scan_tools: registered '{obj.name}' "
                            f"from {obj.__class__.__module__}.{obj.__class__.__qualname__}"
                        )
                    except ValueError:
                        # Already registered — skip
                        pass
                    except Exception as e:
                        logger.warning(
                            f"scan_tools: failed to register tool "
                            f"'{obj.name}': {e}"
                        )

        logger.info(f"scan_tools: {count} tools discovered in '{package}'")
        return count

    def scan_routes(self, router_path: str, *, prefix: str = "") -> None:
        """Import and register a FastAPI Router on the SDK's app.

        Args:
            router_path: Dotted path in ``module.path:variable_name``
                format, e.g. ``"contentforge.app.api.router"``.
            prefix: Optional URL prefix for the router.

        Example::

            sdk.scan_routes("contentforge.app.api:router", prefix="/api/v1")
        """
        if ":" not in router_path:
            raise ValueError(
                f"router_path must be in 'module.path:variable_name' format, "
                f"got '{router_path}'"
            )

        module_path, attr_name = router_path.rsplit(":", 1)
        try:
            mod = importlib.import_module(module_path)
        except ImportError as e:
            raise ImportError(
                f"scan_routes: failed to import module '{module_path}': {e}"
            ) from e

        router = getattr(mod, attr_name, None)
        if router is None:
            raise AttributeError(
                f"scan_routes: '{module_path}' has no attribute '{attr_name}'"
            )

        self.app.include_router(router, prefix=prefix)
        logger.info(f"scan_routes: registered router from '{router_path}'")

    # ── Declarative Plugin creation ──────────────────────────────────

    def create_plugin(
        self,
        *,
        name: str,
        version: str = "0.1.0",
        description: str = "",
        priority: int = 100,
        agents_package: Optional[str] = None,
        tools_package: Optional[str] = None,
        routes: Optional[List[str]] = None,
        event_handlers: Optional[Dict[str, Callable]] = None,
        health_check_fn: Optional[Callable] = None,
        extra_tools: Optional[List[str]] = None,
    ) -> FlowForgePlugin:
        """Declaratively create a FlowForgePlugin with auto-discovery.

        Generates a plugin class that automatically scans and registers
        agents, tools, routes, and event handlers based on the provided
        parameters.

        Args:
            name: Plugin name.
            version: Plugin version string.
            description: Human-readable description.
            priority: Load priority (lower = loaded first).
            agents_package: Package to scan for BaseAgent subclasses.
            tools_package: Package to scan for BaseTool subclasses.
            routes: List of router paths in ``module:variable`` format.
            event_handlers: Dict mapping event types to handler callables.
            health_check_fn: Custom health check function.
            extra_tools: List of extra tool paths in ``module:ClassName`` format to register
                beyond those found by tools_package scanning.

        Returns:
            A :class:`FlowForgePlugin` instance ready for registration.

        Example::

            plugin = sdk.create_plugin(
                name="contentforge",
                version="1.0.0",
                agents_package="contentforge.agents",
                tools_package="contentforge.tools",
                routes=["contentforge.app.api:router"],
                event_handlers={"task.completed": on_task_done},
            )
        """
        sdk_ref = self
        _agents_package = agents_package
        _tools_package = tools_package
        _routes = routes or []
        _event_handlers = event_handlers or {}
        _health_check_fn = health_check_fn
        _extra_tools = extra_tools or []

        class AutoPlugin(FlowForgePlugin):
            manifest = PluginManifest(
                name=name,
                version=version,
                description=description,
                priority=priority,
            )

            def register_agents(self, agent_registry: Any) -> None:
                if _agents_package:
                    sdk_ref.scan_agents(_agents_package)

            def register_tools(self, tool_registry: Any) -> None:
                if _tools_package:
                    sdk_ref.scan_tools(_tools_package)
                # Register extra tools specified by path
                for tool_path in _extra_tools:
                    try:
                        module_path, class_name = tool_path.rsplit(":", 1)
                        import importlib
                        mod = importlib.import_module(module_path)
                        tool_cls = getattr(mod, class_name)
                        tool_instance = tool_cls()
                        tool_registry.register(tool_instance)
                        logger.info(f"Extra tool registered: {tool_path}")
                    except Exception as e:
                        logger.warning(f"Failed to register extra tool '{tool_path}': {e}")

            def register_routes(self, app: Any) -> None:
                for route_path in _routes:
                    prefix = ""
                    if isinstance(route_path, tuple):
                        route_path, prefix = route_path
                    sdk_ref.scan_routes(route_path, prefix=prefix)

            def register_event_handlers(self, event_bus: Any) -> None:
                for event_type, handler in _event_handlers.items():
                    event_bus.subscribe(event_type, handler)

            def health_check(self) -> dict:
                if _health_check_fn is not None:
                    return _health_check_fn()
                return {
                    "status": "healthy",
                    "name": name,
                    "version": version,
                }

        return AutoPlugin()

    # ── Convention-over-configuration bootstrap ──────────────────────

    def bootstrap(self) -> "FlowForgeSDK":
        """Convention-over-configuration auto-discovery.

        When ``project`` is set, automatically scans:

        - ``{project}.agents`` package for BaseAgent subclasses
        - ``{project}.tools`` package for BaseTool subclasses
        - ``{project}.app.api.router`` module for a FastAPI Router
          (tries common variable names: ``router``, ``api_router``)

        Returns self for chaining.

        Example::

            sdk = FlowForgeSDK(project="contentforge").bootstrap()
        """
        if not self._project:
            logger.warning("bootstrap: no project set, nothing to scan")
            return self

        # Scan agents
        agents_pkg = f"{self._project}.agents"
        try:
            importlib.import_module(agents_pkg)
            self.scan_agents(agents_pkg)
        except ImportError:
            logger.debug(f"bootstrap: no agents package at '{agents_pkg}'")

        # Scan tools
        tools_pkg = f"{self._project}.tools"
        try:
            importlib.import_module(tools_pkg)
            self.scan_tools(tools_pkg)
        except ImportError:
            logger.debug(f"bootstrap: no tools package at '{tools_pkg}'")

        # Scan routes — try common module/variable names
        route_module = f"{self._project}.app.api.router"
        try:
            mod = importlib.import_module(route_module)
            for var_name in ("router", "api_router", "api"):
                router_obj = getattr(mod, var_name, None)
                if router_obj is not None:
                    self.app.include_router(router_obj)
                    logger.info(
                        f"bootstrap: registered router '{route_module}:{var_name}'"
                    )
                    break
        except ImportError:
            logger.debug(
                f"bootstrap: no routes module at '{route_module}'"
            )

        return self
