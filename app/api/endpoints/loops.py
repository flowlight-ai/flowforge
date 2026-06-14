"""FlowForge Loop Engine API endpoints."""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from flowforge.memory.helm_db import get_helm_db
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.api.loops")

router = APIRouter(prefix="/api/v1", tags=["loops"])

# ── 运行中 Loop 任务追踪 ──
# key: loop_id, value: asyncio.Task
_running_loop_tasks: dict[str, asyncio.Task] = {}


# --- Request/Response Models ---

class CreateLoopRequest(BaseModel):
    task_id: str
    template_name: str
    overrides: Optional[dict] = None

class StopLoopRequest(BaseModel):
    reason: Optional[str] = None


# --- Helper ---

def _make_response(data, success=True):
    return {"success": success, "data": data}

def _make_error(code, message):
    return {"success": False, "error": {"code": code, "message": message}}


# --- Iteration Callbacks (Repository 层适配，遵守铁律4) ---

def _on_iteration_create(loop_id: str, attempt: int, plan_json: str | None = None) -> str:
    """创建迭代记录回调 — 由 LoopExecutor 调用，委托给 HelmDatabase。"""
    db = get_helm_db()
    return db.create_loop_iteration(
        loop_id=loop_id,
        attempt=attempt,
        plan_json=plan_json,
    )


def _on_iteration_update(iteration_id: str, **kwargs) -> bool:
    """更新迭代记录回调 — 由 LoopExecutor 调用，委托给 HelmDatabase。"""
    db = get_helm_db()
    return db.update_loop_iteration(iteration_id, **kwargs)


def _on_iteration_complete(iteration_id: str) -> bool:
    """完成迭代记录回调 — 由 LoopExecutor 调用，委托给 HelmDatabase。"""
    db = get_helm_db()
    return db.complete_loop_iteration(iteration_id)


def _on_loop_state_update(loop_id: str, state_json: str, phase: str, attempt: int) -> bool:
    """更新 Loop 状态回调 — 由 LoopExecutor 调用，委托给 HelmDatabase。"""
    db = get_helm_db()
    return db.update_loop_state(loop_id, state_json, phase, attempt)


# --- Loop 执行后台任务 ---

async def _run_loop_background(loop_id: str, task_id: str, template_config: dict):
    """后台执行 Loop，完成后更新数据库状态。

    P1-2 回退机制：Loop 失败时退化为单次 HybridExecutor 执行
    （设计文档 loop.md §864-865）。
    """
    hybrid_executor = None
    persona_lock = None
    try:
        from flowforge.app.main import get_persona_lock
        persona_lock = get_persona_lock()
    except (ImportError, AttributeError):
        pass
    try:
        from flowforge.app import main as _main
        hybrid_executor = getattr(_main, "_executor_instance", None)
    except ImportError:
        pass

    try:
        from flowforge.core.task_context import TaskContext

        # 优先使用 HybridExecutor 上已注入的 LoopExecutor（保持一致性）
        loop_executor = None
        if hybrid_executor and hybrid_executor.loop_executor:
            loop_executor = hybrid_executor.loop_executor
            logger.info(f"Using HybridExecutor's injected LoopExecutor for loop_id={loop_id}")
        else:
            # 回退：自行构建 LoopExecutor（向后兼容）
            from flowforge.loop.executor import LoopExecutor
            from flowforge.loop.planner import LLMPlanner
            from flowforge.loop.verifier import RuleBasedVerifier
            from flowforge.loop.reflector import ReflexionReflector
            from flowforge.harness.orchestrator import HarnessOrchestrator
            from flowforge.harness.entropy_manager import EntropyManager, RuleEvolution
            from flowforge.core.checkpoint_manager import CheckpointManager

            harness = getattr(hybrid_executor, "harness", None) if hybrid_executor else None
            harness = harness or HarnessOrchestrator()
            planner = LLMPlanner()
            verifier = RuleBasedVerifier()
            reflector = ReflexionReflector()
            checkpoint_mgr = getattr(
                hybrid_executor, "checkpoint_manager",
                CheckpointManager("data/loop_checkpoints.db"),
            ) if hybrid_executor else CheckpointManager("data/loop_checkpoints.db")
            entropy_mgr = EntropyManager()
            rule_evolution = RuleEvolution()

            loop_executor = LoopExecutor(
                hybrid_executor=hybrid_executor or HarnessOrchestrator(),
                harness=harness,
                planner=planner,
                verifier=verifier,
                reflector=reflector,
                checkpoint_mgr=checkpoint_mgr,
                entropy_mgr=entropy_mgr,
                rule_evolution=rule_evolution,
                persona_lock=persona_lock,
                on_iteration_create=_on_iteration_create,
                on_iteration_update=_on_iteration_update,
                on_iteration_complete=_on_iteration_complete,
                on_loop_state_update=_on_loop_state_update,
            )

        # 构建 TaskContext
        task_ctx = TaskContext(
            task_id=task_id,
            input_data=template_config,
            metadata={"loop_id": loop_id},
        )

        # 执行 Loop
        result = await loop_executor.run(task_ctx, template_config)
        logger.info(
            f"Loop background execution completed: loop_id={loop_id}, "
            f"success={result.success}, attempts={result.total_attempts}"
        )

        # P1-2 回退机制：Loop 失败时退化为单次 HybridExecutor 执行
        # 设计文档 loop.md §864-865: "Loop 失败时退化为单次 HybridExecutor 执行"
        if not result.success and hybrid_executor:
            logger.warning(
                f"Loop failed, degrading to single HybridExecutor execution: "
                f"loop_id={loop_id}, error={result.error}, "
                f"attempts={result.total_attempts}"
            )
            try:
                fallback_mode = template_config.get("worker", {}).get("mode", "workflow")
                fallback_ctx = TaskContext(
                    task_id=task_id,
                    input_data=template_config,
                    metadata={},  # 不含 loop_config，避免再次进入 Loop 分支
                )
                fallback_result = await hybrid_executor.run(
                    fallback_ctx, mode_hint=fallback_mode, _is_substep=True,
                )
                if isinstance(fallback_result, dict):
                    fallback_result["loop_degraded"] = True
                    fallback_result["loop_error"] = result.error
                    fallback_result["loop_attempts"] = result.total_attempts

                # 更新 DB 状态为 degraded（而非 failed）
                db = get_helm_db()
                db.update_loop_state(
                    loop_id,
                    json.dumps({
                        "phase": "degraded",
                        "loop_error": result.error,
                        "loop_attempts": result.total_attempts,
                        "fallback_mode": fallback_mode,
                    }, ensure_ascii=False),
                    "degraded",
                    result.total_attempts,
                )
                logger.info(
                    f"Degraded execution completed: loop_id={loop_id}, "
                    f"fallback_mode={fallback_mode}"
                )
            except Exception as fallback_err:
                logger.error(
                    f"Degraded execution also failed: loop_id={loop_id}, "
                    f"error={fallback_err}"
                )

    except Exception as e:
        logger.error(f"Loop background execution failed: loop_id={loop_id}, error={e}")
        # 异常时更新数据库状态为 failed
        try:
            db = get_helm_db()
            db.update_loop_state(
                loop_id,
                json.dumps({"error": str(e)}, ensure_ascii=False),
                "failed",
                0,
            )
        except Exception:
            pass
    finally:
        # 清理运行中任务追踪
        _running_loop_tasks.pop(loop_id, None)


# --- Endpoints ---

@router.post("/loops")
async def create_loop(body: CreateLoopRequest):
    """Create a Loop instance and start execution."""
    db = get_helm_db()

    # Check template exists
    template = None
    try:
        from flowforge.loop.registry import LoopRegistry
        registry = LoopRegistry()
        template = registry.get(body.template_name)
    except Exception:
        pass

    if template is None:
        raise HTTPException(status_code=404, detail=_make_error("TEMPLATE_NOT_FOUND", f"模板 '{body.template_name}' 不存在"))

    # Merge overrides into template config
    template_config = template.model_dump()
    if body.overrides:
        for key, value in body.overrides.items():
            if key == "max_retries":
                template_config["max_retries"] = value
            elif key in template_config and isinstance(template_config[key], dict) and isinstance(value, dict):
                template_config[key].update(value)
            else:
                template_config[key] = value

    max_retries = template_config.get("max_retries", 3)

    # 创建数据库记录
    loop_id = db.create_loop(
        task_id=body.task_id,
        template_name=body.template_name,
        max_retries=max_retries,
    )

    # 更新数据库状态为 running
    db.update_loop_state(
        loop_id,
        json.dumps({"phase": "running", "template_config": template_config}, ensure_ascii=False),
        "running",
        0,
    )

    # 异步启动 LoopExecutor.run() 在后台执行
    loop_task = asyncio.create_task(
        _run_loop_background(loop_id, body.task_id, template_config),
        name=f"loop-{loop_id}",
    )
    _running_loop_tasks[loop_id] = loop_task

    loop = db.get_loop(loop_id)
    return _make_response(loop)


@router.get("/loops/{loop_id}")
async def get_loop(loop_id: str):
    """Query Loop execution status."""
    db = get_helm_db()
    loop = db.get_loop(loop_id)
    if loop is None:
        raise HTTPException(status_code=404, detail=_make_error("LOOP_NOT_FOUND", f"Loop '{loop_id}' 不存在"))
    return _make_response(loop)


@router.post("/loops/{loop_id}/stop")
async def stop_loop(loop_id: str, body: StopLoopRequest = None):
    """Manually stop a running Loop."""
    db = get_helm_db()
    loop = db.get_loop(loop_id)
    if loop is None:
        raise HTTPException(status_code=404, detail=_make_error("LOOP_NOT_FOUND", f"Loop '{loop_id}' 不存在"))

    if loop.get("phase") in ("completed", "failed", "degraded"):
        raise HTTPException(status_code=400, detail=_make_error("ALREADY_STOPPED", f"Loop 已处于 {loop['phase']} 状态"))

    # 取消后台 asyncio.Task（如果正在运行）
    running_task = _running_loop_tasks.get(loop_id)
    if running_task and not running_task.done():
        running_task.cancel()
        _running_loop_tasks.pop(loop_id, None)
        logger.info(f"Loop background task cancelled: loop_id={loop_id}")

    # 释放 Persona Lock（如果 Loop 正在持有）
    task_id = loop.get("task_id", "")
    if task_id:
        try:
            from flowforge.app.main import get_persona_lock
            persona_lock = get_persona_lock()
            if persona_lock:
                # 从 task context 获取 persona_id
                task_data = db.get_loop(loop_id)
                if task_data:
                    state = task_data.get("state_json") if isinstance(task_data.get("state_json"), dict) else {}
                    persona_id = state.get("persona_id")
                    if persona_id and persona_lock.is_locked(persona_id):
                        persona_lock.release(persona_id)
        except Exception:
            pass  # PersonaLock 释放失败不应阻止停止操作

    # Update phase to failed (stopped by user)
    state = loop.get("state_json") if isinstance(loop.get("state_json"), dict) else {}
    state["phase"] = "failed"
    state["stopped_by_user"] = True
    if body and body.reason:
        state["stop_reason"] = body.reason

    db.update_loop_state(loop_id, json.dumps(state, ensure_ascii=False), "failed", loop.get("attempt", 0))
    return _make_response(db.get_loop(loop_id))


@router.get("/loops/{loop_id}/history")
async def get_loop_history(loop_id: str):
    """Get Loop iteration history."""
    db = get_helm_db()
    loop = db.get_loop(loop_id)
    if loop is None:
        raise HTTPException(status_code=404, detail=_make_error("LOOP_NOT_FOUND", f"Loop '{loop_id}' 不存在"))

    iterations = db.get_loop_iterations(loop_id)
    return _make_response({"loop": loop, "iterations": iterations})


@router.get("/loop-templates")
async def list_loop_templates():
    """List available Loop templates."""
    try:
        from flowforge.loop.registry import LoopRegistry
        registry = LoopRegistry()
        templates = []
        for name in registry.list_templates():
            t = registry.get(name)
            templates.append({
                "name": t.name,
                "description": t.description,
                "version": t.version,
                "max_retries": t.max_retries,
            })
        return _make_response(templates)
    except Exception as e:
        return _make_response([])


@router.get("/loop-templates/{name}")
async def get_loop_template(name: str):
    """Get Loop template details."""
    try:
        from flowforge.loop.registry import LoopRegistry
        registry = LoopRegistry()
        template = registry.get(name)
    except Exception:
        template = None

    if template is None:
        raise HTTPException(status_code=404, detail=_make_error("TEMPLATE_NOT_FOUND", f"模板 '{name}' 不存在"))

    return _make_response(template.model_dump())
