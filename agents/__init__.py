# ContentForge domain agents — now imported from contentforge package
from contentforge.agents.topic_research import TopicResearchAgent
from contentforge.agents.article_writing import ArticleWritingAgent
from contentforge.agents.material_collection import MaterialCollectionAgent
from contentforge.agents.seo_optimization import SEOOptimizationAgent
from contentforge.agents.content_audit import ContentAuditAgent
from contentforge.agents.publishing import PublishingAgent
from contentforge.agents.headline_optimizer import HeadlineOptimizerAgent
from contentforge.agents.content_repurposer import ContentRepurposerAgent
from contentforge.agents.article_eval import ArticleEvalAgent
from contentforge.agents.article_reflect import ArticleReflectAgent

# DevForge domain agents — now imported from devforge package
from devforge.agents.code_writer_agent import CodeWriterAgent

from flowforge.agents.generic import GENERIC_AGENTS
# Re-export generic agents that replace removed flat agents
from flowforge.agents.generic.fact_check import FactCheckAgent
from flowforge.agents.generic.trend_analysis import TrendAnalysisAgent
from flowforge.agents.generic.image_research import ImageResearchAgent
from flowforge.agents.generic.multilingual import MultilingualAgent
from flowforge.agents.generic.web_search_agent import WebSearchAgent
from flowforge.agents.generic.research_agent import ResearchAgent

CONTENT_AGENTS = [
    TopicResearchAgent,
    ArticleWritingAgent,
    MaterialCollectionAgent,
    SEOOptimizationAgent,
    FactCheckAgent,
    ContentAuditAgent,
    TrendAnalysisAgent,
    PublishingAgent,
    HeadlineOptimizerAgent,
    ContentRepurposerAgent,
    ImageResearchAgent,
    MultilingualAgent,
    ArticleEvalAgent,
    ArticleReflectAgent,
    CodeWriterAgent,
    WebSearchAgent,
    ResearchAgent,
]

ALL_AGENTS = CONTENT_AGENTS + GENERIC_AGENTS


def register_agents(agent_registry) -> None:
    for agent_cls in ALL_AGENTS:
        try:
            agent = agent_cls()
            agent_registry.register(agent)
        except Exception as e:
            import logging
            logging.getLogger(__name__).debug(f"Skip agent {agent_cls.__name__}: {e}")
