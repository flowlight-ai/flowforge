"""育灵（Forge Nurturing）锻造流水线主类。

:class:`ForgePipeline` 是万物灵智体的锻造入口。它消费
:class:`~flowforge.forgemind.forms.ForgekinFormData`，按 6 阶段流水线
锻造灵智体实例，产出 :class:`~flowforge.forgemind.base.ForgekinBase`
的子类实例。

6 阶段流水线（FM-006）::

    1. 形态定义      — 确定灵族 species
    2. 能力注入      — 加载 CapabilityProfile
    3. 记忆初始化    — 初始化灵忆 EchoStore 种子
    4. 价值观对齐    — 注入价值锚点
    5. 能力验证      — Eval 验证（min_quality_score=0.85）
    6. 觉醒晋升      — 确认初始觉醒阶 E1

配置驱动（铁律5+P16）：阶段参数 / 提示词 / 价值锚点默认清单 / 灵族
形态工厂映射全部外置到 ``config/forging.yaml`` 和
``config/prompts.yaml``，禁止硬编码。

详见:
    - [doc:design/naming-contract.md#2.4] 育灵定义
    - [doc:review/review.md#第九章] FM-006 锻造流水线 6 阶段
    - [doc:rules.md#红线11] 禁止硬编码
"""

from __future__ import annotations

import importlib
import time
from pathlib import Path
from typing import Any

import yaml

from flowforge.forgemind.base import ForgekinBase
from flowforge.forgemind.forms import ForgekinFormData
from flowforge.forgemind.forging.stages import ForgingStage, ForgingStageResult
from flowforge.forgemind.soul_imprint import SoulImprint
from flowforge.forgemind.species import ForgekinSpecies
from flowforge.forgemind.stages import AwakeningStage, EvolutionStage


# ── 配置文件路径（相对于本文件位置）──────────────────────────────
_CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
_FORGING_YAML_PATH = _CONFIG_DIR / "forging.yaml"
_PROMPTS_YAML_PATH = _CONFIG_DIR / "prompts.yaml"


def _load_yaml(path: Path) -> dict[str, Any]:
    """加载 YAML 配置文件。

    Args:
        path: YAML 文件绝对路径。

    Returns:
        解析后的字典。

    Raises:
        FileNotFoundError: 配置文件不存在。
    """
    if not path.exists():
        raise FileNotFoundError(
            f"配置文件不存在: {path}。"
            f"育灵流水线依赖配置驱动（铁律5+P16）。"
        )
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


class ForgePipeline:
    """育灵（Forge Nurturing）锻造流水线。

    消费 :class:`ForgekinFormData`，按 6 阶段流水线锻造灵智体实例。

    配置驱动:
        - 阶段参数（required / timeout / retry）从 ``config/forging.yaml`` 加载
        - 提示词从 ``config/prompts.yaml`` 加载（铁律5+P16）
        - 灵族形态工厂映射从 ``config/forging.yaml:species_factory`` 加载

    详见:
        - [doc:design/naming-contract.md#2.4] 育灵定义
        - [doc:review/review.md#第九章] FM-006 锻造流水线
    """

    STAGES: list[str] = [
        "species_definition",
        "capability_injection",
        "memory_seeding",
        "value_alignment",
        "capability_verification",
        "awakening_promotion",
    ]

    def __init__(
        self,
        *,
        forging_config: dict[str, Any] | None = None,
        prompts_config: dict[str, Any] | None = None,
    ) -> None:
        """初始化锻造流水线。

        Args:
            forging_config: 育灵配置字典。若为 ``None``，则从
                ``config/forging.yaml`` 加载（配置驱动）。
            prompts_config: 提示词配置字典。若为 ``None``，则从
                ``config/prompts.yaml`` 加载（铁律5+P16）。
        """
        self._forging_config: dict[str, Any] = (
            forging_config if forging_config is not None
            else _load_yaml(_FORGING_YAML_PATH)
        )
        self._prompts_config: dict[str, Any] = (
            prompts_config if prompts_config is not None
            else _load_yaml(_PROMPTS_YAML_PATH)
        )
        self._forging_settings: dict[str, Any] = self._forging_config.get("forging", {})

    # ── 公开 API ─────────────────────────────────────────────────

    async def forge(self, form: ForgekinFormData) -> ForgekinBase:
        """执行完整锻造流程，产出灵智体实例。

        Args:
            form: 灵智体锻造表单（含 name / species / namespace /
                requirement / seed_params / value_anchors 等）。

        Returns:
            锻造完成的 :class:`ForgekinBase` 子类实例。

        Raises:
            RuntimeError: 任何阶段失败时抛出（含阶段名与错误信息）。
        """
        results: list[ForgingStageResult] = []
        context: dict[str, Any] = {"form": form, "imprint": None, "profile": {}}

        # 阶段 1: 形态定义
        results.append(await self._run_stage(
            ForgingStage.SPECIES_DEFINITION, context
        ))
        # 阶段 2: 能力注入
        results.append(await self._run_stage(
            ForgingStage.CAPABILITY_INJECTION, context
        ))
        # 阶段 3: 记忆初始化
        results.append(await self._run_stage(
            ForgingStage.MEMORY_SEEDING, context
        ))
        # 阶段 4: 价值观对齐
        results.append(await self._run_stage(
            ForgingStage.VALUE_ALIGNMENT, context
        ))
        # 阶段 5: 能力验证
        results.append(await self._run_stage(
            ForgingStage.CAPABILITY_VERIFICATION, context
        ))
        # 阶段 6: 觉醒晋升
        results.append(await self._run_stage(
            ForgingStage.AWAKENING_PROMOTION, context
        ))

        # 所有阶段通过后，实例化灵智体
        return self._instantiate_forgekin(form, context)

    @property
    def forging_config(self) -> dict[str, Any]:
        """返回育灵配置字典（只读视图）。"""
        return dict(self._forging_config)

    @property
    def prompts_config(self) -> dict[str, Any]:
        """返回提示词配置字典（只读视图）。"""
        return dict(self._prompts_config)

    def get_stage_config(self, stage: ForgingStage) -> dict[str, Any]:
        """返回指定阶段的配置字典。

        Args:
            stage: 阶段枚举值。

        Returns:
            阶段配置字典（含 required / timeout_seconds / retry 等）。
        """
        stages = self._forging_settings.get("stages", {})
        return dict(stages.get(stage.value, {}))

    def get_prompt(self, stage: ForgingStage) -> str:
        """返回指定阶段的提示词模板。

        提示词外置到 ``config/prompts.yaml``（铁律5+P16）。

        Args:
            stage: 阶段枚举值。

        Returns:
            提示词模板字符串（含占位符，调用方负责填充）。

        Raises:
            KeyError: 该阶段无对应提示词。
        """
        prompts = self._prompts_config.get("forging_prompts", {})
        if stage.value not in prompts:
            raise KeyError(
                f"阶段 {stage.value} 无对应提示词——"
                f"请在 config/prompts.yaml 中补全（铁律5+P16）。"
            )
        return prompts[stage.value]

    # ── 阶段执行调度 ─────────────────────────────────────────────

    async def _run_stage(
        self,
        stage: ForgingStage,
        context: dict[str, Any],
    ) -> ForgingStageResult:
        """执行单个锻造阶段。

        本方法为骨架实现——记录阶段开始 / 调用阶段处理器 / 记录结果。
        具体阶段处理器（``_handle_*``）为骨架占位，Phase 1+ 由真实
        LLM 调用与 EchoStore / Eval 系统填充。

        Args:
            stage: 阶段枚举值。
            context: 流水线上下文（跨阶段共享）。

        Returns:
            阶段执行结果。
        """
        start = time.monotonic()
        stage_config = self.get_stage_config(stage)
        try:
            handler = self._stage_handlers()[stage]
            output = await handler(context)
            duration = time.monotonic() - start
            result = ForgingStageResult(
                stage=stage,
                passed=True,
                output=output,
                duration_seconds=duration,
            )
        except Exception as exc:  # noqa: BLE001 — 流水线需捕获所有阶段异常
            duration = time.monotonic() - start
            result = ForgingStageResult(
                stage=stage,
                passed=False,
                error=f"{type(exc).__name__}: {exc}",
                duration_seconds=duration,
            )
            raise RuntimeError(
                f"育灵锻造阶段 {stage.value}（{stage.chinese_name}）失败: {exc}"
            ) from exc
        return result

    def _stage_handlers(self) -> dict[ForgingStage, Any]:
        """返回阶段处理器映射。

        Returns:
            阶段枚举 → 异步处理器协程函数 的映射。
        """
        return {
            ForgingStage.SPECIES_DEFINITION: self._handle_species_definition,
            ForgingStage.CAPABILITY_INJECTION: self._handle_capability_injection,
            ForgingStage.MEMORY_SEEDING: self._handle_memory_seeding,
            ForgingStage.VALUE_ALIGNMENT: self._handle_value_alignment,
            ForgingStage.CAPABILITY_VERIFICATION: self._handle_capability_verification,
            ForgingStage.AWAKENING_PROMOTION: self._handle_awakening_promotion,
        }

    # ── 阶段处理器（骨架实现，Phase 1+ 接入真实 LLM / Eval）──────

    async def _handle_species_definition(
        self, context: dict[str, Any]
    ) -> dict[str, Any]:
        """阶段 1: 形态定义 — 确认表单中的 species，记录选型理由。

        骨架实现: 直接采用表单中的 ``species`` 字段。Phase 1+ 接入真实
        LLM 调用，根据 ``requirement`` 自动选型。
        """
        form: ForgekinFormData = context["form"]
        return {
            "species": form.species.value,
            "species_chinese": form.species.chinese_name,
            "reason": f"表单显式指定灵族: {form.species.value}",
        }

    async def _handle_capability_injection(
        self, context: dict[str, Any]
    ) -> dict[str, Any]:
        """阶段 2: 能力注入 — 加载能力画像。

        骨架实现: 直接采用表单中的 ``capability_profile`` 字段。Phase 1+
        接入真实 LLM 生成完整能力画像。
        """
        form: ForgekinFormData = context["form"]
        profile = dict(form.capability_profile)
        context["profile"] = profile
        return {
            "capability_profile": profile,
            "native_abilities": profile.get("native_abilities", []),
            "blind_spots": profile.get("blind_spots", []),
        }

    async def _handle_memory_seeding(
        self, context: dict[str, Any]
    ) -> dict[str, Any]:
        """阶段 3: 记忆初始化 — 初始化灵忆 EchoStore 种子。

        骨架实现: 仅记录种子记忆结构。Phase 1+ 接入真实 EchoStore
        写入。
        """
        form: ForgekinFormData = context["form"]
        seed_memories = {
            "identity_memory": f"我是 {form.name}，{form.species.chinese_name}，"
                            f"归属于 {form.namespace} 命名空间。",
            "anchor_memory": "价值锚点已注入，详见灵印 value_anchors。",
            "bootstrap_memory": "首次任务最小可行行为: 观察 → 建议 → 等待 operator 确认。",
        }
        return {"seed_memories": seed_memories}

    async def _handle_value_alignment(
        self, context: dict[str, Any]
    ) -> dict[str, Any]:
        """阶段 4: 价值观对齐 — 注入价值锚点，锻造灵印。

        骨架实现: 从表单或默认清单取价值锚点，调用
        :meth:`SoulImprint.forge` 锻造灵印。
        """
        form: ForgekinFormData = context["form"]
        value_anchors = form.value_anchors or self._forging_settings.get(
            "value_anchors_default", []
        )
        # 锻造灵印（不可变身份标识）
        imprint = SoulImprint.forge(
            seed_params=form.to_imprint_seed(),
            value_anchors=list(value_anchors),
            namespace=form.namespace,
        )
        context["imprint"] = imprint
        return {
            "value_anchors": list(value_anchors),
            "imprint_hash": imprint.imprint_hash,
            "escape_hatch_ready": True,
        }

    async def _handle_capability_verification(
        self, context: dict[str, Any]
    ) -> dict[str, Any]:
        """阶段 5: 能力验证 — Eval 验证（min_quality_score=0.85）。

        骨架实现: 默认通过（quality_score=0.85）。Phase 1+ 接入真实
        Eval 系统评分，未达阈值则中止流水线。
        """
        min_score = self._forging_settings.get("min_quality_score", 0.85)
        # 骨架实现: 默认刚好达标
        quality_score = min_score
        if quality_score < min_score:
            raise RuntimeError(
                f"能力验证未达标: {quality_score} < {min_score}（rules.md 铁律2）"
            )
        return {
            "quality_score": quality_score,
            "min_quality_score": min_score,
            "passed": True,
        }

    async def _handle_awakening_promotion(
        self, context: dict[str, Any]
    ) -> dict[str, Any]:
        """阶段 6: 觉醒晋升 — 确认初始觉醒阶 E1（全导阶）。

        新锻造灵智体必须从 E1 全导阶起步，后续晋升需 operator 显式
        授权。详见 [doc:design/naming-contract.md#4] 觉醒阶进阶规则。
        """
        return {
            "awakening_stage": AwakeningStage.E1.value,
            "reason": "新锻造灵智体默认从全导阶起步，等待 operator 显式授权晋升",
            "guardrails_level": "full",
            "operator_intervention": "per_step",
        }

    # ── 灵智体实例化 ─────────────────────────────────────────────

    def _instantiate_forgekin(
        self,
        form: ForgekinFormData,
        context: dict[str, Any],
    ) -> ForgekinBase:
        """根据灵族形态工厂映射实例化灵智体。

        工厂映射配置在 ``config/forging.yaml:species_factory``，配置驱动
        （铁律5+P16）。

        Args:
            form: 锻造表单。
            context: 流水线上下文（含 imprint / profile / forgekin_config / llm_client）。

        Returns:
            :class:`ForgekinBase` 子类实例。
        """
        imprint: SoulImprint = context["imprint"]
        profile: dict[str, Any] = context.get("profile", {})
        forgekin_config: dict[str, Any] = context.get("forgekin_config", {})
        llm_client: Any | None = context.get("llm_client")

        factory = self._forging_settings.get("species_factory", {})
        species_entry = factory.get(form.species.value, {})
        module_name = species_entry.get("module")
        class_name = species_entry.get("class_name")
        if not module_name or not class_name:
            # 兜底: 直接根据 species 推导
            module_name = f"flowforge.forgemind.species_impl.{form.species.value}"
            class_name = form.species.class_name

        module = importlib.import_module(module_name)
        cls = getattr(module, class_name)

        forgekin_id = forgekin_config.get("forgekin_id") or f"{form.namespace}:{form.name}"

        # 构造参数: 通用参数 + 形态专属参数（如有）
        # v7.0: 注入 forgekin_config（含 personality/role/llm 等）和 llm_client（TraeLLMClient）
        common_kwargs: dict[str, Any] = {
            "forgekin_id": forgekin_id,
            "name": form.name,
            "soul_imprint": imprint,
            "evolution_stage": form.evolution_stage,
            "awakening_stage": form.awakening_stage,
            "capability_profile": profile,
            "forgekin_config": forgekin_config,
            "llm_client": llm_client,
        }
        return cls(**common_kwargs)

    # ── YAML 配置驱动锻造（v7.0 新增）─────────────────────────────

    async def forge_from_yaml(
        self,
        yaml_path: "Path | str",
        *,
        llm_client: Any | None = None,
    ) -> ForgekinBase:
        """从 YAML 配置文件锻造灵智体（v7.0 育灵体系核心入口）.

        本方法是 forgemind 应用层的核心入口——operator 通过编写 YAML
        配置文件定义灵智体（参考 clowder-ai/cat-template.json 范式），
        ForgePipeline 读取配置并按 6 阶段流水线锻造灵智体实例。

        所有 3 只预置灵智体（鲁班/夏洛克/梵高）通过本方法锻造，全部接入
        Trae CN 桥接方案——operator 通过 Trae CN IDE 充当 LLM 与监工。

        YAML 配置结构详见:
            - forgemind/forgekins/luban.yaml（参考实现）
            - forgemind/forgekins/sherlock.yaml
            - forgemind/forgekins/vangogh.yaml

        Args:
            yaml_path: YAML 配置文件路径（绝对或相对路径）。
            llm_client: LLM 客户端实例（如 TraeLLMClient）。若为 None，
                灵智体 chat 方法将返回降级响应。

        Returns:
            锻造完成的 :class:`ForgekinBase` 子类实例，已注入 YAML 配置
            和 LLM 客户端。

        Raises:
            FileNotFoundError: YAML 文件不存在。
            ValueError: YAML 配置缺失必填字段。
            RuntimeError: 锻造阶段失败。
        """
        path = Path(yaml_path) if not isinstance(yaml_path, Path) else yaml_path
        if not path.exists():
            raise FileNotFoundError(
                f"灵智体 YAML 配置不存在: {path}。"
                f"预置配置位于 forgemind/forgekins/ 目录。"
            )

        with path.open("r", encoding="utf-8") as f:
            config = yaml.safe_load(f) or {}

        # 校验必填字段
        required_fields = ["name", "species", "namespace"]
        for field in required_fields:
            if not config.get(field):
                raise ValueError(
                    f"YAML 配置缺失必填字段 {field!r}: {path}。"
                    f"参考 forgemind/forgekins/luban.yaml。"
                )

        # 从 YAML 配置构造 ForgekinFormData
        species = ForgekinSpecies.from_string(config["species"])
        evolution_stage = EvolutionStage.from_string(
            config.get("evolution_stage", "E1")
        )
        awakening_stage = AwakeningStage.from_string(
            config.get("awakening_stage", "E1")
        )

        form = ForgekinFormData(
            name=config["name"],
            species=species,
            namespace=config["namespace"],
            requirement=config.get("role", {}).get("description", ""),
            seed_params={
                "forgekin_id": config.get("forgekin_id"),
                "breed": config.get("breed"),
                "breed_en": config.get("breed_en"),
            },
            value_anchors=config.get("value_anchors", []),
            capability_profile=config.get("capability_profile", {}),
            evolution_stage=evolution_stage,
            awakening_stage=awakening_stage,
            operator_id=config.get("operator_id"),
        )

        # 将完整 YAML 配置和 LLM 客户端放入流水线上下文
        # _instantiate_forgekin 会读取这两个字段注入到灵智体实例
        context_extra: dict[str, Any] = {
            "forgekin_config": config,
            "llm_client": llm_client,
        }

        # 临时存储到实例属性，让 forge() 方法能访问
        self._pending_context_extra = context_extra

        # 执行标准 6 阶段锻造流程
        forgekin = await self.forge(form)

        # 清理临时属性
        self._pending_context_extra = None

        return forgekin

    async def forge(self, form: ForgekinFormData) -> ForgekinBase:
        """执行完整锻造流程，产出灵智体实例。

        Args:
            form: 灵智体锻造表单（含 name / species / namespace /
                requirement / seed_params / value_anchors 等）。

        Returns:
            锻造完成的 :class:`ForgekinBase` 子类实例。

        Raises:
            RuntimeError: 任何阶段失败时抛出（含阶段名与错误信息）。
        """
        results: list[ForgingStageResult] = []
        context: dict[str, Any] = {"form": form, "imprint": None, "profile": {}}

        # v7.0: 注入 forge_from_yaml 传递的额外上下文（forgekin_config / llm_client）
        extra = getattr(self, "_pending_context_extra", None)
        if extra:
            context.update(extra)

        # 阶段 1: 形态定义
        results.append(await self._run_stage(
            ForgingStage.SPECIES_DEFINITION, context
        ))
        # 阶段 2: 能力注入
        results.append(await self._run_stage(
            ForgingStage.CAPABILITY_INJECTION, context
        ))
        # 阶段 3: 记忆初始化
        results.append(await self._run_stage(
            ForgingStage.MEMORY_SEEDING, context
        ))
        # 阶段 4: 价值观对齐
        results.append(await self._run_stage(
            ForgingStage.VALUE_ALIGNMENT, context
        ))
        # 阶段 5: 能力验证
        results.append(await self._run_stage(
            ForgingStage.CAPABILITY_VERIFICATION, context
        ))
        # 阶段 6: 觉醒晋升
        results.append(await self._run_stage(
            ForgingStage.AWAKENING_PROMOTION, context
        ))

        # 所有阶段通过后，实例化灵智体
        return self._instantiate_forgekin(form, context)
