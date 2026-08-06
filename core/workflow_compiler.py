"""Workflow Compiler — 统一入口

此文件保留作为向后兼容入口，实际实现已迁移到 flowforge.compiler 包。

注意：compiler 包的 WorkflowCompiler.compile() 返回 (sop_steps, IRWorkflow) 元组，
与旧版 CompiledWorkflow 对象不同。如需使用 CompiledWorkflow，请直接从本模块导入。
"""
from __future__ import annotations

from typing import Any

from flowforge.compiler.codegen import WorkflowCodeGen
from flowforge.compiler.compiler import WorkflowCompiler
from flowforge.compiler.ir import IRStep, IRWorkflow, StepType
from flowforge.compiler.parser import WorkflowParser
from flowforge.compiler.validator import WorkflowValidator

# ── 旧版 CompiledWorkflow（core 版本独有，compiler 包使用元组返回） ──


class CompiledWorkflow:
    """A workflow that has been validated and compiled from YAML config.

    Contains the resolved node graph, edges, entry point, interrupt points,
    and the compiled sop_steps format for WorkflowExecutor consumption.

    注意：此类仅保留用于向后兼容。compiler 包的 WorkflowCompiler
    返回 (sop_steps, IRWorkflow) 元组，不使用此类。
    """

    def __init__(
        self,
        name: str,
        description: str = "",
        version: float = 1.0,
        nodes: dict | None = None,
        edges: list | None = None,
        entry_point: str = "",
        interrupt_before: list | None = None,
        state_config: Any = None,
        config: Any = None,
        sop_steps: list | None = None,
        adjacency: dict | None = None,
    ) -> None:
        self.name = name
        self.description = description
        self.version = version
        self.nodes = nodes or {}
        self.edges = edges or []
        self.entry_point = entry_point
        self.interrupt_before = interrupt_before or []
        self.state_config = state_config
        self.config = config
        self.sop_steps = sop_steps or []
        self.adjacency = adjacency or {}

    def __repr__(self) -> str:
        return (
            f"CompiledWorkflow(name='{self.name}', "
            f"nodes={len(self.nodes)}, "
            f"entry='{self.entry_point}', "
            f"sop_steps={len(self.sop_steps)})"
        )


__all__ = [
    "WorkflowCompiler", "CompiledWorkflow",
    "WorkflowParser", "IRStep", "IRWorkflow", "StepType",
    "WorkflowValidator", "WorkflowCodeGen",
]
