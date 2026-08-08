"""ProviderTransportRegistry — Agent Provider 传输注册表（F241 CL-014）。

host 维护所有 agentProvider 的注册表，Forgekin通过查询注册表发现能力。

设计依据：
    - [doc:review/review.md#13.3] F241 Agent Provider Plugin（CL-014）
    - [doc:review/review.md#第九章§9.2] EX-008 三方 Agent 能力发现机制缺失
    - [doc:decisions/006-external-agent-integration.md] §3 ExternalAgentAdapter 抽象层

铁律遵守：
    - 铁律 5：禁止硬编码（注册表数据从 YAML 配置加载）
    - 编程红线 11：配置驱动 > 代码实现
    - 编程红线 12：禁止绕过 DI 容器直接实例化

License: MIT
"""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import ValidationError

from flowforge.core.external_agent.manifest import AgentProviderManifest
from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.registry")


class ProviderTransportRegistry:
    """Agent Provider 传输注册表（F241 CL-014）。

    host 维护所有 agentProvider 的注册表，Forgekin通过查询注册表发现能力。

    详见 [doc:review/review.md#13.3] F241 Agent Provider Plugin

    核心接口：
        - register(manifest): 注册一个 Provider
        - discover(capability): 按能力发现 Provider 列表（EX-008）
        - get(provider_name): 按名称获取 Provider Manifest
        - list_all(): 列出所有 Provider

    数据来源：
        - 从 config/manifests/*.yaml 加载（铁律 5 配置驱动）
        - 也可通过 register() 运行时注册（用于测试 / 动态扩展）
    """

    def __init__(self) -> None:
        """初始化空注册表。

        注册表数据通过 register() 或 load_from_dir() 填充。
        """
        self._providers: dict[str, AgentProviderManifest] = {}

    def register(self, manifest: AgentProviderManifest) -> None:
        """注册一个 Provider。

        Args:
            manifest: Provider 声明式 Manifest。

        Raises:
            ValueError: 当 provider_name 已存在时。
        """
        if manifest.provider_name in self._providers:
            raise ValueError(
                f"Provider already registered: {manifest.provider_name}"
            )
        self._providers[manifest.provider_name] = manifest
        logger.info(
            "registry.register provider=%s capabilities=%d blind_spots=%d",
            manifest.provider_name,
            len(manifest.capabilities),
            len(manifest.blind_spots),
        )

    def discover(self, capability: str) -> list[AgentProviderManifest]:
        """按能力发现 Provider 列表（EX-008 能力发现机制）。

        Forgekin查询"谁能做 code_review"，返回所有声明了该能力的 Provider。

        Args:
            capability: 能力名称（如 "code_generation" / "code_review"）。

        Returns:
            匹配的 Provider Manifest 列表（按 Manifest 优先级或注册顺序）。
        """
        matched = [
            m for m in self._providers.values() if capability in m.capabilities
        ]
        logger.debug(
            "registry.discover capability=%s matched=%d",
            capability,
            len(matched),
        )
        return matched

    def get(self, provider_name: str) -> AgentProviderManifest | None:
        """按名称获取 Provider Manifest。

        Args:
            provider_name: Provider 唯一标识。

        Returns:
            Manifest 实例，不存在时返回 None。
        """
        return self._providers.get(provider_name)

    def list_all(self) -> list[AgentProviderManifest]:
        """列出所有已注册的 Provider Manifest。"""
        return list(self._providers.values())

    def list_provider_names(self) -> list[str]:
        """列出所有已注册的 Provider 名称。"""
        return list(self._providers.keys())

    def unregister(self, provider_name: str) -> bool:
        """注销一个 Provider（用于热更新 / 测试清理）。

        Args:
            provider_name: Provider 唯一标识。

        Returns:
            是否成功注销（不存在时返回 False）。
        """
        if provider_name in self._providers:
            del self._providers[provider_name]
            logger.info("registry.unregister provider=%s", provider_name)
            return True
        return False

    def load_from_dir(self, manifests_dir: str | Path) -> int:
        """从目录加载所有 Manifest YAML（铁律 5 配置驱动）。

        Args:
            manifests_dir: Manifest YAML 文件目录。

        Returns:
            成功加载的 Manifest 数量。

        Raises:
            FileNotFoundError: 当目录不存在时。
            ValidationError: 当 YAML 文件不符合 Manifest schema 时。
        """
        manifests_path = Path(manifests_dir)
        if not manifests_path.exists():
            raise FileNotFoundError(
                f"Manifests directory not found: {manifests_path}"
            )
        count = 0
        for yaml_file in manifests_path.glob("*.yaml"):
            try:
                data = yaml.safe_load(yaml_file.read_text(encoding="utf-8"))
                if not isinstance(data, dict):
                    logger.warning(
                        "registry.load skip non-dict yaml: %s", yaml_file
                    )
                    continue
                manifest = AgentProviderManifest(**data)
                # 若已存在则覆盖（支持热更新）
                if manifest.provider_name in self._providers:
                    self._providers[manifest.provider_name] = manifest
                    logger.info(
                        "registry.load update provider=%s from %s",
                        manifest.provider_name,
                        yaml_file.name,
                    )
                else:
                    self.register(manifest)
                count += 1
            except (ValidationError, ValueError) as e:
                logger.error(
                    "registry.load failed file=%s error=%s", yaml_file.name, e
                )
                raise
        logger.info(
            "registry.load_from_dir dir=%s loaded=%d total=%d",
            manifests_path,
            count,
            len(self._providers),
        )
        return count
