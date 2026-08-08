"""LinterRules — Custom linter rule definitions for the harness guardrail.

Defines structured linter rules that can be checked against generated or
modified code. Each rule has an identifier, severity, description, and
a check function that validates source code against the rule.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from typing import Any


class Severity(str, Enum):
    """Rule severity levels."""
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass
class LinterRule:
    """A single linter rule definition.

    Attributes:
        id: Unique rule identifier (e.g. ``"HARNESS-001"``).
        name: Human-readable rule name.
        description: What the rule checks.
        severity: Severity level when violated.
        pattern: Optional regex pattern for simple pattern-based checks.
        check_fn: Optional callable for complex checks. Takes source code
            string, returns a list of violation dictionaries.
        enabled: Whether the rule is active.
    """
    id: str
    name: str
    description: str
    severity: Severity = Severity.WARNING
    pattern: str | None = None
    check_fn: Callable[[str], list[dict[str, Any]]] | None = None
    enabled: bool = True


class LinterRules:
    """Registry and factory for harness linter rules.

    Provides a curated set of built-in rules and supports registration
    of custom rules. Built-in rules cover common anti-patterns that
    violate harness guardrails.

    Built-in rules:
        HARNESS-001: No hardcoded secrets in source code.
        HARNESS-002: No direct database cursor operations.
        HARNESS-003: No bypass of DI container (direct instantiation).
        HARNESS-004: No hardcoded file paths.
        HARNESS-005: Async functions must use await for I/O operations.
    """

    def __init__(self) -> None:
        self._rules: dict[str, LinterRule] = {}
        self._register_builtin_rules()

    def _register_builtin_rules(self) -> None:
        """Register the built-in harness linter rules."""
        builtins = [
            LinterRule(
                id="HARNESS-001",
                name="no_hardcoded_secrets",
                description="Source code must not contain hardcoded API keys, tokens, or passwords",
                severity=Severity.ERROR,
                pattern=r'(?:api_key|secret|token|password|passwd)\s*=\s*["\'][^"\']{8,}["\']',
            ),
            LinterRule(
                id="HARNESS-002",
                name="no_direct_db_cursor",
                description="Must not use raw cursor.execute() — use Repository layer instead",
                severity=Severity.ERROR,
                pattern=r'cursor\.execute\s*\(',
            ),
            LinterRule(
                id="HARNESS-003",
                name="no_di_bypass",
                description="Must not directly instantiate agents/tools — use DI container",
                severity=Severity.WARNING,
                pattern=r'(?:Agent|Tool|Service|Repository)\(\s*\)',
                check_fn=self._check_di_bypass,
            ),
            LinterRule(
                id="HARNESS-004",
                name="no_hardcoded_paths",
                description="Must not hardcode absolute file paths",
                severity=Severity.WARNING,
                pattern=r'["\']/(?:home|usr|var|etc|tmp|opt)/[\w/\-\.]+["\']',
            ),
            LinterRule(
                id="HARNESS-005",
                name="async_io_requires_await",
                description="Async I/O operations must use await",
                severity=Severity.ERROR,
                check_fn=self._check_async_await,
            ),
        ]
        for rule in builtins:
            self._rules[rule.id] = rule

    @staticmethod
    def _check_di_bypass(source_code: str) -> list[dict[str, Any]]:
        """Check for direct instantiation patterns that bypass DI.

        Looks for patterns like ``SomeAgent()`` or ``SomeTool()`` that
        are not preceded by ``register_`` or ``= ...Factory``.

        Args:
            source_code: The source code to check.

        Returns:
            A list of violation dictionaries.
        """
        violations: list[dict[str, Any]] = []
        pattern = re.compile(
            r'(\w+(?:Agent|Tool|Service|Repository|Store|Manager))\s*\(\s*\)'
        )
        for match in pattern.finditer(source_code):
            class_name = match.group(1)
            start = max(0, match.start() - 80)
            context = source_code[start:match.start()]
            if "register_" in context or "Factory" in context or "def " in context:
                continue
            violations.append({
                "rule_id": "HARNESS-003",
                "match": match.group(0),
                "class_name": class_name,
                "position": match.start(),
            })
        return violations

    @staticmethod
    def _check_async_await(source_code: str) -> list[dict[str, Any]]:
        """Check for async I/O calls missing await.

        Detects calls to common async I/O functions that are not preceded
        by ``await``.

        Args:
            source_code: The source code to check.

        Returns:
            A list of violation dictionaries.
        """
        violations: list[dict[str, Any]] = []
        async_io_pattern = re.compile(
            r'(?<!await\s)(?<!\w)'
            r'(\w+\.(?:execute|read|write|send|recv|fetch|post|get|put|delete|query|search))'
            r'\s*\('
        )
        for match in async_io_pattern.finditer(source_code):
            line_start = source_code.rfind("\n", 0, match.start()) + 1
            line_end = source_code.find("\n", match.end())
            line = source_code[line_start:line_end].strip()
            if line.startswith("await ") or line.startswith("return await "):
                continue
            if "async def" in line or "def " in line:
                continue
            violations.append({
                "rule_id": "HARNESS-005",
                "match": match.group(0),
                "line": line[:120],
                "position": match.start(),
            })
        return violations

    def register_rule(self, rule: LinterRule) -> None:
        """Register a custom linter rule.

        Args:
            rule: The LinterRule to register.
        """
        self._rules[rule.id] = rule

    def get_rule(self, rule_id: str) -> LinterRule | None:
        """Get a rule by its identifier.

        Args:
            rule_id: The rule identifier.

        Returns:
            The LinterRule, or ``None`` if not found.
        """
        return self._rules.get(rule_id)

    def get_all_rules(self) -> dict[str, LinterRule]:
        """Get all registered rules.

        Returns:
            A dictionary mapping rule IDs to LinterRule instances.
        """
        return dict(self._rules)

    def get_enabled_rules(self) -> list[LinterRule]:
        """Get all enabled rules.

        Returns:
            A list of enabled LinterRule instances.
        """
        return [r for r in self._rules.values() if r.enabled]

    def enable_rule(self, rule_id: str) -> None:
        """Enable a rule by its identifier.

        Args:
            rule_id: The rule identifier.
        """
        rule = self._rules.get(rule_id)
        if rule:
            rule.enabled = True

    def disable_rule(self, rule_id: str) -> None:
        """Disable a rule by its identifier.

        Args:
            rule_id: The rule identifier.
        """
        rule = self._rules.get(rule_id)
        if rule:
            rule.enabled = False
