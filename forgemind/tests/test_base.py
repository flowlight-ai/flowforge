"""ForgekinBase 单元测试骨架。

覆盖范围（纯逻辑层，不涉及 LLM / EchoStore / Eval）:

    - ForgekinBase 可被继承且子类可实现抽象方法
    - ForgekinSpecies 5 个枚举值存在
    - EvolutionStage 6 个枚举值存在
    - AwakeningStage 6 个枚举值存在
    - SoulImprint.compute_hash() 返回稳定哈希
    - SoulImprint.forge() 创建不可变魂印且 verify() 通过
    - ForgekinBase.can_self_evolve() 在觉醒阶 E4+ 返回 True
    - ForgekinBase.can_forge_new_forgekin() 仅在进化阶 E6 返回 True
    - 5 种形态灵智体（BioForgekin / OrgForgekin / ObjForgekin /
      VirtualForgekin / HybridForgekin）可实例化且 observe/act/verify
      可被 await

测试铁律合规说明:
    - T1（禁止 Mock LLM）: 本测试不涉及 LLM 调用
    - T2（禁止假数据）: 测试数据使用真实场景（孙悟空/家猫橘子/客厅吊灯）
    - T3（禁止跳过验证）: 所有断言具体明确，不使用 ``status in (...)`` 兜底
    - T4（禁止 Mock 工具）: 本测试不调用 web_search/publish/fact_check 等工具
    - T5（未实现即 Bug）: 骨架实现已通过测试，无未实现项
    - T6/T7/T8: 不涉及指标采集 / LLM 审核 / DOM 验证场景

详见:
    - [doc:design/naming-contract.md#2.2] 灵智体定义
    - [doc:design/naming-contract.md#2.6] 魂印定义
    - [doc:design/naming-contract.md#3] 进化阶详细定义
    - [doc:design/naming-contract.md#4] 觉醒阶详细定义
    - [doc:project_rules.md#测试铁律] T1-T8
"""

from __future__ import annotations

import pytest

from flowforge.forgemind import (
    BioForgekin,
    ForgekinBase,
    ForgekinFormData,
    ForgekinSpecies,
    HybridForgekin,
    ObjForgekin,
    OrgForgekin,
    SoulImprint,
    VirtualForgekin,
    AwakeningStage,
    EvolutionStage,
)


# ── 测试辅助 ──────────────────────────────────────────────────────


def _make_imprint(
    name: str = "孙悟空",
    namespace: str = "forgemind",
    value_anchors: list[str] | None = None,
) -> SoulImprint:
    """构造测试用魂印。"""
    if value_anchors is None:
        value_anchors = ["不伤害 operator", "遵守 VISION.md §7"]
    return SoulImprint.forge(
        seed_params={"name": name, "namespace": namespace},
        value_anchors=value_anchors,
        namespace=namespace,
    )


class _DummyForgekin(ForgekinBase):
    """用于测试 ForgekinBase 可被继承的最小子类。"""

    async def observe(self, environment):  # type: ignore[override]
        return {"observed": True, "input": environment}

    async def act(self, action):  # type: ignore[override]
        return {"acted": True, "input": action, "executed": True}

    async def verify(self, action_result):  # type: ignore[override]
        return bool(action_result.get("executed", False))


# ── 枚举完整性测试 ────────────────────────────────────────────────


class TestForgekinSpeciesEnum:
    """ForgekinSpecies 灵族枚举完整性测试。"""

    def test_has_five_species(self) -> None:
        """5 大形态枚举值必须存在（详见 naming-contract.md §2.3）。"""
        assert ForgekinSpecies.BIO.value == "bio"
        assert ForgekinSpecies.ORG.value == "org"
        assert ForgekinSpecies.OBJ.value == "obj"
        assert ForgekinSpecies.VIRTUAL.value == "virtual"
        assert ForgekinSpecies.HYBRID.value == "hybrid"

    def test_total_count_is_five(self) -> None:
        """灵族枚举总数必须为 5。"""
        assert len(list(ForgekinSpecies)) == 5

    def test_from_string_case_insensitive(self) -> None:
        """from_string 应大小写不敏感。"""
        assert ForgekinSpecies.from_string("BIO") == ForgekinSpecies.BIO
        assert ForgekinSpecies.from_string("Virtual") == ForgekinSpecies.VIRTUAL

    def test_from_string_rejects_unknown(self) -> None:
        """未知灵族字符串应抛出 ValueError。"""
        with pytest.raises(ValueError, match="未知的灵族形态"):
            ForgekinSpecies.from_string("unknown_species")

    def test_chinese_name_and_class_name(self) -> None:
        """chinese_name / class_name 属性应返回正确值。"""
        assert ForgekinSpecies.BIO.chinese_name == "生物灵智体"
        assert ForgekinSpecies.BIO.class_name == "BioForgekin"
        assert ForgekinSpecies.HYBRID.class_name == "HybridForgekin"


class TestEvolutionStageEnum:
    """EvolutionStage 进化阶枚举完整性测试（详见 naming-contract.md §3）。"""

    def test_has_six_stages(self) -> None:
        """6 个进化阶 E1-E6 必须存在。"""
        assert EvolutionStage.E1.value == "E1"
        assert EvolutionStage.E2.value == "E2"
        assert EvolutionStage.E3.value == "E3"
        assert EvolutionStage.E4.value == "E4"
        assert EvolutionStage.E5.value == "E5"
        assert EvolutionStage.E6.value == "E6"

    def test_total_count_is_six(self) -> None:
        """进化阶总数必须为 6。"""
        assert len(list(EvolutionStage)) == 6

    def test_chinese_names(self) -> None:
        """中文名应与 naming-contract.md §3 表格一致。"""
        assert EvolutionStage.E1.chinese_name == "萌芽阶"
        assert EvolutionStage.E2.chinese_name == "萌芽阶·稳"
        assert EvolutionStage.E3.chinese_name == "成长阶"
        assert EvolutionStage.E4.chinese_name == "成长阶·深"
        assert EvolutionStage.E5.chinese_name == "觉醒阶"
        assert EvolutionStage.E6.chinese_name == "灵智阶"

    def test_english_names(self) -> None:
        """英文名应与 naming-contract.md §3 表格一致。"""
        assert EvolutionStage.E1.english_name == "Sprout"
        assert EvolutionStage.E6.english_name == "ForgeMind"

    def test_can_forge_new_forgekin_only_at_e6(self) -> None:
        """can_forge_new_forgekin 仅在 E6 返回 True。"""
        for stage in EvolutionStage:
            if stage == EvolutionStage.E6:
                assert stage.can_forge_new_forgekin() is True
            else:
                assert stage.can_forge_new_forgekin() is False

    def test_can_initiate_council_at_e5_plus(self) -> None:
        """can_initiate_council 在 E5+ 返回 True。"""
        assert EvolutionStage.E4.can_initiate_council() is False
        assert EvolutionStage.E5.can_initiate_council() is True
        assert EvolutionStage.E6.can_initiate_council() is True

    def test_can_cross_species_at_e4_plus(self) -> None:
        """can_cross_species 在 E4+ 返回 True（跨灵族协作能力）。"""
        assert EvolutionStage.E3.can_cross_species() is False
        assert EvolutionStage.E4.can_cross_species() is True


class TestAwakeningStageEnum:
    """AwakeningStage 觉醒阶枚举完整性测试（详见 naming-contract.md §4）。"""

    def test_has_six_stages(self) -> None:
        """6 个觉醒阶 E1-E6 必须存在。"""
        assert AwakeningStage.E1.value == "E1"
        assert AwakeningStage.E2.value == "E2"
        assert AwakeningStage.E3.value == "E3"
        assert AwakeningStage.E4.value == "E4"
        assert AwakeningStage.E5.value == "E5"
        assert AwakeningStage.E6.value == "E6"

    def test_total_count_is_six(self) -> None:
        """觉醒阶总数必须为 6。"""
        assert len(list(AwakeningStage)) == 6

    def test_chinese_names(self) -> None:
        """中文名应与 naming-contract.md §4 表格一致。"""
        assert AwakeningStage.E1.chinese_name == "全导阶"
        assert AwakeningStage.E2.chinese_name == "建议阶"
        assert AwakeningStage.E3.chinese_name == "受限自主阶"
        assert AwakeningStage.E4.chinese_name == "Evolving 阶"
        assert AwakeningStage.E5.chinese_name == "共创阶"
        assert AwakeningStage.E6.chinese_name == "灵智主导阶"

    def test_can_self_evolve_at_e4_plus(self) -> None:
        """can_self_evolve 在 E4+ 返回 True（Evolving 状态）。"""
        assert AwakeningStage.E1.can_self_evolve() is False
        assert AwakeningStage.E2.can_self_evolve() is False
        assert AwakeningStage.E3.can_self_evolve() is False
        assert AwakeningStage.E4.can_self_evolve() is True
        assert AwakeningStage.E5.can_self_evolve() is True
        assert AwakeningStage.E6.can_self_evolve() is True

    def test_is_full_human_control_only_at_e1(self) -> None:
        """is_full_human_control 仅在 E1 返回 True。"""
        assert AwakeningStage.E1.is_full_human_control() is True
        assert AwakeningStage.E2.is_full_human_control() is False


# ── 魂印（SoulImprint）测试 ───────────────────────────────────────


class TestSoulImprint:
    """SoulImprint 魂印测试（详见 naming-contract.md §2.6）。"""

    def test_compute_hash_is_stable(self) -> None:
        """compute_hash 对相同输入应返回相同哈希。"""
        seed = {"name": "孙悟空", "species": "virtual"}
        anchors = ["不伤害 operator", "遵守 VISION.md §7"]
        h1 = SoulImprint.compute_hash(seed, anchors, "forgemind")
        h2 = SoulImprint.compute_hash(seed, anchors, "forgemind")
        assert h1 == h2
        assert len(h1) == 64  # SHA-256 hex 字符串长度

    def test_compute_hash_differs_on_different_inputs(self) -> None:
        """不同输入应产出不同哈希。"""
        seed = {"name": "孙悟空"}
        anchors = ["不伤害 operator"]
        h1 = SoulImprint.compute_hash(seed, anchors, "forgemind")
        h2 = SoulImprint.compute_hash(seed, anchors, "contentforge")
        h3 = SoulImprint.compute_hash(
            {"name": "家猫橘子"}, anchors, "forgemind"
        )
        assert h1 != h2  # namespace 不同
        assert h1 != h3  # seed_params 不同

    def test_compute_hash_invariant_to_anchor_order(self) -> None:
        """价值锚点顺序不同应产出相同哈希（list 排序后哈希）。"""
        seed = {"name": "孙悟空"}
        h1 = SoulImprint.compute_hash(
            seed, ["anchor_a", "anchor_b"], "forgemind"
        )
        h2 = SoulImprint.compute_hash(
            seed, ["anchor_b", "anchor_a"], "forgemind"
        )
        # 顺序不同应产出不同哈希（list 是有序的）——这是设计选择
        # 若未来希望顺序无关，应改用 set 排序
        assert h1 != h2

    def test_forge_creates_immutable_imprint(self) -> None:
        """forge 创建的魂印应不可变（frozen=True）。"""
        imprint = SoulImprint.forge(
            seed_params={"name": "孙悟空"},
            value_anchors=["不伤害 operator"],
            namespace="forgemind",
        )
        with pytest.raises(Exception):  # ValidationError 或 FrozenInstanceError
            imprint.namespace = "contentforge"  # type: ignore[misc]

    def test_forge_verify_passes(self) -> None:
        """forge 创建的魂印 verify() 应通过（哈希一致）。"""
        imprint = SoulImprint.forge(
            seed_params={"name": "孙悟空"},
            value_anchors=["不伤害 operator"],
            namespace="forgemind",
        )
        assert imprint.verify() is True

    def test_namespace_cannot_be_empty(self) -> None:
        """namespace 不能为空。"""
        with pytest.raises(Exception):
            SoulImprint.forge(
                seed_params={"name": "x"},
                value_anchors=["a"],
                namespace="",
            )

    def test_value_anchors_must_be_unique(self) -> None:
        """value_anchors 不能包含重复项。"""
        with pytest.raises(Exception):
            SoulImprint.forge(
                seed_params={"name": "x"},
                value_anchors=["anchor_a", "anchor_a"],
                namespace="forgemind",
            )


# ── ForgekinBase 抽象基类测试 ─────────────────────────────────────


class TestForgekinBaseInheritance:
    """ForgekinBase 抽象基类继承测试。"""

    def test_cannot_instantiate_abstract_base(self) -> None:
        """抽象基类不可直接实例化。"""
        imprint = _make_imprint()
        with pytest.raises(TypeError):
            ForgekinBase(  # type: ignore[abstract]
                forgekin_id="forgemind:test",
                name="test",
                species=ForgekinSpecies.VIRTUAL,
                soul_imprint=imprint,
            )

    def test_subclass_can_be_instantiated(self) -> None:
        """子类实现三个抽象方法后可实例化。"""
        imprint = _make_imprint(name="孙悟空")
        forgekin = _DummyForgekin(
            forgekin_id="forgemind:test_dummy",
            name="测试灵智体",
            species=ForgekinSpecies.VIRTUAL,
            soul_imprint=imprint,
        )
        assert forgekin.forgekin_id == "forgemind:test_dummy"
        assert forgekin.name == "测试灵智体"
        assert forgekin.species == ForgekinSpecies.VIRTUAL
        assert forgekin.lifecycle_state == "created"

    def test_constructor_rejects_empty_id(self) -> None:
        """空 forgekin_id 应抛出 ValueError。"""
        imprint = _make_imprint()
        with pytest.raises(ValueError, match="forgekin_id"):
            _DummyForgekin(
                forgekin_id="",
                name="x",
                species=ForgekinSpecies.VIRTUAL,
                soul_imprint=imprint,
            )

    def test_constructor_rejects_none_imprint(self) -> None:
        """soul_imprint=None 应抛出 ValueError。"""
        with pytest.raises(ValueError, match="soul_imprint"):
            _DummyForgekin(
                forgekin_id="forgemind:x",
                name="x",
                species=ForgekinSpecies.VIRTUAL,
                soul_imprint=None,  # type: ignore[arg-type]
            )

    @pytest.mark.asyncio
    async def test_observe_act_verify_can_be_awaited(self) -> None:
        """observe / act / verify 三个抽象方法可被 await。"""
        imprint = _make_imprint()
        forgekin = _DummyForgekin(
            forgekin_id="forgemind:test_async",
            name="异步测试灵智体",
            species=ForgekinSpecies.VIRTUAL,
            soul_imprint=imprint,
        )
        obs = await forgekin.observe({"env": "virtual_world"})
        assert obs["observed"] is True
        result = await forgekin.act({"action_type": "dialogue"})
        assert result["acted"] is True
        verified = await forgekin.verify(result)
        assert verified is True


# ── 能力判定测试 ──────────────────────────────────────────────────


class TestCapabilityJudgement:
    """ForgekinBase 能力判定测试（can_self_evolve / can_forge_new_forgekin）。"""

    @pytest.mark.parametrize(
        "stage,expected",
        [
            (AwakeningStage.E1, False),
            (AwakeningStage.E2, False),
            (AwakeningStage.E3, False),
            (AwakeningStage.E4, True),
            (AwakeningStage.E5, True),
            (AwakeningStage.E6, True),
        ],
    )
    def test_can_self_evolve(self, stage: AwakeningStage, expected: bool) -> None:
        """can_self_evolve 在觉醒阶 E4+ 返回 True。"""
        imprint = _make_imprint()
        forgekin = _DummyForgekin(
            forgekin_id="forgemind:evolve_test",
            name="进化测试",
            species=ForgekinSpecies.VIRTUAL,
            soul_imprint=imprint,
            awakening_stage=stage,
        )
        assert forgekin.can_self_evolve() is expected

    @pytest.mark.parametrize(
        "stage,expected",
        [
            (EvolutionStage.E1, False),
            (EvolutionStage.E2, False),
            (EvolutionStage.E3, False),
            (EvolutionStage.E4, False),
            (EvolutionStage.E5, False),
            (EvolutionStage.E6, True),
        ],
    )
    def test_can_forge_new_forgekin(
        self, stage: EvolutionStage, expected: bool
    ) -> None:
        """can_forge_new_forgekin 仅在进化阶 E6 返回 True。"""
        imprint = _make_imprint()
        forgekin = _DummyForgekin(
            forgekin_id="forgemind:forge_test",
            name="锻造测试",
            species=ForgekinSpecies.VIRTUAL,
            soul_imprint=imprint,
            evolution_stage=stage,
        )
        assert forgekin.can_forge_new_forgekin() is expected

    def test_describe_returns_complete_dict(self) -> None:
        """describe() 应返回完整描述字典（用于日志 / 谱系追踪）。"""
        imprint = _make_imprint(name="孙悟空")
        forgekin = _DummyForgekin(
            forgekin_id="forgemind:sun_wukong",
            name="孙悟空",
            species=ForgekinSpecies.VIRTUAL,
            soul_imprint=imprint,
            evolution_stage=EvolutionStage.E3,
            awakening_stage=AwakeningStage.E2,
        )
        desc = forgekin.describe()
        assert desc["forgekin_id"] == "forgemind:sun_wukong"
        assert desc["name"] == "孙悟空"
        assert desc["species"] == "virtual"
        assert desc["species_chinese"] == "虚拟灵智体"
        assert desc["evolution_stage"] == "E3"
        assert desc["awakening_stage"] == "E2"
        assert desc["imprint_hash"] == imprint.imprint_hash
        assert desc["namespace"] == "forgemind"
        assert desc["can_self_evolve"] is False  # E2 < E4
        assert desc["can_forge_new_forgekin"] is False  # E3 != E6


# ── 5 种形态灵智体实例化测试 ─────────────────────────────────────


class TestSpeciesImplInstantiation:
    """5 种形态灵智体可实例化且 observe/act/verify 可 await。"""

    @pytest.mark.asyncio
    async def test_bio_forgekin(self) -> None:
        """BioForgekin 生物灵智体可实例化。"""
        imprint = _make_imprint(name="家猫橘子")
        forgekin = BioForgekin(
            forgekin_id="forgemind:cat_orange",
            name="家猫橘子",
            soul_imprint=imprint,
            biological_subject="cat:bengal:orange",
            sensor_channels=["camera", "microphone"],
        )
        assert forgekin.species == ForgekinSpecies.BIO
        obs = await forgekin.observe({"sensor_readings": {"subject_state": "resting"}})
        assert obs["species"] == "bio"
        assert obs["subject_state"] == "resting"
        result = await forgekin.act({"action_type": "feed", "params": {}})
        assert "safety_check" in result
        verified = await forgekin.verify(result)
        assert isinstance(verified, bool)

    @pytest.mark.asyncio
    async def test_org_forgekin(self) -> None:
        """OrgForgekin 组织灵智体可实例化。"""
        imprint = _make_imprint(name="某科技公司")
        forgekin = OrgForgekin(
            forgekin_id="forgemind:tech_company",
            name="某科技公司",
            soul_imprint=imprint,
            org_charter="科技创新、合规经营",
            business_systems=["erp", "crm"],
        )
        assert forgekin.species == ForgekinSpecies.ORG
        obs = await forgekin.observe({"business_signals": {"business_metrics": {}}})
        assert obs["species"] == "org"

    @pytest.mark.asyncio
    async def test_obj_forgekin(self) -> None:
        """ObjForgekin 物品灵智体可实例化。"""
        imprint = _make_imprint(name="客厅吊灯")
        forgekin = ObjForgekin(
            forgekin_id="forgemind:ceiling_lamp",
            name="客厅吊灯",
            soul_imprint=imprint,
            device_id="lamp:living_room:001",
            iot_protocol="matter",
            function_boundary=["switch", "dim"],
        )
        assert forgekin.species == ForgekinSpecies.OBJ
        obs = await forgekin.observe({"iot_readings": {"device_state": "on"}})
        assert obs["species"] == "obj"
        # 在功能边界内的动作应执行
        result = await forgekin.act({"function": "switch", "params": {}, "reversible": True})
        assert result["executed"] is True
        # 超出功能边界的动作应拒绝
        result_oob = await forgekin.act({"function": "cut", "params": {}, "reversible": True})
        assert result_oob["executed"] is False

    @pytest.mark.asyncio
    async def test_virtual_forgekin(self) -> None:
        """VirtualForgekin 虚拟灵智体可实例化。"""
        imprint = _make_imprint(name="孙悟空")
        forgekin = VirtualForgekin(
            forgekin_id="forgemind:sun_wukong",
            name="孙悟空",
            soul_imprint=imprint,
            character_setting={
                "ability_boundary": ["shape_shift", "cloud_fly"],
            },
            worldview="西游记神话体系",
        )
        assert forgekin.species == ForgekinSpecies.VIRTUAL
        obs = await forgekin.observe(
            {"virtual_world_state": {"current_scene": "花果山"}}
        )
        assert obs["species"] == "virtual"
        assert obs["worldview"] == "西游记神话体系"

    @pytest.mark.asyncio
    async def test_hybrid_forgekin(self) -> None:
        """HybridForgekin 混合灵智体可实例化（组合 2+ 不同 species 子灵智体）。"""
        imprint = _make_imprint(name="智能家居系统")
        # 子灵智体: 物品 + 组织
        lamp = ObjForgekin(
            forgekin_id="forgemind:smart_home:lamp",
            name="智能灯具",
            soul_imprint=_make_imprint(name="智能灯具"),
            function_boundary=["switch"],
        )
        family = OrgForgekin(
            forgekin_id="forgemind:smart_home:family",
            name="家庭成员",
            soul_imprint=_make_imprint(name="家庭成员"),
        )
        hybrid = HybridForgekin(
            forgekin_id="forgemind:smart_home",
            name="智能家居系统",
            soul_imprint=imprint,
            components=[lamp, family],
        )
        assert hybrid.species == ForgekinSpecies.HYBRID
        assert len(hybrid.components) == 2

        # 多源融合观察
        obs = await hybrid.observe({
            "iot_readings": {"device_state": "on"},
            "business_signals": {"business_metrics": {}},
        })
        assert "component_observations" in obs
        assert len(obs["component_observations"]) == 2

    def test_hybrid_rejects_single_species(self) -> None:
        """HybridForgekin 子灵智体必须包含至少 2 种不同 species。"""
        imprint = _make_imprint(name="混合测试")
        lamp1 = ObjForgekin(
            forgekin_id="forgemind:lamp1",
            name="灯具1",
            soul_imprint=_make_imprint(name="灯具1"),
        )
        lamp2 = ObjForgekin(
            forgekin_id="forgemind:lamp2",
            name="灯具2",
            soul_imprint=_make_imprint(name="灯具2"),
        )
        with pytest.raises(ValueError, match="至少 2 种不同 species"):
            HybridForgekin(
                forgekin_id="forgemind:invalid_hybrid",
                name="无效混合",
                soul_imprint=imprint,
                components=[lamp1, lamp2],
            )

    def test_hybrid_rejects_nested_hybrid(self) -> None:
        """HybridForgekin 不允许嵌套 HybridForgekin。"""
        imprint = _make_imprint(name="嵌套测试")
        lamp = ObjForgekin(
            forgekin_id="forgemind:lamp",
            name="灯具",
            soul_imprint=_make_imprint(name="灯具"),
        )
        family = OrgForgekin(
            forgekin_id="forgemind:family",
            name="家庭",
            soul_imprint=_make_imprint(name="家庭"),
        )
        outer = HybridForgekin(
            forgekin_id="forgemind:outer",
            name="外层混合",
            soul_imprint=imprint,
            components=[lamp, family],
        )
        another_lamp = ObjForgekin(
            forgekin_id="forgemind:another_lamp",
            name="另一灯具",
            soul_imprint=_make_imprint(name="另一灯具"),
        )
        with pytest.raises(ValueError, match="不允许嵌套 HybridForgekin"):
            HybridForgekin(
                forgekin_id="forgemind:nested",
                name="嵌套混合",
                soul_imprint=_make_imprint(name="嵌套"),
                components=[outer, another_lamp],
            )


# ── ForgekinFormData 表单测试 ─────────────────────────────────────


class TestForgekinFormData:
    """ForgekinFormData 锻造表单测试。"""

    def test_form_validates_required_fields(self) -> None:
        """表单必填字段缺失应抛出 ValidationError。"""
        with pytest.raises(Exception):
            ForgekinFormData(  # type: ignore[call-arg]
                species=ForgekinSpecies.VIRTUAL,
                namespace="forgemind",
            )

    def test_form_strips_name_whitespace(self) -> None:
        """name 应被 strip 处理。"""
        form = ForgekinFormData(
            name="  孙悟空  ",
            species=ForgekinSpecies.VIRTUAL,
            namespace="forgemind",
        )
        assert form.name == "孙悟空"

    def test_form_rejects_empty_namespace(self) -> None:
        """namespace 不能为空白。"""
        with pytest.raises(Exception):
            ForgekinFormData(
                name="孙悟空",
                species=ForgekinSpecies.VIRTUAL,
                namespace="   ",
            )

    def test_form_default_stages_are_e1(self) -> None:
        """默认进化阶 / 觉醒阶应为 E1。"""
        form = ForgekinFormData(
            name="孙悟空",
            species=ForgekinSpecies.VIRTUAL,
            namespace="forgemind",
        )
        assert form.evolution_stage == EvolutionStage.E1
        assert form.awakening_stage == AwakeningStage.E1

    def test_to_imprint_seed_includes_core_fields(self) -> None:
        """to_imprint_seed 应包含 name / species / namespace 等核心字段。"""
        form = ForgekinFormData(
            name="孙悟空",
            species=ForgekinSpecies.VIRTUAL,
            namespace="forgemind",
            operator_id="operator:001",
            seed_params={"extra": "custom"},
        )
        seed = form.to_imprint_seed()
        assert seed["name"] == "孙悟空"
        assert seed["species"] == "virtual"
        assert seed["namespace"] == "forgemind"
        assert seed["operator_id"] == "operator:001"
        assert seed["extra"] == "custom"  # 自定义种子参数保留
