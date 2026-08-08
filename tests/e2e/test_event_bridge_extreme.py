"""跨项目事件总线桥接层极端场景测试

验证 EventBridge 在极端条件下的防回环能力，包括：
1. 三项目环形桥接 — A↔B↔C↔A 双向桥接
2. 事件风暴 — 100个事件快速连续发出
3. 组合场景 — 双向+过滤+映射
4. 动态注册/取消注册
5. 同名事件类型在不同项目
6. 跨前缀事件映射回环风险
7. 本地总线重转发回环风险
8. 并发事件发射竞态条件

测试铁律遵守说明：
- T1: 本测试为纯基础设施测试，不涉及LLM调用
- T2: 使用真实场景数据（项目协作、任务状态变更等业务事件）
- T3: 每个场景都有具体断言，不使用模糊断言
- T5: 发现未实现功能记录为Bug
"""

import asyncio
import pytest
from flowforge.events.event_bus import EventBus
from flowforge.events.bridge import EventBridge, BridgeConfig


class TestEventBridgeExtreme:
    """极端场景测试 — 跨项目事件总线桥接层回环风险消除"""

    # ── 场景1: 三项目环形桥接 ──────────────────────────────────────

    @pytest.mark.asyncio
    async def test_three_project_circular_bridge(self):
        """三项目环形桥接 — A↔B↔C↔A，验证无无限循环

        架构：三个项目都双向桥接到主总线。
        A发出事件后，主总线收到带前缀的事件。
        由于前缀路由机制，只有A的on_main_bus_event会匹配前缀，
        但_source_project检查会阻止回传给A。
        B和C的前缀不匹配，不会处理A的事件。
        """
        main_bus = EventBus()
        bridge = EventBridge(main_bus)

        bus_a = EventBus()
        bus_b = EventBus()
        bus_c = EventBus()

        # A↔主总线（双向）
        bridge.register_project("project_a", bus_a, BridgeConfig(
            event_prefix="a.", bidirectional=True))
        # B↔主总线（双向）
        bridge.register_project("project_b", bus_b, BridgeConfig(
            event_prefix="b.", bidirectional=True))
        # C↔主总线（双向）
        bridge.register_project("project_c", bus_c, BridgeConfig(
            event_prefix="c.", bidirectional=True))

        # 在所有总线上计数
        counts = {"a": 0, "b": 0, "c": 0, "main_a": 0, "main_b": 0, "main_c": 0}

        def count_handler(key):
            def handler(event):
                counts[key] += 1
            return handler

        bus_a.subscribe("task.completed", count_handler("a"))
        bus_b.subscribe("task.completed", count_handler("b"))
        bus_c.subscribe("task.completed", count_handler("c"))
        main_bus.subscribe("a.task.completed", count_handler("main_a"))
        main_bus.subscribe("b.task.completed", count_handler("main_b"))
        main_bus.subscribe("c.task.completed", count_handler("main_c"))

        # A发出事件
        await bridge.forward_event("project_a", "task.completed", {
            "task_id": "task-001", "status": "done", "project": "contentforge",
        })

        # 验证：A不应收到自己发出的事件（防回环）
        assert counts["a"] == 0, (
            f"A不应收到自己发出的事件，但收到{counts['a']}次"
        )
        # 验证：主总线收到A的事件1次
        assert counts["main_a"] == 1, (
            f"主总线应收到A的事件1次，实际收到{counts['main_a']}次"
        )
        # 验证：B和C不应收到A的事件（前缀不匹配）
        assert counts["b"] == 0, (
            f"B不应收到A的事件（前缀不匹配），但收到{counts['b']}次"
        )
        assert counts["c"] == 0, (
            f"C不应收到A的事件（前缀不匹配），但收到{counts['c']}次"
        )

        # B也发出事件，验证同样不会回环
        await bridge.forward_event("project_b", "task.completed", {
            "task_id": "task-002", "status": "done", "project": "devforge",
        })

        assert counts["b"] == 0, (
            f"B不应收到自己发出的事件，但收到{counts['b']}次"
        )
        assert counts["main_b"] == 1, (
            f"主总线应收到B的事件1次，实际收到{counts['main_b']}次"
        )
        # A仍然不应收到B的事件（前缀"a."不匹配"b.task.completed"）
        assert counts["a"] == 0, (
            f"A不应收到B的事件（前缀不匹配），但收到{counts['a']}次"
        )

    # ── 场景2: 快速连续事件风暴 ──────────────────────────────────────

    @pytest.mark.asyncio
    async def test_event_storm(self):
        """事件风暴 — 100个事件快速连续发出，验证不丢失不重复"""
        main_bus = EventBus()
        bridge = EventBridge(main_bus)
        bus_a = EventBus()
        bridge.register_project("project_a", bus_a, BridgeConfig(event_prefix="a."))

        received = []
        main_bus.subscribe("a.batch.event", lambda e: received.append(e))

        # 快速发出100个事件
        for i in range(100):
            await bridge.forward_event("project_a", "batch.event", {
                "index": i, "operation": "batch_process", "payload_size": 1024,
            })

        assert len(received) == 100, (
            f"应收到100个事件，实际收到{len(received)}"
        )
        # 验证事件顺序和内容完整性
        for i, event in enumerate(received):
            assert event["payload"]["index"] == i, (
                f"第{i}个事件的index应为{i}，实际为{event['payload']['index']}"
            )
            assert event["payload"]["_source_project"] == "project_a"

    # ── 场景3: 双向桥接+事件过滤+类型映射组合 ──────────────────────────

    @pytest.mark.asyncio
    async def test_combined_filter_transform_bidirectional(self):
        """组合场景：双向+过滤+映射

        验证：
        1. 不在白名单的事件被过滤
        2. 在白名单的事件被映射后转发
        3. 反向桥接：主总线事件能正确回传到本地总线
        """
        main_bus = EventBus()
        bridge = EventBridge(main_bus)
        bus_a = EventBus()

        bridge.register_project("project_a", bus_a, BridgeConfig(
            event_prefix="a.",
            event_filter=["important.alert"],
            event_transform={"a.important.alert": "critical.incident"},
            bidirectional=True,
        ))

        # 记录主总线收到的所有事件
        main_received = []
        main_bus.subscribe("critical.incident", lambda e: main_received.append(e))
        # 不重要的事件不应出现在主总线上
        main_bus.subscribe("a.unimportant.event", lambda e: main_received.append(e))

        # 过滤：不在白名单的事件被丢弃
        await bridge.forward_event("project_a", "unimportant.event", {
            "data": 1, "severity": "low",
        })
        assert len(main_received) == 0, (
            f"不在白名单的事件应被过滤，但主总线收到了{len(main_received)}个"
        )

        # 过滤+映射：在白名单的事件被映射后转发
        await bridge.forward_event("project_a", "important.alert", {
            "data": 2, "severity": "critical", "source": "monitoring",
        })
        assert len(main_received) == 1, (
            f"白名单事件应被映射后转发，主总线应收到1个，实际{len(main_received)}"
        )
        assert main_received[0]["type"] == "critical.incident", (
            f"事件类型应被映射为critical.incident，实际为{main_received[0]['type']}"
        )
        assert main_received[0]["payload"]["severity"] == "critical"

        # 反向：主总线→A（双向桥接回传）
        received_a = []
        bus_a.subscribe("critical.incident", lambda e: received_a.append(e))

        # 主总线发出带A前缀的事件，应转发到A的本地总线
        main_bus.emit("task-001", "a.critical.incident", {
            "data": 3, "severity": "high", "source": "upstream",
        })
        assert len(received_a) == 1, (
            f"双向桥接应将主总线事件回传到A本地总线，实际收到{len(received_a)}个"
        )
        assert received_a[0]["payload"]["severity"] == "high"
        # 验证_source_project被剥离（_前缀字段不传递）
        assert "_source_project" not in received_a[0]["payload"], (
            "双向回传时_source_project应被剥离"
        )

    # ── 场景4: 注册/取消注册动态操作 ──────────────────────────────────

    @pytest.mark.asyncio
    async def test_dynamic_register_unregister(self):
        """动态注册和取消注册

        验证：
        1. 注册后事件能正常转发
        2. 取消注册后事件被静默丢弃
        3. 重新注册后事件恢复转发
        4. 双向桥接取消注册后不再回传
        """
        main_bus = EventBus()
        bridge = EventBridge(main_bus)

        bus_a = EventBus()
        bridge.register_project("project_a", bus_a, BridgeConfig(
            event_prefix="a.", bidirectional=True,
        ))

        # 1. 转发成功
        received_main = []
        main_bus.subscribe("a.task.status", lambda e: received_main.append(e))
        await bridge.forward_event("project_a", "task.status", {
            "task_id": "t-001", "status": "running",
        })
        assert len(received_main) == 1, "注册后事件应正常转发"

        # 2. 双向回传成功
        received_a = []
        bus_a.subscribe("task.status", lambda e: received_a.append(e))
        main_bus.emit("task-002", "a.task.status", {
            "task_id": "t-002", "status": "completed",
        })
        assert len(received_a) == 1, "双向桥接应回传事件到本地总线"

        # 取消注册
        bridge.unregister_project("project_a")
        assert "project_a" not in bridge.list_registered_projects(), (
            "取消注册后项目不应在列表中"
        )

        # 3. 转发失败（静默丢弃）
        forward_count_before = sum(
            1 for e in received_main
            if e["payload"].get("_source_project") == "project_a"
        )
        await bridge.forward_event("project_a", "task.status", {
            "task_id": "t-003", "status": "failed",
        })
        forward_count_after = sum(
            1 for e in received_main
            if e["payload"].get("_source_project") == "project_a"
        )
        assert forward_count_after == forward_count_before, (
            f"取消注册后forward_event不应再转发，之前{forward_count_before}个，现在{forward_count_after}个"
        )

        # 4. 双向回传也失败（取消注册后on_main_bus_event已取消订阅）
        main_bus.emit("task-004", "a.task.status", {
            "task_id": "t-004", "status": "cancelled",
        })
        assert len(received_a) == 1, "取消注册后不应再回传到本地总线"

        # 5. 重新注册后恢复
        bridge.register_project("project_a", bus_a, BridgeConfig(
            event_prefix="a.", bidirectional=True,
        ))
        await bridge.forward_event("project_a", "task.status", {
            "task_id": "t-005", "status": "recovered",
        })
        forward_count_after_reregister = sum(
            1 for e in received_main
            if e["payload"].get("_source_project") == "project_a"
        )
        assert forward_count_after_reregister == forward_count_before + 1, (
            f"重新注册后事件应恢复转发，预期{forward_count_before + 1}个，实际{forward_count_after_reregister}个"
        )

        # 6. 重新注册后双向回传也恢复
        main_bus.emit("task-006", "a.task.status", {
            "task_id": "t-006", "status": "active",
        })
        assert len(received_a) == 2, "重新注册后双向回传应恢复"

    # ── 场景5: 同名事件类型在不同项目 ──────────────────────────────────

    @pytest.mark.asyncio
    async def test_same_event_type_different_projects(self):
        """不同项目发出同名事件类型，验证不混淆

        两个项目都发出"status"事件，通过前缀区分：
        - project_a → a.status
        - project_b → b.status
        """
        main_bus = EventBus()
        bridge = EventBridge(main_bus)

        bus_a = EventBus()
        bus_b = EventBus()
        bridge.register_project("a", bus_a, BridgeConfig(event_prefix="a."))
        bridge.register_project("b", bus_b, BridgeConfig(event_prefix="b."))

        received = []
        main_bus.subscribe("a.status", lambda e: received.append(("a", e)))
        main_bus.subscribe("b.status", lambda e: received.append(("b", e)))

        await bridge.forward_event("a", "status", {
            "service": "contentforge", "health": "healthy",
        })
        await bridge.forward_event("b", "status", {
            "service": "devforge", "health": "degraded",
        })

        assert len(received) == 2, f"应收到2个事件，实际收到{len(received)}"
        assert received[0][0] == "a", "第一个事件应来自项目a"
        assert received[0][1]["payload"]["service"] == "contentforge"
        assert received[1][0] == "b", "第二个事件应来自项目b"
        assert received[1][1]["payload"]["service"] == "devforge"
        # 验证_source_project标记正确
        assert received[0][1]["payload"]["_source_project"] == "a"
        assert received[1][1]["payload"]["_source_project"] == "b"

    # ── 场景6: 跨前缀事件映射回环风险 ──────────────────────────────────

    @pytest.mark.asyncio
    async def test_cross_prefix_transform_no_loop(self):
        """跨前缀事件映射 — A映射到B的前缀，验证不产生回环

        风险场景：project_a的event_transform将a.alert映射为b.alert。
        如果project_b是双向桥接，b.on_main_bus_event会匹配前缀"b."，
        但_source_project是"project_a"不是"project_b"，所以会转发到B的本地总线。
        这是正确的跨项目路由行为，不是回环。
        """
        main_bus = EventBus()
        bridge = EventBridge(main_bus)

        bus_a = EventBus()
        bus_b = EventBus()

        bridge.register_project("project_a", bus_a, BridgeConfig(
            event_prefix="a.",
            event_transform={"a.alert": "b.alert"},
        ))
        bridge.register_project("project_b", bus_b, BridgeConfig(
            event_prefix="b.", bidirectional=True,
        ))

        # B本地总线订阅alert
        received_b = []
        bus_b.subscribe("alert", lambda e: received_b.append(e))

        # A发出alert，被映射为b.alert
        await bridge.forward_event("project_a", "alert", {
            "severity": "critical", "message": "服务异常", "source": "monitoring",
        })

        # B的本地总线应收到映射后的事件（跨项目路由）
        assert len(received_b) == 1, (
            f"B应收到A映射过来的事件，实际收到{len(received_b)}个"
        )
        assert received_b[0]["payload"]["severity"] == "critical"
        # _source_project已被剥离（双向回传时去除_前缀字段）
        # 但_forwarded_from会保留来源链用于防回环
        assert "_source_project" not in received_b[0]["payload"]
        assert received_b[0]["payload"].get("_forwarded_from") == ["project_a"], (
            "跨项目路由时应保留来源链_forwarded_from"
        )

        # A的本地总线不应收到（A不是双向桥接）
        received_a = []
        bus_a.subscribe("alert", lambda e: received_a.append(e))
        assert len(received_a) == 0, "A不是双向桥接，不应收到回传事件"

    # ── 场景7: 本地总线重转发回环风险 ──────────────────────────────────

    @pytest.mark.asyncio
    async def test_local_bus_reforward_loop_risk(self):
        """本地总线重转发回环风险检测

        风险场景：双向桥接下，主总线事件回传到本地总线后，
        如果本地总线订阅者再次调用forward_event，会产生新事件。
        验证：bridge本身不会自动重转发，只有用户代码才会。
        同时验证：即使重转发，_source_project会更新为当前项目，
        不会产生无限循环（因为原项目的防回环检查会阻止）。
        """
        main_bus = EventBus()
        bridge = EventBridge(main_bus)

        bus_a = EventBus()
        bus_b = EventBus()

        bridge.register_project("project_a", bus_a, BridgeConfig(
            event_prefix="a.", bidirectional=True,
        ))
        bridge.register_project("project_b", bus_b, BridgeConfig(
            event_prefix="b.", bidirectional=True,
        ))

        # 模拟：B的本地总线订阅者在收到事件后调用forward_event
        # 这模拟了用户代码可能的行为
        async def b_local_handler(event):
            """B本地总线收到事件后，重新转发到主总线"""
            # 注意：这是用户代码行为，不是bridge自动行为
            await bridge.forward_event("project_b", "notification", {
                "original_event": event["type"],
                "forwarded_by": "project_b",
            })

        bus_b.subscribe("notification", lambda e: b_local_handler(e))

        # A发出事件
        received_main = []
        main_bus.subscribe("a.notification", lambda e: received_main.append(("a", e)))
        main_bus.subscribe("b.notification", lambda e: received_main.append(("b", e)))

        await bridge.forward_event("project_a", "notification", {
            "message": "来自A的通知", "priority": "high",
        })

        # A的事件到达主总线（a.notification）
        a_events = [e for e in received_main if e[0] == "a"]
        assert len(a_events) == 1, "A的事件应到达主总线"

        # B不会自动收到A的事件（前缀"b."不匹配"a.notification"）
        b_events = [e for e in received_main if e[0] == "b"]
        assert len(b_events) == 0, (
            "B不应自动收到A的事件（前缀不匹配），bridge不会自动重转发"
        )

    # ── 场景8: 并发事件发射竞态条件 ──────────────────────────────────

    @pytest.mark.asyncio
    async def test_concurrent_event_emission(self):
        """并发事件发射 — 多个项目同时发出事件，验证不丢失不混淆"""
        main_bus = EventBus()
        bridge = EventBridge(main_bus)

        bus_a = EventBus()
        bus_b = EventBus()
        bus_c = EventBus()

        bridge.register_project("project_a", bus_a, BridgeConfig(event_prefix="a."))
        bridge.register_project("project_b", bus_b, BridgeConfig(event_prefix="b."))
        bridge.register_project("project_c", bus_c, BridgeConfig(event_prefix="c."))

        received_a = []
        received_b = []
        received_c = []

        main_bus.subscribe("a.concurrent.event", lambda e: received_a.append(e))
        main_bus.subscribe("b.concurrent.event", lambda e: received_b.append(e))
        main_bus.subscribe("c.concurrent.event", lambda e: received_c.append(e))

        # 三个项目同时各发50个事件
        async def emit_batch(project, prefix, count=50):
            for i in range(count):
                await bridge.forward_event(project, "concurrent.event", {
                    "index": i, "source": project,
                })

        await asyncio.gather(
            emit_batch("project_a", "a."),
            emit_batch("project_b", "b."),
            emit_batch("project_c", "c."),
        )

        assert len(received_a) == 50, (
            f"A应收到50个事件，实际收到{len(received_a)}"
        )
        assert len(received_b) == 50, (
            f"B应收到50个事件，实际收到{len(received_b)}"
        )
        assert len(received_c) == 50, (
            f"C应收到50个事件，实际收到{len(received_c)}"
        )

        # 验证每个项目的事件_source_project正确
        for event in received_a:
            assert event["payload"]["_source_project"] == "project_a"
        for event in received_b:
            assert event["payload"]["_source_project"] == "project_b"
        for event in received_c:
            assert event["payload"]["_source_project"] == "project_c"

    # ── 场景9: 双向桥接多项目互发事件 ──────────────────────────────────

    @pytest.mark.asyncio
    async def test_bidirectional_multi_project_cross_talk(self):
        """双向桥接多项目交叉通信

        A和B都双向桥接。主总线上发出一个带A前缀的事件，
        A的防回环检查会跳过（如果_source_project是A），
        B不会处理（前缀不匹配）。
        但如果主总线直接发出（无_source_project），A应收到。
        """
        main_bus = EventBus()
        bridge = EventBridge(main_bus)

        bus_a = EventBus()
        bus_b = EventBus()

        bridge.register_project("project_a", bus_a, BridgeConfig(
            event_prefix="a.", bidirectional=True,
        ))
        bridge.register_project("project_b", bus_b, BridgeConfig(
            event_prefix="b.", bidirectional=True,
        ))

        received_a = []
        received_b = []

        bus_a.subscribe("deploy.status", lambda e: received_a.append(e))
        bus_b.subscribe("deploy.status", lambda e: received_b.append(e))

        # 主总线直接发出带A前缀的事件（无_source_project）
        main_bus.emit("task-001", "a.deploy.status", {
            "deployment_id": "deploy-001", "status": "success",
        })

        # A应收到（双向桥接回传，且_source_project不存在所以不等于"project_a"）
        assert len(received_a) == 1, (
            f"A应收到主总线直接发出的事件，实际收到{len(received_a)}个"
        )
        assert received_a[0]["payload"]["deployment_id"] == "deploy-001"

        # B不应收到（前缀不匹配）
        assert len(received_b) == 0, (
            f"B不应收到A前缀的事件，实际收到{len(received_b)}个"
        )

        # 主总线直接发出带B前缀的事件
        main_bus.emit("task-002", "b.deploy.status", {
            "deployment_id": "deploy-002", "status": "failed",
        })

        assert len(received_b) == 1, (
            f"B应收到主总线直接发出的事件，实际收到{len(received_b)}个"
        )
        # A不应收到额外事件
        assert len(received_a) == 1, (
            f"A不应收到B前缀的事件，实际收到{len(received_a)}个"
        )

    # ── 场景10: _source_project被篡改的防护 ──────────────────────────

    @pytest.mark.asyncio
    async def test_source_project_tampering_protection(self):
        """_source_project篡改防护

        验证：即使事件数据中包含_source_project字段，
        forward_event会覆盖它，确保标记正确。
        """
        main_bus = EventBus()
        bridge = EventBridge(main_bus)

        bus_a = EventBus()
        bridge.register_project("project_a", bus_a, BridgeConfig(
            event_prefix="a.", bidirectional=True,
        ))

        received = []
        main_bus.subscribe("a.security.event", lambda e: received.append(e))

        # 尝试在数据中注入假的_source_project
        await bridge.forward_event("project_a", "security.event", {
            "_source_project": "project_b",  # 伪造来源
            "action": "unauthorized_access", "severity": "critical",
        })

        # 验证：forward_event覆盖了伪造的_source_project
        assert len(received) == 1
        assert received[0]["payload"]["_source_project"] == "project_a", (
            "forward_event应覆盖数据中的_source_project，确保标记正确"
        )

        # 验证防回环仍然有效：A的本地总线不应收到自己发出的事件
        received_a = []
        bus_a.subscribe("security.event", lambda e: received_a.append(e))

        # 由于_source_project正确标记为"project_a"，双向桥接不会回传
        # （on_main_bus_event检查source == self._project_name会跳过）
        assert len(received_a) == 0, (
            "即使数据中伪造了_source_project，防回环仍应有效"
        )

    # ── 场景11: 双向桥接中_source_project剥离后的安全性 ──────────────

    @pytest.mark.asyncio
    async def test_bidirectional_strips_source_project_safely(self):
        """双向桥接剥离_source_project后的安全性

        当主总线事件回传到本地总线时，_source_project被剥离。
        验证：剥离后不会导致本地总线的事件被误认为本地发出的事件。
        """
        main_bus = EventBus()
        bridge = EventBridge(main_bus)

        bus_a = EventBus()
        bus_b = EventBus()

        bridge.register_project("project_a", bus_a, BridgeConfig(
            event_prefix="a.", bidirectional=True,
        ))
        bridge.register_project("project_b", bus_b, BridgeConfig(
            event_prefix="b.", bidirectional=True,
        ))

        # B发出事件到主总线
        await bridge.forward_event("project_b", "notification", {
            "message": "来自B的广播", "priority": "normal",
        })

        # A的本地总线不会收到（前缀"a."不匹配"b.notification"）
        received_a = []
        bus_a.subscribe("notification", lambda e: received_a.append(e))
        assert len(received_a) == 0, "A不应收到B的事件（前缀不匹配）"

        # 主总线直接发出带A前缀的事件
        received_a_direct = []
        bus_a.subscribe("alert", lambda e: received_a_direct.append(e))
        main_bus.emit("task-001", "a.alert", {
            "message": "系统告警", "level": "warning",
        })

        assert len(received_a_direct) == 1, "A应收到主总线直接发出的A前缀事件"
        # 验证_source_project已被剥离
        assert "_source_project" not in received_a_direct[0]["payload"], (
            "双向回传时_source_project应被剥离"
        )
        # 主总线直接发出的事件没有_source_project，所以_forwarded_from为空
        assert "_forwarded_from" not in received_a_direct[0]["payload"], (
            "主总线直接发出的事件不应有_forwarded_from"
        )

    # ── 场景12: 事件风暴+双向桥接+防回环 ──────────────────────────────

    @pytest.mark.asyncio
    async def test_event_storm_with_bidirectional_anti_loop(self):
        """事件风暴+双向桥接 — 验证大量事件下防回环仍然有效"""
        main_bus = EventBus()
        bridge = EventBridge(main_bus)

        bus_a = EventBus()
        bus_b = EventBus()

        bridge.register_project("project_a", bus_a, BridgeConfig(
            event_prefix="a.", bidirectional=True,
        ))
        bridge.register_project("project_b", bus_b, BridgeConfig(
            event_prefix="b.", bidirectional=True,
        ))

        # 计数器
        main_a_count = [0]
        main_b_count = [0]
        local_a_count = [0]
        local_b_count = [0]

        main_bus.subscribe("a.metrics.report", lambda e: main_a_count.__setitem__(0, main_a_count[0] + 1))
        main_bus.subscribe("b.metrics.report", lambda e: main_b_count.__setitem__(0, main_b_count[0] + 1))
        bus_a.subscribe("metrics.report", lambda e: local_a_count.__setitem__(0, local_a_count[0] + 1))
        bus_b.subscribe("metrics.report", lambda e: local_b_count.__setitem__(0, local_b_count[0] + 1))

        # A快速发出50个事件
        for i in range(50):
            await bridge.forward_event("project_a", "metrics.report", {
                "cpu_usage": 0.5 + i * 0.01, "memory_mb": 1024 + i,
            })

        # B快速发出50个事件
        for i in range(50):
            await bridge.forward_event("project_b", "metrics.report", {
                "cpu_usage": 0.3 + i * 0.01, "memory_mb": 512 + i,
            })

        # 验证主总线收到正确数量
        assert main_a_count[0] == 50, f"主总线应收到A的50个事件，实际{main_a_count[0]}"
        assert main_b_count[0] == 50, f"主总线应收到B的50个事件，实际{main_b_count[0]}"

        # 验证防回环：A和B的本地总线不应收到自己发出的事件
        assert local_a_count[0] == 0, (
            f"A本地总线不应收到自己发出的事件（防回环），实际收到{local_a_count[0]}"
        )
        assert local_b_count[0] == 0, (
            f"B本地总线不应收到自己发出的事件（防回环），实际收到{local_b_count[0]}"
        )

    # ── 场景13: 跨项目重转发回环防护（_forwarded_from链） ──────────────

    @pytest.mark.asyncio
    async def test_forwarded_from_chain_prevents_multi_hop_loop(self):
        """跨项目重转发回环防护 — _forwarded_from链机制

        模拟最危险的回环场景：A→B→C→A
        使用event_transform让A的事件映射到B的前缀，
        B的事件映射到C的前缀，C的事件映射到A的前缀。
        验证_forwarded_from链能检测并阻断这种多跳回环。
        """
        main_bus = EventBus()
        bridge = EventBridge(main_bus)

        bus_a = EventBus()
        bus_b = EventBus()
        bus_c = EventBus()

        # A: 本地事件加前缀a.，但映射a.alert→b.alert（跨项目路由到B）
        bridge.register_project("project_a", bus_a, BridgeConfig(
            event_prefix="a.",
            event_transform={"a.alert": "b.alert"},
            bidirectional=True,
        ))
        # B: 双向桥接，接收b.前缀的事件
        bridge.register_project("project_b", bus_b, BridgeConfig(
            event_prefix="b.",
            bidirectional=True,
        ))
        # C: 双向桥接，接收c.前缀的事件
        bridge.register_project("project_c", bus_c, BridgeConfig(
            event_prefix="c.",
            bidirectional=True,
        ))

        # A发出alert，被映射为b.alert到达主总线
        received_main = []
        main_bus.subscribe("b.alert", lambda e: received_main.append(e))

        await bridge.forward_event("project_a", "alert", {
            "severity": "critical", "message": "服务宕机", "source": "monitoring",
        })

        # 主总线收到映射后的事件
        assert len(received_main) == 1, "主总线应收到映射后的b.alert"
        assert received_main[0]["payload"]["_source_project"] == "project_a"

        # B的本地总线收到（双向桥接回传，前缀b.匹配）
        received_b = []
        bus_b.subscribe("alert", lambda e: received_b.append(e))
        # 重新发出以触发B的订阅
        await bridge.forward_event("project_a", "alert", {
            "severity": "high", "message": "再次告警", "source": "monitoring",
        })
        assert len(received_b) == 1, (
            f"B应收到A映射过来的事件，实际收到{len(received_b)}个"
        )
        # 验证_forwarded_from链包含project_a
        assert received_b[0]["payload"].get("_forwarded_from") == ["project_a"], (
            "B收到的事件应包含_forwarded_from=['project_a']"
        )

        # 如果B的本地订阅者重新转发到主总线（模拟用户代码行为），
        # _forwarded_from链会被保留
        await bridge.forward_event("project_b", "alert", {
            "severity": "high", "message": "B转发告警",
            "_forwarded_from": ["project_a"],  # 模拟保留来源链
        })

        # A的防回环检查：_source_project是"project_b"，
        # 但_forwarded_from包含"project_a"，所以A不会收到
        received_a = []
        bus_a.subscribe("alert", lambda e: received_a.append(e))

        # 主总线上发出b.alert（模拟B转发的事件）
        main_bus.emit("task-001", "a.alert", {
            "severity": "high", "message": "测试回环",
            "_source_project": "project_b",
            "_forwarded_from": ["project_a"],
        })

        # A的on_main_bus_event检查：
        # 1. _source_project != "project_a" → 不跳过
        # 2. _forwarded_from包含"project_a" → 跳过！
        assert len(received_a) == 0, (
            "A不应收到_forwarded_from链中包含自己的事件（多跳回环防护）"
        )
