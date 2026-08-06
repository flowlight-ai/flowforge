"""ContentModerationLayer — 内容安全层

设计文档参考：S3.0-14, spec.md v2.2 内容安全
支持Doubao moderation L5层统一
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from enum import Enum
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ModerationLevel(str, Enum):
    L1_KEYWORD = "l1_keyword"           # 关键词过滤
    L2_REGEX = "l2_regex"               # 正则匹配
    L3_RULE = "l3_rule"                 # 规则引擎
    L4_LLM = "l4_llm"                   # LLM审核
    L5_PLATFORM = "l5_platform"         # 平台API审核（Doubao moderation）


class ModerationResult(BaseModel):
    """审核结果"""
    passed: bool = True
    level: str = ""
    category: str = ""
    severity: str = "none"  # none / low / medium / high / critical
    reason: str = ""
    details: dict[str, Any] = {}
    action: str = "allow"  # allow / warn / block / review


@dataclass
class ModerationRule:
    """审核规则"""
    name: str
    level: ModerationLevel
    category: str  # e.g. "politics", "violence", "porn", "ad", "privacy"
    pattern: str = ""  # 关键词或正则
    action: str = "block"  # allow / warn / block / review
    severity: str = "medium"
    enabled: bool = True


class ContentModerationLayer:
    """内容安全层

    五层审核链：
    L1: 关键词过滤
    L2: 正则匹配
    L3: 规则引擎
    L4: LLM审核
    L5: 平台API审核（Doubao moderation）

    任一层block则整体block，任一层review则需人工审核
    """

    def __init__(
        self,
        rules: list[ModerationRule] | None = None,
        llm_client: Any = None,
        platform_moderation_fn: Any = None,
    ):
        self._rules: list[ModerationRule] = rules or []
        self._llm_client = llm_client
        self._platform_moderation_fn = platform_moderation_fn
        self._default_rules = self._build_default_rules()

    def add_rule(self, rule: ModerationRule) -> None:
        self._rules.append(rule)

    async def moderate(self, content: str, context: dict[str, Any] | None = None) -> ModerationResult:
        """执行五层审核链"""
        if not content:
            return ModerationResult(passed=True, level="none", action="allow")

        # L1: 关键词过滤
        result = self._check_keywords(content)
        if not result.passed:
            return result

        # L2: 正则匹配
        result = self._check_regex(content)
        if not result.passed:
            return result

        # L3: 规则引擎
        result = self._check_rules(content)
        if not result.passed:
            return result

        # L4: LLM审核
        result = await self._check_llm(content)
        if not result.passed:
            return result

        # L5: 平台API审核
        result = await self._check_platform(content)
        if not result.passed:
            return result

        return ModerationResult(passed=True, level="all", action="allow", reason="All checks passed")

    def _check_keywords(self, content: str) -> ModerationResult:
        """L1: 关键词过滤"""
        all_rules = self._default_rules + self._rules
        keyword_rules = [r for r in all_rules if r.level == ModerationLevel.L1_KEYWORD and r.enabled]

        for rule in keyword_rules:
            if rule.pattern and rule.pattern.lower() in content.lower():
                return ModerationResult(
                    passed=rule.action != "block",
                    level="l1_keyword",
                    category=rule.category,
                    severity=rule.severity,
                    reason=f"Keyword match: {rule.name}",
                    action=rule.action,
                )
        return ModerationResult(passed=True, level="l1_keyword", action="allow")

    def _check_regex(self, content: str) -> ModerationResult:
        """L2: 正则匹配"""
        all_rules = self._default_rules + self._rules
        regex_rules = [r for r in all_rules if r.level == ModerationLevel.L2_REGEX and r.enabled]

        for rule in regex_rules:
            try:
                if rule.pattern and re.search(rule.pattern, content, re.IGNORECASE):
                    return ModerationResult(
                        passed=rule.action != "block",
                        level="l2_regex",
                        category=rule.category,
                        severity=rule.severity,
                        reason=f"Regex match: {rule.name}",
                        action=rule.action,
                    )
            except re.error:
                continue
        return ModerationResult(passed=True, level="l2_regex", action="allow")

    def _check_rules(self, content: str) -> ModerationResult:
        """L3: 规则引擎"""
        all_rules = self._default_rules + self._rules
        rule_rules = [r for r in all_rules if r.level == ModerationLevel.L3_RULE and r.enabled]

        # 基本规则：长度检查、特殊字符比例等
        for rule in rule_rules:
            if rule.name == "max_length" and len(content) > int(rule.pattern or "100000"):
                return ModerationResult(passed=False, level="l3_rule", category="format", severity="low", reason="Content too long", action="warn")
            if rule.name == "special_char_ratio":
                special_count = sum(1 for c in content if not c.isalnum() and not c.isspace() and ord(c) < 128)
                ratio = special_count / len(content) if content else 0
                if ratio > 0.5:
                    return ModerationResult(passed=False, level="l3_rule", category="format", severity="low", reason="High special character ratio", action="warn")

        return ModerationResult(passed=True, level="l3_rule", action="allow")

    async def _check_llm(self, content: str) -> ModerationResult:
        """L4: LLM审核"""
        if not self._llm_client:
            return ModerationResult(passed=True, level="l4_llm", action="allow")

        try:
            prompt = (
                "请审核以下内容是否包含违规信息（政治敏感、暴力、色情、广告、隐私泄露等）。"
                "如果内容安全，回复SAFE；如果违规，回复BLOCK:类别:原因。\n\n"
                f"内容：{content[:2000]}"
            )
            response = await self._llm_client.chat(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=200,
            )
            result_text = response.content if hasattr(response, 'content') else str(response)

            if result_text.strip().upper().startswith("BLOCK"):
                parts = result_text.split(":", 2)
                category = parts[1].strip() if len(parts) > 1 else "unknown"
                reason = parts[2].strip() if len(parts) > 2 else "LLM flagged"
                return ModerationResult(
                    passed=False, level="l4_llm", category=category,
                    severity="high", reason=reason, action="block",
                )

            return ModerationResult(passed=True, level="l4_llm", action="allow")
        except Exception as e:
            logger.warning(f"LLM moderation failed: {e}")
            return ModerationResult(passed=True, level="l4_llm", action="allow", reason="LLM check skipped due to error")

    async def _check_platform(self, content: str) -> ModerationResult:
        """L5: 平台API审核（Doubao moderation）"""
        if not self._platform_moderation_fn:
            return ModerationResult(passed=True, level="l5_platform", action="allow")

        try:
            result = await self._platform_moderation_fn(content)
            if isinstance(result, dict):
                passed = result.get("passed", True)
                return ModerationResult(
                    passed=passed,
                    level="l5_platform",
                    category=result.get("category", ""),
                    severity=result.get("severity", "high" if not passed else "none"),
                    reason=result.get("reason", "Platform moderation result"),
                    action=result.get("action", "block" if not passed else "allow"),
                    details=result,
                )
            return ModerationResult(passed=True, level="l5_platform", action="allow")
        except Exception as e:
            logger.warning(f"Platform moderation failed: {e}")
            return ModerationResult(passed=True, level="l5_platform", action="allow", reason="Platform check skipped")

    def _build_default_rules(self) -> list[ModerationRule]:
        """构建默认审核规则"""
        return [
            # L1 关键词
            ModerationRule(name="sensitive_politics", level=ModerationLevel.L1_KEYWORD, category="politics", pattern="", action="review", severity="high"),
            ModerationRule(name="sensitive_violence", level=ModerationLevel.L1_KEYWORD, category="violence", pattern="", action="block", severity="high"),
            ModerationRule(name="sensitive_porn", level=ModerationLevel.L1_KEYWORD, category="porn", pattern="", action="block", severity="critical"),
            # L3 规则
            ModerationRule(name="max_length", level=ModerationLevel.L3_RULE, category="format", pattern="100000", action="warn", severity="low"),
        ]
