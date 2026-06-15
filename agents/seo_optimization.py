# 此文件已迁移到 contentforge/agents/seo_optimization.py
# 保留此文件仅为向后兼容，新代码请使用 contentforge.agents.seo_optimization
import warnings
warnings.warn(
    "flowforge.agents.seo_optimization 已迁移到 contentforge.agents.seo_optimization，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from contentforge.agents.seo_optimization import SEOOptimizationAgent  # noqa: F401
