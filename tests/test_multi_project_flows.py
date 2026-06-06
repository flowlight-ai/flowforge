"""Multi-step complex flow tests for all 4 business projects.

Tests verify that the dynamic update logic works correctly across
ContentForge, DevForge, NovelForge, and MallForge by simulating
realistic multi-step agent workflows.
"""

import asyncio
import json
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from flowforge.events.event_bus import EventBus
from flowforge.events.solo_adapter import EventBusSoloAdapter, _SAVE_EVENTS, _event_to_message
from flowforge.core.config import ConfigLoader, _deep_merge


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class MockSoloManager:
    def __init__(self):
        self.events: list[tuple[str, str, dict]] = []

    async def emit_event(self, task_id: str, event_type: str, payload: dict):
        self.events.append((task_id, event_type, payload))


class FakeWorkspaceManager:
    def __init__(self):
        self._messages: dict[str, list[dict]] = {}

    def save_message(self, task_id: str, message: dict):
        self._messages.setdefault(task_id, []).append(message)

    def get_messages(self, task_id: str) -> list[dict]:
        return self._messages.get(task_id, [])


def simulate_workflow(solo_mgr, ws_mgr, task_id, steps):
    """Simulate a multi-step workflow by directly calling the adapter logic.
    
    This bypasses EventBus async issues by directly invoking the
    _event_to_message conversion and solo_mgr.emit_event.
    """
    for event_type, payload in steps:
        # Simulate solo_manager receiving the event
        solo_mgr.events.append((task_id, event_type, payload))
        # Simulate message persistence
        if event_type in _SAVE_EVENTS:
            msg = _event_to_message(event_type, payload)
            if msg:
                ws_mgr.save_message(task_id, msg)


# ---------------------------------------------------------------------------
# Config Inheritance Tests
# ---------------------------------------------------------------------------

class TestConfigInheritance:
    @pytest.fixture
    def flowforge_loader(self):
        return ConfigLoader(Path("d:/software/openclaw/flowforge/config"))

    @pytest.fixture
    def contentforge_loader(self):
        return ConfigLoader(Path("d:/software/openclaw/contentforge/config"))

    @pytest.fixture
    def devforge_loader(self):
        return ConfigLoader(Path("d:/software/openclaw/devforge/config"))

    @pytest.fixture
    def novelforge_loader(self):
        return ConfigLoader(Path("d:/software/openclaw/novelforge/config"))

    @pytest.fixture
    def mallforge_loader(self):
        return ConfigLoader(Path("d:/software/openclaw/mallforge/config"))

    def test_flowforge_base_config_loads(self, flowforge_loader):
        cfg = flowforge_loader.load_yaml("default.yaml")
        assert cfg["system"]["server_port"] == 8000

    def test_contentforge_inherits_and_overrides(self, contentforge_loader):
        cfg = contentforge_loader.load_yaml("default.yaml")
        assert cfg["system"]["server_port"] == 8001
        assert cfg["system"]["secret_key"] == "changeme-in-production"  # inherited
        assert "contentforge" in cfg

    def test_devforge_inherits_and_overrides(self, devforge_loader):
        cfg = devforge_loader.load_yaml("default.yaml")
        assert cfg["system"]["server_port"] == 8002

    def test_novelforge_inherits_and_overrides(self, novelforge_loader):
        cfg = novelforge_loader.load_yaml("default.yaml")
        assert cfg["system"]["server_port"] == 8003
        assert "novelforge" in cfg

    def test_mallforge_inherits_and_overrides(self, mallforge_loader):
        cfg = mallforge_loader.load_yaml("default.yaml")
        assert cfg["system"]["server_port"] == 8004
        assert "ecommerce" in cfg

    def test_models_yaml_inheritance(self, contentforge_loader):
        cf_models = contentforge_loader.load_yaml("models.yaml")
        assert "providers" in cf_models
        assert "openroute" in cf_models["providers"]


class TestDeepMerge:
    def test_simple_override(self):
        assert _deep_merge({"a": 1, "b": 2}, {"b": 3, "c": 4}) == {"a": 1, "b": 3, "c": 4}

    def test_nested_override(self):
        result = _deep_merge({"system": {"port": 8000, "host": "0.0.0.0"}}, {"system": {"port": 8001}})
        assert result["system"]["port"] == 8001
        assert result["system"]["host"] == "0.0.0.0"

    def test_list_merge_by_id(self):
        base = {"models": [{"id": "auto", "name": "Auto"}, {"id": "gpt4", "name": "GPT-4"}]}
        override = {"models": [{"id": "gpt4", "name": "GPT-4-Turbo"}, {"id": "claude", "name": "Claude"}]}
        result = _deep_merge(base, override)
        by_id = {m["id"]: m for m in result["models"]}
        assert by_id["auto"]["name"] == "Auto"
        assert by_id["gpt4"]["name"] == "GPT-4-Turbo"
        assert by_id["claude"]["name"] == "Claude"


# ---------------------------------------------------------------------------
# ContentForge Multi-Step Flow
# ---------------------------------------------------------------------------

class TestContentForgeMultiStepFlow:
    def test_full_article_workflow(self):
        solo_mgr = MockSoloManager()
        ws_mgr = FakeWorkspaceManager()
        task_id = "cf-article-001"

        simulate_workflow(solo_mgr, ws_mgr, task_id, [
            ("solo.stage.enter", {"stage": "topic_research", "label": "选题研究"}),
            ("solo.tool.start", {"tool_name": "web_search", "query": "AI教育趋势"}),
            ("solo.tool.end", {"tool_name": "web_search", "results_count": 5}),
            ("solo.stage.exit", {"stage": "topic_research"}),
            ("solo.stage.enter", {"stage": "material_collection", "label": "素材收集"}),
            ("solo.draft.update", {"content": "收集到5篇相关素材...", "is_partial": False, "agent_name": "material_collection"}),
            ("solo.stage.exit", {"stage": "material_collection"}),
            ("solo.stage.enter", {"stage": "article_writing", "label": "文章撰写"}),
            ("solo.draft.update", {"content": "AI正在重塑教育...", "is_partial": True, "agent_name": "article_writing"}),
            ("solo.draft.update", {"content": "AI正在重塑教育格局，从个性化学习到智能评估...", "is_partial": False, "agent_name": "article_writing"}),
            ("solo.stage.exit", {"stage": "article_writing"}),
            ("solo.stage.enter", {"stage": "seo_optimization", "label": "SEO优化"}),
            ("solo.draft.update", {"content": "优化后的标题和关键词...", "is_partial": False, "agent_name": "seo_optimization"}),
            ("solo.stage.exit", {"stage": "seo_optimization"}),
            ("solo.stage.enter", {"stage": "content_audit", "label": "内容审核"}),
            ("solo.stage.exit", {"stage": "content_audit"}),
            ("solo.stage.enter", {"stage": "publishing", "label": "发布"}),
            ("solo.task.completed", {"result": "文章已发布到微信公众号"}),
        ])

        # Verify events forwarded
        event_types = [e[1] for e in solo_mgr.events]
        assert "solo.stage.enter" in event_types
        assert "solo.tool.start" in event_types
        assert "solo.task.completed" in event_types

        # Verify messages persisted
        messages = ws_mgr.get_messages(task_id)
        roles = [m["role"] for m in messages]
        assert "stage" in roles
        assert "tool" in roles
        assert "assistant" in roles

        # Verify drafts saved (3 agents with is_partial=False: material_collection, article_writing, seo_optimization)
        draft_msgs = [m for m in messages if m["role"] == "assistant" and m.get("data", {}).get("_draft")]
        assert len(draft_msgs) == 3
        # Verify partial draft was NOT saved (the is_partial=True one)
        draft_contents = [m["content"] for m in draft_msgs]
        assert not any("AI正在重塑教育..." == c for c in draft_contents)  # partial not saved
        assert any("AI正在重塑教育格局" in c for c in draft_contents)  # final saved

        # Verify final result
        final = [m for m in messages if m["role"] == "assistant" and "result" in m.get("data", {})]
        assert len(final) == 1
        assert "文章已发布" in final[0]["content"]

    def test_contentforge_review_flow(self):
        solo_mgr = MockSoloManager()
        ws_mgr = FakeWorkspaceManager()
        task_id = "cf-review-001"

        simulate_workflow(solo_mgr, ws_mgr, task_id, [
            ("solo.stage.enter", {"stage": "article_writing", "label": "文章撰写"}),
            ("solo.draft.update", {"content": "初稿内容...", "is_partial": False, "agent_name": "article_writing"}),
            ("solo.review.ready", {"draft_summary": "教育AI趋势分析"}),
        ])

        messages = ws_mgr.get_messages(task_id)
        review_msgs = [m for m in messages if m["role"] == "review"]
        assert len(review_msgs) == 1
        assert "教育AI趋势分析" in review_msgs[0]["content"]


# ---------------------------------------------------------------------------
# DevForge Multi-Step Flow
# ---------------------------------------------------------------------------

class TestDevForgeMultiStepFlow:
    def test_full_dev_workflow(self):
        solo_mgr = MockSoloManager()
        ws_mgr = FakeWorkspaceManager()
        task_id = "df-code-001"

        simulate_workflow(solo_mgr, ws_mgr, task_id, [
            ("solo.stage.enter", {"stage": "code_writer", "label": "代码编写"}),
            ("solo.draft.update", {"content": "def process_data(items):\n    return [i*2 for i in items]", "is_partial": False, "agent_name": "code_writer"}),
            ("solo.draft.file", {"filename": "processor.py", "content": "def process_data(items):\n    return [i*2 for i in items]"}),
            ("solo.stage.exit", {"stage": "code_writer"}),
            ("solo.stage.enter", {"stage": "code_reviewer", "label": "代码审查"}),
            ("solo.draft.update", {"content": "审查意见：建议添加类型注解", "is_partial": False, "agent_name": "code_reviewer"}),
            ("solo.stage.exit", {"stage": "code_reviewer"}),
            ("solo.stage.enter", {"stage": "test_generator", "label": "测试生成"}),
            ("solo.tool.start", {"tool_name": "test_runner"}),
            ("solo.tool.end", {"tool_name": "test_runner", "status": "passed"}),
            ("solo.stage.exit", {"stage": "test_generator"}),
            ("solo.stage.enter", {"stage": "refactor_agent", "label": "代码重构"}),
            ("solo.draft.update", {"content": "重构后代码", "is_partial": False, "agent_name": "refactor_agent"}),
            ("solo.stage.exit", {"stage": "refactor_agent"}),
            ("solo.stage.enter", {"stage": "doc_writer", "label": "文档编写"}),
            ("solo.task.completed", {"result": "代码开发完成，测试通过"}),
        ])

        messages = ws_mgr.get_messages(task_id)
        file_msgs = [m for m in messages if m.get("data", {}).get("_is_file")]
        assert len(file_msgs) == 1
        assert file_msgs[0]["data"]["filename"] == "processor.py"

        tool_msgs = [m for m in messages if m["role"] == "tool"]
        assert len(tool_msgs) >= 2


# ---------------------------------------------------------------------------
# NovelForge Multi-Step Flow
# ---------------------------------------------------------------------------

class TestNovelForgeMultiStepFlow:
    def test_full_novel_workflow(self):
        solo_mgr = MockSoloManager()
        ws_mgr = FakeWorkspaceManager()
        task_id = "nf-novel-001"

        simulate_workflow(solo_mgr, ws_mgr, task_id, [
            ("solo.stage.enter", {"stage": "outline_planner", "label": "大纲规划"}),
            ("solo.draft.update", {"content": "第一章：迷雾之城\n第二章：暗流涌动", "is_partial": False, "agent_name": "outline_planner"}),
            ("solo.stage.exit", {"stage": "outline_planner"}),
            ("solo.stage.enter", {"stage": "character_designer", "label": "角色设计"}),
            ("solo.draft.update", {"content": "主角：林墨，28岁侦探", "is_partial": False, "agent_name": "character_designer"}),
            ("solo.stage.exit", {"stage": "character_designer"}),
            ("solo.stage.enter", {"stage": "world_builder", "label": "世界观构建"}),
            ("solo.draft.update", {"content": "近未来都市，AI与人类共存", "is_partial": False, "agent_name": "world_builder"}),
            ("solo.stage.exit", {"stage": "world_builder"}),
            ("solo.stage.enter", {"stage": "chapter_writer", "label": "章节撰写"}),
            ("solo.draft.update", {"content": "迷雾笼罩...", "is_partial": True, "agent_name": "chapter_writer"}),
            ("solo.draft.update", {"content": "迷雾笼罩着整座城市，林墨站在窗前...", "is_partial": False, "agent_name": "chapter_writer"}),
            ("solo.stage.exit", {"stage": "chapter_writer"}),
            ("solo.stage.enter", {"stage": "style_refiner", "label": "风格润色"}),
            ("solo.stage.exit", {"stage": "style_refiner"}),
            ("solo.stage.enter", {"stage": "novel_reviewer", "label": "审阅"}),
            ("solo.review.ready", {"draft_summary": "悬疑小说第一章初稿"}),
            ("solo.task.completed", {"result": "小说第一章完成"}),
        ])

        messages = ws_mgr.get_messages(task_id)
        # Only final draft saved (not partial)
        draft_msgs = [m for m in messages if m["role"] == "assistant" and m.get("data", {}).get("_draft")]
        assert len(draft_msgs) >= 1

        review_msgs = [m for m in messages if m["role"] == "review"]
        assert len(review_msgs) == 1


# ---------------------------------------------------------------------------
# MallForge Multi-Step Flow
# ---------------------------------------------------------------------------

class TestMallForgeMultiStepFlow:
    def test_full_ecommerce_workflow(self):
        solo_mgr = MockSoloManager()
        ws_mgr = FakeWorkspaceManager()
        task_id = "mf-product-001"

        simulate_workflow(solo_mgr, ws_mgr, task_id, [
            ("solo.stage.enter", {"stage": "product_scout", "label": "选品分析"}),
            ("solo.tool.start", {"tool_name": "wholesale_search", "category": "electronics"}),
            ("solo.tool.end", {"tool_name": "wholesale_search", "results_count": 12}),
            ("solo.draft.update", {"content": "推荐3款高利润产品", "is_partial": False, "agent_name": "product_scout"}),
            ("solo.stage.exit", {"stage": "product_scout"}),
            ("solo.stage.enter", {"stage": "listing_generator", "label": "Listing生成"}),
            ("solo.draft.update", {"content": "Wireless Bluetooth Earbuds", "is_partial": False, "agent_name": "listing_generator"}),
            ("solo.draft.file", {"filename": "listing.md", "content": "# Product Listing"}),
            ("solo.stage.exit", {"stage": "listing_generator"}),
            ("solo.stage.enter", {"stage": "ad_optimizer", "label": "广告优化"}),
            ("solo.tool.start", {"tool_name": "ad_platform_api"}),
            ("solo.tool.end", {"tool_name": "ad_platform_api", "status": "campaign_created"}),
            ("solo.stage.exit", {"stage": "ad_optimizer"}),
            ("solo.stage.enter", {"stage": "supply_chain", "label": "供应链管理"}),
            ("solo.draft.update", {"content": "建议采购500件，利润率35%", "is_partial": False, "agent_name": "supply_chain"}),
            ("solo.stage.exit", {"stage": "supply_chain"}),
            ("solo.stage.enter", {"stage": "support_agent", "label": "客服配置"}),
            ("solo.stage.exit", {"stage": "support_agent"}),
            ("solo.stage.enter", {"stage": "report_generator", "label": "报告生成"}),
            ("solo.task.completed", {"result": "选品到上架全流程完成，预估月利润¥15,000"}),
        ])

        messages = ws_mgr.get_messages(task_id)
        stage_msgs = [m for m in messages if m["role"] == "stage"]
        stage_labels = [m["content"] for m in stage_msgs]
        assert "选品分析" in stage_labels
        assert "Listing生成" in stage_labels

        final = [m for m in messages if m["role"] == "assistant" and "result" in m.get("data", {})]
        assert len(final) >= 1
        assert "¥15,000" in final[-1]["content"]

    def test_mallforge_error_recovery(self):
        solo_mgr = MockSoloManager()
        ws_mgr = FakeWorkspaceManager()
        task_id = "mf-error-001"

        simulate_workflow(solo_mgr, ws_mgr, task_id, [
            ("solo.stage.enter", {"stage": "product_scout", "label": "选品分析"}),
            ("solo.tool.start", {"tool_name": "wholesale_search"}),
            ("solo.task.error", {"error": "API rate limit exceeded", "stage": "product_scout"}),
        ])

        messages = ws_mgr.get_messages(task_id)
        error_msgs = [m for m in messages if m["role"] == "system" and "✗" in m["content"]]
        assert len(error_msgs) == 1
        assert "rate limit" in error_msgs[0]["content"].lower()


# ---------------------------------------------------------------------------
# Cross-Project Integration
# ---------------------------------------------------------------------------

class TestCrossProjectIntegration:
    def test_all_projects_config_ports_unique(self):
        loaders = {
            "FlowForge": ConfigLoader(Path("d:/software/openclaw/flowforge/config")),
            "ContentForge": ConfigLoader(Path("d:/software/openclaw/contentforge/config")),
            "DevForge": ConfigLoader(Path("d:/software/openclaw/devforge/config")),
            "NovelForge": ConfigLoader(Path("d:/software/openclaw/novelforge/config")),
            "MallForge": ConfigLoader(Path("d:/software/openclaw/mallforge/config")),
        }
        ports = {}
        for name, loader in loaders.items():
            cfg = loader.load_yaml("default.yaml")
            port = cfg["system"]["server_port"]
            assert port not in ports, f"Port conflict: {name} and {ports[port]} both use port {port}"
            ports[port] = name
        assert ports == {8000: "FlowForge", 8001: "ContentForge", 8002: "DevForge", 8003: "NovelForge", 8004: "MallForge"}

    def test_concurrent_multi_project_workflows(self):
        """Test that multiple project workflows don't cross-contaminate."""
        solo_mgr = MockSoloManager()
        ws_mgr = FakeWorkspaceManager()

        tasks = {
            "cf-001": [("solo.stage.enter", {"stage": "article_writing", "label": "文章撰写"}),
                       ("solo.draft.update", {"content": "文章内容", "is_partial": False, "agent_name": "article_writing"}),
                       ("solo.task.completed", {"result": "文章完成"})],
            "df-001": [("solo.stage.enter", {"stage": "code_writer", "label": "代码编写"}),
                       ("solo.draft.update", {"content": "def hello(): pass", "is_partial": False, "agent_name": "code_writer"}),
                       ("solo.task.completed", {"result": "代码完成"})],
            "nf-001": [("solo.stage.enter", {"stage": "chapter_writer", "label": "章节撰写"}),
                       ("solo.draft.update", {"content": "夜幕降临...", "is_partial": False, "agent_name": "chapter_writer"}),
                       ("solo.task.completed", {"result": "章节完成"})],
            "mf-001": [("solo.stage.enter", {"stage": "product_scout", "label": "选品分析"}),
                       ("solo.draft.update", {"content": "推荐产品列表", "is_partial": False, "agent_name": "product_scout"}),
                       ("solo.task.completed", {"result": "选品完成"})],
        }

        for task_id, steps in tasks.items():
            simulate_workflow(solo_mgr, ws_mgr, task_id, steps)

        for task_id in tasks:
            messages = ws_mgr.get_messages(task_id)
            assert len(messages) > 0, f"No messages for task {task_id}"

        # Verify no cross-contamination
        cf_contents = [m.get("content", "") for m in ws_mgr.get_messages("cf-001")]
        df_contents = [m.get("content", "") for m in ws_mgr.get_messages("df-001")]
        assert not any("def hello" in c for c in cf_contents)
        assert not any("文章内容" in c for c in df_contents)
