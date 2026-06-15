# 此文件已迁移到 contentforge/agents/material_collection.py
# 保留此文件仅为向后兼容，新代码请使用 contentforge.agents.material_collection
import warnings
warnings.warn(
    "flowforge.agents.material_collection 已迁移到 contentforge.agents.material_collection，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from contentforge.agents.material_collection import MaterialCollectionAgent  # noqa: F401
