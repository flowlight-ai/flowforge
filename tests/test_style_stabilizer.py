"""StyleStabilizer 和 StyleDriftDetector 单元测试.

验证风格稳定器（确定性 seed、风格锚点注入）和风格漂移检测器（漂移分数、告警）。
"""

import pytest

from flowforge.tools.style_stabilizer import (
    DriftReport,
    StyleDriftDetector,
    StyleStabilizer,
)


# ═══════════════════════════════════════════════════════════════════════
# StyleStabilizer 测试
# ═══════════════════════════════════════════════════════════════════════


class TestStyleStabilizer:
    """风格稳定器测试."""

    def test_compute_style_seed_deterministic(self):
        """相同风格配置 → 相同 seed（确定性）."""
        stabilizer = StyleStabilizer()
        profile = {
            "narrative_voice": "third_person",
            "language_register": "formal",
            "pacing_tendency": "medium",
        }
        seed1 = stabilizer.compute_style_seed(profile)
        seed2 = stabilizer.compute_style_seed(profile)
        assert seed1 == seed2

    def test_compute_style_seed_different_profiles(self):
        """不同风格配置 → 不同 seed."""
        stabilizer = StyleStabilizer()
        profile1 = {"narrative_voice": "first_person"}
        profile2 = {"narrative_voice": "third_person"}
        assert stabilizer.compute_style_seed(profile1) != stabilizer.compute_style_seed(
            profile2
        )

    def test_compute_style_seed_is_integer(self):
        """seed 应为整数."""
        stabilizer = StyleStabilizer()
        seed = stabilizer.compute_style_seed({"pacing_tendency": "fast"})
        assert isinstance(seed, int)
        assert seed >= 0

    def test_stabilize_prompt_adds_style_block(self):
        """稳定化后提示词应包含风格约束块."""
        stabilizer = StyleStabilizer()
        prompt = "请写一段小说章节"
        profile = {
            "narrative_voice": "third_person",
            "pacing_tendency": "fast",
        }
        result = stabilizer.stabilize_prompt(prompt, profile)

        assert "[风格约束" in result
        assert "[/风格约束]" in result
        assert "请写一段小说章节" in result
        assert "风格种子" in result

    def test_stabilize_prompt_replaces_existing_block(self):
        """已有风格约束块应被替换."""
        stabilizer = StyleStabilizer()
        prompt = "[风格约束 — 旧]旧约束内容[/风格约束]\n请写一段小说"
        profile = {"narrative_voice": "third_person"}
        result = stabilizer.stabilize_prompt(prompt, profile)

        assert "旧约束内容" not in result
        assert "[风格约束" in result
        assert "[/风格约束]" in result
        assert "请写一段小说" in result

    def test_get_style_anchor_all_dimensions(self):
        """风格锚点应包含全部 8 个维度."""
        stabilizer = StyleStabilizer()
        profile = {
            "narrative_voice": "第三人称",
            "language_register": "正式",
            "description_preference": "细腻",
            "dialogue_style": "balanced",
            "pacing_tendency": "medium",
            "emotional_tone": "沉稳",
            "thematic_depth": "深刻",
            "structural_preference": "线性",
        }
        anchor = stabilizer.get_style_anchor(profile)

        assert "叙事视角" in anchor
        assert "语言风格" in anchor
        assert "描写偏好" in anchor
        assert "对话风格" in anchor
        assert "节奏倾向" in anchor
        assert "情绪基调" in anchor
        assert "主题深度" in anchor
        assert "结构偏好" in anchor

    def test_get_style_anchor_partial_dimensions(self):
        """部分维度时只包含已提供的维度."""
        stabilizer = StyleStabilizer()
        profile = {
            "narrative_voice": "第三人称",
            "pacing_tendency": "medium",
        }
        anchor = stabilizer.get_style_anchor(profile)

        assert "叙事视角" in anchor
        assert "节奏倾向" in anchor
        assert "语言风格" not in anchor

    def test_get_style_anchor_empty_profile(self):
        """空风格配置返回默认锚点."""
        stabilizer = StyleStabilizer()
        anchor = stabilizer.get_style_anchor({})
        assert "保持默认风格" in anchor


# ═══════════════════════════════════════════════════════════════════════
# StyleDriftDetector 测试
# ═══════════════════════════════════════════════════════════════════════


class TestStyleDriftDetector:
    """风格漂移检测器测试."""

    def test_compute_drift_score_empty_text(self):
        """空文本漂移分数为 0."""
        detector = StyleDriftDetector()
        score = detector.compute_drift_score("", {"pacing_tendency": "medium"})
        assert score == 0.0

    def test_compute_drift_score_empty_profile(self):
        """空风格配置漂移分数为 0."""
        detector = StyleDriftDetector()
        score = detector.compute_drift_score("一段文本内容", {})
        assert score == 0.0

    def test_compute_drift_score_in_range(self):
        """漂移分数应在 [0, 1] 范围内."""
        detector = StyleDriftDetector()
        text = "这是一段测试文本。用于验证风格漂移检测功能。"
        profile = {
            "pacing_tendency": "medium",
            "dialogue_style": "balanced",
        }
        score = detector.compute_drift_score(text, profile)
        assert 0.0 <= score <= 1.0

    def test_compute_drift_score_deterministic(self):
        """相同文本和配置 → 相同分数（确定性）."""
        detector = StyleDriftDetector()
        text = "这是一段测试文本。用于验证风格漂移检测功能。"
        profile = {
            "pacing_tendency": "medium",
            "dialogue_style": "balanced",
        }
        score1 = detector.compute_drift_score(text, profile)
        score2 = detector.compute_drift_score(text, profile)
        assert score1 == score2

    def test_compute_drift_score_low_vs_high(self):
        """低漂移文本分数低于高漂移文本."""
        detector = StyleDriftDetector()
        profile = {
            "pacing_tendency": "medium",
            "dialogue_style": "balanced",
        }
        # 空文本 → 0.0（最低漂移）
        low_score = detector.compute_drift_score("", profile)
        # 短文本（句长远低于期望值60）→ 较高漂移
        high_score = detector.compute_drift_score("短。", profile)
        assert low_score < high_score

    def test_detect_drift_multiple_chapters(self):
        """批量检测多章节漂移."""
        detector = StyleDriftDetector()
        chapters = [
            {"chapter_id": "ch1", "text": "第一章的内容。"},
            {"chapter_id": "ch2", "text": "第二章的内容。"},
            {"chapter_id": "ch3", "text": "第三章的内容。"},
        ]
        profile = {
            "pacing_tendency": "medium",
            "dialogue_style": "balanced",
        }

        reports = detector.detect_drift(chapters, profile)

        assert len(reports) == 3
        assert all(isinstance(r, DriftReport) for r in reports)
        assert reports[0].chapter_id == "ch1"
        assert reports[1].chapter_id == "ch2"
        assert reports[2].chapter_id == "ch3"
        for r in reports:
            assert 0.0 <= r.drift_score <= 1.0

    def test_detect_drift_high_drift_has_suggestions(self):
        """高漂移章节应有建议."""
        detector = StyleDriftDetector()
        # 构造高漂移文本（句长极短，偏离期望值60）
        chapters = [
            {"chapter_id": "ch_high", "text": "短。短。短。短。短。"},
        ]
        profile = {
            "pacing_tendency": "medium",
            "dialogue_style": "balanced",
        }

        reports = detector.detect_drift(chapters, profile)
        assert len(reports) == 1
        report = reports[0]
        if report.drift_score > detector.DRIFT_WARNING_THRESHOLD:
            assert len(report.suggestions) > 0
            assert len(report.drifted_dimensions) > 0

    def test_alert_on_drift_above_threshold(self):
        """漂移分数超过阈值时告警."""
        detector = StyleDriftDetector()
        assert detector.alert_on_drift(0.6, threshold=0.3) is True

    def test_alert_on_drift_below_threshold(self):
        """漂移分数低于阈值时不告警."""
        detector = StyleDriftDetector()
        assert detector.alert_on_drift(0.2, threshold=0.3) is False

    def test_alert_on_drift_equal_threshold(self):
        """漂移分数等于阈值时不告警（> 而非 >=）."""
        detector = StyleDriftDetector()
        assert detector.alert_on_drift(0.3, threshold=0.3) is False

    def test_alert_on_drift_default_threshold(self):
        """默认阈值 0.3 的告警逻辑."""
        detector = StyleDriftDetector()
        assert detector.alert_on_drift(0.4) is True
        assert detector.alert_on_drift(0.2) is False
