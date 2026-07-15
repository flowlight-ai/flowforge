"""Git worktree 隔离开发环境管理.

移植 clowder-ai worktree SKILL 的核心方法论到 FlowForge：
- 创建 worktree 前必须 main 双向同步（ahead=0 behind=0），F073 门禁
- worktree 目录在项目同级（不在项目内部），../{repo}-{feature}
- 创建后验证基线测试通过（pytest）
- 合入后当场清理（worktree remove + branch delete + prune）

设计原则（遵守铁律）：
- 所有 git 命令通过 asyncio.create_subprocess_exec 异步执行（不阻塞事件循环）
- 不硬编码路径（铁律5）：repo_path 通过参数传入
- 不直接实例化依赖（铁律3）：通过构造函数注入
- 仅依赖 flowforge.core.tracing，单向依赖
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.vcs.worktree")


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


class SyncStatus(BaseModel):
    """main 与 origin/main 双向同步状态.

    Attributes:
        ahead: 本地领先远端的提交数（>0 表示有未推送提交）
        behind: 本地落后远端的提交数（>0 表示有未拉取更新）
        is_synced: 是否完全同步（ahead=0 且 behind=0）
        base_branch: 基线分支名
    """

    ahead: int = Field(description="本地领先远端的提交数")
    behind: int = Field(description="本地落后远端的提交数")
    is_synced: bool = Field(description="是否完全同步")
    base_branch: str = Field(default="main", description="基线分支名")


class WorktreeInfo(BaseModel):
    """单个 worktree 的元信息.

    Attributes:
        path: worktree 绝对路径（在 repo 同级目录）
        branch: worktree 使用的分支名（feat/{feature}）
        feature_name: feature 名称
        created_at: 创建时间
        base_branch: 基线分支名（默认 main）
    """

    path: str = Field(description="worktree 绝对路径")
    branch: str = Field(description="worktree 分支名")
    feature_name: str = Field(description="feature 名称")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="创建时间")
    base_branch: str = Field(default="main", description="基线分支名")


# ---------------------------------------------------------------------------
# 异步 git 命令执行器（模块级私有，遵循 git_deep.py 模式）
# ---------------------------------------------------------------------------


async def _run_git(
    args: list[str],
    cwd: Optional[str] = None,
    timeout: float = 60.0,
) -> tuple[int, str, str]:
    """异步执行 git 命令并返回 (returncode, stdout, stderr).

    使用 asyncio.create_subprocess_exec 避免阻塞事件循环（rules.md 4.1）。
    设置 GIT_TERMINAL_PROMPT=0 禁止交互式凭证提示（fail-closed）。

    Args:
        args: git 子命令及参数列表
        cwd: 工作目录（None 表示当前目录）
        timeout: 超时秒数

    Returns:
        (returncode, stdout, stderr) 三元组
    """
    cmd: list[str] = ["git"]
    if cwd:
        cmd.extend(["-C", cwd])
    cmd.extend(args)

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
    except FileNotFoundError as exc:
        return -1, "", f"git command not found: {exc}"

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            process.communicate(), timeout=timeout
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        return -1, "", f"git command timed out after {timeout}s: {' '.join(args)}"

    return (
        process.returncode or 0,
        stdout_bytes.decode("utf-8", errors="replace").strip(),
        stderr_bytes.decode("utf-8", errors="replace").strip(),
    )


# ---------------------------------------------------------------------------
# WorktreeManager
# ---------------------------------------------------------------------------


class WorktreeManager:
    """Git worktree 隔离开发环境管理.

    移植 clowder-ai worktree SKILL 方法论：
    - 创建 worktree 前必须 main 双向同步（ahead=0 behind=0）
    - worktree 目录在项目同级（不在项目内部）
    - 创建后验证基线测试通过
    - 合入后当场清理

    Usage:
        manager = WorktreeManager()
        sync = await manager.check_main_sync("/path/to/repo")
        if not sync.is_synced:
            await manager.sync_main("/path/to/repo")
        wt = await manager.create_worktree("/path/to/repo", "my-feature")
    """

    def __init__(self, test_command: Optional[list[str]] = None) -> None:
        """初始化 WorktreeManager.

        Args:
            test_command: 基线测试命令（默认 ["pytest", "-x", "-q"]），
                          通过参数注入避免硬编码（铁律5）
        """
        self._test_command = test_command or ["pytest", "-x", "-q"]

    async def check_main_sync(
        self, repo_path: str, base_branch: str = "main"
    ) -> SyncStatus:
        """检查 main 与 origin/main 双向同步状态.

        对应 SKILL F073 门禁：ahead=0 behind=0 才允许创建 worktree。

        Args:
            repo_path: 仓库根目录绝对路径
            base_branch: 基线分支名（默认 main）

        Returns:
            SyncStatus 同步状态
        """
        logger.info(
            f"check_main_sync: repo={repo_path} branch={base_branch}"
        )

        # 先 fetch 远端最新引用
        rc_fetch, _, err_fetch = await _run_git(
            ["fetch", "origin", base_branch, "--quiet"], cwd=repo_path
        )
        if rc_fetch != 0:
            logger.warning(
                f"check_main_sync: fetch failed (rc={rc_fetch}): {err_fetch}"
            )

        # ahead = 本地 main 领先 origin/main 的提交数
        # git rev-list --count origin/main..main
        rc_ahead, out_ahead, _ = await _run_git(
            ["rev-list", "--count", f"origin/{base_branch}..{base_branch}"],
            cwd=repo_path,
        )
        ahead = int(out_ahead.strip()) if rc_ahead == 0 and out_ahead.strip().isdigit() else -1

        # behind = 本地 main 落后 origin/main 的提交数
        # git rev-list --count main..origin/main
        rc_behind, out_behind, _ = await _run_git(
            ["rev-list", "--count", f"{base_branch}..origin/{base_branch}"],
            cwd=repo_path,
        )
        behind = (
            int(out_behind.strip())
            if rc_behind == 0 and out_behind.strip().isdigit()
            else -1
        )

        is_synced = ahead == 0 and behind == 0
        status = SyncStatus(
            ahead=ahead,
            behind=behind,
            is_synced=is_synced,
            base_branch=base_branch,
        )
        logger.info(
            f"check_main_sync: ahead={ahead} behind={behind} "
            f"synced={is_synced}"
        )
        return status

    async def sync_main(
        self, repo_path: str, base_branch: str = "main"
    ) -> None:
        """同步 main 到 origin/main（先 pull 再 push）.

        对应 SKILL：behind > 0 先 pull，ahead > 0 再 push，直到双向同步。

        Args:
            repo_path: 仓库根目录绝对路径
            base_branch: 基线分支名

        Raises:
            RuntimeError: 同步后仍未达到双向同步
        """
        logger.info(f"sync_main: syncing {base_branch} for repo={repo_path}")

        # 先 checkout 到 base_branch（确保在主分支上操作）
        rc_co, _, err_co = await _run_git(
            ["checkout", base_branch], cwd=repo_path
        )
        if rc_co != 0:
            logger.warning(
                f"sync_main: checkout {base_branch} failed: {err_co}"
            )

        # pull 拉取远端更新
        rc_pull, _, err_pull = await _run_git(
            ["pull", "origin", base_branch], cwd=repo_path
        )
        if rc_pull != 0:
            logger.warning(f"sync_main: pull failed: {err_pull}")

        # push 推送本地提交
        rc_push, _, err_push = await _run_git(
            ["push", "origin", base_branch], cwd=repo_path
        )
        if rc_push != 0:
            logger.warning(f"sync_main: push failed: {err_push}")

        # 验证同步结果
        status = await self.check_main_sync(repo_path, base_branch)
        if not status.is_synced:
            raise RuntimeError(
                f"sync_main failed: still not synced "
                f"(ahead={status.ahead}, behind={status.behind}). "
                f"Manual resolution required."
            )
        logger.info(f"sync_main: {base_branch} is now synced with origin")

    async def create_worktree(
        self,
        repo_path: str,
        feature_name: str,
        base_branch: str = "main",
    ) -> WorktreeInfo:
        """创建隔离的 worktree.

        步骤：
        1. 检查 main 与 remote 双向同步（ahead=0, behind=0）— F073 门禁
        2. git worktree add ../{repo}-{feature} -b feat/{feature}
        3. 返回 WorktreeInfo（path, branch, created_at）

        Args:
            repo_path: 仓库根目录绝对路径
            feature_name: feature 名称（用于分支名和目录名）
            base_branch: 基线分支名（默认 main）

        Returns:
            WorktreeInfo 创建的 worktree 信息

        Raises:
            RuntimeError: main 未同步或 worktree 创建失败
        """
        logger.info(
            f"create_worktree: repo={repo_path} feature={feature_name} "
            f"base={base_branch}"
        )

        # Step 1: 检查 main 双向同步（F073 门禁，fail-closed）
        status = await self.check_main_sync(repo_path, base_branch)
        if not status.is_synced:
            raise RuntimeError(
                f"Cannot create worktree: main is not synced with origin "
                f"(ahead={status.ahead}, behind={status.behind}). "
                f"Call sync_main() first."
            )

        # Step 2: 计算 worktree 路径（在 repo 同级目录，不在项目内部）
        repo = Path(repo_path).resolve()
        repo_name = repo.name
        worktree_dir = repo.parent / f"{repo_name}-{feature_name}"
        branch_name = f"feat/{feature_name}"

        if worktree_dir.exists():
            raise RuntimeError(
                f"worktree directory already exists: {worktree_dir}"
            )

        # git worktree add ../{repo}-{feature} -b feat/{feature}
        rc, out, err = await _run_git(
            ["worktree", "add", str(worktree_dir), "-b", branch_name],
            cwd=str(repo),
        )
        if rc != 0:
            raise RuntimeError(
                f"git worktree add failed (rc={rc}): {err}"
            )

        info = WorktreeInfo(
            path=str(worktree_dir),
            branch=branch_name,
            feature_name=feature_name,
            created_at=datetime.utcnow(),
            base_branch=base_branch,
        )
        logger.info(
            f"create_worktree: created worktree at {info.path} "
            f"on branch {info.branch}"
        )
        return info

    async def remove_worktree(
        self, repo_path: str, feature_name: str
    ) -> None:
        """清理已合入的 worktree + 删除本地分支.

        对应 SKILL「合入后清理」：
        - git worktree remove ../{repo}-{feature}
        - git branch -d feat/{feature}
        - git worktree prune

        Args:
            repo_path: 仓库根目录绝对路径
            feature_name: feature 名称

        Raises:
            RuntimeError: worktree 移除失败
        """
        logger.info(
            f"remove_worktree: repo={repo_path} feature={feature_name}"
        )

        repo = Path(repo_path).resolve()
        repo_name = repo.name
        worktree_dir = repo.parent / f"{repo_name}-{feature_name}"
        branch_name = f"feat/{feature_name}"

        # git worktree remove ../{repo}-{feature}
        rc_rm, _, err_rm = await _run_git(
            ["worktree", "remove", str(worktree_dir)], cwd=str(repo)
        )
        if rc_rm != 0:
            raise RuntimeError(
                f"git worktree remove failed: {err_rm}. "
                f"If worktree has uncommitted changes, resolve them first."
            )

        # git branch -d feat/{feature}（-d 仅删除已合并分支，安全）
        rc_bd, _, err_bd = await _run_git(
            ["branch", "-d", branch_name], cwd=str(repo)
        )
        if rc_bd != 0:
            logger.warning(
                f"remove_worktree: branch delete failed: {err_bd} "
                f"(may already be deleted or not merged)"
            )

        # git worktree prune（清理 dangling 引用）
        await _run_git(["worktree", "prune"], cwd=str(repo))

        logger.info(
            f"remove_worktree: cleaned up worktree and branch for "
            f"feature={feature_name}"
        )

    async def list_worktrees(
        self, repo_path: str
    ) -> list[WorktreeInfo]:
        """列出所有 worktree.

        解析 `git worktree list --porcelain` 输出。

        Args:
            repo_path: 仓库根目录绝对路径

        Returns:
            WorktreeInfo 列表
        """
        rc, out, err = await _run_git(
            ["worktree", "list", "--porcelain"], cwd=repo_path
        )
        if rc != 0:
            logger.warning(f"list_worktrees: failed: {err}")
            return []

        worktrees: list[WorktreeInfo] = []
        current_path = ""
        current_branch = ""

        for line in out.split("\n"):
            if line.startswith("worktree "):
                current_path = line[len("worktree ") :]
            elif line.startswith("branch "):
                current_branch = line[len("branch ") :]
                # refs/heads/feat/xxx → feat/xxx
                if current_branch.startswith("refs/heads/"):
                    current_branch = current_branch[len("refs/heads/") :]
            elif line == "" and current_path:
                # 空行分隔 worktree 块
                feature_name = ""
                if current_branch.startswith("feat/"):
                    feature_name = current_branch[len("feat/") :]
                worktrees.append(
                    WorktreeInfo(
                        path=current_path,
                        branch=current_branch,
                        feature_name=feature_name,
                        created_at=datetime.utcnow(),
                    )
                )
                current_path = ""
                current_branch = ""

        # 处理最后一个块（无尾随空行的情况）
        if current_path:
            feature_name = ""
            if current_branch.startswith("feat/"):
                feature_name = current_branch[len("feat/") :]
            worktrees.append(
                WorktreeInfo(
                    path=current_path,
                    branch=current_branch,
                    feature_name=feature_name,
                    created_at=datetime.utcnow(),
                )
            )

        logger.info(
            f"list_worktrees: found {len(worktrees)} worktree(s)"
        )
        return worktrees

    async def validate_baseline(
        self, worktree_path: str
    ) -> bool:
        """验证基线测试通过（运行 pytest）.

        对应 SKILL「验证基线测试通过」— worktree 创建后必须确认基线绿，
        否则后续测试失败无法区分是基线问题还是改动引入。

        Args:
            worktree_path: worktree 根目录绝对路径

        Returns:
            True 表示测试通过，False 表示失败
        """
        logger.info(
            f"validate_baseline: running {' '.join(self._test_command)} "
            f"in {worktree_path}"
        )

        try:
            process = await asyncio.create_subprocess_exec(
                *self._test_command,
                cwd=worktree_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
            )
        except FileNotFoundError as exc:
            logger.error(
                f"validate_baseline: test command not found: {exc}"
            )
            return False

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(), timeout=600.0
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            logger.error(
                "validate_baseline: tests timed out after 600s"
            )
            return False

        passed = process.returncode == 0
        if not passed:
            stderr_text = stderr_bytes.decode("utf-8", errors="replace")
            stdout_text = stdout_bytes.decode("utf-8", errors="replace")
            logger.warning(
                f"validate_baseline: tests FAILED (rc={process.returncode}). "
                f"stdout: {stdout_text[:500]}, stderr: {stderr_text[:500]}"
            )
        else:
            logger.info("validate_baseline: tests passed")
        return passed
