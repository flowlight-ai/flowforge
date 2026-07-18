"""角色面具（Role Mask）— 五层分类。

F093 Bridge Layer 的第一协议。Role Mask 把灵智体的"角色扮演"拆成五层，
允许独立加载/卸载，防止 L4 场景皮肤污染 L3 本体能力。

五层分类（CL-011）:
    - **L1 路由身份（Routing）**：哪个 agent 接任务（如"写作 agent"）
    - **L2 基础设施（Infrastructure）**：用什么工具（如"用 web_search"）
    - **L3 本体能力（Ontology）**：agent 固有能力（如"写作能力"）
    - **L4 场景皮肤（Scene Skin）**：RP 角色（如"孙悟空"）
    - **L5 世界内状态（World State）**：角色当前状态（如"已被如来压五行山"）

铁律:
    灵智体扮演孙悟空时，L4 场景皮肤**不应污染 L3 本体能力**——写作灵智体
    不应真的变成孙悟空，忘记写作能力。RoleMask 可独立加载/卸载，退出场景
    时摘下 L4/L5，保留 L1/L2/L3。

修复的问题:
    - CL-011：v7.0 persona 是扁平文本，未分五层。导致 L4 污染 L3，
      灵智体扮演角色后忘记本体能力。本类把面具分层，支持独立 wear/take_off。

    - CL-012：v7.0 无 Bridge Layer 协议隔离 Core Identity 与 World。本类
      是 Bridge Layer 三协议之一（Role Mask Protocol）。

详见:
    - [doc:review/review.md#13.2] CL-011（Role Mask 五层分类未实现）
    - [doc:review/review.md#13.2] CL-012（三协议 + runtime coordinator）
    - [doc:features/F093-cats-and-u-world-engine.md] 世界引擎 Feature 规格
"""

from __future__ import annotations

from enum import Enum
from typing import Any


class RoleMaskLayer(int, Enum):
    """Role Mask 五层分类（F093 CL-011）。

    层级语义:
        - ``L1_ROUTING``       路由身份（哪个 agent 接任务）
        - ``L2_INFRASTRUCTURE`` 基础设施（用什么工具）
        - ``L3_ONTOLOGY``      本体能力（agent 固有能力）
        - ``L4_SCENE_SKIN``    场景皮肤（RP 角色）
        - ``L5_WORLD_STATE``   世界内状态（角色当前状态）

    隔离原则:
        L4 / L5 是"场景相关"层，进入场景时戴上面具，退出场景时摘下面具。
        L1 / L2 / L3 是"本体相关"层，长期持有，不应被 L4/L5 污染。
    """

    L1_ROUTING = 1
    L2_INFRASTRUCTURE = 2
    L3_ONTOLOGY = 3
    L4_SCENE_SKIN = 4
    L5_WORLD_STATE = 5

    @classmethod
    def scene_layers(cls) -> frozenset["RoleMaskLayer"]:
        """返回场景相关层（L4 / L5）。

        这些层在退出场景时应被摘下，避免污染本体能力。

        Returns:
            ``{L4_SCENE_SKIN, L5_WORLD_STATE}`` 的不可变集合。
        """
        return frozenset({cls.L4_SCENE_SKIN, cls.L5_WORLD_STATE})

    @classmethod
    def ontology_layers(cls) -> frozenset["RoleMaskLayer"]:
        """返回本体相关层（L1 / L2 / L3）。

        这些层长期持有，不应被场景层污染。

        Returns:
            ``{L1_ROUTING, L2_INFRASTRUCTURE, L3_ONTOLOGY}`` 的不可变集合。
        """
        return frozenset({cls.L1_ROUTING, cls.L2_INFRASTRUCTURE, cls.L3_ONTOLOGY})

    @property
    def chinese_name(self) -> str:
        """返回该层的中文名。"""
        return _LAYER_CHINESE_NAMES[self]


_LAYER_CHINESE_NAMES: dict[RoleMaskLayer, str] = {
    RoleMaskLayer.L1_ROUTING: "路由身份",
    RoleMaskLayer.L2_INFRASTRUCTURE: "基础设施",
    RoleMaskLayer.L3_ONTOLOGY: "本体能力",
    RoleMaskLayer.L4_SCENE_SKIN: "场景皮肤",
    RoleMaskLayer.L5_WORLD_STATE: "世界内状态",
}


class RoleMask:
    """角色面具（Role Mask）— 五层分类。

    灵智体扮演孙悟空时，L4 场景皮肤不应污染 L3 本体能力（写作灵智体不应
    真的变成孙悟空，忘记写作能力）。RoleMask 可独立加载/卸载。

    使用模式:
        >>> mask = RoleMask(forgekin_id="forgemind:writer_cat")
        >>> mask.wear(RoleMaskLayer.L4_SCENE_SKIN, {"character": "孙悟空"})
        >>> # ... 执行 RP ...
        >>> mask.take_off(RoleMaskLayer.L4_SCENE_SKIN)  # 退出场景，摘下面具

    线程安全:
        本类非线程安全。多线程环境下应通过 :class:`RuntimeCoordinator`
        串行化 wear/take_off 操作。

    详见:
        - [doc:review/review.md#13.2] CL-011
    """

    def __init__(self, forgekin_id: str) -> None:
        if not forgekin_id or not forgekin_id.strip():
            raise ValueError("forgekin_id 不能为空。")
        self._forgekin_id: str = forgekin_id.strip()
        # layer -> mask dict
        self._layers: dict[RoleMaskLayer, dict[str, Any]] = {}

    @property
    def forgekin_id(self) -> str:
        """返回所属灵智体 ID。"""
        return self._forgekin_id

    def wear(self, layer: RoleMaskLayer, mask: dict[str, Any]) -> None:
        """戴上面具（特定层）。

        若该层已有面具，会被覆盖（新面具替换旧面具）。

        Args:
            layer: 面具层级（L1-L5）。
            mask: 面具内容（自由 dict，如 ``{"character": "孙悟空"}``）。
        """
        if not isinstance(layer, RoleMaskLayer):
            raise TypeError(f"layer 必须是 RoleMaskLayer，收到: {type(layer)}")
        self._layers[layer] = dict(mask)

    def take_off(self, layer: RoleMaskLayer) -> dict[str, Any] | None:
        """摘下面具（特定层）。

        Args:
            layer: 面具层级。

        Returns:
            被摘下的面具内容；``None`` 表示该层本来就没有面具。
        """
        if not isinstance(layer, RoleMaskLayer):
            raise TypeError(f"layer 必须是 RoleMaskLayer，收到: {type(layer)}")
        return self._layers.pop(layer, None)

    def take_off_scene_layers(self) -> dict[RoleMaskLayer, dict[str, Any]]:
        """摘下所有场景相关层（L4 / L5）。

        退出场景时调用，防止 L4 场景皮肤污染 L3 本体能力（CL-011 铁律）。

        Returns:
            被摘下的层 -> 面具内容映射。
        """
        taken: dict[RoleMaskLayer, dict[str, Any]] = {}
        for layer in RoleMaskLayer.scene_layers():
            mask = self.take_off(layer)
            if mask is not None:
                taken[layer] = mask
        return taken

    def get_active_mask(self) -> dict[RoleMaskLayer, dict[str, Any]]:
        """获取当前所有活跃面具。

        Returns:
            层 -> 面具内容映射的拷贝。
        """
        return dict(self._layers)

    def get_layer(self, layer: RoleMaskLayer) -> dict[str, Any] | None:
        """获取特定层的面具内容（不摘下）。

        Args:
            layer: 面具层级。

        Returns:
            面具内容的拷贝；``None`` 表示该层无面具。
        """
        mask = self._layers.get(layer)
        return dict(mask) if mask is not None else None

    def is_wearing(self, layer: RoleMaskLayer) -> bool:
        """判断是否戴着特定层的面具。

        Args:
            layer: 面具层级。

        Returns:
            ``True`` 表示该层有面具。
        """
        return layer in self._layers

    def describe(self) -> dict[str, Any]:
        """返回面具描述（用于日志 / 调试）。

        Returns:
            描述字典。
        """
        return {
            "forgekin_id": self._forgekin_id,
            "active_layers": [layer.name for layer in self._layers],
            "layer_count": len(self._layers),
            "has_scene_skin": self.is_wearing(RoleMaskLayer.L4_SCENE_SKIN),
        }


__all__ = ["RoleMaskLayer", "RoleMask"]
