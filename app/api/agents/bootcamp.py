"""灵智训练营（Bootcamp）API — 用户引导 + 智能体成长训练.

参考 clowder-ai 猫猫训练营（F087 Bootcamp）的设计：
    - packages/api/src/routes/bootcamp.ts
    - packages/api/src/routes/callback-bootcamp-routes.ts
    - packages/api/src/domains/cats/services/bootcamp/env-check.ts

12 阶段状态机（与 clowder-ai PHASE_ORDER 一致）：
    phase-1-intro        — 自我介绍
    phase-2-env-check    — 环境检测
    phase-3-config-help  — 配置帮助（环境有问题时）
    phase-4-task-select  — 选择任务
    phase-5-kickoff      — 确认需求
    phase-6-design       — 设计
    phase-7-dev          — 开发
    phase-7.5-add-teammate — 添加队友
    phase-8-collab       — 多智能体协作
    phase-9-complete     — 完成
    phase-10-retro       — 回顾
    phase-11-farewell    — 毕业

端点：
    - ``GET  /api/v1/bootcamp/env-check``              — 环境检测
    - ``GET  /api/v1/bootcamp/threads``                — 列出所有训练营会话
    - ``POST /api/v1/bootcamp/threads``                — 创建训练营会话
    - ``GET  /api/v1/bootcamp/threads/{id}``           — 获取训练营会话详情
    - ``POST /api/v1/bootcamp/threads/{id}/advance``   — 推进到下一阶段
    - ``POST /api/v1/bootcamp/threads/{id}/env-check`` — 触发环境检测并更新状态

状态机约束（参考 clowder-ai callback-bootcamp-routes.ts）：
    - forward-only：只允许前进，每次最多推进 1 步
    - 跳步例外：phase-2 → phase-4（环境全 OK 跳过配置帮助）
    - 到达 phase-11-farewell 时自动 pin 会话
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from flowforge.app.api.agents.thread_store import get_thread_store
from flowforge.core.tracing import get_logger

logger = get_logger("api.bootcamp")

router = APIRouter(prefix="/bootcamp", tags=["bootcamp"])


# ── 12 阶段状态机（参考 clowder-ai PHASE_ORDER）──────────────────

PHASE_ORDER: list[str] = [
    "phase-1-intro",
    "phase-2-env-check",
    "phase-3-config-help",
    "phase-4-task-select",
    "phase-5-kickoff",
    "phase-6-design",
    "phase-7-dev",
    "phase-7.5-add-teammate",
    "phase-8-collab",
    "phase-9-complete",
    "phase-10-retro",
    "phase-11-farewell",
]

# 阶段中文标签（参考 clowder-ai BootcampListModal.tsx）
PHASE_LABELS: dict[str, str] = {
    "phase-1-intro": "自我介绍",
    "phase-2-env-check": "环境检测",
    "phase-3-config-help": "配置帮助",
    "phase-4-task-select": "选择任务",
    "phase-5-kickoff": "确认需求",
    "phase-6-design": "设计",
    "phase-7-dev": "开发",
    "phase-7.5-add-teammate": "添加队友",
    "phase-8-collab": "多智能体协作",
    "phase-9-complete": "完成",
    "phase-10-retro": "回顾",
    "phase-11-farewell": "毕业",
}

# 允许的跳步例外（参考 clowder-ai ALLOWED_LEGACY_SKIPS）
ALLOWED_SKIPS: set[tuple[str, str]] = {
    ("phase-2-env-check", "phase-4-task-select"),  # 环境全 OK 跳过配置帮助
    ("phase-9-complete", "phase-11-farewell"),      # 完成后跳到毕业
}

# 核心 Forgekin ID（训练营默认引导者 — 鲁班，主架构师）
DEFAULT_LEAD_FORGEKIN = "luban"


# ── 请求/响应模型 ────────────────────────────────────────────────

class BootcampThreadCreate(BaseModel):
    """训练营会话创建请求体。"""
    title: str = Field(
        default="🎓 灵智训练营",
        description="会话标题（默认'灵智训练营'）",
    )
    lead_forgekin_id: str = Field(
        default=DEFAULT_LEAD_FORGEKIN,
        description="引导Forgekin ID（默认 luban 鲁班）",
    )


class BootcampAdvanceRequest(BaseModel):
    """训练营阶段推进请求体。"""
    target_phase: str = Field(
        ...,
        description="目标阶段（如 phase-2-env-check）",
    )


class EnvCheckResult(BaseModel):
    """环境检测结果。"""
    tools: dict[str, dict[str, Any]] = Field(
        default_factory=dict,
        description="工具检测结果：{tool_name: {ok, version, note}}",
    )
    all_core_ok: bool = Field(
        default=False,
        description="核心工具是否全部可用",
    )


# ── 环境检测逻辑（参考 clowder-ai env-check.ts runEnvironmentCheck）──

CORE_TOOLS = ["python", "git", "node", "npm"]
OPTIONAL_TOOLS = ["pnpm", "docker", "uvicorn"]


async def _check_tool(tool: str) -> dict[str, Any]:
    """检测单个工具是否可用（异步执行避免阻塞）.

    Returns:
        {"ok": bool, "version": str, "note": str}
    """
    try:
        # Windows 下使用 where，Linux/Mac 使用 which
        if shutil.which(tool) is None:
            return {"ok": False, "version": "", "note": f"{tool} 未安装或不在 PATH"}

        # 获取版本号
        proc = await asyncio.create_subprocess_exec(
            tool, "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
            version = (stdout.decode("utf-8", errors="ignore").strip() or
                       stderr.decode("utf-8", errors="ignore").strip())
            # 取第一行（版本号通常在第一行）
            version = version.split("\n")[0] if version else ""
            return {"ok": True, "version": version, "note": ""}
        except asyncio.TimeoutError:
            return {"ok": False, "version": "", "note": f"{tool} --version 超时"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "version": "", "note": f"{tool} 检测异常: {exc}"}


async def run_environment_check() -> dict[str, Any]:
    """运行完整环境检测（参考 clowder-ai runEnvironmentCheck）.

    检测项：
        - 核心工具：python, git, node, npm（决定是否跳过 phase-3）
        - 可选工具：pnpm, docker, uvicorn

    Returns:
        {
            "tools": {tool_name: {ok, version, note}},
            "all_core_ok": bool,
        }
    """
    all_tools = CORE_TOOLS + OPTIONAL_TOOLS
    results = await asyncio.gather(*[_check_tool(t) for t in all_tools])

    tools: dict[str, dict[str, Any]] = {}
    for tool, result in zip(all_tools, results):
        tools[tool] = result

    all_core_ok = all(tools[t]["ok"] for t in CORE_TOOLS)

    logger.info(
        "bootcamp 环境检测: core_ok=%s tools=%s",
        all_core_ok,
        {t: tools[t]["ok"] for t in all_tools},
    )

    return {
        "tools": tools,
        "all_core_ok": all_core_ok,
    }


# ── API 端点 ─────────────────────────────────────────────────────

@router.get("/env-check")
async def env_check() -> dict[str, Any]:
    """环境检测 — 检测用户机器上的开发工具是否就绪.

    用于训练营 phase-2-env-check 阶段，判断是否需要进入 phase-3-config-help。
    """
    return await run_environment_check()


@router.get("/phases")
async def list_phases() -> dict[str, Any]:
    """列出训练营所有阶段（供前端展示进度条）."""
    return {
        "phases": [
            {"id": p, "label": PHASE_LABELS.get(p, p), "order": i + 1}
            for i, p in enumerate(PHASE_ORDER)
        ],
        "total": len(PHASE_ORDER),
    }


@router.get("/threads")
async def list_bootcamp_threads() -> dict[str, Any]:
    """列出所有训练营会话."""
    store = get_thread_store()
    threads = store.list_bootcamp_threads()
    return {"items": threads, "total": len(threads)}


@router.post("/threads")
async def create_bootcamp_thread(payload: BootcampThreadCreate) -> dict[str, Any]:
    """创建训练营会话（初始 phase-1-intro）.

    参考 clowder-ai FirstRunQuestWizard.tsx 创建训练营线程的逻辑：
        bootcampState = {v: 1, phase: 'phase-1-intro', leadCat, startedAt}
    """
    store = get_thread_store()
    import time
    bootcamp_state = {
        "v": 1,
        "phase": "phase-1-intro",
        "leadForgekinId": payload.lead_forgekin_id,
        "selectedTaskId": None,
        "envCheck": None,
        "startedAt": int(time.time() * 1000),
        "completedAt": None,
    }
    thread = store.create_thread(
        title=payload.title,
        bootcamp_state=bootcamp_state,
    )
    logger.info(
        "创建训练营会话: id=%s lead=%s",
        thread["id"], payload.lead_forgekin_id,
    )
    return thread


@router.get("/threads/{thread_id}")
async def get_bootcamp_thread(thread_id: str) -> dict[str, Any]:
    """获取训练营会话详情."""
    store = get_thread_store()
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"训练营会话 {thread_id} 不存在")
    if not thread.get("bootcamp_state"):
        raise HTTPException(status_code=400, detail=f"会话 {thread_id} 不是训练营会话")
    return thread


@router.post("/threads/{thread_id}/advance")
async def advance_phase(thread_id: str, payload: BootcampAdvanceRequest) -> dict[str, Any]:
    """推进训练营到下一阶段.

    状态机约束（参考 clowder-ai callback-bootcamp-routes.ts）：
        - forward-only：只允许前进
        - 每次最多推进 1 步（例外：phase-2→phase-4, phase-9→phase-11）
        - 到达 phase-11 时自动 pin 会话
    """
    store = get_thread_store()
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"训练营会话 {thread_id} 不存在")

    current_state = thread.get("bootcamp_state")
    if not current_state:
        raise HTTPException(status_code=400, detail=f"会话 {thread_id} 不是训练营会话")

    current_phase = current_state.get("phase", "phase-1-intro")
    target_phase = payload.target_phase

    # 校验目标阶段
    if target_phase not in PHASE_ORDER:
        raise HTTPException(
            status_code=400,
            detail=f"未知阶段: {target_phase}. 可用: {PHASE_ORDER}",
        )

    current_idx = PHASE_ORDER.index(current_phase)
    target_idx = PHASE_ORDER.index(target_phase)

    # forward-only 校验
    if target_idx <= current_idx:
        raise HTTPException(
            status_code=400,
            detail=f"阶段不能后退或停留: {current_phase} → {target_phase}",
        )

    # 跳步校验
    gap = target_idx - current_idx
    allowed_skip = (current_phase, target_phase) in ALLOWED_SKIPS
    if gap > 1 and not allowed_skip:
        raise HTTPException(
            status_code=400,
            detail=(
                f"阶段跳步不允许: {current_phase} → {target_phase} "
                f"(最多前进 1 步)"
            ),
        )

    # 更新状态
    import time
    updates = {"phase": target_phase}
    if target_phase == "phase-11-farewell":
        updates["completedAt"] = int(time.time() * 1000)

    updated_thread = store.patch_bootcamp_state(thread_id, updates)

    # 到达毕业阶段自动 pin
    if target_phase == "phase-11-farewell":
        store.update_thread(thread_id, pinned=True)
        if updated_thread:
            updated_thread["pinned"] = True

    logger.info(
        "训练营阶段推进: thread=%s %s → %s",
        thread_id, current_phase, target_phase,
    )

    return {
        "thread_id": thread_id,
        "previous_phase": current_phase,
        "current_phase": target_phase,
        "progress": (target_idx + 1) / len(PHASE_ORDER),
        "thread": updated_thread,
    }


@router.post("/threads/{thread_id}/env-check")
async def trigger_env_check(thread_id: str) -> dict[str, Any]:
    """触发环境检测并更新训练营状态.

    在 phase-2-env-check 阶段调用，检测结果写入 bootcamp_state.envCheck。
    若核心工具全部可用，自动推进到 phase-4-task-select（跳过 phase-3）。
    """
    store = get_thread_store()
    thread = store.get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"训练营会话 {thread_id} 不存在")

    current_state = thread.get("bootcamp_state")
    if not current_state:
        raise HTTPException(status_code=400, detail=f"会话 {thread_id} 不是训练营会话")

    # 运行环境检测
    result = await run_environment_check()

    # 更新 bootcamp_state.envCheck
    store.patch_bootcamp_state(thread_id, {"envCheck": result["tools"]})

    # 若核心工具全 OK 且当前在 phase-2，自动推进到 phase-4
    current_phase = current_state.get("phase", "phase-1-intro")
    next_phase = None
    if current_phase == "phase-2-env-check":
        if result["all_core_ok"]:
            next_phase = "phase-4-task-select"
        else:
            next_phase = "phase-3-config-help"

        store.patch_bootcamp_state(thread_id, {"phase": next_phase})
        logger.info(
            "训练营环境检测完成: thread=%s core_ok=%s → %s",
            thread_id, result["all_core_ok"], next_phase,
        )

    return {
        "thread_id": thread_id,
        "env_check": result,
        "auto_advanced_to": next_phase,
    }
