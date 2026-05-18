import asyncio
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput


class ShellCommandTool(BaseTool):
    name = "shell_command"
    description = "执行白名单内的安全 Shell 命令"
    parameters_schema = {
        "type": "object",
        "required": ["command"],
        "properties": {
            "command": {"type": "string"},
            "timeout": {"type": "integer", "default": 30},
        }
    }

    ALLOWED_COMMANDS = {
        "ls", "cat", "head", "tail", "grep", "find", "wc", "echo", "pwd",
        "dir", "type", "python", "pip", "node", "npm",
        "git",
    }

    BLOCKED_PATTERNS = [
        "rm ", "del ", "format ", "shutdown", "reboot",
        "mkfs", "dd ", "> /dev/", "chmod", "chown",
        "sudo ", "runas ", "net user", "net localgroup",
        "taskkill", "reg ", "regedit",
    ]

    def _is_allowed(self, command: str) -> tuple[bool, str]:
        stripped = command.strip()
        if not stripped:
            return False, "Empty command"

        for pattern in self.BLOCKED_PATTERNS:
            if pattern in stripped.lower():
                return False, f"Blocked pattern detected: {pattern.strip()}"

        base = stripped.split()[0].lower()
        base_name = base.replace(".exe", "").replace(".cmd", "").replace(".bat", "")

        if base_name == "git":
            parts = stripped.split()
            if len(parts) >= 2 and parts[1].lower() in ("status", "log", "diff", "branch", "remote", "tag"):
                return True, ""
            return False, f"Git sub-command not allowed: {parts[1] if len(parts) >= 2 else 'unknown'}"

        if base_name in self.ALLOWED_COMMANDS:
            return True, ""

        return False, f"Command not in whitelist: {base_name}"

    async def execute(self, input: ToolInput) -> ToolOutput:
        command = input.params.get("command", "")
        timeout = input.params.get("timeout", 30)

        allowed, reason = self._is_allowed(command)
        if not allowed:
            return ToolOutput(result={}, error=f"Command rejected: {reason}")

        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                return ToolOutput(result={}, error=f"Command timed out after {timeout}s")

            stdout = stdout_bytes.decode("utf-8", errors="replace")
            stderr = stderr_bytes.decode("utf-8", errors="replace")
            return ToolOutput(result={
                "stdout": stdout,
                "stderr": stderr,
                "exit_code": proc.returncode,
            })
        except Exception as e:
            return ToolOutput(result={}, error=str(e))
