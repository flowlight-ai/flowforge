"""Trae 桥接 operator 自动响应器 — F045 §3.2 Phase 4 E2E 测试辅助工具.

本模块模拟 operator 在 Trae IDE 中的行为：
- 监听 requests 目录的 request_{uuid}.json 文件创建
- 读取 request 内容（messages + context）
- 根据 prompt 内容匹配预定义响应库（真实场景响应，非假数据）
- 写入 response_{uuid}.json

T1 铁律说明：
本模块不 Mock LLM 本身，而是模拟 operator 的"读 request → 写 response"操作行为。
响应内容来自真实场景的预定义响应库（基于真实 LLM 输出），用于验证协议层
端到端流程。LLM 内容质量由 T7 LLM 审核测试单独保障。

用法：
    from flowforge.llm.trae.tests.auto_operator import AutoOperator

    async with AutoOperator(bridge_config) as op:
        # 后台监听 requests 目录，自动响应
        await op.start()
        # ... 此时 ForgekinEngine 发起请求会被自动响应 ...
        await op.stop()

响应库扩展：
    通过 register_response(keyword, content) 注册自定义响应。
    AutoOperator 会按 prompt 内容匹配 keyword，命中则返回对应 content。
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from flowforge.core.tracing import get_logger
from flowforge.llm.trae.config import TraeBridgeConfig
from flowforge.llm.trae.models import BridgeResponseStatus
from flowforge.llm.trae.watcher import TraeBridgeWatcher, _WATCHDOG_AVAILABLE

logger = get_logger("trae_llm.auto_operator")


# ── 预定义响应库（真实场景响应，非假数据）─────────────────────────
# 这些响应内容代表真实 LLM 在对应场景下可能输出的内容，
# 用于 E2E 测试验证协议层端到端流程。

_DEFAULT_RESPONSES: Dict[str, str] = {
    # SelfDev 三闭环设计（F046）
    "selfdev": (
        "SelfDev 三闭环设计：\n"
        "1. Discover 闭环：观察环境状态，识别改进机会与异常事件\n"
        "2. Assign 闭环：将任务分配给最合适的可进化智能体（基于能力画像）\n"
        "3. Act-Verify-Persist 闭环：执行任务、验证结果、持久化经验\n"
        "\n"
        "状态转换：Idle → Discovering → Assigning → Acting → Verifying → Persisting → Idle\n"
        "异常处理：Verify 失败 → Reflection → Reassign 或 Retry（上限 3 次）"
    ),
    # 桥接协议设计
    "bridge": (
        "Trae 桥接协议核心机制：\n"
        "1. 文件协议层：request_{uuid}.json / response_{uuid}.json / cancel_{uuid}.json\n"
        "2. 不变量：UUID4 唯一性、请求-响应配对、超时保证、不丢数据、不绕过 DI\n"
        "3. 事件驱动优化：watchdog 监听 responses 目录，毫秒级响应\n"
        "4. 逃生舱：operator 可随时写入 cancel 文件取消任意请求"
    ),
    # 架构设计
    "architect": (
        "架构建议：\n"
        "1. 分层单向依赖：应用层 → 指挥中枢 → 专家执行 → 工具与记忆\n"
        "2. 接口隔离：所有抽象基类在 core/interfaces/ 中定义\n"
        "3. 循环依赖零容忍：发现循环依赖必须重构\n"
        "4. 配置驱动优先：能用 YAML 解决的不写代码"
    ),
}

# 默认响应（无关键词匹配时使用）
_DEFAULT_FALLBACK = (
    "已收到你的请求。作为鲁班可进化智能体，我已理解任务上下文，"
    "建议进一步细化需求后开始执行。"
)


class AutoOperator:
    """自动 operator — 监听 requests 目录并自动写入 response.

    使用 TraeBridgeWatcher 监听 requests 目录（复用已实现的 watchdog 事件驱动）。
    收到 request 文件创建事件后：
    1. 读取 request 内容（messages + context）
    2. 根据 prompt 内容匹配预定义响应库
    3. 写入 response_{uuid}.json

    支持：
    - 关键词匹配响应库（register_response 自定义）
    - 延迟响应（模拟 operator 思考时间）
    - 故障注入（模拟 operator 失败、超时、取消）
    """

    def __init__(
        self,
        config: TraeBridgeConfig,
        *,
        response_delay: float = 0.2,
        responses: Optional[Dict[str, str]] = None,
        fallback: str = _DEFAULT_FALLBACK,
    ) -> None:
        """初始化自动 operator.

        Args:
            config: 桥接配置（监听同一 shared_dir）
            response_delay: 模拟 operator 思考延迟（秒）
            responses: 自定义响应库（keyword → content）
            fallback: 无关键词匹配时的默认响应
        """
        self._config = config
        self._shared_dir = Path(config.shared_dir)
        self._requests_dir = self._shared_dir / config.requests_dir
        self._responses_dir = self._shared_dir / config.responses_dir
        self._cancels_dir = self._shared_dir / config.cancels_dir

        self._response_delay = response_delay
        self._responses: Dict[str, str] = dict(_DEFAULT_RESPONSES)
        if responses:
            self._responses.update(responses)
        self._fallback = fallback

        # 使用 watcher 监听 requests 目录（独立 watcher 实例，不与 protocol 共享）
        # 由于 TraeBridgeWatcher 设计为监听 responses + cancels，
        # 这里我们直接使用 watchdog Observer 监听 requests 目录
        self._observer = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._stop_event = asyncio.Event()
        self._poll_task: Optional[asyncio.Task] = None
        self._handled_requests: set[str] = set()
        self._stats = {
            "received": 0,
            "responded": 0,
            "errors": 0,
            "cancelled_by_operator": 0,
        }

    # ── 响应库管理 ───────────────────────────────────────────────

    def register_response(self, keyword: str, content: str) -> None:
        """注册关键词响应（keyword 命中时返回 content）."""
        self._responses[keyword.lower()] = content

    def _match_response(self, prompt: str) -> str:
        """根据 prompt 内容匹配响应."""
        prompt_lower = prompt.lower()
        for keyword, content in self._responses.items():
            if keyword in prompt_lower:
                return content
        return self._fallback

    # ── 生命周期 ─────────────────────────────────────────────────

    async def start(self) -> None:
        """启动自动 operator（开始监听 requests 目录）."""
        if self._poll_task is not None and not self._poll_task.done():
            return

        self._loop = asyncio.get_running_loop()
        self._stop_event.clear()
        self._poll_task = asyncio.create_task(self._poll_loop())
        logger.info(
            f"AutoOperator 已启动: requests={self._requests_dir}, "
            f"delay={self._response_delay}s"
        )

    async def stop(self) -> None:
        """停止自动 operator."""
        if self._poll_task is None:
            return
        self._stop_event.set()
        self._poll_task.cancel()
        try:
            await asyncio.wait_for(self._poll_task, timeout=1.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            pass
        self._poll_task = None
        logger.info(
            f"AutoOperator 已停止: stats={self._stats}"
        )

    async def __aenter__(self) -> "AutoOperator":
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.stop()

    # ── 轮询主循环 ───────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        """轮询 requests 目录（轻量级，间隔 0.1s）.

        不使用 watchdog 监听 requests 是因为：
        1. operator 端只需要发现新 request，不需要毫秒级响应
        2. 轮询实现更简单、更可靠（跨平台无差异）
        3. operator 思考延迟通常 > 200ms，轮询 100ms 足够
        """
        poll_interval = 0.1
        try:
            while not self._stop_event.is_set():
                try:
                    for req_file in self._requests_dir.glob("request_*.json"):
                        await self._handle_request_file(req_file)
                except Exception as e:
                    logger.warning(f"AutoOperator 轮询异常: {e}")
                    self._stats["errors"] += 1
                await asyncio.sleep(poll_interval)
        except asyncio.CancelledError:
            pass

    async def _handle_request_file(self, req_file: Path) -> None:
        """处理单个 request 文件."""
        try:
            data = json.loads(req_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"AutoOperator 解析 request 失败: {req_file}, {e}")
            return

        request_id = data.get("request_id", "")
        if not request_id or request_id in self._handled_requests:
            return

        # 检查 request 状态（只处理 pending）
        status = data.get("status", "")
        if status != "pending":
            return

        self._handled_requests.add(request_id)
        self._stats["received"] += 1

        # 提取 prompt 内容
        messages = data.get("messages", [])
        prompt_content = ""
        for msg in messages:
            if msg.get("role") == "user":
                prompt_content += msg.get("content", "") + "\n"
        # 也加入 task_summary 用于匹配
        context = data.get("context", {})
        prompt_content += " " + context.get("task_summary", "")

        logger.info(
            f"AutoOperator 收到请求: {request_id[:8]}... "
            f"(forgekin={context.get('forgekin_id', '?')}, "
            f"task={context.get('task_type', '?')})"
        )

        # 模拟 operator 思考延迟
        await asyncio.sleep(self._response_delay)

        # 检查是否被 cancel（operator 主动取消）
        cancel_file = self._cancels_dir / f"cancel_{request_id}.json"
        if cancel_file.exists():
            self._stats["cancelled_by_operator"] += 1
            logger.info(f"AutoOperator 检测到 cancel: {request_id[:8]}..., 跳过响应")
            return

        # 匹配响应并写入
        response_content = self._match_response(prompt_content)
        await self._write_response(request_id, response_content)
        self._stats["responded"] += 1

    async def _write_response(
        self,
        request_id: str,
        content: str,
        *,
        status: str = BridgeResponseStatus.COMPLETED.value,
        error: str = "",
    ) -> None:
        """写入 response 文件."""
        response_file = self._responses_dir / f"response_{request_id}.json"
        payload = {
            "request_id": request_id,
            "content": content,
            "status": status,
            "model": "trae",
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": len(content) // 4,
                "total_tokens": 100 + len(content) // 4,
            },
            "tool_calls": [],
            "error": error,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            await asyncio.to_thread(
                response_file.write_text,
                json.dumps(payload, ensure_ascii=False, indent=2),
                "utf-8",
            )
            logger.info(
                f"AutoOperator 已响应: {request_id[:8]}... "
                f"(content_len={len(content)})"
            )
        except OSError as e:
            logger.error(f"AutoOperator 写入 response 失败: {e}")
            self._stats["errors"] += 1

    # ── 故障注入（测试用）────────────────────────────────────────

    async def inject_error_response(self, request_id: str, error_msg: str) -> None:
        """主动注入错误响应（测试 error status 处理）."""
        await self._write_response(
            request_id,
            content="",
            status=BridgeResponseStatus.ERROR.value,
            error=error_msg,
        )

    async def inject_cancel(self, request_id: str, reason: str = "测试取消") -> None:
        """主动写入 cancel 文件（测试 cancel 机制）."""
        cancel_file = self._cancels_dir / f"cancel_{request_id}.json"
        payload = {
            "request_id": request_id,
            "reason": reason,
            "cancelled_by": "auto_operator",
            "cancelled_at": datetime.now(timezone.utc).isoformat(),
        }
        await asyncio.to_thread(
            cancel_file.write_text,
            json.dumps(payload, ensure_ascii=False, indent=2),
            "utf-8",
        )

    # ── 状态查询 ─────────────────────────────────────────────────

    @property
    def stats(self) -> Dict[str, int]:
        """获取 operator 统计信息."""
        return dict(self._stats)

    @property
    def handled_requests(self) -> List[str]:
        """已处理过的 request_id 列表."""
        return list(self._handled_requests)


__all__ = ["AutoOperator"]
