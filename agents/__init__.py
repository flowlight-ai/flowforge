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

from flowforge.agents.generic import GENERIC_AGENTS

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
]

ALL_AGENTS = CONTENT_AGENTS + GENERIC_AGENTS
