"""ResumeAdapter — 打通Workflow YAML与LangGraph Command(resume=...)

设计文档参考：S3.0-25, spec.md v2.2
让审核流程（暂停→人工审核→恢复）可以通过YAML定义
"""
from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ResumeCommand(BaseModel):
    """LangGraph Command(resume=...) 的适配模型"""
    resume_values: dict[str, Any] = {}
    interrupt_before: list[str] = []
    checkpoint_id: str = ""
    workflow_id: str = ""
    node_name: str = ""


class HumanReviewConfig(BaseModel):
    """Human Review 节点配置"""
    node_name: str = ""
    interrupt_before: bool = True
    timeout: float = 3600.0  # 审核超时（秒）
    auto_approve_after_timeout: bool = False
    required_fields: list[str] = []  # 审核必须填写的字段
    allowed_actions: list[str] = ["approve", "reject", "request_changes"]


class ResumeAdapter:
    """Resume适配器 — 打通Workflow YAML与LangGraph resume机制

    功能：
    1. 将Workflow YAML的human_review节点编译为LangGraph interrupt_before配置
    2. 提供resume_workflow API，接收审核结果并恢复工作流
    3. 支持审核超时处理
    4. 支持persona锁在审核暂停期间保留
    """

    def __init__(self, event_bus: Any = None, checkpoint_manager: Any = None):
        self._event_bus = event_bus
        self._checkpoint_manager = checkpoint_manager
        self._pending_reviews: dict[str, dict[str, Any]] = {}

    def compile_interrupt_config(self, workflow_config: dict[str, Any]) -> dict[str, Any]:
        """从Workflow YAML配置编译LangGraph interrupt_before配置

        扫描workflow_config中的human_review节点，生成interrupt_before列表
        """
        interrupt_nodes = []
        nodes = workflow_config.get("nodes", [])

        for node in nodes:
            node_type = node.get("type", "")
            if node_type == "human_review":
                node_name = node.get("name", "")
                if node_name:
                    interrupt_nodes.append(node_name)

        # 也检查有interrupt_before标记的节点
        for node in nodes:
            if node.get("interrupt_before", False):
                node_name = node.get("name", "")
                if node_name and node_name not in interrupt_nodes:
                    interrupt_nodes.append(node_name)

        return {
            "interrupt_before": interrupt_nodes,
            "has_human_review": len(interrupt_nodes) > 0,
        }

    def create_review_request(
        self,
        workflow_id: str,
        node_name: str,
        state: dict[str, Any],
        config: HumanReviewConfig | None = None,
    ) -> dict[str, Any]:
        """创建审核请求

        当工作流执行到human_review节点时调用
        """
        config = config or HumanReviewConfig()
        review_id = f"{workflow_id}:{node_name}"

        request = {
            "review_id": review_id,
            "workflow_id": workflow_id,
            "node_name": node_name,
            "state_snapshot": state,
            "config": config.model_dump(),
            "created_at": __import__("time").time(),
            "status": "pending",
        }

        self._pending_reviews[review_id] = request

        # 发出审核请求事件
        if self._event_bus:
            try:
                __import__("asyncio").get_event_loop().create_task(
                    self._event_bus.emit("workflow.review_required", {
                        "review_id": review_id,
                        "workflow_id": workflow_id,
                        "node_name": node_name,
                        "required_fields": config.required_fields,
                        "allowed_actions": config.allowed_actions,
                    })
                )
            except Exception:
                pass

        return request

    async def resume_workflow(
        self,
        workflow_id: str,
        node_name: str,
        review_action: str,
        review_data: dict[str, Any] | None = None,
        reviewer: str = "",
    ) -> dict[str, Any]:
        """恢复工作流 — 对应LangGraph的Command(resume=...)

        Args:
            workflow_id: 工作流ID
            node_name: 审核节点名称
            review_action: 审核动作 approve/reject/request_changes
            review_data: 审核数据
            reviewer: 审核人

        Returns:
            ResumeCommand用于恢复LangGraph执行
        """
        review_id = f"{workflow_id}:{node_name}"
        review = self._pending_reviews.get(review_id)

        if not review:
            logger.warning(f"No pending review found for {review_id}")
            return {"status": "error", "reason": "No pending review"}

        # 更新审核状态
        review["status"] = review_action
        review["reviewer"] = reviewer
        review["review_data"] = review_data or {}
        review["completed_at"] = __import__("time").time()

        # 构建resume_values
        resume_values = {
            "review_action": review_action,
            "review_data": review_data or {},
            "reviewer": reviewer,
            "approved": review_action == "approve",
        }

        # 如果reject或request_changes，添加反馈
        if review_action in ("reject", "request_changes"):
            resume_values["feedback"] = (review_data or {}).get("feedback", "")
            resume_values["requested_changes"] = (review_data or {}).get("changes", [])

        # 构建ResumeCommand
        command = ResumeCommand(
            resume_values=resume_values,
            interrupt_before=[node_name],
            workflow_id=workflow_id,
            node_name=node_name,
        )

        # 清理pending
        self._pending_reviews.pop(review_id, None)

        # 发出审核完成事件
        if self._event_bus:
            await self._event_bus.emit("workflow.review_completed", {
                "review_id": review_id,
                "workflow_id": workflow_id,
                "action": review_action,
                "reviewer": reviewer,
            })

        return command.model_dump()

    def get_pending_reviews(self, workflow_id: str | None = None) -> list[dict[str, Any]]:
        """获取待审核列表"""
        reviews = list(self._pending_reviews.values())
        if workflow_id:
            reviews = [r for r in reviews if r["workflow_id"] == workflow_id]
        return reviews

    def check_timeout(self) -> list[str]:
        """检查超时的审核请求"""
        import time
        now = time.time()
        timed_out = []
        for review_id, review in list(self._pending_reviews.items()):
            config = review.get("config", {})
            timeout = config.get("timeout", 3600.0)
            auto_approve = config.get("auto_approve_after_timeout", False)

            if now - review.get("created_at", now) > timeout:
                if auto_approve:
                    # 自动批准
                    review["status"] = "auto_approved"
                    self._pending_reviews.pop(review_id, None)
                    logger.info(f"Review {review_id} auto-approved after timeout")
                else:
                    timed_out.append(review_id)
        return timed_out
