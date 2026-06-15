# 此文件已迁移到 contentforge/tools/publish.py
# 保留此文件仅为向后兼容，新代码请使用 contentforge.tools.publish
import warnings
warnings.warn(
    "flowforge.tools.publish 已迁移到 contentforge.tools.publish，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from contentforge.tools.publish import PublishTool  # noqa: F401
