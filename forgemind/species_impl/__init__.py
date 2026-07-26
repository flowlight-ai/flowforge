"""Forgekin形态实现包（species_impl）— 5 大形态Forgekin的具体实现。

每种形态继承 :class:`~flowforge.forgemind.base.ForgekinBase`，实现
``observe`` / ``act`` / ``verify`` 三个抽象方法，建立与现实世界
（物理或虚拟）的闭环。

5 大形态（详见 [doc:design/naming-contract.md#2.3] ForgekinSpecies定义）:

    - :class:`~flowforge.forgemind.species_impl.bio.BioForgekin`
        生物Forgekin（猫 / 狗 / 鸟 / 鱼 / 昆虫群体）
    - :class:`~flowforge.forgemind.species_impl.org.OrgForgekin`
        组织Forgekin（公司 / 团队 / 社区 / 城市）
    - :class:`~flowforge.forgemind.species_impl.obj.ObjForgekin`
        物品Forgekin（桌椅 / 灯具 / 家电 / 工具）
    - :class:`~flowforge.forgemind.species_impl.virtual.VirtualForgekin`
        虚拟Forgekin（童话 / 神话 / 历史 / 游戏角色）
    - :class:`~flowforge.forgemind.species_impl.hybrid.HybridForgekin`
        混合Forgekin（多形态融合）

形态可进化：一只生物Forgekin猫可通过积累组织协作经验进化为
HybridForgekin（既是宠物又是社区吉祥物）。详见
[doc:decisions/013-all-things-spirit-mind-vision.md#3]。
"""

from flowforge.forgemind.species_impl.bio import BioForgekin
from flowforge.forgemind.species_impl.hybrid import HybridForgekin
from flowforge.forgemind.species_impl.obj import ObjForgekin
from flowforge.forgemind.species_impl.org import OrgForgekin
from flowforge.forgemind.species_impl.virtual import VirtualForgekin

__all__ = [
    "BioForgekin",
    "OrgForgekin",
    "ObjForgekin",
    "VirtualForgekin",
    "HybridForgekin",
]
