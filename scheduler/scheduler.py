from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from core.tracing import get_logger
from core.config import system_config

logger = get_logger("scheduler")

class TaskScheduler:
    def __init__(self, executor=None):
        self.scheduler = AsyncIOScheduler(timezone=system_config.scheduler_timezone)
        self.executor = executor
        self._jobs = {}

    def add_cron_job(self, job_id: str, persona: str, cron_expr: str, input_data: dict, mode: str = "workflow"):
        parts = cron_expr.split()
        trigger = CronTrigger(minute=parts[0] if len(parts) > 0 else "0",
                              hour=parts[1] if len(parts) > 1 else "*",
                              day=parts[2] if len(parts) > 2 else "*",
                              month=parts[3] if len(parts) > 3 else "*",
                              day_of_week=parts[4] if len(parts) > 4 else "*")
        self.scheduler.add_job(self._run_scheduled_task, trigger,
                               id=job_id, args=[persona, input_data, mode],
                               replace_existing=True)
        self._jobs[job_id] = {"persona": persona, "cron": cron_expr, "mode": mode, "input_data": input_data}
        logger.info(f"定时任务已添加: {job_id} ({cron_expr})")

    async def _run_scheduled_task(self, persona, input_data, mode):
        if not self.executor:
            logger.error("Executor not set for scheduler")
            return
        from core.task_context import TaskContext
        import uuid
        task_id = f"cron-{uuid.uuid4()}"
        context = TaskContext(task_id=task_id, persona=persona, input_data=input_data, mode=mode)
        try:
            await self.executor.run(context, mode_hint=mode)
            logger.info(f"定时任务完成: {task_id}")
        except Exception as e:
            logger.error(f"定时任务失败: {task_id} - {e}")

    def remove_job(self, job_id: str):
        try:
            self.scheduler.remove_job(job_id)
            self._jobs.pop(job_id, None)
        except Exception:
            pass

    def list_jobs(self) -> list:
        return [{"id": j.id, "next_run": str(j.next_run_time)} for j in self.scheduler.get_jobs()]

    def start(self):
        if system_config.scheduler_enabled:
            self.scheduler.start()
            logger.info("调度器已启动")

    def shutdown(self):
        self.scheduler.shutdown(wait=False)
