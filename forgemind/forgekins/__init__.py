"""灵智体花名册（Forgekins Roster）— 预置灵智体配置加载入口.

参考 clowder-ai/cat-template.json，结合 FlowForge v7.0 育灵体系,
预置 3 只灵智体（参考 clowder-ai 最初 3 只猫）:
- 宪宪（布偶猫 / Ragdoll）— 主架构师
- 砚砚（缅因猫 / Maine Coon）— 代码审查专家
- 烁烁（暹罗猫 / Siamese）— 视觉设计师

所有 3 只灵智体通过 Trae CN 桥接方案接入 LLM:
- 用户/operator 通过 Trae CN 充当 LLM 与监工
- 流程使用 flowforge 已有的 ForgePipeline + TraeLLMClient
- 任务文件落地于 data/trae_bridge/{tasks,responses}/

详见:
    - [doc:design/naming-contract.md#2.2] 灵智体定义
    - clowder-ai/cat-template.json — 3 只猫参考实现
    - flowforge/llm/trae/client.py — Trae 桥接客户端
"""

from flowforge.forgemind.forgekins.roster import (
    BUILTIN_FORGEKINS,
    ROSTER_FILES,
    load_forgekin_config,
    list_builtin_forgekins,
)

__all__ = [
    "BUILTIN_FORGEKINS",
    "ROSTER_FILES",
    "load_forgekin_config",
    "list_builtin_forgekins",
]
