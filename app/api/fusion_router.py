"""FlowForge Web Fusion 路由聚合 — v1 端点统一注册.

原 v1/ 目录已合并到各模块子目录（2026-07-29 重组），
本文件替代原 v1/__init__.py 的路由聚合职责。

所有路由以 /api/v1 为前缀，资源用复数，子资源用嵌套。
详细 API 清单见 web/WEB-FUSION-DESIGN.md §10.2。
"""
from __future__ import annotations

from fastapi import APIRouter

# Web Fusion 端点（原 v1/ 目录，现合并到各模块）
from flowforge.app.api.admin import audit, env_files, leaderboard, ops
from flowforge.app.api.agents import (
    capability,
    co_creators,
    concierge,
    forgekins,
    forgekins_council,
    signals,
    skills,
    threads,
    voice,
)
from flowforge.app.api.core import (
    connectors,
    eval,
    governance,
    mcp,
    notify,
    permissions,
    quotas,
    routing,
    tool_usage,
)
from flowforge.app.api.memory import memory_v1 as memory
from flowforge.app.api.plugins import marketplace
from flowforge.app.api.plugins import plugins_v1 as plugins
from flowforge.app.api.workflows import callbacks, missions

router = APIRouter(prefix="/api/v1", tags=["web-fusion-v1"])

# Forgekin 相关（council 路由必须先注册，避免 /{forgekin_id}/chat 捕获）
router.include_router(forgekins_council.router)
router.include_router(forgekins.router)

# 线程管理
router.include_router(threads.router)

# 记忆系统（仅 /collections /recall /health 子路径）
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
