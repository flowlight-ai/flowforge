from fastapi import APIRouter
from flowforge.app.api.endpoints import (
    tasks, modes, admin, dashboard, review, schedules,
    plugins, system, agents, workflows, auth, logs,
    admin_models, settings,
    prompts, memory, metrics,
    forgemind,
)
from flowforge.app.api.endpoints.graph import router as graph_router
from flowforge.app.api.endpoints.domain_plugins import router as domain_plugins_router
from flowforge.app.api.endpoints.forgemind import router as forgemind_router
from flowforge.app.api.plugin_management import router as plugin_management_router
from flowforge.app.api.marketplace_api import router as marketplace_router

router = APIRouter(prefix="/api/v1")
router.include_router(tasks.router)
router.include_router(modes.router)
router.include_router(admin.router)
router.include_router(admin_models.router)
router.include_router(dashboard.router)
router.include_router(review.router)
router.include_router(schedules.router)
router.include_router(plugins.router)
router.include_router(system.router)
router.include_router(agents.router)
router.include_router(workflows.router)
router.include_router(auth.router)
router.include_router(logs.router)
router.include_router(settings.router)
router.include_router(graph_router)
router.include_router(prompts.router)
router.include_router(memory.router)
router.include_router(metrics.router)
router.include_router(domain_plugins_router)
router.include_router(plugin_management_router)
router.include_router(marketplace_router)
# v7.0: ForgeMind Forgekin应用层 API（Trae CN 桥接 + webchat + IM MindCouncil + 自进化）
router.include_router(forgemind_router)
