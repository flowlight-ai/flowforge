# 此文件已迁移到 devforge/agents/code_writer_agent.py
# 保留此文件仅为向后兼容，新代码请使用 devforge.agents.code_writer_agent
import warnings
warnings.warn(
    "flowforge.agents.code_writer_agent 已迁移到 devforge.agents.code_writer_agent，请更新导入路径",
    DeprecationWarning,
    stacklevel=2,
)
from devforge.agents.code_writer_agent import CodeWriterAgent  # noqa: F401
