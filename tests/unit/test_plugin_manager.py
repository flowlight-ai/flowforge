import pytest
from flowforge.core.plugin_manager import PluginManager
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.agent_registry import AgentRegistry
from flowforge.tools.registry import ToolRegistry
from flowforge.modes.registry import ModeRegistry
from flowforge.modes.react import ReActExecutor


class PluginAgent(BaseAgent):
    name = "plugin_agent"
    description = "Agent from plugin"

    async def execute(self, input: AgentInput) -> AgentOutput:
        return AgentOutput(result={"ok": True})


class PluginTool(BaseTool):
    name = "plugin_tool"
    description = "Tool from plugin"

    async def execute(self, input: ToolInput) -> ToolOutput:
        return ToolOutput(result={"ok": True})


def register():
    return PluginAgent()


def test_plugin_manager_init():
    pm = PluginManager()
    status = pm.get_status()
    assert "loaded" in status
    assert "modes" in status["loaded"]
    assert "agents" in status["loaded"]
    assert "tools" in status["loaded"]
    assert "workflows" in status["loaded"]


def test_load_from_config_empty():
    pm = PluginManager()
    result = pm.load_from_config({})
    assert result["modes"] == []
    assert result["agents"] == []
    assert result["tools"] == []
    assert result["workflows"] == []


def test_load_from_config_with_string_modules():
    pm = PluginManager()
    config = {
        "agents": ["flowforge.agents.generic.fact_check:FactCheckAgent"],
    }
    result = pm.load_from_config(config)
    assert len(result["agents"]) == 1
    agent = result["agents"][0]()
    assert agent.name == "fact_check"


def test_load_from_config_with_dict_modules():
    pm = PluginManager()
    config = {
        "agents": [{"module": "flowforge.agents.generic.fact_check:FactCheckAgent"}],
    }
    result = pm.load_from_config(config)
    assert len(result["agents"]) == 1


def test_load_from_config_invalid_module():
    pm = PluginManager()
    config = {
        "agents": ["nonexistent.module.path:Something"],
    }
    result = pm.load_from_config(config)
    assert len(result["agents"]) == 0


def test_get_status_after_load():
    pm = PluginManager()
    pm.load_from_config({
        "agents": ["flowforge.agents.generic.fact_check:FactCheckAgent"],
    })
    status = pm.get_status()
    assert "fact_check" in status["loaded"]["agents"] or \
           "flowforge.agents.generic.fact_check:FactCheckAgent" in status["loaded"]["agents"]


def test_register_all_with_config_tools():
    pm = PluginManager()
    mode_registry = ModeRegistry()
    mode_registry.register(ReActExecutor())
    agent_registry = AgentRegistry()
    tool_registry = ToolRegistry()

    pm.load_from_config({
        "tools": ["flowforge.tools.cache:CacheTool"],
    })
    pm.register_all(mode_registry, agent_registry, tool_registry)
    assert "cache" in tool_registry.list_tools()
