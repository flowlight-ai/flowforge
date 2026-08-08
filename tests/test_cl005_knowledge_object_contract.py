"""CL-005 Knowledge Object Contract — 七字段契约单元测试.

测试覆盖：
1. KnowledgeObject 七字段契约完整性（trigger/procedure/precondition/postcondition/anti_pattern/provenance/confidence）
2. 向后兼容性（旧代码不传七字段也能正常创建）
3. compute_confidence_from_maturity 映射规则
4. 字段非空校验（生产环境应通过 EvalContractRegistry 强制要求）
"""
from __future__ import annotations

import pytest

from flowforge.evolution.models import (
    KnowledgeMaturityLevel,
    KnowledgeObject,
)


def test_knowledge_object_backward_compatible():
    """向后兼容：不传 CL-005 七字段也能创建（所有新字段都有默认值）."""
    obj = KnowledgeObject(
        artifact_type="method",
        domain="development",
        knowledge_type="procedural",
        scope="team_shared",
        trust_level="experimental",
        lifecycle="draft",
    )
    # 旧字段正常
    assert obj.artifact_type == "method"
    assert obj.domain == "development"
    # 新字段有默认值
    assert obj.trigger == ""
    assert obj.procedure == ""
    assert obj.precondition == ""
    assert obj.postcondition == ""
    assert obj.anti_pattern == ""
    assert obj.confidence == 0.0


def test_knowledge_object_seven_fields_contract():
    """CL-005 七字段契约：所有字段都可被设置."""
    obj = KnowledgeObject(
        artifact_type="method",
        domain="development",
        knowledge_type="procedural",
        scope="team_shared",
        trust_level="validated",
        lifecycle="active",
        provenance={"author_type": "agent", "agent_id": "luban"},
        source_refs=["ep-001", "ep-002"],
        maturity_level="L3",
        # CL-005 七字段
        trigger="用户询问代码审查时",
        procedure="1. 读取代码 2. 检查风格 3. 给出建议",
        precondition="代码必须可编译",
        postcondition="建议必须包含行号引用",
        anti_pattern="不要用于自动合入",
        confidence=0.85,
    )
    assert obj.trigger == "用户询问代码审查时"
    assert obj.procedure.startswith("1. 读取代码")
    assert obj.precondition == "代码必须可编译"
    assert obj.postcondition == "建议必须包含行号引用"
    assert obj.anti_pattern == "不要用于自动合入"
    assert obj.confidence == 0.85
    assert obj.provenance["author_type"] == "agent"


def test_compute_confidence_l0():
    """L0 → 0.2."""
    obj = KnowledgeObject(
        artifact_type="episode",
        domain="dev",
        knowledge_type="declarative",
        scope="agent_local",
        trust_level="experimental",
        lifecycle="draft",
        maturity_level=KnowledgeMaturityLevel.L0_EPISODE.value,
    )
    assert obj.compute_confidence_from_maturity() == 0.2


def test_compute_confidence_l1():
    """L1 → 0.4."""
    obj = KnowledgeObject(
        artifact_type="episode",
        domain="dev",
        knowledge_type="declarative",
        scope="agent_local",
        trust_level="experimental",
        lifecycle="draft",
        maturity_level=KnowledgeMaturityLevel.L1_PATTERN.value,
    )
    assert obj.compute_confidence_from_maturity() == 0.4


def test_compute_confidence_l2():
    """L2 → 0.6."""
    obj = KnowledgeObject(
        artifact_type="method",
        domain="dev",
        knowledge_type="procedural",
        scope="team_shared",
        trust_level="experimental",
        lifecycle="draft",
        maturity_level=KnowledgeMaturityLevel.L2_DRAFT.value,
    )
    assert obj.compute_confidence_from_maturity() == 0.6


def test_compute_confidence_l3():
    """L3 → 0.8."""
    obj = KnowledgeObject(
        artifact_type="method",
        domain="dev",
        knowledge_type="procedural",
        scope="team_shared",
        trust_level="validated",
        lifecycle="active",
        maturity_level=KnowledgeMaturityLevel.L3_VALIDATED.value,
    )
    assert obj.compute_confidence_from_maturity() == 0.8


def test_compute_confidence_l4():
    """L4 → 1.0."""
    obj = KnowledgeObject(
        artifact_type="method",
        domain="dev",
        knowledge_type="procedural",
        scope="team_shared",
        trust_level="production",
        lifecycle="active",
        maturity_level=KnowledgeMaturityLevel.L4_STANDARD.value,
    )
    assert obj.compute_confidence_from_maturity() == 1.0


def test_compute_confidence_unknown_maturity():
    """未知 maturity → 默认 0.2（保守）."""
    obj = KnowledgeObject(
        artifact_type="episode",
        domain="dev",
        knowledge_type="declarative",
        scope="agent_local",
        trust_level="experimental",
        lifecycle="draft",
        maturity_level="L99",  # 未知
    )
    assert obj.compute_confidence_from_maturity() == 0.2


def test_knowledge_object_seven_fields_list():
    """CL-005 七字段列表完整性（按顺序）."""
    # 七字段：trigger/procedure/precondition/postcondition/anti_pattern/provenance/confidence
    seven_fields = [
        "trigger",
        "procedure",
        "precondition",
        "postcondition",
        "anti_pattern",
        "provenance",
        "confidence",
    ]
    obj = KnowledgeObject(
        artifact_type="method",
        domain="dev",
        knowledge_type="procedural",
        scope="team_shared",
        trust_level="validated",
        lifecycle="active",
    )
    for field_name in seven_fields:
        assert hasattr(obj, field_name), f"KnowledgeObject 缺少 CL-005 字段: {field_name}"


def test_knowledge_object_serialization():
    """KnowledgeObject 可序列化为 dict（含七字段）."""
    obj = KnowledgeObject(
        artifact_type="method",
        domain="dev",
        knowledge_type="procedural",
        scope="team_shared",
        trust_level="validated",
        lifecycle="active",
        maturity_level="L3",
        trigger="trigger text",
        procedure="procedure text",
        precondition="precondition text",
        postcondition="postcondition text",
        anti_pattern="anti pattern text",
        confidence=0.85,
    )
    data = obj.model_dump()
    assert data["trigger"] == "trigger text"
    assert data["procedure"] == "procedure text"
    assert data["precondition"] == "precondition text"
    assert data["postcondition"] == "postcondition text"
    assert data["anti_pattern"] == "anti pattern text"
    assert data["confidence"] == 0.85
