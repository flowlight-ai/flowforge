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
from flowforge.core.canary import CanaryDeploymentConfig, CanaryDeploymentRegistry
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


# ── Public API Surface ─────────────────────────────────────────────
# Only declarative/config-driven interfaces are exposed to upper *Forge
# projects. Internal base classes (BaseTool, BaseAgent, StateQueryTool)
# are NOT exported — upper projects must use MCP/declarative config.
__all__ = [
    "FlowForgeSDK",
    "FlowForgePlugin",
    "PluginManifest",
    "tool",
    "set_tool_registry",
    "AgentRegistry",
    "ToolRegistry",
    "ConfigLoader",
    "EventBus",
    "ModelService",
    "get_model_service",
    "ModelCapability",
    "GuardrailRegistry",
    "GuardrailExecutor",
    "InputGuardrail",
    "OutputGuardrail",
    "CanaryDeploymentConfig",
    "CanaryDeploymentRegistry",
    "Handoff",
    "HandoffManager",
    # NOTE: BaseTool, BaseAgent, AgentInput, AgentOutput, DecoratedTool
    #       are intentionally NOT in __all__ — they are internal.
]

# ── V2 Registries ────────────────────────────────────────────────────

class WorkflowRegistry:
    """Registry for Workflow YAML definitions.

    Plugins register workflow definitions (name → YAML config dict)
    via ``register(name, config)``. The workflow engine can then
    discover and execute them.
    """

    def __init__(self) -> None:
        self._workflows: Dict[str, Dict[str, Any]] = {}

    def register(self, name: str, config: Dict[str, Any]) -> None:
        """Register a workflow definition.

        Args:
            name: Unique workflow identifier.
            config: Workflow YAML configuration dict.
        """
        if name in self._workflows:
            logger.warning(f"WorkflowRegistry: '{name}' already registered, overwriting")
        self._workflows[name] = config
        logger.info(f"WorkflowRegistry: registered workflow '{name}'")

    def get(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a workflow definition by name."""
        return self._workflows.get(name)

    def list_workflows(self) -> List[str]:
        """List all registered workflow names."""
        return list(self._workflows.keys())

    def get_all(self) -> Dict[str, Dict[str, Any]]:
        """Return all registered workflows."""
        return dict(self._workflows)


class GateRegistry:
    """Registry for gate / access-control configurations.

    Gates control whether a workflow step or agent execution is
    allowed to proceed based on runtime conditions.

    Delegates to :class:`flowforge.core.gate.registry.GateRegistry`
    for YAML auto-loading support while preserving the original
    dict-based ``register(name, config)`` interface.
    """

    def __init__(self, config_dir: str | None = None) -> None:
        from flowforge.core.gate.registry import GateRegistry as _CoreGateRegistry
        self._core = _CoreGateRegistry(config_dir=config_dir)

    def load_from_dir(self, dir_path: str | Path) -> int:
        """Load gate configurations from a directory of YAML files.

        Args:
            dir_path: Path to directory containing gate YAML files.

        Returns:
            Number of gates loaded.
        """
        return self._core.load_from_dir(dir_path)

    def register(self, name: str, config: Dict[str, Any]) -> None:
        """Register a gate configuration.

        Args:
            name: Unique gate identifier.
            config: Gate configuration dict.
        """
        if name in self._core._gates:
            logger.warning(f"GateRegistry: '{name}' already registered, overwriting")
        self._core.register(name, config)

    def get(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a gate configuration by name."""
        gate = self._core.get(name)
        if gate is None:
            return None
        # Return dict for backward compatibility
        return gate.model_dump()

    def list_gates(self) -> List[str]:
        """List all registered gate names."""
        return self._core.list_gates()

    def get_all(self) -> Dict[str, Dict[str, Any]]:
        """Return all registered gates."""
        return {k: v.model_dump() for k, v in self._core.get_all().items()}


class QualityGateRegistry:
    """Registry for quality gate configurations.

    Quality gates define pass/fail criteria that must be satisfied
    before a workflow can transition to the next phase.

    Internally delegates to :class:`GateRegistry` — quality gates
    are a specialised subset of gates with the same YAML schema.
    """

    def __init__(self, config_dir: str | None = None) -> None:
        from flowforge.core.gate.registry import GateRegistry as _CoreGateRegistry
        self._core = _CoreGateRegistry(config_dir=config_dir)

    def load_from_dir(self, dir_path: str | Path) -> int:
        """Load quality gate configurations from a directory of YAML files.

        Args:
            dir_path: Path to directory containing quality gate YAML files.

        Returns:
            Number of quality gates loaded.
        """
        return self._core.load_from_dir(dir_path)

    def register(self, name: str, config: Dict[str, Any]) -> None:
        """Register a quality gate configuration.

        Args:
            name: Unique quality gate identifier.
            config: Quality gate configuration dict.
        """
        if name in self._core._gates:
            logger.warning(f"QualityGateRegistry: '{name}' already registered, overwriting")
        self._core.register(name, config)

    def get(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a quality gate configuration by name."""
        gate = self._core.get(name)
        if gate is None:
            return None
        return gate.model_dump()

    def list_quality_gates(self) -> List[str]:
        """List all registered quality gate names."""
        return self._core.list_gates()

    def get_all(self) -> Dict[str, Dict[str, Any]]:
        """Return all registered quality gates."""
        return {k: v.model_dump() for k, v in self._core.get_all().items()}


class EvaluatorRegistry:
    """Registry for evaluator agents.

    Evaluators assess the quality or correctness of agent outputs,
    workflow results, or other artifacts.

    Delegates to :class:`flowforge.evaluators.registry.EvaluatorRegistry`
    for YAML auto-loading while preserving the original dict-based API.
    """

    def __init__(self) -> None:
        from flowforge.evaluators.registry import EvaluatorRegistry as _RealRegistry
        self._impl = _RealRegistry()

    def load_from_dir(self, dir_path: str) -> int:
        """Load evaluator configurations from a YAML directory."""
        return self._impl.load_from_dir(dir_path)

    def register(self, name: str, evaluator: Any) -> None:
        """Register an evaluator.

        Args:
            name: Unique evaluator identifier.
            evaluator: Evaluator instance, config dict, or EvaluatorConfig.
        """
        self._impl.register(name, evaluator)

    def get(self, name: str) -> Optional[Any]:
        """Get an evaluator by name."""
        return self._impl.get(name)

    def get_config(self, name: str) -> Optional[Any]:
        """Get an evaluator configuration by name."""
        return self._impl.get_config(name)

    def list_evaluators(self) -> List[str]:
        """List all registered evaluator names."""
        return self._impl.list_evaluators()

    def get_all_configs(self) -> Dict[str, Any]:
        """Return all registered evaluator configurations."""
        return self._impl.get_all_configs()


class SOPRegistry:
    """Registry for SOP (Standard Operating Procedure) definitions.

    SOPs define ordered sequences of steps that must be followed
    for a particular business process.
    """

    def __init__(self) -> None:
        self._sops: Dict[str, Dict[str, Any]] = {}

    def register(self, name: str, config: Dict[str, Any]) -> None:
        """Register an SOP definition.

        Args:
            name: Unique SOP identifier.
            config: SOP configuration dict.
        """
        if name in self._sops:
            logger.warning(f"SOPRegistry: '{name}' already registered, overwriting")
        self._sops[name] = config
        logger.info(f"SOPRegistry: registered SOP '{name}'")

    def get(self, name: str) -> Optional[Dict[str, Any]]:
        """Get an SOP definition by name."""
        return self._sops.get(name)

    def list_sops(self) -> List[str]:
        """List all registered SOP names."""
        return list(self._sops.keys())

    def get_all(self) -> Dict[str, Dict[str, Any]]:
        """Return all registered SOPs."""
        return dict(self._sops)


class ContextLayerRegistry:
    """Registry for context layers.

    Context layers provide additional contextual information
    (e.g., persona, domain knowledge) that agents can access
    during execution.
    """

    def __init__(self) -> None:
        self._layers: Dict[str, Any] = {}

    def register(self, name: str, layer: Any) -> None:
        """Register a context layer.

        Args:
            name: Unique context layer identifier.
            layer: Context layer instance or callable.
        """
        if name in self._layers:
            logger.warning(f"ContextLayerRegistry: '{name}' already registered, overwriting")
        self._layers[name] = layer
        logger.info(f"ContextLayerRegistry: registered context layer '{name}'")

    def get(self, name: str) -> Optional[Any]:
        """Get a context layer by name."""
        return self._layers.get(name)

    def list_layers(self) -> List[str]:
        """List all registered context layer names."""
        return list(self._layers.keys())


class WorkflowStepHandlerRegistry:
    """Registry for custom workflow step handlers.

    Step handlers define how specific workflow step types are
    executed, allowing plugins to extend the workflow engine
    with custom step logic.
    """

    def __init__(self) -> None:
        self._handlers: Dict[str, Any] = {}

    def register(self, step_type: str, handler: Any) -> None:
        """Register a step handler for a step type.

        Args:
            step_type: The step type identifier this handler processes.
            handler: Handler instance or callable.
        """
        if step_type in self._handlers:
            logger.warning(f"WorkflowStepHandlerRegistry: '{step_type}' already registered, overwriting")
        self._handlers[step_type] = handler
        logger.info(f"WorkflowStepHandlerRegistry: registered handler for step type '{step_type}'")

    def get(self, step_type: str) -> Optional[Any]:
        """Get a step handler by step type."""
        return self._handlers.get(step_type)

    def list_handlers(self) -> List[str]:
        """List all registered step type names."""
        return list(self._handlers.keys())


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

    _current_instance: ClassVar[Optional["FlowForgeSDK"]] = None

    def __init__(
        self,
        project: str = "",
        config_dir: Optional[Union[str, Path]] = None,
        namespace: Optional[str] = None,
    ) -> None:
        self._project: str = project
        self._namespace: Optional[str] = namespace or project or None
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

        # Register as current instance for shared access
        self.__class__._current_instance = self

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
        self._loop_executor: Optional[Any] = None
        self._event_bridge: Optional[Any] = None

        # Service containers for YAML-configured services (type: service)
        self._services: Dict[str, Any] = {}
        self._service_factories: Dict[str, Dict[str, Any]] = {}

        # V2 registries
        self._workflow_registry: Optional[WorkflowRegistry] = None
        self._gate_registry: Optional[GateRegistry] = None
        self._quality_gate_registry: Optional[QualityGateRegistry] = None
        self._evaluator_registry: Optional[EvaluatorRegistry] = None
        self._sop_registry: Optional[SOPRegistry] = None
        self._context_layer_registry: Optional[ContextLayerRegistry] = None
        self._step_handler_registry: Optional[WorkflowStepHandlerRegistry] = None
        self._canary_registry: Optional[CanaryDeploymentRegistry] = None

    # ── Lazy property accessors ─────────────────────────────────────

    @property
    def project(self) -> str:
        """The project package name, if set during initialization."""
        return self._project

    @property
    def namespace(self) -> Optional[str]:
        """The agent namespace prefix, derived from project name or explicitly set.

        When set, all agents registered via this SDK instance will be
        namespaced as ``{namespace}:{agent_name}``, e.g. ``contentforge:writer``.
        """
        return self._namespace

    @namespace.setter
    def namespace(self, value: Optional[str]) -> None:
        self._namespace = value

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
    def event_bridge(self) -> Any:
        """Access the EventBridge for cross-project event propagation.

        Lazily creates an :class:`~flowforge.events.bridge.EventBridge`
        bound to this SDK's :attr:`events` bus.
        """
        if self._event_bridge is None:
            from flowforge.events.bridge import EventBridge
            self._event_bridge = EventBridge(self.events)
        return self._event_bridge

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
    def loop_executor(self) -> Any:
        """Access the LoopExecutor for iterative execution with verification.

        Loop is NOT a mode — it is the "upper-level manager" of modes
        (design doc loop.md §5.3). The LoopExecutor wraps HybridExecutor
        and decides which mode to use for each iteration.

        Lazily creates a :class:`LoopExecutor` instance with default
        dependencies.  For full customization, create a LoopExecutor
        manually and set it via ``sdk.loop_executor = executor`` or
        pass it to the HybridExecutor.

        The recommended way to trigger Loop is via loop_config in
        TaskContext.metadata, which HybridExecutor detects and delegates
        to LoopExecutor directly (bypassing ModeRegistry).

        Example::

            # Recommended: use loop_config to trigger Loop
            ctx = TaskContext(
                task_id="loop-1",
                input_data={"task": "迭代优化文章"},
                metadata={"loop_config": {"name": "article_refine", "max_retries": 5}},
            )
            result = await hybrid.run(ctx)

            # Backward compat: mode_hint="loop" also works
            result = await hybrid.run(ctx, mode_hint="loop")
        """
        if self._loop_executor is None:
            from flowforge.loop.executor import LoopExecutor
            from flowforge.loop.planner import LLMPlanner
            from flowforge.loop.verifier import RuleBasedVerifier
            from flowforge.loop.reflector import ReflexionReflector
            from flowforge.harness.orchestrator import HarnessOrchestrator
            from flowforge.harness.entropy_manager import EntropyManager, RuleEvolution
            from flowforge.core.checkpoint_manager import CheckpointManager

            # Create default dependencies for LoopExecutor
            harness = HarnessOrchestrator()
            planner = LLMPlanner()
            verifier = RuleBasedVerifier()
            # Inject LLM client so Reflector can perform LLM-based reflection
            # (falls back to rule-based logic if llm_client is None or call fails)
            reflector = ReflexionReflector(llm_client=self.llm)
            checkpoint_mgr = CheckpointManager("data/loop_checkpoints.db")
            entropy_mgr = EntropyManager()
            rule_evolution = RuleEvolution()

            # Try to get HybridExecutor from FlowForge main module
            hybrid_executor = None
            try:
                from flowforge.app import main as _main
                hybrid_executor = getattr(_main, "_executor_instance", None)
            except ImportError:
                pass

            # Try to get PersonaLock from FlowForge main module
            persona_lock = None
            try:
                from flowforge.app import main as _main
                persona_lock = _main.get_persona_lock()
            except (ImportError, AttributeError):
                pass

            if hybrid_executor is not None:
                self._loop_executor = LoopExecutor(
                    hybrid_executor=hybrid_executor,
                    harness=harness,
                    planner=planner,
                    verifier=verifier,
                    reflector=reflector,
                    checkpoint_mgr=checkpoint_mgr,
                    entropy_mgr=entropy_mgr,
                    rule_evolution=rule_evolution,
                    persona_lock=persona_lock,
                )
                # Also inject into HybridExecutor
                if hasattr(hybrid_executor, 'set_loop_executor'):
                    hybrid_executor.set_loop_executor(self._loop_executor)
                logger.info("SDK initialized LoopExecutor with HybridExecutor")
            else:
                # Store dependencies for later initialization
                self._loop_harness = harness
                self._loop_planner = planner
                self._loop_verifier = verifier
                self._loop_reflector = reflector
                self._loop_checkpoint_mgr = checkpoint_mgr
                self._loop_entropy_mgr = entropy_mgr
                self._loop_rule_evolution = rule_evolution
                self._loop_executor_pending = True
        return self._loop_executor

    @loop_executor.setter
    def loop_executor(self, value: Any) -> None:
        """Set the LoopExecutor instance directly."""
        self._loop_executor = value
        self._loop_executor_pending = False

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

    # ── V2 Registry property accessors ──────────────────────────────

    @property
    def workflows(self) -> WorkflowRegistry:
        """Access the WorkflowRegistry for workflow YAML management."""
        if self._workflow_registry is None:
            self._workflow_registry = WorkflowRegistry()
        return self._workflow_registry

    @property
    def gates(self) -> GateRegistry:
        """Access the GateRegistry for gate/access-control management."""
        if self._gate_registry is None:
            self._gate_registry = GateRegistry()
            # Auto-load from project config/gates/ directory
            self._auto_load_gates(self._gate_registry)
        return self._gate_registry

    @property
    def quality_gates(self) -> QualityGateRegistry:
        """Access the QualityGateRegistry for quality gate management."""
        if self._quality_gate_registry is None:
            self._quality_gate_registry = QualityGateRegistry()
            # Auto-load from project config/quality_gates/ directory
            self._auto_load_gates(self._quality_gate_registry, subdir="quality_gates")
        return self._quality_gate_registry

    @property
    def evaluators(self) -> EvaluatorRegistry:
        """Access the EvaluatorRegistry for evaluator agent management."""
        if self._evaluator_registry is None:
            self._evaluator_registry = EvaluatorRegistry()
            # Auto-load evaluator YAML configs from flowforge and project dirs
            self._auto_load_evaluator_configs()
        return self._evaluator_registry

    def _auto_load_evaluator_configs(self) -> None:
        """Auto-load evaluator YAML configs from standard directories."""
        # 1. FlowForge built-in evaluator configs
        flowforge_config_dir = Path(__file__).parent / "config" / "evaluators"
        if flowforge_config_dir.is_dir():
            self._evaluator_registry.load_from_dir(str(flowforge_config_dir))

        # 2. Project-specific evaluator configs
        if self._config_dir is not None:
            project_eval_dir = self._config_dir / "evaluators"
            if project_eval_dir.is_dir():
                self._evaluator_registry.load_from_dir(str(project_eval_dir))

    @property
    def sops(self) -> SOPRegistry:
        """Access the SOPRegistry for SOP definition management."""
        if self._sop_registry is None:
            self._sop_registry = SOPRegistry()
        return self._sop_registry

    @property
    def context_layers(self) -> ContextLayerRegistry:
        """Access the ContextLayerRegistry for context layer management."""
        if self._context_layer_registry is None:
            self._context_layer_registry = ContextLayerRegistry()
        return self._context_layer_registry

    @property
    def step_handlers(self) -> WorkflowStepHandlerRegistry:
        """Access the WorkflowStepHandlerRegistry for custom step handler management."""
        if self._step_handler_registry is None:
            self._step_handler_registry = WorkflowStepHandlerRegistry()
        return self._step_handler_registry

    @property
    def canary(self) -> CanaryDeploymentRegistry:
        """Access the CanaryDeploymentRegistry for canary deployment management.

        Lazily creates a :class:`CanaryDeploymentRegistry` and auto-loads
        canary deployment configurations from standard directories.

        Search order:
        1. Project-specific ``{project}/config/canary/``
        2. Framework-level ``flowforge/config/canary/``

        Example::

            # List all canary deployment configs
            deployments = sdk.canary.list_deployments()

            # Get a specific config
            config = sdk.canary.get("production")

            # Create a canary deployment from config
            deployment = sdk.create_canary_deployment("production")
        """
        if self._canary_registry is None:
            self._canary_registry = CanaryDeploymentRegistry()
            self._auto_load_canary_configs()
        return self._canary_registry

    # ── Gate auto-loading helper ──────────────────────────────────────

    def _auto_load_gates(self, registry: GateRegistry | QualityGateRegistry, subdir: str = "gates") -> None:
        """Auto-load gate YAML configs from framework and project config dirs.

        Searches in order (project-level overrides framework-level):
        1. Framework-level ``flowforge/config/{subdir}/``
        2. Project-specific ``{project}/config/{subdir}/``
        """
        search_paths: list[Path] = []

        # 1. Framework-level config dir (loaded first, can be overridden by project)
        framework_config = Path(__file__).parent / "config" / subdir
        search_paths.append(framework_config)

        # 2. Project config dir (loaded second, overrides framework)
        if self._config_dir is not None:
            search_paths.append(self._config_dir / subdir)

        for p in search_paths:
            if p.is_dir():
                try:
                    count = registry.load_from_dir(p)
                    if count > 0:
                        logger.info(f"SDK auto-loaded {count} gate(s) from '{p}'")
                except Exception as e:
                    logger.warning(f"SDK: failed to auto-load gates from '{p}': {e}")

    # ── Canary auto-loading helper ────────────────────────────────────

    def _auto_load_canary_configs(self) -> None:
        """Auto-load canary deployment YAML configs from standard directories.

        Searches in order:
        1. Project-specific ``{project}/config/canary/``
        2. Framework-level ``flowforge/config/canary/``
        """
        search_paths: list[Path] = []

        # 1. Project config dir
        if self._config_dir is not None:
            search_paths.append(self._config_dir / "canary")

        # 2. Framework-level config dir
        framework_config = Path(__file__).parent / "config" / "canary"
        search_paths.append(framework_config)

        for p in search_paths:
            if p.is_dir():
                try:
                    count = self._canary_registry.load_from_dir(p)
                    if count > 0:
                        logger.info(f"SDK auto-loaded {count} canary config(s) from '{p}'")
                except Exception as e:
                    logger.warning(f"SDK: failed to auto-load canary configs from '{p}': {e}")

    def create_canary_deployment(
        self,
        name: str,
        *,
        config_overrides: Optional[Dict[str, Any]] = None,
    ) -> tuple[Any, Any]:
        """Create a canary deployment from a registered configuration.

        Looks up the canary deployment config by name from the registry,
        then creates a :class:`CanaryManager` and :class:`AutoRollbackManager`
        configured according to the deployment config.

        Args:
            name: Name of the canary deployment config (as registered in YAML).
            config_overrides: Optional dict of config overrides applied to
                the loaded :class:`CanaryDeploymentConfig`.

        Returns:
            A tuple of ``(CanaryManager, AutoRollbackManager, CanaryState)``
            ready for execution.

        Raises:
            KeyError: If no config with the given name is registered.

        Example::

            manager, rollback, state = sdk.create_canary_deployment("production")
            result = await manager.run_full_canary(state)
        """
        from flowforge.tools.canary_manager import CanaryManager, CanaryConfig, CanaryState
        from flowforge.tools.auto_rollback import AutoRollbackManager, RollbackPolicy

        config = self.canary.get(name)
        if config is None:
            raise KeyError(f"Canary deployment config '{name}' not found. "
                           f"Available: {self.canary.list_deployments()}")

        # Apply overrides
        if config_overrides:
            config_data = config.model_dump()
            config_data.update(config_overrides)
            config = CanaryDeploymentConfig(**config_data)

        # Create CanaryManager from config
        canary_config = CanaryConfig(
            max_error_rate=config.rollback_on_error_rate,
            max_latency_multiplier=config.rollback_on_latency_multiplier,
            observation_seconds=config.observation_seconds,
            auto_rollback_enabled=config.auto_rollback,
        )
        canary_manager = CanaryManager(config=canary_config)

        # Create AutoRollbackManager from config
        rollback_policy = RollbackPolicy(
            max_error_rate=config.rollback_on_error_rate,
            max_latency_multiplier=config.rollback_on_latency_multiplier,
            observation_window_seconds=config.observation_seconds,
            auto_rollback_enabled=config.auto_rollback,
        )
        rollback_manager = AutoRollbackManager(policy=rollback_policy)

        # Create initial CanaryState
        state = CanaryState(
            task_id=f"canary-{name}",
            observation_seconds=config.observation_seconds,
        )

        logger.info(
            f"SDK created canary deployment '{name}': "
            f"stages={len(config.stages)}, auto_rollback={config.auto_rollback}"
        )
        return canary_manager, rollback_manager, state

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
        namespace: Optional[str] = None,
    ) -> Callable:
        """Decorator to register a function as a FlowForge agent.

        The decorated function is wrapped in a DecoratedAgent and
        auto-registered with the SDK's AgentRegistry.

        If a namespace is available (from SDK init or explicit argument),
        the agent is registered as ``{namespace}:{name}``.

        Args:
            name: Unique agent identifier.
            description: Human-readable description.
            namespace: Optional namespace override. If not provided,
                uses the SDK's default namespace.

        Returns:
            A DecoratedAgent instance.

        Example::

            @sdk.agent(name="writer", description="Content writer agent")
            async def writer(task: str, style: str = "formal") -> dict:
                return {"content": "..."}
        """
        effective_namespace = namespace or self._namespace
        full_name = f"{effective_namespace}:{name}" if effective_namespace else name

        def decorator(func: Callable) -> DecoratedAgent:
            wrapped = DecoratedAgent(
                func=func,
                name=full_name,
                description=description or inspect.getdoc(func) or "",
            )
            self.agents.register(wrapped)
            logger.info(f"SDK auto-registered agent: {full_name}")
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

    # ── Loop template creation ───────────────────────────────────────

    def create_loop_template(self, name: str, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create a Loop configuration template.

        Generates a loop configuration dict that can be used with
        ``TaskContext(metadata={"loop_config": ...})`` or registered
        with the LoopRegistry.

        Args:
            name: Unique template name for the loop.
            config: Optional configuration overrides.  Supported keys:
                ``max_retries`` (int, default 3), ``worker`` (dict with
                ``mode`` key, default ``{"mode": "workflow"}``),
                ``backoff_strategy`` (str, default ``"exponential"``),
                ``backoff_base`` (int, default 2),
                ``planner`` (dict, planner config),
                ``verifier`` (dict, verifier config).

        Returns:
            A loop configuration dictionary ready for use.

        Example::

            loop_config = sdk.create_loop_template(
                name="article_refine",
                config={"max_retries": 5, "worker": {"mode": "reflexion"}},
            )
            ctx = TaskContext(
                task_id="refine-1",
                input_data={"task": "迭代优化文章"},
                metadata={"loop_config": loop_config},
            )
        """
        template: Dict[str, Any] = {
            "name": name,
            "max_retries": 3,
            "worker": {"mode": "workflow"},
            "backoff_strategy": "exponential",
            "backoff_base": 2,
        }
        if config:
            template.update(config)
        logger.info(f"SDK created loop template: {name}")
        return template

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

    def scan_agents(self, package: str, *, naming: str = "snake_case", namespace: Optional[str] = None) -> int:
        """Auto-discover and register all BaseAgent subclasses in a package.

        Iterates all modules in *package*, finds classes that inherit
        from :class:`BaseAgent` (excluding ``BaseAgent`` itself), and
        registers them with the SDK's :class:`AgentRegistry` via
        ``register_factory(name, cls)``.

        If a namespace is available (from SDK init or explicit argument),
        agents are registered as ``{namespace}:{name}``.

        Args:
            package: Dotted package path, e.g. ``"contentforge.agents"``.
            naming: Naming convention for the registration key.
                ``snake_case`` strips the ``Agent`` suffix and converts
                CamelCase to snake_case.
            namespace: Optional namespace override. If not provided,
                uses the SDK's default namespace.

        Returns:
            Number of agents registered.

        Example::

            count = sdk.scan_agents("contentforge.agents")
            print(f"Registered {count} agents")
        """
        effective_namespace = namespace or self._namespace
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
                    full_name = f"{effective_namespace}:{reg_name}" if effective_namespace else reg_name
                    try:
                        self.agents.register_factory(full_name, obj)
                        count += 1
                        logger.info(
                            f"scan_agents: registered '{full_name}' "
                            f"from {obj.__module__}.{obj.__qualname__}"
                        )
                    except Exception as e:
                        logger.warning(
                            f"scan_agents: failed to register '{full_name}': {e}"
                        )

        logger.info(f"scan_agents: {count} agents discovered in '{package}'")
        return count

    def scan_agent_configs(self, config_dir: str, *, namespace: Optional[str] = None) -> int:
        """Auto-discover and register agents from YAML config files.

        Each YAML file in *config_dir* is loaded as an :class:`AgentConfig`
        and used to create a :class:`DeclarativeAgent`. This enables
        pure-configuration agent definitions without writing Python classes.

        Args:
            config_dir: Path to directory containing agent YAML files.
            namespace: Optional namespace override.

        Returns:
            Number of agents registered.

        Example::

            count = sdk.scan_agent_configs("contentforge/config/agents")
        """
        from flowforge.core.declarative_agent import DeclarativeAgent, AgentConfig

        effective_namespace = namespace or self._namespace
        count = 0
        config_path = Path(config_dir)
        if not config_path.is_dir():
            logger.warning(f"scan_agent_configs: '{config_dir}' is not a directory")
            return 0

        for yaml_file in sorted(config_path.glob("*.yaml")):
            try:
                agent = DeclarativeAgent.from_yaml(yaml_file)
                config = agent.config

                # Determine registration name
                reg_name = config.name
                if effective_namespace and ":" not in reg_name:
                    reg_name = f"{effective_namespace}:{reg_name}"

                # Also register with simplified name (without namespace prefix)
                self.agents.register_factory(reg_name, lambda cls=type(agent), cfg=config: DeclarativeAgent(config=cfg))
                count += 1
                logger.info(
                    f"scan_agent_configs: registered '{reg_name}' "
                    f"from {yaml_file.name} (mode={config.execution_mode})"
                )
            except Exception as e:
                logger.warning(
                    f"scan_agent_configs: failed to load '{yaml_file.name}': {e}"
                )

        logger.info(f"scan_agent_configs: {count} agents discovered in '{config_dir}'")
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

    def scan_tool_configs(self, config_dir: str) -> int:
        """Auto-discover and register tools from YAML config files.

        Each YAML file in *config_dir* defines a tool with metadata and
        an entry point.  Supported types:

        - ``local``: Instantiates a Python class from ``entry_point``
          (``module.path:ClassName`` format).  If the class is a
          :class:`BaseTool` subclass it is instantiated with no args;
          otherwise it is registered as a plain service object.
        - ``service``: Like ``local`` but the class is a business service
          (not a tool).  The class is imported and registered as a
          named service accessible via ``sdk.get_service(name)``.
          If ``lazy: true`` is set, the class is not instantiated at
          scan time — only the factory is registered for later use.
        - ``http`` / ``script`` / ``transform``: Delegated to
          :func:`load_declarative_tools_from_yaml`.

        Environment variable interpolation is supported in the ``config``
        section using the ``${ENV_VAR:default}`` syntax.

        Args:
            config_dir: Path to directory containing tool YAML files.

        Returns:
            Number of tools/services registered.

        Example::

            count = sdk.scan_tool_configs("contentforge/config/tools")
        """
        import yaml as _yaml

        count = 0
        config_path = Path(config_dir)
        if not config_path.is_dir():
            logger.warning(f"scan_tool_configs: '{config_dir}' is not a directory")
            return 0

        for yaml_file in sorted(config_path.glob("*.yaml")):
            try:
                with open(yaml_file, "r", encoding="utf-8") as f:
                    data = _yaml.safe_load(f) or {}

                tool_type = data.get("type", "local")
                tool_name = data.get("name", yaml_file.stem)

                if tool_type == "service":
                    # Service type — register as named service, not as tool
                    entry_point = data.get("entry_point", "")
                    if not entry_point or ":" not in entry_point:
                        logger.warning(
                            f"scan_tool_configs: '{yaml_file.name}' missing "
                            f"or invalid entry_point, skipping"
                        )
                        continue

                    module_path, class_name = entry_point.rsplit(":", 1)
                    try:
                        mod = importlib.import_module(module_path)
                    except ImportError as e:
                        logger.warning(
                            f"scan_tool_configs: failed to import module "
                            f"'{module_path}' for service '{tool_name}': {e}"
                        )
                        continue

                    service_cls = getattr(mod, class_name, None)
                    if service_cls is None:
                        logger.warning(
                            f"scan_tool_configs: class '{class_name}' not "
                            f"found in '{module_path}', skipping"
                        )
                        continue

                    is_lazy = data.get("lazy", False)

                    if is_lazy:
                        # Register factory only — don't instantiate
                        self._service_factories[tool_name] = {
                            "cls": service_cls,
                            "config": data.get("config", {}),
                            "entry_point": entry_point,
                        }
                        count += 1
                        logger.info(
                            f"scan_tool_configs: registered lazy service "
                            f"factory '{tool_name}' from {entry_point}"
                        )
                    else:
                        # Eagerly instantiate
                        tool_config = data.get("config", {})
                        resolved_config = self._resolve_env_vars(tool_config)
                        try:
                            instance = service_cls(**resolved_config)
                        except TypeError:
                            instance = service_cls()
                        self._services[tool_name] = instance
                        count += 1
                        logger.info(
                            f"scan_tool_configs: registered service "
                            f"'{tool_name}' from {entry_point}"
                        )

                elif tool_type == "local":
                    entry_point = data.get("entry_point", "")
                    if not entry_point or ":" not in entry_point:
                        logger.warning(
                            f"scan_tool_configs: '{yaml_file.name}' missing "
                            f"or invalid entry_point, skipping"
                        )
                        continue

                    module_path, class_name = entry_point.rsplit(":", 1)
                    try:
                        mod = importlib.import_module(module_path)
                    except ImportError as e:
                        logger.warning(
                            f"scan_tool_configs: failed to import module "
                            f"'{module_path}' for tool '{tool_name}': {e}"
                        )
                        continue

                    tool_cls = getattr(mod, class_name, None)
                    if tool_cls is None:
                        logger.warning(
                            f"scan_tool_configs: class '{class_name}' not "
                            f"found in '{module_path}', skipping"
                        )
                        continue

                    # Resolve config section with env var interpolation
                    tool_config = data.get("config", {})
                    resolved_config = self._resolve_env_vars(tool_config)

                    # Instantiate — BaseTool subclasses need no args;
                    # other classes receive resolved config as kwargs
                    if isinstance(tool_cls, type) and issubclass(tool_cls, BaseTool):
                        try:
                            tool_instance = tool_cls()
                        except TypeError:
                            tool_instance = tool_cls(**resolved_config)
                        self.tools.register(tool_instance)
                        count += 1
                        logger.info(
                            f"scan_tool_configs: registered local tool "
                            f"'{tool_name}' from {entry_point}"
                        )
                    else:
                        # Non-BaseTool local tool — register as service
                        try:
                            instance = tool_cls(**resolved_config)
                        except TypeError:
                            instance = tool_cls()
                        self.tools.register(instance)
                        count += 1
                        logger.info(
                            f"scan_tool_configs: registered local service "
                            f"'{tool_name}' from {entry_point}"
                        )

                else:
                    # Declarative tool types (http/script/transform)
                    from flowforge.core.declarative_tool import (
                        load_declarative_tools_from_yaml,
                    )
                    tools = load_declarative_tools_from_yaml(yaml_file)
                    for t in tools:
                        try:
                            self.tools.register(t)
                            count += 1
                        except ValueError:
                            pass
                    logger.info(
                        f"scan_tool_configs: loaded {len(tools)} declarative "
                        f"tool(s) from '{yaml_file.name}'"
                    )

            except Exception as e:
                logger.warning(
                    f"scan_tool_configs: failed to load '{yaml_file.name}': {e}"
                )

        logger.info(
            f"scan_tool_configs: {count} tool(s)/service(s) discovered in '{config_dir}'"
        )
        return count

    @staticmethod
    def _resolve_env_vars(config: dict) -> dict:
        """Resolve ``${ENV_VAR:default}`` placeholders in config values.

        Only string values are processed; nested dicts are recursed.
        """
        resolved: dict = {}
        for key, value in config.items():
            if isinstance(value, str) and value.startswith("${") and value.endswith("}"):
                inner = value[2:-1]
                if ":" in inner:
                    env_key, default = inner.split(":", 1)
                else:
                    env_key, default = inner, ""
                resolved[key] = os.environ.get(env_key, default)
            elif isinstance(value, dict):
                resolved[key] = FlowForgeSDK._resolve_env_vars(value)
            else:
                resolved[key] = value
        return resolved

    def get_service(self, name: str) -> Optional[Any]:
        """Get a named service registered via ``scan_tool_configs``.

        Services are registered from YAML configs with ``type: service``.
        For lazy services (``lazy: true``), the first call to
        ``get_service`` triggers instantiation.

        Args:
            name: Service name as defined in the YAML config.

        Returns:
            The service instance, or ``None`` if not found.
        """
        # Check eagerly instantiated services first
        if name in self._services:
            return self._services[name]

        # Check lazy factories — instantiate on first access
        if name in self._service_factories:
            factory = self._service_factories[name]
            service_cls = factory["cls"]
            config = factory.get("config", {})
            resolved_config = self._resolve_env_vars(config)
            try:
                instance = service_cls(**resolved_config)
            except TypeError:
                instance = service_cls()
            self._services[name] = instance
            del self._service_factories[name]
            logger.info(f"get_service: lazy-instantiated service '{name}'")
            return instance

        return None

    def list_services(self) -> List[str]:
        """List all registered service names (including lazy factories)."""
        return list(set(list(self._services.keys()) + list(self._service_factories.keys())))

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

    @staticmethod
    def _scan_yaml_dir(dir_path: str, registry: Any, item_type: str) -> int:
        """Scan a directory for YAML files and register them with a registry.

        Each YAML file is loaded and registered using the filename stem
        (without extension) as the registration name.

        Args:
            dir_path: Path to the directory containing YAML files.
            registry: Registry object with a ``register(name, config)`` method.
            item_type: Type label for logging (e.g. "workflow", "sop").

        Returns:
            Number of items registered.
        """
        import yaml as _yaml

        count = 0
        p = Path(dir_path)
        if not p.is_dir():
            # Try resolving relative to workspace root
            workspace_root = Path(__file__).parent.parent
            p = workspace_root / dir_path
        if not p.is_dir():
            logger.debug(f"_scan_yaml_dir: directory '{dir_path}' not found, skipping {item_type} scan")
            return 0

        for yaml_file in sorted(p.glob("*.y*ml")):
            try:
                with open(yaml_file, "r", encoding="utf-8") as f:
                    data = _yaml.safe_load(f) or {}
                item_name = yaml_file.stem
                registry.register(item_name, data)
                count += 1
                logger.info(f"_scan_yaml_dir: registered {item_type} '{item_name}' from {yaml_file}")
            except Exception as e:
                logger.warning(f"_scan_yaml_dir: failed to load {item_type} from {yaml_file}: {e}")

        logger.info(f"_scan_yaml_dir: {count} {item_type}(s) discovered in '{dir_path}'")
        return count

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
        namespace: Optional[str] = None,
        workflows_dir: Optional[str] = None,
        sops_dir: Optional[str] = None,
        personas_dir: Optional[str] = None,
        prompts_dir: Optional[str] = None,
        tools_dir: Optional[str] = None,
        agents_dir: Optional[str] = None,
        gates_dir: Optional[str] = None,
        evaluators_dir: Optional[str] = None,
        quality_gates_dir: Optional[str] = None,
        context_layers_dir: Optional[str] = None,
        loops_dir: Optional[str] = None,
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
            namespace: Agent namespace prefix. If provided, agents are registered
                as ``{namespace}:{agent_name}``. Defaults to the SDK's namespace.
            workflows_dir: Directory to scan for workflow YAML files.
            sops_dir: Directory to scan for SOP YAML files.
            personas_dir: Directory to scan for persona YAML files.
            prompts_dir: Directory to scan for prompts YAML files.
            tools_dir: Directory to scan for declarative Tool YAML files.
            agents_dir: Directory to scan for declarative Agent YAML files.
            gates_dir: Directory to scan for gate YAML files.
            evaluators_dir: Directory to scan for evaluator YAML files.
            quality_gates_dir: Directory to scan for quality gate YAML files.
            context_layers_dir: Directory to scan for context layer YAML files.
            loops_dir: Directory to scan for loop YAML files.

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
                workflows_dir="contentforge/config/workflows",
                sops_dir="contentforge/config/sops",
                personas_dir="contentforge/config/persona",
            )
        """
        sdk_ref = self
        _agents_package = agents_package
        _tools_package = tools_package
        _routes = routes or []
        _event_handlers = event_handlers or {}
        _health_check_fn = health_check_fn
        _extra_tools = extra_tools or []
        _namespace = namespace or self._namespace
        _workflows_dir = workflows_dir
        _sops_dir = sops_dir
        _personas_dir = personas_dir
        _prompts_dir = prompts_dir
        _tools_dir = tools_dir
        _agents_dir = agents_dir
        _gates_dir = gates_dir
        _evaluators_dir = evaluators_dir
        _quality_gates_dir = quality_gates_dir
        _context_layers_dir = context_layers_dir
        _loops_dir = loops_dir

        class AutoPlugin(FlowForgePlugin):
            manifest = PluginManifest(
                name=name,
                version=version,
                description=description,
                priority=priority,
            )

            def register_agents(self, agent_registry: Any) -> None:
                if _agents_package:
                    sdk_ref.scan_agents(_agents_package, namespace=_namespace)
                # Register agents from YAML config directory
                if _agents_dir:
                    sdk_ref.scan_agent_configs(_agents_dir, namespace=_namespace)

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
                # Register tools from YAML config directory
                if _tools_dir:
                    sdk_ref.scan_tool_configs(_tools_dir)

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

            # ── V2 钩子：自动扫描 YAML 目录并注册 ─────────────────

            def register_workflows(self, workflow_registry: Any) -> None:
                if _workflows_dir:
                    sdk_ref._scan_yaml_dir(_workflows_dir, workflow_registry, "workflow")

            def register_sops(self, sop_registry: Any) -> None:
                if _sops_dir:
                    sdk_ref._scan_yaml_dir(_sops_dir, sop_registry, "sop")

            def register_personas(self, persona_registry: Any) -> None:
                if _personas_dir:
                    sdk_ref._scan_yaml_dir(_personas_dir, persona_registry, "persona")

            def register_prompts(self, prompt_registry: Any) -> None:
                if _prompts_dir:
                    sdk_ref._scan_yaml_dir(_prompts_dir, prompt_registry, "prompt")

            def register_gates(self, gate_registry: Any) -> None:
                if _gates_dir:
                    sdk_ref._scan_yaml_dir(_gates_dir, gate_registry, "gate")

            def register_evaluators(self, evaluator_registry: Any) -> None:
                if _evaluators_dir:
                    sdk_ref._scan_yaml_dir(_evaluators_dir, evaluator_registry, "evaluator")

            def register_quality_gates(self, quality_gate_registry: Any) -> None:
                if _quality_gates_dir:
                    sdk_ref._scan_yaml_dir(_quality_gates_dir, quality_gate_registry, "quality_gate")

            def register_context_layers(self, context_registry: Any) -> None:
                if _context_layers_dir:
                    sdk_ref._scan_yaml_dir(_context_layers_dir, context_registry, "context_layer")

            def register_loops(self, loop_registry: Any) -> None:
                if _loops_dir:
                    sdk_ref._scan_yaml_dir(_loops_dir, loop_registry, "loop")

        return AutoPlugin()

    # ── Declarative Tool creation ────────────────────────────────────

    def declarative_tool(self, *, name: str, type: str = "http", **kwargs: Any) -> Any:
        """Declarative Tool definition convenience method.

        Creates a tool from a declarative configuration (e.g. HTTP tool,
        shell tool) without writing any Python code. The tool is
        automatically registered with the SDK's ToolRegistry.

        Args:
            name: Unique tool name.
            type: Tool type, e.g. ``"http"``, ``"shell"``, ``"python"``.
            **kwargs: Additional configuration passed to DeclarativeToolConfig.

        Returns:
            The created tool instance.

        Example::

            tool = sdk.declarative_tool(
                name="web_search",
                type="http",
                url="https://api.example.com/search",
                method="GET",
            )
        """
        from flowforge.core.declarative_tool import DeclarativeToolConfig, create_declarative_tool
        config = DeclarativeToolConfig(name=name, type=type, **kwargs)
        tool = create_declarative_tool(config)
        self.tools.register(tool)
        return tool

    # ── Convention-over-configuration bootstrap ──────────────────────

    def bootstrap(self) -> "FlowForgeSDK":
        """Convention-over-configuration auto-discovery.

        When ``project`` is set, automatically scans:

        - ``{project}.agents`` package for BaseAgent subclasses
        - ``{project}.tools`` package for BaseTool subclasses
        - ``{project}.app.api.router`` module for a FastAPI Router
          (tries common variable names: ``router``, ``api_router``)
        - Registers LoopModeExecutor as a convenience adapter (backward compat)
        - Initializes LoopExecutor and injects into HybridExecutor

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
            self.scan_agents(agents_pkg, namespace=self._namespace)
        except ImportError:
            logger.debug(f"bootstrap: no agents package at '{agents_pkg}'")

        # Scan tools
        tools_pkg = f"{self._project}.tools"
        try:
            importlib.import_module(tools_pkg)
            self.scan_tools(tools_pkg)
        except ImportError:
            logger.debug(f"bootstrap: no tools package at '{tools_pkg}'")

        # Load tools from plugins.yaml (if config_dir is set)
        if self._config_dir is not None:
            plugins_yaml = self._config_dir / "plugins.yaml"
            if plugins_yaml.exists():
                try:
                    import yaml as _yaml
                    with open(plugins_yaml, "r", encoding="utf-8") as _f:
                        _data = _yaml.safe_load(_f) or {}
                    _plugin_list = _data.get("plugins", [])
                    for _decl in _plugin_list:
                        _name = _decl.get("name", "")
                        _transport = _decl.get("transport", "local")
                        _entry = _decl.get("entry_point", "")
                        if _transport == "local" and _entry and not self.tools.has_tool(_name):
                            try:
                                _mod_path, _, _cls_name = _entry.rpartition(":")
                                _mod = importlib.import_module(_mod_path)
                                _cls = getattr(_mod, _cls_name, None)
                                if _cls is not None:
                                    _instance = _cls()
                                    self.tools.register(_instance)
                                    logger.info(f"bootstrap: registered tool '{_name}' from plugins.yaml ({_entry})")
                            except Exception as _e:
                                logger.debug(f"bootstrap: failed to load tool '{_name}' from {_entry}: {_e}")
                except Exception as e:
                    logger.warning(f"bootstrap: failed to load plugins.yaml: {e}")

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

        # Register LoopModeExecutor as a convenience adapter for backward compat
        # (Loop is NOT a mode — it's the upper-level manager of modes)
        self._register_loop_mode()

        # Initialize LoopExecutor and inject into HybridExecutor
        # (This is the primary way Loop is activated — via loop_config)
        self._init_loop_executor()

        # ── V2: Call plugin V2 hooks ─────────────────────────────────
        # Try to load the domain plugin and call V2 registration hooks
        self._call_v2_plugin_hooks()

        return self

    # ── Loop initialization helpers ──────────────────────────────────

    def _register_loop_mode(self) -> None:
        """Register LoopModeExecutor as a convenience adapter for backward compat.

        Loop is NOT a mode — it is the "upper-level manager" of modes
        (design doc loop.md §5.3). LoopModeExecutor is registered into
        ModeRegistry only as a backward-compatible adapter so that
        mode_hint="loop" still works when LoopExecutor is not available
        via HybridExecutor's loop orchestration path.

        The primary way to trigger Loop is via loop_config in
        TaskContext.metadata, which is handled by HybridExecutor directly
        (delegating to LoopExecutor), bypassing ModeRegistry entirely.
        """
        try:
            from flowforge.modes.loop_mode import LoopModeExecutor
            from flowforge.app import main as _main

            mode_registry = getattr(_main, "mode_registry", None)
            if mode_registry is not None:
                # Register as convenience adapter for mode_hint="loop" backward compat
                mode_registry.register(LoopModeExecutor())
                logger.info("SDK registered LoopModeExecutor as convenience adapter (Loop is not a mode)")
        except ImportError:
            logger.debug("SDK: LoopModeExecutor registration skipped — framework main not available")
        except Exception as e:
            logger.warning(f"SDK: LoopModeExecutor registration failed: {e}")

    def _init_loop_executor(self) -> None:
        """Initialize LoopExecutor and inject it into the HybridExecutor.

        Loop is NOT a mode — it is the "upper-level manager" of modes
        (design doc loop.md §5.3). The LoopExecutor wraps HybridExecutor
        and decides which mode to use for each iteration, dynamically
        switching based on verification results.

        Creates a LoopExecutor with default dependencies and injects it
        into the framework's HybridExecutor (if available).  This enables
        loop orchestration through the standard task pipeline when
        loop_config is present in TaskContext.metadata.
        """
        try:
            from flowforge.loop.executor import LoopExecutor
            from flowforge.loop.planner import LLMPlanner
            from flowforge.loop.verifier import RuleBasedVerifier
            from flowforge.loop.reflector import ReflexionReflector
            from flowforge.harness.orchestrator import HarnessOrchestrator
            from flowforge.harness.entropy_manager import EntropyManager, RuleEvolution
            from flowforge.core.checkpoint_manager import CheckpointManager
            from flowforge.app import main as _main

            hybrid_executor = getattr(_main, "_executor_instance", None)
            if hybrid_executor is None:
                logger.debug("SDK: LoopExecutor init skipped — HybridExecutor not available")
                return

            # Only create if not already set
            if hybrid_executor.loop_executor is not None:
                logger.debug("SDK: LoopExecutor already configured, skipping init")
                return

            harness = getattr(hybrid_executor, "harness", None) or HarnessOrchestrator()
            planner = LLMPlanner()
            verifier = RuleBasedVerifier()
            # Inject LLM client so Reflector can perform LLM-based reflection
            # (falls back to rule-based logic if llm_client is None or call fails)
            reflector = ReflexionReflector(llm_client=self.llm)
            checkpoint_mgr = getattr(
                hybrid_executor, "checkpoint_manager",
                CheckpointManager("data/loop_checkpoints.db"),
            )
            entropy_mgr = EntropyManager()
            rule_evolution = RuleEvolution()

            loop_exec = LoopExecutor(
                hybrid_executor=hybrid_executor,
                harness=harness,
                planner=planner,
                verifier=verifier,
                reflector=reflector,
                checkpoint_mgr=checkpoint_mgr,
                entropy_mgr=entropy_mgr,
                rule_evolution=rule_evolution,
            )

            hybrid_executor.set_loop_executor(loop_exec)
            self._loop_executor = loop_exec
            logger.info("SDK initialized LoopExecutor and injected into HybridExecutor")
        except ImportError:
            logger.debug("SDK: LoopExecutor init skipped — dependencies not available")
        except Exception as e:
            logger.warning(f"SDK: LoopExecutor init failed: {e}")

    # ── V2 Plugin hook helpers ───────────────────────────────────────

    def _call_v2_plugin_hooks(self) -> None:
        """Call V2 registration hooks on the domain plugin (if loaded).

        Attempts to import the project's plugin module and call
        V2 hooks (register_workflows, register_gates, etc.) with
        the corresponding V2 registries.
        """
        if not self._project:
            return

        plugin_module_path = f"{self._project}.plugins"
        try:
            mod = importlib.import_module(plugin_module_path)
        except ImportError:
            logger.debug(f"SDK: V2 hooks skipped — plugin module '{plugin_module_path}' not found")
            return

        plugin_instance = getattr(mod, "plugin", None)
        if plugin_instance is None:
            logger.debug(f"SDK: V2 hooks skipped — no 'plugin' attribute in '{plugin_module_path}'")
            return

        # Call each V2 hook with the corresponding registry
        v2_hooks = [
            ("register_tools", self.tools),
            ("register_workflows", self.workflows),
            ("register_gates", self.gates),
            ("register_evaluators", self.evaluators),
            ("register_sops", self.sops),
            ("register_quality_gates", self.quality_gates),
            ("register_context_layers", self.context_layers),
            ("register_workflow_step_handler", self.step_handlers),
        ]

        for hook_name, registry in v2_hooks:
            hook_fn = getattr(plugin_instance, hook_name, None)
            if hook_fn is None:
                continue
            try:
                hook_fn(registry)
                logger.info(f"SDK: called V2 hook '{hook_name}' on plugin '{plugin_instance.name}'")
            except Exception as e:
                logger.warning(f"SDK: V2 hook '{hook_name}' failed on plugin '{plugin_instance.name}': {e}")
