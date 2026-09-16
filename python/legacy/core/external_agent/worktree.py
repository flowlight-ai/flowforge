"""ExternalAgentWorktree — 三方 Agent worktree 隔离机制（EX-005）。

每个三方 Agent 调用必须创建独立 worktree：
    - 网络隔离：仅允许访问必要域名
    - 文件权限：仅允许访问 worktree
    - 操作审计：所有 tool call 记录
    - 操作回滚：错误操作可恢复

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-005 三方 Agent 安全沙箱不足
    - [doc:decisions/006-external-agent-integration.md] §7 worktree 隔离
    - [doc:design/naming-contract.md#2.11] 觉醒阶（六层 Guardrails）

铁律遵守：
    - 铁律 5：禁止硬编码路径（worktree_root 由 host 注入）
    - 铁律 3：依赖通过构造函数注入
    - 所有 I/O 操作使用 async/await

License: MIT
"""

from __future__ import annotations

import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.worktree")


class WorktreeConfig(BaseModel):
    """worktree 配置（host 注入，铁律 5）。"""

    worktree_root: str = Field(..., description="worktree 根目录（host 决定）")
    source_repo: Optional[str] = Field(
        default=None, description="源仓库路径（用于 git worktree 创建）"
    )
    network_allowlist: list[str] = Field(
        default_factory=list, description="默认网络白名单"
    )
    readonly_paths: list[str] = Field(
        default_factory=list,
        description="只读路径（如 VISION.md / rules.md / 项目铁律）",
    )
    enable_rollback: bool = Field(
        default=True, description="是否启用操作回滚（snapshot）"
    )


class AuditEntry(BaseModel):
    """操作审计条目（EX-005 操作审计）。"""

    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="操作时间戳",
    )
    provider_name: str = Field(..., description="执行操作的三方 Agent")
    operation: str = Field(..., description="操作类型（file_write / git / shell）")
    target: str = Field(..., description="操作目标（文件路径 / 命令）")
    success: bool = Field(..., description="是否成功")
    details: dict[str, Any] = Field(
        default_factory=dict, description="操作详情"
    )


class ExternalAgentWorktree:
    """三方 Agent worktree 隔离机制（EX-005）。

    每个三方 Agent 调用必须创建独立 worktree：
        - 网络隔离：仅允许访问必要域名
        - 文件权限：仅允许访问 worktree
        - 操作审计：所有 tool call 记录
        - 操作回滚：错误操作可恢复

    详见 [doc:review/review.md#第九章§9.2] EX-005

    使用流程：
        1. worktree = ExternalAgentWorktree(config)
        2. await worktree.create(provider_name, forgekin_id)
        3. sandbox = worktree.get_sandbox_config()
        4. adapter.invoke(task, sandbox=sandbox)
        5. await worktree.audit(provider_name, "file_write", target, True)
        6. 出错时 await worktree.rollback()
        7. 任务完成 await worktree.cleanup()
    """

    def __init__(self, config: WorktreeConfig) -> None:
        """注入 worktree 配置。

        Args:
            config: worktree 配置（worktree_root 由 host 注入）。
        """
        self._config = config
        self._worktree_path: Optional[Path] = None
        self._snapshot_path: Optional[Path] = None
        self._audit_log: list[AuditEntry] = []
        self._forgekin_id: str = ""
        self._provider_name: str = ""

    @property
    def worktree_path(self) -> str:
        """当前 worktree 路径（create 后可用）。"""
        if self._worktree_path is None:
            raise RuntimeError("Worktree not created yet. Call create() first.")
        return str(self._worktree_path)

    async def create(
        self,
        provider_name: str,
        forgekin_id: str,
        source_subdir: Optional[str] = None,
    ) -> str:
        """创建独立 worktree。

        Args:
            provider_name: 调用的三方 Agent 名称（用于命名 worktree）。
            forgekin_id: Forgekin ID（用于命名 worktree）。
            source_subdir: 源子目录（如 "flowforge/"，None 时复制整个 source_repo）。

        Returns:
            worktree 路径。
        """
        # 生成唯一 worktree 名（provider-forgekin-uuid8）
        short_uuid = uuid.uuid4().hex[:8]
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        worktree_name = f"{provider_name.replace('.', '_')}-{forgekin_id.replace(':', '_')}-{timestamp}-{short_uuid}"
        worktree_path = Path(self._config.worktree_root) / worktree_name
        worktree_path.mkdir(parents=True, exist_ok=True)

        # 复制源仓库内容（如配置了 source_repo）
        if self._config.source_repo:
            src = Path(self._config.source_repo)
            if source_subdir:
                src = src / source_subdir
            if src.exists():
                # 注意：仅复制必要文件，避免复制 .git / node_modules 等
                for item in src.iterdir():
                    if item.name in {".git", "node_modules", "__pycache__", ".venv"}:
                        continue
                    dest = worktree_path / item.name
                    if item.is_dir():
                        shutil.copytree(item, dest, dirs_exist_ok=True)
                    else:
                        shutil.copy2(item, dest)

        # 创建快照（用于回滚，EX-005 操作回滚）
        if self._config.enable_rollback:
            snapshot_path = worktree_path.parent / f"{worktree_name}.snapshot"
            # 简单实现：复制一份作为快照（生产环境可用 git stash / cp -r 优化）
            shutil.copytree(worktree_path, snapshot_path, dirs_exist_ok=True)
            self._snapshot_path = snapshot_path

        self._worktree_path = worktree_path
        self._forgekin_id = forgekin_id
        self._provider_name = provider_name
        self._audit_log = []

        logger.info(
            "worktree.create provider=%s forgekin=%s path=%s snapshot=%s",
            provider_name,
            forgekin_id,
            worktree_path,
            self._snapshot_path is not None,
        )
        return str(worktree_path)

    def get_sandbox_config(self) -> dict[str, Any]:
        """获取 sandbox 配置（host-owned，传递给 HostInjector）。

        Returns:
            sandbox 配置字典（cwd / network_allowlist / writable_paths / readonly_paths）。
        """
        if self._worktree_path is None:
            raise RuntimeError("Worktree not created yet. Call create() first.")
        return {
            "cwd": str(self._worktree_path),
            "network_allowlist": list(self._config.network_allowlist),
            "writable_paths": [str(self._worktree_path)],
            "readonly_paths": list(self._config.readonly_paths),
        }

    async def audit(
        self,
        provider_name: str,
        operation: str,
        target: str,
        success: bool,
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        """记录操作审计（EX-005 操作审计）。

        所有三方 Agent 的 tool call 必须通过此方法记录，
        审计日志会写入 harness-feedback/external-agent-traces/。

        Args:
            provider_name: 执行操作的三方 Agent。
            operation: 操作类型（file_write / file_read / git / shell / network）。
            target: 操作目标（文件路径 / 命令 / URL）。
            success: 是否成功。
            details: 操作详情（如 git diff / shell stdout 摘要）。
        """
        entry = AuditEntry(
            provider_name=provider_name,
            operation=operation,
            target=target,
            success=success,
            details=details or {},
        )
        self._audit_log.append(entry)
        logger.debug(
            "worktree.audit provider=%s op=%s target=%s success=%s",
            provider_name,
            operation,
            target,
            success,
        )

    async def rollback(self) -> bool:
        """回滚到快照（EX-005 操作回滚）。

        错误操作可恢复——从快照恢复 worktree 内容。

        Returns:
            是否成功回滚（无快照时返回 False）。
        """
        if self._snapshot_path is None or self._worktree_path is None:
            logger.warning("worktree.rollback no snapshot available")
            return False
        # 清空当前 worktree，从快照恢复
        for item in self._worktree_path.iterdir():
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()
        for item in self._snapshot_path.iterdir():
            dest = self._worktree_path / item.name
            if item.is_dir():
                shutil.copytree(item, dest, dirs_exist_ok=True)
            else:
                shutil.copy2(item, dest)
        logger.info(
            "worktree.rollback path=%s restored_from=%s",
            self._worktree_path,
            self._snapshot_path,
        )
        return True

    async def cleanup(self) -> None:
        """清理 worktree 和快照（任务完成后调用）。

        注意：审计日志在 cleanup 前应已持久化到外部存储
        （由 host 调用 export_audit_log 后再 cleanup）。
        """
        if self._worktree_path and self._worktree_path.exists():
            shutil.rmtree(self._worktree_path, ignore_errors=True)
        if self._snapshot_path and self._snapshot_path.exists():
            shutil.rmtree(self._snapshot_path, ignore_errors=True)
        logger.info(
            "worktree.cleanup provider=%s forgekin=%s audit_entries=%d",
            self._provider_name,
            self._forgekin_id,
            len(self._audit_log),
        )

    def export_audit_log(self) -> list[dict[str, Any]]:
        """导出审计日志（供持久化到 harness-feedback/external-agent-traces/）。"""
        return [entry.model_dump() for entry in self._audit_log]
