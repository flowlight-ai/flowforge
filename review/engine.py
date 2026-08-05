"""跨模型评审引擎 — ReviewEngine。

工作流程：
1. 作者 agent 完成代码后，创建 ReviewRequest（五件套）
2. ReviewEngine 通过 ReviewerPairing 找到合适的 reviewer
3. Reviewer agent（使用不同模型）审查代码
4. 返回 ReviewResponse（findings + verdict）
5. 如果有 P1 发现，作者修复后必须 re-trigger review

与 FlowForge 集成：
- 使用 ModelCapability 调用不同模型进行审查
- 使用 AgentRegistry 找到 reviewer agent
- 与 SOP review 阶段集成
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

from flowforge.core.tracing import get_logger
from flowforge.review.models import (
    ReviewerInfo,
    ReviewFinding,
    ReviewProvenance,
    ReviewRequest,
    ReviewResponse,
    SeverityLevel,
)
from flowforge.review.pairing import ReviewerPairing
from flowforge.review.protocol import ReviewProtocol

logger = get_logger("review.engine")

# review_prompts.yaml 路径（相对模块定位，不硬编码绝对路径）
# flowforge/review/engine.py → flowforge/config/review_prompts.yaml
_REVIEW_PROMPTS_PATH = Path(__file__).parent.parent / "config" / "review_prompts.yaml"

# 已加载的 prompts 缓存
_prompts_cache: dict[str, Any] | None = None


def _load_review_prompts() -> dict[str, Any]:
    """从 review_prompts.yaml 加载 prompt 模板。

    fail-open: 加载失败时返回空字典并记录 ERROR 日志。
    """
    global _prompts_cache
    if _prompts_cache is not None:
        return _prompts_cache

    try:
        if not _REVIEW_PROMPTS_PATH.exists():
            logger.error(
                f"_load_review_prompts: review_prompts.yaml not found at "
                f"{_REVIEW_PROMPTS_PATH}"
            )
            _prompts_cache = {}
            return _prompts_cache
        with open(_REVIEW_PROMPTS_PATH, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        _prompts_cache = data
        logger.info(
            f"_load_review_prompts: loaded sections={list(data.keys())} "
            f"from {_REVIEW_PROMPTS_PATH}"
        )
        return _prompts_cache
    except Exception as e:
        logger.error(f"_load_review_prompts: failed to load: {e}")
        _prompts_cache = {}
        return _prompts_cache


def _format_code_changes(code_changes: list[dict[str, Any]]) -> str:
    """将代码变更列表格式化为可读字符串。"""
    if not code_changes:
        return "（无代码变更）"

    parts: list[str] = []
    for i, change in enumerate(code_changes):
        file_path = change.get("file_path", f"file_{i}")
        diff = change.get("diff", "")
        content = change.get("content", "")
        parts.append(f"### 文件: {file_path}")
        if diff:
            parts.append(f"```diff\n{diff}\n```")
        if content:
            parts.append(f"```python\n{content}\n```")
        parts.append("")
    return "\n".join(parts)


def _extract_json_from_text(text: str) -> dict[str, Any] | None:
    """从 LLM 输出文本中提取 JSON 对象。

    处理 markdown 代码块包裹和前后多余文本。
    """
    if not text:
        return None

    # 尝试直接解析
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        pass

    # 尝试从 ```json ... ``` 代码块中提取
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except (json.JSONDecodeError, TypeError):
            pass

    # 尝试找到第一个 { 到最后一个 } 的内容
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        try:
            return json.loads(text[first_brace : last_brace + 1])
        except (json.JSONDecodeError, TypeError):
            pass

    return None


def _parse_finding(raw: dict[str, Any]) -> ReviewFinding:
    """将原始 dict 解析为 ReviewFinding。"""
    severity_str = str(raw.get("severity", "P3")).upper().strip()
    try:
        severity = SeverityLevel(severity_str)
    except ValueError:
        severity = SeverityLevel.P3

    return ReviewFinding(
        severity=severity,
        category=str(raw.get("category", "correctness")).strip(),
        title=str(raw.get("title", "")).strip(),
        description=str(raw.get("description", "")).strip(),
        file_path=str(raw.get("file_path", "")).strip(),
        line_start=int(raw.get("line_start", 0) or 0),
        line_end=int(raw.get("line_end", 0) or 0),
        suggestion=str(raw.get("suggestion", "")).strip(),
        evidence=str(raw.get("evidence", "")).strip(),
        stance=str(raw.get("stance", "must_fix")).strip(),
    )


class ReviewEngine:
    """跨模型评审引擎。

    工作流程：
    1. 作者 agent 完成代码后，创建 ReviewRequest（五件套）
    2. ReviewEngine 通过 ReviewerPairing 找到合适的 reviewer
    3. Reviewer agent（使用不同模型）审查代码
    4. 返回 ReviewResponse（findings + verdict）
    5. 如果有 P1 发现，作者修复后必须 re-trigger review

    与 FlowForge 集成：
    - 使用 ModelCapability 调用不同模型进行审查
    - 与 SOP review 阶段集成
    """

    def __init__(
        self,
        pairing: ReviewerPairing,
        protocol: ReviewProtocol,
        llm_client: Any | None = None,
    ) -> None:
        """
        Args:
            pairing: Reviewer 配对器
            protocol: Review 协议
            llm_client: LLM 客户端（flowforge ModelCapability 实例，
                        需提供 async chat(prompt, system, model, ...) 方法）
        """
        self._pairing = pairing
        self._protocol = protocol
        self._llm_client = llm_client
        self._provenance: list[ReviewProvenance] = []
        self._logger = get_logger("review_engine")

    async def request_review(self, request: ReviewRequest) -> ReviewResponse:
        """发起 review 请求。

        流程：
        1. 验证请求完整性（五件套）
        2. 通过 ReviewerPairing 找到合适的 reviewer
        3. 执行 review（调用 reviewer 模型审查代码）
        4. 验证响应并返回

        Args:
            request: 评审请求

        Returns:
            评审响应
        """
        self._logger.info(
            f"request_review: enter request_id={request.request_id!r} "
            f"author={request.author_agent!r} model={request.author_model!r}"
        )

        # 验证请求
        valid, errors = self._protocol.validate_request(request)
        if not valid:
            self._logger.error(
                f"request_review: request validation failed "
                f"request_id={request.request_id!r} errors={errors}"
            )
            # 返回 reject 响应
            return ReviewResponse(
                request_id=request.request_id,
                reviewer_agent="protocol",
                reviewer_model="none",
                findings=[
                    ReviewFinding(
                        severity=SeverityLevel.P1,
                        category="correctness",
                        title="评审请求不完整",
                        description="; ".join(errors),
                        suggestion="补全五件套后重新发起评审",
                        stance="must_fix",
                    )
                ],
                overall_assessment="评审请求未通过协议验证，无法执行评审。",
                verdict="reject",
            )

        # 查找 reviewer
        reviewer = self._pairing.find_reviewer(
            author_model=request.author_model,
            author_agent=request.author_agent,
        )
        if reviewer is None:
            self._logger.error(
                f"request_review: no reviewer available "
                f"request_id={request.request_id!r} "
                f"author={request.author_agent!r}"
            )
            return ReviewResponse(
                request_id=request.request_id,
                reviewer_agent="none",
                reviewer_model="none",
                findings=[
                    ReviewFinding(
                        severity=SeverityLevel.P1,
                        category="architecture",
                        title="无可用 reviewer",
                        description="未找到符合条件的 reviewer，请注册更多 reviewer。",
                        suggestion="注册更多跨 family 的 reviewer",
                        stance="must_fix",
                    )
                ],
                overall_assessment="无可用 reviewer，无法执行评审。",
                verdict="reject",
            )

        # 执行评审
        response = await self.execute_review(request, reviewer)

        # 记录溯源
        cross_family = self._pairing.is_cross_family(
            request.author_model, reviewer.model_name
        )
        provenance = ReviewProvenance(
            request_id=request.request_id,
            author_agent=request.author_agent,
            reviewer_agent=reviewer.agent_name,
            cross_family=cross_family,
            review_round=1,
        )
        self._provenance.append(provenance)
        self._logger.info(
            f"request_review: done request_id={request.request_id!r} "
            f"reviewer={reviewer.agent_name!r} cross_family={cross_family} "
            f"verdict={response.verdict!r} P1={response.p1_count} "
            f"P2={response.p2_count} P3={response.p3_count}"
        )

        return response

    async def execute_review(
        self, request: ReviewRequest, reviewer: ReviewerInfo
    ) -> ReviewResponse:
        """执行 review（使用 reviewer 的模型审查代码）。

        生成 review prompt → 调用 LLM → 解析响应 → 构建 ReviewResponse

        Args:
            request: 评审请求
            reviewer: 评审者信息

        Returns:
            评审响应
        """
        self._logger.info(
            f"execute_review: enter request_id={request.request_id!r} "
            f"reviewer={reviewer.agent_name!r} model={reviewer.model_name!r}"
        )

        if self._llm_client is None:
            self._logger.warning(
                "execute_review: no llm_client configured, "
                "returning placeholder response"
            )
            return ReviewResponse(
                request_id=request.request_id,
                reviewer_agent=reviewer.agent_name,
                reviewer_model=reviewer.model_name,
                findings=[],
                overall_assessment="LLM 客户端未配置，无法执行评审。",
                verdict="request_changes",
                performative_agreement_check=False,
            )

        # 生成 review prompt
        system_prompt, user_prompt = await self._generate_review_prompts(request)

        # 调用 LLM
        try:
            result = await self._llm_client.chat(
                user_prompt,
                system=system_prompt,
                model=reviewer.model_name,
                temperature=0.3,
                max_tokens=4000,
            )
        except Exception as e:
            self._logger.error(
                f"execute_review: LLM call failed "
                f"request_id={request.request_id!r} error={e}"
            )
            return ReviewResponse(
                request_id=request.request_id,
                reviewer_agent=reviewer.agent_name,
                reviewer_model=reviewer.model_name,
                findings=[
                    ReviewFinding(
                        severity=SeverityLevel.P1,
                        category="correctness",
                        title="评审 LLM 调用失败",
                        description=str(e),
                        suggestion="检查 LLM 配置和 reviewer 模型可用性",
                        stance="must_fix",
                    )
                ],
                overall_assessment=f"LLM 调用失败：{e}",
                verdict="reject",
            )

        # 解析 LLM 响应
        content = result.get("content", "") if isinstance(result, dict) else str(result)
        parsed = _extract_json_from_text(content)

        if parsed is None:
            self._logger.warning(
                f"execute_review: failed to parse JSON from LLM response "
                f"request_id={request.request_id!r}"
            )
            return ReviewResponse(
                request_id=request.request_id,
                reviewer_agent=reviewer.agent_name,
                reviewer_model=reviewer.model_name,
                findings=[
                    ReviewFinding(
                        severity=SeverityLevel.P2,
                        category="correctness",
                        title="评审响应格式异常",
                        description="LLM 返回的内容无法解析为 JSON。",
                        evidence=content[:500] if content else "",
                        suggestion="检查 review_prompts.yaml 中的输出格式指引",
                        stance="should_fix",
                    )
                ],
                overall_assessment="LLM 响应解析失败，原始内容已记录。",
                verdict="request_changes",
            )

        # 构建发现列表
        raw_findings = parsed.get("findings", [])
        if not isinstance(raw_findings, list):
            raw_findings = []

        findings = [_parse_finding(f) for f in raw_findings if isinstance(f, dict)]

        verdict = str(parsed.get("verdict", "request_changes")).strip().lower()
        if verdict not in ("approve", "request_changes", "reject"):
            verdict = "request_changes"

        response = ReviewResponse(
            request_id=request.request_id,
            reviewer_agent=reviewer.agent_name,
            reviewer_model=reviewer.model_name,
            findings=findings,
            overall_assessment=str(parsed.get("overall_assessment", "")).strip(),
            verdict=verdict,
        )
        response.recount_severity()

        # 协议验证（含表演性同意检查）
        valid, errors = self._protocol.validate_response(response)
        if not valid:
            self._logger.warning(
                f"execute_review: response validation failed "
                f"request_id={request.request_id!r} errors={errors}"
            )

        self._logger.info(
            f"execute_review: done request_id={request.request_id!r} "
            f"verdict={response.verdict!r} findings={len(response.findings)} "
            f"P1={response.p1_count} P2={response.p2_count} P3={response.p3_count}"
        )

        return response

    async def process_review_response(self, response: ReviewResponse) -> dict:
        """处理 review 响应。

        Args:
            response: 评审响应

        Returns:
            包含以下 key 的字典：
            - verdict: approve/request_changes/reject
            - must_fix_count: P1 数量
            - should_fix_count: P2 数量
            - consider_count: P3 数量
            - next_action: "merge" | "fix_and_retrigger" | "reject"
            - performative_agreement: 是否通过表演性同意检查
        """
        # 确保 severity 计数正确
        response.recount_severity()

        # 决定下一步动作
        if response.verdict == "approve" and response.p1_count == 0:
            next_action = "merge"
        elif response.verdict == "reject":
            next_action = "reject"
        else:
            # request_changes 或有 P1 → 修复后重新触发
            next_action = "fix_and_retrigger"

        result = {
            "verdict": response.verdict,
            "must_fix_count": response.p1_count,
            "should_fix_count": response.p2_count,
            "consider_count": response.p3_count,
            "next_action": next_action,
            "performative_agreement": response.performative_agreement_check,
        }

        self._logger.info(
            f"process_review_response: response_id={response.response_id!r} "
            f"verdict={response.verdict!r} P1={response.p1_count} "
            f"P2={response.p2_count} P3={response.p3_count} "
            f"next_action={next_action!r}"
        )
        return result

    def should_retrigger_review(self, response: ReviewResponse) -> bool:
        """是否需要重新触发 review（P1 修复后必须 re-trigger）。

        Args:
            response: 评审响应

        Returns:
            True 表示需要重新触发评审
        """
        retrigger = response.p1_count > 0 or response.verdict == "request_changes"
        self._logger.debug(
            f"should_retrigger_review: response_id={response.response_id!r} "
            f"p1={response.p1_count} verdict={response.verdict!r} "
            f"retrigger={retrigger}"
        )
        return retrigger

    def get_provenance(self, request_id: str) -> ReviewProvenance | None:
        """获取 review 溯源记录。

        Args:
            request_id: 评审请求 ID

        Returns:
            溯源记录，不存在则返回 None
        """
        for p in self._provenance:
            if p.request_id == request_id:
                return p
        return None

    async def generate_review_prompt(self, request: ReviewRequest) -> str:
        """生成 review prompt（发送给 reviewer 模型的提示词）。

        注意：prompt 从 review_prompts.yaml 加载，不硬编码（铁律5+P16）。

        Args:
            request: 评审请求

        Returns:
            格式化后的 user prompt 字符串
        """
        prompts = _load_review_prompts()
        code_review = prompts.get("code_review", {})
        user_template = code_review.get("user", "")

        if not user_template:
            self._logger.error(
                "generate_review_prompt: code_review.user template not found "
                "in review_prompts.yaml"
            )
            return ""

        code_changes_str = _format_code_changes(request.code_changes)
        try:
            return user_template.format(
                original_requirements=request.original_requirements,
                code_changes=code_changes_str,
                test_evidence=request.test_evidence,
                self_check_report=request.self_check_report or "（未提供）",
            )
        except KeyError as e:
            self._logger.error(
                f"generate_review_prompt: template placeholder error: {e}"
            )
            return user_template

    async def _generate_review_prompts(
        self, request: ReviewRequest
    ) -> tuple[str, str]:
        """生成 system + user prompt 对。

        Returns:
            (system_prompt, user_prompt)
        """
        prompts = _load_review_prompts()
        code_review = prompts.get("code_review", {})
        system_prompt = code_review.get("system", "")
        user_prompt = await self.generate_review_prompt(request)
        return (system_prompt, user_prompt)
