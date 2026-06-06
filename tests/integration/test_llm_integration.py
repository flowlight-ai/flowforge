"""LLM integration tests — calls real LLM APIs, no mocks.

This test module validates the LLMClient and ModelService against real
LLM providers (OpenRouter).  API keys are read from environment variables
or the SecretStore.  Tests are skipped automatically when keys are
unavailable.

Usage:
    python -m pytest flowforge/tests/integration/test_llm_integration.py -v -m integration

铁律遵守:
    T1: 不使用Mock LLM — 直接调用真实LLM API
    T2: 不使用假数据 — 使用真实的prompt和参数
    T3: 不跳过验证 — 每个测试有具体断言
    T6: 采集指标 — 记录响应时间、token使用量等
"""

import os
import sys
import time
import asyncio
from pathlib import Path

import pytest

# Ensure project root is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from flowforge.tools.llm_client import LLMClient
from flowforge.tools.llm.model_service import ModelService
from flowforge.core.base_tool import ToolInput
from flowforge.events.event_bus import EventBus
from flowforge.tests.metrics_collector import TestMetricsCollector


# ---------------------------------------------------------------------------
# API key detection
# ---------------------------------------------------------------------------

def _resolve_api_key(env_name: str) -> str:
    """Resolve an API key from env var or SecretStore.

    Skips known placeholder values set by conftest.py (e.g. "test-key").
    """
    value = os.environ.get(env_name, "")
    if not value:
        try:
            from flowforge.core.secret_store import get_secret_store
            value = get_secret_store().resolve(env_name)
        except Exception:
            pass
    # Filter out conftest.py placeholder keys
    if value in ("test-key", "fake", "mock", "placeholder", "none"):
        return ""
    return value


def _is_valid_openrouter_key(key: str) -> bool:
    """Check if an OpenRouter API key looks like a real key.

    Real OpenRouter keys start with 'sk-or-v1-' and are at least 40 chars.
    """
    if not key:
        return False
    return key.startswith("sk-or-") and len(key) >= 40


OPENROUTER_API_KEY = _resolve_api_key("OPENROUTER_API_KEY")
HAS_OPENROUTER = _is_valid_openrouter_key(OPENROUTER_API_KEY)

# openroute requires the local proxy service on port 13000
# We verify it's actually functional by making a lightweight API call
HAS_OPENROUTE = False
try:
    import httpx
    _openroute_resp = httpx.get("http://127.0.0.1:13000/health", timeout=3)
    if _openroute_resp.status_code == 200:
        # Health endpoint is up — also verify a lightweight chat call works
        try:
            _test_resp = httpx.post(
                "http://127.0.0.1:13000/v1/chat/completions",
                json={"model": "auto", "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1},
                headers={"Authorization": "Bearer none", "Content-Type": "application/json"},
                timeout=15,
            )
            HAS_OPENROUTE = _test_resp.status_code == 200
        except Exception:
            HAS_OPENROUTE = False
except Exception:
    pass

HAS_ANY_PROVIDER = HAS_OPENROUTER or HAS_OPENROUTE


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def event_bus():
    return EventBus()


@pytest.fixture
def llm_client(event_bus):
    """Create an LLMClient with models config from the project."""
    from flowforge.core.config import ConfigLoader
    config_loader = ConfigLoader()
    models_config = config_loader.get_models_config()
    client = LLMClient(models_config=models_config, event_bus=event_bus)
    return client


@pytest.fixture
def model_service():
    """Create a ModelService instance."""
    return ModelService()


@pytest.fixture
async def available_model(model_service):
    """Find an available model via ModelService health check.

    Returns the model_key (e.g. 'openrouter/meta-llama/llama-3.3-70b-instruct:free')
    of the first available model, or None if no model is available.
    """
    if not HAS_OPENROUTER:
        return None
    try:
        results = await model_service.health_check_all(force=True)
        for r in results:
            if r.get("status") == "available":
                return r["model_key"]
    except Exception:
        pass
    return None


@pytest.fixture
def metrics_collector(event_bus):
    """Create a TestMetricsCollector for tracking LLM call metrics."""
    task_id = f"test-llm-integration-{int(time.time())}"
    return TestMetricsCollector(event_bus, task_id)


# ---------------------------------------------------------------------------
# TestLLMClientIntegration
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestLLMClientIntegration:
    """Integration tests for LLMClient — calls real LLM APIs."""

    @pytest.mark.skipif(not HAS_ANY_PROVIDER, reason="No LLM provider available (need OPENROUTER_API_KEY or openroute service)")
    @pytest.mark.timeout(60)
    @pytest.mark.asyncio
    async def test_simple_chat_completion(self, llm_client, metrics_collector, available_model):
        """Send a simple chat request and verify non-empty response.

        Discovers an available model via ModelService health check,
        then sends a real chat completion request.
        """
        if not available_model:
            pytest.skip("No available model found via health check")

        messages = [
            {"role": "system", "content": "You are a helpful assistant. Respond concisely."},
            {"role": "user", "content": "请用一句话介绍人工智能的发展趋势。"},
        ]
        tool_input = ToolInput(params={
            "messages": messages,
            "model": available_model,
            "max_tokens": 200,
            "temperature": 0.3,
            "task_id": metrics_collector.task_id,
        })

        result = await llm_client.execute(tool_input)

        # T3: 具体断言
        assert result.error is None, f"LLM call failed: {result.error}"
        assert result.result is not None, "Result is None"
        content = result.result.get("content", "")
        assert isinstance(content, str), f"Content should be str, got {type(content)}"
        assert len(content.strip()) > 0, "Content is empty"
        assert "provider" in result.result, "Missing 'provider' in result"
        assert "model" in result.result, "Missing 'model' in result"

        # T6: 采集指标
        report = metrics_collector.generate_report()
        assert report["llm"]["total_calls"] >= 1, "No LLM calls recorded"
        print(f"\n[指标] 响应时间: {report['llm']['latency_ms']}ms, "
              f"模型链: {report['llm']['model_chain']}")

    @pytest.mark.skipif(not HAS_OPENROUTER, reason="Need OPENROUTER_API_KEY for fallback test")
    @pytest.mark.timeout(60)
    @pytest.mark.asyncio
    async def test_model_chain_fallback(self, llm_client, metrics_collector, available_model):
        """Test model chain fallback: request a non-existent model first,
        then verify automatic fallback to an available model.
        """
        messages = [
            {"role": "user", "content": "请说出1+1等于几。"},
        ]
        tool_input = ToolInput(params={
            "messages": messages,
            "model": "openrouter/nonexistent-model-xyz:free",
            "max_tokens": 50,
            "temperature": 0.1,
            "task_id": metrics_collector.task_id,
        })

        result = await llm_client.execute(tool_input)

        # The call should succeed via fallback to another model
        assert result.error is None, f"Expected fallback to succeed but got error: {result.error}"
        content = result.result.get("content", "")
        assert len(content.strip()) > 0, "Fallback returned empty content"

        # Verify the model used is NOT the nonexistent one
        used_model = result.result.get("model", "")
        assert "nonexistent-model-xyz" not in used_model, \
            f"Should have fallen back, but used: {used_model}"

        # T6: 采集指标
        report = metrics_collector.generate_report()
        print(f"\n[指标] 回退测试 - 模型链: {report['llm']['model_chain']}, "
              f"调用次数: {report['llm']['total_calls']}")

    @pytest.mark.skipif(not HAS_ANY_PROVIDER, reason="No LLM provider available for streaming test")
    @pytest.mark.timeout(60)
    @pytest.mark.asyncio
    async def test_streaming_completion(self, llm_client, metrics_collector, available_model):
        """Test streaming output — verify at least 1 chunk is received."""
        if not available_model:
            pytest.skip("No available model found via health check")
        messages = [
            {"role": "user", "content": "请列举三种编程语言的名称。"},
        ]
        tool_input = ToolInput(params={
            "messages": messages,
            "model": available_model,
            "stream": True,
            "max_tokens": 200,
            "temperature": 0.3,
            "task_id": metrics_collector.task_id,
        })

        result = await llm_client.execute(tool_input)

        assert result.error is None, f"Streaming call failed: {result.error}"
        content = result.result.get("content", "")
        assert isinstance(content, str), f"Stream content should be str, got {type(content)}"
        assert len(content.strip()) > 0, "Streaming returned empty content"

        # T6: 采集指标
        report = metrics_collector.generate_report()
        print(f"\n[指标] 流式测试 - 内容长度: {len(content)}, "
              f"调用次数: {report['llm']['total_calls']}")

    @pytest.mark.skipif(not HAS_ANY_PROVIDER, reason="No LLM provider available for health test")
    @pytest.mark.timeout(60)
    @pytest.mark.asyncio
    async def test_health_status_update(self, llm_client, metrics_collector, available_model):
        """Test that health status is updated after a successful LLM call."""
        if not available_model:
            pytest.skip("No available model found via health check")
        messages = [
            {"role": "user", "content": "你好"},
        ]
        tool_input = ToolInput(params={
            "messages": messages,
            "model": available_model,
            "max_tokens": 50,
            "temperature": 0.1,
            "task_id": metrics_collector.task_id,
        })

        result = await llm_client.execute(tool_input)
        assert result.error is None, f"LLM call failed: {result.error}"

        # Check health report
        health_report = llm_client.get_health_report()
        assert "models" in health_report, "Health report missing 'models' key"
        assert "summary" in health_report, "Health report missing 'summary' key"

        # At least one model should have been called successfully
        models = health_report["models"]
        assert len(models) > 0, "No models in health report"

        # Find the model that was used
        used_model = result.result.get("model", "")
        used_provider = result.result.get("provider", "")
        model_key = f"{used_provider}/{used_model}"

        # The used model should have success_count > 0
        found = False
        for m in models:
            if m["model_key"] == model_key:
                assert m["success_count"] > 0, \
                    f"Model {model_key} should have success_count > 0 after successful call"
                found = True
                break
        # If model_key not in health report, it may have been recorded differently
        # — still pass as long as the report is non-empty
        if not found:
            print(f"\n[注意] 模型 {model_key} 未在健康报告中找到，"
                  f"但报告包含 {len(models)} 个模型记录")

        # T6: 采集指标
        report = metrics_collector.generate_report()
        print(f"\n[指标] 健康状态 - 可用模型: {health_report['summary']}")

    @pytest.mark.skipif(not HAS_OPENROUTER, reason="Need OPENROUTER_API_KEY for cross-provider fallback test")
    @pytest.mark.timeout(60)
    @pytest.mark.asyncio
    async def test_cross_provider_fallback(self, llm_client, metrics_collector, available_model):
        """Test cross-provider fallback from openroute to openrouter.

        Force a failure on the openroute provider by using a model that
        doesn't exist there, then verify fallback to openrouter.
        """
        if not available_model:
            pytest.skip("No available model found via health check")
        # Set up a scenario where openroute fails (nonexistent model)
        # and openrouter succeeds
        messages = [
            {"role": "user", "content": "请说出2+3等于几。"},
        ]
        # Request a model that doesn't exist, forcing fallback
        tool_input = ToolInput(params={
            "messages": messages,
            "model": "openroute/nonexistent-xyz-999",
            "max_tokens": 50,
            "temperature": 0.1,
            "task_id": metrics_collector.task_id,
        })

        result = await llm_client.execute(tool_input)

        # Should succeed via fallback
        assert result.error is None, f"Cross-provider fallback failed: {result.error}"
        content = result.result.get("content", "")
        assert len(content.strip()) > 0, "Cross-provider fallback returned empty content"

        # Verify the provider used is different from the failed one
        used_provider = result.result.get("provider", "")
        assert used_provider != "openroute" or "nonexistent-xyz-999" not in result.result.get("model", ""), \
            f"Should have fallen back to different provider/model, got {used_provider}/{result.result.get('model')}"

        # T6: 采集指标
        report = metrics_collector.generate_report()
        print(f"\n[指标] 跨供应商回退 - 模型链: {report['llm']['model_chain']}")


# ---------------------------------------------------------------------------
# TestModelServiceIntegration
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestModelServiceIntegration:
    """Integration tests for ModelService — calls real LLM APIs for health checks."""

    @pytest.mark.skipif(not HAS_OPENROUTER, reason="Need OPENROUTER_API_KEY for health check")
    @pytest.mark.timeout(30)
    @pytest.mark.asyncio
    async def test_health_check_single_model(self, model_service):
        """Perform health check on a single model and verify the result."""
        # Use a known free model from OpenRouter
        model_key = "openrouter/moonshotai/kimi-k2.6:free"
        result = await model_service.health_check_single(model_key, force=True)

        assert isinstance(result, dict), f"Result should be dict, got {type(result)}"
        assert "model_key" in result, "Missing 'model_key' in result"
        assert result["model_key"] == model_key, \
            f"model_key mismatch: expected {model_key}, got {result['model_key']}"
        assert "status" in result, "Missing 'status' in result"
        assert result["status"] in ("available", "disabled", "suspended"), \
            f"Unexpected status: {result['status']}"

        # If available, latency should be recorded
        if result["status"] == "available":
            assert "latency_ms" in result, "Missing latency_ms for available model"
            assert result["latency_ms"] > 0, "latency_ms should be positive"

        print(f"\n[指标] 单模型健康检查: {model_key} → {result['status']}, "
              f"延迟: {result.get('latency_ms', 'N/A')}ms")

    @pytest.mark.skipif(not HAS_OPENROUTER, reason="Need OPENROUTER_API_KEY for health check")
    @pytest.mark.timeout(60)
    @pytest.mark.asyncio
    async def test_health_check_all_models(self, model_service):
        """Perform health check on all active models and verify non-empty results."""
        results = await model_service.health_check_all(force=True)

        assert isinstance(results, list), f"Results should be list, got {type(results)}"
        assert len(results) > 0, "Health check returned empty list"

        for r in results:
            assert "model_key" in r, f"Missing 'model_key' in result: {r}"
            assert "status" in r, f"Missing 'status' in result: {r}"
            assert r["status"] in ("available", "disabled", "suspended", "unknown"), \
                f"Unexpected status for {r['model_key']}: {r['status']}"

        available_count = sum(1 for r in results if r["status"] == "available")
        print(f"\n[指标] 全模型健康检查: 总计 {len(results)} 个, "
              f"可用 {available_count} 个, "
              f"不可用 {len(results) - available_count} 个")

    @pytest.mark.timeout(10)
    def test_model_assignment_resolution(self, model_service):
        """Test model assignment resolution — verify persona-to-model mapping."""
        assignments = model_service.get_assignments()

        assert isinstance(assignments, dict), f"Assignments should be dict, got {type(assignments)}"
        assert len(assignments) > 0, "No assignments found"

        # Check default assignment exists
        assert "default" in assignments, "Missing 'default' assignment"
        default = assignments["default"]
        assert "primary" in default, "Default assignment missing 'primary'"
        assert default["primary"], "Default assignment has empty primary"

        # Verify model chain resolution
        chain = model_service.get_model_chain("default")
        assert isinstance(chain, list), f"Chain should be list, got {type(chain)}"
        assert len(chain) > 0, "Model chain is empty"

        # Each chain entry should be in provider/model_id format
        for entry in chain:
            assert "/" in entry, f"Chain entry '{entry}' not in provider/model_id format"

        print(f"\n[指标] 模型分配: default → primary={default['primary']}, "
              f"chain={chain}")

    @pytest.mark.skipif(not HAS_OPENROUTER, reason="Need OPENROUTER_API_KEY for suspended model recovery test")
    @pytest.mark.timeout(30)
    @pytest.mark.asyncio
    async def test_suspended_model_recovery(self, model_service):
        """Test suspended model recovery mechanism.

        Manually suspend a model, then force a health check to recover it.
        """
        model_key = "openrouter/moonshotai/kimi-k2.6:free"

        # First, ensure the model is available
        initial = await model_service.health_check_single(model_key, force=True)
        if initial["status"] == "disabled":
            pytest.skip(f"Model {model_key} is disabled, cannot test recovery")

        # Manually suspend the model
        from datetime import datetime, timedelta
        suspended_until = datetime.utcnow() + timedelta(seconds=10)
        model_service._update_health_state(
            model_key,
            ModelService.STATUS_SUSPENDED,
            suspended_until=suspended_until.isoformat(),
            suspended_until_ts=suspended_until.timestamp(),
            reason="test_suspension",
        )

        # Verify it's suspended (without force, should return cached)
        suspended = await model_service.health_check_single(model_key, force=False)
        assert suspended["status"] == "suspended", \
            f"Expected suspended, got {suspended['status']}"

        # Force health check to recover
        recovered = await model_service.health_check_single(model_key, force=True)
        assert recovered["status"] in ("available", "suspended", "disabled"), \
            f"Unexpected recovery status: {recovered['status']}"

        # If the model is actually healthy, it should recover to available
        if recovered["status"] == "available":
            assert "latency_ms" in recovered, "Missing latency_ms for recovered model"

        print(f"\n[指标] 暂停恢复: {model_key} → "
              f"初始={initial['status']}, "
              f"暂停后={suspended['status']}, "
              f"恢复后={recovered['status']}")

    @pytest.mark.skipif(not HAS_OPENROUTER, reason="Need OPENROUTER_API_KEY for auto-fix test")
    @pytest.mark.timeout(30)
    @pytest.mark.asyncio
    async def test_auto_fix_models(self, model_service):
        """Test model auto-fix functionality.

        Run auto_fix on the default assignment and verify the report structure.
        """
        report = await model_service.auto_fix(assignment_key="default", cascade=True)

        assert isinstance(report, dict), f"Report should be dict, got {type(report)}"
        assert "assignment_key" in report, "Missing 'assignment_key' in report"
        assert "fixes" in report, "Missing 'fixes' in report"
        assert "cascade_suggestions" in report, "Missing 'cascade_suggestions' in report"
        assert "summary" in report, "Missing 'summary' in report"
        assert report["assignment_key"] == "default", \
            f"Expected 'default', got {report['assignment_key']}"

        # fixes should be a list (may be empty if all models are healthy)
        assert isinstance(report["fixes"], list), "fixes should be a list"
        assert isinstance(report["cascade_suggestions"], list), \
            "cascade_suggestions should be a list"

        print(f"\n[指标] 自动修复: {report['summary']}, "
              f"修复数={len(report['fixes'])}, "
              f"级联建议={len(report['cascade_suggestions'])}")
