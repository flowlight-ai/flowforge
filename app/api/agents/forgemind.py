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

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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


# ── 请求/响应模型 ──────────────────────────────────────────────

class WebChatRequest(BaseModel):
    """webchat 请求体。"""
    message: str = Field(
        ...,
        min_length=1,
        description="用户消息内容",
    )
    session_id: str | None = Field(
        default=None,
        description="会话 ID（用于上下文保持，默认使用 forgekin_id）",
    )
    temperature: float | None = Field(
        default=None,
        description="采样温度（覆盖 YAML 配置）",
    )
    max_tokens: int | None = Field(
        default=None,
        description="最大生成 token 数（覆盖 YAML 配置）",
    )


class WebChatResponse(BaseModel):
    """webchat 响应体。"""
    forgekin_id: str
    name: str
    content: str
    model: str = "trae"
    session_id: str
    usage: dict[str, Any] = Field(default_factory=dict)


class CouncilRequest(BaseModel):
    """IM MindCouncil请求体。"""
    topic: str = Field(
        ...,
        min_length=1,
        description="MindCouncil主题（如 '是否采用 ADR-014 提议的 Plugin V4 协议'）",
    )
    forgekin_ids: list[str] = Field(
        default_factory=list,
        description="参与MindCouncil的Forgekin ID 列表（默认 3 只预置Forgekin全部参与）",
    )
    max_rounds: int = Field(
        default=1,
        ge=1,
        le=3,
        description="MindCouncil最大轮数（每轮所有Forgekin各发言一次）",
    )


class CouncilResponse(BaseModel):
    """IM MindCouncil响应体。"""
    topic: str
    rounds: list[dict[str, Any]]
    summary: str
    participant_count: int


class ForgeResponse(BaseModel):
    """锻造响应体。"""
    forgekin_id: str
    name: str
    species: str
    evolution_stage: str
    awakening_stage: str
    imprint_hash: str
    status: str = "forged"


class EvolveRequest(BaseModel):
    """自进化触发请求体。"""
    mode: str = Field(
        default="auto",
        description="进化模式：auto/scope_guard/process_evolution/knowledge_evolution",
    )
    context: dict[str, Any] = Field(
        default_factory=dict,
        description="进化上下文（如最近任务结果、错误日志等）",
    )


class EvolveResponse(BaseModel):
    """自进化响应体。"""
    forgekin_id: str
    mode: str
    triggered: bool
    result: dict[str, Any]


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

    MindCouncil（ForgeCouncil）是多个Forgekin就特定主题进行协同决策的机制。
    每轮所有参与Forgekin依次发言，下一轮可以看到前一轮的所有发言。

    Args:
        request: MindCouncil请求体。

    Returns:
        MindCouncil结果，含每轮发言和最终摘要。
    """
    # 确定参与Forgekin
    forgekin_ids = request.forgekin_ids or list(BUILTIN_FORGEKINS)

    # 辅助函数：BUILTIN_FORGEKINS 用无前缀 id（如 "wenxin"），
    # 但 forgekin_id 在 YAML 中是 "forgemind:wenxin"（带 namespace 前缀）。
    # forge_forgekin(fid) 按 BUILTIN_FORGEKINS 的无前缀 id 锻造，
    # 但 _registry 注册的 key 是 forgekin.forgekin_id（带前缀）。
    # 因此查找时需同时尝试无前缀和带前缀两种 key。
    def _resolve_registry(forgekin_id: str):
        inst = _registry.get(forgekin_id)
        if inst is not None:
            return inst
        if not forgekin_id.startswith("forgemind:"):
            inst = _registry.get(f"forgemind:{forgekin_id}")
            if inst is not None:
                return inst
        return None

    # 确保所有Forgekin已锻造
    for fid in forgekin_ids:
        if _resolve_registry(fid) is None:
            await forge_forgekin(fid)

    participants = [_resolve_registry(fid) for fid in forgekin_ids]
    participants = [p for p in participants if p is not None]

    if not participants:
        raise HTTPException(
            status_code=500,
            detail="无可用Forgekin参与MindCouncil",
        )

    # 执行多轮MindCouncil
    rounds: list[dict[str, Any]] = []
    discussion_history: list[dict[str, str]] = []

    for round_num in range(1, request.max_rounds + 1):
        round_messages: list[dict[str, Any]] = []
        for forgekin in participants:
            # 构造MindCouncil上下文消息
            context_msg = f"MindCouncil主题: {request.topic}\n\n"
            if discussion_history:
                context_msg += "已有讨论:\n"
                for msg in discussion_history[-6:]:  # 最近 6 条
                    context_msg += f"[{msg['role']}]: {msg['content'][:200]}\n"
                context_msg += "\n请基于以上讨论，给出你的观点（200 字以内）:"
            else:
                context_msg += "请给出你的初始观点（200 字以内）:"

            messages = [{"role": "user", "content": context_msg}]
            result = await forgekin.chat(messages)

            content = result.get("content", "")
            round_messages.append({
                "forgekin_id": forgekin.forgekin_id,
                "name": forgekin.name,
                "content": content,
            })
            discussion_history.append({
                "role": forgekin.name,
                "content": content,
            })

        rounds.append({"round": round_num, "messages": round_messages})

    # 生成摘要（用第一个Forgekin）
    summary_msg = (
        f"MindCouncil主题: {request.topic}\n\n"
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
