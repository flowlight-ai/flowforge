# 此文件已迁移到 contentforge/agents/content_audit.py
# 保留此文件仅为向后兼容，新代码请使用 contentforge.agents.content_audit
import warnings
warnings.warn(
    "flowforge.agents.content_audit 已迁移到 contentforge.agents.content_audit，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from contentforge.agents.content_audit import ContentAuditAgent  # noqa: F401
