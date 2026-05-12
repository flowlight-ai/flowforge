import pytest
from fastapi.testclient import TestClient

@pytest.fixture
def client():
    from app.main import app
    return TestClient(app)

def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200

def test_list_modes(client):
    response = client.get("/api/v1/modes")
    assert response.status_code == 200
    modes = response.json()["data"]["modes"]
    assert "react" in modes
    assert "workflow" in modes

def test_platform_info(client):
    response = client.get("/api/v1/system/platform")
    assert response.status_code == 200

def test_dashboard_stats(client):
    response = client.get("/api/v1/dashboard/stats")
    assert response.status_code == 200

def test_review_queue(client):
    response = client.get("/api/v1/review/queue")
    assert response.status_code == 200
