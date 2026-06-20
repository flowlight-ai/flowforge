"""Workflow IR（中间表示）数据结构

IR 是 YAML 和执行图之间的中间层，解耦解析与代码生成。
MVP1 支持 SEQUENCE 模式（顺序执行）。
MVP2 扩展 CONDITIONAL 模式（条件分支）。
"""

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class StepType(str, Enum):
    """步骤类型枚举"""

    AGENT = "agent"
    TOOL = "tool"
    GATE = "gate"
    PARALLEL = "parallel"
    CONDITIONAL = "conditional"
    FALLBACK = "fallback"
    LOOP = "loop"


class IRStep(BaseModel):
    """IR 步骤节点

    每个 step 描述工作流中的一个执行单元。
    MVP1 使用 agent/tool/gate 三种类型。
    MVP2 扩展 condition/on_true/on_false 支持条件分支。
    """

    id: str
    name: str
    type: StepType = StepType.AGENT
    agent: Optional[str] = None
    tool: Optional[str] = None
    input_mapping: Dict[str, str] = {}
    output_key: Optional[str] = None
    execution_policy: Dict[str, Any] = {}
    checkpoint: Dict[str, Any] = {}
    # MVP2: 条件分支字段
    condition: Optional[str] = None   # 条件表达式，如 "${state.score >= 70}"
    on_true: Optional[str] = None     # 条件为真时跳转的步骤ID
    on_false: Optional[str] = None    # 条件为假时跳转的步骤ID
    # PARALLEL: 并行执行的子步骤列表
    parallel_steps: List["IRStep"] = []
    # FALLBACK: 主步骤和回退步骤
    primary: List["IRStep"] = []
    fallback: List["IRStep"] = []
    # LOOP: 循环执行
    loop_steps: List["IRStep"] = []
    max_iterations: int = 1
    exit_condition: Optional[str] = None
    loop_variable: Optional[str] = None

    model_config = {"extra": "allow"}


class IRWorkflow(BaseModel):
    """IR 工作流

    YAML 解析后的中间表示，包含完整的步骤列表和元信息。
    SEQUENCE 模式下步骤按列表顺序依次执行。
    CONDITIONAL 模式下步骤可通过 condition/on_true/on_false 实现分支跳转。
    """

    id: str
    name: str
    description: str = ""
    version: str = "1.0"
    steps: List[IRStep] = []
    state_schema: Dict[str, Any] = {}
    execution_policy: Dict[str, Any] = {}
    checkpoint: Dict[str, Any] = {}

    model_config = {"extra": "allow"}
