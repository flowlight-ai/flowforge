"""Forgekin花名册（Forgekins Roster）— 预置Forgekin配置加载入口.

参考 cat-template.json 范式，结合 FlowForge v7.0 Forge Nurturing体系,
预置 3 只Forgekin（参考最初 3 只猫）:
- 鲁班（猫头鹰 / Owl）— 主架构师
- 夏洛克（猎犬 / Bloodhound）— 代码审查专家
- 梵高（孔雀 / Peacock）— 视觉设计师

所有 3 只Forgekin通过 Trae CN 桥接方案接入 LLM:
- 用户/operator 通过 Trae CN 充当 LLM 与监工
- 流程使用 flowforge 已有的 ForgePipeline + TraeLLMClient
- 任务文件落地于 data/trae_bridge/{tasks,responses}/

详见:
    - [doc:design/naming-contract.md#2.2] Forgekin定义
    - cat-template.json — 3 只猫参考实现
    - flowforge/llm/trae/client.py — Trae 桥接客户端
"""

from flowforge.forgemind.forgekins.roster import (
    BUILTIN_FORGEKINS,
    ROSTER_FILES,
    list_builtin_forgekins,
    load_forgekin_config,
)

__all__ = [
    "BUILTIN_FORGEKINS",
    "ROSTER_FILES",
    "load_forgekin_config",
    "list_builtin_forgekins",
]
