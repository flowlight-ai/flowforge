"""代码执行沙箱 — 进程隔离 + 资源限制 + AST静态安全检查。

在子进程中执行不可信代码，通过 AST 检查拦截危险导入，
通过进程超时和输出截断防止资源滥用。
"""

from __future__ import annotations

import ast
import asyncio
import os
import tempfile
from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("sandbox")


class SandboxConfig(BaseModel):
    """沙箱配置。"""
    timeout_seconds: int = Field(default=60, description="执行超时（秒）")
    max_memory_mb: int = Field(default=512, description="最大内存（MB）")
    max_output_bytes: int = Field(default=65536, description="最大输出字节数")
    allowed_imports: list[str] = Field(default_factory=list, description="允许的导入模块")
    blocked_imports: list[str] = Field(
        default_factory=lambda: ["os.system", "subprocess", "shutil.rmtree"],
        description="禁止的导入模块",
    )
    network_enabled: bool = Field(default=False, description="是否允许网络访问")


class SandboxResult(BaseModel):
    """沙箱执行结果。"""
    success: bool
    output: str = ""
    error: str = ""
    return_code: int | None = None
    safety_check: dict[str, Any] = Field(default_factory=dict)


class CodeSandbox:
    """代码执行沙箱。

    执行流程：
    1. AST 静态安全检查（拦截危险导入）
    2. 写入临时文件
    3. 子进程执行（超时控制）
    4. 截断输出，返回结果
    """

    def __init__(self, config: SandboxConfig | None = None) -> None:
        self.config = config or SandboxConfig()

    async def execute(self, code: str, language: str = "python") -> SandboxResult:
        """在沙箱中执行代码。

        Args:
            code: 要执行的代码
            language: 编程语言（目前仅支持 python）

        Returns:
            SandboxResult 包含执行结果、输出和错误信息
        """
        logger.info(f"[sandbox] executing {language} code, length={len(code)}")

        # 1. AST 静态安全检查
        safety = self._static_check(code)
        if not safety["safe"]:
            logger.warning(f"[sandbox] safety check failed: {safety['reason']}")
            return SandboxResult(
                success=False,
                error=safety["reason"],
                safety_check=safety,
            )

        # 2. 写入临时文件
        with tempfile.NamedTemporaryFile(
            suffix=".py", mode="w", delete=False, encoding="utf-8"
        ) as f:
            f.write(code)
            temp_path = f.name

        try:
            # 3. 子进程执行
            proc = await asyncio.create_subprocess_exec(
                "python", temp_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=self.config.timeout_seconds,
                )
            except TimeoutError:
                proc.kill()
                await proc.wait()
                logger.warning(f"[sandbox] execution timed out after {self.config.timeout_seconds}s")
                return SandboxResult(
                    success=False,
                    error=f"Execution timed out after {self.config.timeout_seconds}s",
                    return_code=-1,
                    safety_check=safety,
                )

            # 4. 截断输出
            output = stdout.decode("utf-8", errors="replace")[:self.config.max_output_bytes]
            error = stderr.decode("utf-8", errors="replace")[:self.config.max_output_bytes]

            result = SandboxResult(
                success=proc.returncode == 0,
                output=output,
                error=error,
                return_code=proc.returncode,
                safety_check=safety,
            )

            logger.info(
                f"[sandbox] execution finished: success={result.success}, "
                f"return_code={result.return_code}, output_len={len(output)}"
            )
            return result

        finally:
            try:
                os.unlink(temp_path)
            except OSError:
                pass

    def _static_check(self, code: str) -> dict[str, Any]:
        """AST 静态安全检查。

        检查是否存在禁止的导入语句。
        """
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            return {"safe": False, "reason": f"Syntax error: {e}"}

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if any(alias.name.startswith(b) for b in self.config.blocked_imports):
                        return {
                            "safe": False,
                            "reason": f"Blocked import: {alias.name}",
                        }
            elif isinstance(node, ast.ImportFrom):
                if node.module and any(
                    node.module.startswith(b) for b in self.config.blocked_imports
                ):
                    return {
                        "safe": False,
                        "reason": f"Blocked import from: {node.module}",
                    }

        # 检查危险函数调用
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                func_name = self._get_call_name(node)
                if func_name in ("exec", "eval", "compile", "__import__"):
                    return {
                        "safe": False,
                        "reason": f"Blocked function call: {func_name}",
                    }

        return {"safe": True, "reason": ""}

    def _get_call_name(self, node: ast.Call) -> str:
        """获取函数调用的名称。"""
        if isinstance(node.func, ast.Name):
            return node.func.id
        if isinstance(node.func, ast.Attribute):
            return node.func.attr
        return ""
