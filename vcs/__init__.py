"""FlowForge VCS 模块 — 版本控制与代码上库流程.

FlowForge worktree + PR + merge-gate 方法论。

模块组成：
- worktree: Git worktree 隔离开发环境管理（F073 门禁 + 基线测试）
- pull_request: GitHub PR 创建与管理（body 合规检查 + review 触发 + squash merge）
- merge_gate: Merge-gate 门禁检查（5 硬条件 + Evidence Validation E1-E5 +
              Review Continuity Guard）
- branch_lifecycle: 分支生命周期管理（feat/* → review → merge → cleanup）
- feature_truth: Feature doc truth 核对（pre-merge 核对 + post-merge 更新）

架构依赖（单向，遵守铁律）：
    vcs.worktree ← vcs.branch_lifecycle
    vcs.pull_request ← vcs.merge_gate
    vcs.feature_truth（独立）
    所有模块 → flowforge.core.tracing

SOP 集成：
    MergeGateChecker 可被 flowforge/sop/engine.py 的谓词检查器调用，
    将 MergeGateResult 转换为 PredicateResult 以接入 SOP 门禁流程。
"""
from __future__ import annotations

from flowforge.vcs.branch_lifecycle import BranchLifecycle
from flowforge.vcs.feature_truth import FeatureTruthChecker, TruthResult
from flowforge.vcs.merge_gate import (
    ContinuityResult,
    EvidenceResult,
    HeadChangeCause,
    MergeContext,
    MergeGateChecker,
    MergeGateResult,
    NextGateOwner,
    Verdict,
)
from flowforge.vcs.pull_request import (
    CIStatus,
    MergeResult,
    PRInfo,
    PullRequestManager,
    ReviewStatus,
)
from flowforge.vcs.worktree import (
    SyncStatus,
    WorktreeInfo,
    WorktreeManager,
)

__all__ = [
    # Managers
    "WorktreeManager",
    "PullRequestManager",
    "MergeGateChecker",
    "BranchLifecycle",
    "FeatureTruthChecker",
    # Worktree models
    "WorktreeInfo",
    "SyncStatus",
    # PR models
    "PRInfo",
    "ReviewStatus",
    "MergeResult",
    "CIStatus",
    # Merge gate models
    "MergeContext",
    "MergeGateResult",
    "EvidenceResult",
    "ContinuityResult",
    "HeadChangeCause",
    "NextGateOwner",
    "Verdict",
    # Feature truth models
    "TruthResult",
]
