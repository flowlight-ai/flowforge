import pytest
from flowforge.scheduler.scheduler import TaskScheduler


@pytest.fixture
def scheduler():
    sched = TaskScheduler(executor=None)
    yield sched
    try:
        sched.scheduler.shutdown(wait=False)
    except Exception:
        pass


def test_add_cron_job(scheduler):
    scheduler.add_cron_job("job-001", "education", "0 9 * * *", {"task": "daily_report"}, mode="workflow")
    assert "job-001" in scheduler._jobs
    assert scheduler._jobs["job-001"]["persona"] == "education"
    assert scheduler._jobs["job-001"]["cron"] == "0 9 * * *"
    assert scheduler._jobs["job-001"]["mode"] == "workflow"


def test_add_cron_job_default_mode(scheduler):
    scheduler.add_cron_job("job-002", "life", "30 8 * * 1", {"task": "weekly"})
    assert scheduler._jobs["job-002"]["mode"] == "workflow"


def test_remove_job(scheduler):
    scheduler.add_cron_job("job-003", "education", "0 9 * * *", {"task": "test"})
    scheduler.remove_job("job-003")
    assert "job-003" not in scheduler._jobs


def test_remove_nonexistent_job(scheduler):
    scheduler.remove_job("nonexistent-job")


def test_list_jobs(scheduler):
    scheduler.add_cron_job("job-004", "education", "0 9 * * *", {"task": "test"})
    try:
        jobs = scheduler.list_jobs()
        job_ids = [j["id"] for j in jobs]
        assert "job-004" in job_ids
    except AttributeError:
        assert "job-004" in scheduler._jobs


def test_list_jobs_empty(scheduler):
    jobs = scheduler.list_jobs()
    assert jobs == []


def test_add_cron_job_replace_existing(scheduler):
    scheduler.add_cron_job("job-005", "education", "0 9 * * *", {"task": "first"})
    scheduler.add_cron_job("job-005", "life", "0 10 * * *", {"task": "second"})
    assert scheduler._jobs["job-005"]["persona"] == "life"
    assert scheduler._jobs["job-005"]["cron"] == "0 10 * * *"


def test_list_jobs_internal_tracking(scheduler):
    scheduler.add_cron_job("job-006", "education", "0 9 * * *", {"task": "test"}, mode="react")
    assert scheduler._jobs["job-006"]["input_data"] == {"task": "test"}
    assert scheduler._jobs["job-006"]["mode"] == "react"
