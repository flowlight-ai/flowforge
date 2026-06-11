from flowforge.agents.topic_research import TopicResearchAgent
from flowforge.agents.article_writing import ArticleWritingAgent
from flowforge.agents.material_collection import MaterialCollectionAgent
from flowforge.agents.seo_optimization import SEOOptimizationAgent
from flowforge.agents.content_audit import ContentAuditAgent
from flowforge.agents.publishing import PublishingAgent
from flowforge.agents.headline_optimizer import HeadlineOptimizerAgent
from flowforge.agents.content_repurposer import ContentRepurposerAgent
from flowforge.agents.article_eval import ArticleEvalAgent
from flowforge.agents.article_reflect import ArticleReflectAgent
from flowforge.agents.code_writer_agent import CodeWriterAgent

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
