"""PromptConfigMap — Forgekin系统提示词配置映射（EAC v1 契约 8）。

Forgekin系统提示词映射到三方 Agent：每个 forgekin × provider 组合
维护独立的 PromptConfig，避免硬编码提示词到 .py 文件（铁律 5 + P16）。

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-002 能力画像（prompt 维度）
    - [doc:rules.md#红线11] 禁止硬编码（提示词外置到 YAML）
    - [doc:prompts.md#P16] 提示词外置验证
    - [doc:design.md v7.1-§D6.2] EAC v1 七契约 #8 System Prompt Configuration Map

铁律遵守：
    - 铁律 5：禁止硬编码提示词（PromptConfig 字段来自 YAML 配置）
    - 编程红线 11：配置驱动（extra_yaml_path 指向外部 YAML 文件）
    - 编程红线 12：禁止绕过 DI 容器直接实例化
    - resolve_prompt() 拼接系统提示词字符串供 Adapter 使用

License: MIT
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.prompt_config_map")


class PromptConfig(BaseModel):
    """提示词配置（单个 forgekin × provider 组合）。

    所有字段均来自外部 YAML 配置（铁律 5 + P16），不在 .py 文件中硬编码。

    Attributes:
        prompt_key: 提示词配置键（YAML 中的唯一标识）。
        role_description: 角色描述（Forgekin在该 Provider 上下文中的定位）。
        personality_summary: 性格摘要（与 AvatarSpec.personality_summary 一致）。
        value_anchors: 价值锚点列表（Forgekin的核心价值取向）。
        restrictions: 限制列表（该 Provider 上下文中的额外约束）。
        extra_yaml_path: 额外 YAML 文件路径（可选，承载长提示词或模板片段）。
    """

    prompt_key: str = Field(..., description="提示词配置键")
    role_description: str = Field(..., description="角色描述")
    personality_summary: str = Field(default="", description="性格摘要")
    value_anchors: list[str] = Field(
        default_factory=list, description="价值锚点列表"
    )
    restrictions: list[str] = Field(
        default_factory=list, description="限制列表"
    )
    extra_yaml_path: str | None = Field(
        default=None,
        description="额外 YAML 文件路径（承载长提示词或模板片段，铁律 5+P16）",
    )


class PromptConfigMap:
    """Forgekin系统提示词配置映射（EAC v1 契约 8）。

    Forgekin系统提示词映射到三方 Agent：每个 forgekin × provider 组合
    维护独立的 PromptConfig，避免硬编码提示词到 .py 文件。

    详见 [doc:rules.md#红线11] + [doc:prompts.md#P16]

    设计要点：
        - 仅内存存储：dict[forgekin_id, dict[provider_name, PromptConfig]]
        - resolve_prompt() 拼接最终 system prompt 字符串
        - extra_yaml_path 不在本类内读取，由调用方按需加载（避免 I/O 耦合）
    """

    def __init__(self) -> None:
        """初始化空提示词映射表。

        数据通过 register_mapping 填充，由 DI 容器管理生命周期。
        """
        # forgekin_id -> provider_name -> PromptConfig
        self._mappings: dict[str, dict[str, PromptConfig]] = {}

    def register_mapping(
        self,
        forgekin_id: str,
        provider_name: str,
        prompt_config: PromptConfig,
    ) -> None:
        """注册一个 forgekin × provider 提示词映射。

        若已存在则覆盖更新（支持热更新）。

        Args:
            forgekin_id: Forgekin ID。
            provider_name: Provider 名称。
            prompt_config: 提示词配置实例。
        """
        provider_map = self._mappings.setdefault(forgekin_id, {})
        provider_map[provider_name] = prompt_config
        logger.info(
            "prompt_map.register forgekin=%s provider=%s key=%s",
            forgekin_id,
            provider_name,
            prompt_config.prompt_key,
        )

    def get_mapping(
        self, forgekin_id: str, provider_name: str
    ) -> PromptConfig | None:
        """获取指定的提示词配置。

        Args:
            forgekin_id: Forgekin ID。
            provider_name: Provider 名称。

        Returns:
            PromptConfig（不存在时返回 None）。
        """
        provider_map = self._mappings.get(forgekin_id)
        if provider_map is None:
            return None
        return provider_map.get(provider_name)

    def list_mappings(
        self, forgekin_id: str
    ) -> list[dict[str, str]]:
        """列出某Forgekin的所有提示词映射。

        Args:
            forgekin_id: Forgekin ID。

        Returns:
            映射摘要列表，每项形如 {"provider_name": ..., "prompt_key": ...}。
        """
        provider_map = self._mappings.get(forgekin_id, {})
        return [
            {"provider_name": provider, "prompt_key": cfg.prompt_key}
            for provider, cfg in provider_map.items()
        ]

    def remove_mapping(
        self, forgekin_id: str, provider_name: str
    ) -> bool:
        """移除一个提示词映射。

        Args:
            forgekin_id: Forgekin ID。
            provider_name: Provider 名称。

        Returns:
            是否成功移除（不存在返回 False）。
        """
        provider_map = self._mappings.get(forgekin_id)
        if provider_map is None or provider_name not in provider_map:
            return False
        del provider_map[provider_name]
        logger.info(
            "prompt_map.remove forgekin=%s provider=%s",
            forgekin_id,
            provider_name,
        )
        # 若该 forgekin 已无任何映射，清理空字典
        if not provider_map:
            del self._mappings[forgekin_id]
        return True

    def resolve_prompt(
        self, forgekin_id: str, provider_name: str
    ) -> str:
        """拼接最终 system prompt 字符串。

        从 PromptConfig 各字段构造（role_description / personality_summary /
        value_anchors / restrictions），extra_yaml_path 不在本类内读取。

        Args:
            forgekin_id: Forgekin ID。
            provider_name: Provider 名称。

        Returns:
            拼接后的 system prompt 字符串。

        Raises:
            KeyError: 当映射不存在时。
        """
        cfg = self.get_mapping(forgekin_id, provider_name)
        if cfg is None:
            raise KeyError(
                f"Prompt mapping not found: forgekin={forgekin_id} "
                f"provider={provider_name}"
            )
        parts: list[str] = [f"# Role\n{cfg.role_description}"]
        if cfg.personality_summary:
            parts.append(f"# Personality\n{cfg.personality_summary}")
        if cfg.value_anchors:
            parts.append(
                "# Value Anchors\n" + "\n".join(f"- {v}" for v in cfg.value_anchors)
            )
        if cfg.restrictions:
            parts.append(
                "# Restrictions\n"
                + "\n".join(f"- {r}" for r in cfg.restrictions)
            )
        if cfg.extra_yaml_path:
            parts.append(f"# Extra Config\n(yaml: {cfg.extra_yaml_path})")
        logger.debug(
            "prompt_map.resolve forgekin=%s provider=%s length=%d",
            forgekin_id,
            provider_name,
            len(parts),
        )
        return "\n\n".join(parts)
