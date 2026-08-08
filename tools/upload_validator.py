"""文件上传验证器 — 校验大小、MIME、扩展名、路径穿越，并生成安全存储文件名。"""

from __future__ import annotations

import fnmatch
import time
import uuid
from dataclasses import dataclass
from pathlib import PurePosixPath

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.tools.upload_validator")

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

MAX_FILE_SIZE: int = 10 * 1024 * 1024  # 10 MB
MAX_FILES_PER_MINUTE: int = 10
MAX_FILES_PER_TASK: int = 20

ALLOWED_MIME_TYPES: set[str] = {
    "image/*",
    "text/*",
    "application/json",
    "application/pdf",
    "application/javascript",
    "application/xml",
    "application/x-yaml",
    "application/toml",
}

ALLOWED_EXTENSIONS: set[str] = {
    ".py", ".js", ".ts", ".jsx", ".tsx",
    ".md", ".txt", ".csv", ".json",
    ".yaml", ".yml", ".xml", ".html", ".css", ".scss",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    ".pdf",
    ".toml", ".ini", ".cfg",
    ".env.example", ".gitignore",
}

# ---------------------------------------------------------------------------
# 数据类
# ---------------------------------------------------------------------------


@dataclass
class UploadValidationResult:
    """上传校验结果。"""

    valid: bool
    error: str | None = None
    safe_filename: str | None = None
    file_type: str | None = None


# ---------------------------------------------------------------------------
# 验证器
# ---------------------------------------------------------------------------


class UploadValidator:
    """文件上传验证器，执行大小 / MIME / 扩展名 / 路径穿越 / 频率校验链。"""

    def __init__(self, max_size: int = MAX_FILE_SIZE) -> None:
        self._max_size = max_size
        # task_id -> list[timestamp]  用于滑动窗口限频
        self._upload_counts: dict[str, list[float]] = {}

    # ------------------------------------------------------------------
    # 公开接口
    # ------------------------------------------------------------------

    def validate(
        self,
        file_name: str,
        content_bytes: bytes,
        mime_type: str,
        task_id: str,
    ) -> UploadValidationResult:
        """执行完整校验链：大小 → MIME → 扩展名 → 路径穿越 → 安全文件名生成。"""

        # 1. 大小校验
        if len(content_bytes) > self._max_size:
            msg = (
                f"文件大小 {len(content_bytes)} 字节超过上限 "
                f"{self._max_size} 字节"
            )
            logger.warning(msg)
            return UploadValidationResult(valid=False, error=msg)

        # 2. MIME 校验
        if not self._is_mime_allowed(mime_type):
            msg = f"不允许的 MIME 类型: {mime_type}"
            logger.warning(msg)
            return UploadValidationResult(valid=False, error=msg)

        # 3. 扩展名校验
        ext = self._extract_extension(file_name)
        if ext is None or not self._is_extension_allowed(ext):
            msg = f"不允许的文件扩展名: {ext}"
            logger.warning(msg)
            return UploadValidationResult(valid=False, error=msg)

        # 4. 路径穿越校验
        safe_name = self._sanitize_filename(file_name)
        if safe_name is None:
            msg = f"文件名包含非法路径组件: {file_name}"
            logger.warning(msg)
            return UploadValidationResult(valid=False, error=msg)

        # 5. 生成安全存储文件名
        storage_name = f"{uuid.uuid4().hex}{ext}"
        file_type = self._classify_file_type(ext, mime_type)

        logger.info(
            "文件校验通过: original=%s, storage=%s, type=%s",
            file_name,
            storage_name,
            file_type,
        )

        return UploadValidationResult(
            valid=True,
            safe_filename=storage_name,
            file_type=file_type,
        )

    def check_rate_limit(self, task_id: str) -> bool:
        """滑动窗口限频：60 秒内同一 task_id 最多 MAX_FILES_PER_MINUTE 次上传。"""
        now = time.monotonic()
        window = 60.0

        timestamps = self._upload_counts.get(task_id, [])
        # 清理过期记录
        timestamps = [ts for ts in timestamps if now - ts < window]

        if len(timestamps) >= MAX_FILES_PER_MINUTE:
            logger.warning(
                "任务 %s 上传频率超限: %d 次 / %d 秒",
                task_id,
                len(timestamps),
                int(window),
            )
            self._upload_counts[task_id] = timestamps
            return False

        timestamps.append(now)
        self._upload_counts[task_id] = timestamps
        return True

    # ------------------------------------------------------------------
    # 内部方法
    # ------------------------------------------------------------------

    def _is_mime_allowed(self, mime_type: str) -> bool:
        """检查 MIME 类型是否在白名单内（支持通配符 image/* 等）。"""
        for allowed in ALLOWED_MIME_TYPES:
            if fnmatch.fnmatch(mime_type.lower(), allowed.lower()):
                return True
        return False

    def _extract_extension(self, file_name: str) -> str | None:
        """从文件名中提取扩展名（小写），支持 .env.example 等多段扩展名。"""
        # 先尝试匹配多段扩展名（如 .env.example, .gitignore）
        lower = file_name.lower()
        for ext in sorted(ALLOWED_EXTENSIONS, key=len, reverse=True):
            if lower.endswith(ext):
                return ext
        # 回退到 pathlib
        dot_ext = PurePosixPath(lower).suffix
        return dot_ext if dot_ext else None

    def _is_extension_allowed(self, ext: str) -> bool:
        return ext.lower() in ALLOWED_EXTENSIONS

    def _sanitize_filename(self, file_name: str) -> str | None:
        """剥离路径组件，拒绝包含 .. / \\ 的文件名。"""
        # 拒绝路径穿越符号
        if ".." in file_name or "/" in file_name or "\\" in file_name:
            return None
        # 仅保留纯文件名
        clean = PurePosixPath(file_name).name
        if not clean or clean == "." or clean == "..":
            return None
        return clean

    def _classify_file_type(self, ext: str, mime_type: str) -> str:
        """根据扩展名和 MIME 类型分类：image / code / json / pdf / text / other。"""
        if mime_type.startswith("image/"):
            return "image"

        code_exts = {
            ".py", ".js", ".ts", ".jsx", ".tsx",
            ".html", ".css", ".scss", ".xml",
        }
        if ext in code_exts:
            return "code"

        if ext == ".json":
            return "json"

        if ext == ".pdf":
            return "pdf"

        text_exts = {
            ".md", ".txt", ".csv", ".yaml", ".yml",
            ".toml", ".ini", ".cfg", ".env.example", ".gitignore",
        }
        if ext in text_exts or mime_type.startswith("text/"):
            return "text"

        return "other"
