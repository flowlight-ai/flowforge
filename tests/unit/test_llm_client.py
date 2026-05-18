import pytest
from flowforge.tools.llm_client import LLMClient


def test_llm_client_init():
    client = LLMClient()
    assert client.name == "llm"
    assert client._health_status == {}


def test_llm_client_with_models_config():
    config = {
        "providers": {
            "openrouter": {"base_url": "https://openrouter.ai/api/v1"},
        },
        "assignments": {
            "education": {
                "topic_research": {
                    "primary": "openrouter/claude-3.5-sonnet",
                    "fallbacks": ["openrouter/gpt-4o"],
                }
            }
        }
    }
    client = LLMClient(models_config=config)
    chain = client._get_model_chain("education", "topic_research")
    assert chain == ["openrouter/claude-3.5-sonnet", "openrouter/gpt-4o"]


def test_llm_client_model_chain_no_assignment():
    client = LLMClient(models_config={})
    chain = client._get_model_chain("nonexistent", "unknown")
    assert len(chain) > 0


def test_llm_client_model_chain_no_agent():
    config = {
        "assignments": {
            "education": {}
        }
    }
    client = LLMClient(models_config=config)
    chain = client._get_model_chain("education", "unknown_agent")
    assert len(chain) > 0


def test_llm_client_update_assignment():
    client = LLMClient()
    client.update_assignment("life", "topic_research", "openrouter/gpt-4o", ["openrouter/claude-3.5-sonnet"])
    assignments = client.get_assignments()
    assert "life" in assignments
    assert assignments["life"]["topic_research"]["primary"] == "openrouter/gpt-4o"
    assert assignments["life"]["topic_research"]["fallbacks"] == ["openrouter/claude-3.5-sonnet"]


def test_llm_client_update_assignment_no_fallbacks():
    client = LLMClient()
    client.update_assignment("tech", "article_writing", "aliyuncs/qwen-max")
    assignments = client.get_assignments()
    assert assignments["tech"]["article_writing"]["fallbacks"] == []


def test_llm_client_health_report_empty():
    client = LLMClient()
    report = client.get_health_report()
    assert report["models"] == []
    assert report["summary"]["total"] == 0
    assert report["summary"]["healthy"] == 0


def test_llm_client_health_report_healthy():
    client = LLMClient()
    client._update_health("openrouter", "claude-3.5-sonnet", True)
    report = client.get_health_report()
    assert report["summary"]["healthy"] == 1
    assert report["models"][0]["status"] == "healthy"


def test_llm_client_health_report_degraded():
    client = LLMClient()
    client._update_health("openrouter", "model-a", True)
    client._update_health("openrouter", "model-a", True)
    client._update_health("openrouter", "model-a", False, "timeout")
    report = client.get_health_report()
    assert report["summary"]["degraded"] == 1
    assert report["models"][0]["status"] == "degraded"


def test_llm_client_health_report_unhealthy():
    client = LLMClient()
    client._update_health("openrouter", "model-b", False, "connection error")
    client._update_health("openrouter", "model-b", False, "timeout")
    report = client.get_health_report()
    assert report["summary"]["unhealthy"] == 1
    assert report["models"][0]["status"] == "unhealthy"


def test_llm_client_update_health_success():
    client = LLMClient()
    client._update_health("openrouter", "model-x", True)
    key = "openrouter/model-x"
    assert client._health_status[key]["success_count"] == 1
    assert client._health_status[key]["error_count"] == 0
    assert client._health_status[key]["last_error"] == ""


def test_llm_client_update_health_failure():
    client = LLMClient()
    client._update_health("openrouter", "model-x", False, "timeout")
    key = "openrouter/model-x"
    assert client._health_status[key]["success_count"] == 0
    assert client._health_status[key]["error_count"] == 1
    assert client._health_status[key]["last_error"] == "timeout"


def test_llm_client_default_base_url():
    from flowforge.tools.llm_client import PROVIDER_BASE_URLS
    assert PROVIDER_BASE_URLS["openrouter"] == "https://openrouter.ai/api/v1"
    assert PROVIDER_BASE_URLS["aliyuncs"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert PROVIDER_BASE_URLS["ark"] == "https://ark.cn-beijing.volces.com/api/v3"
    assert PROVIDER_BASE_URLS.get("unknown", "") == ""


def test_llm_client_set_event_bus():
    from flowforge.events.event_bus import EventBus
    client = LLMClient()
    bus = EventBus()
    client.set_event_bus(bus)
    assert client._event_bus is bus


@pytest.mark.asyncio
async def test_llm_client_execute_no_api_key():
    import os
    os.environ.pop("OPENROUTER_API_KEY", None)
    os.environ.pop("ALIYUNCS_API_KEY", None)
    os.environ.pop("ARK_API_KEY", None)
    client = LLMClient()
    from flowforge.core.base_tool import ToolInput
    result = await client.execute(ToolInput(params={
        "messages": [{"role": "user", "content": "hello"}],
        "model": "openrouter/test-model",
    }))
    assert result.error is not None
