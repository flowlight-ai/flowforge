"""Python Executor Tool — Python代码执行和测试运行工具.

提供代码执行、测试运行、依赖安装能力。
对标 Claude Code / Codex 的代码执行和测试能力。
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.tools.python_executor")


class PythonExecutorTool(BaseTool):
    """Python执行器 — 支持代码执行、测试运行、包管理."""

    name = "python_executor"
    description = "Python代码执行器：运行代码、执行测试、安装依赖、管理虚拟环境"
    safety_level = "dangerous"
    is_concurrency_safe = False

    parameters_schema = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["execute", "run_tests", "install", "check_syntax", "run_command"],
                "description": "操作类型"
            },
            "code": {"type": "string", "description": "要执行的Python代码（execute操作）"},
            "command": {"type": "string", "description": "要执行的命令（run_command操作）"},
            "test_path": {"type": "string", "description": "测试文件或目录路径（run_tests操作）"},
            "package": {"type": "string", "description": "要安装的包名（install操作）"},
            "working_dir": {"type": "string", "description": "工作目录"},
            "timeout": {"type": "integer", "default": 60, "description": "超时秒数"},
            "env": {"type": "object", "description": "环境变量"},
            "args": {"type": "array", "items": {"type": "string"}, "description": "额外参数"},
        },
        "required": ["action"],
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        action = input.params.get("action")
        try:
            if action == "execute":
                return await self._execute_code(input.params)
            elif action == "run_tests":
                return await self._run_tests(input.params)
            elif action == "install":
                return await self._install_package(input.params)
            elif action == "check_syntax":
                return await self._check_syntax(input.params)
            elif action == "run_command":
                return await self._run_command(input.params)
            else:
                return ToolOutput(error=f"Unknown action: {action}")
        except Exception as e:
            logger.error(f"python_executor error: action={action} error={e}")
            return ToolOutput(error=str(e))

    async def _execute_code(self, params: Dict) -> ToolOutput:
        """执行Python代码."""
        code = params.get("code", "")
        if not code:
            return ToolOutput(error="Missing 'code' parameter")
        working_dir = params.get("working_dir", os.getcwd())
        timeout = params.get("timeout", 60)
        env_vars = params.get("env", {})

        # 写入临时文件执行
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = f.name

        try:
            env = os.environ.copy()
            env.update(env_vars)
            env["PYTHONIOENCODING"] = "utf-8"

            t0 = time.time()
            proc = await asyncio.create_subprocess_exec(
                sys.executable, temp_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=working_dir,
                env=env,
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                proc.kill()
                return ToolOutput(result={
                    "success": False,
                    "error": f"Execution timed out after {timeout}s",
                    "stdout": "",
                    "stderr": "",
                    "return_code": -1,
                    "elapsed_s": timeout,
                })

            elapsed = round(time.time() - t0, 2)
            stdout_str = stdout.decode("utf-8", errors="replace")
            stderr_str = stderr.decode("utf-8", errors="replace")

            return ToolOutput(result={
                "success": proc.returncode == 0,
                "stdout": stdout_str[:10000],
                "stderr": stderr_str[:5000],
                "return_code": proc.returncode,
                "elapsed_s": elapsed,
            })
        finally:
            os.unlink(temp_path)

    async def _run_tests(self, params: Dict) -> ToolOutput:
        """运行pytest测试."""
        test_path = params.get("test_path", ".")
        working_dir = params.get("working_dir", os.getcwd())
        timeout = params.get("timeout", 120)
        extra_args = params.get("args", ["-v", "--tb=short"])

        cmd = [sys.executable, "-m", "pytest", test_path] + extra_args
        return await self._run_subprocess(cmd, working_dir, timeout, params.get("env", {}))

    async def _install_package(self, params: Dict) -> ToolOutput:
        """安装Python包."""
        package = params.get("package", "")
        if not package:
            return ToolOutput(error="Missing 'package' parameter")
        timeout = params.get("timeout", 120)

        cmd = [sys.executable, "-m", "pip", "install", package]
        return await self._run_subprocess(cmd, os.getcwd(), timeout)

    async def _check_syntax(self, params: Dict) -> ToolOutput:
        """检查Python语法."""
        code = params.get("code", "")
        if not code:
            return ToolOutput(error="Missing 'code' parameter")

        import py_compile
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = f.name

        try:
            py_compile.compile(temp_path, doraise=True)
            return ToolOutput(result={"valid": True, "errors": []})
        except py_compile.PyCompileError as e:
            return ToolOutput(result={"valid": False, "errors": [str(e)]})
        finally:
            os.unlink(temp_path)

    async def _run_command(self, params: Dict) -> ToolOutput:
        """运行通用命令."""
        command = params.get("command", "")
        if not command:
            return ToolOutput(error="Missing 'command' parameter")
        working_dir = params.get("working_dir", os.getcwd())
        timeout = params.get("timeout", 60)

        # 安全检查：拦截危险命令
        dangerous = ["rm -rf /", "del /s /q C:\\", "format", "mkfs"]
        if any(d in command for d in dangerous):
            return ToolOutput(error=f"Blocked dangerous command: {command[:50]}")

        cmd = command.split()
        return await self._run_subprocess(cmd, working_dir, timeout, params.get("env", {}))

    async def _run_subprocess(self, cmd: List[str], cwd: str, timeout: int, env_vars: Dict = None) -> ToolOutput:
        """运行子进程的通用方法."""
        env = os.environ.copy()
        if env_vars:
            env.update(env_vars)
        env["PYTHONIOENCODING"] = "utf-8"

        t0 = time.time()
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=env,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            elapsed = round(time.time() - t0, 2)

            stdout_str = stdout.decode("utf-8", errors="replace")
            stderr_str = stderr.decode("utf-8", errors="replace")

            return ToolOutput(result={
                "success": proc.returncode == 0,
                "stdout": stdout_str[:10000],
                "stderr": stderr_str[:5000],
                "return_code": proc.returncode,
                "elapsed_s": elapsed,
                "command": " ".join(cmd),
            })
        except asyncio.TimeoutError:
            proc.kill()
            elapsed = round(time.time() - t0, 2)
            return ToolOutput(result={
                "success": False,
                "error": f"Command timed out after {timeout}s",
                "stdout": "",
                "stderr": "",
                "return_code": -1,
                "elapsed_s": elapsed,
                "command": " ".join(cmd),
            })
        except FileNotFoundError as e:
            return ToolOutput(error=f"Command not found: {cmd[0]} ({e})")
