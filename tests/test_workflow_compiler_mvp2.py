"""FWK-01 MVP2 验收测试 — CONDITIONAL 条件分支工作流编译器

验证条件分支功能：condition/on_true/on_false 字段的解析、校验、代码生成。
同时确保 MVP1 SEQUENCE 功能不受影响（回归测试）。
"""

import pytest

from flowforge.compiler.compiler import WorkflowCompiler
from flowforge.compiler.ir import IRStep, IRWorkflow, StepType

# 带条件分支的工作流 YAML
CONDITIONAL_YAML = """
id: content_review
name: "内容审核发布流程"
version: "1.0"
steps:
  - id: review
    name: "内容审核"
    type: agent
    agent: "contentforge:audit"
    output_key: "review_result"
  - id: rewrite
    name: "条件判断"
    type: conditional
    agent: "contentforge:writer"
    condition: "${state.review_result.score < 70}"
    on_true: "rewrite"
    on_false: "publish"
    output_key: "rewrite_result"
  - id: publish
    name: "发布"
    type: agent
    agent: "contentforge:publish"
    output_key: "publish_result"
"""

# 简化条件分支 YAML（agent 类型自动升级为 conditional）
AUTO_CONDITIONAL_YAML = """
id: auto_cond
name: "自动条件分支"
steps:
  - id: check
    name: "检查"
    type: agent
    agent: "test:checker"
    output_key: "check_result"
  - id: decide
    name: "决策"
    agent: "test:decider"
    condition: "${state.check_result.passed}"
    on_true: "success"
    on_false: "fail"
  - id: success
    name: "成功"
    type: agent
    agent: "test:success_handler"
  - id: fail
    name: "失败"
    type: agent
    agent: "test:fail_handler"
"""


class TestConditionalParser:
    """MVP2 Parser 测试：条件分支字段解析"""

    def test_parse_condition_fields(self):
        parser = WorkflowCompiler().parser
        ir = parser.parse(CONDITIONAL_YAML)
        rewrite_step = ir.steps[1]
        assert rewrite_step.condition == "${state.review_result.score < 70}"
        assert rewrite_step.on_true == "rewrite"
        assert rewrite_step.on_false == "publish"

    def test_parse_conditional_type_detected(self):
        """显式 type: conditional 的步骤应保持 CONDITIONAL 类型"""
        parser = WorkflowCompiler().parser
        ir = parser.parse(CONDITIONAL_YAML)
        assert ir.steps[1].type == StepType.CONDITIONAL

    def test_parse_auto_conditional_type(self):
        """有 condition 字段但未显式指定 type 时，自动升级为 CONDITIONAL"""
        parser = WorkflowCompiler().parser
        ir = parser.parse(AUTO_CONDITIONAL_YAML)
        decide_step = ir.steps[1]
        assert decide_step.type == StepType.CONDITIONAL
        assert decide_step.condition is not None

    def test_parse_no_condition_fields_default_none(self):
        """没有 condition 的步骤，condition/on_true/on_false 应为 None"""
        parser = WorkflowCompiler().parser
        ir = parser.parse(CONDITIONAL_YAML)
        review_step = ir.steps[0]
        assert review_step.condition is None
        assert review_step.on_true is None
        assert review_step.on_false is None

    def test_parse_conditional_preserves_agent(self):
        """条件分支步骤保留 agent 字段"""
        parser = WorkflowCompiler().parser
        ir = parser.parse(CONDITIONAL_YAML)
        rewrite_step = ir.steps[1]
        assert rewrite_step.agent == "contentforge:writer"


class TestConditionalValidator:
    """MVP2 Validator 测试：条件分支校验"""

    def test_validate_valid_conditional(self):
        """合法的条件分支应通过校验"""
        compiler = WorkflowCompiler()
        ir = compiler.parser.parse(CONDITIONAL_YAML)
        errors = compiler.validator.validate(ir)
        assert errors == []

    def test_validate_condition_without_on_true(self):
        """condition 存在但缺少 on_true 应报错"""
        compiler = WorkflowCompiler()
        ir = IRWorkflow(
            id="test",
            name="Test",
            steps=[
                IRStep(id="s1", name="S1", type=StepType.CONDITIONAL, agent="a",
                       condition="${state.x > 0}", on_true=None, on_false="s2"),
                IRStep(id="s2", name="S2", type=StepType.AGENT, agent="b"),
            ],
        )
        errors = compiler.validator.validate(ir)
        assert any("on_true" in e for e in errors)

    def test_validate_condition_without_on_false(self):
        """condition 存在但缺少 on_false 应报错"""
        compiler = WorkflowCompiler()
        ir = IRWorkflow(
            id="test",
            name="Test",
            steps=[
                IRStep(id="s1", name="S1", type=StepType.CONDITIONAL, agent="a",
                       condition="${state.x > 0}", on_true="s2", on_false=None),
                IRStep(id="s2", name="S2", type=StepType.AGENT, agent="b"),
            ],
        )
        errors = compiler.validator.validate(ir)
        assert any("on_false" in e for e in errors)

    def test_validate_on_true_references_nonexistent_step(self):
        """on_true 引用不存在的步骤ID应报错"""
        compiler = WorkflowCompiler()
        ir = IRWorkflow(
            id="test",
            name="Test",
            steps=[
                IRStep(id="s1", name="S1", type=StepType.CONDITIONAL, agent="a",
                       condition="${state.x > 0}", on_true="nonexistent", on_false="s2"),
                IRStep(id="s2", name="S2", type=StepType.AGENT, agent="b"),
            ],
        )
        errors = compiler.validator.validate(ir)
        assert any("non-existent step" in e for e in errors)

    def test_validate_on_false_references_nonexistent_step(self):
        """on_false 引用不存在的步骤ID应报错"""
        compiler = WorkflowCompiler()
        ir = IRWorkflow(
            id="test",
            name="Test",
            steps=[
                IRStep(id="s1", name="S1", type=StepType.CONDITIONAL, agent="a",
                       condition="${state.x > 0}", on_true="s2", on_false="nonexistent"),
                IRStep(id="s2", name="S2", type=StepType.AGENT, agent="b"),
            ],
        )
        errors = compiler.validator.validate(ir)
        assert any("non-existent step" in e for e in errors)

    def test_validate_condition_bad_syntax(self):
        """条件表达式语法不正确应报错（未用 ${...} 包裹）"""
        compiler = WorkflowCompiler()
        ir = IRWorkflow(
            id="test",
            name="Test",
            steps=[
                IRStep(id="s1", name="S1", type=StepType.CONDITIONAL, agent="a",
                       condition="state.x > 0", on_true="s2", on_false="s3"),
                IRStep(id="s2", name="S2", type=StepType.AGENT, agent="b"),
                IRStep(id="s3", name="S3", type=StepType.AGENT, agent="c"),
            ],
        )
        errors = compiler.validator.validate(ir)
        assert any("${...}" in e for e in errors)

    def test_validate_on_true_self_reference_allowed(self):
        """on_true 引用自身是合法的（循环执行模式，如"分数不够就重写"）"""
        compiler = WorkflowCompiler()
        ir = IRWorkflow(
            id="test",
            name="Test",
            steps=[
                IRStep(id="s1", name="S1", type=StepType.CONDITIONAL, agent="a",
                       condition="${state.x > 0}", on_true="s1", on_false="s2"),
                IRStep(id="s2", name="S2", type=StepType.AGENT, agent="b"),
            ],
        )
        errors = compiler.validator.validate(ir)
        # on_true 自引用不应报错
        assert not any("infinite loop" in e.lower() for e in errors)

    def test_validate_on_false_self_reference(self):
        """on_false 引用自身应报错（无条件跳回自身是死循环）"""
        compiler = WorkflowCompiler()
        ir = IRWorkflow(
            id="test",
            name="Test",
            steps=[
                IRStep(id="s1", name="S1", type=StepType.CONDITIONAL, agent="a",
                       condition="${state.x > 0}", on_true="s2", on_false="s1"),
                IRStep(id="s2", name="S2", type=StepType.AGENT, agent="b"),
            ],
        )
        errors = compiler.validator.validate(ir)
        assert any("infinite loop" in e.lower() for e in errors)

    def test_validate_on_true_without_condition(self):
        """有 on_true 但没有 condition 应报错"""
        compiler = WorkflowCompiler()
        ir = IRWorkflow(
            id="test",
            name="Test",
            steps=[
                IRStep(id="s1", name="S1", type=StepType.AGENT, agent="a",
                       on_true="s2"),
                IRStep(id="s2", name="S2", type=StepType.AGENT, agent="b"),
            ],
        )
        errors = compiler.validator.validate(ir)
        assert any("requires 'condition' field" in e for e in errors)


class TestConditionalCodeGen:
    """MVP2 CodeGen 测试：条件分支代码生成"""

    def test_codegen_conditional_step(self):
        compiler = WorkflowCompiler()
        sop_steps, _ = compiler.compile(CONDITIONAL_YAML)
        cond_step = sop_steps[1]
        assert cond_step["type"] == "conditional"
        assert cond_step["condition"] == "${state.review_result.score < 70}"
        assert cond_step["on_true"] == "rewrite"
        assert cond_step["on_false"] == "publish"

    def test_codegen_conditional_preserves_agent(self):
        """条件分支步骤保留 agent 字段"""
        compiler = WorkflowCompiler()
        sop_steps, _ = compiler.compile(CONDITIONAL_YAML)
        cond_step = sop_steps[1]
        assert cond_step["agent"] == "contentforge:writer"

    def test_codegen_conditional_preserves_output_key(self):
        """条件分支步骤保留 output_key"""
        compiler = WorkflowCompiler()
        sop_steps, _ = compiler.compile(CONDITIONAL_YAML)
        cond_step = sop_steps[1]
        assert cond_step["output_key"] == "rewrite_result"

    def test_codegen_non_conditional_steps_unchanged(self):
        """非条件分支步骤的代码生成不受影响"""
        compiler = WorkflowCompiler()
        sop_steps, _ = compiler.compile(CONDITIONAL_YAML)
        # review 步骤（第一个）应为普通 agent 类型
        assert sop_steps[0]["type"] == "agent"
        assert sop_steps[0]["agent"] == "contentforge:audit"
        # publish 步骤（第三个）应为普通 agent 类型
        assert sop_steps[2]["type"] == "agent"
        assert sop_steps[2]["agent"] == "contentforge:publish"


class TestMVP1Regression:
    """MVP1 回归测试：确保 SEQUENCE 功能不受 MVP2 影响"""

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

    def test_mvp1_compile_still_works(self):
        compiler = WorkflowCompiler()
        sop_steps, ir = compiler.compile(self.HOTFIX_YAML)
        assert len(sop_steps) == 3
        assert ir.id == "dev_hotfix"

    def test_mvp1_no_condition_fields_in_output(self):
        """MVP1 工作流的步骤不应包含 condition 相关字段"""
        compiler = WorkflowCompiler()
        sop_steps, _ = compiler.compile(self.HOTFIX_YAML)
        for step in sop_steps:
            assert "condition" not in step
            assert "on_true" not in step
            assert "on_false" not in step

    def test_mvp1_ir_no_condition(self):
        """MVP1 工作流的 IRStep 的 condition 字段应为 None"""
        compiler = WorkflowCompiler()
        _, ir = compiler.compile(self.HOTFIX_YAML)
        for step in ir.steps:
            assert step.condition is None
            assert step.on_true is None
            assert step.on_false is None
