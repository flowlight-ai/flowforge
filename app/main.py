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
)
from flowforge.core import metrics
from flowforge.scheduler.scheduler import TaskScheduler
from flowforge.core.plugin_manager import PluginManager
from flowforge.core.tracing import get_logger, load_logging_config

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
        tool_registry.register(WebSearchTool(
            primary="opensieve_search",
            fallback="tavily_search",
            fallback_chain=["opensieve_search", "tavily_search", "duckduckgo_search"],
        ))
    except ImportError:
        logger.debug("WebSearchTool not available")

    import os as _os
    _optional = []
    for mod_name, cls_name, env_key in [
        ("flowforge.tools.tavily_search", "TavilySearchTool", "TAVILY_API_KEY"),
        ("flowforge.tools.duckduckgo_search", "DuckDuckGoSearchTool", None),
        ("flowforge.tools.web_scraper", "WebScraperTool", None),
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


def _register_all_modes(mode_registry: ModeRegistry):
    for executor_cls in [
        WorkflowExecutor, ReflexionExecutor, ReActExecutor,
        PlanExecuteExecutor, MultiAgentExecutor, ReWOOExecutor,
        SelfDiscoverExecutor, AgentJudgeExecutor, GraphOfThoughtsExecutor,
    ]:
        mode_registry.register(executor_cls())


def _load_domain_plugins(agent_registry: AgentRegistry, tool_registry: ToolRegistry):
    import importlib
    import os
    domain_module = os.getenv("FLOWFORGE_DOMAIN_MODULE", "")
    if not domain_module:
        return
    for mod_path in domain_module.split(","):
        mod_path = mod_path.strip()
        if not mod_path:
            continue
        try:
            mod = importlib.import_module(mod_path)
            if hasattr(mod, "register_agents"):
                mod.register_agents(agent_registry)
                logger.info(f"Registered agents from {mod_path}")
            if hasattr(mod, "register_tools"):
                mod.register_tools(tool_registry)
                logger.info(f"Registered tools from {mod_path}")
        except ImportError as e:
            logger.warning(f"Failed to load domain plugin {mod_path}: {e}")


@asynccontextmanager
async def lifespan(app):
    await plugin_registry.load_from_config("plugins.yaml")
    plugin_registry.start_health_monitoring()
    plugin_registry.set_tool_timeout(300)

    tool_registry.set_plugin_registry(plugin_registry)

    web_search_plugin = plugin_registry.get_plugin("web_search")
    if web_search_plugin and hasattr(web_search_plugin, "set_plugin_registry"):
        web_search_plugin.set_plugin_registry(plugin_registry)

    try:
        ws_tool = tool_registry._tools.get("web_search")
        if ws_tool and hasattr(ws_tool, "set_plugin_registry"):
            ws_tool.set_plugin_registry(plugin_registry)
    except Exception as e:
        logger.warning(f"Failed to set plugin_registry for web_search tool: {e}")

    _load_domain_plugins(agent_registry, tool_registry)

    if system_config.scheduler_enabled:
        scheduler.start()
        logger.info("Scheduler started")
    logger.info(
        f"FlowForge API started - "
        f"{len(mode_registry.list_modes())} modes, "
        f"{len(plugin_registry.list_plugin_names())} plugins, "
        f"{len(agent_registry.list_agents())} agents"
    )
    yield
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
llm_client = LLMClient(models_config=_models_config, event_bus=event_bus)
tool_registry.register(llm_client)

_register_core_tools(tool_registry, plugin_registry)

set_plugin_registry_instance(plugin_registry)

_register_all_modes(mode_registry)

memory_manager = MemoryManager({"db_url": system_config.db_url})

set_llm_client_instance(llm_client)

from flowforge.core.tool_chain_executor import ToolChainExecutor
tool_chain_executor = ToolChainExecutor(llm_client, tool_registry, event_bus=event_bus)
set_tool_chain_executor_instance(tool_chain_executor)

model_service = ModelService()
set_model_service_instance(model_service)

_executor_instance = HybridExecutor(
    mode_registry, agent_registry, tool_registry, event_bus,
    memory_manager=memory_manager
)
set_executor_instance(_executor_instance)

try:
    from flowforge.app.api.endpoints.websocket import manager as ws_manager
    _executor_instance.set_solo_manager(ws_manager)
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

app.include_router(router)

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
