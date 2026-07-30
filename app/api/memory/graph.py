"""API端点：提供workflow/agent/模式的静态关系图数据"""
from fastapi import APIRouter, HTTPException
from flowforge.core.agent_registry import AgentRegistry
from flowforge.modes.registry import ModeRegistry
from flowforge.tools.registry import ToolRegistry
import os
import yaml

router = APIRouter(prefix="/graph", tags=["graph"])

agent_registry: AgentRegistry = None
mode_registry: ModeRegistry = None
tool_registry: ToolRegistry = None


def init_graph_api(ar: AgentRegistry, mr: ModeRegistry, tr: ToolRegistry):
    global agent_registry, mode_registry, tool_registry
    agent_registry = ar
    mode_registry = mr
    tool_registry = tr


MODE_GRAPH_DEFS = {
    "react": {
        "display_name": "ReAct 推理循环",
        "description": "思考-行动-观察的迭代推理模式，通过逐步推理和工具调用解决复杂问题",
        "nodes": [
            {"id": "thought", "label": "思考(Thought)", "type": "llm"},
            {"id": "action", "label": "行动(Action)", "type": "tool"},
            {"id": "observation", "label": "观察(Observation)", "type": "result"},
        ],
        "edges": [
            {"from": "thought", "to": "action"},
            {"from": "action", "to": "observation"},
            {"from": "observation", "to": "thought", "label": "循环"},
        ],
    },
    "plan_execute": {
        "display_name": "计划-执行",
        "description": "先由规划器分解任务为步骤，再逐步执行每个步骤",
        "nodes": [
            {"id": "planner", "label": "规划(Planner)", "type": "llm"},
            {"id": "executor", "label": "执行(Executor)", "type": "tool"},
        ],
        "edges": [
            {"from": "planner", "to": "executor"},
        ],
    },
    "reflexion": {
        "display_name": "反思迭代",
        "description": "生成-评估-反思的迭代模式，通过自我反思持续改进输出质量",
        "nodes": [
            {"id": "actor", "label": "生成(Actor)", "type": "llm"},
            {"id": "evaluator", "label": "评估(Evaluator)", "type": "llm"},
            {"id": "reflector", "label": "反思(Reflector)", "type": "llm"},
        ],
        "edges": [
            {"from": "actor", "to": "evaluator"},
            {"from": "evaluator", "to": "reflector"},
            {"from": "reflector", "to": "actor", "label": "迭代"},
        ],
    },
    "rewoo": {
        "display_name": "ReWOO 蓝图并行",
        "description": "先生成工具调用蓝图，再并行执行所有步骤，减少串行等待",
        "nodes": [
            {"id": "blueprint", "label": "蓝图(Blueprint)", "type": "llm"},
            {"id": "parallel_exec", "label": "并行执行", "type": "tool"},
        ],
        "edges": [
            {"from": "blueprint", "to": "parallel_exec"},
        ],
    },
    "agent_judge": {
        "display_name": "Agent 评判",
        "description": "生成器产出内容后由评判器评估质量，给出评分和改进建议",
        "nodes": [
            {"id": "actor", "label": "生成(Actor)", "type": "llm"},
            {"id": "judge", "label": "评判(Judge)", "type": "llm"},
        ],
        "edges": [
            {"from": "actor", "to": "judge"},
        ],
    },
    "workflow": {
        "display_name": "工作流编排",
        "description": "按预定义SOP步骤顺序编排多个Agent执行",
        "nodes": [
            {"id": "sop_steps", "label": "SOP步骤编排", "type": "orchestrator"},
            {"id": "agent_call", "label": "Agent调用", "type": "agent"},
            {"id": "review", "label": "审核节点", "type": "review"},
        ],
        "edges": [
            {"from": "sop_steps", "to": "agent_call"},
            {"from": "agent_call", "to": "review"},
        ],
    },
    "multi_agent": {
        "display_name": "多Agent协作",
        "description": "多个Agent并行协作完成同一任务",
        "nodes": [
            {"id": "coordinator", "label": "协调器", "type": "llm"},
            {"id": "agents", "label": "多Agent并行", "type": "agent"},
        ],
        "edges": [
            {"from": "coordinator", "to": "agents"},
        ],
    },
    "self_discover": {
        "display_name": "自发现模式",
        "description": "分析任务特征，自动推荐最合适的执行模式",
        "nodes": [
            {"id": "analyze", "label": "分析任务", "type": "llm"},
            {"id": "recommend", "label": "推荐模式", "type": "llm"},
        ],
        "edges": [
            {"from": "analyze", "to": "recommend"},
        ],
    },
    "graph_of_thoughts": {
        "display_name": "思维图谱",
        "description": "通过分支推理和评估筛选，探索多条推理路径",
        "nodes": [
            {"id": "initial", "label": "初始思考", "type": "llm"},
            {"id": "branch", "label": "分支推理", "type": "llm"},
            {"id": "evaluate", "label": "评估筛选", "type": "llm"},
        ],
        "edges": [
            {"from": "initial", "to": "branch"},
            {"from": "branch", "to": "evaluate"},
            {"from": "evaluate", "to": "branch", "label": "迭代"},
        ],
    },
}


def _load_workflow_defs():
    import flowforge
    flowforge_dir = os.path.dirname(os.path.abspath(flowforge.__file__))
    wf_dir = os.path.join(flowforge_dir, "workflows")
    wf_dir = os.path.normpath(wf_dir)
    workflows = {}
    if os.path.isdir(wf_dir):
        for f in os.listdir(wf_dir):
            if f.endswith((".yaml", ".yml")):
                with open(os.path.join(wf_dir, f), "r", encoding="utf-8") as fh:
                    data = yaml.safe_load(fh)
                    name = f.replace(".yaml", "").replace(".yml", "")
                    workflows[name] = data
    return workflows


def _resolve_mode_name(step: dict, agent_name: str | None) -> str | None:
    mode_name = step.get("mode")
    if not mode_name and agent_name and agent_registry:
        agent = agent_registry.get(agent_name)
        if agent:
            mode_name = getattr(agent, "default_mode", None)
    return mode_name


def _add_mode_sub_nodes(
    nodes: list, edges: list,
    parent_id: str, step_prefix: str, mode_name: str,
):
    mode_def = MODE_GRAPH_DEFS.get(mode_name, {})
    if not mode_def:
        return

    mode_node_id = f"{step_prefix}__mode"
    nodes.append({
        "id": mode_node_id,
        "type": "mode",
        "label": mode_def.get("display_name", mode_name),
        "parent": parent_id,
    })
    edges.append({"from": parent_id, "to": mode_node_id})

    prev_mode_node = mode_node_id
    for mode_node in mode_def.get("nodes", []):
        sub_node_id = f"{step_prefix}__{mode_node['id']}"
        nodes.append({
            "id": sub_node_id,
            "type": mode_node["type"],
            "label": mode_node["label"],
            "parent": mode_node_id,
        })
        edges.append({"from": prev_mode_node, "to": sub_node_id})
        prev_mode_node = sub_node_id

    for mode_edge in mode_def.get("edges", []):
        if mode_edge.get("label") in ("循环", "迭代"):
            from_id = f"{step_prefix}__{mode_edge['from']}"
            to_id = f"{step_prefix}__{mode_edge['to']}"
            edges.append({"from": from_id, "to": to_id, "label": mode_edge["label"]})


def _add_agent_tool_nodes(
    nodes: list, edges: list,
    parent_id: str, agent_name: str,
):
    if not agent_registry:
        return
    agent = agent_registry.get(agent_name)
    if not agent:
        return
    tool_names = getattr(agent, "tool_names", None)
    if not tool_names:
        return
    for tn in tool_names:
        tool_node_id = f"{parent_id}__tool__{tn}"
        nodes.append({
            "id": tool_node_id,
            "type": "tool",
            "label": tn,
            "parent": parent_id,
        })
        edges.append({"from": parent_id, "to": tool_node_id})


@router.get("/workflows")
async def list_workflows():
    workflows = _load_workflow_defs()
    result = []
    for name, wf in workflows.items():
        steps = []
        for s in wf.get("steps", []):
            step_name = s.get("name") or s.get("id", "")
            step = {"name": step_name}
            if s.get("agent"):
                step["agent"] = s["agent"]
            if s.get("mode"):
                step["mode"] = s["mode"]
            if s.get("output"):
                step["output"] = s["output"]
            if s.get("human"):
                step["human"] = True
            if s.get("parallel_group"):
                step["parallel_group"] = True
            if s.get("display_name"):
                step["display_name"] = s["display_name"]
            steps.append(step)
        result.append({
            "name": name,
            "display_name": wf.get("display_name", name),
            "description": wf.get("description", ""),
            "steps": steps,
        })
    return result


@router.get("/workflows/{name}")
async def get_workflow_graph(name: str):
    workflows = _load_workflow_defs()
    if name not in workflows:
        raise HTTPException(404, f"Workflow '{name}' not found")
    wf = workflows[name]
    steps = wf.get("steps", [])

    nodes = []
    edges = []

    for i, s in enumerate(steps):
        node_id = s.get("name") or s.get("id", f"step-{i}")
        step_type = "review" if s.get("human") else "agent"

        nodes.append({
            "id": node_id,
            "type": step_type,
            "label": s.get("display_name") or s.get("label", node_id),
        })

        agent_name = s.get("agent")
        if agent_name:
            agent_node_id = f"{node_id}__agent"
            nodes.append({
                "id": agent_node_id,
                "type": "agent",
                "label": agent_name,
                "parent": node_id,
            })
            edges.append({"from": node_id, "to": agent_node_id})

            mode_name = _resolve_mode_name(s, agent_name)
            if mode_name:
                _add_mode_sub_nodes(
                    nodes, edges,
                    parent_id=agent_node_id,
                    step_prefix=node_id,
                    mode_name=mode_name,
                )

            _add_agent_tool_nodes(
                nodes, edges,
                parent_id=agent_node_id,
                agent_name=agent_name,
            )

        if i > 0:
            prev_id = steps[i - 1].get("name") or steps[i - 1].get("id", f"step-{i - 1}")
            edges.append({"from": prev_id, "to": node_id})

    return {
        "name": name,
        "display_name": wf.get("display_name", name),
        "description": wf.get("description", ""),
        "nodes": nodes,
        "edges": edges,
    }


@router.get("/agents")
async def list_agents():
    if not agent_registry:
        return []
    agents = agent_registry.get_all() if hasattr(agent_registry, 'get_all') else {}
    result = []
    for name, agent in agents.items():
        mode_name = getattr(agent, 'default_mode', '')
        mode_def = MODE_GRAPH_DEFS.get(mode_name, {})
        result.append({
            "name": name,
            "display_name": getattr(agent, 'display_name', '') or name,
            "description": getattr(agent, 'description', ''),
            "default_mode": mode_name,
            "mode_display_name": mode_def.get("display_name", mode_name),
        })
    return result


@router.get("/agents/{name}")
async def get_agent_graph(name: str):
    if not agent_registry:
        raise HTTPException(404, "Agent registry not initialized")
    agent = agent_registry.get(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")

    nodes = []
    edges = []

    agent_node_id = f"agent__{name}"
    nodes.append({
        "id": agent_node_id,
        "type": "agent",
        "label": getattr(agent, 'display_name', '') or name,
    })

    mode_name = getattr(agent, 'default_mode', 'plan_execute')
    mode_def = MODE_GRAPH_DEFS.get(mode_name, {})

    if mode_name:
        mode_node_id = f"{agent_node_id}__mode"
        nodes.append({
            "id": mode_node_id,
            "type": "mode",
            "label": mode_def.get("display_name", mode_name),
            "parent": agent_node_id,
        })
        edges.append({"from": agent_node_id, "to": mode_node_id})

        prev_mode_node = mode_node_id
        for mode_node in mode_def.get("nodes", []):
            sub_node_id = f"{agent_node_id}__{mode_node['id']}"
            nodes.append({
                "id": sub_node_id,
                "type": mode_node["type"],
                "label": mode_node["label"],
                "parent": mode_node_id,
            })
            edges.append({"from": prev_mode_node, "to": sub_node_id})
            prev_mode_node = sub_node_id

        for mode_edge in mode_def.get("edges", []):
            if mode_edge.get("label") in ("循环", "迭代"):
                from_id = f"{agent_node_id}__{mode_edge['from']}"
                to_id = f"{agent_node_id}__{mode_edge['to']}"
                edges.append({"from": from_id, "to": to_id, "label": mode_edge["label"]})

    _add_agent_tool_nodes(
        nodes, edges,
        parent_id=agent_node_id,
        agent_name=name,
    )

    return {
        "name": name,
        "display_name": getattr(agent, 'display_name', '') or name,
        "description": getattr(agent, 'description', ''),
        "default_mode": mode_name,
        "mode_display_name": mode_def.get("display_name", mode_name),
        "mode_description": mode_def.get("description", ""),
        "nodes": nodes,
        "edges": edges,
    }


@router.get("/modes")
async def list_modes():
    if not mode_registry:
        return []
    result = []
    for name in mode_registry.list_modes():
        mode = mode_registry.get(name)
        mode_def = MODE_GRAPH_DEFS.get(name, {})
        result.append({
            "name": name,
            "display_name": mode_def.get("display_name", name),
            "description": mode_def.get("description", ""),
            "capabilities": getattr(mode, 'capabilities', []),
        })
    return result


@router.get("/modes/{name}")
async def get_mode_graph(name: str):
    if not mode_registry:
        raise HTTPException(404, "Mode registry not initialized")
    mode = mode_registry.get(name)
    if not mode:
        raise HTTPException(404, f"Mode '{name}' not found")

    mode_def = MODE_GRAPH_DEFS.get(name, {})
    nodes = mode_def.get("nodes", [])
    edges = mode_def.get("edges", [])

    return {
        "name": name,
        "display_name": mode_def.get("display_name", name),
        "description": mode_def.get("description", ""),
        "capabilities": getattr(mode, 'capabilities', []),
        "nodes": nodes,
        "edges": edges,
    }
