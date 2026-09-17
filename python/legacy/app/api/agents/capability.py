"""Capability API — 能力画像（真实数据：agent/mode 注册表派生）.

对应设计文档 §10.2：
    - ``GET /api/v1/capability/profiles``  — 能力画像列表

数据来源（真实，非 stub）：
    - agent_registry：每个 Forgekin/Agent 的默认执行模式（model）与能力列表（signals）
    - mode_registry：每种执行模式的能力定义（capabilities）
    - 审计日志：最近出现过的执行动作作为辅助信号（source=audit）

前端契约（ProfilesSection）：
    {
      "items": [
        {"id", "label", "model", "source", "signals": []}
      ],
      "total": N,
      "limit", "offset"
    }
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from flowforge.core.tracing import get_logger

logger = get_logger("capability_api")

router = APIRouter(prefix="/capability", tags=["capability"])

_MODE_DISPLAY = {
    "react": "ReAct 推理循环",
    "plan_execute": "计划-执行",
    "reflexion": "反思迭代",
    "rewoo": "ReWOO 蓝图并行",
    "agent_judge": "Agent 评判",
    "workflow": "工作流编排",
    "multi_agent": "多 Agent 协作",
    "self_discover": "自发现模式",
    "graph_of_thoughts": "思维图谱",
}


async def _build_profiles(forgekin_id: str | None = None) -> list[dict[str, Any]]:
    """从 agent/mode 注册表派生能力画像（真实运行时数据）。"""
    profiles: list[dict[str, Any]] = []
    try:
        from flowforge.app.deps import get_executor

        executor = await get_executor()
    except Exception as e:  # noqa: BLE001 — 注册表不可用时降级为空
        logger.warning(f"capability: executor unavailable: {e}")
        return profiles

    # 1. Agent 画像：每个可进化智能体 = 一个画像（model=默认执行模式）
    try:
        agent_names = executor.agent_registry.list_agents()
        for name in agent_names:
            if forgekin_id and forgekin_id != name:
                continue
            agent = executor.agent_registry.get(name)
            mode = getattr(agent, "default_mode", "") or ""
            caps = list(getattr(agent, "capabilities", []) or [])
            desc = getattr(agent, "description", "") or ""
            profiles.append({
                "id": name,
                "label": getattr(agent, "display_name", "") or name,
                "model": mode or None,
                "source": "agent_registry",
                "signals": caps or ([mode] if mode else []),
                "description": desc,
            })
    except Exception as e:  # noqa: BLE001
        logger.warning(f"capability: agent registry scan failed: {e}")

    # 2. 模式画像：每种执行模式自身的能力画像
    try:
        mode_names = executor.mode_registry.list_modes()
        for mname in mode_names:
            if forgekin_id and forgekin_id != f"mode:{mname}":
                continue
            mode = executor.mode_registry.get(mname)
            caps = list(getattr(mode, "capabilities", []) or [])
            profiles.append({
                "id": f"mode:{mname}",
                "label": _MODE_DISPLAY.get(mname, mname),
                "model": mname,
                "source": "mode_registry",
                "signals": caps,
                "description": getattr(mode, "description", "") or "",
            })
    except Exception as e:  # noqa: BLE001
        logger.warning(f"capability: mode registry scan failed: {e}")

    # 3. 审计信号：最近 20 条审计动作作为补充画像（source=audit）
    try:
        from flowforge.app.api.core.logs import get_audit_logger

        audit = get_audit_logger().query(limit=20)
        seen_actions: set[str] = set()
        for item in audit.get("items", []):
            action = (item.get("action") or "").strip()
            if not action or action in seen_actions:
                continue
            seen_actions.add(action)
            profiles.append({
                "id": f"audit:{action}",
                "label": action,
                "model": None,
                "source": "audit",
                "signals": [item.get("mode") or "system"],
                "description": "来自审计日志的最近执行动作",
            })
    except Exception as e:  # noqa: BLE001
        logger.debug(f"capability: audit signals unavailable: {e}")

    return profiles


@router.get("/profiles")
async def list_capability_profiles(
    forgekin_id: str | None = Query(default=None, description="按Forgekin过滤"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """列出能力画像（agent/mode 注册表真实数据 + 审计派生信号）。"""
    all_profiles = await _build_profiles(forgekin_id=forgekin_id)
    total = len(all_profiles)
    return {
        "items": all_profiles[offset:offset + limit],
        "total": total,
        "limit": limit,
        "offset": offset,
        "filter": {"forgekin_id": forgekin_id} if forgekin_id else None,
    }
