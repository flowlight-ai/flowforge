"""LSPTool — 轻量级代码导航与分析工具.

对标 OpenCode 的 LSP 工具，提供代码导航、诊断和重构能力。
Phase 1 使用 Python AST 实现，Phase 2 可接入真实 LSP 服务器。
"""
from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any, Optional

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.tools.lsp")


class LSPTool(BaseTool):
    """轻量级代码导航与分析工具."""

    name = "lsp"
    description = "代码导航与分析：诊断、定义跳转、引用查找、符号列表、重命名"
    safety_level = "normal"
    is_concurrency_safe = True

    parameters_schema = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["diagnostics", "definitions", "references", "hover", "symbols", "rename"],
                "description": "操作类型",
            },
            "path": {"type": "string", "description": "文件路径"},
            "line": {"type": "integer", "description": "行号（0-based）"},
            "column": {"type": "integer", "description": "列号（0-based）"},
            "severity": {
                "type": "string",
                "enum": ["error", "warning", "info"],
                "description": "诊断严重级别过滤",
            },
            "new_name": {"type": "string", "description": "新名称（rename 操作）"},
        },
        "required": ["action", "path"],
    }

    # ------------------------------------------------------------------
    # 主入口
    # ------------------------------------------------------------------

    async def execute(self, input: ToolInput) -> ToolOutput:
        action: str = input.params.get("action", "")
        path_str: str = input.params.get("path", "")

        file_path = Path(path_str)
        if not file_path.exists():
            return ToolOutput(result={"success": False}, error=f"File not found: {path_str}")
        if not file_path.is_file():
            return ToolOutput(result={"success": False}, error=f"Path is not a file: {path_str}")

        try:
            source = file_path.read_text(encoding="utf-8")
        except OSError as e:
            return ToolOutput(result={"success": False}, error=f"Cannot read file: {e}")

        handlers = {
            "diagnostics": self._diagnostics,
            "definitions": self._definitions,
            "references": self._references,
            "hover": self._hover,
            "symbols": self._symbols,
            "rename": self._rename,
        }

        handler = handlers.get(action)
        if handler is None:
            return ToolOutput(
                result={"success": False},
                error=f"Unknown action: {action}. Supported: {', '.join(handlers.keys())}",
            )

        try:
            result = handler(source, file_path, input.params)
            return ToolOutput(result=result)
        except Exception as e:
            logger.error(f"LSP action '{action}' failed: {e}")
            return ToolOutput(result={"success": False}, error=str(e))

    # ------------------------------------------------------------------
    # diagnostics — 语法错误 + pyflakes 风格检查
    # ------------------------------------------------------------------

    def _diagnostics(self, source: str, file_path: Path, params: dict[str, Any]) -> dict[str, Any]:
        severity_filter: Optional[str] = params.get("severity")
        diagnostics: list[dict[str, Any]] = []

        # 1. 语法错误 — ast.parse
        try:
            tree = ast.parse(source, filename=str(file_path))
        except SyntaxError as e:
            diagnostics.append({
                "line": (e.lineno or 1) - 1,
                "column": (e.offset or 1) - 1,
                "end_line": (e.end_lineno or e.lineno or 1) - 1,
                "end_column": (e.end_offset or e.offset or 1) - 1,
                "message": e.msg,
                "severity": "error",
            })
            # 语法错误时无法继续后续检查
            return self._filter_diagnostics(diagnostics, severity_filter)

        # 2. 未定义名称检查（pyflakes 风格）
        diagnostics.extend(self._check_undefined_names(source, tree))

        # 3. 常见问题检查
        diagnostics.extend(self._check_common_issues(source, tree))

        return self._filter_diagnostics(diagnostics, severity_filter)

    def _check_undefined_names(self, source: str, tree: ast.AST) -> list[dict[str, Any]]:
        """检测可能未定义的名称（pyflakes 风格简化版）."""
        builtins = {
            "False", "None", "True", "and", "as", "assert", "async", "await",
            "break", "class", "continue", "def", "del", "elif", "else", "except",
            "finally", "for", "from", "global", "if", "import", "in", "is",
            "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try",
            "while", "with", "yield",
            "__name__", "__file__", "__doc__", "__package__", "__spec__",
            "__build_class__", "__import__",
            "print", "len", "range", "int", "str", "float", "list", "dict",
            "set", "tuple", "bool", "bytes", "type", "super", "property",
            "classmethod", "staticmethod", "object", "Exception", "BaseException",
            "ValueError", "TypeError", "KeyError", "IndexError", "AttributeError",
            "RuntimeError", "StopIteration", "NotImplementedError", "OSError",
            "FileNotFoundError", "IsADirectoryError", "PermissionError",
            "AssertionError", "ImportError", "ModuleNotFoundError",
            "ArithmeticError", "ZeroDivisionError", "OverflowError",
            "UnicodeError", "UnicodeDecodeError", "UnicodeEncodeError",
            "MemoryError", "RecursionError", "SystemError", "SystemExit",
            "KeyboardInterrupt", "GeneratorExit", "StopAsyncIteration",
            "BufferError", "EOFError", "ReferenceError",
            "enumerate", "zip", "map", "filter", "sorted", "reversed",
            "isinstance", "issubclass", "hasattr", "getattr", "setattr",
            "delattr", "callable", "dir", "vars", "locals", "globals",
            "id", "hash", "repr", "format", "abs", "divmod", "pow", "round",
            "min", "max", "sum", "any", "all", "bin", "hex", "oct", "chr", "ord",
            "open", "input", "iter", "next", "slice", "complex",
            "frozenset", "bytearray", "memoryview", "dict_keys", "dict_values",
            "dict_items", "reversed", "NotImplemented", "Ellipsis",
            "__builtins__", "exit", "quit", "help", "license", "credits",
            "copyright", "ascii", "breakpoint",
        }

        # 收集定义的名称
        defined: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) or isinstance(node, ast.AsyncFunctionDef):
                defined.add(node.name)
            elif isinstance(node, ast.ClassDef):
                defined.add(node.name)
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        defined.add(target.id)
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                defined.add(node.target.id)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    defined.add(alias.asname or alias.name.split(".")[0])
            elif isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    defined.add(alias.asname or alias.name.split(".")[0])
            elif isinstance(node, ast.For):
                if isinstance(node.target, ast.Name):
                    defined.add(node.target.id)
            elif isinstance(node, ast.With):
                for item in node.items:
                    if item.optional_vars and isinstance(item.optional_vars, ast.Name):
                        defined.add(item.optional_vars.id)
            # 函数参数
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for arg in node.args.args + node.args.posonlyargs + node.args.kwonlyargs:
                    defined.add(arg.arg)
                if node.args.vararg:
                    defined.add(node.args.vararg.arg)
                if node.args.kwarg:
                    defined.add(node.args.kwarg.arg)

        # 收集使用的名称
        used: dict[str, int] = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                if node.id not in used:
                    used[node.id] = node.lineno

        diagnostics: list[dict[str, Any]] = []
        for name, lineno in used.items():
            if name not in defined and name not in builtins:
                diagnostics.append({
                    "line": lineno - 1,
                    "column": 0,
                    "message": f"Undefined name '{name}'",
                    "severity": "warning",
                })

        return diagnostics

    def _check_common_issues(self, source: str, tree: ast.AST) -> list[dict[str, Any]]:
        """常见代码问题检查."""
        diagnostics: list[dict[str, Any]] = []

        for node in ast.walk(tree):
            # 裸 except
            if isinstance(node, ast.ExceptHandler) and node.type is None:
                diagnostics.append({
                    "line": node.lineno - 1,
                    "column": 0,
                    "message": "Bare 'except:' catches all exceptions including SystemExit and KeyboardInterrupt",
                    "severity": "warning",
                })
            # 可变默认参数
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                mutable_types = (ast.List, ast.Dict, ast.Set)
                for default in node.args.defaults + node.args.kw_defaults:
                    if default and isinstance(default, mutable_types):
                        diagnostics.append({
                            "line": node.lineno - 1,
                            "column": 0,
                            "message": f"Function '{node.name}' has mutable default argument",
                            "severity": "warning",
                        })
            # star import
            if isinstance(node, ast.ImportFrom):
                if any(alias.name == "*" for alias in node.names):
                    diagnostics.append({
                        "line": node.lineno - 1,
                        "column": 0,
                        "message": f"Star import from '{node.module}' pollutes namespace",
                        "severity": "info",
                    })

        return diagnostics

    def _filter_diagnostics(
        self, diagnostics: list[dict[str, Any]], severity_filter: Optional[str]
    ) -> dict[str, Any]:
        if severity_filter:
            diagnostics = [d for d in diagnostics if d["severity"] == severity_filter]
        return {
            "success": True,
            "diagnostics": diagnostics,
            "count": len(diagnostics),
        }

    # ------------------------------------------------------------------
    # definitions — 跳转到定义
    # ------------------------------------------------------------------

    def _definitions(self, source: str, file_path: Path, params: dict[str, Any]) -> dict[str, Any]:
        line: int = params.get("line", 0)
        column: int = params.get("column", 0)

        # 获取光标处的符号名
        symbol = self._get_symbol_at_position(source, line, column)
        if not symbol:
            return {"success": True, "definitions": [], "message": "No symbol at position"}

        # 在当前文件中查找定义
        definitions: list[dict[str, Any]] = []
        try:
            tree = ast.parse(source, filename=str(file_path))
        except SyntaxError:
            return {"success": True, "definitions": [], "message": "Cannot parse file"}

        for node in ast.walk(tree):
            node_name = None
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                node_name = node.name
            elif isinstance(node, ast.ClassDef):
                node_name = node.name
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id == symbol:
                        definitions.append({
                            "path": str(file_path),
                            "line": node.lineno - 1,
                            "column": 0,
                            "name": symbol,
                            "kind": "variable",
                        })
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                if node.target.id == symbol:
                    definitions.append({
                        "path": str(file_path),
                        "line": node.lineno - 1,
                        "column": 0,
                        "name": symbol,
                        "kind": "variable",
                    })

            if node_name == symbol:
                kind = "function" if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) else "class"
                definitions.append({
                    "path": str(file_path),
                    "line": node.lineno - 1,
                    "column": node.col_offset,
                    "name": symbol,
                    "kind": kind,
                })

        # 如果当前文件未找到，在项目目录中 grep 搜索
        if not definitions:
            definitions = self._search_definition_in_project(symbol, file_path)

        return {"success": True, "definitions": definitions, "count": len(definitions)}

    def _search_definition_in_project(self, symbol: str, current_file: Path) -> list[dict[str, Any]]:
        """在项目目录中搜索符号定义（grep 方式）."""
        project_root = self._find_project_root(current_file)
        if not project_root:
            return []

        definitions: list[dict[str, Any]] = []
        # 匹配 def/class/变量赋值模式
        patterns = [
            (rf"^\s*(?:async\s+)?def\s+{re.escape(symbol)}\s*\(", "function"),
            (rf"^\s*class\s+{re.escape(symbol)}\s*[:\(]", "class"),
            (rf"^{re.escape(symbol)}\s*=", "variable"),
        ]

        for py_file in project_root.rglob("*.py"):
            if py_file.stat().st_size > 512 * 1024:  # 跳过大文件
                continue
            try:
                lines = py_file.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            for i, line_text in enumerate(lines):
                for pattern, kind in patterns:
                    if re.search(pattern, line_text):
                        definitions.append({
                            "path": str(py_file),
                            "line": i,
                            "column": 0,
                            "name": symbol,
                            "kind": kind,
                        })
                        break  # 一行只匹配一次

            if len(definitions) >= 20:  # 限制结果数量
                break

        return definitions

    # ------------------------------------------------------------------
    # references — 查找所有引用
    # ------------------------------------------------------------------

    def _references(self, source: str, file_path: Path, params: dict[str, Any]) -> dict[str, Any]:
        line: int = params.get("line", 0)
        column: int = params.get("column", 0)

        symbol = self._get_symbol_at_position(source, line, column)
        if not symbol:
            return {"success": True, "references": [], "message": "No symbol at position"}

        references: list[dict[str, Any]] = []
        project_root = self._find_project_root(file_path)

        search_files = [file_path]
        if project_root:
            search_files = list(project_root.rglob("*.py"))
            search_files = [f for f in search_files if f.stat().st_size <= 512 * 1024]

        for py_file in search_files:
            try:
                lines = py_file.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            for i, line_text in enumerate(lines):
                # 使用单词边界匹配
                if re.search(rf"\b{re.escape(symbol)}\b", line_text):
                    col = line_text.find(symbol)
                    references.append({
                        "path": str(py_file),
                        "line": i,
                        "column": max(col, 0),
                        "text": line_text.strip(),
                    })
            if len(references) >= 50:  # 限制结果数量
                break

        return {"success": True, "references": references, "count": len(references)}

    # ------------------------------------------------------------------
    # hover — 获取悬停信息
    # ------------------------------------------------------------------

    def _hover(self, source: str, file_path: Path, params: dict[str, Any]) -> dict[str, Any]:
        line: int = params.get("line", 0)
        column: int = params.get("column", 0)

        symbol = self._get_symbol_at_position(source, line, column)
        if not symbol:
            return {"success": True, "hover": None, "message": "No symbol at position"}

        try:
            tree = ast.parse(source, filename=str(file_path))
        except SyntaxError:
            return {"success": True, "hover": None, "message": "Cannot parse file"}

        # 查找符号定义信息
        for node in ast.walk(tree):
            node_name = None
            kind = ""
            detail = ""

            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == symbol:
                kind = "function"
                args_str = self._format_function_args(node)
                prefix = "async " if isinstance(node, ast.AsyncFunctionDef) else ""
                detail = f"{prefix}def {symbol}({args_str})"
                # 提取 docstring
                docstring = ast.get_docstring(node)
                if docstring:
                    detail += f"\n\n{docstring}"
            elif isinstance(node, ast.ClassDef) and node.name == symbol:
                kind = "class"
                bases = ", ".join(self._get_name_from_node(b) for b in node.bases)
                detail = f"class {symbol}"
                if bases:
                    detail += f"({bases})"
                docstring = ast.get_docstring(node)
                if docstring:
                    detail += f"\n\n{docstring}"
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id == symbol:
                        kind = "variable"
                        detail = f"{symbol} = {ast.unparse(node.value)[:200]}"
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                if node.target.id == symbol:
                    kind = "variable"
                    annotation = ast.unparse(node.annotation) if node.annotation else ""
                    detail = f"{symbol}: {annotation}"

            if kind:
                return {
                    "success": True,
                    "hover": {
                        "name": symbol,
                        "kind": kind,
                        "detail": detail,
                        "line": node.lineno - 1,
                        "column": node.col_offset,
                    },
                }

        # 未找到定义，返回基本信息
        line_text = source.splitlines()[line] if line < len(source.splitlines()) else ""
        return {
            "success": True,
            "hover": {
                "name": symbol,
                "kind": "unknown",
                "detail": line_text.strip(),
                "line": line,
                "column": column,
            },
        }

    # ------------------------------------------------------------------
    # symbols — 获取文档符号
    # ------------------------------------------------------------------

    def _symbols(self, source: str, file_path: Path, params: dict[str, Any]) -> dict[str, Any]:
        try:
            tree = ast.parse(source, filename=str(file_path))
        except SyntaxError as e:
            return {
                "success": False,
                "symbols": [],
                "error": f"Syntax error at line {e.lineno}: {e.msg}",
            }

        symbols: list[dict[str, Any]] = []

        for node in ast.iter_child_nodes(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                symbols.append(self._function_symbol(node))
            elif isinstance(node, ast.ClassDef):
                class_sym = self._class_symbol(node)
                symbols.append(class_sym)
                # 类内方法
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        symbols.append(self._function_symbol(item, parent=node.name))
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        symbols.append({
                            "name": target.id,
                            "kind": "variable",
                            "line": node.lineno - 1,
                            "column": node.col_offset,
                            "end_line": (node.end_lineno or node.lineno) - 1,
                        })
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                symbols.append({
                    "name": node.target.id,
                    "kind": "variable",
                    "line": node.lineno - 1,
                    "column": node.col_offset,
                    "end_line": (node.end_lineno or node.lineno) - 1,
                })

        return {"success": True, "symbols": symbols, "count": len(symbols)}

    def _function_symbol(self, node: ast.FunctionDef | ast.AsyncFunctionDef, parent: str = "") -> dict[str, Any]:
        kind = "method" if parent else "function"
        args_str = self._format_function_args(node)
        prefix = "async " if isinstance(node, ast.AsyncFunctionDef) else ""
        return {
            "name": node.name,
            "kind": kind,
            "detail": f"{prefix}def {node.name}({args_str})",
            "line": node.lineno - 1,
            "column": node.col_offset,
            "end_line": (node.end_lineno or node.lineno) - 1,
            "parent": parent or None,
        }

    def _class_symbol(self, node: ast.ClassDef) -> dict[str, Any]:
        bases = ", ".join(self._get_name_from_node(b) for b in node.bases)
        detail = f"class {node.name}"
        if bases:
            detail += f"({bases})"
        return {
            "name": node.name,
            "kind": "class",
            "detail": detail,
            "line": node.lineno - 1,
            "column": node.col_offset,
            "end_line": (node.end_lineno or node.lineno) - 1,
        }

    # ------------------------------------------------------------------
    # rename — 重命名符号
    # ------------------------------------------------------------------

    def _rename(self, source: str, file_path: Path, params: dict[str, Any]) -> dict[str, Any]:
        line: int = params.get("line", 0)
        column: int = params.get("column", 0)
        new_name: str = params.get("new_name", "")

        if not new_name:
            return {"success": False, "error": "new_name is required for rename action"}
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", new_name):
            return {"success": False, "error": f"Invalid identifier: '{new_name}'"}

        symbol = self._get_symbol_at_position(source, line, column)
        if not symbol:
            return {"success": True, "changes": [], "message": "No symbol at position"}

        # 在当前文件中执行替换
        lines = source.splitlines()
        changed_lines: list[int] = []
        new_lines: list[str] = []

        for i, line_text in enumerate(lines):
            new_text = re.sub(rf"\b{re.escape(symbol)}\b", new_name, line_text)
            if new_text != line_text:
                changed_lines.append(i)
            new_lines.append(new_text)

        new_source = "\n".join(new_lines)

        # 验证替换后语法正确
        try:
            ast.parse(new_source, filename=str(file_path))
        except SyntaxError as e:
            return {
                "success": False,
                "error": f"Rename would introduce syntax error at line {e.lineno}: {e.msg}",
            }

        # 写回文件
        try:
            file_path.write_text(new_source, encoding="utf-8")
        except OSError as e:
            return {"success": False, "error": f"Cannot write file: {e}"}

        # 在项目其他文件中也搜索并替换
        project_changes: list[dict[str, Any]] = []
        project_root = self._find_project_root(file_path)
        if project_root:
            project_changes = self._rename_in_project(symbol, new_name, project_root, exclude=file_path)

        changes = [{"path": str(file_path), "lines_changed": changed_lines}]
        changes.extend(project_changes)

        return {
            "success": True,
            "old_name": symbol,
            "new_name": new_name,
            "changes": changes,
        }

    def _rename_in_project(
        self, old_name: str, new_name: str, project_root: Path, exclude: Path
    ) -> list[dict[str, Any]]:
        """在项目其他文件中执行重命名替换."""
        changes: list[dict[str, Any]] = []

        for py_file in project_root.rglob("*.py"):
            if py_file == exclude or py_file.stat().st_size > 512 * 1024:
                continue
            try:
                source = py_file.read_text(encoding="utf-8")
            except OSError:
                continue

            lines = source.splitlines()
            changed_lines: list[int] = []
            new_lines: list[str] = []

            for i, line_text in enumerate(lines):
                new_text = re.sub(rf"\b{re.escape(old_name)}\b", new_name, line_text)
                if new_text != line_text:
                    changed_lines.append(i)
                new_lines.append(new_text)

            if changed_lines:
                new_source = "\n".join(new_lines)
                try:
                    ast.parse(new_source, filename=str(py_file))
                    py_file.write_text(new_source, encoding="utf-8")
                    changes.append({"path": str(py_file), "lines_changed": changed_lines})
                except SyntaxError:
                    # 跳过会导致语法错误的文件
                    logger.warning(f"Rename skipped {py_file}: would introduce syntax error")

            if len(changes) >= 20:  # 限制修改文件数
                break

        return changes

    # ------------------------------------------------------------------
    # 辅助方法
    # ------------------------------------------------------------------

    def _get_symbol_at_position(self, source: str, line: int, column: int) -> str:
        """获取源码指定位置的符号名."""
        lines = source.splitlines()
        if line < 0 or line >= len(lines):
            return ""
        line_text = lines[line]
        if column < 0 or column >= len(line_text):
            return ""

        # 从位置向左右扩展，提取完整标识符
        start = column
        end = column + 1

        while start > 0 and (line_text[start - 1].isalnum() or line_text[start - 1] == "_"):
            start -= 1
        while end < len(line_text) and (line_text[end].isalnum() or line_text[end] == "_"):
            end += 1

        return line_text[start:end]

    def _find_project_root(self, file_path: Path) -> Optional[Path]:
        """向上查找项目根目录（包含 pyproject.toml / setup.py / .git 的目录）."""
        current = file_path.parent
        markers = ["pyproject.toml", "setup.py", "setup.cfg", ".git"]
        for _ in range(20):  # 最多向上 20 层
            for marker in markers:
                if (current / marker).exists():
                    return current
            parent = current.parent
            if parent == current:
                break
            current = parent
        return None

    def _format_function_args(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
        """格式化函数参数列表."""
        args: list[str] = []
        for arg in node.args.args:
            s = arg.arg
            if arg.annotation:
                s += f": {ast.unparse(arg.annotation)}"
            args.append(s)
        if node.args.vararg:
            args.append(f"*{node.args.vararg.arg}")
        for arg in node.args.kwonlyargs:
            s = arg.arg
            if arg.annotation:
                s += f": {ast.unparse(arg.annotation)}"
            args.append(s)
        if node.args.kwarg:
            args.append(f"**{node.args.kwarg.arg}")
        return ", ".join(args)

    def _get_name_from_node(self, node: ast.AST) -> str:
        """从 AST 节点提取名称."""
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return self._get_name_from_node(node.value) + "." + node.attr
        if isinstance(node, ast.Constant):
            return repr(node.value)
        return ast.unparse(node) if hasattr(ast, "unparse") else "..."
