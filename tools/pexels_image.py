# 此文件已迁移到 contentforge/tools/pexels_image.py
# 保留此文件仅为向后兼容，新代码请使用 contentforge.tools.pexels_image
import warnings
warnings.warn(
    "flowforge.tools.pexels_image 已迁移到 contentforge.tools.pexels_image，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from contentforge.tools.pexels_image import PexelsImageTool  # noqa: F401
