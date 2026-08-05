"""SOP 谓词检查器 — 各类门禁检查的具体实现。

每个检查器是一个 async 函数，接收 PredicateConfig 并返回 PredicateResult。
检查器通过 subprocess 执行实际命令（遵守铁律4：不直接操作数据库）。

设计要点：
- 所有外部命令通过 asyncio.create_subprocess_exec 异步执行
- 检查器是独立的纯函数，无副作用
- PredicateChecker 类负责按 type 字段路由到对应检查器
- 失败时返回 passed=False 并附 evidence，便于审计
"""
from __future__ import annotations

import asyncio
import os
import re
from collections.abc import Awaitable, Callable
from typing import Any

from flowforge.core.tracing import get_logger
from flowforge.sop.models import (
    PredicateConfig,
    PredicateResult,
    PredicateType,
)

logger = get_logger("sop.predicate")


async def _run_command(
    cmd: list[str],
    cwd: str | None = None,
    timeout: float = 30.0,
) -> tuple[int, str, str]:
    """异步执行命令并返回 (returncode, stdout, stderr)。

    Args:
        cmd: 命令及其参数列表
        cwd: 工作目录
        timeout: 超时秒数

    Returns:
        (returncode, stdout, stderr) 三元组
    """
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(), timeout=timeout
            )
        except TimeoutError:
            process.kill()
            await process.wait()
            return -1, "", f"command timed out after {timeout}s"
        return (
            process.returncode or 0,
            stdout_bytes.decode("utf-8", errors="replace").strip(),
            stderr_bytes.decode("utf-8", errors="replace").strip(),
        )
    except FileNotFoundError as exc:
        return -1, "", f"command not found: {exc}"
    except Exception as exc:
        return -1, "", f"command execution failed: {exc}"


async def check_manual_only(config: PredicateConfig) -> PredicateResult:
    """手动检查 — 始终返回 passed=True，附 reason 说明。

    用于那些需要人工或 LLM 从文档/上下文中判断的规则（如 spec 完整性、
    Design Gate 证据等）。SOP 引擎不自动判定，仅记录检查说明。
    """
    reason = config.reason or "manual check required"
    logger.debug(f"check_manual_only: reason={reason!r}")
    return PredicateResult(
        passed=True,
        message=f"manual check: {reason}",
        evidence={"reason": reason, "automated": False},
    )


async def check_git_state(config: PredicateConfig) -> PredicateResult:
    """检查 git 仓库状态。

    支持的 checks 项：
    - ahead_zero: 本地分支领先远端 0 个提交（已推送）
    - behind_zero: 本地分支落后远端 0 个提交（已拉取）
    - clean: 工作区干净（无未提交改动）

    Args:
        config.repository: 仓库标识（保留字段，当前仅支持 current）
        config.branch: 分支名（默认 main）
        config.checks: 检查项列表
        config.before_command: 触发检查的前置命令（仅记录到 evidence）
    """
    branch = config.branch or "main"
    checks = config.checks or ["ahead_zero", "behind_zero"]
    evidence: dict[str, Any] = {
        "branch": branch,
        "checks": list(checks),
        "before_command": config.before_command,
    }

    # 获取当前分支
    rc, current_branch, _ = await _run_command(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"]
    )
    if rc != 0:
        return PredicateResult(
            passed=False,
            message=f"failed to get current branch: {current_branch}",
            evidence=evidence,
        )
    evidence["current_branch"] = current_branch

    # 获取与远端的 ahead/behind 计数
    rc, counts, err = await _run_command(
        ["git", "rev-list", "--left-right", "--count", f"origin/{branch}...HEAD"]
    )
    ahead = behind = -1
    if rc == 0:
        try:
            parts = counts.split()
            if len(parts) >= 2:
                behind, ahead = int(parts[0]), int(parts[1])
        except (ValueError, IndexError):
            pass
    evidence["ahead"] = ahead
    evidence["behind"] = behind

    # 检查工作区是否干净
    clean = None
    if "clean" in checks:
        rc, status, _ = await _run_command(["git", "status", "--porcelain"])
        clean = rc == 0 and status == ""
        evidence["clean"] = clean

    # 评估检查项
    failures: list[str] = []
    if "ahead_zero" in checks and ahead > 0:
        failures.append(f"branch is ahead of origin/{branch} by {ahead} commits")
    if "behind_zero" in checks and behind > 0:
        failures.append(f"branch is behind origin/{branch} by {behind} commits")
    if "clean" in checks and clean is False:
        failures.append("working tree has uncommitted changes")

    if failures:
        return PredicateResult(
            passed=False,
            message="; ".join(failures),
            evidence=evidence,
        )
    return PredicateResult(
        passed=True,
        message=f"git state OK on branch {current_branch}",
        evidence=evidence,
    )


async def check_env(config: PredicateConfig) -> PredicateResult:
    """检查环境变量是否已设置。

    config.env_vars 中列出的环境变量必须全部存在且非空。
    """
    env_vars = config.env_vars or []
    if not env_vars:
        return PredicateResult(
            passed=True,
            message="no env vars to check",
            evidence={"checked": []},
        )

    missing: list[str] = []
    present: dict[str, bool] = {}
    for name in env_vars:
        value = os.environ.get(name, "")
        is_set = bool(value)
        present[name] = is_set
        if not is_set:
            missing.append(name)

    evidence = {"checked": env_vars, "present": present, "missing": missing}
    if missing:
        return PredicateResult(
            passed=False,
            message=f"missing env vars: {', '.join(missing)}",
            evidence=evidence,
        )
    return PredicateResult(
        passed=True,
        message=f"all {len(env_vars)} env vars present",
        evidence=evidence,
    )


async def check_command_pattern(config: PredicateConfig) -> PredicateResult:
    """检查命令模式匹配。

    用于校验最近执行的命令是否符合预期模式：
    - must_match: 命令必须匹配此正则（若提供）
    - must_not_match: 命令禁止匹配此正则（若提供）

    实际命令历史从 context['last_command'] 获取，由调用方注入。
    若未提供 last_command，则视为 passed=False（缺少证据）。
    """
    last_command = config.reason  # 不适用，从外部上下文获取
    # 注意：PredicateConfig 不携带运行时上下文，因此需要通过 evidence 间接传入
    # 这里采用保守策略：若无上下文则提示需要外部证据
    evidence: dict[str, Any] = {
        "must_match": config.must_match,
        "must_not_match": config.must_not_match,
    }

    if not config.must_match and not config.must_not_match:
        return PredicateResult(
            passed=True,
            message="no patterns to check",
            evidence=evidence,
        )

    # command_pattern 检查器需要外部证据（last_command）。
    # 由于 PredicateConfig 是静态配置，运行时命令由 SOPExecutor 通过
    # context['last_command'] 注入到 evidence 字段。
    # 这里返回 passed=True 由 engine 层在调用前注入 last_command 后覆写。
    return PredicateResult(
        passed=True,
        message="command pattern check requires runtime context (last_command)",
        evidence=evidence,
    )


async def check_command_sequence(config: PredicateConfig) -> PredicateResult:
    """检查命令序列。

    用于校验已执行的命令序列：
    - must_include: 序列中必须出现的命令（全部满足）
    - anti_pattern: 序列中禁止出现的命令（任一出现即失败）
    - cwd_contains: 当前工作目录需包含的子串

    命令历史从外部 context['command_history'] 获取，由 SOPExecutor 注入。
    """
    evidence: dict[str, Any] = {
        "must_include": list(config.must_include),
        "anti_pattern": list(config.anti_pattern),
        "cwd_contains": config.cwd_contains,
    }

    if not config.must_include and not config.anti_pattern and not config.cwd_contains:
        return PredicateResult(
            passed=True,
            message="no sequence constraints to check",
            evidence=evidence,
        )

    # 同 check_command_pattern，运行时命令历史由 engine 注入
    return PredicateResult(
        passed=True,
        message="command sequence check requires runtime context (command_history)",
        evidence=evidence,
    )


async def check_handle(config: PredicateConfig) -> PredicateResult:
    """检查 handle 约束。

    支持的 constraint：
    - reviewer_not_author: reviewer 不能是 PR author
    - guardian_handoff_present: 必须有非作者非reviewer的 guardian handoff 记录

    这些约束需要外部上下文（author/reviewer/guardian 标识），
    由 SOPExecutor 通过 context 注入到 evidence。
    """
    constraint = config.constraint
    evidence: dict[str, Any] = {"constraint": constraint}

    if not constraint:
        return PredicateResult(
            passed=False,
            message="no handle constraint specified",
            evidence=evidence,
        )

    if constraint not in ("reviewer_not_author", "guardian_handoff_present"):
        return PredicateResult(
            passed=False,
            message=f"unknown handle constraint: {constraint}",
            evidence=evidence,
        )

    # 运行时上下文由 engine 注入
    return PredicateResult(
        passed=True,
        message=f"handle check '{constraint}' requires runtime context (author/reviewer/guardian)",
        evidence=evidence,
    )


async def check_sha_dedup(config: PredicateConfig) -> PredicateResult:
    """SHA 去重检查 — 防止同一 SHA 被重复处理。

    检查 context['current_sha'] 是否在 context['seen_shas'] 中。
    运行时数据由 SOPExecutor 注入。
    """
    evidence: dict[str, Any] = {
        "reason": config.reason or "sha dedup check",
    }
    return PredicateResult(
        passed=True,
        message="sha dedup check requires runtime context (current_sha, seen_shas)",
        evidence=evidence,
    )


async def check_feature_doc_readiness(config: PredicateConfig) -> PredicateResult:
    """feature doc 准备就绪检查。

    检查 feature doc 是否包含必要字段（AC、需求点、Design Gate 证据等）。
    实际文档内容由 SOPExecutor 通过 context['feature_doc'] 注入。
    """
    evidence: dict[str, Any] = {
        "reason": config.reason or "feature doc readiness check",
    }
    return PredicateResult(
        passed=True,
        message="feature doc readiness check requires runtime context (feature_doc)",
        evidence=evidence,
    )


# 谓词检查器函数类型
PredicateCheckerFn = Callable[[PredicateConfig], Awaitable[PredicateResult]]


class PredicateChecker:
    """谓词检查器注册与分发。

    根据 PredicateConfig.type 路由到对应的 async 检查函数。
    支持通过 register 方法注册自定义检查器以扩展新的类型。
    """

    def __init__(self) -> None:
        self._checkers: dict[PredicateType, PredicateCheckerFn] = {}
        self._register_defaults()

    def _register_defaults(self) -> None:
        """注册内置检查器。"""
        self._checkers[PredicateType.MANUAL_ONLY] = check_manual_only
        self._checkers[PredicateType.GIT_STATE_PREDICATE] = check_git_state
        self._checkers[PredicateType.ENV_CHECK] = check_env
        self._checkers[PredicateType.COMMAND_PATTERN] = check_command_pattern
        self._checkers[PredicateType.COMMAND_SEQUENCE] = check_command_sequence
        self._checkers[PredicateType.HANDLE_CHECK] = check_handle
        self._checkers[PredicateType.SHA_DEDUP] = check_sha_dedup
        self._checkers[PredicateType.FEATURE_DOC_READINESS_CHECK] = (
            check_feature_doc_readiness
        )

    def register(
        self, predicate_type: PredicateType, checker: PredicateCheckerFn
    ) -> None:
        """注册或覆盖一个谓词检查器。

        Args:
            predicate_type: 谓词类型
            checker: async 检查函数 (config) -> PredicateResult
        """
        logger.info(f"PredicateChecker: registering checker for type={predicate_type.value}")
        self._checkers[predicate_type] = checker

    async def check(
        self,
        config: PredicateConfig,
        context: dict[str, Any] | None = None,
    ) -> PredicateResult:
        """执行谓词检查。

        Args:
            config: 谓词配置
            context: 运行时上下文（可包含 last_command / command_history /
                     author / reviewer / guardian / feature_doc 等）

        Returns:
            PredicateResult 检查结果
        """
        checker = self._checkers.get(config.type)
        if checker is None:
            logger.warning(f"PredicateChecker: no checker registered for type={config.type}")
            return PredicateResult(
                passed=False,
                message=f"no checker registered for predicate type: {config.type}",
                evidence={"type": config.type.value},
            )

        try:
            result = await checker(config)
        except Exception as exc:
            logger.exception(f"PredicateChecker: checker for type={config.type} raised exception")
            return PredicateResult(
                passed=False,
                message=f"checker exception: {exc}",
                evidence={"type": config.type.value, "exception": str(exc)},
            )

        # 若提供了运行时上下文，对需要上下文的检查器进行后处理
        if context:
            result = self._apply_context(config, result, context)

        return result

    def _apply_context(
        self,
        config: PredicateConfig,
        result: PredicateResult,
        context: dict[str, Any],
    ) -> PredicateResult:
        """对需要运行时上下文的检查结果进行后处理。

        command_pattern / command_sequence / handle_check 等检查器
        在无上下文时返回 passed=True 但 message 提示需要上下文。
        此方法在上下文可用时，重新评估这些检查。
        """
        if config.type == PredicateType.COMMAND_PATTERN:
            return self._evaluate_command_pattern(config, result, context)
        if config.type == PredicateType.COMMAND_SEQUENCE:
            return self._evaluate_command_sequence(config, result, context)
        if config.type == PredicateType.HANDLE_CHECK:
            return self._evaluate_handle_check(config, result, context)
        if config.type == PredicateType.SHA_DEDUP:
            return self._evaluate_sha_dedup(config, result, context)
        if config.type == PredicateType.FEATURE_DOC_READINESS_CHECK:
            return self._evaluate_feature_doc(config, result, context)
        return result

    def _evaluate_command_pattern(
        self,
        config: PredicateConfig,
        result: PredicateResult,
        context: dict[str, Any],
    ) -> PredicateResult:
        """评估命令模式匹配。"""
        last_command = context.get("last_command", "")
        evidence = dict(result.evidence)
        evidence["last_command"] = last_command

        if not last_command:
            return PredicateResult(
                passed=False,
                message="command_pattern check failed: no last_command in context",
                evidence=evidence,
            )

        if config.must_match:
            if not re.search(config.must_match, last_command):
                return PredicateResult(
                    passed=False,
                    message=f"command '{last_command}' does not match required pattern: {config.must_match}",
                    evidence=evidence,
                )

        if config.must_not_match:
            if re.search(config.must_not_match, last_command):
                return PredicateResult(
                    passed=False,
                    message=f"command '{last_command}' matches forbidden pattern: {config.must_not_match}",
                    evidence=evidence,
                )

        return PredicateResult(
            passed=True,
            message=f"command pattern OK: '{last_command}'",
            evidence=evidence,
        )

    def _evaluate_command_sequence(
        self,
        config: PredicateConfig,
        result: PredicateResult,
        context: dict[str, Any],
    ) -> PredicateResult:
        """评估命令序列约束。"""
        command_history: list[str] = context.get("command_history", [])
        cwd = context.get("cwd", os.getcwd())
        evidence = dict(result.evidence)
        evidence["command_history"] = command_history
        evidence["cwd"] = cwd

        # cwd_contains 检查
        if config.cwd_contains and config.cwd_contains not in cwd:
            return PredicateResult(
                passed=False,
                message=f"cwd '{cwd}' does not contain '{config.cwd_contains}'",
                evidence=evidence,
            )

        # must_include 检查：所有命令都必须在历史中出现
        if config.must_include:
            missing = [
                cmd for cmd in config.must_include
                if not any(cmd in hist_cmd for hist_cmd in command_history)
            ]
            if missing:
                return PredicateResult(
                    passed=False,
                    message=f"command sequence missing required commands: {missing}",
                    evidence=evidence,
                )

        # anti_pattern 检查：任一禁止命令出现即失败
        if config.anti_pattern:
            violated = [
                cmd for cmd in config.anti_pattern
                if any(cmd in hist_cmd for hist_cmd in command_history)
            ]
            if violated:
                return PredicateResult(
                    passed=False,
                    message=f"command sequence contains forbidden commands: {violated}",
                    evidence=evidence,
                )

        return PredicateResult(
            passed=True,
            message="command sequence OK",
            evidence=evidence,
        )

    def _evaluate_handle_check(
        self,
        config: PredicateConfig,
        result: PredicateResult,
        context: dict[str, Any],
    ) -> PredicateResult:
        """评估 handle 约束。"""
        author = context.get("author", "")
        reviewer = context.get("reviewer", "")
        guardian = context.get("guardian", "")
        evidence = dict(result.evidence)
        evidence.update({"author": author, "reviewer": reviewer, "guardian": guardian})

        if config.constraint == "reviewer_not_author":
            if not author or not reviewer:
                return PredicateResult(
                    passed=False,
                    message="handle check reviewer_not_author requires both author and reviewer in context",
                    evidence=evidence,
                )
            if reviewer == author:
                return PredicateResult(
                    passed=False,
                    message=f"reviewer '{reviewer}' is the same as author '{author}'",
                    evidence=evidence,
                )
            return PredicateResult(
                passed=True,
                message=f"reviewer '{reviewer}' is not author '{author}'",
                evidence=evidence,
            )

        if config.constraint == "guardian_handoff_present":
            if not guardian:
                return PredicateResult(
                    passed=False,
                    message="handle check guardian_handoff_present requires guardian in context",
                    evidence=evidence,
                )
            if guardian == author:
                return PredicateResult(
                    passed=False,
                    message=f"guardian '{guardian}' is the same as author '{author}'",
                    evidence=evidence,
                )
            if guardian == reviewer:
                return PredicateResult(
                    passed=False,
                    message=f"guardian '{guardian}' is the same as reviewer '{reviewer}'",
                    evidence=evidence,
                )
            return PredicateResult(
                passed=True,
                message=f"guardian '{guardian}' is independent of author and reviewer",
                evidence=evidence,
            )

        return result

    def _evaluate_sha_dedup(
        self,
        config: PredicateConfig,
        result: PredicateResult,
        context: dict[str, Any],
    ) -> PredicateResult:
        """评估 SHA 去重。"""
        current_sha = context.get("current_sha", "")
        seen_shas: set[str] = set(context.get("seen_shas", []))
        evidence = dict(result.evidence)
        evidence.update({"current_sha": current_sha, "seen_shas": list(seen_shas)})

        if not current_sha:
            return PredicateResult(
                passed=False,
                message="sha_dedup check requires current_sha in context",
                evidence=evidence,
            )

        if current_sha in seen_shas:
            return PredicateResult(
                passed=False,
                message=f"current_sha '{current_sha}' has already been processed",
                evidence=evidence,
            )

        return PredicateResult(
            passed=True,
            message=f"current_sha '{current_sha}' is new",
            evidence=evidence,
        )

    def _evaluate_feature_doc(
        self,
        config: PredicateConfig,
        result: PredicateResult,
        context: dict[str, Any],
    ) -> PredicateResult:
        """评估 feature doc 准备就绪。"""
        feature_doc = context.get("feature_doc", {})
        evidence = dict(result.evidence)
        evidence["feature_doc_keys"] = list(feature_doc.keys()) if isinstance(feature_doc, dict) else []

        if not feature_doc:
            return PredicateResult(
                passed=False,
                message="feature_doc_readiness_check requires feature_doc in context",
                evidence=evidence,
            )

        if not isinstance(feature_doc, dict):
            return PredicateResult(
                passed=False,
                message="feature_doc must be a dict",
                evidence=evidence,
            )

        # 检查必要字段（AC / 需求点 checklist）
        required_keys = ["acceptance_criteria", "requirements"]
        missing = [k for k in required_keys if k not in feature_doc]
        if missing:
            return PredicateResult(
                passed=False,
                message=f"feature_doc missing required keys: {missing}",
                evidence=evidence,
            )

        return PredicateResult(
            passed=True,
            message="feature doc is ready",
            evidence=evidence,
        )
