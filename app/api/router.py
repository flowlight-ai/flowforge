"""FlowForge API 路由注册中心.

按架构层次/模块组织（2026-07-29 重组）:
    - core/       架构基础设施层（system/auth/metrics/logs/openroute）
    - agents/     智能体模块（agents/forgemind/council/modes/external_agents/verify）
    - workflows/  工作流模块（workflows/plans/tasks/loops）
    - memory/     记忆模块（memory/graph）
    - plugins/    插件模块（plugins/domain_plugins）
    - admin/      后台管理模块（admin/admin_models/settings/review/schedules/prompts）
    - workspace/  工作区模块（workspace/uploads）
    - endpoints/  独立组件（dashboard/websocket）

所有 API 统一注册到 /api/v1 前缀下。
"""
from fastapi import APIRouter

# ── 架构基础设施层 ──────────────────────────────────────────────
from flowforge.app.api.core import system, auth, metrics, logs

# ── 智能体模块 ──────────────────────────────────────────────────
from flowforge.app.api.agents import agents, modes, forgemind, verify, external_agents_api

# ── 工作流模块 ──────────────────────────────────────────────────
from flowforge.app.api.workflows import workflows, tasks

# ── 记忆模块 ────────────────────────────────────────────────────
from flowforge.app.api.memory import memory
from flowforge.app.api.memory.graph import router as graph_router

# ── 插件模块 ────────────────────────────────────────────────────
from flowforge.app.api.plugins import plugins
from flowforge.app.api.plugins.domain_plugins import router as domain_plugins_router

# ── 后台管理模块 ────────────────────────────────────────────────
from flowforge.app.api.admin import admin, admin_models, settings, review, schedules, prompts

# ── 独立组件 ────────────────────────────────────────────────────
from flowforge.app.api.endpoints import dashboard

# ── 根级 API 模块 ───────────────────────────────────────────────
from flowforge.app.api.plugin_management import router as plugin_management_router
from flowforge.app.api.marketplace_api import router as marketplace_router

router = APIRouter(prefix="/api/v1")

# ── 架构基础设施 ────────────────────────────────────────────────
router.include_router(system.router)
router.include_router(auth.router)
router.include_router(metrics.router)
router.include_router(logs.router)

# ── 智能体 ──────────────────────────────────────────────────────
router.include_router(agents.router)
router.include_router(modes.router)
router.include_router(forgemind.router)
router.include_router(verify.router)
router.include_router(external_agents_api.router)

# ── 工作流 ──────────────────────────────────────────────────────
router.include_router(workflows.router)
router.include_router(tasks.router)

# ── 记忆 ────────────────────────────────────────────────────────
router.include_router(memory.router)
router.include_router(graph_router)

# ── 插件 ────────────────────────────────────────────────────────
router.include_router(plugins.router)
router.include_router(domain_plugins_router)
router.include_router(plugin_management_router)
router.include_router(marketplace_router)

# ── 后台管理 ────────────────────────────────────────────────────
router.include_router(admin.router)
router.include_router(admin_models.router)
router.include_router(settings.router)
router.include_router(review.router)
router.include_router(schedules.router)
router.include_router(prompts.router)

# ── 独立组件 ────────────────────────────────────────────────────
router.include_router(dashboard.router)
