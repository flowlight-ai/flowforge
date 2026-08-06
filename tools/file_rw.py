"""File Read/Write Tool — 文件读写工具.

提供文件读取、写入、搜索、监控能力，是编码Agent的核心工具。
对标 Claude Code / Codex 的文件操作能力。
"""
from __future__ import annotations

import difflib
import re
from pathlib import Path

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.tools.file_rw")


class FileReadWriteTool(BaseTool):
    """文件读写工具 — 支持读取、写入、搜索、差异比较."""

    name = "file_rw"
    description = "文件读写工具：读取、写入、搜索、创建、删除文件和目录"
    safety_level = "normal"
    is_concurrency_safe = False

    parameters_schema = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["read", "write", "append", "search", "list", "mkdir", "delete", "diff", "exists", "copy", "move"],
                "description": "操作类型"
            },
            "path": {"type": "string", "description": "文件或目录路径"},
            "content": {"type": "string", "description": "写入内容（write/append操作）"},
            "pattern": {"type": "string", "description": "搜索模式（search操作，支持正则）"},
            "encoding": {"type": "string", "default": "utf-8", "description": "文件编码"},
            "recursive": {"type": "boolean", "default": False, "description": "递归操作"},
            "source": {"type": "string", "description": "源路径（copy/move操作）"},
            "destination": {"type": "string", "description": "目标路径（copy/move操作）"},
            "original": {"type": "string", "description": "原始内容（diff操作）"},
            "modified": {"type": "string", "description": "修改后内容（diff操作）"},
            "line_start": {"type": "integer", "description": "起始行号（read操作，从1开始）"},
            "line_end": {"type": "integer", "description": "结束行号（read操作）"},
        },
        "required": ["action", "path"],
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        action = input.params.get("action")
        path = input.params.get("path", "")

        try:
            if action == "read":
                return await self._read(path, input.params)
            elif action == "write":
                return await self._write(path, input.params)
            elif action == "append":
                return await self._append(path, input.params)
            elif action == "search":
                return await self._search(path, input.params)
            elif action == "list":
                return await self._list(path, input.params)
            elif action == "mkdir":
                return await self._mkdir(path, input.params)
            elif action == "delete":
                return await self._delete(path, input.params)
            elif action == "diff":
                return await self._diff(path, input.params)
            elif action == "exists":
                return await self._exists(path, input.params)
            elif action == "copy":
                return await self._copy(path, input.params)
            elif action == "move":
                return await self._move(path, input.params)
            else:
                return ToolOutput(error=f"Unknown action: {action}")
        except Exception as e:
            logger.error(f"file_rw error: action={action} path={path} error={e}")
            return ToolOutput(error=str(e))

    async def _read(self, path: str, params: dict) -> ToolOutput:
        """读取文件内容."""
        file_path = Path(path)
        if not file_path.exists():
            return ToolOutput(error=f"File not found: {path}")
        if file_path.is_dir():
            return ToolOutput(error=f"Path is a directory, use 'list' action: {path}")

        encoding = params.get("encoding", "utf-8")
        line_start = params.get("line_start")
        line_end = params.get("line_end")

        try:
            with open(file_path, encoding=encoding, errors="replace") as f:
                lines = f.readlines()

            total_lines = len(lines)
            if line_start is not None:
                start = max(1, line_start) - 1
                lines = lines[start:]
            if line_end is not None:
                end = line_end - (line_start - 1 if line_start else 1)
                lines = lines[:end]

            # 添加行号
            content = ""
            offset = line_start if line_start else 1
            for i, line in enumerate(lines):
                content += f"{offset + i:6d} | {line}"

            return ToolOutput(result={
                "content": content,
                "total_lines": total_lines,
                "path": str(file_path),
                "size_bytes": file_path.stat().st_size,
            })
        except Exception as e:
            return ToolOutput(error=f"Read error: {e}")

    async def _write(self, path: str, params: dict) -> ToolOutput:
        """写入文件内容（覆盖）."""
        content = params.get("content", "")
        encoding = params.get("encoding", "utf-8")
        file_path = Path(path)

        # 安全检查：不写入敏感路径
        if self._is_dangerous_path(file_path):
            return ToolOutput(error=f"Write blocked: dangerous path {path}")

        # 确保父目录存在
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # 如果文件已存在，先读取旧内容用于diff
        old_content = ""
        if file_path.exists():
            try:
                old_content = file_path.read_text(encoding=encoding)
            except Exception:
                pass

        with open(file_path, "w", encoding=encoding) as f:
            f.write(content)

        # 生成diff
        diff_lines = list(difflib.unified_diff(
            old_content.splitlines(keepends=True),
            content.splitlines(keepends=True),
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
        ))
        diff = "".join(diff_lines) if diff_lines else "(new file)"

        logger.info(f"file_rw: wrote {len(content)} bytes to {path}")
        return ToolOutput(result={
            "path": str(file_path),
            "bytes_written": len(content.encode(encoding)),
            "lines_written": content.count("\n") + 1,
            "diff": diff[:2000],  # 限制diff大小
        })

    async def _append(self, path: str, params: dict) -> ToolOutput:
        """追加内容到文件."""
        content = params.get("content", "")
        encoding = params.get("encoding", "utf-8")
        file_path = Path(path)
        file_path.parent.mkdir(parents=True, exist_ok=True)

        with open(file_path, "a", encoding=encoding) as f:
            f.write(content)

        return ToolOutput(result={
            "path": str(file_path),
            "bytes_appended": len(content.encode(encoding)),
        })

    async def _search(self, path: str, params: dict) -> ToolOutput:
        """搜索文件内容（支持正则）."""
        pattern = params.get("pattern", "")
        file_path = Path(path)
        recursive = params.get("recursive", True)

        if not pattern:
            return ToolOutput(error="Missing 'pattern' parameter")

        matches = []
        files_searched = 0

        if file_path.is_file():
            files = [file_path]
        elif file_path.is_dir():
            glob_pattern = "**/*" if recursive else "*"
            files = [f for f in file_path.glob(glob_pattern) if f.is_file()]
        else:
            return ToolOutput(error=f"Path not found: {path}")

        try:
            regex = re.compile(pattern, re.IGNORECASE)
        except re.error as e:
            return ToolOutput(error=f"Invalid regex pattern: {e}")

        max_matches = 100
        for f in files:
            if len(matches) >= max_matches:
                break
            files_searched += 1
            try:
                text = f.read_text(encoding="utf-8", errors="replace")
                for i, line in enumerate(text.splitlines(), 1):
                    if regex.search(line):
                        matches.append({
                            "file": str(f),
                            "line": i,
                            "content": line.strip()[:200],
                        })
                        if len(matches) >= max_matches:
                            break
            except Exception:
                continue

        return ToolOutput(result={
            "pattern": pattern,
            "matches": matches,
            "total_matches": len(matches),
            "files_searched": files_searched,
        })

    async def _list(self, path: str, params: dict) -> ToolOutput:
        """列出目录内容."""
        file_path = Path(path)
        if not file_path.is_dir():
            return ToolOutput(error=f"Not a directory: {path}")

        recursive = params.get("recursive", False)
        entries = []
        glob_pattern = "**/*" if recursive else "*"

        for entry in sorted(file_path.glob(glob_pattern)):
            rel = entry.relative_to(file_path)
            entries.append({
                "name": str(rel),
                "type": "dir" if entry.is_dir() else "file",
                "size": entry.stat().st_size if entry.is_file() else 0,
            })

        return ToolOutput(result={
            "path": str(file_path),
            "entries": entries[:500],  # 限制返回数量
            "total": len(entries),
        })

    async def _mkdir(self, path: str, params: dict) -> ToolOutput:
        """创建目录."""
        file_path = Path(path)
        file_path.mkdir(parents=True, exist_ok=True)
        return ToolOutput(result={"path": str(file_path), "created": True})

    async def _delete(self, path: str, params: dict) -> ToolOutput:
        """删除文件或目录."""
        file_path = Path(path)
        if self._is_dangerous_path(file_path):
            return ToolOutput(error=f"Delete blocked: dangerous path {path}")
        if file_path.is_dir():
            import shutil
            shutil.rmtree(file_path)
        elif file_path.is_file():
            file_path.unlink()
        else:
            return ToolOutput(error=f"Path not found: {path}")
        return ToolOutput(result={"path": str(file_path), "deleted": True})

    async def _diff(self, path: str, params: dict) -> ToolOutput:
        """比较内容差异."""
        original = params.get("original", "")
        modified = params.get("modified", "")
        diff_lines = list(difflib.unified_diff(
            original.splitlines(keepends=True),
            modified.splitlines(keepends=True),
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
        ))
        return ToolOutput(result={
            "diff": "".join(diff_lines) or "(no differences)",
            "has_changes": bool(diff_lines),
        })

    async def _exists(self, path: str, params: dict) -> ToolOutput:
        """检查路径是否存在."""
        file_path = Path(path)
        return ToolOutput(result={
            "path": str(file_path),
            "exists": file_path.exists(),
            "is_file": file_path.is_file() if file_path.exists() else False,
            "is_dir": file_path.is_dir() if file_path.exists() else False,
            "size": file_path.stat().st_size if file_path.is_file() else 0,
        })

    async def _copy(self, path: str, params: dict) -> ToolOutput:
        """复制文件."""
        import shutil
        source = Path(params.get("source", path))
        destination = Path(params.get("destination", ""))
        if not source.exists():
            return ToolOutput(error=f"Source not found: {source}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        return ToolOutput(result={"source": str(source), "destination": str(destination)})

    async def _move(self, path: str, params: dict) -> ToolOutput:
        """移动文件."""
        import shutil
        source = Path(params.get("source", path))
        destination = Path(params.get("destination", ""))
        if not source.exists():
            return ToolOutput(error=f"Source not found: {source}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(destination))
        return ToolOutput(result={"source": str(source), "destination": str(destination)})

    def _is_dangerous_path(self, path: Path) -> bool:
        """检查是否为危险路径."""
        dangerous_patterns = ["/etc/", "/sys/", "/proc/", "C:\\Windows\\", ".ssh/", ".gnupg/"]
        path_str = str(path)
        return any(p in path_str for p in dangerous_patterns)
