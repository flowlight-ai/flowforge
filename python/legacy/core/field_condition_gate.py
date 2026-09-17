"""FlowForge FieldConditionGate — gate type that checks field conditions.

Unlike the dimension-based GateOrchestrator which uses LLM evaluators,
FieldConditionGate performs deterministic checks on state fields.

Gate YAML format:
    name: "concept_approved"
    type: "field_condition"
    description: "概念包审批"
    next_status: "concept_approved"
    next_phase: "outline"
    checks:
      - field: "concept_package.logline"
        condition: "not_empty"
        message: "缺少一句话梗概"
      - field: "outline.outline_score"
        condition: ">= 60"
        allow_missing: true
    require_human: false
"""
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.field_condition_gate")


class FieldConditionGate:
    """Deterministic quality gate that checks state field conditions."""

    def __init__(self, gates_config: dict = None):
        self.gates = gates_config or {}
        logger.info(f"FieldConditionGate.__init__: loaded {len(self.gates)} gates: "
                     f"{list(self.gates.keys())}")

    def check(self, gate_name: str, state: dict) -> dict:
        """Check a named gate against the given state.

        Returns:
            {"passed": bool, "gate": str, "failures": list, "next_status": str|None, "next_phase": str|None}
        """
        logger.info(f"FieldConditionGate.check: gate='{gate_name}', "
                     f"state_keys={list(state.keys()) if isinstance(state, dict) else type(state).__name__}")

        gate = self.gates.get(gate_name)
        if not gate:
            logger.warning(f"FieldConditionGate.check: unknown gate '{gate_name}', "
                           f"available={list(self.gates.keys())}")
            return {"passed": False, "reason": f"Unknown gate: {gate_name}"}

        checks = gate.get("checks", [])
        logger.info(f"FieldConditionGate.check: gate='{gate_name}' has {len(checks)} checks")

        failures = []
        for i, check in enumerate(checks):
            field_path = check["field"]
            condition = check["condition"]
            allow_missing = check.get("allow_missing", False)

            value = self._resolve_field(state, field_path)
            logger.info(f"FieldConditionGate.check: [{i}] field='{field_path}', "
                         f"condition='{condition}', resolved_value={repr(value)[:200]}, "
                         f"allow_missing={allow_missing}")

            ok = self._evaluate(value, condition, allow_missing=allow_missing)
            logger.info(f"FieldConditionGate.check: [{i}] field='{field_path}' -> "
                         f"eval_result={'PASS' if ok else 'FAIL'}")

            if not ok:
                failure_msg = check.get("message",
                    f"Field {field_path} failed condition {condition}")
                failures.append({
                    "field": field_path,
                    "condition": condition,
                    "message": failure_msg,
                })
                logger.info(f"FieldConditionGate.check: [{i}] failure: {failure_msg}")

        if failures:
            logger.info(f"FieldConditionGate.check: gate='{gate_name}' FAILED "
                         f"with {len(failures)} failures")
            return {
                "passed": False,
                "gate": gate_name,
                "failures": failures,
                "next_status": None,
                "next_phase": None,
            }

        next_status = gate.get("next_status")
        next_phase = gate.get("next_phase")
        logger.info(f"FieldConditionGate.check: gate='{gate_name}' PASSED, "
                     f"next_status='{next_status}', next_phase='{next_phase}'")
        return {
            "passed": True,
            "gate": gate_name,
            "failures": [],
            "next_status": next_status,
            "next_phase": next_phase,
        }

    @staticmethod
    def _resolve_field(state: dict, field_path: str):
        """Resolve a dotted field path (with array index support) from state."""
        parts = field_path.replace("]", "").replace("[", ".").split(".")
        current = state
        for part in parts:
            if not part:
                continue
            if isinstance(current, dict):
                current = current.get(part)
            elif isinstance(current, (list, tuple)):
                try:
                    idx = int(part)
                    current = current[idx] if -len(current) <= idx < len(current) else None
                except (ValueError, IndexError):
                    return None
            else:
                return None
            if current is None:
                return None
        return current

    @staticmethod
    def _evaluate(value, condition: str, allow_missing: bool = False) -> bool:
        """Evaluate a condition against a resolved value."""
        if value is None:
            return allow_missing
        if condition == "not_empty":
            return bool(value)
        if condition == "== true":
            return value is True
        if condition.startswith("length >= "):
            threshold = int(condition.split(">= ")[1])
            return len(value) >= threshold
        if condition.startswith("length == "):
            threshold = int(condition.split("== ")[1])
            return len(value) == threshold
        if condition.startswith(">= "):
            threshold = float(condition.split(">= ")[1])
            try:
                return float(value) >= threshold
            except (TypeError, ValueError):
                return False
        return False

    @classmethod
    def from_yaml(cls, yaml_path: str) -> "FieldConditionGate":
        """Load gate definitions from a YAML file."""
        import yaml
        logger.info(f"FieldConditionGate.from_yaml: loading from '{yaml_path}'")
        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        gates = data.get("gates", {})
        # Normalize field names: to_phase -> next_phase, from_phase is informational
        for gate_name, gate_def in gates.items():
            if isinstance(gate_def, dict):
                if "to_phase" in gate_def and "next_phase" not in gate_def:
                    gate_def["next_phase"] = gate_def["to_phase"]
        logger.info(f"FieldConditionGate.from_yaml: loaded {len(gates)} gates: {list(gates.keys())}")
        return cls(gates_config=gates)
