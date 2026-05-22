"""Tests for FlowForge v6.0 Skill System."""

import pytest
import os
import tempfile
from flowforge.skills.adapter import (
    Skill, SkillAdapter, FlowForgeAdapter, ClaudeCodeAdapter,
    AnthropicAdapter, TraeCNAdapter,
)
from flowforge.skills.registry import SkillRegistry
from flowforge.skills.combo import ComboEngine
from flowforge.core.task_context import TaskContext


class TestFlowForgeAdapter:
    """Tests for FlowForge native SKILL.md adapter."""

    def test_can_load_with_skill_md(self):
        """Detects SKILL.md file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "SKILL.md"), "w") as f:
                f.write("---\nname: test\n---\nInstructions here")
            adapter = FlowForgeAdapter()
            assert adapter.can_load(tmpdir)

    def test_cannot_load_without_skill_md(self):
        """No SKILL.md = cannot load."""
        with tempfile.TemporaryDirectory() as tmpdir:
            adapter = FlowForgeAdapter()
            assert not adapter.can_load(tmpdir)

    def test_load_skill(self):
        """Load a skill from SKILL.md."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "SKILL.md"), "w") as f:
                f.write("---\nname: test_skill\ndescription: A test\nversion: 2.0\n---\nDo the thing")
            adapter = FlowForgeAdapter()
            skill = adapter.load(tmpdir)
            assert skill is not None
            assert skill.name == "test_skill"
            assert skill.description == "A test"
            assert skill.version == "2.0"
            assert skill.instructions == "Do the thing"
            assert skill.source_format == "flowforge"


class TestClaudeCodeAdapter:
    """Tests for Claude Code adapter."""

    def test_can_load_with_claude_md(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "CLAUDE.md"), "w") as f:
                f.write("# Instructions")
            adapter = ClaudeCodeAdapter()
            assert adapter.can_load(tmpdir)

    def test_load_claude_md(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "CLAUDE.md"), "w") as f:
                f.write("# Instructions\nDo the work")
            adapter = ClaudeCodeAdapter()
            skill = adapter.load(tmpdir)
            assert skill is not None
            assert skill.source_format == "claude_code"
            assert "Do the work" in skill.instructions


class TestAnthropicAdapter:
    """Tests for Anthropic adapter."""

    def test_can_load_with_prompt_md(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "prompt.md"), "w") as f:
                f.write("Prompt content")
            adapter = AnthropicAdapter()
            assert adapter.can_load(tmpdir)


class TestTraeCNAdapter:
    """Tests for Trae CN adapter."""

    def test_can_load_with_trae_rules(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            rules_dir = os.path.join(tmpdir, ".trae", "rules")
            os.makedirs(rules_dir)
            with open(os.path.join(rules_dir, "rule1.md"), "w") as f:
                f.write("Rule content")
            adapter = TraeCNAdapter()
            assert adapter.can_load(tmpdir)


class TestSkillRegistry:
    """Tests for SkillRegistry."""

    def test_load_skills_empty_dirs(self):
        """Loading from nonexistent dirs is safe."""
        registry = SkillRegistry(config={
            "global_dir": "/nonexistent/global",
            "project_dir": "/nonexistent/project",
        })
        registry.load_skills()
        assert len(registry.list_skills()) == 0

    def test_match_skill_no_skills(self):
        """Matching with no skills returns empty."""
        registry = SkillRegistry(config={
            "global_dir": "/nonexistent",
            "project_dir": "/nonexistent",
        })
        results = registry.match_skill("test query")
        assert results == []

    def test_match_skill_with_context(self):
        """Context enhancement boosts confidence."""
        registry = SkillRegistry(config={
            "global_dir": "/nonexistent",
            "project_dir": "/nonexistent",
        })
        # Manually add a skill
        registry._skills["search"] = Skill(
            name="search",
            triggers=["search", "find"],
            required_tools=["web_search"],
        )
        registry._loaded = True
        results = registry.match_skill("search for info", context={"recent_tools": ["web_search"]})
        assert len(results) > 0
        assert results[0]["name"] == "search"

    def test_apply_skill(self):
        """Apply skill injects into context."""
        registry = SkillRegistry()
        ctx = TaskContext(task_id="test", input_data={})
        skill = Skill(
            name="test",
            instructions="Do X",
            constraints=["No Y"],
            required_tools=["tool_a"],
            mode_hint="react",
        )
        registry.apply_skill(skill, ctx)
        assert ctx.metadata["skill_instructions"] == "Do X"
        assert "No Y" in ctx.metadata["constraints"]
        assert "tool_a" in ctx.metadata["required_tools"]
        assert ctx.metadata["mode_hint"] == "react"

    def test_get_status(self):
        registry = SkillRegistry()
        status = registry.get_status()
        assert "loaded" in status
        assert "skill_count" in status


class TestComboEngine:
    """Tests for ComboEngine."""

    def test_register_combo(self):
        engine = ComboEngine()
        engine.register_combo("test_combo", [
            {"name": "step1", "skill": "skill_a", "output_key": "result1"},
            {"name": "step2", "skill": "skill_b", "output_key": "result2", "depends_on": ["result1"]},
        ])
        combos = engine.list_combos()
        assert len(combos) == 1
        assert combos[0]["name"] == "test_combo"

    @pytest.mark.asyncio
    async def test_execute_combo_not_found(self):
        engine = ComboEngine()
        result = await engine.execute_combo("nonexistent")
        assert "error" in result

    @pytest.mark.asyncio
    async def test_execute_combo_simple(self):
        engine = ComboEngine()
        engine.register_combo("test", [
            {"name": "step1", "skill": "skill_a", "output_key": "out1"},
        ])
        result = await engine.execute_combo("test")
        assert "out1" in result

    def test_get_status(self):
        engine = ComboEngine()
        status = engine.get_status()
        assert "combo_count" in status
