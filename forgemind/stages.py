"""进化阶（Evolution Stage）与觉醒阶（Awakening Stage）枚举定义。

Forgekin有两条独立的进阶轴：

1. **进化阶（Evolution Stage）**：能力成熟度的 6 级进阶体系（E1-E6），
   衡量Forgekin可执行任务的复杂度和领域广度。借鉴 CMMI 5 级 + roleagent.md
   能力 × Harness 公式 + OpenAI Autonomy Levels 的设计思想。
2. **觉醒阶（Awakening Stage）**：自主性和自我导向能力的 6 级进阶体系
   （E1-E6），衡量Forgekin在没有 operator 干预下的决策范围。借鉴 SAE
   自动驾驶 5 级 + OpenAI Agent Autonomy Level + Anthropic
   Constitutional AI 的设计思想。

两条进阶轴的协同规则:
    - E1→E2→E3 是能力积累 / 自主范围扩大，由 Eval 信号 / operator 显式授权触发
    - E3→E4 是跨域能力 / 进入 Evolving 状态（自我导向），是关键转折点，
      需 operator 显式批准 + 另一条轴同步 ≥ E3/E4
    - E4→E5→E6 逐步让渡控制权，但 VISION §7 始终不可被Forgekin修改
    - Magic Words 逃生舱始终可触发（任何阶都不能绕过）

详见:
    - [doc:design/naming-contract.md#2.10] 进化阶定义
    - [doc:design/naming-contract.md#2.11] 觉醒阶定义
    - [doc:design/naming-contract.md#3] 进化阶详细定义
    - [doc:design/naming-contract.md#4] 觉醒阶详细定义
"""

from __future__ import annotations

from enum import Enum


class EvolutionStage(str, Enum):
    """进化阶（Evolution Stage）— Forgekin能力成熟度的 6 级进阶体系。

    衡量Forgekin可执行任务的复杂度和领域广度。详见
    [doc:design/naming-contract.md#3]。

    进阶规则:
        - E1→E2→E3 是能力积累，由 Eval 信号自动触发
        - E3→E4 是跨域能力，需 operator 确认
        - E4→E5 进入 Evoling 状态，需 operator 确认 + 觉醒阶同步 ≥ E3
        - E5→E6 仅由 operator 直接授权，不可自动触发

    废弃命名: 火种（v4.0，"火种"语义模糊）
    """

    E1 = "E1"  # 萌芽阶 Sprout — Initial / Ad-hoc
    E2 = "E2"  # 萌芽阶·稳 Sprout-Stable — Repeatable
    E3 = "E3"  # 成长阶 Growth — Defined / Domain-Aware
    E4 = "E4"  # 成长阶·深 Growth-Deep — Managed / Cross-Domain
    E5 = "E5"  # 觉醒阶 Awakened — Optimizing / Self-Evolving
    E6 = "E6"  # ForgeMind阶 ForgeMind — Master / Forge Master

    @classmethod
    def from_string(cls, value: str) -> "EvolutionStage":
        """从字符串解析进化阶枚举，大小写不敏感。"""
        normalized = value.strip().upper()
        for member in cls:
            if member.value == normalized:
                return member
        valid = ", ".join(m.value for m in cls)
        raise ValueError(
            f"未知的进化阶: {value!r}（合法值: {valid}）。"
            f"详见 [doc:design/naming-contract.md#3]"
        )

    @property
    def chinese_name(self) -> str:
        """返回该进化阶的中文名。"""
        return _EVOLUTION_CHINESE_NAMES[self]

    @property
    def english_name(self) -> str:
        """返回该进化阶的英文名。"""
        return _EVOLUTION_ENGLISH_NAMES[self]

    @property
    def ai_concept(self) -> str:
        """返回该进化阶对应的 AI 业界概念。"""
        return _EVOLUTION_AI_CONCEPTS[self]

    @property
    def level(self) -> int:
        """返回该进化阶的整数等级（1-6），便于比较。"""
        return int(self.value[1])

    def can_cross_species(self) -> bool:
        """判断该进化阶是否具备跨ForgekinSpecies协作能力（≥ E4 Growth-Deep）。"""
        return self.level >= EvolutionStage.E4.level

    def can_initiate_council(self) -> bool:
        """判断该进化阶是否可主动发起MindCouncil（≥ E5 Awakened）。

        详见 [doc:design/naming-contract.md#3] E5 触发条件。
        """
        return self.level >= EvolutionStage.E5.level

    def can_forge_new_forgekin(self) -> bool:
        """判断该进化阶是否可锻造新Forgekin（仅 E6 ForgeMind）。

        E6 是 operator 直接授权的"造 agent"能力，达成 operator
        "养万物"愿景。详见 [doc:design/naming-contract.md#3] E6。
        """
        return self == EvolutionStage.E6


class AwakeningStage(str, Enum):
    """觉醒阶（Awakening Stage）— Forgekin自主性和自我导向能力的 6 级进阶体系。

    衡量Forgekin在没有 operator 干预下的决策范围。详见
    [doc:design/naming-contract.md#4]。

    进阶规则:
        - E1→E2→E3 是自主范围扩大，由 operator 显式授权
        - E3→E4 进入 Evoling 状态（自我导向），是关键转折点，
          需 operator 显式批准 + 进化阶同步 ≥ E4
        - E4→E5→E6 逐步让渡控制权，但 VISION §7 始终不可被Forgekin修改
        - Magic Words 逃生舱始终可触发（任何阶都不能绕过）

    安全治理对应:
        - 觉醒阶 E1-E2：六层 Guardrails 全开
        - 觉醒阶 E3-E4：六层 Guardrails + Eval 自代谢
        - 觉醒阶 E5-E6：六层 Guardrails + Eval 自代谢 + MindCouncil共识 +
          operator 拉闸词

    废弃命名: 升华阶（v4.0，"升华"过于虚幻）
    """

    E1 = "E1"  # 全导阶 Full-Human — L0 Full Human Control
    E2 = "E2"  # 建议阶 Suggest — L1 Suggestion / Assisted
    E3 = "E3"  # 受限自主阶 Bounded-Autonomous — L2 Bounded Autonomous
    E4 = "E4"  # Evolving 阶 Evolving — L3 Evolving / Self-Improving
    E5 = "E5"  # 共创阶 Co-Creative — L4 Co-Creative / Peer
    E6 = "E6"  # ForgeMind主导阶 ForgeMind-Led — L5 ForgeMind-Led / Master

    @classmethod
    def from_string(cls, value: str) -> "AwakeningStage":
        """从字符串解析觉醒阶枚举，大小写不敏感。"""
        normalized = value.strip().upper()
        for member in cls:
            if member.value == normalized:
                return member
        valid = ", ".join(m.value for m in cls)
        raise ValueError(
            f"未知的觉醒阶: {value!r}（合法值: {valid}）。"
            f"详见 [doc:design/naming-contract.md#4]"
        )

    @property
    def chinese_name(self) -> str:
        """返回该觉醒阶的中文名。"""
        return _AWAKENING_CHINESE_NAMES[self]

    @property
    def english_name(self) -> str:
        """返回该觉醒阶的英文名。"""
        return _AWAKENING_ENGLISH_NAMES[self]

    @property
    def ai_concept(self) -> str:
        """返回该觉醒阶对应的 AI 业界概念。"""
        return _AWAKENING_AI_CONCEPTS[self]

    @property
    def level(self) -> int:
        """返回该觉醒阶的整数等级（1-6），便于比较。"""
        return int(self.value[1])

    def can_self_evolve(self) -> bool:
        """判断该觉醒阶是否可自我进化（≥ E4 Evolving）。

        E4 是关键转折点——Forgekin进入 Evolving 状态（自我导向），
        可自主优化自身能力（如重构 harness、补锻典），但不可修改
        VISION §7。详见 [doc:design/naming-contract.md#4] E4。
        """
        return self.level >= AwakeningStage.E4.level

    def is_full_human_control(self) -> bool:
        """判断该觉醒阶是否为全人工（E1，每步操作都需要 operator 介入）。"""
        return self == AwakeningStage.E1


# ── 进化阶元数据表 ────────────────────────────────────────────────
_EVOLUTION_CHINESE_NAMES: dict[EvolutionStage, str] = {
    EvolutionStage.E1: "萌芽阶",
    EvolutionStage.E2: "萌芽阶·稳",
    EvolutionStage.E3: "成长阶",
    EvolutionStage.E4: "成长阶·深",
    EvolutionStage.E5: "觉醒阶",
    EvolutionStage.E6: "ForgeMind阶",
}

_EVOLUTION_ENGLISH_NAMES: dict[EvolutionStage, str] = {
    EvolutionStage.E1: "Sprout",
    EvolutionStage.E2: "Sprout-Stable",
    EvolutionStage.E3: "Growth",
    EvolutionStage.E4: "Growth-Deep",
    EvolutionStage.E5: "Awakened",
    EvolutionStage.E6: "ForgeMind",
}

_EVOLUTION_AI_CONCEPTS: dict[EvolutionStage, str] = {
    EvolutionStage.E1: "Initial / Ad-hoc（初始级 / 临时级）",
    EvolutionStage.E2: "Repeatable（可重复级）",
    EvolutionStage.E3: "Defined / Domain-Aware（已定义级 / 领域感知）",
    EvolutionStage.E4: "Managed / Cross-Domain（已管理级 / 跨域）",
    EvolutionStage.E5: "Optimizing / Self-Evolving（优化级 / 自进化）",
    EvolutionStage.E6: "Master / Forge Master（大师级 / 锻造大师）",
}

# ── 觉醒阶元数据表 ────────────────────────────────────────────────
_AWAKENING_CHINESE_NAMES: dict[AwakeningStage, str] = {
    AwakeningStage.E1: "全导阶",
    AwakeningStage.E2: "建议阶",
    AwakeningStage.E3: "受限自主阶",
    AwakeningStage.E4: "Evolving 阶",
    AwakeningStage.E5: "共创阶",
    AwakeningStage.E6: "ForgeMind主导阶",
}

_AWAKENING_ENGLISH_NAMES: dict[AwakeningStage, str] = {
    AwakeningStage.E1: "Full-Human",
    AwakeningStage.E2: "Suggest",
    AwakeningStage.E3: "Bounded-Autonomous",
    AwakeningStage.E4: "Evolving",
    AwakeningStage.E5: "Co-Creative",
    AwakeningStage.E6: "ForgeMind-Led",
}

_AWAKENING_AI_CONCEPTS: dict[AwakeningStage, str] = {
    AwakeningStage.E1: "L0 Full Human Control / Manual（全人工）",
    AwakeningStage.E2: "L1 Suggestion / Assisted（建议级 / 辅助）",
    AwakeningStage.E3: "L2 Bounded Autonomous / Conditional（受限自主 / 条件自主）",
    AwakeningStage.E4: "L3 Evolving / Self-Improving（自进化 / 自改进）",
    AwakeningStage.E5: "L4 Co-Creative / Peer（共创级 / 平级协作）",
    AwakeningStage.E6: "L5 ForgeMind-Led / Master（ForgeMind主导级 / 大师级）",
}
