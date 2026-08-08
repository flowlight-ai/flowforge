"""CanaryExecutor 单元测试 — 覆盖 P3-008 金丝雀发布执行能力.

测试范围：
- CanaryExecutionState / CanaryStageResult / CanaryExecution / HealthCheckResult 模型字段
- CanaryExecutor 初始化与依赖注入
- execute() 全流程（成功 / 失败 / 自动回滚 / 暂停恢复 / 异常）
- _execute_stage() 流量调整 + 观测 + 健康检查
- _health_check() 成功 / 失败 / 超时 / 阈值越界
- _rollback() 流量回退 + 状态更新
- pause_execution() / resume_execution() / get_execution() / list_executions() / get_execution_history()
- metrics_collector 与 event_bus 集成

测试中不真实 sleep：所有 observation_seconds 均设为 0。
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from flowforge.core.canary import (
    CANARY_EVENT_EXECUTION_FAILED,
    CANARY_EVENT_EXECUTION_PAUSED,
    CANARY_EVENT_EXECUTION_RESUMED,
    CANARY_EVENT_EXECUTION_ROLLED_BACK,
    CANARY_EVENT_EXECUTION_STARTED,
    CANARY_EVENT_EXECUTION_SUCCEEDED,
    CANARY_EVENT_STAGE_COMPLETED,
    CANARY_EVENT_STAGE_FAILED,
    CANARY_EVENT_STAGE_STARTED,
    CANARY_METRIC_ERROR_RATE,
    CANARY_METRIC_LATENCY_P99,
    CANARY_METRIC_ROLLBACK_TOTAL,
    CANARY_METRIC_STAGE_DURATION,
    CANARY_METRIC_STAGE_TOTAL,
    CanaryDeploymentConfig,
    CanaryDeploymentRegistry,
    CanaryExecution,
    CanaryExecutionState,
    CanaryExecutor,
    CanaryStageConfig,
    CanaryStageResult,
    HealthCheckResult,
)
from flowforge.events.event_bus import EventBus


# ──────────────────────────────────────────────────────────────────────────
# 测试辅助
# ──────────────────────────────────────────────────────────────────────────


def _make_stage_dict(
    percentage: int = 10,
    health_check_url: str | None = None,
    error_rate_threshold: float = 0.01,
    latency_p99_threshold_ms: int = 2000,
    duration_seconds: int = 0,
    success_threshold: float = 0.99,
) -> dict[str, Any]:
    """构造单阶段配置字典."""
    return {
        "percentage": percentage,
        "duration_seconds": duration_seconds,
        "health_check_url": health_check_url,
        "success_threshold": success_threshold,
        "error_rate_threshold": error_rate_threshold,
        "latency_p99_threshold_ms": latency_p99_threshold_ms,
    }


def _make_config_dict(
    name: str = "test-deploy",
    description: str = "测试部署",
    stages: list[dict[str, Any]] | None = None,
    observation_seconds: int = 0,
    auto_rollback: bool = True,
    health_check_url: str | None = None,
) -> dict[str, Any]:
    """构造部署配置字典；默认 3 阶段 10%→50%→100%，observation_seconds=0."""
    if stages is None:
        stages = [
            _make_stage_dict(percentage=10, health_check_url=health_check_url),
            _make_stage_dict(percentage=50, health_check_url=health_check_url),
            _make_stage_dict(percentage=100, health_check_url=health_check_url),
        ]
    return {
        "name": name,
        "description": description,
        "enabled": True,
        "stages": stages,
        "auto_rollback": auto_rollback,
        "observation_seconds": observation_seconds,
        "metadata": {"project": "test"},
    }


def _make_registry(
    config_dict: dict[str, Any] | None = None,
) -> CanaryDeploymentRegistry:
    """构造已注册单个部署的注册中心."""
    registry = CanaryDeploymentRegistry()
    config_dict = config_dict or _make_config_dict()
    # 直接构造 CanaryDeploymentConfig 对象传入 register（dict 形式会与 name 参数冲突）
    config = CanaryDeploymentConfig(**config_dict)
    registry.register(config.name, config)
    return registry


def _make_multi_registry(*names: str) -> CanaryDeploymentRegistry:
    """构造已注册多个部署的注册中心."""
    registry = CanaryDeploymentRegistry()
    for name in names:
        config = CanaryDeploymentConfig(**_make_config_dict(name=name))
        registry.register(config.name, config)
    return registry


def _make_mock_response(
    status_code: int = 200,
    body: dict[str, Any] | None = None,
) -> MagicMock:
    """构造模拟 HTTP 响应."""
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = body or {}
    return response


def _make_mock_http_client(
    response: MagicMock | None = None,
    exc: Exception | None = None,
) -> MagicMock:
    """构造模拟 HTTP 客户端.

    Args:
        response: 正常响应；若 exc 提供，则 get 抛出 exc。
        exc: 抛出异常覆盖响应。
    """
    client = MagicMock()
    if exc is not None:
        client.get = AsyncMock(side_effect=exc)
    else:
        client.get = AsyncMock(return_value=response or _make_mock_response(200))
    return client


def _make_mock_metrics_collector(
    canary_metrics: dict[str, Any] | None = None,
) -> MagicMock:
    """构造模拟 metrics_collector."""
    mc = MagicMock()
    mc.inc_counter = MagicMock()
    mc.observe_histogram = MagicMock()
    mc.set_gauge = MagicMock()
    if canary_metrics is not None:
        mc.get_canary_metrics = MagicMock(return_value=canary_metrics)
    return mc


# ──────────────────────────────────────────────────────────────────────────
# 1. CanaryExecutionState 枚举
# ──────────────────────────────────────────────────────────────────────────


def test_canary_execution_state_has_six_values():
    """验证 CanaryExecutionState 包含 6 个枚举值."""
    states = list(CanaryExecutionState)
    assert len(states) == 6


def test_canary_execution_state_values():
    """验证 CanaryExecutionState 各枚举的字符串值."""
    assert CanaryExecutionState.PENDING.value == "pending"
    assert CanaryExecutionState.RUNNING.value == "running"
    assert CanaryExecutionState.PAUSED.value == "paused"
    assert CanaryExecutionState.SUCCEEDED.value == "succeeded"
    assert CanaryExecutionState.ROLLED_BACK.value == "rolled_back"
    assert CanaryExecutionState.FAILED.value == "failed"


def test_canary_execution_state_is_str_enum():
    """验证 CanaryExecutionState 是 str 枚举（可直接当字符串使用）."""
    assert CanaryExecutionState.PENDING == "pending"
    assert isinstance(CanaryExecutionState.RUNNING, str)


# ──────────────────────────────────────────────────────────────────────────
# 2. CanaryStageResult 字段
# ──────────────────────────────────────────────────────────────────────────


def test_canary_stage_result_required_fields():
    """验证 CanaryStageResult 必填字段."""
    result = CanaryStageResult(
        stage_index=0,
        percentage=10,
        state="succeeded",
        started_at="2026-01-01T00:00:00+00:00",
    )
    assert result.stage_index == 0
    assert result.percentage == 10
    assert result.state == "succeeded"
    assert result.started_at == "2026-01-01T00:00:00+00:00"


def test_canary_stage_result_default_fields():
    """验证 CanaryStageResult 默认字段值."""
    result = CanaryStageResult(
        stage_index=1, percentage=50, state="running", started_at="t"
    )
    assert result.finished_at == ""
    assert result.duration_seconds == 0.0
    assert result.health_check_passed is False
    assert result.metrics_snapshot == {}
    assert result.error == ""


def test_canary_stage_result_custom_fields():
    """验证 CanaryStageResult 自定义字段."""
    result = CanaryStageResult(
        stage_index=2,
        percentage=100,
        state="failed",
        started_at="2026-01-01T00:00:00+00:00",
        finished_at="2026-01-01T00:05:00+00:00",
        duration_seconds=300.0,
        health_check_passed=False,
        metrics_snapshot={"error_rate": 0.05, "latency_p99_ms": 2500.0},
        error="timeout",
    )
    assert result.duration_seconds == 300.0
    assert result.metrics_snapshot["error_rate"] == 0.05
    assert result.error == "timeout"


# ──────────────────────────────────────────────────────────────────────────
# 3. CanaryExecution 字段
# ──────────────────────────────────────────────────────────────────────────


def test_canary_execution_default_fields():
    """验证 CanaryExecution 默认字段值."""
    execution = CanaryExecution(deployment_name="test-deploy")
    assert execution.deployment_name == "test-deploy"
    assert execution.state == CanaryExecutionState.PENDING
    assert execution.current_stage_index == -1
    assert execution.stages_results == []
    assert execution.started_at == ""
    assert execution.finished_at == ""
    assert execution.total_duration_seconds == 0.0
    assert execution.auto_rollback_triggered is False
    assert execution.rollback_reason == ""
    assert execution.metadata == {}


def test_canary_execution_custom_state():
    """验证 CanaryExecution 可设置 state."""
    execution = CanaryExecution(
        deployment_name="test-deploy",
        state=CanaryExecutionState.RUNNING,
        current_stage_index=1,
        started_at="2026-01-01T00:00:00+00:00",
    )
    assert execution.state == CanaryExecutionState.RUNNING
    assert execution.current_stage_index == 1


def test_canary_execution_with_stage_results():
    """验证 CanaryExecution 可携带阶段结果."""
    stage = CanaryStageResult(
        stage_index=0, percentage=10, state="succeeded", started_at="t"
    )
    execution = CanaryExecution(
        deployment_name="test-deploy",
        stages_results=[stage],
        auto_rollback_triggered=True,
        rollback_reason="manual",
        metadata={"env": "staging"},
    )
    assert len(execution.stages_results) == 1
    assert execution.stages_results[0].percentage == 10
    assert execution.auto_rollback_triggered is True
    assert execution.rollback_reason == "manual"
    assert execution.metadata["env"] == "staging"


# ──────────────────────────────────────────────────────────────────────────
# 4. HealthCheckResult 字段
# ──────────────────────────────────────────────────────────────────────────


def test_health_check_result_required_passed():
    """验证 HealthCheckResult 必填 passed 字段."""
    result = HealthCheckResult(passed=True)
    assert result.passed is True


def test_health_check_result_default_fields():
    """验证 HealthCheckResult 默认字段值."""
    result = HealthCheckResult(passed=False)
    assert result.status_code == 0
    assert result.response_time_ms == 0.0
    assert result.error_rate == 0.0
    assert result.latency_p99_ms == 0.0
    assert result.details == {}
    assert result.error == ""


def test_health_check_result_custom_fields():
    """验证 HealthCheckResult 自定义字段."""
    result = HealthCheckResult(
        passed=False,
        status_code=500,
        response_time_ms=123.4,
        error_rate=0.05,
        latency_p99_ms=3000.0,
        details={"upstream": "db"},
        error="internal error",
    )
    assert result.status_code == 500
    assert result.response_time_ms == 123.4
    assert result.error_rate == 0.05
    assert result.latency_p99_ms == 3000.0
    assert result.details == {"upstream": "db"}
    assert result.error == "internal error"


# ──────────────────────────────────────────────────────────────────────────
# 5. CanaryExecutor 初始化
# ──────────────────────────────────────────────────────────────────────────


def test_canary_executor_init_default():
    """验证 CanaryExecutor 仅 registry 必填，其余依赖可选."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    assert executor._registry is registry
    assert executor._metrics_collector is None
    assert executor._event_bus is None
    assert executor._http_client is None
    assert executor._executions == {}
    assert executor._history == []


def test_canary_executor_init_with_all_deps():
    """验证 CanaryExecutor 接受所有依赖注入."""
    registry = _make_registry()
    metrics_collector = _make_mock_metrics_collector()
    event_bus = EventBus()
    http_client = _make_mock_http_client()
    custom_logger = MagicMock()
    executor = CanaryExecutor(
        registry,
        metrics_collector=metrics_collector,
        event_bus=event_bus,
        http_client=http_client,
        logger=custom_logger,
    )
    assert executor._metrics_collector is metrics_collector
    assert executor._event_bus is event_bus
    assert executor._http_client is http_client
    assert executor._logger is custom_logger


def test_canary_executor_init_does_not_touch_registry():
    """验证初始化不读取 / 修改 registry（仅保存引用，遵循 DI）."""
    registry = _make_registry()
    initial_keys = list(registry.list_deployments())
    CanaryExecutor(registry)
    assert registry.list_deployments() == initial_keys


# ──────────────────────────────────────────────────────────────────────────
# 6. execute() 全流程
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_execute_success_all_stages():
    """验证 execute 全部 3 阶段成功 → SUCCEEDED."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    result = await executor.execute("test-deploy")
    assert result.state == CanaryExecutionState.SUCCEEDED
    assert result.deployment_name == "test-deploy"
    assert len(result.stages_results) == 3
    assert result.current_stage_index == 2
    assert all(r.health_check_passed for r in result.stages_results)
    assert result.finished_at != ""
    assert result.total_duration_seconds >= 0.0


@pytest.mark.asyncio
async def test_execute_first_stage_failure_autorollback():
    """验证第一阶段健康检查失败 → 自动回滚."""
    stages = [
        _make_stage_dict(percentage=10, health_check_url="http://x/health"),
        _make_stage_dict(percentage=50, health_check_url="http://x/health"),
        _make_stage_dict(percentage=100, health_check_url="http://x/health"),
    ]
    registry = _make_registry(_make_config_dict(stages=stages, auto_rollback=True))
    bad_response = _make_mock_response(status_code=500)
    http_client = _make_mock_http_client(bad_response)
    executor = CanaryExecutor(registry, http_client=http_client)

    result = await executor.execute("test-deploy")

    assert result.state == CanaryExecutionState.ROLLED_BACK
    assert result.auto_rollback_triggered is True
    assert "stage 0" in result.rollback_reason
    assert len(result.stages_results) == 1
    assert result.stages_results[0].health_check_passed is False


@pytest.mark.asyncio
async def test_execute_second_stage_failure_autorollback():
    """验证第二阶段失败（第一阶段已成功）→ 自动回滚."""
    # 第一阶段返回 200，第二阶段返回 500
    good = _make_mock_response(status_code=200, body={"error_rate": 0.0, "latency_p99_ms": 100})
    bad = _make_mock_response(status_code=500)
    http_client = MagicMock()
    http_client.get = AsyncMock(side_effect=[good, bad])

    stages = [
        _make_stage_dict(percentage=10, health_check_url="http://x/health"),
        _make_stage_dict(percentage=50, health_check_url="http://x/health"),
        _make_stage_dict(percentage=100, health_check_url="http://x/health"),
    ]
    registry = _make_registry(_make_config_dict(stages=stages, auto_rollback=True))
    executor = CanaryExecutor(registry, http_client=http_client)

    result = await executor.execute("test-deploy")

    assert result.state == CanaryExecutionState.ROLLED_BACK
    assert result.auto_rollback_triggered is True
    assert "stage 1" in result.rollback_reason
    assert len(result.stages_results) == 2
    assert result.stages_results[0].health_check_passed is True
    assert result.stages_results[1].health_check_passed is False
    assert result.current_stage_index == 1


@pytest.mark.asyncio
async def test_execute_third_stage_failure_autorollback():
    """验证第三阶段失败 → 自动回滚（前两阶段已成功）."""
    good = _make_mock_response(status_code=200, body={"error_rate": 0.0, "latency_p99_ms": 100})
    bad = _make_mock_response(status_code=500)
    http_client = MagicMock()
    http_client.get = AsyncMock(side_effect=[good, good, bad])

    stages = [
        _make_stage_dict(percentage=10, health_check_url="http://x/h"),
        _make_stage_dict(percentage=50, health_check_url="http://x/h"),
        _make_stage_dict(percentage=100, health_check_url="http://x/h"),
    ]
    registry = _make_registry(_make_config_dict(stages=stages))
    executor = CanaryExecutor(registry, http_client=http_client)

    result = await executor.execute("test-deploy")

    assert result.state == CanaryExecutionState.ROLLED_BACK
    assert len(result.stages_results) == 3
    assert result.stages_results[0].health_check_passed is True
    assert result.stages_results[1].health_check_passed is True
    assert result.stages_results[2].health_check_passed is False
    assert result.current_stage_index == 2


@pytest.mark.asyncio
async def test_execute_auto_rollback_disabled_failed():
    """验证 auto_rollback=False 时健康检查失败 → FAILED（不回滚）."""
    stages = [_make_stage_dict(percentage=10, health_check_url="http://x/h")]
    registry = _make_registry(_make_config_dict(stages=stages, auto_rollback=False))
    bad_response = _make_mock_response(status_code=500)
    http_client = _make_mock_http_client(bad_response)
    executor = CanaryExecutor(registry, http_client=http_client)

    result = await executor.execute("test-deploy")

    assert result.state == CanaryExecutionState.FAILED
    assert result.auto_rollback_triggered is False
    assert result.rollback_reason == ""


@pytest.mark.asyncio
async def test_execute_no_traffic_router_succeeds():
    """验证 traffic_router=None 时仍可成功执行."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    result = await executor.execute("test-deploy", traffic_router=None)
    assert result.state == CanaryExecutionState.SUCCEEDED


@pytest.mark.asyncio
async def test_execute_config_not_found_raises():
    """验证配置不存在时 execute 抛出 KeyError."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    with pytest.raises(KeyError, match="not-found"):
        await executor.execute("not-found")


@pytest.mark.asyncio
async def test_execute_already_succeeded_starts_new():
    """验证对已 SUCCEEDED 的部署再次 execute 会创建新执行."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)

    first = await executor.execute("test-deploy")
    assert first.state == CanaryExecutionState.SUCCEEDED
    first_started = first.started_at

    # 模拟时间间隔（_now_iso 调用两次必然不同）
    second = await executor.execute("test-deploy")
    assert second.state == CanaryExecutionState.SUCCEEDED
    # 新执行应具有新的 started_at
    assert second.started_at != first_started


# ──────────────────────────────────────────────────────────────────────────
# 7. execute() 暂停 + 恢复
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_execute_pause_and_resume():
    """验证 execute 在阶段间暂停后恢复可继续完成."""
    registry = _make_registry(_make_config_dict(observation_seconds=0))
    executor = CanaryExecutor(registry)

    # 预创建 execution 并设置暂停标志
    execution = CanaryExecution(
        deployment_name="test-deploy",
        state=CanaryExecutionState.PENDING,
    )
    executor._executions["test-deploy"] = execution
    paused_ok = await executor.pause_execution("test-deploy")
    assert paused_ok is True

    # 启动 execute 作为后台任务
    task = asyncio.create_task(executor.execute("test-deploy"))

    # 等待 execute 进入暂停态
    await asyncio.sleep(0.05)
    assert not task.done()
    current = executor.get_execution("test-deploy")
    assert current.state == CanaryExecutionState.PAUSED

    # 恢复
    resumed_ok = await executor.resume_execution("test-deploy")
    assert resumed_ok is True

    # 等待 execute 完成
    result = await task
    assert result.state == CanaryExecutionState.SUCCEEDED
    assert len(result.stages_results) == 3


@pytest.mark.asyncio
async def test_execute_pause_emits_pause_and_resume_events():
    """验证暂停/恢复会发出对应事件."""
    event_bus = EventBus()
    received: list[dict[str, Any]] = []
    event_bus.subscribe("*", lambda e: received.append(e))

    registry = _make_registry(_make_config_dict(observation_seconds=0))
    executor = CanaryExecutor(registry, event_bus=event_bus)

    execution = CanaryExecution(
        deployment_name="test-deploy", state=CanaryExecutionState.PENDING
    )
    executor._executions["test-deploy"] = execution
    await executor.pause_execution("test-deploy")

    task = asyncio.create_task(executor.execute("test-deploy"))
    await asyncio.sleep(0.05)
    await executor.resume_execution("test-deploy")
    await task

    event_types = [e["type"] for e in received]
    assert CANARY_EVENT_EXECUTION_PAUSED in event_types
    assert CANARY_EVENT_EXECUTION_RESUMED in event_types
    assert CANARY_EVENT_EXECUTION_SUCCEEDED in event_types


# ──────────────────────────────────────────────────────────────────────────
# 8. _execute_stage 行为
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_execute_stage_calls_traffic_router_with_percentage():
    """验证 _execute_stage 会按阶段 percentage 调用 traffic_router."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    execution = CanaryExecution(deployment_name="test-deploy")

    calls: list[int] = []

    def router(percentage: int) -> None:
        calls.append(percentage)

    result = await executor._execute_stage(execution, 0, router)
    assert calls == [10]
    assert result.percentage == 10
    assert result.health_check_passed is True


@pytest.mark.asyncio
async def test_execute_stage_supports_async_traffic_router():
    """验证 _execute_stage 支持异步 traffic_router."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    execution = CanaryExecution(deployment_name="test-deploy")

    calls: list[int] = []

    async def router(percentage: int) -> None:
        calls.append(percentage)

    result = await executor._execute_stage(execution, 1, router)
    assert calls == [50]
    assert result.percentage == 50


@pytest.mark.asyncio
async def test_execute_stage_no_wait_when_observation_zero():
    """验证 observation_seconds=0 时不会 sleep（快速返回）."""
    registry = _make_registry(_make_config_dict(observation_seconds=0))
    executor = CanaryExecutor(registry)
    execution = CanaryExecution(deployment_name="test-deploy")
    import time

    start = time.monotonic()
    await executor._execute_stage(execution, 0, None)
    elapsed = time.monotonic() - start
    # 应在 1 秒内完成（实际通常 <0.05s）
    assert elapsed < 1.0


@pytest.mark.asyncio
async def test_execute_stage_waits_observation_seconds(monkeypatch):
    """验证 observation_seconds>0 时会调用 asyncio.sleep."""
    registry = _make_registry(_make_config_dict(observation_seconds=42))
    executor = CanaryExecutor(registry)
    execution = CanaryExecution(deployment_name="test-deploy")

    sleep_calls: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    await executor._execute_stage(execution, 0, None)
    assert 42.0 in sleep_calls


@pytest.mark.asyncio
async def test_execute_stage_records_metrics_snapshot():
    """验证 _execute_stage 在 metrics_snapshot 中记录健康检查指标."""
    good = _make_mock_response(
        status_code=200, body={"error_rate": 0.002, "latency_p99_ms": 150.0}
    )
    http_client = _make_mock_http_client(good)
    stages = [_make_stage_dict(percentage=10, health_check_url="http://x/h")]
    registry = _make_registry(_make_config_dict(stages=stages))
    executor = CanaryExecutor(registry, http_client=http_client)
    execution = CanaryExecution(deployment_name="test-deploy")

    result = await executor._execute_stage(execution, 0, None)
    assert result.metrics_snapshot["error_rate"] == 0.002
    assert result.metrics_snapshot["latency_p99_ms"] == 150.0
    assert result.metrics_snapshot["status_code"] == 200


# ──────────────────────────────────────────────────────────────────────────
# 9. _health_check 行为
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_health_check_success_status_200():
    """验证状态码 200 → 健康检查通过."""
    response = _make_mock_response(200, body={"error_rate": 0.0, "latency_p99_ms": 100.0})
    http_client = _make_mock_http_client(response)
    executor = CanaryExecutor(_make_registry(), http_client=http_client)
    stage = CanaryStageConfig(percentage=10, health_check_url="http://x/h")
    result = await executor._health_check(stage)
    assert result.passed is True
    assert result.status_code == 200
    assert result.error == ""


@pytest.mark.asyncio
async def test_health_check_failure_status_500():
    """验证状态码 500 → 健康检查失败."""
    response = _make_mock_response(500)
    http_client = _make_mock_http_client(response)
    executor = CanaryExecutor(_make_registry(), http_client=http_client)
    stage = CanaryStageConfig(percentage=10, health_check_url="http://x/h")
    result = await executor._health_check(stage)
    assert result.passed is False
    assert "500" in result.error


@pytest.mark.asyncio
async def test_health_check_failure_timeout():
    """验证请求超时 → 健康检查失败."""
    http_client = _make_mock_http_client(exc=asyncio.TimeoutError("timeout"))
    executor = CanaryExecutor(_make_registry(), http_client=http_client)
    stage = CanaryStageConfig(percentage=10, health_check_url="http://x/h")
    result = await executor._health_check(stage)
    assert result.passed is False
    assert "timeout" in result.error.lower() or "health check request failed" in result.error.lower()


@pytest.mark.asyncio
async def test_health_check_failure_connection_error():
    """验证连接异常 → 健康检查失败."""
    http_client = _make_mock_http_client(exc=ConnectionError("refused"))
    executor = CanaryExecutor(_make_registry(), http_client=http_client)
    stage = CanaryStageConfig(percentage=10, health_check_url="http://x/h")
    result = await executor._health_check(stage)
    assert result.passed is False
    assert "refused" in result.error


@pytest.mark.asyncio
async def test_health_check_failure_error_rate_exceeds():
    """验证 error_rate 超阈值 → 健康检查失败."""
    response = _make_mock_response(
        200, body={"error_rate": 0.5, "latency_p99_ms": 100.0}
    )
    http_client = _make_mock_http_client(response)
    executor = CanaryExecutor(_make_registry(), http_client=http_client)
    stage = CanaryStageConfig(
        percentage=10,
        health_check_url="http://x/h",
        error_rate_threshold=0.01,
    )
    result = await executor._health_check(stage)
    assert result.passed is False
    assert "error_rate" in result.error


@pytest.mark.asyncio
async def test_health_check_failure_latency_exceeds():
    """验证 latency_p99 超阈值 → 健康检查失败."""
    response = _make_mock_response(
        200, body={"error_rate": 0.0, "latency_p99_ms": 5000.0}
    )
    http_client = _make_mock_http_client(response)
    executor = CanaryExecutor(_make_registry(), http_client=http_client)
    stage = CanaryStageConfig(
        percentage=10,
        health_check_url="http://x/h",
        latency_p99_threshold_ms=2000,
    )
    result = await executor._health_check(stage)
    assert result.passed is False
    assert "latency_p99" in result.error


@pytest.mark.asyncio
async def test_health_check_no_url_passes():
    """验证未配置 health_check_url → 健康检查直接通过."""
    executor = CanaryExecutor(_make_registry())
    stage = CanaryStageConfig(percentage=10, health_check_url=None)
    result = await executor._health_check(stage)
    assert result.passed is True
    assert result.status_code == 0


@pytest.mark.asyncio
async def test_health_check_uses_metrics_collector_when_no_body():
    """验证响应体未提供指标时从 metrics_collector 读取."""
    response = _make_mock_response(200, body={})
    http_client = _make_mock_http_client(response)
    metrics_collector = _make_mock_metrics_collector(
        {"error_rate": 0.001, "latency_p99_ms": 100.0}
    )
    executor = CanaryExecutor(
        _make_registry(),
        http_client=http_client,
        metrics_collector=metrics_collector,
    )
    stage = CanaryStageConfig(percentage=10, health_check_url="http://x/h")
    result = await executor._health_check(stage)
    assert result.passed is True
    assert result.error_rate == 0.001
    assert result.latency_p99_ms == 100.0


@pytest.mark.asyncio
async def test_health_check_parses_json_body():
    """验证健康检查能解析 JSON 响应体中的指标."""
    response = _make_mock_response(
        200, body={"error_rate": 0.005, "latency_p99_ms": 250.0, "extra": "info"}
    )
    http_client = _make_mock_http_client(response)
    executor = CanaryExecutor(_make_registry(), http_client=http_client)
    stage = CanaryStageConfig(percentage=10, health_check_url="http://x/h")
    result = await executor._health_check(stage)
    assert result.error_rate == 0.005
    assert result.latency_p99_ms == 250.0
    assert result.details.get("extra") == "info"


# ──────────────────────────────────────────────────────────────────────────
# 10. _rollback 行为
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rollback_resets_traffic_to_zero():
    """验证 _rollback 会调用 traffic_router(0)."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    execution = CanaryExecution(deployment_name="test-deploy")

    calls: list[int] = []

    def router(percentage: int) -> None:
        calls.append(percentage)

    executor._traffic_routers["test-deploy"] = router
    await executor._rollback(execution, reason="test")
    assert 0 in calls


@pytest.mark.asyncio
async def test_rollback_updates_state_and_reason():
    """验证 _rollback 更新 state / auto_rollback_triggered / rollback_reason."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    execution = CanaryExecution(deployment_name="test-deploy")
    updated = await executor._rollback(execution, reason="health check failed")
    assert updated.state == CanaryExecutionState.ROLLED_BACK
    assert updated.auto_rollback_triggered is True
    assert updated.rollback_reason == "health check failed"


@pytest.mark.asyncio
async def test_rollback_without_traffic_router_does_not_raise():
    """验证未注册 traffic_router 时 _rollback 不会抛错."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    execution = CanaryExecution(deployment_name="test-deploy")
    # 不注册 traffic_router
    updated = await executor._rollback(execution, reason="manual")
    assert updated.state == CanaryExecutionState.ROLLED_BACK


# ──────────────────────────────────────────────────────────────────────────
# 11. pause / resume
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_pause_execution_returns_true_for_existing():
    """验证对已存在的执行 pause 返回 True."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    execution = CanaryExecution(deployment_name="test-deploy", state=CanaryExecutionState.RUNNING)
    executor._executions["test-deploy"] = execution
    assert await executor.pause_execution("test-deploy") is True
    assert execution.state == CanaryExecutionState.PAUSED


@pytest.mark.asyncio
async def test_pause_execution_not_found_returns_false():
    """验证对不存在的执行 pause 返回 False."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    assert await executor.pause_execution("not-exist") is False


@pytest.mark.asyncio
async def test_resume_execution_returns_true_for_paused():
    """验证对 PAUSED 状态的执行 resume 返回 True 并恢复 RUNNING."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    execution = CanaryExecution(
        deployment_name="test-deploy", state=CanaryExecutionState.PAUSED
    )
    executor._executions["test-deploy"] = execution
    executor._paused_flags["test-deploy"] = True
    evt = asyncio.Event()
    evt.clear()
    executor._pause_events["test-deploy"] = evt

    assert await executor.resume_execution("test-deploy") is True
    assert execution.state == CanaryExecutionState.RUNNING
    assert evt.is_set() is True
    assert executor._paused_flags["test-deploy"] is False


@pytest.mark.asyncio
async def test_resume_execution_not_found_returns_false():
    """验证对不存在的执行 resume 返回 False."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    assert await executor.resume_execution("not-exist") is False


# ──────────────────────────────────────────────────────────────────────────
# 12. get / list / history
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_execution_returns_current():
    """验证 get_execution 返回当前执行."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    await executor.execute("test-deploy")
    execution = executor.get_execution("test-deploy")
    assert execution is not None
    assert execution.deployment_name == "test-deploy"
    assert execution.state == CanaryExecutionState.SUCCEEDED


def test_get_execution_not_found_returns_none():
    """验证 get_execution 对不存在的部署返回 None."""
    executor = CanaryExecutor(_make_registry())
    assert executor.get_execution("not-exist") is None


@pytest.mark.asyncio
async def test_list_executions_returns_all():
    """验证 list_executions 返回所有执行."""
    registry = _make_multi_registry("deploy-a", "deploy-b")
    executor = CanaryExecutor(registry)
    await executor.execute("deploy-a")
    await executor.execute("deploy-b")
    listing = executor.list_executions()
    assert set(listing.keys()) == {"deploy-a", "deploy-b"}


def test_list_executions_empty():
    """验证无执行时 list_executions 返回空字典."""
    executor = CanaryExecutor(_make_registry())
    assert executor.list_executions() == {}


@pytest.mark.asyncio
async def test_get_execution_history_no_filter():
    """验证 get_execution_history 不带过滤返回所有历史."""
    registry = _make_multi_registry("deploy-a", "deploy-b")
    executor = CanaryExecutor(registry)
    await executor.execute("deploy-a")
    await executor.execute("deploy-b")
    history = executor.get_execution_history()
    assert len(history) == 2
    names = {h.deployment_name for h in history}
    assert names == {"deploy-a", "deploy-b"}


@pytest.mark.asyncio
async def test_get_execution_history_with_filter():
    """验证 get_execution_history 按部署名过滤."""
    registry = _make_multi_registry("deploy-a", "deploy-b")
    executor = CanaryExecutor(registry)
    await executor.execute("deploy-a")
    await executor.execute("deploy-b")
    history = executor.get_execution_history(deployment_name="deploy-a")
    assert len(history) == 1
    assert history[0].deployment_name == "deploy-a"


@pytest.mark.asyncio
async def test_get_execution_history_with_limit():
    """验证 get_execution_history 受 limit 限制."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    # 同一部署多次 execute 会产生多条历史
    for _ in range(5):
        await executor.execute("test-deploy")
    history = executor.get_execution_history(limit=3)
    assert len(history) == 3


# ──────────────────────────────────────────────────────────────────────────
# 13. metrics_collector 集成
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_metrics_collector_records_stage_duration_and_total():
    """验证每阶段会上报 stage_duration / stage_total / error_rate / latency."""
    registry = _make_registry()
    metrics_collector = _make_mock_metrics_collector()
    executor = CanaryExecutor(registry, metrics_collector=metrics_collector)
    await executor.execute("test-deploy")

    # observe_histogram 至少调用 3 次（每阶段 1 次 stage_duration）
    assert metrics_collector.observe_histogram.call_count >= 3
    # inc_counter 至少调用 3 次（每阶段 1 次 stage_total）
    assert metrics_collector.inc_counter.call_count >= 3
    # set_gauge 至少 6 次（每阶段 error_rate + latency_p99）
    assert metrics_collector.set_gauge.call_count >= 6


@pytest.mark.asyncio
async def test_metrics_collector_records_correct_metric_names():
    """验证 metrics_collector 被调用时使用正确的指标名."""
    registry = _make_registry()
    metrics_collector = _make_mock_metrics_collector()
    executor = CanaryExecutor(registry, metrics_collector=metrics_collector)
    await executor.execute("test-deploy")

    observed_names = {
        call.args[0] if call.args else call.kwargs.get("name", "")
        for call in metrics_collector.observe_histogram.call_args_list
    }
    assert CANARY_METRIC_STAGE_DURATION in observed_names

    counter_names = {
        call.args[0] if call.args else call.kwargs.get("name", "")
        for call in metrics_collector.inc_counter.call_args_list
    }
    assert CANARY_METRIC_STAGE_TOTAL in counter_names

    gauge_names = {
        call.args[0] if call.args else call.kwargs.get("name", "")
        for call in metrics_collector.set_gauge.call_args_list
    }
    assert CANARY_METRIC_ERROR_RATE in gauge_names
    assert CANARY_METRIC_LATENCY_P99 in gauge_names


@pytest.mark.asyncio
async def test_metrics_collector_records_rollback_on_failure():
    """验证自动回滚时上报 rollback_total 指标."""
    stages = [_make_stage_dict(percentage=10, health_check_url="http://x/h")]
    registry = _make_registry(_make_config_dict(stages=stages, auto_rollback=True))
    bad_response = _make_mock_response(status_code=500)
    http_client = _make_mock_http_client(bad_response)
    metrics_collector = _make_mock_metrics_collector()
    executor = CanaryExecutor(
        registry, http_client=http_client, metrics_collector=metrics_collector
    )
    await executor.execute("test-deploy")

    counter_names = [
        call.args[0] if call.args else call.kwargs.get("name", "")
        for call in metrics_collector.inc_counter.call_args_list
    ]
    assert CANARY_METRIC_ROLLBACK_TOTAL in counter_names


# ──────────────────────────────────────────────────────────────────────────
# 14. event_bus 事件发出
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_event_bus_emits_execution_started_and_succeeded():
    """验证 execute 发出 execution.started 与 execution.succeeded 事件."""
    event_bus = EventBus()
    received: list[dict[str, Any]] = []
    event_bus.subscribe("*", lambda e: received.append(e))
    executor = CanaryExecutor(_make_registry(), event_bus=event_bus)

    await executor.execute("test-deploy")

    types = [e["type"] for e in received]
    assert CANARY_EVENT_EXECUTION_STARTED in types
    assert CANARY_EVENT_EXECUTION_SUCCEEDED in types


@pytest.mark.asyncio
async def test_event_bus_emits_stage_started_and_completed():
    """验证每阶段发出 stage.started 与 stage.completed 事件."""
    event_bus = EventBus()
    received: list[dict[str, Any]] = []
    event_bus.subscribe("*", lambda e: received.append(e))
    executor = CanaryExecutor(_make_registry(), event_bus=event_bus)

    await executor.execute("test-deploy")

    started = [e for e in received if e["type"] == CANARY_EVENT_STAGE_STARTED]
    completed = [e for e in received if e["type"] == CANARY_EVENT_STAGE_COMPLETED]
    assert len(started) == 3
    assert len(completed) == 3
    # 验证 stage.started payload 包含 percentage
    assert started[0]["payload"]["percentage"] == 10
    assert started[1]["payload"]["percentage"] == 50
    assert started[2]["payload"]["percentage"] == 100


@pytest.mark.asyncio
async def test_event_bus_emits_rollback_on_failure():
    """验证自动回滚时发出 execution.rolled_back 事件."""
    event_bus = EventBus()
    received: list[dict[str, Any]] = []
    event_bus.subscribe("*", lambda e: received.append(e))
    stages = [_make_stage_dict(percentage=10, health_check_url="http://x/h")]
    registry = _make_registry(_make_config_dict(stages=stages, auto_rollback=True))
    bad_response = _make_mock_response(status_code=500)
    http_client = _make_mock_http_client(bad_response)
    executor = CanaryExecutor(registry, event_bus=event_bus, http_client=http_client)

    await executor.execute("test-deploy")

    types = [e["type"] for e in received]
    assert CANARY_EVENT_EXECUTION_ROLLED_BACK in types
    # 同时应有 stage.failed 事件
    assert CANARY_EVENT_STAGE_FAILED in types or any(
        e["type"] == CANARY_EVENT_STAGE_COMPLETED
        and not e["payload"].get("health_check_passed", True)
        for e in received
    )


@pytest.mark.asyncio
async def test_event_bus_emits_failed_when_auto_rollback_disabled():
    """验证 auto_rollback=False 失败时发出 execution.failed 事件."""
    event_bus = EventBus()
    received: list[dict[str, Any]] = []
    event_bus.subscribe("*", lambda e: received.append(e))
    stages = [_make_stage_dict(percentage=10, health_check_url="http://x/h")]
    registry = _make_registry(_make_config_dict(stages=stages, auto_rollback=False))
    bad_response = _make_mock_response(status_code=500)
    http_client = _make_mock_http_client(bad_response)
    executor = CanaryExecutor(registry, event_bus=event_bus, http_client=http_client)

    await executor.execute("test-deploy")

    types = [e["type"] for e in received]
    assert CANARY_EVENT_EXECUTION_FAILED in types
    assert CANARY_EVENT_EXECUTION_ROLLED_BACK not in types


# ──────────────────────────────────────────────────────────────────────────
# 15. traffic_router 回调
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_traffic_router_called_with_each_stage_percentage():
    """验证 traffic_router 被每个阶段以对应 percentage 调用."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    calls: list[int] = []

    def router(percentage: int) -> None:
        calls.append(percentage)

    await executor.execute("test-deploy", traffic_router=router)
    assert calls == [10, 50, 100]


@pytest.mark.asyncio
async def test_traffic_router_called_with_zero_on_rollback():
    """验证自动回滚时 traffic_router(0) 被调用."""
    stages = [
        _make_stage_dict(percentage=10, health_check_url="http://x/h"),
        _make_stage_dict(percentage=50, health_check_url="http://x/h"),
    ]
    registry = _make_registry(_make_config_dict(stages=stages, auto_rollback=True))
    bad_response = _make_mock_response(status_code=500)
    http_client = _make_mock_http_client(bad_response)
    executor = CanaryExecutor(registry, http_client=http_client)

    calls: list[int] = []

    def router(percentage: int) -> None:
        calls.append(percentage)

    await executor.execute("test-deploy", traffic_router=router)
    # 第一阶段失败 → 应有 [10, 0]
    assert calls == [10, 0]


@pytest.mark.asyncio
async def test_traffic_router_async_callback_supported():
    """验证 traffic_router 异步回调被正确 await."""
    registry = _make_registry()
    executor = CanaryExecutor(registry)
    calls: list[int] = []

    async def router(percentage: int) -> None:
        await asyncio.sleep(0)
        calls.append(percentage)

    result = await executor.execute("test-deploy", traffic_router=router)
    assert result.state == CanaryExecutionState.SUCCEEDED
    assert calls == [10, 50, 100]


# ──────────────────────────────────────────────────────────────────────────
# 16. 配置加载与 example 一致性
# ──────────────────────────────────────────────────────────────────────────


def test_canary_yaml_example_loads_into_registry(tmp_path):
    """验证 canary.yaml.example 拆分为单文档后能被 registry 加载."""
    import yaml

    example_path = (
        pytest.importorskip("flowforge").__file__
    )
    from pathlib import Path

    config_example = (
        Path(example_path).parent / "config" / "canary.yaml.example"
    )
    if not config_example.exists():
        pytest.skip("canary.yaml.example 不存在")

    # 多文档拆分，每文档写入单独文件
    docs = list(yaml.safe_load_all(config_example.read_text(encoding="utf-8")))
    docs = [d for d in docs if d]
    assert len(docs) == 2

    for doc in docs:
        assert "name" in doc
        assert "stages" in doc
        assert len(doc["stages"]) == 3
        # 写入临时目录
        (tmp_path / f"{doc['name']}.yaml").write_text(
            yaml.safe_dump(doc, allow_unicode=True), encoding="utf-8"
        )

    registry = CanaryDeploymentRegistry()
    count = registry.load_from_dir(str(tmp_path))
    assert count == 2
    assert "contentforge-publish" in registry.list_deployments()
    assert "devforge-deploy" in registry.list_deployments()


# ──────────────────────────────────────────────────────────────────────────
# 17. 既有 CanaryDeploymentRegistry / CanaryStageConfig / CanaryDeploymentConfig 接口保持兼容
# ──────────────────────────────────────────────────────────────────────────


def test_existing_canary_stage_config_still_works():
    """验证既有 CanaryStageConfig 接口未被破坏."""
    stage = CanaryStageConfig(percentage=20, duration_seconds=60)
    assert stage.percentage == 20
    assert stage.duration_seconds == 60
    assert stage.success_threshold == 0.99


def test_existing_canary_deployment_config_still_works():
    """验证既有 CanaryDeploymentConfig 接口未被破坏."""
    config = CanaryDeploymentConfig(name="legacy")
    assert config.name == "legacy"
    assert config.auto_rollback is True
    assert len(config.stages) == 3


def test_existing_registry_register_and_get_still_works():
    """验证既有 Registry register/get/list_deployments/get_all 未被破坏.

    register 的 dict 用法：name 单独传，dict 内不含 'name' 字段
    （与 load_from_dir 中 YAML 必须含 'name' 不同）。
    """
    registry = CanaryDeploymentRegistry()
    # dict 形式：name 单独传，dict 不含 'name'
    registry.register("legacy", {"description": "old"})
    assert "legacy" in registry.list_deployments()
    assert registry.get("legacy").description == "old"
    assert registry.get("legacy").name == "legacy"
    assert "legacy" in registry.get_all()
    # CanaryDeploymentConfig 形式
    config = CanaryDeploymentConfig(name="another", description="cfg")
    registry.register("another", config)
    assert "another" in registry.list_deployments()
    assert registry.get("another").description == "cfg"
