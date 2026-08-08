import pytest
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.task_context import TaskContext
from flowforge.core.errors import FlowForgeError, ConflictError, ModeNotFoundError, WorkflowRecursionError
from flowforge.core.di import DIContainer

class MockAgent(BaseAgent):
    name = "test"
    async def execute(self, input: AgentInput) -> AgentOutput:
        return AgentOutput(result={"echo": input.params.get("msg", "")})

class MockTool(BaseTool):
    name = "echo"
    async def execute(self, input: ToolInput) -> ToolOutput:
        return ToolOutput(result={"echo": input.params.get("msg", "")})

@pytest.mark.asyncio
async def test_agent_execute():
    agent = MockAgent()
    output = await agent.execute(AgentInput(params={"msg": "hello"}))
    assert output.result["echo"] == "hello"

@pytest.mark.asyncio
async def test_agent_execute_with_context():
    agent = MockAgent()
    ctx = TaskContext(task_id="t1", input_data={})
    output = await agent.execute_with_context(AgentInput(params={"msg": "world"}), ctx)
    assert output.result["echo"] == "world"

@pytest.mark.asyncio
async def test_tool_execute():
    tool = MockTool()
    output = await tool.execute(ToolInput(params={"msg": "test"}))
    assert output.result["echo"] == "test"

def test_task_context_from_parent():
    parent = TaskContext(task_id="t1", input_data={"key": "val"}, metadata={"m": 1}, state={"s": 1})
    child = TaskContext.from_parent(parent, input_data={"key": "child"})
    assert child.task_id == "t1/sub"
    assert child.input_data == {"key": "child"}
    assert child.metadata["m"] == 1
    child.state["s"] = 999
    assert parent.state["s"] == 1

def test_errors():
    assert FlowForgeError().status_code == 500
    assert ConflictError().status_code == 409
    assert ModeNotFoundError().status_code == 404
    assert WorkflowRecursionError().status_code == 400

def test_di_container():
    container = DIContainer()
    container.register_singleton("test", lambda: "hello")
    assert container.resolve("test") == "hello"
    container.register_agent("agent1", lambda: MockAgent())
    agents = container.resolve_all_agents()
    assert "agent1" in agents
    assert container.get("nonexistent") is None
