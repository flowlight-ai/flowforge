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


def _check_tool_sync(tool: str) -> dict[str, Any]:
    """检测单个工具是否可用（同步实现，由 _check_tool 在线程池中调用）.

    Windows 注意：
        - asyncio.create_subprocess_exec 在某些事件循环下会静默失败
        - 改用 subprocess.run（同步）+ asyncio 线程池调度，稳定性更高
        - Windows 下 uvicorn 不带 --version，需对 uvicorn 特殊处理

    Returns:
        {"ok": bool, "version": str, "note": str}
    """
    # 1. 先用 shutil.which 判断是否在 PATH
    resolved = shutil.which(tool)
    if resolved is None:
        return {"ok": False, "version": "", "note": f"{tool} 未安装或不在 PATH"}

    # 2. uvicorn 是 Python 模块，没有独立的 --version CLI
    if tool == "uvicorn":
        try:
            import uvicorn as _uv  # noqa: F401
            return {
                "ok": True,
                "version": f"v{_uv.__version__}",
                "note": "",
            }
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "version": "", "note": f"uvicorn 导入失败: {exc}"}

    # 3. 通用：执行 `<tool> --version`
    try:
        proc = subprocess.run(
            [tool, "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5,
            shell=False,
        )
        version = (
            proc.stdout.decode("utf-8", errors="ignore").strip()
            or proc.stderr.decode("utf-8", errors="ignore").strip()
        )
        # 取第一行（版本号通常在第一行）
        version = version.split("\n")[0] if version else ""
        if proc.returncode == 0 or version:
            return {"ok": True, "version": version, "note": ""}
        return {
            "ok": False,
            "version": "",
            "note": f"{tool} --version 退出码 {proc.returncode}",
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "version": "", "note": f"{tool} --version 超时"}
    except FileNotFoundError:
        return {"ok": False, "version": "", "note": f"{tool} 未安装或不在 PATH"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "version": "", "note": f"{tool} 检测异常: {exc}"}


async def _check_tool(tool: str) -> dict[str, Any]:
    """检测单个工具是否可用（在线程池中执行同步检测）.

    Returns:
        {"ok": bool, "version": str, "note": str}
    """
    return await asyncio.get_event_loop().run_in_executor(
        None, _check_tool_sync, tool
    )


async def run_environment_check() -> dict[str, Any]:
    """运行完整环境检测（联动 doctor.py，覆盖 9 个灵智体所需全部依赖）.

    检测项（通过调用 doctor.py 的 run_doctor 实现）：
        - Python/Node/Git 基础环境
        - 8 个 CLI 工具（claude/codex/gemini/opencode/codebuddy/qodercli/iflow/kimi）
        - 3 个协议代理（claude-code-router/responses-proxy/gemini-proxy）
        - Trae 桥接目录（butterfly 灵智体）
        - .env 配置文件（含 API key 检测）
        - .venv 虚拟环境
        - web/node_modules 前端依赖

    Returns:
        {
            "tools": {tool_name: {ok, version, note}},
            "all_core_ok": bool,
            "cli_tools": [...],
            "proxies": [...],
            "trae_bridge": {...},
            "env_file": {...},
            "venv": {...},
            "web_deps": {...},
            "missing_cli": [...],
            "install_hint": str,
        }
    """
    # 先运行基础工具检测（保持兼容性）
    all_tools = CORE_TOOLS + OPTIONAL_TOOLS
    results = await asyncio.gather(*[_check_tool(t) for t in all_tools])

    tools: dict[str, dict[str, Any]] = {}
    for tool, result in zip(all_tools, results):
        tools[tool] = result

    all_core_ok = all(tools[t]["ok"] for t in CORE_TOOLS)

    # 联动 doctor.py 进行深度检测（在线程池中运行避免阻塞）
    doctor_results = await asyncio.get_event_loop().run_in_executor(
        None, _run_doctor_sync
    )

    # 提取 CLI 工具检测结果
    cli_tools = doctor_results.get("cli_tools", [])
    missing_cli = [
        t["name"] for t in cli_tools
        if isinstance(t, dict) and t.get("status") == "missing"
    ]

    # 提取 Trae 桥接状态
    trae_bridge = doctor_results.get("trae_bridge", {})

    # 提取 .env 配置状态
    env_file = doctor_results.get("env_file", {})

    # 提取 venv 状态
    venv = doctor_results.get("venv", {})

    # 提取 web 依赖状态
    web_deps = doctor_results.get("web_deps", {})

    # 生成安装提示
    install_hint = ""
    if missing_cli:
        install_hint = (
            f"检测到 {len(missing_cli)} 个 CLI 工具未安装: {', '.join(missing_cli)}。"
            "请运行 install.bat（Windows）或 ./install.sh（Unix）一键安装。"
        )
    elif not all_core_ok:
        install_hint = "核心开发工具缺失，请先安装 Python/Node.js/Git。"
    elif not env_file.get("exists", False):
        install_hint = ".env 配置文件不存在，请运行 install 脚本生成。"
    elif not venv.get("exists", False):
        install_hint = ".venv 虚拟环境不存在，请运行 install 脚本创建。"
    else:
        install_hint = "环境就绪！可以开始使用 FlowForge。"

    logger.info(
        "bootcamp 环境检测（联动 doctor）: core_ok=%s missing_cli=%s trae_bridge=%s",
        all_core_ok,
        missing_cli,
        trae_bridge.get("status", "unknown"),
    )

    return {
        "tools": tools,
        "all_core_ok": all_core_ok,
        "cli_tools": cli_tools,
        "proxies": doctor_results.get("proxies", []),
        "trae_bridge": trae_bridge,
        "env_file": env_file,
        "venv": venv,
        "web_deps": web_deps,
        "missing_cli": missing_cli,
        "install_hint": install_hint,
    }


def _run_doctor_sync() -> dict[str, Any]:
    """同步调用 doctor.py 的 run_doctor（在线程池中执行）.

    将 doctor.py 的检测结果作为 dict 返回，供 bootcamp 使用。
    如果 doctor 模块不可用，返回空 dict 降级。
    """
    try:
        # 动态导入 doctor 模块（避免硬依赖）
        import importlib
        import sys as _sys
        from pathlib import Path

        # 将 scripts 目录加入 sys.path
        scripts_dir = str(Path(__file__).resolve().parents[3] / "scripts")
        if scripts_dir not in _sys.path:
            _sys.path.insert(0, scripts_dir)

        doctor_mod = importlib.import_module("doctor")
        # 调用 run_doctor(json_output=True) 获取结构化结果
        # 注意：run_doctor 会打印到 stdout，我们用 json_output 获取 JSON
        import io
        import contextlib

        # 捕获 stdout（doctor 会打印检测结果）
        old_stdout = _sys.stdout
        _sys.stdout = io.StringIO()
        try:
            results = doctor_mod.run_doctor(json_output=True)
        finally:
            _sys.stdout = old_stdout

        return results
    except Exception as exc:
        logger.warning("doctor.py 联动失败，降级为基础检测: %s", exc)
        return {}


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
