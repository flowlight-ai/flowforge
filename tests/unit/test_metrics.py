import importlib
import sys
from unittest.mock import patch, MagicMock

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


def test_record_tool_call():
    metrics.record_tool_call("llm", 1.5)
    metrics.record_tool_call("llm", 2.5)
    stats = metrics.get_tool_stats()
    assert "llm" in stats
    assert stats["llm"]["call_count"] == 2
    assert stats["llm"]["total_duration"] == pytest.approx(4.0)
    assert stats["llm"]["avg_duration"] == pytest.approx(2.0)
    assert stats["llm"]["min_duration"] == pytest.approx(1.5)
    assert stats["llm"]["max_duration"] == pytest.approx(2.5)


def test_record_tool_call_multiple_tools():
    metrics.record_tool_call("llm", 1.0)
    metrics.record_tool_call("web_search", 0.5)
    stats = metrics.get_tool_stats()
    assert "llm" in stats
    assert "web_search" in stats
    assert stats["llm"]["call_count"] == 1
    assert stats["web_search"]["call_count"] == 1


def test_record_llm_tokens():
    metrics.record_llm_tokens("openrouter", "claude-3.5-sonnet", 100)
    metrics.record_llm_tokens("openrouter", "claude-3.5-sonnet", 50)
    stats = metrics.get_llm_token_stats()
    key = "openrouter/claude-3.5-sonnet"
    assert key in stats
    assert stats[key] == 150


def test_record_llm_tokens_multiple_providers():
    metrics.record_llm_tokens("openrouter", "model-a", 100)
    metrics.record_llm_tokens("aliyuncs", "model-b", 200)
    stats = metrics.get_llm_token_stats()
    assert "openrouter/model-a" in stats
    assert "aliyuncs/model-b" in stats
    assert stats["openrouter/model-a"] == 100
    assert stats["aliyuncs/model-b"] == 200


def test_record_task_created():
    metrics.record_task_created("react", "education")
    metrics.record_task_created("react", "education")
    metrics.record_task_created("workflow", "life")
    stats = metrics.get_task_stats()
    assert "react/education" in stats
    assert stats["react/education"]["created"] == 2
    assert "workflow/life" in stats
    assert stats["workflow/life"]["created"] == 1


def test_record_task_completed():
    metrics.record_task_created("react", "education")
    metrics.record_task_completed("react", "education", 5.0)
    stats = metrics.get_task_stats()
    assert stats["react/education"]["completed"] == 1
    assert stats["react/education"]["avg_duration"] == pytest.approx(5.0)


def test_record_task_completed_multiple():
    metrics.record_task_created("react", "education")
    metrics.record_task_completed("react", "education", 3.0)
    metrics.record_task_completed("react", "education", 7.0)
    stats = metrics.get_task_stats()
    assert stats["react/education"]["avg_duration"] == pytest.approx(5.0)


def test_record_task_failed():
    metrics.record_task_created("react", "education")
    metrics.record_task_failed("react", "education")
    stats = metrics.get_task_stats()
    assert stats["react/education"]["failed"] == 1


def test_get_metrics():
    metrics.record_tool_call("llm", 1.0)
    metrics.record_task_created("react", "education")
    metrics.record_llm_tokens("openrouter", "model-a", 100)
    result = metrics.get_metrics()
    assert "tool_stats" in result
    assert "task_stats" in result
    assert "llm_token_stats" in result
    assert "llm" in result["tool_stats"]
    assert "react/education" in result["task_stats"]
    assert "openrouter/model-a" in result["llm_token_stats"]


def test_get_tool_stats_empty():
    stats = metrics.get_tool_stats()
    assert stats == {}


def test_get_task_stats_empty():
    stats = metrics.get_task_stats()
    assert stats == {}


def test_get_llm_token_stats_empty():
    stats = metrics.get_llm_token_stats()
    assert stats == {}


def test_record_tool_error():
    metrics.record_tool_error("llm")
    stats = metrics.get_tool_stats()
    assert "llm" in stats
    assert stats["llm"]["error_count"] > 0


def test_record_llm_error():
    metrics.record_llm_error("openrouter", "TimeoutError")
    if metrics._prometheus_available:
        result = metrics.get_prometheus_metrics()
        assert b"flowforge_llm_errors_total" in result
        assert b"openrouter" in result
        assert b"TimeoutError" in result
    else:
        assert "openrouter" in metrics._llm_error_counts
        assert "TimeoutError" in metrics._llm_error_counts["openrouter"]
        assert metrics._llm_error_counts["openrouter"]["TimeoutError"] == 1


def test_set_persona_running():
    metrics.set_persona_running("education", 3)
    if metrics._prometheus_available:
        result = metrics.get_prometheus_metrics()
        assert b"flowforge_persona_running" in result
        assert b"education" in result
    else:
        assert "education" in metrics._persona_running_counts
        assert metrics._persona_running_counts["education"] == 3


def test_get_prometheus_metrics():
    result = metrics.get_prometheus_metrics()
    assert isinstance(result, bytes)
    if metrics._prometheus_available:
        assert len(result) > 0
        assert b"flowforge_" in result
    else:
        assert result == b""


def test_record_tool_call_and_get_stats():
    metrics.record_tool_call("web_search", 1.2)
    metrics.record_tool_call("web_search", 2.8)
    stats = metrics.get_tool_stats()
    assert "web_search" in stats
    assert stats["web_search"]["call_count"] == 2
    assert stats["web_search"]["total_duration"] == pytest.approx(4.0)
    assert stats["web_search"]["avg_duration"] == pytest.approx(2.0)
    assert stats["web_search"]["min_duration"] == pytest.approx(1.2)
    assert stats["web_search"]["max_duration"] == pytest.approx(2.8)
    assert stats["web_search"]["error_count"] == 0


def test_record_task_lifecycle_and_get_stats():
    metrics.record_task_created("react", "life")
    metrics.record_task_created("react", "life")
    metrics.record_task_completed("react", "life", 4.0)
    metrics.record_task_failed("react", "life")
    stats = metrics.get_task_stats()
    assert "react/life" in stats
    assert stats["react/life"]["created"] == 2
    assert stats["react/life"]["completed"] == 1
    assert stats["react/life"]["failed"] == 1
    assert stats["react/life"]["avg_duration"] == pytest.approx(4.0)


def test_record_llm_tokens_and_get_stats():
    metrics.record_llm_tokens("openrouter", "gpt-4", 500)
    metrics.record_llm_tokens("openrouter", "gpt-4", 300)
    stats = metrics.get_llm_token_stats()
    assert "openrouter/gpt-4" in stats
    assert stats["openrouter/gpt-4"] == 800


@pytest.fixture
def prometheus_metrics():
    mock_pc = MagicMock()
    mock_pc.generate_latest.return_value = b'# HELP flowforge_tasks_total Total tasks created\n'
    with patch.dict(sys.modules, {'prometheus_client': mock_pc}):
        importlib.reload(metrics)
        for attr in ('_tool_call_data', '_llm_token_data', '_task_created_data',
                      '_task_completed_data', '_task_failed_data', '_task_durations_data'):
            obj = getattr(metrics, attr, None)
            if obj is not None and hasattr(obj, 'clear'):
                obj.clear()
        yield metrics
    importlib.reload(metrics)


@pytest.fixture
def no_prometheus_metrics():
    saved = {}
    for key in list(sys.modules.keys()):
        if key == 'prometheus_client' or key.startswith('prometheus_client.'):
            saved[key] = sys.modules.pop(key)
    sys.modules['prometheus_client'] = None
    try:
        importlib.reload(metrics)
        for attr in ('_tool_call_durations', '_tool_error_counts', '_llm_token_counts',
                      '_llm_error_counts', '_task_created', '_task_completed',
                      '_task_failed', '_task_durations', '_persona_running_counts'):
            obj = getattr(metrics, attr, None)
            if obj is not None and hasattr(obj, 'clear'):
                obj.clear()
        yield metrics
    finally:
        del sys.modules['prometheus_client']
        sys.modules.update(saved)
        importlib.reload(metrics)


def test_prometheus_record_tool_call_and_get_stats(prometheus_metrics):
    m = prometheus_metrics
    m.record_tool_call("web_search", 1.5)
    m.record_tool_call("web_search", 2.5)
    stats = m.get_tool_stats()
    assert "web_search" in stats
    assert stats["web_search"]["call_count"] == 2
    assert stats["web_search"]["total_duration"] == pytest.approx(4.0)
    assert stats["web_search"]["avg_duration"] == pytest.approx(2.0)
    assert stats["web_search"]["min_duration"] == pytest.approx(1.5)
    assert stats["web_search"]["max_duration"] == pytest.approx(2.5)


def test_prometheus_record_tool_error_in_stats(prometheus_metrics):
    m = prometheus_metrics
    m.record_tool_error("web_search")
    stats = m.get_tool_stats()
    assert "web_search" in stats
    assert stats["web_search"]["error_count"] == 1
    assert stats["web_search"]["call_count"] == 1


def test_prometheus_record_task_lifecycle(prometheus_metrics):
    m = prometheus_metrics
    m.record_task_created("react", "education")
    m.record_task_completed("react", "education", 5.0)
    m.record_task_failed("react", "life")
    stats = m.get_task_stats()
    assert "react/education" in stats
    assert stats["react/education"]["created"] == 1
    assert stats["react/education"]["completed"] == 1
    assert "react/life" in stats
    assert stats["react/life"]["failed"] == 1


def test_prometheus_record_llm_tokens(prometheus_metrics):
    m = prometheus_metrics
    m.record_llm_tokens("openrouter", "gpt-4", 100)
    m.record_llm_tokens("openrouter", "gpt-4", 50)
    stats = m.get_llm_token_stats()
    assert "openrouter/gpt-4" in stats
    assert stats["openrouter/gpt-4"] == 150


def test_prometheus_get_metrics(prometheus_metrics):
    m = prometheus_metrics
    m.record_tool_call("llm", 1.0)
    m.record_task_created("react", "education")
    m.record_llm_tokens("openrouter", "gpt-4", 100)
    result = m.get_metrics()
    assert "tool_stats" in result
    assert "task_stats" in result
    assert "llm_token_stats" in result
    assert "llm" in result["tool_stats"]
    assert "react/education" in result["task_stats"]
    assert "openrouter/gpt-4" in result["llm_token_stats"]


def test_prometheus_get_prometheus_metrics(prometheus_metrics):
    m = prometheus_metrics
    result = m.get_prometheus_metrics()
    assert isinstance(result, bytes)
    assert b"flowforge_" in result


def test_prometheus_empty_durations_skipped(prometheus_metrics):
    m = prometheus_metrics
    m._tool_call_data["empty_tool"] = []
    stats = m.get_tool_stats()
    assert "empty_tool" not in stats


def test_prometheus_tool_stats_only_errors_no_duration(prometheus_metrics):
    m = prometheus_metrics
    m.record_tool_error("failing_tool")
    stats = m.get_tool_stats()
    assert "failing_tool" in stats
    assert stats["failing_tool"]["error_count"] == 1
    assert stats["failing_tool"]["call_count"] == 1
    assert "total_duration" not in stats["failing_tool"]


def test_non_prometheus_record_tool_error(no_prometheus_metrics):
    m = no_prometheus_metrics
    m.record_tool_error("web_search")
    assert "web_search" in m._tool_error_counts
    assert m._tool_error_counts["web_search"] == 1


def test_non_prometheus_set_persona_running(no_prometheus_metrics):
    m = no_prometheus_metrics
    m.set_persona_running("education", 3)
    assert "education" in m._persona_running_counts
    assert m._persona_running_counts["education"] == 3


def test_non_prometheus_get_tool_stats_with_errors(no_prometheus_metrics):
    m = no_prometheus_metrics
    m.record_tool_call("web_search", 1.0)
    m.record_tool_error("web_search")
    stats = m.get_tool_stats()
    assert "web_search" in stats
    assert stats["web_search"]["error_count"] == 1


def test_non_prometheus_get_prometheus_metrics_returns_empty(no_prometheus_metrics):
    m = no_prometheus_metrics
    result = m.get_prometheus_metrics()
    assert result == b""


def test_non_prometheus_record_tool_call(no_prometheus_metrics):
    m = no_prometheus_metrics
    m.record_tool_call("web_search", 1.5)
    m.record_tool_call("web_search", 2.5)
    stats = m.get_tool_stats()
    assert "web_search" in stats
    assert stats["web_search"]["call_count"] == 2
    assert stats["web_search"]["total_duration"] == pytest.approx(4.0)
    assert stats["web_search"]["avg_duration"] == pytest.approx(2.0)
    assert stats["web_search"]["min_duration"] == pytest.approx(1.5)
    assert stats["web_search"]["max_duration"] == pytest.approx(2.5)
    assert stats["web_search"]["error_count"] == 0


def test_non_prometheus_record_llm_tokens(no_prometheus_metrics):
    m = no_prometheus_metrics
    m.record_llm_tokens("openrouter", "gpt-4", 100)
    m.record_llm_tokens("openrouter", "gpt-4", 50)
    stats = m.get_llm_token_stats()
    assert "openrouter/gpt-4" in stats
    assert stats["openrouter/gpt-4"] == 150


def test_non_prometheus_record_llm_error(no_prometheus_metrics):
    m = no_prometheus_metrics
    m.record_llm_error("openrouter", "TimeoutError")
    assert "openrouter" in m._llm_error_counts
    assert "TimeoutError" in m._llm_error_counts["openrouter"]
    assert m._llm_error_counts["openrouter"]["TimeoutError"] == 1


def test_non_prometheus_record_task_created(no_prometheus_metrics):
    m = no_prometheus_metrics
    m.record_task_created("react", "education")
    stats = m.get_task_stats()
    assert "react/education" in stats
    assert stats["react/education"]["created"] == 1


def test_non_prometheus_record_task_completed(no_prometheus_metrics):
    m = no_prometheus_metrics
    m.record_task_completed("react", "education", 5.0)
    stats = m.get_task_stats()
    assert "react/education" in stats
    assert stats["react/education"]["completed"] == 1
    assert stats["react/education"]["avg_duration"] == pytest.approx(5.0)


def test_non_prometheus_record_task_failed(no_prometheus_metrics):
    m = no_prometheus_metrics
    m.record_task_failed("react", "education")
    stats = m.get_task_stats()
    assert "react/education" in stats
    assert stats["react/education"]["failed"] == 1


def test_non_prometheus_get_task_stats(no_prometheus_metrics):
    m = no_prometheus_metrics
    m.record_task_created("react", "education")
    m.record_task_completed("react", "education", 5.0)
    m.record_task_failed("react", "life")
    stats = m.get_task_stats()
    assert "react/education" in stats
    assert stats["react/education"]["created"] == 1
    assert stats["react/education"]["completed"] == 1
    assert stats["react/education"]["avg_duration"] == pytest.approx(5.0)
    assert "react/life" in stats
    assert stats["react/life"]["failed"] == 1


def test_non_prometheus_get_llm_token_stats(no_prometheus_metrics):
    m = no_prometheus_metrics
    m.record_llm_tokens("openrouter", "gpt-4", 100)
    stats = m.get_llm_token_stats()
    assert "openrouter/gpt-4" in stats
    assert stats["openrouter/gpt-4"] == 100


def test_non_prometheus_get_metrics(no_prometheus_metrics):
    m = no_prometheus_metrics
    m.record_tool_call("llm", 1.0)
    m.record_task_created("react", "education")
    m.record_llm_tokens("openrouter", "gpt-4", 100)
    result = m.get_metrics()
    assert "tool_stats" in result
    assert "task_stats" in result
    assert "llm_token_stats" in result


def test_non_prometheus_tool_stats_only_errors(no_prometheus_metrics):
    m = no_prometheus_metrics
    m.record_tool_error("failing_tool")
    stats = m.get_tool_stats()
    assert "failing_tool" in stats
    assert stats["failing_tool"]["call_count"] == 0
    assert stats["failing_tool"]["error_count"] == 1


def test_non_prometheus_empty_durations_skipped(no_prometheus_metrics):
    m = no_prometheus_metrics
    m._tool_call_durations["empty_tool"] = []
    stats = m.get_tool_stats()
    assert "empty_tool" not in stats


def test_multiple_tools_stats():
    metrics.record_tool_call("llm", 1.0)
    metrics.record_tool_call("web_search", 0.5)
    metrics.record_tool_call("llm", 2.0)
    metrics.record_tool_error("web_search")
    stats = metrics.get_tool_stats()
    assert "llm" in stats
    assert "web_search" in stats
    assert stats["llm"]["call_count"] == 2
    assert stats["llm"]["error_count"] == 0
    assert stats["web_search"]["error_count"] >= 1


def test_tool_stats_with_only_errors():
    metrics.record_tool_error("failing_tool")
    stats = metrics.get_tool_stats()
    assert "failing_tool" in stats
    assert stats["failing_tool"]["error_count"] > 0


def test_task_stats_avg_duration():
    metrics.record_task_created("react", "education")
    metrics.record_task_completed("react", "education", 3.0)
    metrics.record_task_completed("react", "education", 7.0)
    stats = metrics.get_task_stats()
    assert stats["react/education"]["avg_duration"] == pytest.approx(5.0)


def test_llm_token_stats_accumulation():
    metrics.record_llm_tokens("openrouter", "gpt-4", 100)
    metrics.record_llm_tokens("openrouter", "gpt-4", 200)
    metrics.record_llm_tokens("openrouter", "gpt-4", 300)
    stats = metrics.get_llm_token_stats()
    assert stats["openrouter/gpt-4"] == 600
