"""FlowForge API application entry point.

This module contains **only** FastAPI app creation, lifespan wiring, route
mounting, and trivial health/metrics endpoints.  All implementation code
(plugin loading, tool/agent/mode registration) lives in ``core/``:

- :mod:`flowforge.core.bootstrap` — registry bootstrap helpers
- :mod:`flowforge.core.plugin_loader` — plugin lifecycle orchestration
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from flowforge.app.api.router import router
from flowforge.app.deps import (
    set_event_store_instance,
    set_executor_instance,
    set_llm_client_instance,
    set_model_service_instance,
    set_plugin_manager_instance,
    set_plugin_registry_instance,
    set_scheduler_instance,
    set_tool_chain_executor_instance,
)
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
    yield

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
    # NOTE: allow_origins=["*"] + allow_credentials=True causes Starlette to
    # reject WebSocket upgrade requests with 403 Forbidden. For local dev we
    # use wildcard origins with credentials disabled.
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

# Web Fusion v1 router — must register before legacy router so static paths
# (e.g. /memory/collections) aren't captured by dynamic paths.
from flowforge.app.api.fusion_router import router as v1_fusion_router

app.include_router(v1_fusion_router)

app.include_router(router)

from flowforge.app.api.plugin_frontend_api import router as frontend_api_router

app.include_router(frontend_api_router)

# Optional routers (guarded imports for environments without these modules)
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

# ForgeMind Council Chat — mounted directly on app
try:
    from flowforge.app.api.agents import council as council_endpoints
    app.include_router(council_endpoints.router)
except ImportError as _e:
    logger.warning(f"council router not loaded: {_e}")

# Static web UI (Forgekin Council chat page)
try:
    from fastapi.responses import HTMLResponse
    from fastapi.staticfiles import StaticFiles

    _web_static_dir = Path(__file__).resolve().parent.parent / "web_legacy_backup" / "static"
    if _web_static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(_web_static_dir)), name="web_static")

        @app.get("/", response_class=HTMLResponse, include_in_schema=False)
        async def _serve_chat_ui() -> str:
            return (_web_static_dir / "index.html").read_text(encoding="utf-8")

        logger.info(f"Web UI mounted at / (static dir: {_web_static_dir})")
    else:
        logger.warning(f"Web static dir not found: {_web_static_dir}")
except Exception as _e:  # noqa: BLE001
    logger.warning(f"Web UI mount failed: {_e}")

# Legacy compat routes for T7/T8 E2E tests
try:
    from flowforge.app.api.agents import council as _council_compat
    from flowforge.app.api.agents import verify as _verify_compat

    @app.get("/api/agents", include_in_schema=False)
    async def _legacy_list_agents() -> dict:
        return await _council_compat.list_agents()

    @app.post("/api/chat", include_in_schema=False)
    async def _legacy_send_message(payload: dict) -> dict:
        return await _council_compat.send_message(payload)

    app.include_router(_verify_compat.router, prefix="/api")
    logger.info("Legacy compat routes mounted: /api/agents, /api/chat, /api/verify/t7, /api/verify/t8")
except ImportError as _e:
    logger.warning(f"Legacy compat routes not mounted: {_e}")


@app.websocket("/test-ws")
async def diagnostic_ws(ws: WebSocket):
    """Bare-minimum WebSocket echo for connectivity testing."""
    logger.info(f"[test-ws] CONNECT ATTEMPT from {ws.client.host if ws.client else '?'}")
    try:
        await ws.accept()
        logger.info("[test-ws] ACCEPTED")
        await ws.send_text("hello from /test-ws")
        while True:
            data = await ws.receive_text()
            await ws.send_text(f"echo: {data}")
    except Exception as exc:
        logger.warning(f"[test-ws] ERROR: {exc!r}")


@app.get("/health")
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
    from flowforge.core.metrics import get_metrics as gm
    from flowforge.core.metrics import get_prometheus_metrics
    prom_data = get_prometheus_metrics()
    if prom_data:
        from starlette.responses import Response
        return Response(content=prom_data, media_type="text/plain; version=0.0.4; charset=utf-8")
    return gm()


if __name__ == "__main__":
    uvicorn.run(app, host=system_config.server_host, port=system_config.server_port)
