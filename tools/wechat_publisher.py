# 此文件已迁移到 contentforge/tools/wechat_publisher.py
# 保留此文件仅为向后兼容，新代码请使用 contentforge.tools.wechat_publisher
import warnings
warnings.warn(
    "flowforge.tools.wechat_publisher 已迁移到 contentforge.tools.wechat_publisher，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from contentforge.tools.wechat_publisher import WeChatPublisherTool  # noqa: F401
