"""Conditional Router — Declarative condition-based routing for workflows.

Replaces hardcoded if-else strategy routing (e.g. in TopicAgent/SupportAgent)
with a declarative, YAML-configurable routing system.

Supported condition expressions:
  - Comparison:    state.field >= 0.8, state.field == "pass", state.field != "reject"
  - Existence:     state.field exists, state.field not_empty
  - Containment:   "keyword" in state.field, state.field contains "keyword"
  - Logic:         expr1 and expr2, expr1 or expr2, not expr
  - Type check:    type(state.field) == "list", len(state.field) >= 3
  - Nested field:  state.audit_result.score, state.topic_list[0]
  - Built-in fns:  has_error(), retry_count(), score_above(threshold)

License: MIT
"""

from __future__ import annotations

import ast
import operator
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, model_validator

from flowforge.core.tracing import get_logger

logger = get_logger("conditional_router")

# ---------------------------------------------------------------------------
# Safe AST-based expression evaluator
# ---------------------------------------------------------------------------

_COMPARE_OPS: dict[type[ast.AST], Any] = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.Is: operator.is_,
    ast.IsNot: operator.is_not,
}

_BOOL_OPS: dict[type[ast.AST], Any] = {
    ast.And: all,
    ast.Or: any,
}

_UNARY_OPS: dict[type[ast.AST], Any] = {
    ast.Not: operator.not_,
    ast.USub: operator.neg,
}

_ALLOWED_BUILTINS: set[str] = {
    "len",
    "type",
    "has_error",
    "retry_count",
    "score_above",
}

_TYPE_MAP: dict[str, type] = {
    "str": str,
    "int": int,
    "float": float,
    "bool": bool,
    "list": list,
    "dict": dict,
    "tuple": tuple,
    "set": set,
    "none": type(None),
}


class ExpressionError(Exception):
    """Raised when a condition expression is invalid or unsafe."""


class _SafeEvaluator:
    """Evaluate a restricted subset of Python AST against a context dict.

    Only the following node types are permitted:
      - ast.Constant / ast.Num / ast.Str  (literals)
      - ast.Name                          (variable lookup in context)
      - ast.Attribute                     (dotted access)
      - ast.Subscript                     (index / key access)
      - ast.Compare                       (comparison chains)
      - ast.BoolOp                        (and / or)
      - ast.UnaryOp                       (not / -)
      - ast.Call                          (only whitelisted builtins)
    """

    def __init__(self, context: dict[str, Any]) -> None:
        self._context = context

    def evaluate(self, expr: str) -> Any:
        """Parse *expr* as a Python expression and evaluate it safely."""
        try:
            tree = ast.parse(expr, mode="eval")
        except SyntaxError as exc:
            raise ExpressionError(f"Syntax error in expression: {expr!r}") from exc
        return self._visit(tree.body)

    # -- dispatch -----------------------------------------------------------

    def _visit(self, node: ast.AST) -> Any:
        visitor = getattr(self, f"_visit_{node.__class__.__name__}", None)
        if visitor is None:
            raise ExpressionError(
                f"Unsupported expression node: {node.__class__.__name__}"
            )
        return visitor(node)

    # -- literals -----------------------------------------------------------

    def _visit_Constant(self, node: ast.Constant) -> Any:
        return node.value

    # Python 3.7 compat
    def _visit_Num(self, node: ast.Num) -> Any:  # type: ignore[attr-defined]
        return node.n

    def _visit_Str(self, node: ast.Str) -> Any:  # type: ignore[attr-defined]
        return node.s

    # -- names --------------------------------------------------------------

    def _visit_Name(self, node: ast.Name) -> Any:
        return self._resolve_name(node.id)

    def _resolve_name(self, name: str) -> Any:
        if name in self._context:
            return self._context[name]
        raise ExpressionError(f"Undefined variable: {name!r}")

    # -- attribute access ---------------------------------------------------

    def _visit_Attribute(self, node: ast.Attribute) -> Any:
        obj = self._visit(node.value)
        try:
            return getattr(obj, node.attr)
        except AttributeError:
            # Support dict-style access via attribute syntax
            if isinstance(obj, dict):
                return obj.get(node.attr)
            raise ExpressionError(
                f"Cannot access attribute {node.attr!r} on {type(obj).__name__}"
            )

    # -- subscript / index --------------------------------------------------

    def _visit_Subscript(self, node: ast.Subscript) -> Any:
        obj = self._visit(node.value)
        if isinstance(node.slice, ast.Slice):
            raise ExpressionError("Slice subscripts are not supported")
        index = self._visit(node.slice)
        try:
            return obj[index]
        except (KeyError, IndexError, TypeError) as exc:
            raise ExpressionError(
                f"Cannot access index {index!r} on {type(obj).__name__}"
            ) from exc

    def _visit_Index(self, node: ast.Index) -> Any:  # type: ignore[attr-defined]
        # Python 3.8 wraps subscripts in ast.Index
        return self._visit(node.value)

    # -- comparisons --------------------------------------------------------

    def _visit_Compare(self, node: ast.Compare) -> bool:
        left = self._visit(node.left)
        for op, comparator in zip(node.ops, node.comparators):
            right = self._visit(comparator)
            op_type = type(op)
            if op_type not in _COMPARE_OPS:
                raise ExpressionError(f"Unsupported comparison operator: {op_type.__name__}")
            if not _COMPARE_OPS[op_type](left, right):
                return False
            left = right
        return True

    # -- boolean ops --------------------------------------------------------

    def _visit_BoolOp(self, node: ast.BoolOp) -> bool:
        op_type = type(node.op)
        if op_type not in _BOOL_OPS:
            raise ExpressionError(f"Unsupported boolean operator: {op_type.__name__}")
        values = [self._visit(v) for v in node.values]
        return _BOOL_OPS[op_type](values)

    # -- unary ops ----------------------------------------------------------

    def _visit_UnaryOp(self, node: ast.UnaryOp) -> Any:
        op_type = type(node.op)
        if op_type not in _UNARY_OPS:
            raise ExpressionError(f"Unsupported unary operator: {op_type.__name__}")
        operand = self._visit(node.operand)
        return _UNARY_OPS[op_type](operand)

    # -- calls (whitelisted builtins only) ----------------------------------

    def _visit_Call(self, node: ast.Call) -> Any:
        if node.keywords:
            raise ExpressionError("Keyword arguments are not supported in expressions")
        if not isinstance(node.func, ast.Name):
            raise ExpressionError("Only built-in function calls are allowed")

        func_name = node.func.id
        if func_name not in _ALLOWED_BUILTINS:
            raise ExpressionError(f"Function {func_name!r} is not allowed")

        args = [self._visit(a) for a in node.args]
        return self._call_builtin(func_name, args)

    def _call_builtin(self, name: str, args: list[Any]) -> Any:
        if name == "len":
            if len(args) != 1:
                raise ExpressionError("len() requires exactly 1 argument")
            return len(args[0])

        if name == "type":
            if len(args) != 1:
                raise ExpressionError("type() requires exactly 1 argument")
            return type(args[0]).__name__

        if name == "has_error":
            state = self._context.get("state", {})
            errors = state.get("errors", []) if isinstance(state, dict) else []
            return len(errors) > 0

        if name == "retry_count":
            state = self._context.get("state", {}) if isinstance(self._context.get("state"), dict) else {}
            return state.get("retry_count", 0)

        if name == "score_above":
            if len(args) != 1:
                raise ExpressionError("score_above() requires exactly 1 argument (threshold)")
            threshold = args[0]
            state = self._context.get("state", {}) if isinstance(self._context.get("state"), dict) else {}
            score = state.get("score", state.get("audit_score", 0.0))
            return score >= threshold

        raise ExpressionError(f"Unknown built-in function: {name!r}")


# ---------------------------------------------------------------------------
# Extended expression parser (handles 'exists', 'not_empty', 'contains')
# ---------------------------------------------------------------------------

def _preprocess_expression(expr: str, context: dict[str, Any]) -> str:
    """Transform domain-specific syntax into standard Python before AST eval.

    Handles:
      - ``state.field exists``  →  ``__exists("state.field")``
      - ``state.field not_empty`` → ``__not_empty("state.field")``
      - ``state.field contains "kw"`` → ``"kw" in state.field``
    """
    import re

    result = expr

    # "X contains Y" → "Y in X"
    # Match: <expr> contains <literal>
    result = re.sub(
        r'(\b[\w.]+(?:\[[^\]]+\])*)\s+contains\s+("(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|\d+(?:\.\d+)?)',
        r'\2 in \1',
        result,
    )

    # "X exists" → __exists("X")
    result = re.sub(
        r'(\b[\w.]+(?:\[[^\]]+\])*)\s+exists\b',
        r'__exists("\1")',
        result,
    )

    # "X not_empty" → __not_empty("X")
    result = re.sub(
        r'(\b[\w.]+(?:\[[^\]]+\])*)\s+not_empty\b',
        r'__not_empty("\1")',
        result,
    )

    return result


class _ExtendedEvaluator(_SafeEvaluator):
    """Extends _SafeEvaluator with ``exists``, ``not_empty`` builtins."""

    def __init__(self, context: dict[str, Any]) -> None:
        super().__init__(context)
        # Register extended builtins
        self._context["__exists"] = self._builtin_exists
        self._context["__not_empty"] = self._builtin_not_empty

    @staticmethod
    def _builtin_exists(path: str) -> bool:
        """Check whether a dotted path resolves in the evaluator context.

        This is called with a *string* path generated by _preprocess_expression,
        so we cannot use self._context directly. Instead we store the original
        context on the instance and resolve dynamically.
        """
        # Will be overridden per-instance — see __init__ binding below.
        return False

    @staticmethod
    def _builtin_not_empty(path: str) -> bool:
        return False


def _make_evaluator(context: dict[str, Any]) -> _ExtendedEvaluator:
    """Create an _ExtendedEvaluator with proper exists/not_empty closures."""

    raw_context = dict(context)

    def _exists(path: str) -> bool:
        try:
            _resolve_path(raw_context, path)
            return True
        except (KeyError, AttributeError, IndexError, TypeError):
            return False

    def _not_empty(path: str) -> bool:
        try:
            value = _resolve_path(raw_context, path)
            if value is None:
                return False
            if isinstance(value, (str, list, dict, set, tuple)) and len(value) == 0:
                return False
            return True
        except (KeyError, AttributeError, IndexError, TypeError):
            return False

    ctx = dict(context)
    ctx["__exists"] = _exists
    ctx["__not_empty"] = _not_empty

    return _ExtendedEvaluator(ctx)


def _resolve_path(context: dict[str, Any], path: str) -> Any:
    """Resolve a dotted path like ``state.audit_result.score`` in *context*."""
    # Handle bracket subscripts in the path: state.list[0].field
    import re
    parts = re.split(r'\.', path)
    current: Any = context
    for part in parts:
        # Split "list[0]" into "list" and "[0]"
        bracket_matches = re.findall(r'([^\[]+)|\[(\d+)\]', part)
        for name_part, index_part in bracket_matches:
            if name_part:
                if isinstance(current, dict):
                    current = current[name_part]
                else:
                    current = getattr(current, name_part)
            elif index_part:
                current = current[int(index_part)]
    return current


def evaluate_condition(expression: str, context: dict[str, Any]) -> bool:
    """Safely evaluate a condition expression against a context dict.

    Args:
        expression: The condition string to evaluate.
        context: A dict (typically containing ``state``, ``event``, etc.).

    Returns:
        Boolean result of the expression.

    Raises:
        ExpressionError: If the expression is syntactically invalid or
            uses disallowed constructs.
    """
    preprocessed = _preprocess_expression(expression, context)
    evaluator = _make_evaluator(context)
    result = evaluator.evaluate(preprocessed)
    return bool(result)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class RouteConfig(BaseModel):
    """A single routing rule.

    Attributes:
        name: Human-readable route name.
        condition: Condition expression evaluated against the routing context.
        target: Target node / step / strategy to route to when matched.
        priority: Higher number = higher priority. Routes with equal priority
            are evaluated in definition order.
        description: Optional description of this route.
    """

    name: str
    condition: str
    target: str
    priority: int = 0
    description: str = ""

    @model_validator(mode="after")
    def _validate_condition_syntax(self) -> RouteConfig:
        """Validate that the condition expression is parseable."""
        try:
            preprocessed = _preprocess_expression(self.condition, {})
            ast.parse(preprocessed, mode="eval")
        except SyntaxError as exc:
            raise ValueError(
                f"Route '{self.name}' has invalid condition syntax: {self.condition!r} — {exc}"
            ) from exc
        return self


class RouterConfig(BaseModel):
    """Top-level router configuration (matches YAML structure).

    Attributes:
        name: Router identifier.
        description: Optional router description.
        default: Default target when no route matches.
        routes: Ordered list of route rules.
    """

    name: str
    description: str = ""
    default: str | None = None
    routes: list[RouteConfig] = Field(default_factory=list)


class RouteResult(BaseModel):
    """Result of a routing decision.

    Attributes:
        target: The selected target.
        matched_route: Name of the route that matched, or None if default.
        condition: The condition expression that matched.
    """

    target: str
    matched_route: str | None = None
    condition: str = ""


# ---------------------------------------------------------------------------
# ConditionalRouter
# ---------------------------------------------------------------------------

class ConditionalRouter:
    """Declarative condition-based router.

    Routes are evaluated in priority order (highest first). Among routes with
    equal priority, they are evaluated in the order they were added. The first
    matching route wins.

    Usage::

        router = ConditionalRouter(
            routes=[
                RouteConfig(name="hot", condition="state.urgency == 'high'", target="hot_strategy", priority=10),
                RouteConfig(name="deep", condition="state.intent == 'deep_research'", target="deep_strategy", priority=5),
            ],
            default="trending",
        )
        result = await router.route({"state": {"urgency": "high", "intent": "hot_trend"}})
        assert result.target == "hot_strategy"
    """

    def __init__(self, routes: list[RouteConfig], default: str | None = None) -> None:
        self._routes: list[RouteConfig] = list(routes)
        self._default = default
        self._sort_routes()

    def _sort_routes(self) -> None:
        """Sort routes by priority descending. Stable sort preserves insertion order for equal priorities."""
        self._routes.sort(key=lambda r: r.priority, reverse=True)

    async def route(self, context: dict) -> RouteResult:
        """Evaluate routes against *context* and return the matching target.

        Args:
            context: Routing context, typically ``{"state": {...}, "event": {...}}``.

        Returns:
            A RouteResult indicating the selected target.

        Raises:
            ExpressionError: If a condition expression is invalid.
            ValueError: If no route matches and no default is configured.
        """
        for route in self._routes:
            try:
                if evaluate_condition(route.condition, context):
                    logger.debug(
                        f"Route '{route.name}' matched (priority={route.priority}), "
                        f"target={route.target!r}"
                    )
                    return RouteResult(
                        target=route.target,
                        matched_route=route.name,
                        condition=route.condition,
                    )
            except ExpressionError:
                logger.error(
                    f"Route '{route.name}' has invalid condition: {route.condition!r}"
                )
                raise
            except Exception as exc:
                logger.warning(
                    f"Route '{route.name}' evaluation failed: {exc}, skipping"
                )
                continue

        if self._default is not None:
            logger.debug(f"No route matched, using default: {self._default!r}")
            return RouteResult(target=self._default)

        raise ValueError(
            f"No route matched and no default configured. "
            f"Evaluated {len(self._routes)} routes against context keys: {list(context.keys())}"
        )

    def add_route(self, route: RouteConfig) -> None:
        """Dynamically add a routing rule.

        The route list is re-sorted after insertion to maintain priority order.

        Args:
            route: The RouteConfig to add.
        """
        self._routes.append(route)
        self._sort_routes()
        logger.info(f"Added route '{route.name}' (priority={route.priority}, target={route.target!r})")

    def remove_route(self, name: str) -> None:
        """Remove a route by name.

        Args:
            name: The route name to remove.

        Raises:
            KeyError: If no route with the given name exists.
        """
        original_len = len(self._routes)
        self._routes = [r for r in self._routes if r.name != name]
        if len(self._routes) == original_len:
            raise KeyError(f"Route '{name}' not found")
        logger.info(f"Removed route '{name}'")

    def list_routes(self) -> list[RouteConfig]:
        """Return a copy of the current route list (in priority order)."""
        return list(self._routes)

    @classmethod
    def from_yaml(cls, yaml_path: str | Path) -> ConditionalRouter:
        """Load router configuration from a YAML file.

        Expected YAML structure::

            name: my_router
            description: "Router description"
            default: fallback_target

            routes:
              - name: route_a
                condition: "state.field >= 0.8"
                target: target_a
                priority: 10
                description: "High score route"

        Args:
            yaml_path: Path to the YAML configuration file.

        Returns:
            A configured ConditionalRouter instance.

        Raises:
            FileNotFoundError: If the YAML file does not exist.
            ValueError: If the YAML content is invalid.
        """
        path = Path(yaml_path)
        if not path.exists():
            raise FileNotFoundError(f"Router config not found: {path}")

        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        try:
            config = RouterConfig(**data)
        except Exception as exc:
            raise ValueError(f"Invalid router config in {path}: {exc}") from exc

        logger.info(
            f"Loaded router '{config.name}' from {path} "
            f"({len(config.routes)} routes, default={config.default!r})"
        )
        return cls(routes=config.routes, default=config.default)

    def to_dict(self) -> dict[str, Any]:
        """Serialize the router configuration to a plain dict."""
        return {
            "name": "",
            "default": self._default,
            "routes": [r.model_dump() for r in self._routes],
        }

    def __repr__(self) -> str:
        return (
            f"ConditionalRouter(routes={len(self._routes)}, "
            f"default={self._default!r})"
        )
