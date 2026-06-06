import asyncio
import json
import os
import re
from typing import Any, Dict, List

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.code_search")


class CodeSearchTool(BaseTool):
    name = "code_search"
    description = "代码搜索：在代码库中搜索代码模式和定义"
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string", "description": "Search pattern (regex supported)"},
            "path": {"type": "string", "description": "Root directory to search (defaults to CWD)"},
            "file_pattern": {"type": "string", "description": "Glob pattern for files (e.g. '*.py')"},
            "max_results": {"type": "integer", "default": 20, "description": "Maximum number of results"},
            "context_lines": {"type": "integer", "default": 2, "description": "Lines of context around match"},
            "case_sensitive": {"type": "boolean", "default": False, "description": "Case sensitive search"},
        },
    }
    safety_level = "normal"
    is_concurrency_safe = True

    SKIP_DIRS = {
        ".git", "__pycache__", "node_modules", ".venv", "venv",
        ".mypy_cache", ".pytest_cache", ".ruff_cache", ".eggs",
        "dist", "build", "*.egg-info", ".next", ".idea", ".vscode",
    }

    SKIP_EXTENSIONS = {
        ".pyc", ".pyo", ".so", ".dll", ".exe", ".bin",
        ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
        ".woff", ".woff2", ".ttf", ".eot",
        ".zip", ".tar", ".gz", ".rar",
        ".db", ".sqlite3",
    }

    async def _search_with_ripgrep(self, query: str, path: str, **kwargs) -> List[Dict[str, Any]] | None:
        try:
            args = ["rg", "--json"]
            if not kwargs.get("case_sensitive", False):
                args.append("-i")
            if kwargs.get("file_pattern"):
                args.extend(["--glob", kwargs["file_pattern"]])
            context = kwargs.get("context_lines", 2)
            args.extend(["-C", str(context)])
            args.extend(["--max-count", str(kwargs.get("max_results", 20))])
            args.append(query)
            args.append(path)

            proc = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)

            matches = []
            current_match = None
            for line in stdout.decode("utf-8", errors="replace").split("\n"):
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue

                if entry.get("type") == "match":
                    data = entry.get("data", {})
                    current_match = {
                        "file": data.get("path", {}).get("text", ""),
                        "line_number": data.get("line_number", 0),
                        "content": data.get("lines", {}).get("text", "").strip(),
                        "context_before": [],
                        "context_after": [],
                    }
                    matches.append(current_match)
                elif entry.get("type") == "context" and current_match is not None:
                    data = entry.get("data", {})
                    context_line = data.get("lines", {}).get("text", "").strip()
                    if data.get("line_number", 0) < current_match["line_number"]:
                        current_match["context_before"].append(context_line)
                    else:
                        current_match["context_after"].append(context_line)

            return matches[:kwargs.get("max_results", 20)]

        except (FileNotFoundError, asyncio.TimeoutError):
            return None

    def _search_with_python(self, query: str, path: str, **kwargs) -> List[Dict[str, Any]]:
        matches: List[Dict[str, Any]] = []
        max_results = kwargs.get("max_results", 20)
        context_lines = kwargs.get("context_lines", 2)
        case_sensitive = kwargs.get("case_sensitive", False)
        file_pattern = kwargs.get("file_pattern", "")
        flags = 0 if case_sensitive else re.IGNORECASE

        try:
            pattern = re.compile(query, flags)
        except re.error:
            pattern = re.compile(re.escape(query), flags)

        if file_pattern:
            file_regex = re.compile(file_pattern.replace("*", ".*").replace("?", "."))
        else:
            file_regex = None

        for root, dirs, files in os.walk(path):
            dirs[:] = [d for d in dirs if d not in self.SKIP_DIRS and not d.startswith(".")]

            for filename in files:
                _, ext = os.path.splitext(filename)
                if ext in self.SKIP_EXTENSIONS:
                    continue
                if file_regex and not file_regex.search(filename):
                    continue

                filepath = os.path.join(root, filename)
                try:
                    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                        lines = f.readlines()
                except (OSError, PermissionError):
                    continue

                for i, line in enumerate(lines):
                    if pattern.search(line):
                        before = [lines[j].rstrip() for j in range(max(0, i - context_lines), i)]
                        after = [lines[j].rstrip() for j in range(i + 1, min(len(lines), i + 1 + context_lines))]
                        rel_path = os.path.relpath(filepath, path)
                        matches.append({
                            "file": rel_path,
                            "line_number": i + 1,
                            "content": line.rstrip(),
                            "context_before": before,
                            "context_after": after,
                        })
                        if len(matches) >= max_results:
                            return matches

        return matches

    async def execute(self, input: ToolInput) -> ToolOutput:
        params = input.params
        query = params.get("query", "")
        path = params.get("path", os.getcwd())
        max_results = params.get("max_results", 20)
        file_pattern = params.get("file_pattern", "")
        context_lines = params.get("context_lines", 2)
        case_sensitive = params.get("case_sensitive", False)

        if not query:
            return ToolOutput(result={}, error="No search query provided")

        if not os.path.isdir(path):
            return ToolOutput(result={}, error=f"Search path does not exist: {path}")

        kwargs = {
            "max_results": max_results,
            "file_pattern": file_pattern,
            "context_lines": context_lines,
            "case_sensitive": case_sensitive,
        }

        matches = await self._search_with_ripgrep(query, path, **kwargs)

        if matches is None:
            matches = self._search_with_python(query, path, **kwargs)

        return ToolOutput(result={
            "query": query,
            "path": path,
            "matches": matches,
            "total": len(matches),
        })
