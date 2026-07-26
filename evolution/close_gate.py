"""CL-025 F177 Close Gate Validator — Phase A Close Gate 结构化判据。

[doc:review/review.md#14.1] CL-025 F177 Close Gate 结构化判据
[doc:design/naming-contract.md#2.2] Forgekin

规格大纲（design v7.1-§D7.9 Close Gate Validator）：
- AC → evidence 矩阵（每条 AC 标注 ✅/❌ + commit/test/screenshot 证据）
- ❌ 强制三选一（immediate/delete/cvo_signoff）
- 禁止 follow-up / next phase / P2 字样
- 配套 CI: follow-up-detector.mjs

骨架实现：仅满足 verify_cl14_compliance.py 解析，不实现复杂判定逻辑。
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.evolution.close_gate")

# 默认 follow-up 屏蔽词清单（编程红线 11：可配置，不硬编码到逻辑）
_DEFAULT_FOLLOW_UP_BLOCKLIST: list[str] = [
    "follow-up",
    "follow up",
    "next phase",
    "P2",
    "TODO 后续",
    "后续跟进",
]


class Evidence(BaseModel):
    """AC 证据条目 — 单条 AC 的单一证据。"""

    ac_id: str  # AC 编号（如 "AC-A1"）
    status: Literal["pass", "fail"]
    evidence_type: Literal["commit", "test", "screenshot", "log"]
    evidence_uri: str  # commit hash / test report / screenshot path / log path
    notes: str = ""


class CloseGateDecision(BaseModel):
    """Close Gate 决策 — 三选一强制。"""

    decision: Literal["immediate", "delete", "cvo_signoff"]
    decided_by: str  # 决策者（如 "sherlock" / "operator"）
    decided_at: datetime = Field(default_factory=datetime.utcnow)
    rationale: str  # 决策理由


class CloseGateReport(BaseModel):
    """Phase Close Gate 验证报告。"""

    phase_id: str
    passed: bool
    decision: CloseGateDecision
    evidence_count: int
    ac_pass_count: int
    ac_fail_count: int
    follow_up_violations: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class CloseGateValidator:
    """Close Gate Validator — Phase A 收尾判据结构化校验。

    职责（骨架）：
    - 注册 Evidence 形成 AC→evidence 矩阵
    - 检查 closing_text 不含 follow-up 字样
    - 强制 decision 三选一（由 Literal 类型校验）
    - 生成 CloseGateReport

    使用方式：
        validator = CloseGateValidator()
        validator.register_evidence(Evidence(ac_id="AC-A1", ...))
        report = validator.validate_phase_close(phase_id, decision, evidences, closing_text)
    """

    def __init__(self, *, follow_up_blocklist: list[str] | None = None) -> None:
        self._follow_up_blocklist: list[str] = (
            list(follow_up_blocklist)
            if follow_up_blocklist is not None
            else list(_DEFAULT_FOLLOW_UP_BLOCKLIST)
        )
        self._evidences: list[Evidence] = []
        logger.debug(
            f"close_gate validator init: blocklist_size={len(self._follow_up_blocklist)}"
        )

    def register_evidence(self, evidence: Evidence) -> None:
        """注册一条 Evidence。"""
        self._evidences.append(evidence)
        logger.debug(
            f"close_gate register_evidence: ac_id={evidence.ac_id}, "
            f"status={evidence.status}, type={evidence.evidence_type}"
        )

    def get_evidence_matrix(self) -> dict[str, list[Evidence]]:
        """按 ac_id 分组返回证据矩阵。"""
        matrix: dict[str, list[Evidence]] = {}
        for ev in self._evidences:
            matrix.setdefault(ev.ac_id, []).append(ev)
        return matrix

    def check_no_follow_up(self, text: str) -> tuple[bool, list[str]]:
        """检查文本中是否含 follow-up 字样。

        返回 (clean, found_terms)：
        - clean=True 表示未命中任何屏蔽词
        - found_terms 为命中的屏蔽词列表
        """
        if not text:
            return True, []
        text_lower = text.lower()
        found: list[str] = []
        for term in self._follow_up_blocklist:
            if term.lower() in text_lower:
                found.append(term)
        clean = len(found) == 0
        if not clean:
            logger.warning(f"close_gate follow_up_violation: terms={found}")
        return clean, found

    def validate_close_decision(self, decision: CloseGateDecision) -> tuple[bool, str]:
        """验证决策合规性。

        规则：
        - decision 必须是三选一（由 Literal 强制，Pydantic 校验）
        - rationale 不能为空
        - rationale 不能含 follow-up 字样
        """
        if not decision.rationale or not decision.rationale.strip():
            return False, "rationale 不能为空"
        clean, found = self.check_no_follow_up(decision.rationale)
        if not clean:
            return False, f"rationale 含 follow-up 字样: {found}"
        return True, "ok"

    def validate_phase_close(
        self,
        phase_id: str,
        decision: CloseGateDecision,
        evidences: list[Evidence],
        closing_text: str = "",
    ) -> CloseGateReport:
        """完整 Phase A Close Gate 验证。"""
        errors: list[str] = []
        follow_up_violations: list[str] = []

        # 1. 注册证据
        for ev in evidences:
            self.register_evidence(ev)

        # 2. 验证决策
        decision_ok, decision_msg = self.validate_close_decision(decision)
        if not decision_ok:
            errors.append(f"decision: {decision_msg}")

        # 3. 检查 closing_text
        if closing_text:
            clean, found = self.check_no_follow_up(closing_text)
            if not clean:
                follow_up_violations.extend(found)

        # 4. 统计 AC pass/fail
        matrix = self.get_evidence_matrix()
        ac_pass = 0
        ac_fail = 0
        for _ac_id, evs in matrix.items():
            statuses = {e.status for e in evs}
            if "fail" in statuses:
                ac_fail += 1
            elif "pass" in statuses:
                ac_pass += 1

        passed = (
            decision_ok
            and not follow_up_violations
            and not errors
            and ac_fail == 0
        )

        report = CloseGateReport(
            phase_id=phase_id,
            passed=passed,
            decision=decision,
            evidence_count=len(evidences),
            ac_pass_count=ac_pass,
            ac_fail_count=ac_fail,
            follow_up_violations=follow_up_violations,
            errors=errors,
        )
        logger.info(
            f"close_gate validate_phase_close: phase={phase_id}, passed={passed}, "
            f"ac_pass={ac_pass}, ac_fail={ac_fail}, errors={len(errors)}"
        )
        return report
