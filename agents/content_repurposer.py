# 此文件已迁移到 contentforge/agents/content_repurposer.py
# 保留此文件仅为向后兼容，新代码请使用 contentforge.agents.content_repurposer
import warnings
warnings.warn(
    "flowforge.agents.content_repurposer 已迁移到 contentforge.agents.content_repurposer，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from contentforge.agents.content_repurposer import ContentRepurposerAgent  # noqa: F401
