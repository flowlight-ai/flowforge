"""Plugin loading orchestration — extracted from app/main.py.

Encapsulates domain plugin discovery, loading, unloading, and hot-reload
logic that previously lived as module-level functions and globals in
``app/main.py``.  Moving this code into ``core/`` keeps ``app/`` focused on
endpoint wiring while the plugin lifecycle implementation resides in the
shared kernel layer (architecture rule: app → core, never the reverse).

The :class:`PluginLoader` holds all mutable state (loaded plugin list,
lifecycle manager, sandbox/frontend registries) so that ``main.py`` can
simply create one instance and delegate to it.
"""

from __future__ import annotations

import importlib
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI

from flowforge.core.config import ConfigLoader, system_config
from flowforge.core.agent_registry import AgentRegistry
from flowforge.core.plugin_registry import PluginRegistry
from flowforge.core.plugin_protocol import (
    FlowForgePlugin,
    PluginContext,
    PluginState,
    fill_config_defaults,
    validate_plugin_config,
)
from flowforge.core.plugin_lifecycle import PluginLifecycleManager
from flowforge.core.tracing import get_logger
from flowforge.events.event_bus import EventBus
from flowforge.scheduler.scheduler import TaskScheduler
from flowforge.tools.registry import ToolRegistry
from flowforge.modes.registry import ModeRegistry

logger = get_logger("flowforge.core.plugin_loader")

# Standard config sub-directories that auto_discover_plugins scans
_AUTO_DISCOVER_SUBDIRS = [
    "agents", "workflows", "tools", "personas", "prompts",
    "gates", "quality_gates", "evaluators", "context_layers", "loops", "sops",
]

# Default *forge project names to scan — populated at runtime by
# auto_discover_plugins() scanning installed packages.
_DEFAULT_FORGE_NAMES: list[str] = []


class PluginLoader:
    """Encapsulates plugin discovery, loading, unloading, and hot-reload.

    Holds mutable state that was previously scattered across module-level
    globals in ``app/main.py``: the loaded-plugin list, lifecycle manager,
    sandbox manager, and frontend registry.
    """

    def __init__(
        self,
        agent_registry: AgentRegistry,
        tool_registry: ToolRegistry,
        mode_registry: ModeRegistry,
        event_bus: EventBus,
        plugin_registry: PluginRegistry,
        llm_client: Any,
        model_service: Any,
        memory_manager: Any,
        event_store: Any,
        scheduler: TaskScheduler | None = None,
        app: FastAPI | None = None,
    ) -> None:
        self._agent_registry = agent_registry
        self._tool_registry = tool_registry
        self._mode_registry = mode_registry
        self._event_bus = event_bus
        self._plugin_registry = plugin_registry
        self._llm_client = llm_client
        self._model_service = model_service
        self._memory_manager = memory_manager
        self._event_store = event_store
        self._scheduler = scheduler
        self._app = app

        # Mutable state — previously module-level globals
        self.loaded_plugins: list[FlowForgePlugin] = []
        self.lifecycle_manager: PluginLifecycleManager | None = None
        self.sandbox_manager: Any = None
        self.frontend_registry: Any = None

    # ── Dependency sorting helpers ───────────────────────────────────────

    @staticmethod
    def _topological_sort_plugins(plugins: list[FlowForgePlugin]) -> list[FlowForgePlugin]:
        """Sort plugins by dependencies using Kahn's algorithm.

        If A depends on B, B is loaded before A.
        Falls back to priority-based sort on circular dependency.
        """
        name_to_plugin = {p.name: p for p in plugins}
        dep_graph = {p.name: set(p.manifest.dependencies) & set(name_to_plugin) for p in plugins}

        in_degree = {name: len(deps) for name, deps in dep_graph.items()}
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

    @staticmethod
    def _check_version_compatibility(plugins: list[FlowForgePlugin]) -> list[FlowForgePlugin]:
        """Remove plugins incompatible with the current framework version."""
        try:
            from flowforge import __version__ as framework_version
        except ImportError:
            framework_version = "0.1.0"

        compatible: list[FlowForgePlugin] = []
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

    # ── Single plugin loading ────────────────────────────────────────────

    def load_single_plugin(
        self,
        plugin_instance: FlowForgePlugin,
        agent_registry: AgentRegistry | None = None,
        tool_registry: ToolRegistry | None = None,
        mode_registry: ModeRegistry | None = None,
        event_bus: EventBus | None = None,
        scheduler: TaskScheduler | None = None,
        app: FastAPI | None = None,
    ) -> None:
        """Load a single plugin instance — register hooks and track entries.

        Reused by the hot-reload mechanism (``reload_plugin``).

        Optional registries may be passed to override the loader's internal
        instances (used by the backward-compat ``_load_single_plugin`` shim in
        ``app.main`` so callers' local registries are actually populated).
        """
        plugin_instance.state = PluginState.STARTING

        try:
            app = app if app is not None else self._app
            agent_registry = agent_registry if agent_registry is not None else self._agent_registry
            tool_registry = tool_registry if tool_registry is not None else self._tool_registry
            mode_registry = mode_registry if mode_registry is not None else self._mode_registry
            event_bus = event_bus if event_bus is not None else self._event_bus
            scheduler = scheduler if scheduler is not None else self._scheduler

            # 1. middleware
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

            def _get_sdk_registry(attr_name: str, registry_cls: type):
                """Try to use SDK's shared registry; fall back to a new persistent instance."""
                try:
                    from flowforge.sdk import FlowForgeSDK as _FFSDK
                    _sdk_inst = _FFSDK._current_instance
                    if _sdk_inst is not None:
                        return getattr(_sdk_inst, attr_name)
                except Exception:
                    pass
                return registry_cls()

            if WorkflowRegistry is not None:
                wf_registry = _get_sdk_registry("workflows", WorkflowRegistry)
                plugin_instance.register_workflows(wf_registry)
                plugin_instance._registered_workflows.extend(wf_registry.list_workflows())

            if GateRegistry is not None:
                gate_reg = _get_sdk_registry("gates", GateRegistry)
                plugin_instance.register_gates(gate_reg)
                plugin_instance._registered_gates.extend(gate_reg.list_gates())

            if EvaluatorRegistry is not None:
                eval_reg = _get_sdk_registry("evaluators", EvaluatorRegistry)
                plugin_instance.register_evaluators(eval_reg)
                plugin_instance._registered_evaluators.extend(eval_reg.list_evaluators())

            if SOPRegistry is not None:
                sop_reg = _get_sdk_registry("sops", SOPRegistry)
                plugin_instance.register_sops(sop_reg)
                plugin_instance._registered_sops.extend(sop_reg.list_sops())

            if QualityGateRegistry is not None:
                qg_reg = _get_sdk_registry("quality_gates", QualityGateRegistry)
                plugin_instance.register_quality_gates(qg_reg)
                plugin_instance._registered_quality_gates.extend(qg_reg.list_quality_gates())

            if ContextLayerRegistry is not None:
                cl_reg = _get_sdk_registry("context_layers", ContextLayerRegistry)
                plugin_instance.register_context_layers(cl_reg)
                plugin_instance._registered_context_layers.extend(cl_reg.list_layers())

            if WorkflowStepHandlerRegistry is not None:
                sh_reg = WorkflowStepHandlerRegistry()
                plugin_instance.register_workflow_step_handler(sh_reg)
                plugin_instance._registered_step_handlers.extend(sh_reg.list_handlers())

            # 15. loops
            try:
                from flowforge.loop.registry import LoopRegistry as _LoopRegistry
                loop_reg = _LoopRegistry(config_dir="")
                plugin_instance.register_loops(loop_reg)
                plugin_instance._registered_loops.extend(loop_reg.list_templates())
            except ImportError:
                logger.debug("LoopRegistry not available, skipping loop registration")
            except Exception as e:
                logger.debug(f"Loop registration skipped: {e}")

            # 16. startup — pass PluginContext for dependency injection
            plugin_config: dict[str, Any] = {}
            try:
                _cfg = ConfigLoader().load_yaml("default.yaml")
                plugin_config = _cfg.get(plugin_instance.name, {})
            except Exception:
                pass

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
                llm_client=self._llm_client,
                config=system_config,
                plugin_config=plugin_config,
                memory_manager=self._memory_manager,
                model_service=self._model_service,
                plugin_registry=self._plugin_registry,
                event_store=self._event_store,
            )
            plugin_instance.on_startup({"context": ctx})

            plugin_instance.state = PluginState.READY
            self.loaded_plugins.append(plugin_instance)

            if self.lifecycle_manager is not None:
                self.lifecycle_manager.register_plugin(plugin_instance)
                self.lifecycle_manager.store_context(plugin_instance.name, ctx)

            if self.sandbox_manager is not None:
                self.sandbox_manager.create_sandbox(plugin_instance.name, plugin_instance.manifest)

            if self.frontend_registry is not None and plugin_instance.manifest.frontend_entry:
                self.frontend_registry.register(plugin_instance.name, plugin_instance.manifest)

            logger.info(f"[{plugin_instance.name}] Plugin loaded successfully")
        except Exception as e:
            plugin_instance.state = PluginState.ERROR
            logger.error(f"[{plugin_instance.name}] Plugin load failed: {e}")
            raise

    # ── Domain plugin loading ────────────────────────────────────────────

    def load_domain_plugins(self) -> None:
        """Load domain plugins from FLOWFORGE_DOMAIN_MODULE.

        Supports two plugin styles:

        1. **Protocol-based** (preferred): the module defines a ``Plugin`` class
           that inherits from :class:`FlowForgePlugin`.
        2. **Function-based** (legacy): the module exposes top-level
           ``register_agents`` / ``register_tools`` functions.
        """
        domain_module = os.getenv("FLOWFORGE_DOMAIN_MODULE", "")
        if not domain_module:
            try:
                cfg = ConfigLoader()
                raw = cfg.load_yaml("default.yaml")
                domain_module = raw.get("system", {}).get("domain_modules", "")
            except Exception:
                pass
        if not domain_module:
            return

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

            plugin_cls = getattr(mod, "Plugin", None)
            plugin_instance = None

            if plugin_cls is None:
                plugin_instance = getattr(mod, "plugin", None)
            elif isinstance(plugin_cls, type) and issubclass(plugin_cls, FlowForgePlugin):
                plugin_instance = plugin_cls()

            if isinstance(plugin_instance, FlowForgePlugin):
                protocol_plugins.append(plugin_instance)
                continue

            if hasattr(mod, "register_agents") or hasattr(mod, "register_tools"):
                legacy_modules.append(mod)

        # Phase 2: Version compatibility + dependency resolution
        protocol_plugins = self._check_version_compatibility(protocol_plugins)

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

        # Sort by dependencies (topological) then priority
        try:
            protocol_plugins = self._topological_sort_plugins(protocol_plugins)
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
            self.load_single_plugin(plugin_instance)

        # Cross-plugin initialization
        for plugin in self.loaded_plugins:
            for other_plugin in self.loaded_plugins:
                if other_plugin.name != plugin.name:
                    try:
                        plugin.on_plugin_loaded(other_plugin.name)
                    except Exception as e:
                        logger.warning(f"Plugin {plugin.name} on_plugin_loaded({other_plugin.name}) error: {e}")

        # Phase 4: Register legacy function-based plugins
        for mod in legacy_modules:
            if hasattr(mod, "register_agents"):
                mod.register_agents(self._agent_registry)
                logger.info(f"Registered agents from {mod.__name__} (legacy)")
            if hasattr(mod, "register_tools"):
                mod.register_tools(self._tool_registry)
                logger.info(f"Registered tools from {mod.__name__} (legacy)")

    # ── Auto-discover *forge plugins ─────────────────────────────────────

    def auto_discover_plugins(self) -> None:
        """Auto-discover and load *forge plugins from sibling directories.

        Controlled by:
          - ``FLOWFORGE_AUTO_DISCOVER`` env var (default: ``true``)
          - ``FLOWFORGE_FORGE_DIRS`` env var (comma-separated custom dirs)
          - ``system.auto_discover`` in default.yaml
          - ``system.forge_dirs`` in default.yaml
        """
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

        # flowforge/ parent directory
        flowforge_dir = Path(__file__).resolve().parent.parent
        parent_dir = flowforge_dir.parent

        env_dirs = os.getenv("FLOWFORGE_FORGE_DIRS", "").strip()
        yaml_dirs = ""
        if cfg is not None:
            try:
                yaml_dirs = cfg.get("system", {}).get("forge_dirs", "").strip()
            except Exception:
                yaml_dirs = ""

        dirs_str = env_dirs or yaml_dirs

        if dirs_str:
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
            forge_dirs = []
            for name in _DEFAULT_FORGE_NAMES:
                candidate = parent_dir / name
                if candidate.is_dir():
                    forge_dirs.append(candidate)

        if not forge_dirs:
            logger.info("auto_discover_plugins: no *forge directories found")
            return

        logger.info(f"auto_discover_plugins: scanning {len(forge_dirs)} *forge director(ies)")

        from flowforge.sdk import FlowForgeSDK

        sdk = FlowForgeSDK._current_instance

        for forge_dir in forge_dirs:
            config_dir = forge_dir / "config"
            if not config_dir.is_dir():
                logger.debug(f"auto_discover_plugins: {forge_dir.name} has no config/ directory, skipping")
                continue

            discovered_dirs: dict[str, str] = {}
            for subdir_name in _AUTO_DISCOVER_SUBDIRS:
                subdir_path = config_dir / subdir_name
                if subdir_path.is_dir():
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

            try:
                logger.info(f"auto_discover_plugins: loading auto-discovered plugin '{forge_name}'")
                self.load_single_plugin(plugin)
            except Exception as e:
                logger.error(f"auto_discover_plugins: failed to load plugin '{forge_name}': {e}")

    # ── Query / unload / reload ──────────────────────────────────────────

    def get_loaded_plugins(self) -> list[dict]:
        """Get info about all loaded domain plugins."""
        return [
            {
                "name": p.name,
                "version": p.version,
                "state": p.state.value,
                "priority": p.manifest.priority,
                "description": p.manifest.description,
            }
            for p in self.loaded_plugins
        ]

    async def unload_plugin(self, plugin_name: str) -> dict:
        """Unload a plugin by name — removes all its registrations."""
        if self.lifecycle_manager is not None and self.lifecycle_manager.get_plugin(plugin_name):
            result = await self.lifecycle_manager.unload_plugin(plugin_name)
            if result.get("status") == "success":
                plugin = None
                for p in self.loaded_plugins:
                    if p.name == plugin_name:
                        plugin = p
                        break
                if plugin:
                    self.loaded_plugins.remove(plugin)
                if self.sandbox_manager is not None:
                    self.sandbox_manager.remove_sandbox(plugin_name)
                if self.frontend_registry is not None:
                    self.frontend_registry.unregister(plugin_name)
            return result

        # Fallback: manual unload
        plugin = None
        for p in self.loaded_plugins:
            if p.name == plugin_name:
                plugin = p
                break

        if plugin is None:
            return {"status": "error", "message": f"Plugin '{plugin_name}' not found"}

        if plugin.state == PluginState.STOPPED:
            return {"status": "error", "message": f"Plugin '{plugin_name}' already stopped"}

        plugin.state = PluginState.STOPPING

        try:
            plugin.on_shutdown({"app": self._app})
        except Exception as e:
            logger.error(f"[{plugin_name}] Error during shutdown: {e}")

        removed_agents = 0
        for agent_name in plugin._registered_agents:
            try:
                if agent_name in self._agent_registry._agents:
                    del self._agent_registry._agents[agent_name]
                    removed_agents += 1
                if agent_name in self._agent_registry._factories:
                    del self._agent_registry._factories[agent_name]
                    removed_agents += 1
            except Exception as e:
                logger.warning(f"Failed to remove agent '{agent_name}': {e}")

        removed_tools = 0
        for tool_name in plugin._registered_tools:
            try:
                if tool_name in self._tool_registry._tools:
                    del self._tool_registry._tools[tool_name]
                    removed_tools += 1
            except Exception as e:
                logger.warning(f"Failed to remove tool '{tool_name}': {e}")

        removed_handlers = 0
        for event_type, handler in plugin._registered_event_handlers:
            try:
                if event_type in self._event_bus._subscribers:
                    original_len = len(self._event_bus._subscribers[event_type])
                    self._event_bus._subscribers[event_type] = [
                        (cb, filt) for cb, filt in self._event_bus._subscribers[event_type]
                        if cb is not handler
                    ]
                    removed_handlers += original_len - len(self._event_bus._subscribers[event_type])
            except Exception as e:
                logger.warning(f"Failed to remove event handler for '{event_type}': {e}")

        removed_schedules = 0
        if self._scheduler is not None:
            for job_id in plugin._registered_schedules:
                try:
                    self._scheduler.remove_job(job_id)
                    removed_schedules += 1
                except Exception as e:
                    logger.warning(f"Failed to remove schedule '{job_id}': {e}")

        self.loaded_plugins.remove(plugin)
        plugin.state = PluginState.STOPPED

        if self.sandbox_manager is not None:
            self.sandbox_manager.remove_sandbox(plugin_name)
        if self.frontend_registry is not None:
            self.frontend_registry.unregister(plugin_name)

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

    async def reload_plugin(self, plugin_name: str) -> dict:
        """Reload a plugin — unload then reload from the same module."""
        if self.lifecycle_manager is not None and self.lifecycle_manager.get_plugin(plugin_name):
            unload_result = await self.unload_plugin(plugin_name)
            if unload_result.get("status") != "success":
                return unload_result

            plugin = self.lifecycle_manager.get_plugin(plugin_name)
            if plugin is None:
                return {"status": "error", "message": f"Plugin '{plugin_name}' lost during unload"}

            module_path = plugin.__class__.__module__
            try:
                mod = importlib.import_module(module_path)
                importlib.reload(mod)
            except ImportError as e:
                return {"status": "error", "message": f"Failed to reload module {module_path}: {e}"}

            plugin_cls = getattr(mod, "Plugin", None)
            if plugin_cls is None or not (isinstance(plugin_cls, type) and issubclass(plugin_cls, FlowForgePlugin)):
                return {"status": "error", "message": f"No Plugin class found in {module_path}"}

            new_plugin = plugin_cls()
            self.load_single_plugin(new_plugin)

            return {
                "status": "success",
                "plugin": plugin_name,
                "unload": unload_result,
                "reload": "completed",
            }

        # Fallback: manual reload
        plugin = None
        for p in self.loaded_plugins:
            if p.name == plugin_name:
                plugin = p
                break

        if plugin is None:
            return {"status": "error", "message": f"Plugin '{plugin_name}' not found"}

        module_path = plugin.__class__.__module__

        unload_result = await self.unload_plugin(plugin_name)
        if unload_result["status"] != "success":
            return unload_result

        try:
            mod = importlib.import_module(module_path)
            importlib.reload(mod)
        except ImportError as e:
            return {"status": "error", "message": f"Failed to reload module {module_path}: {e}"}

        plugin_cls = getattr(mod, "Plugin", None)
        if plugin_cls is None or not (isinstance(plugin_cls, type) and issubclass(plugin_cls, FlowForgePlugin)):
            return {"status": "error", "message": f"No Plugin class found in {module_path}"}

        new_plugin = plugin_cls()
        self.load_single_plugin(new_plugin)

        return {
            "status": "success",
            "plugin": plugin_name,
            "unload": unload_result,
            "reload": "completed",
        }

    def init_sandbox_and_frontend(self) -> None:
        """Initialize sandbox manager and frontend registry (Phase 4)."""
        from flowforge.core.plugin_sandbox import SandboxManager
        from flowforge.core.plugin_frontend import FrontendPluginRegistry
        self.sandbox_manager = SandboxManager(default_timeout=300)
        self.frontend_registry = FrontendPluginRegistry()

    def shutdown_all(self) -> None:
        """Notify all loaded plugins of shutdown."""
        for plugin in self.loaded_plugins:
            try:
                plugin.on_shutdown({"app": self._app})
            except Exception as e:
                logger.warning(f"Plugin {plugin.name} on_shutdown error: {e}")
