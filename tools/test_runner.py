import asyncio
import os
import re
import tempfile
import json
from typing import Any, Dict

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.test_runner")


class TestRunnerTool(BaseTool):
    name = "test_runner"
    description = "测试运行器：执行pytest测试并解析结果"
    parameters_schema = {
        "type": "object",
        "required": [],
        "properties": {
            "test_path": {"type": "string", "description": "Path to test file or directory"},
            "test_code": {"type": "string", "description": "Test code to execute (creates temp file)"},
            "source_code": {"type": "string", "description": "Source code for the module under test"},
            "language": {"type": "string", "default": "python", "description": "Programming language"},
            "framework": {"type": "string", "default": "pytest", "description": "Test framework"},
            "timeout": {"type": "integer", "default": 60, "description": "Test execution timeout in seconds"},
            "extra_args": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Extra pytest arguments",
            },
        },
    }
    safety_level = "dangerous"
    is_concurrency_safe = False

    def _parse_pytest_output(self, stdout: str, stderr: str) -> Dict[str, Any]:
        passed = 0
        failed = 0
        errors = 0
        skipped = 0
        warnings = 0
        failures: list[Dict[str, str]] = []

        summary_match = re.search(
            r"(\d+) passed", stdout
        )
        if summary_match:
            passed = int(summary_match.group(1))

        failed_match = re.search(r"(\d+) failed", stdout)
        if failed_match:
            failed = int(failed_match.group(1))

        error_match = re.search(r"(\d+) error", stdout)
        if error_match:
            errors = int(error_match.group(1))

        skipped_match = re.search(r"(\d+) skipped", stdout)
        if skipped_match:
            skipped = int(skipped_match.group(1))

        warning_match = re.search(r"(\d+) warning", stdout)
        if warning_match:
            warnings = int(warning_match.group(1))

        failure_blocks = re.findall(
            r"_{3,}\s*(.*?)\s*_{3,}\n(.*?)(?=_{3,}|=+ short test summary|=+ FAILURES)",
            stdout,
            re.DOTALL,
        )
        for test_name, trace in failure_blocks[:10]:
            failures.append({
                "test": test_name.strip()[:200],
                "traceback": trace.strip()[:2000],
            })

        if not failure_blocks and failed > 0:
            short_summary = re.search(
                r"FAILED (.*?)(?:\n|$)", stdout
            )
            if short_summary:
                failures.append({
                    "test": short_summary.group(1).strip()[:200],
                    "traceback": "",
                })

        return {
            "passed": passed,
            "failed": failed,
            "errors": errors,
            "skipped": skipped,
            "warnings": warnings,
            "failures": failures,
            "status": "passed" if failed == 0 and errors == 0 else "failed",
        }

    async def _run_pytest_inline(
        self,
        test_code: str,
        source_code: str,
        timeout: int,
        extra_args: list[str] | None = None,
    ) -> Dict[str, Any]:
        with tempfile.TemporaryDirectory(prefix="flowforge_test_") as tmpdir:
            if source_code:
                src_path = os.path.join(tmpdir, "module_under_test.py")
                with open(src_path, "w", encoding="utf-8") as f:
                    f.write(source_code)

            test_path = os.path.join(tmpdir, "test_module.py")
            with open(test_path, "w", encoding="utf-8") as f:
                f.write(test_code)

            args = [
                "python", "-m", "pytest",
                test_path,
                "-v",
                "--tb=short",
                "--no-header",
                "-q",
            ]
            if extra_args:
                args.extend(extra_args)

            try:
                proc = await asyncio.create_subprocess_exec(
                    *args,
                    cwd=tmpdir,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env={**os.environ, "PYTHONPATH": tmpdir},
                )
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
                stdout_str = stdout.decode("utf-8", errors="replace")
                stderr_str = stderr.decode("utf-8", errors="replace")

                result = self._parse_pytest_output(stdout_str, stderr_str)
                result["raw_stdout"] = stdout_str[:5000]
                result["raw_stderr"] = stderr_str[:2000]
                return result

            except asyncio.TimeoutError:
                return {
                    "passed": 0,
                    "failed": 0,
                    "errors": 1,
                    "skipped": 0,
                    "warnings": 0,
                    "failures": [{"test": "timeout", "traceback": f"Test execution timed out after {timeout}s"}],
                    "status": "timeout",
                }
            except FileNotFoundError:
                return {
                    "passed": 0,
                    "failed": 0,
                    "errors": 1,
                    "skipped": 0,
                    "warnings": 0,
                    "failures": [{"test": "pytest_not_found", "traceback": "pytest not installed or not in PATH"}],
                    "status": "error",
                }

    async def _run_pytest_path(
        self,
        test_path: str,
        timeout: int,
        extra_args: list[str] | None = None,
    ) -> Dict[str, Any]:
        args = [
            "python", "-m", "pytest",
            test_path,
            "-v",
            "--tb=short",
            "--no-header",
            "-q",
        ]
        if extra_args:
            args.extend(extra_args)

        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            stdout_str = stdout.decode("utf-8", errors="replace")
            stderr_str = stderr.decode("utf-8", errors="replace")

            result = self._parse_pytest_output(stdout_str, stderr_str)
            result["raw_stdout"] = stdout_str[:5000]
            result["raw_stderr"] = stderr_str[:2000]
            return result

        except asyncio.TimeoutError:
            return {
                "passed": 0, "failed": 0, "errors": 1, "skipped": 0,
                "warnings": 0,
                "failures": [{"test": "timeout", "traceback": f"Test timed out after {timeout}s"}],
                "status": "timeout",
            }
        except FileNotFoundError:
            return {
                "passed": 0, "failed": 0, "errors": 1, "skipped": 0,
                "warnings": 0,
                "failures": [{"test": "pytest_not_found", "traceback": "pytest not installed"}],
                "status": "error",
            }

    async def execute(self, input: ToolInput) -> ToolOutput:
        params = input.params
        test_path = params.get("test_path", "")
        test_code = params.get("test_code", "")
        source_code = params.get("source_code", "")
        language = params.get("language", "python")
        framework = params.get("framework", "pytest")
        timeout = params.get("timeout", 60)
        extra_args = params.get("extra_args", None)

        if language != "python":
            return ToolOutput(
                result={"status": "unsupported", "language": language},
                error=f"Test runner for {language} not yet implemented",
            )

        if framework != "pytest":
            return ToolOutput(
                result={"status": "unsupported", "framework": framework},
                error=f"Test framework {framework} not yet implemented",
            )

        if test_path and os.path.exists(test_path):
            result = await self._run_pytest_path(test_path, timeout, extra_args)
        elif test_code:
            result = await self._run_pytest_inline(test_code, source_code, timeout, extra_args)
        else:
            return ToolOutput(result={}, error="Either test_path or test_code must be provided")

        return ToolOutput(result=result)
