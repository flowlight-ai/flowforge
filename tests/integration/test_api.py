import pytest
import os
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

DATA_DIR = Path(__file__).parent.parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


@pytest.fixture(scope="module")
def client():
    os.environ.setdefault("OPENROUTER_API_KEY", "test-key")
    from flowforge.app.main import app
    return TestClient(app)


def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "components" in data


def test_list_modes(client):
    response = client.get("/api/v1/modes")
    assert response.status_code == 200
    modes = response.json()["data"]["modes"]
    mode_names = [m["name"] for m in modes]
    assert "react" in mode_names
    assert "workflow" in mode_names


def test_platform_info(client):
    response = client.get("/api/v1/system/platform")
    assert response.status_code == 200


def test_dashboard_stats(client):
    response = client.get("/api/v1/dashboard/stats")
    assert response.status_code == 200


def test_review_queue(client):
    response = client.get("/api/v1/review/queue")
    assert response.status_code == 200


def test_list_agents(client):
    response = client.get("/api/v1/agents")
    assert response.status_code == 200
    data = response.json()
    assert "agents" in data["data"]


def test_admin_config(client):
    response = client.get("/api/v1/admin/config")
    assert response.status_code == 200


def test_dashboard_actions(client):
    response = client.get("/api/v1/dashboard/actions")
    assert response.status_code == 200


def test_dashboard_status(client):
    response = client.get("/api/v1/dashboard/status")
    assert response.status_code == 200


def test_logs_endpoint(client):
    response = client.get("/api/v1/logs")
    assert response.status_code == 200


def test_list_schedules(client):
    response = client.get("/api/v1/schedules")
    assert response.status_code == 200


def test_list_plugins(client):
    response = client.get("/api/v1/plugins")
    assert response.status_code == 200


def test_models_health(client):
    response = client.get("/api/v1/admin/models/health")
    assert response.status_code == 200


def test_models_assignments(client):
    response = client.get("/api/v1/admin/models/assignments")
    assert response.status_code == 200


def test_workflows_list(client):
    response = client.get("/api/v1/workflows")
    assert response.status_code == 200


def test_metrics_endpoint(client):
    response = client.get("/metrics")
    assert response.status_code == 200


def test_create_task(client):
    response = client.post("/api/v1/tasks", json={
        "persona": "education",
        "input_data": {"task": "test task"},
        "mode": "workflow",
        "interaction_mode": "standard",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["data"]["persona"] == "education"
    assert data["data"]["mode"] == "workflow"
    assert "task_id" in data["data"]


def test_create_task_default_mode(client):
    response = client.post("/api/v1/tasks", json={
        "persona": "life",
        "input_data": {"task": "简单任务"},
    })
    assert response.status_code == 201
    data = response.json()
    assert data["data"]["persona"] == "life"


def test_list_tasks(client):
    response = client.get("/api/v1/tasks")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data["data"]
    assert "total" in data["data"]


def test_list_tasks_with_filters(client):
    response = client.get("/api/v1/tasks", params={
        "persona": "education",
        "status": "completed",
        "limit": 10,
        "offset": 0,
    })
    assert response.status_code == 200


def test_get_task_not_found(client):
    response = client.get("/api/v1/tasks/nonexistent-task-id")
    assert response.status_code == 404


def test_submit_review_not_found(client):
    response = client.post("/api/v1/tasks/nonexistent-task-id/review", json={
        "verdict": "approve",
        "feedback": "looks good",
    })
    assert response.status_code == 404


def test_pause_task_not_found(client):
    response = client.post("/api/v1/tasks/nonexistent-task-id/pause")
    assert response.status_code == 404


def test_resume_task_not_found(client):
    response = client.post("/api/v1/tasks/nonexistent-task-id/resume")
    assert response.status_code == 404


def test_cancel_task_not_found(client):
    response = client.post("/api/v1/tasks/nonexistent-task-id/cancel")
    assert response.status_code == 404


def test_skip_stage_not_found(client):
    response = client.post("/api/v1/tasks/nonexistent-task-id/skip", json={"skip_to": "publish"})
    assert response.status_code == 404


def test_review_detail_not_found(client):
    response = client.get("/api/v1/review/nonexistent-task-id")
    assert response.status_code == 404


def test_auth_token_invalid_credentials(client):
    response = client.post("/api/v1/auth/token", json={
        "username": "invalid_user",
        "password": "wrong_password",
    })
    assert response.status_code == 401


def test_auth_refresh_invalid_token(client):
    response = client.post("/api/v1/auth/refresh", json={
        "refresh_token": "invalid_token",
    })
    assert response.status_code == 401


def test_logs_with_filters(client):
    response = client.get("/api/v1/logs", params={
        "level": "INFO",
        "limit": 10,
    })
    assert response.status_code == 200


def test_admin_config_reload(client):
    response = client.post("/api/v1/admin/config/reload")
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["message"] == "Configuration reloaded successfully"


def test_admin_models_assign_update(client):
    response = client.put("/api/v1/admin/models/assign", json={
        "persona": "test_persona",
        "agent_name": "topic_research",
        "primary_model": "openrouter/test-model",
        "fallback_models": ["openrouter/fallback-model"],
    })
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["primary_model"] == "openrouter/test-model"


def test_admin_models_assign_missing_fields(client):
    response = client.put("/api/v1/admin/models/assign", json={
        "persona": "test",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "error"


def test_admin_models_autofix(client):
    response = client.post("/api/v1/admin/models/autofix")
    assert response.status_code == 200


def test_admin_models_health_force(client):
    response = client.post("/api/v1/admin/models/health/force")
    assert response.status_code == 200


def test_admin_models_health_check(client):
    response = client.post("/api/v1/admin/models/health/check", json={
        "model_key": "openrouter/test-model",
    })
    assert response.status_code == 200


def test_create_schedule(client):
    response = client.post("/api/v1/schedules", json={
        "persona": "education",
        "cron": "0 9 * * *",
        "input_data": {"task": "daily report"},
        "mode": "workflow",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["data"]["cron"] == "0 9 * * *"


def test_create_schedule_missing_cron(client):
    response = client.post("/api/v1/schedules", json={
        "persona": "education",
    })
    assert response.status_code == 400


def test_delete_schedule_not_found(client):
    response = client.delete("/api/v1/schedules/nonexistent-schedule")
    assert response.status_code == 404


def test_plugins_reload(client):
    response = client.post("/api/v1/plugins/reload")
    assert response.status_code == 200
