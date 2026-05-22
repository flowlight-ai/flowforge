"""Skill Adapter - Multi-format skill compatibility.

Implements FR-CAP-02: Supports 4 skill formats:
- FlowForge: Native SKILL.md format
- ClaudeCode: CLAUDE.md / .claude/commands/ format
- Anthropic: Anthropic prompt format
- TraeCN: .trae/rules/ format

OpenHarness format is marked as Roadmap (not implemented).
"""

import os
import re
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from flowforge.core.tracing import get_logger

logger = get_logger("skills.adapter")


@dataclass
class Skill:
    """Unified skill representation."""
    name: str
    description: str = ""
    version: str = "1.0"
    triggers: List[str] = field(default_factory=list)
    required_tools: List[str] = field(default_factory=list)
    constraints: List[str] = field(default_factory=list)
    instructions: str = ""
    input_schema: Dict[str, Any] = field(default_factory=dict)
    output_schema: Dict[str, Any] = field(default_factory=dict)
    dependencies: List[str] = field(default_factory=list)
    mode_hint: str = ""
    max_tokens: int = 4000
    source_format: str = "flowforge"
    source_path: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


class SkillAdapter(ABC):
    """Base class for skill format adapters."""

    format_name: str = "base"

    @abstractmethod
    def can_load(self, path: str) -> bool:
        """Check if this adapter can load from the given path."""
        pass

    @abstractmethod
    def load(self, path: str) -> Optional[Skill]:
        """Load a skill from the given path."""
        pass

    def _read_file(self, path: str) -> str:
        """Read file content with error handling."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            logger.warning(f"Failed to read {path}: {e}")
            return ""


class FlowForgeAdapter(SkillAdapter):
    """Adapter for FlowForge native SKILL.md format."""

    format_name = "flowforge"

    def can_load(self, path: str) -> bool:
        return os.path.isfile(os.path.join(path, "SKILL.md"))

    def load(self, path: str) -> Optional[Skill]:
        skill_md = os.path.join(path, "SKILL.md")
        if not os.path.exists(skill_md):
            return None

        content = self._read_file(skill_md)
        if not content:
            return None

        # Parse YAML frontmatter
        metadata = self._parse_frontmatter(content)
        body = self._parse_body(content)

        return Skill(
            name=metadata.get("name", os.path.basename(path)),
            description=metadata.get("description", ""),
            version=metadata.get("version", "1.0"),
            triggers=metadata.get("triggers", []),
            required_tools=metadata.get("required_tools", []),
            constraints=metadata.get("constraints", []),
            instructions=body,
            input_schema=metadata.get("input_schema", {}),
            output_schema=metadata.get("output_schema", {}),
            dependencies=metadata.get("dependencies", []),
            mode_hint=metadata.get("mode_hint", ""),
            max_tokens=metadata.get("max_tokens", 4000),
            source_format=self.format_name,
            source_path=path,
            metadata=metadata,
        )

    def _parse_frontmatter(self, content: str) -> dict:
        """Parse YAML frontmatter from SKILL.md."""
        if not content.startswith("---"):
            return {}

        parts = content.split("---", 2)
        if len(parts) < 3:
            return {}

        yaml_str = parts[1].strip()
        metadata = {}
        for line in yaml_str.split("\n"):
            if ":" in line:
                key, _, value = line.partition(":")
                key = key.strip()
                value = value.strip()
                # Handle list values
                if value.startswith("[") and value.endswith("]"):
                    value = [v.strip().strip('"').strip("'") for v in value[1:-1].split(",") if v.strip()]
                metadata[key] = value

        return metadata

    def _parse_body(self, content: str) -> str:
        """Parse the body (after frontmatter) from SKILL.md."""
        if not content.startswith("---"):
            return content

        parts = content.split("---", 2)
        if len(parts) < 3:
            return ""
        return parts[2].strip()


class ClaudeCodeAdapter(SkillAdapter):
    """Adapter for Claude Code CLAUDE.md / .claude/commands/ format."""

    format_name = "claude_code"

    def can_load(self, path: str) -> bool:
        return (os.path.isfile(os.path.join(path, "CLAUDE.md")) or
                os.path.isdir(os.path.join(path, ".claude")))

    def load(self, path: str) -> Optional[Skill]:
        # Try CLAUDE.md first
        claude_md = os.path.join(path, "CLAUDE.md")
        if os.path.exists(claude_md):
            content = self._read_file(claude_md)
            if content:
                return Skill(
                    name=os.path.basename(path),
                    description=f"Claude Code skill from {path}",
                    instructions=content,
                    source_format=self.format_name,
                    source_path=path,
                )

        # Try .claude/commands/
        commands_dir = os.path.join(path, ".claude", "commands")
        if os.path.isdir(commands_dir):
            combined = []
            for f in os.listdir(commands_dir):
                if f.endswith(".md"):
                    cmd_content = self._read_file(os.path.join(commands_dir, f))
                    if cmd_content:
                        combined.append(f"## {f[:-3]}\n{cmd_content}")

            if combined:
                return Skill(
                    name=os.path.basename(path),
                    description=f"Claude Code commands from {path}",
                    instructions="\n\n".join(combined),
                    source_format=self.format_name,
                    source_path=path,
                )

        return None


class AnthropicAdapter(SkillAdapter):
    """Adapter for Anthropic prompt format."""

    format_name = "anthropic"

    def can_load(self, path: str) -> bool:
        return os.path.isfile(os.path.join(path, "prompt.md"))

    def load(self, path: str) -> Optional[Skill]:
        prompt_md = os.path.join(path, "prompt.md")
        if not os.path.exists(prompt_md):
            return None

        content = self._read_file(prompt_md)
        if not content:
            return None

        return Skill(
            name=os.path.basename(path),
            description=f"Anthropic prompt from {path}",
            instructions=content,
            source_format=self.format_name,
            source_path=path,
        )


class TraeCNAdapter(SkillAdapter):
    """Adapter for Trae CN .trae/rules/ format."""

    format_name = "trae_cn"

    def can_load(self, path: str) -> bool:
        return os.path.isdir(os.path.join(path, ".trae", "rules"))

    def load(self, path: str) -> Optional[Skill]:
        rules_dir = os.path.join(path, ".trae", "rules")
        if not os.path.isdir(rules_dir):
            return None

        combined = []
        for f in sorted(os.listdir(rules_dir)):
            if f.endswith(".md"):
                rule_content = self._read_file(os.path.join(rules_dir, f))
                if rule_content:
                    combined.append(f"## {f[:-3]}\n{rule_content}")

        if not combined:
            return None

        return Skill(
            name=os.path.basename(path),
            description=f"Trae CN rules from {path}",
            instructions="\n\n".join(combined),
            source_format=self.format_name,
            source_path=path,
        )
