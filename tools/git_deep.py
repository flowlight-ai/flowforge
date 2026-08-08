"""Git Deep Operations Tool — Git深度操作工具.

提供log/diff/blame/status等深度Git操作能力。
对标 Claude Code / Codex 的Git操作能力。
"""
from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path
from typing import Any, Dict, List

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.tools.git_deep")


class GitDeepTool(BaseTool):
    """Git深度操作工具 — log/diff/blame/status/show/stash."""

    name = "git_deep"
    description = "Git深度操作：log、diff、blame、status、show、stash、merge-base"
    safety_level = "normal"
    is_concurrency_safe = False

    parameters_schema = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["log", "diff", "blame", "status", "show", "stash_list", "merge_base", "rev_parse"],
                "description": "操作类型"
            },
            "path": {"type": "string", "description": "文件路径（blame/diff操作）"},
            "working_dir": {"type": "string", "description": "Git仓库工作目录"},
            "revision": {"type": "string", "description": "Git修订版本（show/log操作）"},
            "revision_range": {"type": "string", "description": "版本范围（log/diff操作，如 HEAD~5..HEAD）"},
            "max_count": {"type": "integer", "default": 20, "description": "最大返回条数（log操作）"},
            "author": {"type": "string", "description": "作者过滤（log操作）"},
            "since": {"type": "string", "description": "起始日期（log操作）"},
            "until": {"type": "string", "description": "结束日期（log操作）"},
            "staged": {"type": "boolean", "default": False, "description": "是否只看暂存区（diff操作）"},
        },
        "required": ["action"],
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        action = input.params.get("action")
        working_dir = input.params.get("working_dir", os.getcwd())

        try:
            if action == "log":
                return await self._log(working_dir, input.params)
            elif action == "diff":
                return await self._diff(working_dir, input.params)
            elif action == "blame":
                return await self._blame(working_dir, input.params)
            elif action == "status":
                return await self._status(working_dir, input.params)
            elif action == "show":
                return await self._show(working_dir, input.params)
            elif action == "stash_list":
                return await self._stash_list(working_dir, input.params)
            elif action == "merge_base":
                return await self._merge_base(working_dir, input.params)
            elif action == "rev_parse":
                return await self._rev_parse(working_dir, input.params)
            else:
                return ToolOutput(error=f"Unknown action: {action}")
        except Exception as e:
            logger.error(f"git_deep error: action={action} error={e}")
            return ToolOutput(error=str(e))

    async def _run_git(self, args: List[str], cwd: str, timeout: int = 30) -> Dict:
        """执行git命令."""
        cmd = ["git", "-C", cwd] + args
        t0 = time.time()
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return {"success": False, "error": f"Git command timed out after {timeout}s"}
        elapsed = round(time.time() - t0, 2)
        return {
            "success": proc.returncode == 0,
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
            "return_code": proc.returncode,
            "elapsed_s": elapsed,
        }

    async def _log(self, cwd: str, params: Dict) -> ToolOutput:
        """查看提交历史."""
        max_count = params.get("max_count", 20)
        revision_range = params.get("revision_range", "")
        author = params.get("author", "")
        since = params.get("since", "")
        until = params.get("until", "")
        path = params.get("path", "")

        args = ["log", f"--max-count={max_count}", "--format=%H|%an|%ae|%ai|%s"]
        if revision_range:
            args.append(revision_range)
        if author:
            args.extend(["--author", author])
        if since:
            args.extend(["--since", since])
        if until:
            args.extend(["--until", until])
        if path:
            args.extend(["--", path])

        result = await self._run_git(args, cwd)
        if not result["success"]:
            return ToolOutput(error=f"git log failed: {result['stderr']}")

        commits = []
        for line in result["stdout"].strip().split("\n"):
            if not line or "|" not in line:
                continue
            parts = line.split("|", 4)
            if len(parts) >= 5:
                commits.append({
                    "hash": parts[0][:12],
                    "author": parts[1],
                    "email": parts[2],
                    "date": parts[3],
                    "message": parts[4],
                })

        return ToolOutput(result={
            "commits": commits,
            "total": len(commits),
            "elapsed_s": result["elapsed_s"],
        })

    async def _diff(self, cwd: str, params: Dict) -> ToolOutput:
        """查看差异."""
        revision = params.get("revision", "")
        revision_range = params.get("revision_range", "")
        path = params.get("path", "")
        staged = params.get("staged", False)

        args = ["diff"]
        if staged:
            args.append("--cached")
        if revision:
            args.append(revision)
        elif revision_range:
            args.append(revision_range)
        if path:
            args.extend(["--", path])

        result = await self._run_git(args, cwd, timeout=60)
        if not result["success"]:
            return ToolOutput(error=f"git diff failed: {result['stderr']}")

        diff = result["stdout"]
        # 统计变更
        files_changed = []
        current_file = None
        for line in diff.split("\n"):
            if line.startswith("+++ b/") or line.startswith("--- a/"):
                fname = line.split("/", 1)[1] if "/" in line else line[4:]
                if fname not in [f["name"] for f in files_changed]:
                    files_changed.append({"name": fname})

        return ToolOutput(result={
            "diff": diff[:20000],
            "files_changed": [f["name"] for f in files_changed],
            "files_count": len(files_changed),
            "has_changes": bool(diff.strip()),
        })

    async def _blame(self, cwd: str, params: Dict) -> ToolOutput:
        """查看行级 blame 信息."""
        path = params.get("path", "")
        if not path:
            return ToolOutput(error="Missing 'path' parameter for blame")

        args = ["blame", "--porcelain", path]
        result = await self._run_git(args, cwd, timeout=30)
        if not result["success"]:
            return ToolOutput(error=f"git blame failed: {result['stderr']}")

        # 解析porcelain格式
        lines = []
        current_commit = None
        for line in result["stdout"].split("\n"):
            if line.startswith("author "):
                current_commit = {"author": line[7:]}
            elif line.startswith("summary "):
                if current_commit:
                    current_commit["summary"] = line[8:]
            elif line.startswith("\t"):
                if current_commit:
                    current_commit["code"] = line[1:]
                    lines.append(current_commit)
                    current_commit = None

        return ToolOutput(result={
            "file": path,
            "lines": lines[:200],
            "total_lines": len(lines),
        })

    async def _status(self, cwd: str, params: Dict) -> ToolOutput:
        """查看工作区状态."""
        args = ["status", "--porcelain=v2", "--branch"]
        result = await self._run_git(args, cwd)
        if not result["success"]:
            return ToolOutput(error=f"git status failed: {result['stderr']}")

        staged = []
        unstaged = []
        untracked = []
        branch = ""

        for line in result["stdout"].split("\n"):
            if line.startswith("# branch.head "):
                branch = line[14:]
            elif line.startswith("1 "):
                # v2 format: 1 <xy> <sub> <mH> <mI> <mW> <hH> <hI> <path>
                parts = line.split()
                if len(parts) >= 9:
                    xy = parts[1]
                    path = parts[8]
                    if xy[0] != "." and xy[0] != "?":
                        staged.append({"status": xy[0], "path": path})
                    if xy[1] != "." and xy[1] != "?":
                        unstaged.append({"status": xy[1], "path": path})
            elif line.startswith("? "):
                untracked.append(line[2:])

        return ToolOutput(result={
            "branch": branch,
            "staged": staged,
            "unstaged": unstaged,
            "untracked": untracked,
            "is_clean": not (staged or unstaged or untracked),
        })

    async def _show(self, cwd: str, params: Dict) -> ToolOutput:
        """查看提交详情."""
        revision = params.get("revision", "HEAD")
        args = ["show", "--stat", revision]
        result = await self._run_git(args, cwd)
        if not result["success"]:
            return ToolOutput(error=f"git show failed: {result['stderr']}")
        return ToolOutput(result={
            "revision": revision,
            "output": result["stdout"][:10000],
        })

    async def _stash_list(self, cwd: str, params: Dict) -> ToolOutput:
        """查看stash列表."""
        args = ["stash", "list"]
        result = await self._run_git(args, cwd)
        if not result["success"]:
            return ToolOutput(result={"stashes": [], "total": 0})
        stashes = [line.strip() for line in result["stdout"].strip().split("\n") if line.strip()]
        return ToolOutput(result={"stashes": stashes, "total": len(stashes)})

    async def _merge_base(self, cwd: str, params: Dict) -> ToolOutput:
        """查找合并基点."""
        revisions = params.get("revision_range", "HEAD HEAD~1").split()
        args = ["merge-base"] + revisions
        result = await self._run_git(args, cwd)
        if not result["success"]:
            return ToolOutput(error=f"git merge-base failed: {result['stderr']}")
        return ToolOutput(result={"merge_base": result["stdout"].strip()})

    async def _rev_parse(self, cwd: str, params: Dict) -> ToolOutput:
        """解析Git引用."""
        revision = params.get("revision", "HEAD")
        args = ["rev-parse", revision]
        result = await self._run_git(args, cwd)
        if not result["success"]:
            return ToolOutput(error=f"git rev-parse failed: {result['stderr']}")
        return ToolOutput(result={"revision": revision, "hash": result["stdout"].strip()})
