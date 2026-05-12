from fastapi import APIRouter
from app.api.endpoints import tasks, modes, admin, dashboard, review, schedules, plugins, system, agents, workflows

router = APIRouter(prefix="/api/v1")
router.include_router(tasks.router)
router.include_router(modes.router)
router.include_router(admin.router)
router.include_router(dashboard.router)
router.include_router(review.router)
router.include_router(schedules.router)
router.include_router(plugins.router)
router.include_router(system.router)
router.include_router(agents.router)
router.include_router(workflows.router)
