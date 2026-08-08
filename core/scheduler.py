"""FlowForge Scheduler — 基于 APScheduler 的定时任务调度器（P3-010）.

本模块是 ScheduleFactoryRegistry（``flowforge.core.schedule_registry``，CL-023）
的上层调度器封装：ScheduleFactoryRegistry 负责 plugin-owned factory 边界与
deterministic runtime task id 的白名单治理；FlowForgeScheduler 负责具体的
APScheduler 集成、任务执行（含超时/重试/metrics/event_bus 上报）与执行历史管理。

铁律遵守:
    - 铁律 5: 配置从 YAML 加载，禁止硬编码（``load_configs_from_dir``）
    - 铁律 6: 所有 I/O 操作使用 async/await
    - 编程红线 9: 组合优于继承（``FlowForgeScheduler`` 持有
      ``AsyncIOScheduler`` 实例而非继承）
    - 编程红线 11: 配置驱动 > 代码实现（``ScheduledTaskConfig`` Pydantic 模型）
    - 编程红线 12: 不绕过 DI 容器直接实例化（``metrics_collector`` /
      ``event_bus`` 由外部注入）

内置任务处理函数:
    - ``daily_quota_reset`` —— 每日配额重置（调用
      ``ProviderQuotaManager.reset_daily_quota``，如果可用）
    - ``metrics_summary_report`` —— 生成指标摘要（打印 + 上报 event_bus）
    - ``health_check`` —— 关键组件健康检查
    - ``cleanup_expired_events`` —— 清理过期事件（如 ApprovalHub 过期审批）

License: MIT
"""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import yaml
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.scheduler")

TriggerType = Literal["cron", "interval", "date"]

# ── 执行历史保留上限 ───────────────────────────────────────────────
_EXECUTION_HISTORY_LIMIT_PER_TASK = 100
_EXECUTION_HISTORY_LIMIT_GLOBAL = 500


# ── Pydantic 模型 ─────────────────────────────────────────────────


class ScheduledTaskConfig(BaseModel):
    """定时任务配置（Pydantic 模型）.

    描述单个定时任务的全部字段，包括触发方式、处理函数定位、执行策略
    （超时/重试/合并积压）以及元数据。

    Attributes:
        name: 任务名称（唯一标识，作为 APScheduler job_id）。
        description: 任务描述（人类可读）。
        enabled: 是否启用。``False`` 时调用 ``register_task`` 不会向
            APScheduler 添加 job，但配置仍保留在 ``_task_configs`` 中以便
            ``resume_task`` 后重新注册。
        trigger_type: 触发类型，``cron`` / ``interval`` / ``date``。
        trigger_args: 触发参数。
            - ``cron``: 如 ``{"hour": 2, "minute": 0}``
            - ``interval``: 如 ``{"minutes": 30}``
            - ``date``: 如 ``{"run_date": "2026-12-31T23:59:59"}``
        task_handler: 任务处理函数名（从 :class:`TaskRegistry` 查找）。
        task_args: 位置参数列表。
        task_kwargs: 关键字参数字典。
        max_instances: 最大并发实例数（默认 1）。
        coalesce: 是否合并积压任务（默认 True）。
        misfire_grace_time: 错过执行宽限期（秒，默认 60）。
        retry_on_failure: 失败是否重试（默认 True）。
        max_retries: 最大重试次数（默认 3）。
        retry_delay_seconds: 重试间隔秒数（默认 60）。
        timeout_seconds: 执行超时秒数，``0`` 表示无超时（默认 0）。
        metadata: 元数据字典（如 category / owner 等）。
    """

    name: str = Field(..., description="任务名称（唯一标识）")
    description: str = Field(default="", description="任务描述")
    enabled: bool = Field(default=True, description="是否启用")
    trigger_type: TriggerType = Field(..., description="触发类型")
    trigger_args: dict[str, Any] = Field(..., description="触发参数")
    task_handler: str = Field(..., description="任务处理函数名")
    task_args: list[Any] = Field(default_factory=list, description="位置参数")
    task_kwargs: dict[str, Any] = Field(default_factory=dict, description="关键字参数")
    max_instances: int = Field(default=1, ge=1, description="最大并发实例数")
    coalesce: bool = Field(default=True, description="合并积压任务")
    misfire_grace_time: int = Field(default=60, ge=0, description="错过执行宽限期（秒）")
    retry_on_failure: bool = Field(default=True, description="失败是否重试")
    max_retries: int = Field(default=3, ge=0, description="最大重试次数")
    retry_delay_seconds: int = Field(default=60, ge=0, description="重试间隔秒数")
    timeout_seconds: int = Field(default=0, ge=0, description="执行超时秒数，0 表示无超时")
    metadata: dict[str, Any] = Field(default_factory=dict, description="元数据")


class TaskExecutionResult(BaseModel):
    """任务执行结果（Pydantic 模型）.

    每次执行（无论成功或失败）都会生成一个 :class:`TaskExecutionResult`，
    存入执行历史供 ``get_execution_history`` 查询。

    Attributes:
        task_name: 任务名称。
        success: 是否成功。
        started_at: 开始时间（ISO 8601 字符串，UTC）。
        finished_at: 结束时间（ISO 8601 字符串，UTC）。
        duration_seconds: 执行时长（秒）。
        error: 错误信息（失败时填，成功为空字符串）。
        retry_count: 重试次数（成功时为最终成功前的重试次数）。
        result: 任务返回值（任意 JSON-able 值）。
    """

    task_name: str
    success: bool
    started_at: str
    finished_at: str
    duration_seconds: float
    error: str = ""
    retry_count: int = 0
    result: Any = None


# ── TaskRegistry ──────────────────────────────────────────────────


class TaskRegistry:
    """任务处理函数注册中心.

    维护 ``name -> handler`` 映射，供 :class:`FlowForgeScheduler` 在执行
    任务时按 :attr:`ScheduledTaskConfig.task_handler` 查找。

    线程安全说明:
        注册中心主要在调度器构造期使用（同步），运行期只读。如需运行期
        动态注册，建议在外部加锁。本实现未内置锁以避免不必要的复杂度。

    使用示例::

        registry = TaskRegistry()
        registry.register("my_task", my_async_handler)
        handler = registry.get("my_task")
        if handler is not None:
            await handler(*args, **kwargs)
    """

    def __init__(self) -> None:
        self._handlers: dict[str, Callable] = {}

    def register(self, name: str, handler: Callable) -> None:
        """注册任务处理函数.

        Args:
            name: 处理函数名（与 :attr:`ScheduledTaskConfig.task_handler` 对应）。
            handler: 可调用对象（同步或异步均可）。

        Raises:
            ValueError: ``name`` 为空字符串。
            TypeError: ``handler`` 不可调用。
        """
        if not name or not isinstance(name, str):
            raise ValueError("handler name 必须是非空字符串")
        if not callable(handler):
            raise TypeError(f"handler 必须可调用，got {type(handler).__name__}")
        self._handlers[name] = handler
        logger.debug(f"TaskRegistry 已注册 handler: {name}")

    def unregister(self, name: str) -> bool:
        """注销任务处理函数.

        Args:
            name: 处理函数名。

        Returns:
            ``True`` 表示注销成功；``False`` 表示未注册。
        """
        if name in self._handlers:
            del self._handlers[name]
            logger.debug(f"TaskRegistry 已注销 handler: {name}")
            return True
        return False

    def get(self, name: str) -> Callable | None:
        """获取任务处理函数.

        Args:
            name: 处理函数名。

        Returns:
            处理函数；未注册返回 ``None``。
        """
        return self._handlers.get(name)

    def list_handlers(self) -> list[str]:
        """列出所有已注册的任务处理函数名.

        Returns:
            处理函数名列表（按注册顺序，字典插入顺序保证）。
        """
        return list(self._handlers.keys())


# ── 内置任务处理函数 ─────────────────────────────────────────────


async def daily_quota_reset(*args: Any, **kwargs: Any) -> dict[str, Any]:
    """内置任务：每日配额重置.

    通过 ``kwargs["quota_manager"]`` 接收 :class:`ProviderQuotaManager`，
    若其暴露 ``reset_daily_quota`` 方法则调用之；否则仅记录日志并返回
    跳过信息。同时通过 ``kwargs["event_bus"]`` 上报事件。

    Args:
        *args: 透传 :attr:`ScheduledTaskConfig.task_args`。
        **kwargs: 透传 :attr:`ScheduledTaskConfig.task_kwargs`；常用键：
            ``quota_manager`` / ``event_bus``。

    Returns:
        执行结果字典，含 ``reset_providers`` 列表与 ``skipped`` 标志。
    """
    quota_manager = kwargs.get("quota_manager")
    event_bus = kwargs.get("event_bus")
    reset_providers: list[str] = []

    if quota_manager is None:
        logger.info("daily_quota_reset: 未提供 quota_manager，跳过")
        result = {"skipped": True, "reason": "quota_manager not provided", "reset_providers": []}
    else:
        reset_fn = getattr(quota_manager, "reset_daily_quota", None)
        if reset_fn is None:
            logger.info("daily_quota_reset: quota_manager 未实现 reset_daily_quota，跳过")
            result = {"skipped": True, "reason": "reset_daily_quota not implemented", "reset_providers": []}
        else:
            try:
                reset_result = reset_fn()
                if inspect.isawaitable(reset_result):
                    reset_result = await reset_result
                if isinstance(reset_result, dict):
                    reset_providers = list(reset_result.get("reset_providers", []))
                elif isinstance(reset_result, list):
                    reset_providers = list(reset_result)
                logger.info(f"daily_quota_reset: 已重置 {len(reset_providers)} 个 provider")
                result = {"skipped": False, "reset_providers": reset_providers}
            except Exception as exc:
                logger.error(f"daily_quota_reset 调用失败: {exc}")
                result = {"skipped": False, "reset_providers": [], "error": str(exc)}

    if event_bus is not None:
        try:
            event_bus.emit("scheduler", "task.scheduled.quota_reset", result)
        except Exception as exc:
            logger.warning(f"daily_quota_reset 上报事件失败: {exc}")

    return result


async def metrics_summary_report(*args: Any, **kwargs: Any) -> dict[str, Any]:
    """内置任务：指标摘要报告.

    通过 ``kwargs["metrics_collector"]`` 接收 :class:`MetricsCollector`，
    获取其全部指标摘要并打印 + 上报 event_bus。

    Returns:
        包含 ``counter_count`` / ``gauge_count`` / ``histogram_count`` 的摘要字典。
    """
    metrics_collector = kwargs.get("metrics_collector")
    event_bus = kwargs.get("event_bus")

    if metrics_collector is None:
        logger.info("metrics_summary_report: 未提供 metrics_collector，跳过")
        return {"skipped": True, "reason": "metrics_collector not provided"}

    try:
        get_all = getattr(metrics_collector, "get_all_metrics", None)
        summary = get_all() if callable(get_all) else {}
    except Exception as exc:
        logger.error(f"metrics_summary_report 获取指标失败: {exc}")
        return {"skipped": False, "error": str(exc)}

    counter_count = len(summary.get("counters", {})) if isinstance(summary, dict) else 0
    gauge_count = len(summary.get("gauges", {})) if isinstance(summary, dict) else 0
    histogram_count = len(summary.get("histograms", {})) if isinstance(summary, dict) else 0

    report = {
        "skipped": False,
        "counter_count": counter_count,
        "gauge_count": gauge_count,
        "histogram_count": histogram_count,
        "generated_at": datetime.now(UTC).isoformat(),
    }

    # 打印摘要（生产环境可由 logger 接管）
    print(
        f"[metrics_summary_report] counters={counter_count} "
        f"gauges={gauge_count} histograms={histogram_count}"
    )

    if event_bus is not None:
        try:
            event_bus.emit("scheduler", "task.scheduled.metrics_summary", report)
        except Exception as exc:
            logger.warning(f"metrics_summary_report 上报事件失败: {exc}")

    return report


async def health_check(*args: Any, **kwargs: Any) -> dict[str, Any]:
    """内置任务：关键组件健康检查.

    检查项（默认）:
        - ``task_registry`` 是否非空
        - ``event_bus`` 是否存在
        - ``metrics_collector`` 是否存在

    通过 ``kwargs["components"]`` 可传入额外的组件字典参与检查。

    Returns:
        包含 ``healthy`` 布尔值与 ``components`` 详情字典。
    """
    components: dict[str, Any] = {}
    extra = kwargs.get("components") or {}
    if isinstance(extra, dict):
        components.update(extra)

    # 默认检查项
    for key in ("event_bus", "metrics_collector"):
        if key not in components:
            components[key] = "present" if kwargs.get(key) is not None else "missing"

    task_registry = kwargs.get("task_registry")
    components["task_registry"] = (
        f"{len(task_registry.list_handlers())} handlers"
        if task_registry is not None and hasattr(task_registry, "list_handlers")
        else "missing"
    )

    healthy = True
    for name, status in components.items():
        if isinstance(status, str) and status == "missing":
            healthy = False
            break

    logger.info(f"health_check: healthy={healthy}, components={components}")
    return {"healthy": healthy, "components": components}


async def cleanup_expired_events(*args: Any, **kwargs: Any) -> dict[str, Any]:
    """内置任务：清理过期事件.

    通过 ``kwargs["approval_hub"]`` 接收 :class:`ApprovalHub`，调用其
    ``purge_expired`` 清理过期审批；通过 ``kwargs["event_store"]`` 接收
    事件存储，调用其 ``cleanup_expired`` 清理过期事件（如果存在）。

    Returns:
        包含各子系统清理数量的字典。
    """
    cleaned: dict[str, int] = {}

    approval_hub = kwargs.get("approval_hub")
    if approval_hub is not None:
        purge_fn = getattr(approval_hub, "purge_expired", None)
        if purge_fn is not None:
            try:
                purged = purge_fn()
                if inspect.isawaitable(purged):
                    purged = await purged
                cleaned["approval_hub"] = int(purged) if isinstance(purged, (int, float)) else 0
                logger.info(f"cleanup_expired_events: approval_hub 清理 {cleaned['approval_hub']} 条")
            except Exception as exc:
                logger.error(f"cleanup_expired_events approval_hub 清理失败: {exc}")
                cleaned["approval_hub"] = 0
        else:
            cleaned["approval_hub"] = 0
            logger.debug("cleanup_expired_events: approval_hub 未实现 purge_expired")
    else:
        cleaned["approval_hub"] = 0

    event_store = kwargs.get("event_store")
    if event_store is not None:
        cleanup_fn = getattr(event_store, "cleanup_expired", None)
        if cleanup_fn is not None:
            try:
                cnt = cleanup_fn()
                if inspect.isawaitable(cnt):
                    cnt = await cnt
                cleaned["event_store"] = int(cnt) if isinstance(cnt, (int, float)) else 0
                logger.info(f"cleanup_expired_events: event_store 清理 {cleaned['event_store']} 条")
            except Exception as exc:
                logger.error(f"cleanup_expired_events event_store 清理失败: {exc}")
                cleaned["event_store"] = 0
        else:
            cleaned["event_store"] = 0
    else:
        cleaned["event_store"] = 0

    return {"cleaned": cleaned, "total": sum(cleaned.values())}


def create_default_registry() -> TaskRegistry:
    """创建包含内置任务处理函数的默认 :class:`TaskRegistry`.

    注册以下 4 个内置 handler:
        - ``daily_quota_reset``
        - ``metrics_summary_report``
        - ``health_check``
        - ``cleanup_expired_events``

    Returns:
        已注册内置 handler 的 :class:`TaskRegistry` 实例。
    """
    registry = TaskRegistry()
    registry.register("daily_quota_reset", daily_quota_reset)
    registry.register("metrics_summary_report", metrics_summary_report)
    registry.register("health_check", health_check)
    registry.register("cleanup_expired_events", cleanup_expired_events)
    return registry


# ── FlowForgeScheduler ───────────────────────────────────────────


class FlowForgeScheduler:
    """FlowForge 核心调度器（基于 APScheduler AsyncIOScheduler）.

    职责:
        1. 加载 YAML 任务配置（``load_configs_from_dir``）
        2. 注册 / 注销 / 暂停 / 恢复任务（``register_task`` 等）
        3. 任务执行（带超时 / 重试 / metrics / event_bus 上报）
        4. 执行历史管理（``get_execution_history``）

    与 :class:`flowforge.core.schedule_registry.ScheduleFactoryRegistry`
    的关系:
        ``ScheduleFactoryRegistry`` 治理 plugin-owned factory 白名单与
        deterministic runtime task id；``FlowForgeScheduler`` 在其之上
        封装 APScheduler 的具体执行能力。二者可独立使用，也可组合：上层
        先通过 ``ScheduleFactoryRegistry.allocate_task_id`` 拿到确定性
        task id，再用 ``FlowForgeScheduler.register_task`` 注册执行。

    依赖注入:
        ``metrics_collector`` 与 ``event_bus`` 通过构造函数注入，遵循
        编程红线 12（禁止绕过 DI 容器直接实例化）。

    使用示例::

        scheduler = FlowForgeScheduler(
            config_dir="config/scheduler",
            metrics_collector=metrics,
            event_bus=bus,
        )
        await scheduler.start()
        # ...
        await scheduler.shutdown()
    """

    def __init__(
        self,
        config_dir: str | Path | None = None,
        metrics_collector: Any = None,
        event_bus: Any = None,
        logger: Any = None,
    ) -> None:
        """初始化调度器（不启动）.

        Args:
            config_dir: 可选的 YAML 配置目录，传入则立即调用
                ``load_configs_from_dir`` 加载任务。
            metrics_collector: 可选的 :class:`MetricsCollector` 实例。
            event_bus: 可选的 :class:`EventBus` 实例。
            logger: 可选的 logger（默认使用 ``flowforge.core.scheduler``）。
        """
        self._scheduler = AsyncIOScheduler()
        self._task_registry = create_default_registry()
        self._task_configs: dict[str, ScheduledTaskConfig] = {}
        self._execution_history: dict[str, list[TaskExecutionResult]] = {}
        self._global_history: list[TaskExecutionResult] = []
        self._metrics = metrics_collector
        self._event_bus = event_bus
        self._logger = logger or get_logger("flowforge.core.scheduler")
        self._started = False

        if config_dir is not None:
            self.load_configs_from_dir(config_dir)

    # ── 生命周期 ─────────────────────────────────────────────────

    async def start(self) -> None:
        """启动调度器.

        若已启动则记录警告并直接返回。启动后 APScheduler 会按各任务
        trigger 触发 ``_execute_task``。
        """
        if self._started:
            self._logger.warning("FlowForgeScheduler 已启动，重复调用 start 被忽略")
            return
        self._scheduler.start()
        self._started = True
        self._logger.info("FlowForgeScheduler 已启动")

    async def shutdown(self, wait: bool = True) -> None:
        """关闭调度器.

        Args:
            wait: 是否等待正在执行的任务完成。
        """
        if not self._started:
            self._logger.debug("FlowForgeScheduler 未启动，shutdown 无操作")
            return
        try:
            self._scheduler.shutdown(wait=wait)
        except Exception as exc:
            self._logger.warning(f"FlowForgeScheduler shutdown 异常: {exc}")
        finally:
            self._started = False
            self._logger.info("FlowForgeScheduler 已关闭")

    # ── 配置加载 ─────────────────────────────────────────────────

    def load_configs_from_dir(self, dir_path: str | Path) -> int:
        """从 YAML 目录加载任务配置.

        读取 ``dir_path/*.yaml`` 文件，每个文件 top-level 必须为 mapping
        且包含 ``tasks: list`` 字段。每个 list 元素被解析为
        :class:`ScheduledTaskConfig` 后调用 :meth:`register_task`。

        Args:
            dir_path: YAML 配置目录路径。

        Returns:
            成功加载并注册的任务数量。

        Raises:
            FileNotFoundError: 目录不存在。
            ValueError: YAML 格式错误或字段校验失败。
        """
        path = Path(dir_path)
        if not path.exists():
            raise FileNotFoundError(f"配置目录不存在: {path}")
        if not path.is_dir():
            raise ValueError(f"配置路径不是目录: {path}")

        loaded_count = 0
        for yaml_file in sorted(path.glob("*.yaml")):
            try:
                with open(yaml_file, encoding="utf-8") as f:
                    data = yaml.safe_load(f)
            except yaml.YAMLError as exc:
                raise ValueError(f"YAML 解析错误 {yaml_file}: {exc}") from exc

            if data is None:
                continue
            if not isinstance(data, dict):
                raise ValueError(
                    f"{yaml_file} 根节点必须是 mapping，got {type(data).__name__}"
                )

            tasks_list = data.get("tasks", [])
            if not isinstance(tasks_list, list):
                raise ValueError(
                    f"{yaml_file} tasks 字段必须是 list，got {type(tasks_list).__name__}"
                )

            for idx, entry in enumerate(tasks_list):
                if not isinstance(entry, dict):
                    raise ValueError(
                        f"{yaml_file} tasks[{idx}] 必须是 mapping，got {type(entry).__name__}"
                    )
                try:
                    config = ScheduledTaskConfig(**entry)
                except Exception as exc:
                    raise ValueError(
                        f"{yaml_file} tasks[{idx}] 校验失败: {exc}"
                    ) from exc
                self.register_task(config)
                loaded_count += 1

        self._logger.info(f"从 {path} 加载了 {loaded_count} 个任务")
        return loaded_count

    # ── 任务注册 / 注销 / 暂停 / 恢复 ───────────────────────────

    def _build_trigger(self, config: ScheduledTaskConfig):
        """根据 trigger_type + trigger_args 构造 APScheduler Trigger.

        Args:
            config: 任务配置。

        Returns:
            :class:`CronTrigger` / :class:`IntervalTrigger` / :class:`DateTrigger`。

        Raises:
            ValueError: trigger_type 不支持。
        """
        if config.trigger_type == "cron":
            return CronTrigger(**config.trigger_args)
        if config.trigger_type == "interval":
            return IntervalTrigger(**config.trigger_args)
        if config.trigger_type == "date":
            return DateTrigger(**config.trigger_args)
        raise ValueError(f"不支持的 trigger_type: {config.trigger_type}")

    def register_task(self, config: ScheduledTaskConfig) -> str:
        """注册单个任务，返回 job_id.

        若 ``config.enabled`` 为 ``False``，仅记录配置，不向 APScheduler
        添加 job（可通过 :meth:`resume_task` 启用）。

        Args:
            config: 任务配置。

        Returns:
            job_id（等于 ``config.name``）。

        Raises:
            ValueError: 已存在同名任务。
        """
        if config.name in self._task_configs:
            raise ValueError(f"任务已存在: {config.name}")

        self._task_configs[config.name] = config

        if not config.enabled:
            self._logger.info(f"任务 {config.name} 已注册但被禁用，跳过 APScheduler add_job")
            return config.name

        trigger = self._build_trigger(config)
        self._scheduler.add_job(
            func=self._execute_task,
            trigger=trigger,
            args=[config],
            id=config.name,
            replace_existing=True,
            max_instances=config.max_instances,
            coalesce=config.coalesce,
            misfire_grace_time=config.misfire_grace_time,
        )
        self._logger.info(
            f"已注册任务: name={config.name} trigger={config.trigger_type} "
            f"handler={config.task_handler}"
        )
        return config.name

    def unregister_task(self, name: str) -> bool:
        """注销任务.

        从 APScheduler 移除 job 并清除内部配置与历史。

        Args:
            name: 任务名称。

        Returns:
            ``True`` 表示注销成功；``False`` 表示任务不存在。
        """
        if name not in self._task_configs:
            return False
        config = self._task_configs[name]
        if config.enabled:
            try:
                self._scheduler.remove_job(name)
            except Exception as exc:
                self._logger.warning(f"remove_job {name} 异常: {exc}")
        del self._task_configs[name]
        self._execution_history.pop(name, None)
        self._logger.info(f"已注销任务: {name}")
        return True

    def pause_task(self, name: str) -> bool:
        """暂停任务.

        Args:
            name: 任务名称。

        Returns:
            ``True`` 表示暂停成功；``False`` 表示任务不存在或已禁用。
        """
        if name not in self._task_configs:
            return False
        config = self._task_configs[name]
        if not config.enabled:
            return False
        try:
            self._scheduler.pause_job(name)
            self._logger.info(f"已暂停任务: {name}")
            return True
        except Exception as exc:
            self._logger.warning(f"pause_task {name} 异常: {exc}")
            return False

    def resume_task(self, name: str) -> bool:
        """恢复任务.

        Args:
            name: 任务名称。

        Returns:
            ``True`` 表示恢复成功；``False`` 表示任务不存在。
        """
        if name not in self._task_configs:
            return False
        config = self._task_configs[name]
        # 若任务此前被禁用，需要重新 add_job
        if not config.enabled:
            config.enabled = True
            try:
                trigger = self._build_trigger(config)
                self._scheduler.add_job(
                    func=self._execute_task,
                    trigger=trigger,
                    args=[config],
                    id=config.name,
                    replace_existing=True,
                    max_instances=config.max_instances,
                    coalesce=config.coalesce,
                    misfire_grace_time=config.misfire_grace_time,
                )
                self._logger.info(f"已恢复（重新注册）任务: {name}")
                return True
            except Exception as exc:
                self._logger.warning(f"resume_task {name} 重新注册异常: {exc}")
                config.enabled = False
                return False
        try:
            self._scheduler.resume_job(name)
            self._logger.info(f"已恢复任务: {name}")
            return True
        except Exception as exc:
            self._logger.warning(f"resume_task {name} 异常: {exc}")
            return False

    # ── 查询接口 ─────────────────────────────────────────────────

    def list_tasks(self) -> list[dict]:
        """列出所有任务及其下次执行时间.

        Returns:
            任务字典列表，每项含 ``name`` / ``enabled`` / ``trigger_type`` /
            ``task_handler`` / ``next_run_time`` / ``description``。
        """
        jobs = {j.id: j for j in self._scheduler.get_jobs()}
        result: list[dict] = []
        for name, config in self._task_configs.items():
            job = jobs.get(name)
            next_run_time = getattr(job, "next_run_time", None) if job is not None else None
            next_run = (
                next_run_time.isoformat() if next_run_time is not None else None
            )
            result.append({
                "name": name,
                "description": config.description,
                "enabled": config.enabled,
                "trigger_type": config.trigger_type,
                "trigger_args": config.trigger_args,
                "task_handler": config.task_handler,
                "next_run_time": next_run,
            })
        return result

    def get_task_status(self, name: str) -> dict:
        """获取任务状态.

        Args:
            name: 任务名称。

        Returns:
            状态字典，含 ``name`` / ``exists`` / ``enabled`` /
            ``next_run_time`` / ``last_execution``。

            未找到任务时返回 ``{"name": name, "exists": False}``。
        """
        if name not in self._task_configs:
            return {"name": name, "exists": False}
        config = self._task_configs[name]
        try:
            job = self._scheduler.get_job(name)
        except Exception:
            job = None
        next_run_time = getattr(job, "next_run_time", None) if job is not None else None
        next_run = (
            next_run_time.isoformat() if next_run_time is not None else None
        )
        history = self._execution_history.get(name, [])
        last_exec = history[-1].model_dump() if history else None
        return {
            "name": name,
            "exists": True,
            "enabled": config.enabled,
            "trigger_type": config.trigger_type,
            "task_handler": config.task_handler,
            "next_run_time": next_run,
            "last_execution": last_exec,
        }

    # ── 任务执行 ─────────────────────────────────────────────────

    async def _execute_task(self, config: ScheduledTaskConfig) -> TaskExecutionResult:
        """内部执行任务（由 APScheduler 调用）.

        流程:
            1. 从 :class:`TaskRegistry` 查找 handler
            2. 执行（带 ``timeout_seconds`` 超时）
            3. 失败按 ``retry_on_failure`` + ``max_retries`` +
               ``retry_delay_seconds`` 重试
            4. 上报 ``metrics_collector``（计数 + 时长）
            5. 发出 ``event_bus`` 事件（started / completed / failed）
            6. 存入执行历史

        Args:
            config: 任务配置。

        Returns:
            :class:`TaskExecutionResult`。
        """
        started_dt = datetime.now(UTC)
        started_at = started_dt.isoformat()
        start_perf = _perf_counter()

        # 注入运行期上下文（便于内置 handler 访问 DI 组件）
        runtime_kwargs = dict(config.task_kwargs)
        runtime_kwargs.setdefault("scheduler", self)
        runtime_kwargs.setdefault("event_bus", self._event_bus)
        runtime_kwargs.setdefault("metrics_collector", self._metrics)
        runtime_kwargs.setdefault("task_registry", self._task_registry)

        handler = self._task_registry.get(config.task_handler)
        if handler is None:
            finished_dt = datetime.now(UTC)
            result = TaskExecutionResult(
                task_name=config.name,
                success=False,
                started_at=started_at,
                finished_at=finished_dt.isoformat(),
                duration_seconds=_perf_counter() - start_perf,
                error=f"handler not found: {config.task_handler}",
                retry_count=0,
                result=None,
            )
            self._record_execution(result)
            self._emit_event("task.scheduled.failed", {
                "task_name": config.name,
                "error": result.error,
                "started_at": started_at,
            })
            self._record_metrics(config.name, success=False, duration=result.duration_seconds)
            return result

        # 发出 started 事件
        self._emit_event("task.scheduled.started", {
            "task_name": config.name,
            "handler": config.task_handler,
            "started_at": started_at,
        })

        # 执行 + 重试
        retry_count = 0
        last_error = ""
        handler_result: Any = None
        success = False

        max_attempts = (config.max_retries + 1) if config.retry_on_failure else 1
        for attempt in range(max_attempts):
            try:
                handler_result = await self._invoke_handler(
                    handler, config.task_args, runtime_kwargs, config.timeout_seconds
                )
                success = True
                break
            except TimeoutError:
                last_error = (
                    f"timeout after {config.timeout_seconds}s "
                    f"(attempt {attempt + 1}/{max_attempts})"
                )
                self._logger.warning(
                    f"任务 {config.name} 执行超时: {last_error}"
                )
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc} (attempt {attempt + 1}/{max_attempts})"
                self._logger.warning(
                    f"任务 {config.name} 执行失败: {last_error}"
                )

            # 是否还能重试
            if attempt < max_attempts - 1:
                retry_count += 1
                if config.retry_delay_seconds > 0:
                    await asyncio.sleep(config.retry_delay_seconds)
            else:
                break

        finished_dt = datetime.now(UTC)
        duration = _perf_counter() - start_perf
        result = TaskExecutionResult(
            task_name=config.name,
            success=success,
            started_at=started_at,
            finished_at=finished_dt.isoformat(),
            duration_seconds=duration,
            error="" if success else last_error,
            retry_count=retry_count,
            result=handler_result if success else None,
        )

        self._record_execution(result)
        self._record_metrics(config.name, success=success, duration=duration)

        if success:
            self._emit_event("task.scheduled.completed", {
                "task_name": config.name,
                "duration_seconds": duration,
                "retry_count": retry_count,
                "finished_at": result.finished_at,
            })
        else:
            self._emit_event("task.scheduled.failed", {
                "task_name": config.name,
                "error": last_error,
                "retry_count": retry_count,
                "duration_seconds": duration,
                "finished_at": result.finished_at,
            })

        return result

    async def _invoke_handler(
        self,
        handler: Callable,
        args: list[Any],
        kwargs: dict[str, Any],
        timeout_seconds: int,
    ) -> Any:
        """调用 handler（统一处理 sync/async + 超时）.

        Args:
            handler: 可调用对象。
            args: 位置参数。
            kwargs: 关键字参数。
            timeout_seconds: 超时秒数，``0`` 表示无超时。

        Returns:
            handler 返回值。

        Raises:
            asyncio.TimeoutError: 超时。
            Exception: handler 抛出的异常透传。
        """
        coro = self._call_handler(handler, args, kwargs)
        if timeout_seconds > 0:
            return await asyncio.wait_for(coro, timeout=timeout_seconds)
        return await coro

    async def _call_handler(
        self,
        handler: Callable,
        args: list[Any],
        kwargs: dict[str, Any],
    ) -> Any:
        """实际调用 handler，统一 sync/async 入口.

        若 handler 是协程函数则直接 await；否则将同步调用结果包装为
        awaitable（同步异常会立即抛出）。
        """
        result = handler(*args, **kwargs)
        if inspect.isawaitable(result):
            return await result
        return result

    # ── 历史 / 指标 / 事件 辅助 ─────────────────────────────────

    def _record_execution(self, result: TaskExecutionResult) -> None:
        """记录执行结果到 per-task 与 global 历史.

        历史上限:
            - per-task: ``_EXECUTION_HISTORY_LIMIT_PER_TASK``
            - global: ``_EXECUTION_HISTORY_LIMIT_GLOBAL``
        """
        history = self._execution_history.setdefault(result.task_name, [])
        history.append(result)
        if len(history) > _EXECUTION_HISTORY_LIMIT_PER_TASK:
            # 保留尾部最新
            del history[: len(history) - _EXECUTION_HISTORY_LIMIT_PER_TASK]

        self._global_history.append(result)
        if len(self._global_history) > _EXECUTION_HISTORY_LIMIT_GLOBAL:
            del self._global_history[: len(self._global_history) - _EXECUTION_HISTORY_LIMIT_GLOBAL]

    def _record_metrics(self, task_name: str, success: bool, duration: float) -> None:
        """上报 metrics（counter + histogram）."""
        if self._metrics is None:
            return
        try:
            inc = getattr(self._metrics, "inc_counter", None)
            obs = getattr(self._metrics, "observe_histogram", None)
            if callable(inc):
                inc(
                    "flowforge_scheduled_task_total",
                    labels={"task": task_name, "success": str(success).lower()},
                )
                if not success:
                    inc(
                        "flowforge_scheduled_task_failed_total",
                        labels={"task": task_name},
                    )
            if callable(obs):
                obs(
                    "flowforge_scheduled_task_duration_seconds",
                    duration,
                    labels={"task": task_name},
                )
        except Exception as exc:
            self._logger.warning(f"metrics 上报失败: {exc}")

    def _emit_event(self, event_type: str, payload: dict) -> None:
        """发出 event_bus 事件（无 event_bus 时静默跳过）."""
        if self._event_bus is None:
            return
        try:
            self._event_bus.emit("scheduler", event_type, payload)
        except Exception as exc:
            self._logger.warning(f"event_bus emit {event_type} 失败: {exc}")

    def get_execution_history(
        self,
        name: str | None = None,
        limit: int = 50,
    ) -> list[TaskExecutionResult]:
        """获取执行历史.

        Args:
            name: 任务名；``None`` 表示按全局合并历史返回。
            limit: 返回最近 N 条（按时间倒序，最新在前）。

        Returns:
            :class:`TaskExecutionResult` 列表（最新在前）。
        """
        if limit <= 0:
            return []
        if name is None:
            history = self._global_history
        else:
            history = self._execution_history.get(name, [])
        # 返回最新 N 条（倒序）
        return list(reversed(history[-limit:]))

    # ── 便捷访问 ─────────────────────────────────────────────────

    @property
    def task_registry(self) -> TaskRegistry:
        """暴露内部 :class:`TaskRegistry` 供外部注册自定义 handler."""
        return self._task_registry

    @property
    def started(self) -> bool:
        """调度器是否已启动."""
        return self._started


# ── 模块级辅助 ───────────────────────────────────────────────────


def _perf_counter() -> float:
    """包装 time.perf_counter，便于测试 mock."""
    import time
    return time.perf_counter()


__all__ = [
    "ScheduledTaskConfig",
    "TaskExecutionResult",
    "TaskRegistry",
    "FlowForgeScheduler",
    "daily_quota_reset",
    "metrics_summary_report",
    "health_check",
    "cleanup_expired_events",
    "create_default_registry",
]
