"""风格稳定器与漂移检测器 — 确保长文本生成风格一致性.

提供两项核心能力：
- StyleStabilizer: 通过确定性 seed 和风格锚点稳定生成风格
- StyleDriftDetector: 检测章节间的风格漂移并告警
"""

import hashlib
from dataclasses import dataclass, field
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("tools.style_stabilizer")


@dataclass
class DriftReport:
    """风格漂移报告."""

    chapter_id: str
    drift_score: float  # 0.0 ~ 1.0
    drifted_dimensions: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)


class StyleStabilizer:
    """风格稳定器 — 通过确定性 seed 和风格约束确保生成一致性.

    核心原理：
    1. 从风格配置计算确定性 seed（相同配置 → 相同 seed）
    2. 将风格锚点注入提示词，约束 LLM 输出风格
    3. 锚点短语作为风格参照，保持跨章节一致性
    """

    def compute_style_seed(self, style_profile: dict[str, Any]) -> int:
        """从风格配置计算确定性 seed.

        Args:
            style_profile: 风格配置（8 维度）

        Returns:
            确定性 seed 整数
        """
        # 将风格配置序列化为稳定字符串
        profile_str = "|".join(
            f"{k}={v}" for k, v in sorted(style_profile.items())
        )
        hash_hex = hashlib.sha256(profile_str.encode("utf-8")).hexdigest()
        seed = int(hash_hex[:8], 16)
        logger.debug(
            f"compute_style_seed: profile_hash={hash_hex[:16]}... seed={seed} "
            f"dim_count={len(style_profile)}"
        )
        return seed

    def stabilize_prompt(
        self, prompt: str, style_profile: dict[str, Any]
    ) -> str:
        """将风格约束注入提示词.

        Args:
            prompt: 原始提示词
            style_profile: 风格配置

        Returns:
            注入了风格约束的提示词
        """
        anchor = self.get_style_anchor(style_profile)
        seed = self.compute_style_seed(style_profile)

        style_block = f"""
[风格约束 — 必须严格遵守]
风格种子: {seed}
{anchor}
[/风格约束]
"""
        # 在 system prompt 后面插入风格约束
        if "[风格约束" in prompt:
            # 替换已有的风格约束块
            import re

            logger.debug(
                f"stabilize_prompt: mode=replace anchor_len={len(anchor)} "
                f"seed={seed} prompt_len_before={len(prompt)}"
            )
            prompt = re.sub(
                r"\[风格约束.*?\[/风格约束\]",
                style_block.strip(),
                prompt,
                flags=re.DOTALL,
            )
        else:
            logger.debug(
                f"stabilize_prompt: mode=append anchor_len={len(anchor)} "
                f"seed={seed} prompt_len_before={len(prompt)}"
            )
            prompt = prompt + "\n" + style_block

        logger.debug(
            f"stabilize_prompt: done prompt_len_after={len(prompt)}"
        )
        return prompt

    def get_style_anchor(self, style_profile: dict[str, Any]) -> str:
        """提取风格锚点短语 — 用于风格一致性参照.

        Args:
            style_profile: 风格配置

        Returns:
            风格锚点文本
        """
        anchors = []

        # 8 维度锚点
        dimension_labels = {
            "narrative_voice": "叙事视角",
            "language_register": "语言风格",
            "description_preference": "描写偏好",
            "dialogue_style": "对话风格",
            "pacing_tendency": "节奏倾向",
            "emotional_tone": "情绪基调",
            "thematic_depth": "主题深度",
            "structural_preference": "结构偏好",
        }

        for key, label in dimension_labels.items():
            value = style_profile.get(key, "")
            if value:
                anchors.append(f"- {label}: {value}")

        result = "\n".join(anchors) if anchors else "- 保持默认风格"
        logger.debug(
            f"get_style_anchor: dimension_count={len(anchors)} "
            f"anchor_len={len(result)} used_default={not bool(anchors)}"
        )
        return result


class StyleDriftDetector:
    """风格漂移检测器 — 检测章节间的风格偏移.

    核心原理：
    1. 提取每章的风格特征（句长分布、标点频率、词汇丰富度等）
    2. 与基准风格配置对比，计算漂移分数
    3. 分数超过阈值时告警
    """

    # 漂移阈值
    DRIFT_WARNING_THRESHOLD = 0.3
    DRIFT_CRITICAL_THRESHOLD = 0.5

    def compute_drift_score(
        self, chapter_text: str, style_profile: dict[str, Any]
    ) -> float:
        """计算单章风格漂移分数.

        Args:
            chapter_text: 章节文本
            style_profile: 基准风格配置

        Returns:
            漂移分数 0.0 ~ 1.0（0 = 完全一致，1 = 完全漂移）
        """
        if not chapter_text or not style_profile:
            logger.debug(
                f"compute_drift_score: early_return score=0.0 "
                f"reason=empty_input text_empty={not chapter_text} "
                f"profile_empty={not style_profile}"
            )
            return 0.0

        features = self._extract_style_features(chapter_text)
        drifts = []

        # 1. 句长分布漂移
        avg_sentence_len = features["avg_sentence_length"]
        expected_len = self._get_expected_sentence_length(style_profile)
        if expected_len > 0:
            len_drift = abs(avg_sentence_len - expected_len) / max(expected_len, 1)
            drifts.append(min(len_drift, 1.0))
            logger.debug(
                f"compute_drift_score: dim=sentence_length "
                f"actual={avg_sentence_len:.2f} expected={expected_len} "
                f"drift={min(len_drift, 1.0):.4f}"
            )

        # 2. 标点频率漂移
        punct_ratio = features["dialogue_ratio"]
        expected_dialogue = self._get_expected_dialogue_ratio(style_profile)
        dialogue_drift = abs(punct_ratio - expected_dialogue)
        drifts.append(min(dialogue_drift, 1.0))
        logger.debug(
            f"compute_drift_score: dim=dialogue_ratio "
            f"actual={punct_ratio:.4f} expected={expected_dialogue} "
            f"drift={min(dialogue_drift, 1.0):.4f}"
        )

        # 3. 词汇丰富度漂移
        ttr = features["type_token_ratio"]
        expected_ttr = 0.6  # 默认期望
        ttr_drift = abs(ttr - expected_ttr)
        drifts.append(min(ttr_drift, 1.0))
        logger.debug(
            f"compute_drift_score: dim=type_token_ratio "
            f"actual={ttr:.4f} expected={expected_ttr} "
            f"drift={min(ttr_drift, 1.0):.4f}"
        )

        # 4. 段落长度漂移
        avg_para_len = features["avg_paragraph_length"]
        expected_para = 100  # 默认期望
        para_drift = abs(avg_para_len - expected_para) / max(expected_para, 1)
        drifts.append(min(para_drift, 1.0))
        logger.debug(
            f"compute_drift_score: dim=paragraph_length "
            f"actual={avg_para_len:.2f} expected={expected_para} "
            f"drift={min(para_drift, 1.0):.4f}"
        )

        final_score = sum(drifts) / len(drifts) if drifts else 0.0
        logger.debug(
            f"compute_drift_score: final score={final_score:.4f} "
            f"dim_count={len(drifts)}"
        )
        return final_score

    def detect_drift(
        self,
        chapters: list[dict[str, str]],
        style_profile: dict[str, Any],
    ) -> list[DriftReport]:
        """批量检测多章节的风格漂移.

        Args:
            chapters: [{chapter_id, text}, ...]
            style_profile: 基准风格配置

        Returns:
            漂移报告列表
        """
        logger.debug(
            f"detect_drift: enter chapter_count={len(chapters)} "
            f"warning_threshold={self.DRIFT_WARNING_THRESHOLD} "
            f"critical_threshold={self.DRIFT_CRITICAL_THRESHOLD}"
        )
        reports = []
        drifted_count = 0
        for chapter in chapters:
            chapter_id = chapter.get("chapter_id", "")
            text = chapter.get("text", "")
            score = self.compute_drift_score(text, style_profile)

            drifted_dims = []
            suggestions = []

            if score > self.DRIFT_WARNING_THRESHOLD:
                drifted_dims.append("overall")
                drifted_count += 1
                if score > self.DRIFT_CRITICAL_THRESHOLD:
                    suggestions.append(
                        f"章节 {chapter_id} 风格漂移严重（{score:.2f}），"
                        f"建议重新生成或手动调整风格"
                    )
                else:
                    suggestions.append(
                        f"章节 {chapter_id} 风格有漂移（{score:.2f}），"
                        f"建议检查并微调"
                    )

            reports.append(
                DriftReport(
                    chapter_id=chapter_id,
                    drift_score=score,
                    drifted_dimensions=drifted_dims,
                    suggestions=suggestions,
                )
            )

        logger.info(
            f"detect_drift: done chapter_count={len(chapters)} "
            f"reports_with_drift={drifted_count}"
        )
        return reports

    def alert_on_drift(self, score: float, threshold: float = 0.3) -> bool:
        """检查是否需要告警.

        Args:
            score: 漂移分数
            threshold: 告警阈值

        Returns:
            是否需要告警
        """
        logger.debug(
            f"alert_on_drift: enter score={score:.4f} threshold={threshold}"
        )
        if score > threshold:
            logger.warning(
                f"StyleDriftDetector: 风格漂移告警 score={score:.2f} threshold={threshold}"
            )
            logger.debug(
                f"alert_on_drift: decision=alert score={score:.4f} "
                f"exceeds_threshold_by={score - threshold:.4f}"
            )
            return True
        logger.debug(
            f"alert_on_drift: decision=no_alert score={score:.4f} "
            f"margin_below_threshold={threshold - score:.4f}"
        )
        return False

    def _extract_style_features(self, text: str) -> dict[str, float]:
        """提取文本风格特征."""
        import re

        sentences = re.split(r"[。！？.!?]", text)
        sentences = [s.strip() for s in sentences if s.strip()]

        paragraphs = text.split("\n")
        paragraphs = [p.strip() for p in paragraphs if p.strip()]

        # 句长
        avg_sentence_length = (
            sum(len(s) for s in sentences) / len(sentences) if sentences else 0
        )

        # 对话比例（引号内文本占比）
        dialogue_matches = re.findall(r'[""「」『』].*?[""」』]', text)
        dialogue_chars = sum(len(d) for d in dialogue_matches)
        dialogue_ratio = dialogue_chars / len(text) if text else 0

        # 词汇丰富度 (Type-Token Ratio)
        words = list(text)
        ttr = len(set(words)) / len(words) if words else 0

        # 段落长度
        avg_paragraph_length = (
            sum(len(p) for p in paragraphs) / len(paragraphs) if paragraphs else 0
        )

        return {
            "avg_sentence_length": avg_sentence_length,
            "dialogue_ratio": dialogue_ratio,
            "type_token_ratio": ttr,
            "avg_paragraph_length": avg_paragraph_length,
        }

    def _get_expected_sentence_length(self, style_profile: dict[str, Any]) -> float:
        """根据风格配置获取期望句长."""
        pacing = style_profile.get("pacing_tendency", "medium")
        return {"fast": 30, "medium": 60, "slow": 100}.get(pacing, 60)

    def _get_expected_dialogue_ratio(self, style_profile: dict[str, Any]) -> float:
        """根据风格配置获取期望对话比例."""
        dialogue_style = style_profile.get("dialogue_style", "balanced")
        return {
            "minimal": 0.05,
            "balanced": 0.2,
            "heavy": 0.4,
        }.get(dialogue_style, 0.2)
