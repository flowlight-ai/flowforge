import pytest
from flowforge.core import metrics


@pytest.fixture(autouse=True)
def reset_metrics():
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
    yield


def test_record_tool_call():
    metrics.record_tool_call("llm", 1.5)
    metrics.record_tool_call("llm", 2.5)
    stats = metrics.get_tool_stats()
    if not metrics._prometheus_available:
        assert "llm" in stats
        assert stats["llm"]["call_count"] == 2
        assert stats["llm"]["total_duration"] == 4.0
        assert stats["llm"]["avg_duration"] == 2.0
        assert stats["llm"]["min_duration"] == 1.5
        assert stats["llm"]["max_duration"] == 2.5


def test_record_tool_call_multiple_tools():
    metrics.record_tool_call("llm", 1.0)
    metrics.record_tool_call("web_search", 0.5)
    stats = metrics.get_tool_stats()
    if not metrics._prometheus_available:
        assert "llm" in stats
        assert "web_search" in stats


def test_record_llm_tokens():
    metrics.record_llm_tokens("openrouter", "claude-3.5-sonnet", 100)
    metrics.record_llm_tokens("openrouter", "claude-3.5-sonnet", 50)
    stats = metrics.get_llm_token_stats()
    if not metrics._prometheus_available:
        key = "openrouter/claude-3.5-sonnet"
        assert key in stats
        assert stats[key] == 150


def test_record_llm_tokens_multiple_providers():
    metrics.record_llm_tokens("openrouter", "model-a", 100)
    metrics.record_llm_tokens("aliyuncs", "model-b", 200)
    stats = metrics.get_llm_token_stats()
    if not metrics._prometheus_available:
        assert "openrouter/model-a" in stats
        assert "aliyuncs/model-b" in stats


def test_record_task_created():
    metrics.record_task_created("react", "education")
    metrics.record_task_created("react", "education")
    metrics.record_task_created("workflow", "life")
    stats = metrics.get_task_stats()
    if not metrics._prometheus_available:
        assert "react/education" in stats
        assert stats["react/education"]["created"] == 2
        assert "workflow/life" in stats
        assert stats["workflow/life"]["created"] == 1


def test_record_task_completed():
    metrics.record_task_created("react", "education")
    metrics.record_task_completed("react", "education", 5.0)
    stats = metrics.get_task_stats()
    if not metrics._prometheus_available:
        assert stats["react/education"]["completed"] == 1
        assert stats["react/education"]["avg_duration"] == 5.0


def test_record_task_completed_multiple():
    metrics.record_task_created("react", "education")
    metrics.record_task_completed("react", "education", 3.0)
    metrics.record_task_completed("react", "education", 7.0)
    stats = metrics.get_task_stats()
    if not metrics._prometheus_available:
        assert stats["react/education"]["avg_duration"] == 5.0


def test_record_task_failed():
    metrics.record_task_created("react", "education")
    metrics.record_task_failed("react", "education")
    stats = metrics.get_task_stats()
    if not metrics._prometheus_available:
        assert stats["react/education"]["failed"] == 1


def test_get_metrics():
    metrics.record_tool_call("llm", 1.0)
    metrics.record_task_created("react", "education")
    metrics.record_llm_tokens("openrouter", "model-a", 100)
    result = metrics.get_metrics()
    assert "tool_stats" in result
    assert "task_stats" in result
    assert "llm_token_stats" in result


def test_get_tool_stats_empty():
    stats = metrics.get_tool_stats()
    assert isinstance(stats, dict)


def test_get_task_stats_empty():
    stats = metrics.get_task_stats()
    assert isinstance(stats, dict)


def test_get_llm_token_stats_empty():
    stats = metrics.get_llm_token_stats()
    assert isinstance(stats, dict)


def test_record_tool_error():
    metrics.record_tool_error("llm")


def test_record_llm_error():
    metrics.record_llm_error("openrouter", "TimeoutError")


def test_set_persona_running():
    metrics.set_persona_running("education", 1)


def test_get_prometheus_metrics():
    result = metrics.get_prometheus_metrics()
    assert isinstance(result, bytes)
