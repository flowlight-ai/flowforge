"""FlowForgeScheduler 单元测试（P3-010）.

测试覆盖:
    - ScheduledTaskConfig 字段默认值与校验
    - TaskExecutionResult 字段
    - TaskRegistry register/unregister/get/list
    - FlowForgeScheduler 初始化（不启动真实 AsyncIOScheduler）
    - load_configs_from_dir 加载 YAML
    - register_task / unregister_task / pause_task / resume_task
    - _execute_task 执行成功 / 失败重试 / 超时
    - metrics_collector 集成
    - event_bus 集成
    - 执行历史记录
    - 内置任务处理函数（daily_quota_reset / metrics_summary_report /
      health_check / cleanup_expired_events）

测试铁律遵守（project_rules.md T1-T8）:
    - T1: 禁止使用 Mock LLM —— 本模块不涉及 LLM（单元测试）
    - T2: 禁止使用假数据 —— 测试输入使用真实场景数据（contentforge 早间发布 /
          devforge 代码审查 / quota_manager / approval_hub 等）
    - T3: 禁止跳过验证 —— 每个用例都有具体断言
    - T4: 禁止 Mock 工具 —— 本测试不调用外部工具
    - T5: 未实现即 Bug —— 本测试覆盖所有声明的功能
    - T6: E2E 测试需采集指标 —— 本测试为单元测试，不适用
    - T7: LLM 内容审核 —— 本测试不涉及 LLM 内容
    - T8: Web 功能 DOM 验证 —— 本测试不涉及 Web

时间依赖处理:
    - 不依赖真实时间，使用 mock 替换 `_perf_counter` 控制时长断言
    - 测试中重试延迟设为 0，避免真实 sleep

AsyncIOScheduler 处理:
    - 不启动真实 AsyncIOScheduler，仅测试内部逻辑
    - add_job / pause_job / resume_job / remove_job 在未启动状态下
      可操作 jobstore，故无需 Mock
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import yaml

from flowforge.core.scheduler import (
    FlowForgeScheduler,
    ScheduledTaskConfig,
    TaskExecutionResult,
    TaskRegistry,
    cleanup_expired_events,
    create_default_registry,
    daily_quota_reset,
    health_check,
    metrics_summary_report,
)
from flowforge.events.event_bus import EventBus
from flowforge.observability.metrics_collector import MetricsCollector


# ─────────────────────────────────────────────────────────────────
# 测试数据：真实场景 YAML（contentforge / devforge）
# ─────────────────────────────────────────────────────────────────

SCHEDULER_YAML_CONTENT = """\
tasks:
  - name: daily_quota_reset
    description: "每日凌晨重置 Provider 配额"
    enabled: true
    trigger_type: cron
    trigger_args:
      hour: 2
      minute: 0
    task_handler: daily_quota_reset
    timeout_seconds: 120
    metadata:
      category: builtin
      owner: system
  - name: hourly_metrics_summary
    description: "每小时生成指标摘要"
    enabled: true
    trigger_type: interval
    trigger_args:
      minutes: 60
    task_handler: metrics_summary_report
    metadata:
      category: builtin
"""

MULTI_FILE_YAML_CONTENT_2 = """\
tasks:
  - name: devforge_code_review_scheduler
    description: "DevForge 每日 09:00 代码审查调度"
    enabled: false
    trigger_type: cron
    trigger_args:
      hour: 9
      minute: 0
    task_handler: devforge_code_review
    metadata:
      category: devforge
      owner: operator_001
"""


# ─────────────────────────────────────────────────────────────────
# 通用夹具
# ─────────────────────────────────────────────────────────────────


@pytest.fixture
def metrics() -> MetricsCollector:
    """真实的 MetricsCollector（in-memory）。"""
    return MetricsCollector()


@pytest.fixture
def event_bus() -> EventBus:
    """真实的 EventBus（in-memory）。"""
    return EventBus()


@pytest.fixture
def scheduler(metrics, event_bus) -> FlowForgeScheduler:
    """未启动的 FlowForgeScheduler（注入 metrics_collector 与 event_bus）。

    测试结束后调用 shutdown 以释放底层 AsyncIOScheduler 资源。
    """
    sched = FlowForgeScheduler(metrics_collector=metrics, event_bus=event_bus)
    yield sched
    try:
        # _started=False 时 shutdown 为无操作
        sched._scheduler.shutdown(wait=False)
    except Exception:
        pass


@pytest.fixture
def config_dir(tmp_path) -> Path:
    """构造临时 YAML 配置目录（含 2 个 yaml 文件，3 个任务）。"""
    (tmp_path / "scheduler.yaml").write_text(SCHEDULER_YAML_CONTENT, encoding="utf-8")
    (tmp_path / "extra.yaml").write_text(MULTI_FILE_YAML_CONTENT_2, encoding="utf-8")
    return tmp_path


def make_config(
    name: str = "test_task",
    handler: str = "daily_quota_reset",
    trigger_type: str = "interval",
    trigger_args: dict | None = None,
    enabled: bool = True,
    **overrides: Any,
) -> ScheduledTaskConfig:
    """构造测试用 ScheduledTaskConfig（默认 interval 60s + 内置 handler）."""
    base: dict[str, Any] = {
        "name": name,
        "trigger_type": trigger_type,
        "trigger_args": trigger_args or {"minutes": 60},
        "task_handler": handler,
        "enabled": enabled,
    }
    base.update(overrides)
    return ScheduledTaskConfig(**base)


# ─────────────────────────────────────────────────────────────────
# 1. ScheduledTaskConfig 字段默认值与校验
# ─────────────────────────────────────────────────────────────────


class TestScheduledTaskConfig:
    """ScheduledTaskConfig Pydantic 模型测试。"""

    def test_defaults(self):
        """默认值：description / enabled / max_instances / coalesce 等。"""
        config = ScheduledTaskConfig(
            name="quota_reset",
            trigger_type="cron",
            trigger_args={"hour": 2},
            task_handler="daily_quota_reset",
        )
        assert config.description == ""
        assert config.enabled is True
        assert config.max_instances == 1
        assert config.coalesce is True
        assert config.misfire_grace_time == 60
        assert config.retry_on_failure is True
        assert config.max_retries == 3
        assert config.retry_delay_seconds == 60
        assert config.timeout_seconds == 0
        assert config.task_args == []
        assert config.task_kwargs == {}
        assert config.metadata == {}

    def test_trigger_types_accepted(self):
        """三种 trigger_type 均可被接受。"""
        for tt, targs in [
            ("cron", {"hour": 2}),
            ("interval", {"minutes": 30}),
            ("date", {"run_date": "2026-12-31T23:59:59"}),
        ]:
            cfg = ScheduledTaskConfig(
                name=f"task_{tt}",
                trigger_type=tt,
                trigger_args=targs,
                task_handler="daily_quota_reset",
            )
            assert cfg.trigger_type == tt

    def test_invalid_trigger_type_rejected(self):
        """非法 trigger_type 应被 Literal 拒绝。"""
        with pytest.raises(Exception):
            ScheduledTaskConfig(
                name="bad",
                trigger_type="weekly",  # type: ignore[arg-type]
                trigger_args={},
                task_handler="daily_quota_reset",
            )

    def test_max_instances_minimum_one(self):
        """max_instances 必须 >= 1。"""
        with pytest.raises(Exception):
            ScheduledTaskConfig(
                name="bad",
                trigger_type="cron",
                trigger_args={"hour": 2},
                task_handler="daily_quota_reset",
                max_instances=0,
            )

    def test_metadata_field_custom(self):
        """metadata 字段支持任意键值。"""
        config = ScheduledTaskConfig(
            name="t",
            trigger_type="cron",
            trigger_args={"hour": 2},
            task_handler="daily_quota_reset",
            metadata={"category": "contentforge", "owner": "operator_001"},
        )
        assert config.metadata["category"] == "contentforge"
        assert config.metadata["owner"] == "operator_001"

    def test_negative_timeout_rejected(self):
        """timeout_seconds 不能为负。"""
        with pytest.raises(Exception):
            ScheduledTaskConfig(
                name="t",
                trigger_type="cron",
                trigger_args={"hour": 2},
                task_handler="daily_quota_reset",
                timeout_seconds=-1,
            )


# ─────────────────────────────────────────────────────────────────
# 2. TaskExecutionResult 字段
# ─────────────────────────────────────────────────────────────────


class TestTaskExecutionResult:
    """TaskExecutionResult Pydantic 模型测试。"""

    def test_result_with_defaults(self):
        """成功结果的 error 默认为空，retry_count 默认 0。"""
        result = TaskExecutionResult(
            task_name="t",
            success=True,
            started_at="2026-07-21T00:00:00+00:00",
            finished_at="2026-07-21T00:00:01+00:00",
            duration_seconds=1.0,
        )
        assert result.error == ""
        assert result.retry_count == 0
        assert result.result is None

    def test_result_with_error(self):
        """失败结果携带 error 与 retry_count。"""
        result = TaskExecutionResult(
            task_name="t",
            success=False,
            started_at="2026-07-21T00:00:00+00:00",
            finished_at="2026-07-21T00:00:05+00:00",
            duration_seconds=5.0,
            error="ValueError: invalid input",
            retry_count=2,
        )
        assert result.success is False
        assert result.error == "ValueError: invalid input"
        assert result.retry_count == 2

    def test_result_with_payload(self):
        """result 字段可携带任意返回值。"""
        payload = {"reset_providers": ["openai", "anthropic"]}
        result = TaskExecutionResult(
            task_name="t",
            success=True,
            started_at="2026-07-21T00:00:00+00:00",
            finished_at="2026-07-21T00:00:01+00:00",
            duration_seconds=1.0,
            result=payload,
        )
        assert result.result == payload


# ─────────────────────────────────────────────────────────────────
# 3. TaskRegistry
# ─────────────────────────────────────────────────────────────────


class TestTaskRegistry:
    """TaskRegistry register/unregister/get/list 测试。"""

    def test_register_and_get(self):
        """注册后可通过 get 获取。"""
        registry = TaskRegistry()
        handler = lambda *a, **kw: "ok"
        registry.register("my_handler", handler)
        assert registry.get("my_handler") is handler

    def test_get_nonexistent(self):
        """未注册的 handler 返回 None。"""
        registry = TaskRegistry()
        assert registry.get("nonexistent") is None

    def test_unregister_existing(self):
        """注销已注册 handler 返回 True。"""
        registry = TaskRegistry()
        registry.register("h", lambda *a, **kw: None)
        assert registry.unregister("h") is True
        assert registry.get("h") is None

    def test_unregister_nonexistent(self):
        """注销未注册 handler 返回 False。"""
        registry = TaskRegistry()
        assert registry.unregister("missing") is False

    def test_list_handlers(self):
        """list_handlers 按注册顺序返回 handler 名。"""
        registry = TaskRegistry()
        registry.register("h1", lambda *a, **kw: 1)
        registry.register("h2", lambda *a, **kw: 2)
        registry.register("h3", lambda *a, **kw: 3)
        assert registry.list_handlers() == ["h1", "h2", "h3"]

    def test_register_empty_name_rejected(self):
        """空字符串 name 应被拒绝。"""
        registry = TaskRegistry()
        with pytest.raises(ValueError):
            registry.register("", lambda *a, **kw: None)

    def test_register_non_callable_rejected(self):
        """不可调用对象应被拒绝。"""
        registry = TaskRegistry()
        with pytest.raises(TypeError):
            registry.register("bad", "not_a_function")  # type: ignore[arg-type]

    def test_default_registry_has_builtins(self):
        """create_default_registry 应注册 4 个内置 handler。"""
        registry = create_default_registry()
        handlers = registry.list_handlers()
        assert "daily_quota_reset" in handlers
        assert "metrics_summary_report" in handlers
        assert "health_check" in handlers
        assert "cleanup_expired_events" in handlers
        assert len(handlers) == 4


# ─────────────────────────────────────────────────────────────────
# 4. FlowForgeScheduler 初始化
# ─────────────────────────────────────────────────────────────────


class TestSchedulerInit:
    """FlowForgeScheduler 初始化（不启动）测试。"""

    def test_init_no_config_dir(self, metrics, event_bus):
        """无 config_dir 时初始化为空调度器。"""
        sched = FlowForgeScheduler(
            metrics_collector=metrics, event_bus=event_bus
        )
        assert sched.started is False
        assert sched.task_registry is not None
        assert len(sched.list_tasks()) == 0
        assert "daily_quota_reset" in sched.task_registry.list_handlers()

    def test_init_with_default_logger(self, metrics):
        """未传入 logger 时使用默认 logger。"""
        sched = FlowForgeScheduler(metrics_collector=metrics)
        assert sched._logger is not None

    def test_init_with_config_dir_loads_tasks(self, metrics, event_bus, config_dir):
        """构造期传入 config_dir 应立即加载任务。"""
        sched = FlowForgeScheduler(
            metrics_collector=metrics, event_bus=event_bus, config_dir=config_dir
        )
        names = [t["name"] for t in sched.list_tasks()]
        assert "daily_quota_reset" in names
        assert "hourly_metrics_summary" in names
        assert "devforge_code_review_scheduler" in names


# ─────────────────────────────────────────────────────────────────
# 5. load_configs_from_dir
# ─────────────────────────────────────────────────────────────────


class TestLoadConfigsFromDir:
    """load_configs_from_dir 测试。"""

    def test_load_multiple_yaml_files(self, scheduler, config_dir):
        """应加载目录中所有 *.yaml 文件。"""
        count = scheduler.load_configs_from_dir(config_dir)
        assert count == 3
        names = [t["name"] for t in scheduler.list_tasks()]
        assert set(names) == {
            "daily_quota_reset",
            "hourly_metrics_summary",
            "devforge_code_review_scheduler",
        }

    def test_load_empty_dir(self, scheduler, tmp_path):
        """空目录加载返回 0。"""
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        assert scheduler.load_configs_from_dir(empty_dir) == 0

    def test_load_nonexistent_dir_raises(self, scheduler, tmp_path):
        """不存在的目录应 raise FileNotFoundError。"""
        with pytest.raises(FileNotFoundError):
            scheduler.load_configs_from_dir(tmp_path / "missing")

    def test_load_invalid_yaml_raises(self, scheduler, tmp_path):
        """YAML 格式错误应 raise ValueError。"""
        bad_file = tmp_path / "bad.yaml"
        bad_file.write_text("not: valid: yaml: - [", encoding="utf-8")
        with pytest.raises(ValueError):
            scheduler.load_configs_from_dir(tmp_path)

    def test_load_invalid_task_field_raises(self, scheduler, tmp_path):
        """任务字段校验失败应 raise ValueError。"""
        bad_file = tmp_path / "bad_task.yaml"
        bad_file.write_text(
            "tasks:\n  - name: bad\n    trigger_type: cron\n    trigger_args: {hour: 2}\n",
            encoding="utf-8",
        )
        # 缺 task_handler
        with pytest.raises(ValueError):
            scheduler.load_configs_from_dir(tmp_path)

    def test_load_skips_empty_yaml(self, scheduler, tmp_path):
        """空 YAML 文件应被跳过。"""
        empty_yaml = tmp_path / "empty.yaml"
        empty_yaml.write_text("", encoding="utf-8")
        assert scheduler.load_configs_from_dir(tmp_path) == 0


# ─────────────────────────────────────────────────────────────────
# 6. register_task / unregister_task / pause_task / resume_task
# ─────────────────────────────────────────────────────────────────


class TestTaskLifecycle:
    """任务注册 / 注销 / 暂停 / 恢复测试。"""

    def test_register_task_returns_job_id(self, scheduler):
        """register_task 应返回 job_id（等于 config.name）。"""
        cfg = make_config(name="my_task")
        job_id = scheduler.register_task(cfg)
        assert job_id == "my_task"

    def test_register_task_appears_in_list(self, scheduler):
        """注册后应出现在 list_tasks 中。"""
        cfg = make_config(name="listed_task", trigger_type="cron", trigger_args={"hour": 9})
        scheduler.register_task(cfg)
        tasks = scheduler.list_tasks()
        names = [t["name"] for t in tasks]
        assert "listed_task" in names

    def test_register_duplicate_raises(self, scheduler):
        """重复注册同名任务应 raise ValueError。"""
        cfg = make_config(name="dup")
        scheduler.register_task(cfg)
        with pytest.raises(ValueError):
            scheduler.register_task(cfg)

    def test_register_disabled_task_skips_add_job(self, scheduler):
        """enabled=False 时不应向 APScheduler 添加 job。"""
        cfg = make_config(name="disabled_task", enabled=False)
        scheduler.register_task(cfg)
        # 配置已记录
        assert any(t["name"] == "disabled_task" for t in scheduler.list_tasks())
        # APScheduler jobstore 为空
        assert scheduler._scheduler.get_job("disabled_task") is None

    def test_unregister_existing_task(self, scheduler):
        """注销已存在任务返回 True 并移除配置。"""
        cfg = make_config(name="to_remove")
        scheduler.register_task(cfg)
        assert scheduler.unregister_task("to_remove") is True
        assert all(t["name"] != "to_remove" for t in scheduler.list_tasks())

    def test_unregister_nonexistent(self, scheduler):
        """注销不存在任务返回 False。"""
        assert scheduler.unregister_task("ghost") is False

    def test_unregister_disabled_task(self, scheduler):
        """注销被禁用的任务（未在 APScheduler 注册）也应成功。"""
        cfg = make_config(name="disabled", enabled=False)
        scheduler.register_task(cfg)
        assert scheduler.unregister_task("disabled") is True

    def test_pause_task(self, scheduler):
        """暂停任务返回 True。"""
        cfg = make_config(name="pausable")
        scheduler.register_task(cfg)
        assert scheduler.pause_task("pausable") is True

    def test_pause_nonexistent_task(self, scheduler):
        """暂停不存在任务返回 False。"""
        assert scheduler.pause_task("ghost") is False

    def test_pause_disabled_task_returns_false(self, scheduler):
        """暂停被禁用任务返回 False（无 APScheduler job）。"""
        cfg = make_config(name="disabled", enabled=False)
        scheduler.register_task(cfg)
        assert scheduler.pause_task("disabled") is False

    def test_resume_task(self, scheduler):
        """暂停后恢复任务返回 True。"""
        cfg = make_config(name="resumable")
        scheduler.register_task(cfg)
        scheduler.pause_task("resumable")
        assert scheduler.resume_task("resumable") is True

    def test_resume_disabled_task_registers_job(self, scheduler):
        """恢复被禁用任务时重新向 APScheduler 添加 job。"""
        cfg = make_config(name="revive", enabled=False)
        scheduler.register_task(cfg)
        assert scheduler._scheduler.get_job("revive") is None
        assert scheduler.resume_task("revive") is True
        assert scheduler._scheduler.get_job("revive") is not None

    def test_resume_nonexistent_task(self, scheduler):
        """恢复不存在任务返回 False。"""
        assert scheduler.resume_task("ghost") is False


# ─────────────────────────────────────────────────────────────────
# 7. list_tasks / get_task_status
# ─────────────────────────────────────────────────────────────────


class TestTaskQuery:
    """list_tasks / get_task_status 测试。"""

    def test_list_tasks_empty(self, scheduler):
        """空调度器 list_tasks 返回空列表。"""
        assert scheduler.list_tasks() == []

    def test_list_tasks_includes_fields(self, scheduler):
        """list_tasks 每项含必要字段。"""
        cfg = make_config(
            name="field_check",
            trigger_type="cron",
            trigger_args={"hour": 9, "minute": 30},
            description="test desc",
        )
        scheduler.register_task(cfg)
        tasks = scheduler.list_tasks()
        target = next(t for t in tasks if t["name"] == "field_check")
        assert target["description"] == "test desc"
        assert target["enabled"] is True
        assert target["trigger_type"] == "cron"
        assert target["task_handler"] == "daily_quota_reset"
        assert "trigger_args" in target
        # next_run_time 在调度器未启动时为 None
        assert target["next_run_time"] is None

    def test_get_task_status_existing(self, scheduler):
        """已存在任务返回完整状态。"""
        cfg = make_config(name="status_task")
        scheduler.register_task(cfg)
        status = scheduler.get_task_status("status_task")
        assert status["exists"] is True
        assert status["name"] == "status_task"
        assert status["enabled"] is True
        assert "next_run_time" in status
        assert status["last_execution"] is None  # 未执行过

    def test_get_task_status_nonexistent(self, scheduler):
        """不存在任务返回 exists=False。"""
        status = scheduler.get_task_status("ghost")
        assert status["exists"] is False
        assert status["name"] == "ghost"


# ─────────────────────────────────────────────────────────────────
# 8. _execute_task 执行成功 / 失败重试 / 超时
# ─────────────────────────────────────────────────────────────────


class TestExecuteTask:
    """_execute_task 行为测试（直接调用，不通过 APScheduler 触发）。"""

    @pytest.mark.asyncio
    async def test_execute_task_success(self, scheduler):
        """成功执行返回 success=True 的 TaskExecutionResult。"""
        async def handler(*args, **kwargs):
            return {"items": ["a", "b"]}

        scheduler.task_registry.register("success_handler", handler)
        cfg = make_config(
            name="success_task",
            handler="success_handler",
            retry_on_failure=False,
        )
        result = await scheduler._execute_task(cfg)
        assert result.success is True
        assert result.error == ""
        assert result.result == {"items": ["a", "b"]}
        assert result.retry_count == 0
        assert result.task_name == "success_task"
        # started_at / finished_at 是合法 ISO 8601
        datetime.fromisoformat(result.started_at)
        datetime.fromisoformat(result.finished_at)
        assert result.duration_seconds >= 0

    @pytest.mark.asyncio
    async def test_execute_task_handler_not_found(self, scheduler):
        """handler 未注册时返回 success=False 并记入历史。"""
        cfg = make_config(
            name="missing_handler_task",
            handler="no_such_handler",
            retry_on_failure=False,
        )
        result = await scheduler._execute_task(cfg)
        assert result.success is False
        assert "handler not found" in result.error
        # 应触发 task.scheduled.failed 事件
        history = scheduler.get_execution_history(name="missing_handler_task")
        assert len(history) == 1
        assert history[0].success is False

    @pytest.mark.asyncio
    async def test_execute_task_failure_with_retry(self, scheduler):
        """失败重试：max_retries=2 时总共尝试 3 次，最终失败。"""
        call_count = {"n": 0}

        async def handler(*args, **kwargs):
            call_count["n"] += 1
            raise RuntimeError(f"boom #{call_count['n']}")

        scheduler.task_registry.register("boom_handler", handler)
        cfg = make_config(
            name="retry_task",
            handler="boom_handler",
            retry_on_failure=True,
            max_retries=2,
            retry_delay_seconds=0,  # 避免真实等待
        )
        result = await scheduler._execute_task(cfg)
        assert result.success is False
        assert call_count["n"] == 3  # 1 次原始 + 2 次重试
        assert result.retry_count == 2
        assert "RuntimeError" in result.error

    @pytest.mark.asyncio
    async def test_execute_task_failure_no_retry(self, scheduler):
        """retry_on_failure=False 时只尝试 1 次。"""
        call_count = {"n": 0}

        async def handler(*args, **kwargs):
            call_count["n"] += 1
            raise ValueError("single shot")

        scheduler.task_registry.register("single_handler", handler)
        cfg = make_config(
            name="no_retry_task",
            handler="single_handler",
            retry_on_failure=False,
            max_retries=5,  # 即使配 5 也不重试
        )
        result = await scheduler._execute_task(cfg)
        assert result.success is False
        assert call_count["n"] == 1
        assert result.retry_count == 0

    @pytest.mark.asyncio
    async def test_execute_task_retry_then_success(self, scheduler):
        """前 N 次失败后第 N+1 次成功。"""
        call_count = {"n": 0}

        async def handler(*args, **kwargs):
            call_count["n"] += 1
            if call_count["n"] < 3:
                raise RuntimeError("not yet")
            return "finally_ok"

        scheduler.task_registry.register("recover_handler", handler)
        cfg = make_config(
            name="recover_task",
            handler="recover_handler",
            retry_on_failure=True,
            max_retries=5,
            retry_delay_seconds=0,
        )
        result = await scheduler._execute_task(cfg)
        assert result.success is True
        assert result.result == "finally_ok"
        assert result.retry_count == 2  # 失败 2 次后第 3 次成功

    @pytest.mark.asyncio
    async def test_execute_task_timeout(self, scheduler):
        """超时：handler sleep 超过 timeout_seconds 触发 TimeoutError。"""
        async def handler(*args, **kwargs):
            await asyncio.sleep(5)
            return "should_not_reach"

        scheduler.task_registry.register("slow_handler", handler)
        cfg = make_config(
            name="timeout_task",
            handler="slow_handler",
            timeout_seconds=1,
            retry_on_failure=True,
            max_retries=1,
            retry_delay_seconds=0,
        )
        result = await scheduler._execute_task(cfg)
        assert result.success is False
        assert "timeout" in result.error.lower()
        # 2 次尝试（1 原始 + 1 重试），都超时
        assert result.retry_count == 1

    @pytest.mark.asyncio
    async def test_execute_task_sync_handler(self, scheduler):
        """同步 handler 也应被正确执行。"""
        def sync_handler(*args, **kwargs):
            return {"sync": True}

        scheduler.task_registry.register("sync_handler", sync_handler)
        cfg = make_config(
            name="sync_task",
            handler="sync_handler",
            retry_on_failure=False,
        )
        result = await scheduler._execute_task(cfg)
        assert result.success is True
        assert result.result == {"sync": True}

    @pytest.mark.asyncio
    async def test_execute_task_passes_args_kwargs(self, scheduler):
        """task_args 与 task_kwargs 应被透传到 handler。"""
        received: dict = {}

        async def handler(*args, **kwargs):
            received["args"] = args
            received["kwargs"] = kwargs
            return "ok"

        scheduler.task_registry.register("arg_handler", handler)
        cfg = make_config(
            name="arg_task",
            handler="arg_handler",
            task_args=["positional1", "positional2"],
            task_kwargs={"custom_key": "custom_value"},
            retry_on_failure=False,
        )
        await scheduler._execute_task(cfg)
        assert received["args"] == ("positional1", "positional2")
        # custom_key 透传 + 自动注入的运行期上下文
        assert received["kwargs"]["custom_key"] == "custom_value"
        assert "scheduler" in received["kwargs"]
        assert "event_bus" in received["kwargs"]
        assert "metrics_collector" in received["kwargs"]
        assert "task_registry" in received["kwargs"]


# ─────────────────────────────────────────────────────────────────
# 9. metrics_collector 集成
# ─────────────────────────────────────────────────────────────────


class TestMetricsIntegration:
    """metrics_collector 上报集成测试。"""

    @pytest.mark.asyncio
    async def test_metrics_recorded_on_success(self, scheduler, metrics):
        """成功执行后应记录 counter + histogram。"""
        async def handler(*args, **kwargs):
            return "ok"

        scheduler.task_registry.register("m_handler", handler)
        cfg = make_config(name="m_task", handler="m_handler", retry_on_failure=False)
        await scheduler._execute_task(cfg)

        all_metrics = metrics.get_all_metrics()
        # counter 应包含 flowforge_scheduled_task_total
        counter_keys = list(all_metrics["counters"].keys())
        assert any("flowforge_scheduled_task_total" in k for k in counter_keys)
        # histogram 应包含 flowforge_scheduled_task_duration_seconds
        histogram_keys = list(all_metrics["histograms"].keys())
        assert any(
            "flowforge_scheduled_task_duration_seconds" in k for k in histogram_keys
        )

    @pytest.mark.asyncio
    async def test_metrics_recorded_on_failure(self, scheduler, metrics):
        """失败执行后应记录 failed counter。"""
        async def handler(*args, **kwargs):
            raise RuntimeError("fail")

        scheduler.task_registry.register("f_handler", handler)
        cfg = make_config(
            name="f_task",
            handler="f_handler",
            retry_on_failure=False,
        )
        await scheduler._execute_task(cfg)

        all_metrics = metrics.get_all_metrics()
        counter_keys = list(all_metrics["counters"].keys())
        assert any("flowforge_scheduled_task_failed_total" in k for k in counter_keys)

    @pytest.mark.asyncio
    async def test_metrics_collector_none_no_raise(self, event_bus):
        """未注入 metrics_collector 时执行不应报错。"""
        sched = FlowForgeScheduler(metrics_collector=None, event_bus=event_bus)

        async def handler(*args, **kwargs):
            return "ok"

        sched.task_registry.register("h", handler)
        cfg = make_config(name="t", handler="h", retry_on_failure=False)
        result = await sched._execute_task(cfg)
        assert result.success is True


# ─────────────────────────────────────────────────────────────────
# 10. event_bus 集成
# ─────────────────────────────────────────────────────────────────


class TestEventBusIntegration:
    """event_bus 事件上报集成测试。"""

    @pytest.mark.asyncio
    async def test_events_emitted_on_success(self, scheduler, event_bus):
        """成功执行应发出 started + completed 事件。"""
        events: list[dict] = []
        event_bus.subscribe("task.scheduled.started", lambda e: events.append(e))
        event_bus.subscribe("task.scheduled.completed", lambda e: events.append(e))

        async def handler(*args, **kwargs):
            return "ok"

        scheduler.task_registry.register("e_handler", handler)
        cfg = make_config(name="e_task", handler="e_handler", retry_on_failure=False)
        await scheduler._execute_task(cfg)

        types = [e["type"] for e in events]
        assert "task.scheduled.started" in types
        assert "task.scheduled.completed" in types
        # payload 校验
        started = next(e for e in events if e["type"] == "task.scheduled.started")
        assert started["payload"]["task_name"] == "e_task"
        assert started["payload"]["handler"] == "e_handler"
        completed = next(e for e in events if e["type"] == "task.scheduled.completed")
        assert completed["payload"]["task_name"] == "e_task"
        assert "duration_seconds" in completed["payload"]

    @pytest.mark.asyncio
    async def test_events_emitted_on_failure(self, scheduler, event_bus):
        """失败执行应发出 started + failed 事件。"""
        events: list[dict] = []
        event_bus.subscribe("task.scheduled.started", lambda e: events.append(e))
        event_bus.subscribe("task.scheduled.failed", lambda e: events.append(e))

        async def handler(*args, **kwargs):
            raise RuntimeError("fail")

        scheduler.task_registry.register("fail_handler", handler)
        cfg = make_config(
            name="fail_task",
            handler="fail_handler",
            retry_on_failure=False,
        )
        await scheduler._execute_task(cfg)

        types = [e["type"] for e in events]
        assert "task.scheduled.started" in types
        assert "task.scheduled.failed" in types
        failed = next(e for e in events if e["type"] == "task.scheduled.failed")
        assert "error" in failed["payload"]
        assert "RuntimeError" in failed["payload"]["error"]

    @pytest.mark.asyncio
    async def test_no_event_bus_no_raise(self, metrics):
        """未注入 event_bus 时执行不应报错。"""
        sched = FlowForgeScheduler(metrics_collector=metrics, event_bus=None)

        async def handler(*args, **kwargs):
            return "ok"

        sched.task_registry.register("h", handler)
        cfg = make_config(name="t", handler="h", retry_on_failure=False)
        result = await sched._execute_task(cfg)
        assert result.success is True


# ─────────────────────────────────────────────────────────────────
# 11. 执行历史记录
# ─────────────────────────────────────────────────────────────────


class TestExecutionHistory:
    """get_execution_history 测试。"""

    @pytest.mark.asyncio
    async def test_history_per_task(self, scheduler):
        """同一任务的多次执行应记入 per-task 历史。"""
        async def handler(*args, **kwargs):
            return "ok"

        scheduler.task_registry.register("h", handler)
        cfg = make_config(name="hist_task", handler="h", retry_on_failure=False)
        await scheduler._execute_task(cfg)
        await scheduler._execute_task(cfg)
        await scheduler._execute_task(cfg)

        history = scheduler.get_execution_history(name="hist_task")
        assert len(history) == 3
        # 最新在前
        assert all(r.task_name == "hist_task" for r in history)

    @pytest.mark.asyncio
    async def test_history_global(self, scheduler):
        """不指定 name 时返回全局历史（多任务混合）。"""
        async def handler(*args, **kwargs):
            return "ok"

        scheduler.task_registry.register("h", handler)
        cfg_a = make_config(name="task_a", handler="h", retry_on_failure=False)
        cfg_b = make_config(name="task_b", handler="h", retry_on_failure=False)
        await scheduler._execute_task(cfg_a)
        await scheduler._execute_task(cfg_b)
        await scheduler._execute_task(cfg_a)

        history = scheduler.get_execution_history()
        assert len(history) == 3
        # 最新在前，最后一条应是 task_a
        assert history[0].task_name == "task_a"

    @pytest.mark.asyncio
    async def test_history_limit(self, scheduler):
        """limit 参数限制返回数量。"""
        async def handler(*args, **kwargs):
            return "ok"

        scheduler.task_registry.register("h", handler)
        cfg = make_config(name="lim_task", handler="h", retry_on_failure=False)
        for _ in range(10):
            await scheduler._execute_task(cfg)

        history = scheduler.get_execution_history(name="lim_task", limit=3)
        assert len(history) == 3

    @pytest.mark.asyncio
    async def test_history_empty(self, scheduler):
        """未执行过的任务历史为空。"""
        assert scheduler.get_execution_history(name="ghost") == []
        assert scheduler.get_execution_history() == []

    @pytest.mark.asyncio
    async def test_history_reflected_in_status(self, scheduler):
        """get_task_status 应反映最后执行结果。"""
        async def handler(*args, **kwargs):
            return "ok"

        scheduler.task_registry.register("h", handler)
        cfg = make_config(name="st_task", handler="h", retry_on_failure=False)
        # 先注册任务（get_task_status 依赖 _task_configs）
        scheduler.register_task(cfg)
        await scheduler._execute_task(cfg)
        status = scheduler.get_task_status("st_task")
        assert status["exists"] is True
        assert status["last_execution"] is not None
        assert status["last_execution"]["success"] is True


# ─────────────────────────────────────────────────────────────────
# 12. 内置任务处理函数
# ─────────────────────────────────────────────────────────────────


class TestBuiltinHandlers:
    """4 个内置任务处理函数测试。"""

    @pytest.mark.asyncio
    async def test_daily_quota_reset_no_quota_manager(self):
        """未提供 quota_manager 时应跳过并返回 skipped=True。"""
        result = await daily_quota_reset()
        assert result["skipped"] is True
        assert "quota_manager not provided" in result["reason"]
        assert result["reset_providers"] == []

    @pytest.mark.asyncio
    async def test_daily_quota_reset_no_method(self):
        """quota_manager 未实现 reset_daily_quota 时应跳过。"""
        # 使用普通对象（非 MagicMock），避免 MagicMock 自动创建任意属性
        class EmptyQuotaManager:
            pass

        qm = EmptyQuotaManager()
        result = await daily_quota_reset(quota_manager=qm)
        assert result["skipped"] is True
        assert "reset_daily_quota not implemented" in result["reason"]

    @pytest.mark.asyncio
    async def test_daily_quota_reset_sync_method(self):
        """quota_manager.reset_daily_quota 是同步方法返回 dict。"""
        qm = MagicMock()
        qm.reset_daily_quota.return_value = {
            "reset_providers": ["openai", "anthropic"]
        }
        result = await daily_quota_reset(quota_manager=qm)
        assert result["skipped"] is False
        assert result["reset_providers"] == ["openai", "anthropic"]

    @pytest.mark.asyncio
    async def test_daily_quota_reset_async_method(self):
        """quota_manager.reset_daily_quota 是 async 方法返回 list。"""
        qm = MagicMock()

        async def _reset():
            return ["openai", "deepseek"]

        qm.reset_daily_quota = _reset
        result = await daily_quota_reset(quota_manager=qm)
        assert result["skipped"] is False
        assert result["reset_providers"] == ["openai", "deepseek"]

    @pytest.mark.asyncio
    async def test_daily_quota_reset_emits_event(self):
        """提供 event_bus 时应发出 task.scheduled.quota_reset 事件。"""
        events: list[dict] = []
        bus = EventBus()
        bus.subscribe("task.scheduled.quota_reset", lambda e: events.append(e))
        await daily_quota_reset(event_bus=bus)
        assert len(events) == 1
        assert events[0]["payload"]["skipped"] is True

    @pytest.mark.asyncio
    async def test_metrics_summary_report_no_collector(self):
        """未提供 metrics_collector 时跳过。"""
        result = await metrics_summary_report()
        assert result["skipped"] is True
        assert "metrics_collector not provided" in result["reason"]

    @pytest.mark.asyncio
    async def test_metrics_summary_report_with_collector(self, metrics, capsys):
        """提供 metrics_collector 时应返回 counter/gauge/histogram 数量。"""
        # 预填一些指标
        metrics.inc_counter("flowforge_test_counter")
        metrics.set_gauge("flowforge_test_gauge", 1.0)
        metrics.observe_histogram("flowforge_test_hist", 0.5)

        result = await metrics_summary_report(metrics_collector=metrics)
        assert result["skipped"] is False
        assert result["counter_count"] >= 1
        assert result["gauge_count"] >= 1
        assert result["histogram_count"] >= 1
        assert "generated_at" in result

        # 应打印摘要
        captured = capsys.readouterr()
        assert "metrics_summary_report" in captured.out

    @pytest.mark.asyncio
    async def test_metrics_summary_report_emits_event(self, metrics):
        """提供 event_bus 时应发出 task.scheduled.metrics_summary 事件。"""
        events: list[dict] = []
        bus = EventBus()
        bus.subscribe("task.scheduled.metrics_summary", lambda e: events.append(e))
        await metrics_summary_report(metrics_collector=metrics, event_bus=bus)
        assert len(events) == 1
        assert "counter_count" in events[0]["payload"]

    @pytest.mark.asyncio
    async def test_health_check_default_components(self):
        """默认检查 event_bus / metrics_collector / task_registry。"""
        # 不提供任何组件 → 应判为 unhealthy
        result = await health_check()
        assert result["healthy"] is False
        assert result["components"]["event_bus"] == "missing"
        assert result["components"]["metrics_collector"] == "missing"
        assert result["components"]["task_registry"] == "missing"

    @pytest.mark.asyncio
    async def test_health_check_with_components(self):
        """提供完整组件时应判为 healthy。"""
        bus = EventBus()
        mc = MetricsCollector()
        tr = create_default_registry()
        result = await health_check(
            event_bus=bus, metrics_collector=mc, task_registry=tr
        )
        assert result["healthy"] is True
        assert result["components"]["event_bus"] == "present"
        assert result["components"]["metrics_collector"] == "present"
        assert "handlers" in result["components"]["task_registry"]

    @pytest.mark.asyncio
    async def test_health_check_custom_components(self):
        """通过 components 参数注入额外检查项。"""
        result = await health_check(components={"database": "present"})
        assert "database" in result["components"]
        assert result["components"]["database"] == "present"

    @pytest.mark.asyncio
    async def test_cleanup_expired_events_no_targets(self):
        """未提供 approval_hub / event_store 时返回 0 清理。"""
        result = await cleanup_expired_events()
        assert result["cleaned"]["approval_hub"] == 0
        assert result["cleaned"]["event_store"] == 0
        assert result["total"] == 0

    @pytest.mark.asyncio
    async def test_cleanup_expired_events_with_approval_hub(self):
        """提供 approval_hub 时调用其 purge_expired。"""
        hub = MagicMock()
        hub.purge_expired.return_value = 5
        result = await cleanup_expired_events(approval_hub=hub)
        assert result["cleaned"]["approval_hub"] == 5
        assert result["total"] == 5
        hub.purge_expired.assert_called_once()

    @pytest.mark.asyncio
    async def test_cleanup_expired_events_async_event_store(self):
        """event_store.cleanup_expired 是 async 方法时也应正确处理。"""
        store = MagicMock()

        async def _cleanup():
            return 3

        store.cleanup_expired = _cleanup
        result = await cleanup_expired_events(event_store=store)
        assert result["cleaned"]["event_store"] == 3

    @pytest.mark.asyncio
    async def test_cleanup_expired_events_handler_failure(self):
        """approval_hub.purge_expired 抛异常时返回 0 不传播。"""
        hub = MagicMock()
        hub.purge_expired.side_effect = RuntimeError("db down")
        result = await cleanup_expired_events(approval_hub=hub)
        assert result["cleaned"]["approval_hub"] == 0


# ─────────────────────────────────────────────────────────────────
# 13. 时间相关：mock _perf_counter 验证 duration 计算
# ─────────────────────────────────────────────────────────────────


class TestTimeMocking:
    """通过 mock _perf_counter 验证 duration_seconds 计算（不依赖真实时间）。"""

    @pytest.mark.asyncio
    async def test_duration_uses_perf_counter(self, scheduler):
        """mock _perf_counter 返回 0 / 100，duration 应为 100。"""
        from flowforge.core import scheduler as scheduler_module

        async def handler(*args, **kwargs):
            return "ok"

        scheduler.task_registry.register("h", handler)
        cfg = make_config(name="dur_task", handler="h", retry_on_failure=False)

        # 模拟 perf_counter 序列：start=0, end=100
        with patch.object(scheduler_module, "_perf_counter", side_effect=[0.0, 100.0]):
            result = await scheduler._execute_task(cfg)

        assert result.success is True
        assert result.duration_seconds == 100.0


# ─────────────────────────────────────────────────────────────────
# 14. start / shutdown 生命周期
# ─────────────────────────────────────────────────────────────────


class TestSchedulerLifecycle:
    """start / shutdown 行为测试。"""

    @pytest.mark.asyncio
    async def test_shutdown_when_not_started(self, scheduler):
        """未启动时 shutdown 为无操作，不报错。"""
        await scheduler.shutdown()
        assert scheduler.started is False

    @pytest.mark.asyncio
    async def test_start_then_shutdown(self, metrics, event_bus):
        """启动后 shutdown 应将 started 置 False。"""
        sched = FlowForgeScheduler(metrics_collector=metrics, event_bus=event_bus)
        try:
            await sched.start()
            assert sched.started is True
        finally:
            await sched.shutdown(wait=False)
        assert sched.started is False

    @pytest.mark.asyncio
    async def test_start_idempotent(self, metrics, event_bus):
        """重复调用 start 应被忽略。"""
        sched = FlowForgeScheduler(metrics_collector=metrics, event_bus=event_bus)
        try:
            await sched.start()
            assert sched.started is True
            # 第二次 start 应被忽略（不报错，不改变状态）
            await sched.start()
            assert sched.started is True
        finally:
            await sched.shutdown(wait=False)
