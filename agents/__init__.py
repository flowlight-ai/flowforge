from flowforge.agents.generic import GENERIC_AGENTS

# Re-export generic agents for backwards-compatible imports
from flowforge.agents.generic.fact_check import FactCheckAgent
from flowforge.agents.generic.image_research import ImageResearchAgent
from flowforge.agents.generic.multilingual import MultilingualAgent
from flowforge.agents.generic.research_agent import ResearchAgent
from flowforge.agents.generic.trend_analysis import TrendAnalysisAgent
from flowforge.agents.generic.web_search_agent import WebSearchAgent

ALL_AGENTS = GENERIC_AGENTS


def register_agents(agent_registry) -> None:
    for agent_cls in ALL_AGENTS:
        try:
            agent = agent_cls()
            agent_registry.register(agent)
        except Exception as e:
            import logging
            logging.getLogger(__name__).debug(f"Skip agent {agent_cls.__name__}: {e}")
