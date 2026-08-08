import pytest
from flowforge.memory.compressor import ContextCompressor
from flowforge.core.task_context import TaskContext
from flowforge.events.event_bus import EventBus
from flowforge.tools.registry import ToolRegistry
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput


class MockLLM(BaseTool):
    name = "llm"
    description = "Mock LLM"
    parameters_schema = {}

    async def execute(self, input):
        return ToolOutput(result={"content": "Compressed summary of earlier conversation"})


def test_count_tokens():
    from flowforge.memory.compressor import _count_tokens
    assert _count_tokens("hello world") > 0
    assert _count_tokens("你好世界") > 0


@pytest.mark.asyncio
async def test_compress_not_needed():
    compressor = ContextCompressor()
    compressor._max_context_tokens = 100000
    messages = [{"role": "user", "content": "Hello"}]
    result = await compressor.compress_if_needed(messages, TaskContext(task_id="t1", input_data={}))
    assert result == messages


@pytest.mark.asyncio
async def test_compress_triggered():
    tool_registry = ToolRegistry()
    tool_registry.register(MockLLM())
    event_bus = EventBus()

    compressor = ContextCompressor()
    compressor._max_context_tokens = 100

    messages = []
    for i in range(20):
        messages.append({"role": "user", "content": f"Task {i} " * 50})
        messages.append({"role": "assistant", "content": f"Response {i} " * 50})

    ctx = TaskContext(task_id="t1", input_data={})
    ctx.tools = tool_registry
    ctx.event_bus = event_bus

    result = await compressor.compress_if_needed(messages, ctx)
    assert len(result) < len(messages)
    assert any(m["role"] == "system" for m in result)


def test_is_decision_or_tool_result():
    compressor = ContextCompressor()
    assert compressor._is_decision_or_tool_result({"role": "tool", "content": "result"})
    assert compressor._is_decision_or_tool_result({"role": "system", "content": "rule"})
    assert compressor._is_decision_or_tool_result({"role": "assistant", "tool_calls": [{"id": "1"}]})
    assert not compressor._is_decision_or_tool_result({"role": "user", "content": "hello"})


def test_set_context_window():
    compressor = ContextCompressor()
    compressor.set_context_window(200000)
    assert compressor._max_context_tokens == 200000
