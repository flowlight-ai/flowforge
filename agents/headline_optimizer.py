# 此文件已迁移到 contentforge/agents/headline_optimizer.py
# 保留此文件仅为向后兼容，新代码请使用 contentforge.agents.headline_optimizer
import warnings
warnings.warn(
    "flowforge.agents.headline_optimizer 已迁移到 contentforge.agents.headline_optimizer，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from contentforge.agents.headline_optimizer import HeadlineOptimizerAgent  # noqa: F401
