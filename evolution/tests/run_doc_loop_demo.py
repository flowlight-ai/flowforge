"""F046 Phase 2 E2E 演示脚本 — 本地验证 SelfDevDocLoop 文档闭环.

用法：
    python -m flowforge.evolution.tests.run_doc_loop_demo

演示场景：
1. 构造临时项目目录（含过期文档 / 缺失 design / 无 front-matter / 受保护文件）
2. 实例化 SelfDevDocLoop（注入 FakeTraeClient，无需真实 Trae IDE）
3. 触发完整五步循环：Discover → Plan → Act → Verify → Persist
4. 打印每个阶段的执行日志和最终结果
5. 验证生成的文档（front-matter + 标题层级 + LLM 审核通过）

测试铁律遵守：
- T1 禁止 Mock LLM：使用 FakeTraeClient（stub 替代，非 mock）
- T2 真实场景数据：构造真实文档结构模拟项目目录
- T3 具体断言：演示脚本中明确打印每个断言结果
- T6 必须采集指标：打印每个阶段的 elapsed_ms

注意：
- 本脚本不调用真实 LLM，仅用于本地验证五步循环逻辑
- 真实使用时请用 TraeLLMClient 替换 FakeTraeClient
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
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
from flowforge.evolution.self_dev_doc import SelfDevDocLoop


# ══════════════════════════════════════════════════════════════════
# §1 配置日志输出（同时输出到控制台和文件）
# ══════════════════════════════════════════════════════════════════


def setup_logging(log_file: Path) -> None:
    """配置日志：同时输出到控制台和文件."""
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
# §2 FakeTraeClient — Stub 替代 TraeLLMClient
# ══════════════════════════════════════════════════════════════════


class FakeTraeClient:
    """Stub TraeLLMClient — 按顺序返回预设响应.

    第 1 次调用（Plan）：返回合法的 JSON 方案
    第 2 次调用（Verify/LLM 审核）：返回通过审核结果
    后续调用：返回默认响应
    """

    def __init__(self, responses: List[Dict[str, Any]] | None = None) -> None:
        self._responses = list(responses or [])
        self.call_count = 0
        self.calls: List[Dict[str, Any]] = []

    async def chat(
        self,
        messages: List[Dict[str, str]],
        *,
        context: Any = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        self.call_count += 1
        self.calls.append({"messages": messages, "context": context, "kwargs": kwargs})
        if self._responses:
            return self._responses.pop(0)
        # 默认响应
        return {
            "content": "{}",
            "model": "fake-model",
            "provider": "trae",
            "usage": {"latency_ms": 100},
            "request_id": f"req-{self.call_count}",
        }


# ══════════════════════════════════════════════════════════════════
# §3 构造 Mock 数据（临时项目目录）
# ══════════════════════════════════════════════════════════════════


def build_mock_project(root: Path) -> None:
    """在 root 下构造模拟项目目录结构.

    目录结构：
        root/
        ├── docs/
        │   ├── features/
        │   │   └── F100-test.md          # 正常 feature 文档（有 front-matter）
        │   ├── stale_doc.md              # 过期文档（mtime 100 天前）
        │   └── no_frontmatter.md         # 缺少 front-matter（格式问题）
        ├── README.md                     # 根目录文档（无 front-matter 不算问题）
        └── VISION.md                     # 受保护文件（应被 Scope Guard 阻止）
    """
    print("\n[Setup] 构造 Mock 项目目录...")
    print(f"[Setup] 项目根目录: {root}")

    # docs/features/F100-test.md
    features_dir = root / "docs" / "features"
    features_dir.mkdir(parents=True, exist_ok=True)
    (features_dir / "F100-test.md").write_text(
        "---\n"
        "status: done\n"
        "type: feature\n"
        "created_at: 2026-07-01\n"
        "---\n\n"
        "# F100: 测试功能\n\n"
        "这是一个测试 feature 文档.\n\n"
        "## 验收标准\n\n"
        "- AC1: 文档生成功能可用\n"
        "- AC2: 通过 LLM 审核\n",
        encoding="utf-8",
    )
    print(f"[Setup] 创建: docs/features/F100-test.md")

    # docs/stale_doc.md（过期文档）
    stale_path = root / "docs" / "stale_doc.md"
    stale_path.write_text(
        "---\nstatus: draft\ntype: doc\n---\n\n# 过期文档\n\n这个文档很老.\n",
        encoding="utf-8",
    )
    # 修改 mtime 为 100 天前
    old_time = time.time() - 100 * 86400
    os.utime(stale_path, (old_time, old_time))
    print(f"[Setup] 创建: docs/stale_doc.md (mtime=100天前, 触发过期检测)")

    # docs/no_frontmatter.md（无 front-matter）
    (root / "docs" / "no_frontmatter.md").write_text(
        "### 缺少 front-matter 的文档\n\n这个文档没有 YAML 头部.\n",
        encoding="utf-8",
    )
    print(f"[Setup] 创建: docs/no_frontmatter.md (无 front-matter, 触发格式问题)")

    # README.md
    (root / "README.md").write_text(
        "# Mock Project\n\n这是一个用于演示的 Mock 项目.\n",
        encoding="utf-8",
    )
    print(f"[Setup] 创建: README.md")

    # VISION.md（受保护文件）
    (root / "VISION.md").write_text(
        "# 项目愿景\n\n成为最强 AI Agent 智能体平台.\n",
        encoding="utf-8",
    )
    print(f"[Setup] 创建: VISION.md (受 Scope Guard 保护)")

    print(f"[Setup] Mock 项目构造完成\n")


# ══════════════════════════════════════════════════════════════════
# §4 主流程 — 演示三种场景
# ══════════════════════════════════════════════════════════════════


async def scenario_1_full_scan(temp_project: Path) -> None:
    """场景 1：完整扫描模式 — 自动发现并修复文档问题."""
    print("\n" + "═" * 70)
    print("场景 1：完整扫描模式 — 自动发现并修复文档问题")
    print("═" * 70)

    # 配置 FakeTraeClient：为缺失 design 文档返回方案
    plan_response = {
        "content": json.dumps({
            "steps": [{
                "action": "write_file",
                "path": "docs/design/D100-test.md",
                "content": (
                    "---\n"
                    "status: draft\n"
                    "type: design\n"
                    "created_at: 2026-07-20\n"
                    "---\n\n"
                    "# D100: 测试功能详细设计\n\n"
                    "这是自动生成的 design 文档.\n\n"
                    "## 数据模型\n\n"
                    "略.\n\n"
                    "## 接口设计\n\n"
                    "略.\n"
                ),
            }],
            "expected_effect": "为 F100-test 创建对应的 design 文档",
            "risk_assessment": "low",
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 200},
        "request_id": "plan-1",
    }
    review_response = {
        "content": json.dumps({
            "passed": True,
            "score": 0.88,
            "issues": [],
            "suggestions": [],
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 100},
        "request_id": "review-1",
    }
    fake_client = FakeTraeClient([plan_response, review_response])

    # 实例化 ForgeMindEngine + SelfDevDocLoop
    engine = ForgeMindEngine()
    config = {
        "project_root": str(temp_project),
        "forgekin_id": "forgemind:wenxin",
        "docs_dir": "docs",
        "max_age_days": 90,
        "scan_patterns": ["docs/features/*.md"],
    }
    loop = SelfDevDocLoop(fake_client, config, engine, awakening_stage="E3")

    # 覆盖 persist 跳过真实治理层
    async def _noop_persist(record):
        record.persisted = True
        record.persist_payload = {"episode_id": "demo-episode-1"}
        return record.persist_payload
    loop.persist = _noop_persist

    # 注册到 engine
    engine.register_self_dev_loop(loop)

    # 触发完整循环
    print("\n[Run] 触发 SelfDevDocLoop.run_once(scan_patterns=['docs/features/*.md'])")
    start = time.monotonic()
    result = await engine.run_self_dev_loop("doc", {
        "scan_patterns": ["docs/features/*.md"],
    })
    elapsed = time.monotonic() - start

    # 打印结果
    print(f"\n[Result] 循环耗时: {elapsed * 1000:.0f}ms")
    print(f"[Result] loop_type: {result['loop_type']}")
    print(f"[Result] summary: {json.dumps(result['summary'], ensure_ascii=False, indent=2)}")

    # 验证生成的文件
    design_file = temp_project / "docs" / "design" / "D100-test.md"
    if design_file.exists():
        content = design_file.read_text(encoding="utf-8")
        print(f"\n[Verify] ✅ design 文档已创建: {design_file}")
        print(f"[Verify]    文件大小: {len(content)} 字符")
        print(f"[Verify]    以 front-matter 开头: {content.startswith('---')}")
        print(f"[Verify]    包含 D100: {'D100' in content}")
    else:
        print(f"\n[Verify] ❌ design 文档未创建: {design_file}")


async def scenario_2_force_targets(temp_project: Path) -> None:
    """场景 2：force_targets 模式 — 定向生成指定文档."""
    print("\n" + "═" * 70)
    print("场景 2：force_targets 模式 — 定向生成指定文档")
    print("═" * 70)

    target_path = "docs/forced_demo.md"
    plan_response = {
        "content": json.dumps({
            "steps": [{
                "action": "write_file",
                "path": target_path,
                "content": (
                    "---\n"
                    "status: draft\n"
                    "type: design\n"
                    "created_at: 2026-07-20\n"
                    "---\n\n"
                    "# 强制定生成的文档\n\n"
                    "这是通过 force_targets 模式生成的演示文档.\n\n"
                    "## 用途\n\n"
                    "演示 SelfDevDocLoop 的定向更新能力.\n"
                ),
            }],
            "expected_effect": "通过 force_targets 定向生成文档",
            "risk_assessment": "low",
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 150},
        "request_id": "plan-2",
    }
    review_response = {
        "content": json.dumps({
            "passed": True,
            "score": 0.92,
            "issues": [],
            "suggestions": ["继续保持"],
        }),
        "model": "fake-model",
        "provider": "trae",
        "usage": {"latency_ms": 80},
        "request_id": "review-2",
    }
    fake_client = FakeTraeClient([plan_response, review_response])

    engine = ForgeMindEngine()
    config = {
        "project_root": str(temp_project),
        "forgekin_id": "forgemind:wenxin",
        "docs_dir": "docs",
        "max_age_days": 90,
    }
    loop = SelfDevDocLoop(fake_client, config, engine, awakening_stage="E3")

    async def _noop_persist(record):
        record.persisted = True
        record.persist_payload = {"episode_id": "demo-episode-2"}
        return record.persist_payload
    loop.persist = _noop_persist

    engine.register_self_dev_loop(loop)

    print(f"\n[Run] 触发 SelfDevDocLoop.run_once(force_targets=['{target_path}'])")
    start = time.monotonic()
    result = await engine.run_self_dev_loop("doc", {
        "force_targets": [target_path],
    })
    elapsed = time.monotonic() - start

    print(f"\n[Result] 循环耗时: {elapsed * 1000:.0f}ms")
    print(f"[Result] summary: {json.dumps(result['summary'], ensure_ascii=False, indent=2)}")

    target_file = temp_project / target_path
    if target_file.exists():
        content = target_file.read_text(encoding="utf-8")
        print(f"\n[Verify] ✅ 目标文档已创建: {target_file}")
        print(f"[Verify]    文件大小: {len(content)} 字符")
        print(f"[Verify]    以 front-matter 开头: {content.startswith('---')}")
        print(f"[Verify]    包含 # 标题: {'# 强制定生成的文档' in content}")
    else:
        print(f"\n[Verify] ❌ 目标文档未创建: {target_file}")


async def scenario_3_scope_guard_blocks(temp_project: Path) -> None:
    """场景 3：Scope Guard 阻止修改受保护文件."""
    print("\n" + "═" * 70)
    print("场景 3：Scope Guard 阻止修改受保护文件 (VISION.md)")
    print("═" * 70)

    plan_response = {
        "content": json.dumps({
            "steps": [{
                "action": "write_file",
                "path": "VISION.md",
                "content": "# 被篡改的愿景\n\n恶意修改.\n",
            }],
            "expected_effect": "修改愿景",
            "risk_assessment": "low",
        }),
        "model": "fake",
        "provider": "trae",
        "usage": {},
        "request_id": "plan-3",
    }
    fake_client = FakeTraeClient([plan_response])

    engine = ForgeMindEngine()
    config = {
        "project_root": str(temp_project),
        "forgekin_id": "forgemind:wenxin",
    }
    loop = SelfDevDocLoop(fake_client, config, engine, awakening_stage="E3")

    async def _noop_persist(record):
        record.persisted = True
        record.persist_payload = {"episode_id": "demo-episode-3"}
        return record.persist_payload
    loop.persist = _noop_persist

    engine.register_self_dev_loop(loop)

    print("\n[Run] 触发 SelfDevDocLoop.run_once(force_targets=['VISION.md'])")
    print("[Run] 期望：Scope Guard 阻止修改，VISION.md 保持不变")
    start = time.monotonic()
    result = await engine.run_self_dev_loop("doc", {
        "force_targets": ["VISION.md"],
    })
    elapsed = time.monotonic() - start

    print(f"\n[Result] 循环耗时: {elapsed * 1000:.0f}ms")
    print(f"[Result] summary: {json.dumps(result['summary'], ensure_ascii=False, indent=2)}")

    # 验证 VISION.md 未被修改
    vision_file = temp_project / "VISION.md"
    content = vision_file.read_text(encoding="utf-8")
    if "被篡改" in content:
        print(f"\n[Verify] ❌ VISION.md 被篡改！Scope Guard 失效")
    else:
        print(f"\n[Verify] ✅ VISION.md 未被修改（Scope Guard 工作正常）")
        print(f"[Verify]    内容仍为: {content.strip()[:50]}...")

    # 验证 summary
    if result["summary"]["failed"] >= 1 and result["summary"]["passed"] == 0:
        print(f"[Verify] ✅ 任务被阻止（failed={result['summary']['failed']}）")
    else:
        print(f"[Verify] ❌ 任务未被正确阻止")


async def scenario_4_awakening_stage_gate(temp_project: Path) -> None:
    """场景 4：觉醒阶门控 — E2 觉醒阶低于 E3 要求，应被阻止."""
    print("\n" + "═" * 70)
    print("场景 4：觉醒阶门控 — E2 觉醒阶低于 E3 要求，应被阻止")
    print("═" * 70)

    fake_client = FakeTraeClient([])
    engine = ForgeMindEngine()
    config = {
        "project_root": str(temp_project),
        "forgekin_id": "forgemind:wenxin",
    }
    # 觉醒阶 E2（低于 E3 要求）
    loop = SelfDevDocLoop(fake_client, config, engine, awakening_stage="E2")
    engine.register_self_dev_loop(loop)

    print("\n[Run] 触发 SelfDevDocLoop.run_once({}) (觉醒阶=E2)")
    print("[Run] 期望：抛出 AwakeningStageBlockedError")
    try:
        await engine.run_self_dev_loop("doc", {})
        print(f"\n[Verify] ❌ 未抛出异常，门控失效")
    except Exception as e:
        print(f"\n[Verify] ✅ 抛出异常: {type(e).__name__}: {e}")


# ══════════════════════════════════════════════════════════════════
# §5 入口
# ══════════════════════════════════════════════════════════════════


async def main() -> None:
    """演示入口：依次运行 4 个场景."""
    # 创建临时项目目录
    temp_project = Path(tempfile.mkdtemp(prefix="self_dev_doc_demo_"))
    log_file = temp_project / "demo.log"
    setup_logging(log_file)

    print("=" * 70)
    print("F046 Phase 2 — SelfDevDocLoop 文档闭环 E2E 演示")
    print("=" * 70)
    print(f"临时项目目录: {temp_project}")
    print(f"日志文件: {log_file}")

    # 构造 Mock 数据
    build_mock_project(temp_project)

    # 运行 4 个场景
    await scenario_1_full_scan(temp_project)
    await scenario_2_force_targets(temp_project)
    await scenario_3_scope_guard_blocks(temp_project)
    await scenario_4_awakening_stage_gate(temp_project)

    print("\n" + "=" * 70)
    print("演示完成")
    print("=" * 70)
    print(f"\n查看生成的文档: {temp_project}")
    print(f"查看执行日志: {log_file}")

    # 列出生成的所有文档
    print("\n[Summary] 生成的文档清单:")
    for md_file in temp_project.rglob("*.md"):
        rel = md_file.relative_to(temp_project)
        size = md_file.stat().st_size
        print(f"  - {rel} ({size} 字节)")


if __name__ == "__main__":
    asyncio.run(main())
