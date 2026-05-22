"""ArchitectureConstraintEngine — Layer dependency checking using ast module.

Parses Python source files using the ``ast`` module to extract import
statements, then validates them against a layer mapping defined in
``layer_mapping.yaml``. Enforces the rule that lower layers must not
import from higher layers (unidirectional dependency).

Layer order (low → high): Types → Config → Repo → Service → Runtime → UI
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import yaml

from flowforge.core.errors import HarnessViolationError
from flowforge.core.tracing import get_logger
from flowforge.core.task_context import TaskContext

logger = get_logger("harness.arch_constraint_engine")

DEFAULT_LAYER_ORDER = ["types", "config", "repo", "service", "runtime", "ui"]


class ArchitectureConstraintEngine:
    """Validates layer dependencies in Python source code.

    Uses the ``ast`` module to parse imports from source files and checks
    them against a layer mapping (module path prefix → layer name). Any
    import that violates the unidirectional dependency rule (lower layer
    importing from a higher layer) is flagged as a violation.

    Attributes:
        layer_order: Ordered list of layer names from lowest to highest.
        layer_mapping: Dictionary mapping module path prefixes to layer names.
    """

    def __init__(
        self,
        layer_mapping_path: Optional[Path] = None,
        layer_order: Optional[List[str]] = None,
    ) -> None:
        self.layer_order = layer_order or list(DEFAULT_LAYER_ORDER)
        self._layer_rank = {name: idx for idx, name in enumerate(self.layer_order)}
        self.layer_mapping: Dict[str, str] = {}
        if layer_mapping_path and layer_mapping_path.is_file():
            self._load_layer_mapping(layer_mapping_path)
        else:
            self._build_default_mapping()

    def _load_layer_mapping(self, path: Path) -> None:
        """Load layer mapping from a YAML file.

        Expected format:
            layer_order: [types, config, repo, service, runtime, ui]
            mapping:
              flowforge.core.types: types
              flowforge.core.config: config
              ...

        Args:
            path: Path to the layer_mapping.yaml file.
        """
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        except (OSError, yaml.YAMLError) as exc:
            logger.warning("Failed to load layer_mapping.yaml", path=str(path), error=str(exc))
            self._build_default_mapping()
            return

        if "layer_order" in data and isinstance(data["layer_order"], list):
            self.layer_order = data["layer_order"]
            self._layer_rank = {name: idx for idx, name in enumerate(self.layer_order)}

        raw_mapping = data.get("mapping", {})
        if isinstance(raw_mapping, dict):
            self.layer_mapping = {str(k): str(v) for k, v in raw_mapping.items()}
        else:
            self._build_default_mapping()

        logger.info(
            "Layer mapping loaded",
            path=str(path),
            layers=len(self.layer_order),
            mappings=len(self.layer_mapping),
        )

    def _build_default_mapping(self) -> None:
        """Build a default layer mapping based on common FlowForge module paths."""
        self.layer_mapping = {
            "flowforge.core.errors": "types",
            "flowforge.core.base_agent": "types",
            "flowforge.core.base_tool": "types",
            "flowforge.core.tracing": "types",
            "flowforge.core.task_context": "types",
            "flowforge.core.config": "config",
            "flowforge.core.di": "config",
            "flowforge.core.secret_store": "config",
            "flowforge.memory": "repo",
            "flowforge.core.checkpoint_manager": "repo",
            "flowforge.core.agent_registry": "service",
            "flowforge.core.plugin_manager": "service",
            "flowforge.core.prompt_manager": "service",
            "flowforge.core.metrics": "service",
            "flowforge.core.circuit_breaker": "service",
            "flowforge.core.agent_timeout": "service",
            "flowforge.tools": "service",
            "flowforge.core.tool_chain_executor": "runtime",
            "flowforge.modes": "runtime",
            "flowforge.executor": "runtime",
            "flowforge.scheduler": "runtime",
            "flowforge.agents": "runtime",
            "flowforge.events": "runtime",
            "flowforge.app": "ui",
            "flowforge.web": "ui",
        }

    def resolve_layer(self, module_path: str) -> Optional[str]:
        """Resolve a module path to its layer name.

        Matches the module path against the longest prefix in the layer
        mapping.

        Args:
            module_path: Fully qualified module path (e.g. ``flowforge.core.errors``).

        Returns:
            The layer name, or ``None`` if no mapping is found.
        """
        best_match: Optional[str] = None
        best_len = 0
        for prefix, layer in self.layer_mapping.items():
            if module_path == prefix or module_path.startswith(prefix + "."):
                if len(prefix) > best_len:
                    best_match = layer
                    best_len = len(prefix)
        return best_match

    def parse_imports(self, source_code: str) -> List[str]:
        """Parse import statements from Python source code using ast.

        Extracts all imported module paths from both ``import`` and
        ``from ... import`` statements.

        Args:
            source_code: Python source code as a string.

        Returns:
            A list of fully qualified module paths that are imported.
        """
        try:
            tree = ast.parse(source_code)
        except SyntaxError as exc:
            logger.warning("Failed to parse source code", error=str(exc))
            return []

        imports: List[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imports.append(alias.name)
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    imports.append(node.module)

        return imports

    async def validate(
        self,
        source_code: str,
        source_module: str,
        ctx: TaskContext,
    ) -> Dict[str, Any]:
        """Validate that source code respects layer dependency rules.

        Parses the source code to extract imports, resolves each import
        to its layer, and checks that the source module's layer is not
        lower than any imported module's layer.

        Args:
            source_code: The Python source code to validate.
            source_module: The fully qualified module path of the source.
            ctx: The current TaskContext.

        Returns:
            A dictionary with ``valid`` (bool), ``violations`` (list),
            ``source_layer``, and ``checked_imports``.
        """
        source_layer = self.resolve_layer(source_module)
        if source_layer is None:
            return {
                "valid": True,
                "violations": [],
                "source_layer": None,
                "checked_imports": 0,
                "message": "Source module not in layer mapping, skipping validation",
            }

        source_rank = self._layer_rank.get(source_layer, -1)
        imports = self.parse_imports(source_code)
        violations: List[Dict[str, Any]] = []

        for imp in imports:
            imp_layer = self.resolve_layer(imp)
            if imp_layer is None:
                continue

            imp_rank = self._layer_rank.get(imp_layer, -1)
            if imp_rank < 0:
                continue

            if imp_rank > source_rank:
                violations.append({
                    "source_module": source_module,
                    "source_layer": source_layer,
                    "imported_module": imp,
                    "imported_layer": imp_layer,
                    "violation": f"Layer '{source_layer}' (rank {source_rank}) imports from higher layer '{imp_layer}' (rank {imp_rank})",
                })

        result: Dict[str, Any] = {
            "valid": len(violations) == 0,
            "violations": violations,
            "source_layer": source_layer,
            "checked_imports": len(imports),
        }

        if violations:
            logger.warning(
                "Layer dependency violations detected",
                task_id=ctx.task_id,
                source_module=source_module,
                violation_count=len(violations),
            )
            ctx.state["harness_violations"] = ctx.state.get("harness_violations", [])
            ctx.state["harness_violations"].extend(violations)

        return result

    async def validate_file(self, file_path: Path, ctx: TaskContext) -> Dict[str, Any]:
        """Validate a single Python file against layer dependency rules.

        Args:
            file_path: Path to the Python file.
            ctx: The current TaskContext.

        Returns:
            Validation result dictionary.
        """
        try:
            source_code = file_path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("Failed to read file for validation", path=str(file_path), error=str(exc))
            return {"valid": True, "violations": [], "source_layer": None, "checked_imports": 0}

        relative = file_path.relative_to(Path.cwd()) if file_path.is_absolute() else file_path
        module_path = str(relative.with_suffix("")).replace(os.sep, ".")

        return await self.validate(source_code, module_path, ctx)

    async def validate_directory(self, dir_path: Path, ctx: TaskContext) -> Dict[str, Any]:
        """Validate all Python files in a directory against layer dependency rules.

        Args:
            dir_path: Path to the directory to validate.
            ctx: The current TaskContext.

        Returns:
            Aggregated validation result dictionary.
        """
        all_violations: List[Dict[str, Any]] = []
        files_checked = 0

        for py_file in dir_path.rglob("*.py"):
            result = await self.validate_file(py_file, ctx)
            files_checked += 1
            all_violations.extend(result.get("violations", []))

        return {
            "valid": len(all_violations) == 0,
            "violations": all_violations,
            "files_checked": files_checked,
        }


import os  # noqa: E402 — needed for os.sep in validate_file
