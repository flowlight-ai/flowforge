"""FlowForge 代码质量工具 — Lint检查、静态分析、复杂度度量。"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput


class CodeQualityTool(BaseTool):
    name: str = "code_quality"
    description: str = "Execute lint (ruff/flake8), static analysis, and complexity measurement"
    parameters_schema: dict[str, Any] = {
        "type": "object",
        "required": ["action"],
        "properties": {
            "action": {
                "type": "string",
                "enum": ["lint", "analyze", "complexity"],
            },
            "files": {"type": "array", "items": {"type": "string"}},
            "config": {"type": "object"},
            "linter": {"type": "string"},
            "cwd": {"type": "string"},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        action: str = input.params.get("action", "")

        if action == "lint":
            return await self._lint(input.params)
        elif action == "analyze":
            return await self._analyze(input.params)
        elif action == "complexity":
            return await self._complexity(input.params)
        else:
            return ToolOutput(
                result={"success": False},
                error=f"Unknown action: {action}. Supported: lint, analyze, complexity",
            )

    async def _lint(self, params: dict[str, Any]) -> ToolOutput:
        linter: str = params.get("linter", "ruff")
        files: list[str] = params.get("files", ["."])
        cwd: str = params.get("cwd", ".")
        config: dict[str, Any] = params.get("config", {})

        cmd: list[str] = [linter]
        if linter == "ruff":
            cmd.extend(["check", "--output-format=json"])
            config_path: str | None = config.get("config_path")
            if config_path:
                cmd.extend(["--config", config_path])
        elif linter == "flake8":
            cmd.extend(["--format=json"])
            max_line_length: int | None = config.get("max_line_length")
            if max_line_length:
                cmd.extend(["--max-line-length", str(max_line_length)])

        cmd.extend(files)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            issues: list[dict[str, Any]] = []
            raw_output: str = stdout.decode("utf-8", errors="replace")

            if linter == "ruff" and raw_output.strip():
                try:
                    issues = json.loads(raw_output)
                except json.JSONDecodeError:
                    issues = self._parse_text_output(raw_output)
            elif linter == "flake8" and raw_output.strip():
                try:
                    issues = json.loads(raw_output)
                except json.JSONDecodeError:
                    issues = self._parse_text_output(raw_output)
            else:
                issues = self._parse_text_output(raw_output)

            score: float = max(0.0, 1.0 - len(issues) * 0.02)

            return ToolOutput(result={
                "success": True,
                "linter": linter,
                "score": round(score, 4),
                "issue_count": len(issues),
                "issues": issues[:100],
                "return_code": proc.returncode or 0,
            })
        except FileNotFoundError:
            return ToolOutput(
                result={"success": False},
                error=f"Linter '{linter}' not found. Install it first.",
            )
        except Exception as e:
            return ToolOutput(result={"success": False}, error=str(e))

    async def _analyze(self, params: dict[str, Any]) -> ToolOutput:
        files: list[str] = params.get("files", ["."])
        cwd: str = params.get("cwd", ".")

        cmd: list[str] = ["mypy", "--output=json"]
        cmd.extend(files)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            raw_output: str = stdout.decode("utf-8", errors="replace")

            issues: list[dict[str, Any]] = self._parse_text_output(raw_output)
            error_count: int = sum(1 for i in issues if "error" in i.get("raw", "").lower())

            return ToolOutput(result={
                "success": proc.returncode == 0,
                "analyzer": "mypy",
                "total_issues": len(issues),
                "error_count": error_count,
                "issues": issues[:100],
                "return_code": proc.returncode or 0,
            })
        except FileNotFoundError:
            return ToolOutput(
                result={"success": False},
                error="mypy not found. Install it first.",
            )
        except Exception as e:
            return ToolOutput(result={"success": False}, error=str(e))

    async def _complexity(self, params: dict[str, Any]) -> ToolOutput:
        files: list[str] = params.get("files", ["."])
        cwd: str = params.get("cwd", ".")

        cmd: list[str] = ["radon", "cc", "-j"]
        cmd.extend(files)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            raw_output: str = stdout.decode("utf-8", errors="replace")

            results: dict[str, Any] = {}
            if raw_output.strip():
                try:
                    results = json.loads(raw_output)
                except json.JSONDecodeError:
                    results = {"raw": raw_output}

            summary: dict[str, int] = self._summarize_complexity(results)

            return ToolOutput(result={
                "success": True,
                "analyzer": "radon",
                "summary": summary,
                "details": results,
            })
        except FileNotFoundError:
            return ToolOutput(
                result={"success": False},
                error="radon not found. Install it first.",
            )
        except Exception as e:
            return ToolOutput(result={"success": False}, error=str(e))

    def _parse_text_output(self, output: str) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []
        for line in output.strip().splitlines():
            if line.strip():
                issues.append({"raw": line.strip()})
        return issues

    def _summarize_complexity(self, results: dict[str, Any]) -> dict[str, int]:
        summary: dict[str, int] = {
            "A_simple": 0, "B_moderate": 0, "C_complex": 0,
            "D_difficult": 0, "E_very_difficult": 0, "F_unmaintainable": 0,
        }
        for _filename, blocks in results.items():
            if isinstance(blocks, list):
                for block in blocks:
                    if isinstance(block, dict):
                        rank: str = block.get("rank", "")
                        key: str = f"{rank}_simple" if rank == "A" else f"{rank}_moderate" if rank == "B" else f"{rank}_complex" if rank == "C" else f"{rank}_difficult" if rank == "D" else f"{rank}_very_difficult" if rank == "E" else f"{rank}_unmaintainable" if rank == "F" else ""
                        if key in summary:
                            summary[key] += 1
        return summary
