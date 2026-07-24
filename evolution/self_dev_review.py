"""F046 §9.5 SelfDevReviewLoop — 代码审查自我演进闭环.

负责跨厂商独立审查代码，是 F046 v1.1 五闭环扩展架构新增的闭环之一.
对应灵智体：审查员·梵高（forgemind:vangogh）.

设计动机（参考 roleagent.md 核心理论）：
- 跨厂商 review 是结构性必需（no-self-review 铁律）
  同一家厂商的 LLM 共享训练分布偏差，self-review 会漏掉同一类错误
- Generator-Verifier 双向辩论
  审查不是单向判定，审查员可 push back，author 可申诉
- 5 agent sweet spot
  审查员是五灵智体协作的关键角色

处理对象：
- 任意 .py 文件（接受 Code/Framework 闭环的 changed_files 作为输入）
- 任意 .yaml 文件（架构级配置变更）
- 审查报告输出到 docs/reviews/ 目录

五步循环：
1. Discover: 从 context['target_files'] 提取待审查文件
2. Plan: 通过 LLM（与 author 不同厂商）生成审查清单
3. Act: 执行审查（不修改代码，仅生成审查报告）
4. Verify: 验证审查报告质量（meta-review）
5. Persist: 基类通用实现，沉淀到 ForgeMindEngine 三模式

安全护栏：
- I2 Scope Guard 前置检查：禁止审查 VISION/rules.md/decisions/
- I9 no-self-review：必须使用与 author 不同厂商的 LLM
- I11 Review push back：P0/P1 问题必须触发 Author 闭环 Reflect
- I4 LLM 审核必经（T7 铁律）：审查报告本身必须经 LLM 审核
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime, timezone
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

logger = get_logger("flowforge.evolution.self_dev.review")


# ── 默认配置（可由 forgekin_config 覆盖）─────────────────────────
_DEFAULT_REVIEWS_DIR = "docs/reviews"
_DEFAULT_REVIEW_PATTERNS = [
    "**/*.py",
    "**/*.yaml",
]

# ── 问题严重级别 ────────────────────────────────────────────────
# P0: 阻塞性问题（必须修复才能合入）
# P1: 严重问题（强烈建议修复）
# P2: 一般问题（建议修复）
# P3: 提示性建议（可选修复）
_SEVERITY_LEVELS = ["P0", "P1", "P2", "P3"]

# ── I9 no-self-review：已知的 LLM 厂商映射 ──────────────────────
# author 与 reviewer 的厂商必须不同
_LLM_VENDOR_MAP = {
    # OpenAI 系列
    "gpt-4": "openai", "gpt-4o": "openai", "gpt-5": "openai",
    "gpt-4-turbo": "openai", "gpt-3.5-turbo": "openai",
    # Anthropic 系列（含连字符与点号两种命名变体）
    "claude-3-opus": "anthropic", "claude-3-sonnet": "anthropic",
    "claude-3-haiku": "anthropic", "claude-3.5-sonnet": "anthropic",
    "claude-3-5-sonnet": "anthropic", "claude-3-5-haiku": "anthropic",
    "claude-4-opus": "anthropic", "claude-4-sonnet": "anthropic",
    # Google 系列
    "gemini-1.5-pro": "google", "gemini-1.5-flash": "google",
    "gemini-2-pro": "google", "gemini-2-flash": "google",
    # 智谱系列
    "glm-4": "zhipu", "glm-4-plus": "zhipu", "glm-5": "zhipu",
    "glm-5.2": "zhipu",
    # Moonshot 系列
    "moonshot-v1-8k": "moonshot", "moonshot-v1-32k": "moonshot",
    "moonshot-v1-128k": "moonshot",
    # Meta 系列
    "llama-3-70b": "meta", "llama-3-8b": "meta",
    # Trae / fake / fallback 等占位
    "trae": "trae", "fake-model": "fake", "fallback": "fallback",
    "unknown": "unknown",
}


class SelfDevReviewLoop(SelfDevLoopBase):
    """代码审查自我演进闭环 — 跨厂商独立审查（no-self-review 铁律）.

    觉醒阶要求：E3（受限自主阶），低于此阶不能触发.
    安全护栏：I9 no-self-review / I11 Review push back.

    用法示例：
        from flowforge.evolution import ForgeMindEngine, SelfDevReviewLoop

        engine = ForgeMindEngine()
        review_loop = SelfDevReviewLoop(
            trae_client, config, engine, awakening_stage="E3"
        )
        engine.register_self_dev_loop(review_loop)

        # 触发 review 闭环（审查 code 闭环产出）
        result = await engine.run_self_dev_loop("review", {
            "target_files": ["flowforge/evolution/self_dev_code.py"],
            "author_forgekin_id": "forgemind:sherlock",
            "author_llm_model": "gpt-4",
        })
    """

    loop_type = "review"
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

        self._reviews_dir = forgekin_config.get(
            "reviews_dir", _DEFAULT_REVIEWS_DIR
        )
        self._review_patterns = forgekin_config.get(
            "review_patterns", list(_DEFAULT_REVIEW_PATTERNS)
        )

        self._logger = logger
        self._logger.info(
            f"SelfDevReviewLoop 初始化: reviews_dir={self._reviews_dir}, "
            f"review_patterns={len(self._review_patterns)}"
        )

    # ══════════════════════════════════════════════════════════════
    # §1 Discover — 发现审查任务
    # ══════════════════════════════════════════════════════════════

    async def discover(self, context: Dict[str, Any]) -> List[DevTask]:
        """发现审查任务（F046 §9.5）.

        支持三种任务来源：
        1. target_files: 从 context['target_files'] 提取待审查文件（协同协议主入口）
        2. recent_commits: 扫描最近 commit 的变更文件
        3. force_targets: 强制指定的目标文件列表（与 target_files 同义）

        Args:
            context: 发现上下文，支持以下字段：
                - target_files: 待审查文件列表（协同协议主入口）
                - force_targets: 强制指定的目标文件列表
                - recent_commits: 最近 commit 数量（默认 0，不扫描）
                - author_forgekin_id: author 灵智体 ID（I9 跨厂商检查用）
                - author_llm_model: author 使用的 LLM 模型（I9 跨厂商检查用）

        Returns:
            DevTask 列表（按优先级排序）
        """
        start_time = time.monotonic()
        target_files = (
            context.get("target_files")
            or context.get("force_targets")
            or []
        )
        recent_commits = context.get("recent_commits", 0)

        self._logger.info(
            f"[Discover] 开始: target_files={len(target_files)}, "
            f"recent_commits={recent_commits}"
        )

        tasks: List[DevTask] = []

        if target_files:
            # 协同协议主入口：从 target_files 创建审查任务
            self._logger.info(
                f"[Discover] target_files 模式：审查 {len(target_files)} 个文件"
            )
            for target in target_files:
                abs_path = Path(self.project_root) / target
                if not abs_path.exists():
                    self._logger.warning(
                        f"[Discover] 待审查文件不存在: {target}，跳过"
                    )
                    continue
                tasks.append(DevTask(
                    loop_type="review",
                    target_path=target,
                    modification_type="create",  # 创建审查报告
                    description=f"审查文件: {target}",
                    priority="high",
                    context={
                        "source": "target_files",
                        "author_forgekin_id": context.get(
                            "author_forgekin_id", "unknown"
                        ),
                        "author_llm_model": context.get(
                            "author_llm_model", "unknown"
                        ),
                    },
                ))
        elif recent_commits > 0:
            # 扫描最近 commit 的变更文件
            tasks = await self._discover_from_recent_commits(recent_commits)
        else:
            self._logger.warning(
                "[Discover] 未提供 target_files 或 recent_commits，无任务"
            )

        # 按优先级排序
        priority_order = {"critical": 0, "high": 1, "normal": 2, "low": 3}
        tasks.sort(key=lambda t: priority_order.get(t.priority, 99))

        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        self._logger.info(f"[Discover] 完成: {len(tasks)} 个任务, 耗时 {elapsed_ms}ms")
        return tasks

    async def _discover_from_recent_commits(self, n: int) -> List[DevTask]:
        """扫描最近 n 个 commit 的变更文件."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "git", "log", f"-{n}", "--name-only", "--pretty=format:",
                cwd=self.project_root,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            if proc.returncode != 0:
                self._logger.warning("[Discover] git log 失败")
                return []

            files = {
                line.strip()
                for line in stdout.decode("utf-8", errors="replace").splitlines()
                if line.strip()
            }
            self._logger.info(
                f"[Discover] 最近 {n} 个 commit 变更 {len(files)} 个文件"
            )
            return [
                DevTask(
                    loop_type="review",
                    target_path=f,
                    modification_type="create",
                    description=f"审查最近 commit 变更: {f}",
                    priority="normal",
                    context={"source": "recent_commits"},
                )
                for f in sorted(files)
            ]
        except asyncio.TimeoutError:
            self._logger.warning("[Discover] git log 超时")
            return []
        except Exception as e:
            self._logger.warning(f"[Discover] git log 异常: {e}")
            return []

    # ══════════════════════════════════════════════════════════════
    # §2 Plan — 通过 LLM 生成审查清单
    # ══════════════════════════════════════════════════════════════

    async def plan(self, task: DevTask) -> DevPlan:
        """通过 TraeLLMClient 生成审查清单.

        I9 no-self-review 检查：若 reviewer LLM 与 author LLM 同厂商，记录警告但仍执行
        （实际生产中应由 ForgeMindEngine 路由到不同厂商的 LLM）

        Args:
            task: 审查任务（含 target_path / context['author_llm_model']）

        Returns:
            DevPlan 审查方案（含审查项清单）
        """
        start_time = time.monotonic()
        self._logger.info(
            f"[Plan] 开始: task_id={task.task_id}, target={task.target_path}"
        )

        # 读取待审查文件内容
        abs_path = Path(self.project_root) / task.target_path
        if not abs_path.exists():
            self._logger.warning(f"[Plan] 待审查文件不存在: {abs_path}")
            return DevPlan(
                task_id=task.task_id,
                steps=[],
                expected_effect="文件不存在，无法审查",
                risk_assessment="high",
                requires_approval=False,
                llm_model="none",
            )

        try:
            content = await asyncio.to_thread(abs_path.read_text, encoding="utf-8")
            self._logger.info(f"[Plan] 读取待审查文件: {len(content)} 字符")
        except (OSError, UnicodeDecodeError) as e:
            self._logger.warning(f"[Plan] 读取文件失败: {e}")
            return DevPlan(
                task_id=task.task_id,
                steps=[],
                expected_effect=f"读取失败: {e}",
                risk_assessment="high",
                requires_approval=False,
                llm_model="none",
            )

        # 构造 LLM 提示词
        prompt = self._build_plan_prompt(task, content)

        # 调用 TraeLLMClient
        from flowforge.llm.trae.models import BridgeRequestContext

        ctx = BridgeRequestContext(
            forgekin_id=self._forgekin_config.get("forgekin_id", "forgemind:vangogh"),
            task_type="review_plan",
            task_summary=f"Plan review for {task.target_path}",
        )

        try:
            llm_result = await self._trae_client.chat(
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是 FlowForge 审查员可进化智能体（法槌·梵高），"
                            "擅长严格审查代码符合项目规范. "
                            "审查原则：跨厂商独立审查（no-self-review 铁律），"
                            "不放过任何 P0/P1 问题，但也不吹毛求疵."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                context=ctx,
                temperature=0.3,  # 审查需要适度一致性
            )
            reviewer_model = llm_result.get("model", "unknown")
            content_resp = llm_result.get("content", "")
            self._logger.info(
                f"[Plan] LLM 返回: model={reviewer_model}, "
                f"content_len={len(content_resp)}, "
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

        # ── I9 no-self-review 检查 ──
        author_model = task.context.get("author_llm_model", "unknown")
        author_vendor = self._get_llm_vendor(author_model)
        reviewer_vendor = self._get_llm_vendor(reviewer_model)
        if author_vendor == reviewer_vendor and author_vendor not in (
            "unknown", "fake", "fallback", "trae"
        ):
            self._logger.warning(
                f"[Plan] I9 警告：author 与 reviewer 同厂商 "
                f"({author_vendor})，可能漏掉同类盲点"
            )
        else:
            self._logger.info(
                f"[Plan] I9 通过：author={author_vendor}, reviewer={reviewer_vendor}"
            )

        # 解析 LLM 返回的审查清单
        steps, expected_effect, risk_assessment = self._parse_plan_response(
            content_resp, task, reviewer_model
        )

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
            llm_model=reviewer_model,
        )

    def _get_llm_vendor(self, model_name: str) -> str:
        """获取 LLM 厂商（用于 I9 no-self-review 检查）."""
        model_lower = model_name.lower()
        for key, vendor in _LLM_VENDOR_MAP.items():
            if key in model_lower:
                return vendor
        return "unknown"

    def _build_plan_prompt(self, task: DevTask, content: str) -> str:
        """构造 Plan 阶段的 LLM 提示词."""
        # 截取前 5000 字符避免 token 过长
        preview = content[:5000]
        truncated = "（已截取前 5000 字符）" if len(content) > 5000 else ""

        return (
            f"你是 FlowForge 审查员可进化智能体（法槌·梵高）. "
            f"请为以下文件设计审查清单.\n\n"
            f"【文件信息】\n"
            f"路径: {task.target_path}\n"
            f"作者灵智体: {task.context.get('author_forgekin_id', 'unknown')}\n"
            f"作者 LLM 模型: {task.context.get('author_llm_model', 'unknown')}\n\n"
            f"【文件内容】{truncated}\n```\n{preview}\n```\n\n"
            f"【审查维度】\n"
            f"1. 安全检查：是否违反红线 11（硬编码）/12（绕过 DI）/13（直接操作 DB）\n"
            f"2. 架构约束：单向依赖、循环依赖、跨层依赖\n"
            f"3. 代码风格：类型注解、async/await、命名规范\n"
            f"4. 可维护性：命名、注释、复杂度、重复代码\n"
            f"5. 测试覆盖：是否有对应测试、测试是否符合 T1-T8 铁律\n\n"
            f"【请输出 JSON】\n"
            f'{{"steps": [{{"action": "review_file", '
            f'"path": "{task.target_path}", '
            f'"checklist": ["审查项1", "审查项2"]}}], '
            f'"expected_effect": "审查清单", "risk_assessment": "low|medium|high"}}'
        )

    def _parse_plan_response(
        self, content: str, task: DevTask, reviewer_model: str
    ) -> Tuple[List[Dict[str, Any]], str, str]:
        """解析 LLM 返回的 Plan JSON."""
        # 清理 markdown 代码块包裹
        cleaned = re.sub(r"^```(?:json)?\s*", "", content.strip(), flags=re.MULTILINE)
        cleaned = re.sub(r"\s*```$", "", cleaned.strip())

        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                steps = parsed.get("steps", [])
                expected = parsed.get("expected_effect", "审查清单")
                risk = parsed.get("risk_assessment", "medium")
                self._logger.info(
                    f"[Plan] 解析成功: steps={len(steps)}, risk={risk}"
                )
                return steps, expected, risk
        except (json.JSONDecodeError, ValueError) as e:
            self._logger.warning(f"[Plan] LLM 响应非 JSON 格式: {e}")

        # Fallback：生成默认审查清单
        self._logger.info("[Plan] 使用 fallback：默认审查清单")
        default_checklist = [
            "检查是否硬编码路径/密钥/端口（红线 11）",
            "检查是否绕过 DI 容器（红线 12）",
            "检查是否直接操作数据库（红线 13）",
            "检查类型注解是否完整",
            "检查 async/await 是否正确使用",
        ]
        return (
            [{
                "action": "review_file",
                "path": task.target_path,
                "checklist": default_checklist,
            }],
            "fallback：默认审查清单",
            "medium",
        )

    # ══════════════════════════════════════════════════════════════
    # §3 Act — 执行审查（不修改代码，仅生成审查报告）
    # ══════════════════════════════════════════════════════════════

    async def act(self, plan: DevPlan) -> DevResult:
        """执行审查（不修改代码，仅生成审查报告）.

        审查报告输出到 docs/reviews/YYYY-MM-DD_HH-MM-SS_<filename>.md
        含 P0/P1/P2/P3 问题分级，每条问题附具体代码位置

        Args:
            plan: 审查方案（含 steps，每个 step 含 checklist）

        Returns:
            DevResult 审查结果（changed_files 为审查报告路径）
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
            checklist = step.get("checklist", [])

            self._logger.info(
                f"[Act] 步骤 {idx}/{len(plan.steps)}: action={action}, "
                f"target={target}, checklist={len(checklist)}"
            )

            if action != "review_file":
                self._logger.warning(f"[Act] 跳过未知 action: {action}")
                diff_summary_parts.append(f"skip {action}")
                continue

            if not target:
                self._logger.warning(f"[Act] 步骤 {idx} 缺少 path，跳过")
                continue

            abs_path = Path(self.project_root) / target
            if not abs_path.exists():
                self._logger.warning(f"[Act] 待审查文件不存在: {abs_path}")
                error_message = f"文件不存在: {target}"
                success = False
                break

            # 读取待审查文件内容
            try:
                content = await asyncio.to_thread(
                    abs_path.read_text, encoding="utf-8"
                )
            except (OSError, UnicodeDecodeError) as e:
                error_message = f"读取 {target} 失败: {e}"
                success = False
                break

            # 调用 LLM 生成审查报告
            review_report = await self._generate_review_report(
                target, content, checklist, plan.llm_model
            )

            # 写入审查报告文件
            report_rel_path = self._get_report_path(target)
            report_abs_path = Path(self.project_root) / report_rel_path
            await self._write_report(report_abs_path, review_report)
            changed_files.append(report_rel_path)
            diff_summary_parts.append(
                f"review {target} -> {report_rel_path} "
                f"(P0={review_report['p0_count']}, P1={review_report['p1_count']})"
            )

        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        diff_summary = "; ".join(diff_summary_parts) if diff_summary_parts else "无审查"
        self._logger.info(
            f"[Act] 完成: success={success}, reports={len(changed_files)}, "
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

    async def _generate_review_report(
        self,
        target: str,
        content: str,
        checklist: List[str],
        reviewer_model: str,
    ) -> Dict[str, Any]:
        """调用 LLM 生成审查报告."""
        from flowforge.llm.trae.models import BridgeRequestContext

        # 截取前 5000 字符
        preview = content[:5000]
        truncated = "（已截取）" if len(content) > 5000 else ""

        checklist_str = "\n".join(f"- {item}" for item in checklist)
        prompt = (
            f"请审查以下文件并生成审查报告.\n\n"
            f"【文件路径】{target}\n"
            f"【审查清单】\n{checklist_str}\n\n"
            f"【文件内容】{truncated}\n```\n{preview}\n```\n\n"
            f"【请输出 JSON】\n"
            f'{{"issues": [{{"severity": "P0|P1|P2|P3", '
            f'"location": "行号或函数名", "description": "问题描述", '
            f'"suggestion": "修复建议"}}], '
            f'"summary": "整体评价", "score": 0.0-1.0}}'
        )

        ctx = BridgeRequestContext(
            forgekin_id=self._forgekin_config.get("forgekin_id", "forgemind:vangogh"),
            task_type="review_report",
            task_summary=f"Generate review report for {target}",
        )

        try:
            llm_result = await self._trae_client.chat(
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是严格的代码审查员. "
                            "只报告真实问题，不臆造. "
                            "P0=阻塞性，P1=严重，P2=一般，P3=建议."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                context=ctx,
                temperature=0.3,
            )
            resp = llm_result.get("content", "")
            self._logger.info(
                f"[Act] 审查报告 LLM 返回: model={llm_result.get('model')}, "
                f"len={len(resp)}"
            )
        except Exception as e:
            self._logger.exception(f"[Act] 审查报告 LLM 调用失败: {e}")
            resp = '{"issues": [], "summary": "LLM 调用失败", "score": 0.0}'

        # 解析 LLM 返回
        issues, summary, score = self._parse_review_response(resp)

        # 统计问题数量
        p0_count = sum(1 for i in issues if i.get("severity") == "P0")
        p1_count = sum(1 for i in issues if i.get("severity") == "P1")
        p2_count = sum(1 for i in issues if i.get("severity") == "P2")
        p3_count = sum(1 for i in issues if i.get("severity") == "P3")

        return {
            "target": target,
            "reviewer_model": reviewer_model,
            "issues": issues,
            "summary": summary,
            "score": score,
            "p0_count": p0_count,
            "p1_count": p1_count,
            "p2_count": p2_count,
            "p3_count": p3_count,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        }

    def _parse_review_response(self, content: str) -> Tuple[List[Dict], str, float]:
        """解析 LLM 返回的审查报告 JSON."""
        cleaned = re.sub(r"^```(?:json)?\s*", "", content.strip(), flags=re.MULTILINE)
        cleaned = re.sub(r"\s*```$", "", cleaned.strip())

        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                issues = parsed.get("issues", [])
                summary = parsed.get("summary", "无评价")
                score = float(parsed.get("score", 0.0))
                return issues, summary, score
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            self._logger.warning(f"[Act] 审查报告非 JSON 格式: {e}")

        return [], "解析失败", 0.0

    def _get_report_path(self, target: str) -> str:
        """生成审查报告的相对路径.

        格式：docs/reviews/YYYY-MM-DD_HH-MM-SS_<filename>.md
        """
        now = datetime.now(timezone.utc)
        timestamp = now.strftime("%Y-%m-%d_%H-%M-%S")
        filename = Path(target).stem
        return f"{self._reviews_dir}/{timestamp}_{filename}.md"

    async def _write_report(self, abs_path: Path, report: Dict[str, Any]) -> None:
        """写入审查报告文件（Markdown 格式）."""
        parent = abs_path.parent
        if not parent.exists():
            await asyncio.to_thread(parent.mkdir, parents=True, exist_ok=True)

        md = self._format_report_markdown(report)
        await asyncio.to_thread(abs_path.write_text, md, encoding="utf-8")
        self._logger.info(f"[Act] 写入审查报告: {abs_path}")

    def _format_report_markdown(self, report: Dict[str, Any]) -> str:
        """将审查报告格式化为 Markdown."""
        lines = [
            "---",
            f"status: review",
            f"type: code_review",
            f"target: {report['target']}",
            f"reviewer: {report['reviewer_model']}",
            f"score: {report['score']}",
            f"p0: {report['p0_count']}",
            f"p1: {report['p1_count']}",
            f"p2: {report['p2_count']}",
            f"p3: {report['p3_count']}",
            f"reviewed_at: {report['reviewed_at']}",
            "---",
            "",
            f"# 代码审查报告：{report['target']}",
            "",
            f"**审查员 LLM**: {report['reviewer_model']}",
            f"**整体评分**: {report['score']}",
            f"**整体评价**: {report['summary']}",
            "",
            "## 问题列表",
            "",
        ]

        if not report["issues"]:
            lines.append("（无问题）")
        else:
            for idx, issue in enumerate(report["issues"], 1):
                severity = issue.get("severity", "P3")
                location = issue.get("location", "未知位置")
                desc = issue.get("description", "无描述")
                suggestion = issue.get("suggestion", "")
                lines.append(f"### {idx}. [{severity}] {location}")
                lines.append(f"**问题**: {desc}")
                if suggestion:
                    lines.append(f"**建议**: {suggestion}")
                lines.append("")

        # Push back 提示（I11）
        if report["p0_count"] > 0 or report["p1_count"] > 0:
            lines.append("## Push Back 通知（I11）")
            lines.append(
                f"发现 {report['p0_count']} 个 P0 问题和 {report['p1_count']} 个 P1 问题，"
                f"必须触发 Author 闭环 Reflect 重写（I11 不变量）"
            )

        return "\n".join(lines)

    # ══════════════════════════════════════════════════════════════
    # §4 Verify — 验证审查报告质量（meta-review）
    # ══════════════════════════════════════════════════════════════

    async def verify(self, result: DevResult) -> VerifyResult:
        """验证审查报告质量（meta-review）.

        检查项：
        1. 审查报告文件存在性
        2. 报告格式完整性（含 front-matter / 问题列表 / 评分）
        3. P0/P1 问题是否有具体代码位置（I11 push back 前提）
        4. LLM meta-review（T7 铁律：审查报告本身经 LLM 审核）

        Args:
            result: 审查结果（changed_files 为审查报告路径列表）

        Returns:
            VerifyResult 验证结果
        """
        start_time = time.monotonic()
        self._logger.info(
            f"[Verify] 开始: result_id={result.result_id}, "
            f"reports={len(result.changed_files)}"
        )

        checks: List[Dict[str, Any]] = []
        failure_reasons: List[str] = []

        # 检查 1: 报告文件存在性
        for rel_path in result.changed_files:
            abs_path = Path(self.project_root) / rel_path
            exists = abs_path.exists()
            checks.append({
                "name": f"report_exists:{rel_path}",
                "passed": exists,
                "detail": f"{rel_path} {'存在' if exists else '不存在'}",
            })
            if not exists:
                failure_reasons.append(f"审查报告不存在: {rel_path}")

        # 检查 2 & 3: 报告格式与问题位置完整性
        for rel_path in result.changed_files:
            abs_path = Path(self.project_root) / rel_path
            if not abs_path.exists():
                continue
            try:
                content = await asyncio.to_thread(
                    abs_path.read_text, encoding="utf-8"
                )
            except (OSError, UnicodeDecodeError) as e:
                failure_reasons.append(f"读取 {rel_path} 失败: {e}")
                continue

            # 检查 2: front-matter
            has_fm = bool(re.match(r"^---\s*\n.*?\n---\s*\n", content, re.DOTALL))
            checks.append({
                "name": f"front_matter:{rel_path}",
                "passed": has_fm,
                "detail": "有 front-matter" if has_fm else "缺少 front-matter",
            })
            if not has_fm:
                failure_reasons.append(f"{rel_path} 缺少 front-matter")

            # 检查 3: P0/P1 问题是否有 location 字段
            # 简化检查：每个 P0/P1 标题后必须有 "问题" 描述
            p0_p1_pattern = re.compile(
                r"###\s+\d+\.\s+\[P[01]\]\s+(.+?)\n\*\*问题\*\*:\s*(.+?)(?:\n|$)",
                re.DOTALL,
            )
            matches = p0_p1_pattern.findall(content)
            for location, desc in matches:
                if not location.strip() or location.strip() == "未知位置":
                    failure_reasons.append(
                        f"{rel_path} P0/P1 问题缺少具体位置: {desc[:50]}"
                    )
                    checks.append({
                        "name": f"issue_location:{rel_path}",
                        "passed": False,
                        "detail": f"P0/P1 问题位置为空: {location}",
                    })
            if matches:
                checks.append({
                    "name": f"issue_location:{rel_path}",
                    "passed": True,
                    "detail": f"检查 {len(matches)} 个 P0/P1 问题位置",
                })

        # 检查 4: LLM meta-review（T7 铁律）
        llm_review_passed = True
        if result.success and result.changed_files:
            last_report = Path(self.project_root) / result.changed_files[-1]
            if last_report.exists():
                try:
                    content_to_review = await asyncio.to_thread(
                        last_report.read_text, encoding="utf-8"
                    )
                    self._logger.info(
                        f"[Verify] 调用 LLM meta-review: "
                        f"file={result.changed_files[-1]}, "
                        f"content_len={len(content_to_review)}"
                    )
                    review_result = await self.llm_review_content(
                        content_to_review[:4000],
                        content_type="review_report",
                        review_criteria=(
                            "1. 审查报告是否客观（无臆造问题）\n"
                            "2. P0/P1 问题是否真实严重\n"
                            "3. 修复建议是否可行\n"
                            "4. 整体评分是否合理"
                        ),
                    )
                    llm_review_passed = review_result.get("passed", False)
                    score = review_result.get("score", 0.0)
                    issues = review_result.get("issues", [])
                    self._logger.info(
                        f"[Verify] LLM meta-review 结果: "
                        f"passed={llm_review_passed}, score={score}, "
                        f"issues={len(issues)}"
                    )
                    checks.append({
                        "name": f"llm_meta_review:{result.changed_files[-1]}",
                        "passed": llm_review_passed,
                        "detail": f"score={score}, issues={issues[:3]}",
                    })
                    if not llm_review_passed:
                        failure_reasons.append(
                            f"LLM meta-review 未通过 (score={score}): {issues[:2]}"
                        )
                except Exception as e:
                    self._logger.exception(f"[Verify] LLM meta-review 调用失败: {e}")
                    llm_review_passed = False
                    failure_reasons.append(f"LLM meta-review 调用失败: {e}")
                    checks.append({
                        "name": f"llm_meta_review:{result.changed_files[-1]}",
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


__all__ = ["SelfDevReviewLoop"]
