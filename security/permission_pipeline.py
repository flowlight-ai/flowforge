"""Permission Pipeline - Three-layer permission system.

Implements FR-HRN-05:
- deny → ask → allow three-layer pipeline
- deny always wins (fail-closed)
- Four action levels: Read / Suggest / Prepare / Execute
- Rule priority: deny > ask > allow
"""

from collections.abc import Callable
from enum import Enum
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("security.permission_pipeline")


class ActionLevel(str, Enum):
    """Four-level action classification."""
    READ = "read"           # Read-only, no side effects
    SUGGEST = "suggest"     # Suggest changes, no direct modification
    PREPARE = "prepare"     # Prepare resources, reversible
    EXECUTE = "execute"     # Execute irreversible operations


class PermissionPipeline:
    """Three-layer permission pipeline.

    Layer 1 (deny): Explicit deny rules - always wins
    Layer 2 (ask): Requires human approval
    Layer 3 (allow): Explicit allow rules

    Default: if no rule matches, action is denied (fail-closed).
    """

    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or {}
        self._deny_rules: list[dict[str, Any]] = []
        self._ask_rules: list[dict[str, Any]] = []
        self._allow_rules: list[dict[str, Any]] = []
        self._approval_callback: Callable | None = None
        self._check_count = 0
        self._deny_count = 0
        self._ask_count = 0
        self._allow_count = 0

        # Load rules from config
        self._load_rules(self.config.get("rules", []))

    def _load_rules(self, rules: list[dict[str, Any]]):
        """Load permission rules from config."""
        for rule in rules:
            action = rule.get("action", "allow")
            rule_entry = {
                "tool_name": rule.get("tool_name", "*"),
                "action_level": rule.get("action_level", ActionLevel.EXECUTE),
                "condition": rule.get("condition", None),
                "reason": rule.get("reason", ""),
            }
            if action == "deny":
                self._deny_rules.append(rule_entry)
            elif action == "ask":
                self._ask_rules.append(rule_entry)
            else:
                self._allow_rules.append(rule_entry)

    def set_approval_callback(self, callback: Callable):
        """Set the callback for 'ask' layer approval."""
        self._approval_callback = callback

    async def check(
        self,
        tool_name: str,
        action_level: ActionLevel = ActionLevel.EXECUTE,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Check permission for a tool action.

        Returns dict with:
        - allowed: bool
        - reason: str
        - layer: str (deny/ask/allow/default)
        """
        self._check_count += 1

        # Layer 1: Deny (always wins)
        for rule in self._deny_rules:
            if self._matches_rule(rule, tool_name, action_level, context):
                self._deny_count += 1
                return {
                    "allowed": False,
                    "reason": rule.get("reason", "Denied by rule"),
                    "layer": "deny",
                }

        # Layer 2: Ask (requires approval)
        for rule in self._ask_rules:
            if self._matches_rule(rule, tool_name, action_level, context):
                self._ask_count += 1
                if self._approval_callback:
                    approved = await self._approval_callback(tool_name, action_level, context)
                    if not approved:
                        return {
                            "allowed": False,
                            "reason": "Human approval denied",
                            "layer": "ask",
                        }
                    return {
                        "allowed": True,
                        "reason": "Approved by human",
                        "layer": "ask",
                    }
                # No approval callback = deny (fail-closed)
                return {
                    "allowed": False,
                    "reason": "Requires approval but no callback configured",
                    "layer": "ask",
                }

        # Layer 3: Allow
        for rule in self._allow_rules:
            if self._matches_rule(rule, tool_name, action_level, context):
                self._allow_count += 1
                return {
                    "allowed": True,
                    "reason": rule.get("reason", "Allowed by rule"),
                    "layer": "allow",
                }

        # Default: deny (fail-closed)
        self._deny_count += 1
        return {
            "allowed": False,
            "reason": "No matching rule (fail-closed default)",
            "layer": "default",
        }

    def _matches_rule(
        self,
        rule: dict[str, Any],
        tool_name: str,
        action_level: ActionLevel,
        context: dict[str, Any] | None,
    ) -> bool:
        """Check if a rule matches the current action."""
        # Tool name match (wildcard support)
        rule_tool = rule.get("tool_name", "*")
        if rule_tool != "*" and rule_tool != tool_name:
            return False

        # Action level match
        rule_level = rule.get("action_level")
        if rule_level and rule_level != action_level:
            return False

        # Condition match (if specified)
        condition = rule.get("condition")
        if condition and context:
            # Simple key-value condition matching
            for key, value in condition.items():
                if context.get(key) != value:
                    return False

        return True

    def add_deny_rule(self, tool_name: str = "*", action_level: ActionLevel = ActionLevel.EXECUTE, reason: str = ""):
        """Add a deny rule."""
        self._deny_rules.append({
            "tool_name": tool_name,
            "action_level": action_level,
            "reason": reason,
        })

    def add_ask_rule(self, tool_name: str = "*", action_level: ActionLevel = ActionLevel.EXECUTE, reason: str = ""):
        """Add an ask rule."""
        self._ask_rules.append({
            "tool_name": tool_name,
            "action_level": action_level,
            "reason": reason,
        })

    def add_allow_rule(self, tool_name: str = "*", action_level: ActionLevel = ActionLevel.READ, reason: str = ""):
        """Add an allow rule."""
        self._allow_rules.append({
            "tool_name": tool_name,
            "action_level": action_level,
            "reason": reason,
        })

    def get_status(self) -> dict:
        """Get permission pipeline status."""
        return {
            "enabled": True,
            "deny_rules": len(self._deny_rules),
            "ask_rules": len(self._ask_rules),
            "allow_rules": len(self._allow_rules),
            "check_count": self._check_count,
            "deny_count": self._deny_count,
            "ask_count": self._ask_count,
            "allow_count": self._allow_count,
        }
