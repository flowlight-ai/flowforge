import pytest
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.task_context import TaskContext
from flowforge.tools.registry import ToolRegistry
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


class MockLLMTool(BaseTool):
    name = "llm"
    description = "Mock LLM"
    parameters_schema = {}

    def __init__(self, response_content: str = ""):
        self._response_content = response_content

    async def execute(self, input: ToolInput) -> ToolOutput:
        return ToolOutput(result={"content": self._response_content})


class MockWebSearchTool(BaseTool):
    name = "web_search"
    description = "Mock web search"
    parameters_schema = {}

    async def execute(self, input: ToolInput) -> ToolOutput:
        return ToolOutput(result={
            "results": [
                {"title": "Test Result 1", "url": "https://example.com/1", "score": 0.9},
                {"title": "Test Result 2", "url": "https://example.com/2", "score": 0.7},
            ]
        })


class MockHelixRAGTool(BaseTool):
    name = "helixrag_search"
    description = "Mock HelixRAG"
    parameters_schema = {}

    async def execute(self, input: ToolInput) -> ToolOutput:
        return ToolOutput(result={
            "results": [
                {"title": "RAG Result 1", "angle": "技术", "url": "https://rag.example.com/1", "content": "RAG content 1", "source_type": "web"},
                {"title": "RAG Result 2", "angle": "综合", "url": "https://rag.example.com/2", "content": "RAG content 2", "source_type": "web"},
            ]
        })


class MockCacheTool(BaseTool):
    name = "cache"
    description = "Mock cache"
    parameters_schema = {}

    async def execute(self, input: ToolInput) -> ToolOutput:
        return ToolOutput(result={"data": None})


class MockPexelsTool(BaseTool):
    name = "pexels_image"
    description = "Mock pexels"
    parameters_schema = {}

    async def execute(self, input: ToolInput) -> ToolOutput:
        return ToolOutput(result={
            "images": [
                {"url": "https://images.example.com/1.jpg", "title": "Image 1"},
                {"url": "https://images.example.com/2.jpg", "title": "Image 2"},
            ]
        })


class MockPublisherTool(BaseTool):
    name = "publish_toutiao"
    description = "Mock publisher"
    parameters_schema = {}

    async def execute(self, input: ToolInput) -> ToolOutput:
        return ToolOutput(result={"url": "https://toutiao.example.com/article/123"})


def _make_context(tool_registry: ToolRegistry, state: dict = None) -> TaskContext:
    return TaskContext(
        task_id="test-task-001",
        input_data={},
        tools=tool_registry,
        state=state or {},
    )


@pytest.mark.asyncio
async def test_topic_research_agent():
    agent = TopicResearchAgent()
    registry = ToolRegistry()
    registry.register(MockCacheTool())
    registry.register(MockHelixRAGTool())
    registry.register(MockWebSearchTool())
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI technology"}), ctx
    )
    assert "topics" in output.result
    assert len(output.result["topics"]) > 0
    assert output.result["topics"][0]["title"] == "RAG Result 1"


@pytest.mark.asyncio
async def test_topic_research_agent_empty_query():
    agent = TopicResearchAgent()
    registry = ToolRegistry()
    registry.register(MockCacheTool())
    registry.register(MockHelixRAGTool())
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={}), ctx
    )
    assert output.result["topics"] == []


@pytest.mark.asyncio
async def test_topic_research_agent_fallback_to_web_search():
    agent = TopicResearchAgent()
    registry = ToolRegistry()
    registry.register(MockCacheTool())
    registry.register(MockWebSearchTool())
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI technology"}), ctx
    )
    assert "topics" in output.result
    assert len(output.result["topics"]) > 0
    assert output.result["topics"][0]["title"] == "Test Result 1"


@pytest.mark.asyncio
async def test_article_writing_agent():
    agent = ArticleWritingAgent()
    registry = ToolRegistry()
    registry.register(MockLLMTool(response_content="This is a generated article draft."))
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI in Education", "materials": [{"content": "Material 1"}]}), ctx
    )
    assert "draft" in output.result
    assert output.result["draft"] == "This is a generated article draft."


@pytest.mark.asyncio
async def test_material_collection_agent():
    agent = MaterialCollectionAgent()
    registry = ToolRegistry()
    registry.register(MockHelixRAGTool())
    registry.register(MockWebSearchTool())
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topics": [{"title": "AI"}]}), ctx
    )
    assert "materials" in output.result
    assert len(output.result["materials"]) > 0
    assert output.result["materials"][0]["title"] == "RAG Result 1"


@pytest.mark.asyncio
async def test_material_collection_agent_empty_topics():
    agent = MaterialCollectionAgent()
    registry = ToolRegistry()
    registry.register(MockHelixRAGTool())
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topics": []}), ctx
    )
    assert output.result["materials"] == []


@pytest.mark.asyncio
async def test_seo_optimization_agent():
    agent = SEOOptimizationAgent()
    registry = ToolRegistry()
    registry.register(MockLLMTool(response_content="# Optimized Title\n\nOptimized content here."))
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"draft": "Original draft", "keywords": ["AI", "education"]}), ctx
    )
    assert "optimized_draft" in output.result
    assert "seo_title" in output.result
    assert output.result["seo_title"] == "Optimized Title"


@pytest.mark.asyncio
async def test_fact_check_agent():
    agent = FactCheckAgent()
    registry = ToolRegistry()
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"draft": "This is a clean article with no links."}), ctx
    )
    assert "issues" in output.result
    assert "is_clean" in output.result
    assert output.result["is_clean"] is True
    assert output.result["issues"] == []


@pytest.mark.asyncio
async def test_content_audit_agent():
    agent = ContentAuditAgent()
    registry = ToolRegistry()
    registry.register(MockLLMTool(response_content='{"score": 0.85, "issues": ["minor issue"]}'))
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"draft": "Article to audit"}), ctx
    )
    assert "score" in output.result
    assert "issues" in output.result
    assert output.result["score"] == 0.85
    assert output.result["issues"] == ["minor issue"]


@pytest.mark.asyncio
async def test_content_audit_agent_unparseable():
    agent = ContentAuditAgent()
    registry = ToolRegistry()
    registry.register(MockLLMTool(response_content="not valid json"))
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"draft": "Article to audit"}), ctx
    )
    assert output.result["score"] == 0.5
    assert len(output.result["issues"]) > 0


@pytest.mark.asyncio
async def test_trend_analysis_agent():
    agent = TrendAnalysisAgent()
    registry = ToolRegistry()
    registry.register(MockWebSearchTool())
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"domain": "科技"}), ctx
    )
    assert "trends" in output.result
    assert len(output.result["trends"]) > 0
    assert output.result["trends"][0]["title"] == "Test Result 1"


@pytest.mark.asyncio
async def test_trend_analysis_agent_no_tools():
    agent = TrendAnalysisAgent()
    registry = ToolRegistry()
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"domain": "科技"}), ctx
    )
    assert output.result["trends"] == []


@pytest.mark.asyncio
async def test_publishing_agent():
    agent = PublishingAgent()
    registry = ToolRegistry()
    registry.register(MockPublisherTool())
    ctx = _make_context(registry, state={"platforms": ["toutiao"]})
    output = await agent.execute_with_context(
        AgentInput(params={"seo_title": "Test Article", "draft": "Article content"}), ctx
    )
    assert "published" in output.result
    assert "toutiao" in output.result["published"]
    assert output.result["published"]["toutiao"] == "https://toutiao.example.com/article/123"


@pytest.mark.asyncio
async def test_publishing_agent_failed_platform():
    agent = PublishingAgent()
    registry = ToolRegistry()
    ctx = _make_context(registry, state={"platforms": ["toutiao"]})
    output = await agent.execute_with_context(
        AgentInput(params={"seo_title": "Test Article", "draft": "Article content"}), ctx
    )
    assert "published" in output.result
    assert "failed" in output.result["published"]["toutiao"]


@pytest.mark.asyncio
async def test_headline_optimizer_agent():
    agent = HeadlineOptimizerAgent()
    registry = ToolRegistry()
    registry.register(MockLLMTool(response_content='{"headlines": ["标题1", "标题2", "标题3"]}'))
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI", "title": "AI News"}), ctx
    )
    assert "headlines" in output.result
    assert len(output.result["headlines"]) == 3
    assert output.result["headlines"][0] == "标题1"


@pytest.mark.asyncio
async def test_headline_optimizer_agent_unparseable():
    agent = HeadlineOptimizerAgent()
    registry = ToolRegistry()
    registry.register(MockLLMTool(response_content="not json"))
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI", "title": "Original Title"}), ctx
    )
    assert output.result["headlines"] == ["Original Title"]


@pytest.mark.asyncio
async def test_content_repurposer_agent():
    agent = ContentRepurposerAgent()
    registry = ToolRegistry()
    registry.register(MockLLMTool(response_content="Repurposed content"))
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"draft": "Original article", "platforms": ["wechat", "toutiao"]}), ctx
    )
    assert "variants" in output.result
    assert "wechat" in output.result["variants"]
    assert "toutiao" in output.result["variants"]
    assert output.result["variants"]["wechat"] == "Repurposed content"


@pytest.mark.asyncio
async def test_image_research_agent():
    agent = ImageResearchAgent()
    registry = ToolRegistry()
    registry.register(MockPexelsTool())
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI technology"}), ctx
    )
    assert "images" in output.result
    assert len(output.result["images"]) > 0
    assert output.result["images"][0]["url"] == "https://images.example.com/1.jpg"


@pytest.mark.asyncio
async def test_image_research_agent_fallback():
    agent = ImageResearchAgent()
    registry = ToolRegistry()
    registry.register(MockWebSearchTool())
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI technology"}), ctx
    )
    assert "images" in output.result
    assert len(output.result["images"]) > 0


@pytest.mark.asyncio
async def test_image_research_agent_no_tools():
    agent = ImageResearchAgent()
    registry = ToolRegistry()
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"topic": "AI technology"}), ctx
    )
    assert output.result["images"] == []


@pytest.mark.asyncio
async def test_multilingual_agent():
    agent = MultilingualAgent()
    registry = ToolRegistry()
    registry.register(MockLLMTool(response_content="Translated content here"))
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"text": "Hello world", "target_lang": "en"}), ctx
    )
    assert "translated" in output.result
    assert "target_lang" in output.result
    assert output.result["translated"] == "Translated content here"
    assert output.result["target_lang"] == "en"


@pytest.mark.asyncio
async def test_multilingual_agent_default_lang():
    agent = MultilingualAgent()
    registry = ToolRegistry()
    registry.register(MockLLMTool(response_content="Contenu traduit"))
    ctx = _make_context(registry)
    output = await agent.execute_with_context(
        AgentInput(params={"draft": "Bonjour le monde"}), ctx
    )
    assert output.result["target_lang"] == "en"


@pytest.mark.asyncio
async def test_all_agents_raise_on_bare_execute():
    agents = [
        TopicResearchAgent(), ArticleWritingAgent(), MaterialCollectionAgent(),
        SEOOptimizationAgent(), FactCheckAgent(), ContentAuditAgent(),
        TrendAnalysisAgent(), PublishingAgent(), HeadlineOptimizerAgent(),
        ContentRepurposerAgent(), ImageResearchAgent(), MultilingualAgent(),
    ]
    for agent in agents:
        with pytest.raises(NotImplementedError):
            await agent.execute(AgentInput(params={}))


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
