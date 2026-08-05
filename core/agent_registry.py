from collections.abc import Callable

from flowforge.core.base_agent import BaseAgent
from flowforge.core.tracing import get_logger

logger = get_logger("agent_registry")


class AgentRegistry:
    """独立 Agent 注册中心，与 DIContainer 解耦。"""

    def __init__(self):
        self._agents: dict[str, BaseAgent] = {}
        self._factories: dict[str, Callable] = {}

    def register(self, agent: BaseAgent) -> None:
        if agent.name in self._agents:
            logger.debug(f"Agent '{agent.name}' already registered, skipping duplicate")
            return
        self._agents[agent.name] = agent

    def register_factory(self, name: str, factory: Callable) -> None:
        if name in self._factories:
            logger.debug(f"Agent factory '{name}' already registered, skipping duplicate")
            return
        self._factories[name] = factory

    def get(self, name: str) -> BaseAgent | None:
        if name in self._agents:
            return self._agents[name]
        if name in self._factories:
            agent = self._factories[name]()
            self._agents[name] = agent
            return agent
        return None

    def list_agents(self) -> list[str]:
        names = set(self._agents.keys()) | set(self._factories.keys())
        return sorted(names)

    def unregister(self, name: str) -> None:
        """Remove a registered agent by name.

        Removes from both direct registrations and factories.

        Raises:
            KeyError: If the agent name is not registered.
        """
        found = False
        if name in self._agents:
            del self._agents[name]
            found = True
        if name in self._factories:
            del self._factories[name]
            found = True
        if not found:
            raise KeyError(f"Agent '{name}' not registered")

    def get_all(self) -> dict[str, BaseAgent]:
        for name in list(self._factories.keys()):
            if name not in self._agents:
                self._agents[name] = self._factories[name]()
        return dict(self._agents)
