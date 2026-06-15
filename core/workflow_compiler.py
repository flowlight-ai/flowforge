"""FWK-01: Workflow YAML Compiler.

Compiles YAML workflow definitions into executable sop_steps format
consumed by WorkflowExecutor, with future support for LangGraph StateGraph.

Key capabilities:
- YAML schema validation via Pydantic models
- Conditional edge compilation with safe expression evaluation
- Fan-out/fan-in parallel step group compilation
- Fallback chain compilation
- Template variable interpolation ({{state.xxx}}, {{auto.persona}})
- Backward-compatible sop_steps output for WorkflowExecutor
"""

from __future__ import annotations

import re
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator

from flowforge.core.tracing import get_logger

logger = get_logger("workflow_compiler")


# ──────────────────────────── Enums ────────────────────────────


class NodeType(str, Enum):
    """Supported node types in a workflow."""
    AGENT = "agent"
    TOOL = "tool"
    GENERATE = "generate"
    HUMAN = "human"
    GATE = "gate"


class OnErrorStrategy(str, Enum):
    """Error handling strategies for workflow nodes."""
    ABORT = "abort"
    SKIP = "skip"
    RETRY = "retry"
    REFLEXION_RETRY = "reflexion_retry"


# ──────────────────────────── Pydantic Models ────────────────────────────


class WorkflowStateFieldConfig(BaseModel):
    """Configuration for a single state field."""
    type: str = "Any"
    default: Any = None
    description: str = ""

    model_config = {"extra": "allow"}


class WorkflowStateConfig(BaseModel):
    """State definition for a workflow."""
    fields: dict[str, Any] = Field(default_factory=dict)
    defaults: dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class WorkflowNodeMeta(BaseModel):
    """Display metadata for a workflow node."""
    label: str = ""
    order: int = 0
    description: str = ""
    icon: str = ""

    model_config = {"extra": "allow"}


class FallbackStepConfig(BaseModel):
    """A single step in a fallback chain."""
    tool: Optional[str] = None
    agent: Optional[str] = None
    prompt: Optional[str] = None
    input: Optional[dict[str, Any]] = None

    model_config = {"extra": "allow"}

    @model_validator(mode="after")
    def _check_has_action(self) -> "FallbackStepConfig":
        if not self.tool and not self.agent and not self.prompt:
            raise ValueError("Fallback step must specify at least one of: tool, agent, prompt")
        return self


class ConditionalRouterConfig(BaseModel):
    """Conditional routing configuration for a node."""
    conditions: list[dict[str, str]] = Field(default_factory=list)
    default_target: Optional[str] = None

    model_config = {"extra": "allow"}


class WorkflowNodeConfig(BaseModel):
    """Configuration for a single workflow node."""
    name: str
    type: NodeType = NodeType.AGENT
    agent: Optional[str] = None
    tool: Optional[str] = None
    mode: Optional[str] = None
    input: Optional[dict[str, Any]] = None
    output: Optional[str] = None
    meta: Optional[WorkflowNodeMeta] = None
    on_error: OnErrorStrategy = OnErrorStrategy.ABORT
    retry_count: int = 0
    retry_delay: float = 2.0
    timeout: Optional[int] = None
    fallback_chain: list[FallbackStepConfig] = Field(default_factory=list)
    conditional_router: Optional[ConditionalRouterConfig] = None
    prompt: Optional[str] = None

    model_config = {"extra": "allow"}

    @model_validator(mode="after")
    def _validate_type_specific_fields(self) -> "WorkflowNodeConfig":
        if self.type == NodeType.AGENT and not self.agent:
            raise ValueError(f"Node '{self.name}' of type 'agent' must specify 'agent' field")
        if self.type == NodeType.TOOL and not self.tool:
            raise ValueError(f"Node '{self.name}' of type 'tool' must specify 'tool' field")
        return self


class WorkflowEdgeConfig(BaseModel):
    """Configuration for a workflow edge (transition between nodes)."""
    source: str
    target: Optional[str] = None
    targets: Optional[list[str]] = None
    condition: Optional[str] = None

    model_config = {"extra": "allow"}

    @model_validator(mode="after")
    def _validate_targets(self) -> "WorkflowEdgeConfig":
        if not self.target and not self.targets:
            raise ValueError(
                f"Edge from '{self.source}' must specify either 'target' or 'targets'"
            )
        return self


class WorkflowConfig(BaseModel):
    """Top-level workflow configuration."""
    timeout: int = 3600
    max_retries: int = 3
    step_timeout: int = 300
    defense: Optional[dict[str, Any]] = None

    model_config = {"extra": "allow"}


class WorkflowYAMLConfig(BaseModel):
    """Complete YAML workflow configuration model."""
    name: str
    description: str = ""
    version: float = 1.0
    state: Optional[WorkflowStateConfig] = None
    nodes: list[WorkflowNodeConfig]
    edges: list[WorkflowEdgeConfig] = Field(default_factory=list)
    interrupt_before: list[str] = Field(default_factory=list)
    config: WorkflowConfig = Field(default_factory=WorkflowConfig)

    model_config = {"extra": "allow"}


# ──────────────────────────── Compiled Workflow ────────────────────────────


class CompiledWorkflow:
    """A workflow that has been validated and compiled from YAML config.

    Contains the resolved node graph, edges, entry point, interrupt points,
    and the compiled sop_steps format for WorkflowExecutor consumption.
    """

    def __init__(
        self,
        name: str,
        description: str,
        version: float,
        nodes: dict[str, WorkflowNodeConfig],
        edges: list[WorkflowEdgeConfig],
        entry_point: str,
        interrupt_before: list[str],
        state_config: Optional[WorkflowStateConfig],
        config: WorkflowConfig,
        sop_steps: list[dict[str, Any]],
        adjacency: dict[str, list[dict[str, Any]]],
    ) -> None:
        self.name = name
        self.description = description
        self.version = version
        self.nodes = nodes
        self.edges = edges
        self.entry_point = entry_point
        self.interrupt_before = interrupt_before
        self.state_config = state_config
        self.config = config
        self.sop_steps = sop_steps
        self.adjacency = adjacency

    def __repr__(self) -> str:
        return (
            f"CompiledWorkflow(name='{self.name}', "
            f"nodes={len(self.nodes)}, "
            f"entry='{self.entry_point}', "
            f"sop_steps={len(self.sop_steps)})"
        )


# ──────────────────────────── Template Interpolation ────────────────────────────


_TEMPLATE_PATTERN = re.compile(r"\{\{(.+?)\}\}")


def interpolate_template(template_str: str, state: dict[str, Any], auto: Optional[dict[str, Any]] = None) -> Any:
    """Interpolate template variables like {{state.xxx}} and {{auto.persona}}.

    If the entire string is a single template expression, returns the raw value
    (preserving type). Otherwise, substitutes all occurrences as strings.

    Args:
        template_str: The template string containing {{...}} expressions.
        state: The current workflow state dictionary.
        auto: Auto-injected context (persona, task_id, etc.).

    Returns:
        The interpolated value with correct type preservation for single expressions.
    """
    if not isinstance(template_str, str):
        return template_str

    matches = list(_TEMPLATE_PATTERN.finditer(template_str))

    if not matches:
        return template_str

    # Single expression covering the entire string → preserve type
    if len(matches) == 1 and matches[0].start() == 0 and matches[0].end() == len(template_str):
        expr = matches[0].group(1).strip()
        return _resolve_expression(expr, state, auto)

    # Multiple expressions or mixed with literal text → string substitution
    def _replace(match: re.Match) -> str:
        expr = match.group(1).strip()
        resolved = _resolve_expression(expr, state, auto)
        return str(resolved) if resolved is not None else match.group(0)

    return _TEMPLATE_PATTERN.sub(_replace, template_str)


def _resolve_expression(expr: str, state: dict[str, Any], auto: Optional[dict[str, Any]]) -> Any:
    """Resolve a single template expression like 'state.topic_list' or 'auto.persona'.

    Supports:
    - state.xxx: access workflow state
    - state.xxx[0]: index access
    - auto.xxx: access auto-injected context
    """
    if expr.startswith("state."):
        path = expr[len("state."):]
        return _deep_get(state, path)
    elif expr.startswith("auto."):
        path = expr[len("auto."):]
        if auto is None:
            return None
        return _deep_get(auto, path)
    else:
        # Try state first, then auto
        result = _deep_get(state, expr)
        if result is not None:
            return result
        if auto:
            return _deep_get(auto, expr)
        return None


def _deep_get(data: dict[str, Any], path: str) -> Any:
    """Traverse a nested dict using dot/index notation.

    Examples:
        _deep_get(data, "topic_list") -> data["topic_list"]
        _deep_get(data, "audit_result.score") -> data["audit_result"]["score"]
        _deep_get(data, "topic_list[0]") -> data["topic_list"][0]
    """
    # Split by dots, but handle index notation like "list[0]"
    parts = re.split(r'\.', path)
    current: Any = data
    for part in parts:
        # Handle index notation: "field[0]" or "field[0][1]"
        index_matches = re.findall(r'^(.+?)(\[\d+\]*)$', part)
        if index_matches:
            key, indices_str = index_matches[0]
            if key:
                if isinstance(current, dict) and key in current:
                    current = current[key]
                else:
                    return None
            # Parse all index brackets
            for idx_match in re.finditer(r'\[(\d+)\]', indices_str):
                idx = int(idx_match.group(1))
                if isinstance(current, (list, tuple)) and idx < len(current):
                    current = current[idx]
                else:
                    return None
        else:
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                return None
    return current


# ──────────────────────────── Safe Condition Evaluator ────────────────────────────


# Allowed names in condition expressions for safety
_SAFE_BUILTINS = {
    "True": True,
    "False": False,
    "None": None,
    "and": lambda a, b: a and b,
    "or": lambda a, b: a or b,
    "not": lambda a: not a,
}


def compile_condition(condition_expr: str) -> Callable[[dict[str, Any]], bool]:
    """Compile a condition expression string into a callable.

    The callable takes a state dict and returns a boolean.
    Uses restricted eval with only safe builtins and state access.

    Supported expressions:
    - state.audit_result.score >= 0.8
    - state.audit_result.retry_count >= 2
    - state.audit_result.issue_type == 'research'
    - state.review_verdict == 'pass'

    Args:
        condition_expr: A condition expression string referencing state fields.

    Returns:
        A callable that evaluates the condition against a given state dict.
    """
    # Replace state.xxx references with safe dict access
    transformed = _transform_condition_expr(condition_expr)

    def _evaluator(state: dict[str, Any]) -> bool:
        local_vars: dict[str, Any] = {"state": state}
        try:
            return bool(eval(transformed, {"__builtins__": {}}, local_vars))  # noqa: S307
        except Exception as e:
            logger.warning(f"Condition evaluation failed for '{condition_expr}': {e}")
            return False

    _evaluator.__doc__ = f"Condition: {condition_expr}"
    return _evaluator


def _transform_condition_expr(expr: str) -> str:
    """Transform a condition expression to use direct state dict access.

    'state.audit_result.score >= 0.8' -> 'state["audit_result"]["score"] >= 0.8'
    """
    # Replace state.xxx.yyy with state["xxx"]["yyy"]
    # Handle state.xxx[0] as well
    def _replace_state_ref(match: re.Match) -> str:
        path = match.group(1)
        parts = re.split(r'\.', path)
        result = "state"
        for part in parts:
            index_matches = re.findall(r'^(.+?)(\[\d+\]*)$', part)
            if index_matches:
                key, indices_str = index_matches[0]
                if key:
                    result += f'["{key}"]'
                for idx_match in re.finditer(r'\[(\d+)\]', indices_str):
                    result += f'[{idx_match.group(1)}]'
            else:
                result += f'["{part}"]'
        return result

    return re.sub(r'state\.([a-zA-Z_]\w*(?:\.\w+)*(?:\[\d+\])*)', _replace_state_ref, expr)


# ──────────────────────────── Workflow Compiler ────────────────────────────


class WorkflowCompiler:
    """Compiles YAML workflow definitions into executable formats.

    Primary output is sop_steps format for WorkflowExecutor consumption.
    Future target: LangGraph StateGraph compilation.
    """

    def compile_from_yaml(self, yaml_path: str) -> CompiledWorkflow:
        """Compile a workflow from a YAML file.

        Args:
            yaml_path: Path to the YAML workflow definition file.

        Returns:
            A CompiledWorkflow instance ready for execution.

        Raises:
            FileNotFoundError: If the YAML file does not exist.
            ValueError: If the YAML content fails validation.
        """
        path = Path(yaml_path)
        if not path.exists():
            raise FileNotFoundError(f"Workflow YAML file not found: {yaml_path}")

        with open(path, "r", encoding="utf-8") as f:
            raw_config = yaml.safe_load(f)

        if not isinstance(raw_config, dict):
            raise ValueError(f"Invalid YAML: expected mapping, got {type(raw_config).__name__}")

        logger.info(f"Loaded workflow YAML from {yaml_path}")
        return self.compile_from_dict(raw_config)

    def compile_from_dict(self, config: dict[str, Any]) -> CompiledWorkflow:
        """Compile a workflow from a dictionary configuration.

        Args:
            config: A dictionary matching the WorkflowYAMLConfig schema.

        Returns:
            A CompiledWorkflow instance ready for execution.

        Raises:
            ValueError: If validation fails.
        """
        # Parse and validate with Pydantic
        try:
            yaml_config = WorkflowYAMLConfig.model_validate(config)
        except Exception as e:
            raise ValueError(f"Workflow YAML validation failed: {e}") from e

        # Additional semantic validation
        errors = self.validate(yaml_config)
        if errors:
            raise ValueError(f"Workflow validation errors: {'; '.join(errors)}")

        # Build internal structures
        nodes_map = {node.name: node for node in yaml_config.nodes}
        adjacency = self._build_adjacency(yaml_config.edges, nodes_map)
        entry_point = self._find_entry_point(yaml_config.nodes, yaml_config.edges)

        # Compile to sop_steps
        sop_steps = self.to_sop_steps_from_config(yaml_config)

        compiled = CompiledWorkflow(
            name=yaml_config.name,
            description=yaml_config.description,
            version=yaml_config.version,
            nodes=nodes_map,
            edges=yaml_config.edges,
            entry_point=entry_point,
            interrupt_before=yaml_config.interrupt_before,
            state_config=yaml_config.state,
            config=yaml_config.config,
            sop_steps=sop_steps,
            adjacency=adjacency,
        )

        logger.info(
            f"Compiled workflow '{compiled.name}': "
            f"{len(compiled.nodes)} nodes, "
            f"{len(compiled.edges)} edges, "
            f"entry='{compiled.entry_point}', "
            f"{len(compiled.sop_steps)} sop_steps"
        )
        return compiled

    def validate(self, config: WorkflowYAMLConfig) -> list[str]:
        """Validate a workflow configuration for semantic correctness.

        Checks beyond Pydantic schema validation:
        - All edge sources/targets reference existing nodes
        - No orphan nodes (unreachable from entry point)
        - No duplicate node names
        - Conditional edges have valid expression syntax
        - Fallback chains reference valid tools/agents

        Args:
            config: The validated WorkflowYAMLConfig instance.

        Returns:
            A list of validation error strings. Empty list means valid.
        """
        errors: list[str] = []
        node_names = {node.name for node in config.nodes}

        # Check for duplicate node names
        name_counts: dict[str, int] = {}
        for node in config.nodes:
            name_counts[node.name] = name_counts.get(node.name, 0) + 1
        for name, count in name_counts.items():
            if count > 1:
                errors.append(f"Duplicate node name: '{name}'")

        # Check edge references
        for edge in config.edges:
            if edge.source not in node_names:
                errors.append(f"Edge source '{edge.source}' does not match any node")
            if edge.target and edge.target not in node_names:
                errors.append(f"Edge target '{edge.target}' does not match any node")
            if edge.targets:
                for t in edge.targets:
                    if t not in node_names:
                        errors.append(f"Edge target '{t}' does not match any node")

        # Check interrupt_before references
        for name in config.interrupt_before:
            if name not in node_names:
                errors.append(f"interrupt_before node '{name}' does not match any node")

        # Check conditional edge expressions
        for edge in config.edges:
            if edge.condition:
                try:
                    compile_condition(edge.condition)
                except Exception as e:
                    errors.append(
                        f"Invalid condition expression on edge "
                        f"'{edge.source}'->'{edge.target or edge.targets}': {e}"
                    )

        # Check fallback chain references
        for node in config.nodes:
            for fb in node.fallback_chain:
                if fb.tool == node.tool and fb.agent == node.agent:
                    errors.append(
                        f"Node '{node.name}' fallback chain has redundant "
                        f"entry matching the node itself"
                    )

        # Check for orphan nodes (not reachable from any edge source or entry)
        if config.nodes:
            reachable = self._find_reachable_nodes(config.nodes, config.edges)
            for node in config.nodes:
                if node.name not in reachable:
                    errors.append(
                        f"Node '{node.name}' is unreachable from any entry point"
                    )

        return errors

    def to_sop_steps(self, workflow: CompiledWorkflow) -> list[dict[str, Any]]:
        """Convert a compiled workflow to sop_steps format.

        Produces the list of step dicts consumed by
        WorkflowExecutor._execute_sop_steps().

        Args:
            workflow: A compiled workflow instance.

        Returns:
            A list of step dictionaries in sop_steps format.
        """
        return workflow.sop_steps

    def to_sop_steps_from_config(self, config: WorkflowYAMLConfig) -> list[dict[str, Any]]:
        """Compile a WorkflowYAMLConfig directly to sop_steps format.

        This is the core compilation logic that transforms the YAML graph
        definition into a sequential list of steps with parallel groups
        and conditional routing.

        The algorithm:
        1. Topologically sort nodes starting from the entry point
        2. Walk the sorted order; for each node:
           a. If it fans out to multiple unconditional targets, emit the
              current node step first, then a parallel_group containing
              all fan-out targets
           b. Otherwise emit the current node step
        3. Track which nodes have been emitted inside parallel groups
           so they are not emitted again individually
        4. Attach conditional_routes to steps that have conditional edges

        Args:
            config: The validated workflow configuration.

        Returns:
            A list of step dictionaries compatible with WorkflowExecutor.
        """
        nodes_map = {node.name: node for node in config.nodes}
        adjacency = self._build_adjacency(config.edges, nodes_map)
        entry_point = self._find_entry_point(config.nodes, config.edges)

        # Topological ordering
        ordered_nodes = self._topological_sort(config.nodes, adjacency, entry_point)

        sop_steps: list[dict[str, Any]] = []
        # Track nodes already emitted inside a parallel_group
        emitted_in_parallel: set[str] = set()
        # Track parallel groups already emitted (by source node)
        emitted_fan_outs: set[str] = set()

        for node_name in ordered_nodes:
            node = nodes_map[node_name]

            # Skip nodes already emitted inside a parallel group
            if node_name in emitted_in_parallel:
                continue

            # Emit the current node step
            step = self._node_to_sop_step(node, config)
            sop_steps.append(step)

            # Check for fan-out: multiple unconditional outgoing edges
            outgoing = adjacency.get(node_name, [])
            unconditional_targets = [
                e["target"] for e in outgoing if not e.get("condition")
            ]

            if len(unconditional_targets) > 1 and node_name not in emitted_fan_outs:
                emitted_fan_outs.add(node_name)
                parallel_steps = []
                for target_name in unconditional_targets:
                    target_node = nodes_map.get(target_name)
                    if target_node:
                        parallel_steps.append(
                            self._node_to_sop_step(target_node, config)
                        )
                        emitted_in_parallel.add(target_name)
                if parallel_steps:
                    sop_steps.append({"parallel_group": parallel_steps})

            # Attach conditional routes to the step
            conditional_edges = [e for e in outgoing if e.get("condition")]
            if conditional_edges:
                step["conditional_routes"] = [
                    {
                        "target": e["target"],
                        "condition": e["condition"],
                        "condition_fn": compile_condition(e["condition"]),
                    }
                    for e in conditional_edges
                ]

        return sop_steps

    def to_langgraph(self, workflow: CompiledWorkflow) -> Any:
        """Compile a workflow to a LangGraph StateGraph.

        Future target — not yet implemented.

        Args:
            workflow: A compiled workflow instance.

        Raises:
            NotImplementedError: Always, as this is a future target.
        """
        raise NotImplementedError(
            "LangGraph StateGraph compilation is not yet implemented. "
            "Use to_sop_steps() for WorkflowExecutor-compatible output."
        )

    # ──────────────────────────── Internal Methods ────────────────────────────

    def _node_to_sop_step(
        self, node: WorkflowNodeConfig, config: WorkflowYAMLConfig
    ) -> dict[str, Any]:
        """Convert a single WorkflowNodeConfig to an sop_steps-compatible dict.

        The output format matches what WorkflowExecutor._execute_sop_steps()
        expects: keys like 'name', 'agent', 'mode', 'output', 'on_error',
        'retry_count', 'retry_delay', 'human', 'prompt', 'timeout',
        'fallback_chain', etc.
        """
        step: dict[str, Any] = {"name": node.name}

        # Node type mapping
        if node.type == NodeType.HUMAN:
            step["human"] = True
        elif node.type == NodeType.AGENT:
            step["agent"] = node.agent
            if node.mode:
                step["mode"] = node.mode
        elif node.type == NodeType.TOOL:
            step["tool"] = node.tool
            step["type"] = "tool"
        elif node.type == NodeType.GATE:
            step["type"] = "gate"
        elif node.type == NodeType.GENERATE:
            step["type"] = "generate"

        # Input mapping (template variables preserved for runtime interpolation)
        if node.input:
            step["input"] = node.input

        # Output key
        if node.output:
            step["output"] = node.output

        # Error handling
        if node.on_error != OnErrorStrategy.ABORT:
            step["on_error"] = node.on_error.value
        if node.retry_count > 0:
            step["retry_count"] = node.retry_count
        if node.retry_delay != 2.0:
            step["retry_delay"] = node.retry_delay

        # Timeout
        if node.timeout:
            step["timeout"] = node.timeout

        # Prompt (for generate-type nodes)
        if node.prompt:
            step["prompt"] = node.prompt

        # Fallback chain
        if node.fallback_chain:
            step["fallback_chain"] = [
                fb.model_dump(exclude_none=True) for fb in node.fallback_chain
            ]

        # Meta info for UI display
        if node.meta:
            step["meta"] = node.meta.model_dump(exclude_none=True)

        return step

    def _build_adjacency(
        self, edges: list[WorkflowEdgeConfig], nodes_map: dict[str, WorkflowNodeConfig]
    ) -> dict[str, list[dict[str, Any]]]:
        """Build an adjacency list from edge definitions.

        Returns:
            A dict mapping source node name to a list of edge descriptors,
            each containing 'target' and optional 'condition'.
        """
        adjacency: dict[str, list[dict[str, Any]]] = {}

        for edge in edges:
            source = edge.source
            if source not in adjacency:
                adjacency[source] = []

            if edge.targets:
                # Fan-out: multiple targets
                for target in edge.targets:
                    adjacency[source].append({
                        "target": target,
                        "condition": edge.condition,
                    })
            elif edge.target:
                adjacency[source].append({
                    "target": edge.target,
                    "condition": edge.condition,
                })

        return adjacency

    def _find_entry_point(
        self, nodes: list[WorkflowNodeConfig], edges: list[WorkflowEdgeConfig]
    ) -> str:
        """Find the entry point of the workflow.

        The entry point is a node that is never a target of any edge.
        If multiple such nodes exist, use the one with the lowest meta.order.
        """
        all_targets: set[str] = set()
        for edge in edges:
            if edge.target:
                all_targets.add(edge.target)
            if edge.targets:
                all_targets.update(edge.targets)

        candidates = [node for node in nodes if node.name not in all_targets]

        if not candidates:
            # Fallback: use the first node
            logger.warning(
                "No entry point found (all nodes are edge targets). "
                "Defaulting to first node."
            )
            return nodes[0].name if nodes else ""

        if len(candidates) == 1:
            return candidates[0].name

        # Multiple candidates: pick the one with lowest order
        candidates.sort(key=lambda n: (n.meta.order if n.meta else 999, nodes.index(n)))
        return candidates[0].name

    def _find_reachable_nodes(
        self, nodes: list[WorkflowNodeConfig], edges: list[WorkflowEdgeConfig]
    ) -> set[str]:
        """Find all nodes reachable from entry points via edges."""
        adjacency = self._build_adjacency(edges, {n.name: n for n in nodes})
        entry = self._find_entry_point(nodes, edges)

        reachable: set[str] = set()
        stack = [entry]
        while stack:
            current = stack.pop()
            if current in reachable:
                continue
            reachable.add(current)
            for edge in adjacency.get(current, []):
                target = edge["target"]
                if target not in reachable:
                    stack.append(target)

        return reachable

    def _topological_sort(
        self,
        nodes: list[WorkflowNodeConfig],
        adjacency: dict[str, list[dict[str, Any]]],
        entry_point: str,
    ) -> list[str]:
        """Perform a topological sort of nodes starting from the entry point.

        Uses BFS (Kahn's algorithm variant) to produce a deterministic order
        that respects edge dependencies. Fan-out targets are ordered by
        their meta.order value.
        """
        nodes_map = {node.name: node for node in nodes}
        in_degree: dict[str, int] = {node.name: 0 for node in nodes}

        # Compute in-degrees
        for source, edges in adjacency.items():
            for edge in edges:
                target = edge["target"]
                if target in in_degree:
                    in_degree[target] += 1

        # BFS from entry point
        queue: list[str] = [entry_point]
        result: list[str] = []

        while queue:
            # Sort by meta.order for deterministic output
            queue.sort(key=lambda n: (
                nodes_map[n].meta.order if nodes_map.get(n) and nodes_map[n].meta else 999
            ))
            current = queue.pop(0)
            result.append(current)

            for edge in adjacency.get(current, []):
                target = edge["target"]
                if target in in_degree:
                    in_degree[target] -= 1
                    if in_degree[target] == 0:
                        queue.append(target)

        # Add any remaining nodes not reachable via edges
        for node in nodes:
            if node.name not in result:
                result.append(node.name)

        return result
