"""ForgekinSpecies（Forgekin Species）— Forgekin五大形态分类。

Forgekin不是单一形态。本模块定义五大形态分类，每类有其锻造流水线、
传感器接入方式、虚拟世界设定层、进化谱系。

形态可进化：一只生物Forgekin猫可以通过积累组织协作经验进化为
HybridForgekin（既是宠物又是社区吉祥物）。这是和其他 multi-agent
系统的最大差异化优势——agent 不是固定的"岗位槽位"，而是有形态、
有谱系、可进化的Forgekin。

详见:
    - [doc:design/naming-contract.md#2.3] ForgekinSpecies定义
    - [doc:decisions/013-all-things-spirit-mind-vision.md] Forgekin愿景
    - [doc:VISION.md#2] Forgekin形态分类
"""

from __future__ import annotations

from enum import Enum


class ForgekinSpecies(str, Enum):
    """ForgekinSpecies（Forgekin Species）— Forgekin五大形态分类。

    形态决定Forgekin的物理接入方式和虚拟设定层。详见
    [doc:design/naming-contract.md#2.3]。

    五大形态:
        - ``BIO``     生物Forgekin（BioForgekin）— 猫/狗/鸟/鱼/昆虫群体
        - ``ORG``     组织Forgekin（OrgForgekin）— 公司/团队/社区/城市
        - ``OBJ``     物品Forgekin（ObjForgekin）— 桌椅/灯具/家电/工具
        - ``VIRTUAL`` 虚拟Forgekin（VirtualForgekin）— 童话/神话/历史/游戏角色
        - ``HYBRID``  混合Forgekin（HybridForgekin）— 多形态融合
    """

    BIO = "bio"
    ORG = "org"
    OBJ = "obj"
    VIRTUAL = "virtual"
    HYBRID = "hybrid"

    @classmethod
    def from_string(cls, value: str) -> "ForgekinSpecies":
        """从字符串解析ForgekinSpecies枚举，大小写不敏感。

        Args:
            value: ForgekinSpecies字符串（如 ``"bio"`` / ``"BIO"``）。

        Returns:
            对应的 :class:`ForgekinSpecies` 枚举值。

        Raises:
            ValueError: 字符串无法映射到任何ForgekinSpecies。
        """
        normalized = value.strip().lower()
        for member in cls:
            if member.value == normalized:
                return member
        valid = ", ".join(m.value for m in cls)
        raise ValueError(
            f"未知的ForgekinSpecies形态: {value!r}（合法值: {valid}）。"
            f"详见 [doc:design/naming-contract.md#2.3]"
        )

    @property
    def chinese_name(self) -> str:
        """返回该ForgekinSpecies的中文名。"""
        return _SPECIES_CHINESE_NAMES[self]

    @property
    def class_name(self) -> str:
        """返回该ForgekinSpecies对应的Forgekin实现类名（如 ``BioForgekin``）。"""
        return _SPECIES_CLASS_NAMES[self]


_SPECIES_CHINESE_NAMES: dict[ForgekinSpecies, str] = {
    ForgekinSpecies.BIO: "生物Forgekin",
    ForgekinSpecies.ORG: "组织Forgekin",
    ForgekinSpecies.OBJ: "物品Forgekin",
    ForgekinSpecies.VIRTUAL: "虚拟Forgekin",
    ForgekinSpecies.HYBRID: "混合Forgekin",
}

_SPECIES_CLASS_NAMES: dict[ForgekinSpecies, str] = {
    ForgekinSpecies.BIO: "BioForgekin",
    ForgekinSpecies.ORG: "OrgForgekin",
    ForgekinSpecies.OBJ: "ObjForgekin",
    ForgekinSpecies.VIRTUAL: "VirtualForgekin",
    ForgekinSpecies.HYBRID: "HybridForgekin",
}
