from flowforge.agents.generic.react_thinker import ReactThinkerAgent
from flowforge.agents.generic.react_actor import ReactActorAgent
from flowforge.agents.generic.react_observer import ReactObserverAgent
from flowforge.agents.generic.planner import PlannerAgent
from flowforge.agents.generic.executor import ExecutorAgent
from flowforge.agents.generic.verifier import VerifierAgent
from flowforge.agents.generic.reviewer import ReviewerAgent
from flowforge.agents.generic.drafter import DrafterAgent
from flowforge.agents.generic.critic import CriticAgent
from flowforge.agents.generic.refiner import RefinerAgent
from flowforge.agents.generic.analyst import AnalystAgent
from flowforge.agents.generic.processor import ProcessorAgent
from flowforge.agents.generic.validator import ValidatorAgent
from flowforge.agents.generic.deliverer import DelivererAgent
from flowforge.agents.generic.finalizer import FinalizerAgent
from flowforge.agents.generic.approver import ApproverAgent
from flowforge.agents.generic.generator import GeneratorAgent
from flowforge.agents.generic.web_search_agent import WebSearchAgent
from flowforge.agents.generic.research_agent import ResearchAgent
from flowforge.agents.generic.multilingual import MultilingualAgent
from flowforge.agents.generic.fact_check import FactCheckAgent
from flowforge.agents.generic.trend_analysis import TrendAnalysisAgent
from flowforge.agents.generic.image_research import ImageResearchAgent
# ContentForge domain agents — now imported from contentforge package
from contentforge.agents.article_writing import ArticleWritingAgent
from contentforge.agents.article_eval import ArticleEvalAgent
from contentforge.agents.article_reflect import ArticleReflectAgent
from contentforge.agents.topic_research import TopicResearchAgent
from contentforge.agents.material_collection import MaterialCollectionAgent
from contentforge.agents.content_audit import ContentAuditAgent
from contentforge.agents.publishing import PublishingAgent
from contentforge.agents.seo_optimization import SEOOptimizationAgent
from contentforge.agents.headline_optimizer import HeadlineOptimizerAgent
from contentforge.agents.content_repurposer import ContentRepurposerAgent
# DevForge domain agents — now imported from devforge package
from devforge.agents.code_writer_agent import CodeWriterAgent

GENERIC_AGENTS = [
    ReactThinkerAgent,
    ReactActorAgent,
    ReactObserverAgent,
    PlannerAgent,
    ExecutorAgent,
    VerifierAgent,
    ReviewerAgent,
    DrafterAgent,
    CriticAgent,
    RefinerAgent,
    AnalystAgent,
    ProcessorAgent,
    ValidatorAgent,
    DelivererAgent,
    FinalizerAgent,
    ApproverAgent,
    GeneratorAgent,
    WebSearchAgent,
    ResearchAgent,
    MultilingualAgent,
    FactCheckAgent,
    TrendAnalysisAgent,
    ImageResearchAgent,
    ArticleWritingAgent,
    ArticleEvalAgent,
    ArticleReflectAgent,
    TopicResearchAgent,
    MaterialCollectionAgent,
    ContentAuditAgent,
    PublishingAgent,
    CodeWriterAgent,
    SEOOptimizationAgent,
    HeadlineOptimizerAgent,
    ContentRepurposerAgent,
]
