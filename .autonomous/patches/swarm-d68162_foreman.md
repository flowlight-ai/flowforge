# 自主任务产出审阅

- **task_id**: swarm-d681627e0dd5
- **title**: 修复代码 TODO: flowforge\evolution\foreman.py
- **agent**: forgemind:sherlock
- **model**: openroute/doubao-web/chat
- **generated_at**: 2026-07-31T23:55:11.619254+00:00
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

from flowforge.evolution.runtime import SelfDevRuntime
from flowforge.logging import logger

@dataclass
class ForemanConfig:
    """Foreman 调度器配置"""
    loop_interval_seconds: float = 3.0
    emergency_poll_interval_seconds: float = 0.5
    max_concurrent_tasks: int = 5
    task_scan_limit: int = 8

    magic_words_stop: List[str] = field(default_factory=lambda: ["停止", "stop", "exit", "quit"])
    magic_words_pause: List[str] = field(default_factory=lambda: ["暂停", "pause", "hold"])
    magic_words_resume: List[str] = field(default_factory=lambda: ["继续", "resume", "go"])

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
    await foreman.start() # 永不停止，直到 operator 喊 Magic Words
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
        self._magic_words_callback: Optional[Callable[[str], Awaitable[None]]] = None

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

        # 启动主循
```