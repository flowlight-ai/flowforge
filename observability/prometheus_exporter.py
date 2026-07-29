"""Prometheus Exporter — P3-001 Grafana 仪表盘配套指标导出。

本模块基于标准 ``prometheus_client`` 库，将 ``MetricsCollector`` 中的
in-memory 指标同步到 Prometheus 标准格式，并提供 FastAPI 路由注册函数。

覆盖指标（共 14 个）：

5 个核心指标：
1. ``flowforge_tasks_total`` (counter, labels: mode, status) — 任务总数
2. ``flowforge_execution_duration_seconds`` (histogram, labels: mode) — 执行时长
3. ``flowforge_token_usage_total`` (counter, labels: model, provider) — Token 用量
4. ``flowforge_tool_calls_total`` (counter, labels: tool_name, status) — 工具调用
5. ``flowforge_persona_running`` (gauge, labels: persona) — 运行中 persona 数量

5 个 ContentForge 业务指标：
6. ``contentforge_article_quality_score`` (gauge, labels: persona, task_id)
7. ``contentforge_publish_success_total`` (counter, labels: platform, persona)
8. ``contentforge_publish_failure_total`` (counter, labels: platform, persona)
9. ``contentforge_persona_usage_total`` (counter, labels: persona)
10. ``contentforge_topic_research_duration_seconds`` (histogram, labels: strategy, persona)

4 个生产指标（P3-001 新增）：
11. ``flowforge_loop_duration_seconds`` (histogram, labels: mode) — Loop 执行时长
12. ``flowforge_llm_webchat_duration_seconds`` (histogram, labels: provider) — LLM webchat 调用时长
13. ``flowforge_degradation_total`` (counter, labels: action_type) — 降级动作计数
14. ``flowforge_provider_quota_used_ratio`` (gauge, labels: provider) — Provider 配额使用率
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

from flowforge.core.tracing import get_logger
from flowforge.observability.metrics_collector import MetricsCollector

logger = get_logger("observability.prometheus_exporter")

# ── 指标默认配置 ─────────────────────────────────────────────────────────

# Histogram 桶配置：覆盖 Loop 3 分钟 SLO 与 LLM 30 秒 SLO
_LOOP_BUCKETS = (1.0, 5.0, 10.0, 30.0, 60.0, 120.0, 180.0, 300.0, 600.0)
_LLM_WEBCHAT_BUCKETS = (1.0, 5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 45.0, 60.0)
_EXECUTION_BUCKETS = (0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0)
_TOPIC_RESEARCH_BUCKETS = (1.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0, 600.0)

# 已通过便捷方法同步过的 ContentForge counter，sync 时跳过避免重复
_CONTENTFORGE_COUNTER_NAMES = frozenset({
    "contentforge_publish_success_total",
    "contentforge_publish_failure_total",
    "contentforge_persona_usage_total",
})


def _parse_metric_key(key: str) -> Tuple[str, Dict[str, str]]:
    """解析 MetricsCollector 中的复合键，返回 (metric_name, labels)。

    复合键格式: ``metric_name{k1=v1,k2=v2}`` 或纯 ``metric_name``。
    """
    if "{" not in key:
        return key, {}
    name, labels_part = key.split("{", 1)
    labels_part = labels_part.rstrip("}")
    labels: Dict[str, str] = {}
    if labels_part:
        for pair in labels_part.split(","):
            if "=" in pair:
                k, v = pair.split("=", 1)
                labels[k] = v
    return name, labels


class PrometheusExporter:
    """Prometheus 标准指标导出器。

    包装 :class:`MetricsCollector`，将 in-memory 数据桥接到
    ``prometheus_client`` 的 Counter/Histogram/Gauge，并提供：

    - 14 个 Prometheus 指标（5 核心 + 5 ContentForge + 4 生产）
    - 便捷上报方法（同时写入 collector 与 prometheus_client）
    - :meth:`sync_from_collector` 兜底同步（用于直接操作 collector 的场景）
    - :meth:`generate_latest` 输出 Prometheus 文本格式

    Args:
        collector: 被包装的 :class:`MetricsCollector`，为 None 则自动创建。
        registry: 自定义 :class:`CollectorRegistry`，为 None 则使用独立的
            registry，避免与 ``flowforge.core.metrics`` 的全局 registry 冲突。
    """

    def __init__(
        self,
        collector: Optional[MetricsCollector] = None,
        registry: Optional[CollectorRegistry] = None,
    ) -> None:
        self.collector: MetricsCollector = collector if collector is not None else MetricsCollector()
        self.registry: CollectorRegistry = registry if registry is not None else CollectorRegistry()
        # 已同步 counter 累计值，用于计算增量
        self._synced_counters: Dict[str, float] = {}
        # 已同步 histogram 观察次数，用于只同步新增观察
        self._synced_histogram_counts: Dict[str, int] = {}

        self._init_core_metrics()
        self._init_contentforge_metrics()
        self._init_production_metrics()
        logger.debug(
            f"PrometheusExporter initialized: registry={type(self.registry).__name__}, "
            f"collector_enabled={self.collector.enabled}"
        )

    # ── 指标初始化 ──────────────────────────────────────────────────────

    def _init_core_metrics(self) -> None:
        """初始化 5 个核心指标。"""
        self.tasks_total: Counter = Counter(
            "flowforge_tasks_total",
            "FlowForge 任务总数",
            ["mode", "status"],
            registry=self.registry,
        )
        self.execution_duration: Histogram = Histogram(
            "flowforge_execution_duration_seconds",
            "FlowForge 任务执行时长（秒）",
            ["mode"],
            buckets=_EXECUTION_BUCKETS,
            registry=self.registry,
        )
        self.token_usage: Counter = Counter(
            "flowforge_token_usage_total",
            "FlowForge Token 使用量",
            ["model", "provider"],
            registry=self.registry,
        )
        self.tool_calls: Counter = Counter(
            "flowforge_tool_calls_total",
            "FlowForge 工具调用计数",
            ["tool_name", "status"],
            registry=self.registry,
        )
        self.persona_running: Gauge = Gauge(
            "flowforge_persona_running",
            "FlowForge 当前运行中的 Persona 数量",
            ["persona"],
            registry=self.registry,
        )

    def _init_contentforge_metrics(self) -> None:
        """初始化 5 个 ContentForge 业务指标。"""
        self.article_quality: Gauge = Gauge(
            "contentforge_article_quality_score",
            "ContentForge 文章质量分（0.0-1.0）",
            ["persona", "task_id"],
            registry=self.registry,
        )
        self.publish_success: Counter = Counter(
            "contentforge_publish_success_total",
            "ContentForge 发布成功计数",
            ["platform", "persona"],
            registry=self.registry,
        )
        self.publish_failure: Counter = Counter(
            "contentforge_publish_failure_total",
            "ContentForge 发布失败计数",
            ["platform", "persona"],
            registry=self.registry,
        )
        self.persona_usage: Counter = Counter(
            "contentforge_persona_usage_total",
            "ContentForge Persona 使用计数",
            ["persona"],
            registry=self.registry,
        )
        self.topic_research_duration: Histogram = Histogram(
            "contentforge_topic_research_duration_seconds",
            "ContentForge 选题调研时长（秒）",
            ["strategy", "persona"],
            buckets=_TOPIC_RESEARCH_BUCKETS,
            registry=self.registry,
        )

    def _init_production_metrics(self) -> None:
        """初始化 4 个生产指标（P3-001 新增）。"""
        self.loop_duration: Histogram = Histogram(
            "flowforge_loop_duration_seconds",
            "FlowForge Loop 执行时长（秒），3 分钟 SLO",
            ["mode"],
            buckets=_LOOP_BUCKETS,
            registry=self.registry,
        )
        self.llm_webchat_duration: Histogram = Histogram(
            "flowforge_llm_webchat_duration_seconds",
            "FlowForge LLM WebChat 调用时长（秒），30 秒 SLO",
            ["provider"],
            buckets=_LLM_WEBCHAT_BUCKETS,
            registry=self.registry,
        )
        self.degradation_total: Counter = Counter(
            "flowforge_degradation_total",
            "FlowForge 降级动作总数",
            ["action_type"],
            registry=self.registry,
        )
        self.provider_quota_used: Gauge = Gauge(
            "flowforge_provider_quota_used_ratio",
            "FlowForge Provider 配额使用率（0.0-1.0）",
            ["provider"],
            registry=self.registry,
        )

    # ── 核心指标便捷上报 ───────────────────────────────────────────────

    def record_task(self, mode: str, status: str, count: float = 1.0) -> None:
        """记录任务事件（同时写入 collector 与 prometheus_client）。

        Args:
            mode: 执行模式（react/plan_execute/reflexion 等）。
            status: 任务状态（created/completed/failed）。
            count: 增量值，默认 1。
        """
        labels = {"mode": mode, "status": status}
        self.collector.inc_counter("flowforge_tasks_total", count, labels)
        self.tasks_total.labels(mode=mode, status=status).inc(count)

    def record_execution_duration(self, mode: str, duration_seconds: float) -> None:
        """记录任务执行时长。"""
        self.collector.observe_histogram(
            "flowforge_execution_duration_seconds", duration_seconds, {"mode": mode}
        )
        self.execution_duration.labels(mode=mode).observe(duration_seconds)

    def record_token_usage(self, provider: str, model: str, tokens: float) -> None:
        """记录 Token 用量。"""
        labels = {"model": model, "provider": provider}
        self.collector.inc_counter("flowforge_token_usage_total", tokens, labels)
        self.token_usage.labels(model=model, provider=provider).inc(tokens)

    def record_tool_call(self, tool_name: str, status: str = "success", count: float = 1.0) -> None:
        """记录工具调用。"""
        labels = {"tool_name": tool_name, "status": status}
        self.collector.inc_counter("flowforge_tool_calls_total", count, labels)
        self.tool_calls.labels(tool_name=tool_name, status=status).inc(count)

    def set_persona_running(self, persona: str, count: int) -> None:
        """设置当前运行中的 persona 数量。"""
        self.collector.set_gauge("flowforge_persona_running", float(count), {"persona": persona})
        self.persona_running.labels(persona=persona).set(count)

    # ── ContentForge 业务指标便捷上报 ───────────────────────────────────

    def record_article_quality(self, score: float, persona: str = "", task_id: str = "") -> None:
        """记录文章质量分。

        Args:
            score: 质量分（0.0-1.0）。
            persona: 产出该文章的 persona。
            task_id: 关联任务 ID。
        """
        self.collector.record_article_quality(score, persona, task_id)
        self.article_quality.labels(persona=persona, task_id=task_id).set(score)

    def record_publish_result(self, success: bool, platform: str = "", persona: str = "") -> None:
        """记录发布结果。

        Args:
            success: 是否发布成功。
            platform: 目标平台（wechat/toutiao 等）。
            persona: 作者 persona。
        """
        self.collector.record_publish_result(success, platform, persona)
        labels = {"platform": platform, "persona": persona}
        if success:
            self.publish_success.labels(**labels).inc()
        else:
            self.publish_failure.labels(**labels).inc()

    def record_persona_usage(self, persona: str) -> None:
        """记录 persona 使用事件。"""
        self.collector.record_persona_usage(persona)
        self.persona_usage.labels(persona=persona).inc()

    def record_topic_research_duration(
        self, duration_seconds: float, strategy: str = "", persona: str = ""
    ) -> None:
        """记录选题调研时长。"""
        self.collector.record_topic_research_duration(duration_seconds, strategy, persona)
        self.topic_research_duration.labels(strategy=strategy, persona=persona).observe(
            duration_seconds
        )

    # ── 4 个生产指标便捷上报 ───────────────────────────────────────────

    def record_loop_duration(self, duration_seconds: float, mode: str = "default") -> None:
        """记录 Loop 执行时长。

        Args:
            duration_seconds: Loop 执行时长（秒）。SLO 阈值 180 秒（3 分钟）。
            mode: Loop 模式标识。
        """
        self.loop_duration.labels(mode=mode).observe(duration_seconds)
        logger.debug(f"Loop duration recorded: {duration_seconds:.3f}s mode={mode}")

    def record_llm_webchat_duration(self, duration_seconds: float, provider: str = "default") -> None:
        """记录 LLM WebChat 调用时长。

        Args:
            duration_seconds: 调用时长（秒）。SLO 阈值 30 秒。
            provider: LLM 提供方标识。
        """
        self.llm_webchat_duration.labels(provider=provider).observe(duration_seconds)
        logger.debug(f"LLM webchat duration recorded: {duration_seconds:.3f}s provider={provider}")

    def record_degradation(self, action_type: str, count: float = 1.0) -> None:
        """记录降级动作。

        Args:
            action_type: 降级动作类型（fallback/skip/retry/quota_exceeded 等）。
            count: 增量值，默认 1。
        """
        self.degradation_total.labels(action_type=action_type).inc(count)
        logger.debug(f"Degradation recorded: action_type={action_type} count={count}")

    def set_provider_quota_used_ratio(self, provider: str, ratio: float) -> None:
        """设置 Provider 配额使用率。

        Args:
            provider: LLM 提供方标识。
            ratio: 配额使用率（0.0-1.0）。
        """
        self.provider_quota_used.labels(provider=provider).set(ratio)
        logger.debug(f"Provider quota used ratio set: provider={provider} ratio={ratio:.3f}")

    # ── 从 MetricsCollector 同步（兜底机制）────────────────────────────

    def sync_from_collector(self) -> None:
        """从 :class:`MetricsCollector` 同步未通过便捷方法上报的数据。

        用于直接操作 ``collector.inc_counter`` / ``observe_histogram`` /
        ``set_gauge`` 的场景。基于增量同步：

        - Counter: 计算自上次同步以来的累计增量，仅推送差值。
        - Gauge: 直接覆盖当前值。
        - Histogram: 仅同步新增的观察值（按 index 跟踪）。
        """
        if not self.collector.enabled:
            return

        # Counter 增量同步
        for key, value in self.collector._counters.items():
            prev = self._synced_counters.get(key, 0.0)
            delta = value - prev
            if delta <= 0:
                continue
            name, labels = _parse_metric_key(key)
            # ContentForge counter 已通过便捷方法同步，跳过避免重复
            if name in _CONTENTFORGE_COUNTER_NAMES:
                self._synced_counters[key] = value
                continue
            metric = self._find_counter(name)
            if metric is None:
                self._synced_counters[key] = value
                continue
            try:
                metric.labels(**labels).inc(delta)
            except Exception as exc:
                logger.warning(f"Counter sync skipped for {key}: {exc}")
            finally:
                self._synced_counters[key] = value

        # Gauge 覆盖同步
        for key, value in self.collector._gauges.items():
            name, labels = _parse_metric_key(key)
            metric = self._find_gauge(name)
            if metric is None:
                continue
            try:
                metric.labels(**labels).set(value)
            except Exception as exc:
                logger.warning(f"Gauge sync skipped for {key}: {exc}")

        # Histogram 增量同步：仅推送新增观察值
        for key, observations in self.collector._histograms.items():
            prev_count = self._synced_histogram_counts.get(key, 0)
            new_count = len(observations)
            if new_count <= prev_count:
                continue
            new_observations = observations[prev_count:]
            name, labels = _parse_metric_key(key)
            metric = self._find_histogram(name)
            if metric is None:
                self._synced_histogram_counts[key] = new_count
                continue
            try:
                for value in new_observations:
                    metric.labels(**labels).observe(value)
            except Exception as exc:
                logger.warning(f"Histogram sync skipped for {key}: {exc}")
            finally:
                self._synced_histogram_counts[key] = new_count

    def _find_counter(self, name: str) -> Optional[Counter]:
        """根据指标名查找已注册的 Counter。"""
        mapping = {
            "flowforge_tasks_total": self.tasks_total,
            "flowforge_token_usage_total": self.token_usage,
            "flowforge_tool_calls_total": self.tool_calls,
            "contentforge_publish_success_total": self.publish_success,
            "contentforge_publish_failure_total": self.publish_failure,
            "contentforge_persona_usage_total": self.persona_usage,
            "flowforge_degradation_total": self.degradation_total,
        }
        return mapping.get(name)

    def _find_gauge(self, name: str) -> Optional[Gauge]:
        """根据指标名查找已注册的 Gauge。"""
        mapping = {
            "flowforge_persona_running": self.persona_running,
            "contentforge_article_quality_score": self.article_quality,
            "flowforge_provider_quota_used_ratio": self.provider_quota_used,
        }
        return mapping.get(name)

    def _find_histogram(self, name: str) -> Optional[Histogram]:
        """根据指标名查找已注册的 Histogram。"""
        mapping = {
            "flowforge_execution_duration_seconds": self.execution_duration,
            "contentforge_topic_research_duration_seconds": self.topic_research_duration,
            "flowforge_loop_duration_seconds": self.loop_duration,
            "flowforge_llm_webchat_duration_seconds": self.llm_webchat_duration,
        }
        return mapping.get(name)

    # ── 导出 ──────────────────────────────────────────────────────────

    def generate_latest(self) -> bytes:
        """生成 Prometheus 文本格式的最新指标数据。"""
        return generate_latest(self.registry)

    @property
    def content_type(self) -> str:
        """返回 Prometheus 标准的 Content-Type。"""
        return CONTENT_TYPE_LATEST

    def list_registered_metrics(self) -> List[str]:
        """列出所有已注册的指标名。"""
        return [
            "flowforge_tasks_total",
            "flowforge_execution_duration_seconds",
            "flowforge_token_usage_total",
            "flowforge_tool_calls_total",
            "flowforge_persona_running",
            "contentforge_article_quality_score",
            "contentforge_publish_success_total",
            "contentforge_publish_failure_total",
            "contentforge_persona_usage_total",
            "contentforge_topic_research_duration_seconds",
            "flowforge_loop_duration_seconds",
            "flowforge_llm_webchat_duration_seconds",
            "flowforge_degradation_total",
            "flowforge_provider_quota_used_ratio",
        ]


# ── 模块级默认实例 ──────────────────────────────────────────────────────

_default_exporter: Optional[PrometheusExporter] = None


def get_default_exporter() -> PrometheusExporter:
    """获取模块级默认 :class:`PrometheusExporter` 单例。"""
    global _default_exporter
    if _default_exporter is None:
        _default_exporter = PrometheusExporter()
    return _default_exporter


def reset_default_exporter() -> None:
    """重置默认 exporter（主要用于测试隔离）。"""
    global _default_exporter
    _default_exporter = None


def register_metrics_endpoint(
    app: FastAPI,
    exporter: Optional[PrometheusExporter] = None,
    path: str = "/metrics",
) -> PrometheusExporter:
    """在 FastAPI 应用上注册 Prometheus ``/metrics`` 端点。

    Args:
        app: FastAPI 应用实例。
        exporter: 自定义 :class:`PrometheusExporter`，为 None 则使用默认实例。
        path: 端点路径，默认 ``/metrics``。

    Returns:
        实际使用的 :class:`PrometheusExporter` 实例。
    """
    exp = exporter if exporter is not None else get_default_exporter()

    @app.get(path)
    async def _metrics_endpoint() -> Any:  # noqa: ANN401
        # 每次抓取前同步 collector 中的数据，确保数据最新
        exp.sync_from_collector()
        from starlette.responses import Response

        return Response(content=exp.generate_latest(), media_type=exp.content_type)

    logger.info(f"Prometheus /metrics endpoint registered at path={path}")
    return exp
