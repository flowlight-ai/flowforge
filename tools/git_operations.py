"""FlowForge Git 操作工具 — clone、checkout、add、commit、push、pull、tag、branch。"""

from __future__ import annotations

import asyncio
from typing import Any

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput


class GitOperationsTool(BaseTool):
    name: str = "git_operations"
    description: str = "Execute git operations: clone, checkout, add, commit, push, pull, tag, branch"
    parameters_schema: dict[str, Any] = {
        "type": "object",
        "required": ["action"],
        "properties": {
            "action": {
                "type": "string",
                "enum": ["clone", "checkout", "add", "commit", "push", "pull", "tag", "branch"],
            },
            "repo_path": {"type": "string"},
            "url": {"type": "string"},
            "target": {"type": "string"},
            "branch": {"type": "string"},
            "create_branch": {"type": "boolean"},
            "paths": {"type": "array", "items": {"type": "string"}},
            "message": {"type": "string"},
            "remote": {"type": "string"},
            "tag_name": {"type": "string"},
            "tag_message": {"type": "string"},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        action: str = input.params.get("action", "")
        handler_map: dict[str, Any] = {
            "clone": self._clone,
            "checkout": self._checkout,
            "add": self._add,
            "commit": self._commit,
            "push": self._push,
            "pull": self._pull,
            "tag": self._tag,
            "branch": self._branch,
        }

        handler = handler_map.get(action)
        if not handler:
            return ToolOutput(
                result={"success": False},
                error=f"Unknown git action: {action}. Supported: {list(handler_map.keys())}",
            )

        try:
            return await handler(input.params)
        except Exception as e:
            return ToolOutput(result={"success": False}, error=str(e))

    async def _run_git(self, args: list[str], cwd: str | None = None) -> dict[str, Any]:
        cmd: list[str] = ["git"]
        if cwd:
            cmd.extend(["-C", cwd])
        cmd.extend(args)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        return {
            "success": proc.returncode == 0,
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
            "return_code": proc.returncode or 0,
        }

    async def _clone(self, params: dict[str, Any]) -> ToolOutput:
        url: str = params.get("url", "")
        if not url:
            return ToolOutput(result={"success": False}, error="url is required for clone")

        args: list[str] = ["clone", url]
        target: str | None = params.get("target")
        if target:
            args.append(target)

        result: dict[str, Any] = await self._run_git(args)
        return ToolOutput(result=result)

    async def _checkout(self, params: dict[str, Any]) -> ToolOutput:
        branch: str = params.get("branch", "")
        if not branch:
            return ToolOutput(result={"success": False}, error="branch is required for checkout")

        args: list[str] = ["checkout"]
        if params.get("create_branch"):
            args.append("-b")
        args.append(branch)

        result: dict[str, Any] = await self._run_git(args, cwd=params.get("repo_path"))
        return ToolOutput(result=result)

    async def _add(self, params: dict[str, Any]) -> ToolOutput:
        paths: list[str] = params.get("paths", ["."])
        args: list[str] = ["add"] + paths

        result: dict[str, Any] = await self._run_git(args, cwd=params.get("repo_path"))
        return ToolOutput(result=result)

    async def _commit(self, params: dict[str, Any]) -> ToolOutput:
        message: str = params.get("message", "")
        if not message:
            return ToolOutput(result={"success": False}, error="message is required for commit")

        args: list[str] = ["commit", "-m", message]

        result: dict[str, Any] = await self._run_git(args, cwd=params.get("repo_path"))
        return ToolOutput(result=result)

    async def _push(self, params: dict[str, Any]) -> ToolOutput:
        remote: str = params.get("remote", "origin")
        args: list[str] = ["push", remote]

        branch: str | None = params.get("branch")
        if branch:
            args.append(branch)

        result: dict[str, Any] = await self._run_git(args, cwd=params.get("repo_path"))
        return ToolOutput(result=result)

    async def _pull(self, params: dict[str, Any]) -> ToolOutput:
        remote: str = params.get("remote", "origin")
        args: list[str] = ["pull", remote]

        branch: str | None = params.get("branch")
        if branch:
            args.append(branch)

        result: dict[str, Any] = await self._run_git(args, cwd=params.get("repo_path"))
        return ToolOutput(result=result)

    async def _tag(self, params: dict[str, Any]) -> ToolOutput:
        tag_name: str = params.get("tag_name", "")
        if not tag_name:
            return ToolOutput(result={"success": False}, error="tag_name is required for tag")

        args: list[str] = ["tag", tag_name]
        tag_message: str | None = params.get("tag_message")
        if tag_message:
            args.extend(["-m", tag_message])

        result: dict[str, Any] = await self._run_git(args, cwd=params.get("repo_path"))
        return ToolOutput(result=result)

    async def _branch(self, params: dict[str, Any]) -> ToolOutput:
        branch: str = params.get("branch", "")
        if not branch:
            return ToolOutput(result={"success": False}, error="branch name is required")

        args: list[str] = ["branch", branch]

        result: dict[str, Any] = await self._run_git(args, cwd=params.get("repo_path"))
        return ToolOutput(result=result)
