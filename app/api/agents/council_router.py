"""Council 路由解析器 — @mention 解析 + fallback 链.

参考 clowder-ai AgentRouter 的核心路由逻辑（packages/api/src/domains/cats/
services/agents/routing/AgentRouter.ts），为 flowforge 实现简化版：

路由策略（与 clowder-ai 一致）：
    1. 显式 forgekin_ids（非空）→ 直接使用
    2. @all / @全体 / @所有人 → 全部可用 Forgekin 并行
    3. @特定智能体（@鲁班 / @luban / @sherlock ...）→ 仅指定智能体
    4. 无 @ → fallback 链：
       a. 上次回复者（thread_id 最后一条 forgekin 消息）
       b. 默认智能体（luban）

与 clowder-ai 的差异：
    - clowder-ai 有 9 层 fallback（last-replier → preferred → 任意健康 → 默认）
    - flowforge 简化为 3 层（last-replier → preferred → 默认）
    - clowder-ai 区分 ideate/execute 意图，flowforge 用 participant_count 判定
    - clowder-ai 限制并行 ≤3 只猫，flowforge 限制 ≤9（全部 Forgekin）

详见:
    - clowder-ai: packages/api/src/domains/cats/services/agents/routing/AgentRouter.ts
    - clowder-ai: packages/api/src/domains/cats/services/agents/routing/route-parallel.ts
"""

from __future__ import annotations

import re
from typing import Any

from flowforge.core.tracing import get_logger
from flowforge.forgemind.forgekins import BUILTIN_FORGEKINS

logger = get_logger("api.council_router")


# 默认 Forgekin（fallback 链终点）— 与 clowder-ai getDefaultCatId() 对应
DEFAULT_FORGEKIN_ID = "luban"

# @all 触发模式（参考 clowder-ai AgentRouter.parseGroupMentions）
# 注意：使用 word boundary 避免误匹配（如 "@all-cats" 不应触发 @all）
ALL_MENTION_PATTERNS = [
    r"@all\b",
    r"@全体\b",
    r"@所有人\b",
    r"@全部\b",
    r"@大家\b",
]


def _load_forgekin_aliases() -> dict[str, str]:
    """加载所有 Forgekin 的别名映射（alias → forgekin_id）.

    别名来源（优先使用 YAML 中的 mention_patterns 字段）：
        - mention_patterns（如 ['@鲁班', '@luban', '@猫头鹰', '@owl']）
        - forgekin_id 本身（如 'luban'）
        - name（如 '鲁班'）
        - nickname（如 '鲁班'）
    """
    from flowforge.forgemind.forgekins import load_forgekin_config

    aliases: dict[str, str] = {}
    for fid in BUILTIN_FORGEKINS:
        try:
            cfg = load_forgekin_config(fid)
            # ID 本身（小写）
            aliases[fid.lower()] = fid
            # mention_patterns（YAML 中定义，最准确）
            for pattern in cfg.get("mention_patterns", []):
                # 去掉前导 @，转小写
                clean = pattern.lstrip("@").lower().strip()
                if clean:
                    aliases[clean] = fid
            # name（中文名）
            name = cfg.get("name", "")
            if name:
                aliases[name.lower()] = fid
                aliases[name.replace(" ", "").lower()] = fid
            # nickname
            nickname = cfg.get("nickname", "")
            if nickname:
                aliases[nickname.lower()] = fid
        except Exception as exc:  # noqa: BLE001
            logger.warning("加载 Forgekin %s 别名失败: %s", fid, exc)
    return aliases


# 惰性加载别名表（首次调用时加载）
_aliases_cache: dict[str, str] | None = None


def _get_aliases() -> dict[str, str]:
    global _aliases_cache
    if _aliases_cache is None:
        _aliases_cache = _load_forgekin_aliases()
    return _aliases_cache


def is_all_mention(text: str) -> bool:
    """检测消息是否包含 @all / @全体 / @所有人 等群组提及.

    Args:
        text: 用户消息文本

    Returns:
        True 如果消息触发"全部并行"模式
    """
    for pattern in ALL_MENTION_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return True
    return False


def parse_individual_mentions(text: str) -> list[str]:
    """解析消息中的 @特定智能体，返回被提及的 Forgekin ID 列表.

    支持的格式：
        @luban / @鲁班 / @猫头鹰
        @sherlock / @夏洛克 / @猎犬

    Args:
        text: 用户消息文本

    Returns:
        被提及的 Forgekin ID 列表（保持出现顺序，去重）
    """
    aliases = _get_aliases()
    mentioned: list[str] = []
    seen: set[str] = set()

    # 找出所有 @xxx 片段
    # 正则：@ 后跟非空白字符（最长 20 字符，避免贪婪匹配过多）
    matches = re.finditer(r"@([^\s@,，。.!！?？]{1,20})", text)
    for m in matches:
        raw = m.group(1).lower()
        # 跳过 @all / @全体 等群组提及
        if any(re.search(p, f"@{raw}", re.IGNORECASE) for p in ALL_MENTION_PATTERNS):
            continue
        # 查找别名
        fid = aliases.get(raw)
        if fid and fid not in seen:
            mentioned.append(fid)
            seen.add(fid)

    return mentioned


def get_last_replier(
    thread_store: Any, thread_id: str
) -> str | None:
    """获取会话中最后一条 Forgekin 消息的 forgekin_id（last replier）.

    参考 clowder-ai AgentRouter.peekTargets() 的 fallback 层级 5：
        "上次回复者（last replier，优先级高于 preferredCats）"
        用户心智模型："无 @ = 继续跟刚才那只聊"

    Args:
        thread_store: ThreadStore 实例
        thread_id: 会话 ID

    Returns:
        最后回复的 forgekin_id，若无则 None
    """
    try:
        # 获取最近 20 条消息（足够找到最后一条 forgekin 消息）
        msgs = thread_store.list_messages(thread_id, limit=20, offset=0)
        # 从后往前找第一条 forgekin 消息
        for msg in reversed(msgs):
            if msg.get("source") == "forgekin" and msg.get("forgekin_id"):
                return msg["forgekin_id"]
    except Exception as exc:  # noqa: BLE001
        logger.warning("获取 last replier 失败 (thread=%s): %s", thread_id, exc)
    return None


def resolve_participants(
    request: Any,
    thread_store: Any | None = None,
) -> tuple[list[str], str]:
    """解析 Council 请求，决定参与回答的 Forgekin 列表和路由模式.

    fallback 链（参考 clowder-ai AgentRouter.peekTargets）：
        1. 显式 forgekin_ids（非空）→ 直接使用
        2. @all → 全部 Forgekin（parallel 模式）
        3. @特定智能体 → 仅指定（single 模式，多个则 parallel）
        4. 上次回复者（thread_id 关联）→ single 模式
        5. 默认智能体（luban）→ single 模式

    Args:
        request: CouncilRequest 实例（含 topic, forgekin_ids, thread_id, mode）
        thread_store: ThreadStore 实例（用于查询上次回复者，可选）

    Returns:
        (forgekin_ids, routing_mode)
        routing_mode: "single" 或 "parallel"
    """
    topic = request.topic
    explicit_ids = request.forgekin_ids or []
    mode = request.mode or "auto"

    # 1. 显式 forgekin_ids 优先（前端明确指定）
    if explicit_ids:
        # 过滤掉不存在的 ID
        valid = [fid for fid in explicit_ids if fid in BUILTIN_FORGEKINS]
        if valid:
            routing_mode = "parallel" if len(valid) > 1 else "single"
            if mode == "parallel":
                routing_mode = "parallel"
            elif mode == "single":
                routing_mode = "single"
            logger.info(
                "council 路由: 显式指定 ids=%s mode=%s",
                valid, routing_mode,
            )
            return valid, routing_mode

    # 2. @all / @全体 → 全部并行
    if is_all_mention(topic):
        all_ids = list(BUILTIN_FORGEKINS)
        logger.info("council 路由: @all 触发全部并行 ids=%s", all_ids)
        return all_ids, "parallel"

    # 3. @特定智能体 → 仅指定
    mentioned = parse_individual_mentions(topic)
    if mentioned:
        routing_mode = "parallel" if len(mentioned) > 1 else "single"
        if mode == "parallel":
            routing_mode = "parallel"
        elif mode == "single":
            routing_mode = "single"
        logger.info(
            "council 路由: @mention 指定 ids=%s mode=%s",
            mentioned, routing_mode,
        )
        return mentioned, routing_mode

    # 4. 上次回复者（fallback 链核心）
    if thread_store and request.thread_id:
        last_replier = get_last_replier(thread_store, request.thread_id)
        if last_replier and last_replier in BUILTIN_FORGEKINS:
            logger.info(
                "council 路由: fallback last-replier id=%s thread=%s",
                last_replier, request.thread_id,
            )
            return [last_replier], "single"

    # 5. 默认智能体
    logger.info("council 路由: fallback 默认 id=%s", DEFAULT_FORGEKIN_ID)
    return [DEFAULT_FORGEKIN_ID], "single"
