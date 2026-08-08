"""F047 IM 议事通道（IM Council Channel）— 基于 ApprovalHub 的多通道议事层。

[doc:features/F047-im-council-channel.md] F047 §2 核心设计
[doc:review/review.md#14.3] CL-033 Approval Hub 统一审批中心（下层依赖）

规格大纲（F047 §2.1）：
- 数据模型层：复用 flowforge/core/approval_hub.py 的 ApprovalHub / ApprovalRequest / ApprovalDecision
- 通道层：3 个 IMCouncilChannel 适配器（Console / WebChat / TraeBridge）
- 管理器层：IMCouncilManager 统一管理多通道 + 集成 ApprovalHub
- 归档层：JSONL append-only 落盘 + Phase 3 同步 MindCodex

不变量（F047 §2.5）：
- I1 通道故障降级（console > trae > webchat）
- I2 议事不可篡改（归档 append-only，禁止原地修改）
- I3 operator 决策必经（request_approval 为唯一公开入口）
- I4 超时自动拒绝（timeout 秒未回复 → decide(rejected, "timeout")）
- I5 议事记录归档（每次流程落盘 JSONL，Phase 3 同步 MindCodex）

Phase 1 交付：ConsoleChannel 完整 + TraeBridgeChannel/WebChatChannel 骨架（不抛 NotImplementedError）。
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

from flowforge.core.approval_hub import (
    ApprovalDecision,
    ApprovalHub,
    ApprovalRequest,
)
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.im_council")


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------


def _now_utc() -> datetime:
    """返回时区感知的当前 UTC 时间。"""
    return datetime.now(timezone.utc)


def _new_id(prefix: str) -> str:
    """生成带前缀的 UUID。"""
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _expand_env(value: str) -> str:
    """展开字符串中的 ${ENV_VAR} 或 ${ENV_VAR:default} 占位符。

    红线 11：禁止硬编码路径，所有路径通过环境变量或配置注入。
    """
    if not value or "${" not in value:
        return value
    # 简单实现：${VAR} 或 ${VAR:default}
    result = value
    while "${" in result and "}" in result:
        start = result.index("${")
        end = result.index("}", start)
        token = result[start + 2 : end]
        if ":" in token:
            env_key, _, default = token.partition(":")
            env_val = os.environ.get(env_key, default)
        else:
            env_val = os.environ.get(token, "")
        result = result[:start] + env_val + result[end + 1 :]
    return result


# ---------------------------------------------------------------------------
# 数据模型（F047 §2.4）
# ---------------------------------------------------------------------------


class CouncilMessage(BaseModel):
    """议事消息 — Step 1/2 的载荷（F047 §2.4）."""

    message_id: str
    channel: str  # "console" | "webchat" | "trae"
    forgekin_id: str  # 发起Forgekin ID
    content: str  # 消息内容
    message_type: str  # "approval_request" | "info" | "alert" | "council"
    payload: dict[str, Any] = Field(default_factory=dict)  # 附加数据（PR url / config diff）
    created_at: datetime = Field(default_factory=_now_utc)


class CouncilReply(BaseModel):
    """议事回复 — Step 3 的载荷（F047 §2.4）."""

    reply_id: str
    message_id: str  # 对应的 message_id
    replier: str  # "operator" / forgekin_id
    content: str  # "approve" / "reject" / 自然语言回复
    reply_type: str  # "decision" | "comment" | "question"
    decided_at: datetime = Field(default_factory=_now_utc)


# ---------------------------------------------------------------------------
# 通道抽象基类（F047 §2.2）
# ---------------------------------------------------------------------------


class IMCouncilChannel(ABC):
    """IM 议事通道抽象基类 — F047 §2.2.

    所有通道适配器必须实现 3 个抽象方法：
    - send: 发送消息到通道
    - wait_reply: 等待 operator 回复
    - broadcast: 广播给多个接收者

    子类必须声明 channel_name 类属性（如 "console" / "webchat" / "trae"）。
    """

    channel_name: str = "abstract"

    @abstractmethod
    async def send(self, message: CouncilMessage) -> str:
        """发送消息到通道，返回 message_id."""

    @abstractmethod
    async def wait_reply(
        self, message_id: str, timeout: float
    ) -> Optional[CouncilReply]:
        """等待回复，超时返回 None."""

    @abstractmethod
    async def broadcast(self, message: CouncilMessage) -> list[str]:
        """广播给多个接收者，返回 message_id 列表."""


# ---------------------------------------------------------------------------
# ConsoleChannel — CLI 终端通道（Phase 1 完整实现）
# ---------------------------------------------------------------------------


class ConsoleChannel(IMCouncilChannel):
    """CLI 终端通道 — operator 在终端输入 approve/reject（F047 §2.2）.

    适用场景：本地开发、E2E 测试、CI 流水线。

    传输介质：stdin/stdout，所有 I/O 通过 asyncio.get_event_loop().run_in_executor
    包装为 async（避免阻塞事件循环）。

    配置项（来自 im_council.yaml channels.console）：
    - prompt_prefix: 提示符前缀（默认 "[FlowForge]"）
    """

    channel_name = "console"

    def __init__(self, config: dict[str, Any]) -> None:
        """初始化 ConsoleChannel.

        Args:
            config: 通道配置（channels.console 段）
                - prompt_prefix: 提示符前缀
        """
        self._prompt_prefix: str = config.get("prompt_prefix", "[FlowForge]")
        # message_id → 待回复状态（ConsoleChannel 用内存 map 跟踪 in-flight 请求）
        self._pending: dict[str, CouncilMessage] = {}
        logger.debug("ConsoleChannel init: prefix=%s", self._prompt_prefix)

    async def send(self, message: CouncilMessage) -> str:
        """发送消息到终端（打印审批请求），返回 message_id.

        实现细节：
        - 通过 run_in_executor 包装 print，避免阻塞事件循环
        - 记录到 self._pending 以便 wait_reply 时复用
        """
        self._pending[message.message_id] = message
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._print_message, message)
        return message.message_id

    async def wait_reply(
        self, message_id: str, timeout: float
    ) -> Optional[CouncilReply]:
        """阻塞等待 operator 输入 approve/reject，超时返回 None.

        实现细节：
        - 通过 run_in_executor 包装 input()，避免阻塞事件循环
        - asyncio.wait_for 控制超时
        - 解析 operator 输入：approve/yes/y → approved；reject/no/n → rejected
        """
        message = self._pending.get(message_id)
        if message is None:
            logger.warning(
                "ConsoleChannel.wait_reply: message_id %s 未找到", message_id
            )
            return None

        loop = asyncio.get_event_loop()
        try:
            raw_input = await asyncio.wait_for(
                loop.run_in_executor(None, self._read_input, message),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            logger.info(
                "ConsoleChannel.wait_reply: timeout message_id=%s timeout=%ss",
                message_id,
                timeout,
            )
            return None

        decision = self._parse_decision(raw_input)
        reply = CouncilReply(
            reply_id=_new_id("reply"),
            message_id=message_id,
            replier="operator",
            content=raw_input.strip(),
            reply_type="decision",
        )
        # 清理 pending
        self._pending.pop(message_id, None)
        logger.info(
            "ConsoleChannel.wait_reply: message_id=%s decision=%s",
            message_id,
            decision,
        )
        return reply

    async def broadcast(self, message: CouncilMessage) -> list[str]:
        """广播给多个接收者 — Console 通道只有一个接收者（operator），等价于 send."""
        msg_id = await self.send(message)
        return [msg_id]

    # ----- 内部方法 -----

    def _print_message(self, message: CouncilMessage) -> None:
        """打印消息到 stdout（同步，由 run_in_executor 调用）."""
        prefix = self._prompt_prefix
        print(f"\n{prefix} ═══════════════════════════════════════════")
        print(f"{prefix} 议事请求 [{message.message_type}]")
        print(f"{prefix} 来自：{message.forgekin_id}")
        print(f"{prefix} 消息ID：{message.message_id}")
        print(f"{prefix} 内容：{message.content}")
        if message.payload:
            print(f"{prefix} 附带数据：")
            for key, value in message.payload.items():
                print(f"{prefix}   - {key}: {value}")
        print(f"{prefix} ───────────────────────────────────────────")
        print(f"{prefix} 请回复 approve / reject（或 yes / no）")
        print(f"{prefix} ═══════════════════════════════════════════\n")

    def _read_input(self, message: CouncilMessage) -> str:
        """从 stdin 读取 operator 输入（同步，由 run_in_executor 调用）."""
        prefix = self._prompt_prefix
        try:
            return input(f"{prefix} 决策> ")
        except (EOFError, KeyboardInterrupt):
            logger.warning(
                "ConsoleChannel._read_input: EOF/KeyboardInterrupt message_id=%s",
                message.message_id,
            )
            return "reject"

    @staticmethod
    def _parse_decision(raw: str) -> str:
        """解析 operator 输入为 approved / rejected.

        Args:
            raw: operator 原始输入字符串

        Returns:
            "approved" 或 "rejected"
        """
        text = raw.strip().lower()
        if text in ("approve", "approved", "yes", "y", "ok", "同意", "批准"):
            return "approved"
        if text in ("reject", "rejected", "no", "n", "拒绝", "驳回"):
            return "rejected"
        # 未识别输入默认拒绝（保守策略，I3 不变量）
        return "rejected"


# ---------------------------------------------------------------------------
# WebChatChannel — Web 版群通道（Phase 2 骨架）
# ---------------------------------------------------------------------------


class WebChatChannel(IMCouncilChannel):
    """Web 版群通道 — 通过 FastAPI WebSocket 推送到 Web UI（F047 §2.2）.

    适用场景：远程监督、移动端、群聊式 UI。

    传输介质：FastAPI WebSocket /ws/im，多 operator 同时在线时通过广播路由。

    Phase 状态：🔄 骨架（Phase 2 完整实现）。当前 send/wait_reply/broadcast
    仅记录 TODO 日志并返回降级结果，**不抛 NotImplementedError**（避免阻断 I1 降级链路）。

    配置项（来自 im_council.yaml channels.webchat）：
    - websocket_url: WebSocket 端点 URL
    """

    channel_name = "webchat"

    def __init__(self, config: dict[str, Any]) -> None:
        """初始化 WebChatChannel.

        Args:
            config: 通道配置（channels.webchat 段）
                - websocket_url: WebSocket 端点 URL
        """
        self._websocket_url: str = config.get(
            "websocket_url", "ws://localhost:8000/ws/im"
        )
        # Phase 2 将填充：self._connections: dict[str, WebSocket] = {}
        # Phase 2 将填充：self._pending_replies: dict[str, asyncio.Queue] = {}
        logger.debug(
            "WebChatChannel init (skeleton): websocket_url=%s", self._websocket_url
        )

    async def send(self, message: CouncilMessage) -> str:
        """发送消息到 Web UI — Phase 2 实现.

        Phase 2 实现计划：
        - TODO: 通过 WebSocket 推送 message 到所有已连接 operator
        - TODO: 注册 asyncio.Queue 等待回复
        - TODO: 失败时抛异常触发 I1 降级
        """
        logger.warning(
            "WebChatChannel.send: skeleton not implemented (Phase 2), "
            "message_id=%s forgekin=%s",
            message.message_id,
            message.forgekin_id,
        )
        # 骨架降级：返回 message_id 但标记未送达（不抛异常以保持 I1 降级链路工作）
        return message.message_id

    async def wait_reply(
        self, message_id: str, timeout: float
    ) -> Optional[CouncilReply]:
        """等待 Web UI 回复 — Phase 2 实现.

        Phase 2 实现计划：
        - TODO: 从 asyncio.Queue 取回复（带 timeout）
        - TODO: 解析 WebSocket 消息为 CouncilReply
        """
        logger.warning(
            "WebChatChannel.wait_reply: skeleton not implemented (Phase 2), "
            "message_id=%s timeout=%ss",
            message_id,
            timeout,
        )
        # 骨架降级：返回 None 触发 I4 超时拒绝
        return None

    async def broadcast(self, message: CouncilMessage) -> list[str]:
        """广播给多个 Web UI 接收者 — Phase 2 实现.

        Phase 2 实现计划：
        - TODO: 遍历所有 WebSocket 连接并发送
        - TODO: 收集每个连接的 message_id
        """
        logger.warning(
            "WebChatChannel.broadcast: skeleton not implemented (Phase 2), "
            "message_id=%s",
            message.message_id,
        )
        return []


# ---------------------------------------------------------------------------
# TraeBridgeChannel — Trae IDE 桥接通道（Phase 1 骨架，Phase 3 完整）
# ---------------------------------------------------------------------------


class TraeBridgeChannel(IMCouncilChannel):
    """Trae IDE 桥接通道 — 通过 F045 文件协议推送到 Trae IDE（F047 §2.2）.

    适用场景：operator 主力 IDE 工作流，在 Trae CN 内接收审批请求并回写决策。

    传输介质：F045 共享 JSON 文件协议（${FLOWFORGE_BRIDGE_DIR}），
    复用 request_{uuid}.json / response_{uuid}.json 命名约定。

    Phase 状态：🔄 骨架（Phase 3 完整实现）。当前 send/wait_reply/broadcast
    仅记录 TODO 日志并返回降级结果，**不抛 NotImplementedError**。

    配置项（来自 im_council.yaml channels.trae）：
    - bridge_dir: F045 共享目录路径（支持 ${ENV_VAR} 占位符，红线 11）
    """

    channel_name = "trae"

    def __init__(self, config: dict[str, Any]) -> None:
        """初始化 TraeBridgeChannel.

        Args:
            config: 通道配置（channels.trae 段）
                - bridge_dir: F045 共享目录路径
        """
        raw_dir = config.get("bridge_dir", "${FLOWFORGE_BRIDGE_DIR}")
        self._bridge_dir: str = _expand_env(raw_dir)
        # Phase 3 将填充：self._protocol = TraeBridgeProtocol(...)
        logger.debug(
            "TraeBridgeChannel init (skeleton): bridge_dir=%s", self._bridge_dir
        )

    async def send(self, message: CouncilMessage) -> str:
        """发送消息到 Trae IDE — Phase 3 实现.

        Phase 3 实现计划：
        - TODO: 复用 F045 TraeBridgeProtocol 文件命名约定
        - TODO: 写入 {bridge_dir}/requests/council_request_{message_id}.json
        - TODO: operator 在 Trae 内监听并调用 LLM 辅助决策
        - TODO: 写入失败时抛异常触发 I1 降级
        """
        logger.warning(
            "TraeBridgeChannel.send: skeleton not implemented (Phase 3), "
            "message_id=%s forgekin=%s bridge_dir=%s",
            message.message_id,
            message.forgekin_id,
            self._bridge_dir,
        )
        # 骨架降级：返回 message_id 但标记未送达
        return message.message_id

    async def wait_reply(
        self, message_id: str, timeout: float
    ) -> Optional[CouncilReply]:
        """等待 Trae IDE 回复 — Phase 3 实现.

        Phase 3 实现计划：
        - TODO: 轮询 {bridge_dir}/responses/council_response_{message_id}.json
        - TODO: 解析 JSON 为 CouncilReply
        - TODO: 超时返回 None
        """
        logger.warning(
            "TraeBridgeChannel.wait_reply: skeleton not implemented (Phase 3), "
            "message_id=%s timeout=%ss",
            message_id,
            timeout,
        )
        # 骨架降级：返回 None 触发 I4 超时拒绝
        return None

    async def broadcast(self, message: CouncilMessage) -> list[str]:
        """广播给多个 Trae IDE 接收者 — Phase 3 实现.

        Phase 3 实现计划：
        - TODO: 多个 bridge_dir 并发写入
        """
        logger.warning(
            "TraeBridgeChannel.broadcast: skeleton not implemented (Phase 3), "
            "message_id=%s",
            message.message_id,
        )
        return []


# ---------------------------------------------------------------------------
# IMCouncilManager — IM 议事管理器（F047 §2.4）
# ---------------------------------------------------------------------------


class NoAvailableChannelError(RuntimeError):
    """所有通道不可用时抛出（I1 降级链路穷尽）."""


class IMCouncilManager:
    """IM 议事管理器 — 统一管理多通道 + 集成 ApprovalHub（F047 §2.4）.

    职责：
    - 注册 / 注销通道适配器（DI 注入，红线 12）
    - 自动通道选择 + I1 降级链路
    - 五步MindCouncil流程（发起→收集→综合→决策→归档）
    - I3 强制：request_approval 为审批的唯一公开入口
    - I4 超时自动拒绝
    - I5 归档落盘 JSONL

    依赖通过构造函数注入（红线 12）：
    - approval_hub: ApprovalHub 实例（CL-033）
    - config: dict 配置（来自 im_council.yaml）
    """

    # I1 降级链路优先级（console > trae > webchat）
    _CHANNEL_PRIORITY: list[str] = ["console", "trae", "webchat"]

    def __init__(self, approval_hub: ApprovalHub, config: dict[str, Any]) -> None:
        """初始化 IMCouncilManager.

        Args:
            approval_hub: ApprovalHub 实例（CL-033，依赖注入）
            config: 配置字典（来自 im_council.yaml）
                - default_channel: 默认通道名（"auto" 时启用降级链路）
                - approval.timeout_seconds: 默认审批超时
                - approval.auto_reject_on_timeout: 超时是否自动拒绝
                - archive.enabled: 是否启用归档
                - archive.path: 归档目录路径
        """
        self._approval_hub: ApprovalHub = approval_hub
        self._config: dict[str, Any] = config
        self._channels: dict[str, IMCouncilChannel] = {}

        # 归档配置
        archive_cfg = config.get("archive", {})
        self._archive_enabled: bool = archive_cfg.get("enabled", True)
        self._archive_path: str = archive_cfg.get("path", "data/im_council/archive")

        # 审批配置
        approval_cfg = config.get("approval", {})
        self._default_timeout: float = float(
            approval_cfg.get("timeout_seconds", 300)
        )
        self._auto_reject_on_timeout: bool = approval_cfg.get(
            "auto_reject_on_timeout", True
        )

        logger.debug(
            "IMCouncilManager init: archive_enabled=%s archive_path=%s "
            "default_timeout=%ss auto_reject=%s",
            self._archive_enabled,
            self._archive_path,
            self._default_timeout,
            self._auto_reject_on_timeout,
        )

    # ----- 通道注册 -----

    def register_channel(self, name: str, channel: IMCouncilChannel) -> None:
        """注册通道（DI 注入，红线 12）.

        Args:
            name: 通道名（"console" / "webchat" / "trae"）
            channel: IMCouncilChannel 实例

        Raises:
            ValueError: 通道名重复或 channel_name 属性不匹配
        """
        if name in self._channels:
            raise ValueError(f"通道已注册: {name}")
        if channel.channel_name != name:
            raise ValueError(
                f"通道名不匹配: register name={name} but channel.channel_name="
                f"{channel.channel_name}"
            )
        self._channels[name] = channel
        logger.info("IMCouncilManager.register_channel: %s", name)

    def unregister_channel(self, name: str) -> Optional[IMCouncilChannel]:
        """注销通道，返回被移除的通道实例（不存在时返回 None）."""
        channel = self._channels.pop(name, None)
        if channel is not None:
            logger.info("IMCouncilManager.unregister_channel: %s", name)
        return channel

    def list_channels(self) -> list[str]:
        """列出所有已注册通道名."""
        return list(self._channels.keys())

    # ----- 发送消息 -----

    async def send_to_operator(
        self, message: CouncilMessage, channel_name: str = "auto"
    ) -> str:
        """发送消息给 operator（auto 时按 I1 降级链路选择通道）.

        Args:
            message: 议事消息
            channel_name: 指定通道名；"auto" 时按优先级降级

        Returns:
            message_id（成功送达时）

        Raises:
            NoAvailableChannelError: 所有通道不可用（I1 降级链路穷尽）
        """
        if channel_name != "auto":
            # 显式指定通道
            channel = self._channels.get(channel_name)
            if channel is None:
                logger.warning(
                    "send_to_operator: 指定通道 %s 不存在，降级到 auto",
                    channel_name,
                )
                return await self._send_with_fallback(message)
            try:
                message.channel = channel_name
                return await channel.send(message)
            except Exception as exc:
                logger.warning(
                    "send_to_operator: 指定通道 %s 发送失败 (%s)，降级到 auto",
                    channel_name,
                    exc,
                )
                return await self._send_with_fallback(message)
        # auto 模式：按优先级降级
        return await self._send_with_fallback(message)

    async def _send_with_fallback(self, message: CouncilMessage) -> str:
        """I1 降级链路：按 _CHANNEL_PRIORITY 顺序尝试，全部失败时抛异常."""
        last_error: Optional[Exception] = None
        for name in self._CHANNEL_PRIORITY:
            channel = self._channels.get(name)
            if channel is None:
                continue
            try:
                message.channel = name
                msg_id = await channel.send(message)
                logger.info(
                    "_send_with_fallback: 通道 %s 成功送达 message_id=%s",
                    name,
                    msg_id,
                )
                return msg_id
            except Exception as exc:
                logger.warning(
                    "_send_with_fallback: 通道 %s 失败: %s", name, exc
                )
                last_error = exc
                continue
        raise NoAvailableChannelError(
            f"所有通道不可用（已尝试 {self._CHANNEL_PRIORITY}），最后错误: {last_error}"
        )

    # ----- 完整审批流程（I3 强制入口 + I4 超时 + I5 归档）-----

    async def request_approval(
        self, request: ApprovalRequest, timeout: Optional[float] = None
    ) -> bool:
        """发起审批请求 → 推送 → 等待回复 → 调用 ApprovalHub.decide → 归档.

        五步MindCouncil流程（F047 §2.3）：
        1. 发起：构造 CouncilMessage 并提交到 ApprovalHub
        2. 收集：通过选定通道推送 message
        3. 综合：等待 operator 回复 CouncilReply
        4. 决策：调用 ApprovalHub.decide 落地决策
        5. 归档：落盘 JSONL（I5 不变量）

        Args:
            request: 审批请求（CL-033 ApprovalRequest）
            timeout: 超时秒数；None 时使用配置默认值

        Returns:
            True = approved, False = rejected / timeout / 通道异常

        Raises:
            NoAvailableChannelError: 所有通道不可用（I1 降级链路穷尽）
        """
        # I3 强制：request_approval 为唯一公开入口
        actual_timeout = (
            self._default_timeout if timeout is None else float(timeout)
        )

        # Step 1: 提交到 ApprovalHub（不调用 decide，仅 submit）
        self._approval_hub.submit(request)
        logger.info(
            "request_approval: Step1 发起 request_id=%s type=%s forgekin=%s",
            request.request_id,
            request.request_type,
            request.forgekin_id,
        )

        # 构造 CouncilMessage
        message = CouncilMessage(
            message_id=_new_id("council_msg"),
            channel="auto",  # 实际通道由 send_to_operator 设置
            forgekin_id=request.forgekin_id,
            content=f"[{request.request_type}] {request.title}\n{request.description}",
            message_type="approval_request",
            payload={
                "request_id": request.request_id,
                "request_type": request.request_type,
                "title": request.title,
                "description": request.description,
                "priority": request.priority,
                "expires_at": request.expires_at.isoformat(),
                **request.payload,
            },
        )

        # Step 2: 推送给 operator（I1 降级链路）
        try:
            msg_id = await self.send_to_operator(message, channel_name="auto")
        except NoAvailableChannelError:
            logger.error(
                "request_approval: 所有通道不可用，request_id=%s", request.request_id
            )
            # I4 兜底：通道全失败时按超时拒绝处理
            await self._handle_no_channel(request, message)
            return False

        # Step 3: 等待回复（I4 超时控制）
        selected_channel = self._channels.get(message.channel)
        if selected_channel is None:
            logger.error(
                "request_approval: 选中通道 %s 不存在（消息已送达但无法等待回复）",
                message.channel,
            )
            await self._handle_no_channel(request, message)
            return False

        reply: Optional[CouncilReply] = await selected_channel.wait_reply(
            msg_id, actual_timeout
        )

        # Step 4: 决策（I3 必经 ApprovalHub.decide）
        decision_made: ApprovalDecision
        if reply is None:
            # I4 超时自动拒绝
            if self._auto_reject_on_timeout:
                decision_made = ApprovalDecision(
                    request_id=request.request_id,
                    decision="rejected",
                    decided_by="system:timeout",
                    comments=f"timeout after {actual_timeout}s via {message.channel}",
                )
                self._approval_hub.decide(decision_made)
                logger.warning(
                    "request_approval: Step4 I4 超时拒绝 request_id=%s timeout=%ss",
                    request.request_id,
                    actual_timeout,
                )
            else:
                logger.warning(
                    "request_approval: 超时但 auto_reject_on_timeout=False，"
                    "request_id=%s 保持 pending",
                    request.request_id,
                )
                await self._archive_record(message, None, None)
                return False
        else:
            # 解析 operator 决策
            decision_str = ConsoleChannel._parse_decision(reply.content)
            decision_made = ApprovalDecision(
                request_id=request.request_id,
                decision=decision_str,
                decided_by=reply.replier,
                comments=reply.content,
            )
            ok, msg = self._approval_hub.decide(decision_made)
            if not ok:
                logger.error(
                    "request_approval: Step4 decide 失败 request_id=%s reason=%s",
                    request.request_id,
                    msg,
                )
                await self._archive_record(message, reply, None)
                return False
            logger.info(
                "request_approval: Step4 决策落地 request_id=%s decision=%s by=%s",
                request.request_id,
                decision_str,
                reply.replier,
            )

        # Step 5: 归档（I5 不变量）
        await self._archive_record(message, reply, decision_made)

        return decision_made.decision == "approved"

    # ----- 归档（I2 append-only + I5 落盘）-----

    async def _archive_record(
        self,
        message: CouncilMessage,
        reply: Optional[CouncilReply],
        decision: Optional[ApprovalDecision],
    ) -> None:
        """归档一条完整议事记录到 JSONL（I2 append-only + I5 落盘）.

        Args:
            message: 议事消息（必填）
            reply: 议事回复（可能为 None，如超时）
            decision: 审批决策（可能为 None，如 decide 失败）
        """
        if not self._archive_enabled:
            logger.debug("_archive_record: 归档未启用，跳过")
            return

        record = {
            "archived_at": _now_utc().isoformat(),
            "message": message.model_dump(mode="json"),
            "reply": reply.model_dump(mode="json") if reply else None,
            "decision": decision.model_dump(mode="json") if decision else None,
        }

        # 归档路径：{archive_path}/{YYYY-MM-DD}.jsonl
        archive_dir = Path(_expand_env(self._archive_path))
        date_str = _now_utc().strftime("%Y-%m-%d")
        archive_file = archive_dir / f"{date_str}.jsonl"

        # 通过 run_in_executor 包装同步文件 I/O
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(
                None, self._append_jsonl, archive_file, record
            )
            logger.info(
                "_archive_record: 已归档 message_id=%s → %s",
                message.message_id,
                archive_file,
            )
        except OSError as exc:
            logger.error(
                "_archive_record: 归档失败 message_id=%s file=%s error=%s",
                message.message_id,
                archive_file,
                exc,
            )

    @staticmethod
    def _append_jsonl(file_path: Path, record: dict[str, Any]) -> None:
        """以 append-only 模式追加一行 JSON 到 JSONL 文件（I2 不变量）.

        - 自动创建父目录
        - 以 'a' 模式打开（禁止覆盖）
        - 单行 JSON + 换行符
        """
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with file_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False, default=str))
            f.write("\n")

    # ----- 异常处理 -----

    async def _handle_no_channel(
        self, request: ApprovalRequest, message: CouncilMessage
    ) -> None:
        """所有通道不可用时的兜底处理（I4 类似策略：标记为系统拒绝）."""
        if self._auto_reject_on_timeout:
            decision = ApprovalDecision(
                request_id=request.request_id,
                decision="rejected",
                decided_by="system:no_channel",
                comments="所有 IM 通道不可用（I1 降级链路穷尽）",
            )
            self._approval_hub.decide(decision)
            logger.warning(
                "_handle_no_channel: 系统拒绝 request_id=%s reason=no_channel",
                request.request_id,
            )
            await self._archive_record(message, None, decision)
        else:
            await self._archive_record(message, None, None)
