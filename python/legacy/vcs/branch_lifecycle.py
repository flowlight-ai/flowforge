"""分支生命周期管理.

feat/* → review → merge → cleanup 的完整生命周期。
与 WorktreeManager 配合使用，管理 feature 分支的创建、提交、推送和清理。

设计原则（遵守铁律）：
- 所有 git 命令通过 asyncio.create_subprocess_exec 异步执行
- 不硬编码路径（铁律5）：repo_path 通过参数传入
- 合入后清理采用 fail-closed 机制（工作树不干净就停止）
- 仅依赖 flowforge.core.tracing 和 flowforge.vcs.worktree，单向依赖
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from flowforge.core.tracing import get_logger
from flowforge.vcs.worktree import _run_git

logger = get_logger("flowforge.vcs.branch_lifecycle")


class BranchLifecycle:
    """分支生命周期管理.

    feat/* → review → merge → cleanup

    与 WorktreeManager 配合：
    - create_feature_branch: 在 worktree 中创建 feat/{name} 分支
    - commit_changes: 提交变更
    - push_branch: 推送到 remote
    - cleanup_after_merge: 合入后清理（worktree remove + branch delete + prune）
    - check_dirty_worktree: fail-closed 工作树检查

    Usage:
        lifecycle = BranchLifecycle()
        await lifecycle.create_feature_branch("/path/to/worktree", "my-feature")
        sha = await lifecycle.commit_changes("/path/to/worktree", "feat: add xxx")
        await lifecycle.push_branch("/path/to/worktree", "feat/my-feature")
        # ... after merge ...
        await lifecycle.cleanup_after_merge("/path/to/repo", "my-feature")
    """

    def __init__(self) -> None:
        """初始化 BranchLifecycle."""
        pass

    async def create_feature_branch(
        self, repo_path: str, feature_name: str
    ) -> str:
        """创建 feat/{name} 分支.

        在当前仓库中创建并切换到 feat/{feature_name} 分支。
        若分支已存在则切换到该分支。

        Args:
            repo_path: 仓库根目录绝对路径
            feature_name: feature 名称

        Returns:
            分支名 feat/{feature_name}

        Raises:
            RuntimeError: 分支创建失败
        """
        branch_name = f"feat/{feature_name}"
        logger.info(
            f"create_feature_branch: repo={repo_path} branch={branch_name}"
        )

        # 尝试创建新分支并切换
        rc, out, err = await _run_git(
            ["checkout", "-b", branch_name], cwd=repo_path
        )
        if rc == 0:
            logger.info(
                f"create_feature_branch: created and switched to {branch_name}"
            )
            return branch_name

        # 分支可能已存在，尝试直接切换
        rc2, _, err2 = await _run_git(
            ["checkout", branch_name], cwd=repo_path
        )
        if rc2 == 0:
            logger.info(
                f"create_feature_branch: switched to existing {branch_name}"
            )
            return branch_name

        raise RuntimeError(
            f"create_feature_branch failed: checkout -b failed ({err}), "
            f"checkout failed ({err2})"
        )

    async def commit_changes(
        self,
        repo_path: str,
        message: str,
        files: Optional[list[str]] = None,
    ) -> str:
        """提交变更（返回 commit SHA）.

        对应 SKILL commit 流程：git add → git commit → 返回 SHA。

        Args:
            repo_path: 仓库根目录绝对路径
            message: commit message
            files: 要添加的文件列表（None 表示添加所有变更）

        Returns:
            commit SHA

        Raises:
            RuntimeError: 提交失败
        """
        logger.info(
            f"commit_changes: repo={repo_path} message={message!r} "
            f"files={files}"
        )

        # git add
        add_args = ["add"]
        if files:
            add_args.extend(files)
        else:
            add_args.append(".")
        rc_add, _, err_add = await _run_git(add_args, cwd=repo_path)
        if rc_add != 0:
            raise RuntimeError(f"git add failed: {err_add}")

        # git commit
        rc_commit, _, err_commit = await _run_git(
            ["commit", "-m", message], cwd=repo_path
        )
        if rc_commit != 0:
            raise RuntimeError(f"git commit failed: {err_commit}")

        # 获取 commit SHA
        rc_sha, out_sha, err_sha = await _run_git(
            ["rev-parse", "HEAD"], cwd=repo_path
        )
        if rc_sha != 0:
            raise RuntimeError(
                f"git rev-parse HEAD failed: {err_sha}"
            )

        sha = out_sha.strip()
        logger.info(f"commit_changes: committed as {sha[:8]}...")
        return sha

    async def push_branch(
        self, repo_path: str, branch: str
    ) -> None:
        """推送分支到 remote.

        对应 SKILL Step 1：git push origin {branch}。

        Args:
            repo_path: 仓库根目录绝对路径
            branch: 要推送的分支名

        Raises:
            RuntimeError: 推送失败
        """
        logger.info(f"push_branch: repo={repo_path} branch={branch}")

        rc, _, err = await _run_git(
            ["push", "-u", "origin", branch], cwd=repo_path
        )
        if rc != 0:
            raise RuntimeError(f"git push origin {branch} failed: {err}")

        logger.info(f"push_branch: pushed {branch} to origin")

    async def cleanup_after_merge(
        self, repo_path: str, feature_name: str
    ) -> None:
        """合入后清理：worktree remove + branch delete + prune.

        对应 SKILL Step 8（fail-closed）：
        1. 检查工作树是否干净（不干净就停止，禁止 git stash -u）
        2. git checkout main && git pull origin main
        3. git worktree remove ../{repo}-{feature}
        4. git branch -d feat/{feature} && git worktree prune

        ⚠️ fail-closed 铁律：工作树不干净就停止，不强行清理。
        原因：git stash -u 会删除 untracked 文件，多 session 共享工作目录时
        可能导致其他 session 的未 commit 产出丢失。

        Args:
            repo_path: 仓库根目录绝对路径（持有 main 的主仓）
            feature_name: feature 名称

        Raises:
            RuntimeError: 工作树不干净或清理失败
        """
        logger.info(
            f"cleanup_after_merge: repo={repo_path} feature={feature_name}"
        )

        # Step 1: fail-closed 工作树检查
        if await self.check_dirty_worktree(repo_path):
            raise RuntimeError(
                "cleanup_after_merge BLOCKED: 工作树不干净（fail-closed）。"
                "请先处理改动后再继续。禁止使用 git stash -u/--include-untracked。"
            )

        repo = Path(repo_path).resolve()
        repo_name = repo.name
        worktree_dir = repo.parent / f"{repo_name}-{feature_name}"
        branch_name = f"feat/{feature_name}"

        # Step 2: checkout main && pull
        rc_co, _, err_co = await _run_git(
            ["checkout", "main"], cwd=str(repo)
        )
        if rc_co != 0:
            logger.warning(
                f"cleanup_after_merge: checkout main failed: {err_co}"
            )

        rc_pull, _, err_pull = await _run_git(
            ["pull", "origin", "main"], cwd=str(repo)
        )
        if rc_pull != 0:
            logger.warning(
                f"cleanup_after_merge: pull main failed: {err_pull}"
            )

        # Step 3: worktree remove
        rc_wt, _, err_wt = await _run_git(
            ["worktree", "remove", str(worktree_dir)], cwd=str(repo)
        )
        if rc_wt != 0:
            logger.warning(
                f"cleanup_after_merge: worktree remove failed: {err_wt}"
            )

        # Step 4: branch delete + prune
        rc_bd, _, err_bd = await _run_git(
            ["branch", "-d", branch_name], cwd=str(repo)
        )
        if rc_bd != 0:
            logger.warning(
                f"cleanup_after_merge: branch delete failed: {err_bd}"
            )

        await _run_git(["worktree", "prune"], cwd=str(repo))

        logger.info(
            f"cleanup_after_merge: cleaned up feature={feature_name}"
        )

    async def check_dirty_worktree(
        self, repo_path: str
    ) -> bool:
        """检查工作树是否干净（fail-closed 机制）.

        对应 SKILL Step 8 fail-closed 检查：
        工作树不干净 → 停止 merge-gate，不执行清理。

        Args:
            repo_path: 仓库根目录绝对路径

        Returns:
            True 表示工作树不干净（有未提交改动），False 表示干净
        """
        rc, out, _ = await _run_git(
            ["status", "--porcelain"], cwd=repo_path
        )
        if rc != 0:
            # 命令执行失败，按 fail-closed 视为不干净
            logger.warning(
                f"check_dirty_worktree: git status failed, treating as dirty (fail-closed)"
            )
            return True

        is_dirty = bool(out.strip())
        if is_dirty:
            logger.warning(
                f"check_dirty_worktree: working tree is DIRTY — {out.strip()[:200]}"
            )
        else:
            logger.info("check_dirty_worktree: working tree is clean")
        return is_dirty
