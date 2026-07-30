"""FlowForge API application entry point.

This module contains **only** FastAPI app creation, lifespan wiring, route
mounting, and trivial health/metrics endpoints.  All implementation code
(plugin loading, tool/agent/mode registration) lives in ``core/``:

- :mod:`flowforge.core.bootstrap` — registry bootstrap helpers
- :mod:`flowforge.core.plugin_loader` — plugin lifecycle orchestration

Backward compatibility: module-level ``__getattr__`` exposes legacy names
(``_load_single_plugin``, ``_loaded_plugins``, ``lifecycle_manager``, etc.)
so existing tests that import them continue to work.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from flowforge.app.api.router import router
from flowforge.app.deps import (
    set_executor_instance,
    set_llm_client_instance,
    set_model_service_instance,
    set_plugin_registry_instance,
    set_plugin_manager_instance,
    set_scheduler_instance,
    set_tool_chain_executor_instance,
    set_event_store_instance,
)
from flowforge.core import metrics
from flowforge.core.agent_registry import AgentRegistry
from flowforge.core.bootstrap import (
    register_all_modes,
    register_core_agents,
    register_core_tools,
)
from flowforge.core.config import ConfigLoader, system_config
from flowforge.core.persona_lock import PersonaLock
from flowforge.core.plugin_lifecycle import PluginLifecycleManager
from flowforge.core.plugin_loader import PluginLoader
from flowforge.core.plugin_manager import PluginManager
from flowforge.core.plugin_registry import PluginRegistry
from flowforge.core.tool_chain_executor import ToolChainExecutor
from flowforge.core.tracing import get_logger, load_logging_config
from flowforge.events.event_bus import EventBus
from flowforge.executor.hybrid_executor import HybridExecutor
from flowforge.llm.router import LLMRouter
from flowforge.memory.manager import MemoryManager
from flowforge.modes.registry import ModeRegistry
from flowforge.scheduler.scheduler import TaskScheduler
from flowforge.session.event_store import EventStore
from flowforge.tools.llm.model_service import ModelService
from flowforge.tools.llm_client import LLMClient
from flowforge.tools.registry import ToolRegistry

load_logging_config()
logger = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — delegate heavy work to PluginLoader."""
    Path("logs").mkdir(parents=True, exist_ok=True)
    logger.info("Logs directory ensured")

    await plugin_registry.load_from_config("plugins.yaml")
    plugin_registry.start_health_monitoring()
    plugin_registry.set_tool_timeout(300)

    # Phase 4: sandbox + frontend registry
    plugin_loader.init_sandbox_and_frontend()

    tool_registry.set_plugin_registry(plugin_registry)
    ws_tool = tool_registry._tools.get("web_search")
    if ws_tool and hasattr(ws_tool, "set_plugin_registry"):
        ws_tool.set_plugin_registry(plugin_registry)

    # Load domain + auto-discovered plugins
    plugin_loader.load_domain_plugins()
    plugin_loader.auto_discover_plugins()

    if system_config.scheduler_enabled:
        scheduler.start()
        logger.info("Scheduler started")

    # MCP server (optional)
    if system_config.mcp_server_enabled:
        from flowforge.mcp.server import MCPServer
        mcp_server = MCPServer(
            tool_registry=tool_registry,
            agent_registry=agent_registry,
            port=system_config.mcp_server_port,
        )
        app.include_router(mcp_server.get_sse_endpoint())
        logger.info(f"MCP Server enabled, {len(mcp_server.list_tools())} tools exposed")

    # External MCP client integration
    _init_mcp_client_integration(app)

    logger.info(
        f"FlowForge API started - "
        f"{len(mode_registry.list_modes())} modes, "
        f"{len(plugin_registry.list_plugin_names())} plugins, "
        f"{len(agent_registry.list_agents())} agents"
    )

    # F052: 启动 AutonomousDaemon — 5 灵智体 24h 自主运行（10 分钟自动找需求）
    # operator 要求：自进化能力必须自动运行，并在 Web 可观测性中可见
    autonomous_daemon: Any = None
    autonomous_task: Any = None
    try:
        import os as _os
        from flowforge.forgemind.autonomous import create_autonomous_daemon
        # 项目根目录：默认 openclaw 根目录（可由 FLOWFORGE_AUTONOMOUS_ROOT 覆盖）
        project_root_str = _os.environ.get(
            "FLOWFORGE_AUTONOMOUS_ROOT",
            str(Path(__file__).resolve().parents[2]),
        )
        autonomous_daemon = await create_autonomous_daemon(Path(project_root_str))
        autonomous_task = asyncio.create_task(autonomous_daemon.run_forever())
        logger.info(
            "AutonomousDaemon 已启动 — 5 灵智体每 %ds 自动扫描需求",
            autonomous_daemon._scan_interval,
        )
        # 暴露到 app.state 供 API 端点查询
        app.state.autonomous_daemon = autonomous_daemon
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"AutonomousDaemon 启动失败（非致命，API 可正常工作）: {exc}", exc_info=True)

    yield

    # 停止 AutonomousDaemon
    if autonomous_daemon is not None:
        try:
            autonomous_daemon.stop()
        except Exception:  # noqa: BLE001
            pass
    if autonomous_task is not None:
        try:
            autonomous_task.cancel()
            await asyncio.wait_for(autonomous_task, timeout=5.0)
        except (asyncio.TimeoutError, asyncio.CancelledError, Exception):  # noqa: BLE001
            pass

    plugin_loader.shutdown_all()
    await plugin_registry.shutdown_all()
    if system_config.scheduler_enabled:
        scheduler.shutdown()
    logger.info("FlowForge API shutdown")


def _init_mcp_client_integration(app: FastAPI) -> None:
    """Connect to external MCP servers from config/default.yaml."""
    try:
        mcp_cfg = ConfigLoader().load_yaml("default.yaml")
        mcp_servers = mcp_cfg.get("mcp", {}).get("servers", []) or []
        if not mcp_servers:
            logger.debug("MCP client integration: no external servers configured")
            return
        from flowforge.core.mcp_integration import MCPIntegration
        integration = MCPIntegration(tool_registry=tool_registry)
        connected = 0
        for server in mcp_servers:
            srv_name = server.get("name", "unknown")
            if not server.get("enabled", False):
                logger.debug(f"MCP server '{srv_name}' disabled, skipping")
                continue
            try:
                import asyncio
                asyncio.get_event_loop().create_task(integration.connect_server(
                    name=srv_name,
                    command=server.get("command"),
                    args=server.get("args"),
                    url=server.get("url"),
                    env=server.get("env"),
                ))
                connected += 1
            except Exception as exc:
                logger.warning(f"Failed to connect MCP server '{srv_name}': {exc}")
        if connected:
            logger.info(f"MCP client integration: {connected} external server(s) connected")
    except Exception as exc:
        logger.warning(f"MCP client integration skipped: {exc}")


# ── FastAPI app ────────────────────────────────────────────────────────────

app = FastAPI(title="FlowForge API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Core services ──────────────────────────────────────────────────────────

event_bus = EventBus()
agent_registry = AgentRegistry()
_config_loader = ConfigLoader()
plugin_registry = PluginRegistry(config_loader=_config_loader)
tool_registry = ToolRegistry(tool_timeout=300)
mode_registry = ModeRegistry()

_models_config = _config_loader.get_models_config()
_models_yaml_path = _config_loader.config_dir / "models.yaml"
llm_router = LLMRouter(config_path=str(_models_yaml_path))
llm_client = LLMClient(models_config=_models_config, event_bus=event_bus, llm_router=llm_router)
tool_registry.register(llm_client)

register_core_tools(tool_registry, plugin_registry)
register_core_agents(agent_registry)
set_plugin_registry_instance(plugin_registry)
register_all_modes(mode_registry)

memory_manager = MemoryManager({"db_url": system_config.db_url})

event_store = EventStore(store_dir=str(_config_loader.config_dir / ".flowforge" / "events"))
set_event_store_instance(event_store)
logger.info(f"EventStore initialized with {event_store.entry_count} existing entries")

set_llm_client_instance(llm_client)

tool_chain_executor = ToolChainExecutor(llm_client, tool_registry, event_bus=event_bus)
set_tool_chain_executor_instance(tool_chain_executor)

model_service = ModelService(plugin_registry=plugin_registry)
set_model_service_instance(model_service)

_executor_instance = HybridExecutor(
    mode_registry, agent_registry, tool_registry, event_bus,
    memory_manager=memory_manager,
)
set_executor_instance(_executor_instance)

# PersonaLock singleton (Loop execution)
_persona_lock = PersonaLock()


def get_persona_lock() -> PersonaLock:
    """Get the global PersonaLock instance."""
    return _persona_lock


# LoopExecutor injection — activates Loop orchestration in HybridExecutor
try:
    from flowforge.harness.entropy_manager import EntropyManager, RuleEvolution
    from flowforge.harness.orchestrator import HarnessOrchestrator
    from flowforge.loop.executor import LoopExecutor
    from flowforge.loop.planner import LLMPlanner
    from flowforge.loop.reflector import ReflexionReflector
    from flowforge.loop.verifier import RuleBasedVerifier

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

# Plugin loader — encapsulates all plugin lifecycle state
plugin_loader = PluginLoader(
    agent_registry=agent_registry,
    tool_registry=tool_registry,
    mode_registry=mode_registry,
    event_bus=event_bus,
    plugin_registry=plugin_registry,
    llm_client=llm_client,
    model_service=model_service,
    memory_manager=memory_manager,
    event_store=event_store,
    scheduler=scheduler if system_config.scheduler_enabled else None,
    app=app,
)

plugin_manager = PluginManager()
set_plugin_manager_instance(plugin_manager)

# Lifecycle manager with all framework services
plugin_loader.lifecycle_manager = PluginLifecycleManager(
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

# Init graph/memory/prompts APIs
from flowforge.app.api.admin.prompts import init_prompts_api
from flowforge.app.api.memory.graph import init_graph_api
from flowforge.app.api.memory.memory import init_memory_api

init_graph_api(agent_registry, mode_registry, tool_registry)
init_prompts_api(str(_config_loader.config_dir))
init_memory_api(memory_manager)

# ── Route registration ─────────────────────────────────────────────────────

from flowforge.app.api.fusion_router import router as v1_fusion_router
app.include_router(v1_fusion_router)

app.include_router(router)

from flowforge.app.api.plugin_frontend_api import router as frontend_api_router
app.include_router(frontend_api_router)

# Optional routers (guarded imports)
for _module_path, _attr in [
    ("flowforge.app.api.endpoints.websocket", "router"),
    ("flowforge.app.api.core.openroute", "router"),
    ("flowforge.app.api.workspace.workspace", "router"),
    ("flowforge.app.api.workflows.plans", "router"),
    ("flowforge.app.api.workspace.uploads", "router"),
    ("flowforge.app.api.workflows.loops", "router"),
]:
    try:
        _mod = __import__(_module_path, fromlist=[_attr])
        app.include_router(getattr(_mod, _attr))
    except ImportError:
        pass


@app.get("/health")
@app.get("/api/v1/health")
def health():
    components = {
        "mode_registry": {"status": "healthy", "modes": len(mode_registry.list_modes())},
        "plugin_registry": {"status": "healthy", "plugins": len(plugin_registry.list_plugin_names())},
        "tool_registry": {"status": "healthy", "tools": len(tool_registry.list_tools())},
        "agent_registry": {"status": "healthy", "agents": len(agent_registry.list_agents())},
        "event_bus": {"status": "healthy"},
    }
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
    from flowforge.core.metrics import get_metrics as gm, get_prometheus_metrics
    prom_data = get_prometheus_metrics()
    if prom_data:
        from starlette.responses import Response
        return Response(content=prom_data, media_type="text/plain; version=0.0.4; charset=utf-8")
    return gm()


# ── Backward-compatible module-level access ────────────────────────────────
# Tests and a few API modules import legacy names directly from main.py.
# Using __getattr__ keeps these working without polluting the module namespace.

def __getattr__(name: str):
    """Lazy backward-compatible access to legacy plugin-loader attributes."""
    if name == "_loaded_plugins":
        return plugin_loader.loaded_plugins
    if name == "lifecycle_manager":
        return plugin_loader.lifecycle_manager
    if name == "frontend_registry":
        return plugin_loader.frontend_registry
    if name == "sandbox_manager":
        return plugin_loader.sandbox_manager
    if name == "_load_single_plugin":
        # Backward-compatible wrapper: old signature took multiple registries
        # as arguments; the new PluginLoader stores them internally.
        def _load_single_plugin_compat(plugin_instance, *args, **kwargs):
            return plugin_loader.load_single_plugin(plugin_instance)
        return _load_single_plugin_compat
    if name == "unload_plugin":
        return plugin_loader.unload_plugin
    if name == "reload_plugin":
        return plugin_loader.reload_plugin
    if name == "get_loaded_plugins":
        return plugin_loader.get_loaded_plugins
    if name == "_topological_sort_plugins":
        return PluginLoader._topological_sort_plugins
    if name == "_check_version_compatibility":
        return PluginLoader._check_version_compatibility
    if name == "_load_domain_plugins":
        return plugin_loader.load_domain_plugins
    if name == "auto_discover_plugins":
        return plugin_loader.auto_discover_plugins
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


if __name__ == "__main__":
    uvicorn.run(app, host=system_config.server_host, port=system_config.server_port)
