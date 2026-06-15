# 此文件已迁移到 contentforge/tools/pexels_search.py
# 保留此文件仅为向后兼容，新代码请使用 contentforge.tools.pexels_search
import warnings
warnings.warn(
    "flowforge.tools.pexels_search 已迁移到 contentforge.tools.pexels_search，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from contentforge.tools.pexels_search import PexelsSearchTool  # noqa: F401
