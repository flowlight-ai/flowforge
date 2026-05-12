import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import system_config
from core.di import DIContainer
from tools.registry import ToolRegistry
from tools.llm_client import LLMClient
from tools.helixrag_client import HelixRAGClient
from tools.web_search import WebSearchTool
from tools.python_executor import PythonExecutorTool
from tools.file_rw import FileReadWriteTool
from tools.cache import CacheTool
from events.event_bus import EventBus
from modes.registry import ModeRegistry
from modes.workflow import WorkflowExecutor
from modes.reflexion import ReflexionExecutor
from modes.react import ReActExecutor
from modes.plan_execute import PlanExecuteExecutor
from modes.multi_agent import MultiAgentExecutor
from modes.rewoo import ReWOOExecutor
from modes.self_discover import SelfDiscoverExecutor
from modes.agent_judge import AgentJudgeExecutor
from modes.graph_of_thoughts import GraphOfThoughtsExecutor
from executor.hybrid_executor import HybridExecutor
from memory.manager import MemoryManager
from agents.topic_research import TopicResearchAgent
from agents.article_writing import ArticleWritingAgent
from agents.material_collection import MaterialCollectionAgent
from agents.seo_optimization import SEOOptimizationAgent
from agents.fact_check import FactCheckAgent
from agents.content_audit import ContentAuditAgent
from agents.trend_analysis import TrendAnalysisAgent
from agents.publishing import PublishingAgent
from agents.headline_optimizer import HeadlineOptimizerAgent
from agents.content_repurposer import ContentRepurposerAgent
from agents.image_research import ImageResearchAgent
from agents.multilingual import MultilingualAgent
from app.api.router import router
from app.deps import set_executor_instance
from core import metrics

app = FastAPI(title="FlowForge API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

container = DIContainer()
event_bus = EventBus()
tool_registry = ToolRegistry()
mode_registry = ModeRegistry()

tool_registry.register(LLMClient())
tool_registry.register(HelixRAGClient())
tool_registry.register(WebSearchTool())
tool_registry.register(PythonExecutorTool())
tool_registry.register(FileReadWriteTool())
tool_registry.register(CacheTool())

mode_registry.register(WorkflowExecutor())
mode_registry.register(ReflexionExecutor())
mode_registry.register(ReActExecutor())
mode_registry.register(PlanExecuteExecutor())
mode_registry.register(MultiAgentExecutor())
mode_registry.register(ReWOOExecutor())
mode_registry.register(SelfDiscoverExecutor())
mode_registry.register(AgentJudgeExecutor())
mode_registry.register(GraphOfThoughtsExecutor())

container.register_agent("topic_research", lambda: TopicResearchAgent())
container.register_agent("article_writing", lambda: ArticleWritingAgent())
container.register_agent("material_collection", lambda: MaterialCollectionAgent())
container.register_agent("seo_optimization", lambda: SEOOptimizationAgent())
container.register_agent("fact_check", lambda: FactCheckAgent())
container.register_agent("content_audit", lambda: ContentAuditAgent())
container.register_agent("trend_analysis", lambda: TrendAnalysisAgent())
container.register_agent("publishing", lambda: PublishingAgent())
container.register_agent("headline_optimizer", lambda: HeadlineOptimizerAgent())
container.register_agent("content_repurposer", lambda: ContentRepurposerAgent())
container.register_agent("image_research", lambda: ImageResearchAgent())
container.register_agent("multilingual", lambda: MultilingualAgent())

memory_manager = MemoryManager({"db_url": system_config.db_url})

_executor_instance = HybridExecutor(
    mode_registry, container, tool_registry, event_bus,
    memory_manager=memory_manager
)
set_executor_instance(_executor_instance)

app.include_router(router)

try:
    from app.api.endpoints import websocket as ws_endpoints
    app.include_router(ws_endpoints.router)
except ImportError:
    pass

@app.get("/health")
def health():
    return {"status": "healthy", "mode_registry": mode_registry.list_modes()}

@app.get("/metrics")
def get_metrics():
    from core.metrics import get_metrics as gm
    return gm()

if __name__ == "__main__":
    uvicorn.run(app, host=system_config.server_host, port=system_config.server_port)
