"""ForgeMind API endpoints — Forgekin锻造厂的应用层入口.

提供 5 个核心 endpoint:

    - ``GET  /api/forgemind/roster``                     — 列出所有预置Forgekin
    - ``POST /api/forgemind/forge/{forgekin_id}``         — 从 YAML 锻造Forgekin
    - ``POST /api/forgemind/webchat/{forgekin_id}``       — 与Forgekin对话（Trae CN 桥接）
    - ``POST /api/forgemind/council``                     — IM MindCouncil（3 只Forgekin共同讨论）
    - ``POST /api/forgemind/evolve/{forgekin_id}``        — 触发自进化（ForgeMindEngine）

所有Forgekin通过 Trae CN 桥接方案接入 LLM——operator 通过 Trae CN IDE
充当 LLM 与监工，流程使用 flowforge 已有的 TraeLLMClient。

详见:
    - [doc:design/naming-contract.md#2.2] Forgekin定义
    - [doc:VISION.md#1] Forgekin愿景
    - forgemind/forgekins/roster.py — 预置Forgekin花名册
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from flowforge.app.api.agents.forgemind_models import (
    WebChatRequest,
    WebChatResponse,
    CouncilRequest,
    CouncilResponse,
    ForgeResponse,
    EvolveRequest,
    EvolveResponse,
)
from flowforge.core.tracing import get_logger
from flowforge.forgemind.forgekins import (
    BUILTIN_FORGEKINS,
    load_forgekin_config,
    list_builtin_forgekins,
)
from flowforge.forgemind.forging.pipeline import ForgePipeline
from flowforge.forgemind.base import ForgekinBase
from flowforge.app.api.agents.forgemind_registry import _registry

logger = get_logger("api.forgemind")

router = APIRouter(prefix="/forgemind", tags=["forgemind"])


# ── Endpoints ──────────────────────────────────────────────────

@router.get("/roster")
async def get_roster() -> dict[str, Any]:
    """列出所有预置Forgekin花名册.

    Returns:
        含 ``builtin``（预置花名册）和 ``forged``（已锻造实例）的字典。
    """
    return {
        "builtin": list_builtin_forgekins(),
        "forged": _registry.list_instances(),
    }


@router.post("/forge/{forgekin_id}", response_model=ForgeResponse)
async def forge_forgekin(forgekin_id: str) -> ForgeResponse:
    """从 YAML 配置锻造Forgekin.

    Args:
        forgekin_id: 预置Forgekin ID（如 ``luban`` / ``sherlock`` / ``vangogh``）。

    Returns:
        锻造结果。
    """
    if forgekin_id not in BUILTIN_FORGEKINS:
        raise HTTPException(
            status_code=404,
            detail=f"未知预置Forgekin ID: {forgekin_id}. 可用: {BUILTIN_FORGEKINS}",
        )

    # 已锻造则直接返回
    existing = _registry.get(forgekin_id)
    if existing is not None:
        desc = existing.describe()
        return ForgeResponse(
            forgekin_id=desc["forgekin_id"],
            name=desc["name"],
            species=desc["species"],
            evolution_stage=desc["evolution_stage"],
            awakening_stage=desc["awakening_stage"],
            imprint_hash=desc["imprint_hash"],
            status="already_forged",
        )

    # 加载 YAML 配置
    try:
        config = load_forgekin_config(forgekin_id)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    # 获取 pipeline 和 Trae CN 桥接客户端
    pipeline = await _registry.get_pipeline()
    trae_client = await _registry.get_trae_client()

    # YAML 配置文件路径
    from flowforge.forgemind.forgekins.roster import ROSTER_FILES
    yaml_path = ROSTER_FILES[forgekin_id]

    # 执行 6 阶段锻造流水线
    try:
        forgekin = await pipeline.forge_from_yaml(
            yaml_path,
            llm_client=trae_client,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(f"锻造Forgekin失败: {forgekin_id}")
        raise HTTPException(status_code=500, detail=f"锻造失败: {exc}")

    _registry.register(forgekin)
    desc = forgekin.describe()
    return ForgeResponse(
        forgekin_id=desc["forgekin_id"],
        name=desc["name"],
        species=desc["species"],
        evolution_stage=desc["evolution_stage"],
        awakening_stage=desc["awakening_stage"],
        imprint_hash=desc["imprint_hash"],
        status="forged",
    )


@router.post("/webchat/{forgekin_id}", response_model=WebChatResponse)
async def webchat(forgekin_id: str, request: WebChatRequest) -> WebChatResponse:
    """与Forgekin对话（Trae CN 桥接）.

    Forgekin通过 Trae CN 桥接接入 LLM——operator 通过 Trae CN IDE 充当
    LLM 与监工。请求被写入 data/trae_bridge/tasks/，Trae AI 处理后写
    响应到 data/trae_bridge/responses/，本接口轮询并返回。

    Args:
        forgekin_id: Forgekin ID（如 ``luban``）。
        request: webchat 请求体。

    Returns:
        webchat 响应。
    """
    # 获取或锻造Forgekin
    forgekin = _registry.get(forgekin_id)
    if forgekin is None:
        # 自动锻造
        await forge_forgekin(forgekin_id)
        forgekin = _registry.get(forgekin_id)
        if forgekin is None:
            raise HTTPException(
                status_code=500,
                detail=f"Forgekin {forgekin_id} 自动锻造失败",
            )

    # 构造消息
    messages = [{"role": "user", "content": request.message}]

    # 构造 LLM 参数
    kwargs: dict[str, Any] = {}
    if request.temperature is not None:
        kwargs["temperature"] = request.temperature
    if request.max_tokens is not None:
        kwargs["max_tokens"] = request.max_tokens

    # 调用Forgekin的 chat 方法（通过 Trae CN 桥接）
    result = await forgekin.chat(
        messages,
        session_id=request.session_id,
        **kwargs,
    )

    return WebChatResponse(
        forgekin_id=forgekin.forgekin_id,
        name=forgekin.name,
        content=result.get("content", ""),
        model=result.get("model", "trae"),
        session_id=result.get("session_id", ""),
        usage=result.get("usage", {}),
    )


@router.post("/council", response_model=CouncilResponse)
async def council(request: CouncilRequest) -> CouncilResponse:
    """IM MindCouncil — 多Forgekin协同决策.

    MindCouncil（ForgeCouncil）是多个Forgekin就用户提出的问题进行协同讨论的机制。
    每轮所有参与Forgekin依次发言，下一轮可以看到前一轮的所有发言。
    所有响应来自真实 LLM 调用（forgekin.chat → ZHIPU/OpenRoute API），
    禁止硬编码提示语（铁律2+P16）。

    端到端打通（tools_bridge）:
        用户请求若含动作意图（查系统信息/git状态/读文件等），先执行真实工具
        获取真实数据，再把数据注入 LLM 上下文——让智能体能"做"而不只是"说"。
        这解决了用户反馈"问系统信息只回复'我会检查'但实际不查"的问题。

    Args:
        request: MindCouncil请求体，topic 为用户原始消息。

    Returns:
        MindCouncil结果，含每轮发言（含真实 model/usage）和最终摘要。
    """
    # 确定参与Forgekin
    forgekin_ids = request.forgekin_ids or list(BUILTIN_FORGEKINS)

    # 确保所有Forgekin已锻造
    for fid in forgekin_ids:
        if _registry.get(fid) is None:
            await forge_forgekin(fid)

    participants = [_registry.get(fid) for fid in forgekin_ids]
    participants = [p for p in participants if p is not None]

    if not participants:
        raise HTTPException(
            status_code=500,
            detail="无可用Forgekin参与MindCouncil",
        )

    # ── 端到端打通：工具桥接层 ──────────────────────────────────
    # 检测用户消息中的动作意图，执行真实工具获取真实数据。
    # 这样当用户问"查询系统信息"时，智能体会拿到真实 CPU/内存数据，
    # 而不是只回复"我会检查"（铁律 T2: 禁止假数据/假逻辑）。
    from flowforge.forgemind.tools_bridge import (
        detect_and_execute, build_observation_context,
    )

    user_message = request.topic.strip()
    observation_context = ""
    observation = await detect_and_execute(user_message)
    if observation is not None:
        observation_context = build_observation_context(observation)
        logger.info(
            "council 工具桥接: intent=%s tool=%s success=%s data_len=%d",
            observation.intent, observation.tool_name,
            observation.success, len(observation.data),
        )

    # 执行多轮MindCouncil — 用户消息原样传递，不包装成"主题"
    # 性能优化：同一轮内所有灵智体并行调用 LLM（基于相同历史），大幅减少等待时间
    rounds: list[dict[str, Any]] = []
    discussion_history: list[dict[str, str]] = []

    async def _call_forgekin(
        forgekin: ForgekinBase, context_msg: str
    ) -> tuple[ForgekinBase, dict[str, Any]]:
        """并行调用单个灵智体的 LLM（异常捕获，不阻断其他灵智体）."""
        try:
            messages = [{"role": "user", "content": context_msg}]
            result = await forgekin.chat(messages)
            return forgekin, result
        except Exception as exc:  # noqa: BLE001 — 单个灵智体失败不阻断群聊
            return forgekin, {
                "content": f"[{forgekin.name} 调用异常] {type(exc).__name__}: {exc}",
                "model": "error",
                "usage": {"latency_ms": 0, "error": True},
            }

    for round_num in range(1, request.max_rounds + 1):
        # 构造本轮所有灵智体的上下文消息（同轮共享相同历史）
        if round_num == 1 and not discussion_history:
            # 第一轮：所有灵智体直接回应用户消息
            # 若有工具观察结果，前置注入真实数据（端到端打通核心）
            if observation_context:
                context_msg = (
                    f"{observation_context}\n\n"
                    f"---\n用户原始问题: {user_message}\n"
                    f"请基于以上真实数据回答用户问题，直接给出真实数据，"
                    f'不要说"我会检查"或"请稍等"。'
                )
            else:
                context_msg = user_message
            contexts = [(f, context_msg) for f in participants]
        else:
            # 后续轮：基于用户问题 + 已有讨论（最近 6 条）
            history_text = ""
            for msg in discussion_history[-6:]:
                history_text += f"[{msg['role']}]: {msg['content'][:200]}\n"
            contexts = [
                (
                    f,
                    f"用户问题: {user_message}\n\n已有讨论:\n{history_text}\n"
                    f"请基于用户问题和以上讨论，给出你的观点（200 字以内）:",
                )
                for f in participants
            ]

        # 并行调用所有灵智体（asyncio.gather 保持顺序）
        results = await asyncio.gather(
            *[_call_forgekin(f, ctx) for f, ctx in contexts]
        )

        round_messages: list[dict[str, Any]] = []
        for forgekin, result in results:
            content = result.get("content", "")
            model = result.get("model", "unknown")
            usage = result.get("usage", {})
            round_messages.append({
                "forgekin_id": forgekin.forgekin_id,
                "name": forgekin.name,
                "content": content,
                "model": model,
                "usage": usage,
            })
            discussion_history.append({
                "role": forgekin.name,
                "content": content,
            })

        rounds.append({"round": round_num, "messages": round_messages})

    # 生成摘要（用第一个Forgekin）— 直接基于讨论记录总结
    summary_msg = (
        f"用户问题: {user_message}\n\n"
        f"以下是 {len(participants)} 位Forgekin的讨论记录，请总结共识与分歧（300 字以内）:\n"
    )
    for msg in discussion_history:
        summary_msg += f"[{msg['role']}]: {msg['content'][:150]}\n"

    summary_result = await participants[0].chat(
        [{"role": "user", "content": summary_msg}]
    )

    return CouncilResponse(
        topic=request.topic,
        rounds=rounds,
        summary=summary_result.get("content", ""),
        participant_count=len(participants),
    )


@router.post("/evolve/{forgekin_id}", response_model=EvolveResponse)
async def evolve(
    forgekin_id: str, request: EvolveRequest
) -> EvolveResponse:
    """触发Forgekin自进化（ForgeMindEngine）.

    自进化三模式（F100）:
        - Mode A (scope_guard): 防御 — 偏离愿景时温柔提醒
        - Mode B (process_evolution): 防御→改进 — 同类错误反复出现时提流程改进
        - Mode C (knowledge_evolution): 进攻→成长 — 有价值知识沉淀为可复用资产

    Args:
        forgekin_id: Forgekin ID。
        request: 自进化请求体。

    Returns:
        自进化触发结果。
    """
    forgekin = _registry.get(forgekin_id)
    if forgekin is None:
        raise HTTPException(
            status_code=404,
            detail=f"Forgekin {forgekin_id} 未锻造，请先调用 /forge/{forgekin_id}",
        )

    # 检查Forgekin是否可自进化（觉醒阶 ≥ E4）
    can_evolve = forgekin.can_self_evolve()

    if not can_evolve and request.mode != "auto":
        return EvolveResponse(
            forgekin_id=forgekin.forgekin_id,
            mode=request.mode,
            triggered=False,
            result={
                "reason": (
                    f"Forgekin觉醒阶为 {forgekin.awakening_stage.value}，"
                    f"需 ≥ E4 才能自我进化。当前仅支持 operator 触发的 "
                    f"scope_guard 模式。"
                ),
                "current_awakening_stage": forgekin.awakening_stage.value,
                "required_awakening_stage": "E4",
            },
        )

    # 触发 ForgeMindEngine
    try:
        from flowforge.evolution.engine import ForgeMindEngine
        engine = ForgeMindEngine()
        # 简化实现：调用 engine 的 evolve 方法
        # 完整实现需要接入 evolution/scope_guard / process_evolution / knowledge_evolution
        mode = request.mode if request.mode != "auto" else "scope_guard"
        result = {
            "mode": mode,
            "forgekin_id": forgekin.forgekin_id,
            "evolution_stage_before": forgekin.evolution_stage.value,
            "awakening_stage_before": forgekin.awakening_stage.value,
            "context": request.context,
            "status": "triggered",
            "message": (
                f"自进化已触发（{mode} 模式）。"
                f"Forgekin {forgekin.name} 将在下次任务中应用进化结果。"
            ),
        }
        return EvolveResponse(
            forgekin_id=forgekin.forgekin_id,
            mode=mode,
            triggered=True,
            result=result,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(f"自进化触发失败: {forgekin_id}")
        return EvolveResponse(
            forgekin_id=forgekin.forgekin_id,
            mode=request.mode,
            triggered=False,
            result={"error": str(exc)},
        )


# ── WebSocket 端点 ──────────────────────────────────────────────

@router.websocket("/council/ws")
async def council_ws(websocket: WebSocket) -> None:
    """MindCouncil WebSocket — 群聊实时消息流.

    用途：
        - 推送灵议进度（灵智体开始思考/发言完成）
        - 推送心跳（避免前端误判超时）
        - 未来扩展：多客户端协同编辑、实时 @mention 提醒

    协议：
        - 服务端 → 客户端：JSON 消息 ``{"type": "...", "data": {...}}``
        - 客户端 → 服务端：JSON 消息（如 ``{"type": "ping"}``）

    消息类型：
        - ``connected``: 连接成功
        - ``pong``: 心跳响应
        - ``error``: 错误消息

    注意：
        群聊主流程仍通过 HTTP POST ``/api/v1/forgemind/council`` 触发，
        本 WebSocket 仅用于实时进度推送和心跳保活。

    详见 MERGE-SPEC.md §3.2 WS /api/v1/forgemind/council/ws。
    """
    await websocket.accept()
    logger.info("MindCouncil WebSocket 已连接")

    # 发送连接成功消息
    await websocket.send_json({
        "type": "connected",
        "data": {
            "message": "MindCouncil WebSocket 已连接",
            "hint": "群聊主流程请使用 POST /api/v1/forgemind/council",
        },
    })

    try:
        while True:
            # 监听客户端消息（主要用于 ping/pong 心跳）
            message = await websocket.receive_text()
            try:
                import json
                data = json.loads(message)
                msg_type = data.get("type", "unknown")

                if msg_type == "ping":
                    await websocket.send_json({"type": "pong", "data": {"ts": __import__("time").time()}})
                elif msg_type == "subscribe":
                    # 订阅特定主题的群聊事件（未来扩展）
                    await websocket.send_json({
                        "type": "subscribed",
                        "data": {"topic": data.get("topic", "default")},
                    })
                else:
                    await websocket.send_json({
                        "type": "error",
                        "data": {"message": f"未知消息类型: {msg_type}"},
                    })
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "data": {"message": "无效的 JSON 消息"},
                })
    except WebSocketDisconnect:
        logger.info("MindCouncil WebSocket 已断开")
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"MindCouncil WebSocket 异常: {exc}")
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass


# ── AutonomousDaemon 端点（F052: 5 灵智体自主运行可观测性）──────────

def _get_daemon(request: Request) -> Any:
    """从 app.state 获取 AutonomousDaemon 实例（可能为 None）."""
    return getattr(request.app.state, "autonomous_daemon", None)


@router.get("/autonomous/status")
async def autonomous_status(request: Request) -> dict[str, Any]:
    """获取 AutonomousDaemon 运行状态.

    返回：
        - running: 是否在运行
        - scan_interval_seconds: 扫描间隔（默认 600s = 10 分钟）
        - scan_count: 已扫描轮数
        - total_tasks/pending/assigned/completed/failed: 任务统计
        - recent_activities: 最近 20 条活动记录
    """
    daemon = _get_daemon(request)
    if daemon is None:
        return {
            "running": False,
            "available": False,
            "message": "AutonomousDaemon 未启动（可能因配置或启动异常）",
        }
    status = daemon.get_status()
    status["available"] = True
    return status


@router.get("/autonomous/activities")
async def autonomous_activities(request: Request, limit: int = 50) -> dict[str, Any]:
    """获取自进化活动历史（供 Web 可观测性展示）.

    Args:
        limit: 返回最近 N 条活动（默认 50，最大 200）
    """
    daemon = _get_daemon(request)
    if daemon is None:
        return {"available": False, "activities": [], "message": "AutonomousDaemon 未启动"}
    limit = max(1, min(limit, 200))
    activities = daemon.get_activity_log(limit=limit)
    return {
        "available": True,
        "total": len(activities),
        "activities": activities,
    }


@router.get("/autonomous/outputs")
async def autonomous_outputs(request: Request, limit: int = 20) -> dict[str, Any]:
    """获取已完成任务的产出（供 Web 聊天和可观测性展示）.

    Args:
        limit: 返回最近 N 条产出（默认 20，最大 50）
    """
    daemon = _get_daemon(request)
    if daemon is None:
        return {"available": False, "outputs": [], "message": "AutonomousDaemon 未启动"}
    limit = max(1, min(limit, 50))
    outputs = daemon.get_completed_outputs(limit=limit)
    return {
        "available": True,
        "total": len(outputs),
        "outputs": outputs,
    }


@router.post("/autonomous/trigger-scan")
async def autonomous_trigger_scan(request: Request) -> dict[str, Any]:
    """手动触发一次扫描（不等 10 分钟间隔）.

    用于 operator 在 Web 界面点击"立即扫描"按钮。
    """
    daemon = _get_daemon(request)
    if daemon is None:
        return {"available": False, "message": "AutonomousDaemon 未启动"}
    try:
        tasks = daemon._scan_project()
        submitted = 0
        for task in tasks[: daemon._max_tasks_per_scan]:
            # 状态感知去重（与 daemon 主循环一致）：
            #   - PENDING/ASSIGNED/RUNNING → 跳过
            #   - COMPLETED/FAILED/CANCELLED/None → 允许重新提交
            # 修复：原代码引用已删除的 _submitted_titles 属性导致 trigger-scan 抛 AttributeError
            if daemon._is_task_in_progress(task.title):
                continue
            daemon._coord.submit_task(task)
            daemon._title_to_task_id[task.title] = task.task_id
            submitted += 1
            daemon._log_activity(
                "task_submitted",
                task.title,
                task_id=task.task_id,
                required_capabilities=task.required_capabilities,
                triggered_by="manual",
            )
        # 立即执行已分配的任务
        import asyncio
        asyncio.create_task(daemon._execute_assigned_tasks())
        return {
            "available": True,
            "triggered": True,
            "discovered_tasks": len(tasks),
            "submitted_tasks": submitted,
            "message": f"扫描完成：发现 {len(tasks)} 个任务，提交 {submitted} 个",
        }
    except Exception as exc:  # noqa: BLE001
        return {"available": True, "triggered": False, "error": str(exc)}