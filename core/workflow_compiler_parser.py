"""FWK-01 Stage 1: Workflow YAML Parser.

Parses YAML workflow definitions into an Intermediate Representation (IR)
that is consumed by the Validator and CodeGen stages.

IR classes:
- WorkflowIR: Top-level workflow representation
- StepIR: Individual step/node in the workflow
- EdgeIR: Transition between steps
- ConditionIR: Conditional routing logic

Supported step types: SEQUENCE, CONDITIONAL, PARALLEL, FALLBACK, LOOP, GATE
Variable references: ${{state.xxx}}, ${{params.xxx}}, ${{result.xxx}}, ${{outputs.xxx.yyy}}
"""

from __future__ import annotations

import re
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("workflow_compiler.parser")


# ──────────────────────────── Enums ────────────────────────────


class StepType(str, Enum):
    """Supported step types in a workflow."""
    SEQUENCE = "sequence"
    CONDITIONAL = "conditional"
    PARALLEL = "parallel"
    FALLBACK = "fallback"
    LOOP = "loop"
    GATE = "gate"


class Severity(str, Enum):
    """Validation issue severity."""
    ERROR = "error"
    WARNING = "warning"


# ──────────────────────────── Variable Reference ────────────────────────────


_VAR_REF_PATTERN = re.compile(
    r"\$\{\{\s*"
    r"(state|params|result|outputs)"
    r"\.([\w.\[\]]+)"
    r"\s*\}\}"
)

_LEGACY_VAR_REF_PATTERN = re.compile(
    r"\{\{\s*"
    r"(state|params|result|outputs|auto)"
    r"\.([\w.\[\]]+)"
    r"\s*\}\}"
)


class VariableRef(BaseModel):
    """A parsed variable reference like ${{state.topic_list}}."""
    prefix: str  # state | params | result | outputs
    path: str    # e.g. "topic_list", "audit_result.score"
    raw: str     # original string e.g. "${{state.topic_list}}"

    model_config = {"frozen": True}


def parse_variable_refs(text: str) -> List[VariableRef]:
    """Extract all variable references from a string.

    Supports both ${{prefix.path}} and legacy {{prefix.path}} formats.

    Args:
        text: The string to parse for variable references.

    Returns:
        A list of VariableRef instances found in the text.
    """
    refs: List[VariableRef] = []
    seen: set[str] = set()

    for match in _VAR_REF_PATTERN.finditer(text):
        prefix, path = match.group(1), match.group(2)
        raw = match.group(0)
        key = f"{prefix}.{path}"
        if key not in seen:
            seen.add(key)
            refs.append(VariableRef(prefix=prefix, path=path, raw=raw))

    for match in _LEGACY_VAR_REF_PATTERN.finditer(text):
        prefix, path = match.group(1), match.group(2)
        # Map 'auto' to 'state' for consistency
        if prefix == "auto":
            prefix = "state"
        raw = match.group(0)
        key = f"{prefix}.{path}"
        if key not in seen:
            seen.add(key)
            refs.append(VariableRef(prefix=prefix, path=path, raw=raw))

    return refs


def extract_variable_refs_from_value(value: Any) -> List[VariableRef]:
    """Recursively extract variable references from any value (dict, list, str)."""
    refs: List[VariableRef] = []
    if isinstance(value, str):
        refs.extend(parse_variable_refs(value))
    elif isinstance(value, dict):
        for v in value.values():
            refs.extend(extract_variable_refs_from_value(v))
    elif isinstance(value, list):
        for item in value:
            refs.extend(extract_variable_refs_from_value(item))
    return refs


# ──────────────────────────── IR Classes ────────────────────────────


class ConditionIR(BaseModel):
    """A conditional routing entry."""
    expression: str
    target: str
    variable_refs: List[VariableRef] = Field(default_factory=list)

    model_config = {"arbitrary_types_allowed": True}


class ExecutionPolicyIR(BaseModel):
    """Parsed execution policy for a step."""
    timeout: int = 300
    retry: int = 2
    on_error: str = "fallback"
    on_anomaly: str = "reflect"

    model_config = {"extra": "allow"}


class CheckpointIR(BaseModel):
    """Parsed checkpoint configuration."""
    enabled: bool = True
    backend: str = "sqlite"
    path: str = "data/checkpoints.db"
    every_n_steps: int = 5

    model_config = {"extra": "allow"}


class StateUpdateIR(BaseModel):
    """A single state update entry."""
    key: str
    expression: str
    variable_refs: List[VariableRef] = Field(default_factory=list)

    model_config = {"arbitrary_types_allowed": True}


class EdgeIR(BaseModel):
    """A transition edge between steps."""
    source: str
    target: Optional[str] = None
    targets: Optional[List[str]] = None
    condition: Optional[str] = None
    conditions: List[ConditionIR] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class StepIR(BaseModel):
    """A single step/node in the workflow IR."""
    name: str
    step_type: StepType = StepType.SEQUENCE
    agent: Optional[str] = None
    tool: Optional[str] = None
    mode: Optional[str] = None
    prompt: Optional[str] = None
    input: Optional[Dict[str, Any]] = None
    output: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None
    execution_policy: Optional[ExecutionPolicyIR] = None
    checkpoint: Optional[CheckpointIR] = None
    state_updates: List[StateUpdateIR] = Field(default_factory=list)
    fallback_chain: Optional[List[Dict[str, Any]]] = None
    variable_refs: List[VariableRef] = Field(default_factory=list)
    # Agent namespace: {project}:{agent_name}
    agent_namespace: Optional[str] = None

    model_config = {"arbitrary_types_allowed": True, "extra": "allow"}


class WorkflowIR(BaseModel):
    """Top-level workflow Intermediate Representation."""
    name: str
    description: str = ""
    version: float = 1.0
    steps: List[StepIR] = Field(default_factory=list)
    edges: List[EdgeIR] = Field(default_factory=list)
    entry_point: Optional[str] = None
    interrupt_before: List[str] = Field(default_factory=list)
    state_config: Optional[Dict[str, Any]] = None
    config: Optional[Dict[str, Any]] = None
    checkpoint: Optional[CheckpointIR] = None
    source_path: Optional[str] = None

    model_config = {"arbitrary_types_allowed": True, "extra": "allow"}


# ──────────────────────────── Parser ────────────────────────────


class WorkflowParser:
    """Stage 1: Parse YAML workflow definitions into IR.

    The parser is responsible for:
    1. Loading YAML from file or dict
    2. Converting raw YAML into structured IR objects
    3. Extracting variable references from all string values
    4. Parsing agent namespaces (project:agent format)
    5. Parsing execution_policy, checkpoint, state_updates
    """

    def parse_from_yaml(self, yaml_path: str) -> WorkflowIR:
        """Parse a workflow YAML file into IR.

        Args:
            yaml_path: Path to the YAML workflow definition file.

        Returns:
            A WorkflowIR instance.

        Raises:
            FileNotFoundError: If the YAML file does not exist.
            ValueError: If the YAML content is invalid.
        """
        path = Path(yaml_path)
        if not path.exists():
            raise FileNotFoundError(f"Workflow YAML file not found: {yaml_path}")

        with open(path, "r", encoding="utf-8") as f:
            raw_config = yaml.safe_load(f)

        if not isinstance(raw_config, dict):
            raise ValueError(f"Invalid YAML: expected mapping, got {type(raw_config).__name__}")

        logger.info(f"Loaded workflow YAML from {yaml_path}")
        return self.parse_from_dict(raw_config, source_path=yaml_path)

    def parse_from_dict(self, config: dict[str, Any], source_path: Optional[str] = None) -> WorkflowIR:
        """Parse a workflow config dict into IR.

        Args:
            config: A dictionary matching the workflow YAML schema.
            source_path: Optional path to the source YAML file.

        Returns:
            A WorkflowIR instance.
        """
        # Parse steps
        steps = []
        for node_config in config.get("nodes", []):
            step = self._parse_step(node_config)
            steps.append(step)

        # Parse edges
        edges = []
        for edge_config in config.get("edges", []):
            edge = self._parse_edge(edge_config)
            edges.append(edge)

        # Parse checkpoint
        checkpoint = None
        if "checkpoint" in config:
            checkpoint = self._parse_checkpoint(config["checkpoint"])

        # Determine entry point
        entry_point = config.get("entry_point")
        if not entry_point and steps:
            entry_point = self._infer_entry_point(steps, edges)

        # Parse state config
        state_config = None
        if "state" in config:
            state_raw = config["state"]
            if isinstance(state_raw, dict):
                state_config = state_raw

        # Parse top-level config
        top_config = config.get("config")

        ir = WorkflowIR(
            name=config.get("name", "unnamed"),
            description=config.get("description", ""),
            version=config.get("version", 1.0),
            steps=steps,
            edges=edges,
            entry_point=entry_point,
            interrupt_before=config.get("interrupt_before", []),
            state_config=state_config,
            config=top_config,
            checkpoint=checkpoint,
            source_path=source_path,
        )

        logger.info(
            f"Parsed workflow IR '{ir.name}': "
            f"{len(ir.steps)} steps, {len(ir.edges)} edges, "
            f"entry='{ir.entry_point}'"
        )
        return ir

    # ──────────────────────────── Step Parsing ────────────────────────────

    def _parse_step(self, node_config: dict[str, Any]) -> StepIR:
        """Parse a single node/step config into StepIR."""
        name = node_config.get("name", "")
        step_type = self._determine_step_type(node_config)

        # Parse agent namespace
        agent = node_config.get("agent")
        agent_namespace = None
        if agent and ":" in agent:
            agent_namespace = agent

        # Parse execution_policy
        execution_policy = None
        if "execution_policy" in node_config:
            execution_policy = self._parse_execution_policy(node_config["execution_policy"])
        elif any(k in node_config for k in ("timeout", "retry_count", "on_error")):
            # Backward compat: inline policy fields
            execution_policy = ExecutionPolicyIR(
                timeout=node_config.get("timeout", 300),
                retry=node_config.get("retry_count", 2),
                on_error=node_config.get("on_error", "fallback"),
                on_anomaly=node_config.get("on_anomaly", "reflect"),
            )

        # Parse checkpoint
        checkpoint = None
        if "checkpoint" in node_config:
            checkpoint = self._parse_checkpoint(node_config["checkpoint"])

        # Parse state_updates
        state_updates = []
        if "state_updates" in node_config:
            state_updates = self._parse_state_updates(node_config["state_updates"])

        # Collect variable refs from all string values in the step
        variable_refs: List[VariableRef] = []
        for field in ("prompt", "output"):
            val = node_config.get(field)
            if isinstance(val, str):
                variable_refs.extend(parse_variable_refs(val))
        if node_config.get("input"):
            variable_refs.extend(extract_variable_refs_from_value(node_config["input"]))
        for su in state_updates:
            variable_refs.extend(su.variable_refs)

        # Deduplicate variable refs
        seen_keys: set[str] = set()
        unique_refs: List[VariableRef] = []
        for ref in variable_refs:
            key = f"{ref.prefix}.{ref.path}"
            if key not in seen_keys:
                seen_keys.add(key)
                unique_refs.append(ref)

        return StepIR(
            name=name,
            step_type=step_type,
            agent=agent,
            tool=node_config.get("tool"),
            mode=node_config.get("mode"),
            prompt=node_config.get("prompt"),
            input=node_config.get("input"),
            output=node_config.get("output"),
            meta=node_config.get("meta"),
            execution_policy=execution_policy,
            checkpoint=checkpoint,
            state_updates=state_updates,
            fallback_chain=node_config.get("fallback_chain"),
            variable_refs=unique_refs,
            agent_namespace=agent_namespace,
        )

    def _determine_step_type(self, node_config: dict[str, Any]) -> StepType:
        """Determine the StepType from a node config."""
        # Explicit type field
        node_type = node_config.get("type", "").lower()

        type_mapping = {
            "agent": StepType.SEQUENCE,
            "tool": StepType.SEQUENCE,
            "generate": StepType.SEQUENCE,
            "human": StepType.GATE,
            "gate": StepType.GATE,
            "sequence": StepType.SEQUENCE,
            "conditional": StepType.CONDITIONAL,
            "parallel": StepType.PARALLEL,
            "fallback": StepType.FALLBACK,
            "loop": StepType.LOOP,
        }

        if node_type in type_mapping:
            return type_mapping[node_type]

        # Infer from structure
        if node_config.get("conditional_router") or node_config.get("conditions"):
            return StepType.CONDITIONAL
        if node_config.get("fallback_chain"):
            return StepType.FALLBACK
        if node_config.get("loop_config") or node_config.get("loop"):
            return StepType.LOOP

        return StepType.SEQUENCE

    # ──────────────────────────── Edge Parsing ────────────────────────────

    def _parse_edge(self, edge_config: dict[str, Any]) -> EdgeIR:
        """Parse an edge config into EdgeIR."""
        condition_str = edge_config.get("condition")
        conditions: List[ConditionIR] = []

        # Parse conditional_router if present
        router = edge_config.get("conditional_router")
        if router and isinstance(router, dict):
            for cond in router.get("conditions", []):
                if isinstance(cond, dict):
                    expr = cond.get("expression", cond.get("condition", ""))
                    target = cond.get("target", "")
                    if expr and target:
                        var_refs = parse_variable_refs(expr)
                        conditions.append(ConditionIR(
                            expression=expr,
                            target=target,
                            variable_refs=var_refs,
                        ))

        # Parse inline condition
        if condition_str and not conditions:
            var_refs = parse_variable_refs(condition_str)
            conditions.append(ConditionIR(
                expression=condition_str,
                target=edge_config.get("target", ""),
                variable_refs=var_refs,
            ))

        return EdgeIR(
            source=edge_config.get("source", ""),
            target=edge_config.get("target"),
            targets=edge_config.get("targets"),
            condition=condition_str,
            conditions=conditions,
        )

    # ──────────────────────────── Policy / Checkpoint / StateUpdates ────────────────────────────

    def _parse_execution_policy(self, policy_config: dict[str, Any]) -> ExecutionPolicyIR:
        """Parse an execution_policy config."""
        return ExecutionPolicyIR(
            timeout=policy_config.get("timeout", 300),
            retry=policy_config.get("retry", 2),
            on_error=policy_config.get("on_error", "fallback"),
            on_anomaly=policy_config.get("on_anomaly", "reflect"),
        )

    def _parse_checkpoint(self, checkpoint_config: dict[str, Any]) -> CheckpointIR:
        """Parse a checkpoint config."""
        return CheckpointIR(
            enabled=checkpoint_config.get("enabled", True),
            backend=checkpoint_config.get("backend", "sqlite"),
            path=checkpoint_config.get("path", "data/checkpoints.db"),
            every_n_steps=checkpoint_config.get("every_n_steps", 5),
        )

    def _parse_state_updates(self, updates_config: dict[str, Any]) -> List[StateUpdateIR]:
        """Parse state_updates config into a list of StateUpdateIR."""
        result: List[StateUpdateIR] = []
        if not isinstance(updates_config, dict):
            return result
        for key, expression in updates_config.items():
            expr_str = str(expression) if not isinstance(expression, str) else expression
            var_refs = parse_variable_refs(expr_str)
            result.append(StateUpdateIR(
                key=key,
                expression=expr_str,
                variable_refs=var_refs,
            ))
        return result

    # ──────────────────────────── Entry Point Inference ────────────────────────────

    def _infer_entry_point(self, steps: List[StepIR], edges: List[EdgeIR]) -> str:
        """Infer the entry point from steps and edges.

        The entry point is a step that is never a target of any edge.
        """
        all_targets: set[str] = set()
        for edge in edges:
            if edge.target:
                all_targets.add(edge.target)
            if edge.targets:
                all_targets.update(edge.targets)

        candidates = [s for s in steps if s.name not in all_targets]

        if not candidates:
            return steps[0].name if steps else ""

        if len(candidates) == 1:
            return candidates[0].name

        # Multiple candidates: pick lowest meta.order
        candidates.sort(key=lambda s: (s.meta or {}).get("order", 999))
        return candidates[0].name
