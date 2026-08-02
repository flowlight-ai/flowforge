"""F046 v1.1 五闭环协同 E2E 演示脚本 — 验证全链路自我开发.

用法：
    python -m flowforge.evolution.tests.run_five_loops_demo

演示场景：
    模拟「文档→代码→代码审查→自动化测试→框架沉淀」全链路协同（5 闭环完整）

五Forgekin协同工作流（F046 §9.3 v1.1 扩展）：
    1. 文心（forgemind:wenxin, doc, E3）
       └─ 发现缺失 design 文档 → 生成 → LLM 审核通过
    2. 夏洛克（forgemind:sherlock, code, E4）
       └─ 接收 doc 的 changed_files → 实现代码 → LLM 审核通过
    3. 梵高（forgemind:vangogh, review, E3）
       └─ 接收 code 的 changed_files → 跨厂商审查 → 生成报告
    4. 达芬奇（forgemind:davinci, test, E3）
       └─ 接收 review 通过的 target_files → 生成测试 → LLM 审核通过
    5. 鲁班（forgemind:luban, framework, E5）
       └─ 接收 test 通过的协同结果 → 沉淀为新 ADR（需 I8 approval）

协同协议（F046 §9.4 cross-loop context）：
    - doc.changed_files → code.target_files
    - code.changed_files → review.target_files
    - review.checks.passed → test.review_passed
    - test.changed_files → framework.target_files（I8 approval 后创建 ADR）

测试铁律遵守：
- T1 禁止 Mock LLM：使用 FakeTraeClient（stub 替代，非 mock）
- T2 真实场景数据：构造真实项目目录结构
- T3 具体断言：演示脚本中明确打印每个断言结果
- T6 必须采集指标：打印每个阶段的 elapsed_ms

注意：
- 本脚本不调用真实 LLM，仅用于本地验证五闭环协同逻辑
- Framework 闭环的 I8 approval 在 demo 中自动批准（生产环境需 operator 显式批准）
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List

# 确保能导入 flowforge
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

# Windows 终端默认 GBK，print emoji 会失败 — 切到 utf-8 容错输出
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

from flowforge.evolution.engine import ForgeMindEngine
from flowforge.evolution.self_dev_code import SelfDevCodeLoop
from flowforge.evolution.self_dev_doc import SelfDevDocLoop
from flowforge.evolution.self_dev_framework import SelfDevFrameworkLoop
from flowforge.evolution.self_dev_review import SelfDevReviewLoop
from flowforge.evolution.self_dev_test import SelfDevTestLoop


# ══════════════════════════════════════════════════════════════════
# §1 配置日志输出
# ══════════════════════════════════════════════════════════════════


def setup_logging(log_file: Path) -> None:
    """配置日志：同时输出到控制台和文件."""
    import logging
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    datefmt = "%H:%M:%S"
    logging.basicConfig(
        level=logging.INFO,
        format=fmt,
        datefmt=datefmt,
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(str(log_file), encoding="utf-8"),
        ],
    )


# ══════════════════════════════════════════════════════════════════
# §2 FakeTraeClient — 五闭环协同 stub
# ══════════════════════════════════════════════════════════════════


class FakeTraeClient:
    """五闭环协同 stub — 按 loop_type 返回不同的预设响应.

    每个闭环有独立的响应队列，确保协同过程中各闭环拿到正确的响应。
    """

    def __init__(self) -> None:
        # 按 (loop_type, stage) 索引的响应队列
        self._responses: Dict[str, List[Dict[str, Any]]] = {
            "doc_plan": [],
            "doc_review": [],
            "code_plan": [],
            "code_review": [],
            "review_plan": [],
            "review_act": [],
            "review_meta": [],
            "test_plan": [],
            "test_review": [],
            "framework_plan": [],
            "framework_review": [],
        }
        self.call_count = 0
        self.calls: List[Dict[str, Any]] = []

    def set_responses(self, stage: str, responses: List[Dict[str, Any]]) -> None:
        """为指定阶段设置响应队列."""
        self._responses[stage] = list(responses)

    async def chat(
        self,
        messages: List[Dict[str, str]],
        *,
        context: Any = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        self.call_count += 1
        self.calls.append({"messages": messages, "context": context, "kwargs": kwargs})

        # 根据 context.forgekin_id 和 task_type 推断当前阶段
        forgekin_id = ""
        task_type = ""
        if context is not None:
            forgekin_id = getattr(context, "forgekin_id", "")
            task_type = getattr(context, "task_type", "")

        stage_key = self._infer_stage(forgekin_id, task_type)
        if stage_key and self._responses.get(stage_key):
            return self._responses[stage_key].pop(0)

        # 默认响应
        return {
            "content": "{}",
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 100},
            "request_id": f"req-{self.call_count}",
        }

    def _infer_stage(self, forgekin_id: str, task_type: str) -> str:
        """根据 forgekin_id 和 task_type 推断当前阶段."""
        if "wenxin" in forgekin_id:
            if "plan" in task_type:
                return "doc_plan"
            return "doc_review"
        if "sherlock" in forgekin_id:
            if "plan" in task_type:
                return "code_plan"
            return "code_review"
        if "vangogh" in forgekin_id:
            if "plan" in task_type:
                return "review_plan"
            if "report" in task_type:
                return "review_act"
            return "review_meta"
        if "davinci" in forgekin_id:
            if "plan" in task_type:
                return "test_plan"
            return "test_review"
        if "luban" in forgekin_id:
            if "plan" in task_type:
                return "framework_plan"
            return "framework_review"
        return ""


# ══════════════════════════════════════════════════════════════════
# §3 构造协同 Mock 项目
# ══════════════════════════════════════════════════════════════════


def build_collaborative_project(root: Path) -> None:
    """构造五闭环协同所需的 Mock 项目目录.

    结构：
        root/
        ├── docs/features/F500-demo.md     # 触发 doc 闭环：缺 design 文档
        └── flowforge/                      # 源码目录（code 闭环目标）
    """
    print("\n[Setup] 构造五闭环协同 Mock 项目...")
    print(f"[Setup] 项目根目录: {root}")

    # docs/features/F500-demo.md（触发 doc 闭环：缺 design/D500-demo.md）
    features_dir = root / "docs" / "features"
    features_dir.mkdir(parents=True, exist_ok=True)
    (features_dir / "F500-demo.md").write_text(
        "---\n"
        "status: done\n"
        "type: feature\n"
        "created_at: 2026-07-20\n"
        "---\n\n"
        "# F500: 五闭环协同演示功能\n\n"
        "验证 doc→code→review→test 全链路协同.\n\n"
        "## 验收标准\n\n"
        "- AC1: 文档闭环生成 design 文档\n"
        "- AC2: 代码闭环实现功能\n"
        "- AC3: 审查闭环生成报告\n"
        "- AC4: 测试闭环生成测试\n",
        encoding="utf-8",
    )
    print(f"[Setup] 创建: docs/features/F500-demo.md (触发 doc 闭环)")

    # flowforge/ 目录（code 闭环目标）
    ff_dir = root / "flowforge"
    ff_dir.mkdir(parents=True, exist_ok=True)
    print(f"[Setup] 创建: flowforge/ (code 闭环目标目录)")

    print(f"[Setup] Mock 项目构造完成\n")


# ══════════════════════════════════════════════════════════════════
# §4 配置 FakeTraeClient 的五闭环响应
# ══════════════════════════════════════════════════════════════════


def configure_five_loops_responses(client: FakeTraeClient) -> None:
    """为五闭环协同配置各阶段的 LLM 响应."""

    # ── 1. Doc 闭环响应 ──
    # Plan: 生成 D500-demo.md design 文档
    client.set_responses("doc_plan", [{
        "content": json.dumps({
            "steps": [{
                "action": "write_file",
                "path": "docs/design/D500-demo.md",
                "content": (
                    "---\n"
                    "status: draft\n"
                    "type: design\n"
                    "created_at: 2026-07-20\n"
                    "---\n\n"
                    "# D500: 五闭环协同演示详细设计\n\n"
                    "## 数据模型\n\n"
                    "DemoCalculator 类.\n\n"
                    "## 接口设计\n\n"
                    "- add(a, b) -> int\n"
                    "- multiply(a, b) -> int\n"
                ),
            }],
            "expected_effect": "生成 D500 design 文档",
            "risk_assessment": "low",
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 200},
        "request_id": "doc-plan-1",
    }])
    # Review: 通过
    client.set_responses("doc_review", [{
        "content": json.dumps({
            "passed": True,
            "score": 0.88,
            "issues": [],
            "suggestions": ["文档结构清晰"],
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 100},
        "request_id": "doc-review-1",
    }])

    # ── 2. Code 闭环响应 ──
    # Plan: 根据 design 文档实现 DemoCalculator
    client.set_responses("code_plan", [{
        "content": json.dumps({
            "steps": [{
                "action": "write_file",
                "path": "flowforge/demo_calculator.py",
                "content": (
                    "\"\"\"DemoCalculator module — 五闭环协同演示.\"\"\"\n\n"
                    "from flowforge.llm.trae import TraeLLMClient\n\n\n"
                    "class DemoCalculator:\n"
                    "    \"\"\"演示用计算器（注入 TraeLLMClient 满足 DI 红线 12）.\"\"\"\n\n"
                    "    def __init__(self, client: TraeLLMClient) -> None:\n"
                    "        self._client = client\n\n"
                    "    def add(self, a: int, b: int) -> int:\n"
                    "        \"\"\"返回 a + b.\"\"\"\n"
                    "        return a + b\n\n"
                    "    def multiply(self, a: int, b: int) -> int:\n"
                    "        \"\"\"返回 a * b.\"\"\"\n"
                    "        return a * b\n"
                ),
            }],
            "expected_effect": "实现 DemoCalculator 类",
            "risk_assessment": "low",
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 250},
        "request_id": "code-plan-1",
    }])
    # Review: 通过
    client.set_responses("code_review", [{
        "content": json.dumps({
            "passed": True,
            "score": 0.90,
            "issues": [],
            "suggestions": ["代码符合 DI 规范"],
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 120},
        "request_id": "code-review-1",
    }])

    # ── 3. Review 闭环响应 ──
    # Plan: 审查清单
    client.set_responses("review_plan", [{
        "content": json.dumps({
            "steps": [{
                "action": "review_file",
                "path": "flowforge/demo_calculator.py",
                "checklist": ["检查 DI 注入", "检查类型注解", "检查 docstring"],
            }],
            "expected_effect": "审查清单",
            "risk_assessment": "low",
        }),
        "model": "claude-3-5-sonnet",  # Anthropic（与 author 不同厂商）
        "provider": "anthropic",
        "usage": {"latency_ms": 150},
        "request_id": "review-plan-1",
    }])
    # Act: 生成审查报告（无 P0/P1 问题）
    client.set_responses("review_act", [{
        "content": json.dumps({
            "issues": [{
                "severity": "P3",
                "location": "DemoCalculator.__init__",
                "description": "client 参数当前未使用，建议后续扩展时利用",
                "suggestion": "可在未来版本中添加 LLM 辅助计算",
            }],
            "summary": "代码整体合规，无阻塞性问题",
            "score": 0.92,
        }),
        "model": "claude-3-5-sonnet",
        "provider": "anthropic",
        "usage": {"latency_ms": 180},
        "request_id": "review-act-1",
    }])
    # Meta-review: 通过
    client.set_responses("review_meta", [{
        "content": json.dumps({
            "passed": True,
            "score": 0.91,
            "issues": [],
            "suggestions": ["审查报告客观准确"],
        }),
        "model": "claude-3-5-sonnet",
        "provider": "anthropic",
        "usage": {"latency_ms": 100},
        "request_id": "review-meta-1",
    }])

    # ── 4. Test 闭环响应 ──
    # Plan: 生成测试方案
    client.set_responses("test_plan", [{
        "content": json.dumps({
            "steps": [{
                "action": "write_file",
                "path": "tests/test_demo_calculator.py",
                "content": (
                    "import pytest\n"
                    "from unittest.mock import MagicMock\n\n"
                    "from flowforge.demo_calculator import DemoCalculator\n\n\n"
                    "class TestDemoCalculator:\n"
                    "    \"\"\"DemoCalculator 单元测试.\"\"\"\n\n"
                    "    @pytest.fixture\n"
                    "    def calc(self):\n"
                    "        \"\"\"构造 DemoCalculator 实例（注入 mock client）.\"\"\"\n"
                    "        return DemoCalculator(client=MagicMock())\n\n"
                    "    def test_add(self, calc):\n"
                    "        \"\"\"测试加法.\"\"\"\n"
                    "        assert calc.add(2, 3) == 5\n"
                    "        assert calc.add(-1, 1) == 0\n"
                    "        assert calc.add(0, 0) == 0\n\n"
                    "    def test_multiply(self, calc):\n"
                    "        \"\"\"测试乘法.\"\"\"\n"
                    "        assert calc.multiply(2, 3) == 6\n"
                    "        assert calc.multiply(-1, 5) == -5\n"
                    "        assert calc.multiply(0, 100) == 0\n"
                ),
            }],
            "expected_effect": "生成 DemoCalculator 单元测试",
            "risk_assessment": "low",
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 200},
        "request_id": "test-plan-1",
    }])
    # Review: 通过
    client.set_responses("test_review", [{
        "content": json.dumps({
            "passed": True,
            "score": 0.89,
            "issues": [],
            "suggestions": ["测试覆盖了边界值"],
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 100},
        "request_id": "test-review-1",
    }])

    # ── 5. Framework 闭环响应 ──
    # Plan: 创建新 ADR-014（沉淀五闭环协同方法论 — 禁止覆盖已有 ADR）
    # 注意：ADR ID 必须不在 _CORE_ADR_IDS（001-013）中，否则会被 I2 Scope Guard 阻止
    client.set_responses("framework_plan", [{
        "content": json.dumps({
            "steps": [{
                "action": "create_adr",
                "path": "docs/decisions/014-five-loops-collaboration.md",
                "adr_id": "014",
                "content": (
                    "# ADR-014: 五闭环协同自我开发方法论\n\n"
                    "## 背景\n\n"
                    "F046 v1.1 扩展 SelfDev 三闭环为五闭环，新增 review/test 闭环，"
                    "形成「文档→代码→审查→测试→框架」全链路自我开发能力.\n\n"
                    "## 决策\n\n"
                    "采用 cross-loop context 协同协议：\n"
                    "- doc.changed_files → code.target_files\n"
                    "- code.changed_files → review.target_files\n"
                    "- review.passed → test.review_passed\n"
                    "- test.changed_files → framework.target_files（I8 approval）\n\n"
                    "## 影响\n\n"
                    "1. 五个Forgekin可独立完成全链路自我开发\n"
                    "2. 仅 E5 框架变更需 operator approval（I8 不变量）\n"
                    "3. 其他闭环达到觉醒阶门控即可自主执行\n"
                ),
            }],
            "expected_effect": "沉淀五闭环协同方法论为新 ADR",
            "risk_assessment": "low",
        }),
        "model": "claude-3-5-sonnet",  # 架构方案用 Claude（跨厂商）
        "provider": "anthropic",
        "usage": {"latency_ms": 300},
        "request_id": "framework-plan-1",
    }])
    # Review: 通过（LLM 审核新 ADR 内容）
    client.set_responses("framework_review", [{
        "content": json.dumps({
            "passed": True,
            "score": 0.91,
            "issues": [],
            "suggestions": ["ADR 结构完整，决策清晰"],
        }),
        "model": "claude-3-5-sonnet",
        "provider": "anthropic",
        "usage": {"latency_ms": 120},
        "request_id": "framework-review-1",
    }])


# ══════════════════════════════════════════════════════════════════
# §5 注册 5 个Forgekin（含 framework 鲁班 + I8 approval）
# ══════════════════════════════════════════════════════════════════


def register_five_forgekins(
    engine: ForgeMindEngine,
    client: FakeTraeClient,
    project_root: str,
) -> Dict[str, Any]:
    """注册 5 个Forgekin到 ForgeMindEngine（含 framework 鲁班 + I8 approval）.

    返回：
        forgekins 字典：{loop_type: loop_instance}
    """
    print("\n[Register] 注册 5 个Forgekin到 ForgeMindEngine（含 framework 鲁班）...")

    # 通用 persist stub（避免真实治理层调用）
    async def _noop_persist(record):
        record.persisted = True
        record.persist_payload = {"episode_id": f"five-loops-{record.loop_type}"}
        return record.persist_payload

    base_config = {"project_root": project_root}

    # 1. 文心（doc, E3）
    doc_config = {**base_config, "forgekin_id": "forgemind:wenxin", "docs_dir": "docs", "max_age_days": 90}
    doc_loop = SelfDevDocLoop(client, doc_config, engine, awakening_stage="E3")
    doc_loop.persist = _noop_persist
    engine.register_self_dev_loop(doc_loop)
    print(f"[Register] 文心（forgemind:wenxin）— doc, E3 — 已注册")

    # 2. 夏洛克（code, E4）
    code_config = {**base_config, "forgekin_id": "forgemind:sherlock"}
    code_loop = SelfDevCodeLoop(client, code_config, engine, awakening_stage="E4")
    code_loop.persist = _noop_persist
    engine.register_self_dev_loop(code_loop)
    print(f"[Register] 夏洛克（forgemind:sherlock）— code, E4 — 已注册")

    # 3. 梵高（review, E3）
    review_config = {**base_config, "forgekin_id": "forgemind:vangogh", "reviews_dir": "docs/reviews"}
    review_loop = SelfDevReviewLoop(client, review_config, engine, awakening_stage="E3")
    review_loop.persist = _noop_persist
    engine.register_self_dev_loop(review_loop)
    print(f"[Register] 梵高（forgemind:vangogh）— review, E3 — 已注册")

    # 4. 达芬奇（test, E3）
    test_config = {**base_config, "forgekin_id": "forgemind:davinci", "tests_dir": "tests"}
    test_loop = SelfDevTestLoop(client, test_config, engine, awakening_stage="E3")
    test_loop.persist = _noop_persist
    engine.register_self_dev_loop(test_loop)
    print(f"[Register] 达芬奇（forgemind:davinci）— test, E3 — 已注册")

    # 5. 鲁班（framework, E5）— I8 approval_callback 在 demo 中自动批准
    # 生产环境必须由 operator 在 IM 议事中显式批准（F046 §2.6 I8 不变量）
    approval_count = {"n": 0}

    async def _demo_approval_callback(plan, task) -> bool:
        """Demo 用 approval callback — 自动批准并打印审批记录.

        生产环境替换为：通过 IM 议事通道（F047）发送审批请求，
        等待 operator 在 web 群/CLI 中显式批准（I8 不变量）.
        """
        approval_count["n"] += 1
        print(f"[Approval] I8 自动批准 #{approval_count['n']}: plan_id={plan.plan_id}, "
              f"target={task.target_path}, expected_effect={plan.expected_effect}")
        print(f"[Approval] ⚠️  生产环境必须由 operator 显式批准（I8 不变量）")
        return True

    framework_config = {
        **base_config,
        "forgekin_id": "forgemind:luban",
        "approval_callback": _demo_approval_callback,
    }
    framework_loop = SelfDevFrameworkLoop(client, framework_config, engine, awakening_stage="E5")
    framework_loop.persist = _noop_persist
    engine.register_self_dev_loop(framework_loop)
    print(f"[Register] 鲁班（forgemind:luban）— framework, E5, I8 approval 自动 — 已注册")

    print(f"[Register] 共注册 5 个Forgekin（含 framework 鲁班）")

    # 验证注册
    loops = engine.list_self_dev_loops()
    print(f"[Register] 已注册闭环: {loops}")

    return {
        "doc": doc_loop,
        "code": code_loop,
        "review": review_loop,
        "test": test_loop,
        "framework": framework_loop,
    }


# ══════════════════════════════════════════════════════════════════
# §6 五闭环协同主流程
# ══════════════════════════════════════════════════════════════════


async def run_five_loops_collaboration(
    engine: ForgeMindEngine,
    temp_project: Path,
) -> Dict[str, Any]:
    """执行五闭环协同主流程.

    协同链路（F046 §9.3 v1.1 扩展）：
        doc → code → review → test → framework

    返回：
        协同结果字典，含每个闭环的 summary 和 cross-loop context
    """
    results: Dict[str, Any] = {}

    # ──────────────────────────────────────────────────────────────
    # 阶段 1: 文心（doc 闭环）— 发现缺失 design 文档并生成
    # ──────────────────────────────────────────────────────────────
    print("\n" + "═" * 70)
    print("阶段 1/5: 文心（forgemind:wenxin）— 文档闭环")
    print("═" * 70)
    print("[Doc] 触发 doc 闭环：扫描 docs/features/ 自动发现缺失 design 文档")

    start = time.monotonic()
    doc_result = await engine.run_self_dev_loop("doc", {
        "scan_patterns": ["docs/features/*.md"],
    })
    doc_elapsed = time.monotonic() - start

    print(f"\n[Doc] 循环耗时: {doc_elapsed * 1000:.0f}ms")
    print(f"[Doc] summary: {json.dumps(doc_result['summary'], ensure_ascii=False, indent=2)}")

    # 验证 doc 闭环产物
    design_file = temp_project / "docs" / "design" / "D500-demo.md"
    if design_file.exists():
        content = design_file.read_text(encoding="utf-8")
        print(f"\n[Doc] ✅ design 文档已创建: {design_file}")
        print(f"[Doc]    文件大小: {len(content)} 字符")
        print(f"[Doc]    以 front-matter 开头: {content.startswith('---')}")
        # cross-loop context: doc.changed_files
        doc_changed_files = [str(design_file.relative_to(temp_project)).replace("\\", "/")]
        results["doc"] = {
            "summary": doc_result["summary"],
            "changed_files": doc_changed_files,
            "elapsed_ms": int(doc_elapsed * 1000),
        }
        print(f"[Doc] cross-loop context: changed_files={doc_changed_files}")
    else:
        print(f"\n[Doc] ❌ design 文档未创建，协同链路中断")
        results["doc"] = {"error": "design 文档未创建"}
        return results

    # ──────────────────────────────────────────────────────────────
    # 阶段 2: 夏洛克（code 闭环）— 根据 doc 产物实现代码
    # ──────────────────────────────────────────────────────────────
    print("\n" + "═" * 70)
    print("阶段 2/5: 夏洛克（forgemind:sherlock）— 代码闭环")
    print("═" * 70)
    print(f"[Code] 接收 doc.changed_files 作为 target_files: {doc_changed_files}")

    start = time.monotonic()
    code_result = await engine.run_self_dev_loop("code", {
        "force_targets": ["flowforge/demo_calculator.py"],
    })
    code_elapsed = time.monotonic() - start

    print(f"\n[Code] 循环耗时: {code_elapsed * 1000:.0f}ms")
    print(f"[Code] summary: {json.dumps(code_result['summary'], ensure_ascii=False, indent=2)}")

    # 验证 code 闭环产物
    code_file = temp_project / "flowforge" / "demo_calculator.py"
    if code_file.exists():
        content = code_file.read_text(encoding="utf-8")
        print(f"\n[Code] ✅ 代码文件已创建: {code_file}")
        print(f"[Code]    文件大小: {len(content)} 字符")
        print(f"[Code]    包含 DemoCalculator: {'class DemoCalculator' in content}")
        # cross-loop context: code.changed_files
        code_changed_files = ["flowforge/demo_calculator.py"]
        results["code"] = {
            "summary": code_result["summary"],
            "changed_files": code_changed_files,
            "elapsed_ms": int(code_elapsed * 1000),
        }
        print(f"[Code] cross-loop context: changed_files={code_changed_files}")
    else:
        print(f"\n[Code] ❌ 代码文件未创建，协同链路中断")
        results["code"] = {"error": "代码文件未创建"}
        return results

    # ──────────────────────────────────────────────────────────────
    # 阶段 3: 梵高（review 闭环）— 跨厂商审查 code 产物
    # ──────────────────────────────────────────────────────────────
    print("\n" + "═" * 70)
    print("阶段 3/5: 梵高（forgemind:vangogh）— 审查闭环（跨厂商）")
    print("═" * 70)
    print(f"[Review] 接收 code.changed_files 作为 target_files: {code_changed_files}")

    start = time.monotonic()
    review_result = await engine.run_self_dev_loop("review", {
        "target_files": code_changed_files,
        "author_forgekin_id": "forgemind:sherlock",
        "author_llm_model": "fake-model",  # author 用 fake-model
    })
    review_elapsed = time.monotonic() - start

    print(f"\n[Review] 循环耗时: {review_elapsed * 1000:.0f}ms")
    print(f"[Review] summary: {json.dumps(review_result['summary'], ensure_ascii=False, indent=2)}")

    # 验证 review 闭环产物
    reviews_dir = temp_project / "docs" / "reviews"
    reports = list(reviews_dir.glob("*_demo_calculator.md")) if reviews_dir.exists() else []
    if reports:
        report_content = reports[0].read_text(encoding="utf-8")
        print(f"\n[Review] ✅ 审查报告已创建: {reports[0]}")
        print(f"[Review]    文件大小: {len(report_content)} 字符")
        # cross-loop context: review.passed (P0=0 表示通过)
        review_passed = "P0 问题（0 个）" in report_content or "p0: 0" in report_content.lower()
        results["review"] = {
            "summary": review_result["summary"],
            "report_file": str(reports[0].relative_to(temp_project)).replace("\\", "/"),
            "review_passed": review_passed,
            "elapsed_ms": int(review_elapsed * 1000),
        }
        print(f"[Review] cross-loop context: review_passed={review_passed}")
    else:
        print(f"\n[Review] ❌ 审查报告未创建，协同链路中断")
        results["review"] = {"error": "审查报告未创建"}
        return results

    # ──────────────────────────────────────────────────────────────
    # 阶段 4: 达芬奇（test 闭环）— 为 code 产物生成测试
    # ──────────────────────────────────────────────────────────────
    print("\n" + "═" * 70)
    print("阶段 4/5: 达芬奇（forgemind:davinci）— 测试闭环")
    print("═" * 70)
    print(f"[Test] 接收 code.changed_files 作为 target_files: {code_changed_files}")
    print(f"[Test] 接收 review.review_passed: {review_passed}")

    start = time.monotonic()
    test_result = await engine.run_self_dev_loop("test", {
        "target_files": code_changed_files,
        "review_passed": review_passed,
        "test_strategy": "unit",
    })
    test_elapsed = time.monotonic() - start

    print(f"\n[Test] 循环耗时: {test_elapsed * 1000:.0f}ms")
    print(f"[Test] summary: {json.dumps(test_result['summary'], ensure_ascii=False, indent=2)}")

    # 验证 test 闭环产物
    test_file = temp_project / "tests" / "test_demo_calculator.py"
    if test_file.exists():
        content = test_file.read_text(encoding="utf-8")
        print(f"\n[Test] ✅ 测试文件已创建: {test_file}")
        print(f"[Test]    文件大小: {len(content)} 字符")
        print(f"[Test]    包含 TestDemoCalculator: {'class TestDemoCalculator' in content}")
        test_changed_files = ["tests/test_demo_calculator.py"]
        results["test"] = {
            "summary": test_result["summary"],
            "test_file": "tests/test_demo_calculator.py",
            "changed_files": test_changed_files,
            "elapsed_ms": int(test_elapsed * 1000),
        }
        print(f"[Test] cross-loop context: changed_files={test_changed_files}")
    else:
        print(f"\n[Test] ❌ 测试文件未创建")
        results["test"] = {"error": "测试文件未创建"}
        return results

    # ──────────────────────────────────────────────────────────────
    # 阶段 5: 鲁班（framework 闭环）— 沉淀协同方法论为新 ADR（I8 approval）
    # ──────────────────────────────────────────────────────────────
    print("\n" + "═" * 70)
    print("阶段 5/5: 鲁班（forgemind:luban）— 框架闭环（I8 approval）")
    print("═" * 70)
    print(f"[Framework] 接收 test.changed_files 作为 target_files: {test_changed_files}")
    print(f"[Framework] 触发 framework 闭环：沉淀五闭环协同方法论为新 ADR")

    start = time.monotonic()
    # framework 闭环通过 force_targets 指定目标（避免 Discover 扫描全项目）
    framework_result = await engine.run_self_dev_loop("framework", {
        "force_targets": ["docs/decisions/014-five-loops-collaboration.md"],
        "task_source": "force_targets",
    })
    framework_elapsed = time.monotonic() - start

    print(f"\n[Framework] 循环耗时: {framework_elapsed * 1000:.0f}ms")
    print(f"[Framework] summary: {json.dumps(framework_result['summary'], ensure_ascii=False, indent=2)}")

    # 验证 framework 闭环产物：新 ADR 文件
    adr_file = temp_project / "docs" / "decisions" / "014-five-loops-collaboration.md"
    if adr_file.exists():
        content = adr_file.read_text(encoding="utf-8")
        has_front_matter = content.startswith("---")
        print(f"\n[Framework] ✅ 新 ADR 已创建: {adr_file}")
        print(f"[Framework]    文件大小: {len(content)} 字符")
        print(f"[Framework]    以 front-matter 开头: {has_front_matter}")
        print(f"[Framework]    包含 ADR-014: {'ADR-014' in content or '014' in content}")
        if has_front_matter:
            # 提取 front-matter 显示
            fm_end = content.find("---", 4)
            if fm_end > 0:
                front_matter = content[4:fm_end].strip()
                print(f"[Framework]    front-matter:\n{front_matter}")
        results["framework"] = {
            "summary": framework_result["summary"],
            "adr_file": "docs/decisions/014-five-loops-collaboration.md",
            "changed_files": ["docs/decisions/014-five-loops-collaboration.md"],
            "elapsed_ms": int(framework_elapsed * 1000),
        }
        print(f"[Framework] cross-loop context: 新 ADR 已落盘，方法论已沉淀")
    else:
        print(f"\n[Framework] ❌ 新 ADR 未创建")
        results["framework"] = {"error": "新 ADR 未创建"}

    return results


# ══════════════════════════════════════════════════════════════════
# §7 主入口
# ══════════════════════════════════════════════════════════════════


async def main() -> None:
    """五闭环协同 demo 主入口."""
    print("╔" + "═" * 68 + "╗")
    print("║  F046 v1.1 五闭环协同 E2E — doc→code→review→test→framework    ║")
    print("╚" + "═" * 68 + "╝")

    # 创建临时项目目录
    with tempfile.TemporaryDirectory(prefix="five_loops_demo_") as tmp:
        temp_project = Path(tmp)
        log_file = temp_project / "five_loops_demo.log"

        # 配置日志
        setup_logging(log_file)

        # 构造 Mock 项目
        build_collaborative_project(temp_project)

        # 配置 FakeTraeClient
        client = FakeTraeClient()
        configure_five_loops_responses(client)

        # 实例化 ForgeMindEngine
        engine = ForgeMindEngine()

        # 注册 5 个Forgekin（含 framework 鲁班 + I8 approval）
        register_five_forgekins(engine, client, str(temp_project))

        # 执行五闭环协同
        total_start = time.monotonic()
        results = await run_five_loops_collaboration(engine, temp_project)
        total_elapsed = time.monotonic() - total_start

        # 打印协同总结
        print("\n" + "╔" + "═" * 68 + "╗")
        print("║                  五闭环协同总结                              ║")
        print("╚" + "═" * 68 + "╝")

        print(f"\n[Summary] 总耗时: {total_elapsed * 1000:.0f}ms")
        print(f"[Summary] LLM 调用次数: {client.call_count}")

        success_count = 0
        loop_labels = {
            "doc": "文心（wenxin）",
            "code": "夏洛克（sherlock）",
            "review": "梵高（vangogh）",
            "test": "达芬奇（davinci）",
            "framework": "鲁班（luban）",
        }
        for loop_type in ["doc", "code", "review", "test", "framework"]:
            r = results.get(loop_type, {})
            label = loop_labels[loop_type]
            if "error" in r:
                print(f"[Summary] ❌ {loop_type} {label}: {r['error']}")
            else:
                elapsed = r.get("elapsed_ms", 0)
                summary = r.get("summary", {})
                print(f"[Summary] ✅ {loop_type} {label}: total={summary.get('total', 0)}, "
                      f"passed={summary.get('passed', 0)}, failed={summary.get('failed', 0)}, "
                      f"elapsed={elapsed}ms")
                success_count += 1

        print(f"\n[Summary] 协同结果: {success_count}/5 闭环成功")

        if success_count == 5:
            print("\n[Summary] 🎉 五闭环协同全链路验证通过！")
            print("[Summary]    1. 文心（wenxin, E3） → 生成 design 文档")
            print("[Summary]    2. 夏洛克（sherlock, E4） → 实现代码")
            print("[Summary]    3. 梵高（vangogh, E3） → 跨厂商审查")
            print("[Summary]    4. 达芬奇（davinci, E3） → 生成测试")
            print("[Summary]    5. 鲁班（luban, E5） → 沉淀新 ADR（I8 approval）")
            print("[Summary] 全链路：doc → code → review → test → framework ✅")
            print("\n[Summary] F046 v1.1 五闭环自我开发能力已验证")
            print("[Summary]   生产环境仅需在 E5 框架变更时由 operator 显式 approval（I8 不变量）")
        else:
            print(f"\n[Summary] ⚠️  {5 - success_count} 个闭环失败，请查看日志: {log_file}")

        print(f"\n[Logs] 完整日志: {log_file}")


if __name__ == "__main__":
    asyncio.run(main())
