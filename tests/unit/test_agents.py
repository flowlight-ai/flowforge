import pytest
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.task_context import TaskContext
from flowforge.tools.registry import ToolRegistry
from flowforge.events.event_bus import EventBus
from flowforge.agents.generic.fact_check import FactCheckAgent
from flowforge.agents.generic.trend_analysis import TrendAnalysisAgent
from flowforge.agents.generic.image_research import ImageResearchAgent
from flowforge.agents.generic.multilingual import MultilingualAgent
from flowforge.agents.generic.web_search_agent import WebSearchAgent
from flowforge.agents.generic.research_agent import ResearchAgent


class SimulatedLLMTool(BaseTool):
    name = "llm"
    description = "Simulated LLM for unit testing"
    parameters_schema = {}

    def __init__(self, responses: list[str] | None = None, response_content: str = ""):
        if responses is not None:
            self._responses = responses
        else:
            self._responses = [response_content] if response_content else [""]
        self._response_index = 0
        self._calls: list[dict] = []

    async def execute(self, input: ToolInput) -> ToolOutput:
        self._calls.append(input.params)
        response = self._responses[self._response_index % len(self._responses)]
        self._response_index += 1
        return ToolOutput(result={"content": response})


class SimulatedWebSearchTool(BaseTool):
    name = "web_search"
    description = "Simulated web search for unit testing"
    parameters_schema = {}

    def __init__(self):
        self._calls: list[dict] = []

    async def execute(self, input: ToolInput) -> ToolOutput:
        self._calls.append(input.params)
        return ToolOutput(result={
            "results": [
                {"title": "Simulated Search Result 1", "url": "https://example.com/1", "score": 0.9, "content": "Search content 1"},
                {"title": "Simulated Search Result 2", "url": "https://example.com/2", "score": 0.7, "content": "Search content 2"},
            ]
        })


class SimulatedOpenSieveTool(BaseTool):
    name = "opensieve_search"
    description = "Simulated OpenSieve for unit testing"
    parameters_schema = {}

    def __init__(self):
        self._calls: list[dict] = []

    async def execute(self, input: ToolInput) -> ToolOutput:
        self._calls.append(input.params)
        return ToolOutput(result={
            "results": [
                {"title": "RAG Result 1", "angle": "技术", "url": "https://rag.example.com/1", "content": "RAG content 1", "source_type": "web"},
                {"title": "RAG Result 2", "angle": "综合", "url": "https://rag.example.com/2", "content": "RAG content 2", "source_type": "web"},
            ]
        })


class SimulatedCacheTool(BaseTool):
    name = "cache"
    description = "Simulated cache for unit testing"
    parameters_schema = {}

    def __init__(self):
        self._calls: list[dict] = []

    async def execute(self, input: ToolInput) -> ToolOutput:
        self._calls.append(input.params)
        return ToolOutput(result={"data": None})


class SimulatedPexelsTool(BaseTool):
    name = "pexels_image"
    description = "Simulated pexels for unit testing"
    parameters_schema = {}

    def __init__(self):
        self._calls: list[dict] = []

    async def execute(self, input: ToolInput) -> ToolOutput:
        self._calls.append(input.params)
        return ToolOutput(result={
            "images": [
                {"url": "https://images.example.com/1.jpg", "title": "Image 1"},
                {"url": "https://images.example.com/2.jpg", "title": "Image 2"},
            ]
        })


class SimulatedPublisherTool(BaseTool):
    name = "publish_toutiao"
    description = "Simulated publisher for unit testing"
    parameters_schema = {}

    def __init__(self):
        self._calls: list[dict] = []

    async def execute(self, input: ToolInput) -> ToolOutput:
        self._calls.append(input.params)
        return ToolOutput(result={"url": "https://toutiao.example.com/article/123"})


class EventCollector:

    def __init__(self, event_bus: EventBus):
        self.events: list[dict] = []
        event_bus.subscribe("*", self._on_event)

    def _on_event(self, event: dict):
        self.events.append(event)

    def event_types(self) -> list[str]:
        return [e["type"] for e in self.events]

    def has_event(self, event_type: str) -> bool:
        return event_type in self.event_types()


def _make_context(tool_registry: ToolRegistry, state: dict = None) -> TaskContext:
    return TaskContext(
        task_id="test-task-001",
        input_data={},
        tools=tool_registry,
        state=state or {},
        event_bus=EventBus(),
    )


# --- FlowForge generic agent tests ---

@pytest.mark.asyncio
async def test_fact_check_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = FactCheckAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(response_content='{"issues": [], "is_clean": true}')
    registry.register(llm_tool)
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"draft": "This is a clean article with no links."}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "issues" in output.result
    assert "is_clean" in output.result
    assert isinstance(output.result["issues"], list)
    assert output.result["is_clean"] is True
    assert len(llm_tool._calls) >= 1


@pytest.mark.asyncio
async def test_trend_analysis_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = TrendAnalysisAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        '[{"topic": "AI趋势1", "heat_score": 8, "trend_direction": "上升", "spread_potential": "高", "analysis": "分析"}]',
    ])
    registry.register(llm_tool)
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"domain": "科技"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "trends" in output.result
    assert len(output.result["trends"]) > 0
    assert len(llm_tool._calls) >= 1


@pytest.mark.asyncio
async def test_trend_analysis_agent_no_search_tools():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = TrendAnalysisAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        '[{"topic": "LLM生成趋势", "heat_score": 7, "trend_direction": "上升", "spread_potential": "中", "analysis": "基于LLM推理"}]',
    ])
    registry.register(llm_tool)
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"domain": "科技"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "trends" in output.result
    assert len(output.result["trends"]) > 0
    assert output.result["trends"][0]["topic"] == "LLM生成趋势"
    assert len(llm_tool._calls) >= 1


@pytest.mark.asyncio
async def test_image_research_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = ImageResearchAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        '[{"url": "https://images.example.com/1.jpg", "relevance": 0.9, "quality": "高", "reason": "highly relevant"}]',
    ])
    registry.register(llm_tool)
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI technology", "images": [{"url": "https://images.example.com/1.jpg"}], "mode": "filter"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "filtered_images" in output.result
    assert len(output.result["filtered_images"]) > 0
    assert len(llm_tool._calls) >= 1


@pytest.mark.asyncio
async def test_image_research_agent_image_plan():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = ImageResearchAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        '{"image_suggestions": [{"type": "插图", "style": "简约", "search_keywords": ["AI"], "placement": "正文"}]}',
    ])
    registry.register(llm_tool)
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI technology"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "image_plan" in output.result
    assert len(llm_tool._calls) >= 1


@pytest.mark.asyncio
async def test_image_research_agent_no_tools():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = ImageResearchAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool()
    registry.register(llm_tool)
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI technology"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "image_plan" in output.result


@pytest.mark.asyncio
async def test_multilingual_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = MultilingualAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        "Translated content here",
    ])
    registry.register(llm_tool)
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"text": "Hello world", "target_lang": "en"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "translated" in output.result
    assert "target_lang" in output.result
    assert len(output.result["translated"]) > 0
    assert output.result["target_lang"] == "en"
    assert len(llm_tool._calls) >= 1


@pytest.mark.asyncio
async def test_multilingual_agent_default_lang():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = MultilingualAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        "Contenu traduit",
    ])
    registry.register(llm_tool)
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"text": "Bonjour le monde"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert output.result["target_lang"] == "en"
    assert len(output.result["translated"]) > 0


def test_all_agents_have_correct_names():
    expected = {
        "fact_check", "trend_analysis",
        "image_research", "multilingual",
    }
    agents = [
        FactCheckAgent(), TrendAnalysisAgent(),
        ImageResearchAgent(), MultilingualAgent(),
    ]
    actual = {a.name for a in agents}
    assert actual == expected
