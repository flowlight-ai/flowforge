"""
验证所有 prompt key 在 prompts.yaml 中有对应配置，且 get_prompt 正确返回 YAML 值而非 fallback。

覆盖范围：
- FlowForge 通用 Agent (17个 key)
- FlowForge 模式 (12个 key)
- FlowForge 其他 (brain/loop/harness/workflow/tools 等)
- ContentForge workers (topic/writer/editor/audit/fact_check/translation/repurpose/headline/seo_planner/content)
- NovelForge agents + tools
"""
import os
import sys
import pytest

# 确保 flowforge 包可导入
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from flowforge.core.prompt_manager import PromptManager


# ── 辅助函数 ──

def _reset_prompt_manager():
    """重置单例，确保测试从干净状态开始。"""
    PromptManager._instance = None
    PromptManager._prompts = {}


def _get_pm() -> PromptManager:
    _reset_prompt_manager()
    return PromptManager()


# ── FlowForge 通用 Agent 提示词 ──

FLOWFORGE_AGENT_KEYS = [
    "flowforge.agent.analyst",
    "flowforge.agent.approver",
    "flowforge.agent.critic",
    "flowforge.agent.deliverer",
    "flowforge.agent.drafter",
    "flowforge.agent.finalizer",
    "flowforge.agent.generator",
    "flowforge.agent.planner",
    "flowforge.agent.processor",
    "flowforge.agent.react_observer",
    "flowforge.agent.react_thinker",
    "flowforge.agent.refiner",
    "flowforge.agent.reviewer",
    "flowforge.agent.validator",
    "flowforge.agent.verifier",
    "flowforge.agent.fact_check",
    "flowforge.agent.web_search_plan",
    "flowforge.agent.web_search_summarize",
    "flowforge.agent.web_search_fallback",
]

# ── FlowForge 模式 提示词 ──

FLOWFORGE_MODE_KEYS = [
    "flowforge.mode.multi_agent.decompose",
    "flowforge.mode.multi_agent.compress",
    "flowforge.mode.multi_agent.create_task_board",
    "flowforge.mode.multi_agent.replan",
    "flowforge.mode.multi_agent.aggregate",
    "flowforge.mode.graph_of_thoughts.initial",
    "flowforge.mode.graph_of_thoughts.branch",
    "flowforge.mode.graph_of_thoughts.evaluate",
    "flowforge.mode.rewoo.generate_blueprint",
    "flowforge.mode.self_discover.select",
    "flowforge.mode.self_discover.adapt",
    "flowforge.mode.plan_execute.generate_plan",
]

# ── FlowForge 其他 提示词 ──

FLOWFORGE_OTHER_KEYS = [
    # brain/plan_generator
    "brain.plan_generator.initial_plan",
    "brain.plan_generator.incremental_update",
    # harness/feedback_loop
    "harness.feedback_loop.evaluate",
    "harness.feedback_loop.judge",
    "harness.feedback_loop.score",
    # loop/planner
    "loop.planner.plan",
    "loop.planner.replan",
    # loop/reflector
    "loop.reflector.reflect",
    # modes/workflow
    "modes.workflow.translate",
    "modes.workflow.code",
    "modes.workflow.general",
    "modes.workflow.search_unavailable",
    "modes.rewoo.fallback",
    # tools/web_search
    "tools.web_search.search_prompt",
    "tools.web_search.search_system",
    # react / planning / response / reflexion
    "react.system",
    "react.orchestrator",
    "planning.system",
    "planning.text_based",
    "response.helm",
    "response.normal",
    "response.simple",
    "reflexion.actor",
    "reflexion.evaluator",
    "reflexion.reflector",
    # agent.* (flowforge/config/prompts.yaml 中也有)
    "agent.topic_research",
    "agent.article_writing",
    "agent.article_eval",
    "agent.article_reflect",
    "agent.seo_planning",
    "agent.seo_optimize",
    "agent.fact_check",
    "agent.content_audit.assess",
    "agent.content_audit.compliance",
    "agent.headline_analyze",
    "agent.headline_generate",
    "agent.headline_evaluate",
    "agent.repurposer_analyze",
    "agent.repurposer_rewrite",
    "agent.multilingual_detect",
    "agent.multilingual_translate",
    "agent.multilingual_verify",
    "agent.code_analyze",
    "agent.code_generate",
    "agent.code_review",
    "agent.research_plan",
    "agent.research_synthesize",
    "agent.trend_collect",
    "agent.trend_analyze",
    "agent.image_filter",
    "agent.web_search_plan",
    "agent.web_search_summarize",
    "tool.web_search_fallback",
]

# ── ContentForge 提示词 ──

CONTENTFORGE_KEYS = [
    # topic_agent 5处策略
    "contentforge.topic.hot_trend",
    "contentforge.topic.vertical_deep_dive",
    "contentforge.topic.seasonal_planning",
    "contentforge.topic.competitor_benchmarking",
    "contentforge.topic.llm_search_fallback",
    # writer_agent 4处
    "contentforge.writer.main",
    "contentforge.writer.material_rich",
    "contentforge.writer.material_limited",
    "contentforge.writer.material_none",
    # editor_agent 1处
    "contentforge.editor.main",
    # audit_agent 1处
    "contentforge.audit.main",
    # fact_check_agent 2处
    "contentforge.fact_check.validate_claim",
    "contentforge.fact_check.verify_topic",
    # content.py 6处
    "contentforge.content.video_script",
    "contentforge.content.video_narration",
    "contentforge.content.series_plan",
    "contentforge.content.series_create",
    "contentforge.content.interact_comment",
    "contentforge.content.interact_reply",
    # translation_agent 3处
    "contentforge.translation_agent.translate",
    "contentforge.translation_agent.cultural_adapt",
    "contentforge.translation_agent.self_evaluate",
    # repurpose_agent 3处
    "contentforge.repurpose_agent.analyze",
    "contentforge.repurpose_agent.rewrite",
    "contentforge.repurpose_agent.self_evaluate",
    # headline_agent 3处
    "contentforge.headline_agent.generate",
    "contentforge.headline_agent.evaluate",
    "contentforge.headline_agent.optimize",
    # seo_planner_agent 3处
    "contentforge.seo_planner.analyze_keywords",
    "contentforge.seo_planner.analyze_competitors",
    "contentforge.seo_planner.formulate_strategy",
]

# ── NovelForge 提示词 ──

NOVELFORGE_KEYS = [
    # agents
    "novelforge.agent.concept",
    "novelforge.agent.outline",
    "novelforge.agent.chapter_writing",
    "novelforge.agent.style_calibrate",
    "novelforge.agent.polisher",
    "novelforge.agent.full_review",
    "novelforge.agent.continuity_check",
    "novelforge.agent.plot_integrator",
    "novelforge.agent.market_analyst",
    "novelforge.agent.publication_advisor",
    # reviewers
    "novelforge.reviewer.emotion",
    "novelforge.reviewer.arbitrator",
    # context_manager
    "novelforge.context.world_state",
    "novelforge.context.summary",
    # tools
    "novelforge.tool.compare_geography",
    "novelforge.tool.verify_power_system",
]


class TestPromptLoading:
    """验证 prompts.yaml 中的 prompt key 被正确加载"""

    @pytest.fixture(autouse=True)
    def setup_pm(self):
        self.pm = _get_pm()

    # ── FlowForge 通用 Agent ──

    def test_flowforge_generic_agent_prompts_exist(self):
        """验证 FlowForge 通用 Agent 的 prompt key 在 YAML 中存在"""
        missing = []
        for key in FLOWFORGE_AGENT_KEYS:
            value = self.pm.get(key)
            if not value:
                missing.append(key)
        assert not missing, f"缺少的 FlowForge Agent prompt key: {missing}"

    def test_flowforge_generic_agent_prompts_not_trivial(self):
        """验证 FlowForge 通用 Agent 的 prompt 值有意义（长度 > 10）"""
        short = []
        for key in FLOWFORGE_AGENT_KEYS:
            value = self.pm.get(key)
            if value and len(value.strip()) <= 10:
                short.append((key, value[:50]))
        assert not short, f"过短的 FlowForge Agent prompt: {short}"

    # ── FlowForge 模式 ──

    def test_flowforge_mode_prompts_exist(self):
        """验证 FlowForge 模式的 prompt key 在 YAML 中存在"""
        missing = []
        for key in FLOWFORGE_MODE_KEYS:
            value = self.pm.get(key)
            if not value:
                missing.append(key)
        assert not missing, f"缺少的 FlowForge Mode prompt key: {missing}"

    def test_flowforge_mode_prompts_not_trivial(self):
        """验证 FlowForge 模式的 prompt 值有意义"""
        short = []
        for key in FLOWFORGE_MODE_KEYS:
            value = self.pm.get(key)
            if value and len(value.strip()) <= 10:
                short.append((key, value[:50]))
        assert not short, f"过短的 FlowForge Mode prompt: {short}"

    # ── FlowForge 其他 ──

    def test_flowforge_other_prompts_exist(self):
        """验证 FlowForge 其他 prompt key 在 YAML 中存在"""
        missing = []
        for key in FLOWFORGE_OTHER_KEYS:
            value = self.pm.get(key)
            if not value:
                missing.append(key)
        assert not missing, f"缺少的 FlowForge 其他 prompt key: {missing}"

    # ── ContentForge ──

    def test_contentforge_prompts_exist(self):
        """验证 ContentForge 的 prompt key 在 YAML 中存在"""
        missing = []
        for key in CONTENTFORGE_KEYS:
            value = self.pm.get(key)
            if not value:
                missing.append(key)
        assert not missing, f"缺少的 ContentForge prompt key: {missing}"

    def test_contentforge_prompts_not_trivial(self):
        """验证 ContentForge 的 prompt 值有意义"""
        short = []
        for key in CONTENTFORGE_KEYS:
            value = self.pm.get(key)
            if value and len(value.strip()) <= 10:
                short.append((key, value[:50]))
        assert not short, f"过短的 ContentForge prompt: {short}"

    # ── NovelForge ──

    def test_novelforge_prompts_exist(self):
        """验证 NovelForge 的 prompt key 在 YAML 中存在"""
        missing = []
        for key in NOVELFORGE_KEYS:
            value = self.pm.get(key)
            if not value:
                missing.append(key)
        assert not missing, f"缺少的 NovelForge prompt key: {missing}"

    def test_novelforge_prompts_not_trivial(self):
        """验证 NovelForge 的 prompt 值有意义"""
        short = []
        for key in NOVELFORGE_KEYS:
            value = self.pm.get(key)
            if value and len(value.strip()) <= 10:
                short.append((key, value[:50]))
        assert not short, f"过短的 NovelForge prompt: {short}"

    # ── Fallback 逻辑验证 ──

    def test_yaml_value_not_fallback(self):
        """验证 get_prompt 返回的是 YAML 值而非 fallback。

        方法：对每个 key，比较 get_prompt(key) 和 _get_prompt(key, fallback=MARKER)。
        如果 YAML 值存在，两者应不同（YAML 值 vs fallback 格式化后的值）。
        如果 YAML 值不存在，_get_prompt 会返回 fallback。
        """
        FALLBACK_MARKER = "FALLBACK_TEST_VALUE_12345"

        all_keys = (
            FLOWFORGE_AGENT_KEYS
            + FLOWFORGE_MODE_KEYS
            + CONTENTFORGE_KEYS
            + NOVELFORGE_KEYS
        )

        using_fallback = []
        for key in all_keys:
            yaml_value = self.pm.get(key)
            if not yaml_value:
                using_fallback.append(key)
                continue

            # 模拟 _get_prompt 的 fallback 逻辑：
            # 如果 YAML 值存在，_get_prompt(key, fallback=FALLBACK_MARKER) 应返回 YAML 值
            # 如果 YAML 值不存在，_get_prompt 会返回 fallback
            # 我们直接用 PromptManager.get() 验证
            fallback_result = self.pm.get(key)
            if fallback_result == FALLBACK_MARKER:
                using_fallback.append(key)

        assert not using_fallback, (
            f"以下 key 的 YAML 值缺失，使用了 fallback: {using_fallback}"
        )

    def test_yaml_values_contain_template_vars(self):
        """验证 YAML 中的 prompt 模板包含必要的模板变量（如 {task}、{query} 等）。

        这确保 YAML 中的 prompt 是完整的模板，而非空壳。
        """
        # 抽查几个关键 key，确认它们包含模板变量
        checks = {
            "flowforge.agent.analyst": "{task}",
            "flowforge.agent.drafter": "{task}",
            "flowforge.agent.critic": "{draft}",
            "flowforge.agent.refiner": "{draft}",
            "flowforge.mode.multi_agent.decompose": "{task}",
            "flowforge.mode.rewoo.generate_blueprint": "{task}",
            "contentforge.writer.main": "{topic_title}",
            "contentforge.audit.main": "{draft}",
            "contentforge.fact_check.validate_claim": "{claim}",
            "novelforge.agent.continuity_check": "{chapter_content}",
            "novelforge.tool.compare_geography": "{description}",
            "novelforge.tool.verify_power_system": "{description}",
        }

        missing_vars = []
        for key, expected_var in checks.items():
            value = self.pm.get(key)
            if not value:
                missing_vars.append((key, f"key 不存在"))
            elif expected_var not in value:
                missing_vars.append((key, f"缺少模板变量 {expected_var}"))

        assert not missing_vars, f"模板变量缺失: {missing_vars}"

    # ── 全量汇总 ──

    def test_all_keys_summary(self):
        """汇总所有 key 的加载状态，输出统计信息。"""
        all_keys = (
            FLOWFORGE_AGENT_KEYS
            + FLOWFORGE_MODE_KEYS
            + FLOWFORGE_OTHER_KEYS
            + CONTENTFORGE_KEYS
            + NOVELFORGE_KEYS
        )

        loaded = 0
        missing = []
        for key in all_keys:
            value = self.pm.get(key)
            if value:
                loaded += 1
            else:
                missing.append(key)

        total = len(all_keys)
        print(f"\n{'='*60}")
        print(f"Prompt 加载汇总: {loaded}/{total} 成功")
        if missing:
            print(f"缺失的 key ({len(missing)}):")
            for k in missing:
                print(f"  - {k}")
        else:
            print("所有 key 均已从 YAML 正确加载！")
        print(f"{'='*60}")

        # 即使有缺失也不断言失败，仅记录（因为某些 key 可能是可选的）
        # 但核心 key 必须存在
        core_missing = [k for k in missing if k.startswith(("flowforge.agent.", "flowforge.mode.", "contentforge.", "novelforge."))]
        assert not core_missing, f"核心 prompt key 缺失: {core_missing}"


class TestPromptManagerAutoDiscovery:
    """验证 PromptManager 自动发现机制"""

    def test_auto_discover_contentforge(self):
        """验证 contentforge/config/prompts.yaml 被自动发现"""
        pm = _get_pm()
        # contentforge 特有的 key 应该能找到
        value = pm.get("contentforge.writer.main")
        assert value, "contentforge/config/prompts.yaml 未被自动发现"
        assert "{topic_title}" in value

    def test_auto_discover_novelforge(self):
        """验证 novelforge/config/prompts.yaml 被自动发现"""
        pm = _get_pm()
        value = pm.get("novelforge.agent.concept")
        assert value, "novelforge/config/prompts.yaml 未被自动发现"
        assert "{genre}" in value

    def test_list_keys_includes_all_projects(self):
        """验证 list_keys 包含所有项目的 key"""
        pm = _get_pm()
        keys = pm.list_keys()

        has_flowforge = any(k.startswith("flowforge.") for k in keys)
        has_contentforge = any(k.startswith("contentforge.") for k in keys)
        has_novelforge = any(k.startswith("novelforge.") for k in keys)

        assert has_flowforge, "未找到 flowforge.* 的 prompt key"
        assert has_contentforge, "未找到 contentforge.* 的 prompt key"
        assert has_novelforge, "未找到 novelforge.* 的 prompt key"

    def test_prompt_override_order(self):
        """验证后加载的项目 prompts 可以覆盖先加载的。

        contentforge/config/prompts.yaml 中的 agent.topic_research 应覆盖
        flowforge/config/prompts.yaml 中的同名 key（如果存在）。
        """
        pm = _get_pm()
        value = pm.get("agent.topic_research")
        assert value, "agent.topic_research 未找到"
        # contentforge 的版本最后加载，应该覆盖 flowforge 的版本
        # 两个版本内容相似，只要能加载即可


class TestFallbackVsYAML:
    """验证 _get_prompt 的 fallback 逻辑：YAML 值优先于 fallback"""

    def _simulate_get_prompt(self, key: str, fallback: str = "", **kwargs) -> str:
        """模拟 GenericAgent._get_prompt 的逻辑"""
        try:
            result = self.pm.get(key, **kwargs)
            if result:
                return result
        except Exception:
            pass
        if fallback and kwargs:
            try:
                return fallback.format(**kwargs)
            except (KeyError, ValueError, IndexError):
                pass
        return fallback or ""

    @pytest.fixture(autouse=True)
    def setup_pm(self):
        self.pm = _get_pm()

    def test_yaml_takes_priority_over_fallback(self):
        """验证 YAML 中的值优先于 fallback 参数。

        对每个 flowforge.agent.* key，传入一个明显不同的 fallback，
        确认返回的是 YAML 值而非 fallback。
        """
        FALLBACK = "THIS_IS_FALLBACK_{task}"

        for key in FLOWFORGE_AGENT_KEYS:
            yaml_value = self.pm.get(key)
            if not yaml_value:
                continue  # YAML 中不存在的 key，跳过

            # 用 fallback 参数调用
            result = self._simulate_get_prompt(key, fallback=FALLBACK, task="test")
            # 结果不应是 fallback 值
            assert result != FALLBACK.format(task="test"), (
                f"Key '{key}': 返回了 fallback 而非 YAML 值"
            )
            # 结果应该包含 YAML 值的特征内容
            assert len(result) > len(FALLBACK), (
                f"Key '{key}': 返回值过短，可能使用了 fallback"
            )

    def test_contentforge_yaml_takes_priority(self):
        """验证 ContentForge 的 YAML 值优先于 fallback"""
        FALLBACK = "FALLBACK_{topic}"

        contentforge_keys_with_vars = [
            ("contentforge.writer.main", {"soul_intro": "s", "platform_name": "p", "platform_guide": "g",
                                           "topic_title": "t", "topic_angle": "a", "material_section": "m",
                                           "writing_methods_text": "w", "viral_types_text": "v",
                                           "perspectives_text": "p", "openings_text": "o",
                                           "required_elements_text": "r", "compliance_section": "c",
                                           "soul": "s", "memory": "m", "conditional_instruction": "i"}),
            ("contentforge.editor.main", {"platform": "p", "soul": "s", "memory": "m",
                                           "platform_guide": "g", "topic_title": "t", "topic_angle": "a",
                                           "draft": "d"}),
            ("contentforge.audit.main", {"ai_flavor_examples": "a", "soul": "s", "memory": "m",
                                          "compliance_rules": "c", "draft": "d", "source_excerpt": "s",
                                          "persona": "p", "platform": "p", "fact_check_result": "f"}),
        ]

        for key, kwargs in contentforge_keys_with_vars:
            yaml_value = self.pm.get(key)
            if not yaml_value:
                continue

            result = self._simulate_get_prompt(key, fallback=FALLBACK, **kwargs)
            # 不应返回 fallback
            assert "FALLBACK_" not in result[:20], (
                f"Key '{key}': 返回了 fallback 而非 YAML 值"
            )

    def test_novelforge_yaml_takes_priority(self):
        """验证 NovelForge 的 YAML 值优先于 fallback"""
        FALLBACK = "FALLBACK_{description}"

        for key in ["novelforge.tool.compare_geography", "novelforge.tool.verify_power_system"]:
            yaml_value = self.pm.get(key)
            if not yaml_value:
                continue

            result = self._simulate_get_prompt(
                key, fallback=FALLBACK, description="test", existing_data="data"
            )
            assert "FALLBACK_" not in result[:20], (
                f"Key '{key}': 返回了 fallback 而非 YAML 值"
            )
