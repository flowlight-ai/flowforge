import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from flowforge.core.config import system_config, ConfigLoader
from flowforge.core.di import DIContainer
from flowforge.core.agent_registry import AgentRegistry
from flowforge.tools.registry import ToolRegistry
from flowforge.tools.llm_client import LLMClient
from flowforge.tools.llm.model_service import ModelService
from flowforge.tools.helixrag_client import HelixRAGClient
from flowforge.tools.web_search import WebSearchTool
from flowforge.tools.python_executor import PythonExecutorTool
from flowforge.tools.file_rw import FileReadWriteTool
from flowforge.tools.cache import CacheTool
from flowforge.tools.tavily_search import TavilySearchTool
from flowforge.tools.duckduckgo_search import DuckDuckGoSearchTool
from flowforge.tools.web_scraper import WebScraperTool
from flowforge.tools.toutiao_publisher import ToutiaoPublisherTool
from flowforge.tools.wechat_publisher import WeChatPublisherTool
from flowforge.tools.pexels_image import PexelsImageTool
from flowforge.tools.sendgrid_mail import SendGridMailTool
from flowforge.tools.webhook import WebhookTool
from flowforge.tools.shell_command import ShellCommandTool
from flowforge.tools.workspace_file import WorkspaceFileTool
from flowforge.tools.local_publish import LocalPublishTool
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
from flowforge.agents.topic_research import TopicResearchAgent
from flowforge.agents.article_writing import ArticleWritingAgent
from flowforge.agents.material_collection import MaterialCollectionAgent
from flowforge.agents.seo_optimization import SEOOptimizationAgent
from flowforge.agents.fact_check import FactCheckAgent
from flowforge.agents.content_audit import ContentAuditAgent
from flowforge.agents.trend_analysis import TrendAnalysisAgent
from flowforge.agents.publishing import PublishingAgent
from flowforge.agents.headline_optimizer import HeadlineOptimizerAgent
from flowforge.agents.content_repurposer import ContentRepurposerAgent
from flowforge.agents.image_research import ImageResearchAgent
from flowforge.agents.multilingual import MultilingualAgent
from flowforge.agents.web_search_agent import WebSearchAgent
from flowforge.agents.code_writer_agent import CodeWriterAgent
from flowforge.agents.research_agent import ResearchAgent
from flowforge.app.api.router import router
from flowforge.app.deps import (
    set_executor_instance, set_llm_client_instance,
    set_model_service_instance,
    set_scheduler_instance, set_plugin_manager_instance,
    set_tool_chain_executor_instance,
)
from flowforge.core import metrics
from flowforge.scheduler.scheduler import TaskScheduler
from flowforge.core.plugin_manager import PluginManager
from flowforge.tools.webproxy_service import get_webproxy_service
from flowforge.core.tracing import get_logger

logger = get_logger("main")

@asynccontextmanager
async def lifespan(app):
    if system_config.scheduler_enabled:
        scheduler.start()
        logger.info("Scheduler started")
    logger.info(f"FlowForge API started - {len(mode_registry.list_modes())} modes, {len(tool_registry.list_tools())} tools, {len(agent_registry.list_agents())} agents")
    yield
    svc = get_webproxy_service()
    if svc.is_running:
        svc.stop()
        logger.info("WebProxy service stopped on shutdown")
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
tool_registry = ToolRegistry()
mode_registry = ModeRegistry()

_config_loader = ConfigLoader()
_models_config = _config_loader.get_models_config()
llm_client = LLMClient(models_config=_models_config, event_bus=event_bus)
tool_registry.register(llm_client)
if system_config.helixrag_enabled:
    tool_registry.register(HelixRAGClient())
tool_registry.register(WebSearchTool())
tool_registry.register(PythonExecutorTool())
tool_registry.register(FileReadWriteTool())
tool_registry.register(CacheTool())
tool_registry.register(ShellCommandTool())
tool_registry.register(WorkspaceFileTool())
tool_registry.register(LocalPublishTool())

_optional_tools = [
    (TavilySearchTool, "TAVILY_API_KEY"),
    (DuckDuckGoSearchTool, None),
    (WebScraperTool, None),
    (ToutiaoPublisherTool, "TOUTIAO_ACCESS_TOKEN"),
    (WeChatPublisherTool, "WECHAT_APP_ID"),
    (PexelsImageTool, "PEXELS_API_KEY"),
    (SendGridMailTool, "SENDGRID_API_KEY"),
    (WebhookTool, None),
]
for tool_cls, env_key in _optional_tools:
    try:
        if env_key is None or __import__("os").getenv(env_key, ""):
            tool_registry.register(tool_cls())
    except Exception as e:
        logger.debug(f"Skip tool {tool_cls.__name__}: {e}")

set_llm_client_instance(llm_client)

from flowforge.core.tool_chain_executor import ToolChainExecutor
tool_chain_executor = ToolChainExecutor(llm_client, tool_registry, event_bus=event_bus)
set_tool_chain_executor_instance(tool_chain_executor)

model_service = ModelService()
set_model_service_instance(model_service)

mode_registry.register(WorkflowExecutor())
mode_registry.register(ReflexionExecutor())
mode_registry.register(ReActExecutor())
mode_registry.register(PlanExecuteExecutor())
mode_registry.register(MultiAgentExecutor())
mode_registry.register(ReWOOExecutor())
mode_registry.register(SelfDiscoverExecutor())
mode_registry.register(AgentJudgeExecutor())
mode_registry.register(GraphOfThoughtsExecutor())

agent_registry.register_factory("topic_research", lambda: TopicResearchAgent())
agent_registry.register_factory("article_writing", lambda: ArticleWritingAgent())
agent_registry.register_factory("material_collection", lambda: MaterialCollectionAgent())
agent_registry.register_factory("seo_optimization", lambda: SEOOptimizationAgent())
agent_registry.register_factory("fact_check", lambda: FactCheckAgent())
agent_registry.register_factory("content_audit", lambda: ContentAuditAgent())
agent_registry.register_factory("trend_analysis", lambda: TrendAnalysisAgent())
agent_registry.register_factory("publishing", lambda: PublishingAgent())
agent_registry.register_factory("headline_optimizer", lambda: HeadlineOptimizerAgent())
agent_registry.register_factory("content_repurposer", lambda: ContentRepurposerAgent())
agent_registry.register_factory("image_research", lambda: ImageResearchAgent())
agent_registry.register_factory("multilingual", lambda: MultilingualAgent())
agent_registry.register_factory("web_search_agent", lambda: WebSearchAgent())
agent_registry.register_factory("code_writer_agent", lambda: CodeWriterAgent())
agent_registry.register_factory("research_agent", lambda: ResearchAgent())

memory_manager = MemoryManager({"db_url": system_config.db_url})

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
from flowforge.core.config import ConfigLoader

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
    from flowforge.app.api.endpoints import webproxy as webproxy_endpoints
    app.include_router(webproxy_endpoints.router)
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
        svc = get_webproxy_service()
        if svc.is_running:
            components["webproxy"] = {"status": "running", "port": svc.port}
        else:
            components["webproxy"] = {"status": "stopped"}
    except Exception:
        components["webproxy"] = {"status": "unknown"}
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
