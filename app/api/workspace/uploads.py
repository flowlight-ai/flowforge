"""文件上传 API — Helm 模式附件上传、列表、下载、软删除。"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from flowforge.core.tracing import get_logger
from flowforge.memory.helm_db import HelmDatabase
from flowforge.tools.upload_validator import UploadValidator

logger = get_logger("flowforge.uploads_api")

router = APIRouter(prefix="/api/v1/upload", tags=["upload"])

# ── 模块级单例 ──

_validator = UploadValidator()

_helm_db: HelmDatabase | None = None


def get_helm_db() -> HelmDatabase:
    global _helm_db
    if _helm_db is None:
        _helm_db = HelmDatabase()
    return _helm_db


# ── 存储根目录 ──

_WORKSPACE_ROOT = Path("data/workspace")


# ── 端点 ──


@router.post("/{task_id}")
async def upload_file(task_id: str, file: UploadFile = File(...)):
    """上传附件到指定任务。"""

    # 1. 频率限制
    if not _validator.check_rate_limit(task_id):
        raise HTTPException(
            status_code=429,
            detail="上传频率超限，每分钟最多 10 次",
        )

    # 2. 读取文件内容
    try:
        content = await file.read()
    except Exception as exc:
        logger.error("读取上传文件失败: %s", exc)
        raise HTTPException(status_code=500, detail="读取上传文件失败") from exc

    # 3. 校验
    file_name = file.filename or "unknown"
    mime_type = file.content_type or "application/octet-stream"

    result = _validator.validate(file_name, content, mime_type, task_id)
    if not result.valid:
        raise HTTPException(status_code=400, detail=result.error)

    # 4. 存储到磁盘
    storage_dir = _WORKSPACE_ROOT / task_id / "attachments"
    storage_path = storage_dir / result.safe_filename  # type: ignore[arg-type]

    try:
        storage_dir.mkdir(parents=True, exist_ok=True)
        storage_path.write_bytes(content)
    except Exception as exc:
        logger.error("文件存储失败: %s", exc)
        raise HTTPException(status_code=500, detail="文件存储失败") from exc

    # 5. 记录到数据库
    db = get_helm_db()
    ext = Path(file_name).suffix.lower()
    try:
        att_id = db.create_attachment(
            task_id=task_id,
            file_name=file_name,
            file_size=len(content),
            file_type=result.file_type,  # type: ignore[arg-type]
            storage_path=str(storage_path),
            mime_type=mime_type,
            extension=ext,
        )
    except Exception as exc:
        # 回滚磁盘文件
        try:
            storage_path.unlink(missing_ok=True)
        except Exception:
            pass
        logger.error("附件记录创建失败: %s", exc)
        raise HTTPException(status_code=500, detail="附件记录创建失败") from exc

    logger.info("文件上传成功: task_id=%s, att_id=%s, file=%s", task_id, att_id, file_name)

    return {
        "id": str(att_id),
        "file_name": file_name,
        "file_type": result.file_type,
        "status": "uploaded",
    }


@router.get("/{task_id}")
async def list_attachments(task_id: str):
    """列出指定任务的所有附件。"""
    db = get_helm_db()
    attachments = db.list_attachments_by_task(task_id)
    return attachments


@router.get("/{task_id}/{attachment_id}")
async def download_attachment(task_id: str, attachment_id: int):
    """下载指定附件。"""
    db = get_helm_db()
    att = db.get_attachment(attachment_id)

    if att is None or att["task_id"] != task_id or att["status"] == "deleted":
        raise HTTPException(status_code=404, detail="附件不存在")

    storage_path = Path(att["storage_path"])
    if not storage_path.exists():
        raise HTTPException(status_code=404, detail="附件文件不存在")

    # 更新最后访问时间
    db.mark_accessed(attachment_id)

    return FileResponse(
        path=str(storage_path),
        filename=att["file_name"],
        media_type=att.get("mime_type") or "application/octet-stream",
    )


@router.delete("/{task_id}/{attachment_id}")
async def delete_attachment(task_id: str, attachment_id: int):
    """软删除指定附件。"""
    db = get_helm_db()
    att = db.get_attachment(attachment_id)

    if att is None or att["task_id"] != task_id:
        raise HTTPException(status_code=404, detail="附件不存在")

    if att["status"] == "deleted":
        return {"status": "deleted"}

    db.delete_attachment(attachment_id)
    logger.info("附件已软删除: task_id=%s, att_id=%s", task_id, attachment_id)

    return {"status": "deleted"}
