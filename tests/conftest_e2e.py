"""
FlowForge E2E测试配置 — 真实LLM测试基础设施
v9.0: 区分单元/集成测试环境，提供真实LLM测试上下文
"""

import os
import time
import json
import uuid
import pytest


@pytest.fixture
def use_real_llm():
    """通过环境变量 FLOWFORGE_REAL_LLM=1 启用真实LLM"""
    return os.environ.get("FLOWFORGE_REAL_LLM", "0") == "1"


@pytest.fixture
def e2e_base_url():
    """E2E测试基础URL"""
    return os.environ.get("FLOWFORGE_BASE_URL", "http://127.0.0.1:8000")


@pytest.fixture
def openroute_url():
    """OpenRoute代理URL"""
    return os.environ.get("FLOWFORGE_OPENROUTE_URL", "http://127.0.0.1:13000")


@pytest.fixture
async def real_llm_context(use_real_llm):
    """提供真实 LLM 的测试上下文"""
    if not use_real_llm:
        pytest.skip("需设置 FLOWFORGE_REAL_LLM=1 启用真实LLM测试")

    try:
        from flowforge.core.task_context import TaskContext
        from flowforge.events.event_bus import EventBus
        from flowforge.tools.llm_client import LLMClient
        from flowforge.tools.registry import ToolRegistry
    except ImportError:
        pytest.skip("FlowForge模块未安装")

    event_bus = EventBus()
    tool_registry = ToolRegistry()
    llm_client = LLMClient(event_bus=event_bus)
    tool_registry.register(llm_client)

    ctx = TaskContext(
        task_id=f"test_{uuid.uuid4().hex[:8]}",
        persona="test",
        input_data={},
    )
    ctx.tools = tool_registry
    ctx.event_bus = event_bus

    # 注入 MetricsCollector
    from tests.metrics_collector import TestMetricsCollector
    collector = TestMetricsCollector(event_bus, ctx.task_id)
    ctx._test_collector = collector

    yield ctx

    # 测试结束后输出报告
    collector.end_time = time.time()
    report = collector.generate_report()
    report_path = f"test_reports/{ctx.task_id}_metrics.json"
    os.makedirs("test_reports", exist_ok=True)
    collector.save_report(report_path)
    print(f"\n=== 测试指标报告 ({ctx.task_id}) ===")
    print(json.dumps(report, indent=2, ensure_ascii=False))


@pytest.fixture
def http_client():
    """提供HTTP测试客户端"""
    import httpx
    base_url = os.environ.get("FLOWFORGE_BASE_URL", "http://127.0.0.1:8000")
    return httpx.Client(base_url=base_url, timeout=180.0)


@pytest.fixture
def ws_client():
    """提供WebSocket测试客户端"""
    import websockets
    base_url = os.environ.get("FLOWFORGE_WS_URL", "ws://127.0.0.1:8000")
    return websockets.connect(f"{base_url}/ws/solo")
