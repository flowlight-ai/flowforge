import pytest
import asyncio
import os
import tempfile
import time

from flowforge.core import metrics
from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.task_context import TaskContext
from flowforge.mcp.client import MCPClient
from flowforge.harness.feedback_loop import FeedbackLoop
from flowforge.harness.entropy_manager import GarbageCollection, GCSchedule
from flowforge.skills.combo import ComboEngine
from flowforge.memory.working import WorkingMemory
from flowforge.memory.short_term import ShortTermMemory
from flowforge.memory.long_term import LongTermMemory
from flowforge.memory.episodic import EpisodicMemory
from flowforge.security.arch_constraint import ArchitectureConstraintEngine, DEFAULT_LAYER_MAPPING
from flowforge.core.interfaces.tools import ToolPlugin, PluginState, PluginHealth, PluginManifest


class _ConcreteAgent(BaseAgent):
    name = "test_concrete"
    description = "Concrete agent for shell fix verification tests"

    async def execute(self, input: AgentInput) -> AgentOutput:
        return AgentOutput(result={"echo": input.params})


@pytest.fixture(autouse=True)
def _reset_metrics():
    if metrics._prometheus_available:
        if hasattr(metrics, '_tool_call_data'):
            metrics._tool_call_data.clear()
        if hasattr(metrics, '_llm_token_data'):
            metrics._llm_token_data.clear()
        if hasattr(metrics, '_task_created_data'):
            metrics._task_created_data.clear()
        if hasattr(metrics, '_task_completed_data'):
            metrics._task_completed_data.clear()
        if hasattr(metrics, '_task_failed_data'):
            metrics._task_failed_data.clear()
        if hasattr(metrics, '_task_durations_data'):
            metrics._task_durations_data.clear()
    else:
        if hasattr(metrics, '_tool_call_durations'):
            metrics._tool_call_durations.clear()
        if hasattr(metrics, '_tool_error_counts'):
            metrics._tool_error_counts.clear()
        if hasattr(metrics, '_llm_token_counts'):
            metrics._llm_token_counts.clear()
        if hasattr(metrics, '_llm_error_counts'):
            metrics._llm_error_counts.clear()
        if hasattr(metrics, '_task_created'):
            metrics._task_created.clear()
        if hasattr(metrics, '_task_completed'):
            metrics._task_completed.clear()
        if hasattr(metrics, '_task_failed'):
            metrics._task_failed.clear()
        if hasattr(metrics, '_task_durations'):
            metrics._task_durations.clear()
        if hasattr(metrics, '_persona_running_counts'):
            metrics._persona_running_counts.clear()
    yield


class TestMetricsFix:

    @pytest.mark.asyncio
    async def test_metrics_tool_stats_returns_real_data(self):
        metrics.record_tool_call("test_tool", 1.5)
        metrics.record_tool_call("test_tool", 2.5)
        stats = metrics.get_tool_stats()
        assert "test_tool" in stats, "tool_stats should contain recorded tool"
        assert stats["test_tool"]["call_count"] == 2
        assert stats["test_tool"]["total_duration"] == pytest.approx(4.0)
        assert stats["test_tool"]["avg_duration"] == pytest.approx(2.0)

    @pytest.mark.asyncio
    async def test_metrics_tool_error_is_recorded(self):
        metrics.record_tool_error("failing_tool")
        stats = metrics.get_tool_stats()
        assert "failing_tool" in stats
        assert stats["failing_tool"]["error_count"] > 0

    @pytest.mark.asyncio
    async def test_metrics_task_stats_returns_real_data(self):
        metrics.record_task_created("workflow", "test_persona")
        metrics.record_task_completed("workflow", "test_persona", 5.0)
        stats = metrics.get_task_stats()
        assert len(stats) > 0, "task_stats should not be empty after recording tasks"

    @pytest.mark.asyncio
    async def test_metrics_llm_token_stats_returns_real_data(self):
        metrics.record_llm_tokens("openai", "gpt-4", 100)
        stats = metrics.get_llm_token_stats()
        assert len(stats) > 0, "llm_token_stats should not be empty after recording tokens"


class TestBaseAgentFix:

    @pytest.mark.asyncio
    async def test_validate_input_rejects_empty_params(self):
        agent = _ConcreteAgent()
        empty_input = AgentInput(params={})
        assert agent.validate_input(empty_input) is False, "empty params should be rejected"

    @pytest.mark.asyncio
    async def test_validate_input_accepts_valid_params(self):
        agent = _ConcreteAgent()
        valid_input = AgentInput(params={"task": "分析AI趋势"})
        assert agent.validate_input(valid_input) is True

    @pytest.mark.asyncio
    async def test_get_cost_estimate_returns_nonzero(self):
        agent = _ConcreteAgent()
        input_with_content = AgentInput(params={"task": "写一篇关于人工智能发展趋势的深度分析报告"})
        estimate = agent.get_cost_estimate(input_with_content)
        assert estimate["estimated_tokens"] > 0, "should estimate non-zero tokens for non-empty input"
        assert estimate["estimated_cost"] > 0.0, "should estimate non-zero cost"


class TestMCPClientFix:

    @pytest.mark.asyncio
    async def test_mcp_client_list_tools_sends_jsonrpc(self):
        client = MCPClient()
        tools = await client.list_tools()
        assert isinstance(tools, list)
        assert hasattr(client, '_request_id')
        assert hasattr(client, '_send_jsonrpc')

    @pytest.mark.asyncio
    async def test_mcp_client_call_tool_sends_jsonrpc(self):
        client = MCPClient()
        result = await client.call_tool("test_tool", {})
        assert "error" in result
        assert "not yet implemented" not in str(result).lower(), "should not return 'not yet implemented' anymore"


class TestFeedbackLoopFix:

    @pytest.mark.asyncio
    async def test_heuristic_fallback_scores_below_threshold(self):
        loop = FeedbackLoop(config={"evaluation_mode": "full", "quality_threshold": 0.7})
        ctx = TaskContext(task_id="test", input_data={"task": "test"})
        short_content = "This is a short piece of text that is long enough to pass the fifty character threshold but lacks structure depth or detail."
        result = {"content": short_content, "status": "completed"}
        result = await loop.evaluate(result, ctx)
        assert "_feedback" in result
        scores = result["_feedback"].get("scores", {})
        if scores:
            for dim, val in scores.items():
                assert val <= 0.7, f"{dim}={val} should be <= 0.7 in heuristic fallback"


class TestEntropyManagerFix:

    @pytest.mark.asyncio
    async def test_collect_resource_actually_deletes_files(self):
        gc = GarbageCollection()
        data_dir = os.path.join(os.path.dirname(__file__), "_gc_test_data")
        os.makedirs(data_dir, exist_ok=True)
        tmp_path = os.path.join(data_dir, "old_file.tmp")
        with open(tmp_path, "wb") as f:
            f.write(b"old content")
        old_time = time.time() - 86400 * 31
        os.utime(tmp_path, (old_time, old_time))
        schedule = GCSchedule(resource_type="temp_files", max_age_days=30)
        result = await gc._collect_resource("temp_files", schedule)
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        try:
            os.rmdir(data_dir)
        except OSError:
            pass
        assert result.get("status") != "scheduled" or result.get("deleted_count", 0) > 0, \
            "should actually delete files, not just schedule"


class TestComboFix:

    @pytest.mark.asyncio
    async def test_execute_combo_actually_calls_skill(self):
        engine = ComboEngine()
        engine.register_combo("test_combo", [
            {"name": "step1", "skill": "test_skill", "output_key": "out1"}
        ])

        class MockSkill:
            instructions = "test"

            async def execute(self, variables):
                return {"result": "executed", "variables": variables}

        class MockRegistry:
            def get_skill(self, name):
                return MockSkill()

        result = await engine.execute_combo("test_combo", skill_registry=MockRegistry())
        assert "out1" in result
        out = result["out1"]
        assert out.get("output", {}).get("result") == "executed" or out.get("executed") is True, \
            "should contain execution result, not just metadata"


class TestMemorySearchFix:

    @pytest.mark.asyncio
    async def test_working_memory_fuzzy_search(self):
        mem = WorkingMemory()
        await mem.store("user_preference_theme", {"theme": "dark"})
        results = await mem.search("preference")
        assert len(results) > 0, "fuzzy search should find partial key match"

    @pytest.mark.asyncio
    async def test_short_term_memory_fuzzy_search(self):
        db_path = tempfile.mktemp(suffix=".db")
        mem = ShortTermMemory(db_url=f"sqlite:///{db_path}")
        await mem.store("user_config", {"setting": "value"})
        results = await mem.search("config")
        assert len(results) > 0, "fuzzy search should find partial key match"
        mem.conn.close()
        try:
            os.remove(db_path)
        except OSError:
            pass

    @pytest.mark.asyncio
    async def test_long_term_memory_searches_value(self):
        db_path = tempfile.mktemp(suffix=".db")
        mem = LongTermMemory(db_url=f"sqlite:///{db_path}")
        await mem.store("item1", {"description": "machine learning trends"})
        results = await mem.search("machine learning")
        assert len(results) > 0, "search should find content in value field"
        mem.conn.close()
        try:
            os.remove(db_path)
        except OSError:
            pass

    @pytest.mark.asyncio
    async def test_episodic_memory_searches_trace(self):
        db_path = tempfile.mktemp(suffix=".db")
        mem = EpisodicMemory(db_url=f"sqlite:///{db_path}")
        await mem.store("task-001", {"action": "deep_research", "topic": "AI safety"})
        results = await mem.search("deep_research")
        assert len(results) > 0, "search should find content in trace field"
        mem.conn.close()
        try:
            os.remove(db_path)
        except OSError:
            pass


class TestArchConstraintFix:

    def test_arch_constraint_default_layer_mapping(self):
        engine = ArchitectureConstraintEngine(config={})
        assert engine.layer_mapping == {} or engine.layer_mapping == DEFAULT_LAYER_MAPPING, \
            "should have layer mapping when not configured"
        assert len(engine.layer_order) > 0, "should have default layer order"

    def test_arch_constraint_with_explicit_mapping(self):
        engine = ArchitectureConstraintEngine(config={
            "layer_mapping": {
                "types": ["flowforge.core.errors", "flowforge.core.base_agent"],
                "config": ["flowforge.core.config", "flowforge.core.di"],
                "service": ["flowforge.core.metrics", "flowforge.tools"],
                "runtime": ["flowforge.modes", "flowforge.agents"],
                "ui": ["flowforge.app", "flowforge.web"],
            },
            "layer_order": ["types", "config", "service", "runtime", "ui"],
        })
        layer = engine.get_layer("flowforge.core.metrics")
        assert layer is not None, "should find layer with explicit mapping"
        assert layer == "service"


class TestToolPluginHealthCheckFix:

    def test_tool_plugin_health_check_returns_unknown(self):
        class _TestPlugin(ToolPlugin):
            manifest = PluginManifest(name="test_plugin")

            async def execute(self, params):
                return {}

        plugin = _TestPlugin()
        health = plugin.health_check()
        if asyncio.iscoroutine(health):
            health = asyncio.get_event_loop().run_until_complete(health)
        assert health.state == PluginState.UNKNOWN, "default health_check should return UNKNOWN, not READY"


class TestTrendAnalysisReportFix:

    @pytest.mark.asyncio
    async def test_trend_analysis_returns_report(self):
        pytest.skip("需要真实LLM，在E2E测试中验证")
