"""Doubao Moderation内容安全层 — L5层统一安全检查.

五层安全体系:
- L1 输入净化: 基础输入清洗和格式校验
- L2 权限检查: 操作权限验证
- L3 架构约束: 层级依赖校验
- L4 工具沙箱: 工具执行隔离
- L5 内容审核: 发布前内容安全检查（本模块）

本模块实现L5内容审核，检查敏感词、隐私泄露、合规性三类风险。
"""

import re
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from flowforge.core.tracing import get_logger

logger = get_logger("security.moderation")


class ModerationLevel(str, Enum):
    """审核层级."""

    L1_INPUT_SANITIZATION = "L1"
    L2_PERMISSION_CHECK = "L2"
    L3_ARCHITECTURE_CONSTRAINT = "L3"
    L4_TOOL_SANDBOX = "L4"
    L5_CONTENT_MODERATION = "L5"


class ModerationResult(BaseModel):
    """审核结果."""

    safe: bool = True
    level: ModerationLevel = ModerationLevel.L5_CONTENT_MODERATION
    risk_tags: List[str] = []
    reason: str = ""
    confidence: float = 1.0


class ContentModerationChecker:
    """内容安全审核 — 发布前必经检查.

    检查维度:
    1. sensitive_words: 敏感词检测（政治/暴力/色情/诈骗等）
    2. privacy: 隐私泄露检测（手机号/身份证号/银行卡号）
    3. compliance: 合规性检测（虚假宣传等）

    用法:
        checker = ContentModerationChecker()
        result = await checker.check("待审核内容")
        if not result.safe:
            # 阻止发布或标记审核
    """

    # 敏感词分类（实际部署时应从配置文件加载）
    SENSITIVE_CATEGORIES: Dict[str, List[str]] = {
        "political": ["敏感词1", "敏感词2"],
        "violence": ["暴力", "凶杀"],
        "adult": ["色情", "裸体"],
        "fraud": ["诈骗", "传销"],
        "privacy": ["身份证号", "银行卡号"],
    }

    # 虚假宣传关键词
    FALSE_ADVERTISING_WORDS = ["100%有效", "绝对治愈", "包治百病"]

    async def check(
        self,
        content: str,
        check_types: Optional[List[str]] = None,
    ) -> ModerationResult:
        """执行内容安全检查.

        Args:
            content: 待审核的文本内容
            check_types: 检查类型列表，默认全部检查
                - "sensitive_words": 敏感词检测
                - "privacy": 隐私泄露检测
                - "compliance": 合规性检测

        Returns:
            ModerationResult 审核结果
        """
        types = check_types or ["sensitive_words", "privacy", "compliance"]
        risk_tags: List[str] = []

        if "sensitive_words" in types:
            tags = self._check_sensitive_words(content)
            risk_tags.extend(tags)

        if "privacy" in types:
            tags = self._check_privacy_leak(content)
            risk_tags.extend(tags)

        if "compliance" in types:
            tags = self._check_compliance(content)
            risk_tags.extend(tags)

        safe = len(risk_tags) == 0
        result = ModerationResult(
            safe=safe,
            risk_tags=risk_tags,
            reason="; ".join(risk_tags) if risk_tags else "内容安全检查通过",
            confidence=0.95 if safe else 0.85,
        )

        if not safe:
            logger.info(
                f"内容审核未通过: risk_tags={risk_tags}, "
                f"内容预览={content[:100]}"
            )

        return result

    def _check_sensitive_words(self, content: str) -> List[str]:
        """敏感词检查."""
        tags: List[str] = []
        for category, words in self.SENSITIVE_CATEGORIES.items():
            for word in words:
                if word in content:
                    tags.append(f"sensitive:{category}")
                    break  # 每个分类只标记一次
        return tags

    def _check_privacy_leak(self, content: str) -> List[str]:
        """隐私泄露检查."""
        tags: List[str] = []
        # 手机号
        if re.search(r"1[3-9]\d{9}", content):
            tags.append("privacy:phone_number")
        # 身份证号
        if re.search(r"\d{17}[\dXx]", content):
            tags.append("privacy:id_number")
        # 银行卡号（16-19位连续数字）
        if re.search(r"\d{16,19}", content):
            tags.append("privacy:bank_card")
        return tags

    def _check_compliance(self, content: str) -> List[str]:
        """合规性检查."""
        tags: List[str] = []
        # 检查虚假宣传
        if any(w in content for w in self.FALSE_ADVERTISING_WORDS):
            tags.append("compliance:false_advertising")
        return tags

    def add_sensitive_words(self, category: str, words: List[str]):
        """动态添加敏感词.

        Args:
            category: 敏感词分类
            words: 敏感词列表
        """
        if category not in self.SENSITIVE_CATEGORIES:
            self.SENSITIVE_CATEGORIES[category] = []
        self.SENSITIVE_CATEGORIES[category].extend(words)
        logger.info(f"添加敏感词: category={category}, count={len(words)}")

    def get_status(self) -> dict:
        """获取审核器状态."""
        return {
            "level": ModerationLevel.L5_CONTENT_MODERATION.value,
            "categories": list(self.SENSITIVE_CATEGORIES.keys()),
            "category_word_counts": {
                cat: len(words) for cat, words in self.SENSITIVE_CATEGORIES.items()
            },
        }
