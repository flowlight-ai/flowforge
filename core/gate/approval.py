"""门禁人工审批 — 支持 WebSocket 实时推送和升级链。

HumanApprovalProvider: 抽象基类，定义审批请求/检查接口
WebSocketApprovalProvider: 通过 WebSocket 推送审批请求到 Helm UI
EscalationChain: 多级审批人升级链，超时自动升级到下一级
"""

from __future__ import annotations

import asyncio
import uuid
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.gate.models import GateStatus, GateVerdict
from flowforge.core.tracing import get_logger

logger = get_logger("gate_approval")

DEFAULT_APPROVAL_TIMEOUT_SECONDS = 3600  # 1 小时


class ApprovalRequest(BaseModel):
    """审批请求。"""
    approval_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    gate_name: str
    task_id: str
    context: dict[str, Any] = Field(default_factory=dict)
    requested_at: datetime = Field(default_factory=datetime.now)
    current_level: int = 0
    approver: str = ""


class ApprovalResponse(BaseModel):
    """审批响应。"""
    approval_id: str
    approved: bool
    approver: str = ""
    comment: str = ""
    responded_at: datetime = Field(default_factory=datetime.now)


class EscalationLevel(BaseModel):
    """升级链中的一级。"""
    approver: str = Field(description="审批人标识")
    timeout_seconds: int = Field(default=DEFAULT_APPROVAL_TIMEOUT_SECONDS, description="该级超时时间（秒）")


class EscalationChain(BaseModel):
    """多级审批升级链。"""
    levels: list[EscalationLevel] = Field(default_factory=list)
    current_level: int = 0

    def get_current_level(self) -> EscalationLevel | None:
        """获取当前升级级别。"""
        if 0 <= self.current_level < len(self.levels):
            return self.levels[self.current_level]
        return None

    def escalate(self) -> EscalationLevel | None:
        """升级到下一级。

        Returns:
            下一级的 EscalationLevel，如果已到末尾则返回 None
        """
        self.current_level += 1
        if 0 <= self.current_level < len(self.levels):
            logger.info(
                f"[escalation] escalated to level {self.current_level}: "
                f"approver={self.levels[self.current_level].approver}"
            )
            return self.levels[self.current_level]
        logger.warning("[escalation] no more escalation levels available")
        return None

    def is_exhausted(self) -> bool:
        """是否已用完所有升级级别。"""
        return self.current_level >= len(self.levels)

    @classmethod
    def from_config(cls, config: dict[str, Any]) -> EscalationChain:
        """从配置创建升级链。

        配置格式:
            escalation_chain:
              - approver: "tech_lead"
                timeout_seconds: 1800
              - approver: "engineering_manager"
                timeout_seconds: 3600
              - approver: "cto"
                timeout_seconds: 7200
        """
        levels = []
        for level_cfg in config.get("escalation_chain", []):
            levels.append(EscalationLevel(
                approver=level_cfg.get("approver", "unknown"),
                timeout_seconds=level_cfg.get("timeout_seconds", DEFAULT_APPROVAL_TIMEOUT_SECONDS),
            ))
        return cls(levels=levels)


class HumanApprovalProvider(ABC):
    """人工审批提供者抽象基类。"""

    def __init__(self, timeout_seconds: int = DEFAULT_APPROVAL_TIMEOUT_SECONDS) -> None:
        self._timeout_seconds = timeout_seconds

    @abstractmethod
    async def request_approval(
        self,
        gate_name: str,
        task_id: str,
        context: dict[str, Any],
    ) -> str:
        """发起审批请求。

        Args:
            gate_name: 门禁名称
            task_id: 任务 ID
            context: 审批上下文（评分、建议等）

        Returns:
            approval_id: 审批请求 ID
        """

    @abstractmethod
    async def check_approval(self, approval_id: str) -> GateVerdict | None:
        """检查审批结果。

        Args:
            approval_id: 审批请求 ID

        Returns:
            GateVerdict 如果审批已完成，None 如果仍在等待
        """

    async def wait_for_approval(
        self,
        approval_id: str,
        timeout_seconds: int | None = None,
    ) -> GateVerdict:
        """等待审批结果，带超时。

        Args:
            approval_id: 审批请求 ID
            timeout_seconds: 超时时间（秒），默认使用实例配置

        Returns:
            GateVerdict 审批结果
        """
        effective_timeout = timeout_seconds or self._timeout_seconds
        elapsed = 0.0
        poll_interval = 2.0

        while elapsed < effective_timeout:
            verdict = await self.check_approval(approval_id)
            if verdict is not None:
                return verdict
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        # 超时
        logger.warning(
            f"[approval] approval_id={approval_id} timed out after {effective_timeout}s"
        )
        return GateVerdict(
            gate_id="",
            gate_name="",
            task_id="",
            status=GateStatus.TIMEOUT,
            overall_score=0.0,
            pass_threshold=0.0,
            decision="timeout",
            reviewer_feedback=f"Human approval timed out after {effective_timeout}s",
            decided_at=datetime.now(),
        )


class WebSocketApprovalProvider(HumanApprovalProvider):
    """基于 WebSocket 的人工审批提供者。

    通过 WebSocket 向 Helm UI 推送审批请求，
    等待人工响应后返回裁决结果。
    """

    def __init__(
        self,
        timeout_seconds: int = DEFAULT_APPROVAL_TIMEOUT_SECONDS,
        ws_manager: Any = None,
        escalation_chain: EscalationChain | None = None,
    ) -> None:
        super().__init__(timeout_seconds)
        self._ws_manager = ws_manager
        self._escalation_chain = escalation_chain
        self._pending: dict[str, ApprovalRequest] = {}
        self._responses: dict[str, ApprovalResponse] = {}

    async def request_approval(
        self,
        gate_name: str,
        task_id: str,
        context: dict[str, Any],
    ) -> str:
        """发起审批请求，通过 WebSocket 推送到 Helm UI。"""
        request = ApprovalRequest(
            gate_name=gate_name,
            task_id=task_id,
            context=context,
        )

        # 设置审批人
        if self._escalation_chain:
            level = self._escalation_chain.get_current_level()
            if level:
                request.approver = level.approver
                request.current_level = self._escalation_chain.current_level

        self._pending[request.approval_id] = request

        # 通过 WebSocket 推送审批请求
        if self._ws_manager is not None:
            try:
                await self._ws_manager.broadcast(
                    task_id=task_id,
                    event_type="gate_approval_request",
                    data={
                        "approval_id": request.approval_id,
                        "gate_name": gate_name,
                        "task_id": task_id,
                        "context": context,
                        "approver": request.approver,
                        "timeout_seconds": self._timeout_seconds,
                    },
                )
                logger.info(
                    f"[approval] sent approval request via WebSocket: "
                    f"approval_id={request.approval_id}, gate={gate_name}, "
                    f"approver={request.approver}"
                )
            except Exception as e:
                logger.error(f"[approval] failed to send WebSocket message: {e}")
        else:
            logger.info(
                f"[approval] no ws_manager, approval request recorded: "
                f"approval_id={request.approval_id}"
            )

        return request.approval_id

    async def check_approval(self, approval_id: str) -> GateVerdict | None:
        """检查审批结果。"""
        request = self._pending.get(approval_id)
        if request is None:
            return None

        response = self._responses.get(approval_id)
        if response is None:
            return None

        # 有响应，生成裁决
        if response.approved:
            verdict = GateVerdict(
                gate_id=request.gate_name,
                gate_name=request.gate_name,
                task_id=request.task_id,
                status=GateStatus.PASSED,
                overall_score=1.0,
                pass_threshold=0.0,
                decision="human_approved",
                reviewer_feedback=response.comment,
                decided_at=response.responded_at,
            )
        else:
            verdict = GateVerdict(
                gate_id=request.gate_name,
                gate_name=request.gate_name,
                task_id=request.task_id,
                status=GateStatus.FAILED,
                overall_score=0.0,
                pass_threshold=0.0,
                decision="human_rejected",
                reviewer_feedback=response.comment,
                decided_at=response.responded_at,
            )

        # 清理
        del self._pending[approval_id]
        del self._responses[approval_id]

        return verdict

    async def submit_response(self, response: ApprovalResponse) -> None:
        """提交审批响应（由 WebSocket handler 调用）。

        Args:
            response: 审批响应
        """
        if response.approval_id in self._pending:
            self._responses[response.approval_id] = response
            logger.info(
                f"[approval] response received: approval_id={response.approval_id}, "
                f"approved={response.approved}, approver={response.approver}"
            )
        else:
            logger.warning(
                f"[approval] received response for unknown approval_id={response.approval_id}"
            )

    async def wait_for_approval_with_escalation(
        self,
        approval_id: str,
    ) -> GateVerdict:
        """带升级链的审批等待。

        如果当前审批人超时，自动升级到下一级审批人。
        """
        if self._escalation_chain is None:
            return await self.wait_for_approval(approval_id)

        while not self._escalation_chain.is_exhausted():
            level = self._escalation_chain.get_current_level()
            if level is None:
                break

            timeout = level.timeout_seconds
            verdict = await self.wait_for_approval(approval_id, timeout_seconds=timeout)

            if verdict.decision != "timeout":
                return verdict

            # 超时，尝试升级
            next_level = self._escalation_chain.escalate()
            if next_level is None:
                break

            # 重新发起审批请求给下一级审批人
            request = self._pending.get(approval_id)
            if request:
                request.approver = next_level.approver
                request.current_level = self._escalation_chain.current_level

                if self._ws_manager is not None:
                    try:
                        await self._ws_manager.broadcast(
                            task_id=request.task_id,
                            event_type="gate_approval_escalation",
                            data={
                                "approval_id": approval_id,
                                "gate_name": request.gate_name,
                                "new_approver": next_level.approver,
                                "escalation_level": self._escalation_chain.current_level,
                            },
                        )
                    except Exception as e:
                        logger.error(f"[approval] failed to send escalation message: {e}")

        # 所有升级级别都用完
        return GateVerdict(
            gate_id="",
            gate_name="",
            task_id="",
            status=GateStatus.TIMEOUT,
            overall_score=0.0,
            pass_threshold=0.0,
            decision="timeout",
            reviewer_feedback="All escalation levels timed out",
            decided_at=datetime.now(),
        )


def create_approval_provider_from_config(
    gate_config: dict[str, Any],
    ws_manager: Any = None,
) -> WebSocketApprovalProvider:
    """从门禁配置创建审批提供者。

    配置格式:
        human_approval:
          timeout_seconds: 3600
          escalation_chain:
            - approver: "tech_lead"
              timeout_seconds: 1800
            - approver: "engineering_manager"
              timeout_seconds: 3600
    """
    approval_cfg = gate_config.get("human_approval", {})
    timeout = approval_cfg.get("timeout_seconds", DEFAULT_APPROVAL_TIMEOUT_SECONDS)

    escalation_chain = EscalationChain.from_config(approval_cfg)

    return WebSocketApprovalProvider(
        timeout_seconds=timeout,
        ws_manager=ws_manager,
        escalation_chain=escalation_chain if escalation_chain.levels else None,
    )
