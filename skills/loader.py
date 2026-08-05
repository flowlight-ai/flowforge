"""FlowForge Skill Loader — multi-format skill file parser.

Supports four skill formats:
- FlowForge native (YAML/JSON)
- Claude Code skill format
- Anthropic skill format
- Trae CN skill format

Auto-detects format based on file structure and naming conventions.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from flowforge.core.tracing import get_logger
from flowforge.skills.base import (
    FlowForgeNativeSkill,
    SkillBase,
    SkillFormat,
    SkillOutput,
    SkillStep,
    SkillTrigger,
)

logger = get_logger("flowforge.skills.loader")


class SkillLoader:
    """Load skill definitions from files and directories.

    Supports dual-layer loading (global + project) and auto-detection
    of skill format based on file structure.
    """

    # File extensions that may contain skill definitions
    SKILL_EXTENSIONS = {".yaml", ".yml", ".json", ".md"}

    def load_from_directory(self, dir_path: str) -> list[SkillBase]:
        """Load all skill files from a directory.

        Scans recursively for files with recognized extensions and
        attempts to parse each as a skill definition.

        Args:
            dir_path: Absolute or relative path to the skills directory.

        Returns:
            List of successfully loaded SkillBase instances.
        """
        skills: list[SkillBase] = []
        dir_path_obj = Path(dir_path)

        if not dir_path_obj.exists():
            logger.debug(f"Skills directory does not exist: {dir_path}")
            return skills

        if not dir_path_obj.is_dir():
            logger.warning(f"Skills path is not a directory: {dir_path}")
            return skills

        for file_path in sorted(dir_path_obj.rglob("*")):
            if file_path.suffix not in self.SKILL_EXTENSIONS:
                continue
            if file_path.name.startswith("_"):
                continue

            try:
                skill = self._load_file(str(file_path))
                if skill is not None:
                    skills.append(skill)
                    logger.debug(f"Loaded skill: {skill.name} from {file_path}")
            except Exception as exc:
                logger.warning(
                    f"Failed to load skill from {file_path}: {exc}"
                )

        return skills

    def _load_file(self, file_path: str) -> SkillBase | None:
        """Auto-detect format and load a single skill file."""
        path = Path(file_path)

        # Try to detect format from file content
        format_detected = self._detect_format(path)

        if format_detected == SkillFormat.FLOWFORGE:
            return self.load_flowforge_skill(file_path)
        elif format_detected == SkillFormat.CLAUDE_CODE:
            return self.load_claude_code_skill(file_path)
        elif format_detected == SkillFormat.ANTHROPIC:
            return self.load_anthropic_skill(file_path)
        elif format_detected == SkillFormat.TRAE_CN:
            return self.load_trae_cn_skill(file_path)

        return None

    def _detect_format(self, path: Path) -> SkillFormat | None:
        """Detect skill format from file structure and content.

        Detection heuristics:
        - FlowForge: YAML/JSON with top-level ``format: flowforge`` or
          ``steps`` key
        - Claude Code: Markdown files in a ``commands/`` directory, or
          files with ``---`` frontmatter containing Claude-specific keys
        - Anthropic: YAML/JSON with ``anthropic`` or ``claude`` markers
        - Trae CN: YAML with ``.trae.`` in filename or ``trae`` in content
        """
        name_lower = path.name.lower()
        suffix = path.suffix.lower()

        # Trae CN: filename contains .trae.
        if ".trae." in name_lower:
            return SkillFormat.TRAE_CN

        # Markdown files are likely Claude Code format
        if suffix == ".md":
            return SkillFormat.CLAUDE_CODE

        # For YAML/JSON, read content to detect format
        if suffix in {".yaml", ".yml", ".json"}:
            try:
                content = self._read_raw(path)
                if isinstance(content, dict):
                    fmt = content.get("format", "").lower()
                    if fmt == "flowforge":
                        return SkillFormat.FLOWFORGE
                    if fmt in ("claude_code", "claude-code"):
                        return SkillFormat.CLAUDE_CODE
                    if fmt == "anthropic":
                        return SkillFormat.ANTHROPIC
                    if fmt == "trae_cn":
                        return SkillFormat.TRAE_CN

                    # Heuristic: if it has 'steps', treat as FlowForge
                    if "steps" in content:
                        return SkillFormat.FLOWFORGE

                    # Heuristic: Anthropic format has 'tools' or 'anthropic_version'
                    if "anthropic_version" in content or "tool_use" in content:
                        return SkillFormat.ANTHROPIC
            except Exception:
                pass

        # Default: assume FlowForge native
        if suffix in {".yaml", ".yml", ".json"}:
            return SkillFormat.FLOWFORGE

        return None

    def _read_raw(self, path: Path) -> dict[str, Any]:
        """Read a YAML or JSON file into a dict."""
        suffix = path.suffix.lower()
        text = path.read_text(encoding="utf-8")

        if suffix == ".json":
            return json.loads(text)
        else:
            return yaml.safe_load(text) or {}

    # ── Format-specific loaders ──────────────────────────────────────

    def load_flowforge_skill(self, file_path: str) -> SkillBase | None:
        """Load a FlowForge native YAML/JSON skill definition.

        Expected structure::

            name: content-audit
            description: "..."
            version: 1.0
            format: flowforge
            triggers:
              - on_demand
            steps:
              - name: quality_check
                agent: content-audit
                prompt: "..."
            output:
              format: report
              fields: [quality_score, seo_score]
        """
        path = Path(file_path)
        content = self._read_raw(path)

        if not content or "name" not in content:
            return None

        steps = [SkillStep(**s) for s in content.get("steps", [])]
        output_data = content.get("output", {})
        output = SkillOutput(**output_data) if output_data else SkillOutput()
        triggers = [
            SkillTrigger(t) for t in content.get("triggers", ["on_demand"])
        ]

        return FlowForgeNativeSkill(
            name=content["name"],
            description=content.get("description", ""),
            version=str(content.get("version", "0.1.0")),
            format=SkillFormat.FLOWFORGE,
            triggers=triggers,
            steps=steps,
            output=output,
            source_path=str(path.absolute()),
        )

    def load_claude_code_skill(self, file_path: str) -> SkillBase | None:
        """Parse a Claude Code skill format.

        Claude Code skills are typically Markdown files with YAML
        frontmatter.  The frontmatter contains metadata; the body
        contains the prompt/instructions.

        Expected structure::

            ---
            name: my-skill
            description: "..."
            ---
            Skill instructions in Markdown...
        """
        path = Path(file_path)
        text = path.read_text(encoding="utf-8")

        # Parse frontmatter
        metadata: dict[str, Any] = {}
        body = text

        if text.startswith("---"):
            parts = text.split("---", 2)
            if len(parts) >= 3:
                try:
                    metadata = yaml.safe_load(parts[1]) or {}
                except yaml.YAMLError:
                    pass
                body = parts[2].strip()

        name = metadata.get("name", path.stem)
        description = metadata.get("description", "")

        # Build a single step from the markdown body
        steps = []
        if body:
            steps.append(
                SkillStep(
                    name="execute",
                    prompt=body,
                    agent=metadata.get("agent", ""),
                )
            )

        triggers = [
            SkillTrigger(t)
            for t in metadata.get("triggers", ["on_demand"])
        ]

        return FlowForgeNativeSkill(
            name=name,
            description=description,
            version=str(metadata.get("version", "0.1.0")),
            format=SkillFormat.CLAUDE_CODE,
            triggers=triggers,
            steps=steps,
            source_path=str(path.absolute()),
        )

    def load_anthropic_skill(self, file_path: str) -> SkillBase | None:
        """Parse an Anthropic skill format.

        Anthropic skills use a JSON structure with tool definitions
        and prompt templates.

        Expected structure::

            {
              "name": "my-skill",
              "anthropic_version": "2024-01-01",
              "tools": [...],
              "prompt": "..."
            }
        """
        path = Path(file_path)
        content = self._read_raw(path)

        if not content or "name" not in content:
            return None

        name = content["name"]
        description = content.get("description", "")
        prompt = content.get("prompt", "")
        tools = content.get("tools", [])

        # Convert Anthropic tool definitions to steps
        steps = []
        if prompt:
            steps.append(
                SkillStep(
                    name="execute",
                    prompt=prompt,
                    tool=",".join(tools) if isinstance(tools, list) else str(tools),
                )
            )

        triggers = [
            SkillTrigger(t)
            for t in content.get("triggers", ["on_demand"])
        ]

        return FlowForgeNativeSkill(
            name=name,
            description=description,
            version=str(content.get("version", "0.1.0")),
            format=SkillFormat.ANTHROPIC,
            triggers=triggers,
            steps=steps,
            source_path=str(path.absolute()),
        )

    def load_trae_cn_skill(self, file_path: str) -> SkillBase | None:
        """Parse a Trae CN skill format.

        Trae CN skills are YAML files with a specific structure that
        includes ``instructions``, ``trigger``, and ``context`` fields.

        Expected structure::

            name: my-skill
            description: "..."
            instructions: "..."
            trigger:
              type: on_demand
            context:
              files: [...]
        """
        path = Path(file_path)
        content = self._read_raw(path)

        if not content or "name" not in content:
            return None

        name = content["name"]
        description = content.get("description", "")
        instructions = content.get("instructions", "")

        # Map Trae CN trigger types to SkillTrigger
        trigger_data = content.get("trigger", {})
        if isinstance(trigger_data, dict):
            trigger_type = trigger_data.get("type", "on_demand")
        elif isinstance(trigger_data, str):
            trigger_type = trigger_data
        else:
            trigger_type = "on_demand"

        try:
            triggers = [SkillTrigger(trigger_type)]
        except ValueError:
            triggers = [SkillTrigger.ON_DEMAND]

        # Build steps from instructions
        steps = []
        if instructions:
            steps.append(
                SkillStep(
                    name="execute",
                    prompt=instructions,
                )
            )

        # Trae CN may define multiple instruction blocks
        for idx, inst in enumerate(content.get("steps", [])):
            if isinstance(inst, dict):
                steps.append(
                    SkillStep(
                        name=inst.get("name", f"step-{idx + 1}"),
                        prompt=inst.get("prompt", inst.get("instructions", "")),
                        agent=inst.get("agent", ""),
                    )
                )

        return FlowForgeNativeSkill(
            name=name,
            description=description,
            version=str(content.get("version", "0.1.0")),
            format=SkillFormat.TRAE_CN,
            triggers=triggers,
            steps=steps,
            source_path=str(path.absolute()),
        )
