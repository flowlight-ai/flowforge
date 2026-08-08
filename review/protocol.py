"""Review 协议 — 五件套 + 证据。

五件套：
1. 原始需求摘录
2. 代码变更（diff + content）
3. 测试证据
4. 自检报告
5. 设计文档引用

证据：每个 finding 必须有证据（代码片段/文档引用）

禁止表演性同意：
- 不能只说"看起来不错"而不给出具体发现
- 不能同意但不说为什么
- 每个发现必须有明确立场（must_fix/should_fix/consider）
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from flowforge.core.tracing import get_logger
from flowforge.review.models import (
    ReviewRequest,
    ReviewResponse,
    SeverityLevel,
)

logger = get_logger("review.protocol")

# 表演性同意的笼统措辞特征（大小写不敏感匹配）
_PERFORMATIVE_PHRASES: list[str] = [
    "看起来不错",
    "看起来可以",
    "看起来还行",
    "没问题",
    "很好",
    "不错",
    "挺好的",
    "整体不错",
    "总体不错",
    "看起来没问题",
    "看起来挺好",
    "还行",
    "可以接受",
    "ok",
    "looks good",
    "looks fine",
    "no issues",
    "seems fine",
    "all good",
]

# 合法的 stance 值
_VALID_STANCES = {"must_fix", "should_fix", "consider"}

# 合法的 verdict 值
_VALID_VERDICTS = {"approve", "request_changes", "reject"}

# 合法的 category 值
_VALID_CATEGORIES = {
    "security",
    "performance",
    "correctness",
    "style",
    "architecture",
    "test_coverage",
}


class ReviewProtocol:
    """Review 协议 — 五件套 + 证据。

    职责：
    1. create_review_request: 创建符合五件套规范的评审请求
    2. validate_request: 验证请求完整性
    3. validate_response: 验证响应完整性（含 stance/performative 检查）
    4. check_performative_agreement: 检测表演性同意
    """

    def create_review_request(
        self,
        author_agent: str,
        author_model: str,
        feature_id: str,
        original_requirements: str,
        code_changes: list[dict[str, Any]],
        test_evidence: str,
        self_check_report: str = "",
        design_doc_ref: str = "",
        request_id: str = "",
    ) -> ReviewRequest:
        """创建 review 请求（五件套）。

        五件套：
        1. original_requirements — 原始需求摘录（铁律：必须附）
        2. code_changes — 代码变更（diff + content）
        3. test_evidence — 测试证据
        4. self_check_report — 自检报告
        5. design_doc_ref — 设计文档引用

        Args:
            author_agent: 写代码的 agent
            author_model: 写代码用的模型
            feature_id: 功能 ID
            original_requirements: 原始需求摘录（必填）
            code_changes: 代码变更列表 [{file_path, diff, content}]
            test_evidence: 测试证据
            self_check_report: 自检报告
            design_doc_ref: 设计文档引用
            request_id: 指定 request_id（留空则自动生成）

        Returns:
            构建好的 ReviewRequest
        """
        request = ReviewRequest(
            author_agent=author_agent,
            author_model=author_model,
            feature_id=feature_id,
            original_requirements=original_requirements,
            code_changes=code_changes,
            test_evidence=test_evidence,
            self_check_report=self_check_report,
            design_doc_ref=design_doc_ref,
            created_at=datetime.now(UTC),
        )
        if request_id:
            request.request_id = request_id

        valid, errors = self.validate_request(request)
        if not valid:
            logger.warning(
                f"create_review_request: validation failed "
                f"request_id={request.request_id!r} errors={errors}"
            )
        else:
            logger.info(
                f"create_review_request: created request_id={request.request_id!r} "
                f"author={author_agent!r} model={author_model!r} "
                f"files={len(code_changes)}"
            )
        return request

    def validate_request(self, request: ReviewRequest) -> tuple[bool, list[str]]:
        """验证请求完整性。

        检查：
        1. original_requirements 非空（铁律：必须附原始需求摘录）
        2. code_changes 非空
        3. test_evidence 非空
        4. author_agent / author_model / feature_id 非空
        5. 每个代码变更项有 file_path

        Args:
            request: 待验证的评审请求

        Returns:
            (是否通过, 错误信息列表)
        """
        errors: list[str] = []

        if not request.original_requirements.strip():
            errors.append("original_requirements 不能为空（铁律：必须附原始需求摘录）")
        if not request.code_changes:
            errors.append("code_changes 不能为空（五件套之二）")
        if not request.test_evidence.strip():
            errors.append("test_evidence 不能为空（五件套之三）")
        if not request.author_agent.strip():
            errors.append("author_agent 不能为空")
        if not request.author_model.strip():
            errors.append("author_model 不能为空")
        if not request.feature_id.strip():
            errors.append("feature_id 不能为空")

        for i, change in enumerate(request.code_changes):
            if not change.get("file_path"):
                errors.append(f"code_changes[{i}] 缺少 file_path")

        if errors:
            logger.warning(
                f"validate_request: FAILED request_id={request.request_id!r} "
                f"errors={len(errors)}"
            )
        else:
            logger.debug(
                f"validate_request: OK request_id={request.request_id!r}"
            )

        return (len(errors) == 0, errors)

    def validate_response(self, response: ReviewResponse) -> tuple[bool, list[str]]:
        """验证响应完整性。

        检查：
        1. 每个发现是否有明确 stance（must_fix/should_fix/consider）
        2. 是否有"表演性同意"（verdict=approve 但 findings 为空或都是 P3）
        3. P1 发现是否有修复建议
        4. verdict 合法
        5. 每个发现的 severity/category 合法

        Args:
            response: 待验证的评审响应

        Returns:
            (是否通过, 错误信息列表)
        """
        errors: list[str] = []

        # verdict 合法性
        if response.verdict not in _VALID_VERDICTS:
            errors.append(
                f"verdict 必须是 {sorted(_VALID_VERDICTS)} 之一，"
                f"实际为 {response.verdict!r}"
            )

        # 每个发现检查
        for i, finding in enumerate(response.findings):
            if finding.stance not in _VALID_STANCES:
                errors.append(
                    f"findings[{i}] stance 必须是 {sorted(_VALID_STANCES)} 之一，"
                    f"实际为 {finding.stance!r}"
                )
            if finding.category and finding.category not in _VALID_CATEGORIES:
                errors.append(
                    f"findings[{i}] category 应为 {sorted(_VALID_CATEGORIES)} 之一，"
                    f"实际为 {finding.category!r}"
                )
            if not finding.title.strip():
                errors.append(f"findings[{i}] title 不能为空")
            if not finding.description.strip():
                errors.append(f"findings[{i}] description 不能为空")
            # P1 必须有修复建议
            if finding.severity == SeverityLevel.P1 and not finding.suggestion.strip():
                errors.append(
                    f"findings[{i}] P1 发现必须提供修复建议（suggestion）"
                )
            # P1/P2 应该有证据
            if (
                finding.severity in (SeverityLevel.P1, SeverityLevel.P2)
                and not finding.evidence.strip()
            ):
                errors.append(
                    f"findings[{i}] {finding.severity.value} 发现建议提供证据（evidence）"
                )

        # 表演性同意检查
        is_performative = self.check_performative_agreement(response)
        response.performative_agreement_check = not is_performative
        if is_performative:
            errors.append(
                "检测到表演性同意：verdict=approve 但缺少实质性发现。"
                "不能只说'看起来不错'而不给出具体发现。"
            )

        # P1/P2 计数一致性
        expected_p1 = sum(
            1 for f in response.findings if f.severity == SeverityLevel.P1
        )
        expected_p2 = sum(
            1 for f in response.findings if f.severity == SeverityLevel.P2
        )
        if response.p1_count != expected_p1:
            errors.append(
                f"p1_count 不一致：声明 {response.p1_count}，实际 {expected_p1}"
            )
        if response.p2_count != expected_p2:
            errors.append(
                f"p2_count 不一致：声明 {response.p2_count}，实际 {expected_p2}"
            )

        if errors:
            logger.warning(
                f"validate_response: FAILED response_id={response.response_id!r} "
                f"errors={len(errors)}"
            )
        else:
            logger.debug(
                f"validate_response: OK response_id={response.response_id!r}"
            )

        return (len(errors) == 0, errors)

    def check_performative_agreement(self, response: ReviewResponse) -> bool:
        """检查是否表演性同意。

        表演性同意的特征：
        - verdict=approve 但没有 P1/P2 发现
        - findings 为空
        - 所有发现都是 P3 + consider
        - overall_assessment 过于笼统（"看起来不错"等）

        Args:
            response: 评审响应

        Returns:
            True 表示检测到表演性同意（不通过），False 表示正常
        """
        # 非 approve 不检查表演性同意
        if response.verdict != "approve":
            return False

        # 特征 1：findings 为空
        if not response.findings:
            logger.debug(
                f"check_performative_agreement: EMPTY findings on approve "
                f"response_id={response.response_id!r}"
            )
            return True

        # 特征 2：所有发现都是 P3 + consider
        all_p3 = all(
            f.severity == SeverityLevel.P3 for f in response.findings
        )
        all_consider = all(
            f.stance == "consider" for f in response.findings
        )
        if all_p3 and all_consider:
            logger.debug(
                f"check_performative_agreement: all P3+consider on approve "
                f"response_id={response.response_id!r}"
            )
            return True

        # 特征 3：approve 但没有 P1/P2 发现 + 评估笼统
        has_p1_p2 = any(
            f.severity in (SeverityLevel.P1, SeverityLevel.P2)
            for f in response.findings
        )
        if not has_p1_p2:
            assessment_lower = response.overall_assessment.lower().strip()
            # 笼统措辞检测
            for phrase in _PERFORMATIVE_PHRASES:
                if phrase in assessment_lower:
                    logger.debug(
                        f"check_performative_agreement: vague phrase "
                        f"{phrase!r} on approve without P1/P2 "
                        f"response_id={response.response_id!r}"
                    )
                    return True
            # 评估过短（少于 20 字符）且没有 P1/P2
            if len(assessment_lower) < 20:
                logger.debug(
                    f"check_performative_agreement: assessment too short "
                    f"({len(assessment_lower)} chars) on approve without P1/P2 "
                    f"response_id={response.response_id!r}"
                )
                return True

        return False
