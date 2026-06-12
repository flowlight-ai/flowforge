"""Unit tests for the FlowForge DeclarativeAgent system.

Covers:
- DeclarativeAgent creation from YAML
- DeclarativeAgent creation from decorator
- DeclarativeAgent creation from dict
- tools resolution and schema generation
- handoffs prompt generation
- guardrails checking
"""

import asyncio
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import yaml

from flowforge.core.base_agent import AgentInput, AgentOutput
from flowforge.core.declarative_agent import (
    AgentConfig,
    DeclarativeAgent,
    _decorator_agents,
    agent,
    get_decorator_agents,
)


# ── DeclarativeAgent creation from dict ──────────────────────────────


class TestDeclarativeAgentFromDict:
    def test_create_from_config_dict(self):
        config = {
            "name": "test-agent",
            "description": "A test agent",
            "model": "deepseek-v4",
            "tools": ["web_search"],
            "instructions": "You are a test agent.",
            "handoffs": ["review-agent"],
            "guardrails": ["content_safety"],
        }
        da = DeclarativeAgent.from_config(config)
        assert da.name == "test-agent"
        assert da.description == "A test agent"
        assert da.config.model == "deepseek-v4"
        assert da.config.tools == ["web_search"]
        assert da.config.instructions == "You are a test agent."
        assert da.config.handoffs == ["review-agent"]
        assert da.config.guardrails == ["content_safety"]

    def test_create_from_config_minimal(self):
        config = {"name": "minimal"}
        da = DeclarativeAgent.from_config(config)
        assert da.name == "minimal"
        assert da.config.tools == []
        assert da.config.handoffs == []
        assert da.config.guardrails == []

    def test_create_from_config_with_execute_fn(self):
        async def my_execute(task: str) -> dict:
            return {"result": "done"}

        config = {"name": "custom-exec"}
        da = DeclarativeAgent.from_config(config, execute_fn=my_execute)
        assert da._execute_fn is my_execute
        assert da._is_async is True

    def test_create_from_config_with_sync_execute_fn(self):
        def my_sync_execute(task: str) -> dict:
            return {"result": "done"}

        config = {"name": "sync-exec"}
        da = DeclarativeAgent.from_config(config, execute_fn=my_sync_execute)
        assert da._execute_fn is my_sync_execute
        assert da._is_async is False


# ── DeclarativeAgent creation from YAML ──────────────────────────────


class TestDeclarativeAgentFromYAML:
    def test_create_from_yaml_file(self, tmp_path):
        yaml_content = {
            "name": "yaml-agent",
            "description": "Agent from YAML",
            "model": "gpt-4",
            "tools": ["search", "calculator"],
            "instructions": "Follow instructions carefully.",
            "handoffs": ["editor"],
            "guardrails": ["safety"],
        }
        yaml_file = tmp_path / "agent.yaml"
        yaml_file.write_text(yaml.dump(yaml_content), encoding="utf-8")

        da = DeclarativeAgent.from_yaml(str(yaml_file))
        assert da.name == "yaml-agent"
        assert da.config.model == "gpt-4"
        assert da.config.tools == ["search", "calculator"]
        assert da.config.handoffs == ["editor"]

    def test_create_from_yaml_invalid_content(self, tmp_path):
        yaml_file = tmp_path / "bad.yaml"
        yaml_file.write_text("just a string", encoding="utf-8")

        with pytest.raises(ValueError, match="must contain a mapping"):
            DeclarativeAgent.from_yaml(str(yaml_file))

    def test_create_from_yaml_with_execute_fn(self, tmp_path):
        yaml_content = {"name": "yaml-with-fn", "model": "test"}
        yaml_file = tmp_path / "agent_fn.yaml"
        yaml_file.write_text(yaml.dump(yaml_content), encoding="utf-8")

        async def custom_fn(task: str) -> str:
            return "ok"

        da = DeclarativeAgent.from_yaml(str(yaml_file), execute_fn=custom_fn)
        assert da._execute_fn is custom_fn


# ── DeclarativeAgent creation from decorator ──────────────────────────


class TestDeclarativeAgentFromDecorator:
    def setup_method(self):
        """Clear the decorator registry before each test."""
        _decorator_agents.clear()

    def test_decorator_registers_agent(self):
        @agent(name="decorated-agent", description="Decorated test agent")
        async def my_task(task: str) -> str:
            return "result"

        agents = get_decorator_agents()
        assert "decorated-agent" in agents
        da = agents["decorated-agent"]
        assert da.name == "decorated-agent"
        assert da.description == "Decorated test agent"

    def test_decorator_with_tools_and_handoffs(self):
        @agent(
            name="full-agent",
            tools=["search"],
            handoffs=["editor"],
            guardrails=["safety"],
            model="deepseek-v4",
        )
        async def full_task(task: str) -> str:
            return "done"

        agents = get_decorator_agents()
        da = agents["full-agent"]
        assert da.config.tools == ["search"]
        assert da.config.handoffs == ["editor"]
        assert da.config.guardrails == ["safety"]
        assert da.config.model == "deepseek-v4"

    def test_decorator_placeholder_body_uses_llm(self):
        @agent(name="placeholder-agent")
        async def placeholder(task: str) -> str:
            ...

        agents = get_decorator_agents()
        da = agents["placeholder-agent"]
        # Placeholder body means no custom execute_fn
        assert da._execute_fn is None

    def test_decorator_attaches_agent_to_function(self):
        @agent(name="func-agent")
        async def func(task: str) -> str:
            return "ok"

        assert hasattr(func, "_declarative_agent")
        assert func._declarative_agent.name == "func-agent"


# ── tools resolution and schema generation ────────────────────────────


class TestToolsResolution:
    def test_resolve_tools_schema_with_mock_registry(self):
        config = AgentConfig(
            name="tool-agent",
            tools=["web_search", "calculator"],
        )
        da = DeclarativeAgent(config=config)

        mock_tool = MagicMock()
        mock_tool.description = "Search the web"
        mock_tool.parameters_schema = {
            "type": "object",
            "properties": {"query": {"type": "string"}},
        }

        with patch("flowforge.tools.registry.ToolRegistry") as MockRegistry:
            mock_instance = MagicMock()
            mock_instance.get_tool.return_value = mock_tool
            MockRegistry.return_value = mock_instance

            schemas = da._resolve_tools_schema()
            assert len(schemas) == 2
            assert schemas[0]["function"]["name"] == "web_search"
            assert schemas[0]["function"]["parameters"]["type"] == "object"

    def test_resolve_tools_schema_missing_tool_skipped(self):
        config = AgentConfig(
            name="missing-tool-agent",
            tools=["nonexistent"],
        )
        da = DeclarativeAgent(config=config)

        with patch("flowforge.tools.registry.ToolRegistry") as MockRegistry:
            mock_instance = MagicMock()
            mock_instance.get_tool.side_effect = Exception("Not found")
            MockRegistry.return_value = mock_instance

            schemas = da._resolve_tools_schema()
            assert len(schemas) == 0

    def test_resolve_tools_schema_empty_tools(self):
        config = AgentConfig(name="no-tools-agent", tools=[])
        da = DeclarativeAgent(config=config)
        schemas = da._resolve_tools_schema()
        assert schemas == []

    def test_resolve_tools_schema_registry_unavailable(self):
        config = AgentConfig(
            name="no-registry-agent",
            tools=["search"],
        )
        da = DeclarativeAgent(config=config)

        with patch("flowforge.tools.registry.ToolRegistry") as MockRegistry:
            MockRegistry.side_effect = Exception("Registry unavailable")
            schemas = da._resolve_tools_schema()
            assert schemas == []


# ── handoffs prompt generation ────────────────────────────────────────


class TestHandoffsPrompt:
    def test_build_handoff_prompt(self):
        config = AgentConfig(
            name="handoff-agent",
            handoffs=["review-agent", "seo-agent"],
        )
        da = DeclarativeAgent(config=config)
        prompt = da._build_handoff_prompt()
        assert "review-agent" in prompt
        assert "seo-agent" in prompt
        assert "[HANDOFF_TO:" in prompt

    def test_build_handoff_prompt_empty(self):
        config = AgentConfig(name="no-handoff-agent", handoffs=[])
        da = DeclarativeAgent(config=config)
        prompt = da._build_handoff_prompt()
        # Empty handoffs should still produce the template
        assert "[HANDOFF_TO:" in prompt

    def test_handoff_prompt_appended_to_instructions(self):
        config = AgentConfig(
            name="handoff-instr",
            instructions="You are a writer.",
            handoffs=["editor"],
        )
        da = DeclarativeAgent(config=config)
        handoff_prompt = da._build_handoff_prompt()
        assert "editor" in handoff_prompt


# ── guardrails checking ──────────────────────────────────────────────


class TestGuardrailsChecking:
    @pytest.mark.asyncio
    async def test_input_guardrails_pass(self):
        config = AgentConfig(
            name="guardrail-agent",
            guardrails=["safety"],
        )
        da = DeclarativeAgent(config=config)

        with patch("flowforge.core.guardrails.GuardrailRegistry") as MockReg:
            mock_instance = MagicMock()
            mock_instance._input_guardrails = {}
            MockReg.return_value = mock_instance

            with patch("flowforge.core.guardrails.GuardrailExecutor") as MockExec:
                mock_executor = MagicMock()
                mock_executor.run_input_guardrails = AsyncMock(return_value=[])
                MockExec.return_value = mock_executor

                result = await da._run_input_guardrails("test input", {})
                assert result is None  # No guardrail blocked

    @pytest.mark.asyncio
    async def test_input_guardrails_blocked(self):
        config = AgentConfig(
            name="blocked-agent",
            guardrails=["safety"],
        )
        da = DeclarativeAgent(config=config)

        with patch("flowforge.core.guardrails.GuardrailRegistry") as MockReg:
            mock_instance = MagicMock()
            mock_input_guardrail = MagicMock()
            mock_instance._input_guardrails = {"safety": mock_input_guardrail}
            MockReg.return_value = mock_instance

            with patch("flowforge.core.guardrails.GuardrailExecutor") as MockExec:
                from flowforge.core.guardrails import GuardrailResult

                blocked_result = GuardrailResult(
                    status="blocked", message="Unsafe content"
                )
                mock_executor = MagicMock()
                mock_executor.run_input_guardrails = AsyncMock(
                    return_value=[blocked_result]
                )
                MockExec.return_value = mock_executor

                result = await da._run_input_guardrails("unsafe input", {})
                assert result is not None
                assert result.result.get("status") == "blocked"

    @pytest.mark.asyncio
    async def test_output_guardrails_pass(self):
        config = AgentConfig(
            name="output-guard-agent",
            guardrails=["quality"],
        )
        da = DeclarativeAgent(config=config)

        with patch("flowforge.core.guardrails.GuardrailRegistry") as MockReg:
            mock_instance = MagicMock()
            mock_instance._output_guardrails = {}
            MockReg.return_value = mock_instance

            with patch("flowforge.core.guardrails.GuardrailExecutor") as MockExec:
                mock_executor = MagicMock()
                mock_executor.run_output_guardrails = AsyncMock(return_value=[])
                MockExec.return_value = mock_executor

                result = await da._run_output_guardrails("clean output", {})
                assert result is None

    @pytest.mark.asyncio
    async def test_no_guardrails_configured(self):
        config = AgentConfig(name="no-guard-agent", guardrails=[])
        da = DeclarativeAgent(config=config)
        result = await da._run_input_guardrails("input", {})
        assert result is None

    @pytest.mark.asyncio
    async def test_guardrail_registry_unavailable(self):
        config = AgentConfig(
            name="no-reg-guard-agent",
            guardrails=["safety"],
        )
        da = DeclarativeAgent(config=config)

        with patch("flowforge.core.guardrails.GuardrailRegistry") as MockReg:
            MockReg.side_effect = Exception("Registry unavailable")
            result = await da._run_input_guardrails("input", {})
            assert result is None


# ── Custom execution ──────────────────────────────────────────────────


class TestCustomExecution:
    @pytest.mark.asyncio
    async def test_execute_custom_async(self):
        async def my_fn(task: str) -> dict:
            return {"result": "async-done"}

        config = AgentConfig(name="async-exec")
        da = DeclarativeAgent(config=config, execute_fn=my_fn)

        input_data = AgentInput(params={"task": "test"})
        output = await da._execute_custom(input_data)
        assert output.result["result"] == "async-done"

    @pytest.mark.asyncio
    async def test_execute_custom_sync(self):
        def my_fn(task: str) -> dict:
            return {"result": "sync-done"}

        config = AgentConfig(name="sync-exec")
        da = DeclarativeAgent(config=config, execute_fn=my_fn)

        input_data = AgentInput(params={"task": "test"})
        output = await da._execute_custom(input_data)
        assert output.result["result"] == "sync-done"

    @pytest.mark.asyncio
    async def test_execute_custom_returns_agent_output(self):
        async def my_fn(task: str) -> AgentOutput:
            return AgentOutput(result={"custom": True})

        config = AgentConfig(name="ao-exec")
        da = DeclarativeAgent(config=config, execute_fn=my_fn)

        input_data = AgentInput(params={"task": "test"})
        output = await da._execute_custom(input_data)
        assert isinstance(output, AgentOutput)
        assert output.result["custom"] is True

    @pytest.mark.asyncio
    async def test_execute_custom_exception(self):
        async def failing_fn(task: str) -> dict:
            raise ValueError("boom")

        config = AgentConfig(name="fail-exec")
        da = DeclarativeAgent(config=config, execute_fn=failing_fn)

        input_data = AgentInput(params={"task": "test"})
        output = await da._execute_custom(input_data)
        assert "error" in output.result
        assert "boom" in output.result["error"]


# ── AgentConfig model ─────────────────────────────────────────────────


class TestAgentConfig:
    def test_config_defaults(self):
        config = AgentConfig(name="default-agent")
        assert config.name == "default-agent"
        assert config.description == ""
        assert config.model is None
        assert config.tools == []
        assert config.instructions is None
        assert config.handoffs == []
        assert config.guardrails == []
        assert config.metadata == {}

    def test_config_all_fields(self):
        config = AgentConfig(
            name="full",
            description="Full config",
            model="gpt-4",
            tools=["search"],
            instructions="Be helpful",
            handoffs=["editor"],
            guardrails=["safety"],
            metadata={"priority": "high"},
        )
        assert config.model == "gpt-4"
        assert config.metadata["priority"] == "high"
