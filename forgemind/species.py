"""灵族（Forgekin Species）— 灵智体五大形态分类。

灵智体不是单一形态。本模块定义五大形态分类，每类有其锻造流水线、
传感器接入方式、虚拟世界设定层、进化谱系。

形态可进化：一只生物灵智体猫可以通过积累组织协作经验进化为
HybridForgekin（既是宠物又是社区吉祥物）。这是和其他 multi-agent
系统的最大差异化优势——agent 不是固定的"岗位槽位"，而是有形态、
有谱系、可进化的灵智体。

详见:
    - [doc:design/naming-contract.md#2.3] 灵族定义
    - [doc:decisions/013-all-things-spirit-mind-vision.md] 万物灵智体愿景
    - [doc:VISION.md#2] 万物灵智体形态分类
"""

from __future__ import annotations

from enum import Enum


class ForgekinSpecies(str, Enum):
    """灵族（Forgekin Species）— 灵智体五大形态分类。

    形态决定灵智体的物理接入方式和虚拟设定层。详见
    [doc:design/naming-contract.md#2.3]。

    五大形态:
        - ``BIO``     生物灵智体（BioForgekin）— 猫/狗/鸟/鱼/昆虫群体
        - ``ORG``     组织灵智体（OrgForgekin）— 公司/团队/社区/城市
        - ``OBJ``     物品灵智体（ObjForgekin）— 桌椅/灯具/家电/工具
        - ``VIRTUAL`` 虚拟灵智体（VirtualForgekin）— 童话/神话/历史/游戏角色
        - ``HYBRID``  混合灵智体（HybridForgekin）— 多形态融合
    """

    BIO = "bio"
    ORG = "org"
    OBJ = "obj"
    VIRTUAL = "virtual"
    HYBRID = "hybrid"

    @classmethod
    def from_string(cls, value: str) -> "ForgekinSpecies":
        """从字符串解析灵族枚举，大小写不敏感。

        Args:
            value: 灵族字符串（如 ``"bio"`` / ``"BIO"``）。

        Returns:
            对应的 :class:`ForgekinSpecies` 枚举值。

        Raises:
            ValueError: 字符串无法映射到任何灵族。
        """
        normalized = value.strip().lower()
        for member in cls:
            if member.value == normalized:
                return member
        valid = ", ".join(m.value for m in cls)
        raise ValueError(
            f"未知的灵族形态: {value!r}（合法值: {valid}）。"
            f"详见 [doc:design/naming-contract.md#2.3]"
        )

    @property
    def chinese_name(self) -> str:
        """返回该灵族的中文名。"""
        return _SPECIES_CHINESE_NAMES[self]

    @property
    def class_name(self) -> str:
        """返回该灵族对应的灵智体实现类名（如 ``BioForgekin``）。"""
        return _SPECIES_CLASS_NAMES[self]


_SPECIES_CHINESE_NAMES: dict[ForgekinSpecies, str] = {
    ForgekinSpecies.BIO: "生物灵智体",
    ForgekinSpecies.ORG: "组织灵智体",
    ForgekinSpecies.OBJ: "物品灵智体",
    ForgekinSpecies.VIRTUAL: "虚拟灵智体",
    ForgekinSpecies.HYBRID: "混合灵智体",
}

_SPECIES_CLASS_NAMES: dict[ForgekinSpecies, str] = {
    ForgekinSpecies.BIO: "BioForgekin",
    ForgekinSpecies.ORG: "OrgForgekin",
    ForgekinSpecies.OBJ: "ObjForgekin",
    ForgekinSpecies.VIRTUAL: "VirtualForgekin",
    ForgekinSpecies.HYBRID: "HybridForgekin",
}
