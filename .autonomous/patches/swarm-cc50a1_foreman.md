# 自主任务产出审阅

- **task_id**: swarm-cc50a12e5002
- **title**: 修复代码 TODO: flowforge\evolution\foreman.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-08-01T05:08:59.755104+00:00
- **source_file**: flowforge\evolution\foreman.py
- **required_capabilities**: code_generation

## 审阅指南

1. 检查产出的代码是否符合项目规范（CONTRIBUTING.md 15 条红线）
2. 检查是否引入循环依赖或违反分层架构
3. 通过审核后，将下方代码块内容应用到对应源文件
4. 应用后必须运行对应测试验证（铁律 T1-T8）

## 任务上下文

```
文件 flowforge\evolution\foreman.py 中发现 2 处 TODO/FIXME/NotImplementedError。请分析代码上下文并实现缺失的逻辑。
```

## LLM 产出内容

# 文件路径：flowforge/evolution/foreman.py

python

```
import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

from flowforge.core.logger import logger

@dataclass
class ForemanConfig:
    """Foreman 调度器配置参数"""
    loop_interval_seconds: float = 10.0
    emergency_poll_interval_seconds: float = 2.0
    max_concurrent_tasks: int = 5
    task_scan_limit: int = 8
    magic_words_stop: List[str] = field(
        default_factory=lambda: ["停止", "stop", "exit", "quit"]
    )
    magic_words_pause: List[str] = field(
        default_factory=lambda: ["暂停", "pause", "hold"]
    )
    magic_words_resume: List[str] = field(
        default_factory=lambda: ["继续", "resume", "go"]
    )

@dataclass
class ForemanStats:
    """Foreman 运行统计."""
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    total_loops: int = 0
    total_tasks_dispatched: int = 0
    total_tasks_completed: int = 0
    total_tasks_failed: int = 0
    total_emergencies: int = 0
    last_loop_at: Optional[datetime] = None
    last_task_at: Optional[datetime] = None
    current_state: str = "idle"  # idle / running / paused / stopped

class ContinuousForeman:
    """五Forgekin持续工作调度器（永不停止）.
    参考 FlowForge 5 agent sweet spot 模式：
    - 5 个Forgekin永远不停止工作
    - foreman 持续扫描任务源 → 分发 → 监控 → 循环
    - operator 通过 Magic Words 干预（停止/暂停/继续）

    用法：
    from flowforge.evolution.runtime import SelfDevRuntime
    from flowforge.evolution.foreman import ContinuousForeman

    runtime = SelfDevRuntime.bootstrap(approval_mode="manual")
    foreman = ContinuousForeman(runtime)
    await foreman.start()  # 永不停止，直到 operator 喊 Magic Words
    """

    def __init__(
        self,
        runtime: Any,  # SelfDevRuntime 实例（避免循环导入用 Any）
        *,
        config: Optional[ForemanConfig] = None,
        swarm_coordinator: Optional[Any] = None,
    ) -> None:
        """初始化 Foreman.
        Args:
            runtime: SelfDevRuntime 实例（提供 5 个 run_xxx_loop 方法）
            config: Foreman 配置（None 用默认）
            swarm_coordinator: SwarmCoordinator 实例（None 在第一次 start 时创建）
        """
        self._runtime = runtime
        self._config = config or ForemanConfig()
        self._swarm = swarm_coordinator

        # 运行状态
        self._stats = ForemanStats()
        self._task: Optional[asyncio.Task] = None  # 主循环 task
        self._emergency_queue: asyncio.Queue = asyncio.Queue()
        self._running_tasks: Dict[str, asyncio.Task] = {}  # task_id -> asyncio.Task

        # Magic Words 监听（通过 stdin 或 IM 通道）
        self._magic_words_callback: Optional[Callable[[str], Awaitable[Optional[str]]]] = None

        # 状态标志
        self._stop_requested = False
        self._pause_requested = False
        self._logger = logger

        self._logger.info(
            f"ContinuousForeman 初始化: interval={self._config.loop_interval_seconds}s, "
            f"max_concurrent={self._config.max_concurrent_tasks}"
        )

    # ══════════════════════════════════════════════════════════════
    # §1 生命周期 — start / pause / resume / stop
    # ══════════════════════════════════════════════════════════════
    async def start(self) -> None:
        """启动持续调度循环（永不停止，直到 stop()）.
        启动后：
        - 主循环 task 持续运行（每 loop_interval_seconds 触发一次）
        - 紧急任务监听 task 并发运行
        - Magic Words 监听 task 并发运行（如配置）
        """
        if self._task is not None and not self._task.done():
            self._logger.warning("Foreman 已在运行，忽略重复 start()")
            return

        self._stop_requested = False
        self._pause_requested = False
        self._stats = ForemanStats(current_state="running")
        self._logger.info(
            "Foreman 启动 — 5 Forgekin持续工作模式（5 agent sweet spot）"
        )

        # 懒加载 SwarmCoordinator（避免 import 时硬依赖）
        if self._swarm is None:
            self._swarm = self._create_swarm_coordinator()

        # 启动主循环 task
        self._task = asyncio.create_task(self._main_loop(), name="foreman-main")
        # 启动紧急任务监听 task
        asyncio.create_task(
            self._emergency_loop(), name="foreman-emergency"
        )
        # 启动 Magic Words 监听 task（如配置）
        if self._magic_words_callback is not None:
            asyncio.create_task(
                self._magic_words_loop(), name="foreman-magic-words"
            )

    async def stop(self, reason: str = "operator requested") -> None:
        """停止 Foreman（operator 显式停止）.
        Args:
            reason: 停止原因（记录到日志）
        """
        self._logger.info(f"Foreman 停止请求: reason={reason}")
        self._stop_requested = True
        self._stats.current_state = "stopped"

        # 取消主循环 task
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

        # 等待所有运行中的任务完成（最多 30 秒）
        if self._running_tasks:
            self._logger.info(
                f"等待 {len(self._running_tasks)} 个运行中任务完成..."
            )
            done, pending = await asyncio.wait(
                list(self._running_tasks.values()), timeout=30.0,
            )
            for task in pending:
                task.cancel()
            self._running_tasks.clear()

        self._logger.info(
            f"Foreman 已停止: total_loops={self._stats.total_loops}, "
            f"dispatched={self._stats.total_tasks_dispatched}, "
            f"completed={self._stats.total_tasks_completed}, "
            f"failed={self._stats.total_tasks_failed}"
        )

    async def pause(self, reason: str = "operator requested") -> None:
        """暂停 Foreman（不停止，可 resume）."""
        self._logger.info(f"Foreman 暂停: reason={reason}")
        self._pause_requested = True
        self._stats.current_state = "paused"

    async def resume(self) -> None:
        """恢复 Foreman."""
        self._logger.info("Foreman 恢复")
        self._pause_requested = False
        self._stats.current_state = "running"

    def set_magic_words_callback(
        self, callback: Callable[[str], Awaitable[Optional[str]]]
    ) -> None:
        """设置 Magic Words 监听回调.
        callback 收到原始文本，由 foreman 内部解析是否为 Magic Words.
        """
        self._magic_words_callback = callback

    # ══════════════════════════════════════════════════════════════
    # §2 主循环 — 持续扫描 + 分发 + 监控
    # ══════════════════════════════════════════════════════════════
    async def _main_loop(self) -> None:
        """主循环 — 每 loop_interval_seconds 触发一次扫描 + 分发."""
        try:
            while not self._stop_requested:
                if self._pause_requested:
                    await asyncio.sleep(self._config.loop_interval_seconds)
                    continue

                self._stats.total_loops += 1
                self._stats.last_loop_at = datetime.now(timezone.utc)
                self._logger.debug(
                    f"Foreman 主循环 #{self._stats.total_loops} 启动"
                )
                try:
                    # 1. 扫描任务源
                    tasks = await self._scan_task_sources(
                        limit=self._config.task_scan_limit
                    )
                    # 2. 提交到 SwarmCoordinator
                    for task in tasks:
                        self._submit_to_swarm(task)
                    # 3. 分发任务到 5 Forgekin
                    dispatched = []
                    if self._swarm is not None:
                        dispatched = await self._swarm.dispatch()
                        self._stats.total_tasks_dispatched += len(dispatched)
                    # 4. 为每个分发的任务启动执行 task
                    for task_id in dispatched:
                        await self._start_task_execution(task_id)
                    # 5. 检查超时任务
                    if self._swarm is not None:
                        reassigned = await self._swarm.check_timeouts()
                        if reassigned:
                            self._logger.info(
                                f"Foreman 检测到 {len(reassigned)} 个超时任务已 reassign"
                            )
                    # 6. 清理已完成的执行 task
                    self._cleanup_completed_tasks()
                except Exception as e:
                    self._logger.exception(f"Foreman 主循环异常: {e}")
                # 等待下一次循环
                await asyncio.sleep(self._config.loop_interval_seconds)
        except asyncio.CancelledError:
            self._logger.info("Foreman 主循环被取消")
            raise
        finally:
            self._stats.current_state = "stopped"

    async def _emergency_loop(self) -> None:
        """紧急任务监听循环 — 高频轮询 emergency_queue."""
        try:
            while not self._stop_requested:
                try:
                    # 非阻塞获取紧急任务
                    task_data = await asyncio.wait_for(
                        self._emergency_queue.get(),
                        timeout=self._config.emergency_poll_interval_seconds,
                    )
                    self._stats.total_emergencies += 1
                    self._logger.warning(
                        f"Foreman 接收到紧急任务: {task_data.get('title', '')}"
                    )
                    # 紧急任务立即提交并分发
                    self._submit_to_swarm(task_data)
                    if self._swarm is not None:
                        dispatched = await self._swarm.dispatch()
                        for task_id in dispatched:
                            await self._start_task_execution(task_id)
                except asyncio.TimeoutError:
                    continue
        except asyncio.CancelledError:
            self._logger.info("Foreman 紧急任务监听被取消")
            raise

    async def _magic_words_loop(self) -> None:
        """Magic Words 监听循环."""
        if self._magic_words_callback is None:
            return
        try:
            while not self._stop_requested:
                try:
                    # 由 callback 提供原始文本（阻塞等待 operator 输入）
                    text = await self._magic_words_callback("")
                    if not text:
                        continue
                    text_lower = text.lower().strip()
                    # 检查 Magic Words
                    if any(w in text_lower for w in self._config.magic_words_stop):
                        await self.stop(reason=f"Magic Words: {text}")
                        break
                    elif any(w in text_lower for w in self._config.magic_words_pause):
                        await self.pause(reason=f"Magic Words: {text}")
                    elif any(w in text_lower for w in self._config.magic_words_resume):
                        await self.resume()
                    else:
                        self._logger.debug(f"非 Magic Words 输入: {text}")
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    self._logger.exception(f"Magic Words 监听异常: {e}")
                await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            self._logger.info("Foreman Magic Words 监听被取消")
            raise

    # ══════════════════════════════════════════════════════════════
    # §3 任务源扫描
    # ══════════════════════════════════════════════════════════════
    async def _scan_task_sources(self, limit: int = 5) -> List[Dict[str, Any]]:
        """扫描所有任务源，返回待处理任务列表.
        任务源优先级：
        1. operator 提交的显式任务（通过 submit_operator_task）
        2. Eval Ledger 失败信号
        3. task.md 中 ⏳/🔄 状态的任务
        4. 定时扫描（文档过期/代码 bug 等）
        Args:
            limit: 最多返回的任务数
        Returns:
            任务字典列表，每个含 title/description/required_capabilities/loop_type 等
        """
        tasks: List[Dict[str, Any]] = []
        # 任务源 1: operator 显式提交的任务（通过 emergency_queue 或 submit_operator_task）
        # 已在 _emergency_loop 中处理，这里不重复
        # 任务源 2: Eval Ledger 失败信号
        try:
            from flowforge.evolution.eval_ledger import EvalLedger
            eval_ledger = EvalLedger()
            eval_tasks = await eval_ledger.scan_failed_evals()
            tasks.extend(eval_tasks)
        except ImportError:
            self._logger.debug("EvalLedger 模块未就绪，跳过失败任务扫描")
        # 任务源 3: task.md 中 ⏳/🔄 状态的任务
        task_md_tasks = await self._scan_task_md()
        tasks.extend(task_md_tasks)
        # 任务源 4: 定时扫描（文档过期等）
        scan_tasks = await self._scan_periodic()
        tasks.extend(scan_tasks)
        # 按优先级排序 + 限制数量
        priority_map = {"critical": 0, "emergency": 0, "high": 1, "normal": 2, "low": 3}
        tasks = sorted(tasks, key=lambda t: priority_map.get(t.get("priority", "normal"), 99))
        return tasks[:limit]

    async def _scan_task_md(self) -> List[Dict[str, Any]]:
        """扫描 task.md 中的待办任务.
        Returns:
            任务字典列表
        """
        try:
            from flowforge.core.task_markdown import TaskMarkdownLoader
            loader = TaskMarkdownLoader()
            pending_tasks = await loader.scan_pending_tasks()
            return pending_tasks
        except ImportError:
            self._logger.debug("TaskMarkdownLoader 不存在，跳过 task.md 扫描")
            return []

    async def _scan_periodic(self) -> List[Dict[str, Any]]:
        """定时扫描任务源（文档过期/代码 bug 等）.
        触发的 SelfDev 闭环：
        - 文档过期 → doc 闭环（wenxin）
        - 代码 bug → code 闭环（sherlock）
        - 架构偏离 → framework 闭环（luban, I8 approval）
        - 审查缺失 → review 闭环（vangogh）
        - 测试覆盖率下降 → test 闭环（davinci）
        Returns:
            任务字典列表
        """
        # 低频扫描（每 10 次主循环才触发一次）
        if self._stats.total_loops % 10 != 0:
            return []
        periodic_tasks = []
        try:
            from flowforge.evolution.scan import DocExpiryScanner, CodeHealthScanner
            doc_scanner = DocExpiryScanner()
            expired_docs = await doc_scanner.scan()
            for doc_info in expired_docs:
                periodic_tasks.append({
                    "title": f"文档过期更新：{doc_info['path']}",
                    "description": "SelfDevDocLoop Discover 阶段扫描过期文档",
                    "required_capabilities": ["doc_generation"],
                    "loop_type": "doc",
                    "forgekin_id": "wenxin",
                    "priority": "low",
                    "context": {"task_source": "periodic_scan", "target_path": doc_info["path"]},
                })
            code_scanner = CodeHealthScanner()
            code_issues = await code_scanner.scan_defects()
            for issue in code_issues:
                periodic_tasks.append({
                    "title": f"代码缺陷修复：{issue['file']}",
                    "description": "定时扫描发现代码静态缺陷",
                    "required_capabilities": ["code_generation", "bug_fixing"],
                    "loop_type": "code",
                    "forgekin_id": "sherlock",
                    "priority": "normal",
                    "context": {"task_source": "periodic_scan", "target_path": issue["file"]},
                })
        except ImportError:
            self._logger.debug("周期性扫描模块未就绪，跳过自动巡检")
        return periodic_tasks

    # ══════════════════════════════════════════════════════════════
    # §4 任务执行
    # ══════════════════════════════════════════════════════════════
    def _submit_to_swarm(self, task_data: Dict[str, Any]) -> None:
        """提交任务到 SwarmCoordinator.
        Args:
            task_data: 任务字典（含 title/description/required_capabilities 等）
        """
        if self._swarm is None:
            self._logger.warning("SwarmCoordinator 未初始化，任务无法提交")
            return
        # 懒导入 SwarmTask（避免 import 时硬依赖）
        try:
            SwarmTask = self._import_swarm_task()
        except ImportError as e:
            self._logger.error(f"无法导入 SwarmTask: {e}")
            return
        try:
            task = SwarmTask(
                title=task_data.get("title", ""),
                description=task_data.get("description", ""),
                required_capabilities=task_data.get("required_capabilities", []),
                preferred_agent_id=task_data.get("forgekin_id"),
                priority=task_data.get("priority", "normal"),
                context=task_data.get("context", {}),
            )
            self._swarm.submit_task(task)
            self._logger.info(
                f"任务提交到 Swarm: id={task.task_id}, title={task.title}, "
                f"priority={task.priority}"
            )
            task_data["task_id"] = task.task_id
        except Exception as e:
            self._logger.exception(f"提交任务到 Swarm 失败: {e}")

    async def _start_task_execution(self, task_id: str) -> None:
        """为已分发的任务启动执行 task.
        根据 task 的 loop_type 路由到对应的 SelfDev 闭环：
       

```