"""Canary Deployment Framework — 金丝雀发布框架.

提供渐进式发布、健康检查、自动回滚的金丝雀部署能力。
通过 YAML 配置驱动，无需编写代码即可使用。
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

import yaml
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.canary")


class CanaryStageConfig(BaseModel):
    """金丝雀阶段配置."""
    percentage: int = 10
    duration_seconds: int = 300
    health_check_url: str | None = None
    success_threshold: float = 0.99
    error_rate_threshold: float = 0.01
    latency_p99_threshold_ms: int = 2000


class CanaryDeploymentConfig(BaseModel):
    """金丝雀部署配置 — 从 YAML 文件加载."""
    name: str
    description: str = ""
    enabled: bool = True
    stages: list[CanaryStageConfig] = Field(default_factory=lambda: [
        CanaryStageConfig(percentage=10, duration_seconds=300),
        CanaryStageConfig(percentage=50, duration_seconds=300),
        CanaryStageConfig(percentage=100, duration_seconds=0),
    ])
    auto_rollback: bool = True
    rollback_on_error_rate: float = 0.05
    rollback_on_latency_multiplier: float = 2.0
    health_check_interval_seconds: int = 30
    health_check_timeout_seconds: int = 10
    observation_seconds: int = 300
    metadata: dict[str, Any] = Field(default_factory=dict)

    class Config:
        extra = "allow"


class CanaryDeploymentRegistry:
    """金丝雀部署配置注册中心 — 支持从 YAML 目录自动加载."""

    def __init__(self, config_dir: str | None = None):
        self._configs: dict[str, CanaryDeploymentConfig] = {}
        if config_dir:
            self.load_from_dir(config_dir)

    def load_from_dir(self, dir_path: str | Path) -> int:
        """从目录加载所有金丝雀部署配置."""
        count = 0
        canary_path = Path(dir_path)
        if not canary_path.is_dir():
            workspace_root = Path.cwd()
            canary_path = workspace_root / dir_path
        if not canary_path.is_dir():
            logger.debug(f"CanaryDeploymentRegistry: directory '{dir_path}' not found, skipping")
            return 0

        for yaml_file in sorted(canary_path.glob("*.y*ml")):
            try:
                data = yaml.safe_load(yaml_file.read_text(encoding="utf-8"))
                if not data or "name" not in data:
                    logger.warning(f"CanaryDeploymentRegistry: skipping {yaml_file}, missing 'name'")
                    continue
                config = CanaryDeploymentConfig(**data)
                self._configs[config.name] = config
                count += 1
                logger.info(f"CanaryDeploymentRegistry: loaded '{config.name}' from {yaml_file.name}")
            except Exception as e:
                logger.warning(f"CanaryDeploymentRegistry: failed to load from {yaml_file}: {e}")

        logger.info(f"CanaryDeploymentRegistry: {count} config(s) loaded from '{dir_path}'")
        return count

    def register(self, name: str, config: dict[str, Any] | CanaryDeploymentConfig) -> None:
        """注册金丝雀部署配置."""
        if isinstance(config, CanaryDeploymentConfig):
            self._configs[name] = config
        else:
            self._configs[name] = CanaryDeploymentConfig(name=name, **config)

    def get(self, name: str) -> Optional[CanaryDeploymentConfig]:
        return self._configs.get(name)

    def list_deployments(self) -> list[str]:
        return list(self._configs.keys())

    def get_all(self) -> dict[str, CanaryDeploymentConfig]:
        return dict(self._configs)


# ──────────────────────────────────────────────────────────────────────────
# 金丝雀发布执行能力（P3-008 补完）
# ──────────────────────────────────────────────────────────────────────────


class CanaryExecutionState(str, Enum):
    """金丝雀发布执行状态枚举."""

    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    SUCCEEDED = "succeeded"
    ROLLED_BACK = "rolled_back"
    FAILED = "failed"


class CanaryStageResult(BaseModel):
    """金丝雀单个阶段执行结果."""

    stage_index: int
    percentage: int
    state: str
    started_at: str
    finished_at: str = ""
    duration_seconds: float = 0.0
    health_check_passed: bool = False
    metrics_snapshot: dict[str, Any] = Field(default_factory=dict)
    error: str = ""

    class Config:
        extra = "allow"


class CanaryExecution(BaseModel):
    """金丝雀发布整体执行状态."""

    deployment_name: str
    state: CanaryExecutionState = CanaryExecutionState.PENDING
    current_stage_index: int = -1
    stages_results: list[CanaryStageResult] = Field(default_factory=list)
    started_at: str = ""
    finished_at: str = ""
    total_duration_seconds: float = 0.0
    auto_rollback_triggered: bool = False
    rollback_reason: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)

    class Config:
        extra = "allow"


class HealthCheckResult(BaseModel):
    """健康检查结果."""

    passed: bool
    status_code: int = 0
    response_time_ms: float = 0.0
    error_rate: float = 0.0
    latency_p99_ms: float = 0.0
    details: dict[str, Any] = Field(default_factory=dict)
    error: str = ""

    class Config:
        extra = "allow"


# 金丝雀发布相关事件类型常量（与 EventBus 配合使用）
CANARY_EVENT_EXECUTION_STARTED = "canary.execution.started"
CANARY_EVENT_EXECUTION_SUCCEEDED = "canary.execution.succeeded"
CANARY_EVENT_EXECUTION_PAUSED = "canary.execution.paused"
CANARY_EVENT_EXECUTION_RESUMED = "canary.execution.resumed"
CANARY_EVENT_EXECUTION_ROLLED_BACK = "canary.execution.rolled_back"
CANARY_EVENT_EXECUTION_FAILED = "canary.execution.failed"
CANARY_EVENT_STAGE_STARTED = "canary.stage.started"
CANARY_EVENT_STAGE_COMPLETED = "canary.stage.completed"
CANARY_EVENT_STAGE_FAILED = "canary.stage.failed"

# MetricsCollector 指标名常量
CANARY_METRIC_STAGE_DURATION = "flowforge_canary_stage_duration_seconds"
CANARY_METRIC_STAGE_TOTAL = "flowforge_canary_stage_total"
CANARY_METRIC_ERROR_RATE = "flowforge_canary_error_rate"
CANARY_METRIC_LATENCY_P99 = "flowforge_canary_latency_p99_ms"
CANARY_METRIC_ROLLBACK_TOTAL = "flowforge_canary_rollback_total"


def _now_iso() -> str:
    """返回当前 UTC 时间的 ISO 8601 字符串."""
    return datetime.now(timezone.utc).isoformat()


class CanaryExecutor:
    """金丝雀发布执行器 — 驱动渐进式发布流程的核心组件.

    通过 :class:`CanaryDeploymentRegistry` 获取配置，按 stages 顺序执行
    金丝雀发布；每阶段调用 ``traffic_router`` 调整流量、等待观测期、
    执行健康检查；健康检查失败时根据 ``auto_rollback`` 自动回滚或置为
    FAILED 状态。

    所有依赖（registry / metrics_collector / event_bus / http_client）
    均通过构造函数注入，遵循 DI 原则（铁律 12）。
    """

    def __init__(
        self,
        registry: CanaryDeploymentRegistry,
        metrics_collector: Any = None,
        event_bus: Any = None,
        http_client: Any = None,
        logger: Any = None,
    ) -> None:
        """初始化金丝雀执行器.

        Args:
            registry: 金丝雀部署配置注册中心（必需，DI 注入）。
            metrics_collector: 可选的指标采集器，需支持 ``inc_counter`` /
                ``observe_histogram`` / ``set_gauge`` 接口；若额外实现
                ``get_canary_metrics(deployment_name, stage_index)`` 方法，
                健康检查会从其中读取 ``error_rate`` 与 ``latency_p99_ms``。
            event_bus: 可选的事件总线，需支持 ``emit(task_id, event_type, payload)``。
            http_client: 可选的 HTTP 客户端（需提供 ``get(url, timeout=...)``
                异步接口）；为 None 时按需创建 ``httpx.AsyncClient``。
            logger: 可选的日志器，为 None 时使用模块级 logger。
        """
        self._registry = registry
        self._metrics_collector = metrics_collector
        self._event_bus = event_bus
        self._http_client = http_client
        self._logger = logger or get_logger("flowforge.core.canary.executor")

        # 进行中 / 已完成的执行记录
        self._executions: dict[str, CanaryExecution] = {}
        self._history: list[CanaryExecution] = []

        # 暂停 / 恢复支持
        self._pause_events: dict[str, asyncio.Event] = {}
        self._paused_flags: dict[str, bool] = {}

        # 每次执行对应的 traffic_router（_rollback 复用）
        self._traffic_routers: dict[str, Optional[Callable]] = {}

    # ── 公共接口 ──────────────────────────────────────────────────

    async def execute(
        self,
        deployment_name: str,
        traffic_router: Optional[Callable] = None,
    ) -> CanaryExecution:
        """执行一次完整的金丝雀发布流程.

        按 stages 顺序逐阶段执行：调整流量 → 等待观测期 → 健康检查 →
        决策（继续 / 暂停 / 回滚）。全部阶段成功则置 SUCCEEDED；任一阶段
        健康检查失败且 ``auto_rollback=True`` 时自动回滚，否则置 FAILED。

        Args:
            deployment_name: 注册中心中的部署配置名。
            traffic_router: 流量路由回调，签名为
                ``traffic_router(percentage: int) -> Any``，支持同步或异步。
                为 None 时跳过流量调整步骤。

        Returns:
            本次执行的 :class:`CanaryExecution` 状态快照。

        Raises:
            KeyError: 配置不存在时抛出。
        """
        config = self._registry.get(deployment_name)
        if config is None:
            available = self._registry.list_deployments()
            raise KeyError(
                f"Canary deployment '{deployment_name}' not found. "
                f"Available: {available}"
            )

        # 复用 / 新建 execution
        existing = self._executions.get(deployment_name)
        if existing is None or existing.state in (
            CanaryExecutionState.SUCCEEDED,
            CanaryExecutionState.ROLLED_BACK,
            CanaryExecutionState.FAILED,
        ):
            execution = CanaryExecution(
                deployment_name=deployment_name,
                state=CanaryExecutionState.PENDING,
                started_at=_now_iso(),
                metadata=dict(config.metadata),
            )
            self._executions[deployment_name] = execution
        else:
            execution = existing

        # 注册 traffic_router / pause event
        self._traffic_routers[deployment_name] = traffic_router
        if deployment_name not in self._pause_events:
            evt = asyncio.Event()
            evt.set()
            self._pause_events[deployment_name] = evt
        if not self._paused_flags.get(deployment_name, False):
            self._pause_events[deployment_name].set()

        execution_start = time.monotonic()
        execution.state = CanaryExecutionState.RUNNING
        self._emit_event(
            CANARY_EVENT_EXECUTION_STARTED,
            deployment_name,
            {"deployment_name": deployment_name, "stages": len(config.stages)},
        )
        self._logger.info(
            f"[canary] execute start: deployment={deployment_name} stages={len(config.stages)}"
        )

        stage_index = execution.current_stage_index + 1
        while stage_index < len(config.stages):
            # 暂停检查（协作式）
            if self._paused_flags.get(deployment_name, False):
                execution.state = CanaryExecutionState.PAUSED
                self._emit_event(
                    CANARY_EVENT_EXECUTION_PAUSED,
                    deployment_name,
                    {"deployment_name": deployment_name, "stage_index": stage_index},
                )
                self._logger.info(
                    f"[canary] execution paused at stage={stage_index}: {deployment_name}"
                )
                await self._pause_events[deployment_name].wait()
                execution.state = CanaryExecutionState.RUNNING
                self._emit_event(
                    CANARY_EVENT_EXECUTION_RESUMED,
                    deployment_name,
                    {"deployment_name": deployment_name, "stage_index": stage_index},
                )
                self._logger.info(
                    f"[canary] execution resumed at stage={stage_index}: {deployment_name}"
                )

            execution.current_stage_index = stage_index
            stage_cfg = config.stages[stage_index]
            self._emit_event(
                CANARY_EVENT_STAGE_STARTED,
                deployment_name,
                {
                    "deployment_name": deployment_name,
                    "stage_index": stage_index,
                    "percentage": stage_cfg.percentage,
                },
            )

            try:
                stage_result = await self._execute_stage(
                    execution, stage_index, traffic_router
                )
            except Exception as exc:
                stage_result = CanaryStageResult(
                    stage_index=stage_index,
                    percentage=stage_cfg.percentage,
                    state=CanaryExecutionState.FAILED.value,
                    started_at=_now_iso(),
                    finished_at=_now_iso(),
                    error=f"stage execution error: {exc}",
                )
                execution.stages_results.append(stage_result)
                self._emit_event(
                    CANARY_EVENT_STAGE_FAILED,
                    deployment_name,
                    {
                        "deployment_name": deployment_name,
                        "stage_index": stage_index,
                        "error": str(exc),
                    },
                )
                self._record_stage_metrics(deployment_name, stage_result)
                if config.auto_rollback:
                    execution = await self._rollback(
                        execution, reason=f"stage {stage_index} raised: {exc}"
                    )
                else:
                    execution.state = CanaryExecutionState.FAILED
                    self._emit_event(
                        CANARY_EVENT_EXECUTION_FAILED,
                        deployment_name,
                        {"deployment_name": deployment_name, "error": str(exc)},
                    )
                execution.total_duration_seconds = time.monotonic() - execution_start
                execution.finished_at = _now_iso()
                self._history.append(execution)
                return execution

            execution.stages_results.append(stage_result)
            self._record_stage_metrics(deployment_name, stage_result)
            self._emit_event(
                CANARY_EVENT_STAGE_COMPLETED,
                deployment_name,
                {
                    "deployment_name": deployment_name,
                    "stage_index": stage_index,
                    "percentage": stage_cfg.percentage,
                    "health_check_passed": stage_result.health_check_passed,
                },
            )

            if not stage_result.health_check_passed:
                if config.auto_rollback:
                    execution = await self._rollback(
                        execution,
                        reason=(
                            f"stage {stage_index} health check failed: "
                            f"{stage_result.error}"
                        ),
                    )
                else:
                    execution.state = CanaryExecutionState.FAILED
                    self._emit_event(
                        CANARY_EVENT_EXECUTION_FAILED,
                        deployment_name,
                        {
                            "deployment_name": deployment_name,
                            "stage_index": stage_index,
                            "error": stage_result.error,
                        },
                    )
                execution.total_duration_seconds = time.monotonic() - execution_start
                execution.finished_at = _now_iso()
                self._history.append(execution)
                return execution

            stage_index += 1

        execution.state = CanaryExecutionState.SUCCEEDED
        execution.total_duration_seconds = time.monotonic() - execution_start
        execution.finished_at = _now_iso()
        self._emit_event(
            CANARY_EVENT_EXECUTION_SUCCEEDED,
            deployment_name,
            {
                "deployment_name": deployment_name,
                "total_duration_seconds": execution.total_duration_seconds,
            },
        )
        self._logger.info(
            f"[canary] execute succeeded: deployment={deployment_name} "
            f"duration={execution.total_duration_seconds:.3f}s"
        )
        self._history.append(execution)
        return execution

    async def _execute_stage(
        self,
        execution: CanaryExecution,
        stage_index: int,
        traffic_router: Optional[Callable],
    ) -> CanaryStageResult:
        """执行单个金丝雀阶段：调整流量 → 等待观测 → 健康检查.

        Args:
            execution: 当前执行上下文。
            stage_index: 阶段索引。
            traffic_router: 流量路由回调（可为 None）。

        Returns:
            该阶段的 :class:`CanaryStageResult`。
        """
        config = self._registry.get(execution.deployment_name)
        assert config is not None  # execute() 已校验
        stage_cfg = config.stages[stage_index]

        started_at = _now_iso()
        start_mono = time.monotonic()
        self._logger.info(
            f"[canary] stage start: deployment={execution.deployment_name} "
            f"stage={stage_index} percentage={stage_cfg.percentage}%"
        )

        # 调整流量
        if traffic_router is not None:
            result = traffic_router(stage_cfg.percentage)
            if asyncio.iscoroutine(result):
                await result

        # 等待观测期（测试中可将 observation_seconds 设为 0 跳过）
        if config.observation_seconds > 0:
            await asyncio.sleep(config.observation_seconds)

        # 健康检查
        health = await self._health_check(stage_cfg)

        duration = time.monotonic() - start_mono
        stage_state = (
            CanaryExecutionState.SUCCEEDED.value
            if health.passed
            else CanaryExecutionState.FAILED.value
        )
        return CanaryStageResult(
            stage_index=stage_index,
            percentage=stage_cfg.percentage,
            state=stage_state,
            started_at=started_at,
            finished_at=_now_iso(),
            duration_seconds=duration,
            health_check_passed=health.passed,
            metrics_snapshot={
                "status_code": health.status_code,
                "response_time_ms": health.response_time_ms,
                "error_rate": health.error_rate,
                "latency_p99_ms": health.latency_p99_ms,
            },
            error=health.error,
        )

    async def _health_check(self, config: CanaryStageConfig) -> HealthCheckResult:
        """对单个阶段执行健康检查.

        检查项：
        1. 调用 ``health_check_url``，HTTP 状态码必须为 200；
        2. ``error_rate`` 须小于 ``error_rate_threshold``；
        3. ``latency_p99_ms`` 须小于 ``latency_p99_threshold_ms``。

        ``error_rate`` 与 ``latency_p99_ms`` 优先来自 HTTP 响应体 JSON
        （键名 ``error_rate`` / ``latency_p99_ms``）；若响应体未提供且
        ``metrics_collector`` 实现了 ``get_canary_metrics`` 方法，则从
        metrics_collector 读取；否则置为 0。

        Args:
            config: 单阶段配置。

        Returns:
            :class:`HealthCheckResult` 检查结果。
        """
        result = HealthCheckResult(passed=True)

        if config.health_check_url:
            client_owned = False
            client = self._http_client
            if client is None:
                import httpx

                client = httpx.AsyncClient()
                client_owned = True
            try:
                start = time.monotonic()
                response = await client.get(
                    config.health_check_url, timeout=10.0
                )
                result.response_time_ms = (time.monotonic() - start) * 1000.0
                result.status_code = response.status_code

                if response.status_code != 200:
                    result.passed = False
                    result.error = (
                        f"health check returned status {response.status_code}"
                    )
                else:
                    # 尝试从响应体读取 error_rate / latency_p99_ms
                    try:
                        body = response.json() if hasattr(response, "json") else {}
                        if isinstance(body, dict):
                            result.error_rate = float(body.get("error_rate", 0.0))
                            result.latency_p99_ms = float(
                                body.get("latency_p99_ms", 0.0)
                            )
                            result.details = {
                                k: v
                                for k, v in body.items()
                                if k not in ("error_rate", "latency_p99_ms")
                            }
                    except Exception:
                        # 响应体非 JSON，忽略
                        pass
            except Exception as exc:
                result.passed = False
                result.status_code = 0
                result.error = f"health check request failed: {exc}"
            finally:
                if client_owned:
                    try:
                        await client.aclose()
                    except Exception:
                        pass

        # 若未从响应体获得指标，尝试从 metrics_collector 读取
        if (
            self._metrics_collector is not None
            and result.error_rate == 0.0
            and result.latency_p99_ms == 0.0
        ):
            getter = getattr(self._metrics_collector, "get_canary_metrics", None)
            if callable(getter):
                try:
                    metrics_data = getter()
                    if isinstance(metrics_data, dict):
                        result.error_rate = float(metrics_data.get("error_rate", 0.0))
                        result.latency_p99_ms = float(
                            metrics_data.get("latency_p99_ms", 0.0)
                        )
                except Exception:
                    pass

        # 阈值检查
        if result.error_rate > config.error_rate_threshold:
            result.passed = False
            result.error = (
                f"error_rate {result.error_rate:.4f} exceeds threshold "
                f"{config.error_rate_threshold:.4f}"
            )
        if result.latency_p99_ms > config.latency_p99_threshold_ms:
            result.passed = False
            if not result.error:
                result.error = (
                    f"latency_p99 {result.latency_p99_ms:.1f}ms exceeds threshold "
                    f"{config.latency_p99_threshold_ms}ms"
                )

        return result

    async def _rollback(
        self,
        execution: CanaryExecution,
        reason: str,
    ) -> CanaryExecution:
        """回滚金丝雀发布：将流量回退至 0% 并更新执行状态.

        Args:
            execution: 当前执行上下文。
            reason: 回滚原因。

        Returns:
            更新后的 :class:`CanaryExecution`。
        """
        deployment_name = execution.deployment_name
        traffic_router = self._traffic_routers.get(deployment_name)

        if traffic_router is not None:
            try:
                result = traffic_router(0)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as exc:
                self._logger.warning(
                    f"[canary] traffic_router(0) failed during rollback: {exc}"
                )

        execution.state = CanaryExecutionState.ROLLED_BACK
        execution.auto_rollback_triggered = True
        execution.rollback_reason = reason

        if self._metrics_collector is not None:
            try:
                self._metrics_collector.inc_counter(
                    CANARY_METRIC_ROLLBACK_TOTAL,
                    labels={"deployment_name": deployment_name},
                )
            except Exception:
                pass

        self._emit_event(
            CANARY_EVENT_EXECUTION_ROLLED_BACK,
            deployment_name,
            {"deployment_name": deployment_name, "reason": reason},
        )
        self._logger.warning(
            f"[canary] rollback: deployment={deployment_name} reason={reason}"
        )
        return execution

    async def pause_execution(self, deployment_name: str) -> bool:
        """暂停执行（等待人工审批）.

        在下一阶段开始前生效（协作式暂停）。

        Args:
            deployment_name: 部署名。

        Returns:
            是否成功设置暂停（执行不存在则返回 False）。
        """
        if deployment_name not in self._executions:
            return False
        self._paused_flags[deployment_name] = True
        evt = self._pause_events.setdefault(deployment_name, asyncio.Event())
        evt.clear()
        execution = self._executions[deployment_name]
        if execution.state == CanaryExecutionState.RUNNING:
            execution.state = CanaryExecutionState.PAUSED
        self._logger.info(f"[canary] pause requested: {deployment_name}")
        return True

    async def resume_execution(self, deployment_name: str) -> bool:
        """恢复已暂停的执行.

        Args:
            deployment_name: 部署名。

        Returns:
            是否成功恢复（执行不存在则返回 False）。
        """
        if deployment_name not in self._executions:
            return False
        self._paused_flags[deployment_name] = False
        evt = self._pause_events.setdefault(deployment_name, asyncio.Event())
        evt.set()
        execution = self._executions[deployment_name]
        if execution.state == CanaryExecutionState.PAUSED:
            execution.state = CanaryExecutionState.RUNNING
        self._logger.info(f"[canary] resume requested: {deployment_name}")
        return True

    def get_execution(self, deployment_name: str) -> Optional[CanaryExecution]:
        """获取指定部署的当前执行状态.

        Args:
            deployment_name: 部署名。

        Returns:
            :class:`CanaryExecution` 或 None（不存在时）。
        """
        return self._executions.get(deployment_name)

    def list_executions(self) -> dict[str, CanaryExecution]:
        """列出所有执行（按部署名索引）.

        Returns:
            ``{deployment_name: CanaryExecution}`` 字典（浅拷贝）。
        """
        return dict(self._executions)

    def get_execution_history(
        self,
        deployment_name: Optional[str] = None,
        limit: int = 20,
    ) -> list[CanaryExecution]:
        """获取执行历史记录.

        Args:
            deployment_name: 可选过滤条件；为 None 时返回所有部署的历史。
            limit: 最多返回的记录数，默认 20。

        Returns:
            历史执行列表（按时间倒序最近的在前）。
        """
        if deployment_name is None:
            return list(self._history[-limit:])
        return [
            e
            for e in self._history[-limit:]
            if e.deployment_name == deployment_name
        ]

    # ── 内部辅助 ──────────────────────────────────────────────────

    def _emit_event(self, event_type: str, deployment_name: str, payload: dict) -> None:
        """向 event_bus 发送事件（若 event_bus 可用）."""
        if self._event_bus is None:
            return
        try:
            self._event_bus.emit(deployment_name, event_type, payload)
        except Exception as exc:
            self._logger.warning(f"[canary] event emit failed: {event_type}: {exc}")

    def _record_stage_metrics(
        self, deployment_name: str, stage_result: CanaryStageResult
    ) -> None:
        """向 metrics_collector 上报单阶段指标."""
        if self._metrics_collector is None:
            return
        labels = {
            "deployment_name": deployment_name,
            "stage_index": str(stage_result.stage_index),
        }
        try:
            self._metrics_collector.observe_histogram(
                CANARY_METRIC_STAGE_DURATION,
                stage_result.duration_seconds,
                labels=labels,
            )
            self._metrics_collector.inc_counter(
                CANARY_METRIC_STAGE_TOTAL,
                labels={
                    **labels,
                    "state": (
                        "success"
                        if stage_result.health_check_passed
                        else "failure"
                    ),
                },
            )
            self._metrics_collector.set_gauge(
                CANARY_METRIC_ERROR_RATE,
                stage_result.metrics_snapshot.get("error_rate", 0.0),
                labels=labels,
            )
            self._metrics_collector.set_gauge(
                CANARY_METRIC_LATENCY_P99,
                stage_result.metrics_snapshot.get("latency_p99_ms", 0.0),
                labels=labels,
            )
        except Exception as exc:
            self._logger.warning(
                f"[canary] metrics record failed for stage {stage_result.stage_index}: {exc}"
            )
