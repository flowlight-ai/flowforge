"""Tests for FlowForge Infrastructure: EventStore WAL, LLMRouter, ContentModeration."""

import asyncio
import os
import shutil
import tempfile
import time

import pytest

# ============================================================
# EventStore WAL Tests
# ============================================================


class TestEventStore:
    """Tests for EventStore WAL模式事件存储."""

    @pytest.fixture
    def store_dir(self, tmp_path):
        """创建临时存储目录."""
        return str(tmp_path / "test_events")

    @pytest.fixture
    def store(self, store_dir):
        """创建EventStore实例."""
        from flowforge.session.event_store import EventStore

        return EventStore(store_dir=store_dir)

    @pytest.mark.asyncio
    async def test_append_and_query(self, store):
        """测试追加和查询事件."""
        entry = await store.append("task.start", {"task_id": "t1"}, trace_id="tr1")
        assert entry.id == 1
        assert entry.event_type == "task.start"
        assert entry.data == {"task_id": "t1"}
        assert entry.trace_id == "tr1"
        assert entry.timestamp > 0

        results = await store.query(event_type="task.start")
        assert len(results) == 1
        assert results[0].id == 1

    @pytest.mark.asyncio
    async def test_query_by_trace_id(self, store):
        """测试按trace_id查询."""
        await store.append("llm.start", {"model": "a"}, trace_id="tr-A")
        await store.append("llm.start", {"model": "b"}, trace_id="tr-B")
        await store.append("llm.end", {"tokens": 100}, trace_id="tr-A")

        results = await store.query(trace_id="tr-A")
        assert len(results) == 2
        assert all(r.trace_id == "tr-A" for r in results)

    @pytest.mark.asyncio
    async def test_query_by_since(self, store):
        """测试按时间范围查询."""
        before = time.time()
        await store.append("event.old", {})
        await store.append("event.new", {})
        after = time.time()

        results = await store.query(since=before)
        assert len(results) == 2

    @pytest.mark.asyncio
    async def test_query_limit(self, store):
        """测试查询限制."""
        for i in range(10):
            await store.append("test.event", {"i": i})

        results = await store.query(limit=3)
        assert len(results) == 3

    @pytest.mark.asyncio
    async def test_entry_count(self, store):
        """测试事件计数."""
        assert store.entry_count == 0
        await store.append("e1", {})
        assert store.entry_count == 1
        await store.append("e2", {})
        assert store.entry_count == 2

    @pytest.mark.asyncio
    async def test_wal_persistence(self, store_dir):
        """测试WAL持久化：重启后能恢复事件."""
        from flowforge.session.event_store import EventStore

        # 写入事件
        store1 = EventStore(store_dir=store_dir)
        await store1.append("task.start", {"task_id": "persist_test"})
        assert store1.entry_count == 1

        # 模拟重启
        store2 = EventStore(store_dir=store_dir)
        assert store2.entry_count == 1
        results = await store2.query(event_type="task.start")
        assert len(results) == 1
        assert results[0].data["task_id"] == "persist_test"

    @pytest.mark.asyncio
    async def test_compact(self, store):
        """测试压缩功能."""
        for i in range(20):
            await store.append("test.event", {"i": i})

        assert store.entry_count == 20
        await store.compact(keep_last_n=5)
        assert store.entry_count == 5

    @pytest.mark.asyncio
    async def test_auto_commit_on_batch(self, store_dir):
        """测试批量自动提交."""
        from flowforge.session.event_store import EventStore

        store = EventStore(store_dir=store_dir)
        store._batch_size = 5  # 降低批量阈值便于测试

        for i in range(5):
            await store.append("batch.test", {"i": i})

        # 批量提交后WAL应被清空
        assert not os.path.exists(os.path.join(store_dir, "wal.jsonl"))
        # 快照应存在
        assert os.path.exists(os.path.join(store_dir, "snapshot.json"))

    @pytest.mark.asyncio
    async def test_empty_query(self, store):
        """测试空查询."""
        results = await store.query()
        assert results == []


# ============================================================
# LLMRouter Tests
# ============================================================


class TestLLMRouter:
    """Tests for LLMRouter 多模型级联路由."""

    @pytest.fixture
    def router(self):
        """创建LLMRouter实例（不加载配置文件）."""
        from flowforge.llm.router import LLMRouter

        return LLMRouter()

    @pytest.fixture
    def router_with_config(self, tmp_path):
        """创建带配置的LLMRouter实例."""
        from flowforge.llm.router import LLMRouter

        config_content = """
cascade_strategies:
  default:
    primary: doubao-seed2
    fallback:
      - qwen3.6-plus
      - deepseek-chat
    retry_on:
      - rate_limit
      - timeout
    max_retries: 2
  content_writing:
    primary: doubao-seed2
    fallback:
      - qwen3.6-plus
  code_generation:
    primary: deepseek-chat
    fallback:
      - doubao-seed2
model_specs:
  doubao-seed2:
    provider: doubao
    display_name: "豆包 Seed 2.0"
  qwen3.6-plus:
    provider: openrouter
    display_name: "Qwen 3.6 Plus"
  deepseek-chat:
    provider: openrouter
    display_name: "DeepSeek Chat"
"""
        config_path = str(tmp_path / "models.yaml")
        with open(config_path, "w", encoding="utf-8") as f:
            f.write(config_content)

        return LLMRouter(config_path=config_path)

    @pytest.mark.asyncio
    async def test_route_default_strategy(self, router_with_config):
        """测试默认策略路由到primary."""
        model = await router_with_config.route("default")
        assert model == "doubao-seed2"

    @pytest.mark.asyncio
    async def test_route_specific_strategy(self, router_with_config):
        """测试指定策略路由."""
        model = await router_with_config.route("code_generation")
        assert model == "deepseek-chat"

    @pytest.mark.asyncio
    async def test_route_fallback_on_unavailable(self, router_with_config):
        """测试primary不可用时降级到fallback."""
        await router_with_config.record_error("doubao-seed2", "rate_limit")
        await router_with_config.record_error("doubao-seed2", "rate_limit")
        await router_with_config.record_error("doubao-seed2", "rate_limit")

        model = await router_with_config.route("default")
        assert model == "qwen3.6-plus"

    @pytest.mark.asyncio
    async def test_route_all_unavailable(self, router_with_config):
        """测试所有模型不可用时返回primary."""
        for mid in ["doubao-seed2", "qwen3.6-plus", "deepseek-chat"]:
            for _ in range(3):
                await router_with_config.record_error(mid, "server_error")

        model = await router_with_config.route("default")
        assert model == "doubao-seed2"  # 回退到primary

    @pytest.mark.asyncio
    async def test_record_success(self, router_with_config):
        """测试记录成功调用."""
        await router_with_config.record_success("doubao-seed2", latency=0.5)
        status = router_with_config.get_model_status("doubao-seed2")
        assert status is not None
        assert status.health.value == "healthy"
        assert status.latency_p95 == 0.5
        assert status.consecutive_errors == 0

    @pytest.mark.asyncio
    async def test_record_error_degraded(self, router_with_config):
        """测试错误率达到阈值时降级."""
        # 模拟多次调用，使error_rate超过0.1
        # 每次 error +0.05, success -0.01
        # 1 success + 3 errors = 0 - 0.01 + 0.15 = 0.14 > 0.1 → degraded
        await router_with_config.record_success("qwen3.6-plus", latency=0.3)
        for _ in range(3):
            await router_with_config.record_error("qwen3.6-plus", "timeout")

        status = router_with_config.get_model_status("qwen3.6-plus")
        assert status is not None
        assert status.health.value in ("degraded", "unavailable")

    @pytest.mark.asyncio
    async def test_success_resets_errors(self, router_with_config):
        """测试成功调用重置连续错误计数."""
        for _ in range(2):
            await router_with_config.record_error("deepseek-chat", "timeout")
        await router_with_config.record_success("deepseek-chat", latency=0.4)

        status = router_with_config.get_model_status("deepseek-chat")
        assert status is not None
        assert status.consecutive_errors == 0
        assert status.health.value == "healthy"

    @pytest.mark.asyncio
    async def test_health_report(self, router_with_config):
        """测试健康报告."""
        await router_with_config.record_success("doubao-seed2", latency=0.5)
        report = router_with_config.get_health_report()
        assert "total_models" in report
        assert "healthy" in report
        assert "degraded" in report
        assert "unavailable" in report
        assert report["total_models"] >= 3

    @pytest.mark.asyncio
    async def test_unknown_strategy_falls_to_default(self, router_with_config):
        """测试未知策略回退到default."""
        model = await router_with_config.route("nonexistent_strategy")
        assert model == "doubao-seed2"

    @pytest.mark.asyncio
    async def test_router_without_config(self, router):
        """测试无配置时的路由（空策略）."""
        model = await router.route("default")
        assert model == ""  # 无配置时返回空字符串

    def test_get_strategies(self, router_with_config):
        """测试获取策略列表."""
        strategies = router_with_config.get_strategies()
        assert "default" in strategies
        assert "content_writing" in strategies
        assert "code_generation" in strategies


# ============================================================
# ContentModerationChecker Tests
# ============================================================


class TestContentModerationChecker:
    """Tests for ContentModerationChecker 内容安全审核."""

    @pytest.fixture
    def checker(self):
        """创建ContentModerationChecker实例."""
        from flowforge.security.moderation import ContentModerationChecker

        return ContentModerationChecker()

    @pytest.mark.asyncio
    async def test_safe_content(self, checker):
        """测试安全内容通过审核."""
        result = await checker.check("今天天气很好，适合出门散步。")
        assert result.safe
        assert len(result.risk_tags) == 0
        assert "通过" in result.reason

    @pytest.mark.asyncio
    async def test_sensitive_words_violence(self, checker):
        """测试暴力敏感词检测."""
        result = await checker.check("这篇文章包含暴力内容描述")
        assert not result.safe
        assert "sensitive:violence" in result.risk_tags

    @pytest.mark.asyncio
    async def test_sensitive_words_adult(self, checker):
        """测试色情敏感词检测."""
        result = await checker.check("检测到色情内容需要过滤")
        assert not result.safe
        assert "sensitive:adult" in result.risk_tags

    @pytest.mark.asyncio
    async def test_sensitive_words_fraud(self, checker):
        """测试诈骗敏感词检测."""
        result = await checker.check("警惕网络诈骗行为")
        assert not result.safe
        assert "sensitive:fraud" in result.risk_tags

    @pytest.mark.asyncio
    async def test_privacy_phone_number(self, checker):
        """测试手机号隐私泄露检测."""
        result = await checker.check("请联系13800138000咨询详情")
        assert not result.safe
        assert "privacy:phone_number" in result.risk_tags

    @pytest.mark.asyncio
    async def test_privacy_id_number(self, checker):
        """测试身份证号隐私泄露检测."""
        result = await checker.check("身份证号110101199001011234需要核实")
        assert not result.safe
        assert "privacy:id_number" in result.risk_tags

    @pytest.mark.asyncio
    async def test_privacy_bank_card(self, checker):
        """测试银行卡号隐私泄露检测."""
        result = await checker.check("银行卡号6222021234567890123已绑定")
        assert not result.safe
        assert "privacy:bank_card" in result.risk_tags

    @pytest.mark.asyncio
    async def test_compliance_false_advertising(self, checker):
        """测试虚假宣传合规检测."""
        result = await checker.check("我们的产品100%有效，绝对治愈所有疾病")
        assert not result.safe
        assert "compliance:false_advertising" in result.risk_tags

    @pytest.mark.asyncio
    async def test_multiple_risks(self, checker):
        """测试多维度风险检测."""
        result = await checker.check("暴力内容，请联系13800138000，100%有效")
        assert not result.safe
        assert len(result.risk_tags) >= 3

    @pytest.mark.asyncio
    async def test_selective_check_types(self, checker):
        """测试选择性检查类型."""
        # 只检查隐私，不检查敏感词和合规
        result = await checker.check(
            "暴力内容，请联系13800138000",
            check_types=["privacy"],
        )
        assert not result.safe
        assert "privacy:phone_number" in result.risk_tags
        assert "sensitive:violence" not in result.risk_tags

    @pytest.mark.asyncio
    async def test_add_sensitive_words(self, checker):
        """测试动态添加敏感词."""
        checker.add_sensitive_words("custom", ["违禁词A", "违禁词B"])
        result = await checker.check("这里包含违禁词A的内容")
        assert not result.safe
        assert "sensitive:custom" in result.risk_tags

    @pytest.mark.asyncio
    async def test_moderation_result_model(self, checker):
        """测试ModerationResult模型."""
        result = await checker.check("安全内容")
        assert result.level.value == "L5"
        assert result.confidence > 0

    def test_get_status(self, checker):
        """测试获取审核器状态."""
        status = checker.get_status()
        assert "level" in status
        assert "categories" in status
        assert "category_word_counts" in status
        assert status["level"] == "L5"

    @pytest.mark.asyncio
    async def test_empty_content(self, checker):
        """测试空内容."""
        result = await checker.check("")
        assert result.safe

    @pytest.mark.asyncio
    async def test_safe_content_no_false_positive(self, checker):
        """测试正常内容无误报."""
        result = await checker.check("人工智能技术在医疗领域的应用前景广阔")
        assert result.safe
        assert len(result.risk_tags) == 0
