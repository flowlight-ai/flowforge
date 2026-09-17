import ast
import re
from typing import Any, Dict, List

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.linter_tool")


class LinterTool(BaseTool):
    name = "linter_tool"
    description = "代码静态检查：检查代码质量、风格和潜在问题"
    parameters_schema = {
        "type": "object",
        "required": ["code"],
        "properties": {
            "code": {"type": "string", "description": "Source code to lint"},
            "language": {"type": "string", "default": "python", "description": "Programming language"},
            "rule_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Specific rule IDs to check (optional)",
            },
        },
    }
    safety_level = "normal"
    is_concurrency_safe = True

    def _lint_python(self, code: str, rule_ids: List[str] | None = None) -> Dict[str, Any]:
        violations: List[Dict[str, Any]] = []

        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            return {
                "passed": False,
                "violations": [{
                    "rule_id": "syntax_error",
                    "rule_name": "Syntax Error",
                    "description": f"Syntax error at line {e.lineno}: {e.msg}",
                    "severity": "error",
                    "line": e.lineno or 0,
                }],
                "rules_checked": 1,
                "severity_counts": {"error": 1, "warning": 0, "info": 0},
            }

        rules = {
            "no_bare_except": self._check_bare_except,
            "no_mutable_default": self._check_mutable_defaults,
            "no_star_import": self._check_star_imports,
            "no_debug_statements": self._check_debug_statements,
            "max_function_length": self._check_function_length,
            "no_unused_import_hint": self._check_unused_import_hints,
        }

        if rule_ids:
            rules = {k: v for k, v in rules.items() if k in rule_ids}

        severity_counts = {"error": 0, "warning": 0, "info": 0}

        for rule_id, check_fn in rules.items():
            rule_violations = check_fn(code, tree)
            for v in rule_violations:
                v["rule_id"] = rule_id
            violations.extend(rule_violations)

        for v in violations:
            severity = v.get("severity", "warning")
            severity_counts[severity] = severity_counts.get(severity, 0) + 1

        has_errors = severity_counts.get("error", 0) > 0

        return {
            "passed": not has_errors,
            "violations": violations,
            "rules_checked": len(rules),
            "severity_counts": severity_counts,
        }

    def _check_bare_except(self, code: str, tree: ast.AST) -> List[Dict[str, Any]]:
        violations = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ExceptHandler) and node.type is None:
                violations.append({
                    "rule_name": "No Bare Except",
                    "description": "Bare 'except:' catches all exceptions including SystemExit and KeyboardInterrupt",
                    "severity": "warning",
                    "line": node.lineno,
                })
        return violations

    def _check_mutable_defaults(self, code: str, tree: ast.AST) -> List[Dict[str, Any]]:
        violations = []
        mutable_types = (ast.List, ast.Dict, ast.Set)
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for default in node.args.defaults + node.args.kw_defaults:
                    if default and isinstance(default, mutable_types):
                        violations.append({
                            "rule_name": "No Mutable Default Arguments",
                            "description": f"Function '{node.name}' has mutable default argument",
                            "severity": "warning",
                            "line": node.lineno,
                        })
        return violations

    def _check_star_imports(self, code: str, tree: ast.AST) -> List[Dict[str, Any]]:
        violations = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and any(alias.name == "*" for alias in node.names):
                violations.append({
                    "rule_name": "No Star Imports",
                    "description": f"Star import from '{node.module}' pollutes namespace",
                    "severity": "info",
                    "line": node.lineno,
                })
        return violations

    def _check_debug_statements(self, code: str, tree: ast.AST) -> List[Dict[str, Any]]:
        violations = []
        debug_funcs = {"breakpoint", "pdb"}
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                func_name = ""
                if isinstance(node.func, ast.Name):
                    func_name = node.func.id
                elif isinstance(node.func, ast.Attribute):
                    func_name = node.func.attr
                if func_name in debug_funcs:
                    violations.append({
                        "rule_name": "No Debug Statements",
                        "description": f"Debug statement '{func_name}' found",
                        "severity": "warning",
                        "line": node.lineno,
                    })
        return violations

    def _check_function_length(self, code: str, tree: ast.AST) -> List[Dict[str, Any]]:
        violations = []
        max_lines = 50
        lines = code.split("\n")
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                func_lines = node.end_lineno - node.lineno + 1 if hasattr(node, 'end_lineno') else 0
                if func_lines > max_lines:
                    violations.append({
                        "rule_name": "Max Function Length",
                        "description": f"Function '{node.name}' is {func_lines} lines (max {max_lines})",
                        "severity": "info",
                        "line": node.lineno,
                    })
        return violations

    def _check_unused_import_hints(self, code: str, tree: ast.AST) -> List[Dict[str, Any]]:
        violations = []
        imported_names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    name = alias.asname or alias.name
                    imported_names.add((name, node.lineno))
            elif isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    name = alias.asname or alias.name
                    imported_names.add((name, node.lineno))

        used_names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                used_names.add(node.id)
            elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
                used_names.add(node.value.id)

        for name, lineno in imported_names:
            if name not in used_names and name != "*":
                violations.append({
                    "rule_name": "Potentially Unused Import",
                    "description": f"Import '{name}' may be unused",
                    "severity": "info",
                    "line": lineno,
                })
        return violations

    async def execute(self, input: ToolInput) -> ToolOutput:
        params = input.params
        code = params.get("code", "")
        language = params.get("language", "python")
        rule_ids = params.get("rule_ids", None)

        if not code:
            return ToolOutput(result={}, error="No code provided for linting")

        if language == "python":
            result = self._lint_python(code, rule_ids)
        else:
            result = {
                "passed": True,
                "violations": [],
                "rules_checked": 0,
                "severity_counts": {"error": 0, "warning": 0, "info": 0},
                "note": f"Linter for {language} not yet implemented, basic check only",
            }

        try:
            from flowforge.harness.constraints.linter_runner import LinterRunner
            from flowforge.harness.constraints.linter_rules import LinterRules
            from flowforge.core.task_context import TaskContext

            rules = LinterRules()
            runner = LinterRunner(rules)
            ctx = TaskContext(task_id="flowforge-lint", input_data={})
            harness_result = await runner.run(code, ctx, rule_ids=rule_ids)
            if harness_result.get("violations"):
                result.setdefault("harness_violations", harness_result["violations"])
        except ImportError:
            pass
        except Exception as e:
            logger.debug(f"Flowforge linter runner unavailable: {e}")

        return ToolOutput(result=result)
