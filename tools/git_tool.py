import asyncio
import os
from typing import Any, Dict

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.git_tool")


class GitTool(BaseTool):
    name = "git_tool"
    description = "Git版本控制操作：status, diff, log, commit, push, branch"
    parameters_schema = {
        "type": "object",
        "required": ["action"],
        "properties": {
            "action": {
                "type": "string",
                "enum": ["status", "diff", "log", "commit", "push", "branch", "add"],
                "description": "Git action to perform",
            },
            "path": {"type": "string", "description": "Repository path (defaults to CWD)"},
            "message": {"type": "string", "description": "Commit message (for commit action)"},
            "count": {"type": "integer", "description": "Number of log entries (for log action)"},
            "files": {
                "type": "array",
                "items": {"type": "string"},
                "description": "File paths to add/commit",
            },
            "branch": {"type": "string", "description": "Branch name (for branch action)"},
        },
    }
    safety_level = "dangerous"
    is_concurrency_safe = False

    def _get_repo_path(self, params: Dict[str, Any]) -> str:
        return params.get("path", os.getcwd())

    async def _run_git(self, args: list[str], repo_path: str, timeout: int = 30) -> Dict[str, Any]:
        try:
            proc = await asyncio.create_subprocess_exec(
                "git", *args,
                cwd=repo_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            output = stdout.decode("utf-8", errors="replace").strip()
            error = stderr.decode("utf-8", errors="replace").strip()
            return {
                "exit_code": proc.returncode,
                "output": output,
                "error": error,
                "success": proc.returncode == 0,
            }
        except asyncio.TimeoutError:
            return {"exit_code": -1, "output": "", "error": "Command timed out", "success": False}
        except FileNotFoundError:
            return {"exit_code": -1, "output": "", "error": "git not found in PATH", "success": False}

    async def execute(self, input: ToolInput) -> ToolOutput:
        params = input.params
        action = params.get("action", "")
        repo_path = self._get_repo_path(params)

        if action == "status":
            result = await self._run_git(["status", "--porcelain=v1"], repo_path)
            if result["success"]:
                files = []
                for line in result["output"].split("\n"):
                    if line.strip():
                        status_code = line[:2].strip()
                        file_path = line[3:].strip()
                        files.append({"status": status_code, "file": file_path})
                return ToolOutput(result={"action": "status", "files": files, "raw": result["output"]})
            return ToolOutput(result={"action": "status", "files": [], "error": result["error"]})

        elif action == "diff":
            result = await self._run_git(["diff", "--stat"], repo_path)
            diff_stat = result.get("output", "")
            diff_result = await self._run_git(["diff"], repo_path, timeout=60)
            return ToolOutput(result={
                "action": "diff",
                "stat": diff_stat,
                "output": diff_result.get("output", "")[:10000],
                "error": result.get("error", ""),
            })

        elif action == "log":
            count = params.get("count", 10)
            result = await self._run_git(
                ["log", f"-{count}", "--oneline", "--decorate"],
                repo_path,
            )
            return ToolOutput(result={
                "action": "log",
                "output": result.get("output", ""),
                "error": result.get("error", ""),
            })

        elif action == "add":
            files = params.get("files", [])
            if not files:
                files = ["."]
            result = await self._run_git(["add"] + files, repo_path)
            return ToolOutput(result={
                "action": "add",
                "files": files,
                "success": result["success"],
                "error": result.get("error", ""),
            })

        elif action == "commit":
            message = params.get("message", "Automated commit")
            files = params.get("files", [])
            if files:
                add_result = await self._run_git(["add"] + files, repo_path)
                if not add_result["success"]:
                    return ToolOutput(result={"action": "commit", "success": False, "error": add_result["error"]})
            result = await self._run_git(["commit", "-m", message], repo_path)
            return ToolOutput(result={
                "action": "commit",
                "message": message,
                "success": result["success"],
                "output": result.get("output", ""),
                "error": result.get("error", ""),
            })

        elif action == "push":
            result = await self._run_git(["push"], repo_path, timeout=60)
            return ToolOutput(result={
                "action": "push",
                "success": result["success"],
                "output": result.get("output", ""),
                "error": result.get("error", ""),
            })

        elif action == "branch":
            branch_name = params.get("branch", "")
            if branch_name:
                result = await self._run_git(["checkout", "-b", branch_name], repo_path)
                return ToolOutput(result={
                    "action": "branch",
                    "branch": branch_name,
                    "success": result["success"],
                    "output": result.get("output", ""),
                    "error": result.get("error", ""),
                })
            else:
                result = await self._run_git(["branch", "-a"], repo_path)
                branches = [
                    line.strip().lstrip("* ")
                    for line in result.get("output", "").split("\n")
                    if line.strip()
                ]
                return ToolOutput(result={
                    "action": "branch",
                    "branches": branches,
                    "output": result.get("output", ""),
                })

        else:
            return ToolOutput(result={}, error=f"Unknown git action: {action}")
