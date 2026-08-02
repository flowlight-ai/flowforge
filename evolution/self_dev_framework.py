"""F046 §2.5.3 SelfDevFrameworkLoop — 框架自我演进闭环.

负责自主调整框架配置和架构，是 SelfDev 五闭环中觉醒阶要求最高（E5）的闭环.
对应Forgekin：架构师·鲁班（forgemind:luban）.

设计动机（参考 F046 §2.6 关键不变量 I8）：
- 框架变更影响面广：架构调整可能破坏分层单向依赖、循环依赖零容忍等铁律
- 必须显式 approval：所有 Act 操作必须由 operator 显式批准（I8 不变量）
- ADR 不可变：13 份核心 ADR 禁止修改，只能新增 ADR 补充

处理对象：
- flowforge/**/*.yaml（架构级 YAML 配置，如 models.yaml / llm_route.yaml）
- docs/decisions/*.md（ADR 文档，禁止修改已有，仅允许新增）
- flowforge/**/__init__.py（模块导出，影响依赖图）

五步循环：
1. Discover: 架构偏离检测 / 配置不一致检测 / 依赖图问题 / force_targets
2. Plan: 通过 LLM 设计架构方案（强制 requires_approval=True）
3. Act: 修改 YAML / 创建新 ADR / 调整依赖（含 I8 approval 检查）
4. Verify: 依赖图检查 / 单向依赖检查 / ADR 一致性 / 配置完整性 / LLM 审核
5. Persist: 基类通用实现，沉淀到 ForgeMindEngine 三模式

安全护栏：
- I2 Scope Guard 前置检查：禁止修改 VISION/rules.md/decisions/ 已有 ADR
- I8 Framework 需 approval：所有 Act 必须显式 approval
- I4 LLM 审核必经（T7 铁律）：架构方案必须经 LLM 审核
- 红线 6：禁止盲目覆盖（只能新增 ADR，不能修改已有）
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from flowforge.core.tracing import get_logger
from flowforge.evolution.self_dev_base import (
    ApprovalRequiredError,
    DevPlan,
    DevResult,
    DevTask,
    SelfDevLoopBase,
    VerifyResult,
)

logger = get_logger("flowforge.evolution.self_dev.framework")


# ── 默认配置（可由 forgekin_config 覆盖）─────────────────────────
_DEFAULT_CONFIG_PATTERNS = [
    "flowforge/config/**/*.yaml",
    "flowforge/config/**/*.yml",
]
_DEFAULT_ADR_DIR = "docs/decisions"
_DEFAULT_ADR_PATTERNS = [
    "docs/decisions/*.md",
]
# 受保护的核心 ADR（禁止修改内容，只能新增 ADR 补充）
# 注：decisions/ 整个目录已由基类 _PROTECTED_PATH_PATTERNS 保护，
# 这里额外记录"核心 13 份 ADR"用于 Discover 阶段的偏离检测
_CORE_ADR_IDS: List[str] = [
    "001", "002", "003", "004", "005", "006", "007",
    "008", "009", "010", "011", "012", "013",
]

# ── 架构层目录结构（用于依赖图检查）──────────────────────────────
# 分层单向依赖：应用层 → 指挥中枢 → 专家执行 → 工具与记忆 → 共享内核
# 下层绝对禁止导入上层模块
_LAYER_ORDER = [
    "gateway",       # 应用层
    "brain",         # 指挥中枢层
    "workers",       # 专家执行层
    "tools",         # 工具与记忆层
    "core",          # 共享内核（最底层，所有层可依赖）
]
# core 是最底层，没有更下层；其他层禁止导入上层
_LAYER_FORBIDDEN_IMPORTS = {
    "core": ["gateway", "brain", "workers", "tools"],  # core 禁止导入所有上层
    "tools": ["gateway", "brain", "workers"],
    "workers": ["gateway", "brain"],
    "brain": ["gateway"],
    "gateway": [],
}

# ── I8 approval 回调类型 ──────────────────────────────────────────
# ApprovalCallback 接收 (plan, task) 返回 bool（True=批准，False=拒绝）
ApprovalCallback = Callable[[DevPlan, DevTask], Awaitable[bool]]


class SelfDevFrameworkLoop(SelfDevLoopBase):
    """框架自我演进闭环 — 自主调整框架配置和架构（I8 approval 强制）.

    觉醒阶要求：E5（完全自主阶），低于此阶不能触发.
    安全护栏：I8 Framework 需 approval / I2 Scope Guard / 红线 6 禁止盲目覆盖.

    用法示例：
        from flowforge.evolution import ForgeMindEngine, SelfDevFrameworkLoop
        from flowforge.llm.trae import TraeLLMClient

        engine = ForgeMindEngine()

        # approval 回调（operator 显式批准）
        async def approval_cb(plan: DevPlan, task: DevTask) -> bool:
            print(f"框架变更待批准: {plan.steps}")
            # 实际场景中由 operator 在 IM 议事中批准
            return True  # 或 False

        trae_client = TraeLLMClient(protocol=...)
        config = {
            "project_root": "/path/to/flowforge",
            "forgekin_id": "forgemind:luban",
            "approval_callback": approval_cb,
        }
        framework_loop = SelfDevFrameworkLoop(
            trae_client, config, engine, awakening_stage="E5"
        )
        engine.register_self_dev_loop(framework_loop)

        # 触发框架闭环（检测架构偏离）
        result = await engine.run_self_dev_loop("framework", {
            "task_source": "architecture_drift",
        })
    """

    loop_type = "framework"
    min_awakening_stage = "E5"

    def __init__(
        self,
        trae_client: Any,
        forgekin_config: Dict[str, Any],
        evolution_engine: Any,
        *,
        awakening_stage: str = "E5",
    ) -> None:
        super().__init__(trae_client, forgekin_config, evolution_engine, awakening_stage=awakening_stage)

        # 框架闭环配置（从 forgekin_config 读取，不硬编码 — 红线 11）
        self._config_patterns = forgekin_config.get(
            "config_patterns", list(_DEFAULT_CONFIG_PATTERNS)
        )
        self._adr_dir = forgekin_config.get("adr_dir", _DEFAULT_ADR_DIR)
        self._adr_patterns = forgekin_config.get(
            "adr_patterns", list(_DEFAULT_ADR_PATTERNS)
        )

        # I8 approval 回调（必须显式注入，未注入则所有 Act 都被阻止）
        self._approval_callback: Optional[ApprovalCallback] = forgekin_config.get(
            "approval_callback"
        )

        self._logger = logger
        self._logger.info(
            f"SelfDevFrameworkLoop 初始化: config_patterns={len(self._config_patterns)}, "
            f"adr_dir={self._adr_dir}, approval_callback={'已配置' if self._approval_callback else '未配置（I8 阻止）'}"
        )

    # ══════════════════════════════════════════════════════════════
    # §1 Discover — 发现框架任务
    # ══════════════════════════════════════════════════════════════

    async def discover(self, context: Dict[str, Any]) -> List[DevTask]:
        """发现框架任务（F046 §2.5.3）.

        支持四种任务来源：
        1. force_targets: 强制指定的目标文件列表（定向修改，协同协议主入口）
        2. architecture_drift: 架构偏离检测（与 ADR 不一致）
        3. config_inconsistency: 配置不一致检测（YAML 与代码不匹配）
        4. dependency_graph: 依赖图问题（循环依赖、跨层依赖）

        Args:
            context: 发现上下文，支持以下字段：
                - force_targets / target_files: 强制指定的目标文件列表
                - task_source: 任务来源（默认 "force_targets"）
                - check_architecture: 是否检测架构偏离（默认 False）
                - check_dependencies: 是否检测依赖图（默认 False）

        Returns:
            DevTask 列表（按优先级排序）
        """
        start_time = time.monotonic()
        target_files = (
            context.get("force_targets")
            or context.get("target_files")
            or []
        )
        task_source = context.get("task_source", "force_targets")
        check_architecture = context.get("check_architecture", False)
        check_dependencies = context.get("check_dependencies", False)

        self._logger.info(
            f"[Discover] 开始: task_source={task_source}, "
            f"force_targets={len(target_files)}, "
            f"check_architecture={check_architecture}, "
            f"check_dependencies={check_dependencies}"
        )

        tasks: List[DevTask] = []

        if target_files:
            # force_targets 优先级最高
            self._logger.info(
                f"[Discover] force_targets 模式：直接处理 {len(target_files)} 个目标"
            )
            for target in target_files:
                abs_path = Path(self.project_root) / target
                mod_type = "update" if abs_path.exists() else "create"
                tasks.append(DevTask(
                    loop_type="framework",
                    target_path=target,
                    modification_type=mod_type,
                    description=f"定向框架修改: {target}",
                    priority="high",
                    context={"source": "force_targets"},
                ))
        elif task_source == "architecture_drift" or check_architecture:
            tasks = await self._discover_architecture_drift()
        elif task_source == "config_inconsistency":
            tasks = await self._discover_config_inconsistency()
        elif task_source == "dependency_graph" or check_dependencies:
            tasks = await self._discover_dependency_graph_issues()
        else:
            self._logger.warning(
                f"[Discover] 未提供 force_targets，task_source={task_source!r} 未实现"
            )

        # 按优先级排序
        priority_order = {"critical": 0, "high": 1, "normal": 2, "low": 3}
        tasks.sort(key=lambda t: priority_order.get(t.priority, 99))

        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        self._logger.info(f"[Discover] 完成: {len(tasks)} 个任务, 耗时 {elapsed_ms}ms")
        return tasks

    async def _discover_architecture_drift(self) -> List[DevTask]:
        """检测架构偏离（与 ADR 不一致）.

        简化实现：扫描 ADR 目录，提取 ADR ID 与标题，
        检查代码中是否引用了未在 ADR 中记录的架构决策.
        """
        self._logger.info("[Discover] architecture_drift 模式：扫描 ADR 目录")
        adr_path = Path(self.project_root) / self._adr_dir
        if not adr_path.exists():
            self._logger.warning(f"[Discover] ADR 目录不存在: {adr_path}")
            return []

        tasks: List[DevTask] = []
        try:
            for adr_file in adr_path.glob("*.md"):
                # 跳过核心 ADR（13 份）
                adr_id_match = re.match(r"^(\d+)-", adr_file.name)
                if not adr_id_match:
                    continue
                adr_id = adr_id_match.group(1)
                if adr_id in _CORE_ADR_IDS:
                    continue  # 核心 ADR 不可修改

                # 检查 ADR 文件是否有"状态: deprecated"等标记
                try:
                    content = await asyncio.to_thread(
                        adr_file.read_text, encoding="utf-8"
                    )
                    if "deprecated" in content.lower() or "superseded" in content.lower():
                        self._logger.info(
                            f"[Discover] ADR {adr_file.name} 已废弃，建议归档"
                        )
                        tasks.append(DevTask(
                            loop_type="framework",
                            target_path=str(adr_file.relative_to(self.project_root)).replace("\\", "/"),
                            modification_type="update",
                            description=f"归档已废弃 ADR: {adr_file.name}",
                            priority="normal",
                            context={"source": "architecture_drift", "adr_id": adr_id},
                        ))
                except (OSError, UnicodeDecodeError) as e:
                    self._logger.warning(f"[Discover] 读取 ADR 失败 {adr_file}: {e}")
        except Exception as e:
            self._logger.warning(f"[Discover] 扫描 ADR 异常: {e}")

        return tasks

    async def _discover_config_inconsistency(self) -> List[DevTask]:
        """检测配置不一致（YAML 与代码不匹配）.

        简化实现：扫描 config 目录，检查 YAML 文件是否存在语法错误或缺失必填字段.
        """
        self._logger.info("[Discover] config_inconsistency 模式：扫描 config 目录")
        tasks: List[DevTask] = []

        try:
            import yaml
        except ImportError:
            self._logger.warning("[Discover] pyyaml 未安装，跳过 YAML 语法检查")
            return tasks

        # 遍历所有配置 pattern，提取目录 + 扩展名，用 rglob 匹配
        root = Path(self.project_root)
        seen_files = set()  # 去重
        for pattern in self._config_patterns:
            # 解析 pattern：提取 base_dir 和 extensions
            # 例如 "flowforge/config/**/*.yaml" → base_dir="flowforge/config", ext="yaml"
            # 例如 "flowforge/config/*.yml" → base_dir="flowforge/config", ext="yml"
            pattern_clean = pattern.replace("\\", "/")
            # 提取扩展名
            ext_match = re.search(r"\*\*?\.(ya?ml)$", pattern_clean)
            if not ext_match:
                continue
            ext = ext_match.group(1)
            # 提取 base_dir（** 之前的部分）
            base_dir_str = pattern_clean.split("**")[0].rstrip("/").rstrip("\\")
            if not base_dir_str:
                base_dir = root
            else:
                base_dir = root / base_dir_str
            if not base_dir.exists():
                continue

            # 用 rglob 匹配所有该扩展名的文件
            for cfg_file in base_dir.rglob(f"*.{ext}"):
                if not cfg_file.is_file() or cfg_file in seen_files:
                    continue
                seen_files.add(cfg_file)
                try:
                    content = await asyncio.to_thread(
                        cfg_file.read_text, encoding="utf-8"
                    )
                    try:
                        yaml.safe_load(content)
                    except yaml.YAMLError as e:
                        rel_path = str(cfg_file.relative_to(self.project_root)).replace("\\", "/")
                        self._logger.info(
                            f"[Discover] YAML 语法错误: {rel_path}: {e}"
                        )
                        tasks.append(DevTask(
                            loop_type="framework",
                            target_path=rel_path,
                            modification_type="update",
                            description=f"修复 YAML 语法错误: {rel_path}",
                            priority="high",
                            context={"source": "config_inconsistency", "error": str(e)},
                        ))
                except (OSError, UnicodeDecodeError) as e:
                    self._logger.warning(f"[Discover] 读取配置失败 {cfg_file}: {e}")

        return tasks

    async def _discover_dependency_graph_issues(self) -> List[DevTask]:
        """检测依赖图问题（循环依赖、跨层依赖）.

        简化实现：扫描 flowforge/ 下的 Python 文件，
        检查是否存在下层导入上层的违规.
        """
        self._logger.info("[Discover] dependency_graph 模式：扫描 Python 依赖")
        tasks: List[DevTask] = []
        root = Path(self.project_root) / "flowforge"
        if not root.exists():
            self._logger.warning(f"[Discover] flowforge 目录不存在: {root}")
            return []

        # 遍历各层目录
        for layer_dir in root.iterdir():
            if not layer_dir.is_dir() or layer_dir.name.startswith("_"):
                continue
            layer_name = layer_dir.name
            if layer_name not in _LAYER_FORBIDDEN_IMPORTS:
                continue

            forbidden_layers = _LAYER_FORBIDDEN_IMPORTS[layer_name]
            if not forbidden_layers:
                continue

            # 扫描该层所有 .py 文件
            for py_file in layer_dir.rglob("*.py"):
                try:
                    content = await asyncio.to_thread(
                        py_file.read_text, encoding="utf-8"
                    )
                except (OSError, UnicodeDecodeError):
                    continue

                # 检查 import 语句
                rel_path = str(py_file.relative_to(self.project_root)).replace("\\", "/")
                for line in content.splitlines():
                    line = line.strip()
                    # 匹配 from flowforge.<layer> import ... 或 import flowforge.<layer>
                    import_match = re.match(
                        r"^(?:from\s+flowforge\.(\w+)|import\s+flowforge\.(\w+))",
                        line,
                    )
                    if not import_match:
                        continue
                    imported_layer = import_match.group(1) or import_match.group(2)
                    if imported_layer in forbidden_layers:
                        self._logger.info(
                            f"[Discover] 跨层依赖违规: {rel_path} 导入上层 {imported_layer}"
                        )
                        tasks.append(DevTask(
                            loop_type="framework",
                            target_path=rel_path,
                            modification_type="update",
                            description=(
                                f"修复跨层依赖违规: {rel_path} 导入上层 "
                                f"{imported_layer}（分层单向依赖铁律）"
                            ),
                            priority="critical",  # 跨层依赖是 critical 级别
                            context={
                                "source": "dependency_graph",
                                "violation": f"{layer_name} -> {imported_layer}",
                                "import_line": line,
                            },
                        ))
                        break  # 同一文件只报告一次

        return tasks

    # ══════════════════════════════════════════════════════════════
    # §2 Plan — 通过 LLM 设计架构方案（强制 requires_approval=True）
    # ══════════════════════════════════════════════════════════════

    async def plan(self, task: DevTask) -> DevPlan:
        """通过 TraeLLMClient 设计架构调整方案.

        I8 不变量：所有方案必须 requires_approval=True（operator 显式批准）.

        Args:
            task: 框架任务（含 target_path / modification_type / description）

        Returns:
            DevPlan 架构方案（requires_approval 强制 True）
        """
        start_time = time.monotonic()
        self._logger.info(
            f"[Plan] 开始: task_id={task.task_id}, target={task.target_path}, "
            f"type={task.modification_type}"
        )

        # 读取现有内容（如果存在）
        existing_content = ""
        if task.target_path:
            abs_path = Path(self.project_root) / task.target_path
            if abs_path.exists():
                try:
                    existing_content = await asyncio.to_thread(
                        abs_path.read_text, encoding="utf-8"
                    )
                    self._logger.info(
                        f"[Plan] 读取现有内容: {len(existing_content)} 字符"
                    )
                except (OSError, UnicodeDecodeError) as e:
                    self._logger.warning(f"[Plan] 读取现有内容失败: {e}")

        # 构造 LLM 提示词
        prompt = self._build_plan_prompt(task, existing_content)

        # 调用 TraeLLMClient
        from flowforge.llm.trae.models import BridgeRequestContext

        ctx = BridgeRequestContext(
            forgekin_id=self._forgekin_config.get("forgekin_id", "forgemind:luban"),
            task_type="framework_plan",
            task_summary=f"Plan framework modification for {task.target_path}",
        )

        try:
            llm_result = await self._trae_client.chat(
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是 FlowForge 架构师可进化智能体（巨匠·鲁班），"
                            "擅长设计符合分层单向依赖和 ADR 一致性的架构方案. "
                            "严格遵守：所有方案需 operator 显式 approval（I8 不变量），"
                            "禁止修改 VISION/rules.md/核心 ADR（I2 Scope Guard），"
                            "禁止盲目覆盖（红线 6：只能新增 ADR，不能修改已有）."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                context=ctx,
                temperature=0.2,  # 架构方案需要确定性
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
                requires_approval=True,  # I8 即使失败也强制 approval
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
            requires_approval=True,  # I8 强制：所有 framework 方案必须 approval
            llm_model=model,
        )

    def _build_plan_prompt(self, task: DevTask, existing_content: str) -> str:
        """构造 Plan 阶段的 LLM 提示词."""
        existing_section = ""
        if existing_content:
            preview = existing_content[:3000]
            existing_section = f"【现有内容（前 3000 字符）】\n```\n{preview}\n```\n\n"
        else:
            existing_section = "【现有内容】\n（文件不存在，需创建新文件）\n\n"

        context_section = ""
        if task.context:
            context_section = f"【任务上下文】\n{task.context}\n\n"

        return (
            f"你是 FlowForge 架构师可进化智能体（巨匠·鲁班）. "
            f"请为以下框架任务设计修改方案.\n\n"
            f"【任务信息】\n"
            f"目标路径: {task.target_path}\n"
            f"修改类型: {task.modification_type}\n"
            f"任务描述: {task.description}\n"
            f"{context_section}"
            f"{existing_section}"
            f"【强制规范】\n"
            f"1. 所有方案需 operator 显式 approval（I8 不变量）\n"
            f"2. 禁止修改 VISION/rules.md/核心 ADR（I2 Scope Guard）\n"
            f"3. 禁止盲目覆盖（红线 6：只能新增 ADR，不能修改已有）\n"
            f"4. 分层单向依赖（应用层 → 指挥中枢 → 专家执行 → 工具与记忆 → 共享内核）\n"
            f"5. 循环依赖零容忍（发现循环依赖必须重构）\n"
            f"6. YAML 配置必须可被 yaml.safe_load 解析\n"
            f"7. ADR 文档必须包含 front-matter（id/title/status/created_at）\n\n"
            f"【请输出 JSON】\n"
            f'{{"steps": [{{"action": "update_yaml"|"create_adr"|"update_dependency", '
            f'"path": "目标路径", "content": "内容", '
            f'"adr_id": "ADR 编号（仅 create_adr 需要）"}}], '
            f'"expected_effect": "预期效果", "risk_assessment": "low|medium|high"}}'
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
                expected = parsed.get("expected_effect", "框架修改方案")
                risk = parsed.get("risk_assessment", "high")  # framework 默认高风险
                self._logger.info(f"[Plan] 解析成功: steps={len(steps)}, risk={risk}")
                return steps, expected, risk
        except (json.JSONDecodeError, ValueError) as e:
            self._logger.warning(f"[Plan] LLM 响应非 JSON 格式: {e}")

        # Fallback：返回空 steps + 高风险（framework 不允许 fallback 写入）
        self._logger.info("[Plan] 使用 fallback：空 steps + 高风险标记")
        return (
            [],
            "fallback：LLM 响应非 JSON，框架闭环拒绝臆造方案",
            "high",
        )

    # ══════════════════════════════════════════════════════════════
    # §3 Act — 执行架构修改（含 I8 approval 检查）
    # ══════════════════════════════════════════════════════════════

    async def act(self, plan: DevPlan) -> DevResult:
        """执行架构修改（I8 approval 强制）.

        支持三种 action：
        - update_yaml: 修改 YAML 配置（覆盖或创建）
        - create_adr: 创建新 ADR（不修改已有 — 红线 6）
        - update_dependency: 调整模块依赖（修改 __init__.py 或导入语句）

        I8 安全护栏：
        - 所有 Act 必须 plan.requires_approval=True（由 plan 阶段强制）
        - 必须调用 approval_callback 获得 operator 显式批准
        - 未配置 approval_callback 或 callback 返回 False 时抛 ApprovalRequiredError

        Args:
            plan: 修改方案（含 steps）

        Returns:
            DevResult 修改结果

        Raises:
            ApprovalRequiredError: I8 approval 未通过
        """
        start_time = time.monotonic()
        self._logger.info(
            f"[Act] 开始: plan_id={plan.plan_id}, steps={len(plan.steps)}, "
            f"requires_approval={plan.requires_approval}"
        )

        # ── I8 approval 检查 ──
        if plan.requires_approval:
            approved = await self._request_approval(plan)
            if not approved:
                self._logger.warning(
                    f"[Act] I8 拒绝：plan {plan.plan_id} 未获 operator approval"
                )
                raise ApprovalRequiredError(plan.plan_id, plan.steps[0].get("path", "") if plan.steps else "")

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

            # 红线 6 检查：create_adr 不能覆盖已有 ADR
            if action == "create_adr":
                abs_path = Path(self.project_root) / target
                if abs_path.exists():
                    self._logger.warning(
                        f"[Act] 红线 6 违规：禁止覆盖已有 ADR {target}"
                    )
                    error_message = f"红线 6 违规：禁止覆盖已有 ADR {target}"
                    success = False
                    break

            abs_path = Path(self.project_root) / target
            try:
                if action == "update_yaml":
                    await self._write_file(abs_path, content)
                    changed_files.append(target)
                    diff_summary_parts.append(f"update_yaml {target} ({len(content)} chars)")

                elif action == "create_adr":
                    # 添加 front-matter（如果 content 没有以 --- 开头）
                    if not content.startswith("---"):
                        adr_id = step.get("adr_id", "")
                        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                        # target 是字符串，用 Path(target).stem 提取文件名（不含扩展名）
                        adr_title = Path(target).stem
                        front_matter = (
                            f"---\nid: ADR-{adr_id}\n"
                            f"title: {adr_title}\n"
                            f"status: proposed\n"
                            f"created_at: {timestamp}\n---\n\n"
                        )
                        content = front_matter + content
                    await self._write_file(abs_path, content)
                    changed_files.append(target)
                    diff_summary_parts.append(f"create_adr {target} ({len(content)} chars)")

                elif action == "update_dependency":
                    await self._write_file(abs_path, content)
                    changed_files.append(target)
                    diff_summary_parts.append(
                        f"update_dependency {target} ({len(content)} chars)"
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

    async def _request_approval(self, plan: DevPlan) -> bool:
        """I8 approval 请求 — 调用 approval_callback 获得 operator 批准.

        Returns:
            True=批准，False=拒绝（或未配置 callback）
        """
        if self._approval_callback is None:
            self._logger.warning(
                "[Act] I8 阻止：未配置 approval_callback（operator 必须显式注入）"
            )
            return False

        try:
            # 构造 task 上下文（从 plan.task_id 推断）
            task = DevTask(
                task_id=plan.task_id,
                loop_type="framework",
                target_path=plan.steps[0].get("path", "") if plan.steps else "",
                modification_type="framework",
                description=plan.expected_effect,
            )
            approved = await self._approval_callback(plan, task)
            self._logger.info(
                f"[Act] I8 approval 结果: approved={approved}, plan_id={plan.plan_id}"
            )
            return bool(approved)
        except Exception as e:
            self._logger.exception(f"[Act] approval_callback 异常: {e}")
            return False

    async def _write_file(self, abs_path: Path, content: str) -> None:
        """写入文件（确保目录存在）."""
        parent = abs_path.parent
        if not parent.exists():
            self._logger.info(f"[Act] 创建目录: {parent}")
            await asyncio.to_thread(parent.mkdir, parents=True, exist_ok=True)

        await asyncio.to_thread(abs_path.write_text, content, encoding="utf-8")
        self._logger.info(f"[Act] 写入文件: {abs_path} ({len(content)} chars)")

    # ══════════════════════════════════════════════════════════════
    # §4 Verify — 验证框架修改效果
    # ══════════════════════════════════════════════════════════════

    async def verify(self, result: DevResult) -> VerifyResult:
        """验证框架修改效果.

        检查项：
        1. 文件存在性（所有 changed_files 都存在）
        2. YAML 语法检查（对 .yaml/.yml 文件）
        3. ADR front-matter 检查（对 docs/decisions/*.md）
        4. 依赖图检查（无循环依赖、无跨层依赖）
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

        # 检查 2: YAML 语法检查
        for rel_path in result.changed_files:
            if not (rel_path.endswith(".yaml") or rel_path.endswith(".yml")):
                continue
            abs_path = Path(self.project_root) / rel_path
            if not abs_path.exists():
                continue
            yaml_ok, yaml_err = await self._check_yaml_syntax(abs_path)
            checks.append({
                "name": f"yaml_syntax:{rel_path}",
                "passed": yaml_ok,
                "detail": "YAML 语法正确" if yaml_ok else f"YAML 错误: {yaml_err}",
            })
            if not yaml_ok:
                failure_reasons.append(f"{rel_path} YAML 错误: {yaml_err}")

        # 检查 3: ADR front-matter 检查
        for rel_path in result.changed_files:
            if "decisions/" not in rel_path and "docs/decisions" not in rel_path:
                continue
            if not rel_path.endswith(".md"):
                continue
            abs_path = Path(self.project_root) / rel_path
            if not abs_path.exists():
                continue
            fm_ok, fm_err = await self._check_adr_frontmatter(abs_path)
            checks.append({
                "name": f"adr_frontmatter:{rel_path}",
                "passed": fm_ok,
                "detail": "front-matter 完整" if fm_ok else f"front-matter 缺失: {fm_err}",
            })
            if not fm_ok:
                failure_reasons.append(f"{rel_path} ADR front-matter 缺失: {fm_err}")

        # 检查 4: 依赖图检查（对所有变更的 .py 文件）
        for rel_path in result.changed_files:
            if not rel_path.endswith(".py"):
                continue
            abs_path = Path(self.project_root) / rel_path
            if not abs_path.exists():
                continue
            dep_ok, dep_err = await self._check_dependency_layer(rel_path, abs_path)
            checks.append({
                "name": f"dependency_layer:{rel_path}",
                "passed": dep_ok,
                "detail": "分层单向依赖通过" if dep_ok else f"违规: {dep_err}",
            })
            if not dep_ok:
                failure_reasons.append(f"{rel_path} 跨层依赖违规: {dep_err}")

        # 检查 5: LLM 内容审核（T7 铁律）
        llm_review_passed = True
        if result.success and result.changed_files:
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
                        content_to_review[:5000],
                        content_type="framework",
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

    async def _check_yaml_syntax(self, abs_path: Path) -> Tuple[bool, str]:
        """检查 YAML 文件语法."""
        try:
            import yaml
            content = await asyncio.to_thread(abs_path.read_text, encoding="utf-8")
            yaml.safe_load(content)
            return True, ""
        except ImportError:
            return False, "pyyaml 未安装"
        except yaml.YAMLError as e:
            return False, str(e)
        except (OSError, UnicodeDecodeError) as e:
            return False, f"读取失败: {e}"

    async def _check_adr_frontmatter(self, abs_path: Path) -> Tuple[bool, str]:
        """检查 ADR 文件的 front-matter 完整性.

        必须包含: id / title / status / created_at
        """
        try:
            content = await asyncio.to_thread(abs_path.read_text, encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            return False, f"读取失败: {e}"

        if not content.startswith("---"):
            return False, "缺少 front-matter (---)"

        # 提取 front-matter
        fm_match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
        if not fm_match:
            return False, "front-matter 格式错误"

        fm_content = fm_match.group(1)
        required_fields = ["id:", "title:", "status:", "created_at:"]
        missing = [f for f in required_fields if f not in fm_content]
        if missing:
            return False, f"缺失字段: {missing}"

        return True, ""

    async def _check_dependency_layer(self, rel_path: str, abs_path: Path) -> Tuple[bool, str]:
        """检查 Python 文件的分层单向依赖.

        下层模块禁止导入上层模块.
        """
        try:
            content = await asyncio.to_thread(abs_path.read_text, encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            return False, f"读取失败: {e}"

        # 推断当前文件所在层
        # rel_path 形如 flowforge/core/xxx.py → core 层
        parts = rel_path.replace("\\", "/").split("/")
        if len(parts) < 2 or parts[0] != "flowforge":
            return True, ""  # 非 flowforge 模块，跳过检查

        layer_name = parts[1]
        if layer_name not in _LAYER_FORBIDDEN_IMPORTS:
            return True, ""  # 非已知层，跳过

        forbidden_layers = _LAYER_FORBIDDEN_IMPORTS[layer_name]
        if not forbidden_layers:
            return True, ""

        # 检查 import 语句
        for line in content.splitlines():
            line = line.strip()
            import_match = re.match(
                r"^(?:from\s+flowforge\.(\w+)|import\s+flowforge\.(\w+))",
                line,
            )
            if not import_match:
                continue
            imported_layer = import_match.group(1) or import_match.group(2)
            if imported_layer in forbidden_layers:
                return False, f"{layer_name} 导入上层 {imported_layer}: {line}"

        return True, ""


__all__ = ["SelfDevFrameworkLoop"]
