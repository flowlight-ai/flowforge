"""F046 §9.6 SelfDevTestLoop — 自动化测试自我演进闭环.

负责自主生成/执行/验证测试，是 F046 v1.1 五闭环扩展架构新增的闭环之一.
对应灵智体：测试员·达芬奇（forgemind:davinci）.

设计动机（参考 roleagent.md + 项目测试铁律 T1-T8）：
- 测试是复利型基础设施（Built to Persist）
  自动化测试不随模型升级折旧，反而随代码增长价值持续上升
- T1-T8 铁律强制
  禁止 Mock LLM、禁止假数据、必须具体断言、必须采集指标等
- 闭环最后一环
  Test 闭环是五灵智体全链路（doc→code→framework→review→test）的最后一环

处理对象：
- tests/**/*.py（测试文件，禁止删除已有 — I10/红线 8）
- 新生成的测试文件输出到对应 tests/ 子目录

五步循环：
1. Discover: 检测未覆盖代码 / 测试失败 / 测试过期 / target_files
2. Plan: 通过 LLM 生成测试方案（unit/integration/e2e）
3. Act: 生成新测试文件（不删除已有）+ 运行 pytest
4. Verify: 测试通过 / 覆盖率达标 / T1-T8 铁律检查 / LLM 审核
5. Persist: 基类通用实现，沉淀到 ForgeMindEngine 三模式

安全护栏：
- I2 Scope Guard 前置检查：禁止修改 VISION/rules.md/decisions/
- I10 不删除测试：禁止删除已有测试用例（与 I5 一致，作用于 Test 闭环自身）
- T1-T8 铁律：所有生成的测试必须符合测试铁律
- I4 LLM 审核必经（T7 铁律）：测试代码必须经 LLM 审核
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from flowforge.core.tracing import get_logger
from flowforge.evolution.self_dev_base import (
    DevPlan,
    DevResult,
    DevTask,
    SelfDevLoopBase,
    VerifyResult,
)

logger = get_logger("flowforge.evolution.self_dev.test")


# ── 默认配置（可由 forgekin_config 覆盖）─────────────────────────
_DEFAULT_TESTS_DIR = "tests"
_DEFAULT_COVERAGE_THRESHOLD = 0.80  # 覆盖率阈值 80%
_DEFAULT_PYTEST_TIMEOUT = 120  # pytest 单次执行超时 120 秒
_DEFAULT_TEST_STRATEGY = "unit"  # 默认测试策略

# ── I10 不删除测试：禁止删除/覆盖的文件名模式（红线 8）──────────
_TEST_FILE_PATTERNS = [
    r"^test_.*\.py$",
    r".*_test\.py$",
    r"^conftest\.py$",
]

# ── T1-T8 铁律检查模式 ──────────────────────────────────────────
# T1: 禁止 Mock LLM（检测 unittest.mock.patch LLM 调用）
_T1_MOCK_LLM_PATTERNS = [
    r"mock\s*\(\s*LLMClient\b",
    r"patch\s*\(\s*['\"].*LLMClient['\"]",
    r"MagicMock\s*\(\s*spec\s*=\s*LLMClient\b",
    r"@patch\s*\(\s*['\"].*trae_client['\"]",
]

# T2: 禁止假数据（检测 "test"/"hello"/"dummy" 等占位字符串）
_T2_FAKE_DATA_PATTERNS = [
    r"['\"]test['\"]\s*[,)]",  # "test" 作为参数
    r"['\"]hello['\"]",
    r"['\"]dummy['\"]",
    r"['\"]fake['\"]",
    r"['\"]sample['\"]",
]

# T3: 必须有具体断言（不能只检查 status in ("completed", "error")）
_T3_VAGUE_ASSERT_PATTERNS = [
    r"assert\s+status\s+in\s*\(\s*['\"]completed['\"]\s*,\s*['\"]error['\"]\s*\)",
    r"assert\s+result\s+is\s+not\s+None\s*$",  # 仅检查 not None，无具体内容
]

# T7: LLM 内容必须经 LLM 审核（检查测试代码是否调用 llm_review）
_T7_REVIEW_PATTERN = r"llm_review_content\s*\("


class SelfDevTestLoop(SelfDevLoopBase):
    """自动化测试自我演进闭环 — 自主生成/执行/验证测试.

    觉醒阶要求：E3（受限自主阶），低于此阶不能触发.
    安全护栏：I10 不删除测试 / T1-T8 铁律强制.

    用法示例：
        from flowforge.evolution import ForgeMindEngine, SelfDevTestLoop

        engine = ForgeMindEngine()
        test_loop = SelfDevTestLoop(
            trae_client, config, engine, awakening_stage="E3"
        )
        engine.register_self_dev_loop(test_loop)

        # 触发 test 闭环（为 code 闭环产出补测试）
        result = await engine.run_self_dev_loop("test", {
            "target_files": ["flowforge/evolution/self_dev_code.py"],
            "test_strategy": "unit",
        })
    """

    loop_type = "test"
    min_awakening_stage = "E3"

    def __init__(
        self,
        trae_client: Any,
        forgekin_config: Dict[str, Any],
        evolution_engine: Any,
        *,
        awakening_stage: str = "E3",
    ) -> None:
        super().__init__(trae_client, forgekin_config, evolution_engine, awakening_stage=awakening_stage)

        self._tests_dir = forgekin_config.get("tests_dir", _DEFAULT_TESTS_DIR)
        self._coverage_threshold = forgekin_config.get(
            "coverage_threshold", _DEFAULT_COVERAGE_THRESHOLD
        )
        self._pytest_timeout = forgekin_config.get(
            "pytest_timeout", _DEFAULT_PYTEST_TIMEOUT
        )

        self._logger = logger
        self._logger.info(
            f"SelfDevTestLoop 初始化: tests_dir={self._tests_dir}, "
            f"coverage_threshold={self._coverage_threshold}, "
            f"pytest_timeout={self._pytest_timeout}s"
        )

    # ══════════════════════════════════════════════════════════════
    # §1 Discover — 发现测试任务
    # ══════════════════════════════════════════════════════════════

    async def discover(self, context: Dict[str, Any]) -> List[DevTask]:
        """发现测试任务（F046 §9.6）.

        支持四种任务来源：
        1. target_files: 为指定文件生成测试（协同协议主入口）
        2. pytest_failure: 从 pytest 失败输出提取待修复任务
        3. coverage_gap: 检测覆盖率不足的模块
        4. force_targets: 强制指定的目标文件列表

        Args:
            context: 发现上下文，支持以下字段：
                - target_files: 待测试文件列表（协同协议主入口）
                - force_targets: 强制指定的目标文件列表
                - task_source: 任务来源（默认 "force_targets"）
                - pytest_output: pytest 失败输出
                - test_strategy: 测试策略（unit/integration/e2e，默认 unit）
                - review_passed: 是否已通过 review 闭环（协同协议）

        Returns:
            DevTask 列表（按优先级排序）
        """
        start_time = time.monotonic()
        target_files = (
            context.get("target_files")
            or context.get("force_targets")
            or []
        )
        task_source = context.get("task_source", "force_targets")
        test_strategy = context.get("test_strategy", _DEFAULT_TEST_STRATEGY)
        pytest_output = context.get("pytest_output", "")

        self._logger.info(
            f"[Discover] 开始: target_files={len(target_files)}, "
            f"task_source={task_source}, strategy={test_strategy}"
        )

        tasks: List[DevTask] = []

        if target_files:
            # 协同协议主入口：为指定文件生成测试
            self._logger.info(
                f"[Discover] target_files 模式：为 {len(target_files)} 个文件生成测试"
            )
            for target in target_files:
                # 推断对应的测试文件路径
                test_file = self._infer_test_path(target)
                abs_test = Path(self.project_root) / test_file
                mod_type = "update" if abs_test.exists() else "create"

                # I10 检查：若测试文件已存在，禁止覆盖（强制 append 模式）
                if mod_type == "update":
                    self._logger.info(
                        f"[Discover] 测试文件已存在 {test_file}，将采用 append 模式（I10）"
                    )

                tasks.append(DevTask(
                    loop_type="test",
                    target_path=test_file,
                    modification_type=mod_type,
                    description=f"为 {target} 生成 {test_strategy} 测试",
                    priority="high",
                    context={
                        "source": "target_files",
                        "source_file": target,
                        "test_strategy": test_strategy,
                        "review_passed": context.get("review_passed", False),
                    },
                ))
        elif task_source == "pytest_failure":
            tasks = await self._discover_from_pytest_failure(pytest_output)
        elif task_source == "coverage_gap":
            tasks = await self._discover_from_coverage_gap()
        else:
            self._logger.warning(
                f"[Discover] 未提供 target_files，task_source={task_source!r} 未实现"
            )

        # 按优先级排序
        priority_order = {"critical": 0, "high": 1, "normal": 2, "low": 3}
        tasks.sort(key=lambda t: priority_order.get(t.priority, 99))

        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        self._logger.info(f"[Discover] 完成: {len(tasks)} 个任务, 耗时 {elapsed_ms}ms")
        return tasks

    def _infer_test_path(self, source_file: str) -> str:
        """从源文件路径推断测试文件路径.

        flowforge/foo.py -> tests/test_foo.py
        flowforge/evolution/self_dev.py -> tests/evolution/test_self_dev.py
        flowforge/evolution/self_dev_code.py -> tests/evolution/test_self_dev_code.py
        """
        rel = source_file.replace("\\", "/")
        # 去掉 flowforge/ 前缀
        if rel.startswith("flowforge/"):
            inner = rel[len("flowforge/"):]
        else:
            inner = rel
        # 加 test_ 前缀
        parts = inner.split("/")
        parts[-1] = f"test_{parts[-1]}" if not parts[-1].startswith("test_") else parts[-1]
        return f"tests/{'/'.join(parts)}"

    async def _discover_from_pytest_failure(self, pytest_output: str) -> List[DevTask]:
        """从 pytest 失败输出提取待修复测试任务."""
        if not pytest_output:
            self._logger.warning("[Discover] pytest_failure 模式但无 pytest_output")
            return []

        tasks: List[DevTask] = []
        # 匹配 FAILED 模式
        failed_pattern = re.compile(
            r"FAILED\s+(\S+?\.py)::(\S+)\s*-\s*(.+?)(?:\n|$)"
        )
        for match in failed_pattern.finditer(pytest_output):
            test_file = match.group(1)
            test_func = match.group(2)
            error_msg = match.group(3).strip()
            self._logger.info(
                f"[Discover] 发现测试失败: {test_file}::{test_func}, "
                f"error={error_msg[:80]}"
            )
            tasks.append(DevTask(
                loop_type="test",
                target_path=test_file,
                modification_type="update",
                description=f"修复失败测试: {test_file}::{test_func} - {error_msg}",
                priority="high",
                context={
                    "source": "pytest_failure",
                    "test_func": test_func,
                    "error_msg": error_msg,
                },
            ))
        return tasks

    async def _discover_from_coverage_gap(self) -> List[DevTask]:
        """检测覆盖率不足的模块（运行 pytest --cov 提取）."""
        self._logger.info("[Discover] coverage_gap 模式：运行 pytest --cov")
        try:
            proc = await asyncio.create_subprocess_exec(
                "python", "-m", "pytest", "--cov=flowforge", "--cov-report=term",
                cwd=self.project_root,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(
                proc.communicate(), timeout=self._pytest_timeout
            )
            output = stdout.decode("utf-8", errors="replace")

            # 提取覆盖率不足的文件（Cover < 80%）
            tasks: List[DevTask] = []
            cov_pattern = re.compile(
                r"^(flowforge/\S+\.py)\s+\d+\s+\d+\s+(\d+)%"
            )
            for match in cov_pattern.finditer(output):
                file = match.group(1)
                cov = int(match.group(2))
                if cov < int(self._coverage_threshold * 100):
                    self._logger.info(
                        f"[Discover] 覆盖率不足: {file} ({cov}%)"
                    )
                    test_file = self._infer_test_path(file)
                    tasks.append(DevTask(
                        loop_type="test",
                        target_path=test_file,
                        modification_type="create",
                        description=f"提升 {file} 覆盖率（当前 {cov}%，目标 {int(self._coverage_threshold*100)}%）",
                        priority="normal",
                        context={
                            "source": "coverage_gap",
                            "source_file": file,
                            "current_coverage": cov,
                            "test_strategy": "unit",
                        },
                    ))
            return tasks
        except asyncio.TimeoutError:
            self._logger.warning("[Discover] pytest --cov 超时")
            return []
        except Exception as e:
            self._logger.warning(f"[Discover] pytest --cov 异常: {e}")
            return []

    # ══════════════════════════════════════════════════════════════
    # §2 Plan — 通过 LLM 生成测试方案
    # ══════════════════════════════════════════════════════════════

    async def plan(self, task: DevTask) -> DevPlan:
        """通过 TraeLLMClient 生成测试方案.

        Args:
            task: 测试任务（含 target_path / context['source_file'] / context['test_strategy']）

        Returns:
            DevPlan 测试方案（含具体测试用例步骤）
        """
        start_time = time.monotonic()
        self._logger.info(
            f"[Plan] 开始: task_id={task.task_id}, target={task.target_path}, "
            f"strategy={task.context.get('test_strategy', 'unit')}"
        )

        # 读取源文件内容（被测代码）
        source_file = task.context.get("source_file", "")
        existing_content = ""
        if source_file:
            abs_source = Path(self.project_root) / source_file
            if abs_source.exists():
                try:
                    existing_content = await asyncio.to_thread(
                        abs_source.read_text, encoding="utf-8"
                    )
                    self._logger.info(
                        f"[Plan] 读取被测代码: {len(existing_content)} 字符"
                    )
                except (OSError, UnicodeDecodeError) as e:
                    self._logger.warning(f"[Plan] 读取被测代码失败: {e}")

        # 读取已有测试文件内容（若存在，采用 append 模式 - I10）
        existing_test_content = ""
        abs_test = Path(self.project_root) / task.target_path
        if abs_test.exists():
            try:
                existing_test_content = await asyncio.to_thread(
                    abs_test.read_text, encoding="utf-8"
                )
                self._logger.info(
                    f"[Plan] 读取已有测试: {len(existing_test_content)} 字符（I10 append 模式）"
                )
            except (OSError, UnicodeDecodeError) as e:
                self._logger.warning(f"[Plan] 读取已有测试失败: {e}")

        # 构造 LLM 提示词
        prompt = self._build_plan_prompt(
            task, existing_content, existing_test_content
        )

        # 调用 TraeLLMClient
        from flowforge.llm.trae.models import BridgeRequestContext

        ctx = BridgeRequestContext(
            forgekin_id=self._forgekin_config.get("forgekin_id", "forgemind:davinci"),
            task_type="test_plan",
            task_summary=f"Plan tests for {task.context.get('source_file', task.target_path)}",
        )

        try:
            llm_result = await self._trae_client.chat(
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是 FlowForge 测试员可进化智能体（显微镜·达芬奇），"
                            "擅长编写符合 T1-T8 铁律的高质量测试. "
                            "T1 禁止 Mock LLM，T2 禁止假数据，"
                            "T3 必须具体断言，T6 必须采集指标，"
                            "T7 LLM 内容必须经 LLM 审核."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                context=ctx,
                temperature=0.2,  # 测试生成需要确定性
            )
            content = llm_result.get("content", "")
            model = llm_result.get("model", "unknown")
            self._logger.info(
                f"[Plan] LLM 返回: model={model}, content_len={len(content)}, "
                f"latency={llm_result.get('usage', {}).get('latency_ms', 0)}ms"
            )
        except Exception as e:
            self._logger.exception(f"[Plan] LLM 调用失败: {e}")
            return DevPlan(
                task_id=task.task_id,
                steps=[],
                expected_effect=f"LLM 调用失败: {e}",
                risk_assessment="high",
                requires_approval=False,
                llm_model="fallback",
            )

        # 解析 LLM 返回的方案
        steps, expected_effect, risk_assessment = self._parse_plan_response(content, task)

        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        self._logger.info(
            f"[Plan] 完成: steps={len(steps)}, expected={expected_effect[:50]}, "
            f"elapsed={elapsed_ms}ms"
        )

        return DevPlan(
            task_id=task.task_id,
            steps=steps,
            expected_effect=expected_effect,
            risk_assessment=risk_assessment,
            requires_approval=False,
            llm_model=model,
        )

    def _build_plan_prompt(
        self,
        task: DevTask,
        source_content: str,
        existing_test_content: str,
    ) -> str:
        """构造 Plan 阶段的 LLM 提示词."""
        source_file = task.context.get("source_file", "")
        strategy = task.context.get("test_strategy", "unit")

        # 截取前 4000 字符避免 token 过长
        source_preview = source_content[:4000]
        source_trunc = "（已截取）" if len(source_content) > 4000 else ""

        test_section = ""
        if existing_test_content:
            test_preview = existing_test_content[:2000]
            test_section = (
                f"【已有测试内容（前 2000 字符，I10 append 模式）】\n"
                f"```python\n{test_preview}\n```\n\n"
            )

        return (
            f"你是 FlowForge 测试员可进化智能体（显微镜·达芬奇）. "
            f"请为以下源文件设计 {strategy} 测试方案.\n\n"
            f"【任务信息】\n"
            f"源文件: {source_file}\n"
            f"测试文件: {task.target_path}\n"
            f"测试策略: {strategy}\n"
            f"修改类型: {task.modification_type}\n\n"
            f"【被测代码】{source_trunc}\n```python\n{source_preview}\n```\n\n"
            f"{test_section}"
            f"【T1-T8 铁律】\n"
            f"T1: 禁止 Mock LLM（必须真实调用 LLM）\n"
            f"T2: 禁止假数据（输入必须是真实场景数据，禁止 'test'/'hello'）\n"
            f"T3: 必须有具体断言（不能 status in ('completed','error')）\n"
            f"T4: 禁止 Mock 工具（web_search/publish 等必须真实调用）\n"
            f"T6: 必须采集指标（用 MetricsCollector 或类似）\n"
            f"T7: LLM 内容必须经 LLM 审核（调用 llm_review_content）\n"
            f"T8: Web 功能必须操控浏览器验证 DOM\n\n"
            f"【请输出 JSON】\n"
            f'{{"steps": [{{"action": "write_file"|"append", '
            f'"path": "{task.target_path}", "content": "测试代码"}}], '
            f'"expected_effect": "预期测试效果", "risk_assessment": "low|medium|high"}}'
        )

    def _parse_plan_response(
        self, content: str, task: DevTask
    ) -> Tuple[List[Dict[str, Any]], str, str]:
        """解析 LLM 返回的 Plan JSON."""
        # 清理 markdown 代码块包裹
        cleaned = re.sub(r"^```(?:json)?\s*", "", content.strip(), flags=re.MULTILINE)
        cleaned = re.sub(r"\s*```$", "", cleaned.strip())

        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                steps = parsed.get("steps", [])
                expected = parsed.get("expected_effect", "测试方案")
                risk = parsed.get("risk_assessment", "medium")
                self._logger.info(
                    f"[Plan] 解析成功: steps={len(steps)}, risk={risk}"
                )

                # I10 强制：若测试文件已存在，将 write_file 改为 append
                abs_test = Path(self.project_root) / task.target_path
                if abs_test.exists():
                    for step in steps:
                        if step.get("action") == "write_file":
                            step["action"] = "append"
                            self._logger.info(
                                f"[Plan] I10 强制：write_file -> append "
                                f"({task.target_path} 已存在)"
                            )

                return steps, expected, risk
        except (json.JSONDecodeError, ValueError) as e:
            self._logger.warning(f"[Plan] LLM 响应非 JSON 格式: {e}")

        # Fallback：返回空方案（不写入文件）
        self._logger.info("[Plan] 使用 fallback：空方案")
        return (
            [],
            "fallback：LLM 响应非 JSON，无测试方案",
            "high",
        )

    # ══════════════════════════════════════════════════════════════
    # §3 Act — 执行测试任务（生成/追加测试文件 + 运行 pytest）
    # ══════════════════════════════════════════════════════════════

    async def act(self, plan: DevPlan) -> DevResult:
        """执行测试任务.

        支持两种 action：
        - write_file: 完整写入新测试文件（仅当文件不存在时）
        - append: 追加测试用例到已有测试文件（I10 强制已存在文件用此模式）

        安全护栏前置检查（I10/T1-T8）：
        - I10: 禁止覆盖已有测试文件（强制 append）
        - T1-T8: 检查测试代码是否符合铁律（仅警告，不阻止写入）

        Args:
            plan: 测试方案（含 steps）

        Returns:
            DevResult 测试结果（changed_files 为测试文件路径列表）
        """
        start_time = time.monotonic()
        self._logger.info(
            f"[Act] 开始: plan_id={plan.plan_id}, steps={len(plan.steps)}"
        )

        changed_files: List[str] = []
        diff_summary_parts: List[str] = []
        success = True
        error_message = ""

        for idx, step in enumerate(plan.steps, 1):
            action = step.get("action", "")
            target = step.get("path", "")
            content = step.get("content", "")

            self._logger.info(
                f"[Act] 步骤 {idx}/{len(plan.steps)}: action={action}, "
                f"target={target}, content_len={len(content)}"
            )

            if not target:
                self._logger.warning(f"[Act] 步骤 {idx} 缺少 path，跳过")
                continue

            # ── I10 安全护栏：禁止覆盖已有测试文件 ──
            abs_path = Path(self.project_root) / target
            if action == "write_file" and abs_path.exists():
                self._logger.warning(
                    f"[Act] I10 违规：禁止覆盖已有测试文件 {target}，自动改为 append"
                )
                action = "append"

            # ── T1-T8 铁律检查（仅警告，不阻止写入）──
            if content:
                violations = self._check_test_quality(content, target)
                if violations:
                    self._logger.warning(
                        f"[Act] T1-T8 铁律警告（不阻止写入）: {violations}"
                    )

            try:
                if action == "write_file":
                    await self._write_file(abs_path, content)
                    changed_files.append(target)
                    diff_summary_parts.append(
                        f"write {target} ({len(content)} chars)"
                    )

                elif action == "append":
                    await self._append_file(abs_path, content)
                    changed_files.append(target)
                    diff_summary_parts.append(
                        f"append {len(content)} chars to {target}"
                    )

                else:
                    self._logger.warning(f"[Act] 未知 action: {action}")
                    diff_summary_parts.append(f"skip {action}")

            except Exception as e:
                self._logger.exception(f"[Act] 步骤 {idx} 执行失败: {e}")
                success = False
                error_message = f"步骤 {idx} 失败: {e}"
                break

        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        diff_summary = "; ".join(diff_summary_parts) if diff_summary_parts else "无变更"
        self._logger.info(
            f"[Act] 完成: success={success}, changed_files={len(changed_files)}, "
            f"elapsed={elapsed_ms}ms"
        )

        return DevResult(
            plan_id=plan.plan_id,
            changed_files=changed_files,
            diff_summary=diff_summary,
            success=success,
            error_message=error_message,
            elapsed_ms=elapsed_ms,
        )

    def _check_test_quality(self, content: str, target: str) -> List[str]:
        """T1-T8 铁律检查 — 返回违规列表（仅警告，不阻止写入）.

        检查项：
        - T1: 是否 Mock LLM
        - T2: 是否使用假数据
        - T3: 是否有模糊断言
        - T7: 是否调用 llm_review_content（仅对涉及 LLM 的测试）
        """
        violations: List[str] = []

        # 仅对 Python 测试文件做检查
        if not target.endswith(".py"):
            return violations

        # T1 检查：Mock LLM
        for pattern in _T1_MOCK_LLM_PATTERNS:
            if re.search(pattern, content, re.IGNORECASE):
                violations.append(f"T1 违规：检测到 Mock LLM 模式 {pattern!r}")
                break

        # T2 检查：假数据
        for pattern in _T2_FAKE_DATA_PATTERNS:
            if re.search(pattern, content):
                violations.append(f"T2 违规：检测到假数据模式 {pattern!r}")
                break

        # T3 检查：模糊断言
        for pattern in _T3_VAGUE_ASSERT_PATTERNS:
            if re.search(pattern, content):
                violations.append(f"T3 违规：检测到模糊断言 {pattern!r}")
                break

        # T7 检查：LLM 内容必须经 LLM 审核
        # 仅当测试代码涉及 LLM 调用时检查
        if "llm" in content.lower() or "trae_client" in content.lower():
            if not re.search(_T7_REVIEW_PATTERN, content):
                violations.append(
                    "T7 警告：测试涉及 LLM 但未调用 llm_review_content 审核"
                )

        return violations

    async def _write_file(self, abs_path: Path, content: str) -> None:
        """写入文件（确保目录存在）."""
        parent = abs_path.parent
        if not parent.exists():
            self._logger.info(f"[Act] 创建目录: {parent}")
            await asyncio.to_thread(parent.mkdir, parents=True, exist_ok=True)

        await asyncio.to_thread(abs_path.write_text, content, encoding="utf-8")
        self._logger.info(f"[Act] 写入测试文件: {abs_path} ({len(content)} chars)")

    async def _append_file(self, abs_path: Path, content: str) -> None:
        """追加内容到文件末尾（I10 安全模式）."""
        if not abs_path.exists():
            await self._write_file(abs_path, content)
            return

        def _append() -> None:
            with open(abs_path, "a", encoding="utf-8") as f:
                f.write("\n\n" + content)

        await asyncio.to_thread(_append)
        self._logger.info(f"[Act] 追加测试用例: {abs_path} ({len(content)} chars)")

    # ══════════════════════════════════════════════════════════════
    # §4 Verify — 验证测试质量
    # ══════════════════════════════════════════════════════════════

    async def verify(self, result: DevResult) -> VerifyResult:
        """验证测试质量.

        检查项：
        1. 测试文件存在性
        2. Python 语法检查（py_compile）
        3. T1-T8 铁律检查（强制，违反则 verify 失败）
        4. pytest 执行（测试是否通过）
        5. LLM 内容审核（T7 铁律）

        Args:
            result: 测试结果

        Returns:
            VerifyResult 验证结果
        """
        start_time = time.monotonic()
        self._logger.info(
            f"[Verify] 开始: result_id={result.result_id}, "
            f"changed_files={len(result.changed_files)}"
        )

        checks: List[Dict[str, Any]] = []
        failure_reasons: List[str] = []

        # 检查 1: 测试文件存在性
        for rel_path in result.changed_files:
            abs_path = Path(self.project_root) / rel_path
            exists = abs_path.exists()
            checks.append({
                "name": f"file_exists:{rel_path}",
                "passed": exists,
                "detail": f"{rel_path} {'存在' if exists else '不存在'}",
            })
            if not exists:
                failure_reasons.append(f"测试文件不存在: {rel_path}")

        # 检查 2: Python 语法检查
        for rel_path in result.changed_files:
            if not rel_path.endswith(".py"):
                continue
            abs_path = Path(self.project_root) / rel_path
            if not abs_path.exists():
                continue
            syntax_ok, syntax_err = await self._check_python_syntax(abs_path)
            checks.append({
                "name": f"syntax:{rel_path}",
                "passed": syntax_ok,
                "detail": "语法正确" if syntax_ok else f"语法错误: {syntax_err}",
            })
            if not syntax_ok:
                failure_reasons.append(f"{rel_path} 语法错误: {syntax_err}")

        # 检查 3: T1-T8 铁律检查（强制）
        for rel_path in result.changed_files:
            if not rel_path.endswith(".py"):
                continue
            abs_path = Path(self.project_root) / rel_path
            if not abs_path.exists():
                continue
            try:
                content = await asyncio.to_thread(
                    abs_path.read_text, encoding="utf-8"
                )
                violations = self._check_test_quality(content, rel_path)
                checks.append({
                    "name": f"t1_t8:{rel_path}",
                    "passed": not violations,
                    "detail": f"违规 {len(violations)} 项" if violations else "通过",
                })
                if violations:
                    failure_reasons.append(
                        f"{rel_path} T1-T8 铁律违规: {violations[:2]}"
                    )
            except (OSError, UnicodeDecodeError) as e:
                failure_reasons.append(f"读取 {rel_path} 失败: {e}")

        # 检查 4: pytest 执行（仅在语法和铁律检查通过时运行）
        if not failure_reasons and result.changed_files:
            pytest_passed, pytest_output, pytest_summary = await self._run_pytest(
                result.changed_files
            )
            checks.append({
                "name": "pytest_run",
                "passed": pytest_passed,
                "detail": pytest_summary,
            })
            if not pytest_passed:
                failure_reasons.append(
                    f"pytest 失败: {pytest_summary}"
                )

        # 检查 5: LLM 内容审核（T7 铁律）
        llm_review_passed = True
        if result.success and result.changed_files:
            last_test = Path(self.project_root) / result.changed_files[-1]
            if last_test.exists():
                try:
                    content_to_review = await asyncio.to_thread(
                        last_test.read_text, encoding="utf-8"
                    )
                    self._logger.info(
                        f"[Verify] 调用 LLM 审核测试: "
                        f"file={result.changed_files[-1]}, "
                        f"content_len={len(content_to_review)}"
                    )
                    review_result = await self.llm_review_content(
                        content_to_review[:5000],
                        content_type="test_code",
                        review_criteria=(
                            "1. 测试是否符合 T1-T8 铁律\n"
                            "2. 测试用例是否覆盖正常/异常/边界\n"
                            "3. 断言是否具体有效\n"
                            "4. 测试是否可维护（命名、结构、注释）"
                        ),
                    )
                    llm_review_passed = review_result.get("passed", False)
                    score = review_result.get("score", 0.0)
                    issues = review_result.get("issues", [])
                    self._logger.info(
                        f"[Verify] LLM 审核结果: passed={llm_review_passed}, "
                        f"score={score}, issues={len(issues)}"
                    )
                    checks.append({
                        "name": f"llm_review:{result.changed_files[-1]}",
                        "passed": llm_review_passed,
                        "detail": f"score={score}, issues={issues[:3]}",
                    })
                    if not llm_review_passed:
                        failure_reasons.append(
                            f"LLM 审核未通过 (score={score}): {issues[:2]}"
                        )
                except Exception as e:
                    self._logger.exception(f"[Verify] LLM 审核调用失败: {e}")
                    llm_review_passed = False
                    failure_reasons.append(f"LLM 审核调用失败: {e}")
                    checks.append({
                        "name": f"llm_review:{result.changed_files[-1]}",
                        "passed": False,
                        "detail": f"调用异常: {e}",
                    })

        passed = len(failure_reasons) == 0
        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        self._logger.info(
            f"[Verify] 完成: passed={passed}, checks={len(checks)}, "
            f"failures={len(failure_reasons)}, elapsed={elapsed_ms}ms"
        )

        return VerifyResult(
            result_id=result.result_id,
            passed=passed,
            checks=checks,
            failure_reasons=failure_reasons,
            llm_review_passed=llm_review_passed,
            elapsed_ms=elapsed_ms,
        )

    async def _check_python_syntax(self, abs_path: Path) -> Tuple[bool, str]:
        """检查 Python 文件语法（用 py_compile）."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "python", "-m", "py_compile", str(abs_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
            if proc.returncode == 0:
                return True, ""
            return False, stderr.decode("utf-8", errors="replace").strip()
        except asyncio.TimeoutError:
            return False, "py_compile 超时（10s）"
        except Exception as e:
            return False, f"py_compile 异常: {e}"

    async def _run_pytest(
        self, test_files: List[str]
    ) -> Tuple[bool, str, str]:
        """运行 pytest 验证测试.

        Returns:
            (passed, full_output, summary)
        """
        if not test_files:
            return True, "", "无测试文件"

        args = ["python", "-m", "pytest", "--tb=short", "-q"]
        args.extend(test_files)

        self._logger.info(f"[Verify] 运行 pytest: {args}")
        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                cwd=self.project_root,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=self._pytest_timeout
            )
            output = stdout.decode("utf-8", errors="replace")
            err = stderr.decode("utf-8", errors="replace")
            full_output = output + err

            # 提取 summary 行（如 "5 passed in 1.23s"）
            summary_match = re.search(
                r"=\s*\n((?:FAILED|ERROR|PASSED|\d+\s+(?:passed|failed|error)).+)",
                full_output,
            )
            summary = summary_match.group(1) if summary_match else (
                f"exit_code={proc.returncode}"
            )

            passed = proc.returncode == 0
            self._logger.info(
                f"[Verify] pytest 完成: passed={passed}, summary={summary}"
            )
            return passed, full_output, summary
        except asyncio.TimeoutError:
            self._logger.warning(
                f"[Verify] pytest 超时（{self._pytest_timeout}s）"
            )
            return False, "", f"pytest 超时（{self._pytest_timeout}s）"
        except Exception as e:
            self._logger.exception(f"[Verify] pytest 异常: {e}")
            return False, "", f"pytest 异常: {e}"


__all__ = ["SelfDevTestLoop"]
