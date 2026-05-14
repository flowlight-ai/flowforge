import pytest
from flowforge.core.agent_registry import AgentRegistry
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput


class DummyAgent(BaseAgent):
    name = "dummy"
    description = "Dummy agent for testing"

    async def execute(self, input: AgentInput) -> AgentOutput:
        return AgentOutput(result={"echo": input.params.get("msg", "")})


class AnotherAgent(BaseAgent):
    name = "another"
    description = "Another agent for testing"

    async def execute(self, input: AgentInput) -> AgentOutput:
        return AgentOutput(result={"ok": True})


def test_register_agent():
    registry = AgentRegistry()
    agent = DummyAgent()
    registry.register(agent)
    assert registry.get("dummy") is agent


def test_register_duplicate_raises():
    registry = AgentRegistry()
    registry.register(DummyAgent())
    with pytest.raises(ValueError, match="already registered"):
        registry.register(DummyAgent())


def test_get_nonexistent():
    registry = AgentRegistry()
    assert registry.get("nonexistent") is None


def test_register_factory():
    registry = AgentRegistry()
    registry.register_factory("dummy", DummyAgent)
    agent = registry.get("dummy")
    assert agent is not None
    assert agent.name == "dummy"


def test_register_factory_lazy_instantiation():
    registry = AgentRegistry()
    registry.register_factory("dummy", DummyAgent)
    agent1 = registry.get("dummy")
    agent2 = registry.get("dummy")
    assert agent1 is agent2


def test_list_agents():
    registry = AgentRegistry()
    registry.register(DummyAgent())
    registry.register_factory("another", AnotherAgent)
    names = registry.list_agents()
    assert "dummy" in names
    assert "another" in names


def test_list_agents_empty():
    registry = AgentRegistry()
    assert registry.list_agents() == []


def test_get_all():
    registry = AgentRegistry()
    registry.register(DummyAgent())
    registry.register_factory("another", AnotherAgent)
    all_agents = registry.get_all()
    assert "dummy" in all_agents
    assert "another" in all_agents
    assert all_agents["dummy"].name == "dummy"
    assert all_agents["another"].name == "another"


def test_get_all_instantiates_factories():
    registry = AgentRegistry()
    registry.register_factory("dummy", DummyAgent)
    registry.register_factory("another", AnotherAgent)
    all_agents = registry.get_all()
    assert len(all_agents) == 2
    assert isinstance(all_agents["dummy"], DummyAgent)
    assert isinstance(all_agents["another"], AnotherAgent)
