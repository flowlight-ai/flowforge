import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from flowforge.core.config import system_config, ConfigLoader
from flowforge.core.agent_registry import AgentRegistry
from flowforge.core.plugin_registry import PluginRegistry
from flowforge.tools.registry import ToolRegistry
from flowforge.tools.llm_client import LLMClient
from flowforge.tools.llm.model_service import ModelService
from flowforge.llm.router import LLMRouter
from flowforge.events.event_bus import EventBus
from flowforge.modes.registry import ModeRegistry
from flowforge.modes.workflow import WorkflowExecutor
from flowforge.modes.reflexion import ReflexionExecutor
from flowforge.modes.react import ReActExecutor
from flowforge.modes.plan_execute import PlanExecuteExecutor
from flowforge.modes.multi_agent import MultiAgentExecutor
from flowforge.modes.rewoo import ReWOOExecutor
from flowforge.modes.self_discover import SelfDiscoverExecutor
from flowforge.modes.agent_judge import AgentJudgeExecutor
from flowforge.modes.graph_of_thoughts import GraphOfThoughtsExecutor
from flowforge.executor.hybrid_executor import HybridExecutor
from flowforge.memory.manager import MemoryManager
from flowforge.app.api.router import router
from flowforge.app.deps import (
    set_executor_instance, set_llm_client_instance,
    set_model_service_instance,
    set_scheduler_instance, set_plugin_manager_instance,
    set_tool_chain_executor_instance,
    set_plugin_registry_instance,
    set_event_store_instance,
)
from flowforge.core import metrics
from flowforge.scheduler.scheduler import TaskScheduler
from flowforge.core.plugin_protocol import FlowForgePlugin, PluginState
from flowforge.core.plugin_manager import PluginManager
from flowforge.core.plugin_lifecycle import PluginLifecycleManager
from flowforge.core.tracing import get_logger, load_logging_config
from flowforge.core.persona_lock import PersonaLock

load_logging_config()
logger = get_logger("main")


def _register_core_tools(tool_registry: ToolRegistry, plugin_registry: PluginRegistry):
    from flowforge.tools.python_executor import PythonExecutorTool
    from flowforge.tools.file_rw import FileReadWriteTool
    from flowforge.tools.cache import CacheTool
    from flowforge.tools.workspace_file import WorkspaceFileTool

    tool_registry.register(PythonExecutorTool())
    tool_registry.register(FileReadWriteTool())
    tool_registry.register(CacheTool())
    tool_registry.register(WorkspaceFileTool())

    try:
        from flowforge.tools.web_search import WebSearchTool
        tool_registry.register(WebSearchTool())
    except ImportError:
        logger.debug("WebSearchTool not available")

    import os as _os
    _optional = []
    for mod_name, cls_name, env_key in [
        ("flowforge.tools.tavily_search", "TavilySearchTool", "TAVILY_API_KEY"),
        ("flowforge.tools.duckduckgo_search", "DuckDuckGoSearchTool", None),
        ("flowforge.tools.web_scraper", "WebScraperTool", None),
        # ContentForge domain tools — use contentforge.tools.xxx directly
        ("flowforge.tools.sendgrid_mail", "SendGridMailTool", "SENDGRID_API_KEY"),
        ("flowforge.tools.local_publish", "LocalPublishTool", None),
        ("flowforge.tools.opensieve_client", "OpenSieveClient", None),
        ("flowforge.tools.git_tool", "GitTool", None),
        ("flowforge.tools.linter_tool", "LinterTool", None),
        ("flowforge.tools.test_runner", "TestRunnerTool", None),
        ("flowforge.tools.code_search", "CodeSearchTool", None),
        ("flowforge.tools.translation_tool", "TranslationTool", None),
    ]:
        try:
            mod = __import__(mod_name, fromlist=[cls_name])
            _optional.append((getattr(mod, cls_name), env_key))
        except ImportError:
            pass
    for _tool_cls, _env_key in _optional:
        try:
            if _env_key is None or _os.getenv(_env_key, ""):
                tool_registry.register(_tool_cls())
        except Exception:
            pass


def _register_core_agents(agent_registry: AgentRegistry):
    from flowforge.agents.generic import GENERIC_AGENTS
    for agent_cls in GENERIC_AGENTS:
        try:
            name = getattr(agent_cls, "name", None) or agent_cls.__name__.replace("Agent", "").lower()
            agent_registry.register_factory(name, agent_cls)
        except Exception as e:
            logger.debug(f"Skip agent {agent_cls.__name__}: {e}")


def _register_all_modes(mode_registry: ModeRegistry):
    for executor_cls in [
        WorkflowExecutor, ReflexionExecutor, ReActExecutor,
        PlanExecuteExecutor, MultiAgentExecutor, ReWOOExecutor,
        SelfDiscoverExecutor, AgentJudgeExecutor, GraphOfThoughtsExecutor,
    ]:
        mode_registry.register(executor_cls())


def _topological_sort_plugins(plugins: list) -> list:
    """Sort plugins by dependencies using Kahn's algorithm.

    If A depends on B, B is loaded before A.
    Falls back to priority-based sort on circular dependency.
    """
    name_to_plugin = {p.name: p for p in plugins}
    dep_graph = {p.name: set(p.manifest.dependencies) & set(name_to_plugin) for p in plugins}

    # In-degree: number of *available* dependencies each plugin has
    in_degree = {name: len(deps) for name, deps in dep_graph.items()}

    # Build reverse adjacency: dep -> list of plugins that depend on it
    reverse_adj: dict[str, list[str]] = {name: [] for name in name_to_plugin}
    for name, deps in dep_graph.items():
        for dep in deps:
            if dep in reverse_adj:
                reverse_adj[dep].append(name)

    queue = [name for name, deg in in_degree.items() if deg == 0]
    result: list[str] = []

    while queue:
        name = queue.pop(0)
        result.append(name)
        for dependent in reverse_adj.get(name, []):
            in_degree[dependent] -= 1
            if in_degree[dependent] == 0:
                queue.append(dependent)

    if len(result) != len(plugins):
        logger.error("Circular dependency detected among plugins")
        return sorted(plugins, key=lambda p: p.manifest.priority)

    return [name_to_plugin[name] for name in result]


def _check_version_compatibility(plugins: list) -> list:
    """Remove plugins incompatible with the current framework version.

    Returns the filtered list of plugins.
    """
    try:
        from flowforge import __version__ as framework_version
    except ImportError:
        framework_version = "0.1.0"

    compatible: list = []
    for plugin in plugins:
        manifest = plugin.manifest
        if manifest.min_framework_version:
            if framework_version < manifest.min_framework_version:
                logger.error(
                    f"[{plugin.name}] Requires framework >= {manifest.min_framework_version}, "
                    f"current: {framework_version}"
                )
                continue
        if manifest.max_framework_version:
            if framework_version > manifest.max_framework_version:
                logger.warning(
                    f"[{plugin.name}] Designed for framework <= {manifest.max_framework_version}, "
                    f"current: {framework_version}. May have compatibility issues."
                )
        compatible.append(plugin)
    return compatible


def _load_domain_plugins(
    agent_registry: AgentRegistry,
    tool_registry: ToolRegistry,
    mode_registry: ModeRegistry | None = None,
    event_bus: EventBus | None = None,
    scheduler: TaskScheduler | None = None,
    app: FastAPI | None = None,
):
    """Load domain plugins from FLOWFORGE_DOMAIN_MODULE.

    Supports two plugin styles:

    1. **Protocol-based** (preferred): the module defines a ``Plugin`` class
       that inherits from :class:`FlowForgePlugin`.  The framework
       instantiates it and calls lifecycle methods in order.

    2. **Function-based** (legacy): the module exposes top-level
       ``register_agents`` / ``register_tools`` functions.  This is kept for
       backward compatibility.
    """
    import importlib
    import os

    domain_module = os.getenv("FLOWFORGE_DOMAIN_MODULE", "")
    if not domain_module:
        try:
            from flowforge.core.config import ConfigLoader
            cfg = ConfigLoader()
            raw = cfg.load_yaml("default.yaml")
            domain_module = raw.get("system", {}).get("domain_modules", "")
        except Exception:
            pass
    if not domain_module:
        return

    # Phase 1: Discover all plugins
    protocol_plugins: list[FlowForgePlugin] = []
    legacy_modules: list = []

    for mod_path in domain_module.split(","):
        mod_path = mod_path.strip()
        if not mod_path:
            continue
        try:
            mod = importlib.import_module(mod_path)
        except ImportError as e:
            logger.warning(f"Failed to load domain plugin {mod_path}: {e}")
            continue

        # Check for protocol-based plugin
        plugin_cls = getattr(mod, "Plugin", None)
        plugin_instance = None

        if plugin_cls is None:
            plugin_instance = getattr(mod, "plugin", None)
        elif isinstance(plugin_cls, type) and issubclass(plugin_cls, FlowForgePlugin):
            plugin_instance = plugin_cls()

        if isinstance(plugin_instance, FlowForgePlugin):
            protocol_plugins.append(plugin_instance)
            continue

        # Check for legacy function-based plugin
        if hasattr(mod, "register_agents") or hasattr(mod, "register_tools"):
            legacy_modules.append(mod)

    # Phase 2: Version compatibility check
    protocol_plugins = _check_version_compatibility(protocol_plugins)

    # Phase 2: Dependency resolution — remove plugins with missing required deps
    available_names = {p.name for p in protocol_plugins}
    plugins_with_deps: list[FlowForgePlugin] = []
    for plugin in protocol_plugins:
        missing_required = False
        for dep in plugin.manifest.dependencies:
            if dep not in available_names:
                logger.error(
                    f"[{plugin.name}] Missing required dependency: {dep}. "
                    f"Available plugins: {available_names}"
                )
                missing_required = True
                break
        if missing_required:
            continue
        for dep in plugin.manifest.optional_dependencies:
            if dep not in available_names:
                logger.warning(f"[{plugin.name}] Optional dependency not available: {dep}")
        plugins_with_deps.append(plugin)
    protocol_plugins = plugins_with_deps

    # Phase 2: Sort by dependencies (topological) then priority
    try:
        protocol_plugins = _topological_sort_plugins(protocol_plugins)
    except Exception as e:
        logger.warning(f"Dependency sort failed, falling back to priority sort: {e}")
        protocol_plugins.sort(key=lambda p: p.manifest.priority)

    # Phase 3: Register protocol plugins in order
    for plugin_instance in protocol_plugins:
        logger.info(
            f"Loading protocol plugin: {plugin_instance.name} "
            f"v{plugin_instance.version} (priority={plugin_instance.manifest.priority}) "
            f"from {plugin_instance.__class__.__module__}"
        )
        _load_single_plugin(
            plugin_instance, agent_registry, tool_registry,
            mode_registry, event_bus, scheduler, app,
        )

    # Notify all protocol plugins about each other (cross-plugin initialization)
    for plugin in _loaded_plugins:
        for other_plugin in _loaded_plugins:
            if other_plugin.name != plugin.name:
                try:
                    plugin.on_plugin_loaded(other_plugin.name)
                except Exception as e:
                    logger.warning(f"Plugin {plugin.name} on_plugin_loaded({other_plugin.name}) error: {e}")

    # Phase 4: Register legacy function-based plugins
    for mod in legacy_modules:
        if hasattr(mod, "register_agents"):
            mod.register_agents(agent_registry)
            logger.info(f"Registered agents from {mod.__name__} (legacy)")
        if hasattr(mod, "register_tools"):
            mod.register_tools(tool_registry)
            logger.info(f"Registered tools from {mod.__name__} (legacy)")


# Keep track of loaded protocol plugins for shutdown
_loaded_plugins: list[FlowForgePlugin] = []

# Plugin lifecycle manager — initialized after registries are created
lifecycle_manager: PluginLifecycleManager | None = None

# Phase 4: Sandbox manager and frontend registry
sandbox_manager = None
frontend_registry = None

# ── Auto-discover *forge plugins ──────────────────────────────────────

# Standard config sub-directories that auto_discover_plugins scans
_AUTO_DISCOVER_SUBDIRS = [
    "agents", "workflows", "tools", "personas", "prompts",
    "gates", "quality_gates", "evaluators", "context_layers", "loops", "sops",
]

# Default *forge project names to scan
_DEFAULT_FORGE_NAMES = ["contentforge", "devforge", "novelforge", "mallforge"]


def auto_discover_plugins(
    agent_registry: AgentRegistry,
    tool_registry: ToolRegistry,
    mode_registry: ModeRegistry | None = None,
    event_bus: EventBus | None = None,
    scheduler: TaskScheduler | None = None,
    app: FastAPI | None = None,
):
    """Auto-discover and load *forge plugins from sibling directories.

    Scans sibling *forge projects' config/ directories and creates
    AutoPlugin instances to register their declarative configurations.
    No Python plugin code is required in the *forge projects — only
    YAML configuration files in the standard sub-directories.

    Controlled by:
      - ``FLOWFORGE_AUTO_DISCOVER`` env var (default: ``true``)
      - ``FLOWFORGE_FORGE_DIRS`` env var (comma-separated custom dirs)
      - ``system.auto_discover`` in default.yaml
      - ``system.forge_dirs`` in default.yaml
    """
    import os
    from pathlib import Path

    # 1. Check if auto-discover is enabled
    env_flag = os.getenv("FLOWFORGE_AUTO_DISCOVER", "").lower()
    if env_flag in ("0", "false", "no", "off"):
        logger.info("auto_discover_plugins: disabled by FLOWFORGE_AUTO_DISCOVER env var")
        return

    cfg = None
    try:
        cfg = ConfigLoader().load_yaml("default.yaml")
        yaml_flag = cfg.get("system", {}).get("auto_discover", True)
    except Exception:
        yaml_flag = True

    if env_flag == "" and not yaml_flag:
        logger.info("auto_discover_plugins: disabled by default.yaml config")
        return

    # 2. Determine flowforge parent directory
    flowforge_dir = Path(__file__).resolve().parent.parent  # flowforge/
    parent_dir = flowforge_dir.parent  # d:\software\openclaw

    # 3. Determine which *forge directories to scan
    env_dirs = os.getenv("FLOWFORGE_FORGE_DIRS", "").strip()
    yaml_dirs = ""
    if cfg is not None:
        try:
            yaml_dirs = cfg.get("system", {}).get("forge_dirs", "").strip()
        except Exception:
            yaml_dirs = ""

    dirs_str = env_dirs or yaml_dirs

    if dirs_str:
        # Custom directory list provided
        forge_dirs = []
        for d in dirs_str.split(","):
            d = d.strip()
            if not d:
                continue
            p = Path(d)
            if not p.is_absolute():
                p = parent_dir / p
            if p.is_dir():
                forge_dirs.append(p)
            else:
                logger.warning(f"auto_discover_plugins: custom dir '{d}' not found, skipping")
    else:
        # Auto-scan sibling *forge directories
        forge_dirs = []
        for name in _DEFAULT_FORGE_NAMES:
            candidate = parent_dir / name
            if candidate.is_dir():
                forge_dirs.append(candidate)

    if not forge_dirs:
        logger.info("auto_discover_plugins: no *forge directories found")
        return

    logger.info(f"auto_discover_plugins: scanning {len(forge_dirs)} *forge director(ies)")

    # 4. For each *forge directory, check config/ and create AutoPlugin
    from flowforge.sdk import FlowForgeSDK

    sdk = FlowForgeSDK._current_instance

    for forge_dir in forge_dirs:
        config_dir = forge_dir / "config"
        if not config_dir.is_dir():
            logger.debug(f"auto_discover_plugins: {forge_dir.name} has no config/ directory, skipping")
            continue

        # Discover which standard sub-directories exist
        discovered_dirs: dict[str, str] = {}
        for subdir_name in _AUTO_DISCOVER_SUBDIRS:
            subdir_path = config_dir / subdir_name
            if subdir_path.is_dir():
                # Check if directory has any YAML files
                has_yaml = any(subdir_path.glob("*.y*ml"))
                if has_yaml:
                    discovered_dirs[subdir_name] = str(subdir_path)

        if not discovered_dirs:
            logger.debug(f"auto_discover_plugins: {forge_dir.name}/config/ has no standard sub-directories with YAML, skipping")
            continue

        forge_name = forge_dir.name
        logger.info(
            f"auto_discover_plugins: {forge_name} discovered config dirs: "
            f"{', '.join(discovered_dirs.keys())}"
        )

        # 5. Create AutoPlugin via SDK
        try:
            if sdk is not None:
                plugin = sdk.create_plugin(
                    name=forge_name,
                    version="0.1.0",
                    description=f"Auto-discovered {forge_name} declarative configs",
                    priority=200,
                    namespace=forge_name,
                    agents_dir=discovered_dirs.get("agents"),
                    workflows_dir=discovered_dirs.get("workflows"),
                    tools_dir=discovered_dirs.get("tools"),
                    personas_dir=discovered_dirs.get("personas"),
                    prompts_dir=discovered_dirs.get("prompts"),
                    gates_dir=discovered_dirs.get("gates"),
                    quality_gates_dir=discovered_dirs.get("quality_gates"),
                    evaluators_dir=discovered_dirs.get("evaluators"),
                    context_layers_dir=discovered_dirs.get("context_layers"),
                    loops_dir=discovered_dirs.get("loops"),
                    sops_dir=discovered_dirs.get("sops"),
                )
            else:
                # Fallback: create SDK instance for this forge
                forge_sdk = FlowForgeSDK(project=forge_name, namespace=forge_name)
                plugin = forge_sdk.create_plugin(
                    name=forge_name,
                    version="0.1.0",
                    description=f"Auto-discovered {forge_name} declarative configs",
                    priority=200,
                    namespace=forge_name,
                    agents_dir=discovered_dirs.get("agents"),
                    workflows_dir=discovered_dirs.get("workflows"),
                    tools_dir=discovered_dirs.get("tools"),
                    personas_dir=discovered_dirs.get("personas"),
                    prompts_dir=discovered_dirs.get("prompts"),
                    gates_dir=discovered_dirs.get("gates"),
                    quality_gates_dir=discovered_dirs.get("quality_gates"),
                    evaluators_dir=discovered_dirs.get("evaluators"),
                    context_layers_dir=discovered_dirs.get("context_layers"),
                    loops_dir=discovered_dirs.get("loops"),
                    sops_dir=discovered_dirs.get("sops"),
                )
        except Exception as e:
            logger.error(f"auto_discover_plugins: failed to create plugin for {forge_name}: {e}")
            continue

        # 6. Load the plugin
        try:
            logger.info(f"auto_discover_plugins: loading auto-discovered plugin '{forge_name}'")
            _load_single_plugin(
                plugin, agent_registry, tool_registry,
                mode_registry, event_bus, scheduler, app,
            )
        except Exception as e:
            logger.error(f"auto_discover_plugins: failed to load plugin '{forge_name}': {e}")


def _load_single_plugin(
    plugin_instance: FlowForgePlugin,
    agent_registry: AgentRegistry,
    tool_registry: ToolRegistry,
    mode_registry: ModeRegistry | None = None,
    event_bus: EventBus | None = None,
    scheduler: TaskScheduler | None = None,
    app: FastAPI | None = None,
):
    """Load a single plugin instance — register hooks and track entries.

    This function is extracted from _load_domain_plugins so that it can be
    reused by the hot-reload mechanism (reload_plugin).
    """
    plugin_instance.state = PluginState.STARTING

    try:
        # 1. middleware (before app starts handling requests)
        if app is not None:
            plugin_instance.register_middleware(app)

        # 2. agents — track new registrations
        agents_before = set(agent_registry._agents.keys())
        factories_before = set(agent_registry._factories.keys())
        plugin_instance.register_agents(agent_registry)
        new_agents = (set(agent_registry._agents.keys()) - agents_before) | \
                     (set(agent_registry._factories.keys()) - factories_before)
        plugin_instance._registered_agents.extend(new_agents)

        # 3. tools — track new registrations
        tools_before = set(tool_registry._tools.keys())
        plugin_instance.register_tools(tool_registry)
        new_tools = set(tool_registry._tools.keys()) - tools_before
        plugin_instance._registered_tools.extend(new_tools)

        # 4. modes
        if mode_registry is not None:
            plugin_instance.register_modes(mode_registry)

        # 5. routes
        if app is not None:
            plugin_instance.register_routes(app)

        # 6. event handlers — track new subscriptions
        if event_bus is not None:
            handlers_before = {
                et: list(handlers) for et, handlers in event_bus._subscribers.items()
            }
            plugin_instance.register_event_handlers(event_bus)
            for et in event_bus._subscribers:
                old_ids = {id(h) for h, _ in handlers_before.get(et, [])}
                for cb, filt in event_bus._subscribers[et]:
                    if id(cb) not in old_ids:
                        plugin_instance._registered_event_handlers.append((et, cb))

        # 7. schedules
        if scheduler is not None:
            jobs_before = set(scheduler._jobs.keys())
            plugin_instance.register_schedules(scheduler)
            new_jobs = set(scheduler._jobs.keys()) - jobs_before
            plugin_instance._registered_schedules.extend(new_jobs)

        # 8–14. V2 hooks — call with corresponding registries
        try:
            from flowforge.sdk import (
                WorkflowRegistry, GateRegistry, QualityGateRegistry,
                EvaluatorRegistry, SOPRegistry, ContextLayerRegistry,
                WorkflowStepHandlerRegistry,
            )
        except ImportError:
            WorkflowRegistry = GateRegistry = QualityGateRegistry = None
            EvaluatorRegistry = SOPRegistry = ContextLayerRegistry = None
            WorkflowStepHandlerRegistry = None

        # Helper: get SDK shared registry instance, or create a persistent one
        def _get_sdk_registry(attr_name: str, registry_cls: type):
            """Try to use SDK's shared registry; fall back to a new persistent instance."""
            try:
                from flowforge.sdk import FlowForgeSDK as _FFSDK
                _sdk_inst = _FFSDK._current_instance
                if _sdk_inst is not None:
                    return getattr(_sdk_inst, attr_name)
            except Exception:
                pass
            # Create a persistent instance (not a throwaway)
            return registry_cls()

        # 8. workflows — use SDK shared instance
        if WorkflowRegistry is not None:
            wf_registry = _get_sdk_registry("workflows", WorkflowRegistry)
            plugin_instance.register_workflows(wf_registry)
            plugin_instance._registered_workflows.extend(wf_registry.list_workflows())

        # 9. gates — use SDK shared instance to avoid isolation
        if GateRegistry is not None:
            gate_reg = _get_sdk_registry("gates", GateRegistry)
            plugin_instance.register_gates(gate_reg)
            plugin_instance._registered_gates.extend(gate_reg.list_gates())

        # 10. evaluators — use SDK shared instance to avoid isolation
        if EvaluatorRegistry is not None:
            eval_reg = _get_sdk_registry("evaluators", EvaluatorRegistry)
            plugin_instance.register_evaluators(eval_reg)
            plugin_instance._registered_evaluators.extend(eval_reg.list_evaluators())

        # 11. SOPs — use SDK shared instance
        if SOPRegistry is not None:
            sop_reg = _get_sdk_registry("sops", SOPRegistry)
            plugin_instance.register_sops(sop_reg)
            plugin_instance._registered_sops.extend(sop_reg.list_sops())

        # 12. quality gates — use SDK shared instance
        if QualityGateRegistry is not None:
            qg_reg = _get_sdk_registry("quality_gates", QualityGateRegistry)
            plugin_instance.register_quality_gates(qg_reg)
            plugin_instance._registered_quality_gates.extend(qg_reg.list_quality_gates())

        # 13. context layers — use SDK shared instance
        if ContextLayerRegistry is not None:
            cl_reg = _get_sdk_registry("context_layers", ContextLayerRegistry)
            plugin_instance.register_context_layers(cl_reg)
            plugin_instance._registered_context_layers.extend(cl_reg.list_layers())

        # 14. workflow step handlers
        if WorkflowStepHandlerRegistry is not None:
            sh_reg = WorkflowStepHandlerRegistry()
            plugin_instance.register_workflow_step_handler(sh_reg)
            plugin_instance._registered_step_handlers.extend(sh_reg.list_handlers())

        # 15. loops — use LoopRegistry for auto-discovered loop configs
        try:
            from flowforge.loop.registry import LoopRegistry as _LoopRegistry
            loop_reg = _LoopRegistry(config_dir="")  # empty dir — no auto-load
            plugin_instance.register_loops(loop_reg)
            plugin_instance._registered_loops.extend(loop_reg.list_templates())
        except ImportError:
            logger.debug("LoopRegistry not available, skipping loop registration")
        except Exception as e:
            logger.debug(f"Loop registration skipped: {e}")

        # 16. startup — pass PluginContext for dependency injection
        from flowforge.core.plugin_protocol import PluginContext
        from flowforge.core.plugin_protocol import validate_plugin_config, fill_config_defaults
        plugin_config = {}
        try:
            _cfg = ConfigLoader().load_yaml("default.yaml")
            plugin_config = _cfg.get(plugin_instance.name, {})
        except Exception:
            pass

        # Validate plugin config against schema
        if plugin_instance.manifest.config_schema:
            is_valid, errors = validate_plugin_config(
                plugin_config, plugin_instance.manifest.config_schema
            )
            if not is_valid:
                logger.error(f"[{plugin_instance.name}] Config validation failed: {errors}")
            plugin_config = fill_config_defaults(
                plugin_config, plugin_instance.manifest.config_schema
            )
        ctx = PluginContext(
            agent_registry=agent_registry,
            tool_registry=tool_registry,
            mode_registry=mode_registry,
            event_bus=event_bus,
            scheduler=scheduler,
            app=app,
            llm_client=llm_client,
            config=system_config,
            plugin_config=plugin_config,
            memory_manager=memory_manager,
            model_service=model_service,
            plugin_registry=plugin_registry,
            event_store=event_store,
        )
        plugin_instance.on_startup({"context": ctx})

        plugin_instance.state = PluginState.READY
        _loaded_plugins.append(plugin_instance)

        # Register with lifecycle manager for hot-load/unload/pause/resume
        if lifecycle_manager is not None:
            lifecycle_manager.register_plugin(plugin_instance)
            lifecycle_manager.store_context(plugin_instance.name, ctx)

        # Phase 4: Create sandbox for this plugin
        if sandbox_manager is not None:
            sandbox_manager.create_sandbox(plugin_instance.name, plugin_instance.manifest)

        # Phase 4: Register frontend components
        if frontend_registry is not None and plugin_instance.manifest.frontend_entry:
            frontend_registry.register(plugin_instance.name, plugin_instance.manifest)

        logger.info(f"[{plugin_instance.name}] Plugin loaded successfully")
    except Exception as e:
        plugin_instance.state = PluginState.ERROR
        logger.error(f"[{plugin_instance.name}] Plugin load failed: {e}")
        raise


def get_loaded_plugins() -> list[dict]:
    """Get info about all loaded domain plugins."""
    return [
        {
            "name": p.name,
            "version": p.version,
            "state": p.state.value,
            "priority": p.manifest.priority,
            "description": p.manifest.description,
        }
        for p in _loaded_plugins
    ]


async def unload_plugin(plugin_name: str) -> dict:
    """Unload a plugin by name — removes all its registrations.

    Delegates to PluginLifecycleManager if available, otherwise falls back
    to manual cleanup.

    Returns dict with unload status and details.
    """
    # Prefer lifecycle manager for proper cleanup
    if lifecycle_manager is not None and lifecycle_manager.get_plugin(plugin_name):
        result = await lifecycle_manager.unload_plugin(plugin_name)
        if result.get("status") == "success":
            # Also remove from _loaded_plugins
            plugin = None
            for p in _loaded_plugins:
                if p.name == plugin_name:
                    plugin = p
                    break
            if plugin:
                _loaded_plugins.remove(plugin)
            # Phase 4: Remove sandbox and frontend registration
            if sandbox_manager is not None:
                sandbox_manager.remove_sandbox(plugin_name)
            if frontend_registry is not None:
                frontend_registry.unregister(plugin_name)
        return result

    # Fallback: manual unload (for plugins not tracked by lifecycle manager)
    plugin = None
    for p in _loaded_plugins:
        if p.name == plugin_name:
            plugin = p
            break

    if plugin is None:
        return {"status": "error", "message": f"Plugin '{plugin_name}' not found"}

    if plugin.state == PluginState.STOPPED:
        return {"status": "error", "message": f"Plugin '{plugin_name}' already stopped"}

    plugin.state = PluginState.STOPPING

    # 1. Call on_shutdown
    try:
        plugin.on_shutdown({"app": app})
    except Exception as e:
        logger.error(f"[{plugin_name}] Error during shutdown: {e}")

    # 2. Remove registered agents
    removed_agents = 0
    for agent_name in plugin._registered_agents:
        try:
            if agent_name in agent_registry._agents:
                del agent_registry._agents[agent_name]
                removed_agents += 1
            if agent_name in agent_registry._factories:
                del agent_registry._factories[agent_name]
                removed_agents += 1
        except Exception as e:
            logger.warning(f"Failed to remove agent '{agent_name}': {e}")

    # 3. Remove registered tools
    removed_tools = 0
    for tool_name in plugin._registered_tools:
        try:
            if tool_name in tool_registry._tools:
                del tool_registry._tools[tool_name]
                removed_tools += 1
        except Exception as e:
            logger.warning(f"Failed to remove tool '{tool_name}': {e}")

    # 4. Remove registered event handlers
    removed_handlers = 0
    for event_type, handler in plugin._registered_event_handlers:
        try:
            if event_type in event_bus._subscribers:
                original_len = len(event_bus._subscribers[event_type])
                event_bus._subscribers[event_type] = [
                    (cb, filt) for cb, filt in event_bus._subscribers[event_type]
                    if cb is not handler
                ]
                removed_handlers += original_len - len(event_bus._subscribers[event_type])
        except Exception as e:
            logger.warning(f"Failed to remove event handler for '{event_type}': {e}")

    # 5. Remove registered schedules
    removed_schedules = 0
    if scheduler is not None:
        for job_id in plugin._registered_schedules:
            try:
                scheduler.remove_job(job_id)
                removed_schedules += 1
            except Exception as e:
                logger.warning(f"Failed to remove schedule '{job_id}': {e}")

    # 6. Remove from loaded list
    _loaded_plugins.remove(plugin)
    plugin.state = PluginState.STOPPED

    # Phase 4: Remove sandbox and frontend registration
    if sandbox_manager is not None:
        sandbox_manager.remove_sandbox(plugin_name)
    if frontend_registry is not None:
        frontend_registry.unregister(plugin_name)

    logger.info(
        f"[{plugin_name}] Plugin unloaded: "
        f"{removed_agents} agents, {removed_tools} tools, "
        f"{removed_handlers} handlers, {removed_schedules} schedules removed"
    )

    return {
        "status": "success",
        "plugin": plugin_name,
        "removed_agents": removed_agents,
        "removed_tools": removed_tools,
        "removed_handlers": removed_handlers,
        "removed_schedules": removed_schedules,
    }


async def reload_plugin(plugin_name: str) -> dict:
    """Reload a plugin — unload then reload from the same module.

    Delegates to PluginLifecycleManager if available, otherwise falls back
    to manual reload.
    """
    # Prefer lifecycle manager
    if lifecycle_manager is not None and lifecycle_manager.get_plugin(plugin_name):
        # Unload via lifecycle manager
        unload_result = await unload_plugin(plugin_name)
        if unload_result.get("status") != "success":
            return unload_result

        # Reload module and re-discover plugin class
        plugin = lifecycle_manager.get_plugin(plugin_name)
        if plugin is None:
            return {"status": "error", "message": f"Plugin '{plugin_name}' lost during unload"}

        module_path = plugin.__class__.__module__
        import importlib
        try:
            mod = importlib.import_module(module_path)
            importlib.reload(mod)
        except ImportError as e:
            return {"status": "error", "message": f"Failed to reload module {module_path}: {e}"}

        plugin_cls = getattr(mod, "Plugin", None)
        if plugin_cls is None or not (isinstance(plugin_cls, type) and issubclass(plugin_cls, FlowForgePlugin)):
            return {"status": "error", "message": f"No Plugin class found in {module_path}"}

        new_plugin = plugin_cls()
        _load_single_plugin(
            new_plugin, agent_registry, tool_registry,
            mode_registry, event_bus, scheduler, app,
        )

        return {
            "status": "success",
            "plugin": plugin_name,
            "unload": unload_result,
            "reload": "completed",
        }

    # Fallback: manual reload
    plugin = None
    for p in _loaded_plugins:
        if p.name == plugin_name:
            plugin = p
            break

    if plugin is None:
        return {"status": "error", "message": f"Plugin '{plugin_name}' not found"}

    module_path = plugin.__class__.__module__

    # Unload
    unload_result = await unload_plugin(plugin_name)
    if unload_result["status"] != "success":
        return unload_result

    # Reload module
    import importlib
    try:
        mod = importlib.import_module(module_path)
        importlib.reload(mod)
    except ImportError as e:
        return {"status": "error", "message": f"Failed to reload module {module_path}: {e}"}

    # Re-discover plugin class
    plugin_cls = getattr(mod, "Plugin", None)
    if plugin_cls is None or not (isinstance(plugin_cls, type) and issubclass(plugin_cls, FlowForgePlugin)):
        return {"status": "error", "message": f"No Plugin class found in {module_path}"}

    # Re-register
    new_plugin = plugin_cls()
    _load_single_plugin(
        new_plugin, agent_registry, tool_registry,
        mode_registry, event_bus, scheduler, app,
    )

    return {
        "status": "success",
        "plugin": plugin_name,
        "unload": unload_result,
        "reload": "completed",
    }


@asynccontextmanager
async def lifespan(app):
    # Ensure logs directory exists
    from pathlib import Path
    logs_dir = Path("logs")
    logs_dir.mkdir(parents=True, exist_ok=True)
    logger.info(f"Logs directory ensured: {logs_dir.resolve()}")

    await plugin_registry.load_from_config("plugins.yaml")
    plugin_registry.start_health_monitoring()
    plugin_registry.set_tool_timeout(300)

    # Phase 4: Initialize sandbox manager and frontend registry
    global sandbox_manager, frontend_registry
    from flowforge.core.plugin_sandbox import SandboxManager
    from flowforge.core.plugin_frontend import FrontendPluginRegistry
    sandbox_manager = SandboxManager(default_timeout=300)
    frontend_registry = FrontendPluginRegistry()

    tool_registry.set_plugin_registry(plugin_registry)

    if plugin_registry.has_plugin("web_search"):
        web_search_plugin = plugin_registry.get_plugin("web_search")
        if web_search_plugin and hasattr(web_search_plugin, "set_plugin_registry"):
            web_search_plugin.set_plugin_registry(plugin_registry)

    try:
        ws_tool = tool_registry._tools.get("web_search")
        if ws_tool and hasattr(ws_tool, "set_plugin_registry"):
            ws_tool.set_plugin_registry(plugin_registry)
    except Exception as e:
        logger.warning(f"Failed to set plugin_registry for web_search tool: {e}")

    _load_domain_plugins(
        agent_registry, tool_registry,
        mode_registry=mode_registry,
        event_bus=event_bus,
        scheduler=scheduler if system_config.scheduler_enabled else None,
        app=app,
    )

    # Auto-discover *forge plugins from sibling directories
    auto_discover_plugins(
        agent_registry, tool_registry,
        mode_registry=mode_registry,
        event_bus=event_bus,
        scheduler=scheduler if system_config.scheduler_enabled else None,
        app=app,
    )

    if system_config.scheduler_enabled:
        scheduler.start()
        logger.info("Scheduler started")

    # Start MCP Server if enabled
    if system_config.mcp_server_enabled:
        from flowforge.mcp.server import MCPServer
        mcp_server = MCPServer(
            tool_registry=tool_registry,
            agent_registry=agent_registry,
            port=system_config.mcp_server_port,
        )
        app.include_router(mcp_server.get_sse_endpoint())
        logger.info(f"MCP Server enabled, {len(mcp_server.list_tools())} tools exposed")

    # Connect to external MCP servers (MCP Client integration)
    # Reads mcp.servers from config/default.yaml and connects each enabled
    # server, registering its tools into the ToolRegistry with prefix
    # mcp.{server_name}.{tool}.
    try:
        _mcp_cfg = ConfigLoader().load_yaml("default.yaml")
        _mcp_section = _mcp_cfg.get("mcp", {})
        _mcp_servers = _mcp_section.get("servers", []) or []
        if _mcp_servers:
            from flowforge.core.mcp_integration import MCPIntegration
            _mcp_integration = MCPIntegration(tool_registry=tool_registry)
            _connected = 0
            for _server in _mcp_servers:
                _srv_name = _server.get("name", "unknown")
                if not _server.get("enabled", False):
                    logger.debug(f"MCP server '{_srv_name}' disabled, skipping")
                    continue
                try:
                    await _mcp_integration.connect_server(
                        name=_srv_name,
                        command=_server.get("command"),
                        args=_server.get("args"),
                        url=_server.get("url"),
                        env=_server.get("env"),
                    )
                    _connected += 1
                except Exception as _e:
                    logger.warning(f"Failed to connect MCP server '{_srv_name}': {_e}")
            if _connected:
                logger.info(f"MCP client integration: {_connected} external server(s) connected")
            else:
                logger.info("MCP client integration: no external servers connected (template only)")
        else:
            logger.debug("MCP client integration: no external servers configured")
    except Exception as _e:
        logger.warning(f"MCP client integration skipped: {_e}")

    logger.info(
        f"FlowForge API started - "
        f"{len(mode_registry.list_modes())} modes, "
        f"{len(plugin_registry.list_plugin_names())} plugins, "
        f"{len(agent_registry.list_agents())} agents"
    )
    yield
    # Notify protocol plugins of shutdown
    for _plug in _loaded_plugins:
        try:
            _plug.on_shutdown({"app": app})
        except Exception as e:
            logger.warning(f"Plugin {_plug.name} on_shutdown error: {e}")
    await plugin_registry.shutdown_all()
    if system_config.scheduler_enabled:
        scheduler.shutdown()
    logger.info("FlowForge API shutdown")


app = FastAPI(title="FlowForge API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

event_bus = EventBus()
agent_registry = AgentRegistry()
_config_loader = ConfigLoader()
plugin_registry = PluginRegistry(config_loader=_config_loader)
tool_registry = ToolRegistry(tool_timeout=300)
mode_registry = ModeRegistry()

_models_config = _config_loader.get_models_config()
# 实例化 LLMRouter 并注入到 LLMClient，让 llm_route.yaml 的路由策略真正生效
# 修复审核报告缺陷 #1：原代码未注入 LLMRouter，导致 llm_route.yaml 的 routes 配置完全失效
_models_yaml_path = _config_loader.config_dir / "models.yaml"
llm_router = LLMRouter(config_path=str(_models_yaml_path))
llm_client = LLMClient(models_config=_models_config, event_bus=event_bus, llm_router=llm_router)
tool_registry.register(llm_client)

_register_core_tools(tool_registry, plugin_registry)
_register_core_agents(agent_registry)

set_plugin_registry_instance(plugin_registry)

_register_all_modes(mode_registry)

memory_manager = MemoryManager({"db_url": system_config.db_url})

# EventStore 初始化 — WAL模式事件存储，用于任务生命周期事件持久化
from flowforge.session.event_store import EventStore
event_store = EventStore(store_dir=str(ConfigLoader().config_dir / ".flowforge" / "events"))
set_event_store_instance(event_store)
logger.info(f"EventStore initialized with {event_store.entry_count} existing entries")

set_llm_client_instance(llm_client)

from flowforge.core.tool_chain_executor import ToolChainExecutor
tool_chain_executor = ToolChainExecutor(llm_client, tool_registry, event_bus=event_bus)
set_tool_chain_executor_instance(tool_chain_executor)

model_service = ModelService(plugin_registry=plugin_registry)
set_model_service_instance(model_service)

_executor_instance = HybridExecutor(
    mode_registry, agent_registry, tool_registry, event_bus,
    memory_manager=memory_manager
)
set_executor_instance(_executor_instance)

# PersonaLock 单例 — Loop 执行期间防止同一 Persona 被其他任务抢占
# 必须在 LoopExecutor 注入之前定义，因为 LoopExecutor 依赖 PersonaLock
_persona_lock = PersonaLock()


def get_persona_lock() -> PersonaLock:
    """获取全局 PersonaLock 实例。"""
    return _persona_lock

# 注入 LoopExecutor — 激活 HybridExecutor.run() 中的 Loop 编排分支和回退机制
# 设计文档 loop.md §5.3: Loop 是 mode 的"上层管理者"，不是 mode 本身
try:
    from flowforge.loop.executor import LoopExecutor
    from flowforge.loop.planner import LLMPlanner
    from flowforge.loop.verifier import RuleBasedVerifier
    from flowforge.loop.reflector import ReflexionReflector
    from flowforge.harness.orchestrator import HarnessOrchestrator
    from flowforge.harness.entropy_manager import EntropyManager, RuleEvolution

    _loop_executor = LoopExecutor(
        hybrid_executor=_executor_instance,
        harness=_executor_instance.harness or HarnessOrchestrator(),
        planner=LLMPlanner(),
        verifier=RuleBasedVerifier(),
        reflector=ReflexionReflector(llm_client=llm_client),
        checkpoint_mgr=_executor_instance.checkpoint_manager,
        entropy_mgr=EntropyManager(),
        rule_evolution=RuleEvolution(),
        persona_lock=_persona_lock,
        memory_manager=memory_manager,
    )
    _executor_instance.set_loop_executor(_loop_executor)
    logger.info("LoopExecutor injected into HybridExecutor")
except Exception as _loop_err:
    logger.warning(f"Failed to inject LoopExecutor: {_loop_err}")

try:
    from flowforge.app.api.endpoints.websocket import manager as ws_manager
    _executor_instance.set_helm_manager(ws_manager)
except ImportError:
    pass

scheduler = TaskScheduler(executor=_executor_instance)
set_scheduler_instance(scheduler)

from flowforge.app.api.endpoints.graph import init_graph_api
init_graph_api(agent_registry, mode_registry, tool_registry)

from flowforge.app.api.endpoints.prompts import init_prompts_api
from flowforge.app.api.endpoints.memory import init_memory_api

_config_dir = str(ConfigLoader().config_dir)
init_prompts_api(_config_dir)
init_memory_api(memory_manager)

plugin_manager = PluginManager()
set_plugin_manager_instance(plugin_manager)

# Initialize lifecycle manager with all framework services
lifecycle_manager = PluginLifecycleManager(
    agent_registry=agent_registry,
    tool_registry=tool_registry,
    mode_registry=mode_registry,
    event_bus=event_bus,
    scheduler=scheduler if system_config.scheduler_enabled else None,
    app=app,
    llm_client=llm_client,
    config=system_config,
    memory_manager=memory_manager,
    model_service=model_service,
    plugin_registry=plugin_registry,
    event_store=event_store,
)

app.include_router(router)

# Phase 4: Frontend plugin API
from flowforge.app.api.plugin_frontend_api import router as frontend_api_router
app.include_router(frontend_api_router)

try:
    from flowforge.app.api.endpoints import websocket as ws_endpoints
    app.include_router(ws_endpoints.router)
except ImportError:
    pass

try:
    from flowforge.app.api.endpoints import openroute as openroute_endpoints
    app.include_router(openroute_endpoints.router)
except ImportError:
    pass

try:
    from flowforge.app.api.endpoints import workspace as workspace_endpoints
    app.include_router(workspace_endpoints.router)
except ImportError:
    pass

try:
    from flowforge.app.api.endpoints import plans as plans_endpoints
    app.include_router(plans_endpoints.router)
except ImportError:
    pass

try:
    from flowforge.app.api.endpoints import uploads as uploads_endpoints
    app.include_router(uploads_endpoints.router)
except ImportError:
    pass

try:
    from flowforge.app.api.endpoints import loops as loops_endpoints
    app.include_router(loops_endpoints.router)
except ImportError:
    pass


@app.get("/health")
def health():
    components = {}
    components["mode_registry"] = {"status": "healthy", "modes": len(mode_registry.list_modes())}
    components["plugin_registry"] = {"status": "healthy", "plugins": len(plugin_registry.list_plugin_names())}
    components["tool_registry"] = {"status": "healthy", "tools": len(tool_registry.list_tools())}
    components["agent_registry"] = {"status": "healthy", "agents": len(agent_registry.list_agents())}
    components["event_bus"] = {"status": "healthy"}
    try:
        _executor_instance.state_manager.list_states()
        components["database"] = {"status": "healthy"}
    except Exception as e:
        components["database"] = {"status": "unhealthy", "message": str(e)}
    try:
        health_report = model_service.get_health_report()
        summary = health_report.get("summary", {})
        disabled = summary.get("disabled", 0)
        suspended = summary.get("suspended", 0)
        if disabled > 0:
            components["model_service"] = {"status": "degraded", "message": f"{disabled} disabled, {suspended} suspended models"}
        elif suspended > 0:
            components["model_service"] = {"status": "degraded", "message": f"{suspended} suspended models"}
        else:
            components["model_service"] = {"status": "healthy"}
    except Exception:
        components["model_service"] = {"status": "unknown"}
    try:
        openroute_plugin = plugin_registry.get_plugin("openroute")
        if openroute_plugin and openroute_plugin.is_running:
            components["openroute"] = {"status": "running", "port": openroute_plugin.port}
        else:
            components["openroute"] = {"status": "stopped"}
    except Exception:
        components["openroute"] = {"status": "unknown"}
    return {"status": "healthy", "components": components}


@app.get("/metrics")
def get_metrics_endpoint():
    from flowforge.core.metrics import get_prometheus_metrics, get_metrics as gm
    prom_data = get_prometheus_metrics()
    if prom_data:
        from starlette.responses import Response
        return Response(content=prom_data, media_type="text/plain; version=0.0.4; charset=utf-8")
    return gm()


if __name__ == "__main__":
    uvicorn.run(app, host=system_config.server_host, port=system_config.server_port)
