# 此文件已迁移到 contentforge/agents/topic_research.py
# 保留此文件仅为向后兼容，新代码请使用 contentforge.agents.topic_research
import warnings
warnings.warn(
    "flowforge.agents.topic_research 已迁移到 contentforge.agents.topic_research，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from contentforge.agents.topic_research import TopicResearchAgent  # noqa: F401
