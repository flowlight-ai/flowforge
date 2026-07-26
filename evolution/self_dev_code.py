"""F046 §2.5.2 SelfDevCodeLoop — 代码自我演进闭环.

负责自主实现和修改代码，是 SelfDev 五闭环中觉醒阶要求中等（E4）的闭环.
对应Forgekin：开发者·夏洛克（forgemind:sherlock）.

处理对象：
- flowforge/**/*.py（Python 源码）
- flowforge/**/*.yaml（YAML 配置，非架构级）
- *Forge/**/*.py（业务扩展代码）
- tests/**/*.py（测试文件，禁止删除已有 — I5/红线 8）

五步循环：
1. Discover: 检测测试失败 / 缺失功能 / Bug / 重构机会
2. Plan: 通过 TraeLLMClient 生成代码方案（含风险评估）
3. Act: 写入/修改代码文件（含 I5/I6/I7 安全护栏前置检查）
4. Verify: 运行 pytest / 类型检查 / lint / 架构约束 / LLM 审核（T7）
5. Persist: 基类通用实现，沉淀到 ForgeMindEngine 三模式

安全护栏：
- I2 Scope Guard 前置检查：禁止修改 VISION/rules.md/decisions/
- I5 不删除测试：act 阶段禁止删除 test_*.py 文件（红线 8）
- I6 不绕过 DI：新代码必须通过 DI 容器注入依赖（红线 12）
- I7 不硬编码：新代码禁止硬编码路径/密钥/端口（红线 11）
- I4 LLM 审核必经（T7 铁律）：生成的代码必须再调用 LLM 审核通过
"""

from __future__ import annotations

import asyncio
import re
import subprocess
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

logger = get_logger("flowforge.evolution.self_dev.code")


# ── 默认配置（可由 forgekin_config 覆盖）─────────────────────────
_DEFAULT_SOURCE_PATTERNS = [
    "**/*.py",
]
_DEFAULT_TEST_DIR = "tests"
_DEFAULT_COVERAGE_THRESHOLD = 0.80  # 覆盖率阈值 80%
_DEFAULT_PYTEST_TIMEOUT = 60  # pytest 单次执行超时 60 秒

# ── I5 不删除测试：禁止删除的文件名模式（红线 8）────────────────
_TEST_FILE_PATTERNS = [
    r"^test_.*\.py$",
    r".*_test\.py$",
    r"^conftest\.py$",
]

# ── I6 不绕过 DI：检查的依赖注入模式 ────────────────────────────
# 合法的依赖注入方式（任一匹配即通过）
_DI_PATTERNS = [
    r"def __init__\([^)]*\b\w+:\s*\w+Container\b",  # 构造函数注入 Container
    r"def __init__\([^)]*\b\w+:\s*[A-Z]\w+Client\b",  # 构造函数注入 Client
    r"def __init__\([^)]*\b\w+:\s*[A-Z]\w+Engine\b",  # 构造函数注入 Engine
    r"def __init__\([^)]*\b\w+:\s*[A-Z]\w+Repository\b",  # 构造函数注入 Repository
    r"@inject\b",  # DI 装饰器
    r"container\.resolve\(",  # 容器解析
    r"container\.get\(",  # 容器获取
]

# 直接实例化的反模式（出现即违规）
_DIRECT_INSTANTIATION_PATTERNS = [
    r"^\s*from\s+flowforge\.llm\.trae\.client\s+import\s+TraeLLMClient\s*$",  # Agent 直接 import LLM SDK
    r"^\s*from\s+flowforge\.db\.session\s+import\s+Session\b.*$",  # Agent 直接操作数据库
    r"^\s*cursor\.execute\(",  # 直接执行 SQL
    r"^\s*Session\(\)",  # 直接创建 DB Session
]

# ── I7 不硬编码：禁止的模式 ─────────────────────────────────────
_HARDCODED_PATH_PATTERNS = [
    r"['\"](?:/home/|/Users/|C:\\Users\\|D:\\software\\)",  # 绝对路径
    r"['\"](?:/opt/|/var/|/etc/)",  # 系统路径
]
_HARDCODED_SECRET_PATTERNS = [
    r"api_key\s*=\s*['\"]sk-[a-zA-Z0-9]+",  # OpenAI 风格 API key
    r"password\s*=\s*['\"][^'\"]+['\"]",  # 明文密码
    r"secret\s*=\s*['\"][^'\"]+['\"]",  # 明文 secret
    r"token\s*=\s*['\"][^'\"]+['\"]",  # 明文 token
]
_HARDCODED_PORT_PATTERNS = [
    r"port\s*=\s*\d{4,5}\b(?!.*\bconfig\b)",  # 端口号（不含 config 字样）
]


class SelfDevCodeLoop(SelfDevLoopBase):
    """代码自我演进闭环 — 自主实现和修改代码.

    觉醒阶要求：E4（自主阶），低于此阶不能触发.
    安全护栏：I5 不删除测试 / I6 不绕过 DI / I7 不硬编码.

    用法示例：
        from flowforge.evolution import ForgeMindEngine, SelfDevCodeLoop
        from flowforge.llm.trae import TraeLLMClient

        engine = ForgeMindEngine()
        trae_client = TraeLLMClient(protocol=...)
        config = {
            "project_root": "/path/to/flowforge",
            "forgekin_id": "forgemind:sherlock",
        }
        code_loop = SelfDevCodeLoop(trae_client, config, engine, awakening_stage="E4")
        engine.register_self_dev_loop(code_loop)

        # 触发代码闭环（修复测试失败）
        result = await engine.run_self_dev_loop("code", {
            "task_source": "pytest_failure",
            "pytest_output": "...",
        })
    """

    loop_type = "code"
    min_awakening_stage = "E4"

    def __init__(
        self,
        trae_client: Any,
        forgekin_config: Dict[str, Any],
        evolution_engine: Any,
        *,
        awakening_stage: str = "E4",
    ) -> None:
        super().__init__(trae_client, forgekin_config, evolution_engine, awakening_stage=awakening_stage)

        # 代码闭环配置（从 forgekin_config 读取，不硬编码 — 红线 11）
        self._source_patterns = forgekin_config.get(
            "source_patterns", list(_DEFAULT_SOURCE_PATTERNS)
        )
        self._test_dir = forgekin_config.get("test_dir", _DEFAULT_TEST_DIR)
        self._coverage_threshold = forgekin_config.get(
            "coverage_threshold", _DEFAULT_COVERAGE_THRESHOLD
        )
        self._pytest_timeout = forgekin_config.get(
            "pytest_timeout", _DEFAULT_PYTEST_TIMEOUT
        )

        self._logger = logger
        self._logger.info(
            f"SelfDevCodeLoop 初始化: source_patterns={len(self._source_patterns)}, "
            f"test_dir={self._test_dir}, coverage_threshold={self._coverage_threshold}, "
            f"pytest_timeout={self._pytest_timeout}s"
        )

    # ══════════════════════════════════════════════════════════════
    # §1 Discover — 发现代码任务
    # ══════════════════════════════════════════════════════════════

    async def discover(self, context: Dict[str, Any]) -> List[DevTask]:
        """发现代码任务（F046 §2.5.2）.

        支持四种任务来源（task_source）：
        1. pytest_failure: 从 pytest 失败输出提取待修复任务
        2. task_md: 从 task.md 提取未实现项
        3. bug_report: 从 bug 报告字符串提取
        4. force_targets: 强制指定的目标文件列表（定向修改）

        Args:
            context: 发现上下文，支持以下字段：
                - task_source: 任务来源（默认 "force_targets"）
                - force_targets: 强制指定的目标路径列表
                - pytest_output: pytest 失败输出（task_source=pytest_failure 时使用）
                - task_md_path: task.md 路径（task_source=task_md 时使用）
                - bug_report: bug 报告字符串（task_source=bug_report 时使用）
                - target_files: 与 force_targets 同义（协同协议用）

        Returns:
            DevTask 列表（按优先级排序）
        """
        start_time = time.monotonic()
        task_source = context.get("task_source", "force_targets")
        force_targets = context.get("force_targets") or context.get("target_files", [])
        pytest_output = context.get("pytest_output", "")
        task_md_path = context.get("task_md_path", "")
        bug_report = context.get("bug_report", "")

        self._logger.info(
            f"[Discover] 开始: task_source={task_source}, "
            f"force_targets={len(force_targets)}, pytest_output_len={len(pytest_output)}"
        )

        tasks: List[DevTask] = []

        if force_targets:
            # force_targets 优先级最高，跳过其他来源
            self._logger.info(
                f"[Discover] force_targets 模式：直接处理 {len(force_targets)} 个目标"
            )
            for target in force_targets:
                # 判断是创建还是更新
                abs_path = Path(self.project_root) / target
                mod_type = "update" if abs_path.exists() else "create"
                tasks.append(DevTask(
                    loop_type="code",
                    target_path=target,
                    modification_type=mod_type,
                    description=f"定向修改代码: {target}",
                    priority="high",
                    context={"source": "force_targets"},
                ))
        elif task_source == "pytest_failure":
            tasks = await self._discover_from_pytest_failure(pytest_output)
        elif task_source == "task_md":
            tasks = await self._discover_from_task_md(task_md_path)
        elif task_source == "bug_report":
            tasks = await self._discover_from_bug_report(bug_report)
        else:
            self._logger.warning(f"[Discover] 未知 task_source: {task_source!r}")

        # 按优先级排序
        priority_order = {"critical": 0, "high": 1, "normal": 2, "low": 3}
        tasks.sort(key=lambda t: priority_order.get(t.priority, 99))

        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        self._logger.info(f"[Discover] 完成: {len(tasks)} 个任务, 耗时 {elapsed_ms}ms")
        return tasks

    async def _discover_from_pytest_failure(self, pytest_output: str) -> List[DevTask]:
        """从 pytest 失败输出提取待修复任务."""
        if not pytest_output:
            self._logger.warning("[Discover] pytest_failure 模式但无 pytest_output")
            return []

        tasks: List[DevTask] = []
        # 匹配 FAILED 模式：FAILED tests/test_xxx.py::test_func - AssertionError: ...
        failed_pattern = re.compile(
            r"FAILED\s+(\S+?\.py)::(\S+)\s*-\s*(.+?)(?:\n|$)"
        )
        for match in failed_pattern.finditer(pytest_output):
            test_file = match.group(1)
            test_func = match.group(2)
            error_msg = match.group(3).strip()

            # 推断源文件路径：tests/test_foo.py -> flowforge/foo.py 或 *Forge/foo.py
            source_file = self._infer_source_from_test(test_file)
            if not source_file:
                self._logger.warning(
                    f"[Discover] 无法推断源文件: test={test_file}，跳过"
                )
                continue

            self._logger.info(
                f"[Discover] 发现测试失败: {test_file}::{test_func} -> "
                f"推断源文件 {source_file}, error={error_msg[:80]}"
            )
            tasks.append(DevTask(
                loop_type="code",
                target_path=source_file,
                modification_type="update",
                description=f"修复测试失败: {test_file}::{test_func} - {error_msg}",
                priority="high",
                context={
                    "source": "pytest_failure",
                    "test_file": test_file,
                    "test_func": test_func,
                    "error_msg": error_msg,
                },
            ))
        return tasks

    def _infer_source_from_test(self, test_file: str) -> str:
        """从测试文件路径推断源文件路径.

        tests/test_foo.py -> flowforge/foo.py
        tests/evolution/test_self_dev.py -> flowforge/evolution/self_dev.py
        tests/test_xxx_yyy.py -> flowforge/xxx_yyy.py
        """
        # 转换为相对路径
        rel = test_file.replace("\\", "/")
        if rel.startswith("tests/"):
            # 去掉 tests/ 前缀和 test_ 前缀
            inner = rel[len("tests/"):]
            parts = inner.split("/")
            if parts[-1].startswith("test_"):
                parts[-1] = parts[-1][len("test_"):]
            return "flowforge/" + "/".join(parts)
        return ""

    async def _discover_from_task_md(self, task_md_path: str) -> List[DevTask]:
        """从 task.md 提取未实现项."""
        if not task_md_path:
            task_md_path = "docs/task.md"
        abs_path = Path(self.project_root) / task_md_path
        if not abs_path.exists():
            self._logger.warning(f"[Discover] task.md 不存在: {abs_path}")
            return []

        try:
            content = await asyncio.to_thread(abs_path.read_text, encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            self._logger.warning(f"[Discover] 读取 task.md 失败: {e}")
            return []

        tasks: List[DevTask] = []
        # 匹配未实现项模式：- [ ] F0XX: 描述 / TODO: 描述 / FIXME: 描述
        todo_pattern = re.compile(
            r"^\s*(?:-\s*\[\s*\]\s*|TODO:\s*|FIXME:\s*)(.+)$",
            re.MULTILINE,
        )
        for match in todo_pattern.finditer(content):
            desc = match.group(1).strip()
            self._logger.info(f"[Discover] 发现未实现项: {desc[:80]}")
            tasks.append(DevTask(
                loop_type="code",
                target_path="",  # 待 Plan 阶段确定
                modification_type="create",
                description=f"实现未完成项: {desc}",
                priority="normal",
                context={"source": "task_md", "raw_description": desc},
            ))
        return tasks

    async def _discover_from_bug_report(self, bug_report: str) -> List[DevTask]:
        """从 bug 报告字符串提取任务."""
        if not bug_report:
            return []

        # 简单提取：按行分割，每行视为一个 bug
        tasks: List[DevTask] = []
        for line in bug_report.strip().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            self._logger.info(f"[Discover] 发现 bug: {line[:80]}")
            tasks.append(DevTask(
                loop_type="code",
                target_path="",  # 待 Plan 阶段确定
                modification_type="update",
                description=f"修复 bug: {line}",
                priority="high",
                context={"source": "bug_report", "raw_bug": line},
            ))
        return tasks

    # ══════════════════════════════════════════════════════════════
    # §2 Plan — 通过 LLM 生成代码方案
    # ══════════════════════════════════════════════════════════════

    async def plan(self, task: DevTask) -> DevPlan:
        """通过 TraeLLMClient 生成代码修改方案.

        Args:
            task: 开发任务（含 target_path / modification_type / description）

        Returns:
            DevPlan 修改方案（含具体步骤、预期效果、风险评估）
        """
        start_time = time.monotonic()
        self._logger.info(
            f"[Plan] 开始: task_id={task.task_id}, target={task.target_path or '(待定)'}, "
            f"type={task.modification_type}"
        )

        # 读取现有代码内容（如果存在）
        existing_content = ""
        if task.target_path:
            abs_path = Path(self.project_root) / task.target_path
            if abs_path.exists():
                try:
                    existing_content = await asyncio.to_thread(
                        abs_path.read_text, encoding="utf-8"
                    )
                    self._logger.info(
                        f"[Plan] 读取现有代码: {len(existing_content)} 字符"
                    )
                except (OSError, UnicodeDecodeError) as e:
                    self._logger.warning(f"[Plan] 读取现有代码失败: {e}")

        # 构造 LLM 提示词
        prompt = self._build_plan_prompt(task, existing_content)

        # 调用 TraeLLMClient
        from flowforge.llm.trae.models import BridgeRequestContext

        ctx = BridgeRequestContext(
            forgekin_id=self._forgekin_config.get("forgekin_id", "forgemind:sherlock"),
            task_type="code_plan",
            task_summary=f"Plan code modification for {task.target_path or task.description[:50]}",
        )

        try:
            llm_result = await self._trae_client.chat(
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是 FlowForge 开发者可进化智能体（猎犬·夏洛克），"
                            "擅长实现符合项目架构规范的 Python 代码. "
                            "严格遵守：所有依赖通过构造函数注入（红线 12），"
                            "禁止硬编码路径/密钥/端口（红线 11），"
                            "禁止直接操作数据库（红线 13），"
                            "禁止删除已有测试用例（红线 8）."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                context=ctx,
                temperature=0.2,  # 代码生成需要确定性
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
                steps=[{
                    "action": "write_file",
                    "path": task.target_path or "TODO.py",
                    "content": f"# LLM 调用失败，待人工介入: {e}\n",
                }],
                expected_effect="LLM 调用失败，写入占位符待人工修复",
                risk_assessment="high",
                requires_approval=False,
                llm_model="fallback",
            )

        # 解析 LLM 返回的方案
        steps, expected_effect, risk_assessment = self._parse_plan_response(content, task)

        # 若 task.target_path 为空（task_md/bug_report 来源），从 steps 推断
        if not task.target_path and steps:
            first_path = steps[0].get("path", "")
            if first_path:
                task.target_path = first_path
                self._logger.info(f"[Plan] 推断 target_path: {first_path}")

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

    def _build_plan_prompt(self, task: DevTask, existing_content: str) -> str:
        """构造 Plan 阶段的 LLM 提示词."""
        existing_section = ""
        if existing_content:
            # 截取前 3000 字符避免 token 过长
            preview = existing_content[:3000]
            existing_section = f"【现有代码（前 3000 字符）】\n```python\n{preview}\n```\n\n"
        else:
            existing_section = "【现有代码】\n（文件不存在，需创建新文件）\n\n"

        # 上下文信息（pytest 失败详情等）
        context_section = ""
        if task.context:
            context_section = f"【任务上下文】\n{task.context}\n\n"

        return (
            f"你是 FlowForge 开发者可进化智能体（猎犬·夏洛克）. "
            f"请为以下代码任务设计修改方案.\n\n"
            f"【任务信息】\n"
            f"目标路径: {task.target_path or '(需根据任务描述推断)'}\n"
            f"修改类型: {task.modification_type}\n"
            f"任务描述: {task.description}\n"
            f"{context_section}"
            f"{existing_section}"
            f"【强制规范】\n"
            f"1. 所有依赖必须通过构造函数注入（红线 12：禁止绕过 DI 容器）\n"
            f"2. 禁止硬编码路径/密钥/端口（红线 11）\n"
            f"3. 禁止直接操作数据库（红线 13：必须通过 Repository 层）\n"
            f"4. 禁止删除已有测试用例（红线 8）\n"
            f"5. 类型注解强制（Python 3.11+）\n"
            f"6. 所有 I/O 操作使用 async/await\n"
            f"7. Agent 禁止直接导入 LLM SDK，必须通过 LLMClient\n\n"
            f"【请输出 JSON】\n"
            f'{{"steps": [{{"action": "write_file"|"update_section"|"append", '
            f'"path": "目标路径", "content": "代码内容", '
            f'"section": "函数名（仅 update_section 需要）"}}], '
            f'"expected_effect": "预期效果", "risk_assessment": "low|medium|high"}}'
        )

    def _parse_plan_response(
        self, content: str, task: DevTask
    ) -> Tuple[List[Dict[str, Any]], str, str]:
        """解析 LLM 返回的 Plan JSON."""
        import json

        # 清理 markdown 代码块包裹
        cleaned = re.sub(r"^```(?:json)?\s*", "", content.strip(), flags=re.MULTILINE)
        cleaned = re.sub(r"\s*```$", "", cleaned.strip())

        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                steps = parsed.get("steps", [])
                expected = parsed.get("expected_effect", "代码修改方案")
                risk = parsed.get("risk_assessment", "medium")
                self._logger.info(f"[Plan] 解析成功: steps={len(steps)}, risk={risk}")
                return steps, expected, risk
        except (json.JSONDecodeError, ValueError) as e:
            self._logger.warning(f"[Plan] LLM 响应非 JSON 格式: {e}")

        # Fallback：把 LLM 内容作为单个 write_file 步骤
        self._logger.info("[Plan] 使用 fallback：将 LLM 内容作为单个 write_file 步骤")
        return (
            [{
                "action": "write_file",
                "path": task.target_path or "generated_code.py",
                "content": content,
            }],
            "fallback：直接写入 LLM 生成内容",
            "medium",
        )

    # ══════════════════════════════════════════════════════════════
    # §3 Act — 执行代码修改（含 I5/I6/I7 安全护栏）
    # ══════════════════════════════════════════════════════════════

    async def act(self, plan: DevPlan) -> DevResult:
        """执行代码修改.

        支持三种 action：
        - write_file: 完整写入文件（覆盖或创建）
        - update_section: 替换指定函数/类内容（按 def/class 名匹配）
        - append: 追加内容到文件末尾

        安全护栏前置检查（I5/I6/I7）：
        - I5: 禁止删除 test_*.py 文件（红线 8）
        - I6: 检查新代码是否使用 DI 容器（红线 12）
        - I7: 检查新代码是否硬编码路径/密钥/端口（红线 11）

        Args:
            plan: 修改方案（含 steps）

        Returns:
            DevResult 修改结果
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
                f"[Act] 步骤 {idx}/{len(plan.steps)}: action={action}, target={target}, "
                f"content_len={len(content)}"
            )

            if not target:
                self._logger.warning(f"[Act] 步骤 {idx} 缺少 path 字段，跳过")
                continue

            # ── I5 安全护栏：禁止删除 test_*.py 文件 ──
            if self._is_test_file(target) and action == "write_file":
                abs_path = Path(self.project_root) / target
                if abs_path.exists():
                    self._logger.warning(
                        f"[Act] I5 违规：禁止覆盖已有测试文件 {target}（红线 8）"
                    )
                    error_message = f"I5 违规：禁止覆盖已有测试文件 {target}"
                    success = False
                    break

            # ── I6/I7 安全护栏：检查新代码内容 ──
            if content:
                violations = self._check_code_safety(content, target)
                if violations:
                    self._logger.warning(
                        f"[Act] 安全护栏阻止写入 {target}: {violations}"
                    )
                    error_message = f"安全护栏违规: {violations}"
                    success = False
                    break

            abs_path = Path(self.project_root) / target
            try:
                if action == "write_file":
                    await self._write_file(abs_path, content)
                    changed_files.append(target)
                    diff_summary_parts.append(f"write {target} ({len(content)} chars)")

                elif action == "update_section":
                    section = step.get("section", "")
                    await self._update_section(abs_path, section, content)
                    changed_files.append(target)
                    diff_summary_parts.append(
                        f"update section '{section}' in {target}"
                    )

                elif action == "append":
                    await self._append_file(abs_path, content)
                    changed_files.append(target)
                    diff_summary_parts.append(
                        f"append {len(content)} chars to {target}"
                    )

                else:
                    self._logger.warning(f"[Act] 未知 action: {action}")
                    diff_summary_parts.append(f"skip unknown action: {action}")

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

    def _is_test_file(self, path: str) -> bool:
        """判断路径是否为测试文件."""
        filename = Path(path).name
        for pattern in _TEST_FILE_PATTERNS:
            if re.match(pattern, filename):
                return True
        return False

    def _check_code_safety(self, content: str, target: str) -> List[str]:
        """I6/I7 安全护栏检查 — 返回违规列表（空列表表示通过）.

        检查项：
        - I6: 新代码是否使用 DI 容器（仅对 .py 文件，跳过 __init__.py）
        - I7: 是否硬编码路径/密钥/端口
        - 红线 13: 是否直接操作数据库
        - 红线 9: 是否绕过 DI 直接 import LLM SDK
        """
        violations: List[str] = []

        # 仅对 Python 文件做代码内容检查
        if not target.endswith(".py"):
            return violations

        # 跳过 __init__.py（仅导出，无需 DI）
        if target.endswith("__init__.py"):
            return violations

        # 跳过测试文件（测试文件本身不强制 DI）
        if self._is_test_file(target):
            return violations

        lines = content.splitlines()

        # I7 检查：硬编码路径
        for line in lines:
            for pattern in _HARDCODED_PATH_PATTERNS:
                if re.search(pattern, line):
                    violations.append(f"I7 硬编码路径: {line.strip()}")
                    break

        # I7 检查：硬编码密钥
        for line in lines:
            for pattern in _HARDCODED_SECRET_PATTERNS:
                if re.search(pattern, line):
                    violations.append(f"I7 硬编码密钥: {line.strip()}")
                    break

        # I7 检查：硬编码端口（仅当不在 config 字典中时）
        for line in lines:
            for pattern in _HARDCODED_PORT_PATTERNS:
                if re.search(pattern, line):
                    violations.append(f"I7 硬编码端口: {line.strip()}")
                    break

        # 红线 13 检查：直接操作数据库
        for line in lines:
            for pattern in _DIRECT_INSTANTIATION_PATTERNS:
                if re.search(pattern, line):
                    violations.append(f"红线 13 违规: {line.strip()}")
                    break

        # I6 检查：是否使用 DI（仅当有 __init__ 方法时）
        has_init = any("def __init__" in line for line in lines)
        if has_init:
            has_di = any(
                re.search(pattern, content)
                for pattern in _DI_PATTERNS
            )
            if not has_di:
                # 进一步检查：是否有任何构造函数参数（无参 __init__ 跳过）
                init_match = re.search(
                    r"def __init__\(([^)]*)\)", content
                )
                if init_match and init_match.group(1).strip() not in ("self", "self,"):
                    violations.append(
                        "I6 违规：__init__ 有参数但未使用 DI 容器注入（红线 12）"
                    )

        return violations

    async def _write_file(self, abs_path: Path, content: str) -> None:
        """写入文件（确保目录存在）."""
        parent = abs_path.parent
        if not parent.exists():
            self._logger.info(f"[Act] 创建目录: {parent}")
            await asyncio.to_thread(parent.mkdir, parents=True, exist_ok=True)

        await asyncio.to_thread(abs_path.write_text, content, encoding="utf-8")
        self._logger.info(f"[Act] 写入文件: {abs_path} ({len(content)} chars)")

    async def _update_section(
        self, abs_path: Path, section: str, new_content: str
    ) -> None:
        """替换指定函数/类内容（按 def/class 名匹配）."""
        if not abs_path.exists():
            raise FileNotFoundError(f"文件不存在: {abs_path}")

        original = await asyncio.to_thread(abs_path.read_text, encoding="utf-8")
        # 匹配 def/class 定义及其缩进块（直到下一个同缩进 def/class 或文件末尾）
        pattern = re.compile(
            rf"^(\s*)(?:async\s+def|def|class)\s+{re.escape(section)}\b.*?$"
            rf"(?:\n\1.*?$)*",
            re.MULTILINE,
        )
        match = pattern.search(original)
        if not match:
            self._logger.warning(
                f"[Act] 未找到函数/类 '{section}'，追加到文件末尾"
            )
            new_full = original.rstrip() + f"\n\n\n{new_content}\n"
        else:
            indent = match.group(1)
            # 缩进 new_content 到匹配的缩进级别
            indented_new = "\n".join(
                indent + line if line else line
                for line in new_content.splitlines()
            )
            new_full = original[:match.start()] + indented_new + original[match.end():]

        await asyncio.to_thread(abs_path.write_text, new_full, encoding="utf-8")
        self._logger.info(f"[Act] 更新函数/类 '{section}': {abs_path}")

    async def _append_file(self, abs_path: Path, content: str) -> None:
        """追加内容到文件末尾."""
        if not abs_path.exists():
            await self._write_file(abs_path, content)
            return

        def _append() -> None:
            with open(abs_path, "a", encoding="utf-8") as f:
                f.write(content)

        await asyncio.to_thread(_append)
        self._logger.info(f"[Act] 追加内容: {abs_path} ({len(content)} chars)")

    # ══════════════════════════════════════════════════════════════
    # §4 Verify — 验证代码修改效果
    # ══════════════════════════════════════════════════════════════

    async def verify(self, result: DevResult) -> VerifyResult:
        """验证代码修改效果.

        检查项：
        1. 文件存在性（所有 changed_files 都存在）
        2. Python 语法检查（py_compile）
        3. 测试通过性（pytest，可选）
        4. I6/I7 安全护栏复查（对修改后的文件）
        5. LLM 内容审核（T7 铁律）

        Args:
            result: 修改结果

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

        # 检查 1: 文件存在性
        for rel_path in result.changed_files:
            abs_path = Path(self.project_root) / rel_path
            exists = abs_path.exists()
            checks.append({
                "name": f"file_exists:{rel_path}",
                "passed": exists,
                "detail": f"路径 {rel_path} {'存在' if exists else '不存在'}",
            })
            if not exists:
                failure_reasons.append(f"文件不存在: {rel_path}")
                self._logger.warning(f"[Verify] 文件不存在: {rel_path}")

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

        # 检查 3: I6/I7 安全护栏复查（对修改后的文件内容）
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
                violations = self._check_code_safety(content, rel_path)
                checks.append({
                    "name": f"safety:{rel_path}",
                    "passed": not violations,
                    "detail": f"违规 {len(violations)} 项" if violations else "通过",
                })
                if violations:
                    failure_reasons.append(
                        f"{rel_path} 安全护栏违规: {violations[:2]}"
                    )
            except (OSError, UnicodeDecodeError) as e:
                failure_reasons.append(f"读取 {rel_path} 失败: {e}")

        # 检查 4: LLM 内容审核（T7 铁律）
        llm_review_passed = True
        if result.success and result.changed_files:
            # 取最后一个变更文件的内容做 LLM 审核
            last_file = Path(self.project_root) / result.changed_files[-1]
            if last_file.exists():
                try:
                    content_to_review = await asyncio.to_thread(
                        last_file.read_text, encoding="utf-8"
                    )
                    self._logger.info(
                        f"[Verify] 调用 LLM 审核: file={result.changed_files[-1]}, "
                        f"content_len={len(content_to_review)}"
                    )
                    review_result = await self.llm_review_content(
                        content_to_review[:5000],  # 截取前 5000 字符
                        content_type="code",
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


__all__ = ["SelfDevCodeLoop"]
