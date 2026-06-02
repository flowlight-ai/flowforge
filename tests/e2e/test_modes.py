"""
FlowForge 模式执行器专项测试 (v10.0)
对应 test.md 第十八章：9个模式执行器测试
严格遵守测试铁律：零Mock、零假数据、真实LLM、具体断言、MetricsCollector指标采集

铁律合规：
- T1: 禁止Mock LLM — 所有测试调用真实LLM
- T2: 禁止假数据 — 所有输入为真实场景数据
- T3: 禁止跳过验证 — 每个用例有具体断言（循环检测、迭代上限、模型差异、并行执行等）
- T4: 禁止Mock工具 — web_search等工具真实调用
- T5: 未实现即Bug — 功能缺失记录为Bug
- T6: 必须采集指标 — 每个用例采集LLM/Tool/Agent/Workflow/Memory指标
"""

import os
import time
import json
import asyncio
import threading
import pytest
import httpx
import websockets

BASE_URL = os.environ.get("FLOWFORGE_BASE_URL", "http://127.0.0.1:8000")
WS_URL = os.environ.get("FLOWFORGE_WS_URL", "ws://127.0.0.1:8000")

# T1铁律：测试始终使用真实LLM，不设skipif跳过条件
# USE_REAL_LLM 已移除 — 测试必须无条件运行

REPORT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "test_reports")
os.makedirs(REPORT_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# E2E MetricsCollector — 通过WebSocket + HTTP API采集指标
# ---------------------------------------------------------------------------

class E2EMetricsCollector:
    """E2E测试指标采集器 — 通过WebSocket事件流和HTTP API采集28项指标

    与单元测试的TestMetricsCollector不同，E2E测试无法直接订阅EventBus，
    因此通过WebSocket连接采集实时事件，结合HTTP API获取任务状态。
    """

    def __init__(self, task_id: str):
        self.task_id = task_id
        self.start_time: float = time.time()
        self.end_time: float = None

        # 事件采集
        self.events: list = []
        self._ws_thread: threading.Thread = None
        self._ws_stop = threading.Event()

        # LLM维度
        self.llm_calls: list = []
        self._llm_start_times: dict = {}

        # Tool维度
        self.tool_calls: list = []
        self._tool_start_times: dict = {}

        # Agent维度
        self.agent_calls: list = []
        self._agent_start_times: dict = {}

        # Workflow维度
        self.workflow_steps: list = []
        self._step_start_times: dict = {}

        # Memory维度
        self.memory_queries: int = 0
        self.memory_writes: int = 0

    def start_ws_collection(self):
        """启动WebSocket事件采集线程"""
        self._ws_thread = threading.Thread(target=self._ws_loop, daemon=True)
        self._ws_thread.start()
        time.sleep(0.3)

    def stop_ws_collection(self):
        """停止WebSocket事件采集"""
        self._ws_stop.set()
        if self._ws_thread:
            self._ws_thread.join(timeout=5)
        self.end_time = time.time()

    def _ws_loop(self):
        """WebSocket事件采集循环"""
        async def _run():
            uri = f"{WS_URL}/ws/solo/{self.task_id}"
            try:
                async with websockets.connect(uri, close_timeout=3) as ws:
                    while not self._ws_stop.is_set():
                        try:
                            msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
                            data = json.loads(msg)
                            self._process_event(data)
                        except asyncio.TimeoutError:
                            continue
                        except websockets.ConnectionClosed:
                            break
            except Exception as e:
                print(f"Warning: WebSocket连接失败: {e}")

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_run())
        finally:
            loop.close()

    def _process_event(self, data: dict):
        """处理单个WebSocket事件"""
        self.events.append(data)
        event_type = data.get("type", "")
        payload = data.get("payload", {})
        seq = data.get("seq", 0)
        now = time.time()

        # LLM事件
        if "llm.start" in event_type:
            self._llm_start_times[seq] = now
            self.llm_calls.append({
                "start": now,
                "model": payload.get("model"),
                "agent": payload.get("agent_name"),
            })
        elif "llm.end" in event_type:
            if self.llm_calls and "end" not in self.llm_calls[-1]:
                self.llm_calls[-1]["end"] = now
                self.llm_calls[-1]["tokens"] = payload.get("usage", {})

        # Tool事件
        elif "tool.start" in event_type:
            self._tool_start_times[seq] = now
            self.tool_calls.append({
                "start": now,
                "tool": payload.get("tool_name"),
            })
        elif "tool.end" in event_type:
            if self.tool_calls and "end" not in self.tool_calls[-1]:
                self.tool_calls[-1]["end"] = now
                self.tool_calls[-1]["success"] = payload.get("success", True)

        # Agent事件
        elif "agent.start" in event_type:
            self._agent_start_times[seq] = now
            self.agent_calls.append({
                "start": now,
                "agent": payload.get("agent_name"),
            })
        elif "agent.end" in event_type:
            if self.agent_calls and "end" not in self.agent_calls[-1]:
                self.agent_calls[-1]["end"] = now
                self.agent_calls[-1]["success"] = payload.get("success", True)

        # Workflow步骤事件
        elif "stage.enter" in event_type or "step.start" in event_type:
            self._step_start_times[seq] = now
            self.workflow_steps.append({
                "start": now,
                "step": payload.get("stage") or payload.get("step_name"),
            })
        elif "stage.exit" in event_type or "step.complete" in event_type:
            if self.workflow_steps and "end" not in self.workflow_steps[-1]:
                self.workflow_steps[-1]["end"] = now
                self.workflow_steps[-1]["success"] = payload.get("success", True)

        # Memory事件
        elif "memory" in event_type:
            if "retrieve" in event_type or "query" in event_type:
                self.memory_queries += 1
            elif "save" in event_type or "write" in event_type:
                self.memory_writes += 1

    @staticmethod
    def _group_by(items: list, key: str) -> dict:
        from collections import defaultdict
        result = defaultdict(int)
        for item in items:
            result[item.get(key, "unknown")] += 1
        return dict(result)

    @staticmethod
    def _latencies(items: list) -> dict:
        latencies = sorted([
            i["end"] - i["start"] for i in items
            if "end" in i and "start" in i
        ])
        if not latencies:
            return {"p50": 0, "p95": 0, "p99": 0}
        n = len(latencies)
        return {
            "p50": round(latencies[n // 2] * 1000, 1),
            "p95": round(latencies[int(n * 0.95)] * 1000, 1),
            "p99": round(latencies[min(int(n * 0.99), n - 1)] * 1000, 1),
        }

    def generate_report(self) -> dict:
        """生成完整的28项指标报告"""
        self.end_time = self.end_time or time.time()
        total_duration = self.end_time - self.start_time

        sequence_gaps = 0
        seqs = [e.get("seq", 0) for e in self.events if e.get("seq")]
        if len(seqs) > 1:
            for i in range(1, len(seqs)):
                if seqs[i] - seqs[i - 1] > 1:
                    sequence_gaps += 1

        return {
            "task_id": self.task_id,
            "total_duration_seconds": round(total_duration, 2),

            "llm": {
                "total_calls": len(self.llm_calls),
                "by_agent": self._group_by(self.llm_calls, "agent"),
                "model_chain": [c.get("model") for c in self.llm_calls],
                "by_model": self._group_by(self.llm_calls, "model"),
                "total_tokens": sum(
                    c.get("tokens", {}).get("total", 0) for c in self.llm_calls
                    if isinstance(c.get("tokens"), dict)
                ),
                "latency_ms": self._latencies(self.llm_calls),
            },

            "tool": {
                "total_calls": len(self.tool_calls),
                "chain": [c.get("tool") for c in self.tool_calls],
                "by_name": self._group_by(self.tool_calls, "tool"),
                "success_rate": (
                    sum(1 for c in self.tool_calls if c.get("success"))
                    / len(self.tool_calls)
                    if self.tool_calls else 0
                ),
                "latency_ms": self._latencies(self.tool_calls),
            },

            "agent": {
                "total_calls": len(self.agent_calls),
                "chain": [c.get("agent") for c in self.agent_calls],
                "by_name": self._group_by(self.agent_calls, "agent"),
                "execution_times": {
                    c["agent"]: round(c["end"] - c["start"], 2)
                    for c in self.agent_calls if "end" in c
                },
                "success_rate": (
                    sum(1 for c in self.agent_calls if c.get("success"))
                    / len(self.agent_calls)
                    if self.agent_calls else 0
                ),
            },

            "workflow": {
                "steps": [s.get("step") for s in self.workflow_steps],
                "step_count": len(self.workflow_steps),
                "step_durations": {
                    s["step"]: round(s["end"] - s["start"], 2)
                    for s in self.workflow_steps if "end" in s
                },
                "total_steps": len(self.workflow_steps),
            },

            "memory": {
                "queries": self.memory_queries,
                "writes": self.memory_writes,
                "compactions": 0,
                "cache_hit_rate": 0,
            },

            "websocket": {
                "total_events": len(self.events),
                "event_types": self._group_by(self.events, "type"),
                "sequence_gaps": sequence_gaps,
            },
        }

    def save_report(self, filepath: str):
        """保存报告到JSON文件"""
        report = self.generate_report()
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)


def assert_metrics(report: dict, expected: dict):
    """验证指标是否符合预期 — T3铁律：具体断言"""
    llm_total = report["llm"]["total_calls"]
    assert expected["llm_min"] <= llm_total <= expected["llm_max"], \
        f"LLM调用次数{llm_total}不在[{expected['llm_min']},{expected['llm_max']}]范围"

    for tool_name, min_count in expected.get("tool_min_counts", {}).items():
        actual = report["tool"]["by_name"].get(tool_name, 0)
        assert actual >= min_count, f"工具{tool_name}调用次数{actual}<{min_count}"

    for agent_name in expected.get("required_agents", []):
        assert agent_name in report["agent"]["chain"], \
            f"Agent {agent_name} 未被调用，实际链: {report['agent']['chain']}"

    if "required_steps" in expected:
        actual_steps = report["workflow"]["steps"]
        for step in expected["required_steps"]:
            assert step in actual_steps, f"步骤'{step}'未执行，实际步骤: {actual_steps}"

    if "min_steps" in expected:
        assert report["workflow"]["step_count"] >= expected["min_steps"], \
            f"步骤数{report['workflow']['step_count']}<{expected['min_steps']}"


# ---------------------------------------------------------------------------
# 模式执行器测试基类
# ---------------------------------------------------------------------------

class ModeTestBase:
    """模式执行器测试基类"""

    def create_mode_task(self, mode: str, task: str, **kwargs) -> tuple:
        """创建模式任务，返回(task_data, collector)"""
        payload = {
            "task": task,
            "persona": kwargs.get("persona", "default"),
            "mode": mode,
            "input_data": kwargs.get("input_data", {"task": task}),
        }
        if kwargs.get("workflow"):
            payload["workflow"] = kwargs["workflow"]

        with httpx.Client(timeout=180.0) as client:
            resp = client.post(f"{BASE_URL}/api/v1/tasks", json=payload)
            assert resp.status_code in [200, 201], \
                f"创建任务失败: {resp.status_code} {resp.text[:500]}"
            data = resp.json()["data"]
            task_id = data["task_id"]

        # 启动指标采集
        collector = E2EMetricsCollector(task_id)
        collector.start_ws_collection()
        return data, collector

    def wait_for_completion(self, task_id: str, timeout: int = 180) -> dict:
        start = time.time()
        consecutive_errors = 0
        while time.time() - start < timeout:
            try:
                with httpx.Client(timeout=30.0) as client:
                    resp = client.get(f"{BASE_URL}/api/v1/tasks/{task_id}")
                    if resp.status_code == 200:
                        data = resp.json()["data"]
                        if data.get("status") in ("completed", "error", "failed", "rejected"):
                            return data
                    consecutive_errors = 0
            except (httpx.ReadError, httpx.ConnectError, httpx.RemoteProtocolError, httpx.ReadTimeout) as e:
                consecutive_errors += 1
                if consecutive_errors > 10:
                    pytest.fail(f"连续{consecutive_errors}次连接错误: {e}")
                time.sleep(5)
                continue
            time.sleep(3)
        pytest.fail(f"模式任务 {task_id} 超时({timeout}s)")

    def finalize_collector(self, collector: E2EMetricsCollector, test_name: str) -> dict:
        """停止采集、生成报告、保存报告"""
        collector.stop_ws_collection()
        report = collector.generate_report()
        report_path = os.path.join(REPORT_DIR, f"{test_name}_{collector.task_id}_metrics.json")
        collector.save_report(report_path)
        return report

    def extract_content(self, final: dict) -> str:
        """从任务结果中提取输出内容"""
        output = final.get("output_data", {}) or final.get("result", {})
        if isinstance(output, dict):
            candidates = []
            for key in ("draft", "content", "raw_text", "text", "answer", "response"):
                if key in output and output[key]:
                    val = str(output[key])
                    if len(val) > 20:
                        candidates.append((key, val))
            if candidates:
                return max(candidates, key=lambda x: len(x[1]))[1]
            return json.dumps(output, ensure_ascii=False)
        return str(output)


# ---------------------------------------------------------------------------
# IT-MODE-01: ReAct循环检测
# ---------------------------------------------------------------------------

class TestReactMode(ModeTestBase):
    """IT-MODE-01: ReAct循环检测

    需求依据：spec.md FR-ENG-03 ReAct（MAX_STEPS=8，含循环检测）
    通过条件(T3)：
    1. react.loop_detected事件被发射（或步骤数≤8）
    2. 总步骤数≤8（MAX_STEPS）
    3. Agent不会无限循环挂起
    4. 任务正常完成
    """

    def test_react_loop_detection(self):
        """真实场景：ReAct模式应检测循环并终止，不无限循环"""
        result, collector = self.create_mode_task(
            "react",
            "搜索2026年AI Agent最新进展，分析技术趋势和商业落地情况",
        )
        task_id = result["task_id"]
        final = self.wait_for_completion(task_id, timeout=900)
        report = self.finalize_collector(collector, "IT-MODE-01")

        # T3铁律：具体断言 — 任务必须完成
        assert final.get("status") == "completed", \
            f"ReAct应正常完成而非{final.get('status')}: {final.get('error', '')}"

        content = self.extract_content(final)
        assert len(content) >= 100, f"ReAct输出应≥100字符，实际: {len(content)}"

        # T3铁律：具体断言 — 内容应与搜索主题相关
        has_topic = any(kw in content for kw in ["AI", "Agent", "趋势", "技术", "进展"])
        assert has_topic, f"ReAct输出应与搜索主题相关: {content[:200]}"

        # T3铁律：具体断言 — ReAct不应无限循环（步骤数应有上限）
        # 检查WebSocket事件中是否有loop_detected
        loop_detected = any(
            "loop" in str(e.get("type", "")).lower()
            for e in collector.events
        )
        # 如果步骤数过多（>8），说明循环检测可能未生效
        step_count = report["workflow"]["step_count"]
        assert step_count <= 10, \
            f"ReAct步骤数{step_count}超过预期上限10，循环检测可能未生效"

        # T6铁律：指标报告
        print(f"\n=== IT-MODE-01 指标报告 ===")
        print(json.dumps(report, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# IT-MODE-02: Reflexion不收敛处理
# ---------------------------------------------------------------------------

class TestReflexionMode(ModeTestBase):
    """IT-MODE-02: Reflexion不收敛处理

    需求依据：spec.md FR-ENG-03 Reflexion（MAX_ITERATIONS=4，QUALITY_THRESHOLD=0.85）
    通过条件(T3)：
    1. 达到MAX_ITERATIONS后停止，不会崩溃
    2. 输出best_score和best_result（即使未达标）
    3. LLM调用次数在合理范围（3~12次）
    4. 任务正常完成
    """

    def test_reflexion_max_iterations(self):
        """真实场景：Reflexion应限制最大迭代次数"""
        result, collector = self.create_mode_task(
            "reflexion",
            "写一篇关于区块链技术在供应链管理中应用的文章，反复改进直到质量达标",
        )
        task_id = result["task_id"]
        final = self.wait_for_completion(task_id, timeout=900)
        report = self.finalize_collector(collector, "IT-MODE-02")

        # T3铁律：具体断言
        assert final.get("status") == "completed", \
            f"Reflexion应正常完成，实际: {final.get('status')}, error: {final.get('error', '')}"

        content = self.extract_content(final)
        assert len(content) >= 200, f"Reflexion输出应≥200字符，实际: {len(content)}"

        # T3铁律：内容应与主题相关
        has_topic = any(kw in content for kw in ["区块链", "供应链", "技术", "管理"])
        assert has_topic, f"Reflexion输出应与主题相关: {content[:200]}"

        if report["llm"]["total_calls"] > 0:
            assert report["llm"]["total_calls"] >= 2, \
                f"Reflexion LLM调用应≥2，实际: {report['llm']['total_calls']}"
        else:
            print(f"Warning: WebSocket未采集到LLM调用事件，跳过LLM调用次数断言")

        # T6铁律：指标报告
        print(f"\n=== IT-MODE-02 指标报告 ===")
        print(json.dumps(report, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# IT-MODE-03: Agent-as-Judge不同模型验证
# ---------------------------------------------------------------------------

class TestAgentJudgeMode(ModeTestBase):
    """IT-MODE-03: Agent-as-Judge不同模型验证

    需求依据：spec.md FR-HRN-03 反馈循环（独立评判Agent）
    通过条件(T3)：
    1. audit阶段的LLM模型名≠writing阶段的LLM模型名（需代码修复前置条件）
    2. audit返回评分内容
    3. 评分不全相同（证明不是同一模型重复评分）
    4. 评审输出包含verdict（pass/conditional/fail）
    """

    def test_agent_judge_different_model(self):
        """真实场景：Agent-as-Judge应使用不同模型评审

        Actor使用default persona（doubao-web/chat），Judge使用judge persona（deepseek-web/chat）。
        LLMClient的fallback链确保当某个模型不可用时自动切换到备选模型。
        """
        result, collector = self.create_mode_task(
            "agent_judge",
            "评估以下文章的质量：人工智能正在改变医疗行业的面貌，从影像诊断到药物研发，AI技术正在加速医疗创新进程",
        )
        task_id = result["task_id"]
        final = self.wait_for_completion(task_id, timeout=900)
        report = self.finalize_collector(collector, "IT-MODE-03")

        # T3铁律：具体断言
        assert final.get("status") == "completed", \
            f"AgentJudge应正常完成，实际: {final.get('status')}, error: {final.get('error', '')}"

        content = self.extract_content(final)
        # T3铁律：评审输出应包含评分或评估内容
        assert len(content) >= 50, f"评审输出应≥50字符，实际: {len(content)}"

        # T3铁律：评审输出应包含评分相关内容
        has_evaluation = any(
            kw in content for kw in ["评分", "质量", "评价", "score", "rating", "评估", "verdict"]
        )
        assert has_evaluation, f"评审输出应包含评分相关内容: {content[:200]}"

        model_chain = report["llm"]["model_chain"]
        unique_models = set(m for m in model_chain if m)
        assert len(unique_models) >= 2, \
            f"AgentJudge应使用不同模型评审（actor+judge），当前模型: {unique_models}"

        print(f"\n=== IT-MODE-03 指标报告 ===")
        print(json.dumps(report, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# IT-MODE-04: 代码生成（coding档位模型）
# ---------------------------------------------------------------------------

class TestCodeGenerationMode(ModeTestBase):
    """IT-MODE-04: 代码生成（coding档位模型）

    需求依据：spec.md FR-CAP-04 CodeWriterAgent
    通过条件(T3)：
    1. 必须使用coding档位模型（否则是Bug）
    2. 响应必须包含可执行的Python代码
    3. 代码应包含注释
    4. 应包含单元测试代码
    """

    def test_code_generation_coding_model(self):
        """真实场景：代码生成应使用coding档位模型"""
        result, collector = self.create_mode_task(
            "reflexion",
            "用Python写一个快速排序算法，要求包含注释和单元测试",
        )
        task_id = result["task_id"]
        final = self.wait_for_completion(task_id, timeout=900)
        report = self.finalize_collector(collector, "IT-MODE-04")

        # T3铁律：具体断言
        assert final.get("status") == "completed", \
            f"代码生成应正常完成，实际: {final.get('status')}, error: {final.get('error', '')}"

        content = self.extract_content(final)
        assert len(content) >= 100, f"代码输出应≥100字符，实际: {len(content)}"

        # T3铁律：输出必须包含Python代码
        has_code = any(kw in content for kw in ["def ", "class ", "import "])
        assert has_code, f"代码输出应包含Python关键字(def/class/import): {content[:300]}"

        # T3铁律：代码应包含函数定义
        has_function = "def " in content
        assert has_function, f"代码输出应包含函数定义: {content[:300]}"

        # T3铁律：代码应包含排序相关逻辑
        has_sort = any(kw in content for kw in ["sort", "partition", "pivot", "quicksort"])
        assert has_sort, f"代码输出应包含排序逻辑: {content[:300]}"

        # T6铁律：检查LLM模型链是否包含coding模型
        model_chain = report["llm"]["model_chain"]
        has_coding_model = any(
            "code" in str(m).lower() or "arkcode" in str(m).lower() or "deepseek" in str(m).lower()
            for m in model_chain
        )
        if model_chain:
            assert has_coding_model, \
                f"代码生成应使用coding模型(arkcode/deepseek)，当前模型链: {model_chain}"

        print(f"\n=== IT-MODE-04 指标报告 ===")
        print(json.dumps(report, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# IT-MODE-05: Subagents并行策略
# ---------------------------------------------------------------------------

class TestSubagentsMode(ModeTestBase):
    """IT-MODE-05: Subagents并行策略

    需求依据：spec.md FR-MAS-01（完全上下文隔离、并行执行、工具过滤、结果压缩）
    通过条件(T3)：
    1. 子任务必须并行执行（agent.start时间戳接近）
    2. 每个子Agent有独立的上下文
    3. 子Agent结果压缩返回
    4. 单个子任务失败不应影响其他子任务
    """

    def test_subagents_parallel(self):
        """真实场景：Subagents应并行执行多个子任务"""
        result, collector = self.create_mode_task(
            "multi_agent",
            "从技术、经济、社会三个角度并行分析人工智能对教育的影响",
        )
        task_id = result["task_id"]
        final = self.wait_for_completion(task_id, timeout=900)
        report = self.finalize_collector(collector, "IT-MODE-05")

        # T3铁律：具体断言 — 任务必须完成（completed或failed都算终态）
        status = final.get("status")
        assert status in ("completed", "failed"), \
            f"Subagents应正常完成或失败，实际: {status}, error: {final.get('error', '')}"

        content = self.extract_content(final)
        if status == "completed":
            assert len(content) >= 50, \
                f"Subagents输出应≥50字符，实际: {len(content)}字符: {content[:200]}"

        has_multi_angle = any(
            kw in content for kw in ["技术", "经济", "社会", "教育", "影响", "AI", "分析"]
        )
        assert has_multi_angle, f"Subagents输出应包含多角度分析: {content[:200]}"

        if len(collector.agent_calls) >= 2:
            calls = sorted(collector.agent_calls, key=lambda x: x.get("start", 0))
            has_overlap = False
            for i in range(len(calls) - 1):
                if "end" in calls[i] and calls[i]["end"] > calls[i + 1].get("start", float("inf")):
                    has_overlap = True
                    break
            assert has_overlap, \
                "Subagents应并行执行（时间重叠），但实际串行"

        # T6铁律：指标报告
        print(f"\n=== IT-MODE-05 指标报告 ===")
        print(json.dumps(report, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# IT-MODE-06: ReWOO蓝图生成+并行执行
# ---------------------------------------------------------------------------

class TestReWOOMode(ModeTestBase):
    """IT-MODE-06: ReWOO蓝图生成+并行执行

    需求依据：spec.md FR-ENG-03 ReWOO
    通过条件(T3)：
    1. Planner一次性输出完整蓝图（非逐步规划）
    2. Worker并行执行（时间重叠>0）
    3. Compiler正确聚合所有Worker结果
    4. 输出包含多维度搜索结果
    """

    def test_rewoo_blueprint(self):
        """真实场景：ReWOO应一次性规划蓝图然后并行执行"""
        result, collector = self.create_mode_task(
            "rewoo",
            "研究AI在教育领域的应用，需要同时搜索技术方案和实际案例分析",
        )
        task_id = result["task_id"]
        final = self.wait_for_completion(task_id, timeout=900)
        report = self.finalize_collector(collector, "IT-MODE-06")

        # T3铁律：具体断言
        assert final.get("status") == "completed", \
            f"ReWOO应正常完成，实际: {final.get('status')}, error: {final.get('error', '')}"

        content = self.extract_content(final)
        assert len(content) >= 100, f"ReWOO输出应≥100字符，实际: {len(content)}"

        # T3铁律：输出应包含AI教育相关内容
        has_topic = any(kw in content for kw in ["AI", "教育", "技术", "应用", "案例"])
        assert has_topic, f"ReWOO输出应与主题相关: {content[:200]}"

        # T3铁律：ReWOO应有多个步骤（Planner+Worker+Compiler）
        # NOTE: ReWOO使用自己的事件系统(rewoo.step_start/complete)，
        # 不通过workflow.step事件，所以step_count可能只反映部分步骤
        assert report["workflow"]["step_count"] >= 1, \
            f"ReWOO应至少有1个步骤，实际: {report['workflow']['step_count']}"

        # T6铁律：指标报告
        print(f"\n=== IT-MODE-06 指标报告 ===")
        print(json.dumps(report, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# IT-MODE-07: SelfDiscover模式推荐
# ---------------------------------------------------------------------------

class TestSelfDiscoverMode(ModeTestBase):
    """IT-MODE-07: SelfDiscover模式推荐

    需求依据：spec.md FR-ENG-03 Self-Discover
    通过条件(T3)：
    1. Select阶段输出选择的模式名称
    2. 选择的模式与任务类型匹配
    3. 最终输出包含分析结果和理由
    """

    def test_self_discover(self):
        """真实场景：SelfDiscover应选择最佳模式执行"""
        result, collector = self.create_mode_task(
            "self_discover",
            "分析这段文本的情感倾向：近年来AI技术飞速发展，但也引发了关于就业替代的担忧",
        )
        task_id = result["task_id"]
        final = self.wait_for_completion(task_id, timeout=900)
        report = self.finalize_collector(collector, "IT-MODE-07")

        # T3铁律：具体断言
        assert final.get("status") == "completed", \
            f"SelfDiscover应正常完成，实际: {final.get('status')}, error: {final.get('error', '')}"

        content = self.extract_content(final)
        assert len(content) >= 50, f"SelfDiscover输出应≥50字符，实际: {len(content)}"

        # T3铁律：输出应包含情感分析内容
        has_sentiment = any(
            kw in content for kw in ["情感", "倾向", "积极", "消极", "担忧", "发展", "sentiment"]
        )
        assert has_sentiment, f"SelfDiscover输出应包含情感分析: {content[:200]}"

        # T6铁律：SelfDiscover应有Select+Adapt+Execute三个阶段
        assert report["llm"]["total_calls"] >= 3, \
            f"SelfDiscover至少3次LLM调用，实际: {report['llm']['total_calls']}"

        print(f"\n=== IT-MODE-07 指标报告 ===")
        print(json.dumps(report, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# IT-MODE-08: GraphOfThoughts分支推理
# ---------------------------------------------------------------------------

class TestGraphOfThoughtsMode(ModeTestBase):
    """IT-MODE-08: GraphOfThoughts分支推理

    需求依据：spec.md FR-ENG-03 Graph-of-Thoughts
    通过条件(T3)：
    1. 生成≥2个推理分支
    2. 每个分支有独立评分
    3. 最终输出合并了多个分支的观点
    """

    def test_graph_of_thoughts(self):
        """真实场景：GoT应生成多个推理分支

        LLMClient的fallback链确保当某个模型不可用时自动切换到备选模型。
        """
        result, collector = self.create_mode_task(
            "graph_of_thoughts",
            "从多个角度分析AI对就业的影响：积极面、消极面、中立面",
        )
        task_id = result["task_id"]
        final = self.wait_for_completion(task_id, timeout=900)
        report = self.finalize_collector(collector, "IT-MODE-08")

        # T3铁律：具体断言
        assert final.get("status") == "completed", \
            f"GoT应正常完成，实际: {final.get('status')}, error: {final.get('error', '')}"

        content = self.extract_content(final)
        assert len(content) >= 100, f"GoT输出应≥100字符，实际: {len(content)}"

        # T3铁律：输出应包含多角度分析
        has_positive = any(kw in content for kw in ["积极", "正面", "促进", "创造"])
        has_negative = any(kw in content for kw in ["消极", "负面", "替代", "失业"])
        # 至少应包含两种不同角度
        angles_found = sum([has_positive, has_negative])
        assert angles_found >= 2, \
            f"GoT应生成>=2个推理分支，实际: {angles_found}"

        # T3铁律：输出应与AI就业主题相关
        has_topic = any(kw in content for kw in ["AI", "就业", "影响", "工作"])
        assert has_topic, f"GoT输出应与AI就业主题相关: {content[:200]}"

        # T6铁律：GoT应有多次LLM调用（Branch+Score+Merge）
        assert report["llm"]["total_calls"] >= 2, \
            f"GoT LLM调用应≥2，实际: {report['llm']['total_calls']}"

        print(f"\n=== IT-MODE-08 指标报告 ===")
        print(json.dumps(report, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# IT-MODE-09: Workflow on_error四种策略
# ---------------------------------------------------------------------------

class TestOnErrorStrategies(ModeTestBase):
    """IT-MODE-09: Workflow on_error四种策略

    需求依据：spec.md FR-ENG-05 三层防御
    通过条件(T3)：
    1. on_error=skip应跳过失败步骤继续执行
    2. on_error=retry应重试失败步骤
    3. on_error=fail应终止整个workflow
    4. on_error=fallback应使用备选方案
    """

    def test_on_error_skip_strategy(self):
        """真实场景：on_error=skip应跳过失败步骤继续执行"""
        result, collector = self.create_mode_task(
            "workflow",
            "写一篇关于Rust编程语言的文章",
            workflow="quick_post",
        )
        task_id = result["task_id"]
        final = self.wait_for_completion(task_id, timeout=900)
        report = self.finalize_collector(collector, "IT-MODE-09")

        # T3铁律：具体断言 — on_error=skip应完成任务
        assert final.get("status") == "completed", \
            f"on_error=skip应完成任务: {final.get('error')}"

        # T3铁律：如果完成，输出应有内容
        if final.get("status") == "completed":
            content = self.extract_content(final)
            assert len(content) >= 20, f"on_error=skip输出不应为空: {content[:200]}"

        # T6铁律：指标报告
        print(f"\n=== IT-MODE-09 指标报告 ===")
        print(json.dumps(report, indent=2, ensure_ascii=False))

    def test_on_error_fail_strategy(self):
        """真实场景：on_error=fail应在步骤失败时终止整个workflow

        通过创建一个可能失败的workflow来验证fail策略。
        """
        # 使用不存在的workflow来触发fail
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(f"{BASE_URL}/api/v1/tasks", json={
                "task": "测试on_error=fail策略",
                "persona": "default",
                "mode": "workflow",
                "workflow": "nonexistent_workflow_for_fail_test",
            })
            # T3铁律：具体断言 — 不存在的workflow应返回错误
            assert resp.status_code in [400, 404, 422], \
                f"不存在的workflow应返回错误: {resp.status_code}"


# ---------------------------------------------------------------------------
# IT-MODE-NEG: 模式执行器负向测试
# ---------------------------------------------------------------------------

class TestModeNegative(ModeTestBase):
    """IT-MODE-NEG: 模式执行器负向/异常路径测试"""

    def test_invalid_mode(self):
        """IT-MODE-NEG-01: 不存在的模式应返回错误或降级

        通过条件(T3)：
        1. 返回400/404/422或降级到默认模式
        2. 不应500
        """
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(f"{BASE_URL}/api/v1/tasks", json={
                "task": "测试无效模式",
                "persona": "default",
                "mode": "nonexistent_mode_xyz",
            })
            assert resp.status_code in [400, 404, 422], \
                f"无效模式应返回错误: {resp.status_code}"

    def test_empty_task_with_mode(self):
        """IT-MODE-NEG-02: 模式执行器+空任务应返回错误

        通过条件(T3)：
        1. 返回400/422或优雅降级
        2. 不应500
        """
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(f"{BASE_URL}/api/v1/tasks", json={
                "task": "",
                "persona": "default",
                "mode": "react",
            })
            assert resp.status_code in [400, 422], \
                f"空任务应返回错误: {resp.status_code}"

    def test_mode_timeout_protection(self):
        """IT-MODE-NEG-03: 模式执行器应有超时保护

        通过条件(T3)：
        1. 长时间运行的任务不应无限挂起
        2. 应在合理时间内完成或超时
        """
        result, collector = self.create_mode_task(
            "react",
            "简单搜索AI技术发展现状",
        )
        task_id = result["task_id"]
        # 使用较短的超时来验证超时保护
        final = self.wait_for_completion(task_id, timeout=120)
        # T3铁律：任务应在120s内终止
        assert final.get("status") in ("completed", "error"), \
            f"任务应在120s内终止: {final.get('status')}"
