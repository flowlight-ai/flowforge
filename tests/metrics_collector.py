"""
FlowForge 测试指标收集器 — 通过 EventBus 订阅自动采集 28 项指标
v9.0: 修复EventBus订阅方式（不支持task_id.*通配符），改用全局通配符+task_id过滤
"""

import time
import json
from typing import Any, Dict, List, Optional
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
        self.cache_hits: int = 0
        self.cache_misses: int = 0
        self.events: List[Dict] = []
        self.start_time: float = time.time()
        self.end_time: float = None

        # 订阅全局通配符，在回调中过滤task_id
        # v9.0 修复: EventBus不支持task_id.*通配符，改用"*"全局订阅
        event_bus.subscribe("*", self._on_event)

        # 订阅具体事件类型
        event_bus.subscribe("llm.start", self._on_llm_start)
        event_bus.subscribe("llm.end", self._on_llm_end)
        event_bus.subscribe("tool.start", self._on_tool_start)
        event_bus.subscribe("tool.end", self._on_tool_end)
        event_bus.subscribe("agent.start", self._on_agent_start)
        event_bus.subscribe("agent.end", self._on_agent_end)
        event_bus.subscribe("workflow.step.start", self._on_step_start)
        event_bus.subscribe("workflow.step.complete", self._on_step_complete)

        # Memory维度采集 (v9.0 新增)
        event_bus.subscribe("memory.retrieve", self._on_memory_retrieve)
        event_bus.subscribe("memory.save", self._on_memory_save)
        event_bus.subscribe("context.warning", self._on_compaction)

    def _filter_task(self, data: Any) -> bool:
        """过滤非当前task的事件"""
        if isinstance(data, dict):
            return data.get("task_id") == self.task_id or data.get("task_id") is None
        return True

    def _on_event(self, data: Any):
        if not self._filter_task(data):
            return
        self.events.append({"time": time.time(), "data": data})

    def _on_llm_start(self, data: Any):
        if not self._filter_task(data):
            return
        self.llm_calls.append({
            "start": time.time(),
            "model": data.get("model") if isinstance(data, dict) else None,
            "agent": data.get("agent_name") if isinstance(data, dict) else None,
        })

    def _on_llm_end(self, data: Any):
        if not self._filter_task(data):
            return
        if self.llm_calls:
            self.llm_calls[-1]["end"] = time.time()
            self.llm_calls[-1]["tokens"] = data.get("usage", {}) if isinstance(data, dict) else {}

    def _on_tool_start(self, data: Any):
        if not self._filter_task(data):
            return
        self.tool_calls.append({
            "start": time.time(),
            "tool": data.get("tool_name") if isinstance(data, dict) else None,
            "step": data.get("step") if isinstance(data, dict) else None,
        })

    def _on_tool_end(self, data: Any):
        if not self._filter_task(data):
            return
        if self.tool_calls:
            self.tool_calls[-1]["end"] = time.time()
            self.tool_calls[-1]["success"] = data.get("success", False) if isinstance(data, dict) else False
            # 缓存命中统计
            if isinstance(data, dict) and data.get("cached"):
                self.cache_hits += 1
            else:
                self.cache_misses += 1

    def _on_agent_start(self, data: Any):
        if not self._filter_task(data):
            return
        self.agent_calls.append({
            "start": time.time(),
            "agent": data.get("agent_name") if isinstance(data, dict) else None,
        })

    def _on_agent_end(self, data: Any):
        if not self._filter_task(data):
            return
        if self.agent_calls:
            self.agent_calls[-1]["end"] = time.time()
            self.agent_calls[-1]["success"] = data.get("success", True) if isinstance(data, dict) else True

    def _on_step_start(self, data: Any):
        if not self._filter_task(data):
            return
        self.workflow_steps.append({
            "start": time.time(),
            "step": data.get("step_name") if isinstance(data, dict) else None,
        })

    def _on_step_complete(self, data: Any):
        if not self._filter_task(data):
            return
        if self.workflow_steps:
            self.workflow_steps[-1]["end"] = time.time()
            self.workflow_steps[-1]["success"] = data.get("success", True) if isinstance(data, dict) else True

    def _on_memory_retrieve(self, data: Any):
        if not self._filter_task(data):
            return
        self.memory_queries += 1

    def _on_memory_save(self, data: Any):
        if not self._filter_task(data):
            return
        self.memory_writes += 1

    def _on_compaction(self, data: Any):
        if not self._filter_task(data):
            return
        if isinstance(data, dict) and "compaction" in str(data).lower():
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
            "p50": round(latencies[n // 2] * 1000, 1),
            "p95": round(latencies[int(n * 0.95)] * 1000, 1),
            "p99": round(latencies[min(int(n * 0.99), n - 1)] * 1000, 1),
        }

    def generate_report(self) -> dict:
        """生成完整的 28 项指标报告"""
        self.end_time = self.end_time or time.time()
        total_duration = self.end_time - self.start_time

        # WebSocket序号连续性检测
        sequence_gaps = 0
        solo_events = [e for e in self.events if "solo" in str(e.get("data", ""))]
        if len(solo_events) > 1:
            for i in range(1, len(solo_events)):
                prev_seq = solo_events[i-1].get("data", {}).get("seq", 0) if isinstance(solo_events[i-1].get("data"), dict) else 0
                curr_seq = solo_events[i].get("data", {}).get("seq", 0) if isinstance(solo_events[i].get("data"), dict) else 0
                if curr_seq - prev_seq > 1:
                    sequence_gaps += 1

        return {
            "task_id": self.task_id,
            "total_duration_seconds": round(total_duration, 2),

            # LLM 维度 (6项)
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

            # Tool 维度 (5项)
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

            # Agent 维度 (5项)
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

            # Workflow 维度 (4项)
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

            # Memory 维度 (4项) — v9.0 完整实现
            "memory": {
                "queries": self.memory_queries,
                "writes": self.memory_writes,
                "compactions": self.memory_compactions,
                "cache_hit_rate": (
                    self.cache_hits / (self.cache_hits + self.cache_misses)
                    if (self.cache_hits + self.cache_misses) > 0
                    else 0
                ),
            },

            # WebSocket 维度 (3项) — v9.0 完整实现
            "websocket": {
                "total_events": len(self.events),
                "event_types": self._group_by(self.events, "type"),
                "sequence_gaps": sequence_gaps,
            },

            # Frontend 维度 (3项) — 需要从Playwright采集
            "frontend": {
                "timeline_nodes": 0,  # 需Playwright DOM计数
                "citation_links": 0,  # 需Playwright DOM计数
                "streaming_chunks": sum(
                    1 for e in self.events if isinstance(e.get("data"), dict) and "stream" in str(e.get("data", ""))
                ),
            },
        }

    def save_report(self, filepath: str):
        """保存报告到JSON文件"""
        report = self.generate_report()
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)


def assert_metrics(report: dict, expected: dict):
    """验证指标是否符合预期"""
    # LLM
    llm_total = report["llm"]["total_calls"]
    assert expected["llm_min"] <= llm_total <= expected["llm_max"], \
        f"LLM调用次数{llm_total}不在[{expected['llm_min']},{expected['llm_max']}]范围"

    # Tool
    for tool_name, min_count in expected.get("tool_min_counts", {}).items():
        actual = report["tool"]["by_name"].get(tool_name, 0)
        assert actual >= min_count, f"工具{tool_name}调用次数{actual}<{min_count}"

    # Agent
    for agent_name in expected.get("required_agents", []):
        assert agent_name in report["agent"]["chain"], \
            f"Agent{agent_name}未被调用"

    # Workflow steps
    if "required_steps" in expected:
        actual_steps = report["workflow"]["steps"]
        for step in expected["required_steps"]:
            assert step in actual_steps, f"步骤{step}未执行"

    # Memory
    if "memory_min_queries" in expected:
        assert report["memory"]["queries"] >= expected["memory_min_queries"], \
            f"Memory查询次数{report['memory']['queries']}<{expected['memory_min_queries']}"


def assert_event_order(events: list, expected_sequence: list):
    """验证事件按预期顺序发生"""
    actual_agents = [e for e in events if isinstance(e.get("data"), dict) and e["data"].get("type") == "agent.start"]
    actual_order = [e["data"]["agent_name"] for e in actual_agents]
    for i, expected in enumerate(expected_sequence):
        assert expected in actual_order, f"Agent {expected} not called"
        if i > 0:
            prev_idx = actual_order.index(expected_sequence[i-1])
            curr_idx = actual_order.index(expected)
            assert prev_idx < curr_idx, f"{expected} executed before {expected_sequence[i-1]}"
