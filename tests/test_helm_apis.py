"""Helm 模式 API 与数据库测试 — 覆盖 Plans / Uploads / UploadValidator / HelmDatabase 四个模块。"""

from __future__ import annotations

import io
import json
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from flowforge.memory.helm_db import HelmDatabase
from flowforge.tools.upload_validator import (
    ALLOWED_EXTENSIONS,
    MAX_FILE_SIZE,
    UploadValidator,
)


# ──────────────────────────── Fixtures ────────────────────────────


@pytest.fixture
def tmp_db(tmp_path: Path) -> HelmDatabase:
    """创建临时数据库，测试结束后自动清理。"""
    db_path = str(tmp_path / "test_helm.db")
    return HelmDatabase(db_path=db_path)


@pytest.fixture
def tmp_workspace(tmp_path: Path) -> Path:
    """创建临时工作空间目录。"""
    ws = tmp_path / "workspace"
    ws.mkdir(parents=True, exist_ok=True)
    return ws


def _make_app(tmp_db: HelmDatabase, tmp_workspace: Path) -> TestClient:
    """构造注入了临时数据库和工作空间的 FastAPI TestClient。"""
    from fastapi import FastAPI

    from flowforge.app.api.workflows import plans as plans_mod
    from flowforge.app.api.workspace import uploads as uploads_mod

    app = FastAPI()
    app.include_router(plans_mod.router)
    app.include_router(uploads_mod.router)

    # 注入临时数据库
    plans_mod._helm_db = tmp_db
    uploads_mod._helm_db = tmp_db

    # 注入临时工作空间目录
    uploads_mod._WORKSPACE_ROOT = tmp_workspace

    return TestClient(app)


@pytest.fixture
def client(tmp_db: HelmDatabase, tmp_workspace: Path) -> TestClient:
    return _make_app(tmp_db, tmp_workspace)


@pytest.fixture
def validator() -> UploadValidator:
    return UploadValidator()


# ══════════════════════════════════════════════════════════════════
# TestPlansAPI — 8 tests
# ══════════════════════════════════════════════════════════════════


class TestPlansAPI:
    """Plans API 端点测试。"""

    def test_create_plan(self, client: TestClient):
        """POST /api/v1/tasks/{task_id}/plan 创建计划，验证返回 id 和 status=pending。"""
        resp = client.post(
            "/api/v1/tasks/task-001/plan",
            json={"intent": "撰写一篇关于AI趋势的深度分析文章"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        data = body["data"]
        assert "id" in data
        assert data["status"] == "pending"
        assert data["task_id"] == "task-001"
        assert data["title"] == "撰写一篇关于AI趋势的深度分析文章"

    def test_get_plan(self, client: TestClient):
        """创建计划后 GET 获取，验证所有字段匹配。"""
        # 先创建
        create_resp = client.post(
            "/api/v1/tasks/task-002/plan",
            json={"intent": "研究量子计算应用场景", "persona": "tech", "mode": "pipeline"},
        )
        plan_data = create_resp.json()["data"]

        # 再获取
        get_resp = client.get("/api/v1/tasks/task-002/plan")
        assert get_resp.status_code == 200
        body = get_resp.json()
        assert body["success"] is True
        data = body["data"]
        assert data["id"] == plan_data["id"]
        assert data["task_id"] == "task-002"
        assert data["title"] == "研究量子计算应用场景"
        assert data["persona"] == "tech"
        assert data["mode"] == "pipeline"
        assert data["status"] == "pending"

    def test_get_plan_not_found(self, client: TestClient):
        """GET 不存在的 task_id 的计划，验证 404。"""
        resp = client.get("/api/v1/tasks/nonexistent-task/plan")
        assert resp.status_code == 404

    def test_confirm_plan(self, client: TestClient):
        """创建计划后确认，验证 status=confirmed 且 confirmed_at 已设置。"""
        create_resp = client.post(
            "/api/v1/tasks/task-003/plan",
            json={"intent": "编写产品发布稿"},
        )
        plan_id = create_resp.json()["data"]["id"]

        confirm_resp = client.post(
            "/api/v1/tasks/task-003/plan/confirm",
            json={"plan_id": plan_id},
        )
        assert confirm_resp.status_code == 200
        data = confirm_resp.json()["data"]
        assert data["status"] == "confirmed"
        assert data["confirmed_at"] is not None

    def test_confirm_plan_with_edited_steps(self, client: TestClient):
        """确认时携带编辑后的步骤，验证步骤被更新。"""
        create_resp = client.post(
            "/api/v1/tasks/task-004/plan",
            json={"intent": "市场调研报告"},
        )
        plan_id = create_resp.json()["data"]["id"]

        edited_steps = [
            {"name": "数据收集", "task": "收集市场数据", "agent": "researcher", "tool": "web_search", "mode": "pipeline"},
            {"name": "报告撰写", "task": "撰写调研报告", "agent": "writer", "tool": None, "mode": "pipeline"},
        ]

        confirm_resp = client.post(
            "/api/v1/tasks/task-004/plan/confirm",
            json={"plan_id": plan_id, "edited_steps": edited_steps},
        )
        assert confirm_resp.status_code == 200
        data = confirm_resp.json()["data"]
        assert data["status"] == "confirmed"
        assert len(data["steps_json"]) == 2
        assert data["steps_json"][0]["name"] == "数据收集"
        assert data["steps_json"][1]["name"] == "报告撰写"

    def test_reject_plan(self, client: TestClient):
        """创建计划后拒绝，验证 status=rejected。"""
        client.post(
            "/api/v1/tasks/task-005/plan",
            json={"intent": "竞品分析"},
        )

        reject_resp = client.post("/api/v1/tasks/task-005/plan/reject")
        assert reject_resp.status_code == 200
        data = reject_resp.json()["data"]
        assert data["status"] == "rejected"

    def test_update_step(self, client: TestClient):
        """PATCH 更新计划中的步骤，验证步骤已更新且 edited_steps 包含步骤名称。"""
        create_resp = client.post(
            "/api/v1/tasks/task-006/plan",
            json={"intent": "内容创作"},
        )

        # 更新第 0 步
        patch_resp = client.patch(
            "/api/v1/tasks/task-006/plan/steps/0",
            json={"name": "深度调研", "task": "执行深度调研任务"},
        )
        assert patch_resp.status_code == 200
        data = patch_resp.json()["data"]
        step = data["steps_json"][0]
        assert step["name"] == "深度调研"
        assert step["task"] == "执行深度调研任务"
        # edited_steps 应包含被编辑步骤的名称
        assert "深度调研" in data["edited_steps"]

    def test_update_step_invalid_index(self, client: TestClient):
        """PATCH 使用无效步骤索引，验证返回错误。"""
        client.post(
            "/api/v1/tasks/task-007/plan",
            json={"intent": "测试无效索引"},
        )

        resp = client.patch(
            "/api/v1/tasks/task-007/plan/steps/99",
            json={"name": "无效步骤"},
        )
        assert resp.status_code == 400


# ══════════════════════════════════════════════════════════════════
# TestUploadsAPI — 8 tests
# ══════════════════════════════════════════════════════════════════


class TestUploadsAPI:
    """Uploads API 端点测试。"""

    def test_upload_file(self, client: TestClient):
        """POST 上传有效文本文件，验证返回 id、file_name、file_type、status=uploaded。"""
        resp = client.post(
            "/api/v1/upload/task-up-001",
            files={"file": ("notes.txt", io.BytesIO(b"Hello World"), "text/plain")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert data["file_name"] == "notes.txt"
        assert data["file_type"] in ("text", "code", "json", "pdf", "image", "other")
        assert data["status"] == "uploaded"

    def test_upload_image(self, client: TestClient):
        """POST 上传伪图片文件（.png 扩展名 + image/png MIME），验证成功。"""
        fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        resp = client.post(
            "/api/v1/upload/task-up-002",
            files={"file": ("photo.png", io.BytesIO(fake_png), "image/png")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["file_type"] == "image"
        assert data["status"] == "uploaded"

    def test_upload_oversized_file(self, client: TestClient):
        """POST 超过 10MB 的文件，验证 400 错误。"""
        big_content = b"x" * (MAX_FILE_SIZE + 1)
        resp = client.post(
            "/api/v1/upload/task-up-003",
            files={"file": ("big.txt", io.BytesIO(big_content), "text/plain")},
        )
        assert resp.status_code == 400

    def test_upload_invalid_extension(self, client: TestClient):
        """POST .exe 扩展名的文件，验证 400 错误。"""
        resp = client.post(
            "/api/v1/upload/task-up-004",
            files={"file": ("malware.exe", io.BytesIO(b"MZ"), "application/octet-stream")},
        )
        assert resp.status_code == 400

    def test_upload_path_traversal(self, client: TestClient):
        """POST 包含路径穿越的文件名，验证 400 错误。"""
        resp = client.post(
            "/api/v1/upload/task-up-005",
            files={"file": ("../../../etc/passwd.txt", io.BytesIO(b"root:x:0:0"), "text/plain")},
        )
        assert resp.status_code == 400

    def test_list_attachments(self, client: TestClient):
        """上传文件后 GET 列表，验证文件出现在列表中。"""
        client.post(
            "/api/v1/upload/task-up-006",
            files={"file": ("doc.md", io.BytesIO(b"# Title"), "text/markdown")},
        )

        resp = client.get("/api/v1/upload/task-up-006")
        assert resp.status_code == 200
        attachments = resp.json()
        assert isinstance(attachments, list)
        assert len(attachments) >= 1
        assert attachments[0]["file_name"] == "doc.md"

    def test_delete_attachment(self, client: TestClient):
        """上传后 DELETE，验证软删除（status=deleted）。"""
        upload_resp = client.post(
            "/api/v1/upload/task-up-007",
            files={"file": ("temp.py", io.BytesIO(b"print('hi')"), "text/x-python")},
        )
        att_id = upload_resp.json()["id"]

        delete_resp = client.delete(f"/api/v1/upload/task-up-007/{att_id}")
        assert delete_resp.status_code == 200
        assert delete_resp.json()["status"] == "deleted"

    def test_download_attachment(self, client: TestClient):
        """上传后 GET 下载，验证文件内容匹配。"""
        content = b"download test content"
        upload_resp = client.post(
            "/api/v1/upload/task-up-008",
            files={"file": ("readme.txt", io.BytesIO(content), "text/plain")},
        )
        att_id = upload_resp.json()["id"]

        download_resp = client.get(f"/api/v1/upload/task-up-008/{att_id}")
        assert download_resp.status_code == 200
        assert download_resp.content == content


# ══════════════════════════════════════════════════════════════════
# TestUploadValidator — 8 tests
# ══════════════════════════════════════════════════════════════════


class TestUploadValidator:
    """UploadValidator 校验逻辑测试。"""

    def test_validate_valid_text_file(self, validator: UploadValidator):
        """有效的 .py 文件，验证 valid=True。"""
        result = validator.validate("script.py", b"print('hello')", "text/x-python", "task-v-001")
        assert result.valid is True
        assert result.safe_filename is not None
        assert result.file_type is not None

    def test_validate_oversized_file(self, validator: UploadValidator):
        """超过 10MB 的文件，验证 valid=False。"""
        big = b"x" * (MAX_FILE_SIZE + 1)
        result = validator.validate("big.txt", big, "text/plain", "task-v-002")
        assert result.valid is False
        assert "超过上限" in result.error

    def test_validate_invalid_mime(self, validator: UploadValidator):
        """错误的 MIME 类型，验证 valid=False。"""
        result = validator.validate("data.bin", b"\x00\xff", "application/x-binary", "task-v-003")
        assert result.valid is False
        assert "MIME" in result.error

    def test_validate_invalid_extension(self, validator: UploadValidator):
        """不允许的扩展名 .exe，验证 valid=False。"""
        result = validator.validate("program.exe", b"MZ", "application/octet-stream", "task-v-004")
        assert result.valid is False
        # MIME 或扩展名校验都可能先触发
        assert "MIME" in result.error or "扩展名" in result.error

    def test_validate_path_traversal(self, validator: UploadValidator):
        """包含 .. 的文件名，验证 valid=False。"""
        result = validator.validate("../../../etc/passwd.txt", b"root", "text/plain", "task-v-005")
        assert result.valid is False
        assert "非法路径" in result.error

    def test_sanitize_filename(self, validator: UploadValidator):
        """各种危险文件名，验证 safe_filename 使用 UUID。"""
        # 正常文件名应生成 UUID 开头的安全文件名
        result = validator.validate("normal.txt", b"ok", "text/plain", "task-v-006")
        assert result.valid is True
        # safe_filename 应为 UUID + 扩展名格式
        safe = result.safe_filename
        assert safe is not None
        assert safe.endswith(".txt")
        # UUID hex 为 32 字符
        name_without_ext = safe[:-4]  # 去掉 .txt
        assert len(name_without_ext) == 32

    def test_classify_file_type(self, validator: UploadValidator):
        """各种扩展名，验证正确分类。"""
        cases = [
            ("photo.png", b"\x89PNG", "image/png", "image"),
            ("script.py", b"pass", "text/x-python", "code"),
            ("data.json", b"{}", "application/json", "json"),
            ("doc.pdf", b"%PDF", "application/pdf", "pdf"),
            ("notes.txt", b"hi", "text/plain", "text"),
            ("style.css", b"{}", "text/css", "code"),
        ]
        for file_name, content, mime, expected_type in cases:
            result = validator.validate(file_name, content, mime, "task-v-007")
            assert result.valid is True, f"{file_name} should be valid, got error: {result.error}"
            assert result.file_type == expected_type, f"{file_name} expected {expected_type}, got {result.file_type}"

    def test_rate_limit(self, validator: UploadValidator):
        """60 秒内多次上传，验证频率限制生效。"""
        task_id = "task-rate-limit"
        # 前 MAX_FILES_PER_MINUTE 次应通过
        for i in range(10):
            assert validator.check_rate_limit(task_id) is True, f"第 {i+1} 次应通过"
        # 第 11 次应被限频
        assert validator.check_rate_limit(task_id) is False


# ══════════════════════════════════════════════════════════════════
# TestHelmDatabase — 7 tests
# ══════════════════════════════════════════════════════════════════


class TestHelmDatabase:
    """HelmDatabase 直接 CRUD 测试。"""

    def test_create_and_get_plan(self, tmp_db: HelmDatabase):
        """创建计划后按 id 获取，验证所有字段。"""
        steps = [{"name": "步骤一", "task": "执行任务", "agent": "generic", "tool": None, "mode": "pipeline"}]
        plan_id = tmp_db.create_plan(
            task_id="db-task-001",
            title="测试计划",
            steps=steps,
            description="这是一个测试计划",
            persona="tech",
            mode="pipeline",
        )
        assert plan_id > 0

        plan = tmp_db.get_plan(plan_id)
        assert plan is not None
        assert plan["id"] == plan_id
        assert plan["task_id"] == "db-task-001"
        assert plan["title"] == "测试计划"
        assert plan["description"] == "这是一个测试计划"
        assert plan["status"] == "pending"
        assert plan["persona"] == "tech"
        assert plan["mode"] == "pipeline"
        assert len(plan["steps_json"]) == 1
        assert plan["steps_json"][0]["name"] == "步骤一"

    def test_get_plan_by_task(self, tmp_db: HelmDatabase):
        """为同一 task_id 创建多个计划，验证获取最新一条。"""
        tmp_db.create_plan("db-task-002", "第一个计划", [{"name": "s1", "task": "t1", "agent": "g", "tool": None, "mode": "pipeline"}])
        tmp_db.create_plan("db-task-002", "第二个计划", [{"name": "s2", "task": "t2", "agent": "g", "tool": None, "mode": "pipeline"}])

        plan = tmp_db.get_plan_by_task("db-task-002")
        assert plan is not None
        assert plan["title"] == "第二个计划"

    def test_update_plan_status(self, tmp_db: HelmDatabase):
        """创建计划后更新状态，验证生命周期转换。"""
        plan_id = tmp_db.create_plan("db-task-003", "状态测试", [{"name": "s", "task": "t", "agent": "g", "tool": None, "mode": "pipeline"}])

        # pending -> confirmed
        assert tmp_db.update_plan_status(plan_id, HelmDatabase.PLAN_CONFIRMED) is True
        plan = tmp_db.get_plan(plan_id)
        assert plan["status"] == "confirmed"
        assert plan["confirmed_at"] is not None

        # confirmed -> executing
        assert tmp_db.update_plan_status(plan_id, HelmDatabase.PLAN_EXECUTING) is True
        plan = tmp_db.get_plan(plan_id)
        assert plan["status"] == "executing"
        assert plan["started_at"] is not None

        # executing -> completed
        assert tmp_db.update_plan_status(plan_id, HelmDatabase.PLAN_COMPLETED) is True
        plan = tmp_db.get_plan(plan_id)
        assert plan["status"] == "completed"
        assert plan["completed_at"] is not None

    def test_create_and_get_attachment(self, tmp_db: HelmDatabase):
        """创建附件后按 id 获取，验证字段。"""
        att_id = tmp_db.create_attachment(
            task_id="db-task-004",
            file_name="report.pdf",
            file_size=2048,
            file_type="pdf",
            storage_path="/tmp/report.pdf",
            mime_type="application/pdf",
            extension=".pdf",
        )
        assert att_id > 0

        att = tmp_db.get_attachment(att_id)
        assert att is not None
        assert att["id"] == att_id
        assert att["task_id"] == "db-task-004"
        assert att["file_name"] == "report.pdf"
        assert att["file_size"] == 2048
        assert att["file_type"] == "pdf"
        assert att["status"] == "uploaded"

    def test_list_attachments_by_task(self, tmp_db: HelmDatabase):
        """创建多个附件后列出，验证列表。"""
        tmp_db.create_attachment("db-task-005", "a.txt", 10, "text", "/tmp/a.txt", mime_type="text/plain", extension=".txt")
        tmp_db.create_attachment("db-task-005", "b.json", 20, "json", "/tmp/b.json", mime_type="application/json", extension=".json")

        attachments = tmp_db.list_attachments_by_task("db-task-005")
        assert len(attachments) == 2
        names = {a["file_name"] for a in attachments}
        assert names == {"a.txt", "b.json"}

    def test_soft_delete_attachment(self, tmp_db: HelmDatabase):
        """软删除附件，验证 status=deleted 且不出现在列表中。"""
        att_id = tmp_db.create_attachment("db-task-006", "del.txt", 5, "text", "/tmp/del.txt", mime_type="text/plain", extension=".txt")

        assert tmp_db.delete_attachment(att_id) is True

        # 直接获取仍可看到，但 status=deleted
        att = tmp_db.get_attachment(att_id)
        assert att["status"] == "deleted"

        # 列表中不应出现
        attachments = tmp_db.list_attachments_by_task("db-task-006")
        assert len(attachments) == 0

    def test_mark_accessed(self, tmp_db: HelmDatabase):
        """标记访问，验证 last_accessed_at 已更新。"""
        att_id = tmp_db.create_attachment("db-task-007", "acc.txt", 3, "text", "/tmp/acc.txt", mime_type="text/plain", extension=".txt")

        # 初始 last_accessed_at 为 None
        att = tmp_db.get_attachment(att_id)
        assert att["last_accessed_at"] is None

        # 标记访问
        assert tmp_db.mark_accessed(att_id) is True

        # 验证已更新
        att = tmp_db.get_attachment(att_id)
        assert att["last_accessed_at"] is not None
