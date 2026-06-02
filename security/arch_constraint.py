"""Architecture Constraint Engine - Dependency validation.

Implements FR-HRN-02:
- Layered dependency model (Types→Config→Repo→Service→Runtime→UI)
- Custom Linter rules
- CI gate
- Violation injection into agent context
- Dependency extraction using Python ast module + layer_mapping.yaml

Phase 1: Python only
Phase 2: Multi-language support
"""

import ast
import os
from typing import Optional, Dict, Any, List, Set, Tuple
from flowforge.core.tracing import get_logger

logger = get_logger("security.arch_constraint")

# Default layer ordering (lower layers cannot import from higher layers)
DEFAULT_LAYER_ORDER = ["types", "config", "repo", "service", "runtime", "ui"]

DEFAULT_LAYER_MAPPING = {
    "flowforge.app": 0,
    "flowforge.brain": 1,
    "flowforge.modes": 2,
    "flowforge.workers": 2,
    "flowforge.agents": 2,
    "flowforge.tools": 3,
    "flowforge.memory": 3,
    "flowforge.core": 4,
}


class ArchitectureConstraintEngine:
    """Architecture constraint engine.

    Validates that code follows the layered dependency model,
    preventing lower layers from importing from higher layers.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.layer_order = self.config.get("layer_order", DEFAULT_LAYER_ORDER)
        self.layer_mapping = self.config.get("layer_mapping", {})
        self.enabled = self.config.get("enabled", True)
        self._violation_count = 0
        self._check_count = 0
        self._violations: List[Dict[str, Any]] = []

    def get_layer(self, module_path: str) -> Optional[str]:
        mapping = self.layer_mapping or DEFAULT_LAYER_MAPPING
        for layer, patterns in mapping.items():
            if isinstance(patterns, str):
                patterns = [patterns]
            for pattern in patterns:
                if pattern in module_path:
                    return layer
        return None

    def extract_dependencies(self, source_code: str) -> List[str]:
        """Extract import dependencies from Python source code.

        Uses the ast module to parse import statements.
        """
        dependencies = []
        try:
            tree = ast.parse(source_code)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        dependencies.append(alias.name)
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        dependencies.append(node.module)
        except SyntaxError:
            logger.warning("Failed to parse source code for dependency extraction")

        return dependencies

    def check_dependency(
        self,
        source_module: str,
        target_module: str,
    ) -> Optional[Dict[str, Any]]:
        """Check if a dependency violates the layer model.

        Returns None if valid, or a violation dict if invalid.
        """
        if not self.enabled:
            return None

        source_layer = self.get_layer(source_module)
        target_layer = self.get_layer(target_module)

        if source_layer is None or target_layer is None:
            return None

        if source_layer == target_layer:
            return None

        source_idx = self.layer_order.index(source_layer) if source_layer in self.layer_order else -1
        target_idx = self.layer_order.index(target_layer) if target_layer in self.layer_order else -1

        if source_idx < 0 or target_idx < 0:
            return None

        # Lower layer importing from higher layer = violation
        if source_idx < target_idx:
            violation = {
                "source_module": source_module,
                "source_layer": source_layer,
                "target_module": target_module,
                "target_layer": target_layer,
                "violation_type": "reverse_dependency",
                "message": f"Layer '{source_layer}' ({source_module}) cannot import from '{target_layer}' ({target_module})",
            }
            self._violations.append(violation)
            self._violation_count += 1
            return violation

        return None

    def check_file(self, file_path: str) -> List[Dict[str, Any]]:
        """Check a single file for dependency violations."""
        if not self.enabled:
            return []

        if not os.path.exists(file_path):
            return []

        self._check_count += 1
        violations = []

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                source = f.read()

            deps = self.extract_dependencies(source)
            for dep in deps:
                violation = self.check_dependency(file_path, dep)
                if violation:
                    violations.append(violation)
        except Exception as e:
            logger.warning(f"Failed to check file {file_path}: {e}")

        return violations

    def inject_violations_into_context(self, ctx, violations: List[Dict[str, Any]]):
        """Inject violation information into agent context.

        This allows agents to be aware of architecture violations
        and potentially self-correct.
        """
        if not violations or not hasattr(ctx, 'metadata'):
            return

        ctx.metadata["arch_violations"] = [
            v["message"] for v in violations
        ]

    def get_status(self) -> dict:
        """Get constraint engine status."""
        return {
            "enabled": self.enabled,
            "layer_order": self.layer_order,
            "layer_mapping_configured": bool(self.layer_mapping),
            "check_count": self._check_count,
            "violation_count": self._violation_count,
            "recent_violations": self._violations[-10:],
        }
