"""Metrics Collector - Prometheus integration.

Implements FR-OBS-02: 5 core Prometheus metrics:
1. flowforge_tasks_total - Total tasks counter
2. flowforge_execution_duration_seconds - Execution duration histogram
3. flowforge_token_usage_total - Token usage counter
4. flowforge_tool_calls_total - Tool call counter
5. flowforge_persona_running - Currently running persona gauge

ContentForge-specific business metrics:
6. contentforge_article_quality_score - Article quality score gauge
7. contentforge_publish_success_total - Publish success counter
8. contentforge_publish_failure_total - Publish failure counter
9. contentforge_persona_usage_total - Persona usage counter
10. contentforge_topic_research_duration_seconds - Topic research duration histogram

FlowForge production metrics (P3-003 - T6 测试铁律：E2E 必采完整指标):
11. flowforge_loop_total{loop_name, success} - Loop 执行计数器
12. flowforge_loop_duration_seconds{loop_name} - Loop 时长直方图（3min SLO）
13. flowforge_loop_iterations_total{loop_name} - Loop 迭代次数计数器
14. flowforge_loop_quality_score{loop_name} - Loop 质量分 gauge
15. flowforge_loop_step_duration_seconds{loop_name, step_name} - Loop 单步时长直方图
16. flowforge_loop_step_total{loop_name, step_name, success} - Loop 单步计数器
17. flowforge_llm_calls_total{model, provider, success, call_type} - LLM 调用计数器
18. flowforge_llm_duration_seconds{model, call_type} - LLM 调用时长直方图
19. flowforge_llm_tokens_total{model, call_type} - LLM token 计数器
20. flowforge_llm_webchat_duration_seconds{model} - WebChat LLM 调用时长直方图（30s SLO）
21. flowforge_degradation_total{component, action_type} - 降级动作计数器
22. flowforge_recovery_total{component, success} - 恢复动作计数器
23. flowforge_recovery_duration_seconds{component} - 恢复时长直方图
24. flowforge_provider_quota_used_ratio{provider} - Provider 配额使用率 gauge
25. flowforge_provider_quota_remaining{provider} - Provider 配额剩余 gauge
"""

import time
from typing import Optional, Dict, Any, List, Tuple
from flowforge.core.tracing import get_logger

logger = get_logger("observability.metrics_collector")


class MetricsCollector:
    """Prometheus-compatible metrics collector.

    Collects and exposes 5 core metrics for FlowForge observability,
    plus ContentForge-specific business metrics, and FlowForge production
    metrics (Loop/LLM/degradation/recovery/provider).
    Phase 1 uses in-memory collection; Phase 2 adds Prometheus export.
    """

    # 关键指标的默认 bucket 配置（按基础指标名索引）
    DEFAULT_BUCKETS: Dict[str, List[float]] = {
        "flowforge_loop_duration_seconds": [10, 30, 60, 90, 120, 180, 300, 600],
        "flowforge_loop_step_duration_seconds": [1, 5, 10, 30, 60, 120, 300],
        "flowforge_llm_duration_seconds": [0.5, 1, 2, 5, 10, 30, 60, 120],
        "flowforge_llm_webchat_duration_seconds": [5, 10, 20, 30, 60, 120, 300],
        "flowforge_recovery_duration_seconds": [1, 5, 10, 30, 60, 120, 300],
        "flowforge_execution_duration_seconds": [0.1, 0.5, 1, 5, 10, 30, 60, 120],
        "contentforge_topic_research_duration_seconds": [1, 5, 10, 30, 60, 120, 300],
    }

    # SLO 阈值常量
    LOOP_SLO_SECONDS: float = 180.0
    WEBCHAT_SLO_SECONDS: float = 30.0
    SLO_WINDOW_SECONDS: float = 300.0  # 最近 5 分钟
    DEGRADATION_RATE_THRESHOLD: float = 0.05

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.enabled = self.config.get("enabled", True)

        # In-memory metric storage
        self._counters: Dict[str, float] = {}
        self._histograms: Dict[str, list] = {}
        self._gauges: Dict[str, float] = {}

        # 与 _histograms 并行的时间戳记录，用于时间窗口聚合（SLO 计算）
        self._histogram_timestamps: Dict[str, List[float]] = {}

        # 每个基础指标名的 bucket 配置（按基础指标名索引）
        self._histogram_buckets: Dict[str, List[float]] = dict(self.DEFAULT_BUCKETS)

    # ── Core metric operations ──────────────────────────────────────

    def inc_counter(self, name: str, value: float = 1.0, labels: Optional[Dict[str, str]] = None):
        """Increment a counter metric."""
        if not self.enabled:
            return
        key = self._make_key(name, labels)
        self._counters[key] = self._counters.get(key, 0) + value

    def observe_histogram(
        self,
        name: str,
        value: float,
        labels: Optional[Dict[str, str]] = None,
        buckets: Optional[List[float]] = None,
    ):
        """Record a histogram observation.

        Args:
            name: 指标名。
            value: 观测值。
            labels: 可选标签字典。
            buckets: 可选 bucket 列表。若提供，会注册到该指标名上
                （已存在的同名 bucket 配置会被覆盖）。默认 None 表示
                不修改该指标名的 bucket 配置。
        """
        if not self.enabled:
            return
        key = self._make_key(name, labels)
        if key not in self._histograms:
            self._histograms[key] = []
            self._histogram_timestamps[key] = []
        self._histograms[key].append(value)
        self._histogram_timestamps[key].append(time.time())
        if buckets is not None:
            self._histogram_buckets[name] = list(buckets)

    def set_gauge(self, name: str, value: float, labels: Optional[Dict[str, str]] = None):
        """Set a gauge metric value."""
        if not self.enabled:
            return
        key = self._make_key(name, labels)
        self._gauges[key] = value

    def _make_key(self, name: str, labels: Optional[Dict[str, str]] = None) -> str:
        """Create a metric key with optional labels."""
        if not labels:
            return name
        label_str = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        return f"{name}{{{label_str}}}"

    def _parse_key(self, key: str) -> Tuple[str, Dict[str, str]]:
        """将指标 key 解析为 (基础名, 标签字典)。"""
        if '{' not in key:
            return key, {}
        base_name = key.split('{', 1)[0]
        labels_str = key.split('{', 1)[1].rstrip('}')
        labels: Dict[str, str] = {}
        for pair in labels_str.split(','):
            if '=' in pair:
                k, v = pair.split('=', 1)
                labels[k] = v
        return base_name, labels

    def _format_prometheus_labels(self, labels: Dict[str, str]) -> str:
        """按 Prometheus 文本格式（带引号）输出标签。"""
        if not labels:
            return ''
        return '{' + ','.join(f'{k}="{v}"' for k, v in sorted(labels.items())) + '}'

    def _get_buckets(self, metric_name: str) -> List[float]:
        """获取指定指标的 bucket 配置。"""
        return self._histogram_buckets.get(metric_name, [])

    @staticmethod
    def _percentile(values: List[float], p: float) -> float:
        """计算分位数（线性插值法）。

        Args:
            values: 观测值列表。
            p: 分位数（0-100）。
        """
        if not values:
            return 0.0
        sorted_vals = sorted(values)
        if len(sorted_vals) == 1:
            return sorted_vals[0]
        k = (len(sorted_vals) - 1) * p / 100.0
        f = int(k)
        c = min(f + 1, len(sorted_vals) - 1)
        if f == c:
            return sorted_vals[f]
        return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)

    def _recent_histogram_values(self, base_name: str, window_seconds: float) -> List[float]:
        """获取最近 window_seconds 秒内指定基础指标名的所有观测值。"""
        now = time.time()
        cutoff = now - window_seconds
        result: List[float] = []
        for key, values in self._histograms.items():
            parsed_name, _ = self._parse_key(key)
            if parsed_name != base_name:
                continue
            timestamps = self._histogram_timestamps.get(key, [])
            for ts, val in zip(timestamps, values):
                if ts >= cutoff:
                    result.append(val)
        return result

    # ── ContentForge business metrics ───────────────────────────────

    def record_article_quality(self, score: float, persona: str = "", task_id: str = ""):
        """Record article quality score.

        Args:
            score: Quality score (0.0 - 1.0).
            persona: The persona that produced the article.
            task_id: Associated task ID.
        """
        labels = {}
        if persona:
            labels["persona"] = persona
        if task_id:
            labels["task_id"] = task_id
        self.set_gauge("contentforge_article_quality_score", score, labels or None)
        logger.debug(f"Article quality recorded: score={score}, persona={persona}")

    def record_publish_result(self, success: bool, platform: str = "", persona: str = ""):
        """Record a publish attempt result.

        Args:
            success: Whether the publish succeeded.
            platform: Target platform (wechat, toutiao, etc.).
            persona: The persona that authored the content.
        """
        labels = {}
        if platform:
            labels["platform"] = platform
        if persona:
            labels["persona"] = persona
        metric_name = "contentforge_publish_success_total" if success else "contentforge_publish_failure_total"
        self.inc_counter(metric_name, labels=labels or None)
        logger.debug(f"Publish result recorded: success={success}, platform={platform}")

    def get_publish_success_rate(self, platform: str = "", persona: str = "") -> float:
        """Calculate publish success rate for given filters."""
        success_key = self._make_key("contentforge_publish_success_total",
                                     {"platform": platform, "persona": persona} if platform or persona else None)
        failure_key = self._make_key("contentforge_publish_failure_total",
                                     {"platform": platform, "persona": persona} if platform or persona else None)
        success_count = self._counters.get(success_key, 0)
        failure_count = self._counters.get(failure_key, 0)
        total = success_count + failure_count
        return success_count / total if total > 0 else 0.0

    def record_persona_usage(self, persona: str):
        """Record a persona usage event."""
        self.inc_counter("contentforge_persona_usage_total", labels={"persona": persona})
        logger.debug(f"Persona usage recorded: persona={persona}")

    def record_topic_research_duration(self, duration_seconds: float, strategy: str = "", persona: str = ""):
        """Record topic research duration.

        Args:
            duration_seconds: Time spent on topic research.
            strategy: The topic strategy used (hot_trend, vertical_deep_dive, etc.).
            persona: The persona context.
        """
        labels = {}
        if strategy:
            labels["strategy"] = strategy
        if persona:
            labels["persona"] = persona
        self.observe_histogram("contentforge_topic_research_duration_seconds", duration_seconds,
                               labels=labels or None)
        logger.debug(f"Topic research duration recorded: {duration_seconds:.2f}s, strategy={strategy}")

    # ── FlowForge Loop 执行指标 ─────────────────────────────────────

    def record_loop_execution(
        self,
        loop_name: str,
        duration_seconds: float,
        success: bool,
        iteration_count: int,
        quality_score: float = 0.0,
    ) -> None:
        """记录一次 Loop 执行。

        覆盖 4 个指标：
        - ``flowforge_loop_total{loop_name, success}`` (counter)
        - ``flowforge_loop_duration_seconds{loop_name}`` (histogram)
        - ``flowforge_loop_iterations_total{loop_name}`` (counter)
        - ``flowforge_loop_quality_score{loop_name}`` (gauge)

        Args:
            loop_name: Loop 名称（如 creation、polish）。
            duration_seconds: 整体执行时长（秒）。
            success: 是否成功完成。
            iteration_count: 迭代次数。
            quality_score: 最终质量分（0.0-1.0），未评估时为 0.0。
        """
        success_label = "true" if success else "false"
        self.inc_counter(
            "flowforge_loop_total",
            labels={"loop_name": loop_name, "success": success_label},
        )
        self.observe_histogram(
            "flowforge_loop_duration_seconds",
            duration_seconds,
            labels={"loop_name": loop_name},
        )
        self.inc_counter(
            "flowforge_loop_iterations_total",
            value=float(iteration_count),
            labels={"loop_name": loop_name},
        )
        self.set_gauge(
            "flowforge_loop_quality_score",
            quality_score,
            labels={"loop_name": loop_name},
        )
        logger.debug(
            f"Loop execution recorded: loop_name={loop_name}, duration={duration_seconds:.2f}s, "
            f"success={success}, iterations={iteration_count}, quality={quality_score:.3f}"
        )

    def record_loop_step(
        self,
        loop_name: str,
        step_name: str,
        duration_seconds: float,
        success: bool,
    ) -> None:
        """记录 Loop 内单步执行。

        覆盖 2 个指标：
        - ``flowforge_loop_step_duration_seconds{loop_name, step_name}`` (histogram)
        - ``flowforge_loop_step_total{loop_name, step_name, success}`` (counter)

        Args:
            loop_name: 所属 Loop 名称。
            step_name: 步骤名称（如 discover、assign、act、verify、persist）。
            duration_seconds: 该步骤耗时（秒）。
            success: 是否成功。
        """
        success_label = "true" if success else "false"
        self.observe_histogram(
            "flowforge_loop_step_duration_seconds",
            duration_seconds,
            labels={"loop_name": loop_name, "step_name": step_name},
        )
        self.inc_counter(
            "flowforge_loop_step_total",
            labels={
                "loop_name": loop_name,
                "step_name": step_name,
                "success": success_label,
            },
        )
        logger.debug(
            f"Loop step recorded: loop_name={loop_name}, step={step_name}, "
            f"duration={duration_seconds:.2f}s, success={success}"
        )

    # ── LLM 调用指标 ────────────────────────────────────────────────

    def record_llm_call(
        self,
        model: str,
        provider: str,
        duration_seconds: float,
        success: bool,
        token_usage: int = 0,
        call_type: str = "chat",
    ) -> None:
        """记录一次 LLM 调用。

        覆盖 3 个指标：
        - ``flowforge_llm_calls_total{model, provider, success, call_type}`` (counter)
        - ``flowforge_llm_duration_seconds{model, call_type}`` (histogram)
        - ``flowforge_llm_tokens_total{model, call_type}`` (counter，仅当 token_usage > 0)

        Args:
            model: 模型名（如 claude-3-5-sonnet、gpt-4o）。
            provider: 提供方（如 openrouter、doubao、openai）。
            duration_seconds: 调用耗时（秒）。
            success: 是否成功。
            token_usage: 本次调用消耗 token 数。
            call_type: 调用类型（chat/embedding/review/judge 等）。
        """
        success_label = "true" if success else "false"
        self.inc_counter(
            "flowforge_llm_calls_total",
            labels={
                "model": model,
                "provider": provider,
                "success": success_label,
                "call_type": call_type,
            },
        )
        self.observe_histogram(
            "flowforge_llm_duration_seconds",
            duration_seconds,
            labels={"model": model, "call_type": call_type},
        )
        if token_usage > 0:
            self.inc_counter(
                "flowforge_llm_tokens_total",
                value=float(token_usage),
                labels={"model": model, "call_type": call_type},
            )
        logger.debug(
            f"LLM call recorded: model={model}, provider={provider}, "
            f"duration={duration_seconds:.2f}s, success={success}, tokens={token_usage}"
        )

    def record_llm_webchat_call(
        self,
        model: str,
        duration_seconds: float,
        success: bool,
    ) -> None:
        """记录 WebChat LLM 调用（30s SLO 专用）。

        同时计入 ``flowforge_llm_calls_total``（call_type=webchat）与
        ``flowforge_llm_webchat_duration_seconds``（独立直方图，
        bucket: 5/10/20/30/60/120/300）。

        Args:
            model: 模型名。
            duration_seconds: 调用耗时（秒）。
            success: 是否成功。
        """
        success_label = "true" if success else "false"
        self.inc_counter(
            "flowforge_llm_calls_total",
            labels={
                "model": model,
                "provider": "webchat",
                "success": success_label,
                "call_type": "webchat",
            },
        )
        self.observe_histogram(
            "flowforge_llm_webchat_duration_seconds",
            duration_seconds,
            labels={"model": model},
        )
        logger.debug(
            f"Webchat LLM call recorded: model={model}, "
            f"duration={duration_seconds:.2f}s, success={success}"
        )

    # ── 降级与恢复指标 ──────────────────────────────────────────────

    def record_degradation(
        self,
        component: str,
        action_type: str,
        reason: str = "",
    ) -> None:
        """记录一次降级动作。

        覆盖 1 个指标：
        - ``flowforge_degradation_total{component, action_type}`` (counter)

        Args:
            component: 降级组件（如 llm_provider、openroute、loop_executor）。
            action_type: 降级类型（如 fallback、skip、cache_only、disable）。
            reason: 降级原因（用于日志排查，不作为 label 以避免基数爆炸）。
        """
        self.inc_counter(
            "flowforge_degradation_total",
            labels={"component": component, "action_type": action_type},
        )
        logger.warning(
            f"Degradation recorded: component={component}, action={action_type}, reason={reason}"
        )

    def record_recovery(
        self,
        component: str,
        duration_seconds: float,
        success: bool,
    ) -> None:
        """记录一次恢复动作。

        覆盖 2 个指标：
        - ``flowforge_recovery_total{component, success}`` (counter)
        - ``flowforge_recovery_duration_seconds{component}`` (histogram)

        Args:
            component: 恢复组件。
            duration_seconds: 恢复耗时（秒）。
            success: 是否恢复成功。
        """
        success_label = "true" if success else "false"
        self.inc_counter(
            "flowforge_recovery_total",
            labels={"component": component, "success": success_label},
        )
        self.observe_histogram(
            "flowforge_recovery_duration_seconds",
            duration_seconds,
            labels={"component": component},
        )
        logger.info(
            f"Recovery recorded: component={component}, "
            f"duration={duration_seconds:.2f}s, success={success}"
        )

    # ── Provider 配额指标 ──────────────────────────────────────────

    def record_provider_quota(
        self,
        provider: str,
        used: float,
        limit: float,
    ) -> None:
        """记录 Provider 配额使用情况。

        覆盖 2 个指标：
        - ``flowforge_provider_quota_used_ratio{provider}`` (gauge, used/limit)
        - ``flowforge_provider_quota_remaining{provider}`` (gauge, max(limit-used, 0))

        Args:
            provider: 提供方名（如 openroute、doubao）。
            used: 已用配额。
            limit: 总配额上限。
        """
        ratio = (used / limit) if limit > 0 else 1.0
        remaining = max(limit - used, 0.0)
        self.set_gauge(
            "flowforge_provider_quota_used_ratio",
            ratio,
            labels={"provider": provider},
        )
        self.set_gauge(
            "flowforge_provider_quota_remaining",
            remaining,
            labels={"provider": provider},
        )
        logger.debug(
            f"Provider quota recorded: provider={provider}, used={used}, "
            f"limit={limit}, ratio={ratio:.3f}"
        )

    # ── Export methods ───────────────────────────────────────────────

    def get_all_metrics(self) -> dict:
        """Get all collected metrics."""
        return {
            "counters": dict(self._counters),
            "gauges": dict(self._gauges),
            "histograms": {
                k: {"count": len(v), "sum": sum(v), "avg": sum(v)/len(v) if v else 0}
                for k, v in self._histograms.items()
            },
        }

    def get_contentforge_metrics(self) -> dict:
        """Get ContentForge-specific business metrics summary."""
        quality_scores = {k: v for k, v in self._gauges.items()
                         if k.startswith("contentforge_article_quality_score")}
        publish_success = {k: v for k, v in self._counters.items()
                          if k.startswith("contentforge_publish_success_total")}
        publish_failure = {k: v for k, v in self._counters.items()
                          if k.startswith("contentforge_publish_failure_total")}
        persona_usage = {k: v for k, v in self._counters.items()
                        if k.startswith("contentforge_persona_usage_total")}
        topic_durations = {k: v for k, v in self._histograms.items()
                          if k.startswith("contentforge_topic_research_duration_seconds")}

        return {
            "article_quality_scores": quality_scores,
            "publish_success": publish_success,
            "publish_failure": publish_failure,
            "publish_success_rate": self._compute_publish_rates(),
            "persona_usage_counts": persona_usage,
            "topic_research_durations": {
                k: {"count": len(v), "sum": sum(v), "avg": sum(v)/len(v) if v else 0}
                for k, v in topic_durations.items()
            },
        }

    def _compute_publish_rates(self) -> dict:
        """Compute publish success rates per platform/persona combination."""
        rates = {}
        all_keys = set()
        for k in self._counters:
            if k.startswith("contentforge_publish_success_total") or \
               k.startswith("contentforge_publish_failure_total"):
                base = k.split("{")[0]
                labels_part = k.split("{")[1].rstrip("}") if "{" in k else ""
                all_keys.add(labels_part)

        for label_str in all_keys:
            s_key = f"contentforge_publish_success_total{{{label_str}}}" if label_str else "contentforge_publish_success_total"
            f_key = f"contentforge_publish_failure_total{{{label_str}}}" if label_str else "contentforge_publish_failure_total"
            s = self._counters.get(s_key, 0)
            f = self._counters.get(f_key, 0)
            total = s + f
            rates[label_str or "overall"] = s / total if total > 0 else 0.0
        return rates

    def get_flowforge_metrics(self) -> dict:
        """返回 FlowForge 核心指标摘要（loop/llm/degradation/recovery/provider）。

        Returns:
            包含 5 个顶层键的字典：``loop``、``llm``、``degradation``、
            ``recovery``、``provider``，每个键对应一个子字典。
        """
        loop_total = {k: v for k, v in self._counters.items()
                     if k.startswith("flowforge_loop_total{")}
        loop_iterations = {k: v for k, v in self._counters.items()
                          if k.startswith("flowforge_loop_iterations_total{")}
        loop_step_total = {k: v for k, v in self._counters.items()
                          if k.startswith("flowforge_loop_step_total{")}
        loop_quality = {k: v for k, v in self._gauges.items()
                       if k.startswith("flowforge_loop_quality_score{")}
        loop_durations = {
            k: {"count": len(v), "sum": sum(v), "avg": sum(v)/len(v) if v else 0}
            for k, v in self._histograms.items()
            if k.startswith("flowforge_loop_duration_seconds{")
        }
        loop_step_durations = {
            k: {"count": len(v), "sum": sum(v), "avg": sum(v)/len(v) if v else 0}
            for k, v in self._histograms.items()
            if k.startswith("flowforge_loop_step_duration_seconds{")
        }

        llm_calls = {k: v for k, v in self._counters.items()
                    if k.startswith("flowforge_llm_calls_total{")}
        llm_tokens = {k: v for k, v in self._counters.items()
                     if k.startswith("flowforge_llm_tokens_total{")}
        llm_durations = {
            k: {"count": len(v), "sum": sum(v), "avg": sum(v)/len(v) if v else 0}
            for k, v in self._histograms.items()
            if k.startswith("flowforge_llm_duration_seconds{")
        }
        webchat_durations = {
            k: {"count": len(v), "sum": sum(v), "avg": sum(v)/len(v) if v else 0}
            for k, v in self._histograms.items()
            if k.startswith("flowforge_llm_webchat_duration_seconds{")
        }

        degradation_total = {k: v for k, v in self._counters.items()
                            if k.startswith("flowforge_degradation_total{")}
        recovery_total = {k: v for k, v in self._counters.items()
                         if k.startswith("flowforge_recovery_total{")}
        recovery_durations = {
            k: {"count": len(v), "sum": sum(v), "avg": sum(v)/len(v) if v else 0}
            for k, v in self._histograms.items()
            if k.startswith("flowforge_recovery_duration_seconds{")
        }

        quota_used_ratio = {k: v for k, v in self._gauges.items()
                           if k.startswith("flowforge_provider_quota_used_ratio{")}
        quota_remaining = {k: v for k, v in self._gauges.items()
                          if k.startswith("flowforge_provider_quota_remaining{")}

        return {
            "loop": {
                "total": loop_total,
                "iterations": loop_iterations,
                "step_total": loop_step_total,
                "quality_scores": loop_quality,
                "durations": loop_durations,
                "step_durations": loop_step_durations,
            },
            "llm": {
                "calls": llm_calls,
                "tokens": llm_tokens,
                "durations": llm_durations,
                "webchat_durations": webchat_durations,
            },
            "degradation": {
                "total": degradation_total,
            },
            "recovery": {
                "total": recovery_total,
                "durations": recovery_durations,
            },
            "provider": {
                "quota_used_ratio": quota_used_ratio,
                "quota_remaining": quota_remaining,
            },
        }

    def get_slo_status(self) -> dict:
        """返回 SLO 达标状态。

        Returns:
            包含以下键的字典：
            - ``loop_3min_slo``: 最近 5min P95 loop_duration 是否 < 180s。
            - ``webchat_30s_slo``: 最近 5min P95 webchat_duration 是否 < 30s。
            - ``degradation_rate``: 降级率（degradation / max(loop_total, 1)）。
              < 0.05 为健康。
            - ``loop_p95_seconds``: 最近 5min Loop P95 时长（无数据时为 0.0）。
            - ``webchat_p95_seconds``: 最近 5min WebChat P95 时长（无数据时为 0.0）。
            - ``loop_sample_count``: 最近 5min Loop 样本数。
            - ``webchat_sample_count``: 最近 5min WebChat 样本数。
        """
        # Loop 3min SLO: P95 < 180s in last 5 min
        loop_recent = self._recent_histogram_values(
            "flowforge_loop_duration_seconds", self.SLO_WINDOW_SECONDS
        )
        loop_p95 = self._percentile(loop_recent, 95) if loop_recent else 0.0
        loop_3min_slo = (loop_p95 < self.LOOP_SLO_SECONDS) if loop_recent else True

        # Webchat 30s SLO: P95 < 30s in last 5 min
        webchat_recent = self._recent_histogram_values(
            "flowforge_llm_webchat_duration_seconds", self.SLO_WINDOW_SECONDS
        )
        webchat_p95 = self._percentile(webchat_recent, 95) if webchat_recent else 0.0
        webchat_30s_slo = (webchat_p95 < self.WEBCHAT_SLO_SECONDS) if webchat_recent else True

        # Degradation rate: degradation_count / max(loop_total, 1)
        degradation_count = sum(
            v for k, v in self._counters.items()
            if k.startswith("flowforge_degradation_total{")
        )
        loop_count = sum(
            v for k, v in self._counters.items()
            if k.startswith("flowforge_loop_total{")
        )
        if loop_count > 0:
            degradation_rate = degradation_count / loop_count
        else:
            degradation_rate = 0.0

        return {
            "loop_3min_slo": loop_3min_slo,
            "webchat_30s_slo": webchat_30s_slo,
            "degradation_rate": degradation_rate,
            "loop_p95_seconds": loop_p95,
            "webchat_p95_seconds": webchat_p95,
            "loop_sample_count": len(loop_recent),
            "webchat_sample_count": len(webchat_recent),
        }

    def get_prometheus_format(self) -> str:
        """Export metrics in Prometheus text format.

        对于配置了 bucket 的直方图，按 Prometheus 标准格式输出：
        ``<metric>_bucket{<labels>,le="<bucket>"} <count>``、
        ``<metric>_bucket{<labels>,le="+Inf"} <count>``、
        ``<metric>_count{<labels>} <count>``、
        ``<metric>_sum{<labels>} <sum>``。

        对于未配置 bucket 的直方图，保持原有简化格式：
        ``<key>_count``、``<key>_sum``。
        """
        lines = []

        for key, value in self._counters.items():
            lines.append(f"# TYPE {key.split('{')[0]} counter")
            lines.append(f"{key} {value}")

        for key, value in self._gauges.items():
            lines.append(f"# TYPE {key.split('{')[0]} gauge")
            lines.append(f"{key} {value}")

        for key, values in self._histograms.items():
            base_name, labels = self._parse_key(key)
            lines.append(f"# TYPE {base_name} histogram")
            buckets = self._get_buckets(base_name)
            if buckets:
                # 输出 Prometheus 标准 bucket 格式
                for bucket in buckets:
                    count = sum(1 for v in values if v <= bucket)
                    bucket_labels = {**labels, "le": str(bucket)}
                    lines.append(
                        f"{base_name}_bucket{self._format_prometheus_labels(bucket_labels)} {count}"
                    )
                # +Inf bucket
                inf_labels = {**labels, "le": "+Inf"}
                lines.append(
                    f"{base_name}_bucket{self._format_prometheus_labels(inf_labels)} {len(values)}"
                )
                # count / sum（带引号的标准 Prometheus 标签格式）
                label_str = self._format_prometheus_labels(labels)
                lines.append(f"{base_name}_count{label_str} {len(values)}")
                lines.append(f"{base_name}_sum{label_str} {sum(values)}")
            else:
                # 无 bucket 配置：保持原有简化格式
                lines.append(f"{key}_count {len(values)}")
                lines.append(f"{key}_sum {sum(values)}")

        return "\n".join(lines)

    def get_status(self) -> dict:
        """Get metrics collector status."""
        return {
            "enabled": self.enabled,
            "counter_count": len(self._counters),
            "gauge_count": len(self._gauges),
            "histogram_count": len(self._histograms),
            "bucket_config_count": len(self._histogram_buckets),
        }
