"""FlowForge Web Fusion Phase 8 — Backend API stubs.

将 clowder-ai 的后端 API 端点合并到 FlowForge 8000 端口。
所有路由以 ``/api/v1`` 为前缀，资源用复数，子资源用嵌套。

命名规范（铁律）：
    - 使用 ``forgekin`` 替代 ``cat``
    - 使用 ``可进化智能体`` 替代 ``灵智体``
    - 严禁使用 cat/clowder/cat-cafe 字样

每个路由文件均为 stub 实现，返回空列表/默认配置，确保：
    - 前端 fetch 不会 404
    - 前端可以正常渲染（即使是空状态）
    - 响应格式与前端期望一致

详细 API 清单见 web/WEB-FUSION-DESIGN.md §10.2。
"""

from __future__ import annotations

from fastapi import APIRouter

# Web Fusion Phase 8 路由模块
from flowforge.app.api.v1 import (
    audit,
    callbacks,
    capability,
    co_creators,
    concierge,
    connectors,
    env_files,
    eval,
    forgekins,
    forgekins_council,
    governance,
    leaderboard,
    marketplace,
    mcp,
    memory,
    missions,
    notify,
    ops,
    permissions,
    plugins,
    quotas,
    routing,
    signals,
    skills,
    threads,
    tool_usage,
    voice,
)

router = APIRouter(prefix="/api/v1", tags=["web-fusion-v1"])

# Forgekin 相关（重命名自 clowder-ai cats）
router.include_router(forgekins.router)
router.include_router(forgekins_council.router)

# 线程管理
router.include_router(threads.router)

# 记忆系统（与现有 endpoints/memory.py 共享 /memory 前缀，
# 仅定义 /collections /recall /health 子路径，不与现有 /memory/{id} 冲突）
router.include_router(memory.router)

# 任务管理
router.include_router(missions.router)

# 信号系统
router.include_router(signals.router)

# 治理与权限
router.include_router(governance.router)
router.include_router(permissions.router)
router.include_router(quotas.router)

# 路由与连接器
router.include_router(routing.router)
router.include_router(connectors.router)

# 能力与插件
router.include_router(skills.router)
router.include_router(mcp.router)
router.include_router(plugins.router)
router.include_router(marketplace.router)

# 配置与运维
router.include_router(concierge.router)
router.include_router(voice.router)
router.include_router(notify.router)
router.include_router(ops.router)
router.include_router(env_files.router)
router.include_router(co_creators.router)

# 评估与统计
router.include_router(eval.router)
router.include_router(leaderboard.router)
router.include_router(tool_usage.router)
router.include_router(audit.router)
router.include_router(callbacks.router)

# 能力画像
router.include_router(capability.router)

__all__ = ["router"]
