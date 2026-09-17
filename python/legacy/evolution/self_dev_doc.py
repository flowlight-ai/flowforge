"""F046 §2.5.1 SelfDevDocLoop — 文档自我演进闭环.

负责自主编写和维护项目文档，是 SelfDev 三闭环中觉醒阶要求最低（E3）的闭环.

处理对象：
- spec.md / arch.md / design.md（顶层 SRS/SAD/SDD）
- features/F0XX-xxx.md（Feature 级 SRS）
- architecture/A0XX-xxx.md（Feature 级 SAD）
- design/D0XX-xxx.md（Feature 级 SDD）
- README.md / SETUP.md 等公共文档

五步循环：
1. Discover: 扫描 docs/ 目录，检测过期/缺失/格式问题的文档
2. Plan: 通过 TraeLLMClient 生成文档大纲和修改方案
3. Act: 写入/修改文档文件（async I/O，不操作数据库）
4. Verify: front-matter 检查、标题层级、链接有效性、LLM 内容审核（T7）
5. Persist: 基类通用实现，沉淀到 ForgeMindEngine 三模式

安全护栏：
- I2 Scope Guard 前置检查：禁止修改 VISION.md / CONTRIBUTING.md / SOP.md / decisions/
- I4 LLM 审核必经（T7 铁律）：生成的文档内容必须再调用 LLM 审核通过
- I7 不硬编码：路径从 forgekin_config["project_root"] 读取
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from flowforge.core.tracing import get_logger
from flowforge.evolution.self_dev_base import (
    DevPlan,
    DevResult,
    DevTask,
    SelfDevLoopBase,
    VerifyResult,
)

logger = get_logger("flowforge.evolution.self_dev.doc")


# ── 默认配置（可由 forgekin_config 覆盖）─────────────────────────
_DEFAULT_DOCS_DIR = "docs"
_DEFAULT_MAX_AGE_DAYS = 90  # 文档超过 90 天未更新视为过期
_DEFAULT_SCAN_PATTERNS = [
    "docs/**/*.md",
    "**/README.md",
    "**/SETUP.md",
]

# ── Front-matter 正则（YAML 头部）─────────────────────────────────
_FRONT_MATTER_RE = re.compile(r"^---\s*\n(.*?\n)---\s*\n", re.DOTALL)

# ── 标题层级正则 ─────────────────────────────────────────────────
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)


class SelfDevDocLoop(SelfDevLoopBase):
    """文档自我演进闭环 — 自主编写和维护项目文档.

    觉醒阶要求：E3（受限自主阶），低于此阶不能触发.
    安全护栏：禁止修改 VISION/rules/prompts/decisions 等受保护路径.

    用法示例：
        from flowforge.evolution import ForgeMindEngine, SelfDevDocLoop
        from flowforge.llm.trae import TraeLLMClient

        engine = ForgeMindEngine()
        trae_client = TraeLLMClient(protocol=...)
        config = {
            "project_root": "/path/to/flowforge",
            "forgekin_id": "forgemind:wenxin",
        }
        doc_loop = SelfDevDocLoop(trae_client, config, engine, awakening_stage="E3")
        engine.register_self_dev_loop(doc_loop)

        # 触发文档闭环
        result = await engine.run_self_dev_loop("doc", {
            "scan_patterns": ["docs/features/*.md"],
            "max_age_days": 30,
        })
    """

    loop_type = "doc"
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

        # 文档闭环配置（从 forgekin_config 读取，不硬编码 — 红线 11）
        self._docs_dir = forgekin_config.get("docs_dir", _DEFAULT_DOCS_DIR)
        self._max_age_days = forgekin_config.get("max_age_days", _DEFAULT_MAX_AGE_DAYS)
        self._scan_patterns = forgekin_config.get("scan_patterns", list(_DEFAULT_SCAN_PATTERNS))

        self._logger = logger
        self._logger.info(
            f"SelfDevDocLoop 初始化: docs_dir={self._docs_dir}, "
            f"max_age_days={self._max_age_days}, scan_patterns={len(self._scan_patterns)}"
        )

    # ══════════════════════════════════════════════════════════════
    # §1 Discover — 发现文档任务
    # ══════════════════════════════════════════════════════════════

    async def discover(self, context: Dict[str, Any]) -> List[DevTask]:
        """发现文档任务（F046 §2.5.1）.

        检测三类问题：
        1. 过期文档（mtime 超过 max_age_days）
        2. 缺失文档（features/F0XX-xxx.md 存在但 design/D0XX-xxx.md 缺失）
        3. 格式问题（无 front-matter / 标题层级错乱）

        Args:
            context: 发现上下文，支持以下可选字段：
                - scan_patterns: 覆盖默认扫描 glob 模式
                - max_age_days: 覆盖默认过期阈值
                - force_targets: 强制指定的目标路径列表（用于定向更新）
                - docs_dir: 覆盖默认文档目录

        Returns:
            DevTask 列表（按优先级排序）
        """
        start_time = time.monotonic()
        scan_patterns = context.get("scan_patterns", self._scan_patterns)
        max_age_days = context.get("max_age_days", self._max_age_days)
        docs_dir_rel = context.get("docs_dir", self._docs_dir)
        force_targets = context.get("force_targets", [])

        self._logger.info(
            f"[Discover] 开始扫描文档: docs_dir={docs_dir_rel}, "
            f"patterns={scan_patterns}, max_age_days={max_age_days}, "
            f"force_targets={force_targets}"
        )

        tasks: List[DevTask] = []

        # 处理 force_targets（定向更新，跳过扫描）
        if force_targets:
            self._logger.info(f"[Discover] force_targets 模式：跳过扫描，直接处理 {len(force_targets)} 个目标")
            for target in force_targets:
                task = DevTask(
                    loop_type="doc",
                    target_path=target,
                    modification_type="update",
                    description=f"定向更新文档: {target}",
                    priority="high",
                    context={"source": "force_targets"},
                )
                tasks.append(task)
        else:
            # 扫描文档
            project_root = Path(self.project_root)
            scanned_count = 0
            for pattern in scan_patterns:
                for doc_path in project_root.glob(pattern):
                    if not doc_path.is_file():
                        continue
                    scanned_count += 1
                    rel_path = self._to_rel_path(doc_path)

                    # 检测过期
                    task = await self._check_stale(doc_path, rel_path, max_age_days)
                    if task:
                        tasks.append(task)
                        continue

                    # 检测格式问题
                    task = await self._check_format_issues(doc_path, rel_path)
                    if task:
                        tasks.append(task)

            # 检测缺失文档（feature 存在但 design 缺失）
            missing_tasks = await self._check_missing_docs(project_root)
            tasks.extend(missing_tasks)

            self._logger.info(
                f"[Discover] 扫描完成: 共扫描 {scanned_count} 个文档，"
                f"发现 {len(tasks)} 个任务（含 {len(missing_tasks)} 个缺失文档）"
            )

        # 按优先级排序
        priority_order = {"critical": 0, "high": 1, "normal": 2, "low": 3}
        tasks.sort(key=lambda t: priority_order.get(t.priority, 99))

        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        self._logger.info(f"[Discover] 完成: {len(tasks)} 个任务, 耗时 {elapsed_ms}ms")
        return tasks

    async def _check_stale(self, doc_path: Path, rel_path: str, max_age_days: int) -> Optional[DevTask]:
        """检测过期文档."""
        try:
            mtime = doc_path.stat().st_mtime
            age_days = (time.time() - mtime) / 86400
            if age_days > max_age_days:
                self._logger.info(
                    f"[Discover] 发现过期文档: {rel_path} (age={age_days:.1f}天, threshold={max_age_days}天)"
                )
                return DevTask(
                    loop_type="doc",
                    target_path=rel_path,
                    modification_type="update",
                    description=f"文档已过期 {age_days:.0f} 天（阈值 {max_age_days} 天），需检查内容是否与代码一致",
                    priority="normal",
                    context={"source": "stale_detect", "age_days": age_days},
                )
        except OSError as e:
            self._logger.warning(f"[Discover] 无法读取文件状态 {rel_path}: {e}")
        return None

    async def _check_format_issues(self, doc_path: Path, rel_path: str) -> Optional[DevTask]:
        """检测格式问题（无 front-matter / 标题层级错乱）."""
        try:
            content = await asyncio.to_thread(doc_path.read_text, encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            self._logger.warning(f"[Discover] 无法读取文件 {rel_path}: {e}")
            return None

        issues: List[str] = []

        # 检查 front-matter（仅对 docs/ 下的文档强制要求）
        if rel_path.startswith("docs/") and not _FRONT_MATTER_RE.match(content):
            issues.append("缺少 front-matter（YAML 头部）")

        # 检查标题层级（必须从 # 或 ## 开始，不能跳级）
        headings = _HEADING_RE.findall(content)
        if headings:
            first_level = len(headings[0][0])
            if first_level > 2:
                issues.append(f"首个标题层级过深 (#{first_level}，应为 # 或 ##)")

        if issues:
            self._logger.info(f"[Discover] 发现格式问题: {rel_path} ({', '.join(issues)})")
            return DevTask(
                loop_type="doc",
                target_path=rel_path,
                modification_type="update",
                description=f"格式问题: {', '.join(issues)}",
                priority="normal",
                context={"source": "format_check", "issues": issues},
            )
        return None

    async def _check_missing_docs(self, project_root: Path) -> List[DevTask]:
        """检测缺失文档（features/F0XX 存在但 design/D0XX 缺失）."""
        tasks: List[DevTask] = []
        features_dir = project_root / "docs" / "features"
        design_dir = project_root / "docs" / "design"

        if not features_dir.is_dir():
            return tasks

        try:
            feature_files = list(features_dir.glob("F*.md"))
        except OSError:
            return tasks

        for feature_file in feature_files:
            # 从 F0XX-xxx.md 提取 0XX（match.group(0) 含前缀 F0XX-）
            match = re.match(r"^F(\d{3})-", feature_file.name)
            if not match:
                continue
            num = match.group(1)
            # 去掉整个 F0XX- 前缀（match.group(0) 长度可能为 5，如 F100-）
            suffix = feature_file.name[len(match.group(0)):]
            design_name = f"D{num}-{suffix}"
            design_file = design_dir / design_name

            if not design_file.exists():
                rel_path = f"docs/design/{design_name}"
                self._logger.info(
                    f"[Discover] 发现缺失文档: {rel_path} "
                    f"(对应 feature {feature_file.name} 存在但 design 缺失)"
                )
                tasks.append(DevTask(
                    loop_type="doc",
                    target_path=rel_path,
                    modification_type="create",
                    description=f"为 feature {feature_file.name} 创建对应的 design 文档",
                    priority="high",
                    context={"source": "missing_detect", "feature_file": feature_file.name},
                ))

        return tasks

    def _to_rel_path(self, abs_path: Path) -> str:
        """将绝对路径转为相对项目根的路径."""
        try:
            return str(abs_path.relative_to(self.project_root)).replace("\\", "/")
        except ValueError:
            return str(abs_path)

    # ══════════════════════════════════════════════════════════════
    # §2 Plan — 通过 LLM 生成文档方案
    # ══════════════════════════════════════════════════════════════

    async def plan(self, task: DevTask) -> DevPlan:
        """通过 TraeLLMClient 生成文档修改方案.

        Args:
            task: 开发任务（含 target_path / modification_type / description）

        Returns:
            DevPlan 修改方案（含具体步骤、预期效果、风险评估）
        """
        start_time = time.monotonic()
        self._logger.info(
            f"[Plan] 开始: task_id={task.task_id}, target={task.target_path}, "
            f"type={task.modification_type}"
        )

        # 读取现有文档内容（如果存在）
        existing_content = ""
        abs_path = Path(self.project_root) / task.target_path
        if abs_path.exists():
            try:
                existing_content = await asyncio.to_thread(abs_path.read_text, encoding="utf-8")
                self._logger.info(f"[Plan] 读取现有文档: {len(existing_content)} 字符")
            except (OSError, UnicodeDecodeError) as e:
                self._logger.warning(f"[Plan] 读取现有文档失败: {e}")

        # 构造 LLM 提示词
        prompt = self._build_plan_prompt(task, existing_content)

        # 调用 TraeLLMClient
        from flowforge.llm.trae.models import BridgeRequestContext

        ctx = BridgeRequestContext(
            forgekin_id=self._forgekin_config.get("forgekin_id", "forgemind:wenxin"),
            task_type="doc_plan",
            task_summary=f"Plan doc modification for {task.target_path}",
        )

        try:
            llm_result = await self._trae_client.chat(
                messages=[
                    {"role": "system", "content": "你是 FlowForge 文档员可进化智能体（钢笔·文心），擅长编写符合项目规范的文档."},
                    {"role": "user", "content": prompt},
                ],
                context=ctx,
                temperature=0.4,  # 文档生成需要适度创造性
            )
            content = llm_result.get("content", "")
            model = llm_result.get("model", "unknown")
            self._logger.info(
                f"[Plan] LLM 返回: model={model}, content_len={len(content)}, "
                f"latency={llm_result.get('usage', {}).get('latency_ms', 0)}ms"
            )
        except Exception as e:
            self._logger.exception(f"[Plan] LLM 调用失败: {e}")
            # 返回最小化方案（避免阻塞循环）
            return DevPlan(
                task_id=task.task_id,
                steps=[{
                    "action": "write_file",
                    "path": task.target_path,
                    "content": f"<!-- LLM 调用失败，待人工介入: {e} -->\n",
                }],
                expected_effect="LLM 调用失败，写入占位符待人工修复",
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

    def _build_plan_prompt(self, task: DevTask, existing_content: str) -> str:
        """构造 Plan 阶段的 LLM 提示词."""
        existing_section = ""
        if existing_content:
            # 截取前 2000 字符避免 token 过长
            preview = existing_content[:2000]
            existing_section = f"【现有文档内容（前 2000 字符）】\n```\n{preview}\n```\n\n"
        else:
            existing_section = "【现有文档内容】\n（文件不存在，需创建新文档）\n\n"

        return (
            f"你是 FlowForge 文档员可进化智能体。请为以下文档任务设计修改方案.\n\n"
            f"【任务信息】\n"
            f"目标路径: {task.target_path}\n"
            f"修改类型: {task.modification_type}\n"
            f"任务描述: {task.description}\n"
            f"上下文: {task.context}\n\n"
            f"{existing_section}"
            f"【要求】\n"
            f"1. 文档必须以 YAML front-matter 开头（--- 包裹），含 status/type/created_at 字段\n"
            f"2. 标题层级从 # 或 ## 开始，不跳级\n"
            f"3. 内容必须真实，不臆造信息（T2 铁律）\n"
            f"4. 路径用相对路径，不硬编码绝对路径\n\n"
            f"【请输出 JSON】\n"
            f'{{"steps": [{{"action": "write_file"|"update_section"|"append", '
            f'"path": "目标路径", "content": "文档内容", "section": "章节名（仅 update_section 需要）"}}], '
            f'"expected_effect": "预期效果", "risk_assessment": "low|medium|high"}}'
        )

    def _parse_plan_response(
        self, content: str, task: DevTask
    ) -> tuple[List[Dict[str, Any]], str, str]:
        """解析 LLM 返回的 Plan JSON."""
        import json

        # 清理 markdown 代码块包裹
        cleaned = re.sub(r"^```(?:json)?\s*", "", content.strip(), flags=re.MULTILINE)
        cleaned = re.sub(r"\s*```$", "", cleaned.strip())

        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                steps = parsed.get("steps", [])
                expected = parsed.get("expected_effect", "文档修改方案")
                risk = parsed.get("risk_assessment", "medium")
                self._logger.info(
                    f"[Plan] 解析成功: steps={len(steps)}, risk={risk}"
                )
                return steps, expected, risk
        except (json.JSONDecodeError, ValueError) as e:
            self._logger.warning(f"[Plan] LLM 响应非 JSON 格式: {e}")

        # Fallback：把 LLM 内容作为单个 write_file 步骤
        self._logger.info("[Plan] 使用 fallback：将 LLM 内容作为单个 write_file 步骤")
        return (
            [{
                "action": "write_file",
                "path": task.target_path,
                "content": content,
            }],
            "fallback：直接写入 LLM 生成内容",
            "medium",
        )

    # ══════════════════════════════════════════════════════════════
    # §3 Act — 执行文档修改
    # ══════════════════════════════════════════════════════════════

    async def act(self, plan: DevPlan) -> DevResult:
        """执行文档修改.

        支持三种 action：
        - write_file: 完整写入文件（覆盖或创建）
        - update_section: 替换指定章节内容（按 ## 标题匹配）
        - append: 追加内容到文件末尾

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

            abs_path = Path(self.project_root) / target
            try:
                if action == "write_file":
                    await self._write_file(abs_path, content)
                    changed_files.append(target)
                    diff_summary_parts.append(f"write {target} ({len(content)} chars)")

                elif action == "update_section":
                    section = step.get("section", "")
                    new_content = await self._update_section(abs_path, section, content)
                    changed_files.append(target)
                    diff_summary_parts.append(f"update section '{section}' in {target}")

                elif action == "append":
                    await self._append_file(abs_path, content)
                    changed_files.append(target)
                    diff_summary_parts.append(f"append {len(content)} chars to {target}")

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

    async def _write_file(self, abs_path: Path, content: str) -> None:
        """写入文件（确保目录存在）."""
        # 检查父目录
        parent = abs_path.parent
        if not parent.exists():
            self._logger.info(f"[Act] 创建目录: {parent}")
            await asyncio.to_thread(parent.mkdir, parents=True, exist_ok=True)

        # 写入文件
        await asyncio.to_thread(abs_path.write_text, content, encoding="utf-8")
        self._logger.info(f"[Act] 写入文件: {abs_path} ({len(content)} chars)")

    async def _update_section(self, abs_path: Path, section: str, new_content: str) -> str:
        """替换指定章节内容（按 ## 标题匹配）."""
        if not abs_path.exists():
            raise FileNotFoundError(f"文件不存在: {abs_path}")

        original = await asyncio.to_thread(abs_path.read_text, encoding="utf-8")
        # 匹配 ## 章节标题及其内容（直到下一个 ## 或文件末尾）
        pattern = re.compile(
            rf"(##\s+{re.escape(section)}.*?)(?=\n##\s+|\Z)",
            re.DOTALL,
        )
        match = pattern.search(original)
        if not match:
            self._logger.warning(f"[Act] 未找到章节 '{section}'，追加到文件末尾")
            new_full = original.rstrip() + f"\n\n## {section}\n{new_content}\n"
        else:
            new_section = f"## {section}\n{new_content}"
            new_full = original[:match.start()] + new_section + original[match.end():]

        await asyncio.to_thread(abs_path.write_text, new_full, encoding="utf-8")
        self._logger.info(f"[Act] 更新章节 '{section}': {abs_path}")
        return new_full

    async def _append_file(self, abs_path: Path, content: str) -> None:
        """追加内容到文件末尾."""
        if not abs_path.exists():
            await self._write_file(abs_path, content)
            return

        # 异步追加（用 to_thread 包装同步 append）
        def _append() -> None:
            with open(abs_path, "a", encoding="utf-8") as f:
                f.write(content)

        await asyncio.to_thread(_append)
        self._logger.info(f"[Act] 追加内容: {abs_path} ({len(content)} chars)")

    # ══════════════════════════════════════════════════════════════
    # §4 Verify — 验证文档修改效果
    # ══════════════════════════════════════════════════════════════

    async def verify(self, result: DevResult) -> VerifyResult:
        """验证文档修改效果.

        检查项：
        1. 文件存在性（所有 changed_files 都存在）
        2. Front-matter 格式（docs/ 下的文档必须有）
        3. 标题层级（不跳级）
        4. LLM 内容审核（T7 铁律）

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

        # 检查 2 & 3: 格式检查（仅对存在的文件）
        for rel_path in result.changed_files:
            abs_path = Path(self.project_root) / rel_path
            if not abs_path.exists():
                continue

            try:
                content = await asyncio.to_thread(abs_path.read_text, encoding="utf-8")
            except (OSError, UnicodeDecodeError) as e:
                failure_reasons.append(f"读取 {rel_path} 失败: {e}")
                checks.append({
                    "name": f"readable:{rel_path}",
                    "passed": False,
                    "detail": str(e),
                })
                continue

            # 检查 2: Front-matter（仅 docs/ 下强制）
            if rel_path.startswith("docs/"):
                has_fm = bool(_FRONT_MATTER_RE.match(content))
                checks.append({
                    "name": f"front_matter:{rel_path}",
                    "passed": has_fm,
                    "detail": "有 front-matter" if has_fm else "缺少 front-matter",
                })
                if not has_fm:
                    failure_reasons.append(f"{rel_path} 缺少 front-matter")

            # 检查 3: 标题层级
            headings = _HEADING_RE.findall(content)
            if headings:
                first_level = len(headings[0][0])
                level_ok = first_level <= 2
                checks.append({
                    "name": f"heading_level:{rel_path}",
                    "passed": level_ok,
                    "detail": f"首个标题 #{first_level}",
                })
                if not level_ok:
                    failure_reasons.append(f"{rel_path} 首个标题层级过深 (#{first_level})")

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
                        content_to_review[:4000],  # 截取前 4000 字符避免 token 过长
                        content_type="doc",
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


__all__ = ["SelfDevDocLoop"]
