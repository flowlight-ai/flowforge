"""Workflow graph model definitions.

Contains the data models that describe a workflow's structure:
nodes (steps), edges (connections), and the graph itself.
"""

from typing import Any

from pydantic import BaseModel, Field


class WorkflowNode(BaseModel):
    """A single step in a workflow graph.

    Represents an atomic unit of work — either an agent call, a tool
    invocation, an LLM generation step, or a human review gate.
    """

    name: str = Field(..., description="Unique step name within the workflow")
    type: str = Field("generate", description="Step type: agent | tool | generate | human")
    agent: str | None = Field(None, description="Agent name when type=agent")
    tool: str | None = Field(None, description="Tool name when type=tool")
    mode: str | None = Field(None, description="Mode executor hint for sub-step")
    prompt: str | None = Field(None, description="Prompt template (supports {{var}} interpolation)")
    input: dict[str, Any] = Field(default_factory=dict, description="Input parameters for the step")
    output: str | None = Field(None, description="Key name to store step result in context")
    description: str | None = Field(None, description="Human-readable step description")
    on_error: str = Field("abort", description="Error handling: abort | skip | retry | reflexion_retry")
    retry_count: int = Field(1, description="Number of retries when on_error=retry")
    retry_delay: float = Field(2, description="Delay in seconds between retries")
    human: bool = Field(False, description="Whether this step requires human review")
    force_mode: bool = Field(False, description="Force the specified mode even if agent exists")
    parallel_group: list[dict[str, Any]] | None = Field(
        None, description="List of sub-steps to execute in parallel"
    )

    model_config = {"extra": "allow"}


class WorkflowEdge(BaseModel):
    """A directed connection between two workflow nodes.

    Edges define the execution order and optional transition conditions.
    """

    source: str = Field(..., description="Source node name")
    target: str = Field(..., description="Target node name")
    condition: str | None = Field(None, description="Optional condition expression for conditional edges")

    model_config = {"extra": "allow"}


class WorkflowGraph(BaseModel):
    """Complete workflow graph definition.

    A graph is an ordered list of nodes with optional edges that
    describe the execution flow. When edges are absent, nodes are
    executed in list order (sequential SOP).
    """

    nodes: list[WorkflowNode] = Field(default_factory=list, description="Ordered list of workflow steps")
    edges: list[WorkflowEdge] = Field(default_factory=list, description="Optional directed edges between nodes")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Workflow-level metadata")

    model_config = {"extra": "allow"}
