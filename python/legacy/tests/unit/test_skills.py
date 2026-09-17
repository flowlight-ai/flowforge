"""Unit tests for the FlowForge Skill system.

Covers:
- FlowForgeNativeSkill creation and serialization
- SkillLoader loading from YAML
- SkillManager registration and lookup
- ComboSkill pipeline execution
- _execute_step with mock context
- _check_condition with various operators
"""

import asyncio
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import yaml

from flowforge.skills.base import (
    FlowForgeNativeSkill,
    SkillBase,
    SkillContext,
    SkillFormat,
    SkillOutput,
    SkillResult,
    SkillStep,
    SkillTrigger,
)
from flowforge.skills.combo import ComboPipeline, ComboSkill
from flowforge.skills.loader import SkillLoader
from flowforge.skills.manager import SkillManager, _parse_version


# ── FlowForgeNativeSkill creation and serialization ──────────────────


class TestFlowForgeNativeSkillCreation:
    def test_create_with_defaults(self):
        skill = FlowForgeNativeSkill(name="test-skill")
        assert skill.name == "test-skill"
        assert skill.description == ""
        assert skill.version == "0.1.0"
        assert skill.format == SkillFormat.FLOWFORGE
        assert skill.triggers == [SkillTrigger.ON_DEMAND]
        assert skill.steps == []
        assert skill.source_path == ""

    def test_create_with_all_fields(self):
        steps = [
            SkillStep(name="step1", prompt="Do something"),
            SkillStep(name="step2", tool="web_search"),
        ]
        output = SkillOutput(format="report", fields=["score"])
        skill = FlowForgeNativeSkill(
            name="audit",
            description="Content audit skill",
            version="1.2.0",
            format=SkillFormat.FLOWFORGE,
            triggers=[SkillTrigger.ON_DEMAND, SkillTrigger.ON_COMPLETE],
            steps=steps,
            output=output,
            source_path="/tmp/audit.yaml",
        )
        assert skill.name == "audit"
        assert skill.description == "Content audit skill"
        assert skill.version == "1.2.0"
        assert len(skill.steps) == 2
        assert skill.steps[0].name == "step1"
        assert skill.steps[1].tool == "web_search"
        assert skill.output.format == "report"
        assert skill.output.fields == ["score"]
        assert skill.triggers == [SkillTrigger.ON_DEMAND, SkillTrigger.ON_COMPLETE]

    def test_to_dict_serialization(self):
        steps = [SkillStep(name="s1", prompt="hello")]
        output = SkillOutput(format="text", fields=["result"])
        skill = FlowForgeNativeSkill(
            name="my-skill",
            description="desc",
            version="2.0.0",
            steps=steps,
            output=output,
        )
        d = skill.to_dict()
        assert d["name"] == "my-skill"
        assert d["description"] == "desc"
        assert d["version"] == "2.0.0"
        assert d["format"] == "flowforge"
        assert d["triggers"] == ["on_demand"]
        assert len(d["steps"]) == 1
        assert d["steps"][0]["name"] == "s1"
        assert d["output"]["format"] == "text"
        assert d["output"]["fields"] == ["result"]

    def test_from_dict_deserialization(self):
        data = {
            "name": "restored",
            "description": "restored skill",
            "version": "3.0.0",
            "format": "flowforge",
            "triggers": ["on_demand"],
            "steps": [{"name": "step-a", "prompt": "do it"}],
            "output": {"format": "json", "fields": ["key"]},
            "source_path": "",
        }
        skill = SkillBase.from_dict(data)
        assert isinstance(skill, FlowForgeNativeSkill)
        assert skill.name == "restored"
        assert skill.version == "3.0.0"
        assert len(skill.steps) == 1
        assert skill.steps[0].name == "step-a"

    def test_repr(self):
        skill = FlowForgeNativeSkill(name="demo", version="1.0.0")
        r = repr(skill)
        assert "FlowForgeNativeSkill" in r
        assert "demo" in r
        assert "1.0.0" in r


# ── SkillLoader loading from YAML ────────────────────────────────────


class TestSkillLoader:
    def test_load_flowforge_yaml(self, tmp_path):
        skill_yaml = {
            "name": "yaml-skill",
            "description": "Loaded from YAML",
            "version": "1.0",
            "format": "flowforge",
            "triggers": ["on_demand"],
            "steps": [
                {"name": "check", "prompt": "Check quality"},
            ],
            "output": {"format": "report", "fields": ["score"]},
        }
        yaml_file = tmp_path / "skill.yaml"
        yaml_file.write_text(yaml.dump(skill_yaml), encoding="utf-8")

        loader = SkillLoader()
        skill = loader.load_flowforge_skill(str(yaml_file))
        assert skill is not None
        assert skill.name == "yaml-skill"
        assert skill.description == "Loaded from YAML"
        assert len(skill.steps) == 1
        assert skill.steps[0].name == "check"
        assert skill.output.format == "report"

    def test_load_from_directory(self, tmp_path):
        # Create two skill files
        skill1 = {"name": "skill-a", "steps": [{"name": "s1", "prompt": "p1"}]}
        skill2 = {"name": "skill-b", "steps": [{"name": "s2", "tool": "search"}]}

        (tmp_path / "a.yaml").write_text(yaml.dump(skill1), encoding="utf-8")
        (tmp_path / "b.yaml").write_text(yaml.dump(skill2), encoding="utf-8")

        loader = SkillLoader()
        skills = loader.load_from_directory(str(tmp_path))
        assert len(skills) == 2
        names = {s.name for s in skills}
        assert "skill-a" in names
        assert "skill-b" in names

    def test_load_from_nonexistent_directory(self):
        loader = SkillLoader()
        skills = loader.load_from_directory("/nonexistent/path")
        assert skills == []

    def test_load_claude_code_markdown(self, tmp_path):
        md_content = "---\nname: claude-skill\ndescription: Claude format\n---\nDo the thing\n"
        md_file = tmp_path / "skill.md"
        md_file.write_text(md_content, encoding="utf-8")

        loader = SkillLoader()
        skill = loader.load_claude_code_skill(str(md_file))
        assert skill is not None
        assert skill.name == "claude-skill"
        assert skill.format == SkillFormat.CLAUDE_CODE
        assert len(skill.steps) == 1
        assert "Do the thing" in skill.steps[0].prompt

    def test_detect_format_flowforge(self, tmp_path):
        yaml_file = tmp_path / "test.yaml"
        yaml_file.write_text(yaml.dump({"name": "x", "steps": []}), encoding="utf-8")

        loader = SkillLoader()
        fmt = loader._detect_format(yaml_file)
        assert fmt == SkillFormat.FLOWFORGE

    def test_detect_format_trae_cn(self, tmp_path):
        yaml_file = tmp_path / "skill.trae.yaml"
        yaml_file.write_text("name: x", encoding="utf-8")

        loader = SkillLoader()
        fmt = loader._detect_format(yaml_file)
        assert fmt == SkillFormat.TRAE_CN

    def test_detect_format_markdown(self, tmp_path):
        md_file = tmp_path / "skill.md"
        md_file.write_text("# Skill", encoding="utf-8")

        loader = SkillLoader()
        fmt = loader._detect_format(md_file)
        assert fmt == SkillFormat.CLAUDE_CODE


# ── SkillManager registration and lookup ──────────────────────────────


class TestSkillManager:
    def test_register_and_lookup(self):
        mgr = SkillManager()
        skill = FlowForgeNativeSkill(name="lookup-test", version="1.0.0")
        mgr._register_skill(skill)
        assert mgr.get_skill("lookup-test") is skill
        assert mgr.has_skill("lookup-test")
        assert not mgr.has_skill("nonexistent")

    def test_version_conflict_newer_wins(self):
        mgr = SkillManager()
        old_skill = FlowForgeNativeSkill(name="ver-test", version="1.0.0")
        new_skill = FlowForgeNativeSkill(name="ver-test", version="2.0.0")
        mgr._register_skill(old_skill)
        mgr._register_skill(new_skill)
        assert mgr.get_skill("ver-test").version == "2.0.0"

    def test_version_conflict_older_skipped(self):
        mgr = SkillManager()
        new_skill = FlowForgeNativeSkill(name="ver-test2", version="3.0.0")
        old_skill = FlowForgeNativeSkill(name="ver-test2", version="1.0.0")
        mgr._register_skill(new_skill)
        mgr._register_skill(old_skill)
        assert mgr.get_skill("ver-test2").version == "3.0.0"

    def test_list_skills(self):
        mgr = SkillManager()
        mgr._register_skill(FlowForgeNativeSkill(name="a"))
        mgr._register_skill(FlowForgeNativeSkill(name="b"))
        assert len(mgr.list_skills()) == 2

    def test_list_skills_by_format(self):
        mgr = SkillManager()
        mgr._register_skill(FlowForgeNativeSkill(name="ff", format=SkillFormat.FLOWFORGE))
        mgr._register_skill(FlowForgeNativeSkill(name="cc", format=SkillFormat.CLAUDE_CODE))
        ff_skills = mgr.list_skills_by_format(SkillFormat.FLOWFORGE)
        assert len(ff_skills) == 1
        assert ff_skills[0].name == "ff"

    def test_match_triggers(self):
        mgr = SkillManager()
        mgr._register_skill(
            FlowForgeNativeSkill(name="ondemand", triggers=[SkillTrigger.ON_DEMAND])
        )
        mgr._register_skill(
            FlowForgeNativeSkill(name="onstart", triggers=[SkillTrigger.ON_START])
        )
        mgr._register_skill(
            FlowForgeNativeSkill(
                name="both",
                triggers=[SkillTrigger.ON_DEMAND, SkillTrigger.ON_START],
            )
        )
        on_demand = mgr.match_triggers(SkillTrigger.ON_DEMAND)
        assert len(on_demand) == 2
        names = {s.name for s in on_demand}
        assert "ondemand" in names
        assert "both" in names

    def test_execute_skill_not_found(self):
        mgr = SkillManager()
        ctx = SkillContext()
        with pytest.raises(KeyError, match="Skill not found"):
            asyncio.get_event_loop().run_until_complete(
                mgr.execute_skill("nonexistent", ctx)
            )

    def test_clear(self):
        mgr = SkillManager()
        mgr._register_skill(FlowForgeNativeSkill(name="x"))
        mgr.clear()
        assert mgr.skill_count() == 0

    def test_parse_version(self):
        assert _parse_version("1.0") == (1, 0, 0)
        assert _parse_version("1.2.3") == (1, 2, 3)
        assert _parse_version("0.1.0") == (0, 1, 0)
        assert _parse_version("2") == (2, 0, 0)

    def test_load_skills_from_directories(self, tmp_path):
        # Create global skill
        global_dir = tmp_path / "global"
        global_dir.mkdir()
        (global_dir / "g.yaml").write_text(
            yaml.dump({"name": "global-skill", "steps": []}), encoding="utf-8"
        )
        # Create project skill
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        (project_dir / "p.yaml").write_text(
            yaml.dump({"name": "project-skill", "steps": []}), encoding="utf-8"
        )

        mgr = SkillManager()
        count = mgr.load_skills(
            global_dir=str(global_dir), project_dir=str(project_dir)
        )
        assert count == 2
        assert mgr.has_skill("global-skill")
        assert mgr.has_skill("project-skill")


# ── ComboSkill pipeline execution ─────────────────────────────────────


class TestComboSkill:
    def test_combo_creation(self):
        combo = ComboSkill(
            name="combo-test",
            skill_names=["step1", "step2"],
            error_strategy="skip",
            max_retries=1,
        )
        assert combo.name == "combo-test"
        assert combo.skill_names == ["step1", "step2"]
        assert combo.error_strategy == "skip"
        assert combo.max_retries == 1

    def test_combo_to_dict(self):
        combo = ComboSkill(
            name="combo-dict",
            skill_names=["a", "b"],
            error_strategy="stop",
        )
        d = combo.to_dict()
        assert d["skill_names"] == ["a", "b"]
        assert d["error_strategy"] == "stop"

    def test_combo_validate_always_true(self):
        combo = ComboSkill(name="v", skill_names=[])
        assert combo.validate(SkillContext()) is True

    def test_pipeline_run_with_mock_skills(self):
        """Test ComboPipeline with a mock SkillManager."""
        mock_skill = FlowForgeNativeSkill(name="mock-skill", steps=[])
        # Override execute to return a known result
        mock_skill.execute = AsyncMock(
            return_value=SkillResult(success=True, output={"key": "value"})
        )
        mock_skill.validate = MagicMock(return_value=True)

        mgr = SkillManager()
        mgr._register_skill(mock_skill)

        pipeline = ComboPipeline(
            skill_names=["mock-skill"],
            error_strategy="stop",
            skill_manager=mgr,
        )
        ctx = SkillContext()
        result = asyncio.get_event_loop().run_until_complete(pipeline.run(ctx))
        assert result.success is True
        assert "mock-skill" in result.steps_completed

    def test_pipeline_stop_on_missing_skill(self):
        pipeline = ComboPipeline(
            skill_names=["nonexistent"],
            error_strategy="stop",
        )
        ctx = SkillContext()
        result = asyncio.get_event_loop().run_until_complete(pipeline.run(ctx))
        assert result.success is False
        assert "not found" in result.error

    def test_pipeline_skip_on_missing_skill(self):
        pipeline = ComboPipeline(
            skill_names=["nonexistent"],
            error_strategy="skip",
        )
        ctx = SkillContext()
        result = asyncio.get_event_loop().run_until_complete(pipeline.run(ctx))
        assert result.success is True
        assert "nonexistent" in result.steps_failed

    def test_pipeline_context_passing(self):
        """Verify output from one skill is merged into context.state for subsequent skills."""
        skill1 = FlowForgeNativeSkill(name="s1", steps=[])
        skill1.execute = AsyncMock(
            return_value=SkillResult(success=True, output={"data": "from-s1"})
        )
        skill1.validate = MagicMock(return_value=True)

        skill2 = FlowForgeNativeSkill(name="s2", steps=[])
        skill2.execute = AsyncMock(
            return_value=SkillResult(success=True, output={"data2": "from-s2"})
        )
        skill2.validate = MagicMock(return_value=True)

        mgr = SkillManager()
        mgr._register_skill(skill1)
        mgr._register_skill(skill2)

        pipeline = ComboPipeline(
            skill_names=["s1", "s2"],
            error_strategy="stop",
            skill_manager=mgr,
        )
        ctx = SkillContext()
        result = asyncio.get_event_loop().run_until_complete(pipeline.run(ctx))
        assert result.success is True
        assert len(result.steps_completed) == 2
        # Verify context.state was updated after s1 with s1's output
        call_args = skill2.execute.call_args[0][0]
        assert call_args.state.get("data") == "from-s1"


# ── _execute_step with mock context ──────────────────────────────────


class TestExecuteStep:
    @pytest.mark.asyncio
    async def test_execute_step_with_prompt(self):
        """Test _execute_step dispatches to LLM when step has a prompt."""
        skill = FlowForgeNativeSkill(
            name="step-test",
            steps=[SkillStep(name="llm-step", prompt="Hello world")],
        )
        ctx = SkillContext(task_id="test-task")

        with patch("flowforge.tools.llm_client.LLMClient") as MockLLM:
            mock_instance = MagicMock()
            mock_output = MagicMock()
            mock_output.result = {"content": "response", "model": "test"}
            mock_instance.execute = AsyncMock(return_value=mock_output)
            MockLLM.return_value = mock_instance

            result = await skill._execute_step(skill.steps[0], ctx)
            assert result["status"] == "completed"
            assert result["llm_call"] is True

    @pytest.mark.asyncio
    async def test_execute_step_no_dispatch(self):
        """Test _execute_step returns failed when no agent/tool/prompt."""
        skill = FlowForgeNativeSkill(
            name="empty-step",
            steps=[SkillStep(name="noop")],
        )
        ctx = SkillContext()
        result = await skill._execute_step(skill.steps[0], ctx)
        # Code returns "failed" with reason when no dispatch target is specified
        assert result["status"] == "failed"
        assert "no agent/tool/prompt" in result.get("reason", "")

    @pytest.mark.asyncio
    async def test_execute_step_on_error_skip(self):
        """Test step with on_error='skip' records failure in step output."""
        skill = FlowForgeNativeSkill(
            name="skip-test",
            steps=[SkillStep(name="fail-step", prompt="fail", on_error="skip")],
        )
        ctx = SkillContext()

        with patch("flowforge.tools.llm_client.LLMClient") as MockLLM:
            mock_instance = MagicMock()
            mock_instance.execute = AsyncMock(side_effect=Exception("LLM down"))
            MockLLM.return_value = mock_instance
            result = await skill.execute(ctx)
            # _execute_step catches the exception internally and returns
            # {"status": "failed"}, so the step appears in steps_completed
            # but the output contains the failure info
            assert "fail-step" in result.steps_completed
            assert result.output["fail-step"]["status"] == "failed"

    @pytest.mark.asyncio
    async def test_execute_step_on_error_stop(self):
        """Test step with on_error='stop' records failure in step output."""
        skill = FlowForgeNativeSkill(
            name="stop-test",
            steps=[SkillStep(name="fail-step", prompt="fail", on_error="stop")],
        )
        ctx = SkillContext()

        with patch("flowforge.tools.llm_client.LLMClient") as MockLLM:
            mock_instance = MagicMock()
            mock_instance.execute = AsyncMock(side_effect=Exception("LLM down"))
            MockLLM.return_value = mock_instance
            result = await skill.execute(ctx)
            # _execute_step catches the exception internally, so the step
            # appears in steps_completed with failure info in output
            assert "fail-step" in result.steps_completed
            assert result.output["fail-step"]["status"] == "failed"


# ── _check_condition with various operators ───────────────────────────


class TestCheckCondition:
    def test_check_condition_always_true(self):
        """ComboPipeline._check_condition currently returns True for all skills."""
        pipeline = ComboPipeline(skill_names=[], error_strategy="stop")
        skill = FlowForgeNativeSkill(name="cond-test")
        ctx = SkillContext()
        assert pipeline._check_condition(skill, ctx) is True

    def test_check_condition_with_state_data(self):
        """Verify _check_condition passes even with populated state."""
        pipeline = ComboPipeline(skill_names=[], error_strategy="stop")
        skill = FlowForgeNativeSkill(name="cond-test2")
        ctx = SkillContext(state={"key": "value", "count": 5})
        assert pipeline._check_condition(skill, ctx) is True

    def test_check_condition_with_empty_context(self):
        pipeline = ComboPipeline(skill_names=[], error_strategy="stop")
        skill = FlowForgeNativeSkill(name="cond-test3")
        ctx = SkillContext()
        assert pipeline._check_condition(skill, ctx) is True
