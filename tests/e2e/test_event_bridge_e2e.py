"""跨项目事件总线桥接层E2E测试

验证 EventBridge 的双向转发、防回环、事件过滤和事件类型映射机制。
测试场景覆盖6个核心场景，确保跨项目事件传播的正确性。

测试铁律遵守说明：
- T1: 本测试为纯基础设施测试，不涉及LLM调用
- T2: 使用真实场景数据（小说创作、章节完成等业务事件）
- T3: 每个场景都有具体断言，不使用模糊断言
- T5: 发现未实现功能记录为Bug
"""

import pytest
import asyncio
from flowforge.events.event_bus import EventBus
from flowforge.events.bridge import EventBridge, BridgeConfig


class TestEventBridgeE2E:
    """E2E测试 — 跨项目事件总线桥接层"""

    @pytest.fixture
    def main_bus(self):
        """主总线（FlowForge EventBus）"""
        return EventBus()

    @pytest.fixture
    def bridge(self, main_bus):
        """桥接层实例"""
        return EventBridge(main_bus)

    @pytest.fixture
    def novel_bus(self):
        """NovelForge 本地事件总线"""
        return EventBus()

    @pytest.mark.asyncio
    async def test_unidirectional_forward(self, bridge, main_bus, novel_bus):
        """场景1: 单向转发 — NovelForge事件转发到主总线，带前缀"""
        bridge.register_project(
            "novelforge", novel_bus,
            BridgeConfig(event_prefix="novelforge."),
        )

        received = []
        main_bus.subscribe("novelforge.novel.created", lambda e: received.append(e))

        # 通过forward_event转发NovelForge的事件到主总线
        await bridge.forward_event("novelforge", "novel.created", {"title": "星辰变", "author": "我吃西红柿"})

        assert len(received) == 1, "主总线订阅者应收到1条事件"
        assert received[0]["type"] == "novelforge.novel.created", "事件类型应带前缀"
        assert received[0]["payload"]["title"] == "星辰变", "事件数据应正确传递"
        assert received[0]["payload"]["_source_project"] == "novelforge", "应包含来源项目标记"
        assert received[0]["payload"]["_original_type"] == "novel.created", "应包含原始事件类型"

    @pytest.mark.asyncio
    async def test_cross_project_subscription(self, bridge, main_bus, novel_bus):
        """场景2: 跨项目订阅 — 使用通配符模式订阅其他项目的事件"""
        bridge.register_project(
            "novelforge", novel_bus,
            BridgeConfig(event_prefix="novelforge."),
        )

        received = []
        bridge.subscribe_cross_project("novelforge.*", lambda e: received.append(e))

        await bridge.forward_event("novelforge", "novel.created", {"id": "novel-001", "genre": "玄幻"})

        assert len(received) == 1, "跨项目订阅者应收到1条事件"
        assert received[0]["type"] == "novelforge.novel.created", "应收到带前缀的事件"
        assert received[0]["payload"]["id"] == "novel-001", "事件数据应正确传递"

    @pytest.mark.asyncio
    async def test_bidirectional_bridge(self, bridge, main_bus, novel_bus):
        """场景3: 双向桥接 — 主总线事件转发回项目本地总线"""
        bridge.register_project(
            "novelforge", novel_bus,
            BridgeConfig(event_prefix="novelforge.", bidirectional=True),
        )

        received = []
        novel_bus.subscribe("chapter.completed", lambda e: received.append(e))

        # 主总线上发出带前缀的事件
        main_bus.emit("task-001", "novelforge.chapter.completed", {"chapter_id": 42, "word_count": 3200})

        assert len(received) == 1, "NovelForge本地总线应收到1条事件"
        assert received[0]["type"] == "chapter.completed", "本地总线应收到去掉前缀的事件类型"
        assert received[0]["payload"]["chapter_id"] == 42, "事件数据应正确传递"
        assert received[0]["payload"]["word_count"] == 3200, "事件数据应完整保留"

    @pytest.mark.asyncio
    async def test_anti_loop(self, bridge, main_bus, novel_bus):
        """场景4: 防回环 — 双向桥接下事件不会循环转发"""
        bridge.register_project(
            "novelforge", novel_bus,
            BridgeConfig(event_prefix="novelforge.", bidirectional=True),
        )

        loop_count = [0]
        novel_bus.subscribe("novel.created", lambda e: loop_count.__setitem__(0, loop_count[0] + 1))

        # NovelForge发出事件 → 转发到主总线 → 不应回传到NovelForge（因为_source_project匹配）
        await bridge.forward_event("novelforge", "novel.created", {"id": "novel-anti-loop", "title": "防回环测试"})

        # 此时主总线收到了事件，但on_main_bus_event检测到_source_project=="novelforge"后跳过
        # 所以novel_bus订阅者不应收到
        assert loop_count[0] == 0, "防回环：forward_event转发的事件不应回传到本地总线"

        # 主总线直接发出带前缀的事件（无_source_project标记）→ 应该转发到NovelForge
        main_bus.emit("task-002", "novelforge.novel.created", {"id": "novel-direct", "title": "直接主总线事件"})

        assert loop_count[0] == 1, "主总线直接发出的事件应转发到本地总线，且只收到1次"

    @pytest.mark.asyncio
    async def test_event_filter(self, bridge, main_bus, novel_bus):
        """场景5: 事件过滤 — 只转发白名单内的事件"""
        bridge.register_project(
            "novelforge", novel_bus,
            BridgeConfig(
                event_prefix="novelforge.",
                event_filter=["novel.created", "novel.updated"],
            ),
        )

        received = []
        main_bus.subscribe("novelforge.novel.created", lambda e: received.append(e))
        main_bus.subscribe("novelforge.novel.updated", lambda e: received.append(e))
        main_bus.subscribe("novelforge.novel.deleted", lambda e: received.append(e))

        # 白名单内的事件应该通过
        await bridge.forward_event("novelforge", "novel.created", {"id": "novel-001", "title": "星辰变"})
        assert len(received) == 1, "白名单事件novel.created应通过过滤"

        await bridge.forward_event("novelforge", "novel.updated", {"id": "novel-001", "title": "星辰变(修订版)"})
        assert len(received) == 2, "白名单事件novel.updated应通过过滤"

        # 不在白名单内的事件应该被过滤
        await bridge.forward_event("novelforge", "novel.deleted", {"id": "novel-001"})
        assert len(received) == 2, "非白名单事件novel.deleted应被过滤掉，不应增加"

    @pytest.mark.asyncio
    async def test_event_transform(self, bridge, main_bus, novel_bus):
        """场景6: 事件类型映射 — 转发时变换事件类型名称"""
        bridge.register_project(
            "novelforge", novel_bus,
            BridgeConfig(
                event_prefix="novelforge.",
                event_transform={"novelforge.novel.created": "content.novel_created"},
            ),
        )

        received = []
        # transform_event_type先加前缀再映射，映射替换整个类型：
        # "novel.created" → prefix → "novelforge.novel.created" → transform → "content.novel_created"
        main_bus.subscribe("content.novel_created", lambda e: received.append(e))

        await bridge.forward_event("novelforge", "novel.created", {"id": "novel-transform", "title": "盘龙"})

        assert len(received) == 1, "应收到映射后的事件类型"
        assert received[0]["type"] == "content.novel_created", "事件类型应被映射"
        assert received[0]["payload"]["id"] == "novel-transform", "事件数据应正确传递"

    @pytest.mark.asyncio
    async def test_bidirectional_strips_internal_metadata(self, bridge, main_bus, novel_bus):
        """场景7: 双向桥接回传时去除内部元数据（_前缀字段）"""
        bridge.register_project(
            "novelforge", novel_bus,
            BridgeConfig(event_prefix="novelforge.", bidirectional=True),
        )

        received = []
        novel_bus.subscribe("chapter.published", lambda e: received.append(e))

        # 主总线发出事件，payload中包含一些_前缀字段
        main_bus.emit("task-003", "novelforge.chapter.published", {
            "chapter_id": 99,
            "_internal_flag": "should_be_removed",
            "_debug_info": "should_be_removed_too",
            "title": "第九十九章 大结局",
        })

        assert len(received) == 1, "本地总线应收到1条事件"
        payload = received[0]["payload"]
        assert "chapter_id" in payload, "正常字段应保留"
        assert "title" in payload, "正常字段应保留"
        assert "_internal_flag" not in payload, "_前缀的内部元数据应被去除"
        assert "_debug_info" not in payload, "_前缀的内部元数据应被去除"

    @pytest.mark.asyncio
    async def test_multiple_projects_bridge(self, bridge, main_bus):
        """场景8: 多项目桥接 — 多个项目同时注册到桥接层"""
        novel_bus = EventBus()
        content_bus = EventBus()
        dev_bus = EventBus()

        bridge.register_project("novelforge", novel_bus, BridgeConfig(event_prefix="novelforge."))
        bridge.register_project("contentforge", content_bus, BridgeConfig(event_prefix="contentforge."))
        bridge.register_project("devforge", dev_bus, BridgeConfig(event_prefix="devforge."))

        assert set(bridge.list_registered_projects()) == {"novelforge", "contentforge", "devforge"}, "应注册3个项目"

        novel_received = []
        content_received = []
        dev_received = []

        # EventBus不支持glob模式订阅，需订阅精确事件类型
        main_bus.subscribe("novelforge.novel.created", lambda e: novel_received.append(e))
        main_bus.subscribe("contentforge.article.published", lambda e: content_received.append(e))
        main_bus.subscribe("devforge.build.completed", lambda e: dev_received.append(e))

        await bridge.forward_event("novelforge", "novel.created", {"title": "星辰变"})
        await bridge.forward_event("contentforge", "article.published", {"title": "AI技术趋势"})
        await bridge.forward_event("devforge", "build.completed", {"project": "flowforge"})

        assert len(novel_received) == 1, "NovelForge事件应被主总线收到"
        assert len(content_received) == 1, "ContentForge事件应被主总线收到"
        assert len(dev_received) == 1, "DevForge事件应被主总线收到"

    @pytest.mark.asyncio
    async def test_unregistered_project_event_dropped(self, bridge, main_bus):
        """场景9: 未注册项目的事件被丢弃"""
        received = []
        main_bus.subscribe("*", lambda e: received.append(e))

        # 向未注册的项目转发事件，应被丢弃
        await bridge.forward_event("unknown_project", "some.event", {"data": "value"})

        assert len(received) == 0, "未注册项目的事件应被丢弃"

    @pytest.mark.asyncio
    async def test_bidirectional_only_matching_prefix(self, bridge, main_bus, novel_bus):
        """场景10: 双向桥接只转发匹配前缀的事件"""
        bridge.register_project(
            "novelforge", novel_bus,
            BridgeConfig(event_prefix="novelforge.", bidirectional=True),
        )

        received = []
        novel_bus.subscribe("task.completed", lambda e: received.append(e))

        # 发出不匹配前缀的事件，不应转发到NovelForge
        main_bus.emit("task-004", "contentforge.article.published", {"title": "无关事件"})

        assert len(received) == 0, "不匹配前缀的事件不应转发到NovelForge本地总线"

        # 发出匹配前缀的事件，应转发
        main_bus.emit("task-005", "novelforge.task.completed", {"task_id": "t-001"})

        assert len(received) == 1, "匹配前缀的事件应转发到NovelForge本地总线"
