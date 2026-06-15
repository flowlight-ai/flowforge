# 此文件已迁移到 contentforge/agents/article_reflect.py
# 保留此文件仅为向后兼容，新代码请使用 contentforge.agents.article_reflect
import warnings
warnings.warn(
    "flowforge.agents.article_reflect 已迁移到 contentforge.agents.article_reflect，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from contentforge.agents.article_reflect import ArticleReflectAgent  # noqa: F401
