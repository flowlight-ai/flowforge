# 此文件已迁移到 contentforge/tools/image_download.py
# 保留此文件仅为向后兼容，新代码请使用 contentforge.tools.image_download
import warnings
warnings.warn(
    "flowforge.tools.image_download 已迁移到 contentforge.tools.image_download，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from contentforge.tools.image_download import ImageDownloadTool  # noqa: F401
