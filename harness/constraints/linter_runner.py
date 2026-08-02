"""LinterRunner — Execution engine for harness linter rules.

Runs the registered linter rules against source code and collects
violations. Supports both pattern-based and function-based rule checks.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

from flowforge.core.tracing import get_logger
from flowforge.core.task_context import TaskContext
from flowforge.harness.constraints.linter_rules import LinterRule, LinterRules, Severity

logger = get_logger("harness.linter_runner")


class LinterRunner:
    """Executes linter rules against source code and collects violations.

    The LinterRunner iterates over enabled rules from a LinterRules
    registry and applies each rule's check (pattern-based or function-based)
    to the provided source code. Results are aggregated into a validation
    report.

    Attributes:
        rules: The LinterRules registry to use for checks.
    """

    def __init__(self, rules: LinterRules | None = None) -> None:
        self.rules = rules or LinterRules()

    async def run(
        self,
        source_code: str,
        ctx: TaskContext,
        *,
        file_path: str | None = None,
        rule_ids: List[str] | None = None,
    ) -> Dict[str, Any]:
        """Run linter checks against source code.

        Applies all enabled rules (or a specified subset) to the source
        code and collects any violations.

        Args:
            source_code: The Python source code to lint.
            ctx: The current TaskContext.
            file_path: Optional file path for context in violation reports.
            rule_ids: Optional list of specific rule IDs to run. If ``None``,
                all enabled rules are run.

        Returns:
            A dictionary with ``passed`` (bool), ``violations`` (list),
            ``rules_checked`` (int), and ``severity_counts`` (dict).
        """
        enabled = self.rules.get_enabled_rules()
        if rule_ids:
            enabled = [r for r in enabled if r.id in rule_ids]

        all_violations: List[Dict[str, Any]] = []
        severity_counts: Dict[str, int] = {s.value: 0 for s in Severity}

        for rule in enabled:
            violations = self._check_rule(rule, source_code)
            for v in violations:
                v["file_path"] = file_path
                v["severity"] = rule.severity.value
                severity_counts[rule.severity.value] += 1
            all_violations.extend(violations)

        has_errors = severity_counts.get(Severity.ERROR.value, 0) > 0

        result: Dict[str, Any] = {
            "passed": not has_errors,
            "violations": all_violations,
            "rules_checked": len(enabled),
            "severity_counts": severity_counts,
        }

        if all_violations:
            logger.info(
                "Linter violations found",
                task_id=ctx.task_id,
                total=len(all_violations),
                errors=severity_counts.get(Severity.ERROR.value, 0),
                warnings=severity_counts.get(Severity.WARNING.value, 0),
            )
            ctx.state["linter_violations"] = ctx.state.get("linter_violations", [])
            ctx.state["linter_violations"].extend(all_violations)

        return result

    def _check_rule(
        self,
        rule: LinterRule,
        source_code: str,
    ) -> List[Dict[str, Any]]:
        """Apply a single rule to source code.

        Uses the rule's ``check_fn`` if available, otherwise falls back
        to pattern-based matching.

        Args:
            rule: The LinterRule to apply.
            source_code: The source code to check.

        Returns:
            A list of violation dictionaries.
        """
        violations: List[Dict[str, Any]] = []

        if rule.check_fn:
            try:
                fn_violations = rule.check_fn(source_code)
                if isinstance(fn_violations, list):
                    for v in fn_violations:
                        v["rule_id"] = rule.id
                        v["rule_name"] = rule.name
                        v["description"] = rule.description
                    violations.extend(fn_violations)
            except Exception as exc:
                logger.warning(
                    "Rule check function failed",
                    rule_id=rule.id,
                    error=str(exc),
                )

        if rule.pattern:
            try:
                for match in re.finditer(rule.pattern, source_code):
                    violations.append({
                        "rule_id": rule.id,
                        "rule_name": rule.name,
                        "description": rule.description,
                        "match": match.group(0),
                        "position": match.start(),
                    })
            except re.error as exc:
                logger.warning(
                    "Invalid regex pattern in rule",
                    rule_id=rule.id,
                    error=str(exc),
                )

        return violations
