"""P3-009 Skill 沉淀与共享 — Forgekin 技能库与市场.

本模块实现 Forgekin（可进化智能体，详见 ``forgemind/base.py``）的
**Skill Library（技能库）** 与 **Skill Market（技能市场）**：

- 技能以 YAML 文件持久化（每个 skill 一个文件），便于版本控制与人工审查
- 支持技能注册 / 检索 / 匹配 / 调用记录 / 进化 / 导入导出
- 通过 ``metrics_collector`` 上报指标、``event_bus`` 发出事件
- 通过依赖注入接收 ``metrics_collector`` / ``event_bus`` / ``logger``
  （铁律3：禁止绕过 DI 容器直接实例化）

设计原则：
- SkillLibrary 只记录调用元数据，**不执行具体业务逻辑**——
  实际执行由调用方（Forgekin / Agent / Loop）完成，调用方通过
  ``record_invocation_result`` 反馈结果。这是 P3-009 的核心契约。
- 所有公开 IO 方法使用 ``async/await``（项目规范：所有 I/O 操作异步化）。
- 类型注解强制（Python 3.11+ 类型语法）。

引用：
- [doc:features/F037-forgemind-marketplace.md] Forgekin 市场设计
- [doc:project_rules.md#铁律3] 禁止绕过 DI 容器
- [doc:project_rules.md#铁律5] 禁止硬编码路径
"""

from __future__ import annotations

import re
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from flowforge.core.tracing import get_logger

# ── 默认配置（基于项目结构解析，非硬编码绝对路径）─────────────
_DEFAULT_STORAGE_DIR = Path(__file__).parent.parent / "data" / "skill_library"
_DEFAULT_MARKET_DIR = Path(__file__).parent.parent / "data" / "skill_market"

# 进化决策参数
_EVOLVE_RECENT_WINDOW = 10  # 最近 N 次调用用于进化决策
_MATURITY_PROMOTE_SUCCESS_RATE = 0.9  # 成熟度提升的成功率阈值
_MATURITY_PROMOTE_USAGE_MIN = 10  # 成熟度提升的最小使用次数
_MATURITY_MAX = 5  # 成熟度上限（对应 Capability Maturity Level L4）
_MATURITY_MIN = 1  # 成熟度下限（对应 L0）
_CONFIDENCE_SMOOTH_ALPHA = 0.3  # 置信度平滑系数（新 = 旧*0.7 + 最近成功率*0.3）


def _now_iso() -> str:
    """返回当前 UTC 时间的 ISO 8601 字符串."""
    return datetime.now(UTC).isoformat()


def _parse_semver(version: str) -> tuple[int, int, int]:
    """解析语义化版本号为可比较的元组.

    Examples:
        "1.2"    -> (1, 2, 0)
        "1.2.3"  -> (1, 2, 3)
        "0.1.0"  -> (0, 1, 0)
    """
    parts = str(version).split(".")
    nums: list[int] = []
    for part in parts[:3]:
        try:
            nums.append(int(part))
        except (ValueError, TypeError):
            nums.append(0)
    while len(nums) < 3:
        nums.append(0)
    return tuple(nums)  # type: ignore[return-value]


def _match_trigger_pattern(pattern: str, trigger: str) -> bool:
    """判断单个 trigger_pattern 是否匹配 trigger.

    优先按 regex 匹配；若 pattern 不是合法 regex 或不匹配，再按
    关键词（子串）匹配。两种方式都大小写不敏感。
    """
    if not pattern:
        return False
    # 1. 尝试 regex 匹配（大小写不敏感）
    try:
        if re.search(pattern, trigger, re.IGNORECASE):
            return True
    except re.error:
        pass
    # 2. 回退到关键词（子串）匹配
    return pattern.lower() in trigger.lower()


def _check_precondition(precondition: str, context: dict[str, Any]) -> bool:
    """检查单个前置条件是否满足.

    支持两种格式：
    - ``key=value`` 或 ``key:value``：检查 ``context[key] == value``
    - 其他：视为描述性前置条件，若 ``context`` 非空则按 key 存在性检查，
      否则视为已满足（仅作记录用途）。

    Returns:
        ``True`` 表示前置条件满足。
    """
    if not precondition:
        return True
    # 解析 key=value 或 key:value 格式
    for sep in ("=", ":"):
        if sep in precondition:
            key, _, expected = precondition.partition(sep)
            key = key.strip()
            expected = expected.strip()
            if not key:
                continue
            if key not in context:
                return False
            return str(context[key]) == expected
    # 描述性前置条件：检查 context 中是否存在同名 key
    token = precondition.strip().lower().replace(" ", "_")
    if token and token in context:
        return True
    # 无法验证，视为已满足（仅作记录）
    return True


# ── 数据模型 ─────────────────────────────────────────────────────


class Skill(BaseModel):
    """技能元数据模型.

    描述一个 Forgekin 沉淀的可复用技能，包含触发模式、执行步骤、
    前后置条件、反模式、输入输出契约，以及使用统计与进化信息。

    属性:
        skill_id: 唯一标识（自动生成 uuid4 前缀）.
        name: 人类可读的技能名称（必填，非空）.
        description: 详细描述.
        forgekin_species: 所属 Forgekin 物种
            （如 ``"luban"`` / ``"sherlock"`` / ``"vangogh"``）.
        version: 语义化版本号.
        maturity_level: 成熟度等级 1-5（对应 Capability Maturity Level L0-L4）.
        trigger_patterns: 触发模式列表（regex 或关键词）.
        procedure: 执行步骤描述（自然语言或伪代码）.
        preconditions: 前置条件列表.
        postconditions: 后置条件列表.
        anti_patterns: 反模式列表（不应出现的情况）.
        inputs: 输入参数名列表.
        outputs: 输出参数名列表.
        confidence: 置信度（0.0-1.0）.
        usage_count: 累计使用次数.
        success_count: 成功次数.
        failure_count: 失败次数.
        created_at: 创建时间（ISO 8601）.
        updated_at: 更新时间（ISO 8601）.
        created_by: 创建者（forgekin_id 或 ``"human"``）.
        tags: 标签列表.
        is_public: 是否公开到市场.
        metadata: 额外元数据（如市场评分等）.
    """

    model_config = ConfigDict(validate_assignment=True)

    skill_id: str = Field(
        default_factory=lambda: f"skill_{uuid.uuid4().hex[:12]}"
    )
    name: str
    description: str = ""
    forgekin_species: str = ""
    version: str = "1.0.0"
    maturity_level: int = 1
    trigger_patterns: list[str] = Field(default_factory=list)
    procedure: str = ""
    preconditions: list[str] = Field(default_factory=list)
    postconditions: list[str] = Field(default_factory=list)
    anti_patterns: list[str] = Field(default_factory=list)
    inputs: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    confidence: float = 0.5
    usage_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)
    created_by: str = ""
    tags: list[str] = Field(default_factory=list)
    is_public: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("maturity_level")
    @classmethod
    def _validate_maturity(cls, v: int) -> int:
        """校验成熟度在 1-5 范围内（对应 L0-L4）."""
        if not _MATURITY_MIN <= v <= _MATURITY_MAX:
            raise ValueError(
                f"maturity_level 必须在 [{_MATURITY_MIN}, {_MATURITY_MAX}] 范围内，"
                f"得到 {v}"
            )
        return v

    @field_validator("confidence")
    @classmethod
    def _validate_confidence(cls, v: float) -> float:
        """校验置信度在 0.0-1.0 范围内."""
        if not 0.0 <= v <= 1.0:
            raise ValueError(
                f"confidence 必须在 [0.0, 1.0] 范围内，得到 {v}"
            )
        return v

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        """校验技能名非空."""
        if not v or not v.strip():
            raise ValueError("name 不能为空")
        return v.strip()

    def success_rate(self) -> float:
        """返回历史成功率（success_count / max(usage_count, 1)）."""
        if self.usage_count <= 0:
            return 0.0
        return self.success_count / self.usage_count

    def touch(self) -> None:
        """更新 updated_at 字段为当前时间."""
        self.updated_at = _now_iso()


class SkillInvocation(BaseModel):
    """技能调用记录.

    记录一次技能调用的元数据，包括调用方、输入、输出、成功状态、
    耗时、错误信息与反馈。实际执行由调用方完成，SkillLibrary 仅
    记录元数据。

    属性:
        invocation_id: 调用唯一标识（自动生成）.
        skill_id: 被调用的技能 ID.
        invoked_by: 调用方 forgekin_id.
        invoked_at: 调用时间（ISO 8601）.
        inputs: 调用输入参数.
        outputs: 调用输出结果.
        success: 是否成功.
        duration_seconds: 耗时（秒）.
        error: 错误信息（失败时）.
        feedback: 调用方反馈.
    """

    model_config = ConfigDict(validate_assignment=True)

    invocation_id: str = Field(
        default_factory=lambda: f"inv_{uuid.uuid4().hex[:12]}"
    )
    skill_id: str
    invoked_by: str
    invoked_at: str = Field(default_factory=_now_iso)
    inputs: dict[str, Any] = Field(default_factory=dict)
    outputs: dict[str, Any] = Field(default_factory=dict)
    success: bool = False
    duration_seconds: float = 0.0
    error: str = ""
    feedback: str = ""


# ── SkillLibrary 技能库 ─────────────────────────────────────────


class SkillLibrary:
    """技能库管理器.

    负责技能的注册 / 更新 / 注销 / 检索 / 匹配 / 调用记录 / 进化 /
    导入导出。每个技能以 YAML 文件持久化到 ``storage_dir`` 下
    （文件名 ``{skill_id}.yaml``），便于版本控制与人工审查。

    所有 IO 方法为 ``async``（项目规范：所有 I/O 操作异步化）。
    ``metrics_collector`` / ``event_bus`` / ``logger`` 均通过构造函数
    注入（铁律3：禁止绕过 DI 容器直接实例化）。

    Args:
        storage_dir: 技能 YAML 文件存储目录。默认 ``flowforge/data/skill_library``.
        metrics_collector: 指标采集器（实现 ``inc_counter`` /
            ``observe_histogram`` / ``set_gauge`` 接口，可选）.
        event_bus: 事件总线（实现 ``emit(task_id, event_type, payload)``
            接口，可选）.
        logger: 日志器（可选，默认通过 ``get_logger`` 获取）.
    """

    # 事件类型常量
    EVENT_SKILL_REGISTERED = "skill.registered"
    EVENT_SKILL_UPDATED = "skill.updated"
    EVENT_SKILL_UNREGISTERED = "skill.unregistered"
    EVENT_SKILL_INVOKED = "skill.invoked"
    EVENT_SKILL_INVOCATION_COMPLETED = "skill.invocation.completed"
    EVENT_SKILL_EVOLVED = "skill.evolved"

    # 指标名常量
    METRIC_INVOCATIONS_TOTAL = "flowforge_skill_invocations_total"
    METRIC_INVOCATION_DURATION = "flowforge_skill_invocation_duration_seconds"
    METRIC_LIBRARY_SIZE = "flowforge_skill_library_size"

    def __init__(
        self,
        storage_dir: str | Path | None = None,
        metrics_collector: Any = None,
        event_bus: Any = None,
        logger: Any = None,
    ) -> None:
        self._storage_dir: Path = (
            Path(storage_dir) if storage_dir else _DEFAULT_STORAGE_DIR
        )
        self._storage_dir.mkdir(parents=True, exist_ok=True)
        self._metrics = metrics_collector
        self._event_bus = event_bus
        self._logger = logger or get_logger("flowforge.core.skill_library")
        self._skills: dict[str, Skill] = {}
        # 调用记录：invocation_id -> SkillInvocation
        self._invocations: dict[str, SkillInvocation] = {}
        # 调用开始时间戳：invocation_id -> monotonic time
        self._invocation_start_times: dict[str, float] = {}
        # 加载已有技能
        self._load_all()

    # ── 内部辅助 ──────────────────────────────────────────────────

    def _skill_path(self, skill_id: str) -> Path:
        """返回技能对应的 YAML 文件路径."""
        return self._storage_dir / f"{skill_id}.yaml"

    def _load_all(self) -> None:
        """加载 storage_dir 下所有 skill YAML 文件到内存."""
        if not self._storage_dir.exists():
            return
        for path in self._storage_dir.glob("*.yaml"):
            try:
                with open(path, encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                if data and isinstance(data, dict):
                    skill = Skill(**data)
                    self._skills[skill.skill_id] = skill
            except Exception as exc:  # noqa: BLE001 — 加载阶段需捕获所有异常
                self._logger.warning(f"加载技能文件失败 {path}: {exc}")

    def _persist(self, skill: Skill) -> None:
        """将技能持久化到 YAML 文件."""
        path = self._skill_path(skill.skill_id)
        with open(path, "w", encoding="utf-8") as f:
            yaml.safe_dump(
                skill.model_dump(),
                f,
                allow_unicode=True,
                sort_keys=False,
            )

    def _remove_file(self, skill_id: str) -> None:
        """删除技能对应的 YAML 文件."""
        path = self._skill_path(skill_id)
        if path.exists():
            path.unlink()

    def _emit(self, event_type: str, payload: dict) -> None:
        """发送事件到事件总线（容忍异常）."""
        if self._event_bus is None:
            return
        try:
            self._event_bus.emit("skill_library", event_type, payload)
        except Exception as exc:  # noqa: BLE001 — 事件总线不应阻塞主流程
            self._logger.warning(f"事件总线发送失败 {event_type}: {exc}")

    def _inc_counter(
        self, name: str, value: float = 1.0, labels: dict | None = None
    ) -> None:
        """递增计数器指标（容忍异常）."""
        if self._metrics is None:
            return
        try:
            self._metrics.inc_counter(name, value=value, labels=labels)
        except Exception as exc:  # noqa: BLE001 — 指标上报不应阻塞主流程
            self._logger.warning(f"指标上报失败 {name}: {exc}")

    def _observe_histogram(
        self, name: str, value: float, labels: dict | None = None
    ) -> None:
        """记录直方图指标（容忍异常）."""
        if self._metrics is None:
            return
        try:
            self._metrics.observe_histogram(name, value, labels=labels)
        except Exception as exc:  # noqa: BLE001 — 指标上报不应阻塞主流程
            self._logger.warning(f"指标上报失败 {name}: {exc}")

    def _set_gauge(
        self, name: str, value: float, labels: dict | None = None
    ) -> None:
        """设置 gauge 指标（容忍异常）."""
        if self._metrics is None:
            return
        try:
            self._metrics.set_gauge(name, value, labels=labels)
        except Exception as exc:  # noqa: BLE001 — 指标上报不应阻塞主流程
            self._logger.warning(f"指标上报失败 {name}: {exc}")

    def _recent_invocations(self, skill_id: str, limit: int = _EVOLVE_RECENT_WINDOW) -> list[SkillInvocation]:
        """返回指定技能最近 N 次已完成的调用记录."""
        records = [
            inv for inv in self._invocations.values()
            if inv.skill_id == skill_id and inv.duration_seconds > 0
        ]
        # 按 invoked_at 倒序取最近 limit 条
        records.sort(key=lambda x: x.invoked_at, reverse=True)
        return records[:limit]

    # ── 公开 API：注册 / 更新 / 注销 ──────────────────────────────

    async def register_skill(self, skill: Skill) -> str:
        """注册新技能，返回 skill_id.

        若 skill.skill_id 为空或与已存在技能冲突，将生成新 ID。
        持久化到 ``{storage_dir}/{skill_id}.yaml``.

        Args:
            skill: 待注册的技能对象.

        Returns:
            注册后的 skill_id.
        """
        if not skill.skill_id or skill.skill_id in self._skills:
            # 冲突时生成新 ID（不覆盖既有技能）
            skill.skill_id = f"skill_{uuid.uuid4().hex[:12]}"
        skill.touch()
        self._skills[skill.skill_id] = skill
        self._persist(skill)
        self._inc_counter(
            "flowforge_skill_registered_total",
            labels={"forgekin_species": skill.forgekin_species},
        )
        self._set_gauge(
            self.METRIC_LIBRARY_SIZE, float(len(self._skills))
        )
        self._emit(
            self.EVENT_SKILL_REGISTERED,
            {"skill_id": skill.skill_id, "name": skill.name},
        )
        self._logger.info(
            f"注册技能 {skill.skill_id} ({skill.name}) 物种={skill.forgekin_species}"
        )
        return skill.skill_id

    async def update_skill(self, skill_id: str, updates: dict[str, Any]) -> Skill:
        """更新技能字段，返回更新后的 Skill.

        Args:
            skill_id: 待更新的技能 ID.
            updates: 待更新的字段字典（键值对）.

        Returns:
            更新后的 Skill 对象.

        Raises:
            KeyError: 技能不存在.
        """
        if skill_id not in self._skills:
            raise KeyError(f"技能不存在: {skill_id}")
        skill = self._skills[skill_id]
        for key, value in updates.items():
            if hasattr(skill, key) and key != "skill_id":
                setattr(skill, key, value)
        skill.touch()
        self._persist(skill)
        self._inc_counter(
            "flowforge_skill_updated_total",
            labels={"forgekin_species": skill.forgekin_species},
        )
        self._emit(
            self.EVENT_SKILL_UPDATED,
            {"skill_id": skill_id, "updates": list(updates.keys())},
        )
        self._logger.info(f"更新技能 {skill_id}: {list(updates.keys())}")
        return skill

    async def unregister_skill(self, skill_id: str) -> bool:
        """注销技能，删除内存与磁盘记录.

        Args:
            skill_id: 待注销的技能 ID.

        Returns:
            ``True`` 表示删除成功；``False`` 表示技能不存在.
        """
        if skill_id not in self._skills:
            return False
        del self._skills[skill_id]
        self._remove_file(skill_id)
        self._set_gauge(
            self.METRIC_LIBRARY_SIZE, float(len(self._skills))
        )
        self._emit(self.EVENT_SKILL_UNREGISTERED, {"skill_id": skill_id})
        self._logger.info(f"注销技能 {skill_id}")
        return True

    # ── 公开 API：检索 ────────────────────────────────────────────

    async def get_skill(self, skill_id: str) -> Skill | None:
        """获取技能。不存在返回 None."""
        return self._skills.get(skill_id)

    async def list_skills(
        self,
        forgekin_species: str | None = None,
        tags: list[str] | None = None,
        maturity_min: int = 0,
    ) -> list[Skill]:
        """列出技能，支持按物种 / 标签 / 最低成熟度过滤.

        Args:
            forgekin_species: 仅返回此物种的技能（None 表示不过滤）.
            tags: 仅返回包含任一标签的技能（None 表示不过滤）.
            maturity_min: 仅返回 maturity_level >= maturity_min 的技能.

        Returns:
            过滤后的技能列表.
        """
        result = []
        tag_set = set(tags) if tags else None
        for skill in self._skills.values():
            if forgekin_species and skill.forgekin_species != forgekin_species:
                continue
            if tag_set and not (set(skill.tags) & tag_set):
                continue
            if skill.maturity_level < maturity_min:
                continue
            result.append(skill)
        return result

    async def search_skills(self, query: str, limit: int = 10) -> list[Skill]:
        """搜索技能（按 name / description / tags 匹配）.

        匹配方式：大小写不敏感的子串匹配。综合评分排序后返回前 limit 条。
        """
        if not query:
            return []
        q = query.lower()
        scored: list[tuple[float, Skill]] = []
        for skill in self._skills.values():
            score = 0.0
            if q in skill.name.lower():
                score += 3.0
            if skill.description and q in skill.description.lower():
                score += 2.0
            for tag in skill.tags:
                if q in tag.lower():
                    score += 1.5
                    break
            if score > 0:
                scored.append((score, skill))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [s for _, s in scored[:limit]]

    async def match_skills(
        self, trigger: str, context: dict[str, Any] | None = None
    ) -> list[Skill]:
        """根据 trigger 匹配技能.

        匹配规则：
        1. trigger_patterns 中任一模式匹配（regex 优先，回退关键词子串）
        2. 所有 preconditions 在 context 中满足

        排序：``confidence * usage_success_rate`` 降序。

        Args:
            trigger: 触发字符串（如用户输入或任务描述）.
            context: 上下文字典，用于校验 preconditions.

        Returns:
            匹配且通过前置条件的技能列表（按综合得分降序）.
        """
        ctx = context or {}
        matched: list[Skill] = []
        for skill in self._skills.values():
            if not skill.trigger_patterns:
                continue
            if not any(
                _match_trigger_pattern(p, trigger)
                for p in skill.trigger_patterns
            ):
                continue
            # 校验前置条件
            if not all(
                _check_precondition(p, ctx) for p in skill.preconditions
            ):
                continue
            matched.append(skill)
        # 按 confidence * success_rate 降序
        matched.sort(
            key=lambda s: s.confidence * max(s.success_rate(), 0.0),
            reverse=True,
        )
        return matched

    # ── 公开 API：调用记录 ────────────────────────────────────────

    async def invoke_skill(
        self,
        skill_id: str,
        inputs: dict[str, Any],
        invoked_by: str,
    ) -> SkillInvocation:
        """调用技能，返回调用记录.

        本方法仅记录调用开始，**不执行具体业务逻辑**——实际执行
        由调用方完成，调用方随后通过 :meth:`record_invocation_result`
        反馈结果。

        Args:
            skill_id: 被调用的技能 ID.
            inputs: 调用输入参数.
            invoked_by: 调用方 forgekin_id.

        Returns:
            SkillInvocation 调用记录（含 invocation_id 供后续反馈）.

        Raises:
            KeyError: 技能不存在.
        """
        if skill_id not in self._skills:
            raise KeyError(f"技能不存在: {skill_id}")
        invocation = SkillInvocation(
            skill_id=skill_id,
            invoked_by=invoked_by,
            inputs=dict(inputs),
        )
        self._invocations[invocation.invocation_id] = invocation
        self._invocation_start_times[invocation.invocation_id] = time.monotonic()
        self._inc_counter(
            self.METRIC_INVOCATIONS_TOTAL,
            labels={
                "skill_id": skill_id,
                "invoked_by": invoked_by,
            },
        )
        self._emit(
            self.EVENT_SKILL_INVOKED,
            {
                "invocation_id": invocation.invocation_id,
                "skill_id": skill_id,
                "invoked_by": invoked_by,
            },
        )
        self._logger.info(
            f"调用技能 {skill_id} invocation={invocation.invocation_id} "
            f"by={invoked_by}"
        )
        return invocation

    async def record_invocation_result(
        self,
        invocation_id: str,
        success: bool,
        outputs: dict[str, Any] | None = None,
        error: str = "",
        feedback: str = "",
    ) -> None:
        """反馈调用结果，更新技能统计与指标.

        Args:
            invocation_id: 调用 ID（由 :meth:`invoke_skill` 返回）.
            success: 调用是否成功.
            outputs: 调用输出结果.
            error: 错误信息（失败时）.
            feedback: 调用方反馈.
        """
        invocation = self._invocations.get(invocation_id)
        if invocation is None:
            self._logger.warning(f"调用记录不存在: {invocation_id}")
            return
        start = self._invocation_start_times.pop(invocation_id, None)
        duration = (
            time.monotonic() - start if start is not None else 0.0
        )
        invocation.success = success
        invocation.outputs = dict(outputs) if outputs else {}
        invocation.error = error
        invocation.feedback = feedback
        invocation.duration_seconds = duration

        # 更新技能统计
        skill = self._skills.get(invocation.skill_id)
        if skill is not None:
            skill.usage_count += 1
            if success:
                skill.success_count += 1
            else:
                skill.failure_count += 1
            skill.touch()
            self._persist(skill)
            self._observe_histogram(
                self.METRIC_INVOCATION_DURATION,
                duration,
                labels={
                    "skill_id": skill.skill_id,
                    "success": "true" if success else "false",
                },
            )
        self._emit(
            self.EVENT_SKILL_INVOCATION_COMPLETED,
            {
                "invocation_id": invocation_id,
                "skill_id": invocation.skill_id,
                "success": success,
                "duration_seconds": duration,
            },
        )
        self._logger.info(
            f"调用完成 {invocation_id} success={success} duration={duration:.3f}s"
        )

    # ── 公开 API：进化 ────────────────────────────────────────────

    async def evolve_skill(
        self, skill_id: str, experience: dict[str, Any]
    ) -> Skill:
        """基于经验进化技能.

        进化逻辑：
        - 更新 procedure（若 experience 提供新 procedure）
        - 追加 anti_patterns（若 experience 提供新反模式列表）
        - 调整 confidence（基于最近 N 次调用成功率，平滑更新）
        - 提升 maturity_level（若 success_rate > 0.9 且 usage_count > 10）

        Args:
            skill_id: 待进化的技能 ID.
            experience: 经验字典，可含 ``procedure`` / ``anti_patterns`` /
                ``new_tags`` 等字段.

        Returns:
            进化后的 Skill 对象.

        Raises:
            KeyError: 技能不存在.
        """
        if skill_id not in self._skills:
            raise KeyError(f"技能不存在: {skill_id}")
        skill = self._skills[skill_id]

        # 1. 更新 procedure
        new_procedure = experience.get("procedure")
        if new_procedure:
            skill.procedure = new_procedure

        # 2. 追加 anti_patterns（去重）
        new_anti = experience.get("anti_patterns") or []
        if new_anti:
            existing = set(skill.anti_patterns)
            for ap in new_anti:
                if ap and ap not in existing:
                    skill.anti_patterns.append(ap)
                    existing.add(ap)

        # 3. 追加 tags
        new_tags = experience.get("new_tags") or []
        if new_tags:
            existing_tags = set(skill.tags)
            for tag in new_tags:
                if tag and tag not in existing_tags:
                    skill.tags.append(tag)
                    existing_tags.add(tag)

        # 4. 调整 confidence（基于最近 N 次调用成功率，平滑更新）
        recent = self._recent_invocations(skill_id)
        if recent:
            recent_success_rate = (
                sum(1 for r in recent if r.success) / len(recent)
            )
            # 平滑更新：新 = 旧 * (1 - α) + 最近成功率 * α
            skill.confidence = round(
                skill.confidence * (1 - _CONFIDENCE_SMOOTH_ALPHA)
                + recent_success_rate * _CONFIDENCE_SMOOTH_ALPHA,
                4,
            )
            # 校验区间
            if skill.confidence > 1.0:
                skill.confidence = 1.0
            elif skill.confidence < 0.0:
                skill.confidence = 0.0

        # 5. 提升 maturity_level
        if (
            skill.usage_count > _MATURITY_PROMOTE_USAGE_MIN
            and skill.success_rate() > _MATURITY_PROMOTE_SUCCESS_RATE
            and skill.maturity_level < _MATURITY_MAX
        ):
            skill.maturity_level += 1
            self._logger.info(
                f"技能 {skill_id} 成熟度提升至 L{skill.maturity_level - 1}"
            )

        skill.touch()
        self._persist(skill)
        self._inc_counter(
            "flowforge_skill_evolved_total",
            labels={"forgekin_species": skill.forgekin_species},
        )
        self._emit(
            self.EVENT_SKILL_EVOLVED,
            {
                "skill_id": skill_id,
                "confidence": skill.confidence,
                "maturity_level": skill.maturity_level,
            },
        )
        self._logger.info(
            f"进化技能 {skill_id}: confidence={skill.confidence} "
            f"maturity={skill.maturity_level}"
        )
        return skill

    # ── 公开 API：导入导出 ───────────────────────────────────────

    async def export_skill(self, skill_id: str) -> dict:
        """导出技能为 dict（用于市场共享）.

        Args:
            skill_id: 待导出的技能 ID.

        Returns:
            技能的字典表示（含所有字段）.

        Raises:
            KeyError: 技能不存在.
        """
        if skill_id not in self._skills:
            raise KeyError(f"技能不存在: {skill_id}")
        return self._skills[skill_id].model_dump()

    async def import_skill(
        self, skill_data: dict[str, Any], overwrite: bool = False
    ) -> Skill:
        """从 dict 导入技能.

        Args:
            skill_data: 技能字典表示.
            overwrite: 若技能 ID 已存在，是否覆盖；False 时生成新 ID.

        Returns:
            导入后的 Skill 对象.
        """
        existing_id = skill_data.get("skill_id")
        if (
            existing_id
            and existing_id in self._skills
            and not overwrite
        ):
            # 生成新 ID 避免覆盖
            skill_data = {**skill_data, "skill_id": f"skill_{uuid.uuid4().hex[:12]}"}
        skill = Skill(**skill_data)
        skill.touch()
        self._skills[skill.skill_id] = skill
        self._persist(skill)
        self._set_gauge(self.METRIC_LIBRARY_SIZE, float(len(self._skills)))
        self._emit(
            self.EVENT_SKILL_REGISTERED,
            {"skill_id": skill.skill_id, "name": skill.name, "imported": True},
        )
        self._logger.info(
            f"导入技能 {skill.skill_id} ({skill.name}) overwrite={overwrite}"
        )
        return skill

    # ── 公开 API：统计 ────────────────────────────────────────────

    def get_skill_statistics(self, skill_id: str) -> dict:
        """获取技能统计（usage_count / success_rate / avg_duration）."""
        skill = self._skills.get(skill_id)
        if skill is None:
            return {}
        invocations = [
            inv for inv in self._invocations.values()
            if inv.skill_id == skill_id and inv.duration_seconds > 0
        ]
        avg_duration = (
            sum(inv.duration_seconds for inv in invocations) / len(invocations)
            if invocations
            else 0.0
        )
        return {
            "skill_id": skill_id,
            "name": skill.name,
            "usage_count": skill.usage_count,
            "success_count": skill.success_count,
            "failure_count": skill.failure_count,
            "success_rate": round(skill.success_rate(), 4),
            "avg_duration_seconds": round(avg_duration, 4),
            "invocation_count": len(invocations),
            "confidence": skill.confidence,
            "maturity_level": skill.maturity_level,
        }

    def get_library_status(self) -> dict:
        """获取技能库整体状态."""
        by_species: dict[str, int] = {}
        by_maturity: dict[int, int] = {}
        public_count = 0
        for skill in self._skills.values():
            by_species[skill.forgekin_species] = (
                by_species.get(skill.forgekin_species, 0) + 1
            )
            by_maturity[skill.maturity_level] = (
                by_maturity.get(skill.maturity_level, 0) + 1
            )
            if skill.is_public:
                public_count += 1
        return {
            "total_skills": len(self._skills),
            "public_skills": public_count,
            "total_invocations": len(self._invocations),
            "by_species": by_species,
            "by_maturity": by_maturity,
            "storage_dir": str(self._storage_dir),
        }


# ── SkillMarket 技能市场 ─────────────────────────────────────────


class SkillMarket:
    """技能市场，基于 SkillLibrary 扩展.

    提供 Forgekin 技能的市场化共享能力：
    - ``publish_to_market`` 仅发布 ``is_public=True`` 的技能到市场目录
    - ``browse_market`` 浏览市场，支持按物种 / 标签过滤与多种排序
    - ``install_from_market`` 从市场安装技能到本地库
    - ``rate_skill`` 对市场技能评分（1-5 星）

    市场目录与本地库目录分离，便于权限隔离与审计。

    Args:
        library: 关联的 SkillLibrary 实例.
        market_dir: 市场目录（默认 ``flowforge/data/skill_market``）.
    """

    MARKET_RATINGS_KEY = "market_ratings"

    def __init__(
        self,
        library: SkillLibrary,
        market_dir: str | Path | None = None,
    ) -> None:
        self._library = library
        self._market_dir: Path = (
            Path(market_dir) if market_dir else _DEFAULT_MARKET_DIR
        )
        self._market_dir.mkdir(parents=True, exist_ok=True)

    # ── 内部辅助 ──────────────────────────────────────────────────

    def _market_skill_path(self, skill_id: str) -> Path:
        """返回市场技能对应的 YAML 文件路径."""
        return self._market_dir / f"{skill_id}.yaml"

    def _load_market_skill(self, skill_id: str) -> Skill | None:
        """从市场目录加载单个技能."""
        path = self._market_skill_path(skill_id)
        if not path.exists():
            return None
        try:
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
            if data and isinstance(data, dict):
                return Skill(**data)
        except Exception as exc:  # noqa: BLE001 — 加载阶段需捕获所有异常
            self._library._logger.warning(f"加载市场技能失败 {path}: {exc}")
        return None

    def _load_all_market_skills(self) -> list[Skill]:
        """加载市场目录下所有技能."""
        if not self._market_dir.exists():
            return []
        skills: list[Skill] = []
        for path in self._market_dir.glob("*.yaml"):
            try:
                with open(path, encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                if data and isinstance(data, dict):
                    skills.append(Skill(**data))
            except Exception as exc:  # noqa: BLE001 — 加载阶段需捕获所有异常
                self._library._logger.warning(
                    f"加载市场技能文件失败 {path}: {exc}"
                )
        return skills

    def _persist_market_skill(self, skill: Skill) -> None:
        """将技能持久化到市场目录."""
        path = self._market_skill_path(skill.skill_id)
        with open(path, "w", encoding="utf-8") as f:
            yaml.safe_dump(
                skill.model_dump(),
                f,
                allow_unicode=True,
                sort_keys=False,
            )

    # ── 公开 API ──────────────────────────────────────────────────

    async def publish_to_market(self, skill_id: str) -> bool:
        """发布技能到市场（仅 ``is_public=True`` 的技能）.

        Args:
            skill_id: 待发布的技能 ID.

        Returns:
            ``True`` 表示发布成功；``False`` 表示技能不存在或非公开.
        """
        skill = await self._library.get_skill(skill_id)
        if skill is None:
            return False
        if not skill.is_public:
            return False
        # 拷贝一份到市场目录（避免共享引用导致后续修改互相影响）
        market_skill = Skill(**skill.model_dump())
        self._persist_market_skill(market_skill)
        self._library._logger.info(
            f"发布技能 {skill_id} 到市场 {self._market_dir}"
        )
        return True

    async def browse_market(
        self,
        forgekin_species: str | None = None,
        tags: list[str] | None = None,
        sort_by: str = "usage_count",
    ) -> list[Skill]:
        """浏览市场技能.

        Args:
            forgekin_species: 仅返回此物种的技能（None 不过滤）.
            tags: 仅返回包含任一标签的技能（None 不过滤）.
            sort_by: 排序字段，可选 ``usage_count`` / ``confidence``
                / ``maturity_level`` / ``success_rate`` / ``rating_avg``.

        Returns:
            过滤并排序后的技能列表.
        """
        skills = self._load_all_market_skills()
        tag_set = set(tags) if tags else None
        filtered: list[Skill] = []
        for skill in skills:
            if forgekin_species and skill.forgekin_species != forgekin_species:
                continue
            if tag_set and not (set(skill.tags) & tag_set):
                continue
            filtered.append(skill)

        def sort_key(skill: Skill) -> float:
            if sort_by == "confidence":
                return skill.confidence
            if sort_by == "maturity_level":
                return float(skill.maturity_level)
            if sort_by == "success_rate":
                return skill.success_rate()
            if sort_by == "rating_avg":
                return self._rating_avg(skill)
            return float(skill.usage_count)  # 默认 usage_count

        filtered.sort(key=sort_key, reverse=True)
        return filtered

    async def install_from_market(self, skill_id: str) -> Skill:
        """从市场安装技能到本地库.

        Args:
            skill_id: 市场中待安装的技能 ID.

        Returns:
            安装到本地库后的 Skill 对象.

        Raises:
            KeyError: 市场中不存在该技能.
        """
        market_skill = self._load_market_skill(skill_id)
        if market_skill is None:
            raise KeyError(f"市场技能不存在: {skill_id}")
        # 通过 import_skill 写入本地库（若 ID 冲突，生成新 ID）
        installed = await self._library.import_skill(
            market_skill.model_dump(), overwrite=False
        )
        self._library._logger.info(
            f"从市场安装技能 {skill_id} -> 本地 {installed.skill_id}"
        )
        return installed

    async def rate_skill(
        self, skill_id: str, rating: int, comment: str = ""
    ) -> None:
        """评价市场技能（1-5 星）.

        评分写入市场技能的 ``metadata[SkillMarket.MARKET_RATINGS_KEY]``
        列表，便于后续聚合计算。

        Args:
            skill_id: 市场技能 ID.
            rating: 评分 1-5.
            comment: 评价评论（可选）.
        """
        if not 1 <= rating <= 5:
            raise ValueError(f"rating 必须在 [1, 5] 范围内，得到 {rating}")
        skill = self._load_market_skill(skill_id)
        if skill is None:
            raise KeyError(f"市场技能不存在: {skill_id}")
        ratings = list(skill.metadata.get(self.MARKET_RATINGS_KEY, []))
        ratings.append({"rating": rating, "comment": comment})
        skill.metadata[self.MARKET_RATINGS_KEY] = ratings
        self._persist_market_skill(skill)
        self._library._logger.info(
            f"评价市场技能 {skill_id}: {rating} 星 ({comment or '无评论'})"
        )

    def _rating_avg(self, skill: Skill) -> float:
        """计算技能的市场平均评分."""
        ratings = skill.metadata.get(self.MARKET_RATINGS_KEY, [])
        if not ratings:
            return 0.0
        total = sum(r.get("rating", 0) for r in ratings)
        return total / len(ratings)

    async def get_market_status(self) -> dict:
        """获取市场整体状态."""
        skills = self._load_all_market_skills()
        by_species: dict[str, int] = {}
        by_maturity: dict[int, int] = {}
        rating_sum = 0.0
        rating_count = 0
        for skill in skills:
            by_species[skill.forgekin_species] = (
                by_species.get(skill.forgekin_species, 0) + 1
            )
            by_maturity[skill.maturity_level] = (
                by_maturity.get(skill.maturity_level, 0) + 1
            )
            ratings = skill.metadata.get(self.MARKET_RATINGS_KEY, [])
            for r in ratings:
                rating_sum += r.get("rating", 0)
                rating_count += 1
        return {
            "total_skills": len(skills),
            "by_species": by_species,
            "by_maturity": by_maturity,
            "avg_rating": round(rating_sum / rating_count, 2) if rating_count else 0.0,
            "rating_count": rating_count,
            "market_dir": str(self._market_dir),
        }
