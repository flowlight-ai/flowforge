"""F052 Autonomous Daemon — 5 Forgekin 24h 自主运行守护进程.

本模块实现灵智体自主工作循环（类似 clowder-ai 的自主工作功能）：

    1. 扫描项目 — 发现文档缺失/代码 TODO/测试缺失/架构问题
    2. 提交任务 — 将发现的问题作为 SwarmTask 提交给 SwarmCoordinator
    3. 调度分发 — SwarmCoordinator.run_continuously() 按 I3 能力匹配分发
    4. 执行任务 — 调用灵智体 LLM 真实生成文档/修复代码/编写测试
    5. 心跳上报 — heartbeat 上报进度，progress=1.0 自动完成
    6. 循环往复 — 每 scan_interval 秒扫描一次，24h 不间断

设计依据：
    - F049 Agent Swarm（SwarmCoordinator 调度）
    - F046 SelfDev Triple Loop（自进化三模式）
    - clowder-ai 自主工作模式参考
    - 铁律 2：禁止假数据 — 所有扫描真实读取文件系统
    - 铁律 3：禁止 Mock LLM — 任务执行通过 forgekin.chat() 真实调用 LLM
    - 红线 11：路径通过 config 注入，不硬编码

License: MIT
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import yaml

from flowforge.core.tracing import get_logger
from flowforge.forgemind.swarm import (
    SwarmCoordinator,
    SwarmTask,
    SwarmTaskStatus,
)

logger = get_logger("flowforge.forgemind.autonomous")


# ──────────────────────────────────────────────────────────────────
# 默认配置（可通过 YAML 覆盖，红线 11）
# ──────────────────────────────────────────────────────────────────

DEFAULT_SCAN_INTERVAL_SECONDS = 600  # 10 分钟扫描一次（operator 要求 10min 自动找需求）
DEFAULT_MAX_CONCURRENT_TASKS = 3  # 同时执行的最大任务数
DEFAULT_MAX_TASKS_PER_SCAN = 5  # 每次扫描最多提交的任务数

# 文档缺失检查清单（相对项目根目录）
DOC_CHECKLIST = [
    "docs/spec.md",
    "docs/arch.md",
]

# TODO/FIXME 模式（红线 11：不硬编码，但正则模式是技术常量）
TODO_PATTERNS = [
    re.compile(r"#\s*TODO[:\s]", re.IGNORECASE),
    re.compile(r"#\s*FIXME[:\s]", re.IGNORECASE),
    re.compile(r"raise\s+NotImplementedError", re.IGNORECASE),
    re.compile(r"pass\s*#\s*placeholder", re.IGNORECASE),
]

# 扫描需排除的第三方/生成目录（Bug 3 修复）
# rglob 默认扫入 .venv（63MB 第三方包）、.git、node_modules 等，
# 导致大量无效 TODO 任务与性能开销。目录名按 parts 匹配（任意层级）。
SCAN_EXCLUDED_DIRS = frozenset({
    ".venv",
    "venv",
    "env",
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "__pycache__",
    "site-packages",
    "build",
    "dist",
    ".next",
    ".nuxt",
    ".cache",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".eggs",
    ".autonomous",
    "logs",
    "data",
})


class AutonomousDaemon:
    """5 灵智体 24h 自主运行守护进程.

    职责：
        1. 定期扫描项目，发现任务（文档缺失/TODO/测试缺失等）
        2. 提交任务给 SwarmCoordinator
        3. 监听分配结果，调用灵智体 LLM 执行任务
        4. 通过 heartbeat 上报进度
        5. 完成后任务自动标记 COMPLETED

    使用示例::

        daemon = AutonomousDaemon(
            coordinator=coord,
            project_root=Path("d:/software/openclaw"),
            forgekins={"forgemind:wenxin": wenkin_instance, ...},
        )
        await daemon.run_forever()
    """

    def __init__(
        self,
        coordinator: SwarmCoordinator,
        project_root: Path,
        forgekins: Optional[dict[str, Any]] = None,
        config: Optional[dict[str, Any]] = None,
    ) -> None:
        """初始化自主运行 daemon.

        Args:
            coordinator: SwarmCoordinator 实例（已注册 5 灵智体）
            project_root: 项目根目录（扫描范围）
            forgekins: 灵智体实例字典 {forgekin_id: ForgekinBase}
            config: 配置字典（可覆盖默认扫描间隔等）
        """
        self._coord = coordinator
        self._root = Path(project_root)
        self._forgekins = forgekins or {}
        self._config = config or {}
        self._scan_interval = int(
            self._config.get("scan_interval_seconds", DEFAULT_SCAN_INTERVAL_SECONDS)
        )
        self._max_concurrent = int(
            self._config.get("max_concurrent_tasks", DEFAULT_MAX_CONCURRENT_TASKS)
        )
        self._max_tasks_per_scan = int(
            self._config.get("max_tasks_per_scan", DEFAULT_MAX_TASKS_PER_SCAN)
        )
        # Bug 1 修复：任务消费循环间隔（默认 5s，与 SwarmCoordinator dispatch 节奏对齐）
        self._consumer_interval = float(
            self._config.get("consumer_interval_seconds", 5.0)
        )
        self._running = False
        self._dispatch_task: Optional[asyncio.Task] = None
        # Bug 1 修复：后台任务消费循环（持续执行 ASSIGNED 任务）
        self._consumer_task: Optional[asyncio.Task] = None
        # 执行器任务追踪集合（防 GC 提前回收，done 时自动移除）
        self._executor_tasks: set[asyncio.Task] = set()
        # 任务标题 → 最新 task_id 映射（用于状态感知的去重，避免死循环）
        # 替代原 _submitted_titles 集合：原集合永久保留标题，导致已完成/失败任务无法重新提交
        self._title_to_task_id: dict[str, str] = {}
        # 自进化活动历史（最近 200 条，供 API 和可观测性查询）
        self._activity_log: list[dict[str, Any]] = []
        # 已完成任务的产出（供 Web 可观测性展示）
        self._completed_outputs: list[dict[str, Any]] = []
        # 扫描计数
        self._scan_count = 0

        logger.info(
            "AutonomousDaemon 初始化: root=%s scan_interval=%ds max_concurrent=%d",
            self._root,
            self._scan_interval,
            self._max_concurrent,
        )

    def _log_activity(self, event_type: str, title: str, **extra: Any) -> None:
        """记录自进化活动（供 API 和 Web 可观测性查询）.

        event_type 取值:
            - scan_started / scan_completed
            - task_discovered / task_submitted / task_assigned
            - task_started / task_completed / task_failed
            - daemon_started / daemon_stopped
        """
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event_type": event_type,
            "title": title,
            **extra,
        }
        self._activity_log.append(entry)
        # 保留最近 200 条
        if len(self._activity_log) > 200:
            self._activity_log = self._activity_log[-200:]
        # 同时写入 INFO 日志（供 logs 端点采集）
        logger.info("[ACTIVITY] %s: %s %s", event_type, title, extra or "")

    def _is_task_in_progress(self, title: str) -> bool:
        """状态感知的任务去重检查（修复死循环 Bug）.

        检查给定标题对应的最新任务在 SwarmCoordinator 中的状态：
            - PENDING/ASSIGNED/RUNNING → True（进行中，跳过提交）
            - COMPLETED/FAILED/CANCELLED/REASSIGNED → False（已结束，允许重新提交）
            - 未找到 task_id 或任务不存在 → False（首次提交或被清理）

        这取代了原 `_submitted_titles` 集合的永久去重逻辑：
        原逻辑导致已完成的"补充缺失文档"任务无法重新提交，
        使 daemon 陷入"扫描发现2个潜在任务但0个提交"的死循环。

        Args:
            title: 任务标题.

        Returns:
            True 表示任务仍在进行中（应跳过），False 表示可重新提交.
        """
        task_id = self._title_to_task_id.get(title)
        if task_id is None:
            return False  # 从未提交过，允许提交
        task = self._coord._tasks.get(task_id)
        if task is None:
            return False  # 任务已被清理，允许重新提交
        in_progress_states = {
            SwarmTaskStatus.PENDING,
            SwarmTaskStatus.ASSIGNED,
            SwarmTaskStatus.RUNNING,
        }
        return task.status in in_progress_states

    def register_forgekin(self, forgekin_id: str, forgekin: Any) -> None:
        """注册灵智体实例（用于执行任务时调用 LLM）."""
        self._forgekins[forgekin_id] = forgekin
        logger.info("AutonomousDaemon 注册灵智体: %s", forgekin_id)

    async def run_forever(self) -> None:
        """主循环 — 24h 持续运行.

        流程：
            1. 启动 SwarmCoordinator.run_continuously() 后台调度
            2. 每隔 scan_interval 秒扫描项目
            3. 提交发现的任务
            4. 执行已分配的任务
            5. 循环往复
        """
        self._running = True
        logger.info("AutonomousDaemon 启动 — 5 灵智体开始 24h 自主运行")
        self._log_activity("daemon_started", "AutonomousDaemon 启动", scan_interval=self._scan_interval)

        # 启动 SwarmCoordinator 后台调度循环
        self._dispatch_task = asyncio.create_task(
            self._coord.run_continuously(interval=5.0)
        )
        logger.info("SwarmCoordinator 后台调度已启动")

        # Bug 1 修复：启动后台任务消费循环（持续执行 ASSIGNED 任务）
        # 原实现仅在扫描轮执行任务，导致扫描间隔内新分配的任务无人执行而超时失败
        self._consumer_task = asyncio.create_task(self._task_consumer_loop())
        logger.info(
            "任务消费循环已启动（interval=%ss, max_concurrent=%d）",
            self._consumer_interval,
            self._max_concurrent,
        )

        scan_count = 0
        while self._running:
            scan_count += 1
            try:
                logger.info("=== 自主扫描第 %d 轮 ===", scan_count)
                self._scan_count = scan_count
                self._log_activity("scan_started", f"第 {scan_count} 轮自主扫描")

                # 1. 扫描项目，发现任务
                tasks = self._scan_project()
                logger.info("扫描发现 %d 个潜在任务", len(tasks))
                self._log_activity("scan_completed", f"扫描完成：发现 {len(tasks)} 个潜在任务", scan_round=scan_count)

                # 2. 提交任务（状态感知去重 + 限量）
                # 去重策略：基于 task.title 查询 SwarmCoordinator 中的最新 task 状态
                #   - PENDING/ASSIGNED/RUNNING → 跳过（避免重复提交正在处理的任务）
                #   - COMPLETED/FAILED/CANCELLED/REASSIGNED/None → 允许重新提交（允许重试/重新发现）
                # 这修复了原 _submitted_titles 永久保留导致已完成任务无法重新提交的死循环 Bug
                submitted = 0
                for task in tasks[: self._max_tasks_per_scan]:
                    if self._is_task_in_progress(task.title):
                        continue
                    self._coord.submit_task(task)
                    self._title_to_task_id[task.title] = task.task_id
                    submitted += 1
                    logger.info(
                        "提交任务: [%s] %s → 需要: %s",
                        task.task_id[:12],
                        task.title,
                        task.required_capabilities,
                    )
                    self._log_activity(
                        "task_submitted",
                        task.title,
                        task_id=task.task_id,
                        required_capabilities=task.required_capabilities,
                    )

                # 3. 等待 dispatch 分发
                # 注：任务执行不再在此处进行（Bug 1 修复）——
                # 由后台 _task_consumer_loop 持续消费 ASSIGNED 任务，
                # 避免扫描间隔内新分配的任务无人执行而心跳超时。
                await asyncio.sleep(1)

                # 4. 等待下一轮扫描
                logger.info(
                    "本轮完成: 提交 %d 个任务，等待 %ds 后下一轮",
                    submitted,
                    self._scan_interval,
                )
                await asyncio.sleep(self._scan_interval)

            except asyncio.CancelledError:
                logger.info("AutonomousDaemon 收到取消信号，正在停止")
                break
            except Exception as exc:  # noqa: BLE001
                logger.error("AutonomousDaemon 循环异常: %s", exc, exc_info=True)
                await asyncio.sleep(60)  # 出错后等 1 分钟再重试

        # 清理：停止任务消费循环
        if self._consumer_task and not self._consumer_task.done():
            self._consumer_task.cancel()
            try:
                await self._consumer_task
            except asyncio.CancelledError:
                pass
        # 等待执行器任务结束（最多 5s，避免强制中断正在执行的 LLM 调用）
        if self._executor_tasks:
            done, pending = await asyncio.wait(
                self._executor_tasks, timeout=5.0
            )
            for t in pending:
                t.cancel()
        # 停止 SwarmCoordinator 调度循环
        if self._dispatch_task and not self._dispatch_task.done():
            self._dispatch_task.cancel()
            try:
                await self._dispatch_task
            except asyncio.CancelledError:
                pass
        logger.info("AutonomousDaemon 已停止（共扫描 %d 轮）", scan_count)
        self._log_activity("daemon_stopped", "AutonomousDaemon 已停止", total_scans=scan_count)

    def stop(self) -> None:
        """停止自主运行."""
        self._running = False
        logger.info("AutonomousDaemon 收到停止指令")

    # ── 项目扫描（真实文件系统操作，铁律 2：禁止假数据）──────────

    def _scan_project(self) -> list[SwarmTask]:
        """扫描项目，发现任务.

        扫描内容：
            1. 文档缺失（docs/spec.md / docs/arch.md 等）
            2. 代码 TODO/FIXME/NotImplementedError
            3. 测试缺失（有模块无测试）

        Returns:
            发现的 SwarmTask 列表
        """
        tasks: list[SwarmTask] = []
        tasks.extend(self._scan_missing_docs())
        tasks.extend(self._scan_code_todos())
        tasks.extend(self._scan_missing_tests())
        return tasks

    def _scan_missing_docs(self) -> list[SwarmTask]:
        """扫描缺失的文档（文心 doc_generation 任务）."""
        tasks: list[SwarmTask] = []
        for doc_rel_path in DOC_CHECKLIST:
            doc_path = self._root / doc_rel_path
            if not doc_path.exists():
                tasks.append(SwarmTask(
                    title=f"补充缺失文档: {doc_rel_path}",
                    description=(
                        f"项目根目录下 {doc_rel_path} 文件不存在。"
                        f"请根据项目实际结构生成对应文档，"
                        f"包含项目概述、架构设计、使用说明等。"
                    ),
                    required_capabilities=["doc_generation"],
                    priority="normal",
                    context={"scan_source": "autonomous", "doc_path": doc_rel_path},
                ))
        return tasks

    def _scan_code_todos(self) -> list[SwarmTask]:
        """扫描代码中的 TODO/FIXME/NotImplementedError（夏洛克 code_generation 任务）."""
        tasks: list[SwarmTask] = []
        todo_count = 0

        # 扫描 flowforge 目录下的 .py 文件（限制范围避免过多）
        src_dir = self._root / "flowforge"
        if not src_dir.is_dir():
            return tasks

        for py_file in src_dir.rglob("*.py"):
            # 跳过 tests 与第三方/生成目录（Bug 3 修复：排除 .venv 等）
            if "tests" in py_file.parts or SCAN_EXCLUDED_DIRS.intersection(py_file.parts):
                continue
            try:
                content = py_file.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue

            for pattern in TODO_PATTERNS:
                matches = pattern.findall(content)
                if matches:
                    todo_count += len(matches)
                    rel_path = py_file.relative_to(self._root)
                    task_title = f"修复代码 TODO: {rel_path}"
                    if not self._is_task_in_progress(task_title):
                        tasks.append(SwarmTask(
                            title=task_title,
                            description=(
                                f"文件 {rel_path} 中发现 {len(matches)} 处 "
                                f"TODO/FIXME/NotImplementedError。"
                                f"请分析代码上下文并实现缺失的逻辑。"
                            ),
                            required_capabilities=["code_generation"],
                            priority="normal",
                            context={
                                "scan_source": "autonomous",
                                "file": str(rel_path),
                                "count": len(matches),
                            },
                        ))
                    break  # 同一文件只提交一个任务

        if todo_count > 0:
            logger.info("代码扫描: 发现 %d 处 TODO/FIXME", todo_count)
        return tasks

    def _scan_missing_tests(self) -> list[SwarmTask]:
        """扫描缺失的测试文件（达芬奇 test_generation 任务）.

        测试查找策略（按优先级）：
            1. 精确命名匹配：``tests/test_{mod_name}.py`` 或 ``tests/{sub}/test_{mod_name}.py``
            2. 模糊命名匹配：``tests/**/test_*{mod_name}*.py``（含模块名的测试文件，如 test_cl031_auto_dream.py）
            3. 内容 import 匹配：测试文件中 import 该模块的（最准确但开销大）

        修复 Bug：原逻辑只检查精确命名，导致 test_cl031_auto_dream.py 被漏检，
        误判 ``evolution/auto_dream.py`` 缺少测试，触发"补充测试"任务循环。
        """
        tasks: list[SwarmTask] = []
        src_dir = self._root / "flowforge"
        tests_dir = self._root / "flowforge" / "tests"

        if not src_dir.is_dir():
            return tasks

        # 扫描核心模块，检查是否有对应测试
        core_modules = [
            "forgemind/swarm.py",
            "forgemind/base.py",
            "evolution/auto_dream.py",
        ]

        for mod_rel in core_modules:
            mod_path = self._root / "flowforge" / mod_rel
            if not mod_path.exists():
                continue

            mod_name = Path(mod_rel).stem
            # 1. 精确命名匹配
            test_candidates = [
                tests_dir / f"test_{mod_name}.py",
                tests_dir / mod_name / f"test_{mod_name}.py",
                tests_dir / "unit" / f"test_{mod_name}.py",
                tests_dir / "integration" / f"test_{mod_name}.py",
            ]
            # 模块自身目录下的 tests（如 flowforge/forgemind/tests/）
            mod_dir = mod_path.parent / "tests"
            if mod_dir.is_dir():
                test_candidates.append(mod_dir / f"test_{mod_name}.py")

            has_test = any(t.exists() for t in test_candidates)

            # 2. 模糊命名匹配：tests 目录递归查找包含 mod_name 的 test_*.py
            if not has_test:
                for test_file in tests_dir.rglob(f"test_*{mod_name}*.py"):
                    if SCAN_EXCLUDED_DIRS.intersection(test_file.parts):
                        continue
                    has_test = True
                    break

            # 3. 内容 import 匹配：查找 import 该模块的测试文件
            if not has_test:
                # 构造模块的 import 路径，如 "flowforge.forgemind.swarm"
                mod_import = f"flowforge.{mod_rel.replace('/', '.').replace('.py', '')}"
                for test_file in tests_dir.rglob("test_*.py"):
                    if SCAN_EXCLUDED_DIRS.intersection(test_file.parts):
                        continue
                    try:
                        test_content = test_file.read_text(
                            encoding="utf-8", errors="ignore"
                        )
                        if mod_import in test_content or mod_name in test_content:
                            has_test = True
                            break
                    except (PermissionError, OSError):
                        continue

            if not has_test:
                task_title = f"补充测试: {mod_rel}"
                if not self._is_task_in_progress(task_title):
                    tasks.append(SwarmTask(
                        title=task_title,
                        description=(
                            f"模块 {mod_rel} 缺少单元测试。"
                            f"请为该模块的核心功能编写测试用例，"
                            f"覆盖主要分支和边界条件。"
                        ),
                        required_capabilities=["test_generation"],
                        priority="low",
                        context={
                            "scan_source": "autonomous",
                            "module": mod_rel,
                        },
                    ))

        return tasks

    # ── 任务执行（真实 LLM 调用，铁律 3：禁止 Mock LLM）──────────

    async def _task_consumer_loop(self) -> None:
        """后台任务消费循环（Bug 1 修复）.

        持续轮询 SwarmCoordinator 中 ASSIGNED 状态的任务并启动执行器，
        受 ``max_concurrent_tasks`` 限制并发数。

        背景：原实现仅在扫描轮（scan_interval=600s）调用一次
        ``_execute_assigned_tasks``，而 SwarmCoordinator 每 5s 分发一次任务。
        扫描间隔内新分配的任务无人执行 → 无心跳上报 → heartbeat_timeout
        → reassign → 重分配后仍无人执行 → 超 3 次后 FAILED。

        修复：每 ``consumer_interval_seconds``（默认 5s）轮询一次，
        与 dispatch 节奏对齐，确保任何时刻被分配的任务都会被尽快执行。
        """
        while self._running:
            try:
                await self._execute_assigned_tasks()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — 循环不退出
                logger.error("任务消费循环异常（继续下一轮）: %s", exc)
            await asyncio.sleep(self._consumer_interval)

    async def _execute_assigned_tasks(self) -> None:
        """执行所有 ASSIGNED 状态的任务.

        遍历 SwarmCoordinator 的任务列表，对 ASSIGNED 状态的任务
        调用对应灵智体的 LLM 执行。

        Bug 1 修复：拾取任务后立即上报 heartbeat（0.1）将状态推进为
        RUNNING，防止消费循环下一轮重复拾取同一任务（原实现依赖
        ``_execute_task`` 内部心跳，存在 create_task 排队窗口期的重复风险）。
        执行器任务加入 ``_executor_tasks`` 追踪集合，防止 GC 提前回收。

        Bug 1 补充：全局并发控制——按当前 RUNNING 任务数计算剩余容量，
        避免 5s 轮询下跨轮拾取导致并发超过 max_concurrent（原实现仅在
        单轮内限制拾取数，扫描轮 600s 间隔下不会跨轮重叠；消费循环
        5s 间隔下必须按全局在飞任务数限制）。
        """
        # 全局并发控制：当前 RUNNING（执行中）任务数
        running = sum(
            1
            for t in self._coord._tasks.values()
            if t.status == SwarmTaskStatus.RUNNING
        )
        remaining = max(0, self._max_concurrent - running)
        if remaining <= 0:
            return

        executed = 0
        for task in list(self._coord._tasks.values()):
            if executed >= remaining:
                break
            if (
                task.status == SwarmTaskStatus.ASSIGNED
                and task.assigned_agent_id
            ):
                # 立即上报心跳推进状态为 RUNNING（防重复拾取）
                try:
                    await self._coord.heartbeat(
                        task.assigned_agent_id, task.task_id, 0.1, "busy"
                    )
                except Exception:  # noqa: BLE001
                    pass
                # 异步执行（不阻塞消费循环）
                executor = asyncio.create_task(self._execute_task(task))
                self._executor_tasks.add(executor)
                executor.add_done_callback(self._executor_tasks.discard)
                executed += 1

        if executed > 0:
            logger.info("启动 %d 个任务执行（异步并行）", executed)

    async def _execute_task(self, task: SwarmTask) -> None:
        """执行单个任务 — 调用灵智体 LLM 生成结果.

        流程：
            1. heartbeat(progress=0.1) — 标记开始执行
            2. 启动心跳保活协程（每 10s 发送心跳，防止 30s 超时）
            3. forgekin.chat() — 真实调用 LLM
            4. 停止心跳保活
            5. heartbeat(progress=1.0) — 标记完成
        """
        agent_id = task.assigned_agent_id
        forgekin = self._forgekins.get(agent_id)

        if forgekin is None:
            logger.warning(
                "任务 %s 分配给 %s，但灵智体实例未注册，跳过",
                task.task_id[:12],
                agent_id,
            )
            return

        logger.info(
            "▶ 灵智体 %s 开始执行: [%s] %s",
            agent_id,
            task.task_id[:12],
            task.title,
        )

        # 心跳保活协程 — LLM 调用可能耗时 30-90s，需要定期发送心跳防止超时
        keepalive_stop = asyncio.Event()

        async def _heartbeat_keepalive():
            """每 10s 发送心跳保活（SwarmCoordinator 30s 超时）。"""
            progress = 0.1
            while not keepalive_stop.is_set():
                try:
                    await self._coord.heartbeat(agent_id, task.task_id, progress, "busy")
                except Exception:  # noqa: BLE001
                    pass
                try:
                    await asyncio.wait_for(keepalive_stop.wait(), timeout=10.0)
                except asyncio.TimeoutError:
                    progress = min(0.9, progress + 0.1)

        try:
            # 1. 上报开始
            await self._coord.heartbeat(agent_id, task.task_id, 0.1, "busy")

            # 2. 启动心跳保活
            keepalive_task = asyncio.create_task(_heartbeat_keepalive())

            # 3. 构造任务消息，调用 LLM
            task_prompt = self._build_task_prompt(task)
            messages = [{"role": "user", "content": task_prompt}]
            result = await forgekin.chat(messages)

            # 4. 停止心跳保活
            keepalive_stop.set()
            keepalive_task.cancel()
            try:
                await keepalive_task
            except asyncio.CancelledError:
                pass

            # 5. 保存结果
            content = result.get("content", "")
            model = result.get("model", "unknown")

            # 无效响应检测（T2铁律：禁止假数据；避免"无法回答"被当作有效产出）
            invalid_markers = [
                "无法回答", "无法回答这个问题", "我不能回答", "我无法提供",
                "[ZHIPU HTTP 429]", "[OpenRoute 超时]", "[ZHIPU 异常]",
                "[OpenRoute 异常]", "余额不足", "当前不可用",
            ]
            is_invalid = (
                not content
                or len(content) < 20
                or any(marker in content for marker in invalid_markers)
            )
            if is_invalid:
                logger.warning(
                    "无效产出: agent=%s task=%s model=%s content=%r",
                    agent_id,
                    task.task_id[:12],
                    model,
                    content[:100] if content else "(empty)",
                )
                self._log_activity(
                    "task_invalid_output",
                    task.title,
                    task_id=task.task_id,
                    agent_id=agent_id,
                    model=model,
                    content_length=len(content),
                    content_preview=content[:200] if content else "(empty)",
                    reason="无效响应（无法回答/余额不足/超时等）",
                )
                await self._coord.heartbeat(agent_id, task.task_id, 0.0, "error")
                return

            task.result = {
                "content": content,
                "model": model,
                "summary": content[:200] if content else "",
                "completed_by": agent_id,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }

            # 5.1 真实落盘产出（铁律2：禁止假数据/假逻辑）
            # 文档任务：直接写入 docs/ 目录
            # 代码/测试任务：写入 .autonomous/patches/{task_id}.md 供 operator 审阅
            # 这样既满足"真实落盘"要求，又避免 LLM 直接破坏现有代码
            output_path = self._persist_task_output(task, content, model)

            # 6. 上报完成（progress=1.0 触发 COMPLETED）
            await self._coord.heartbeat(agent_id, task.task_id, 1.0, "idle")

            logger.info(
                "✓ 灵智体 %s 完成任务: [%s] %s (model=%s, %d 字, output=%s)",
                agent_id,
                task.task_id[:12],
                task.title,
                model,
                len(content),
                output_path or "(未落盘)",
            )
            self._log_activity(
                "task_completed",
                task.title,
                task_id=task.task_id,
                agent_id=agent_id,
                model=model,
                content_length=len(content),
                content_preview=content[:300] if content else "",
                output_path=output_path,
            )
            # 保存产出供 Web 可观测性展示（保留最近 50 条）
            self._completed_outputs.append({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "task_id": task.task_id,
                "title": task.title,
                "agent_id": agent_id,
                "model": model,
                "content": content,
                "content_preview": content[:500] if content else "",
                "output_path": output_path,
            })
            if len(self._completed_outputs) > 50:
                self._completed_outputs = self._completed_outputs[-50:]

        except Exception as exc:  # noqa: BLE001
            # 停止心跳保活
            keepalive_stop.set()
            logger.error(
                "✗ 灵智体 %s 执行任务失败: [%s] %s — %s",
                agent_id,
                task.task_id[:12],
                task.title,
                exc,
                exc_info=True,
            )
            self._log_activity(
                "task_failed",
                task.title,
                task_id=task.task_id,
                agent_id=agent_id,
                error=str(exc),
            )
            # 上报失败状态
            await self._coord.heartbeat(agent_id, task.task_id, 0.0, "error")

    def _persist_task_output(
        self, task: SwarmTask, content: str, model: str
    ) -> Optional[str]:
        """真实落盘任务产出（铁律2：禁止假数据/假逻辑）.

        根据任务类型将 LLM 产出写入文件：
            - doc_generation: 直接写入 ``docs/{filename}`` （安全，文档可被 operator 直接审阅）
            - code_generation: 写入 ``.autonomous/patches/{task_id}_{filename}.md`` 供 operator 审阅
            - test_generation: 写入 ``.autonomous/patches/{task_id}_{filename}.md`` 供 operator 审阅

        设计权衡：
            - 文档任务直接落盘到 docs/，因为文档是声明式的、不会破坏代码
            - 代码/测试任务先落盘到 patches/ 目录，由 operator 决定是否应用到源文件
            - 这避免 LLM 直接修改源代码的风险，同时满足"产出必须落盘"的铁律

        Args:
            task: 已完成的 SwarmTask.
            content: LLM 生成的产出内容.
            model: 使用的模型名称（用于元数据）.

        Returns:
            落盘文件的相对路径（相对 project_root），失败时返回 None.
        """
        if not content:
            return None

        ctx = task.context or {}
        required = task.required_capabilities
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

        try:
            if "doc_generation" in required:
                # 文档任务：直接写入 docs/ 目录
                doc_rel = ctx.get("doc_path")
                if not doc_rel:
                    # 没有指定路径，使用通用路径
                    doc_rel = f"docs/autonomous_{ts}_{task.task_id[:8]}.md"
                target = self._root / doc_rel
                target.parent.mkdir(parents=True, exist_ok=True)
                # 添加 front-matter（铁律：文档必须含 front-matter）
                if not content.startswith("---"):
                    frontmatter = (
                        f"---\n"
                        f"status: draft\n"
                        f"type: autonomous_generated\n"
                        f"created_at: {datetime.now(timezone.utc).isoformat()}\n"
                        f"generated_by: {task.assigned_agent_id or 'unknown'}\n"
                        f"model: {model}\n"
                        f"task_id: {task.task_id}\n"
                        f"---\n\n"
                    )
                    content = frontmatter + content
                target.write_text(content, encoding="utf-8")
                rel_path = str(target.relative_to(self._root)).replace("\\", "/")
                logger.info("文档产出已落盘: %s", rel_path)
                return rel_path

            elif "code_generation" in required or "test_generation" in required:
                # 代码/测试任务：写入 .autonomous/patches/ 供 operator 审阅
                patches_dir = self._root / "flowforge" / ".autonomous" / "patches"
                patches_dir.mkdir(parents=True, exist_ok=True)
                # 构造文件名：{task_id}_{原文件名或任务类型}.md
                source_file = ctx.get("file") or ctx.get("module") or "output"
                source_basename = Path(source_file).stem
                patch_filename = f"{task.task_id[:12]}_{source_basename}.md"
                target = patches_dir / patch_filename
                # 包装为审阅格式（含元数据 + 原任务信息 + LLM 产出）
                header = (
                    f"# 自主任务产出审阅\n\n"
                    f"- **task_id**: {task.task_id}\n"
                    f"- **title**: {task.title}\n"
                    f"- **agent**: {task.assigned_agent_id or 'unknown'}\n"
                    f"- **model**: {model}\n"
                    f"- **generated_at**: {datetime.now(timezone.utc).isoformat()}\n"
                    f"- **source_file**: {source_file}\n"
                    f"- **required_capabilities**: {', '.join(required)}\n"
                    f"\n## 审阅指南\n\n"
                    f"1. 检查产出的代码是否符合项目规范（CONTRIBUTING.md 15 条红线）\n"
                    f"2. 检查是否引入循环依赖或违反分层架构\n"
                    f"3. 通过审核后，将下方代码块内容应用到对应源文件\n"
                    f"4. 应用后必须运行对应测试验证（铁律 T1-T8）\n"
                    f"\n## 任务上下文\n\n```\n{task.description}\n```\n"
                    f"\n## LLM 产出内容\n\n"
                )
                target.write_text(header + content, encoding="utf-8")
                rel_path = str(target.relative_to(self._root)).replace("\\", "/")
                logger.info("代码产出已落盘（待审阅）: %s", rel_path)
                return rel_path

            else:
                # 未知任务类型：通用落盘
                generic_dir = self._root / "flowforge" / ".autonomous" / "outputs"
                generic_dir.mkdir(parents=True, exist_ok=True)
                target = generic_dir / f"{task.task_id[:12]}_{ts}.md"
                target.write_text(content, encoding="utf-8")
                rel_path = str(target.relative_to(self._root)).replace("\\", "/")
                return rel_path

        except (PermissionError, OSError) as exc:
            logger.error("产出落盘失败: task=%s error=%s", task.task_id[:12], exc)
            return None

    def _build_task_prompt(self, task: SwarmTask) -> str:
        """构造任务执行提示词（基于任务信息+真实文件上下文，铁律2：禁止假数据）.

        根据任务类型附加真实文件内容，避免 LLM 生成"假设性代码"：
            - doc_generation: 附加项目结构概览 + README + 关键模块清单
            - code_generation: 附加目标文件的真实完整内容
            - test_generation: 附加目标模块的真实完整内容
        """
        prompt = (
            f"你被分配了一个自主任务，请基于你的角色能力完成：\n\n"
            f"任务标题: {task.title}\n"
            f"任务描述: {task.description}\n"
            f"需要能力: {', '.join(task.required_capabilities)}\n"
        )
        if task.context:
            prompt += f"上下文: {task.context}\n"

        # 根据任务类型附加真实文件上下文（关键修复：避免 LLM 生成假设性代码）
        ctx = task.context or {}
        required = task.required_capabilities

        if "doc_generation" in required:
            prompt += self._build_doc_context(ctx)
        elif "code_generation" in required:
            prompt += self._build_code_context(ctx)
        elif "test_generation" in required:
            prompt += self._build_test_context(ctx)

        prompt += (
            "\n【重要】以上是项目真实文件内容，请基于实际代码和项目结构生成具体的、"
            "可执行的成果。禁止生成假设性代码或示例代码——必须针对真实文件"
            "进行修改或补充。产出格式：\n"
            "- 文档任务：直接输出 Markdown 文档内容\n"
            "- 代码任务：输出完整的修改后代码（带文件路径标注）\n"
            "- 测试任务：输出完整的测试代码（带文件路径标注）"
        )
        return prompt

    def _build_doc_context(self, ctx: dict[str, Any]) -> str:
        """为文档生成任务附加项目真实结构上下文."""
        parts = ["\n--- 项目真实结构（用于生成文档参考）---\n"]
        try:
            for entry in sorted(self._root.iterdir()):
                if entry.name.startswith(".") or entry.name in {
                    "__pycache__", "node_modules", ".git", ".next", "dist", "build"
                }:
                    continue
                if entry.is_dir():
                    parts.append(f"DIR {entry.name}/")
                    try:
                        for sub in sorted(entry.iterdir())[:8]:
                            if not sub.name.startswith("."):
                                parts.append(f"   - {sub.name}")
                    except (PermissionError, OSError):
                        pass
                else:
                    parts.append(f"FILE {entry.name}")
        except (PermissionError, OSError):
            pass

        readme_path = self._root / "README.md"
        if readme_path.exists():
            try:
                readme = readme_path.read_text(encoding="utf-8", errors="ignore")
                parts.append("\n--- README.md（前800字）---\n")
                parts.append(readme[:800])
            except (PermissionError, OSError):
                pass

        doc_path = ctx.get("doc_path")
        if doc_path:
            target_doc = self._root / doc_path
            if target_doc.exists():
                try:
                    existing = target_doc.read_text(encoding="utf-8", errors="ignore")
                    parts.append(f"\n--- 现有 {doc_path} 内容（前1000字，供参考）---\n")
                    parts.append(existing[:1000])
                except (PermissionError, OSError):
                    pass
            else:
                parts.append(f"\n目标文档 {doc_path} 不存在，需新建。")

        return "\n".join(parts) + "\n"

    def _build_code_context(self, ctx: dict[str, Any]) -> str:
        """为代码修复任务附加目标文件真实完整内容."""
        file_rel = ctx.get("file")
        if not file_rel:
            return ""

        target_file = self._root / file_rel
        if not target_file.exists():
            return f"\n目标文件 {file_rel} 不存在。\n"

        try:
            content = target_file.read_text(encoding="utf-8", errors="ignore")
        except (PermissionError, OSError) as exc:
            return f"\n读取文件 {file_rel} 失败: {exc}\n"

        parts = [
            f"\n--- 目标文件 {file_rel} 完整内容（{len(content)} 字符）---\n",
            content,
            "\n--- 文件结束 ---\n",
            "请在上述真实代码基础上，修复其中的 TODO/FIXME/NotImplementedError，"
            "输出完整的修改后文件内容。禁止生成假设性或示例性代码。",
        ]
        return "\n".join(parts)

    def _build_test_context(self, ctx: dict[str, Any]) -> str:
        """为测试生成任务附加目标模块真实完整内容."""
        module_rel = ctx.get("module")
        if not module_rel:
            return ""

        target_mod = self._root / module_rel
        if not target_mod.exists():
            return f"\n目标模块 {module_rel} 不存在。\n"

        try:
            content = target_mod.read_text(encoding="utf-8", errors="ignore")
            max_len = 6000
            if len(content) > max_len:
                content = content[:max_len] + f"\n\n# ... (已截断，共 {len(content)} 字符)"
        except (PermissionError, OSError) as exc:
            return f"\n读取模块 {module_rel} 失败: {exc}\n"

        parts = [
            f"\n--- 目标模块 {module_rel} 完整内容（供编写测试参考）---\n",
            content,
            "\n--- 模块结束 ---\n",
            "请基于上述真实代码，为其中的核心类和函数编写单元测试。"
            "输出完整的测试代码，禁止生成假设性测试。",
        ]
        return "\n".join(parts)

    # ── 状态查询 ──────────────────────────────────────────────

    def get_status(self) -> dict[str, Any]:
        """获取 daemon 运行状态（供 /api/v1/forgemind/autonomous/status 查询）."""
        tasks = list(self._coord._tasks.values())
        # 计算最近活动统计
        recent_activities = self._activity_log[-20:] if self._activity_log else []
        completed_count = sum(1 for a in self._activity_log if a.get("event_type") == "task_completed")
        failed_count = sum(1 for a in self._activity_log if a.get("event_type") == "task_failed")
        return {
            "running": self._running,
            "scan_interval_seconds": self._scan_interval,
            "scan_count": self._scan_count,
            "registered_forgekins": list(self._forgekins.keys()),
            "total_tasks": len(tasks),
            "pending": sum(1 for t in tasks if t.status == SwarmTaskStatus.PENDING),
            "assigned": sum(1 for t in tasks if t.status == SwarmTaskStatus.ASSIGNED),
            "running_tasks": sum(1 for t in tasks if t.status == SwarmTaskStatus.RUNNING),
            "completed": sum(1 for t in tasks if t.status == SwarmTaskStatus.COMPLETED),
            "failed": sum(1 for t in tasks if t.status == SwarmTaskStatus.FAILED),
            "submitted_titles": len(self._title_to_task_id),
            # 自进化活动统计
            "activity_log_count": len(self._activity_log),
            "completed_tasks_total": completed_count,
            "failed_tasks_total": failed_count,
            "recent_activities": recent_activities,
        }

    def get_activity_log(self, limit: int = 100) -> list[dict[str, Any]]:
        """获取自进化活动历史（供 Web 可观测性展示）."""
        return list(reversed(self._activity_log[-limit:]))

    def get_completed_outputs(self, limit: int = 20) -> list[dict[str, Any]]:
        """获取已完成任务的产出（供 Web 聊天和可观测性展示）."""
        return list(reversed(self._completed_outputs[-limit:]))


# ──────────────────────────────────────────────────────────────────
# 工厂函数 — 从 YAML 配置创建 AutonomousDaemon
# ──────────────────────────────────────────────────────────────────


async def create_autonomous_daemon(
    project_root: Path,
    swarm_config_path: Optional[Path] = None,
) -> AutonomousDaemon:
    """从配置创建 AutonomousDaemon 实例.

    Args:
        project_root: 项目根目录
        swarm_config_path: agent_swarm.yaml 路径（默认 config/agent_swarm.yaml）

    Returns:
        配置好的 AutonomousDaemon 实例（未启动）
    """
    if swarm_config_path is None:
        swarm_config_path = project_root / "flowforge" / "config" / "agent_swarm.yaml"

    # 加载 swarm 配置
    with open(swarm_config_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)["agent_swarm"]

    # 创建 SwarmCoordinator
    coord = SwarmCoordinator(config=cfg)

    # 创建 AutonomousDaemon
    daemon = AutonomousDaemon(
        coordinator=coord,
        project_root=project_root,
        config=cfg,
    )

    # 锻造 5 个灵智体并注册
    from flowforge.forgemind.forgekins import BUILTIN_FORGEKINS, ROSTER_FILES
    from flowforge.forgemind.forging.pipeline import ForgePipeline
    from flowforge.llm.trae.client import TraeLLMClient
    from flowforge.llm.trae.config import TraeBridgeConfig

    # 创建 TraeLLMClient 实例（用于 provider="trae" 的灵智体）
    # 铁律 3：依赖通过构造函数注入；初始化失败不阻塞 daemon 启动
    try:
        bridge_config = TraeBridgeConfig()
        trae_client = TraeLLMClient(bridge_config=bridge_config)
    except Exception as exc:  # noqa: BLE001
        logger.warning("TraeLLMClient 初始化失败，灵智体将走降级路径: %s", exc)
        trae_client = None

    pipeline = ForgePipeline()
    for forgekin_id in BUILTIN_FORGEKINS:
        try:
            yaml_path = ROSTER_FILES[forgekin_id]
            forgekin = await pipeline.forge_from_yaml(yaml_path, llm_client=trae_client)
            # SwarmCoordinator 中的 agent_id 是带前缀的（forgemind:wenxin）
            full_id = f"forgemind:{forgekin_id}"
            daemon.register_forgekin(full_id, forgekin)
            logger.info("灵智体 %s 已锻造并注册到 daemon", full_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("灵智体 %s 锻造失败: %s", forgekin_id, exc)

    return daemon
