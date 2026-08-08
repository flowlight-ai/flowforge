"""FWK-01 MVP1 验收测试 — SEQUENCE 工作流编译器

验证三阶段编译流程：YAML → Parser → IR → Validator → CodeGen → sop_steps
MVP1 仅支持 SEQUENCE 模式（顺序执行）。
"""

import os

import pytest

from flowforge.compiler.compiler import WorkflowCompiler
from flowforge.compiler.ir import IRStep, IRWorkflow, StepType

HOTFIX_YAML = """
id: dev_hotfix
name: "Hotfix修复流程"
version: "1.0"
steps:
  - id: analyze
    name: "Bug分析"
    type: agent
    agent: "devforge:bug_analyzer"
    output_key: "root_cause"
  - id: fix
    name: "代码修复"
    type: agent
    agent: "devforge:coder"
    output_key: "fix_code"
  - id: verify
    name: "修复验证"
    type: agent
    agent: "devforge:test_generator"
    output_key: "test_result"
"""


class TestParser:
    """第一阶段：YAML → IR 解析测试"""

    def test_parse_basic_fields(self):
        parser = WorkflowCompiler().parser
        ir = parser.parse(HOTFIX_YAML)
        assert ir.id == "dev_hotfix"
        assert ir.name == "Hotfix修复流程"
        assert ir.version == "1.0"

    def test_parse_steps_count(self):
        parser = WorkflowCompiler().parser
        ir = parser.parse(HOTFIX_YAML)
        assert len(ir.steps) == 3

    def test_parse_step_fields(self):
        parser = WorkflowCompiler().parser
        ir = parser.parse(HOTFIX_YAML)
        step0 = ir.steps[0]
        assert step0.id == "analyze"
        assert step0.name == "Bug分析"
        assert step0.type == StepType.AGENT
        assert step0.agent == "devforge:bug_analyzer"
        assert step0.output_key == "root_cause"

    def test_parse_step_order_preserved(self):
        parser = WorkflowCompiler().parser
        ir = parser.parse(HOTFIX_YAML)
        assert ir.steps[0].id == "analyze"
        assert ir.steps[1].id == "fix"
        assert ir.steps[2].id == "verify"

    def test_parse_invalid_yaml_raises(self):
        parser = WorkflowCompiler().parser
        with pytest.raises(ValueError, match="expected mapping"):
            parser.parse("just a string")

    def test_parse_file_not_found(self):
        parser = WorkflowCompiler().parser
        with pytest.raises(FileNotFoundError):
            parser.parse_file("/nonexistent/path.yaml")

    def test_parse_with_input_mapping(self):
        yaml_content = """
id: test_wf
name: "Test"
steps:
  - id: step1
    name: "Step 1"
    type: agent
    agent: "test:agent"
    input_mapping:
      query: "${params.query}"
    output_key: "result"
"""
        parser = WorkflowCompiler().parser
        ir = parser.parse(yaml_content)
        assert ir.steps[0].input_mapping == {"query": "${params.query}"}

    def test_parse_tool_step(self):
        yaml_content = """
id: tool_wf
name: "Tool Workflow"
steps:
  - id: search
    name: "搜索"
    type: tool
    tool: "web_search"
    output_key: "search_result"
"""
        parser = WorkflowCompiler().parser
        ir = parser.parse(yaml_content)
        assert ir.steps[0].type == StepType.TOOL
        assert ir.steps[0].tool == "web_search"


class TestValidator:
    """第二阶段：IR 校验测试"""

    def test_validate_valid_workflow(self):
        compiler = WorkflowCompiler()
        ir = compiler.parser.parse(HOTFIX_YAML)
        errors = compiler.validator.validate(ir)
        assert errors == []

    def test_validate_empty_id(self):
        compiler = WorkflowCompiler()
        ir = IRWorkflow(id="", name="Test", steps=[IRStep(id="s1", name="S1", type=StepType.AGENT, agent="a")])
        errors = compiler.validator.validate(ir)
        assert any("id is required" in e for e in errors)

    def test_validate_no_steps(self):
        compiler = WorkflowCompiler()
        ir = IRWorkflow(id="test", name="Test", steps=[])
        errors = compiler.validator.validate(ir)
        assert any("at least one step" in e for e in errors)

    def test_validate_duplicate_step_id(self):
        compiler = WorkflowCompiler()
        ir = IRWorkflow(
            id="test",
            name="Test",
            steps=[
                IRStep(id="s1", name="S1", type=StepType.AGENT, agent="a"),
                IRStep(id="s1", name="S2", type=StepType.AGENT, agent="b"),
            ],
        )
        errors = compiler.validator.validate(ir)
        assert any("Duplicate step id" in e for e in errors)

    def test_validate_agent_step_without_agent(self):
        compiler = WorkflowCompiler()
        ir = IRWorkflow(
            id="test",
            name="Test",
            steps=[IRStep(id="s1", name="S1", type=StepType.AGENT, agent=None)],
        )
        errors = compiler.validator.validate(ir)
        assert any("requires 'agent' field" in e for e in errors)

    def test_validate_tool_step_without_tool(self):
        compiler = WorkflowCompiler()
        ir = IRWorkflow(
            id="test",
            name="Test",
            steps=[IRStep(id="s1", name="S1", type=StepType.TOOL, tool=None)],
        )
        errors = compiler.validator.validate(ir)
        assert any("requires 'tool' field" in e for e in errors)


class TestCodeGen:
    """第三阶段：IR → sop_steps 代码生成测试"""

    def test_codegen_step_count(self):
        compiler = WorkflowCompiler()
        sop_steps, _ = compiler.compile(HOTFIX_YAML)
        assert len(sop_steps) == 3

    def test_codegen_agent_step(self):
        compiler = WorkflowCompiler()
        sop_steps, _ = compiler.compile(HOTFIX_YAML)
        step0 = sop_steps[0]
        assert step0["type"] == "agent"
        assert step0["agent"] == "devforge:bug_analyzer"
        assert step0["name"] == "Bug分析"
        assert step0["output_key"] == "root_cause"

    def test_codegen_step_order(self):
        compiler = WorkflowCompiler()
        sop_steps, _ = compiler.compile(HOTFIX_YAML)
        assert sop_steps[0]["agent"] == "devforge:bug_analyzer"
        assert sop_steps[1]["agent"] == "devforge:coder"
        assert sop_steps[2]["agent"] == "devforge:test_generator"

    def test_codegen_tool_step(self):
        yaml_content = """
id: tool_wf
name: "Tool Workflow"
steps:
  - id: search
    name: "搜索"
    type: tool
    tool: "web_search"
    output_key: "search_result"
"""
        compiler = WorkflowCompiler()
        sop_steps, _ = compiler.compile(yaml_content)
        assert sop_steps[0]["type"] == "tool"
        assert sop_steps[0]["tool"] == "web_search"

    def test_codegen_input_mapping_preserved(self):
        yaml_content = """
id: map_wf
name: "Mapping Workflow"
steps:
  - id: step1
    name: "Step 1"
    type: agent
    agent: "test:agent"
    input_mapping:
      query: "${params.query}"
      context: "${state.context}"
    output_key: "result"
"""
        compiler = WorkflowCompiler()
        sop_steps, _ = compiler.compile(yaml_content)
        assert sop_steps[0]["input_mapping"] == {"query": "${params.query}", "context": "${state.context}"}

    def test_codegen_optional_fields_omitted(self):
        yaml_content = """
id: minimal_wf
name: "Minimal"
steps:
  - id: s1
    name: "S1"
    type: agent
    agent: "test:agent"
"""
        compiler = WorkflowCompiler()
        sop_steps, _ = compiler.compile(yaml_content)
        # output_key, input_mapping, execution_policy 不应出现
        assert "output_key" not in sop_steps[0]
        assert "input_mapping" not in sop_steps[0]
        assert "execution_policy" not in sop_steps[0]


class TestCompilerIntegration:
    """编译器集成测试：完整 YAML → sop_steps 流程"""

    def test_compile_full_pipeline(self):
        compiler = WorkflowCompiler()
        sop_steps, ir = compiler.compile(HOTFIX_YAML)
        assert len(sop_steps) == 3
        assert ir.id == "dev_hotfix"
        assert len(ir.steps) == 3

    def test_compile_validation_error_raises(self):
        bad_yaml = """
id: ""
name: "Bad"
steps: []
"""
        compiler = WorkflowCompiler()
        with pytest.raises(ValueError, match="Workflow validation failed"):
            compiler.compile(bad_yaml)

    def test_compile_file(self):
        path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "config",
            "workflows",
            "dev_hotfix.yaml",
        )
        if not os.path.exists(path):
            pytest.skip("dev_hotfix.yaml not found")
        compiler = WorkflowCompiler()
        sop_steps, ir = compiler.compile_file(path)
        assert len(sop_steps) >= 3
        assert ir.id == "dev_hotfix"

    def test_compile_file_not_found(self):
        compiler = WorkflowCompiler()
        with pytest.raises(FileNotFoundError):
            compiler.compile_file("/nonexistent/workflow.yaml")

    def test_ir_preserved_after_compile(self):
        compiler = WorkflowCompiler()
        _, ir = compiler.compile(HOTFIX_YAML)
        # IR 结构完整保留，可供二次处理
        assert isinstance(ir, IRWorkflow)
        assert all(isinstance(s, IRStep) for s in ir.steps)
        assert ir.steps[0].type == StepType.AGENT
