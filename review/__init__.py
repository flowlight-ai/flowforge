"""跨模型评审引擎模块 — FlowForge 跨模型代码评审机制。

核心能力：
1. 跨模型评审：Claude 写代码，GPT 审查；GPT 写代码，Claude 审查
2. 同一个体不能 review 自己的代码（铁律）
3. 跨 family 优先（如 DeepSeek 写的代码用 GLM 审查）
4. 每个发现必须有明确严重性：P1（阻断）/ P2（应修）/ P3（可选）
5. 禁止表演性同意（receive-review 的核心规则）
6. Review 请求必须附原始需求摘录
7. Review 五件套 + 证据

模块结构：
- models.py: Pydantic 数据模型
- pairing.py: Reviewer 配对规则
- protocol.py: Review 协议（五件套 + 证据）
- engine.py: ReviewEngine 评审引擎
"""

from flowforge.review.engine import ReviewEngine
from flowforge.review.models import (
    ReviewerInfo,
    ReviewFinding,
    ReviewProvenance,
    ReviewRequest,
    ReviewResponse,
    SeverityLevel,
)
from flowforge.review.pairing import ReviewerPairing
from flowforge.review.protocol import ReviewProtocol

__all__ = [
    # 数据模型
    "SeverityLevel",
    "ReviewFinding",
    "ReviewRequest",
    "ReviewResponse",
    "ReviewerInfo",
    "ReviewProvenance",
    # 配对
    "ReviewerPairing",
    # 协议
    "ReviewProtocol",
    # 引擎
    "ReviewEngine",
]
