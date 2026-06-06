import os
import httpx

BASE_URL = os.environ.get("FLOWFORGE_BASE_URL", "http://127.0.0.1:8002")


class TestAPIValidation:
    def test_health_endpoint(self):
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(f"{BASE_URL}/health")
            assert resp.status_code == 200
