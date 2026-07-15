"""GitHub PR 创建与管理.

移植 clowder-ai merge-gate SKILL 的 PR 流程到 FlowForge：
- PR body 禁止 @handle（防止误触发 remote review，PR #160 反面案例）
- PR comment 触发 review（不是 body），极简格式 @codex review
- 支持 squash merge（通过 GitHub，禁止本地 squash）
- PR tracking 注册

设计原则（遵守铁律）：
- GitHub API 操作通过 gh CLI 异步执行（与 SKILL 方法论一致）
- 不硬编码仓库/密钥（铁律5）：repo 通过参数传入
- 仅依赖 flowforge.core.tracing，单向依赖
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.vcs.pull_request")


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


class PRInfo(BaseModel):
    """GitHub PR 元信息.

    Attributes:
        number: PR 编号
        title: PR 标题
        branch: 源分支名（head）
        base: 目标分支名（默认 main）
        url: PR 的 GitHub URL
        created_at: 创建时间
    """

    number: int = Field(description="PR 编号")
    title: str = Field(description="PR 标题")
    branch: str = Field(description="源分支名（head）")
    base: str = Field(default="main", description="目标分支名")
    url: str = Field(default="", description="PR 的 GitHub URL")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="创建时间")


class ReviewStatus(BaseModel):
    """PR review 状态.

    对应 SKILL「remote review 处理规则」— 必须检查 inline code comments
    （LL-033 教训：gh pr view --json reviews 只返回 review body，
    inline comments 里可能有 P1）。

    Attributes:
        approved: 是否有 APPROVE 状态的 review
        changes_requested: 是否有 CHANGES_REQUESTED 状态的 review
        pending: 是否仍有 pending review
        p1_count: P1 finding 数量（含 inline comments）
        p2_count: P2 finding 数量（含 inline comments）
        inline_findings: inline code comment 中的 finding 列表
    """

    approved: bool = Field(description="是否有 APPROVE review")
    changes_requested: bool = Field(description="是否有 CHANGES_REQUESTED review")
    pending: bool = Field(default=False, description="是否仍有 pending review")
    p1_count: int = Field(default=0, description="P1 finding 数量")
    p2_count: int = Field(default=0, description="P2 finding 数量")
    inline_findings: list[dict[str, Any]] = Field(
        default_factory=list, description="inline code comment findings"
    )


class MergeResult(BaseModel):
    """PR squash merge 结果.

    Attributes:
        success: merge 是否成功
        sha: merge commit SHA
        merged_at: merge 时间
    """

    success: bool = Field(description="merge 是否成功")
    sha: str = Field(default="", description="merge commit SHA")
    merged_at: datetime = Field(default_factory=datetime.utcnow, description="merge 时间")


class CIStatus(BaseModel):
    """PR CI/CD 检查状态.

    Attributes:
        all_passed: 所有 CI 检查是否通过
        failing_checks: 失败的检查项列表
        pending_checks: 进行中的检查项列表
    """

    all_passed: bool = Field(description="所有 CI 检查是否通过")
    failing_checks: list[str] = Field(default_factory=list, description="失败的检查项")
    pending_checks: list[str] = Field(default_factory=list, description="进行中的检查项")


# ---------------------------------------------------------------------------
# 异步 gh CLI 执行器
# ---------------------------------------------------------------------------


async def _run_gh(
    args: list[str],
    timeout: float = 60.0,
) -> tuple[int, str, str]:
    """异步执行 gh CLI 命令并返回 (returncode, stdout, stderr).

    gh CLI 是 GitHub 官方命令行工具，与 merge-gate SKILL 方法论一致。
    认证通过 `gh auth login` 完成（不在此模块硬编码密钥，铁律5）。

    Args:
        args: gh 子命令及参数列表
        timeout: 超时秒数

    Returns:
        (returncode, stdout, stderr) 三元组
    """
    cmd: list[str] = ["gh"] + args

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "GH_FORCE_TTY": "0"},
        )
    except FileNotFoundError as exc:
        return -1, "", f"gh CLI not found: {exc}. Install from https://cli.github.com/"

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            process.communicate(), timeout=timeout
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        return -1, "", f"gh command timed out after {timeout}s: {' '.join(args)}"

    return (
        process.returncode or 0,
        stdout_bytes.decode("utf-8", errors="replace").strip(),
        stderr_bytes.decode("utf-8", errors="replace").strip(),
    )


# ---------------------------------------------------------------------------
# PR body 合规性检查（纯逻辑，无外部依赖）
# ---------------------------------------------------------------------------

# @handle 检测正则：匹配 @句柄（含 HTML 注释中的签名）
# 对应 SKILL 硬规则：PR body（含 HTML 注释）禁止出现任何 @句柄
_HANDLE_PATTERN = re.compile(r"@[A-Za-z0-9_-]+")

# 已知的 review 触发句柄（SKILL 中的特定列表）
_KNOWN_REVIEW_HANDLES = re.compile(
    r"@(codex|chatgpt-codex-connector|gpt52|opus|sonnet|gemini)\b"
)

# @handle review 触发模式
_HANDLE_REVIEW_PATTERN = re.compile(r"@[A-Za-z0-9_-]+\s+review")


# ---------------------------------------------------------------------------
# PullRequestManager
# ---------------------------------------------------------------------------


class PullRequestManager:
    """GitHub PR 创建与管理.

    移植 clowder-ai merge-gate SKILL 的 PR 流程：
    - PR body 禁止 @handle（防止误触发 remote review）
    - PR comment 触发 review（不是 body），极简格式 @codex review
    - 支持 squash merge（通过 GitHub，禁止本地 squash）
    - PR tracking 注册

    Usage:
        manager = PullRequestManager()
        is_valid, msg = manager.check_pr_body(pr_body_text)
        if is_valid:
            pr = await manager.create_pr("owner/repo", "feat/xxx", "title", body)
    """

    def __init__(self, default_reviewer: str = "@codex") -> None:
        """初始化 PullRequestManager.

        Args:
            default_reviewer: 默认 review 触发句柄（通过参数注入，铁律5）
        """
        self._default_reviewer = default_reviewer

    def check_pr_body(self, body: str) -> tuple[bool, str]:
        """检查 PR body 合规性（禁止 @handle）.

        对应 SKILL 硬规则（PR #160 反面案例）：
        - PR body（含 HTML 注释）禁止出现任何 @句柄
        - remote review 触发句柄只能写在 comment，不能写在 body
        - 详细格式会让 connector 误解为代码修改请求（2026-04-20 PR #1300 确认）

        Args:
            body: PR body 文本

        Returns:
            (is_valid, error_message) 二元组：
            - is_valid=True 时 error_message 为空
            - is_valid=False 时 error_message 说明违规原因
        """
        if not body:
            return True, ""

        # 检查 1：禁止 @handle review 触发模式
        match = _HANDLE_REVIEW_PATTERN.search(body)
        if match:
            return False, (
                f"PR body 禁止 @handle review 触发模式（发现 '{match.group()}'）。"
                f"remote review 触发句柄只能写在 PR comment，不能写在 body。"
            )

        # 检查 2：禁止已知的 review 触发句柄
        match = _KNOWN_REVIEW_HANDLES.search(body)
        if match:
            return False, (
                f"PR body 禁止出现任何 @句柄（发现 '{match.group()}'，"
                f"含 HTML 注释中的签名）。签名改为纯文本。"
            )

        # 检查 3：禁止任何 @句柄（最严格，对应 SKILL 硬规则）
        match = _HANDLE_PATTERN.search(body)
        if match:
            return False, (
                f"PR body 禁止出现任何 @句柄（发现 '{match.group()}'）。"
                f"@mention 只能用于 PR comment，不能用于 body。"
            )

        return True, ""

    async def create_pr(
        self,
        repo: str,
        branch: str,
        title: str,
        body: str,
        base: str = "main",
    ) -> PRInfo:
        """创建 PR（验证 body 无 @handle）.

        对应 SKILL Step 2-3：开 PR + PR body 防呆检查。

        Args:
            repo: 仓库全名（owner/repo 格式）
            branch: 源分支名
            title: PR 标题
            body: PR body（必须通过 check_pr_body 检查）
            base: 目标分支（默认 main）

        Returns:
            PRInfo 创建的 PR 信息

        Raises:
            ValueError: PR body 包含 @handle（合规性检查失败）
            RuntimeError: gh CLI 创建 PR 失败
        """
        logger.info(
            f"create_pr: repo={repo} branch={branch} title={title!r} base={base}"
        )

        # PR body 合规性检查（fail-closed）
        is_valid, error_msg = self.check_pr_body(body)
        if not is_valid:
            raise ValueError(f"PR body 合规性检查失败: {error_msg}")

        # gh pr create --repo {repo} --head {branch} --base {base} --title {title} --body {body}
        rc, out, err = await _run_gh(
            [
                "pr", "create",
                "--repo", repo,
                "--head", branch,
                "--base", base,
                "--title", title,
                "--body", body,
                "--json", "number,title,headRefName,baseRefName,url,createdAt",
            ]
        )
        if rc != 0:
            raise RuntimeError(
                f"gh pr create failed (rc={rc}): {err}"
            )

        try:
            data = json.loads(out)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"gh pr create returned invalid JSON: {exc}. Output: {out[:500]}"
            ) from exc

        pr_info = PRInfo(
            number=data.get("number", 0),
            title=data.get("title", title),
            branch=data.get("headRefName", branch),
            base=data.get("baseRefName", base),
            url=data.get("url", ""),
            created_at=datetime.utcnow(),
        )
        logger.info(
            f"create_pr: created PR #{pr_info.number} at {pr_info.url}"
        )
        return pr_info

    async def trigger_review(
        self,
        repo: str,
        pr_number: int,
        reviewer: Optional[str] = None,
    ) -> None:
        """在 PR comment 中触发 review（不是 body）.

        对应 SKILL Step 5：触发 remote review。
        ⚠️ 只发极简格式（@codex review 一行），不带 SHA、不带规则描述、
        不带审查标准！详细格式会让 connector 误解为代码修改请求
        （2026-04-20 PR #1300 确认）。

        Args:
            repo: 仓库全名（owner/repo）
            pr_number: PR 编号
            reviewer: review 触发句柄（默认使用初始化时的 default_reviewer）

        Raises:
            RuntimeError: comment 创建失败
        """
        handle = reviewer or self._default_reviewer
        # 极简格式：只发 @handle review 一行
        comment_body = f"{handle} review"

        logger.info(
            f"trigger_review: repo={repo} pr={pr_number} reviewer={handle}"
        )

        rc, _, err = await _run_gh(
            [
                "pr", "comment", str(pr_number),
                "--repo", repo,
                "--body", comment_body,
            ]
        )
        if rc != 0:
            raise RuntimeError(
                f"trigger_review failed: gh pr comment failed (rc={rc}): {err}"
            )
        logger.info(
            f"trigger_review: posted review trigger comment on PR #{pr_number}"
        )

    async def check_review_status(
        self, repo: str, pr_number: int
    ) -> ReviewStatus:
        """检查 PR review 状态（含 inline comments）.

        对应 SKILL「remote review 处理规则」+ LL-033 教训：
        必须检查 inline code comments，gh pr view --json reviews
        只返回 review body，inline comments 里可能有 P1。

        Args:
            repo: 仓库全名（owner/repo）
            pr_number: PR 编号

        Returns:
            ReviewStatus review 状态
        """
        logger.info(
            f"check_review_status: repo={repo} pr={pr_number}"
        )

        # 获取 reviews
        rc_rev, out_rev, _ = await _run_gh(
            [
                "pr", "view", str(pr_number),
                "--repo", repo,
                "--json", "reviews",
            ]
        )

        approved = False
        changes_requested = False
        pending = False

        if rc_rev == 0:
            try:
                rev_data = json.loads(out_rev)
                reviews = rev_data.get("reviews", [])
                for review in reviews:
                    state = review.get("state", "")
                    if state == "APPROVED":
                        approved = True
                    elif state == "CHANGES_REQUESTED":
                        changes_requested = True
                    elif state == "PENDING":
                        pending = True
            except json.JSONDecodeError:
                logger.warning("check_review_status: failed to parse reviews JSON")

        # 获取 inline comments（LL-033：必须检查！）
        # gh api repos/{owner}/{repo}/pulls/{pr_number}/comments
        rc_inline, out_inline, _ = await _run_gh(
            [
                "api", f"repos/{repo}/pulls/{pr_number}/comments",
                "--paginate",
            ]
        )

        p1_count = 0
        p2_count = 0
        inline_findings: list[dict[str, Any]] = []

        if rc_inline == 0:
            try:
                comments = json.loads(out_inline) if out_inline else []
                if isinstance(comments, list):
                    p1_pattern = re.compile(r"\bP1\b", re.IGNORECASE)
                    p2_pattern = re.compile(r"\bP2\b", re.IGNORECASE)
                    for comment in comments:
                        body_text = comment.get("body", "")
                        if p1_pattern.search(body_text):
                            p1_count += 1
                            inline_findings.append({
                                "severity": "P1",
                                "path": comment.get("path", ""),
                                "body": body_text[:200],
                            })
                        if p2_pattern.search(body_text):
                            p2_count += 1
                            inline_findings.append({
                                "severity": "P2",
                                "path": comment.get("path", ""),
                                "body": body_text[:200],
                            })
            except json.JSONDecodeError:
                logger.warning(
                    "check_review_status: failed to parse inline comments JSON"
                )

        status = ReviewStatus(
            approved=approved,
            changes_requested=changes_requested,
            pending=pending,
            p1_count=p1_count,
            p2_count=p2_count,
            inline_findings=inline_findings,
        )
        logger.info(
            f"check_review_status: approved={approved} "
            f"changes_requested={changes_requested} "
            f"P1={p1_count} P2={p2_count} "
            f"inline_findings={len(inline_findings)}"
        )
        return status

    async def squash_merge(
        self,
        repo: str,
        pr_number: int,
        delete_branch: bool = True,
    ) -> MergeResult:
        """Squash merge（通过 GitHub，禁止本地 squash）.

        对应 SKILL Step 7：必须用 gh pr merge --squash（禁止本地 squash）。
        本地 squash + push 会导致 PR 显示 closed 而非 merged。

        Args:
            repo: 仓库全名（owner/repo）
            pr_number: PR 编号
            delete_branch: 是否删除源分支（默认 True）

        Returns:
            MergeResult merge 结果

        Raises:
            RuntimeError: merge 失败
        """
        args = ["pr", "merge", str(pr_number), "--repo", repo, "--squash"]
        if delete_branch:
            args.append("--delete-branch")

        logger.info(
            f"squash_merge: repo={repo} pr={pr_number} delete_branch={delete_branch}"
        )

        rc, out, err = await _run_gh(args)
        if rc != 0:
            return MergeResult(
                success=False,
                sha="",
                merged_at=datetime.utcnow(),
            )

        # 获取 merge commit SHA
        sha = ""
        rc_sha, out_sha, _ = await _run_gh(
            [
                "pr", "view", str(pr_number),
                "--repo", repo,
                "--json", "mergeCommit",
            ]
        )
        if rc_sha == 0:
            try:
                sha_data = json.loads(out_sha)
                merge_commit = sha_data.get("mergeCommit", {})
                sha = merge_commit.get("oid", "")
            except json.JSONDecodeError:
                pass

        result = MergeResult(
            success=True,
            sha=sha,
            merged_at=datetime.utcnow(),
        )
        logger.info(
            f"squash_merge: PR #{pr_number} merged successfully, sha={sha[:8]}"
        )
        return result

    async def check_pr_checks(
        self, repo: str, pr_number: int
    ) -> CIStatus:
        """检查 PR CI/CD 状态.

        对应 SKILL Quick Reference：云端通过？gh pr checks {PR}。

        Args:
            repo: 仓库全名（owner/repo）
            pr_number: PR 编号

        Returns:
            CIStatus CI 检查状态
        """
        logger.info(
            f"check_pr_checks: repo={repo} pr={pr_number}"
        )

        rc, out, err = await _run_gh(
            [
                "pr", "checks", str(pr_number),
                "--repo", repo,
                "--json", "name,state,link",
            ]
        )

        failing_checks: list[str] = []
        pending_checks: list[str] = []

        if rc != 0:
            logger.warning(
                f"check_pr_checks: gh pr checks failed: {err}"
            )
            return CIStatus(
                all_passed=False,
                failing_checks=[f"check command failed: {err}"],
                pending_checks=[],
            )

        try:
            checks = json.loads(out) if out else []
        except json.JSONDecodeError:
            logger.warning("check_pr_checks: failed to parse checks JSON")
            return CIStatus(
                all_passed=False,
                failing_checks=["failed to parse CI check results"],
                pending_checks=[],
            )

        if isinstance(checks, list):
            for check in checks:
                name = check.get("name", "unknown")
                state = check.get("state", "").upper()
                if state in ("FAILURE", "ERROR", "CANCELLED", "TIMED_OUT"):
                    failing_checks.append(name)
                elif state in ("PENDING", "IN_PROGRESS", "QUEUED"):
                    pending_checks.append(name)

        all_passed = len(failing_checks) == 0 and len(pending_checks) == 0
        status = CIStatus(
            all_passed=all_passed,
            failing_checks=failing_checks,
            pending_checks=pending_checks,
        )
        logger.info(
            f"check_pr_checks: all_passed={all_passed} "
            f"failing={len(failing_checks)} pending={len(pending_checks)}"
        )
        return status
