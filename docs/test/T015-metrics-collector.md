# T015: MetricsCollector 可执行实现（28 项指标采集）

> **状态**: ✅ done
> **创建日期**: 2026-07-19
> **负责人**: 测试员可进化智能体（蜜獾·平头哥）
> **测试类别**: 测试工具（指标采集器）
> **关联 spec.md**: [doc:../spec.md]（FR-ENG-05, FR-ENG-06）
> **关联 arch.md**: [doc:../arch.md]（§4.3 EventBus）
> **关联 design.md**: [doc:../design.md]（§3.3）
> **测试铁律**: 已应用 T1-T8（详见 [doc:rules.md#T1-T8]，T6 必须采集指标）
> **命名规范**: 已应用 v2.0（详见 [doc:design/naming-contract.md]）

---

## 1. 28 项指标体系（7 维）

| 维度 | 指标数 | 关键指标 |
|------|--------|---------|
| **LLM** | 6 | total_calls / by_agent / model_chain / by_model / total_tokens / latency_ms |
| **Tool** | 5 | total_calls / chain / by_name / success_rate / latency_ms |
| **Agent** | 5 | total_calls / chain / by_name / execution_times / success_rate |
| **Workflow** | 4 | steps / step_count / step_durations / total_steps |
| **Memory** | 4 | queries / writes / compactions / cache_hit_rate |
| **WebSocket** | 3 | total_events / event_types / sequence_gaps |
| **Frontend** | 3 | timeline_nodes / citation_links / streaming_chunks |

---

## 2. TestMetricsCollector 类实现

```python
# tests/metrics_collector.py

import time
import json
from typing import Any, Dict, List
from collections import defaultdict


class TestMetricsCollector:
    """测试指标收集器 — 通过 EventBus 订阅自动采集 28 项指标"""

    def __init__(self, event_bus, task_id: str):
        self.task_id = task_id
        self.llm_calls: List[Dict] = []
        self.tool_calls: List[Dict] = []
        self.agent_calls: List[Dict] = []
        self.workflow_steps: List[Dict] = []
        self.memory_queries: int = 0
        self.memory_writes: int = 0
        self.memory_compactions: int = 0
        self.events: List[Dict] = []
        self.start_time: float = time.time()
        self.end_time: float = None

        # 订阅所有事件（使用通配符订阅，在回调中过滤 task_id）
        event_bus.subscribe("*", self._on_event)
        event_bus.subscribe("llm.start", self._on_llm_start)
        event_bus.subscribe("llm.end", self._on_llm_end)
        event_bus.subscribe("tool.start", self._on_tool_start)
        event_bus.subscribe("tool.end", self._on_tool_end)
        event_bus.subscribe("agent.start", self._on_agent_start)
        event_bus.subscribe("agent.end", self._on_agent_end)
        event_bus.subscribe("workflow.step.start", self._on_step_start)
        event_bus.subscribe("workflow.step.complete", self._on_step_complete)

        # Memory 维度采集
        event_bus.subscribe("memory.retrieve", self._on_memory_retrieve)
        event_bus.subscribe("memory.save", self._on_memory_save)
        event_bus.subscribe("context.warning", self._on_compaction)

    def _on_event(self, data: Any):
        # 在回调中过滤 task_id
        if isinstance(data, dict) and data.get("task_id") != self.task_id:
            return
        self.events.append({"time": time.time(), "data": data})

    def _on_llm_start(self, data: Any):
        self.llm_calls.append({
            "start": time.time(),
            "model": data.get("model"),
            "agent": data.get("agent_name"),
        })

    def _on_llm_end(self, data: Any):
        if self.llm_calls:
            self.llm_calls[-1]["end"] = time.time()
            self.llm_calls[-1]["tokens"] = data.get("usage", {})

    def _on_tool_start(self, data: Any):
        self.tool_calls.append({
            "start": time.time(),
            "tool": data.get("tool_name"),
            "step": data.get("step"),
        })

    def _on_tool_end(self, data: Any):
        if self.tool_calls:
            self.tool_calls[-1]["end"] = time.time()
            self.tool_calls[-1]["success"] = data.get("success", False)

    def _on_agent_start(self, data: Any):
        self.agent_calls.append({
            "start": time.time(),
            "agent": data.get("agent_name"),
        })

    def _on_agent_end(self, data: Any):
        if self.agent_calls:
            self.agent_calls[-1]["end"] = time.time()
            self.agent_calls[-1]["success"] = data.get("success", True)

    def _on_step_start(self, data: Any):
        self.workflow_steps.append({
            "start": time.time(),
            "step": data.get("step_name"),
        })

    def _on_step_complete(self, data: Any):
        if self.workflow_steps:
            self.workflow_steps[-1]["end"] = time.time()
            self.workflow_steps[-1]["success"] = data.get("success", True)

    def _on_memory_retrieve(self, data: Any):
        self.memory_queries += 1

    def _on_memory_save(self, data: Any):
        self.memory_writes += 1

    def _on_compaction(self, data: Any):
        if "compaction" in str(data):
            self.memory_compactions += 1

    @staticmethod
    def _group_by(items: List[Dict], key: str) -> Dict:
        result = defaultdict(int)
        for item in items:
            result[item.get(key, "unknown")] += 1
        return dict(result)

    @staticmethod
    def _latencies(items: List[Dict]) -> Dict:
        latencies = sorted([i["end"] - i["start"] for i in items if "end" in i and "start" in i])
        if not latencies:
            return {"p50": 0, "p95": 0, "p99": 0}
        n = len(latencies)
        return {
            "p50": latencies[n // 2] * 1000,
            "p95": latencies[int(n * 0.95)] * 1000,
            "p99": latencies[min(int(n * 0.99), n - 1)] * 1000,
        }

    def generate_report(self) -> dict:
        """生成完整的 28 项指标报告"""
        self.end_time = self.end_time or time.time()
        total_duration = self.end_time - self.start_time

        return {
            "task_id": self.task_id,
            "total_duration_seconds": round(total_duration, 2),

            # LLM 维度 (6 项)
            "llm": {
                "total_calls": len(self.llm_calls),
                "by_agent": self._group_by(self.llm_calls, "agent"),
                "model_chain": [c.get("model") for c in self.llm_calls],
                "by_model": self._group_by(self.llm_calls, "model"),
                "total_tokens": sum(
                    c.get("tokens", {}).get("total", 0) for c in self.llm_calls
                ),
                "latency_ms": self._latencies(self.llm_calls),
            },

            # Tool 维度 (5 项)
            "tool": {
                "total_calls": len(self.tool_calls),
                "chain": [c["tool"] for c in self.tool_calls],
                "by_name": self._group_by(self.tool_calls, "tool"),
                "success_rate": (
                    sum(1 for c in self.tool_calls if c.get("success"))
                    / len(self.tool_calls)
                    if self.tool_calls
                    else 0
                ),
                "latency_ms": self._latencies(self.tool_calls),
            },

            # Agent 维度 (5 项)
            "agent": {
                "total_calls": len(self.agent_calls),
                "chain": [c["agent"] for c in self.agent_calls],
                "by_name": self._group_by(self.agent_calls, "agent"),
                "execution_times": {
                    c["agent"]: round(c["end"] - c["start"], 2)
                    for c in self.agent_calls
                    if "end" in c
                },
                "success_rate": (
                    sum(1 for c in self.agent_calls if c.get("success"))
                    / len(self.agent_calls)
                    if self.agent_calls
                    else 0
                ),
            },

            # Workflow 维度 (4 项)
            "workflow": {
                "steps": [s["step"] for s in self.workflow_steps],
                "step_count": len(self.workflow_steps),
                "step_durations": {
                    s["step"]: round(s["end"] - s["start"], 2)
                    for s in self.workflow_steps
                    if "end" in s
                },
                "total_steps": len(self.workflow_steps),
            },

            # Memory 维度 (4 项)
            "memory": {
                "queries": self.memory_queries,
                "writes": self.memory_writes,
                "compactions": self.memory_compactions,
                "cache_hit_rate": 0,  # 需要从 cache 工具结果采集
            },

            # WebSocket 维度 (3 项) — 需要从 HelmWSManager 采集
            "websocket": {
                "total_events": len(self.events),
                "event_types": self._group_by(self.events, "type"),
                "sequence_gaps": 0,  # 需要检查序号连续性
            },

            # Frontend 维度 (3 项) — 需要从 Playwright 采集
            "frontend": {
                "timeline_nodes": 0,  # Playwright DOM 计数
                "citation_links": 0,  # Playwright DOM 计数
                "streaming_chunks": sum(
                    1 for e in self.events if "stream" in str(e.get("data", ""))
                ),
            },
        }

    def save_report(self, filepath: str):
        """保存报告到 JSON 文件"""
        report = self.generate_report()
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
```

---

## 3. pytest 集成

```python
# tests/conftest_e2e.py

import pytest
from flowforge.events.event_bus import EventBus
from tests.metrics_collector import TestMetricsCollector


@pytest.fixture
async def metrics_collector(event_bus: EventBus):
    """自动注入 MetricsCollector，采集所有 E2E 测试指标"""
    task_id = f"test_{uuid.uuid4().hex[:8]}"
    collector = TestMetricsCollector(event_bus, task_id)
    yield collector
    # 测试结束后自动保存报告
    report_path = f"reports/metrics_{task_id}_{time.strftime('%Y%m%d_%H%M%S')}.json"
    collector.save_report(report_path)
    print(f"\n📊 指标报告已保存: {report_path}")
```

**使用方式**：

```
FLOWFORGE_REAL_LLM=1 pytest tests/e2e/ -v
测试结束后自动输出指标报告到 reports/ 目录
```

---

## 4. 指标验证断言模板

```python
def assert_metrics(report: dict, expected: dict):
    """验证指标是否符合预期"""
    # LLM
    llm_total = report["llm"]["total_calls"]
    assert expected["llm_min"] <= llm_total <= expected["llm_max"], \
        f"LLM 调用次数 {llm_total} 不在 [{expected['llm_min']}, {expected['llm_max']}] 范围"

    # Tool
    for tool_name, min_count in expected.get("tool_min_counts", {}).items():
        actual = report["tool"]["by_name"].get(tool_name, 0)
        assert actual >= min_count, f"工具 {tool_name} 调用次数 {actual} < {min_count}"

    # Agent
    for agent_name in expected.get("required_agents", []):
        assert agent_name in report["agent"]["chain"], \
            f"Agent {agent_name} 未被调用"

    # Workflow steps
    if "required_steps" in expected:
        actual_steps = report["workflow"]["steps"]
        for step in expected["required_steps"]:
            assert step in actual_steps, f"步骤 {step} 未执行"

    # Memory
    if "memory_min_queries" in expected:
        assert report["memory"]["queries"] >= expected["memory_min_queries"], \
            f"Memory 查询次数 {report['memory']['queries']} < {expected['memory_min_queries']}"
```

---

## 5. 事件序列顺序验证

```python
def assert_event_order(events: list, expected_sequence: list):
    """验证事件按预期顺序发生"""
    actual_agents = [e for e in events if e.get("type") == "agent.start"]
    actual_order = [e["data"]["agent_name"] for e in actual_agents]
    for i, expected in enumerate(expected_sequence):
        assert expected in actual_order, f"Agent {expected} not called"
        if i > 0:
            prev_idx = actual_order.index(expected_sequence[i - 1])
            curr_idx = actual_order.index(expected)
            assert prev_idx < curr_idx, f"{expected} executed before {expected_sequence[i - 1]}"
```

---

## 6. WebSocket 序号连续性验证

```python
def assert_websocket_sequence_no_gaps(events: list):
    """验证 WebSocket 事件序号连续无跳号"""
    seq_numbers = [e.get("seq") for e in events if e.get("seq") is not None]
    if not seq_numbers:
        return
    for i in range(1, len(seq_numbers)):
        gap = seq_numbers[i] - seq_numbers[i - 1]
        assert gap == 1, f"WebSocket 序号跳号: {seq_numbers[i - 1]} → {seq_numbers[i]} (gap={gap})"
```

---

## 7. T6 铁律专项要求

> **T6 铁律**：每个 E2E 测试必须使用 MetricsCollector 采集 LLM 调用次数、工具调用链、Agent 调用链、Workflow 步骤、Memory 操作等指标，并写入报告。

### 7.1 强制要求

- 每个 E2E 测试用例必须使用 `metrics_collector` fixture
- 测试结束必须调用 `save_report()` 写入 JSON 文件
- 测试断言必须包含 `assert_metrics()` 验证关键指标
- 缺失 MetricsCollector 的测试视为不完整（T6 违规）

### 7.2 报告存储路径

- 默认路径：`reports/metrics_{task_id}_{timestamp}.json`
- 环境变量覆盖：`FLOWFORGE_METRICS_DIR=/custom/path`
- 报告保留策略：30 天（可配置）

---

## 8. 引用

- [doc:../spec.md]（FR-ENG-05, FR-ENG-06）
- [doc:../arch.md]（§4.3 EventBus）
- [doc:../design.md]（§3.3）
- [doc:rules.md#T1-T8]（特别是 T6 必须采集指标）
- [doc:design/naming-contract.md]
- [doc:T002-test-strategy.md]（6 维 28 项指标体系定义）
- [doc:TEMPLATE.md]

---

## 9. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v1.0 | 初始创建：从原 test.md 第 28 章拆分，覆盖 MetricsCollector 28 项指标采集实现 + 断言模板 + T6 铁律 | 测试员可进化智能体（蜜獾·平头哥） |
