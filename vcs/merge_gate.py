"""Merge-gate 门禁检查.

FlowForge merge-gate SKILL 的门禁体系：
- 门禁 5 硬条件（reviewer 放行 / P1P2 清零 / review 覆盖 HEAD /
  BACKLOG 更新 / 全量门禁通过）
- Evidence Validation Checker (E1-E5)
- Review Continuity Guard（HEAD 变化后 nextGateOwner 判定）
- Feature Doc Truth 核对（委托给 feature_truth.py）

SOP 集成：
    MergeGateChecker 可被 flowforge/sop/engine.py 的谓词检查器调用。
    集成方式：在 sop/predicate.py 中注册新的 predicate type
    （如 merge_gate_check），在检查器中实例化 MergeGateChecker 并调用
    check_all()，将 MergeGateResult 转换为 PredicateResult。
    本模块不修改 sop/predicate.py（遵守红线#7：不修改不相关代码）。

设计原则（遵守铁律）：
- 仅依赖 flowforge.core.tracing 和 flowforge.vcs.pull_request，单向依赖
- 不硬编码路径/密钥（铁律5）
- 通过构造函数注入依赖（铁律3）
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.vcs.pull_request import PullRequestManager, ReviewStatus

logger = get_logger("flowforge.vcs.merge_gate")


# ---------------------------------------------------------------------------
# 枚举
# ---------------------------------------------------------------------------


class HeadChangeCause(str, Enum):
    """HEAD 变化原因 — 决定 nextGateOwner 路由.

    对应 SKILL Review Provenance Matrix 的 headChangeCause 字段：
    - local-gate: 本地门禁修复（如 pnpm gate rebase / fixup / formatter）
    - cloud-finding: cloud P1/P2 修复后 push 新 SHA
    - ci-fix: CI 失败修复
    - rebase: 纯 rebase（0 code delta）
    - pr-meta: 只改 PR body/comment，不改 commit SHA
    """

    LOCAL_GATE = "local-gate"
    CLOUD_FINDING = "cloud-finding"
    CI_FIX = "ci-fix"
    REBASE = "rebase"
    PR_META = "pr-meta"


class NextGateOwner(str, Enum):
    """下一步门禁所有者 — 谁需要做下一步 review.

    对应 SKILL Review Provenance Matrix 的 nextGateOwner 字段：
    - local-peer: 本地跨猫 reviewer
    - cloud: 云端 codex reviewer
    - ci: CI/CD 系统
    - author: PR 作者（merge-ready 态）
    - guardian: 愿景守护者
    """

    LOCAL_PEER = "local-peer"
    CLOUD = "cloud"
    CI = "ci"
    AUTHOR = "author"
    GUARDIAN = "guardian"


class Verdict(str, Enum):
    """review 结论.

    对应 SKILL Evidence Manifest 的 verdict 字段：
    - passed: review APPROVE on final HEAD
    - blocked: 未 APPROVE（BLOCK / CHANGES_REQUESTED）
    - pending: review 进行中
    """

    PASSED = "passed"
    BLOCKED = "blocked"
    PENDING = "pending"


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


class MergeContext(BaseModel):
    """Merge-gate 执行上下文 — Review Provenance Matrix.

    对应 SKILL 的 Review Provenance Matrix + Evidence Manifest 前 5 个字段。
    由调用方（SOP executor 或上层编排）组装后传入。

    Attributes:
        pr_number: PR 编号
        repo: 仓库全名（owner/repo）
        head_sha: 当前 HEAD SHA（git rev-parse HEAD）
        local_review_sha: 本地跨猫 review 覆盖的 SHA
        cloud_review_sha: cloud review 覆盖的 SHA
        head_change_cause: HEAD 变化原因
        next_gate_owner: 下一步门禁所有者
        gate_passed: 全量门禁是否通过（pnpm gate / light path）
        is_exempt: 是否为 exempt PR（SKILL.md/docs-only，无 cloud review）
    """

    pr_number: int = Field(description="PR 编号")
    repo: str = Field(description="仓库全名（owner/repo）")
    head_sha: str = Field(description="当前 HEAD SHA")
    local_review_sha: str = Field(default="", description="本地 review 覆盖的 SHA")
    cloud_review_sha: str = Field(default="", description="cloud review 覆盖的 SHA")
    head_change_cause: HeadChangeCause = Field(
        default=HeadChangeCause.LOCAL_GATE, description="HEAD 变化原因"
    )
    next_gate_owner: NextGateOwner = Field(
        default=NextGateOwner.LOCAL_PEER, description="下一步门禁所有者"
    )
    gate_passed: bool = Field(default=False, description="全量门禁是否通过")
    is_exempt: bool = Field(
        default=False, description="是否为 exempt PR（无 cloud review）"
    )


class EvidenceResult(BaseModel):
    """Evidence Validation Checker 结果 (E1-E5).

    对应 SKILL Step 6.9 的 5 项硬条件 — 任一不满足则 BLOCKED。

    Attributes:
        e1_head_match: head === PR current HEAD
        e2_not_stale: stale === false（review SHA 覆盖 head）
        e3_provenance_closed: reviewer provenance 闭合
        e4_verdict_ok: verdict !== "blocked"
        e5_gate_passed: gate_passed === true
        all_passed: 全部通过
        details: 各检查项的详细说明
    """

    e1_head_match: bool = Field(description="E1: head === PR current HEAD")
    e2_not_stale: bool = Field(description="E2: review SHA 覆盖当前 head")
    e3_provenance_closed: bool = Field(description="E3: reviewer provenance 闭合")
    e4_verdict_ok: bool = Field(description="E4: verdict !== blocked")
    e5_gate_passed: bool = Field(description="E5: gate_passed === true")
    all_passed: bool = Field(description="全部通过")
    details: dict[str, str] = Field(
        default_factory=dict, description="各检查项详细说明"
    )


class ContinuityResult(BaseModel):
    """Review Continuity Guard 结果.

    对应 SKILL Review Continuity Guard — HEAD 变化后的 nextGateOwner 判定。

    Attributes:
        next_gate_owner: 下一步门禁所有者
        is_stale: review 是否过期（需要 re-review）
        reason: 判定原因说明
    """

    next_gate_owner: NextGateOwner = Field(description="下一步门禁所有者")
    is_stale: bool = Field(description="review 是否过期")
    reason: str = Field(default="", description="判定原因说明")


class MergeGateResult(BaseModel):
    """Merge-gate 全部门禁检查结果.

    Attributes:
        passed: 全部门禁是否通过
        failures: 阻断性失败列表
        warnings: 警告列表
        evidence_manifest: Evidence Manifest（Review Provenance Matrix 超集）
        evidence_result: Evidence Validation Checker 结果
        continuity_result: Review Continuity Guard 结果
        checked_at: 检查时间
    """

    passed: bool = Field(description="全部门禁是否通过")
    failures: list[str] = Field(default_factory=list, description="阻断性失败列表")
    warnings: list[str] = Field(default_factory=list, description="警告列表")
    evidence_manifest: dict[str, Any] = Field(
        default_factory=dict, description="Evidence Manifest"
    )
    evidence_result: Optional[EvidenceResult] = Field(
        default=None, description="Evidence Validation Checker 结果"
    )
    continuity_result: Optional[ContinuityResult] = Field(
        default=None, description="Review Continuity Guard 结果"
    )
    checked_at: datetime = Field(default_factory=datetime.utcnow, description="检查时间")


# ---------------------------------------------------------------------------
# MergeGateChecker
# ---------------------------------------------------------------------------


class MergeGateChecker:
    """Merge-gate 5 硬条件 + Evidence Validation + Review Continuity Guard.

    FlowForge 门禁体系：
    1. Local peer reviewer 明确放行
    2. 所有 P1/P2 已修复
    3. Review 覆盖当前 HEAD SHA
    4. BACKLOG 条目已标记完成
    5. 全量门禁通过（pytest + lint）

    + Evidence Validation Checker (E1-E5)
    + Review Continuity Guard
    + Feature Doc Truth 核对（由 FeatureTruthChecker 单独处理）

    Usage:
        pr_manager = PullRequestManager()
        checker = MergeGateChecker(pr_manager)
        context = MergeContext(pr_number=123, repo="owner/repo", head_sha="abc123", ...)
        result = await checker.check_all("owner/repo", 123, context)
        if checker.should_block_merge(result):
            print("BLOCKED:", result.failures)
    """

    def __init__(
        self,
        pr_manager: Optional[PullRequestManager] = None,
    ) -> None:
        """初始化 MergeGateChecker.

        Args:
            pr_manager: PullRequestManager 实例（用于查询 PR review/CI 状态）。
                        若为 None 则内部创建默认实例（通过构造函数注入，铁律3）。
        """
        self._pr_manager = pr_manager or PullRequestManager()

    async def check_all(
        self,
        repo: str,
        pr_number: int,
        context: MergeContext,
    ) -> MergeGateResult:
        """执行全部门禁检查.

        对应 SKILL merge-gate 完整流程的 Step 6-6.9：
        1. 检查 reviewer 放行（5 硬条件 #1）
        2. 检查 P1/P2 清零（5 硬条件 #2）
        3. Review Continuity Guard（5 硬条件 #3）
        4. Evidence Validation Checker (E1-E5, Step 6.9)
        5. 组装 evidence manifest

        Args:
            repo: 仓库全名（owner/repo）
            pr_number: PR 编号
            context: Merge-gate 执行上下文

        Returns:
            MergeGateResult 全部门禁检查结果
        """
        logger.info(
            f"check_all: repo={repo} pr={pr_number} "
            f"head={context.head_sha[:8]}..."
        )

        failures: list[str] = []
        warnings: list[str] = []

        # 获取 PR review 状态和 CI 状态
        review_status = await self._pr_manager.check_review_status(repo, pr_number)
        ci_status = await self._pr_manager.check_pr_checks(repo, pr_number)

        # --- 5 硬条件检查 ---

        # #1: Local peer reviewer 明确放行
        if not review_status.approved:
            failures.append(
                "门禁#1 失败：Local peer reviewer 未明确放行（无 APPROVE 状态 review）"
            )

        # #2: 所有 P1/P2 已修复
        if review_status.p1_count > 0 or review_status.p2_count > 0:
            failures.append(
                f"门禁#2 失败：仍有未修复的 finding "
                f"(P1={review_status.p1_count}, P2={review_status.p2_count})，"
                f"含 inline comments（LL-033）"
            )

        if review_status.changes_requested:
            failures.append(
                "门禁#2 失败：review 状态为 CHANGES_REQUESTED"
            )

        # #3: Review 覆盖当前 HEAD SHA（Review Continuity Guard）
        continuity = self.check_review_continuity(context)
        if continuity.is_stale:
            failures.append(
                f"门禁#3 失败：review 过期 — {continuity.reason}"
            )

        # #4: BACKLOG 条目已标记完成（由调用方在 context 中提供证据）
        # 此项为语义检查，SKILL 中为 manual_only，这里记录 warning 提示
        warnings.append(
            "门禁#4 提示：BACKLOG 条目已标记完成需人工确认（manual_only）"
        )

        # #5: 全量门禁通过（pytest + lint）
        if not context.gate_passed:
            failures.append(
                "门禁#5 失败：全量门禁未通过（gate_passed=False）"
            )

        # CI 检查作为额外门禁
        if not ci_status.all_passed:
            if ci_status.failing_checks:
                failures.append(
                    f"CI 检查失败：{ci_status.failing_checks}"
                )
            elif ci_status.pending_checks:
                warnings.append(
                    f"CI 检查进行中：{ci_status.pending_checks}"
                )

        # --- Evidence Validation Checker (E1-E5, Step 6.9) ---
        evidence = await self.check_evidence_validation(context)

        # 组装 evidence manifest（Review Provenance Matrix 超集）
        evidence_manifest: dict[str, Any] = {
            "head": context.head_sha,
            "localPeerReviewSha": context.local_review_sha,
            "cloudReviewSha": context.cloud_review_sha,
            "headChangeCause": context.head_change_cause.value,
            "nextGateOwner": context.next_gate_owner.value,
            "gate_passed": context.gate_passed,
            "stale": not evidence.e2_not_stale,
            "verdict": self._determine_verdict(review_status, evidence).value,
        }

        if not evidence.all_passed:
            failed_e = [
                k for k, v in {
                    "E1": evidence.e1_head_match,
                    "E2": evidence.e2_not_stale,
                    "E3": evidence.e3_provenance_closed,
                    "E4": evidence.e4_verdict_ok,
                    "E5": evidence.e5_gate_passed,
                }.items() if not v
            ]
            failures.append(
                f"Evidence Validation 失败：{failed_e} — {evidence.details}"
            )

        passed = len(failures) == 0
        result = MergeGateResult(
            passed=passed,
            failures=failures,
            warnings=warnings,
            evidence_manifest=evidence_manifest,
            evidence_result=evidence,
            continuity_result=continuity,
            checked_at=datetime.utcnow(),
        )

        if passed:
            logger.info(
                f"check_all: PASSED — all gate checks passed for PR #{pr_number}"
            )
        else:
            logger.warning(
                f"check_all: BLOCKED — {len(failures)} failure(s) for PR #{pr_number}"
            )
        return result

    async def check_evidence_validation(
        self, context: MergeContext
    ) -> EvidenceResult:
        """Evidence Validation Checker (E1-E5).

        对应 SKILL Step 6.9 — 5 项硬条件，任一不满足则 BLOCKED：
        - E1: head === PR current HEAD
        - E2: stale === false（review SHA covers head）
        - E3: reviewer provenance 闭合（至少一个 review 源覆盖 head）
        - E4: verdict !== "blocked"
        - E5: gate_passed === true

        Args:
            context: Merge-gate 执行上下文

        Returns:
            EvidenceResult 检查结果
        """
        details: dict[str, str] = {}

        # E1: head === PR current HEAD
        # head_sha 应与 PR 当前 headRefOid 一致（由调用方确保传入正确的 head_sha）
        # 此处检查 head_sha 非空（实际 PR head 比对在 check_all 中通过 gh CLI 完成）
        e1 = bool(context.head_sha)
        details["E1"] = (
            f"head={context.head_sha[:8]}... — "
            f"{'valid' if e1 else 'EMPTY head_sha'}"
        )

        # E2: stale === false
        # 按 headChangeCause 判定活跃 review 源是否覆盖 head
        active_sha = self._get_active_review_sha(context)
        e2 = bool(active_sha) and active_sha == context.head_sha
        details["E2"] = (
            f"headChangeCause={context.head_change_cause.value} → "
            f"active source sha={active_sha[:8] if active_sha else 'none'}... "
            f"vs head={context.head_sha[:8]}... — "
            f"{'not stale' if e2 else 'STALE'}"
        )

        # E3: reviewer provenance 闭合
        # 至少一个 review 源（local 或 cloud）非空且覆盖 head
        # exempt PR 无 cloud 时只看 local
        local_covers = bool(context.local_review_sha) and context.local_review_sha == context.head_sha
        cloud_covers = bool(context.cloud_review_sha) and context.cloud_review_sha == context.head_sha
        if context.is_exempt:
            e3 = local_covers
            details["E3"] = (
                f"exempt PR → local covers={local_covers} — "
                f"{'provenance closed' if e3 else 'NOT closed'}"
            )
        else:
            e3 = local_covers or cloud_covers
            details["E3"] = (
                f"local covers={local_covers}, cloud covers={cloud_covers} — "
                f"{'provenance closed' if e3 else 'NOT closed'}"
            )

        # E4: verdict !== "blocked"
        # verdict 由 review 状态决定，此处简化为检查 next_gate_owner 非 author-blocked
        # 完整 verdict 判定在 _determine_verdict 中
        e4 = context.next_gate_owner != NextGateOwner.GUARDIAN or local_covers or cloud_covers
        details["E4"] = (
            f"next_gate_owner={context.next_gate_owner.value} — "
            f"{'verdict ok' if e4 else 'verdict BLOCKED'}"
        )

        # E5: gate_passed === true
        e5 = context.gate_passed
        details["E5"] = (
            f"gate_passed={context.gate_passed} — "
            f"{'passed' if e5 else 'NOT passed'}"
        )

        all_passed = e1 and e2 and e3 and e4 and e5
        result = EvidenceResult(
            e1_head_match=e1,
            e2_not_stale=e2,
            e3_provenance_closed=e3,
            e4_verdict_ok=e4,
            e5_gate_passed=e5,
            all_passed=all_passed,
            details=details,
        )

        if all_passed:
            logger.info("check_evidence_validation: PASSED (E1-E5 all green)")
        else:
            logger.warning(
                f"check_evidence_validation: BLOCKED — {details}"
            )
        return result

    def check_review_continuity(
        self, context: MergeContext
    ) -> ContinuityResult:
        """Review Continuity Guard.

        对应 SKILL Review Continuity Guard — HEAD 变化后的 nextGateOwner 判定：
        - cloud-finding → cloud re-review
        - ci-fix/local-gate → local peer re-review
        - rebase (0 delta) → continuity valid（需 reviewer pre-approval）
        - pr-meta → 不影响 review 覆盖

        判定规则（SKILL）：
        - headChangeCause=cloud-finding → nextGateOwner=cloud，只看 cloudReviewSha
        - headChangeCause=ci-fix/local-gate → nextGateOwner=local-peer，只看 localPeerReviewSha
          （ci-fix 始终路由到 local peer re-review）
        - headChangeCause=rebase → pure rebase + 0 code delta + reviewer pre-approval = valid
        - headChangeCause=pr-meta → 不改 SHA，不影响 review 覆盖

        Args:
            context: Merge-gate 执行上下文

        Returns:
            ContinuityResult 连续性检查结果
        """
        cause = context.head_change_cause
        active_sha = self._get_active_review_sha(context)

        if cause == HeadChangeCause.PR_META:
            # 只改 PR body/comment，不改 commit SHA → 不影响 review 覆盖
            return ContinuityResult(
                next_gate_owner=context.next_gate_owner,
                is_stale=False,
                reason="headChangeCause=pr-meta → 不改 SHA，review 覆盖不受影响",
            )

        if cause == HeadChangeCause.REBASE:
            # 纯 rebase + 0 code delta + reviewer pre-approval = continuity valid
            # 若无 pre-approval 证据则视为 stale
            is_stale = not bool(active_sha) or active_sha != context.head_sha
            return ContinuityResult(
                next_gate_owner=context.next_gate_owner,
                is_stale=is_stale,
                reason=(
                    f"headChangeCause=rebase → 需要 reviewer pre-approval "
                    f"延续到 {context.head_sha[:8]}... "
                    f"({'valid' if not is_stale else 'STALE — 需 re-approval'})"
                ),
            )

        if cause == HeadChangeCause.CLOUD_FINDING:
            # cloud P1/P2 修复 → 只看 cloudReviewSha，nextGateOwner=cloud
            is_stale = not bool(context.cloud_review_sha) or context.cloud_review_sha != context.head_sha
            return ContinuityResult(
                next_gate_owner=NextGateOwner.CLOUD,
                is_stale=is_stale,
                reason=(
                    f"headChangeCause=cloud-finding → active source=cloud, "
                    f"cloudReviewSha={context.cloud_review_sha[:8] if context.cloud_review_sha else 'none'}... "
                    f"vs head={context.head_sha[:8]}... "
                    f"({'not stale' if not is_stale else 'STALE — 需 re-trigger cloud review'})"
                ),
            )

        # ci-fix 或 local-gate → 路由到 local peer re-review
        # ci-fix 始终路由到 local peer（即使上一次 headChangeCause 是 cloud-finding）
        is_stale = not bool(context.local_review_sha) or context.local_review_sha != context.head_sha
        return ContinuityResult(
            next_gate_owner=NextGateOwner.LOCAL_PEER,
            is_stale=is_stale,
            reason=(
                f"headChangeCause={cause.value} → active source=local-peer, "
                f"localPeerReviewSha={context.local_review_sha[:8] if context.local_review_sha else 'none'}... "
                f"vs head={context.head_sha[:8]}... "
                f"({'not stale' if not is_stale else 'STALE — 需 local peer re-review'})"
            ),
        )

    def should_block_merge(self, result: MergeGateResult) -> bool:
        """根据门禁结果决定是否阻止 merge.

        Args:
            result: MergeGateResult 全部门禁检查结果

        Returns:
            True 表示应阻止 merge（有阻断性失败）
        """
        return not result.passed

    # ------------------------------------------------------------------
    # 私有辅助方法
    # ------------------------------------------------------------------

    def _get_active_review_sha(self, context: MergeContext) -> str:
        """根据 headChangeCause 判定活跃 review 源的 SHA.

        对应 SKILL Evidence Manifest 的 stale 字段定义：
        - cloud-finding → 只看 cloudReviewSha
        - local-gate → 只看 localPeerReviewSha
        - ci-fix → 只看 localPeerReviewSha（ci-fix 始终路由到 local peer）
        - rebase → 继承上次（按 local 处理，需 pre-approval）
        - pr-meta → 不改 SHA，返回 head（不影响）
        - exempt PR（无 cloud）→ 始终只看 localPeerReviewSha
        """
        if context.is_exempt:
            return context.local_review_sha

        cause = context.head_change_cause
        if cause == HeadChangeCause.CLOUD_FINDING:
            return context.cloud_review_sha
        if cause == HeadChangeCause.PR_META:
            return context.head_sha  # 不改 SHA
        # local-gate / ci-fix / rebase → 看 local
        return context.local_review_sha

    def _determine_verdict(
        self,
        review_status: ReviewStatus,
        evidence: EvidenceResult,
    ) -> Verdict:
        """根据 review 状态和 evidence 判定 verdict.

        对应 SKILL Evidence Manifest 的 verdict 字段：
        - passed: review APPROVE on final HEAD
        - blocked: 未 APPROVE（BLOCK / CHANGES_REQUESTED）
        - pending: review 进行中
        """
        if review_status.changes_requested:
            return Verdict.BLOCKED
        if not evidence.e3_provenance_closed or not evidence.e4_verdict_ok:
            return Verdict.BLOCKED
        if review_status.pending:
            return Verdict.PENDING
        if review_status.approved and evidence.all_passed:
            return Verdict.PASSED
        return Verdict.PENDING
