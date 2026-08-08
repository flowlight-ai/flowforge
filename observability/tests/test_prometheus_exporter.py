"""PrometheusExporter 单元测试。

覆盖：
- 指标注册完整性
- Counter / Histogram / Gauge 上报
- /metrics endpoint 输出格式
- 4 个新增生产指标的上报
- sync_from_collector 兜底同步
- ContentForge 业务指标

使用 FastAPI TestClient，不启动真实 HTTP 服务。
"""

from __future__ import annotations

import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from prometheus_client import CollectorRegistry

from flowforge.observability.metrics_collector import MetricsCollector
from flowforge.observability.prometheus_exporter import (
    PrometheusExporter,
    get_default_exporter,
    register_metrics_endpoint,
    reset_default_exporter,
)

# ── 公共 fixture ────────────────────────────────────────────────────────


@pytest.fixture
def fresh_exporter() -> PrometheusExporter:
    """每个测试用例使用独立的 exporter + 独立 registry，避免指标冲突。"""
    registry = CollectorRegistry()
    collector = MetricsCollector()
    return PrometheusExporter(collector=collector, registry=registry)


@pytest.fixture
def app_with_metrics(fresh_exporter: PrometheusExporter) -> FastAPI:
    """注册了 /metrics 端点的 FastAPI 应用。"""
    app = FastAPI()
    register_metrics_endpoint(app, exporter=fresh_exporter, path="/metrics")
    return app


# ── 1. 指标注册完整性 ───────────────────────────────────────────────────


def test_all_metrics_registered(fresh_exporter: PrometheusExporter) -> None:
    """测试 1：所有 14 个指标均被注册到 registry。

    注意：prometheus_client 的 Counter 在 ``collect()`` 返回的 ``m.name`` 中
    会自动去掉 ``_total`` 后缀（仅在序列化时加回），因此这里改为校验
    ``generate_latest()`` 的文本输出，更贴近用户实际看到的内容。
    """
    # 触发所有 14 个指标，确保它们出现在 collect() 输出中
    fresh_exporter.record_task(mode="test", status="test")
    fresh_exporter.record_execution_duration(mode="test", duration_seconds=0.1)
    fresh_exporter.record_token_usage(provider="test", model="test", tokens=1)
    fresh_exporter.record_tool_call(tool_name="test", status="test")
    fresh_exporter.set_persona_running(persona="test", count=1)
    fresh_exporter.record_article_quality(score=0.5, persona="test", task_id="test")
    fresh_exporter.record_publish_result(success=True, platform="test", persona="test")
    fresh_exporter.record_publish_result(success=False, platform="test", persona="test")
    fresh_exporter.record_persona_usage(persona="test")
    fresh_exporter.record_topic_research_duration(
        duration_seconds=0.1, strategy="test", persona="test"
    )
    fresh_exporter.record_loop_duration(duration_seconds=0.1, mode="test")
    fresh_exporter.record_llm_webchat_duration(duration_seconds=0.1, provider="test")
    fresh_exporter.record_degradation(action_type="test")
    fresh_exporter.set_provider_quota_used_ratio(provider="test", ratio=0.1)

    # 通过 generate_latest 文本输出校验（保留 _total 后缀）
    output = fresh_exporter.generate_latest().decode("utf-8")

    expected_metrics = {
        # 5 个核心指标
        "flowforge_tasks_total",
        "flowforge_execution_duration_seconds",
        "flowforge_token_usage_total",
        "flowforge_tool_calls_total",
        "flowforge_persona_running",
        # 5 个 ContentForge 业务指标
        "contentforge_article_quality_score",
        "contentforge_publish_success_total",
        "contentforge_publish_failure_total",
        "contentforge_persona_usage_total",
        "contentforge_topic_research_duration_seconds",
        # 4 个生产指标
        "flowforge_loop_duration_seconds",
        "flowforge_llm_webchat_duration_seconds",
        "flowforge_degradation_total",
        "flowforge_provider_quota_used_ratio",
    }
    missing = [name for name in expected_metrics if name not in output]
    assert not missing, f"缺失指标: {missing}"


def test_list_registered_metrics_returns_all_14(fresh_exporter: PrometheusExporter) -> None:
    """测试 2：list_registered_metrics 返回 14 个指标名。"""
    names = fresh_exporter.list_registered_metrics()
    assert len(names) == 14
    assert "flowforge_loop_duration_seconds" in names
    assert "flowforge_provider_quota_used_ratio" in names


# ── 2. Counter 上报 ──────────────────────────────────────────────────────


def test_counter_recording(fresh_exporter: PrometheusExporter) -> None:
    """测试 3：Counter 上报后 generate_latest 输出包含正确的累计值。"""
    fresh_exporter.record_task(mode="react", status="completed")
    fresh_exporter.record_task(mode="react", status="completed")
    fresh_exporter.record_task(mode="plan_execute", status="failed")

    output = fresh_exporter.generate_latest().decode("utf-8")
    # 总计 3 个任务
    assert "flowforge_tasks_total" in output
    # mode=react,status=completed 应该为 2
    react_match = re.search(
        r'flowforge_tasks_total\{mode="react",status="completed"\} (\d+)', output
    )
    assert react_match is not None, "未找到 react/completed 计数"
    assert int(react_match.group(1)) == 2
    # mode=plan_execute,status=failed 应该为 1
    plan_match = re.search(
        r'flowforge_tasks_total\{mode="plan_execute",status="failed"\} (\d+)', output
    )
    assert plan_match is not None, "未找到 plan_execute/failed 计数"
    assert int(plan_match.group(1)) == 1


def test_counter_synced_to_collector(fresh_exporter: PrometheusExporter) -> None:
    """测试 4：便捷上报方法同时写入 MetricsCollector。"""
    fresh_exporter.record_task(mode="react", status="completed")
    fresh_exporter.record_tool_call(tool_name="web_search", status="success")

    # 验证 collector 也有对应数据
    collector_data = fresh_exporter.collector.get_all_metrics()
    counters = collector_data["counters"]
    assert any("flowforge_tasks_total" in k for k in counters)
    assert any("flowforge_tool_calls_total" in k for k in counters)


# ── 3. Histogram 上报 ───────────────────────────────────────────────────


def test_histogram_recording(fresh_exporter: PrometheusExporter) -> None:
    """测试 5：Histogram 上报后输出包含 count 与 sum。"""
    fresh_exporter.record_execution_duration(mode="react", duration_seconds=1.5)
    fresh_exporter.record_execution_duration(mode="react", duration_seconds=2.5)

    output = fresh_exporter.generate_latest().decode("utf-8")
    # 检查 histogram 的 _count 与 _sum
    count_match = re.search(
        r'flowforge_execution_duration_seconds_count\{mode="react"\} (\d+)', output
    )
    assert count_match is not None, "未找到 execution_duration_count"
    assert int(count_match.group(1)) == 2

    sum_match = re.search(
        r'flowforge_execution_duration_seconds_sum\{mode="react"\} ([\d.]+)', output
    )
    assert sum_match is not None, "未找到 execution_duration_sum"
    assert abs(float(sum_match.group(1)) - 4.0) < 0.01


def test_topic_research_histogram(fresh_exporter: PrometheusExporter) -> None:
    """测试 6：ContentForge 选题调研 histogram 正常上报。"""
    fresh_exporter.record_topic_research_duration(
        duration_seconds=12.3, strategy="hot_trend", persona="life"
    )
    output = fresh_exporter.generate_latest().decode("utf-8")
    assert "contentforge_topic_research_duration_seconds_count" in output
    count_match = re.search(
        r'contentforge_topic_research_duration_seconds_count\{persona="life",strategy="hot_trend"\} (\d+)',
        output,
    )
    assert count_match is not None
    assert int(count_match.group(1)) == 1


# ── 4. Gauge 上报 ────────────────────────────────────────────────────────


def test_gauge_recording(fresh_exporter: PrometheusExporter) -> None:
    """测试 7：Gauge 上报后输出包含最新值。"""
    fresh_exporter.set_persona_running(persona="life", count=2)
    fresh_exporter.set_persona_running(persona="life", count=5)  # 覆盖

    output = fresh_exporter.generate_latest().decode("utf-8")
    match = re.search(
        r'flowforge_persona_running\{persona="life"\} (\d+)', output
    )
    assert match is not None, "未找到 persona_running gauge"
    assert int(match.group(1)) == 5


def test_article_quality_gauge(fresh_exporter: PrometheusExporter) -> None:
    """测试 8：ContentForge 文章质量分 gauge 正常上报。"""
    fresh_exporter.record_article_quality(
        score=0.92, persona="education", task_id="task-001"
    )
    output = fresh_exporter.generate_latest().decode("utf-8")
    match = re.search(
        r'contentforge_article_quality_score\{persona="education",task_id="task-001"\} ([\d.]+)',
        output,
    )
    assert match is not None
    assert abs(float(match.group(1)) - 0.92) < 0.001


# ── 5. /metrics endpoint 输出格式 ────────────────────────────────────────


def test_metrics_endpoint_content_type(app_with_metrics: FastAPI) -> None:
    """测试 9：/metrics 端点返回 Prometheus 标准的 Content-Type。

    不同 prometheus_client 版本返回的 version 字段不同（0.0.4 / 1.0.0 等），
    这里只校验 ``text/plain`` + ``version=`` + ``charset=utf-8`` 三要素。
    """
    client = TestClient(app_with_metrics)
    response = client.get("/metrics")
    assert response.status_code == 200
    content_type = response.headers.get("content-type", "")
    assert "text/plain" in content_type, f"Content-Type 缺少 text/plain: {content_type}"
    assert "version=" in content_type, f"Content-Type 缺少 version=: {content_type}"
    assert "charset=utf-8" in content_type, f"Content-Type 缺少 charset=utf-8: {content_type}"


def test_metrics_endpoint_output_format(app_with_metrics: FastAPI) -> None:
    """测试 10：/metrics 端点输出符合 Prometheus 文本格式（含 HELP/TYPE 行）。"""
    exporter = app_with_metrics.dependency_overrides.get(None, None)
    # 直接通过默认 exporter 注册时，需要重新获取 — 这里用注册时的 exporter
    # 我们改用直接调用记录方法（通过 fresh_exporter fixture）
    # 由于 app_with_metrics fixture 已创建 app，这里改用 TestClient 验证
    client = TestClient(app_with_metrics)
    # 触发一些指标（通过默认 exporter）
    default_exp = get_default_exporter()
    default_exp.record_task(mode="react", status="completed")

    response = client.get("/metrics")
    body = response.text
    # 必须包含 TYPE 声明
    assert "# TYPE flowforge_tasks_total counter" in body
    # 必须包含 HELP 声明
    assert "# HELP flowforge_tasks_total" in body
    # 必须包含实际指标行
    assert "flowforge_tasks_total" in body


def test_metrics_endpoint_includes_all_metric_types(app_with_metrics: FastAPI) -> None:
    """测试 11：/metrics 输出包含 counter/histogram/gauge 三种类型声明。"""
    # 通过默认 exporter 触发所有类型
    default_exp = get_default_exporter()
    default_exp.record_task(mode="react", status="created")           # counter
    default_exp.record_execution_duration(mode="react", duration_seconds=1.0)  # histogram
    default_exp.set_persona_running(persona="life", count=1)          # gauge

    client = TestClient(app_with_metrics)
    response = client.get("/metrics")
    body = response.text

    # 验证包含三种 TYPE 声明
    assert "# TYPE flowforge_tasks_total counter" in body
    assert "# TYPE flowforge_execution_duration_seconds histogram" in body
    assert "# TYPE flowforge_persona_running gauge" in body


# ── 6. 4 个新生产指标上报 ───────────────────────────────────────────────


def test_loop_duration_metric(fresh_exporter: PrometheusExporter) -> None:
    """测试 12：flowforge_loop_duration_seconds（新指标 1）正常上报。"""
    fresh_exporter.record_loop_duration(duration_seconds=45.0, mode="content")
    fresh_exporter.record_loop_duration(duration_seconds=150.0, mode="content")

    output = fresh_exporter.generate_latest().decode("utf-8")
    assert "flowforge_loop_duration_seconds" in output
    # 3 分钟 SLO 应有 le="180" 桶（不同版本可能输出 180 或 180.0）
    assert re.search(r'le="180(\.0)?"', output), "未找到 le=180 桶（3 分钟 SLO）"
    count_match = re.search(
        r'flowforge_loop_duration_seconds_count\{mode="content"\} (\d+)', output
    )
    assert count_match is not None
    assert int(count_match.group(1)) == 2


def test_llm_webchat_duration_metric(fresh_exporter: PrometheusExporter) -> None:
    """测试 13：flowforge_llm_webchat_duration_seconds（新指标 2）正常上报。"""
    fresh_exporter.record_llm_webchat_duration(duration_seconds=5.0, provider="openai")
    fresh_exporter.record_llm_webchat_duration(duration_seconds=28.0, provider="openai")
    fresh_exporter.record_llm_webchat_duration(duration_seconds=35.0, provider="doubao")

    output = fresh_exporter.generate_latest().decode("utf-8")
    assert "flowforge_llm_webchat_duration_seconds" in output
    # 30 秒 SLO 应有 le="30" 桶（不同版本可能输出 30 或 30.0）
    assert re.search(r'le="30(\.0)?"', output), "未找到 le=30 桶（30 秒 SLO）"
    # openai 应有 2 次观察
    openai_match = re.search(
        r'flowforge_llm_webchat_duration_seconds_count\{provider="openai"\} (\d+)', output
    )
    assert openai_match is not None
    assert int(openai_match.group(1)) == 2
    # doubao 应有 1 次观察
    doubao_match = re.search(
        r'flowforge_llm_webchat_duration_seconds_count\{provider="doubao"\} (\d+)', output
    )
    assert doubao_match is not None
    assert int(doubao_match.group(1)) == 1


def test_degradation_metric(fresh_exporter: PrometheusExporter) -> None:
    """测试 14：flowforge_degradation_total（新指标 3）正常上报。"""
    fresh_exporter.record_degradation(action_type="fallback")
    fresh_exporter.record_degradation(action_type="fallback")
    fresh_exporter.record_degradation(action_type="quota_exceeded")
    fresh_exporter.record_degradation(action_type="skip", count=3)

    output = fresh_exporter.generate_latest().decode("utf-8")
    assert "flowforge_degradation_total" in output
    fallback_match = re.search(
        r'flowforge_degradation_total\{action_type="fallback"\} (\d+)', output
    )
    assert fallback_match is not None
    assert int(fallback_match.group(1)) == 2
    skip_match = re.search(
        r'flowforge_degradation_total\{action_type="skip"\} (\d+)', output
    )
    assert skip_match is not None
    assert int(skip_match.group(1)) == 3


def test_provider_quota_metric(fresh_exporter: PrometheusExporter) -> None:
    """测试 15：flowforge_provider_quota_used_ratio（新指标 4）正常上报。"""
    fresh_exporter.set_provider_quota_used_ratio(provider="openai", ratio=0.35)
    fresh_exporter.set_provider_quota_used_ratio(provider="doubao", ratio=0.92)

    output = fresh_exporter.generate_latest().decode("utf-8")
    assert "flowforge_provider_quota_used_ratio" in output
    openai_match = re.search(
        r'flowforge_provider_quota_used_ratio\{provider="openai"\} ([\d.]+)', output
    )
    assert openai_match is not None
    assert abs(float(openai_match.group(1)) - 0.35) < 0.001
    doubao_match = re.search(
        r'flowforge_provider_quota_used_ratio\{provider="doubao"\} ([\d.]+)', output
    )
    assert doubao_match is not None
    assert abs(float(doubao_match.group(1)) - 0.92) < 0.001


# ── 7. sync_from_collector 兜底同步 ─────────────────────────────────────


def test_sync_from_collector_counters(fresh_exporter: PrometheusExporter) -> None:
    """测试 16：sync_from_collector 同步直接通过 collector 上报的 counter 增量。"""
    # 直接操作 collector（绕过 exporter 的便捷方法）
    fresh_exporter.collector.inc_counter(
        "flowforge_tasks_total", 5, {"mode": "react", "status": "completed"}
    )

    # 同步前，prometheus 输出应不含该数据
    output_before = fresh_exporter.generate_latest().decode("utf-8")
    match_before = re.search(
        r'flowforge_tasks_total\{mode="react",status="completed"\} (\d+)', output_before
    )
    assert match_before is None or int(match_before.group(1)) == 0

    # 同步后，应反映增量 5
    fresh_exporter.sync_from_collector()
    output_after = fresh_exporter.generate_latest().decode("utf-8")
    match_after = re.search(
        r'flowforge_tasks_total\{mode="react",status="completed"\} (\d+)', output_after
    )
    assert match_after is not None
    assert int(match_after.group(1)) == 5

    # 再次增量 3，同步后应为 8
    fresh_exporter.collector.inc_counter(
        "flowforge_tasks_total", 3, {"mode": "react", "status": "completed"}
    )
    fresh_exporter.sync_from_collector()
    output_final = fresh_exporter.generate_latest().decode("utf-8")
    match_final = re.search(
        r'flowforge_tasks_total\{mode="react",status="completed"\} (\d+)', output_final
    )
    assert match_final is not None
    assert int(match_final.group(1)) == 8


def test_sync_from_collector_gauges(fresh_exporter: PrometheusExporter) -> None:
    """测试 17：sync_from_collector 同步 gauge 的当前值。"""
    fresh_exporter.collector.set_gauge(
        "flowforge_persona_running", 4, {"persona": "life"}
    )
    fresh_exporter.sync_from_collector()
    output = fresh_exporter.generate_latest().decode("utf-8")
    match = re.search(
        r'flowforge_persona_running\{persona="life"\} (\d+)', output
    )
    assert match is not None
    assert int(match.group(1)) == 4


def test_sync_from_collector_histograms(fresh_exporter: PrometheusExporter) -> None:
    """测试 18：sync_from_collector 同步 histogram 新增观察值。"""
    # 直接通过 collector 观察 2 个值
    fresh_exporter.collector.observe_histogram(
        "flowforge_execution_duration_seconds", 1.0, {"mode": "react"}
    )
    fresh_exporter.collector.observe_histogram(
        "flowforge_execution_duration_seconds", 2.0, {"mode": "react"}
    )
    fresh_exporter.sync_from_collector()
    output = fresh_exporter.generate_latest().decode("utf-8")
    match = re.search(
        r'flowforge_execution_duration_seconds_count\{mode="react"\} (\d+)', output
    )
    assert match is not None
    assert int(match.group(1)) == 2

    # 再观察 1 个新值，同步后应为 3
    fresh_exporter.collector.observe_histogram(
        "flowforge_execution_duration_seconds", 3.0, {"mode": "react"}
    )
    fresh_exporter.sync_from_collector()
    output2 = fresh_exporter.generate_latest().decode("utf-8")
    match2 = re.search(
        r'flowforge_execution_duration_seconds_count\{mode="react"\} (\d+)', output2
    )
    assert match2 is not None
    assert int(match2.group(1)) == 3


# ── 8. ContentForge 业务指标 ────────────────────────────────────────────


def test_publish_result_metrics(fresh_exporter: PrometheusExporter) -> None:
    """测试 19：发布结果同时更新 success 与 failure 两个 counter。"""
    fresh_exporter.record_publish_result(success=True, platform="wechat", persona="life")
    fresh_exporter.record_publish_result(success=True, platform="wechat", persona="life")
    fresh_exporter.record_publish_result(success=False, platform="wechat", persona="life")

    output = fresh_exporter.generate_latest().decode("utf-8")
    success_match = re.search(
        r'contentforge_publish_success_total\{persona="life",platform="wechat"\} (\d+)', output
    )
    assert success_match is not None
    assert int(success_match.group(1)) == 2
    failure_match = re.search(
        r'contentforge_publish_failure_total\{persona="life",platform="wechat"\} (\d+)', output
    )
    assert failure_match is not None
    assert int(failure_match.group(1)) == 1


def test_persona_usage_metric(fresh_exporter: PrometheusExporter) -> None:
    """测试 20：ContentForge persona 使用计数器正常累计。"""
    fresh_exporter.record_persona_usage(persona="life")
    fresh_exporter.record_persona_usage(persona="life")
    fresh_exporter.record_persona_usage(persona="education")

    output = fresh_exporter.generate_latest().decode("utf-8")
    life_match = re.search(
        r'contentforge_persona_usage_total\{persona="life"\} (\d+)', output
    )
    assert life_match is not None
    assert int(life_match.group(1)) == 2


# ── 9. 默认 exporter 与注册 ─────────────────────────────────────────────


def test_default_exporter_singleton() -> None:
    """测试 21：get_default_exporter 返回单例。"""
    reset_default_exporter()
    exp1 = get_default_exporter()
    exp2 = get_default_exporter()
    assert exp1 is exp2


def test_register_metrics_endpoint_default_path() -> None:
    """测试 22：register_metrics_endpoint 在默认 /metrics 路径注册端点。"""
    reset_default_exporter()
    app = FastAPI()
    register_metrics_endpoint(app)
    client = TestClient(app)
    response = client.get("/metrics")
    assert response.status_code == 200
    body = response.text
    # 至少应包含指标名
    assert "flowforge_" in body or "contentforge_" in body


def test_register_metrics_endpoint_custom_path() -> None:
    """测试 23：register_metrics_endpoint 支持自定义路径。"""
    registry = CollectorRegistry()
    exporter = PrometheusExporter(registry=registry)
    app = FastAPI()
    register_metrics_endpoint(app, exporter=exporter, path="/custom-metrics")
    client = TestClient(app)
    response = client.get("/custom-metrics")
    assert response.status_code == 200


def test_content_type_property(fresh_exporter: PrometheusExporter) -> None:
    """测试 24：content_type 属性返回 Prometheus 标准 Content-Type。

    不同 prometheus_client 版本返回的 version 字段不同（0.0.4 / 1.0.0 等），
    这里只校验 ``text/plain`` + ``version=`` + ``charset=utf-8`` 三要素。
    """
    ct = fresh_exporter.content_type
    assert "text/plain" in ct, f"Content-Type 缺少 text/plain: {ct}"
    assert "version=" in ct, f"Content-Type 缺少 version=: {ct}"
    assert "charset=utf-8" in ct, f"Content-Type 缺少 charset=utf-8: {ct}"


# ── 10. 注册后通过 endpoint 触发 sync ────────────────────────────────────


def test_endpoint_triggers_sync_from_collector() -> None:
    """测试 25：访问 /metrics 端点会触发 sync_from_collector。"""
    reset_default_exporter()
    collector = MetricsCollector()
    registry = CollectorRegistry()
    exporter = PrometheusExporter(collector=collector, registry=registry)

    app = FastAPI()
    register_metrics_endpoint(app, exporter=exporter, path="/metrics")

    # 直接通过 collector 上报（绕过 exporter 便捷方法）
    collector.inc_counter(
        "flowforge_tasks_total", 7, {"mode": "react", "status": "completed"}
    )

    client = TestClient(app)
    response = client.get("/metrics")
    body = response.text
    match = re.search(
        r'flowforge_tasks_total\{mode="react",status="completed"\} (\d+)', body
    )
    assert match is not None
    assert int(match.group(1)) == 7


def test_grafana_dashboard_json_exists_and_valid() -> None:
    """测试 26：Grafana 仪表盘 JSON 文件存在且为合法 JSON。"""
    import json
    from pathlib import Path

    dashboard_path = (
        Path(__file__).parent.parent / "grafana" / "flowforge-dashboard.json"
    )
    assert dashboard_path.exists(), f"仪表盘文件不存在: {dashboard_path}"
    with open(dashboard_path, encoding="utf-8") as f:
        dashboard = json.load(f)
    # 验证关键字段
    assert dashboard["uid"] == "flowforge-main"
    assert dashboard["schemaVersion"] == 39
    assert dashboard["title"] == "FlowForge Main Dashboard"
    assert dashboard["refresh"] == "10s"
    panels = dashboard["panels"]
    assert len(panels) == 6, f"应有 6 个 panels，实际 {len(panels)}"
    panel_titles = [p["title"] for p in panels]
    # 验证 6 个 panel 均存在
    assert any("Task Throughput" in t for t in panel_titles)
    assert any("Execution Duration P95" in t for t in panel_titles)
    assert any("Token Usage" in t for t in panel_titles)
    assert any("Loop Duration P99" in t for t in panel_titles)
    assert any("LLM WebChat Duration P99" in t for t in panel_titles)
    assert any("Provider Quota" in t for t in panel_titles)


def test_prometheus_yml_example_exists() -> None:
    """测试 27：Prometheus 配置示例文件存在且包含必要字段。"""
    from pathlib import Path

    yml_path = (
        Path(__file__).parent.parent / "prometheus.yml.example"
    )
    assert yml_path.exists(), f"Prometheus 配置示例不存在: {yml_path}"
    content = yml_path.read_text(encoding="utf-8")
    assert "scrape_configs:" in content
    assert "job_name: \"flowforge\"" in content
    assert "scrape_interval: 15s" in content
    assert "targets:" in content
