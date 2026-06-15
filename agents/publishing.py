# 此文件已迁移到 contentforge/agents/publishing.py
# 保留此文件仅为向后兼容，新代码请使用 contentforge.agents.publishing
import warnings
warnings.warn(
    "flowforge.agents.publishing 已迁移到 contentforge.agents.publishing，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from contentforge.agents.publishing import PublishingAgent  # noqa: F401
