"""TeamAct 类型定义 — 六步循环状态、终止条件、持球状态枚举。

本模块定义 TeamAct 协作协议的核心枚举类型，对应 roleagent.md §2：
    - TeamActStep: 六步循环状态（State → Owner → Action → Evidence → Verdict → Route）
    - TerminationCondition: 五项终止条件（缺一不可）
    - BallStatus: 持球状态（持球 / 已传 / 释放 / 升级）

设计依据：
    - features/F002-teamact-loop.md §2.1（六步循环）
    - roleagent.md §2.2（五项终止条件）
    - ADR 012（Forgekin 代码层命名）

铁律遵守：
    - 铁律 5：无硬编码路径/密钥
    - 编程红线 9：使用枚举组合而非继承

License: MIT
"""

from __future__ import annotations

from enum import Enum


class TeamActStep(str, Enum):
    """TeamAct 六步循环状态。

    对应 roleagent.md §2.1 团队主循环：
        STATE    → 读共享状态（仓库 / spec / 任务 / 记忆 / 交接胶囊）
        OWNER    → 谁持球？（路由指令 / 显式持有声明）
        ACTION   → 持球者执行（写代码 / review / 设计 / 调研）
        EVIDENCE → 产出证据（commit / 测试 / trace / 截图）
        VERDICT  → 验证（跨 agent review / 自检 / CVO 确认）
        ROUTE    → 传球（路由给下一个 agent / 继续持有 / 升级给 CVO）

    循环顺序：STATE → OWNER → ACTION → EVIDENCE → VERDICT → ROUTE → STATE（下一轮）
    """

    STATE = "state"
    OWNER = "owner"
    ACTION = "action"
    EVIDENCE = "evidence"
    VERDICT = "verdict"
    ROUTE = "route"

    @classmethod
    def ordered(cls) -> list["TeamActStep"]:
        """返回六步循环的有序列表。"""
        return [cls.STATE, cls.OWNER, cls.ACTION, cls.EVIDENCE, cls.VERDICT, cls.ROUTE]

    def next(self) -> "TeamActStep":
        """返回下一步（ROUTE 之后循环回 STATE）。"""
        order = self.ordered()
        idx = order.index(self)
        return order[(idx + 1) % len(order)]


class TerminationCondition(str, Enum):
    """五项终止条件（缺一不可）。

    对应 roleagent.md §2.2，TeamAct 团队任务终止必须同时满足以下五项：
        1. ACCEPTANCE_DONE: 验收标准全部达成（不能有 deferred）
        2. EVIDENCE_ATTACHED: 证据已附（每条验收都有 commit / 测试 / trace）
        3. CROSS_VALIDATED: 跨 agent 交叉验证（不能自己 review 自己）
        4. NO_DANGLING_OWNERSHIP: 无悬空任务归属（所有 open question 已 resolved 或升级）
        5. VISION_CONVERGED: 愿景收敛（CVO 确认不能被 proxy 替代）

    枚举值与 TerminationReport 字段名一一对应，便于 setattr 动态赋值。
    """

    ACCEPTANCE_DONE = "acceptance_done"
    EVIDENCE_ATTACHED = "evidence_attached"
    CROSS_VALIDATED = "cross_validated"
    NO_DANGLING_OWNERSHIP = "no_dangling_ownership"
    VISION_CONVERGED = "vision_converged"

    @classmethod
    def all(cls) -> list["TerminationCondition"]:
        """返回五项终止条件的完整列表。"""
        return [
            cls.ACCEPTANCE_DONE,
            cls.EVIDENCE_ATTACHED,
            cls.CROSS_VALIDATED,
            cls.NO_DANGLING_OWNERSHIP,
            cls.VISION_CONVERGED,
        ]


class BallStatus(str, Enum):
    """持球状态枚举。

    描述灵智体（Forgekin）在 TeamAct 循环中的持球状态：
        HELD      → 当前持球（执行中）
        PASSED    → 已传球（球已转交给下一个灵智体）
        RELEASED  → 已释放（任务完成，主动释放球权）
        ESCALATED → 已升级（升级给首席愿景官 CVO）
    """

    HELD = "held"
    PASSED = "passed"
    RELEASED = "released"
    ESCALATED = "escalated"
