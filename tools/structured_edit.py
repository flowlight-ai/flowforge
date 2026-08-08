"""StructuredEditTool — 精确结构化代码编辑工具.

对标 Claude Code 的 Edit 工具和 Codex CLI 的 apply_patch，
提供精确、安全、原子性的代码编辑能力。

核心设计原则：
1. 精确匹配：old_string 必须精确匹配文件内容，避免误改
2. 唯一性检查：默认要求 old_string 在文件中唯一，防止批量误改
3. 原子性：multi_edit 先验证所有 old_string 存在，再统一应用
4. 编码保持：自动检测并保持文件原始编码和行尾格式
"""
from __future__ import annotations

import difflib
import re
from pathlib import Path

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.tools.structured_edit")


def _detect_encoding(path: Path) -> str:
    """检测文件编码，默认 utf-8."""
    try:
        raw = path.read_bytes()
        # BOM 检测
        if raw.startswith(b"\xef\xbb\xbf"):
            return "utf-8-sig"
        if raw.startswith(b"\xff\xfe"):
            return "utf-16-le"
        if raw.startswith(b"\xfe\xff"):
            return "utf-16-be"
        # 尝试 utf-8
        raw.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        return "gbk"  # Windows 中文环境常见


def _detect_line_ending(content: str) -> str:
    """检测行尾格式."""
    if "\r\n" in content:
        return "\r\n"
    if "\r" in content:
        return "\r"
    return "\n"


def _normalize_line_endings(text: str, target: str) -> str:
    """将文本行尾统一为目标格式."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if target == "\r\n":
        text = text.replace("\n", "\r\n")
    elif target == "\r":
        text = text.replace("\n", "\r")
    return text


def _count_lines(content: str) -> int:
    """计算文本行数."""
    if not content:
        return 0
    return content.count("\n") + (0 if content.endswith("\n") else 1)


class StructuredEditTool(BaseTool):
    """精确结构化代码编辑工具."""

    name = "structured_edit"
    description = "精确结构化代码编辑：替换、插入、删除、正则替换、补丁应用、多编辑"
    safety_level = "normal"
    is_concurrency_safe = False

    parameters_schema = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "replace", "insert", "delete_lines",
                    "search_replace", "apply_patch", "multi_edit",
                ],
                "description": "操作类型",
            },
            "path": {"type": "string", "description": "文件路径"},
            "old_string": {"type": "string", "description": "要替换的原始文本（replace/multi_edit）"},
            "new_string": {"type": "string", "description": "替换后的新文本（replace/multi_edit）"},
            "replace_all": {"type": "boolean", "default": False, "description": "是否替换所有匹配项"},
            "line_number": {"type": "integer", "description": "目标行号（insert，从1开始）"},
            "content": {"type": "string", "description": "要插入的内容（insert）"},
            "after": {"type": "boolean", "default": True, "description": "在目标行之后插入（insert）"},
            "start_line": {"type": "integer", "description": "起始行号（delete_lines，从1开始）"},
            "end_line": {"type": "integer", "description": "结束行号（delete_lines，包含）"},
            "pattern": {"type": "string", "description": "正则表达式模式（search_replace）"},
            "replacement": {"type": "string", "description": "替换文本（search_replace）"},
            "flags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "正则标志列表（search_replace），如 IGNORECASE, MULTILINE, DOTALL",
            },
            "patch": {"type": "string", "description": "unified diff 补丁字符串（apply_patch）"},
            "edits": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "old_string": {"type": "string"},
                        "new_string": {"type": "string"},
                    },
                    "required": ["old_string", "new_string"],
                },
                "description": "多编辑列表（multi_edit）",
            },
            "expected_hash": {
                "type": "string",
                "description": (
                    "预期的文件内容 SHA256 hash，用于陈旧内容检测。"
                    "若提供，执行前会校验当前文件 hash 是否匹配，"
                    "不匹配则返回 Stale content 错误"
                ),
            },
        },
        "required": ["action", "path"],
    }

    def __init__(self) -> None:
        """初始化，创建文件快照字典用于陈旧内容检测."""
        self._file_snapshots: dict[str, str] = {}

    async def execute(self, input: ToolInput) -> ToolOutput:
        action = input.params.get("action")
        path = input.params.get("path", "")

        # 陈旧内容检测：若提供 expected_hash，校验当前文件 hash 是否匹配
        expected_hash = input.params.get("expected_hash")
        if expected_hash:
            try:
                content, _, _ = self._read_file(path)
                current_hash = self._compute_hash(content)
                if current_hash != expected_hash:
                    return ToolOutput(error=(
                        f"Stale content detected: file '{path}' has been modified since last read. "
                        f"Expected hash {expected_hash[:8]}, got {current_hash[:8]}. "
                        f"Please re-read the file and retry."
                    ))
            except (FileNotFoundError, IsADirectoryError) as e:
                return ToolOutput(error=str(e))

        try:
            if action == "replace":
                return await self._replace(path, input.params)
            elif action == "insert":
                return await self._insert(path, input.params)
            elif action == "delete_lines":
                return await self._delete_lines(path, input.params)
            elif action == "search_replace":
                return await self._search_replace(path, input.params)
            elif action == "apply_patch":
                return await self._apply_patch(path, input.params)
            elif action == "multi_edit":
                return await self._multi_edit(path, input.params)
            else:
                return ToolOutput(error=f"Unknown action: {action}")
        except Exception as e:
            logger.error(f"structured_edit error: action={action} path={path} error={e}")
            return ToolOutput(error=str(e))

    # ── 文件读写辅助 ──────────────────────────────────────────

    def _read_file(self, path: str) -> tuple[str, str, str]:
        """读取文件，返回 (content, encoding, line_ending)."""
        file_path = Path(path)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {path}")
        if file_path.is_dir():
            raise IsADirectoryError(f"Path is a directory: {path}")

        encoding = _detect_encoding(file_path)
        content = file_path.read_text(encoding=encoding)
        line_ending = _detect_line_ending(content)
        return content, encoding, line_ending

    def _write_file(self, path: str, content: str, encoding: str, line_ending: str) -> None:
        """写入文件，保持编码和行尾格式."""
        file_path = Path(path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        content = _normalize_line_endings(content, line_ending)
        file_path.write_text(content, encoding=encoding)

    def _make_diff(self, old_content: str, new_content: str, path: str) -> str:
        """生成 unified diff."""
        old_lines = old_content.splitlines(keepends=True)
        new_lines = new_content.splitlines(keepends=True)
        diff_lines = list(difflib.unified_diff(
            old_lines, new_lines,
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
        ))
        return "".join(diff_lines) if diff_lines else "(no changes)"

    # ── 陈旧内容检测 ──────────────────────────────────────────

    @staticmethod
    def _compute_hash(content: str) -> str:
        """Compute SHA256 hash of file content."""
        import hashlib
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    def _snapshot_file(self, file_path: str) -> str:
        """读取文件内容，计算 SHA256 hash，存入 _file_snapshots，返回 hash."""
        content, _, _ = self._read_file(file_path)
        file_hash = self._compute_hash(content)
        self._file_snapshots[file_path] = file_hash
        return file_hash

    def _check_stale(self, file_path: str) -> bool:
        """比较当前文件 hash 与快照 hash，如果不同则返回 True（陈旧）.

        若文件无快照记录，返回 False（无法判定，视为未陈旧）。
        """
        if file_path not in self._file_snapshots:
            return False
        try:
            content, _, _ = self._read_file(file_path)
            current_hash = self._compute_hash(content)
        except (FileNotFoundError, IsADirectoryError):
            return True  # 文件不存在或变为目录，视为陈旧
        return current_hash != self._file_snapshots[file_path]

    # ── 1. replace — 精确字符串替换 ────────────────────────────

    async def _replace(self, path: str, params: dict) -> ToolOutput:
        """精确字符串替换，对标 Claude Code Edit."""
        old_string = params.get("old_string")
        new_string = params.get("new_string", "")
        replace_all = params.get("replace_all", False)

        if old_string is None:
            return ToolOutput(error="Missing required parameter: old_string")

        content, encoding, line_ending = self._read_file(path)

        # 检查 old_string 是否存在
        count = content.count(old_string)
        if count == 0:
            # 提供相似片段帮助定位
            hint = self._find_similar_hint(content, old_string)
            msg = f"old_string not found in file: {path}"
            if hint:
                msg += f"\nSimilar content found:\n{hint}"
            return ToolOutput(error=msg)

        if count > 1 and not replace_all:
            # 提供所有匹配位置
            positions = self._find_all_positions(content, old_string)
            return ToolOutput(error=(
                f"old_string matches {count} times in {path}. "
                f"Set replace_all=True to replace all, or provide more context to make it unique. "
                f"Match positions (char offset): {positions}"
            ))

        # 执行替换
        if replace_all:
            new_content = content.replace(old_string, new_string)
        else:
            new_content = content.replace(old_string, new_string, 1)

        self._write_file(path, new_content, encoding, line_ending)

        diff = self._make_diff(content, new_content, path)
        logger.info(f"structured_edit replace: {path} ({count} replacement(s))")

        # 记录新的文件快照，供后续操作陈旧检测使用
        new_hash = self._snapshot_file(path)

        return ToolOutput(result={
            "path": path,
            "action": "replace",
            "replacements": count if replace_all else 1,
            "diff": diff[:4000],
            "file_hash": new_hash,
        })

    # ── 2. insert — 在指定行插入内容 ──────────────────────────

    async def _insert(self, path: str, params: dict) -> ToolOutput:
        """在指定行号处插入内容."""
        line_number = params.get("line_number")
        content_to_insert = params.get("content", "")
        after = params.get("after", True)

        if line_number is None:
            return ToolOutput(error="Missing required parameter: line_number")

        file_content, encoding, line_ending = self._read_file(path)
        lines = file_content.splitlines(keepends=True)
        total_lines = len(lines)

        # 处理空文件
        if total_lines == 0 and file_content == "":
            new_content = content_to_insert + line_ending
            self._write_file(path, new_content, encoding, line_ending)
            return ToolOutput(result={
                "path": path,
                "action": "insert",
                "inserted_at": 1,
                "total_lines": 1,
                "diff": self._make_diff(file_content, new_content, path)[:4000],
            })

        # 边界检查
        if line_number < 1:
            line_number = 1
        if line_number > total_lines:
            line_number = total_lines

        # 确保插入内容以行尾结束
        insert_text = content_to_insert
        if insert_text and not insert_text.endswith("\n"):
            insert_text += line_ending

        # 计算插入位置
        insert_idx = line_number if after else line_number - 1

        # 构建新内容
        new_lines = lines[:insert_idx] + [insert_text] + lines[insert_idx:]
        new_content = "".join(new_lines)

        self._write_file(path, new_content, encoding, line_ending)

        actual_line = insert_idx + 1
        diff = self._make_diff(file_content, new_content, path)
        logger.info(f"structured_edit insert: {path} at line {actual_line}")

        return ToolOutput(result={
            "path": path,
            "action": "insert",
            "inserted_at": actual_line,
            "total_lines": len(new_lines),
            "diff": diff[:4000],
        })

    # ── 3. delete_lines — 删除行范围 ──────────────────────────

    async def _delete_lines(self, path: str, params: dict) -> ToolOutput:
        """删除指定行范围."""
        start_line = params.get("start_line")
        end_line = params.get("end_line")

        if start_line is None or end_line is None:
            return ToolOutput(error="Missing required parameters: start_line and end_line")
        if start_line < 1:
            return ToolOutput(error=f"start_line must be >= 1, got {start_line}")
        if end_line < start_line:
            return ToolOutput(error=f"end_line ({end_line}) must be >= start_line ({start_line})")

        content, encoding, line_ending = self._read_file(path)
        lines = content.splitlines(keepends=True)
        total_lines = len(lines)

        if start_line > total_lines:
            return ToolOutput(error=f"start_line ({start_line}) exceeds total lines ({total_lines})")

        # 限制 end_line 不超过文件总行数
        actual_end = min(end_line, total_lines)

        # 提取被删除的内容
        deleted_lines = lines[start_line - 1 : actual_end]
        deleted_content = "".join(deleted_lines)

        # 构建新内容
        new_lines = lines[: start_line - 1] + lines[actual_end:]
        new_content = "".join(new_lines)

        self._write_file(path, new_content, encoding, line_ending)

        diff = self._make_diff(content, new_content, path)
        logger.info(f"structured_edit delete_lines: {path} lines {start_line}-{actual_end}")

        return ToolOutput(result={
            "path": path,
            "action": "delete_lines",
            "deleted_range": [start_line, actual_end],
            "deleted_content": deleted_content[:2000],
            "lines_deleted": actual_end - start_line + 1,
            "remaining_lines": len(new_lines),
            "diff": diff[:4000],
        })

    # ── 4. search_replace — 正则搜索替换 ─────────────────────

    async def _search_replace(self, path: str, params: dict) -> ToolOutput:
        """正则表达式搜索替换."""
        pattern = params.get("pattern")
        replacement = params.get("replacement", "")
        flag_names = params.get("flags", [])

        if not pattern:
            return ToolOutput(error="Missing required parameter: pattern")

        # 编译正则标志
        flags = 0
        flag_map = {
            "IGNORECASE": re.IGNORECASE,
            "I": re.IGNORECASE,
            "MULTILINE": re.MULTILINE,
            "M": re.MULTILINE,
            "DOTALL": re.DOTALL,
            "S": re.DOTALL,
            "VERBOSE": re.VERBOSE,
            "X": re.VERBOSE,
        }
        for f_name in flag_names:
            f_upper = f_name.upper()
            if f_upper in flag_map:
                flags |= flag_map[f_upper]
            else:
                return ToolOutput(error=f"Unknown regex flag: {f_name}")

        try:
            regex = re.compile(pattern, flags)
        except re.error as e:
            return ToolOutput(error=f"Invalid regex pattern: {e}")

        content, encoding, line_ending = self._read_file(path)

        # 执行替换
        new_content, match_count = regex.subn(replacement, content)

        if match_count == 0:
            return ToolOutput(result={
                "path": path,
                "action": "search_replace",
                "matches": 0,
                "message": "Pattern not found, no changes made",
            })

        self._write_file(path, new_content, encoding, line_ending)

        diff = self._make_diff(content, new_content, path)
        logger.info(f"structured_edit search_replace: {path} ({match_count} match(es))")

        # 记录新的文件快照，供后续操作陈旧检测使用
        new_hash = self._snapshot_file(path)

        return ToolOutput(result={
            "path": path,
            "action": "search_replace",
            "matches": match_count,
            "diff": diff[:4000],
            "file_hash": new_hash,
        })

    # ── 5. apply_patch — 应用 unified diff 补丁 ───────────────

    async def _apply_patch(self, path: str, params: dict) -> ToolOutput:
        """应用 unified diff 补丁，对标 Codex CLI apply_patch."""
        patch_text = params.get("patch", "")

        if not patch_text:
            return ToolOutput(error="Missing required parameter: patch")

        content, encoding, line_ending = self._read_file(path)

        try:
            new_content = self._apply_unified_diff(content, patch_text, path)
        except PatchError as e:
            return ToolOutput(error=f"Patch apply failed: {e}")

        self._write_file(path, new_content, encoding, line_ending)

        diff = self._make_diff(content, new_content, path)
        logger.info(f"structured_edit apply_patch: {path}")

        return ToolOutput(result={
            "path": path,
            "action": "apply_patch",
            "diff": diff[:4000],
        })

    def _apply_unified_diff(self, content: str, patch: str, path: str) -> str:
        """解析并应用 unified diff.

        支持标准 unified diff 格式：
          --- a/file.py
          +++ b/file.py
          @@ -start,count +start,count @@
           context line
          -removed line
          +added line
        """
        lines = content.splitlines(keepends=True)
        patch_lines = patch.splitlines(keepends=True)

        # 解析 hunk
        hunks = self._parse_hunks(patch_lines)
        if not hunks:
            raise PatchError("No valid hunks found in patch")

        # 从后往前应用，避免行号偏移
        hunks.sort(key=lambda h: h["old_start"], reverse=True)

        for hunk in hunks:
            old_start = hunk["old_start"] - 1  # 转为0索引
            old_count = hunk["old_count"]
            context = hunk["context"]
            removed = hunk["removed"]
            added = hunk["added"]

            # 验证上下文行匹配
            context_and_removed = context + removed
            expected_lines = [l.rstrip("\r\n") + "\n" for l in context_and_removed]
            actual_lines = lines[old_start : old_start + len(expected_lines)]
            actual_stripped = [l.rstrip("\r\n") + "\n" for l in actual_lines]

            if actual_stripped != expected_lines:
                # 尝试模糊匹配：忽略空白差异
                mismatch_detail = self._context_mismatch_detail(
                    expected_lines, actual_lines, old_start
                )
                raise PatchError(
                    f"Context mismatch at line {old_start + 1}: {mismatch_detail}"
                )

            # 替换：移除旧行，插入新行
            added_lines = [l.rstrip("\r\n") + "\n" for l in added]
            lines[old_start : old_start + len(expected_lines)] = added_lines

        return "".join(lines)

    def _parse_hunks(self, patch_lines: list[str]) -> list[dict]:
        """解析 unified diff 中的 hunk."""
        hunks = []
        i = 0

        # 跳过头部（---, +++ 等）
        while i < len(patch_lines):
            line = patch_lines[i].rstrip("\r\n")
            if line.startswith("@@"):
                break
            i += 1

        while i < len(patch_lines):
            line = patch_lines[i].rstrip("\r\n")
            if not line.startswith("@@"):
                i += 1
                continue

            # 解析 @@ -old_start,old_count +new_start,new_count @@
            match = re.match(
                r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@",
                line,
            )
            if not match:
                i += 1
                continue

            old_start = int(match.group(1))
            old_count = int(match.group(2)) if match.group(2) is not None else 1
            new_start = int(match.group(3))
            new_count = int(match.group(4)) if match.group(4) is not None else 1

            context = []
            removed = []
            added = []

            i += 1
            while i < len(patch_lines):
                pline = patch_lines[i].rstrip("\r\n")
                if pline.startswith("@@"):
                    break
                if pline.startswith("---") and i + 1 < len(patch_lines) and patch_lines[i + 1].rstrip("\r\n").startswith("+++"):
                    break
                if pline.startswith(" "):
                    context.append(pline[1:])
                elif pline.startswith("-"):
                    removed.append(pline[1:])
                elif pline.startswith("+"):
                    added.append(pline[1:])
                elif pline == "":
                    # 空行可能是上下文行（diff 中空行不带前缀空格的情况）
                    context.append("")
                i += 1

            hunks.append({
                "old_start": old_start,
                "old_count": old_count,
                "new_start": new_start,
                "new_count": new_count,
                "context": context,
                "removed": removed,
                "added": added,
            })

        return hunks

    def _context_mismatch_detail(
        self, expected: list[str], actual: list[str], start: int
    ) -> str:
        """生成上下文不匹配的详细信息."""
        details = []
        for i, (exp, act) in enumerate(zip(expected, actual)):
            if exp.rstrip("\r\n") != act.rstrip("\r\n"):
                details.append(
                    f"  line {start + i + 1}: expected {exp.rstrip()!r}, got {act.rstrip()!r}"
                )
        if not details:
            details.append(f"  length mismatch: expected {len(expected)} lines, got {len(actual)}")
        return "\n".join(details[:5])

    # ── 6. multi_edit — 原子性多编辑 ──────────────────────────

    async def _multi_edit(self, path: str, params: dict) -> ToolOutput:
        """原子性多编辑：先验证所有 old_string 存在，再统一应用."""
        edits = params.get("edits", [])

        if not edits:
            return ToolOutput(error="Missing required parameter: edits (non-empty list)")

        # 验证每个 edit 的结构
        for i, edit in enumerate(edits):
            if "old_string" not in edit or "new_string" not in edit:
                return ToolOutput(error=f"Edit #{i + 1} missing old_string or new_string")

        content, encoding, line_ending = self._read_file(path)

        # 阶段1：验证所有 old_string 存在且唯一
        # 陈旧内容检测：若提供 expected_hash，先校验文件 hash 是否匹配
        expected_hash = params.get("expected_hash")
        if expected_hash:
            current_hash = self._compute_hash(content)
            if current_hash != expected_hash:
                return ToolOutput(error=(
                    f"Stale content detected: file '{path}' has been modified since last read. "
                    f"Expected hash {expected_hash[:8]}, got {current_hash[:8]}. "
                    f"Please re-read the file and retry."
                ))

        validation_errors = []
        for i, edit in enumerate(edits):
            old_string = edit["old_string"]
            count = content.count(old_string)
            if count == 0:
                validation_errors.append(f"Edit #{i + 1}: old_string not found")
            elif count > 1:
                validation_errors.append(
                    f"Edit #{i + 1}: old_string matches {count} times (not unique)"
                )

        if validation_errors:
            return ToolOutput(error=(
                "Multi-edit validation failed:\n" +
                "\n".join(validation_errors)
            ))

        # 阶段2：按位置从后往前应用，避免偏移
        positions = []
        for i, edit in enumerate(edits):
            old_string = edit["old_string"]
            idx = content.find(old_string)
            positions.append((idx, i))

        # 按位置降序排列，从后往前替换
        positions.sort(key=lambda x: x[0], reverse=True)

        new_content = content
        for _, edit_idx in positions:
            edit = edits[edit_idx]
            old_string = edit["old_string"]
            new_string = edit["new_string"]
            new_content = new_content.replace(old_string, new_string, 1)

        self._write_file(path, new_content, encoding, line_ending)

        diff = self._make_diff(content, new_content, path)
        logger.info(f"structured_edit multi_edit: {path} ({len(edits)} edits)")

        # 记录新的文件快照，供后续操作陈旧检测使用
        new_hash = self._snapshot_file(path)

        return ToolOutput(result={
            "path": path,
            "action": "multi_edit",
            "edits_applied": len(edits),
            "diff": diff[:4000],
            "file_hash": new_hash,
        })

    # ── 辅助方法 ──────────────────────────────────────────────

    def _find_similar_hint(self, content: str, target: str, max_hints: int = 3) -> str:
        """查找与 target 相似的文本片段，帮助用户定位."""
        target_lines = target.strip().splitlines()
        if not target_lines:
            return ""

        first_line = target_lines[0].strip()
        if not first_line:
            return ""

        content_lines = content.splitlines()
        candidates = []

        for i, line in enumerate(content_lines):
            ratio = difflib.SequenceMatcher(None, first_line, line.strip()).ratio()
            if ratio > 0.5:
                start = max(0, i - 1)
                end = min(len(content_lines), i + len(target_lines) + 1)
                snippet = "\n".join(
                    f"  L{j + start + 1}: {content_lines[j + start]}"
                    for j in range(end - start)
                )
                candidates.append((ratio, snippet))

        candidates.sort(key=lambda x: x[0], reverse=True)
        return "\n".join(c[1] for c in candidates[:max_hints])

    def _find_all_positions(self, content: str, target: str) -> list[int]:
        """查找 target 在 content 中所有出现的字符偏移位置."""
        positions = []
        start = 0
        while True:
            idx = content.find(target, start)
            if idx == -1:
                break
            positions.append(idx)
            start = idx + 1
        return positions


class PatchError(Exception):
    """补丁应用错误."""
    pass
