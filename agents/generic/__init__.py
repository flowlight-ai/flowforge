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

# ContentForge domain agents have been migrated to contentforge package.
# Use: from contentforge.agents.xxx import XxxAgent
# DevForge domain agents have been migrated to devforge package.
# Use: from devforge.agents.xxx import XxxAgent

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
]
