import pytest
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.task_context import TaskContext
from flowforge.tools.registry import ToolRegistry
from flowforge.events.event_bus import EventBus
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


@pytest.mark.asyncio
async def test_topic_research_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = TopicResearchAgent()
    registry = ToolRegistry()
    cache_tool = SimulatedCacheTool()
    web_search_tool = SimulatedWebSearchTool()
    registry.register(cache_tool)
    registry.register(web_search_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI technology"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "topics" in output.result
    assert len(output.result["topics"]) > 0
    assert all("title" in t and "url" in t for t in output.result["topics"])
    assert len(cache_tool._calls) >= 1
    assert collector.has_event("topic_research.cache_check_start")
    assert collector.has_event("topic_research.complete")


@pytest.mark.asyncio
async def test_topic_research_agent_empty_query():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = TopicResearchAgent()
    registry = ToolRegistry()
    cache_tool = SimulatedCacheTool()
    opensieve_tool = SimulatedOpenSieveTool()
    registry.register(cache_tool)
    registry.register(opensieve_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert output.result["topics"] == []
    assert len(cache_tool._calls) == 0
    assert len(opensieve_tool._calls) == 0


@pytest.mark.asyncio
async def test_topic_research_agent_fallback_to_web_search():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = TopicResearchAgent()
    registry = ToolRegistry()
    cache_tool = SimulatedCacheTool()
    web_search_tool = SimulatedWebSearchTool()
    registry.register(cache_tool)
    registry.register(web_search_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI technology"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "topics" in output.result
    assert len(output.result["topics"]) > 0
    assert all("title" in t and "url" in t for t in output.result["topics"])
    assert len(cache_tool._calls) >= 1
    assert len(web_search_tool._calls) >= 1
    assert collector.has_event("topic_research.cache_check_start")
    assert collector.has_event("topic_research.complete")


@pytest.mark.asyncio
async def test_article_writing_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = ArticleWritingAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(response_content="This is a generated article draft with sufficient length to pass validation.")
    registry.register(llm_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI in Education", "materials": [{"content": "Material 1"}]}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "draft" in output.result
    assert len(output.result["draft"]) > 0
    assert len(llm_tool._calls) >= 1
    assert collector.has_event("article_writing.generation_start")
    assert collector.has_event("article_writing.complete")


@pytest.mark.asyncio
async def test_material_collection_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = MaterialCollectionAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool()
    opensieve_tool = SimulatedOpenSieveTool()
    web_search_tool = SimulatedWebSearchTool()
    registry.register(llm_tool)
    registry.register(opensieve_tool)
    registry.register(web_search_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"topics": [{"title": "AI"}]}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "materials" in output.result
    assert len(output.result["materials"]) > 0
    assert all("title" in m and "url" in m for m in output.result["materials"])
    assert len(opensieve_tool._calls) >= 1
    assert len(web_search_tool._calls) >= 1
    assert collector.has_event("material_collection.cache_check_start")
    assert collector.has_event("material_collection.web_search_start")
    assert collector.has_event("material_collection.complete")


@pytest.mark.asyncio
async def test_material_collection_agent_empty_topics():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = MaterialCollectionAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool()
    opensieve_tool = SimulatedOpenSieveTool()
    registry.register(llm_tool)
    registry.register(opensieve_tool)
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topics": []}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert output.result["materials"] == []
    assert len(opensieve_tool._calls) == 0


@pytest.mark.asyncio
async def test_seo_optimization_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = SEOOptimizationAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        '{"suggested_keywords": ["AI", "education", "machine learning"]}',
        "# Optimized Title\n\nOptimized content here.",
    ])
    registry.register(llm_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"draft": "Original draft", "keywords": ["AI", "education"]}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "optimized_draft" in output.result
    assert "seo_title" in output.result
    assert len(output.result["seo_title"]) > 0
    assert len(output.result["optimized_draft"]) > 0
    assert len(llm_tool._calls) >= 2
    assert collector.has_event("seo_optimization.planning_start")
    assert collector.has_event("seo_optimization.optimize_start")
    assert collector.has_event("seo_optimization.optimize_complete")


@pytest.mark.asyncio
async def test_fact_check_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = FactCheckAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(response_content='{"issues": [], "is_clean": true}')
    registry.register(llm_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"draft": "This is a clean article with no links."}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "issues" in output.result
    assert "is_clean" in output.result
    assert isinstance(output.result["issues"], list)
    assert output.result["is_clean"] is True
    assert len(llm_tool._calls) >= 1
    assert collector.has_event("fact_check.url_check_start")
    assert collector.has_event("fact_check.fact_verify_start")
    assert collector.has_event("fact_check.complete")


@pytest.mark.asyncio
async def test_content_audit_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = ContentAuditAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        '{"accuracy": 8.5, "coherence": 8.5, "expression": 8.5, "value": 8.5, "readability": 8.5, "issues": ["minor issue"]}',
        '{"is_clean": true, "violations": []}',
    ])
    registry.register(llm_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"draft": "Article to audit"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "score" in output.result
    assert "issues" in output.result
    assert "is_clean" in output.result
    assert "violations" in output.result
    assert 0 <= output.result["score"] <= 1
    assert output.result["score"] == 0.85
    assert output.result["issues"] == ["minor issue"]
    assert output.result["is_clean"] is True
    assert output.result["violations"] == []
    assert len(llm_tool._calls) >= 2
    assert collector.has_event("content_audit.assess_start")
    assert collector.has_event("content_audit.compliance_start")
    assert collector.has_event("content_audit.complete")


@pytest.mark.asyncio
async def test_content_audit_agent_unparseable():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = ContentAuditAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(response_content="not valid json")
    registry.register(llm_tool)
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"draft": "Article to audit"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert output.result["score"] == 0.5
    assert output.result["issues"] == []
    assert output.result["is_clean"] is True
    assert output.result["violations"] == []
    assert len(llm_tool._calls) >= 2


@pytest.mark.asyncio
async def test_trend_analysis_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = TrendAnalysisAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        '{"trends": [{"title": "AI趋势1", "heat": 8, "direction": "上升", "potential": "高", "analysis": "分析"}]}',
        "Trend report content",
    ])
    web_search_tool = SimulatedWebSearchTool()
    registry.register(llm_tool)
    registry.register(web_search_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"domain": "科技"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "trends" in output.result
    assert "report" in output.result
    assert len(output.result["trends"]) > 0
    assert all("title" in t for t in output.result["trends"])
    assert len(web_search_tool._calls) >= 1
    assert len(llm_tool._calls) >= 1
    assert collector.has_event("trend_analysis.collect_data_start")
    assert collector.has_event("trend_analysis.complete")


@pytest.mark.asyncio
async def test_trend_analysis_agent_no_search_tools():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = TrendAnalysisAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        '{"trends": [{"title": "LLM生成趋势", "heat": 7, "direction": "上升", "potential": "中", "analysis": "基于LLM推理"}]}',
        "LLM generated trend report",
    ])
    registry.register(llm_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"domain": "科技"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "trends" in output.result
    assert len(output.result["trends"]) > 0
    assert output.result["trends"][0]["title"] == "LLM生成趋势"
    assert len(llm_tool._calls) >= 1
    assert collector.has_event("trend_analysis.complete")


@pytest.mark.asyncio
async def test_publishing_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = PublishingAgent()
    registry = ToolRegistry()
    publisher_tool = SimulatedPublisherTool()
    registry.register(publisher_tool)
    ctx = _make_context(registry, state={"platforms": ["toutiao"]})
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"seo_title": "Test Article", "draft": "Article content"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "published" in output.result
    assert "toutiao" in output.result["published"]
    assert output.result["published"]["toutiao"] == "https://toutiao.example.com/article/123"
    assert len(publisher_tool._calls) >= 1
    assert publisher_tool._calls[0]["title"] == "Test Article"
    assert collector.has_event("publishing.complete")


@pytest.mark.asyncio
async def test_publishing_agent_failed_platform():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = PublishingAgent()
    registry = ToolRegistry()
    ctx = _make_context(registry, state={"platforms": ["toutiao"]})
    output = await agent.execute_with_context(
        AgentInput(params={"seo_title": "Test Article", "draft": "Article content"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "published" in output.result
    assert "toutiao" in output.result["published"]
    assert "failed" in output.result["published"]["toutiao"]


@pytest.mark.asyncio
async def test_headline_optimizer_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = HeadlineOptimizerAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        '{"audience": "科技爱好者", "hooks": ["数据驱动", "趋势预测"]}',
        '{"headlines": ["标题1", "标题2", "标题3"]}',
        '{"ranked": [{"headline": "标题1", "score": 9}, {"headline": "标题2", "score": 8}, {"headline": "标题3", "score": 7}]}',
    ])
    registry.register(llm_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI", "title": "AI News"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "headlines" in output.result
    assert isinstance(output.result["headlines"], list)
    assert len(output.result["headlines"]) == 3
    assert output.result["headlines"][0] == "标题1"
    assert len(llm_tool._calls) >= 2
    assert collector.has_event("headline_optimizer.analyze_topic_start")
    assert collector.has_event("headline_optimizer.generate_headlines_start")
    assert collector.has_event("headline_optimizer.complete")


@pytest.mark.asyncio
async def test_headline_optimizer_agent_unparseable():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = HeadlineOptimizerAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(response_content="not json")
    registry.register(llm_tool)
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI", "title": "Original Title"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert output.result["headlines"] == ["Original Title"]
    assert len(llm_tool._calls) >= 1


@pytest.mark.asyncio
async def test_content_repurposer_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = ContentRepurposerAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        '{"core_message": "AI technology trends", "key_points": ["point1", "point2"], "tone": "专业"}',
        "WeChat version content",
        "Toutiao version content",
    ])
    registry.register(llm_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"draft": "Original article", "platforms": ["wechat", "toutiao"]}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "variants" in output.result
    assert "wechat" in output.result["variants"]
    assert "toutiao" in output.result["variants"]
    assert len(output.result["variants"]["wechat"]) > 0
    assert len(output.result["variants"]["toutiao"]) > 0
    assert len(llm_tool._calls) >= 3
    assert collector.has_event("content_repurposer.analyze_content_start")
    assert collector.has_event("content_repurposer.generate_variants_start")
    assert collector.has_event("content_repurposer.complete")


@pytest.mark.asyncio
async def test_image_research_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = ImageResearchAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        '{"selected": [{"url": "https://images.example.com/1.jpg", "title": "Image 1", "relevance": 0.9, "reason": "highly relevant"}]}',
    ])
    pexels_tool = SimulatedPexelsTool()
    registry.register(llm_tool)
    registry.register(pexels_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI technology"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "images" in output.result
    assert len(output.result["images"]) > 0
    assert all("url" in img for img in output.result["images"])
    assert len(pexels_tool._calls) >= 1
    assert collector.has_event("image_research.search_images_start")
    assert collector.has_event("image_research.complete")


@pytest.mark.asyncio
async def test_image_research_agent_fallback():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = ImageResearchAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool()
    web_search_tool = SimulatedWebSearchTool()
    registry.register(llm_tool)
    registry.register(web_search_tool)
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI technology"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "images" in output.result
    assert len(output.result["images"]) > 0
    assert len(web_search_tool._calls) >= 1


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
    assert output.result["images"] == []


@pytest.mark.asyncio
async def test_multilingual_agent():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = MultilingualAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        '{"source_lang": "zh"}',
        "Translated content here",
        '{"verified_translation": "Translated content here"}',
    ])
    registry.register(llm_tool)
    ctx = _make_context(registry)
    collector = EventCollector(ctx.event_bus)
    output = await agent.execute_with_context(
        AgentInput(params={"text": "Hello world", "target_lang": "en"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert "translated" in output.result
    assert "target_lang" in output.result
    assert len(output.result["translated"]) > 0
    assert output.result["target_lang"] == "en"
    assert len(llm_tool._calls) >= 2
    assert collector.has_event("multilingual.detect_language_start")
    assert collector.has_event("multilingual.translate_start")
    assert collector.has_event("multilingual.complete")


@pytest.mark.asyncio
async def test_multilingual_agent_default_lang():
    """此为单元测试，使用模拟LLM；集成测试应使用真实LLM。"""
    agent = MultilingualAgent()
    registry = ToolRegistry()
    llm_tool = SimulatedLLMTool(responses=[
        '{"source_lang": "zh"}',
        "Contenu traduit",
        '{"verified_translation": "Contenu traduit"}',
    ])
    registry.register(llm_tool)
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"draft": "Bonjour le monde"}), ctx
    )
    assert isinstance(output, AgentOutput)
    assert output.result["target_lang"] == "en"
    assert len(output.result["translated"]) > 0


def test_all_agents_have_correct_names():
    expected = {
        "topic_research", "article_writing", "material_collection",
        "seo_optimization", "fact_check", "content_audit",
        "trend_analysis", "publishing", "headline_optimizer",
        "content_repurposer", "image_research", "multilingual",
    }
    agents = [
        TopicResearchAgent(), ArticleWritingAgent(), MaterialCollectionAgent(),
        SEOOptimizationAgent(), FactCheckAgent(), ContentAuditAgent(),
        TrendAnalysisAgent(), PublishingAgent(), HeadlineOptimizerAgent(),
        ContentRepurposerAgent(), ImageResearchAgent(), MultilingualAgent(),
    ]
    actual = {a.name for a in agents}
    assert actual == expected
